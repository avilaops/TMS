// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ate, clicar, desmontarTudo, montar, porTexto } from "./tela";

/**
 * Tela do funil de cotações (`/dashboard/crm`). As regras ficam nas rotas,
 * testadas com banco em `tests/crm.test.ts`; aqui se confere o que a tela
 * mostra e o que ela manda em cada ação.
 */

import CRMPage from "../src/app/dashboard/crm/page";

const lead = (extra: Record<string, unknown> = {}) => ({
  id: "lead-1",
  companyName: "Indústria Interessada",
  email: "compras@industria.br",
  phone: "17999990000",
  origin: "São José do Rio Preto",
  destination: "Mirassol",
  volumes: 3,
  weight: 120.5,
  estimatedValue: 150,
  invoiceValue: 2000,
  status: "NEW",
  channel: "SITE",
  number: 1494,
  lostReason: null,
  assignee: null,
  createdAt: "2026-10-08T15:30:00.000Z",
  lastActivityAt: new Date().toISOString(),
  collection: null,
  ...extra,
});

const haDias = (dias: number) => new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();

const CLIENTES = [
  { id: "cli-1", companyName: "Serilon Brasil Ltda", tradeName: "Serilon", active: true },
  { id: "cli-2", companyName: "Transportes Lima Ltda", tradeName: null, active: true },
  { id: "cli-3", companyName: "Cliente Desativado Ltda", tradeName: "Desativado", active: false },
];

type Resposta = { status?: number; body: unknown } | Error;
type Pedido = { metodo: string; caminho: string; corpo: unknown };

/** Cada chamada (`MÉTODO caminho`) recebe a próxima resposta da fila que o teste montou. */
function api(respostas: Record<string, Resposta[]>) {
  const pedidos: Pedido[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const metodo = init?.method ?? "GET";
      const caminho = String(url);
      pedidos.push({ metodo, caminho, corpo: init?.body ? JSON.parse(String(init.body)) : undefined });
      const fila = respostas[`${metodo} ${caminho}`];
      const resposta = fila?.length === 1 ? fila[0] : fila?.shift();
      if (!resposta) throw new Error(`Chamada inesperada: ${metodo} ${caminho}`);
      if (resposta instanceof Error) throw resposta;
      return new Response(typeof resposta.body === "string" ? resposta.body : JSON.stringify(resposta.body), {
        status: resposta.status ?? 200,
      });
    }),
  );
  return pedidos;
}

const LISTA = "GET /api/dashboard/crm";
const EQUIPE = "GET /api/dashboard/crm/equipe";
const PESSOAS = [
  { id: "u-ana", name: "Ana Paula" },
  { id: "u-rafa", name: "Rafael" },
];

const coluna = (tela: HTMLElement, status: string) => tela.querySelector<HTMLElement>(`[data-coluna="${status}"]`)!;
const cartao = (tela: HTMLElement, id = "lead-1") => tela.querySelector<HTMLElement>(`[data-lead="${id}"]`)!;
const botao = (onde: ParentNode, texto: string) => porTexto(onde, "button", texto)[0];
const alerta = (tela: HTMLElement) => tela.querySelector('[role="alert"]');

/** Digita ou escolhe como o React enxerga: pelo setter nativo, com o evento que ele escuta. */
async function preencher(campo: HTMLInputElement | HTMLSelectElement, valor: string) {
  const prototipo = campo instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototipo, "value")!.set!.call(campo, valor);
    campo.dispatchEvent(new Event(campo instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}

async function abrir(leads: unknown[], outras: Record<string, Resposta[]> = {}) {
  const pedidos = api({ [LISTA]: [{ body: leads }], [EQUIPE]: [{ body: PESSOAS }], ...outras });
  const tela = await montar(<CRMPage />);
  await ate(() => expect(tela.textContent).not.toContain("Carregando cotações..."));
  return { tela, pedidos };
}

const selectStatus = (onde: ParentNode) => onde.querySelector<HTMLSelectElement>('select[aria-label="Status da cotação"]')!;

afterEach(async () => {
  await desmontarTudo();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "clipboard");
});

describe("tela do funil de cotações", () => {
  it("mostra as quatro colunas com rótulo em português e cada lead na sua", async () => {
    const { tela } = await abrir([
      lead(),
      lead({ id: "lead-2", status: "CONTACTED" }),
      lead({ id: "lead-3", status: "LOST" }),
    ]);

    expect([...tela.querySelectorAll("h3")].map((h) => h.textContent)).toEqual([
      "Novos",
      "Em contato",
      "Convertidos",
      "Perdidos",
    ]);
    expect(coluna(tela, "NEW").contains(cartao(tela, "lead-1"))).toBe(true);
    expect(coluna(tela, "CONTACTED").contains(cartao(tela, "lead-2"))).toBe(true);
    expect(coluna(tela, "LOST").contains(cartao(tela, "lead-3"))).toBe(true);
    expect(coluna(tela, "CONVERTED").textContent).toContain("Nenhum lead");

    // O selo do cartão é o rótulo, não o código do status.
    expect(cartao(tela).textContent).toContain("Novos");
    expect(cartao(tela).textContent).not.toContain("NEW");
    expect(cartao(tela, "lead-2").textContent).not.toContain("CONTACTED");
    expect(alerta(tela)).toBeNull();
  });

  it("o select de status oferece só o que o operador escolhe, sem Convertidos", async () => {
    const { tela } = await abrir([lead()]);

    const opcoes = [...selectStatus(cartao(tela)).querySelectorAll("option")];
    expect(opcoes.map((o) => o.getAttribute("value"))).toEqual(["NEW", "CONTACTED", "LOST"]);
    expect(opcoes.map((o) => o.textContent)).toEqual(["Novos", "Em contato", "Perdidos"]);
  });

  it("valor em reais no padrão brasileiro; zero é R$ 0,00 e sem valor é Não definido", async () => {
    const { tela } = await abrir([
      lead(),
      lead({ id: "lead-zero", estimatedValue: 0 }),
      lead({ id: "lead-sem", estimatedValue: null }),
      lead({ id: "lead-mil", estimatedValue: 1234.5 }),
    ]);

    // O Intl separa "R$" do número com espaço não separável.
    const preco = (id: string) => cartao(tela, id).textContent!.replace(/ /g, " ");
    expect(preco("lead-1")).toContain("Preço: R$ 150,00");
    expect(preco("lead-zero")).toContain("Preço: R$ 0,00");
    expect(preco("lead-zero")).not.toContain("Não definido");
    expect(preco("lead-sem")).toContain("Preço: Não definido");
    expect(preco("lead-mil")).toContain("Preço: R$ 1.234,50");
  });

  it("trocar o status manda o PATCH e leva o cartão para a coluna nova", async () => {
    const { tela, pedidos } = await abrir([lead()], {
      "PATCH /api/dashboard/crm/lead-1": [{ body: lead({ status: "CONTACTED" }) }],
    });

    await preencher(selectStatus(cartao(tela)), "CONTACTED");
    await ate(() => expect(coluna(tela, "CONTACTED").contains(cartao(tela))).toBe(true));
    expect(pedidos.at(-1)).toEqual({ metodo: "PATCH", caminho: "/api/dashboard/crm/lead-1", corpo: { status: "CONTACTED" } });
  });

  it("fecha a proposta quando a cotação deixa de estar aberta", async () => {
    const { tela } = await abrir([lead()], {
      "PATCH /api/dashboard/crm/lead-1": [{ body: lead({ status: "LOST" }) }],
    });
    await clicar(botao(cartao(tela), "Preparar proposta"));
    expect(tela.querySelector('form[aria-label="Preparar proposta da cotação 1494"]')).not.toBeNull();

    await preencher(selectStatus(cartao(tela)), "LOST");
    await ate(() => expect(tela.querySelector('form[aria-label="Preparar proposta da cotação 1494"]')).toBeNull());
  });

  it("usa diálogo modal e fecha a proposta pelo Escape", async () => {
    const { tela } = await abrir([lead()]);
    await clicar(botao(cartao(tela), "Preparar proposta"));
    const dialogo = tela.querySelector<HTMLDialogElement>('dialog[aria-label="Proposta comercial"]')!;
    expect(dialogo).not.toBeNull();

    await act(async () => {
      dialogo.dispatchEvent(new Event("cancel", { bubbles: false, cancelable: true }));
    });
    expect(tela.querySelector('form[aria-label="Preparar proposta da cotação 1494"]')).toBeNull();
  });

  it("editar o valor manda o texto digitado, com vírgula, e mostra o valor gravado", async () => {
    const { tela, pedidos } = await abrir([lead()], {
      "PATCH /api/dashboard/crm/lead-1": [{ body: lead({ estimatedValue: 199.9 }) }],
    });

    await clicar(botao(cartao(tela), "Editar"));
    const campo = cartao(tela).querySelector<HTMLInputElement>('input[aria-label="Preço estimado"]')!;
    expect(campo.value).toBe("150");
    await preencher(campo, "199,90");
    await clicar(botao(cartao(tela), "Salvar"));

    await ate(() => expect(cartao(tela).textContent!.replace(/ /g, " ")).toContain("Preço: R$ 199,90"));
    expect(pedidos.at(-1)!.corpo).toEqual({ estimatedValue: "199,90" });
    expect(cartao(tela).querySelector('input[aria-label="Preço estimado"]')).toBeNull();
  });

  it("prepara e copia a proposta sem alterar a cotação nem registrar contato", async () => {
    const copiados: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (texto: string) => void copiados.push(texto) },
    });
    const { tela, pedidos } = await abrir([lead()]);

    await clicar(botao(cartao(tela), "Preparar proposta"));
    const form = tela.querySelector<HTMLFormElement>('form[aria-label="Preparar proposta da cotação 1494"]')!;
    expect(form).not.toBeNull();
    await preencher(form.querySelector<HTMLInputElement>('input[name="deadline"]')!, "até 2 dias úteis");
    await preencher(form.querySelector<HTMLInputElement>('input[name="validUntil"]')!, "2026-10-25");

    const previa = form.querySelector<HTMLTextAreaElement>('textarea[aria-label="Prévia da proposta"]')!;
    expect(previa.value).toContain("cotação nº 1494");
    expect(previa.value).toContain("Frete estimado: R$ 150,00");
    await clicar(botao(form, "Copiar proposta"));

    await ate(() => expect(form.querySelector('[role="status"]')?.textContent).toContain("Proposta copiada"));
    expect(copiados).toEqual([previa.value]);
    expect(pedidos).toHaveLength(2);
  });

  it("sem valor impede a proposta e orienta editar o preço", async () => {
    const { tela } = await abrir([lead({ estimatedValue: null })]);
    await clicar(botao(cartao(tela), "Preparar proposta"));

    const form = tela.querySelector('form[aria-label="Preparar proposta da cotação 1494"]')!;
    expect(form.querySelector('[role="alert"]')?.textContent).toContain("Informe o preço estimado");
    expect(botao(form, "Copiar proposta").hasAttribute("disabled")).toBe(true);
  });

  it("falha da área de transferência mantém a proposta disponível para cópia manual", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async () => { throw new Error("negado"); } },
    });
    const { tela } = await abrir([lead()]);
    await clicar(botao(cartao(tela), "Preparar proposta"));
    const form = tela.querySelector<HTMLFormElement>('form[aria-label="Preparar proposta da cotação 1494"]')!;
    await preencher(form.querySelector<HTMLInputElement>('input[name="deadline"]')!, "24 horas");
    await preencher(form.querySelector<HTMLInputElement>('input[name="validUntil"]')!, "2026-10-25");
    await clicar(botao(form, "Copiar proposta"));

    await ate(() => expect(form.querySelector('[role="alert"]')?.textContent).toContain("Selecione o texto"));
    expect(form.querySelector<HTMLTextAreaElement>('textarea[aria-label="Prévia da proposta"]')!.readOnly).toBe(true);
  });

  it("trocar de cotação limpa os termos comerciais da proposta", async () => {
    const { tela } = await abrir([lead(), lead({ id: "lead-2", number: 1495, companyName: "Outro cliente" })]);
    await clicar(botao(cartao(tela), "Preparar proposta"));
    let form = tela.querySelector<HTMLFormElement>('form[aria-label="Preparar proposta da cotação 1494"]')!;
    await preencher(form.querySelector<HTMLInputElement>('input[name="deadline"]')!, "24 horas");
    await preencher(form.querySelector<HTMLInputElement>('input[name="validUntil"]')!, "2026-10-25");

    await clicar(botao(cartao(tela, "lead-2"), "Preparar proposta"));
    form = tela.querySelector<HTMLFormElement>('form[aria-label="Preparar proposta da cotação 1495"]')!;
    expect(form.querySelector<HTMLInputElement>('input[name="deadline"]')!.value).toBe("");
    expect(form.querySelector<HTMLInputElement>('input[name="validUntil"]')!.value).toBe("");
    expect(form.querySelector<HTMLTextAreaElement>('textarea[aria-label="Prévia da proposta"]')!.value).toBe("");
  });

  it("proposta aberta acompanha o preço atualizado da cotação", async () => {
    const { tela } = await abrir([lead()], {
      "PATCH /api/dashboard/crm/lead-1": [{ body: lead({ estimatedValue: 199.9 }) }],
    });
    await clicar(botao(cartao(tela), "Preparar proposta"));
    const form = tela.querySelector<HTMLFormElement>('form[aria-label="Preparar proposta da cotação 1494"]')!;
    await preencher(form.querySelector<HTMLInputElement>('input[name="deadline"]')!, "24 horas");
    await preencher(form.querySelector<HTMLInputElement>('input[name="validUntil"]')!, "2026-10-25");

    await clicar(botao(cartao(tela), "Editar"));
    await preencher(cartao(tela).querySelector<HTMLInputElement>('input[aria-label="Preço estimado"]')!, "199,90");
    await clicar(botao(cartao(tela), "Salvar"));

    await ate(() => expect(form.querySelector<HTMLTextAreaElement>('textarea[aria-label="Prévia da proposta"]')!.value).toContain("R$ 199,90"));
  });

  it("Converter em coleta só aparece em Novos e Em contato", async () => {
    const { tela } = await abrir([
      lead(),
      lead({ id: "lead-2", status: "CONTACTED" }),
      lead({ id: "lead-3", status: "LOST" }),
      lead({ id: "lead-4", status: "CONVERTED", collection: { id: "c-1", trackingCode: "9184726350", status: "CONFIRMED" } }),
    ]);

    expect(botao(cartao(tela, "lead-1"), "Converter em coleta")).toBeDefined();
    expect(botao(cartao(tela, "lead-2"), "Converter em coleta")).toBeDefined();
    expect(botao(cartao(tela, "lead-3"), "Converter em coleta")).toBeUndefined();
    expect(botao(cartao(tela, "lead-4"), "Converter em coleta")).toBeUndefined();
  });

  it("cartão convertido mostra o código de rastreio e fica sem select, Editar e Converter", async () => {
    const { tela } = await abrir([
      lead({ status: "CONVERTED", collection: { id: "c-1", trackingCode: "9184726350", status: "CONFIRMED" } }),
      // Marcado como convertido à mão, antes de existir a conversão: sem coleta.
      lead({ id: "lead-antigo", status: "CONVERTED", collection: null }),
    ]);

    const convertido = cartao(tela);
    expect(coluna(tela, "CONVERTED").contains(convertido)).toBe(true);
    expect(convertido.querySelector(".font-mono")!.textContent).toBe("9184726350");
    expect(convertido.querySelector("select")).toBeNull();
    expect(convertido.querySelectorAll("button")).toHaveLength(0);

    const antigo = cartao(tela, "lead-antigo");
    expect(antigo.querySelector(".font-mono")).toBeNull();
    expect(antigo.textContent).toContain("sem coleta vinculada");
    expect(antigo.querySelectorAll("button, select")).toHaveLength(0);
  });

  it("o formulário de conversão vem preenchido pelo lead, lista só clientes ativos e mostra a carga só para leitura", async () => {
    const { tela, pedidos } = await abrir([lead()], { "GET /api/clientes": [{ body: CLIENTES }] });

    await clicar(botao(cartao(tela), "Converter em coleta"));
    const form = cartao(tela).querySelector("form")!;
    await ate(() => expect(form.querySelectorAll('select[name="clientId"] option')).toHaveLength(3));

    expect(pedidos.map((p) => `${p.metodo} ${p.caminho}`)).toEqual([LISTA, EQUIPE, "GET /api/clientes"]);
    const opcoes = [...form.querySelectorAll('select[name="clientId"] option')];
    // Nome fantasia quando há; senão a razão social. O inativo não entra.
    expect(opcoes.map((o) => o.textContent)).toEqual(["Selecione o cliente", "Serilon", "Transportes Lima Ltda"]);
    expect(opcoes.map((o) => o.getAttribute("value"))).toEqual(["", "cli-1", "cli-2"]);

    expect(form.querySelector<HTMLInputElement>('input[name="sender"]')!.value).toBe("Indústria Interessada");
    expect(form.querySelector<HTMLInputElement>('input[name="receiver"]')!.value).toBe("");
    expect(form.querySelector<HTMLInputElement>('input[name="invoiceValue"]')!.value).toBe("2000");

    // Origem, destino, volumes e peso aparecem, mas não há campo para mudá-los.
    expect(form.querySelector("[data-carga]")!.textContent).toBe(
      "Carga do pedido: São José do Rio Preto ➔ Mirassol, 3 vol, 120.5 kg",
    );
    expect([...form.querySelectorAll("input, select")].map((c) => c.getAttribute("name"))).toEqual([
      "clientId",
      "sender",
      "receiver",
      "invoiceValue",
    ]);
  });

  it("lead sem valor de nota abre o formulário com o campo vazio; Cancelar fecha sem chamar a rota", async () => {
    const { tela, pedidos } = await abrir([lead({ invoiceValue: null })], { "GET /api/clientes": [{ body: CLIENTES }] });

    await clicar(botao(cartao(tela), "Converter em coleta"));
    expect(cartao(tela).querySelector<HTMLInputElement>('input[name="invoiceValue"]')!.value).toBe("");

    await clicar(botao(cartao(tela), "Cancelar"));
    expect(cartao(tela).querySelector("form")).toBeNull();
    expect(botao(cartao(tela), "Converter em coleta")).toBeDefined();
    expect(pedidos.some((p) => p.metodo === "POST")).toBe(false);
  });

  it("confirmar chama a rota de conversão e o cartão vai para Convertidos com o rastreio", async () => {
    const convertido = lead({ status: "CONVERTED", collection: { id: "c-9", trackingCode: "0000000123", status: "CONFIRMED" } });
    const { tela, pedidos } = await abrir([lead()], {
      "GET /api/clientes": [{ body: CLIENTES }],
      "POST /api/dashboard/crm/lead-1/converter": [{ status: 201, body: { lead: convertido, collection: { id: "c-9" } } }],
    });

    await clicar(botao(cartao(tela), "Converter em coleta"));
    const form = cartao(tela).querySelector("form")!;
    await ate(() => expect(form.querySelectorAll('select[name="clientId"] option')).toHaveLength(3));
    await preencher(form.querySelector<HTMLSelectElement>('select[name="clientId"]')!, "cli-2");
    await preencher(form.querySelector<HTMLInputElement>('input[name="receiver"]')!, "Loja Centro");
    await clicar(botao(form, "Confirmar conversão"));

    await ate(() => expect(coluna(tela, "CONVERTED").contains(cartao(tela))).toBe(true));
    expect(pedidos.at(-1)).toEqual({
      metodo: "POST",
      caminho: "/api/dashboard/crm/lead-1/converter",
      corpo: { clientId: "cli-2", sender: "Indústria Interessada", receiver: "Loja Centro", invoiceValue: "2000" },
    });
    expect(cartao(tela).querySelector(".font-mono")!.textContent).toBe("0000000123");
    expect(cartao(tela).querySelectorAll("button, select, form")).toHaveLength(0);
    expect(coluna(tela, "NEW").textContent).toContain("Nenhum lead");
    expect(alerta(tela)).toBeNull();
  });

  const aviso = (tela: HTMLElement) => tela.querySelector<HTMLElement>('[role="status"]');
  const semNbsp = (texto: string | null | undefined) => (texto ?? "").replace(/\s/g, " ");

  /** Converte o lead da tela com a resposta dada e devolve a tela já com o cartão em Convertidos. */
  async function converterCom(collection: Record<string, unknown>, doLead: Record<string, unknown> = {}) {
    const convertido = lead({
      status: "CONVERTED",
      collection: { id: "c-9", trackingCode: "0000000123", status: "CONFIRMED" },
      ...doLead,
    });
    const resultado = await abrir([lead(doLead)], {
      "GET /api/clientes": [{ body: CLIENTES }],
      "POST /api/dashboard/crm/lead-1/converter": [{ status: 201, body: { lead: convertido, collection: { id: "c-9", ...collection } } }],
    });
    const { tela } = resultado;
    await clicar(botao(cartao(tela), "Converter em coleta"));
    const form = cartao(tela).querySelector("form")!;
    await ate(() => expect(form.querySelectorAll('select[name="clientId"] option')).toHaveLength(3));
    return { ...resultado, form };
  }

  async function confirmar(tela: HTMLElement, form: HTMLFormElement) {
    await clicar(botao(form, "Confirmar conversão"));
    await ate(() => expect(coluna(tela, "CONVERTED").contains(cartao(tela))).toBe(true));
  }

  it("frete da tabela diferente do valor estimado: a confirmação mostra os dois valores, sem ser erro", async () => {
    const { tela, form } = await converterCom({ freightValue: 50 });
    expect(aviso(tela)).toBeNull();
    await confirmar(tela, form);

    await ate(() => expect(aviso(tela)).not.toBeNull());
    expect(semNbsp(aviso(tela)!.textContent)).toBe(
      "Cotação de Indústria Interessada convertida em coleta. Valor estimado na cotação: R$ 150,00. " +
        "Frete da coleta pela tabela: R$ 50,00. " +
        "É o frete da coleta que vai para a fatura: para cobrar o valor da cotação, edite o frete na coleta.",
    );
    expect(aviso(tela)!.className).toContain("text-amber-800");
    expect(alerta(tela)).toBeNull();
    // O cartão convertido continua mostrando o valor da cotação, que não foi trocado.
    expect(semNbsp(cartao(tela).textContent)).toContain("Preço: R$ 150,00");
  });

  it("coleta que nasceu a cotar, com valor estimado no lead: a confirmação diz que não há frete da tabela", async () => {
    const { tela, form } = await converterCom({ freightValue: null });
    await confirmar(tela, form);

    await ate(() => expect(aviso(tela)).not.toBeNull());
    const texto = semNbsp(aviso(tela)!.textContent);
    expect(texto).toContain("Valor estimado na cotação: R$ 150,00.");
    expect(texto).toContain("A coleta nasceu sem frete (a cotar)");
    expect(texto).not.toContain("Frete da coleta pela tabela");
  });

  it.each([
    ["o frete é igual ao valor estimado", { freightValue: 150 }, {}],
    ["o lead não tem valor estimado", { freightValue: 50 }, { estimatedValue: null }],
  ])("quando %s, a conversão não mostra aviso de valores", async (_caso, collection, doLead) => {
    const { tela, form } = await converterCom(collection, doLead);
    await confirmar(tela, form);

    expect(aviso(tela)).toBeNull();
    expect(alerta(tela)).toBeNull();
  });

  it("o aviso de valores some quando o operador abre outra conversão", async () => {
    const outro = lead({ id: "lead-2", companyName: "Outra Indústria" });
    const convertido = lead({ status: "CONVERTED", collection: { id: "c-9", trackingCode: "0000000123", status: "CONFIRMED" } });
    const { tela } = await abrir([lead(), outro], {
      "GET /api/clientes": [{ body: CLIENTES }],
      "POST /api/dashboard/crm/lead-1/converter": [{ status: 201, body: { lead: convertido, collection: { id: "c-9", freightValue: 50 } } }],
    });

    await clicar(botao(cartao(tela), "Converter em coleta"));
    await ate(() => expect(cartao(tela).querySelectorAll('select[name="clientId"] option')).toHaveLength(3));
    await confirmar(tela, cartao(tela).querySelector("form")!);
    await ate(() => expect(aviso(tela)).not.toBeNull());

    await clicar(botao(cartao(tela, "lead-2"), "Converter em coleta"));
    expect(aviso(tela)).toBeNull();
  });

  it("campo do valor da nota apagado vai vazio para a rota, que grava a coleta sem valor de nota", async () => {
    const { tela, form, pedidos } = await converterCom({ freightValue: 150, invoiceValue: null });
    const campo = form.querySelector<HTMLInputElement>('input[name="invoiceValue"]')!;
    expect(campo.value).toBe("2000");
    expect(form.textContent).toContain("Vazio: a coleta nasce sem valor de nota.");

    await preencher(campo, "");
    await preencher(form.querySelector<HTMLSelectElement>('select[name="clientId"]')!, "cli-1");
    await preencher(form.querySelector<HTMLInputElement>('input[name="receiver"]')!, "Loja Centro");
    await confirmar(tela, form);

    // A chave vai, vazia: é o que separa "apagado" de "não informado" na rota.
    expect(pedidos.at(-1)!.corpo).toEqual({ clientId: "cli-1", sender: "Indústria Interessada", receiver: "Loja Centro", invoiceValue: "" });
  });

  it.each([
    [400, "Informe o destinatário."],
    [404, "Cotação não encontrada."],
    [409, "Cotação já convertida em coleta."],
    [500, "Erro interno ao converter a cotação."],
  ])("conversão recusada com %i mostra a mensagem do corpo e mantém o formulário", async (status, mensagem) => {
    const { tela } = await abrir([lead()], {
      "GET /api/clientes": [{ body: CLIENTES }],
      "POST /api/dashboard/crm/lead-1/converter": [{ status, body: { error: mensagem } }],
    });

    await clicar(botao(cartao(tela), "Converter em coleta"));
    await clicar(botao(cartao(tela), "Confirmar conversão"));

    await ate(() => expect(alerta(tela)?.textContent).toBe(mensagem));
    expect(alerta(tela)!.className).toContain("text-red-700");
    expect(coluna(tela, "NEW").contains(cartao(tela))).toBe(true);
    expect(cartao(tela).querySelector("form")).not.toBeNull();
  });

  it("erro ao trocar status e ao salvar valor aparece na tela, e o cartão fica como estava", async () => {
    const { tela } = await abrir([lead()], {
      "PATCH /api/dashboard/crm/lead-1": [
        { status: 409, body: { error: "Cotação já convertida em coleta: não pode mais ser alterada." } },
        { status: 400, body: { error: "O valor precisa ser um número maior ou igual a zero." } },
        new TypeError("Failed to fetch"),
        { status: 502, body: "<html>" },
        { body: lead({ status: "LOST" }) },
      ],
    });

    await preencher(selectStatus(cartao(tela)), "LOST");
    await ate(() =>
      expect(alerta(tela)?.textContent).toBe("Cotação já convertida em coleta: não pode mais ser alterada."),
    );
    expect(coluna(tela, "NEW").contains(cartao(tela))).toBe(true);

    await clicar(botao(cartao(tela), "Editar"));
    await preencher(cartao(tela).querySelector<HTMLInputElement>('input[aria-label="Preço estimado"]')!, "abc");
    await clicar(botao(cartao(tela), "Salvar"));
    await ate(() => expect(alerta(tela)?.textContent).toBe("O valor precisa ser um número maior ou igual a zero."));
    // O campo continua aberto para corrigir.
    expect(cartao(tela).querySelector('input[aria-label="Preço estimado"]')).not.toBeNull();

    // Falha de rede e resposta que não é JSON também viram mensagem, nunca silêncio.
    await clicar(botao(cartao(tela), "Salvar"));
    await ate(() => expect(alerta(tela)?.textContent).toBe("Não foi possível falar com o servidor. Tente de novo."));
    await clicar(botao(cartao(tela), "Salvar"));
    await ate(() => expect(alerta(tela)?.textContent).toBe("Erro 502 ao falar com o servidor."));

    // A ação seguinte que dá certo limpa a faixa.
    await preencher(selectStatus(cartao(tela)), "LOST");
    await ate(() => expect(coluna(tela, "LOST").contains(cartao(tela))).toBe(true));
    expect(alerta(tela)).toBeNull();
  });

  it("falha ao buscar os clientes aparece na tela", async () => {
    const { tela } = await abrir([lead()], { "GET /api/clientes": [{ status: 403, body: { error: "Acesso negado" } }] });

    await clicar(botao(cartao(tela), "Converter em coleta"));
    await ate(() => expect(alerta(tela)?.textContent).toBe("Acesso negado"));
  });

  it.each([
    ["recusa do servidor com motivo", { status: 403, body: { error: "Acesso negado" } } as Resposta, "Acesso negado"],
    ["erro do servidor sem motivo", { status: 500, body: {} } as Resposta, "Erro 500 ao falar com o servidor."],
    ["resposta 200 que não é lista", { body: { leads: [] } } as Resposta, "Não foi possível carregar as cotações."],
    ["falha de rede", new TypeError("Failed to fetch") as Resposta, "Não foi possível falar com o servidor. Tente de novo."],
  ])("falha ao carregar (%s): mostra a mensagem, mantém Atualizar Lista e recarrega por ele", async (_caso, resposta, mensagem) => {
    const pedidos = api({ [LISTA]: [resposta, { body: [lead()] }], [EQUIPE]: [{ body: PESSOAS }] });
    const tela = await montar(<CRMPage />);

    await ate(() => expect(alerta(tela)?.textContent).toBe(mensagem));
    expect(tela.querySelector("[data-lead]")).toBeNull();

    await clicar(botao(tela, "Atualizar Lista"));
    await ate(() => expect(cartao(tela)).not.toBeNull());
    expect(alerta(tela)).toBeNull();
    // A lista duas vezes (a que falhou e a do botão) e a equipe uma.
    expect(pedidos.filter((p) => p.caminho === "/api/dashboard/crm")).toHaveLength(2);
    expect(pedidos).toHaveLength(3);
  });

  it("celular: as abas mostram a contagem de cada etapa e trocam a coluna à mostra", async () => {
    const { tela } = await abrir([lead()]);

    const aba = (status: string) => tela.querySelector<HTMLElement>(`[data-aba="${status}"]`)!;
    const escondida = (status: string) => tela.querySelector(`[data-coluna="${status}"]`)!.className.includes("hidden md:block");

    expect(aba("NEW").textContent).toBe("Novos1");
    expect(aba("LOST").textContent).toBe("Perdidos0");
    expect(aba("NEW").getAttribute("aria-selected")).toBe("true");
    expect(escondida("NEW")).toBe(false);
    expect(escondida("LOST")).toBe(true);

    await clicar(aba("LOST"));
    expect(aba("LOST").getAttribute("aria-selected")).toBe("true");
    expect(aba("NEW").getAttribute("aria-selected")).toBe("false");
    expect(escondida("LOST")).toBe(false);
    expect(escondida("NEW")).toBe(true);
  });

  it("cartão: número, canal, selo de parada, responsável e motivo da perda; convertido mostra só texto", async () => {
    const { tela, pedidos } = await abrir(
      [
        lead({ channel: "WHATSAPP", status: "CONTACTED", lastActivityAt: haDias(3), assignee: { id: "u-rafa", name: "Rafael" } }),
        lead({ id: "lead-2", number: 7, status: "LOST", lostReason: "PRECO", lastActivityAt: haDias(9) }),
        lead({ id: "lead-3", number: null, status: "CONVERTED", assignee: { id: "u-x", name: "Quem Saiu" }, collection: { id: "c-1", trackingCode: "9184726350", status: "CONFIRMED" } }),
      ],
      {
        "PATCH /api/dashboard/crm/lead-1": [{ body: lead({ status: "CONTACTED", assignee: { id: "u-ana", name: "Ana Paula" } }) }],
        "PATCH /api/dashboard/crm/lead-2": [{ body: lead({ id: "lead-2", status: "LOST", lostReason: "PRAZO" }) }],
      },
    );

    const aberto = cartao(tela);
    expect(aberto.textContent).toContain("nº 1494");
    expect(aberto.textContent).toContain("WhatsApp");
    expect(aberto.querySelector("[data-parada]")!.textContent).toBe("parada há 3 dias");
    const responsavel = aberto.querySelector<HTMLSelectElement>('select[aria-label="Responsável"]')!;
    expect(responsavel.value).toBe("u-rafa");
    expect([...responsavel.options].map((o) => o.textContent)).toEqual(["Sem responsável", "Ana Paula", "Rafael"]);
    expect(aberto.querySelector('select[aria-label="Motivo da perda"]')).toBeNull();

    await preencher(responsavel, "u-ana");
    expect(pedidos.at(-1)).toEqual({ metodo: "PATCH", caminho: "/api/dashboard/crm/lead-1", corpo: { assigneeId: "u-ana" } });
    await ate(() => expect(cartao(tela).querySelector<HTMLSelectElement>('select[aria-label="Responsável"]')!.value).toBe("u-ana"));
    // Responder renovou a atividade: o selo some.
    expect(cartao(tela).querySelector("[data-parada]")).toBeNull();

    const perdido = cartao(tela, "lead-2");
    expect(perdido.querySelector("[data-parada]")).toBeNull();
    expect(perdido.textContent).toContain("Perdida: Preço acima do concorrente");
    const motivo = perdido.querySelector<HTMLSelectElement>('select[aria-label="Motivo da perda"]')!;
    expect(motivo.value).toBe("PRECO");
    expect([...motivo.options].map((o) => o.getAttribute("value"))).toEqual(["", "PRECO", "PRAZO", "DESISTIU", "SEM_RETORNO", "OUTRA_TRANSPORTADORA", "OUTRO"]);
    await preencher(motivo, "PRAZO");
    expect(pedidos.at(-1)!.corpo).toEqual({ lostReason: "PRAZO" });
    await ate(() => expect(cartao(tela, "lead-2").textContent).toContain("Perdida: Prazo de entrega"));
    // Perdida não tem Registrar contato nem Converter.
    expect(botao(cartao(tela, "lead-2"), "Registrar contato")).toBeUndefined();

    const convertido = cartao(tela, "lead-3");
    expect(convertido.textContent).not.toContain("nº");
    expect(convertido.textContent).toContain("Responsável: Quem Saiu");
    expect(convertido.querySelectorAll("button, select")).toHaveLength(0);
  });

  it("Registrar contato manda só `contato: true` e atualiza o cartão com a resposta", async () => {
    const { tela, pedidos } = await abrir([lead({ lastActivityAt: haDias(4) })], {
      "PATCH /api/dashboard/crm/lead-1": [{ body: lead({ lastActivityAt: new Date().toISOString() }) }],
    });
    expect(cartao(tela).querySelector("[data-parada]")!.textContent).toBe("parada há 4 dias");

    await clicar(botao(cartao(tela), "Registrar contato"));
    expect(pedidos.at(-1)).toEqual({ metodo: "PATCH", caminho: "/api/dashboard/crm/lead-1", corpo: { contato: true } });
    await ate(() => expect(cartao(tela).querySelector("[data-parada]")).toBeNull());
  });

  it("resumo do topo: cotações, conversão, fechado × cotado e paradas, do que está na tela", async () => {
    const { tela } = await abrir([
      lead({ estimatedValue: 100, lastActivityAt: haDias(3) }),
      lead({ id: "lead-2", status: "CONVERTED", estimatedValue: 300, collection: null }),
      lead({ id: "lead-3", status: "LOST", estimatedValue: 50 }),
      lead({ id: "lead-4", status: "CONTACTED", estimatedValue: null }),
    ]);

    const resumo = semNbsp(tela.querySelector("[data-resumo]")!.textContent);
    expect(resumo).toContain("Cotações4");
    expect(resumo).toContain("2 em aberto");
    expect(resumo).toContain("Conversão50%");
    expect(resumo).toContain("1 de 2 decididas");
    expect(resumo).toContain("Fechado × cotadoR$ 300,00");
    expect(resumo).toContain("de R$ 450,00 cotados");
    expect(resumo).toContain("Paradas1");
  });

  it("filtros vão para a rota como query; o cartão de paradas liga e desliga o filtro; sem filtro a URL é a de sempre", async () => {
    const { tela, pedidos } = await abrir([lead()], {
      "GET /api/dashboard/crm?status=parada": [{ body: [] }],
      "GET /api/dashboard/crm?status=LOST": [{ body: [] }],
      "GET /api/dashboard/crm?status=LOST&dias=30": [{ body: [] }],
      "GET /api/dashboard/crm?status=LOST&dias=30&assigneeId=ninguem": [{ body: [] }],
      "GET /api/dashboard/crm?status=LOST&dias=30&assigneeId=ninguem&busca=Mirassol": [{ body: [] }],
    });

    await clicar(tela.querySelector("[data-paradas]")!);
    await ate(() => expect(pedidos.at(-1)!.caminho).toBe("/api/dashboard/crm?status=parada"));
    expect(tela.querySelector<HTMLSelectElement>('select[aria-label="Etapa"]')!.value).toBe("parada");
    await ate(() => expect(tela.querySelector("[data-lead]")).toBeNull());

    await clicar(tela.querySelector("[data-paradas]")!);
    await ate(() => expect(pedidos.at(-1)!.caminho).toBe("/api/dashboard/crm"));
    await ate(() => expect(cartao(tela)).not.toBeNull());

    await preencher(tela.querySelector<HTMLSelectElement>('select[aria-label="Etapa"]')!, "LOST");
    await ate(() => expect(pedidos.at(-1)!.caminho).toBe("/api/dashboard/crm?status=LOST"));
    await preencher(tela.querySelector<HTMLSelectElement>('select[aria-label="Período"]')!, "30");
    await ate(() => expect(pedidos.at(-1)!.caminho).toBe("/api/dashboard/crm?status=LOST&dias=30"));
    const porResponsavel = tela.querySelector<HTMLSelectElement>('select[aria-label="Filtrar por responsável"]')!;
    expect([...porResponsavel.options].map((o) => o.textContent)).toEqual(["Qualquer responsável", "Sem responsável", "Ana Paula", "Rafael"]);
    await preencher(porResponsavel, "ninguem");
    await ate(() => expect(pedidos.at(-1)!.caminho).toBe("/api/dashboard/crm?status=LOST&dias=30&assigneeId=ninguem"));
    await preencher(tela.querySelector<HTMLInputElement>('input[aria-label="Buscar cotação"]')!, "Mirassol");
    await ate(() => expect(pedidos.at(-1)!.caminho).toBe("/api/dashboard/crm?status=LOST&dias=30&assigneeId=ninguem&busca=Mirassol"));
  });

  it("a lista mostra a mesma coleção em tabela, com os mesmos controles, e Converter volta ao funil com o formulário aberto", async () => {
    const { tela, pedidos } = await abrir(
      [lead({ assignee: { id: "u-ana", name: "Ana Paula" }, lastActivityAt: haDias(2) }), lead({ id: "lead-2", status: "CONVERTED", collection: { id: "c-1", trackingCode: "9184726350", status: "CONFIRMED" } })],
      { "GET /api/clientes": [{ body: CLIENTES }], "PATCH /api/dashboard/crm/lead-1": [{ body: lead({ status: "CONTACTED" }) }] },
    );

    await clicar(tela.querySelector('[data-visao="lista"]')!);
    expect(tela.querySelector("[data-coluna]")).toBeNull();
    const linhas = [...tela.querySelectorAll("[data-linha]")];
    expect(linhas.map((l) => l.getAttribute("data-linha"))).toEqual(["lead-1", "lead-2"]);
    const aberta = linhas[0] as HTMLElement;
    expect(aberta.textContent).toContain("1494");
    expect(aberta.textContent).toContain("São José do Rio Preto ➔ Mirassol");
    expect(aberta.textContent).toContain("3 vol · 120.5 kg");
    expect(semNbsp(aberta.textContent)).toContain("R$ 150,00");
    expect(aberta.querySelector("[data-parada]")!.textContent).toBe("parada há 2 dias");
    expect(aberta.querySelector<HTMLSelectElement>('select[aria-label="Responsável"]')!.value).toBe("u-ana");
    expect(botao(aberta, "Preparar proposta")).toBeDefined();

    const convertida = linhas[1] as HTMLElement;
    expect(convertida.textContent).toContain("9184726350");
    expect(convertida.querySelectorAll("button, select")).toHaveLength(0);

    await preencher(selectStatus(aberta), "CONTACTED");
    expect(pedidos.at(-1)).toEqual({ metodo: "PATCH", caminho: "/api/dashboard/crm/lead-1", corpo: { status: "CONTACTED" } });

    await clicar(botao(tela.querySelector("[data-linha='lead-1']")!, "Converter em coleta"));
    await ate(() => expect(cartao(tela).querySelector("form")).not.toBeNull());
    expect(tela.querySelector("[data-lista]")).toBeNull();
    expect(tela.querySelector('[data-visao="funil"]')!.getAttribute("aria-pressed")).toBe("true");
  });

  it("registrar cotação: manda o que foi digitado, sem responsável quando é quem registra, e põe a nova em Novos", async () => {
    const nova = lead({ id: "lead-novo", number: 1495, companyName: "Autopeças Rota 376", channel: "WHATSAPP", estimatedValue: null });
    const { tela, pedidos } = await abrir([lead()], { "POST /api/dashboard/crm": [{ status: 400, body: { error: "Informe o telefone ou o e-mail do cliente." } }, { status: 201, body: nova }] });

    expect(tela.querySelector('form[aria-label="Registrar cotação"]')).toBeNull();
    await clicar(botao(tela, "Registrar cotação"));
    const form = tela.querySelector<HTMLFormElement>('form[aria-label="Registrar cotação"]')!;
    expect([...form.querySelectorAll("input, select")].map((c) => c.getAttribute("name"))).toEqual([
      "companyName", "phone", "email", "channel", "origin", "destination", "volumes", "weight", "invoiceValue", "assigneeId",
    ]);
    expect([...form.querySelector<HTMLSelectElement>('select[name="channel"]')!.options].map((o) => o.textContent)).toEqual(["WhatsApp", "Telefone", "E-mail"]);
    expect([...form.querySelector<HTMLSelectElement>('select[name="assigneeId"]')!.options].map((o) => o.textContent)).toEqual(["Quem registra", "Sem responsável", "Ana Paula", "Rafael"]);

    await preencher(form.querySelector<HTMLInputElement>('input[name="companyName"]')!, "Autopeças Rota 376");
    await preencher(form.querySelector<HTMLInputElement>('input[name="origin"]')!, "Maringá");
    await preencher(form.querySelector<HTMLInputElement>('input[name="destination"]')!, "Mirassol");
    await preencher(form.querySelector<HTMLInputElement>('input[name="weight"]')!, "88,5");
    await act(async () => {
      form.requestSubmit();
    });
    // A recusa aparece dentro do formulário, que fica aberto para corrigir.
    await ate(() => expect(form.querySelector('[role="alert"]')?.textContent).toBe("Informe o telefone ou o e-mail do cliente."));
    expect(pedidos.at(-1)).toEqual({
      metodo: "POST",
      caminho: "/api/dashboard/crm",
      corpo: { companyName: "Autopeças Rota 376", phone: "", email: "", channel: "WHATSAPP", origin: "Maringá", destination: "Mirassol", volumes: "1", weight: "88,5", invoiceValue: "" },
    });

    await preencher(form.querySelector<HTMLInputElement>('input[name="phone"]')!, "44999990000");
    await preencher(form.querySelector<HTMLSelectElement>('select[name="assigneeId"]')!, "ninguem");
    await act(async () => {
      form.requestSubmit();
    });
    await ate(() => expect(cartao(tela, "lead-novo")).not.toBeNull());
    expect(pedidos.at(-1)!.corpo).toMatchObject({ phone: "44999990000", assigneeId: null });
    expect(tela.querySelector('form[aria-label="Registrar cotação"]')).toBeNull();
    expect(coluna(tela, "NEW").querySelectorAll("[data-lead]")).toHaveLength(2);
    expect(coluna(tela, "NEW").querySelector("[data-lead]")!.getAttribute("data-lead")).toBe("lead-novo");
    expect(cartao(tela, "lead-novo").textContent).toContain("nº 1495");
  });
});
