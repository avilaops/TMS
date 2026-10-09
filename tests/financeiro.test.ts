import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getServerSession } from "next-auth";
import {
  diaNoBrasil,
  fluxoDeCaixa,
  mesesDoPeriodo,
  periodoPadrao,
  resumoFinanceiro,
  situacaoDoLancamento,
  type Lancamento,
} from "../src/lib/financeiro";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

/** As contas do financeiro, sem banco: lançamentos na mão, data de referência na mão. */
describe("contas do financeiro", () => {
  // Meio-dia de 15/10/2026 em Brasília.
  const HOJE = new Date("2026-10-15T15:00:00.000Z");
  const dia = (d: string) => new Date(`${d}T00:00:00.000Z`);
  const l = (extra: Partial<Lancamento>): Lancamento => ({
    type: "INCOME",
    amount: 100,
    status: "PENDING",
    dueDate: null,
    paidAt: null,
    ...extra,
  });

  it("vence no fim do dia do vencimento, não no começo, e o dia é o do Brasil", () => {
    expect(situacaoDoLancamento(l({ dueDate: dia("2026-10-14") }), HOJE)).toBe("vencido");
    expect(situacaoDoLancamento(l({ dueDate: dia("2026-10-15") }), HOJE)).toBe("aberto");
    expect(situacaoDoLancamento(l({ dueDate: dia("2026-10-16") }), HOJE)).toBe("aberto");
    expect(situacaoDoLancamento(l({ dueDate: null }), HOJE)).toBe("aberto");
    expect(situacaoDoLancamento(l({ dueDate: dia("2020-01-01"), status: "PAID" }), HOJE)).toBe("pago");

    // 01:30 UTC do dia 16 ainda é dia 15 em Brasília: o que vence dia 15 não está vencido.
    const madrugadaUtc = new Date("2026-10-16T01:30:00.000Z");
    expect(diaNoBrasil(madrugadaUtc)).toBe("2026-10-15");
    expect(situacaoDoLancamento(l({ dueDate: dia("2026-10-15") }), madrugadaUtc)).toBe("aberto");
  });

  it("o resumo separa aberto de vencido, por lado, e conta o realizado só do mês corrente", () => {
    const resumo = resumoFinanceiro(
      [
        l({ amount: 100.1, dueDate: dia("2026-10-20") }),
        l({ amount: 50.2, dueDate: dia("2026-10-01") }),
        l({ type: "EXPENSE", amount: 30, dueDate: dia("2026-11-05") }),
        l({ type: "EXPENSE", amount: 20, dueDate: dia("2026-09-30") }),
        l({ amount: 500, status: "PAID", paidAt: new Date("2026-10-03T12:00:00Z") }),
        l({ type: "EXPENSE", amount: 80, status: "PAID", paidAt: new Date("2026-10-10T12:00:00Z") }),
        // Pago no mês passado: não entra em "no mês".
        l({ amount: 999, status: "PAID", paidAt: new Date("2026-09-28T12:00:00Z") }),
      ],
      HOJE,
    );
    expect(resumo).toEqual({
      aReceber: { aberto: 100.1, vencido: 50.2 },
      aPagar: { aberto: 30, vencido: 20 },
      noMes: { recebido: 500, pago: 80 },
      saldoPrevisto: 100.3,
    });
  });

  it("o fluxo põe o previsto no mês do vencimento e o realizado no mês do pagamento", () => {
    const fluxo = fluxoDeCaixa(
      [
        // Venceu em setembro, recebido em outubro: previsto em 09, realizado em 10.
        l({ amount: 1000, dueDate: dia("2026-09-25"), status: "PAID", paidAt: new Date("2026-10-02T12:00:00Z") }),
        l({ type: "EXPENSE", amount: 400, dueDate: dia("2026-10-10"), status: "PAID", paidAt: new Date("2026-10-10T12:00:00Z") }),
        l({ amount: 250.5, dueDate: dia("2026-11-15") }),
        // Sem vencimento: só aparece quando é pago.
        l({ type: "EXPENSE", amount: 60, status: "PAID", paidAt: new Date("2026-11-03T12:00:00Z") }),
        // Fora do período: ignorado.
        l({ amount: 9999, dueDate: dia("2027-06-01") }),
      ],
      "2026-09",
      "2026-11",
    );

    expect(fluxo).toEqual([
      { mes: "2026-09", previsto: { entradas: 1000, saidas: 0, saldo: 1000 }, realizado: { entradas: 0, saidas: 0, saldo: 0 }, acumulado: 0 },
      { mes: "2026-10", previsto: { entradas: 0, saidas: 400, saldo: -400 }, realizado: { entradas: 1000, saidas: 400, saldo: 600 }, acumulado: 600 },
      { mes: "2026-11", previsto: { entradas: 250.5, saidas: 0, saldo: 250.5 }, realizado: { entradas: 0, saidas: 60, saldo: -60 }, acumulado: 540 },
    ]);
  });

  it("pagamento às 23h de Brasília do último dia do mês fica no mês certo", () => {
    // 02:00 UTC de 1º/11 = 23:00 de 31/10 em Brasília.
    const fluxo = fluxoDeCaixa([l({ status: "PAID", paidAt: new Date("2026-11-01T02:00:00Z") })], "2026-10", "2026-11");
    expect(fluxo[0].realizado.entradas).toBe(100);
    expect(fluxo[1].realizado.entradas).toBe(0);
  });

  it("período: meses em ordem, virada de ano, e inválido devolve vazio", () => {
    expect(mesesDoPeriodo("2026-11", "2027-02")).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
    expect(mesesDoPeriodo("2026-10", "2026-10")).toEqual(["2026-10"]);
    expect(mesesDoPeriodo("2026-10", "2026-09")).toEqual([]);
    expect(mesesDoPeriodo("2026-13", "2027-01")).toEqual([]);
    expect(mesesDoPeriodo("outubro", "2027-01")).toEqual([]);
    expect(mesesDoPeriodo("2020-01", "2022-12")).toHaveLength(36);
    expect(mesesDoPeriodo("2020-01", "2023-01")).toEqual([]);
    expect(periodoPadrao(HOJE)).toEqual({ de: "2026-07", ate: "2027-01" });
    expect(periodoPadrao(new Date("2026-02-10T15:00:00Z"))).toEqual({ de: "2025-11", ate: "2026-05" });
  });
});

/** Rotas do financeiro, contra um Postgres de verdade. */
const temBanco = Boolean(process.env.DATABASE_URL);

if (!temBanco) {
  console.warn("\n[financeiro.test] DATABASE_URL ausente: testes de integração PULADOS.\n");
}

const suite = temBanco ? describe : describe.skip;

// Tudo o que esta suite cria usa estes marcadores, e só isso é apagado.
const PREFIXO = "teste-financeiro-";
const CNPJ = "99444333000122";
const HASH_FALSO = "$2b$10$hashfalsoparateste000000000000000000000000000000000";

suite("rotas do financeiro", () => {
  let banco: typeof import("../src/lib/prisma");
  let financeiro: typeof import("../src/app/api/financeiro/route");
  let lancamentoPorId: typeof import("../src/app/api/financeiro/[id]/route");
  let fluxo: typeof import("../src/app/api/financeiro/fluxo/route");
  let faturas: typeof import("../src/app/api/faturas/route");
  let faturaPorId: typeof import("../src/app/api/faturas/[id]/route");

  const sessao = vi.mocked(getServerSession);
  const ids = { ADMIN: "", OPERATION: "" };
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
  const meus = { description: { startsWith: PREFIXO } };

  async function limparLancamentos() {
    const { sistema } = banco;
    await sistema.financialTransaction.deleteMany({ where: { OR: [meus, { client: { cnpj: CNPJ } }] } });
    await sistema.collection.deleteMany({ where: { client: { cnpj: CNPJ } } });
    await sistema.invoice.deleteMany({ where: { client: { cnpj: CNPJ } } });
  }

  async function limpar() {
    await limparLancamentos();
    await banco.sistema.client.deleteMany({ where: { cnpj: CNPJ } });
    await banco.sistema.user.deleteMany({ where: { email: { startsWith: PREFIXO } } });
  }

  const criar = async (corpo: Record<string, unknown>) => {
    entrarComo("ADMIN");
    const res = await financeiro.POST(req("POST", { type: "EXPENSE", amount: "100", description: descricao("x"), ...corpo }));
    return { status: res.status, corpo: (await res.json()) as Record<string, unknown> & { id: string } };
  };

  const alterar = async (id: string, corpo: Record<string, unknown>) => {
    entrarComo("ADMIN");
    const res = await lancamentoPorId.PATCH(req("PATCH", corpo), ctx(id));
    return { status: res.status, corpo: (await res.json()) as Record<string, unknown> };
  };

  const gravado = (id: string) => banco.default.financialTransaction.findUniqueOrThrow({ where: { id } });

  beforeAll(async () => {
    banco = await import("../src/lib/prisma");
    financeiro = await import("../src/app/api/financeiro/route");
    lancamentoPorId = await import("../src/app/api/financeiro/[id]/route");
    fluxo = await import("../src/app/api/financeiro/fluxo/route");
    faturas = await import("../src/app/api/faturas/route");
    faturaPorId = await import("../src/app/api/faturas/[id]/route");
    await limpar();

    clienteId = (await banco.default.client.create({ data: { companyName: `${PREFIXO}cliente`, cnpj: CNPJ } })).id;
    for (const perfil of ["ADMIN", "OPERATION"] as const) {
      ids[perfil] = (
        await banco.default.user.create({
          data: { name: perfil, email: `${PREFIXO}${perfil.toLowerCase()}@exemplo.br`, password: HASH_FALSO, role: perfil },
        })
      ).id;
    }
  });

  beforeEach(async () => {
    sessao.mockReset();
    await limparLancamentos();
  });

  afterAll(async () => {
    if (banco) await limpar();
  });

  it("só o administrador: sem sessão 401 e operação 403, em todas as rotas", async () => {
    const { corpo } = await criar({});
    const chamadas = [
      () => financeiro.GET(),
      () => financeiro.POST(req("POST", { type: "EXPENSE", amount: 1, description: descricao("invasor") })),
      () => lancamentoPorId.PATCH(req("PATCH", { action: "pagar" }), ctx(corpo.id)),
      () => lancamentoPorId.DELETE(req("DELETE"), ctx(corpo.id)),
      () => fluxo.GET(),
    ];
    for (const [perfil, esperado] of [[null, 401], ["OPERATION", 403]] as const) {
      for (const chamar of chamadas) {
        entrarComo(perfil);
        expect((await chamar()).status).toBe(esperado);
      }
    }
    expect(await gravado(corpo.id)).toMatchObject({ status: "PENDING" });
    expect(await banco.default.financialTransaction.count({ where: { description: descricao("invasor") } })).toBe(0);
  });

  it("cria validando; número com vírgula, cliente, categoria e fornecedor são gravados", async () => {
    const { status, corpo } = await criar({
      type: "EXPENSE",
      amount: "1234,56",
      description: `  ${descricao("diesel")}  `,
      dueDate: "2026-11-10",
      category: "Combustível",
      counterparty: "Posto Avenida",
      notes: "",
    });
    expect(status).toBe(201);
    expect(corpo).toMatchObject({
      type: "EXPENSE",
      amount: 1234.56,
      description: descricao("diesel"),
      status: "PENDING",
      paidAt: null,
      category: "Combustível",
      counterparty: "Posto Avenida",
      notes: null,
      client: null,
      invoice: null,
    });
    expect(String(corpo.dueDate)).toMatch(/^2026-11-10T00:00:00/);

    const comCliente = await criar({ type: "INCOME", clientId: clienteId });
    expect(comCliente.corpo.client).toMatchObject({ id: clienteId });
  });

  it("recusa o que antes passava: tipo e situação inventados, valor zero, negativo ou texto, cliente inexistente", async () => {
    for (const [caso, corpo] of [
      ["tipo inventado", { type: "RECEITA" }],
      ["situação inventada", { status: "QUITADO" }],
      ["valor zero", { amount: 0 }],
      ["valor negativo", { amount: -5 }],
      ["valor que não é número", { amount: "abc" }],
      ["valor em notação científica", { amount: "1e3" }],
      ["sem valor", { amount: "" }],
      ["sem descrição", { description: " " }],
      ["vencimento inválido", { dueDate: "não é data" }],
      ["forma de pagamento inventada", { status: "PAID", paymentMethod: "CHEQUE-SEM-FUNDO" }],
      ["cliente inexistente", { clientId: "00000000-0000-4000-8000-000000000000" }],
    ] as const) {
      expect((await criar({ description: descricao("invalido"), ...corpo })).status, caso).toBe(400);
    }
    entrarComo("ADMIN");
    expect((await financeiro.POST(req("POST", null))).status).toBe(400);
    expect(await banco.default.financialTransaction.count({ where: { description: descricao("invalido") } })).toBe(0);
  });

  it("lançamento que já nasce pago guarda quando e como; em aberto não guarda", async () => {
    const pago = await criar({ status: "PAID", paymentMethod: "PIX", paidAt: "2026-10-05" });
    expect(pago.corpo).toMatchObject({ status: "PAID", paymentMethod: "PIX" });
    expect(String(pago.corpo.paidAt)).toMatch(/^2026-10-05/);

    const pagoAgora = await criar({ status: "PAID" });
    expect(Date.now() - new Date(String(pagoAgora.corpo.paidAt)).getTime()).toBeLessThan(60_000);

    // Em aberto, data e forma de pagamento informadas por engano não são gravadas.
    const aberto = await criar({ paymentMethod: "PIX", paidAt: "2026-10-05" });
    expect(aberto.corpo).toMatchObject({ status: "PENDING", paidAt: null, paymentMethod: null });
  });

  it("pagar grava data e forma; reabrir limpa; cada um só vale na situação certa", async () => {
    const { corpo } = await criar({});

    expect((await alterar(corpo.id, { action: "reabrir" })).status).toBe(409);

    const pago = await alterar(corpo.id, { action: "pagar", paymentMethod: "BOLETO", paidAt: "2026-10-07" });
    expect(pago.status).toBe(200);
    expect(pago.corpo).toMatchObject({ status: "PAID", paymentMethod: "BOLETO" });
    expect(String(pago.corpo.paidAt)).toMatch(/^2026-10-07/);

    expect((await alterar(corpo.id, { action: "pagar" })).status).toBe(409);

    // Pago, dá para corrigir a data e a forma sem reabrir.
    const corrigido = await alterar(corpo.id, { paidAt: "2026-10-08", paymentMethod: "PIX" });
    expect(corrigido.corpo).toMatchObject({ status: "PAID", paymentMethod: "PIX" });
    expect(String(corrigido.corpo.paidAt)).toMatch(/^2026-10-08/);

    const reaberto = await alterar(corpo.id, { action: "reabrir" });
    expect(reaberto.corpo).toMatchObject({ status: "PENDING", paidAt: null, paymentMethod: null });

    // Em aberto, mandar data de pagamento sem `action` não paga por baixo do pano.
    await alterar(corpo.id, { paidAt: "2026-10-09", paymentMethod: "PIX" });
    expect(await gravado(corpo.id)).toMatchObject({ status: "PENDING", paidAt: null, paymentMethod: null });

    const semData = await alterar(corpo.id, { action: "pagar" });
    expect(Date.now() - new Date(String(semData.corpo.paidAt)).getTime()).toBeLessThan(60_000);
    expect((await alterar(corpo.id, { action: "explodir" })).status).toBe(400);
  });

  it("edita só o que veio, apaga campo com vazio, e recusa dado inválido sem mudar nada", async () => {
    const { corpo } = await criar({ category: "Pedágio", dueDate: "2026-11-10", counterparty: "Concessionária" });

    const editado = await alterar(corpo.id, { amount: "250,75", category: "", dueDate: "2026-12-01" });
    expect(editado.status).toBe(200);
    expect(editado.corpo).toMatchObject({ amount: 250.75, category: null, counterparty: "Concessionária" });
    expect(String(editado.corpo.dueDate)).toMatch(/^2026-12-01/);

    for (const invalido of [{ amount: 0 }, { type: "X" }, { description: "" }, { clientId: "00000000-0000-4000-8000-000000000000" }, {}]) {
      expect((await alterar(corpo.id, invalido)).status, JSON.stringify(invalido)).toBe(400);
    }
    expect(await gravado(corpo.id)).toMatchObject({ amount: 250.75, type: "EXPENSE" });

    expect((await alterar("00000000-0000-4000-8000-000000000000", { amount: 1 })).status).toBe(404);
  });

  it("exclui lançamento manual; o que não existe responde 404", async () => {
    const { corpo } = await criar({});
    entrarComo("ADMIN");
    expect((await lancamentoPorId.DELETE(req("DELETE"), ctx(corpo.id))).status).toBe(200);
    expect(await banco.default.financialTransaction.findUnique({ where: { id: corpo.id } })).toBeNull();

    entrarComo("ADMIN");
    expect((await lancamentoPorId.DELETE(req("DELETE"), ctx(corpo.id))).status).toBe(404);
  });

  describe("lançamento que veio de fatura", () => {
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

    it("não é pago, editado nem excluído pelo financeiro: 409 mandando para o Faturamento", async () => {
      const { lancamento } = await emitirFatura();

      for (const corpo of [{ action: "pagar" }, { amount: 1 }, { description: "trocada" }]) {
        const res = await alterar(lancamento.id, corpo);
        expect(res.status, JSON.stringify(corpo)).toBe(409);
        expect(String(res.corpo.error)).toMatch(/Faturamento/);
      }
      entrarComo("ADMIN");
      const exclusao = await lancamentoPorId.DELETE(req("DELETE"), ctx(lancamento.id));
      expect(exclusao.status).toBe(409);

      expect(await gravado(lancamento.id)).toMatchObject({ amount: 300, status: "PENDING", paidAt: null });
    });

    it("pagar a fatura data o lançamento, que entra no realizado; reabrir tira", async () => {
      const { fatura, lancamento } = await emitirFatura();

      entrarComo("ADMIN");
      expect((await faturaPorId.PATCH(req("PATCH", { action: "pagar" }), ctx(fatura.id))).status).toBe(200);
      const pago = await gravado(lancamento.id);
      expect(pago.status).toBe("PAID");
      expect(Date.now() - pago.paidAt!.getTime()).toBeLessThan(60_000);

      entrarComo("ADMIN");
      const mes = diaNoBrasil(new Date()).slice(0, 7);
      const noFluxo = (await (await fluxo.GET(req("GET", undefined, `?de=${mes}&ate=${mes}`))).json()) as {
        fluxo: { realizado: { entradas: number } }[];
      };
      expect(noFluxo.fluxo[0].realizado.entradas).toBeGreaterThanOrEqual(300);

      entrarComo("ADMIN");
      await faturaPorId.PATCH(req("PATCH", { action: "reabrir" }), ctx(fatura.id));
      expect(await gravado(lancamento.id)).toMatchObject({ status: "PENDING", paidAt: null, paymentMethod: null });
    });

    it("a lista mostra o número da fatura e o cliente de cada lançamento", async () => {
      const { fatura, lancamento } = await emitirFatura();
      entrarComo("ADMIN");
      const lista = (await (await financeiro.GET()).json()) as { id: string; invoice: { number: number } | null; client: { id: string } | null }[];
      expect(lista.find((t) => t.id === lancamento.id)).toMatchObject({ invoice: { number: fatura.number }, client: { id: clienteId } });
      expect(JSON.stringify(lista)).not.toContain("tenantId");
    });
  });

  it("filtros da lista: tipo, situação e período do vencimento", async () => {
    await criar({ description: descricao("receita-aberta"), type: "INCOME", dueDate: "2099-01-10" });
    await criar({ description: descricao("despesa-vencida"), dueDate: "2020-01-10" });
    await criar({ description: descricao("despesa-paga"), dueDate: "2020-02-10", status: "PAID" });

    const listar = async (query: string) => {
      entrarComo("ADMIN");
      const lista = (await (await financeiro.GET(req("GET", undefined, query))).json()) as { description: string }[];
      return lista.map((t) => t.description).filter((d) => d.startsWith(PREFIXO)).sort();
    };

    expect(await listar("?tipo=INCOME")).toEqual([descricao("receita-aberta")]);
    expect(await listar("?situacao=vencido")).toEqual([descricao("despesa-vencida")]);
    expect(await listar("?situacao=pago")).toEqual([descricao("despesa-paga")]);
    expect(await listar("?situacao=aberto")).toEqual([descricao("receita-aberta")]);
    expect(await listar("?de=2020-01-01&ate=2020-01-31")).toEqual([descricao("despesa-vencida")]);
    expect(await listar("?tipo=EXPENSE&de=2020-02-01")).toEqual([descricao("despesa-paga")]);
    // Filtro que não existe é ignorado, não vira erro.
    expect(await listar("?tipo=X&situacao=Y&de=ontem")).toHaveLength(3);
  });

  it("fluxo de caixa: período padrão de sete meses, período pedido, e período inválido 400", async () => {
    entrarComo("ADMIN");
    const padrao = (await (await fluxo.GET()).json()) as { periodo: { de: string; ate: string }; fluxo: unknown[]; resumo: Record<string, unknown> };
    expect(padrao.fluxo).toHaveLength(7);
    expect(padrao.resumo).toHaveProperty("saldoPrevisto");

    await criar({ description: descricao("previsto"), type: "INCOME", amount: 700, dueDate: "2031-03-15" });
    entrarComo("ADMIN");
    const pedido = (await (await fluxo.GET(req("GET", undefined, "?de=2031-03&ate=2031-04"))).json()) as {
      fluxo: { mes: string; previsto: { entradas: number } }[];
    };
    expect(pedido.fluxo.map((m) => m.mes)).toEqual(["2031-03", "2031-04"]);
    expect(pedido.fluxo[0].previsto.entradas).toBeGreaterThanOrEqual(700);

    for (const query of ["?de=2031-04&ate=2031-03", "?de=abril&ate=2031-03", "?de=2020-01&ate=2031-03"]) {
      entrarComo("ADMIN");
      expect((await fluxo.GET(req("GET", undefined, query))).status, query).toBe(400);
    }
  });
});
