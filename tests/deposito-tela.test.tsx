// @vitest-environment jsdom
import { Suspense, act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ate, clicar, desmontarTudo, montar, porTexto } from "./tela";
import { barrasCode128B } from "../src/lib/code128";
import type { CargaConferida, CargaNoDeposito, ContadoresDoDeposito, VolumeDaCarga } from "../src/lib/deposito";

/**
 * Telas do depósito: a visão, a conferência por leitura, as posições e as
 * etiquetas. As regras e as rotas são testadas em `tests/deposito.test.ts`;
 * aqui se confere o que cada tela mostra e o que ela manda para a API.
 */

vi.mock("next/link", () => ({
  default: ({ href, children, className, ...resto }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className} {...resto}>
      {children}
    </a>
  ),
}));

import DepositoPage from "../src/app/dashboard/deposito/page";
import ConferenciaPage from "../src/app/dashboard/deposito/conferencia/page";
import PosicoesPage from "../src/app/dashboard/deposito/posicoes/page";
import EtiquetasPage from "../src/app/dashboard/deposito/etiquetas/[coletaId]/page";

type Resposta = { status?: number; body: unknown };
type Pedido = { url: string; method: string; body: Record<string, unknown> | undefined };

/** Respostas por "MÉTODO endereço" (o GET dispensa o método): fixas, ou calculadas a partir do corpo do pedido. */
function api(respostas: Record<string, Resposta | ((body: Record<string, unknown> | undefined) => Resposta)>) {
  const pedidos: Pedido[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
      pedidos.push({ url: String(url), method, body });
      const resposta = respostas[method === "GET" ? String(url) : `${method} ${String(url)}`];
      if (!resposta) throw new Error(`Chamada inesperada: ${method} ${String(url)}`);
      const { status, body: corpo } = typeof resposta === "function" ? resposta(body) : resposta;
      return new Response(JSON.stringify(corpo), { status: status ?? 200 });
    }),
  );
  return pedidos;
}

const carregando = (tela: HTMLElement) => tela.querySelector('[aria-label="Carregando"]');

async function digitar(campo: HTMLInputElement, valor: string) {
  const gravar = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    gravar.call(campo, valor);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function enviar(form: HTMLFormElement) {
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

afterEach(async () => {
  await desmontarTudo();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

const RASTREIO = "1234567890";

const volume = (sequence: number, dados: Partial<VolumeDaCarga> = {}): VolumeDaCarga => ({
  sequence,
  code: `${RASTREIO}-0${sequence}`,
  status: "PENDING",
  weight: null,
  damageNote: null,
  checkedAt: null,
  checkedBy: null,
  location: null,
  ...dados,
});

/** A carga de três volumes no estado dado: o resumo sai dos volumes. */
function carga(volumes: VolumeDaCarga[], extra: Partial<CargaConferida> & { status?: string } = {}): CargaConferida {
  const presentes = volumes.filter((v) => v.status === "RECEIVED" || v.status === "DAMAGED");
  const avariados = volumes.filter((v) => v.status === "DAMAGED").length;
  const { status = "CONFIRMED", ...resto } = extra;
  return {
    carga: {
      id: "c1",
      trackingCode: RASTREIO,
      status,
      emManifesto: false,
      cliente: "Serilon",
      sender: "Remetente",
      receiver: "Mercado Bom Preço",
      origin: "Rio Preto/SP",
      destination: "Mirassol/SP",
      volumes: volumes.length,
      weight: 30,
    },
    volumes,
    resumo: {
      esperados: volumes.length,
      recebidos: presentes.length - avariados,
      avariados,
      faltando: volumes.filter((v) => v.status === "MISSING").length,
      pendentes: volumes.filter((v) => v.status === "PENDING").length,
      pesoConferido: null,
      divergenciaDeQuantidade: presentes.length !== volumes.length,
      divergenciaDePeso: false,
    },
    conferencia: null,
    recusa: null,
    ...resto,
  };
}

const recebido = (sequence: number, dados: Partial<VolumeDaCarga> = {}) => volume(sequence, { status: "RECEIVED", checkedAt: "2026-10-09T12:00:00.000Z", ...dados });

describe("tela de conferência", () => {
  const campoDe = (tela: HTMLElement) => tela.querySelector<HTMLInputElement>('form[aria-label="Leitura"] input')!;
  const aviso = (tela: HTMLElement) => tela.querySelector("[data-aviso]");
  const situacaoDe = (tela: HTMLElement, sequence: number) => tela.querySelector(`[data-volume="${sequence}"] [data-situacao]`)?.getAttribute("data-situacao");
  const progresso = (tela: HTMLElement) => tela.querySelector("[data-progresso]")?.textContent;

  /** Digita no campo de leitura e aperta Enter, como o leitor de código de barras faz. */
  async function ler(tela: HTMLElement, texto: string) {
    await digitar(campoDe(tela), texto);
    await enviar(tela.querySelector<HTMLFormElement>('form[aria-label="Leitura"]')!);
  }

  const BUSCA = `/api/deposito/conferencia?codigo=${RASTREIO}`;
  const VOLUMES = "POST /api/deposito/coletas/c1/volumes";
  const POSICAO = "POST /api/deposito/coletas/c1/posicao";
  const CONCLUIR = "POST /api/deposito/coletas/c1/concluir";

  it("começa com o campo de leitura em foco e mais nada", async () => {
    api({});
    const tela = await montar(<ConferenciaPage />);
    expect(document.activeElement).toBe(campoDe(tela));
    expect(campoDe(tela).placeholder).toBe("Código de rastreio da carga");
    expect(tela.querySelector('[aria-label="Carga"]')).toBeNull();
    expect(tela.textContent).toContain("Leia com o leitor");
  });

  it("ler o código da carga abre os volumes esperados; ler cada etiqueta marca o volume, sem contar duas vezes", async () => {
    const pedidos = api({
      [BUSCA]: { body: { ...carga([volume(1), volume(2), volume(3)]), sequenciaLida: null } },
      [VOLUMES]: (body) =>
        body?.codigo === `${RASTREIO}-02`
          ? { body: { ...carga([recebido(1), recebido(2), volume(3)]), sequence: 2, repetido: false } }
          : { body: { ...carga([recebido(1), volume(2), volume(3)]), sequence: 1, repetido: pedidos.filter((p) => p.method === "POST").length > 1 } },
    });
    const tela = await montar(<ConferenciaPage />);

    await ler(tela, RASTREIO);
    await ate(() => expect(tela.querySelectorAll("[data-volume]")).toHaveLength(3));
    expect(progresso(tela)).toBe("0 de 3");
    expect(tela.querySelector('[aria-label="Carga"]')!.textContent).toContain("Serilon");
    expect(tela.querySelector('[aria-label="Carga"]')!.textContent).toContain("Mirassol/SP");
    expect([1, 2, 3].map((n) => situacaoDe(tela, n))).toEqual(["PENDING", "PENDING", "PENDING"]);
    // O campo esvazia e fica pronto para a próxima leitura.
    expect(campoDe(tela).value).toBe("");
    expect(campoDe(tela).placeholder).toBe("Etiqueta do volume ou posição");
    expect(document.activeElement).toBe(campoDe(tela));

    await ler(tela, `${RASTREIO}-01`);
    await ate(() => expect(situacaoDe(tela, 1)).toBe("RECEIVED"));
    expect(progresso(tela)).toBe("1 de 3");
    expect(aviso(tela)!.textContent).toBe("Volume 1 de 3 conferido.");
    expect(aviso(tela)!.getAttribute("data-aviso")).toBe("ok");

    await ler(tela, `${RASTREIO}-01`);
    await ate(() => expect(aviso(tela)!.textContent).toBe("Volume 1 já estava conferido."));
    expect(aviso(tela)!.getAttribute("data-aviso")).toBe("info");
    expect(progresso(tela)).toBe("1 de 3");

    await ler(tela, `${RASTREIO}-02`);
    await ate(() => expect(progresso(tela)).toBe("2 de 3"));

    expect(pedidos.filter((p) => p.method === "POST").map((p) => p.body)).toEqual([
      { codigo: `${RASTREIO}-01` },
      { codigo: `${RASTREIO}-01` },
      { codigo: `${RASTREIO}-02` },
    ]);
  });

  it("abrir pela etiqueta de um volume já confere aquele volume", async () => {
    const pedidos = api({
      [`/api/deposito/conferencia?codigo=${RASTREIO}-02`]: { body: { ...carga([volume(1), volume(2), volume(3)]), sequenciaLida: 2 } },
      [VOLUMES]: { body: { ...carga([volume(1), recebido(2), volume(3)]), sequence: 2, repetido: false } },
    });
    const tela = await montar(<ConferenciaPage />);

    await ler(tela, `${RASTREIO}-02`);
    await ate(() => expect(situacaoDe(tela, 2)).toBe("RECEIVED"));
    expect(pedidos.at(-1)).toMatchObject({ method: "POST", body: { codigo: `${RASTREIO}-02` } });
  });

  it("a visão do depósito manda para cá com a carga já aberta", async () => {
    window.history.replaceState(null, "", `/dashboard/deposito/conferencia?codigo=${RASTREIO}`);
    api({ [BUSCA]: { body: { ...carga([recebido(1), volume(2), volume(3)], { status: "COLLECTED" }), sequenciaLida: null } } });
    const tela = await montar(<ConferenciaPage />);
    await ate(() => expect(progresso(tela)).toBe("1 de 3"));
    expect(tela.querySelector('[aria-label="Carga"]')!.textContent).toContain("Coletado");
  });

  it("recusa com mensagem clara: código que não é carga, carga que não existe, volume de outra carga e código de outra carga", async () => {
    const pedidos = api({
      "/api/deposito/conferencia?codigo=0000000001": { status: 404, body: { error: "Nenhuma carga desta empresa com o código 0000000001." } },
      [BUSCA]: { body: { ...carga([volume(1), volume(2), volume(3)]), sequenciaLida: null } },
      [VOLUMES]: { status: 409, body: { error: "Este volume não é desta carga. Confira a etiqueta." } },
    });
    const tela = await montar(<ConferenciaPage />);

    // Sem carga aberta, o código de uma posição não serve: nem chama a API.
    await ler(tela, "A-01-03");
    expect(aviso(tela)!.textContent).toBe("Leia o código de rastreio da carga ou a etiqueta de um dos volumes dela.");
    expect(pedidos).toHaveLength(0);

    await ler(tela, "0000000001");
    await ate(() => expect(aviso(tela)!.textContent).toBe("Nenhuma carga desta empresa com o código 0000000001."));
    expect(aviso(tela)!.getAttribute("role")).toBe("alert");

    await ler(tela, RASTREIO);
    await ate(() => expect(tela.querySelectorAll("[data-volume]")).toHaveLength(3));

    await ler(tela, "9999999999-01");
    await ate(() => expect(aviso(tela)!.textContent).toBe("Este volume não é desta carga. Confira a etiqueta."));
    expect(progresso(tela)).toBe("0 de 3");

    const antes = pedidos.length;
    await ler(tela, "9999999999");
    expect(aviso(tela)!.textContent).toBe("Este código é de outra carga. Conclua esta conferência ou troque de carga antes.");
    await ler(tela, RASTREIO);
    expect(aviso(tela)!.textContent).toBe("Esta é a carga aberta. Leia a etiqueta de um volume.");
    await ler(tela, "???");
    expect(aviso(tela)!.textContent).toContain("Código não reconhecido");
    expect(pedidos).toHaveLength(antes);
  });

  it("carga que não pode ser conferida mostra o motivo e não oferece conferir", async () => {
    api({ [BUSCA]: { body: { ...carga([volume(1)], { status: "ROUTE", recusa: "Esta carga já saiu para entrega." }), sequenciaLida: null } } });
    const tela = await montar(<ConferenciaPage />);
    await ler(tela, RASTREIO);
    await ate(() => expect(aviso(tela)!.textContent).toBe("Esta carga já saiu para entrega."));
    expect(tela.querySelector('[aria-label="Volumes"]')).toBeNull();
    expect(porTexto(tela, "button", "Concluir")).toHaveLength(0);
    // O campo volta a pedir uma carga.
    expect(campoDe(tela).placeholder).toBe("Código de rastreio da carga");
  });

  it("o botão Conferir faz o que a leitura faz, pelo número do volume", async () => {
    const pedidos = api({
      [BUSCA]: { body: { ...carga([volume(1), volume(2)]), sequenciaLida: null } },
      [VOLUMES]: { body: { ...carga([volume(1), recebido(2)]), sequence: 2, repetido: false } },
    });
    const tela = await montar(<ConferenciaPage />);
    await ler(tela, RASTREIO);
    await ate(() => expect(tela.querySelectorAll("[data-volume]")).toHaveLength(2));

    await clicar(porTexto(tela.querySelector('[data-volume="2"]')!, "button", "Conferir")[0]);
    await ate(() => expect(situacaoDe(tela, 2)).toBe("RECEIVED"));
    expect(pedidos.at(-1)!.body).toEqual({ sequence: 2 });
    // Volume conferido não oferece mais "Conferir"; o pendente continua oferecendo.
    expect(porTexto(tela.querySelector('[data-volume="2"]')!, "button", "Conferir")).toHaveLength(0);
    expect(porTexto(tela.querySelector('[data-volume="1"]')!, "button", "Conferir")).toHaveLength(1);
  });

  it("ler o código de uma posição aloca os volumes conferidos que ainda não têm lugar", async () => {
    const naPosicao = { id: "p1", code: "A-01-03" };
    const pedidos = api({
      [BUSCA]: { body: { ...carga([recebido(1, { location: { id: "p0", code: "DOCA" } }), recebido(2), volume(3)]), sequenciaLida: null } },
      [POSICAO]: { body: { ...carga([recebido(1, { location: { id: "p0", code: "DOCA" } }), recebido(2, { location: naPosicao }), volume(3)]), alocados: 1 } },
    });
    const tela = await montar(<ConferenciaPage />);
    await ler(tela, RASTREIO);
    await ate(() => expect(tela.querySelectorAll("[data-volume]")).toHaveLength(3));

    await ler(tela, "a-01-03");
    await ate(() => expect(aviso(tela)!.textContent).toBe("1 volume(s) na posição A-01-03."));
    expect(pedidos.at(-1)!.body).toEqual({ locationCode: "A-01-03", sequences: [2] });
    expect(tela.querySelector('[data-volume="2"]')!.textContent).toContain("A-01-03");

    // Agora todos os presentes têm lugar: ler outra posição muda a carga inteira.
    await ler(tela, "A-01-03");
    await ate(() => expect(pedidos.filter((p) => p.url.endsWith("/posicao"))).toHaveLength(2));
    expect(pedidos.at(-1)!.body).toEqual({ locationCode: "A-01-03" });
  });

  it("Editar grava situação, peso e avaria, e só chama a posição quando ela mudou", async () => {
    const avariado = recebido(2, { status: "DAMAGED", weight: 9.5, damageNote: "Caixa amassada" });
    const pedidos = api({
      [BUSCA]: { body: { ...carga([recebido(1), recebido(2), volume(3)]), sequenciaLida: null } },
      "/api/deposito/posicoes": { body: [{ id: "p1", code: "A-01-03", active: true }, { id: "p2", code: "VELHA", active: false }] },
      [VOLUMES]: { body: { ...carga([recebido(1), avariado, volume(3)]), sequence: 2, repetido: false } },
      [POSICAO]: { body: { ...carga([recebido(1), { ...avariado, location: { id: "p1", code: "A-01-03" } }, volume(3)]), alocados: 1 } },
    });
    const tela = await montar(<ConferenciaPage />);
    await ler(tela, RASTREIO);
    await ate(() => expect(tela.querySelectorAll("[data-volume]")).toHaveLength(3));

    await clicar(tela.querySelector('[aria-label="Editar volume 2"]')!);
    const form = await (async () => {
      await ate(() => expect(tela.querySelector('form[aria-label="Volume 2"]')).not.toBeNull());
      return tela.querySelector<HTMLFormElement>('form[aria-label="Volume 2"]')!;
    })();
    // Só as posições ativas são sugeridas.
    await ate(() => expect([...form.querySelectorAll("datalist option")].map((o) => o.getAttribute("value"))).toEqual(["A-01-03"]));

    await clicar(porTexto(form, '[role="radio"]', "Avariado")[0]);
    await digitar(form.querySelector<HTMLInputElement>('input[inputmode="decimal"]')!, "9,5");
    const nota = form.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(nota, "Caixa amassada");
      nota.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await digitar(form.querySelector<HTMLInputElement>("input[list]")!, "A-01-03");
    await enviar(form);

    await ate(() => expect(tela.querySelector('form[aria-label="Volume 2"]')).toBeNull());
    const gravacoes = pedidos.filter((p) => p.method === "POST");
    expect(gravacoes.map((p) => [p.url, p.body])).toEqual([
      ["/api/deposito/coletas/c1/volumes", { sequence: 2, status: "DAMAGED", weight: "9,5", damageNote: "Caixa amassada" }],
      ["/api/deposito/coletas/c1/posicao", { locationCode: "A-01-03", sequences: [2] }],
    ]);
    expect(situacaoDe(tela, 2)).toBe("DAMAGED");
    expect(tela.querySelector('[data-volume="2"]')!.textContent).toContain("Caixa amassada");

    // Marcar como faltando não mexe em posição: o servidor já tira o volume de lá.
    await clicar(tela.querySelector('[aria-label="Editar volume 2"]')!);
    await ate(() => expect(tela.querySelector('form[aria-label="Volume 2"]')).not.toBeNull());
    const outra = tela.querySelector<HTMLFormElement>('form[aria-label="Volume 2"]')!;
    await clicar(porTexto(outra, '[role="radio"]', "Faltando")[0]);
    expect(outra.querySelector("textarea")).toBeNull();
    expect(outra.querySelector("input[list]")).toBeNull();
    await enviar(outra);
    await ate(() => expect(tela.querySelector('form[aria-label="Volume 2"]')).toBeNull());
    expect(pedidos.at(-1)).toMatchObject({ url: "/api/deposito/coletas/c1/volumes", body: { sequence: 2, status: "MISSING" } });
  });

  it("Concluir avisa dos volumes não lidos e, confirmado, mostra a conferência concluída", async () => {
    const concluida = carga([recebido(1), recebido(2), volume(3, { status: "MISSING" })], {
      status: "COLLECTED",
      conferencia: {
        concludedAt: "2026-10-09T12:00:00.000Z",
        expectedVolumes: 3,
        receivedVolumes: 2,
        damagedVolumes: 0,
        missingVolumes: 1,
        declaredWeight: 30,
        checkedWeight: null,
        quantityDivergence: true,
        weightDivergence: false,
        user: { id: "u1", name: "Ana" },
      },
    });
    const pedidos = api({
      [BUSCA]: { body: { ...carga([recebido(1), recebido(2), volume(3)]), sequenciaLida: null } },
      [CONCLUIR]: { body: concluida },
    });
    const perguntas: string[] = [];
    let resposta = false;
    window.confirm = (texto?: string) => {
      perguntas.push(texto ?? "");
      return resposta;
    };

    const tela = await montar(<ConferenciaPage />);
    await ler(tela, RASTREIO);
    await ate(() => expect(progresso(tela)).toBe("2 de 3"));

    await clicar(porTexto(tela, "button", "Concluir")[0]);
    expect(perguntas).toEqual(["1 volume(s) não foram lidos e vão ficar como faltando. Concluir mesmo assim?"]);
    expect(pedidos.filter((p) => p.method === "POST")).toHaveLength(0);

    resposta = true;
    await clicar(porTexto(tela, "button", "Concluir")[0]);
    await ate(() => expect(aviso(tela)!.textContent).toBe("Conferência concluída. A carga está no depósito."));
    expect(situacaoDe(tela, 3)).toBe("MISSING");
    const resumo = tela.querySelector('[aria-label="Carga"]')!.textContent!;
    expect(resumo).toContain("Coletado");
    expect(resumo).toContain("1 faltando");
    expect(resumo).toContain("conferência concluída");
    expect(porTexto(tela, "button", "Concluir de novo")).toHaveLength(1);
    expect(porTexto(tela, "a", "Etiquetas")[0].getAttribute("href")).toBe("/dashboard/deposito/etiquetas/c1");
  });

  it("sessão expirada e acesso negado aparecem como nas telas vizinhas", async () => {
    api({ [BUSCA]: { status: 401, body: { error: "Não autorizado" } } });
    const tela = await montar(<ConferenciaPage />);
    await ler(tela, RASTREIO);
    await ate(() => expect(tela.textContent).toContain("Sessão expirada"));
    expect(porTexto(tela, "a", "Ir para o login")[0].getAttribute("href")).toBe("/login");
  });
});

describe("tela da visão do depósito", () => {
  const item = (dados: Partial<CargaNoDeposito>): CargaNoDeposito => ({
    id: "c1",
    trackingCode: "1111111111",
    cliente: "Açúcar União",
    receiver: "Mercado",
    destination: "Mirassol/SP",
    volumes: 3,
    weight: 30,
    entrouEm: "2026-10-09T12:00:00.000Z",
    dias: 0,
    conferencia: { concludedAt: "2026-10-09T12:00:00.000Z", receivedVolumes: 3, damagedVolumes: 0, missingVolumes: 0, quantityDivergence: false, weightDivergence: false },
    posicoes: ["A-01-03"],
    alertas: [],
    ...dados,
  });
  const CARGAS = [
    item({ id: "a" }),
    item({
      id: "b",
      trackingCode: "2222222222",
      cliente: "Bebidas Sul",
      volumes: 2,
      dias: 5,
      posicoes: [],
      alertas: ["PARADA", "DIVERGENCIA", "SEM_POSICAO"],
      conferencia: { concludedAt: "2026-10-04T12:00:00.000Z", receivedVolumes: 0, damagedVolumes: 1, missingVolumes: 1, quantityDivergence: true, weightDivergence: false },
    }),
    item({ id: "c", trackingCode: "3333333333", cliente: "Casa Verde", volumes: 1, conferencia: null, posicoes: [], alertas: ["SEM_POSICAO"] }),
  ];
  const CONTADORES: ContadoresDoDeposito = { cargas: 3, volumes: 6, PARADA: 1, DIVERGENCIA: 1, AVARIA: 0, SEM_POSICAO: 2 };

  const linhas = (tela: HTMLElement) => [...tela.querySelectorAll("[data-carga]")].map((linha) => linha.getAttribute("data-carga"));
  const contador = (tela: HTMLElement, nome: string) => tela.querySelector<HTMLElement>(`[data-contador="${nome}"]`)!;

  async function abrir(resposta: Resposta) {
    api({ "/api/deposito": resposta });
    const tela = await montar(<DepositoPage />);
    await ate(() => expect(carregando(tela)).toBeNull());
    return tela;
  }

  it("mostra os contadores, as cargas com volumes, posição, dias e alertas, e os atalhos", async () => {
    const tela = await abrir({ body: { diasDeAlerta: 3, contadores: CONTADORES, cargas: CARGAS } });

    expect(Object.fromEntries(["cargas", "volumes", "PARADA", "DIVERGENCIA", "AVARIA", "SEM_POSICAO"].map((n) => [n, contador(tela, n).querySelector("p")!.textContent]))).toEqual({
      cargas: "3",
      volumes: "6",
      PARADA: "1",
      DIVERGENCIA: "1",
      AVARIA: "0",
      SEM_POSICAO: "2",
    });
    expect(linhas(tela)).toEqual(["a", "b", "c"]);

    const a = tela.querySelector('[data-carga="a"]')!;
    expect(a.textContent).toContain("Açúcar União");
    expect(a.textContent).toContain("1111111111");
    expect(a.textContent).toContain("3 de 3");
    expect(a.textContent).toContain("A-01-03");
    expect(a.textContent).toContain("hoje");
    expect(a.querySelectorAll("[data-alerta]")).toHaveLength(0);
    expect(porTexto(a, "a", "Conferir")[0].getAttribute("href")).toBe("/dashboard/deposito/conferencia?codigo=1111111111");
    expect(porTexto(a, "a", "Etiquetas")[0].getAttribute("href")).toBe("/dashboard/deposito/etiquetas/a");

    const b = tela.querySelector('[data-carga="b"]')!;
    expect(b.textContent).toContain("1 de 2 · 1 avariado · 1 faltando");
    expect(b.textContent).toContain("sem posição");
    expect(b.textContent).toContain("5 dias");
    expect([...b.querySelectorAll("[data-alerta]")].map((e) => e.textContent)).toEqual(["Parada há mais de 3 dias", "Divergência de quantidade", "Sem posição"]);

    expect(tela.querySelector('[data-carga="c"]')!.textContent).toContain("1 (sem conferência)");

    expect(porTexto(tela, "a", "Conferir")[0].getAttribute("href")).toBe("/dashboard/deposito/conferencia");
    expect(porTexto(tela, "a", "Posições")[0].getAttribute("href")).toBe("/dashboard/deposito/posicoes");
    // Sem dado financeiro na tela.
    expect(tela.textContent).not.toMatch(/R\$/);
  });

  it("tocar num alerta filtra a lista; a busca acha por código, cliente e posição", async () => {
    const tela = await abrir({ body: { diasDeAlerta: 3, contadores: CONTADORES, cargas: CARGAS } });

    await clicar(contador(tela, "SEM_POSICAO"));
    expect(linhas(tela)).toEqual(["b", "c"]);
    expect(contador(tela, "SEM_POSICAO").getAttribute("aria-pressed")).toBe("true");
    await clicar(contador(tela, "PARADA"));
    expect(linhas(tela)).toEqual(["b"]);
    await clicar(contador(tela, "PARADA"));
    expect(linhas(tela)).toEqual(["a", "b", "c"]);

    const busca = tela.querySelector<HTMLInputElement>('input[type="search"]')!;
    await digitar(busca, "3333");
    expect(linhas(tela)).toEqual(["c"]);
    await digitar(busca, "acucar");
    expect(linhas(tela)).toEqual(["a"]);
    await digitar(busca, "a-01");
    expect(linhas(tela)).toEqual(["a"]);
    await digitar(busca, "nada");
    expect(linhas(tela)).toEqual([]);
    expect(tela.textContent).toContain("Nenhuma carga com este filtro.");

    await clicar(porTexto(tela, "button", "Limpar")[0]);
    expect(linhas(tela)).toEqual(["a", "b", "c"]);
  });

  it("depósito vazio, acesso negado e falha", async () => {
    const vazio = await abrir({ body: { diasDeAlerta: 3, contadores: { cargas: 0, volumes: 0, PARADA: 0, DIVERGENCIA: 0, AVARIA: 0, SEM_POSICAO: 0 }, cargas: [] } });
    expect(vazio.textContent).toContain("Nenhuma carga no depósito agora.");
    await desmontarTudo();

    const negado = await abrir({ status: 403, body: { error: "Acesso negado" } });
    expect(negado.textContent).toContain("Acesso negado");
    expect(negado.textContent).toContain("restrito à equipe interna");
    await desmontarTudo();

    const falha = await abrir({ status: 500, body: { error: "Internal Server Error" } });
    expect(falha.querySelector('[role="alert"]')!.textContent).toContain("Internal Server Error");
    expect(porTexto(falha, "button", "Tentar de novo")).toHaveLength(1);
  });
});

describe("tela de posições", () => {
  const POSICOES = [
    { id: "p1", code: "A-01-03", description: "Corredor A", active: true, _count: { volumes: 4 } },
    { id: "p2", code: "VELHA", description: null, active: false, _count: { volumes: 0 } },
  ];

  it("lista as posições e cadastra uma nova", async () => {
    const pedidos = api({
      "/api/deposito/posicoes": { body: POSICOES },
      "POST /api/deposito/posicoes": { status: 201, body: { id: "p3", code: "B-02", description: null, active: true, _count: { volumes: 0 } } },
    });
    const tela = await montar(<PosicoesPage />);
    await ate(() => expect(tela.querySelectorAll("[data-posicao]")).toHaveLength(2));

    const a = tela.querySelector('[data-posicao="A-01-03"]')!;
    expect(a.textContent).toContain("Corredor A");
    expect(a.textContent).toContain("4");
    expect(a.textContent).toContain("Ativa");
    expect(porTexto(tela.querySelector('[data-posicao="VELHA"]')!, "button", "Reativar")).toHaveLength(1);

    await clicar(porTexto(tela, "button", "Nova posição")[0]);
    const form = tela.querySelector<HTMLFormElement>('form[aria-label="Nova posição"]')!;
    await digitar(form.querySelectorAll("input")[0], "b-02");
    await enviar(form);

    await ate(() => expect(tela.querySelector('form[aria-label="Nova posição"]')).toBeNull());
    expect(pedidos.find((p) => p.method === "POST")).toMatchObject({ url: "/api/deposito/posicoes", body: { code: "b-02", description: "" } });
    // A lista é pedida de novo depois de gravar.
    expect(pedidos.filter((p) => p.method === "GET")).toHaveLength(2);
  });

  it("altera, desativa e mostra o erro da API no formulário", async () => {
    const pedidos = api({
      "/api/deposito/posicoes": { body: POSICOES },
      "PATCH /api/deposito/posicoes/p1": (body) =>
        body?.code === "VELHA" ? { status: 409, body: { error: "Já existe uma posição com este código." } } : { body: { ...POSICOES[0], active: false } },
    });
    const tela = await montar(<PosicoesPage />);
    await ate(() => expect(tela.querySelectorAll("[data-posicao]")).toHaveLength(2));
    const a = () => tela.querySelector('[data-posicao="A-01-03"]')!;

    await clicar(porTexto(a(), "button", "Desativar")[0]);
    await ate(() => expect(pedidos.filter((p) => p.method === "PATCH")).toHaveLength(1));
    expect(pedidos.find((p) => p.method === "PATCH")).toMatchObject({ url: "/api/deposito/posicoes/p1", body: { active: false } });

    await clicar(porTexto(a(), "button", "Alterar")[0]);
    const form = tela.querySelector<HTMLFormElement>('form[aria-label="Alterar posição"]')!;
    const [codigo, descricao] = form.querySelectorAll("input");
    expect(codigo.value).toBe("A-01-03");
    expect(descricao.value).toBe("Corredor A");
    await digitar(codigo, "VELHA");
    await enviar(form);
    await ate(() => expect(form.querySelector('[role="alert"]')?.textContent).toBe("Já existe uma posição com este código."));
    // Com erro o formulário continua aberto.
    expect(tela.querySelector('form[aria-label="Alterar posição"]')).not.toBeNull();
  });
});

describe("tela de etiquetas", () => {
  async function abrir(resposta: Resposta, coletaId = "c1") {
    api({ [`/api/deposito/coletas/${coletaId}`]: resposta });
    const params = Promise.resolve({ coletaId });
    const tela = await montar(
      <Suspense fallback="carregando">
        <EtiquetasPage params={params} />
      </Suspense>,
    );
    await ate(() => {
      expect(tela.textContent).not.toBe("carregando");
      expect(carregando(tela)).toBeNull();
    });
    return tela;
  }

  it("imprime uma etiqueta por volume, com cliente, destino, destinatário, a contagem, o código e as barras", async () => {
    const tela = await abrir({ body: carga([recebido(1), volume(2), volume(3)]) });
    const etiquetas = [...tela.querySelectorAll("[data-etiqueta]")];
    expect(etiquetas.map((e) => e.getAttribute("data-etiqueta"))).toEqual([`${RASTREIO}-01`, `${RASTREIO}-02`, `${RASTREIO}-03`]);

    const segunda = etiquetas[1];
    for (const texto of ["Serilon", "Mirassol/SP", "Mercado Bom Preço", "Volume 2 de 3", `${RASTREIO}-02`]) expect(segunda.textContent, texto).toContain(texto);

    // O desenho é o que a função pura calcula: uma barra por retângulo preto, na largura com a zona de silêncio.
    const esperado = barrasCode128B(`${RASTREIO}-02`)!;
    const svg = segunda.querySelector("svg")!;
    expect(svg.getAttribute("aria-label")).toBe(`Código de barras ${RASTREIO}-02`);
    expect(svg.getAttribute("viewBox")).toBe(`0 0 ${esperado.largura} 10`);
    const barras = [...svg.querySelectorAll('rect[fill="#000"]')].map((r) => ({ x: Number(r.getAttribute("x")), largura: Number(r.getAttribute("width")) }));
    expect(barras).toEqual(esperado.barras);

    // Só as etiquetas saem no papel.
    expect(tela.querySelector("style")!.textContent).toContain("@media print");
    expect(tela.querySelector("[data-etiquetas]")).not.toBeNull();
    expect(porTexto(tela, "button", "Imprimir")).toHaveLength(1);
    expect(tela.textContent).not.toMatch(/R\$/);
  });

  it("carga sem código de rastreio não tem etiqueta, e carga que não existe mostra o erro", async () => {
    const semCodigo = carga([]);
    semCodigo.carga.trackingCode = null;
    const tela = await abrir({ body: semCodigo });
    expect(tela.querySelectorAll("[data-etiqueta]")).toHaveLength(0);
    expect(tela.querySelector('[role="alert"]')!.textContent).toContain("não tem código de rastreio");
    expect(porTexto(tela, "button", "Imprimir")).toHaveLength(0);
    await desmontarTudo();

    const inexistente = await abrir({ status: 404, body: { error: "Carga não encontrada." } }, "x");
    expect(inexistente.querySelector('[role="alert"]')!.textContent).toBe("Carga não encontrada.");
  });
});
