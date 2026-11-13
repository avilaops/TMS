// @vitest-environment jsdom
import { act, useReducer } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ate, clicar, desmontarTudo, montar, porTexto } from "./tela";
import { formatCurrency } from "../src/lib/format";

const estado = vi.hoisted(() => ({ perfil: "DIRECTOR" as string | null }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: estado.perfil ? { user: { role: estado.perfil } } : null }) }));
vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a>,
}));

import FinanceiroPage from "../src/app/dashboard/financeiro/page";

const lancamento = (id: string, extra: Record<string, unknown> = {}) => ({
  id, type: "INCOME", amount: 120, description: `Frete ${id}`, dueDate: null,
  status: "PENDING", paidAt: null, paymentMethod: null, paidAmount: null,
  category: null, costCenter: "Filial A", counterparty: "Transportes Teste",
  notes: null, clientId: null, client: null, invoice: null, ...extra,
});
const LANCAMENTOS = [
  lancamento("aberto"),
  lancamento("recebido", { status: "PAID", paidAt: "2026-11-01T12:00:00Z" }),
  lancamento("fatura", { invoice: { id: "fat-1", number: 1 } }),
  lancamento("despesa", { type: "EXPENSE", costCenter: "Filial B" }),
];

function api(status = 200) {
  const pedidos: { caminho: string; metodo: string; corpo: Record<string, unknown> | null }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const caminho = String(url), metodo = init?.method ?? "GET";
    pedidos.push({ caminho, metodo, corpo: init?.body ? JSON.parse(String(init.body)) : null });
    if (metodo !== "GET") return Response.json({ ok: true });
    if (caminho === "/api/financeiro") return Response.json(LANCAMENTOS, { status });
    if (caminho === "/api/financeiro/fluxo") return Response.json({ fluxo: [{
      mes: "2026-11", previsto: { entradas: 360, saidas: 120 }, realizado: { entradas: 120, saidas: 0, saldo: 120 }, acumulado: 120,
    }] });
    if (caminho === "/api/clientes") return Response.json([]);
    if (caminho === "/api/empresa/cobranca") return Response.json({ multaPct: 2, jurosPct: 1 });
    throw new Error(`Chamada inesperada: ${metodo} ${caminho}`);
  }));
  return pedidos;
}

async function abrir() {
  const pedidos = api();
  const tela = await montar(<FinanceiroPage />);
  await ate(() => expect(tela.textContent).toContain("Frete aberto"));
  return { tela, pedidos, gravacoes: () => pedidos.filter((p) => p.metodo !== "GET") };
}

const botao = (tela: ParentNode, texto: string) => porTexto(tela, "button", texto)[0];
const linha = (tela: HTMLElement, texto: string) => porTexto(tela, "tbody tr", texto)[0];
async function preencher(campo: HTMLInputElement | HTMLSelectElement, valor: string) {
  await act(async () => {
    const prototipo = campo instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototipo, "value")!.set!.call(campo, valor);
    campo.dispatchEvent(new Event(campo instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}
async function enviar(form: HTMLFormElement) {
  await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
}

beforeEach(() => { estado.perfil = "DIRECTOR"; });
afterEach(async () => { await desmontarTudo(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("Financeiro conforme as capacidades do perfil", () => {
  it("Diretoria consulta dados, filtros, fluxo e recibos sem receber comandos que a API recusaria", async () => {
    const { tela, gravacoes } = await abrir();
    expect(tela.textContent).toContain("Somente leitura");
    expect(tela.textContent).toContain(formatCurrency(240));
    expect(tela.querySelector('a[href="/dashboard/financeiro/recibo/recebido"]')).not.toBeNull();
    expect(tela.querySelector('a[href="/dashboard/faturamento/fat-1"]')).not.toBeNull();
    expect(tela.querySelector('a[href="/dashboard/financeiro/conciliacao"]')).toBeNull();
    expect(porTexto(tela, "button", /Novo|Editar|Excluir|Marcar recebido|Reabrir/)).toHaveLength(0);

    await preencher(tela.querySelector("select")!, "pago");
    expect(tela.textContent).toContain("Frete recebido");
    expect(tela.textContent).not.toContain("Frete aberto");
    await preencher(tela.querySelector("select")!, "");
    await preencher(tela.querySelector('[data-filtro="centro"]')!, "Filial B");
    await clicar(botao(tela, "A pagar"));
    expect(tela.textContent).toContain("Frete despesa");
    expect(botao(tela, "Marcar pago")).toBeUndefined();
    await clicar(botao(tela, "Fluxo de caixa"));
    expect(tela.textContent).toContain("Entradas realizadas");
    expect(tela.textContent).toContain("nov.");
    expect(tela.querySelector("form")).toBeNull();
    expect(gravacoes()).toEqual([]);
  });

  it.each([null, "DESCONHECIDO"])("sessão sem perfil de escrita (%s) não expõe comandos de gravação", async (perfil) => {
    estado.perfil = perfil;
    const { tela } = await abrir();
    expect(porTexto(tela, "button", /Novo|Editar|Excluir|Marcar recebido|Reabrir/)).toHaveLength(0);
    expect(tela.querySelector('a[href="/dashboard/financeiro/conciliacao"]')).toBeNull();
  });

  it.each([401, 403])("a recusa da API (%s) continua impedindo a exibição dos dados", async (status) => {
    api(status);
    const tela = await montar(<FinanceiroPage />);
    await ate(() => expect(tela.textContent).toContain(status === 401 ? "Sessão expirada" : "Acesso negado"));
    expect(tela.textContent).not.toContain("Frete aberto");
    expect(tela.querySelector("form")).toBeNull();
  });

  it.each(["lançamento", "baixa"])("retira o formulário de %s se a sessão passa de Financeiro para Diretoria", async (painel) => {
    estado.perfil = "FINANCE";
    const pedidos = api();
    let atualizar!: () => void;
    function TelaComSessao() {
      const [, renderizar] = useReducer((n: number) => n + 1, 0);
      atualizar = renderizar;
      return <FinanceiroPage />;
    }
    const tela = await montar(<TelaComSessao />);
    await ate(() => expect(tela.textContent).toContain("Frete aberto"));
    await clicar(painel === "lançamento" ? botao(tela, "Novo lançamento") : botao(linha(tela, "Frete aberto"), "Marcar recebido"));
    expect(tela.querySelector("form")).not.toBeNull();
    estado.perfil = "DIRECTOR";
    await act(async () => { atualizar(); });
    expect(tela.querySelector("form")).toBeNull();
    expect(tela.textContent).toContain("Somente leitura");
    expect(porTexto(tela, "button", /Novo|Editar|Excluir|Marcar recebido|Reabrir/)).toHaveLength(0);
    await clicar(botao(tela, "A pagar"));
    expect(tela.textContent).toContain("Frete despesa");
    expect(pedidos.every((p) => p.metodo === "GET")).toBe(true);
  });

  describe.each(["ADMIN", "FINANCE"])("%s", (perfil) => {
    beforeEach(() => { estado.perfil = perfil; });

    it("preserva conciliação, novo lançamento e edição", async () => {
      const { tela, gravacoes } = await abrir();
      expect(tela.textContent).not.toContain("Somente leitura");
      expect(tela.querySelector('a[href="/dashboard/financeiro/conciliacao"]')).not.toBeNull();
      await clicar(botao(tela, "Novo lançamento"));
      const form = tela.querySelector("form")!;
      await preencher(porTexto(form, "label", "Descrição")[0].querySelector("input")!, "Frete avulso");
      await preencher(porTexto(form, "label", "Valor (R$)")[0].querySelector("input")!, "150,00");
      await enviar(form);
      expect(gravacoes()[0]).toMatchObject({ caminho: "/api/financeiro", metodo: "POST", corpo: { description: "Frete avulso", amount: "150,00" } });
      await clicar(botao(linha(tela, "Frete aberto"), "Editar"));
      await preencher(porTexto(tela.querySelector("form")!, "label", "Descrição")[0].querySelector("input")!, "Frete corrigido");
      await enviar(tela.querySelector("form")!);
      expect(gravacoes()[1]).toMatchObject({ caminho: "/api/financeiro/aberto", metodo: "PATCH", corpo: { description: "Frete corrigido" } });
    });

    it("preserva baixa, reabertura e pagamento da despesa", async () => {
      const { tela, gravacoes } = await abrir();
      await clicar(botao(linha(tela, "Frete aberto"), "Marcar recebido"));
      await enviar(tela.querySelector('form[aria-label="Baixa do título"]')!);
      expect(gravacoes()[0]).toMatchObject({ caminho: "/api/financeiro/aberto", metodo: "PATCH", corpo: { action: "pagar" } });
      await clicar(botao(linha(tela, "Frete recebido"), "Reabrir"));
      expect(gravacoes()[1]).toMatchObject({ caminho: "/api/financeiro/recebido", metodo: "PATCH", corpo: { action: "reabrir" } });
      await clicar(botao(tela, "A pagar"));
      await clicar(botao(linha(tela, "Frete despesa"), "Marcar pago"));
      expect(gravacoes()[2]).toMatchObject({ caminho: "/api/financeiro/despesa", metodo: "PATCH", corpo: { action: "pagar" } });
    });

    it("preserva exclusão confirmada e trata lançamentos de fatura pelo Faturamento", async () => {
      const { tela, gravacoes } = await abrir();
      expect(linha(tela, "Frete fatura").querySelectorAll("button")).toHaveLength(0);
      vi.spyOn(window, "confirm").mockReturnValue(true);
      await clicar(botao(linha(tela, "Frete aberto"), "Excluir"));
      expect(window.confirm).toHaveBeenCalledOnce();
      expect(gravacoes()).toEqual([{ caminho: "/api/financeiro/aberto", metodo: "DELETE", corpo: null }]);
    });
  });
});
