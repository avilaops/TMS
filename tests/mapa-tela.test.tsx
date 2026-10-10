// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assentar, ate, clicar, desmontarTudo, montar } from "./tela";
import type { Manifesto } from "../src/app/dashboard/manifestos/carregar";
import { ATRIBUICAO_DO_MAPA, BLOCOS_PADRAO, type MapaDaViagem } from "../src/lib/mapa";
import { INTERVALO_DE_ENVIO_MS } from "../src/lib/posicao";

/**
 * As telas do mapa e do GPS, sem navegador de verdade:
 * - o componente do mapa, com o Leaflet trocado por um registro do que foi
 *   desenhado (o jsdom não desenha mapa; o que se confere é o que o componente
 *   pede ao Leaflet e o que ele escreve em volta);
 * - a aba Rota do painel alternando entre a lista e o mapa;
 * - o compartilhamento da localização no app do motorista, com a geolocalização
 *   do navegador trocada.
 */

type Chamada = { tipo: string; args: unknown[]; balao?: unknown; dica?: unknown };

const leaflet = vi.hoisted(() => {
  const chamadas: { tipo: string; args: unknown[]; balao?: unknown; dica?: unknown }[] = [];
  const estado = { mapas: 0, removidos: 0, limpezas: 0, enquadramentos: [] as unknown[][], blocos: undefined as unknown[] | undefined };
  const camada = (tipo: string, args: unknown[]) => {
    const registro: { tipo: string; args: unknown[]; balao?: unknown; dica?: unknown } = { tipo, args };
    chamadas.push(registro);
    const objeto = {
      addTo: () => objeto,
      remove: () => objeto,
      bindPopup: (conteudo: unknown) => {
        registro.balao = conteudo;
        return objeto;
      },
      bindTooltip: (conteudo: unknown) => {
        registro.dica = conteudo;
        return objeto;
      },
      clearLayers: () => {
        estado.limpezas += 1;
        chamadas.length = 0;
        return objeto;
      },
    };
    return objeto;
  };
  const modulo = {
    map: (...args: unknown[]) => {
      estado.mapas += 1;
      const mapa = {
        opcoes: args[1],
        setView: (...a: unknown[]) => {
          estado.enquadramentos.push(["setView", ...a]);
          return mapa;
        },
        fitBounds: (...a: unknown[]) => {
          estado.enquadramentos.push(["fitBounds", ...a]);
          return mapa;
        },
        invalidateSize: () => mapa,
        remove: () => {
          estado.removidos += 1;
          return mapa;
        },
      };
      return mapa;
    },
    tileLayer: (...args: unknown[]) => {
      estado.blocos = args;
      return { addTo: () => undefined };
    },
    layerGroup: () => camada("grupo", []),
    marker: (...args: unknown[]) => camada("marker", args),
    divIcon: (opcoes: unknown) => opcoes,
    polyline: (...args: unknown[]) => camada("polyline", args),
    circleMarker: (...args: unknown[]) => camada("circleMarker", args),
    circle: (...args: unknown[]) => camada("circle", args),
  };
  return { chamadas, estado, modulo };
});

vi.mock("leaflet", () => ({ ...leaflet.modulo, default: leaflet.modulo }));
vi.mock("leaflet/dist/leaflet.css", () => ({}));
vi.mock("next/link", () => ({
  default: ({ href, children, className, ...resto }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className} {...resto}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({ useParams: () => ({ id: "viagem-1" }), useRouter: () => ({ push: () => undefined }) }));

import { MapaDaViagemNaTela } from "../src/components/mapa/mapa-da-viagem";
import { TelaDaViagem } from "../src/app/dashboard/manifestos/viagem";
import ViagemDoMotorista from "../src/app/driver/viagem/[id]/page";
import { desligarGps, estadoDoGps } from "../src/lib/gps-motorista";

const desenhadas = (tipo: string): Chamada[] => leaflet.chamadas.filter((chamada) => chamada.tipo === tipo);

const MAPA: MapaDaViagem = {
  status: "ROUTE",
  origem: { lat: -20.8113, lon: -49.3758, nome: "São José do Rio Preto/SP" },
  paradas: [
    { id: "a", numero: 1, receiver: "Mercado <b>Bom</b> Preço", destino: "Rua das Flores, 120, Mirassol - SP", status: "DELIVERED", ponto: { lat: -20.82, lon: -49.51, precisao: "endereco" }, aLocalizar: false },
    { id: "b", numero: 2, receiver: "Padaria Central", destino: "Catanduva - SP", status: "ROUTE", ponto: { lat: -21.1314, lon: -48.977, precisao: "cidade" }, aLocalizar: true },
    { id: "c", numero: 3, receiver: "Sem lugar", destino: "Lugar Nenhum", status: "ROUTE", ponto: null, aLocalizar: false },
  ],
  posicao: { lat: -20.9, lon: -49.4, precisao: 25, em: new Date(Date.now() - 5 * 60_000).toISOString() },
  localizaEndereco: true,
};

beforeEach(() => {
  leaflet.chamadas.length = 0;
  Object.assign(leaflet.estado, { mapas: 0, removidos: 0, limpezas: 0, enquadramentos: [], blocos: undefined });
});

afterEach(async () => {
  await desmontarTudo();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("mapa da viagem (Leaflet)", () => {
  it("usa os blocos do OpenStreetMap com o crédito visível e desenha as paradas numeradas, a linha e o motorista", async () => {
    const tela = await montar(<MapaDaViagemNaTela mapa={MAPA} />);
    await ate(() => expect(desenhadas("marker")).toHaveLength(2));

    expect(leaflet.estado.blocos).toEqual([BLOCOS_PADRAO, { attribution: ATRIBUICAO_DO_MAPA, maxZoom: 19 }]);
    expect(ATRIBUICAO_DO_MAPA).toContain("OpenStreetMap");
    expect(ATRIBUICAO_DO_MAPA).toContain("https://www.openstreetmap.org/copyright");

    // Um marcador por parada com ponto, no ponto dela, com o número; a sem localização fica de fora.
    const marcadores = desenhadas("marker");
    expect(marcadores.map((m) => m.args[0])).toEqual([[-20.82, -49.51], [-21.1314, -48.977]]);
    const icones = marcadores.map((m) => (m.args[1] as { icon: { html: string } }).icon.html);
    expect(icones[0]).toContain(">1</div>");
    expect(icones[1]).toContain(">2</div>");
    // Endereço localizado: marcador cheio. Centro da cidade: tracejado.
    expect(icones[0]).not.toContain("dashed");
    expect(icones[1]).toContain("dashed");
    // Entregue em verde, a entregar em azul.
    expect(icones[0]).toContain("#16a34a");
    expect(icones[1]).toContain("#2563eb");

    // A linha sai da origem e passa pelas paradas, na ordem.
    expect(desenhadas("polyline")[0].args[0]).toEqual([[-20.8113, -49.3758], [-20.82, -49.51], [-21.1314, -48.977]]);

    // A origem e o motorista são círculos; o motorista leva também o raio de erro do aparelho.
    const circulos = desenhadas("circleMarker");
    expect(circulos.map((c) => c.args[0])).toEqual([[-20.8113, -49.3758], [-20.9, -49.4]]);
    expect(circulos[0].dica).toBe("Origem: São José do Rio Preto/SP");
    expect(circulos[1].dica).toBe("Motorista, há 5 min");
    expect(desenhadas("circle")[0].args).toEqual([[-20.9, -49.4], expect.objectContaining({ radius: 25 })]);

    // Enquadra tudo o que foi desenhado, uma vez.
    expect(leaflet.estado.enquadramentos).toHaveLength(1);
    expect(leaflet.estado.enquadramentos[0][0]).toBe("fitBounds");
    expect((leaflet.estado.enquadramentos[0][1] as unknown[]).length).toBe(4);

    const legenda = tela.querySelector("[data-legenda-do-mapa]")!.textContent ?? "";
    expect(tela.querySelector("[data-posicao-do-motorista]")!.textContent).toContain("Motorista: localização há 5 min (±25 m).");
    expect(tela.querySelector("[data-pelo-centro]")!.textContent).toContain("1 parada está no centro da cidade (marcador tracejado); 1 endereço ainda está sendo localizado.");
    expect(tela.querySelector("[data-fora-do-mapa]")!.textContent).toContain("1 parada ficou fora do mapa");
    expect(legenda).toContain("Linha reta entre as paradas, não o caminho da estrada.");
    expect(legenda).toContain("Trânsito não entra na conta: não existe em fonte aberta.");
    expect(legenda).toContain("Google Maps");
  });

  it("o nome do destinatário vai para o balão como texto, nunca como HTML", async () => {
    await montar(<MapaDaViagemNaTela mapa={MAPA} />);
    await ate(() => expect(desenhadas("marker")).toHaveLength(2));
    const balao = desenhadas("marker")[0].balao as HTMLElement;
    expect(balao).toBeInstanceOf(HTMLElement);
    expect(balao.querySelector("b")).toBeNull();
    expect(balao.textContent).toBe("1. Mercado <b>Bom</b> Preço" + "Rua das Flores, 120, Mirassol - SP");
  });

  it("sem posição compartilhada, diz; viagem fora de rota não fala de motorista", async () => {
    const semPosicao = await montar(<MapaDaViagemNaTela mapa={{ ...MAPA, posicao: null }} />);
    await ate(() => expect(desenhadas("marker")).toHaveLength(2));
    expect(semPosicao.querySelector("[data-sem-posicao]")!.textContent).toContain("Motorista sem localização compartilhada.");
    expect(desenhadas("circleMarker")).toHaveLength(1);
    expect(desenhadas("circle")).toHaveLength(0);
    await desmontarTudo();

    const emMontagem = await montar(<MapaDaViagemNaTela mapa={{ ...MAPA, status: "ASSEMBLING", posicao: null }} />);
    await ate(() => expect(leaflet.estado.mapas).toBe(2));
    expect(emMontagem.querySelector("[data-sem-posicao]")).toBeNull();
    expect(emMontagem.querySelector("[data-posicao-do-motorista]")).toBeNull();
  });

  it("no app do motorista vale a posição lida do aparelho; posição nova redesenha sem enquadrar de novo", async () => {
    const agora = Date.now();
    const tela = await montar(<MapaDaViagemNaTela mapa={{ ...MAPA, posicao: null }} posicaoDoAparelho={{ lat: -20.85, lon: -49.45, precisao: 8, em: agora }} />);
    await ate(() => expect(desenhadas("circleMarker")).toHaveLength(2));
    expect(desenhadas("circleMarker")[1].args[0]).toEqual([-20.85, -49.45]);
    expect(tela.querySelector("[data-posicao-do-motorista]")!.textContent).toContain("localização agora (±8 m)");
    expect(leaflet.estado.enquadramentos).toHaveLength(1);
    await desmontarTudo();

    // Mesma tela, o motorista andou: os marcadores são refeitos, o enquadramento não.
    const limpezas = leaflet.estado.limpezas;
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(<MapaDaViagemNaTela mapa={MAPA} />));
    await ate(() => expect(leaflet.estado.enquadramentos).toHaveLength(2));
    await act(async () => root.render(<MapaDaViagemNaTela mapa={{ ...MAPA, posicao: { ...MAPA.posicao!, lat: -20.95 } }} />));
    await ate(() => expect(desenhadas("circleMarker")[1].args[0]).toEqual([-20.95, -49.4]));
    expect(leaflet.estado.limpezas).toBeGreaterThan(limpezas + 1);
    expect(leaflet.estado.enquadramentos).toHaveLength(2);
    await act(async () => root.unmount());
    container.remove();
  });

  it("desmontar a tela desfaz o mapa", async () => {
    await montar(<MapaDaViagemNaTela mapa={MAPA} />);
    await ate(() => expect(leaflet.estado.mapas).toBe(1));
    // A roda do mouse fica desligada para não prender a rolagem do painel.
    await desmontarTudo();
    expect(leaflet.estado.removidos).toBe(1);
  });
});

/* ------------------------------ Aba Rota do painel ----------------------------- */

type Pedido = { url: string; method: string };

function api(responder: (pedido: Pedido) => { status?: number; body: unknown } | undefined) {
  const pedidos: Pedido[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const pedido: Pedido = { url: String(url), method: init?.method ?? "GET" };
      pedidos.push(pedido);
      const resposta = responder(pedido);
      if (!resposta) throw new Error(`Chamada inesperada: ${pedido.method} ${pedido.url}`);
      return new Response(JSON.stringify(resposta.body), { status: resposta.status ?? 200 });
    }),
  );
  return pedidos;
}

describe("aba Rota: lista ou mapa", () => {
  const carga = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    sender: "Remetente",
    receiver: `Destinatário ${id}`,
    origin: "São José do Rio Preto - SP",
    destination: "Mirassol - SP",
    volumes: 1,
    weight: 10,
    client: { tradeName: "Aurora", companyName: "Comercial Aurora Ltda" },
    status: "ROUTE",
    manifestId: "viagem-1",
    ...extra,
  });
  const manifesto: Manifesto = {
    id: "viagem-1",
    status: "ROUTE",
    createdAt: "2026-10-01T12:00:00.000Z",
    driver: { id: "m1", user: { name: "Ana" }, cpf: "1", active: true },
    vehicle: { id: "v1", plate: "ABC1D23", model: "Caminhão", type: "TRUCK", status: "AVAILABLE" },
    collections: [carga("a", { deliveryStreet: "Rua das Flores", deliveryNumber: "120", deliveryDistrict: "Centro", deliveryZip: "15130000" }), carga("b")],
  };

  const abrirRota = async () => {
    const tela = await montar(<TelaDaViagem manifesto={manifesto} veAcerto={false} aprovaDespesa={false} onClose={() => {}} onChange={() => {}} />);
    await clicar(tela.querySelector('[data-aba="Rota"]')!);
    return tela;
  };

  it("abre na lista, com o endereço da parada, e o link do Google Maps leva o endereço inteiro", async () => {
    const pedidos = api(({ url }) => (url === "/api/equipe/ajudantes" ? { body: [] } : undefined));
    const tela = await abrirRota();
    expect(tela.querySelector('[data-parada="a"]')!.textContent).toContain("Rua das Flores, 120 - Centro, Mirassol - SP, 15130-000");
    expect(tela.querySelector('[data-parada="b"]')!.textContent).toContain("Mirassol - SP");
    const link = tela.querySelector<HTMLAnchorElement>("[data-rota-no-mapa]")!;
    expect(link.textContent).toContain("Google Maps");
    expect(decodeURIComponent(link.href)).toContain("Rua das Flores, 120 - Centro, Mirassol - SP, 15130-000");
    // O mapa não é pedido enquanto a pessoa não abre.
    expect(tela.querySelector("[data-mapa-da-viagem]")).toBeNull();
    expect(pedidos.some((p) => p.url.endsWith("/mapa"))).toBe(false);
  });

  it("o botão Mapa troca a lista pelo mapa, lido do servidor; Lista volta", async () => {
    const pedidos = api(({ url }) => {
      if (url === "/api/equipe/ajudantes") return { body: [] };
      if (url === "/api/manifestos/viagem-1/mapa") return { body: MAPA };
      return undefined;
    });
    const tela = await abrirRota();
    await clicar(tela.querySelector("[data-ver-mapa]")!);
    await ate(() => expect(tela.querySelector("[data-mapa-da-viagem]")).not.toBeNull());
    expect(tela.querySelector("[data-parada]")).toBeNull();
    expect(pedidos.filter((p) => p.url.endsWith("/mapa"))).toHaveLength(1);
    expect(tela.querySelector("[data-posicao-do-motorista]")!.textContent).toContain("localização há 5 min");
    expect(tela.querySelector("[data-sem-geo]")).toBeNull();
    expect(tela.querySelector("[data-ver-mapa]")!.textContent).toContain("Lista");

    await clicar(tela.querySelector("[data-ver-mapa]")!);
    expect(tela.querySelector("[data-mapa-da-viagem]")).toBeNull();
    expect(tela.querySelectorAll("[data-parada]")).toHaveLength(2);
  });

  it("servidor sem GEO_CONTATO: a tela avisa que as paradas estão no centro da cidade", async () => {
    api(({ url }) => {
      if (url === "/api/equipe/ajudantes") return { body: [] };
      if (url.endsWith("/mapa")) return { body: { ...MAPA, localizaEndereco: false } };
      return undefined;
    });
    const tela = await abrirRota();
    await clicar(tela.querySelector("[data-ver-mapa]")!);
    await ate(() => expect(tela.querySelector("[data-sem-geo]")).not.toBeNull());
    expect(tela.querySelector("[data-sem-geo]")!.textContent).toContain("GEO_CONTATO");
  });

  it("erro ao ler o mapa aparece na tela", async () => {
    api(({ url }) => {
      if (url === "/api/equipe/ajudantes") return { body: [] };
      if (url.endsWith("/mapa")) return { status: 403, body: { error: "Acesso negado." } };
      return undefined;
    });
    const tela = await abrirRota();
    await clicar(tela.querySelector("[data-ver-mapa]")!);
    await ate(() => expect(tela.querySelector('[data-aba-do-mapa] [role="alert"]')?.textContent).toContain("Acesso negado."));
    expect(tela.querySelector("[data-mapa-da-viagem]")).toBeNull();
  });
});

/* --------------------------- Viagem no app do motorista ------------------------ */

describe("viagem no app do motorista: endereço, mapa e botão de localização", () => {
  const VIAGEM = {
    id: "viagem-1",
    collections: [
      {
        id: "a",
        receiver: "Mercado Bom Preço",
        destination: "Mirassol - SP",
        volumes: 2,
        weight: 30,
        status: "ROUTE",
        receiverName: null,
        pickupDate: null,
        pickupFrom: null,
        pickupTo: null,
        priority: "NORMAL",
        cubicMeters: null,
        pickupNotes: null,
        deliveryStreet: "Rua das Flores",
        deliveryNumber: "120",
        deliveryDistrict: "Centro",
        deliveryZip: "15130000",
        client: { tradeName: "Aurora", companyName: "Comercial Aurora Ltda" },
      },
    ],
  };
  type Sucesso = (lida: { coords: { latitude: number; longitude: number; accuracy: number } }) => void;
  type Falha = (erro: { code: number }) => void;
  const gps = { observar: vi.fn(), parar: vi.fn(), sucesso: null as Sucesso | null, falha: null as Falha | null };

  beforeEach(() => {
    sessionStorage.clear();
    gps.observar.mockReset();
    gps.parar.mockReset();
    gps.observar.mockImplementation((sucesso: Sucesso, falha: Falha) => {
      gps.sucesso = sucesso;
      gps.falha = falha;
      return 3;
    });
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: { watchPosition: gps.observar, clearWatch: gps.parar } });
  });

  afterEach(() => {
    desligarGps();
  });

  const abrir = async () => {
    const pedidos: { url: string; method: string; corpo: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        pedidos.push({ url: String(url), method: init?.method ?? "GET", corpo: typeof init?.body === "string" ? JSON.parse(init.body) : null });
        if (String(url) === "/api/driver/manifestos") return new Response(JSON.stringify([VIAGEM]));
        if (String(url) === "/api/driver/manifestos/viagem-1/mapa") return new Response(JSON.stringify({ ...MAPA, posicao: null }));
        if (String(url) === "/api/driver/manifestos/viagem-1/posicao") return new Response(JSON.stringify({ ok: true }));
        throw new Error(`Chamada inesperada: ${String(url)}`);
      }),
    );
    const tela = await montar(<ViagemDoMotorista />);
    await ate(() => expect(tela.querySelector("[data-compartilhar-localizacao]")).not.toBeNull());
    return { tela, pedidos };
  };

  it("mostra o endereço da parada, leva o endereço inteiro ao Google Maps e não pede a localização ao abrir", async () => {
    const { tela, pedidos } = await abrir();
    expect(tela.querySelector('[data-endereco="a"]')!.textContent).toBe("Rua das Flores, 120 - Centro, Mirassol - SP, 15130-000");
    const link = tela.querySelector<HTMLAnchorElement>("[data-rota-no-mapa]")!;
    expect(link.textContent).toContain("Google Maps");
    expect(decodeURIComponent(link.href)).toContain("Rua das Flores, 120 - Centro, Mirassol - SP, 15130-000");

    // Nada de permissão nem de mapa sem o toque.
    expect(gps.observar).not.toHaveBeenCalled();
    expect(tela.querySelector("[data-mapa-do-motorista]")).toBeNull();
    expect(pedidos.map((p) => p.url)).toEqual(["/api/driver/manifestos"]);
    const aviso = tela.querySelector("[data-aviso-do-gps]")!.textContent ?? "";
    expect(aviso).toContain("a transportadora vê onde você está enquanto o app estiver aberto na tela");
    expect(aviso).toContain("O cliente não vê");
  });

  it("o toque em Compartilhar localização pede a posição, envia para a viagem e avisa que só vale com o app aberto; o segundo toque para", async () => {
    const { tela, pedidos } = await abrir();
    const botao = tela.querySelector("[data-compartilhar-localizacao]")!;
    expect(botao.textContent).toContain("Compartilhar localização");

    await clicar(botao);
    expect(gps.observar).toHaveBeenCalledTimes(1);
    expect(botao.getAttribute("aria-pressed")).toBe("true");
    expect(botao.textContent).toContain("Parar localização");
    expect(tela.querySelector("[data-aviso-do-gps]")!.textContent).toContain("aguardando o GPS");

    gps.sucesso!({ coords: { latitude: -20.81, longitude: -49.37, accuracy: 9 } });
    await ate(() => expect(tela.querySelector("[data-aviso-do-gps]")!.textContent).toContain("enviada agora"));
    expect(tela.querySelector("[data-aviso-do-gps]")!.textContent).toContain("Só funciona com o app aberto na tela");
    expect(pedidos.find((p) => p.method === "POST")).toEqual({ url: "/api/driver/manifestos/viagem-1/posicao", method: "POST", corpo: { lat: -20.81, lon: -49.37, precisao: 9 } });

    await clicar(botao);
    expect(gps.parar).toHaveBeenCalledWith(3);
    expect(estadoDoGps().situacao).toBe("desligado");
    expect(botao.getAttribute("aria-pressed")).toBe("false");
  });

  it("permissão negada: o botão volta e a tela explica como liberar", async () => {
    const { tela } = await abrir();
    await clicar(tela.querySelector("[data-compartilhar-localizacao]")!);
    gps.falha!({ code: 1 });
    await ate(() => expect(tela.querySelector("[data-aviso-do-gps]")!.textContent).toContain("A permissão de localização foi negada"));
    expect(tela.querySelector("[data-compartilhar-localizacao]")!.getAttribute("aria-pressed")).toBe("false");
  });

  it("Ver mapa carrega o mapa da viagem dele e mostra a posição lida do aparelho", async () => {
    const { tela, pedidos } = await abrir();
    await clicar(tela.querySelector("[data-ver-mapa]")!);
    await ate(() => expect(tela.querySelector("[data-mapa-do-motorista] [data-mapa-da-viagem]")).not.toBeNull());
    expect(pedidos.filter((p) => p.url.endsWith("/mapa"))).toHaveLength(1);
    expect(tela.querySelector("[data-sem-posicao]")).not.toBeNull();

    await clicar(tela.querySelector("[data-compartilhar-localizacao]")!);
    gps.sucesso!({ coords: { latitude: -20.81, longitude: -49.37, accuracy: 9 } });
    await ate(() => expect(tela.querySelector("[data-posicao-do-motorista]")?.textContent).toContain("localização agora (±9 m)"));
    await ate(() => expect(desenhadas("circleMarker").some((c) => JSON.stringify(c.args[0]) === "[-20.81,-49.37]")).toBe(true));
  });
});

/* ------------------------------ GPS do motorista ------------------------------ */

describe("compartilhar a localização no app do motorista", () => {
  type Sucesso = (lida: { coords: { latitude: number; longitude: number; accuracy: number } }) => void;
  type Falha = (erro: { code: number }) => void;

  /** Troca a geolocalização do navegador e a rede; devolve os controles do teste. */
  async function aparelho(respostaDoServidor: () => { status: number } = () => ({ status: 200 })) {
    const gps = { observar: vi.fn(), parar: vi.fn(), sucesso: null as Sucesso | null, falha: null as Falha | null };
    gps.observar.mockImplementation((sucesso: Sucesso, falha: Falha) => {
      gps.sucesso = sucesso;
      gps.falha = falha;
      return 7;
    });
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: { watchPosition: gps.observar, clearWatch: gps.parar } });
    const enviados: { url: string; corpo: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        enviados.push({ url: String(url), corpo: JSON.parse(String(init?.body)) });
        return new Response("{}", { status: respostaDoServidor().status });
      }),
    );
    vi.resetModules();
    const modulo = await import("../src/lib/gps-motorista");
    return { gps, enviados, modulo };
  }

  const ler = (lat: number, lon: number, accuracy = 10) => ({ coords: { latitude: lat, longitude: lon, accuracy } });

  beforeEach(() => {
    sessionStorage.clear();
  });

  it("carregar o módulo não pede permissão: só o toque em ligar chama o navegador", async () => {
    const { gps, modulo, enviados } = await aparelho();
    expect(gps.observar).not.toHaveBeenCalled();
    expect(modulo.estadoDoGps()).toEqual(modulo.GPS_DESLIGADO);

    modulo.ligarGps("viagem-1");
    expect(gps.observar).toHaveBeenCalledTimes(1);
    expect(modulo.estadoDoGps()).toMatchObject({ manifestId: "viagem-1", situacao: "pedindo", posicao: null });
    expect(enviados).toHaveLength(0);
    modulo.desligarGps();
  });

  it("a primeira posição sai na hora; as seguintes, a cada 30 segundos, e só enquanto ligado", async () => {
    vi.useFakeTimers();
    const { gps, modulo, enviados } = await aparelho();
    const avisos = vi.fn();
    const cancelar = modulo.assinarGps(avisos);

    modulo.ligarGps("viagem-1");
    gps.sucesso!(ler(-20.81, -49.37, 12));
    await vi.advanceTimersByTimeAsync(0);
    expect(enviados).toEqual([{ url: "/api/driver/manifestos/viagem-1/posicao", corpo: { lat: -20.81, lon: -49.37, precisao: 12 } }]);
    expect(modulo.estadoDoGps()).toMatchObject({ situacao: "ligado", posicao: { lat: -20.81, lon: -49.37, precisao: 12 } });
    expect(typeof modulo.estadoDoGps().enviadaEm).toBe("number");
    expect(avisos).toHaveBeenCalled();

    // O aparelho avisa de novo antes do relógio: guarda, não envia.
    gps.sucesso!(ler(-20.82, -49.38));
    await vi.advanceTimersByTimeAsync(1000);
    expect(enviados).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(INTERVALO_DE_ENVIO_MS);
    expect(enviados).toHaveLength(2);
    expect(enviados[1].corpo).toEqual({ lat: -20.82, lon: -49.38, precisao: 10 });

    // Ao registrar a entrega, a posição sai na hora.
    expect(await modulo.enviarPosicaoAgora()).toBe(true);
    expect(enviados).toHaveLength(3);

    modulo.desligarGps();
    expect(gps.parar).toHaveBeenCalledWith(7);
    expect(modulo.estadoDoGps()).toEqual(modulo.GPS_DESLIGADO);
    await vi.advanceTimersByTimeAsync(INTERVALO_DE_ENVIO_MS * 3);
    expect(enviados).toHaveLength(3);
    expect(await modulo.enviarPosicaoAgora()).toBe(false);
    cancelar();
  });

  it("posição lida há mais de dois minutos não é enviada como se fosse a de agora", async () => {
    vi.useFakeTimers();
    const { gps, modulo, enviados } = await aparelho();
    modulo.ligarGps("viagem-1");
    gps.sucesso!(ler(-20.81, -49.37));
    await vi.advanceTimersByTimeAsync(0);
    expect(enviados).toHaveLength(1);
    // Tela bloqueada: o aparelho parou de avisar. O relógio segue, mas não reenvia posição velha.
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(enviados.length).toBeLessThanOrEqual(5);
    const antes = enviados.length;
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(enviados).toHaveLength(antes);
    modulo.desligarGps();
  });

  it("permissão negada desliga e diz; falta de sinal segue tentando", async () => {
    const { gps, modulo, enviados } = await aparelho();
    modulo.ligarGps("viagem-1");
    gps.falha!({ code: 2 });
    expect(modulo.estadoDoGps()).toMatchObject({ situacao: "pedindo", semSinal: true, manifestId: "viagem-1" });
    expect(gps.parar).not.toHaveBeenCalled();

    gps.falha!({ code: 1 });
    expect(modulo.estadoDoGps()).toMatchObject({ situacao: "negado", manifestId: null, posicao: null });
    expect(gps.parar).toHaveBeenCalledWith(7);
    expect(enviados).toHaveLength(0);
  });

  it("viagem finalizada ou sessão caída (404, 401, 403) desliga o compartilhamento; erro passageiro, não", async () => {
    for (const status of [404, 401, 403]) {
      const { gps, modulo } = await aparelho(() => ({ status }));
      modulo.ligarGps("viagem-1");
      gps.sucesso!(ler(-20.81, -49.37));
      await assentar(5);
      expect(modulo.estadoDoGps().situacao, String(status)).toBe("desligado");
      expect(gps.parar).toHaveBeenCalled();
    }
    for (const status of [429, 500]) {
      const { gps, modulo } = await aparelho(() => ({ status }));
      modulo.ligarGps("viagem-1");
      gps.sucesso!(ler(-20.81, -49.37));
      await assentar(5);
      expect(modulo.estadoDoGps(), String(status)).toMatchObject({ situacao: "ligado", enviadaEm: null });
      modulo.desligarGps();
    }
  });

  it("aparelho sem geolocalização: diz que não dá, sem quebrar", async () => {
    const { modulo } = await aparelho();
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: undefined });
    modulo.ligarGps("viagem-1");
    expect(modulo.estadoDoGps()).toMatchObject({ situacao: "indisponivel", manifestId: null });
  });

  it("depois de recarregar, só religa sozinho se ele tinha ligado nesta viagem e a permissão já está concedida", async () => {
    // O relógio do envio é de mentira aqui: o módulo ligado não deixa temporizador de verdade para trás.
    vi.useFakeTimers();
    const permissao = { state: "granted" };
    Object.defineProperty(navigator, "permissions", { configurable: true, value: { query: async () => permissao } });

    let { gps, modulo } = await aparelho();
    await modulo.retomarGps("viagem-1");
    expect(gps.observar).not.toHaveBeenCalled();

    modulo.ligarGps("viagem-1");
    expect(sessionStorage.getItem("tms-gps-viagem")).toBe("viagem-1");

    // Página recarregada: módulo novo, a sessão do navegador lembra.
    ({ gps, modulo } = await aparelho());
    await modulo.retomarGps("outra-viagem");
    expect(gps.observar).not.toHaveBeenCalled();
    await modulo.retomarGps("viagem-1");
    expect(gps.observar).toHaveBeenCalledTimes(1);
    modulo.desligarGps();
    expect(sessionStorage.getItem("tms-gps-viagem")).toBeNull();

    // Permissão ainda não concedida: não abre pedido sem toque.
    sessionStorage.setItem("tms-gps-viagem", "viagem-1");
    permissao.state = "prompt";
    ({ gps, modulo } = await aparelho());
    await modulo.retomarGps("viagem-1");
    expect(gps.observar).not.toHaveBeenCalled();
  });
});
