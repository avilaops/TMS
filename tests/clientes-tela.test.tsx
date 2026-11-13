// @vitest-environment jsdom
import { act, useReducer } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ate, clicar, desmontarTudo, montar, porTexto } from "./tela";

const estado = vi.hoisted(() => ({ perfil: "FINANCE" as string | null }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: estado.perfil ? { user: { role: estado.perfil } } : null }) }));
vi.mock("../src/lib/brasilApi", () => ({ getCompanyByCnpj: vi.fn() }));
import ClientesPage from "../src/app/dashboard/clientes/page";

const CLIENTE = {
  id: "cli-1", cnpj: "12345678000190", companyName: "Transportes Teste Ltda", tradeName: "Transportes Teste",
  ie: "123", contactName: "Maria", email: "contato@example.com", phone: "11999990000", address: "Rua Teste, 100",
  notificationRecipients: [{ email: "fiscal@example.com", category: "fiscal", documents: ["cteXml"] }],
  notificationPreferences: { enabled: true, sendWhen: "disponivel" },
  paymentCondition: "28 dias", creditLimit: 1000, freightTableId: "tab-1", active: true,
};

function api(cliente = CLIENTE, status = 200) {
  const pedidos: { caminho: string; metodo: string; corpo: Record<string, unknown> | null }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const caminho = String(url), metodo = init?.method ?? "GET";
    pedidos.push({ caminho, metodo, corpo: init?.body ? JSON.parse(String(init.body)) : null });
    if (metodo !== "GET") return Response.json({ ...cliente, ...JSON.parse(String(init?.body)) });
    if (caminho === "/api/clientes") return Response.json([cliente], { status });
    if (caminho === "/api/tabelas-frete") return Response.json([{ id: "tab-1", name: "Tabela da transportadora", active: true, isDefault: true }]);
    throw new Error(`Chamada inesperada: ${metodo} ${caminho}`);
  }));
  return { pedidos, gravacoes: () => pedidos.filter((p) => p.metodo !== "GET") };
}
async function abrir(cliente = CLIENTE) {
  const chamadas = api(cliente);
  const tela = await montar(<ClientesPage />);
  await ate(() => expect(tela.textContent).toContain(cliente.companyName));
  return { tela, ...chamadas };
}
const botao = (tela: ParentNode, texto: string) => porTexto(tela, "button", texto)[0];
const campo = (tela: ParentNode, rotulo: string) => porTexto(tela, "label", rotulo)[0].parentElement!.querySelector("input")!;
async function digitar(alvo: HTMLInputElement | HTMLSelectElement, valor: string) {
  await act(async () => {
    const tipo = alvo instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(tipo, "value")!.set!.call(alvo, valor);
    alvo.dispatchEvent(new Event(alvo instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}

beforeEach(() => { estado.perfil = "FINANCE"; vi.spyOn(window, "alert").mockImplementation(() => {}); });
afterEach(async () => { await desmontarTudo(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("Clientes conforme as capacidades", () => {
  it("Financeiro consulta a lista e recebe somente a ação de editar condições", async () => {
    const { tela } = await abrir();
    expect(porTexto(tela, "button", /Novo Cliente|Desativar|Reativar/)).toHaveLength(0);
    expect(botao(tela, "Editar condições")).toBeDefined();
    expect(tela.textContent).toContain(CLIENTE.email);
    await clicar(botao(tela, "Editar condições"));
    expect(tela.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Comercial");
    expect(campo(tela, "Condição de Pagamento").matches(":disabled")).toBe(false);
    expect(campo(tela, "Limite de Crédito").matches(":disabled")).toBe(false);
    expect(tela.querySelector("select")!.disabled).toBe(true);
    expect(tela.textContent).toContain("Você pode alterar somente a condição de pagamento e o limite de crédito.");
  });

  it("Financeiro lê cadastro e notificações sem poder alterá-los ou buscar CNPJ", async () => {
    const { tela } = await abrir();
    await clicar(botao(tela, "Editar condições"));
    await clicar(botao(tela, "Dados cadastrais"));
    expect(campo(tela, "Razão Social").value).toBe(CLIENTE.companyName);
    expect([...tela.querySelectorAll("input")].every((c) => c.matches(":disabled"))).toBe(true);
    expect(botao(tela, "Buscar")).toBeUndefined();
    await clicar(botao(tela, "Documentos e notificações"));
    expect(tela.querySelector('input[type="email"]')!.getAttribute("value")).toBe("fiscal@example.com");
    expect([...tela.querySelectorAll("input, select")].every((c) => c.matches(":disabled"))).toBe(true);
    expect(botao(tela, "Adicionar e-mail").matches(":disabled")).toBe(true);
    expect(botao(tela, "Remover").matches(":disabled")).toBe(true);
  });

  it("envia somente as duas condições alteradas, inclusive quando o CNPJ legado está vazio", async () => {
    const { tela, gravacoes } = await abrir({ ...CLIENTE, cnpj: "" });
    await clicar(botao(tela, "Editar condições"));
    await digitar(campo(tela, "Condição de Pagamento"), "35 dias");
    await digitar(campo(tela, "Limite de Crédito"), "2500");
    await clicar(botao(tela, "Salvar condições"));
    expect(gravacoes()).toEqual([{ caminho: "/api/clientes/cli-1", metodo: "PATCH", corpo: { paymentCondition: "35 dias", creditLimit: "2500" } }]);
    expect(window.alert).not.toHaveBeenCalled();
  });

  it("não grava ao cancelar nem ao salvar sem alterações; permite limpar condições", async () => {
    const { tela, gravacoes } = await abrir();
    await clicar(botao(tela, "Editar condições"));
    await digitar(campo(tela, "Condição de Pagamento"), "45 dias");
    await clicar(botao(tela, "Cancelar"));
    expect(gravacoes()).toEqual([]);
    await clicar(botao(tela, "Editar condições"));
    expect(campo(tela, "Condição de Pagamento").value).toBe("28 dias");
    await clicar(botao(tela, "Salvar condições"));
    expect(gravacoes()).toEqual([]);
    await clicar(botao(tela, "Editar condições"));
    await digitar(campo(tela, "Condição de Pagamento"), "");
    await digitar(campo(tela, "Limite de Crédito"), "");
    await clicar(botao(tela, "Salvar condições"));
    expect(gravacoes()[0].corpo).toEqual({ paymentCondition: "", creditLimit: "" });
  });

  it.each([null, "DESCONHECIDO"])("sessão sem capacidade (%s) não oferece gravações", async (perfil) => {
    estado.perfil = perfil;
    const { tela } = await abrir();
    expect(porTexto(tela, "button", /Novo Cliente|Editar|Desativar|Reativar/)).toHaveLength(0);
  });

  it.each([401, 403])("recusa de leitura da API (%s) não exibe os dados do cliente", async (status) => {
    api(CLIENTE, status);
    const tela = await montar(<ClientesPage />);
    await ate(() => expect(tela.textContent).toContain("Nenhum cliente cadastrado"));
    expect(tela.textContent).not.toContain(CLIENTE.companyName);
    expect(porTexto(tela, "button", /Novo Cliente|Editar|Desativar/)).toHaveLength(0);
  });

  it.each(["novo", "edição"])("retira o editor de %s quando a sessão perde a capacidade necessária", async (modo) => {
    estado.perfil = "ADMIN";
    const { gravacoes } = api();
    let atualizar!: () => void;
    function TelaComSessao() {
      const [, renderizar] = useReducer((n: number) => n + 1, 0);
      atualizar = renderizar;
      return <ClientesPage />;
    }
    const tela = await montar(<TelaComSessao />);
    await ate(() => expect(tela.textContent).toContain(CLIENTE.companyName));
    await clicar(botao(tela, modo === "novo" ? "Novo Cliente" : "Editar"));
    expect(tela.querySelector('[role="dialog"]')).not.toBeNull();
    estado.perfil = modo === "novo" ? "FINANCE" : null;
    await act(async () => { atualizar(); });
    expect(tela.querySelector('[role="dialog"]')).toBeNull();
    expect(gravacoes()).toEqual([]);
  });

  it("trocar de Administrador para Financeiro descarta campos proibidos do payload em um editor aberto", async () => {
    estado.perfil = "ADMIN";
    const { gravacoes } = api();
    let atualizar!: () => void;
    function TelaComSessao() {
      const [, renderizar] = useReducer((n: number) => n + 1, 0);
      atualizar = renderizar;
      return <ClientesPage />;
    }
    const tela = await montar(<TelaComSessao />);
    await ate(() => expect(tela.textContent).toContain(CLIENTE.companyName));
    await clicar(botao(tela, "Editar"));
    await digitar(campo(tela, "Razão Social"), "Alteração fora do alcance");
    await clicar(botao(tela, "Comercial"));
    await digitar(tela.querySelector("select")!, "");
    await digitar(campo(tela, "Condição de Pagamento"), "42 dias");
    estado.perfil = "FINANCE";
    await act(async () => { atualizar(); });
    expect(tela.querySelector("select")!.disabled).toBe(true);
    await clicar(botao(tela, "Salvar condições"));
    expect(gravacoes()[0].corpo).toEqual({ paymentCondition: "42 dias" });
  });

  describe.each(["ADMIN", "DIRECTOR", "OPERATION", "COMMERCIAL"])("%s preserva o cadastro completo", (perfil) => {
    beforeEach(() => { estado.perfil = perfil; });
    it("cria cliente e mantém edição de cadastro, tabela e notificações", async () => {
      const { tela, gravacoes } = await abrir();
      await clicar(botao(tela, "Novo Cliente"));
      await digitar(campo(tela, "CNPJ / CPF"), "12345678000190");
      await digitar(campo(tela, "Razão Social"), "Novo cliente");
      await clicar(botao(tela, "Salvar Cliente"));
      expect(gravacoes()[0]).toMatchObject({ caminho: "/api/clientes", metodo: "POST", corpo: { companyName: "Novo cliente", cnpj: "12345678000190" } });
      await clicar(botao(tela, "Editar"));
      expect(campo(tela, "Razão Social").matches(":disabled")).toBe(false);
      expect(botao(tela, "Buscar")).toBeDefined();
      await digitar(campo(tela, "Razão Social"), "Nome corrigido");
      await clicar(botao(tela, "Comercial"));
      expect(tela.querySelector("select")!.disabled).toBe(false);
      await digitar(tela.querySelector("select")!, "");
      await clicar(botao(tela, "Documentos e notificações"));
      expect(tela.querySelector('input[type="email"]')!.matches(":disabled")).toBe(false);
      await clicar(botao(tela, "Salvar Cliente"));
      expect(gravacoes()[1].corpo).toEqual({ companyName: "Nome corrigido", freightTableId: "" });
    });
    it("desativa e reativa", async () => {
      const { tela, gravacoes } = await abrir();
      vi.spyOn(window, "confirm").mockReturnValue(true);
      await clicar(botao(tela, "Desativar"));
      expect(gravacoes()[0].corpo).toEqual({ active: false });
      await desmontarTudo();
      const inativo = await abrir({ ...CLIENTE, active: false });
      await clicar(botao(inativo.tela, "Reativar"));
      expect(inativo.gravacoes()[0].corpo).toEqual({ active: true });
    });
  });
});
