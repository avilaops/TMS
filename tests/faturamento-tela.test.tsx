// @vitest-environment jsdom
import { Suspense, act, useReducer } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ate, clicar, desmontarTudo, montar, porTexto } from "./tela";

const estado = vi.hoisted(() => ({ perfil: "DIRECTOR" as string | null }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: estado.perfil ? { user: { role: estado.perfil } } : null }) }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));

import Faturamento from "../src/app/dashboard/faturamento/page";
import FaturaPage from "../src/app/dashboard/faturamento/[id]/page";

const CARGA = { id: "c-1", trackingCode: "TMS-1", createdAt: "2026-11-01T12:00:00Z", origin: "São Paulo", destination: "Campinas", receiver: "Maria", volumes: 2, weight: 10, freightValue: 100 };
const FATURA = {
  id: "f-1", number: 1, status: "OPEN", total: 100, dueDate: "2026-11-20T00:00:00Z", issuedAt: "2026-11-01T12:00:00Z",
  client: { companyName: "Transportes Teste Ltda", tradeName: "Transportes Teste", cnpj: "12345678000190" },
  _count: { collections: 1 }, paidAt: null, transaction: null, collections: [CARGA], notes: "Entrega conferida", pix: "PIX-ESTATICO-TESTE", gateway: true,
};
const COBRANCA = {
  id: "b-1", tipo: "BOLETO", situacao: "PENDING", valor: 100, valorPago: null, copiaECola: null, qrCodeBase64: null,
  link: "https://www.mercadopago.com.br/payments/1/ticket", linhaDigitavel: "123456789", venceEm: "2026-11-20T00:00:00Z", criadaEm: "2026-11-01T12:00:00Z", pagaEm: null, nota: null,
};

function api({ paga = false, status = 200 } = {}) {
  const pedidos: { caminho: string; metodo: string; corpo: Record<string, unknown> | null }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const caminho = String(url), metodo = init?.method ?? "GET";
    const corpo = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
    pedidos.push({ caminho, metodo, corpo });
    if (metodo !== "GET") return Response.json(caminho.includes("/cobrancas") ? COBRANCA : FATURA);
    if (caminho === "/api/empresa/cobranca") return Response.json({ multaPct: 2, jurosPct: 1 });
    if (caminho === "/api/faturas/faturaveis") return Response.json([{ clientId: "cli-1", cliente: "Transportes Teste", cargas: 2, total: 100 }], { status });
    if (caminho === "/api/faturas/faturaveis?clientId=cli-1") return Response.json({ cargas: [CARGA], aCotar: [{ ...CARGA, id: "c-2", destination: "Santos", freightValue: null }] }, { status });
    if (caminho === "/api/faturas") return Response.json([FATURA, { ...FATURA, id: "f-2", number: 2, status: "PAID" }], { status });
    if (caminho === "/api/faturas/f-1") return Response.json({ ...FATURA, ...(paga ? { status: "PAID", transaction: { id: "t-1" }, paidAt: "2026-11-02T12:00:00Z" } : {}), cobrancas: [COBRANCA] }, { status });
    throw new Error(`Chamada inesperada: ${metodo} ${caminho}`);
  }));
  return { pedidos, gravacoes: () => pedidos.filter((p) => p.metodo !== "GET") };
}

const botao = (tela: ParentNode, texto: string) => porTexto(tela, "button", texto)[0];
async function digitar(campo: HTMLInputElement | HTMLSelectElement, valor: string) {
  await act(async () => {
    const tipo = campo instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(tipo, "value")!.set!.call(campo, valor);
    campo.dispatchEvent(new Event(campo instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}
async function lista() {
  const chamadas = api();
  const tela = await montar(<Faturamento />);
  await ate(() => expect(tela.textContent).toContain("Faturas emitidas"));
  return { tela, ...chamadas };
}
async function detalhe(opcoes: Parameters<typeof api>[0] = {}) {
  const chamadas = api(opcoes);
  const tela = await montar(<Suspense fallback={<p>Carregando fatura</p>}><FaturaPage params={Promise.resolve({ id: "f-1" })} /></Suspense>);
  await ate(() => expect(tela.textContent).toContain("Fatura nº 1"));
  return { tela, ...chamadas };
}

beforeEach(() => { estado.perfil = "DIRECTOR"; vi.spyOn(window, "scrollTo").mockImplementation(() => {}); });
afterEach(async () => { await desmontarTudo(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("Faturamento conforme as capacidades", () => {
  it("Diretoria consulta faturas e cargas sem seleção ou comandos de emissão e baixa", async () => {
    const { tela, gravacoes } = await lista();
    expect(tela.textContent).toContain("Faturas em modo de consulta.");
    expect(porTexto(tela, "button", /Marcar paga|Cancelar|Reabrir/)).toHaveLength(0);
    expect(tela.querySelector('a[href="/dashboard/faturamento/f-1"]')).not.toBeNull();
    await digitar(tela.querySelector("select")!, "cli-1");
    expect(tela.textContent).toContain("Maria");
    expect(tela.querySelector('input[type="checkbox"]')).toBeNull();
    expect(tela.querySelector('input[type="date"]')).toBeNull();
    expect(botao(tela, "Emitir fatura")).toBeUndefined();
    expect(gravacoes()).toEqual([]);
  });

  it("Diretoria preserva a capacidade independente de informar frete", async () => {
    const { tela, gravacoes } = await lista();
    await digitar(tela.querySelector("select")!, "cli-1");
    await digitar(tela.querySelector('input[aria-label="Frete da carga para Santos"]')!, "175,00");
    await clicar(botao(tela, "Gravar frete"));
    expect(gravacoes()).toEqual([{ caminho: "/api/coletas/c-2/frete", metodo: "PATCH", corpo: { freightValue: "175,00" } }]);
    expect(botao(tela, "Emitir fatura")).toBeUndefined();
  });

  it("Diretoria imprime a fatura e consulta Pix/boleto sem gerar ou atualizar cobrança", async () => {
    const { tela, gravacoes } = await detalhe();
    expect(tela.textContent).toContain("Fatura em modo de consulta.");
    expect(porTexto(tela, "button", /Gerar Pix|Gerar boleto|Atualizar situação/)).toHaveLength(0);
    expect(tela.querySelector('a[href="https://www.mercadopago.com.br/payments/1/ticket"]')).not.toBeNull();
    expect(tela.textContent).toContain("PIX-ESTATICO-TESTE");
    vi.spyOn(window, "print").mockImplementation(() => {});
    await clicar(botao(tela, "Imprimir ou salvar em PDF"));
    expect(window.print).toHaveBeenCalledOnce();
    expect(gravacoes()).toEqual([]);
  });

  it("Diretoria preserva o recibo da fatura paga", async () => {
    const { tela } = await detalhe({ paga: true });
    expect(tela.querySelector('a[href="/dashboard/financeiro/recibo/t-1"]')).not.toBeNull();
  });

  it.each([null, "DESCONHECIDO"])("sessão sem capacidade (%s) não recebe ações de gravação nas duas páginas", async (perfil) => {
    estado.perfil = perfil;
    const l = await lista();
    await digitar(l.tela.querySelector("select")!, "cli-1");
    expect(porTexto(l.tela, "button", /Emitir|Gravar frete|Marcar paga|Cancelar|Reabrir/)).toHaveLength(0);
    const d = await detalhe();
    expect(porTexto(d.tela, "button", /Gerar|Atualizar/)).toHaveLength(0);
  });

  it.each([401, 403])("recusa de leitura (%s) não exibe dados em nenhuma das páginas", async (status) => {
    api({ status });
    const l = await montar(<Faturamento />);
    await ate(() => expect(l.textContent).toContain("Acesso negado"));
    expect(l.textContent).not.toContain("Transportes Teste");
    const d = await montar(<Suspense fallback="Carregando"><FaturaPage params={Promise.resolve({ id: "f-1" })} /></Suspense>);
    await ate(() => expect(d.textContent).toContain("Seu perfil não tem acesso"));
    expect(d.textContent).not.toContain("Fatura nº 1");
  });

  it.each(["lista", "detalhe"])("mudança de perfil retira as ações de %s e a baixa aberta", async (pagina) => {
    estado.perfil = "ADMIN";
    const { gravacoes } = api();
    const params = Promise.resolve({ id: "f-1" });
    let atualizar!: () => void;
    function TelaComSessao() {
      const [, renderizar] = useReducer((n: number) => n + 1, 0);
      atualizar = renderizar;
      return pagina === "lista" ? <Faturamento /> : <Suspense fallback="Carregando"><FaturaPage params={params} /></Suspense>;
    }
    const tela = await montar(<TelaComSessao />);
    await ate(() => expect(tela.textContent).toContain(pagina === "lista" ? "Faturas emitidas" : "Fatura nº 1"));
    if (pagina === "lista") {
      await clicar(botao(tela, "Marcar paga"));
      expect(tela.querySelector('form[aria-label="Baixa do título"]')).not.toBeNull();
    }
    estado.perfil = "DIRECTOR";
    await act(async () => { atualizar(); });
    expect(tela.querySelector("form")).toBeNull();
    expect(porTexto(tela, "button", /Marcar paga|Cancelar|Reabrir|Gerar|Atualizar/)).toHaveLength(0);
    expect(gravacoes()).toEqual([]);
  });

  describe.each(["ADMIN", "FINANCE"])("%s", (perfil) => {
    beforeEach(() => { estado.perfil = perfil; });
    it("preserva emissão, baixa, reabertura e cancelamento", async () => {
      const { tela, gravacoes } = await lista();
      await digitar(tela.querySelector("select")!, "cli-1");
      expect(tela.querySelector('input[type="checkbox"]')).not.toBeNull();
      await clicar(botao(tela, "Emitir fatura"));
      expect(gravacoes()[0]).toMatchObject({ caminho: "/api/faturas", metodo: "POST", corpo: { clientId: "cli-1", collectionIds: ["c-1"] } });
      await clicar(botao(tela, "Marcar paga"));
      await act(async () => { tela.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
      expect(gravacoes()[1]).toMatchObject({ caminho: "/api/faturas/f-1", metodo: "PATCH", corpo: { action: "pagar" } });
      await clicar(botao(tela, "Reabrir"));
      expect(gravacoes()[2]).toMatchObject({ caminho: "/api/faturas/f-2", metodo: "PATCH", corpo: { action: "reabrir" } });
      vi.spyOn(window, "confirm").mockReturnValue(true);
      await clicar(botao(tela, "Cancelar"));
      expect(gravacoes()[3]).toMatchObject({ caminho: "/api/faturas/f-1", metodo: "PATCH", corpo: { action: "cancelar" } });
    });
    it("preserva geração de Pix e atualização da cobrança existente", async () => {
      const { tela, gravacoes } = await detalhe();
      await clicar(botao(tela, "Gerar Pix"));
      expect(gravacoes()[0]).toEqual({ caminho: "/api/faturas/f-1/cobrancas", metodo: "POST", corpo: { tipo: "PIX" } });
      await clicar(botao(tela, "Atualizar situação"));
      expect(gravacoes()[1]).toEqual({ caminho: "/api/faturas/f-1/cobrancas/b-1", metodo: "POST", corpo: null });
    });
  });
});
