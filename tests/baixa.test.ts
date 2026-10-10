import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getServerSession } from "next-auth";
import {
  DESCONTO_MAIOR_QUE_O_VALOR,
  ENCARGOS_SO_A_RECEBER,
  ENCARGOS_SO_NA_BAIXA,
  fluxoDeCaixa,
  resumoFinanceiro,
  temEncargos,
  updateTransactionSchema,
  valorRealizado,
  valorRecebido,
  type Lancamento,
} from "../src/lib/financeiro";
import { JUROS_PADRAO_PCT, MULTA_PADRAO_PCT, encargosSugeridos } from "../src/lib/cobranca";
import { invoiceActionSchema } from "../src/lib/faturas";
import { parametrosDeCobrancaSchema } from "../src/lib/empresa";
import { SEM_CENTRO_DE_CUSTO, montarRelatorio } from "../src/lib/relatorios";
import { EMPRESA_OUTRA, EMPRESA_PADRAO } from "./empresas-de-teste";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

/**
 * Fechamento do contas a receber: baixa com juros, multa e desconto, sugestão
 * de encargos, parâmetros de cobrança da empresa e centro de custo.
 */
describe("contas da baixa", () => {
  // Meio-dia de 15/10/2026 em Brasília.
  const HOJE = new Date("2026-10-15T15:00:00.000Z");
  const dia = (d: string) => new Date(`${d}T00:00:00.000Z`);
  const l = (extra: Partial<Lancamento>): Lancamento => ({ type: "INCOME", amount: 100, status: "PENDING", dueDate: null, paidAt: null, ...extra });

  it("valor recebido: original mais juros e multa, menos desconto, em centavos; pode sair negativo para quem chama recusar", () => {
    expect(valorRecebido(1000, { juros: 10, multa: 20, desconto: 5 })).toBe(1025);
    expect(valorRecebido(1000, {})).toBe(1000);
    expect(valorRecebido(1000, { juros: null, multa: undefined, desconto: 0 })).toBe(1000);
    // 0,1 + 0,2 não vira 0,30000000000000004.
    expect(valorRecebido(0.1, { juros: 0.2 })).toBe(0.3);
    expect(valorRecebido(100, { desconto: 100 })).toBe(0);
    expect(valorRecebido(100, { multa: 2, desconto: 150 })).toBe(-48);
  });

  it("tem encargos só quando algum é maior que zero: tudo zerado é baixa pelo valor cheio", () => {
    expect(temEncargos({})).toBe(false);
    expect(temEncargos({ juros: 0, multa: 0, desconto: 0 })).toBe(false);
    expect(temEncargos({ juros: null, multa: null, desconto: null })).toBe(false);
    expect(temEncargos({ desconto: 0.01 })).toBe(true);
    expect(temEncargos({ juros: 1 })).toBe(true);
    expect(temEncargos({ multa: 1 })).toBe(true);
  });

  it("valor realizado: o recebido quando existe, o original quando não; recebido zero é zero, não o original", () => {
    expect(valorRealizado({ amount: 100, paidAmount: 90 })).toBe(90);
    expect(valorRealizado({ amount: 100, paidAmount: null })).toBe(100);
    expect(valorRealizado({ amount: 100 })).toBe(100);
    expect(valorRealizado({ amount: 100, paidAmount: 0 })).toBe(0);
  });

  it("o resumo do mês e o fluxo realizado usam o valor recebido; o previsto continua no valor original", () => {
    const lancamentos = [
      l({ amount: 1000, paidAmount: 1025, status: "PAID", dueDate: dia("2026-10-01"), paidAt: new Date("2026-10-10T12:00:00Z") }),
      l({ amount: 500, paidAmount: 450, status: "PAID", dueDate: dia("2026-10-05"), paidAt: new Date("2026-10-06T12:00:00Z") }),
      l({ amount: 200, status: "PAID", dueDate: dia("2026-10-05"), paidAt: new Date("2026-10-06T12:00:00Z") }),
      l({ type: "EXPENSE", amount: 300, status: "PAID", dueDate: dia("2026-10-08"), paidAt: new Date("2026-10-08T12:00:00Z") }),
    ];

    expect(resumoFinanceiro(lancamentos, HOJE).noMes).toEqual({ recebido: 1675, pago: 300 });
    expect(fluxoDeCaixa(lancamentos, "2026-10", "2026-10")).toEqual([
      { mes: "2026-10", previsto: { entradas: 1700, saidas: 300, saldo: 1400 }, realizado: { entradas: 1675, saidas: 300, saldo: 1375 }, acumulado: 1375 },
    ]);
  });

  describe("sugestão de encargos", () => {
    const PADRAO = { multaPct: MULTA_PADRAO_PCT, jurosPct: JUROS_PADRAO_PCT };

    it("o padrão é multa de 2% e juros de 1% ao mês", () => {
      expect(PADRAO).toEqual({ multaPct: 2, jurosPct: 1 });
    });

    it("multa é o percentual do valor, uma vez; juros são pro rata por dia de atraso (mês de 30 dias)", () => {
      expect(encargosSugeridos(1000, 15, PADRAO)).toEqual({ multa: 20, juros: 5 });
      expect(encargosSugeridos(1000, 30, PADRAO)).toEqual({ multa: 20, juros: 10 });
      expect(encargosSugeridos(1000, 1, PADRAO)).toEqual({ multa: 20, juros: 0.33 });
      expect(encargosSugeridos(1000, 90, PADRAO)).toEqual({ multa: 20, juros: 30 });
      // Arredonda em centavos: 333,33 × 2% = 6,6666 e 333,33 × 1% × 7/30 = 0,7777.
      expect(encargosSugeridos(333.33, 7, PADRAO)).toEqual({ multa: 6.67, juros: 0.78 });
    });

    it("título em dia não tem encargo, nem valor zerado; parâmetro zero zera só o seu lado", () => {
      expect(encargosSugeridos(1000, 0, PADRAO)).toEqual({ multa: 0, juros: 0 });
      expect(encargosSugeridos(1000, -3, PADRAO)).toEqual({ multa: 0, juros: 0 });
      expect(encargosSugeridos(0, 10, PADRAO)).toEqual({ multa: 0, juros: 0 });
      expect(encargosSugeridos(1000, 30, { multaPct: 0, jurosPct: 3 })).toEqual({ multa: 0, juros: 30 });
      expect(encargosSugeridos(1000, 30, { multaPct: 10, jurosPct: 0 })).toEqual({ multa: 100, juros: 0 });
    });
  });

  describe("validação", () => {
    it("lançamento: encargos só com a ação pagar, número do formulário com vírgula, e nunca negativo", () => {
      expect(updateTransactionSchema.parse({ action: "pagar", juros: "12,50", multa: "3", desconto: "" })).toEqual({ action: "pagar", juros: 12.5, multa: 3 });
      expect(updateTransactionSchema.parse({ action: "pagar" })).toEqual({ action: "pagar" });

      for (const corpo of [{ juros: 1 }, { description: "nova", multa: 1 }, { action: "reabrir", desconto: 1 }]) {
        const recusado = updateTransactionSchema.safeParse(corpo);
        expect(recusado.success, JSON.stringify(corpo)).toBe(false);
        expect(recusado.error?.issues[0]?.message).toBe(ENCARGOS_SO_NA_BAIXA);
      }
      for (const corpo of [{ action: "pagar", juros: -1 }, { action: "pagar", multa: "abc" }, { action: "pagar", desconto: [] }]) {
        expect(updateTransactionSchema.safeParse(corpo).success, JSON.stringify(corpo)).toBe(false);
      }
    });

    it("fatura: os mesmos três campos, só ao pagar", () => {
      expect(invoiceActionSchema.parse({ action: "pagar", juros: "1,5", multa: 6 })).toEqual({ action: "pagar", juros: 1.5, multa: 6 });
      expect(invoiceActionSchema.parse({ action: "cancelar" })).toEqual({ action: "cancelar" });
      for (const action of ["reabrir", "cancelar"]) {
        expect(invoiceActionSchema.safeParse({ action, juros: 1 }).error?.issues[0]?.message).toBe(ENCARGOS_SO_NA_BAIXA);
      }
      expect(invoiceActionSchema.safeParse({ action: "pagar", desconto: -1 }).success).toBe(false);
    });

    it("parâmetros de cobrança: os dois percentuais, de 0 a 100, com vírgula", () => {
      expect(parametrosDeCobrancaSchema.parse({ multaPct: "2,5", jurosPct: 0 })).toEqual({ multaPct: 2.5, jurosPct: 0 });
      expect(parametrosDeCobrancaSchema.parse({ multaPct: 100, jurosPct: "1" })).toEqual({ multaPct: 100, jurosPct: 1 });
      for (const corpo of [{ multaPct: 2 }, { jurosPct: 1 }, { multaPct: 101, jurosPct: 1 }, { multaPct: 2, jurosPct: -1 }, { multaPct: "abc", jurosPct: 1 }, { multaPct: "", jurosPct: 1 }, null]) {
        expect(parametrosDeCobrancaSchema.safeParse(corpo).success, JSON.stringify(corpo)).toBe(false);
      }
    });
  });

  it("relatório: recebido pelo valor que entrou, e despesas pagas por centro de custo, da maior para a menor", () => {
    const { financeiro } = montarRelatorio(
      {
        cargas: [],
        entregas: [],
        cotacoes: [],
        aReceber: [],
        pagos: [
          { type: "INCOME", amount: 1000, paidAmount: 1025, category: null, costCenter: "Filial A" },
          { type: "INCOME", amount: 200, paidAmount: null, category: null },
          { type: "EXPENSE", amount: 300, category: "Combustível", costCenter: "Filial A" },
          { type: "EXPENSE", amount: 150.5, category: "Pedágio", costCenter: " Filial A " },
          { type: "EXPENSE", amount: 700, category: "Folha", costCenter: "Matriz" },
          { type: "EXPENSE", amount: 40, category: null, costCenter: null },
          { type: "EXPENSE", amount: 10, category: null, costCenter: "  " },
          { type: "EXPENSE", amount: 5, category: null },
        ],
      },
      HOJE,
    );

    expect(financeiro.recebido).toBe(1225);
    expect(financeiro.pago).toBe(1205.5);
    // Receita não entra no quadro por centro de custo, mesmo tendo um.
    expect(financeiro.despesasPorCentroDeCusto).toEqual([
      { centro: "Matriz", total: 700 },
      { centro: "Filial A", total: 450.5 },
      { centro: SEM_CENTRO_DE_CUSTO, total: 55 },
    ]);
  });
});

/** As rotas, contra um Postgres de verdade. */
const temBanco = Boolean(process.env.DATABASE_URL);

if (!temBanco) {
  console.warn("\n[baixa.test] DATABASE_URL ausente: testes de integração PULADOS.\n");
}

const suite = temBanco ? describe : describe.skip;

// Tudo o que esta suite cria usa estes marcadores, e só isso é apagado.
const PREFIXO = "teste-baixa-";
const CNPJ = "99444333000155";
const HASH_FALSO = "$2b$10$hashfalsoparateste000000000000000000000000000000000";

type Corpo = Record<string, unknown> & { id: string; error?: string };

suite("rotas da baixa, do centro de custo e dos parâmetros de cobrança", () => {
  let banco: typeof import("../src/lib/prisma");
  let financeiro: typeof import("../src/app/api/financeiro/route");
  let lancamentoPorId: typeof import("../src/app/api/financeiro/[id]/route");
  let fluxo: typeof import("../src/app/api/financeiro/fluxo/route");
  let recibo: typeof import("../src/app/api/financeiro/[id]/recibo/route");
  let relatorios: typeof import("../src/app/api/relatorios/route");
  let faturas: typeof import("../src/app/api/faturas/route");
  let faturaPorId: typeof import("../src/app/api/faturas/[id]/route");
  let cobranca: typeof import("../src/app/api/empresa/cobranca/route");

  const sessao = vi.mocked(getServerSession);
  const ids = { ADMIN: "", OPERATION: "", CLIENT: "", DRIVER: "" };
  let clienteId: string;

  const entrarComo = (perfil: keyof typeof ids | null) =>
    sessao.mockResolvedValue(perfil ? { user: { id: ids[perfil], role: perfil, clientId: null } } : null);

  const req = (method = "GET", body?: unknown, query = "") =>
    new Request(`http://localhost/api/teste${query}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

  const descricao = (n: string) => `${PREFIXO}${n}`;
  const PADRAO = { lateFinePct: 2, lateInterestPct: 1 };

  async function limparLancamentos() {
    const { sistema } = banco;
    await sistema.financialTransaction.deleteMany({ where: { OR: [{ description: { startsWith: PREFIXO } }, { client: { cnpj: CNPJ } }] } });
    await sistema.collection.deleteMany({ where: { client: { cnpj: CNPJ } } });
    await sistema.invoice.deleteMany({ where: { client: { cnpj: CNPJ } } });
  }

  // As outras suites contam com os parâmetros padrão das empresas de teste.
  async function restaurarParametros() {
    for (const empresa of [EMPRESA_PADRAO, EMPRESA_OUTRA]) await banco.sistema.tenant.update({ where: { id: empresa.id }, data: PADRAO });
  }

  async function limpar() {
    await limparLancamentos();
    await restaurarParametros();
    await banco.sistema.auditLog.deleteMany({ where: { userName: { startsWith: PREFIXO } } });
    await banco.sistema.client.deleteMany({ where: { cnpj: CNPJ } });
    await banco.sistema.user.deleteMany({ where: { email: { startsWith: PREFIXO } } });
  }

  const criar = async (corpo: Record<string, unknown> = {}) => {
    entrarComo("ADMIN");
    const res = await financeiro.POST(req("POST", { type: "INCOME", amount: "1000", description: descricao("título"), ...corpo }));
    expect(res.status).toBe(201);
    return (await res.json()) as Corpo;
  };

  const alterar = async (id: string, corpo: Record<string, unknown>) => {
    entrarComo("ADMIN");
    const res = await lancamentoPorId.PATCH(req("PATCH", corpo), ctx(id));
    return { status: res.status, corpo: (await res.json()) as Corpo };
  };

  const gravado = (id: string) => banco.default.financialTransaction.findUniqueOrThrow({ where: { id } });

  async function emitirFatura() {
    const carga = await banco.default.collection.create({
      data: {
        clientId: clienteId,
        sender: "Remetente",
        receiver: "Destinatário",
        origin: "Rio Preto",
        destination: "Mirassol",
        volumes: 1,
        weight: 10,
        status: "DELIVERED",
        freightValue: 300,
      },
    });
    entrarComo("ADMIN");
    const res = await faturas.POST(req("POST", { clientId: clienteId, collectionIds: [carga.id], dueDate: "2026-11-10" }));
    expect(res.status).toBe(201);
    const fatura = (await res.json()) as { id: string; number: number };
    const lancamento = await banco.default.financialTransaction.findUniqueOrThrow({ where: { invoiceId: fatura.id } });
    return { fatura, lancamento };
  }

  const agirNaFatura = async (id: string, corpo: Record<string, unknown>) => {
    entrarComo("ADMIN");
    const res = await faturaPorId.PATCH(req("PATCH", corpo), ctx(id));
    return { status: res.status, corpo: (await res.json()) as Corpo };
  };

  beforeAll(async () => {
    banco = await import("../src/lib/prisma");
    financeiro = await import("../src/app/api/financeiro/route");
    lancamentoPorId = await import("../src/app/api/financeiro/[id]/route");
    fluxo = await import("../src/app/api/financeiro/fluxo/route");
    recibo = await import("../src/app/api/financeiro/[id]/recibo/route");
    relatorios = await import("../src/app/api/relatorios/route");
    faturas = await import("../src/app/api/faturas/route");
    faturaPorId = await import("../src/app/api/faturas/[id]/route");
    cobranca = await import("../src/app/api/empresa/cobranca/route");
    await limpar();

    clienteId = (await banco.default.client.create({ data: { companyName: `${PREFIXO}cliente`, cnpj: CNPJ } })).id;
    for (const perfil of ["ADMIN", "OPERATION", "CLIENT", "DRIVER"] as const) {
      ids[perfil] = (
        await banco.default.user.create({
          data: { name: `${PREFIXO}${perfil}`, email: `${PREFIXO}${perfil.toLowerCase()}@exemplo.br`, password: HASH_FALSO, role: perfil },
        })
      ).id;
    }
  });

  beforeEach(async () => {
    sessao.mockReset();
    await limparLancamentos();
    await restaurarParametros();
  });

  afterAll(async () => {
    if (banco) await limpar();
  });

  describe("baixa de lançamento a receber", () => {
    it("com juros, multa e desconto: o valor original fica, e o recebido é guardado à parte, com auditoria", async () => {
      const titulo = await criar({ dueDate: "2026-01-10" });

      const { status, corpo } = await alterar(titulo.id, { action: "pagar", juros: "10", multa: "20,00", desconto: 5, paymentMethod: "PIX" });
      expect(status).toBe(200);
      expect(corpo).toMatchObject({ status: "PAID", amount: 1000, interest: 10, fine: 20, discount: 5, paidAmount: 1025, paymentMethod: "PIX" });
      expect(await gravado(titulo.id)).toMatchObject({ amount: 1000, interest: 10, fine: 20, discount: 5, paidAmount: 1025 });

      const linha = await banco.sistema.auditLog.findFirstOrThrow({ where: { entityId: titulo.id, action: "lancamento.pagar" } });
      expect(linha.userId).toBe(ids.ADMIN);
      expect(linha.after).toMatchObject({ status: "PAID", interest: 10, fine: 20, discount: 5, paidAmount: 1025 });
      // O valor original não mudou: não aparece no antes e depois.
      expect(linha.after).not.toHaveProperty("amount");
    });

    it("só com desconto, até zerar o título; reabrir apaga os quatro campos", async () => {
      const titulo = await criar({ amount: "100" });

      const pago = await alterar(titulo.id, { action: "pagar", desconto: "100" });
      expect(pago.corpo).toMatchObject({ status: "PAID", amount: 100, interest: 0, fine: 0, discount: 100, paidAmount: 0 });

      const reaberto = await alterar(titulo.id, { action: "reabrir" });
      expect(reaberto.corpo).toMatchObject({ status: "PENDING", paidAt: null, interest: null, fine: null, discount: null, paidAmount: null });
    });

    it("sem encargo, ou com os três zerados, é a baixa pelo valor cheio de sempre: nada é guardado", async () => {
      const semNada = await criar();
      const zerado = await criar();

      expect((await alterar(semNada.id, { action: "pagar" })).corpo).toMatchObject({ status: "PAID", interest: null, fine: null, discount: null, paidAmount: null });
      expect((await alterar(zerado.id, { action: "pagar", juros: "0", multa: 0, desconto: "" })).corpo).toMatchObject({
        status: "PAID",
        interest: null,
        fine: null,
        discount: null,
        paidAmount: null,
      });
    });

    it("recusa sem mudar nada: desconto maior que o valor, encargo em despesa, encargo fora da baixa, número inválido", async () => {
      const titulo = await criar({ amount: "100" });
      const despesa = await criar({ type: "EXPENSE", amount: "100" });

      const maior = await alterar(titulo.id, { action: "pagar", multa: 2, desconto: "102,01" });
      expect(maior).toMatchObject({ status: 400, corpo: { error: DESCONTO_MAIOR_QUE_O_VALOR } });

      const emDespesa = await alterar(despesa.id, { action: "pagar", juros: 1 });
      expect(emDespesa).toMatchObject({ status: 400, corpo: { error: ENCARGOS_SO_A_RECEBER } });

      const foraDaBaixa = await alterar(titulo.id, { description: descricao("outra"), multa: 1 });
      expect(foraDaBaixa).toMatchObject({ status: 400, corpo: { error: ENCARGOS_SO_NA_BAIXA } });

      for (const corpo of [{ juros: -1 }, { multa: "dez" }, { desconto: {} }]) {
        expect((await alterar(titulo.id, { action: "pagar", ...corpo })).status, JSON.stringify(corpo)).toBe(400);
      }

      for (const id of [titulo.id, despesa.id]) {
        expect(await gravado(id)).toMatchObject({ status: "PENDING", paidAt: null, interest: null, fine: null, discount: null, paidAmount: null });
      }
      expect((await gravado(titulo.id)).description).toBe(descricao("título"));

      // Despesa continua sendo paga direto, pelo valor.
      expect((await alterar(despesa.id, { action: "pagar" })).corpo).toMatchObject({ status: "PAID", paidAmount: null });
    });

    it("corrigir o valor de um título já baixado com encargos refaz o recebido; se ficar negativo, recusa", async () => {
      const titulo = await criar({ amount: "1000" });
      await alterar(titulo.id, { action: "pagar", juros: 10, multa: 20, desconto: 500 });
      expect((await gravado(titulo.id)).paidAmount).toBe(530);

      expect((await alterar(titulo.id, { amount: "900" })).corpo).toMatchObject({ amount: 900, paidAmount: 430 });

      const negativo = await alterar(titulo.id, { amount: "400" });
      expect(negativo).toMatchObject({ status: 400, corpo: { error: DESCONTO_MAIOR_QUE_O_VALOR } });
      expect(await gravado(titulo.id)).toMatchObject({ amount: 900, paidAmount: 430 });

      // Baixado pelo valor cheio, corrigir o valor não inventa um recebido.
      const cheio = await criar({ amount: "50" });
      await alterar(cheio.id, { action: "pagar" });
      expect((await alterar(cheio.id, { amount: "60" })).corpo).toMatchObject({ amount: 60, paidAmount: null });
    });

    it("só o administrador dá a baixa: sem sessão 401, operação 403, e o título segue em aberto", async () => {
      const titulo = await criar();
      for (const [perfil, esperado] of [[null, 401], ["OPERATION", 403]] as const) {
        entrarComo(perfil);
        expect((await lancamentoPorId.PATCH(req("PATCH", { action: "pagar", juros: 1 }), ctx(titulo.id))).status).toBe(esperado);
      }
      expect(await gravado(titulo.id)).toMatchObject({ status: "PENDING", paidAmount: null });
    });

    it("o fluxo realizado, o relatório e o recibo usam o valor recebido; o previsto, o original", async () => {
      // Junho de 2018: nenhuma outra suite põe lançamento nesse mês.
      const titulo = await criar({ dueDate: "2018-06-10" });
      await alterar(titulo.id, { action: "pagar", juros: 5, multa: 20, paidAt: "2018-06-20T15:00:00.000Z" });

      entrarComo("ADMIN");
      const noFluxo = (await (await fluxo.GET(req("GET", undefined, "?de=2018-06&ate=2018-06"))).json()) as {
        fluxo: { previsto: { entradas: number }; realizado: { entradas: number } }[];
      };
      expect(noFluxo.fluxo[0].previsto.entradas).toBe(1000);
      expect(noFluxo.fluxo[0].realizado.entradas).toBe(1025);

      entrarComo("ADMIN");
      const relatorio = (await (await relatorios.GET(req("GET", undefined, "?de=2018-06&ate=2018-06"))).json()) as { financeiro: { recebido: number } };
      expect(relatorio.financeiro.recebido).toBe(1025);

      entrarComo("ADMIN");
      const doRecibo = (await (await recibo.GET(req(), ctx(titulo.id))).json()) as Corpo;
      expect(doRecibo).toMatchObject({ amount: 1025, encargos: { original: 1000, juros: 5, multa: 20, desconto: 0 } });
    });
  });

  describe("baixa de fatura", () => {
    it("os encargos vão para o lançamento da fatura; o total da fatura não muda; reabrir apaga", async () => {
      const { fatura, lancamento } = await emitirFatura();

      const paga = await agirNaFatura(fatura.id, { action: "pagar", multa: 6, juros: "1,50" });
      expect(paga.status).toBe(200);
      expect(paga.corpo).toMatchObject({ status: "PAID", total: 300 });
      expect(await gravado(lancamento.id)).toMatchObject({ status: "PAID", amount: 300, interest: 1.5, fine: 6, discount: 0, paidAmount: 307.5 });

      const linha = await banco.sistema.auditLog.findFirstOrThrow({ where: { entityId: fatura.id, action: "fatura.pagar" } });
      expect(linha.after).toMatchObject({ status: "PAID", interest: 1.5, fine: 6, discount: 0, paidAmount: 307.5 });

      entrarComo("ADMIN");
      const doRecibo = (await (await recibo.GET(req(), ctx(lancamento.id))).json()) as Corpo;
      expect(doRecibo).toMatchObject({ amount: 307.5, encargos: { original: 300, juros: 1.5, multa: 6, desconto: 0 } });

      expect((await agirNaFatura(fatura.id, { action: "reabrir" })).status).toBe(200);
      expect(await gravado(lancamento.id)).toMatchObject({ status: "PENDING", paidAt: null, interest: null, fine: null, discount: null, paidAmount: null });
    });

    it("sem encargo é a baixa de sempre; desconto maior que o total e encargo fora do pagar são recusados", async () => {
      const { fatura, lancamento } = await emitirFatura();

      const maior = await agirNaFatura(fatura.id, { action: "pagar", desconto: "300,01" });
      expect(maior).toMatchObject({ status: 400, corpo: { error: DESCONTO_MAIOR_QUE_O_VALOR } });
      const noCancelar = await agirNaFatura(fatura.id, { action: "cancelar", juros: 1 });
      expect(noCancelar).toMatchObject({ status: 400, corpo: { error: ENCARGOS_SO_NA_BAIXA } });
      expect(await banco.default.invoice.findUniqueOrThrow({ where: { id: fatura.id } })).toMatchObject({ status: "OPEN", paidAt: null });
      expect(await gravado(lancamento.id)).toMatchObject({ status: "PENDING", paidAmount: null });

      expect((await agirNaFatura(fatura.id, { action: "pagar" })).status).toBe(200);
      expect(await gravado(lancamento.id)).toMatchObject({ status: "PAID", interest: null, fine: null, discount: null, paidAmount: null });
    });

    it("o lançamento da fatura continua fora do alcance do financeiro, com ou sem encargo", async () => {
      const { lancamento } = await emitirFatura();
      const res = await alterar(lancamento.id, { action: "pagar", juros: 1 });
      expect(res.status).toBe(409);
      expect(String(res.corpo.error)).toMatch(/Faturamento/);
      expect(await gravado(lancamento.id)).toMatchObject({ status: "PENDING", paidAmount: null });
    });
  });

  describe("centro de custo", () => {
    it("é gravado sem espaço nas pontas, alterado, apagado com vazio, e entra na auditoria", async () => {
      const lancamento = await criar({ type: "EXPENSE", costCenter: "  Rota Sul  " });
      expect(lancamento.costCenter).toBe("Rota Sul");

      expect((await alterar(lancamento.id, { costCenter: "Matriz" })).corpo.costCenter).toBe("Matriz");
      const linha = await banco.sistema.auditLog.findFirstOrThrow({ where: { entityId: lancamento.id, action: "lancamento.alterar" } });
      expect(linha.before).toEqual({ costCenter: "Rota Sul" });
      expect(linha.after).toEqual({ costCenter: "Matriz" });

      expect((await alterar(lancamento.id, { costCenter: "" })).corpo.costCenter).toBeNull();
      expect((await alterar(lancamento.id, { costCenter: "x".repeat(81) })).status).toBe(400);
    });

    it("filtro da lista: só os lançamentos daquele centro, sem diferenciar maiúsculas", async () => {
      const sul = await criar({ type: "EXPENSE", costCenter: "Rota Sul" });
      const norte = await criar({ type: "EXPENSE", costCenter: "Rota Norte" });
      const sem = await criar({ type: "EXPENSE" });

      const listar = async (query: string) => {
        entrarComo("ADMIN");
        const lista = (await (await financeiro.GET(req("GET", undefined, query))).json()) as Corpo[];
        return lista.filter((l) => String(l.description).startsWith(PREFIXO)).map((l) => l.id);
      };

      expect(await listar("?centro=rota%20sul")).toEqual([sul.id]);
      expect(await listar("?centro=Rota%20Norte&tipo=EXPENSE")).toEqual([norte.id]);
      expect(await listar("?centro=Rota%20Norte&tipo=INCOME")).toEqual([]);
      expect(await listar("?centro=Inexistente")).toEqual([]);
      // Vazio é o mesmo que sem filtro.
      expect((await listar("?centro=")).sort()).toEqual([sul.id, norte.id, sem.id].sort());
    });

    it("relatório: só as despesas pagas no período, por centro; receita, em aberto e paga fora do período não entram", async () => {
      const em = "2018-06-15T15:00:00.000Z";
      await criar({ type: "EXPENSE", amount: "300", costCenter: "Filial A", status: "PAID", paidAt: em });
      await criar({ type: "EXPENSE", amount: "120,50", costCenter: "Filial A", status: "PAID", paidAt: em });
      await criar({ type: "EXPENSE", amount: "50", status: "PAID", paidAt: em });
      await criar({ type: "INCOME", amount: "999", costCenter: "Filial A", status: "PAID", paidAt: em });
      await criar({ type: "EXPENSE", amount: "888", costCenter: "Filial A" });
      await criar({ type: "EXPENSE", amount: "777", costCenter: "Filial A", status: "PAID", paidAt: "2018-07-01T15:00:00.000Z" });

      entrarComo("ADMIN");
      const relatorio = (await (await relatorios.GET(req("GET", undefined, "?de=2018-06&ate=2018-06"))).json()) as {
        financeiro: { despesasPorCentroDeCusto: { centro: string; total: number }[] };
      };
      expect(relatorio.financeiro.despesasPorCentroDeCusto).toEqual([
        { centro: "Filial A", total: 420.5 },
        { centro: SEM_CENTRO_DE_CUSTO, total: 50 },
      ]);
    });
  });

  describe("parâmetros de cobrança da empresa", () => {
    const ler = async () => {
      const res = await cobranca.GET();
      return { status: res.status, corpo: (await res.json()) as Record<string, unknown> };
    };
    const gravar = async (corpo: unknown) => {
      const res = await cobranca.PATCH(req("PATCH", corpo));
      return { status: res.status, corpo: (await res.json()) as Record<string, unknown> };
    };
    const daEmpresa = (id: string) => banco.sistema.tenant.findUniqueOrThrow({ where: { id }, select: { lateFinePct: true, lateInterestPct: true } });

    it("só o administrador lê e altera: sem sessão 401; operação, cliente e motorista 403", async () => {
      for (const [perfil, esperado] of [[null, 401], ["OPERATION", 403], ["CLIENT", 403], ["DRIVER", 403]] as const) {
        entrarComo(perfil);
        expect((await ler()).status, String(perfil)).toBe(esperado);
        entrarComo(perfil);
        expect((await gravar({ multaPct: 50, jurosPct: 50 })).status, String(perfil)).toBe(esperado);
      }
      expect(await daEmpresa(EMPRESA_PADRAO.id)).toEqual(PADRAO);
    });

    it("o padrão é 2% de multa e 1% de juros ao mês; alterar grava, a leitura seguinte traz, e a auditoria registra", async () => {
      entrarComo("ADMIN");
      expect(await ler()).toEqual({ status: 200, corpo: { multaPct: 2, jurosPct: 1 } });

      entrarComo("ADMIN");
      expect(await gravar({ multaPct: "2,5", jurosPct: 0 })).toEqual({ status: 200, corpo: { multaPct: 2.5, jurosPct: 0 } });
      entrarComo("ADMIN");
      expect((await ler()).corpo).toEqual({ multaPct: 2.5, jurosPct: 0 });

      const linha = await banco.sistema.auditLog.findFirstOrThrow({
        where: { action: "empresa.cobranca", userId: ids.ADMIN },
        orderBy: { createdAt: "desc" },
      });
      expect(linha.entityId).toBe(EMPRESA_PADRAO.id);
      expect(linha.before).toEqual({ multaPct: 2, jurosPct: 1 });
      expect(linha.after).toEqual({ multaPct: 2.5, jurosPct: 0 });
    });

    it("dado inválido é 400 e nada é gravado", async () => {
      for (const corpo of [{}, { multaPct: 2 }, { multaPct: 101, jurosPct: 1 }, { multaPct: 2, jurosPct: -0.1 }, { multaPct: "dois", jurosPct: 1 }]) {
        entrarComo("ADMIN");
        expect((await gravar(corpo)).status, JSON.stringify(corpo)).toBe(400);
      }
      expect(await daEmpresa(EMPRESA_PADRAO.id)).toEqual(PADRAO);
    });

    it("isolamento: a alteração fica na empresa da sessão, mesmo com o id de outra no corpo", async () => {
      entrarComo("ADMIN");
      expect((await gravar({ multaPct: 9, jurosPct: 3, id: EMPRESA_OUTRA.id, tenantId: EMPRESA_OUTRA.id })).status).toBe(200);
      expect(await daEmpresa(EMPRESA_PADRAO.id)).toEqual({ lateFinePct: 9, lateInterestPct: 3 });
      expect(await daEmpresa(EMPRESA_OUTRA.id)).toEqual(PADRAO);
    });
  });
});
