// @vitest-environment jsdom
import { Suspense, act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ate, clicar, desmontarTudo, montar, porTexto } from "./tela";
import type { ConferenciaDoCte, ResumoDoCte } from "../src/lib/cte";
import { SEM_EXPEDIDOR, semCteAnterior } from "../src/lib/cte/preparar";
import type { Minuta } from "../src/lib/minuta";
import type { CargaParaCte } from "../src/lib/nfe";
import { EXIGENCIA_DO_SERVICO, SEM_REDESPACHO } from "../src/lib/redespacho";

/**
 * Redespacho e subcontratação nas telas: o bloco do formulário de minuta, a
 * conferência do CT-e e a folha da minuta de despacho. As regras e as rotas
 * são testadas em `tests/redespacho.test.ts`.
 */

vi.mock("next/link", () => ({
  default: ({ href, children, className, ...resto }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className} {...resto}>
      {children}
    </a>
  ),
}));

vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));

import ColetasPage from "../src/app/dashboard/coletas/page";
import MinutaPage from "../src/app/dashboard/coletas/[id]/minuta/page";
import CtePage from "../src/app/dashboard/fiscal/cte/page";

type Resposta = { status?: number; body: unknown };
type Pedido = { url: string; method: string; body: Record<string, unknown> | undefined };

function api(respostas: Record<string, Resposta>) {
  const pedidos: Pedido[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      pedidos.push({ url: String(url), method, body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined });
      const resposta = respostas[method === "GET" ? String(url) : `${method} ${String(url)}`];
      if (!resposta) throw new Error(`Chamada inesperada: ${method} ${String(url)}`);
      return new Response(JSON.stringify(resposta.body), { status: resposta.status ?? 200 });
    }),
  );
  return pedidos;
}

async function digitar(campo: HTMLInputElement | HTMLSelectElement, valor: string) {
  const gravar = Object.getOwnPropertyDescriptor(campo instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    gravar.call(campo, valor);
    campo.dispatchEvent(new Event(campo instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}

afterEach(async () => {
  await desmontarTudo();
  vi.unstubAllGlobals();
});

const CHAVE_ANTERIOR = "35261099000503000124570010000003211123456785";
const cliente = { id: "cli1", tradeName: "Contratante", companyName: "Transportadora Contratante Ltda", active: true };

const coleta = (extra: Record<string, unknown> = {}) => ({
  ...SEM_REDESPACHO,
  id: "c1",
  sender: "Indústria Remetente",
  receiver: "Comércio Destinatário",
  origin: "Rio Preto - SP",
  destination: "Belo Horizonte - MG",
  volumes: 3,
  weight: 30,
  status: "CONFIRMED",
  manifestId: null,
  invoiceKey: null,
  invoiceValue: null,
  freightValue: null,
  freightManual: false,
  trackingCode: "9900000001",
  pickupDate: null,
  pickupFrom: null,
  pickupTo: null,
  priority: "NORMAL",
  cubicMeters: null,
  pickupNotes: null,
  deliveryStreet: null,
  deliveryNumber: null,
  deliveryDistrict: null,
  deliveryZip: null,
  proof: null,
  _count: { deliveryAttempts: 0 },
  client: cliente,
  driver: null,
  ...extra,
});

/* ------------------------------ Formulário de minuta --------------------------- */

describe("formulário de minuta: bloco Redespacho / subcontratação", () => {
  const campo = (tela: HTMLElement, id: string) => tela.querySelector<HTMLInputElement>(`#coleta-${id}`);
  /** O campo que vem logo depois de um rótulo do formulário principal (os de cima não têm id). */
  const doRotulo = (tela: HTMLElement, texto: string, indice = 0) => porTexto(tela, "label", texto)[indice].parentElement!.querySelector<HTMLInputElement | HTMLSelectElement>("input, select")!;

  async function abrir(coletas: unknown[] = []) {
    const pedidos = api({
      "/api/coletas": { body: coletas },
      "/api/clientes": { body: [cliente] },
      "/api/motoristas": { body: [] },
      "POST /api/coletas": { status: 201, body: coleta() },
      "PATCH /api/coletas/c1": { body: coleta() },
    });
    const tela = await montar(<ColetasPage />);
    await ate(() => expect(tela.querySelector('[aria-label="Buscar coletas"]')).not.toBeNull());
    return { tela, pedidos };
  }

  it("fechado por padrão; aberto, mostra o tipo, a chave e uma parte por vez no celular; o pedido leva os campos", async () => {
    const { tela, pedidos } = await abrir();
    await clicar(porTexto(tela, "button", "Nova Minuta")[0]);
    const botao = tela.querySelector<HTMLButtonElement>('[data-secao="redespacho"]')!;
    expect(botao.getAttribute("aria-expanded")).toBe("false");
    expect(botao.textContent).toContain("Redespacho / subcontratação (opcional)");
    expect(campo(tela, "servico")).toBeNull();

    await clicar(botao);
    expect(botao.getAttribute("aria-expanded")).toBe("true");
    const servico = tela.querySelector<HTMLSelectElement>("#coleta-servico")!;
    expect([...servico.options].map((opcao) => opcao.textContent)).toEqual(["Normal", "Subcontratação", "Redespacho", "Redespacho intermediário"]);
    expect(tela.querySelector("[data-exigencia]")!.textContent).toContain(EXIGENCIA_DO_SERVICO.NORMAL);

    await digitar(servico, "INTERMEDIATE");
    expect(tela.querySelector("[data-exigencia]")!.textContent).toContain("Exige a chave do CT-e anterior, o expedidor e o recebedor.");
    expect(tela.querySelector("[data-exigencia]")!.textContent).toContain("confirme com o contador");
    expect(botao.textContent).toContain("Redespacho / subcontratação: Redespacho intermediário");
    await digitar(campo(tela, "cte-anterior")!, CHAVE_ANTERIOR);

    // Duas abas no celular: a parte que não está aberta fica escondida (e as duas aparecem no computador, pela classe `md:block`).
    const parteDe = (prefixo: string) => tela.querySelector<HTMLElement>(`[data-parte="${prefixo}"]`)!;
    expect(parteDe("shipper").className).not.toMatch(/(^| )hidden( |$)/);
    expect(parteDe("consignee").className).toMatch(/(^| )hidden( |$)/);
    expect(parteDe("consignee").className).toContain("md:block");
    expect(parteDe("shipper").querySelectorAll("input")).toHaveLength(8);
    await digitar(campo(tela, "shipperName")!, "Centro de Distribuição");
    await digitar(campo(tela, "shipperDocument")!, "99.000.903/0001-30");
    await digitar(campo(tela, "shipperCity")!, "Santos - SP");
    await clicar(tela.querySelector('[data-aba="consignee"]')!);
    expect(tela.querySelector('[data-aba="consignee"]')!.getAttribute("aria-selected")).toBe("true");
    expect(parteDe("shipper").className).toMatch(/(^| )hidden( |$)/);
    expect(parteDe("consignee").className).not.toMatch(/(^| )hidden( |$)/);
    await digitar(campo(tela, "consigneeName")!, "Transportes Recebedor");

    await digitar(doRotulo(tela, "Cliente (Pagador)"), "cli1");
    await digitar(doRotulo(tela, "Remetente *"), "Indústria Remetente");
    await digitar(doRotulo(tela, "Destinatário *"), "Comércio Destinatário");
    await digitar(doRotulo(tela, "Cidade - UF *", 0), "Rio Preto - SP");
    await digitar(doRotulo(tela, "Cidade - UF *", 1), "Belo Horizonte - MG");
    await clicar(porTexto(tela, "button", "Salvar Minuta")[0]);
    await ate(() => expect(pedidos.some((pedido) => pedido.method === "POST")).toBe(true));
    expect(pedidos.find((pedido) => pedido.method === "POST")!.body).toMatchObject({
      clientId: "cli1",
      serviceType: "INTERMEDIATE",
      previousCteKey: CHAVE_ANTERIOR,
      shipperName: "Centro de Distribuição",
      shipperDocument: "99.000.903/0001-30",
      shipperCity: "Santos - SP",
      consigneeName: "Transportes Recebedor",
      consigneeDocument: "",
    });
  });

  it("ao editar: a carga com redespacho abre o bloco com o que está gravado, e só o que mudou vai no pedido; a carga normal abre fechada", async () => {
    const comRedespacho = coleta({ serviceType: "REDISPATCH", previousCteKey: CHAVE_ANTERIOR, shipperName: "Centro de Distribuição", shipperZip: "11010000" });
    const { tela, pedidos } = await abrir([comRedespacho, coleta({ id: "c2", trackingCode: "9900000002" })]);
    await ate(() => expect(tela.querySelectorAll("tbody tr")).toHaveLength(2));

    await clicar(porTexto(tela.querySelectorAll("tbody tr")[1], "button", "Editar")[0]);
    expect(tela.querySelector('[data-secao="redespacho"]')!.getAttribute("aria-expanded")).toBe("false");
    await clicar(porTexto(tela, "button", "Cancelar").at(-1)!);

    await clicar(porTexto(tela.querySelectorAll("tbody tr")[0], "button", "Editar")[0]);
    expect(tela.querySelector('[data-secao="redespacho"]')!.getAttribute("aria-expanded")).toBe("true");
    expect(tela.querySelector<HTMLSelectElement>("#coleta-servico")!.value).toBe("REDISPATCH");
    expect(campo(tela, "cte-anterior")!.value).toBe(CHAVE_ANTERIOR);
    expect(campo(tela, "shipperName")!.value).toBe("Centro de Distribuição");
    expect(campo(tela, "shipperZip")!.value).toBe("11010-000");

    await digitar(tela.querySelector<HTMLSelectElement>("#coleta-servico")!, "SUBCONTRACT");
    await digitar(campo(tela, "shipperName")!, "");
    await clicar(porTexto(tela, "button", "Salvar Minuta")[0]);
    await ate(() => expect(pedidos.some((pedido) => pedido.method === "PATCH")).toBe(true));
    expect(pedidos.find((pedido) => pedido.method === "PATCH")!.body).toEqual({ serviceType: "SUBCONTRACT", shipperName: "" });
  });
});

/* ------------------------------ Conferência do CT-e ---------------------------- */

describe("conferência do CT-e: tipo de serviço, documento anterior, expedidor e recebedor", () => {
  const carga: CargaParaCte = {
    id: "c1",
    trackingCode: "1234567890",
    status: "ROUTE",
    sender: "Indústria Remetente",
    receiver: "Comércio Destinatário",
    origin: "São José do Rio Preto - SP",
    destination: "Belo Horizonte - MG",
    volumes: 3,
    weight: 42.5,
    invoiceKey: "35261099444333000181550010000012341123456780",
    invoiceValue: 1534.56,
    freightValue: 120,
    cteKey: null,
    cteNumber: null,
    cteStatus: "PENDING",
    updatedAt: "2026-10-09T12:00:00.000Z",
    client: { id: "cli1", companyName: "Transportadora Contratante Ltda", tradeName: "Contratante", cnpj: "99000503000124" },
    emitido: null,
  };

  const resumo = (extra: Partial<ResumoDoCte> = {}): ResumoDoCte => ({
    ambiente: "HOMOLOGACAO",
    serie: 1,
    numeroPrevisto: 40,
    cfop: "6351",
    emitente: { nome: "Transportadora de Teste Ltda", documento: "99.000.108/0001-41", ie: "123456789012", endereco: "Rua das Flores, 120 - Centro, Mirassol - SP" },
    servico: { tipo: "NORMAL", chaveDoCteAnterior: null, emissorDoAnterior: null },
    remetente: { nome: "Indústria Remetente", documento: "99.000.303/0001-71", ie: "110042490114", endereco: "Av. Brasil, 1500" },
    expedidor: null,
    recebedor: null,
    destinatario: { nome: "Comércio Destinatário", documento: "99.000.703/0001-87", ie: null, endereco: "Rua da Bahia, 900" },
    tomador: { papel: "OUTRO", nome: "Transportadora Contratante Ltda", documento: "99.000.503/0001-24", contribuinte: "1" },
    origem: "São José do Rio Preto - SP",
    destino: "Belo Horizonte - MG",
    valorDaPrestacao: 120,
    valorDaCarga: 1534.56,
    icms: { situacao: "00", grupo: "ICMS00", base: 120, aliquota: 12, valor: 14.4, retido: false },
    ibsCbs: null,
    peso: 42.5,
    volumes: 3,
    chavesDeNfe: ["35261099444333000181550010000012341123456780"],
    ...extra,
  });

  async function conferir(conferencia: Partial<ConferenciaDoCte>) {
    api({
      "/api/fiscal/cte": { body: [carga] },
      "/api/fiscal/cte/situacao": { body: { pronta: true, ambiente: "HOMOLOGACAO", faltas: [], dacte: false } },
      "/api/fiscal/cte/emissao?collectionId=c1": { body: { pronta: true, pendencias: [], avisos: [], resumo: resumo(), cte: null, svc: null, ...conferencia } },
    });
    const tela = await montar(<CtePage />);
    await ate(() => expect(tela.querySelector('[data-acao="conferir"]')).not.toBeNull());
    await clicar(tela.querySelector('[data-acao="conferir"]')!);
    await ate(() => expect(tela.querySelector("[data-resumo]")).not.toBeNull());
    return tela.querySelector<HTMLElement>('[role="dialog"]')!;
  }

  it("serviço normal sem expedidor nem recebedor: a conferência é a de sempre, sem linha nova", async () => {
    const dialogo = await conferir({});
    expect(dialogo.querySelector("[data-servico]")).toBeNull();
    expect(dialogo.querySelector("[data-cte-anterior]")).toBeNull();
    expect(dialogo.querySelector("[data-expedidor]")).toBeNull();
    expect(dialogo.querySelector("[data-recebedor]")).toBeNull();
    expect(dialogo.querySelector<HTMLButtonElement>("[data-emitir]")!.disabled).toBe(false);
  });

  it("redespacho: mostra o tipo, quem emitiu o CT-e anterior com a chave, o expedidor e o tomador no papel dele, e os avisos", async () => {
    const dialogo = await conferir({
      avisos: ["O tomador é outra transportadora: o CT-e vai com o CFOP 6351."],
      resumo: resumo({
        servico: { tipo: "REDISPATCH", chaveDoCteAnterior: CHAVE_ANTERIOR, emissorDoAnterior: "Transportadora Contratante Ltda · 99.000.503/0001-24" },
        expedidor: { nome: "Transportadora Contratante Ltda", documento: "99.000.503/0001-24", ie: "111222333444", endereco: "Rod. Washington Luís, 440" },
        tomador: { papel: "EXPEDIDOR", nome: "Transportadora Contratante Ltda", documento: "99.000.503/0001-24", contribuinte: "1" },
      }),
    });
    expect(dialogo.querySelector("[data-servico]")!.textContent).toBe("Redespacho");
    expect(dialogo.querySelector("[data-cte-anterior]")!.textContent).toBe("Transportadora Contratante Ltda · 99.000.503/0001-24 · 3526 1099 0005 0300 0124 5700 1000 0003 2111 2345 6785");
    expect(dialogo.querySelector("[data-expedidor]")!.textContent).toBe("Transportadora Contratante Ltda · 99.000.503/0001-24");
    expect(dialogo.querySelector("[data-recebedor]")).toBeNull();
    expect(dialogo.querySelector("[data-resumo]")!.textContent).toContain("o expedidor · contribuinte");
    expect(dialogo.querySelector("[data-avisos]")!.textContent).toContain("CFOP 6351");
    expect(dialogo.querySelector<HTMLButtonElement>("[data-emitir]")!.disabled).toBe(false);
  });

  it("redespacho intermediário com pendências: lista o que falta, marca o que falta no resumo e não deixa emitir", async () => {
    const dialogo = await conferir({
      pendencias: [semCteAnterior("INTERMEDIATE"), SEM_EXPEDIDOR],
      resumo: resumo({ servico: { tipo: "INTERMEDIATE", chaveDoCteAnterior: null, emissorDoAnterior: null }, recebedor: { nome: "Transportes Recebedor Ltda", documento: "99.001.103/0001-33", ie: null, endereco: "Av. do Contorno, 8000" }, chavesDeNfe: [] }),
    });
    const pendencias = [...dialogo.querySelectorAll("[data-pendencias] li")].map((item) => item.textContent);
    expect(pendencias).toEqual([semCteAnterior("INTERMEDIATE"), SEM_EXPEDIDOR]);
    expect(pendencias[0]).toContain('no bloco "Redespacho / subcontratação"');
    expect(dialogo.querySelector("[data-servico]")!.textContent).toBe("Redespacho intermediário");
    expect(dialogo.querySelector("[data-cte-anterior]")!.textContent).toBe("falta a chave");
    expect(dialogo.querySelector("[data-expedidor]")!.textContent).toBe("falta informar");
    expect(dialogo.querySelector("[data-recebedor]")!.textContent).toBe("Transportes Recebedor Ltda · 99.001.103/0001-33");
    expect(dialogo.querySelector<HTMLButtonElement>("[data-emitir]")!.disabled).toBe(true);
  });
});

/* --------------------------------- A minuta ----------------------------------- */

describe("folha da minuta de despacho: expedidor, recebedor e tipo de serviço", () => {
  const minuta = (extra: Partial<Minuta> = {}): Minuta => ({
    empresa: { name: "Transportes Avila", logo: null },
    codigo: "1234567890",
    emitidaEm: "2026-10-12T15:00:00.000Z",
    pagador: { nome: "Transportadora Contratante Ltda", documento: "99000503000124", endereco: null },
    remetente: { nome: "Indústria Remetente", documento: null, endereco: null, cidade: "São José do Rio Preto - SP" },
    destinatario: { nome: "Comércio Destinatário", documento: null, endereco: null, cidade: "Belo Horizonte - MG" },
    servico: null,
    expedidor: null,
    recebedor: null,
    carga: { volumes: 3, peso: 120.5, cubagem: null, valorDaMercadoria: null },
    notas: [],
    frete: null,
    viagem: null,
    motorista: null,
    cte: null,
    observacoes: null,
    ...extra,
  });

  async function abrir(corpo: Minuta) {
    api({ "/api/coletas/c1/minuta": { body: corpo } });
    const tela = await montar(
      <Suspense fallback="carregando">
        <MinutaPage params={Promise.resolve({ id: "c1" })} />
      </Suspense>,
    );
    await ate(() => expect(tela.querySelector("[data-minuta]")).not.toBeNull());
    return tela.querySelector<HTMLElement>("[data-minuta]")!;
  }
  const secao = (folha: HTMLElement, nome: string) => folha.querySelector<HTMLElement>(`[data-secao="${nome}"]`);

  it("serviço normal: a folha não mostra nada de redespacho", async () => {
    const folha = await abrir(minuta());
    for (const nome of ["servico", "expedidor", "recebedor"]) expect(secao(folha, nome), nome).toBeNull();
  });

  it("com redespacho: tipo de serviço com a chave do CT-e anterior em blocos, e o expedidor e o recebedor entre as partes e o pagador", async () => {
    const folha = await abrir(
      minuta({
        servico: { rotulo: "Redespacho intermediário", chaveDoCteAnterior: CHAVE_ANTERIOR },
        expedidor: { nome: "Centro de Distribuição Expedidor Ltda", documento: "99000903000130", endereco: "Rua das Docas, 50 - Distrito Industrial, São José do Rio Preto - SP, 15035-100" },
        recebedor: { nome: "Transportes Recebedor Ltda", documento: null, endereco: null },
      }),
    );
    expect(secao(folha, "servico")!.textContent).toContain("Tipo de serviço");
    expect(secao(folha, "servico")!.textContent).toContain("Redespacho intermediário");
    expect(secao(folha, "servico")!.textContent).toContain("CT-e anterior: 3526 1099 0005 0300 0124 5700 1000 0003 2111 2345 6785");
    expect(secao(folha, "expedidor")!.textContent).toContain("Centro de Distribuição Expedidor Ltda");
    expect(secao(folha, "expedidor")!.textContent).toContain("99.000.903/0001-30");
    expect(secao(folha, "expedidor")!.textContent).toContain("Rua das Docas, 50 - Distrito Industrial");
    expect(secao(folha, "recebedor")!.textContent).toContain("Transportes Recebedor Ltda");
    const ordem = [...folha.querySelectorAll("[data-secao]")].map((no) => no.getAttribute("data-secao"));
    expect(ordem.slice(0, 6)).toEqual(["remetente", "destinatario", "expedidor", "recebedor", "servico", "pagador"]);
    // Só o tipo, sem chave: a linha da chave não aparece.
    await desmontarTudo();
    const semChave = await abrir(minuta({ servico: { rotulo: "Subcontratação", chaveDoCteAnterior: null } }));
    expect(secao(semChave, "servico")!.textContent).toBe("Tipo de serviçoSubcontratação");
  });
});
