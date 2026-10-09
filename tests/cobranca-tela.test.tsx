// @vitest-environment jsdom
import { Suspense } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ate, clicar, desmontarTudo, montar, porTexto } from "./tela";
import { formatCurrency } from "../src/lib/format";

/**
 * Telas da cobrança (`/dashboard/cobranca`) e do recibo
 * (`/dashboard/financeiro/recibo/[id]`), e os links que levam ao recibo. As
 * contas e as rotas são testadas em `tests/cobranca.test.ts`; aqui se confere
 * o que cada tela mostra com cada resposta.
 */

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

import CobrancaPage from "../src/app/dashboard/cobranca/page";
import ReciboPage from "../src/app/dashboard/financeiro/recibo/[id]/page";
import FinanceiroPage from "../src/app/dashboard/financeiro/page";
import FaturaPage from "../src/app/dashboard/faturamento/[id]/page";

type Resposta = { status?: number; body: unknown } | Error;

/** Cada caminho recebe a próxima resposta da fila que o teste montou (a última se repete). */
function api(respostas: Record<string, Resposta[]>) {
  const pedidos: { metodo: string; caminho: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const caminho = String(url);
      pedidos.push({ metodo: init?.method ?? "GET", caminho });
      const fila = respostas[caminho];
      const resposta = fila?.length === 1 ? fila[0] : fila?.shift();
      if (!resposta) throw new Error(`Chamada inesperada: ${caminho}`);
      if (resposta instanceof Error) throw resposta;
      return new Response(typeof resposta.body === "string" ? resposta.body : JSON.stringify(resposta.body), {
        status: resposta.status ?? 200,
      });
    }),
  );
  return pedidos;
}

const COBRANCA = "/api/financeiro/cobranca";
const SEM_FAIXA = { a_vencer: 0, ate_30: 0, de_31_a_60: 0, de_61_a_90: 0, acima_de_90: 0 };

const POSICAO = {
  hoje: "2026-10-15",
  empresa: { name: "Mello Transportes" },
  totais: {
    emAberto: 2084.56,
    vencido: 1314.56,
    aVencer: 770,
    porFaixa: { a_vencer: 770, ate_30: 80, de_31_a_60: 1234.56, de_61_a_90: 0, acima_de_90: 0 },
    devedoresEmAtraso: 1,
  },
  devedores: [
    {
      chave: "cliente:cli-1",
      clientId: "cli-1",
      nome: "Serilon",
      contato: { nome: "Marta", email: "fin@serilon.br", telefone: "1733330000" },
      total: 1634.56,
      vencido: 1314.56,
      maiorAtraso: 40,
      porFaixa: { ...SEM_FAIXA, a_vencer: 320, ate_30: 80, de_31_a_60: 1234.56 },
      titulos: [
        {
          id: "t-1",
          description: "Fatura nº 12 (3 cargas)",
          amount: 1234.56,
          dueDate: "2026-09-05T00:00:00.000Z",
          diasDeAtraso: 40,
          faixa: "de_31_a_60",
          invoice: { id: "fat-12", number: 12 },
        },
        { id: "t-2", description: "Frete avulso", amount: 80, dueDate: "2026-10-14T00:00:00.000Z", diasDeAtraso: 1, faixa: "ate_30", invoice: null },
        // Meia-noite UTC do dia 1º: no fuso do Brasil seria 31/10.
        { id: "t-3", description: "Frete de novembro", amount: 300, dueDate: "2026-11-01T00:00:00.000Z", diasDeAtraso: 0, faixa: "a_vencer", invoice: null },
        { id: "t-4", description: "Acerto", amount: 20, dueDate: null, diasDeAtraso: 0, faixa: "a_vencer", invoice: null },
      ],
    },
    {
      chave: "pagador:posto avenida",
      clientId: null,
      nome: "Posto Avenida",
      contato: { nome: null, email: null, telefone: null },
      total: 450,
      vencido: 0,
      maiorAtraso: 0,
      porFaixa: { ...SEM_FAIXA, a_vencer: 450 },
      titulos: [{ id: "t-5", description: "Frete de outubro", amount: 450, dueDate: "2026-10-20T00:00:00.000Z", diasDeAtraso: 0, faixa: "a_vencer", invoice: null }],
    },
  ],
};

const VAZIA = {
  hoje: "2026-10-15",
  empresa: { name: "Mello Transportes" },
  totais: { emAberto: 0, vencido: 0, aVencer: 0, porFaixa: SEM_FAIXA, devedoresEmAtraso: 0 },
  devedores: [],
};

const botao = (onde: ParentNode, texto: string) => porTexto(onde, "button", texto)[0];
const cartao = (tela: HTMLElement, rotulo: string) => tela.querySelector<HTMLElement>(`[data-cartao="${rotulo}"]`);
const linha = (tela: HTMLElement, chave: string) => tela.querySelector<HTMLElement>(`[data-devedor="${chave}"]`)!;
const carregando = (tela: HTMLElement) => tela.querySelector('[aria-label="Carregando"]');

/** Põe um `navigator.clipboard` de mentira; o jsdom não tem um. */
function areaDeTransferencia(writeText: (texto: string) => Promise<void>) {
  const espia = vi.fn(writeText);
  Object.defineProperty(navigator, "clipboard", { value: { writeText: espia }, configurable: true });
  return espia;
}

async function abrirCobranca(respostas: Resposta[]) {
  const pedidos = api({ [COBRANCA]: respostas });
  const tela = await montar(<CobrancaPage />);
  await ate(() => expect(carregando(tela)).toBeNull());
  return { tela, pedidos };
}

afterEach(async () => {
  await desmontarTudo();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "clipboard");
});

describe("tela da cobrança", () => {
  it("403 mostra o aviso de acesso, sem cartão nem lista zerada", async () => {
    const { tela } = await abrirCobranca([{ status: 403, body: { error: "Acesso negado" } }]);

    expect(tela.textContent).toContain("Acesso negado");
    expect(tela.textContent).toContain("restrita ao perfil Administrador");
    expect(tela.querySelectorAll("[data-cartao]")).toHaveLength(0);
    expect(tela.querySelector("table")).toBeNull();
    expect(tela.textContent).not.toContain("Nenhum valor a receber em aberto.");
    expect(tela.textContent).not.toContain("R$");
  });

  it("401 pede novo login, sem cartão e sem dizer que o perfil é restrito", async () => {
    const { tela } = await abrirCobranca([{ status: 401, body: { error: "Não autorizado" } }]);

    expect(tela.textContent).toContain("Sessão expirada");
    expect(tela.querySelector('a[href="/login"]')).not.toBeNull();
    expect(tela.textContent).not.toContain("Administrador");
    expect(tela.querySelectorAll("[data-cartao]")).toHaveLength(0);
  });

  it("cartões com os quatro totais e uma linha com o total de cada faixa", async () => {
    const { tela } = await abrirCobranca([{ body: POSICAO }]);

    expect([...tela.querySelectorAll("[data-cartao]")].map((c) => c.getAttribute("data-cartao"))).toEqual([
      "Em aberto",
      "Vencido",
      "A vencer",
      "Clientes em atraso",
    ]);
    expect(cartao(tela, "Em aberto")!.textContent).toContain(formatCurrency(2084.56));
    expect(cartao(tela, "Vencido")!.textContent).toContain(formatCurrency(1314.56));
    expect(cartao(tela, "A vencer")!.textContent).toContain(formatCurrency(770));
    expect(cartao(tela, "Clientes em atraso")!.textContent).toBe("Clientes em atraso1");

    expect([...tela.querySelectorAll("[data-faixa]")].map((f) => f.textContent)).toEqual([
      `A vencer${formatCurrency(770)}`,
      `1 a 30 dias${formatCurrency(80)}`,
      `31 a 60 dias${formatCurrency(1234.56)}`,
      `61 a 90 dias${formatCurrency(0)}`,
      `Mais de 90 dias${formatCurrency(0)}`,
    ]);
  });

  it("lista os devedores na ordem da API, com total, vencido e maior atraso", async () => {
    const { tela } = await abrirCobranca([{ body: POSICAO }]);

    const linhas = [...tela.querySelectorAll<HTMLElement>("[data-devedor]")];
    expect(linhas.map((l) => l.getAttribute("data-devedor"))).toEqual(["cliente:cli-1", "pagador:posto avenida"]);
    expect([...linhas[0].querySelectorAll("td")].slice(0, 4).map((td) => td.textContent)).toEqual([
      "Serilon4 títulos",
      formatCurrency(1634.56),
      formatCurrency(1314.56),
      "40 dias",
    ]);
    expect([...linhas[1].querySelectorAll("td")].slice(0, 4).map((td) => td.textContent)).toEqual([
      "Posto Avenida1 título",
      formatCurrency(450),
      formatCurrency(0),
      "-",
    ]);
    // Fechado, o devedor não mostra os títulos.
    expect(tela.querySelector("[data-titulo]")).toBeNull();
  });

  it("abrir o devedor mostra os títulos: vencimento do calendário, atraso, valor e link da fatura", async () => {
    const { tela } = await abrirCobranca([{ body: POSICAO }]);

    await clicar(botao(linha(tela, "cliente:cli-1"), "Serilon"));
    const titulos = [...tela.querySelectorAll<HTMLElement>("[data-titulo]")];
    expect(titulos.map((t) => [...t.querySelectorAll("td")].map((td) => td.textContent))).toEqual([
      ["Fatura nº 12 (3 cargas)ver fatura", "05/09/2026", "40 dias", formatCurrency(1234.56)],
      ["Frete avulso", "14/10/2026", "1 dia", formatCurrency(80)],
      ["Frete de novembro", "01/11/2026", "a vencer", formatCurrency(300)],
      ["Acerto", "-", "sem vencimento", formatCurrency(20)],
    ]);
    expect([...tela.querySelectorAll("[data-titulo] a")].map((a) => a.getAttribute("href"))).toEqual(["/dashboard/faturamento/fat-12"]);

    // Só os títulos do devedor aberto; abrir de novo fecha.
    expect(tela.textContent).not.toContain("Frete de outubro");
    await clicar(botao(linha(tela, "cliente:cli-1"), "Serilon"));
    expect(tela.querySelector("[data-titulo]")).toBeNull();
  });

  it("Aviso de cobrança mostra o texto pronto, só para leitura, e Copiar manda esse texto para a área de transferência", async () => {
    const copiado = areaDeTransferencia(async () => undefined);
    const { tela, pedidos } = await abrirCobranca([{ body: POSICAO }]);

    expect(tela.querySelector("textarea")).toBeNull();
    await clicar(botao(linha(tela, "cliente:cli-1"), "Aviso de cobrança"));

    const area = tela.querySelector<HTMLTextAreaElement>("textarea")!;
    expect(area.readOnly).toBe(true);
    expect(area.value.split("\n")).toEqual([
      "Olá, Marta.",
      "",
      "Identificamos pagamento em atraso em nome de Serilon. Constam em aberto os títulos abaixo. Pedimos a regularização ou, se o pagamento já foi feito, o envio do comprovante.",
      "",
      "- Fatura nº 12 (3 cargas) | vencimento 05/09/2026 | R$ 1.234,56 | vencido há 40 dias",
      "- Frete avulso | vencimento 14/10/2026 | R$ 80,00 | vencido há 1 dia",
      "- Frete de novembro | vencimento 01/11/2026 | R$ 300,00",
      "- Acerto | sem vencimento definido | R$ 20,00",
      "",
      "Total em aberto: R$ 1.634,56",
      "",
      "Atenciosamente,",
      "Mello Transportes",
    ]);

    await clicar(botao(tela, "Copiar"));
    await ate(() => expect(tela.querySelector('[role="status"]')?.textContent).toBe("Aviso copiado."));
    expect(copiado).toHaveBeenCalledTimes(1);
    expect(copiado).toHaveBeenCalledWith(area.value);

    // A tela não envia nada: a única chamada ao servidor foi a leitura da posição.
    expect(pedidos).toEqual([{ metodo: "GET", caminho: COBRANCA }]);
  });

  it("o aviso de quem não tem nada vencido é um lembrete", async () => {
    areaDeTransferencia(async () => undefined);
    const { tela } = await abrirCobranca([{ body: POSICAO }]);

    await clicar(botao(linha(tela, "pagador:posto avenida"), "Aviso de cobrança"));
    const texto = tela.querySelector<HTMLTextAreaElement>("textarea")!.value;
    expect(texto).toContain("Olá, Posto Avenida.");
    expect(texto).toContain("lembrete de vencimento");
    expect(texto).not.toContain("atraso");
  });

  it.each([
    ["a cópia é recusada", () => areaDeTransferencia(async () => Promise.reject(new Error("NotAllowedError")))],
    ["o navegador não tem área de transferência", () => undefined],
  ])("quando %s, o texto continua na tela e aparece como copiar à mão", async (_caso, preparar) => {
    preparar();
    const { tela } = await abrirCobranca([{ body: POSICAO }]);

    await clicar(botao(linha(tela, "cliente:cli-1"), "Aviso de cobrança"));
    await clicar(botao(tela, "Copiar"));

    await ate(() =>
      expect(tela.querySelector('[role="status"]')?.textContent).toBe("Não foi possível copiar. Selecione o texto e copie."),
    );
    expect(tela.querySelector<HTMLTextAreaElement>("textarea")!.value).toContain("Total em aberto: R$ 1.634,56");
    expect(tela.textContent).not.toContain("Aviso copiado.");
  });

  it("sem devedor: cartões zerados e a frase de que não há nada em aberto", async () => {
    const { tela } = await abrirCobranca([{ body: VAZIA }]);

    expect(tela.textContent).toContain("Nenhum valor a receber em aberto.");
    expect(cartao(tela, "Em aberto")!.textContent).toContain(formatCurrency(0));
    expect(tela.querySelector("[data-devedor]")).toBeNull();
    expect(tela.querySelector('[role="alert"]')).toBeNull();
  });

  it.each([
    ["erro com motivo no corpo", { status: 500, body: { error: "Internal Server Error" } } as Resposta, "Internal Server Error"],
    ["página no lugar do JSON", { status: 502, body: "<html>" } as Resposta, "Não foi possível carregar a cobrança."],
    ["falha de rede", new TypeError("Failed to fetch") as Resposta, "Não foi possível carregar a cobrança."],
  ])("falha ao carregar (%s): faixa vermelha com a mensagem, e Tentar de novo recarrega", async (_caso, falha, mensagem) => {
    const { tela, pedidos } = await abrirCobranca([falha, { body: POSICAO }]);

    const alerta = tela.querySelector<HTMLElement>('[role="alert"]')!;
    expect(alerta.textContent).toContain(mensagem);
    expect(alerta.className).toContain("text-red-700");
    // Falha não é lista vazia nem acesso negado.
    expect(tela.querySelectorAll("[data-cartao]")).toHaveLength(0);
    expect(tela.textContent).not.toContain("Nenhum valor a receber em aberto.");
    expect(tela.textContent).not.toContain("Acesso negado");

    await clicar(botao(alerta, "Tentar de novo"));
    await ate(() => expect(tela.querySelector("[data-devedor]")).not.toBeNull());
    expect(tela.querySelector('[role="alert"]')).toBeNull();
    expect(pedidos).toHaveLength(2);
  });

  it("não tem botão de baixa: pagar fica no Faturamento e no Financeiro", async () => {
    const { tela } = await abrirCobranca([{ body: POSICAO }]);
    await clicar(botao(linha(tela, "cliente:cli-1"), "Serilon"));

    expect([...tela.querySelectorAll("button")].map((b) => b.textContent)).toEqual([
      "Serilon",
      "Aviso de cobrança",
      "Posto Avenida",
      "Aviso de cobrança",
    ]);
  });
});

const RECIBO = {
  id: "t-1",
  amount: 1234.56,
  description: "Frete de outubro",
  // 02:00 UTC do dia 13 ainda é dia 12 em Brasília.
  paidAt: "2026-10-13T02:00:00.000Z",
  paymentMethod: "TRANSFERENCIA",
  dueDate: "2026-10-10T00:00:00.000Z",
  invoice: null,
  pagador: { nome: "Serilon Brasil Ltda", cnpj: "12345678000190" },
  empresa: { name: "Mello Transportes", cnpj: "98765432000110" },
};

async function abrirRecibo(resposta: Resposta, id = "t-1") {
  api({ [`/api/financeiro/${id}/recibo`]: [resposta] });
  const params = Promise.resolve({ id });
  const tela = await montar(
    <Suspense fallback="carregando">
      <ReciboPage params={params} />
    </Suspense>,
  );
  await ate(() => {
    expect(tela.textContent).not.toBe("carregando");
    expect(carregando(tela)).toBeNull();
  });
  return tela;
}

const campo = (tela: HTMLElement, nome: string) => tela.querySelector<HTMLElement>(`[data-campo="${nome}"]`);

describe("tela do recibo", () => {
  it("mostra empresa e pagador com CNPJ formatado, valor, referência, data do Brasil e forma de pagamento", async () => {
    const tela = await abrirRecibo({ body: RECIBO });

    expect(tela.querySelector("h1")!.textContent).toBe("Recibo");
    expect(campo(tela, "empresa")!.textContent).toBe("RecebedorMello Transportes98.765.432/0001-10");
    expect(campo(tela, "pagador")!.textContent).toBe("Recebido deSerilon Brasil Ltda12.345.678/0001-90");
    expect(campo(tela, "valor")!.textContent).toBe(formatCurrency(1234.56));
    expect(campo(tela, "referente")!.textContent).toBe("Referente aFrete de outubro");
    expect(campo(tela, "recebimento")!.textContent).toBe("Data do recebimento12/10/2026");
    expect(campo(tela, "forma")!.textContent).toBe("Forma de pagamentoTransferência");
  });

  it("recibo de fatura cita o número; sem CNPJ e sem forma de pagamento, as linhas somem", async () => {
    const tela = await abrirRecibo({
      body: {
        ...RECIBO,
        description: "Acerto de frete",
        invoice: { id: "fat-12", number: 12 },
        paymentMethod: null,
        pagador: { nome: "Posto Avenida", cnpj: null },
        empresa: { name: "Mello Transportes", cnpj: null },
      },
    });

    expect(campo(tela, "referente")!.textContent).toBe("Referente aAcerto de frete (fatura nº 12)");
    expect(campo(tela, "pagador")!.textContent).toBe("Recebido dePosto Avenida");
    expect(campo(tela, "empresa")!.textContent).toBe("RecebedorMello Transportes");
    expect(campo(tela, "forma")).toBeNull();
  });

  it("descrição que já traz o número da fatura não o repete", async () => {
    const tela = await abrirRecibo({ body: { ...RECIBO, description: "Fatura nº 12 (3 cargas)", invoice: { id: "fat-12", number: 12 } } });
    expect(campo(tela, "referente")!.textContent).toBe("Referente aFatura nº 12 (3 cargas)");
  });

  it("Imprimir chama a impressão do navegador, e o que não é do recibo fica fora do papel", async () => {
    const imprimir = vi.fn();
    vi.stubGlobal("print", imprimir);
    const tela = await abrirRecibo({ body: RECIBO });

    const imprimirBotao = botao(tela, "Imprimir ou salvar em PDF");
    await clicar(imprimirBotao);
    expect(imprimir).toHaveBeenCalledTimes(1);

    const barra = imprimirBotao.closest(".print\\:hidden")!;
    expect(barra).not.toBeNull();
    expect(barra.querySelector('a[href="/dashboard/financeiro"]')).not.toBeNull();
    expect(tela.querySelector("h1")!.closest(".print\\:hidden")).toBeNull();
  });

  it.each([
    [404, "Lançamento não encontrado."],
    [409, "Só há recibo de valor já recebido."],
  ])("%i mostra a mensagem do corpo com o link de volta para o Financeiro", async (status, mensagem) => {
    const tela = await abrirRecibo({ status, body: { error: mensagem } });

    expect(tela.querySelector('[role="alert"] h1')!.textContent).toBe(mensagem);
    expect(tela.querySelector('[role="alert"] a')!.getAttribute("href")).toBe("/dashboard/financeiro");
    expect(campo(tela, "valor")).toBeNull();
    expect(porTexto(tela, "button", "Imprimir")).toHaveLength(0);
  });

  it("401 pede novo login e 403 avisa que o perfil não tem acesso, sem recibo", async () => {
    const semSessao = await abrirRecibo({ status: 401, body: { error: "Não autorizado" } });
    expect(semSessao.textContent).toContain("Sessão expirada");
    expect(semSessao.querySelector('a[href="/login"]')).not.toBeNull();
    expect(campo(semSessao, "valor")).toBeNull();

    const semPerfil = await abrirRecibo({ status: 403, body: { error: "Acesso negado" } });
    expect(semPerfil.textContent).toContain("Acesso negado");
    expect(semPerfil.textContent).toContain("restrito ao perfil Administrador");
    expect(campo(semPerfil, "valor")).toBeNull();
  });
});

describe("entradas para o recibo", () => {
  const lancamento = (extra: Record<string, unknown>) => ({
    id: "l-1",
    type: "INCOME",
    amount: 100,
    description: "Lançamento",
    dueDate: null,
    status: "PENDING",
    paidAt: null,
    paymentMethod: null,
    category: null,
    counterparty: null,
    notes: null,
    clientId: null,
    client: null,
    invoice: null,
    ...extra,
  });
  const PAGO = { status: "PAID", paidAt: "2026-10-12T15:00:00.000Z" };

  async function abrirFinanceiro(lancamentos: unknown[]) {
    api({
      "/api/financeiro": [{ body: lancamentos }],
      "/api/financeiro/fluxo": [{ body: { fluxo: [] } }],
      "/api/clientes": [{ body: [] }],
    });
    const tela = await montar(<FinanceiroPage />);
    await ate(() => expect(tela.querySelector('[role="tablist"]')).not.toBeNull());
    return tela;
  }

  const recibos = (tela: HTMLElement) => porTexto(tela, "a", "Recibo").map((a) => a.getAttribute("href"));

  it("no Financeiro, só a receita paga tem o link Recibo, manual ou de fatura", async () => {
    const tela = await abrirFinanceiro([
      lancamento({ id: "receita-paga", description: "Receita paga", ...PAGO }),
      lancamento({ id: "de-fatura-paga", description: "Fatura nº 7 (1 carga)", ...PAGO, invoice: { id: "fat-7", number: 7 } }),
      lancamento({ id: "receita-aberta", description: "Receita em aberto" }),
      lancamento({ id: "despesa-paga", description: "Despesa paga", type: "EXPENSE", ...PAGO }),
    ]);

    // Aba "A receber".
    expect(tela.textContent).toContain("Receita em aberto");
    expect(recibos(tela)).toEqual(["/dashboard/financeiro/recibo/receita-paga", "/dashboard/financeiro/recibo/de-fatura-paga"]);

    // Aba "A pagar": despesa paga não tem recibo.
    await clicar(porTexto(tela, '[role="tab"]', "A pagar")[0]);
    expect(tela.textContent).toContain("Despesa paga");
    expect(recibos(tela)).toEqual([]);
  });

  const fatura = (extra: Record<string, unknown>) => ({
    number: 12,
    status: "OPEN",
    total: 300,
    dueDate: "2026-11-10T00:00:00.000Z",
    issuedAt: "2026-10-01T12:00:00.000Z",
    paidAt: null,
    notes: null,
    client: { companyName: "Serilon Brasil Ltda", tradeName: "Serilon", cnpj: "12345678000190" },
    transaction: { id: "t-12" },
    collections: [],
    ...extra,
  });

  async function abrirFatura(corpo: unknown) {
    api({ "/api/faturas/fat-12": [{ body: corpo }] });
    const params = Promise.resolve({ id: "fat-12" });
    const tela = await montar(
      <Suspense fallback="carregando">
        <FaturaPage params={params} />
      </Suspense>,
    );
    await ate(() => expect(tela.querySelector("h1")?.textContent).toBe("Fatura nº 12"));
    return tela;
  }

  it("na fatura paga aparece o link Recibo, fora da impressão; em aberto e cancelada não", async () => {
    const paga = await abrirFatura(fatura({ status: "PAID", paidAt: "2026-10-12T15:00:00.000Z" }));
    const [link] = porTexto(paga, "a", "Recibo");
    expect(link.getAttribute("href")).toBe("/dashboard/financeiro/recibo/t-12");
    expect(link.closest(".print\\:hidden")).not.toBeNull();
    // O CNPJ continua formatado como antes.
    expect(paga.textContent).toContain("12.345.678/0001-90");

    const aberta = await abrirFatura(fatura({}));
    expect(recibos(aberta)).toEqual([]);

    const cancelada = await abrirFatura(fatura({ status: "CANCELLED", transaction: null }));
    expect(recibos(cancelada)).toEqual([]);
  });
});
