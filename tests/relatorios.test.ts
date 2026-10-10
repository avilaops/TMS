import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getServerSession } from "next-auth";
import {
  SEM_CATEGORIA,
  SEM_MOTORISTA,
  entregasPorDia,
  limitesDoPeriodo,
  montarRelatorio,
  periodoDoRelatorio,
  semanaCorrente,
  type CargaDoPeriodo,
  type DadosDoRelatorio,
  type EntregaDoPeriodo,
  type Relatorio,
} from "../src/lib/relatorios";
import { EMPRESA_OUTRA } from "./empresas-de-teste";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

/** As contas do relatório, sem banco: linhas na mão, data de referência na mão. */
describe("contas do relatório", () => {
  // Meio-dia de 15/10/2026 em Brasília.
  const HOJE = new Date("2026-10-15T15:00:00.000Z");
  const VAZIO: DadosDoRelatorio = { cargas: [], entregas: [], cotacoes: [], pagos: [], aReceber: [] };

  const cliente = (id: string, tradeName: string | null = null) => ({ id, companyName: `Razão ${id} Ltda`, tradeName });
  const carga = (extra: Partial<CargaDoPeriodo> = {}): CargaDoPeriodo => ({
    status: "DELIVERED",
    weight: 10,
    freightValue: 100,
    client: cliente("a"),
    ...extra,
  });
  // Entrega às 12h do dia 10, coletada `horas` antes.
  const entrega = (horas: number | null, extra: Partial<EntregaDoPeriodo> = {}): EntregaDoPeriodo => {
    const entregueEm = new Date("2026-10-10T15:00:00.000Z");
    return {
      entregueEm,
      coletadaEm: horas === null ? null : new Date(entregueEm.getTime() - horas * 3_600_000),
      freightDeadlineHours: 24,
      motorista: { id: "m1", nome: "Ana" },
      ...extra,
    };
  };

  it("período: limites no relógio do Brasil, com o fim exclusivo e a virada do ano", () => {
    expect(limitesDoPeriodo("2026-10", "2026-10")).toEqual({
      inicio: new Date("2026-10-01T03:00:00.000Z"),
      fim: new Date("2026-11-01T03:00:00.000Z"),
    });
    expect(limitesDoPeriodo("2026-11", "2026-12")?.fim).toEqual(new Date("2027-01-01T03:00:00.000Z"));
  });

  it("período invertido, malformado ou com mais de 36 meses não tem limites", () => {
    for (const [de, ate] of [["2026-10", "2026-09"], ["2026-13", "2026-12"], ["outubro", "2026-10"], ["", ""], ["2020-01", "2023-01"]]) {
      expect(limitesDoPeriodo(de, ate), `${de}..${ate}`).toBeNull();
    }
    expect(limitesDoPeriodo("2020-01", "2022-12")).not.toBeNull();
  });

  it("período padrão: o mês corrente e os dois anteriores, pelo dia do Brasil", () => {
    expect(periodoDoRelatorio(HOJE)).toEqual({ de: "2026-08", ate: "2026-10" });
    expect(periodoDoRelatorio(new Date("2026-02-10T15:00:00.000Z"))).toEqual({ de: "2025-12", ate: "2026-02" });
    // 01:30 UTC de 1º de novembro ainda é 31 de outubro em Brasília.
    expect(periodoDoRelatorio(new Date("2026-11-01T01:30:00.000Z"))).toEqual({ de: "2026-08", ate: "2026-10" });
  });

  it("semana corrente: de segunda a domingo no relógio do Brasil, com o fim exclusivo", () => {
    // 15/10/2026 é quinta-feira.
    expect(semanaCorrente(HOJE)).toEqual({
      inicio: new Date("2026-10-12T03:00:00.000Z"),
      fim: new Date("2026-10-19T03:00:00.000Z"),
      dias: ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"],
    });
    // Segunda e domingo ficam na própria semana; 01:30 UTC de segunda ainda é domingo em Brasília.
    expect(semanaCorrente(new Date("2026-10-12T15:00:00.000Z")).dias[0]).toBe("2026-10-12");
    expect(semanaCorrente(new Date("2026-10-18T15:00:00.000Z")).dias[0]).toBe("2026-10-12");
    expect(semanaCorrente(new Date("2026-10-19T01:30:00.000Z")).dias[0]).toBe("2026-10-12");
    // Semana que vira o mês e o ano.
    expect(semanaCorrente(new Date("2027-01-01T15:00:00.000Z")).dias).toEqual([
      "2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02", "2027-01-03",
    ]);
  });

  it("entregas por dia: cada entrega no dia do Brasil em que aconteceu; fora da semana não conta", () => {
    expect(entregasPorDia([], HOJE)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(
      entregasPorDia(
        [
          new Date("2026-10-12T03:00:00.000Z"), // 00:00 de segunda
          "2026-10-12T20:00:00.000Z",
          new Date("2026-10-16T02:30:00.000Z"), // 23:30 de quinta
          new Date("2026-10-19T02:59:00.000Z"), // 23:59 de domingo
          new Date("2026-10-12T02:59:00.000Z"), // domingo anterior
          new Date("2026-10-19T03:00:00.000Z"), // segunda seguinte
        ],
        HOJE,
      ),
    ).toEqual([2, 0, 0, 1, 0, 0, 1]);
  });

  it("sem dado nenhum: tudo zero e as taxas sem valor, não 0% nem 100%", () => {
    expect(montarRelatorio(VAZIO, HOJE)).toEqual<Relatorio>({
      operacional: {
        cargas: 0,
        porStatus: {},
        prazo: { entregas: 0, noPrazo: 0, foraDoPrazo: 0, semMedicao: 0, taxaNoPrazo: null, tempoMedioHoras: null },
        motoristas: [],
      },
      comercial: { cotacoes: 0, porStatus: {}, conversao: null, frete: 0, clientes: [] },
      financeiro: {
        recebido: 0,
        pago: 0,
        resultado: 0,
        despesasPorCategoria: [],
        despesasPorCentroDeCusto: [],
        aReceberEmAberto: 0,
        vencido: 0,
        inadimplencia: null,
      },
    });
  });

  it("prazo: no limite é no prazo; sem prazo, sem coleta ou fora de ordem fica sem medição", () => {
    const { prazo } = montarRelatorio(
      {
        ...VAZIO,
        entregas: [
          entrega(24),
          entrega(24.5),
          entrega(10),
          entrega(6, { freightDeadlineHours: null }),
          entrega(null),
          entrega(-2),
        ],
      },
      HOJE,
    ).operacional;

    expect(prazo).toEqual({
      entregas: 6,
      noPrazo: 2,
      foraDoPrazo: 1,
      semMedicao: 3,
      taxaNoPrazo: 66.7,
      // (24 + 24,5 + 10 + 6) / 4: a entrega sem prazo tem tempo, a sem coleta e a fora de ordem não.
      tempoMedioHoras: 16.1,
    });
  });

  it("motoristas: cada um com a sua conta, quem entregou mais primeiro, e a carga sem motorista à parte", () => {
    const { motoristas } = montarRelatorio(
      {
        ...VAZIO,
        entregas: [
          entrega(30, { motorista: { id: "m2", nome: "Bruno" } }),
          entrega(10),
          entrega(20),
          entrega(5, { motorista: null }),
        ],
      },
      HOJE,
    ).operacional;

    expect(motoristas.map((m) => [m.chave, m.nome, m.entregas, m.noPrazo, m.foraDoPrazo, m.taxaNoPrazo, m.tempoMedioHoras])).toEqual([
      ["m1", "Ana", 2, 2, 0, 100, 15],
      ["m2", "Bruno", 1, 0, 1, 0, 30],
      ["", SEM_MOTORISTA, 1, 1, 0, 100, 5],
    ]);
  });

  it("cargas: conta por status; cancelada e recusada ficam fora do frete, e carga a cotar não soma valor", () => {
    const { operacional, comercial } = montarRelatorio(
      {
        ...VAZIO,
        cargas: [
          carga({ freightValue: 100.1, weight: 10.5 }),
          carga({ freightValue: 200.2, weight: 20, status: "ROUTE" }),
          carga({ freightValue: null, status: "PENDING" }),
          carga({ freightValue: 999, status: "CANCELLED" }),
          carga({ freightValue: 999, status: "REJECTED" }),
          carga({ freightValue: 500, client: cliente("b", "Fantasia B") }),
        ],
      },
      HOJE,
    );

    expect(operacional.cargas).toBe(6);
    expect(operacional.porStatus).toEqual({ DELIVERED: 2, ROUTE: 1, PENDING: 1, CANCELLED: 1, REJECTED: 1 });
    expect(comercial.frete).toBe(800.3);
    expect(comercial.clientes).toEqual([
      { clientId: "b", nome: "Fantasia B", cargas: 1, peso: 10, frete: 500, aCotar: 0 },
      { clientId: "a", nome: "Razão a Ltda", cargas: 3, peso: 40.5, frete: 300.3, aCotar: 1 },
    ]);
  });

  it("cotações: conversão é o que virou coleta sobre tudo o que chegou", () => {
    const { comercial } = montarRelatorio(
      { ...VAZIO, cotacoes: [{ status: "NEW" }, { status: "CONTACTED" }, { status: "CONVERTED" }, { status: "LOST" }, { status: "CONVERTED" }, { status: "LOST" }] },
      HOJE,
    );
    expect(comercial.cotacoes).toBe(6);
    expect(comercial.porStatus).toEqual({ NEW: 1, CONTACTED: 1, CONVERTED: 2, LOST: 2 });
    expect(comercial.conversao).toBe(33.3);
  });

  it("financeiro: recebido, pago e resultado; despesa por categoria, da maior para a menor", () => {
    const { financeiro } = montarRelatorio(
      {
        ...VAZIO,
        pagos: [
          { type: "INCOME", amount: 1000.1, category: "Frete" },
          { type: "INCOME", amount: 0.2, category: null },
          { type: "EXPENSE", amount: 300, category: "Combustível" },
          { type: "EXPENSE", amount: 150.5, category: " Combustível " },
          { type: "EXPENSE", amount: 700, category: "Folha" },
          { type: "EXPENSE", amount: 40, category: null },
          { type: "EXPENSE", amount: 10, category: "  " },
        ],
      },
      HOJE,
    );

    expect(financeiro.recebido).toBe(1000.3);
    expect(financeiro.pago).toBe(1200.5);
    expect(financeiro.resultado).toBe(-200.2);
    expect(financeiro.despesasPorCategoria).toEqual([
      { categoria: "Folha", total: 700 },
      { categoria: "Combustível", total: 450.5 },
      { categoria: SEM_CATEGORIA, total: 50 },
    ]);
  });

  it("inadimplência: vence hoje ainda não venceu; sem vencimento não vence nunca", () => {
    const dia = (d: string) => new Date(`${d}T00:00:00.000Z`);
    const { financeiro } = montarRelatorio(
      {
        ...VAZIO,
        aReceber: [
          { amount: 100, dueDate: dia("2026-10-14") },
          { amount: 200, dueDate: dia("2026-10-15") },
          { amount: 300, dueDate: dia("2026-10-16") },
          { amount: 400, dueDate: null },
        ],
      },
      HOJE,
    );
    expect(financeiro.aReceberEmAberto).toBe(1000);
    expect(financeiro.vencido).toBe(100);
    expect(financeiro.inadimplencia).toBe(10);
  });
});

/** A rota dos relatórios, contra um Postgres de verdade. */
const temBanco = Boolean(process.env.DATABASE_URL);

if (!temBanco) {
  console.warn("\n[relatorios.test] DATABASE_URL ausente: testes de integração PULADOS.\n");
}

const suite = temBanco ? describe : describe.skip;

// Tudo o que esta suite cria usa estes marcadores, e só isso é apagado.
const PREFIXO = "teste-relatorios-";
const CNPJ = "99444333000155";
const CNPJ_DA_OUTRA = "99444333000236";
const CPF = "99444333015";
const HASH_FALSO = "$2b$10$hashfalsoparateste000000000000000000000000000000000";

// Um período antigo, em que só existe o que esta suite põe: as contas saem exatas.
const PERIODO = "de=2019-03&ate=2019-04";
const em = (dia: string, hora = "12:00") => new Date(`${dia}T${hora}:00-03:00`);

type Resposta = Relatorio & { periodo: { de: string; ate: string } };

suite("rota dos relatórios", () => {
  let banco: typeof import("../src/lib/prisma");
  let relatorios: typeof import("../src/app/api/relatorios/route");

  const sessao = vi.mocked(getServerSession);
  const ids = { ADMIN: "", OPERATION: "", CLIENT: "", DRIVER: "" };
  let clienteId: string;
  let motoristaId: string;

  const entrarComo = (perfil: keyof typeof ids | null) =>
    sessao.mockResolvedValue(perfil ? { user: { id: ids[perfil], role: perfil, clientId: null } } : null);

  const pedir = (query = PERIODO) => relatorios.GET(new Request(`http://localhost/api/relatorios${query ? `?${query}` : ""}`));
  const ler = async (query = PERIODO) => {
    entrarComo("ADMIN");
    const res = await pedir(query);
    expect(res.status).toBe(200);
    return (await res.json()) as Resposta;
  };

  const meus = { description: { startsWith: PREFIXO } };

  async function limparMovimento() {
    const { sistema } = banco;
    await sistema.financialTransaction.deleteMany({ where: meus });
    await sistema.quoteLead.deleteMany({ where: { companyName: { startsWith: PREFIXO } } });
    await sistema.collection.deleteMany({ where: { client: { cnpj: { in: [CNPJ, CNPJ_DA_OUTRA] } } } });
  }

  async function limpar() {
    await limparMovimento();
    await banco.sistema.client.deleteMany({ where: { cnpj: { in: [CNPJ, CNPJ_DA_OUTRA] } } });
    await banco.sistema.driver.deleteMany({ where: { cpf: CPF } });
    await banco.sistema.user.deleteMany({ where: { email: { startsWith: PREFIXO } } });
  }

  /** Carga criada em `criadaEm`, com o histórico de coleta e de entrega nas datas dadas. */
  async function criarCarga({
    criadaEm,
    status = "DELIVERED",
    frete = 100,
    prazo = 24,
    coletadaEm = null,
    entregueEm = null,
    comMotorista = true,
  }: {
    criadaEm: Date;
    status?: string;
    frete?: number | null;
    prazo?: number | null;
    coletadaEm?: Date | null;
    entregueEm?: Date | null;
    comMotorista?: boolean;
  }) {
    const historico = [
      ...(coletadaEm ? [{ fromStatus: "CONFIRMED", toStatus: "COLLECTED", createdAt: coletadaEm }] : []),
      ...(entregueEm ? [{ fromStatus: "ROUTE", toStatus: "DELIVERED", createdAt: entregueEm }] : []),
    ];
    return banco.default.collection.create({
      data: {
        clientId: clienteId,
        driverId: comMotorista ? motoristaId : null,
        sender: "Remetente",
        receiver: "Destinatário",
        origin: "Rio Preto",
        destination: "Mirassol",
        volumes: 1,
        weight: 10,
        status,
        freightValue: frete,
        freightDeadlineHours: prazo,
        createdAt: criadaEm,
        statusHistory: { create: historico },
      },
    });
  }

  const lancar = (dados: { type: string; amount: number; status: string; paidAt?: Date; dueDate?: Date; category?: string }) =>
    banco.default.financialTransaction.create({ data: { description: `${PREFIXO}lançamento`, ...dados } });

  const cotar = (status: string, criadaEm: Date) =>
    banco.default.quoteLead.create({
      data: {
        companyName: `${PREFIXO}lead`,
        email: "lead@exemplo.br",
        phone: "1733330000",
        origin: "Rio Preto",
        destination: "Mirassol",
        volumes: 1,
        weight: 10,
        status,
        createdAt: criadaEm,
      },
    });

  beforeAll(async () => {
    banco = await import("../src/lib/prisma");
    relatorios = await import("../src/app/api/relatorios/route");
    await limpar();

    clienteId = (await banco.default.client.create({ data: { companyName: `${PREFIXO}cliente ltda`, tradeName: `${PREFIXO}fantasia`, cnpj: CNPJ } })).id;
    for (const perfil of ["ADMIN", "OPERATION", "CLIENT", "DRIVER"] as const) {
      ids[perfil] = (
        await banco.default.user.create({
          data: { name: `${PREFIXO}${perfil}`, email: `${PREFIXO}${perfil.toLowerCase()}@exemplo.br`, password: HASH_FALSO, role: perfil },
        })
      ).id;
    }
    motoristaId = (
      await banco.default.driver.create({
        data: { userId: ids.DRIVER, cpf: CPF, cnh: "44444444444", cnhExpiry: new Date("2031-06-30"), category: "C" },
      })
    ).id;
  });

  beforeEach(async () => {
    sessao.mockReset();
    await limparMovimento();
  });

  afterAll(async () => {
    if (banco) await limpar();
  });

  it("só o administrador: sem sessão 401; operação, cliente e motorista 403, sem vazar nada", async () => {
    await criarCarga({ criadaEm: em("2019-03-10") });

    for (const [perfil, esperado] of [[null, 401], ["OPERATION", 403], ["CLIENT", 403], ["DRIVER", 403]] as const) {
      entrarComo(perfil);
      const res = await pedir();
      expect(res.status, String(perfil)).toBe(esperado);
      expect(JSON.stringify(await res.json())).not.toContain(PREFIXO);
    }
  });

  it("período inválido é 400; sem período vale o mês corrente e os dois anteriores", async () => {
    entrarComo("ADMIN");
    for (const query of ["de=2019-04&ate=2019-03", "de=2019-3&ate=2019-04", "de=abc&ate=2019-04", "de=2015-01&ate=2019-04"]) {
      const res = await pedir(query);
      expect(res.status, query).toBe(400);
      expect((await res.json()).error).toMatch(/Período inválido/);
    }

    expect((await ler("")).periodo).toEqual(periodoDoRelatorio());
    // Chamada sem requisição, como o teste de permissões faz.
    expect((await relatorios.GET()).status).toBe(200);
  });

  it("período sem movimento: 200 com tudo zerado", async () => {
    const relatorio = await ler();
    expect(relatorio.periodo).toEqual({ de: "2019-03", ate: "2019-04" });
    expect(relatorio.operacional).toEqual({
      cargas: 0,
      porStatus: {},
      prazo: { entregas: 0, noPrazo: 0, foraDoPrazo: 0, semMedicao: 0, taxaNoPrazo: null, tempoMedioHoras: null },
      motoristas: [],
    });
    expect(relatorio.comercial).toEqual({ cotacoes: 0, porStatus: {}, conversao: null, frete: 0, clientes: [] });
    expect(relatorio.financeiro).toMatchObject({ recebido: 0, pago: 0, resultado: 0, despesasPorCategoria: [] });
  });

  it("operação: cargas pela data de criação e entregas pela data da entrega, cada uma no seu mês do Brasil", async () => {
    // Criada e entregue dentro do período, em 20 h: no prazo.
    await criarCarga({ criadaEm: em("2019-03-10"), coletadaEm: em("2019-03-11", "08:00"), entregueEm: em("2019-03-12", "04:00") });
    // Entregue em 30 h com prazo de 24: fora do prazo. Sem motorista.
    await criarCarga({ criadaEm: em("2019-04-01"), coletadaEm: em("2019-04-02", "08:00"), entregueEm: em("2019-04-03", "14:00"), comMotorista: false });
    // Criada antes do período e entregue dentro: entra só nas entregas. 23:30 de 30/04 no Brasil já é maio em UTC.
    await criarCarga({ criadaEm: em("2019-02-27"), coletadaEm: em("2019-04-30", "13:30"), entregueEm: em("2019-04-30", "23:30"), prazo: null });
    // Criada dentro e entregue depois do período: entra só nas cargas.
    await criarCarga({ criadaEm: em("2019-04-30", "23:30"), coletadaEm: em("2019-05-01", "08:00"), entregueEm: em("2019-05-01", "10:00") });
    // Ainda em rota e cancelada: contam como carga, não como entrega.
    await criarCarga({ criadaEm: em("2019-03-20"), status: "ROUTE", coletadaEm: em("2019-03-21") });
    await criarCarga({ criadaEm: em("2019-03-21"), status: "CANCELLED", frete: 999 });
    // Fora do período dos dois lados: 23:59 de fevereiro e 00:00 de maio, no Brasil.
    await criarCarga({ criadaEm: em("2019-02-28", "23:59"), entregueEm: em("2019-02-28", "23:59"), coletadaEm: em("2019-02-28", "10:00") });
    await criarCarga({ criadaEm: em("2019-05-01", "00:00"), status: "PENDING" });

    const { operacional, comercial } = await ler();

    expect(operacional.cargas).toBe(5);
    expect(operacional.porStatus).toEqual({ DELIVERED: 3, ROUTE: 1, CANCELLED: 1 });
    expect(operacional.prazo).toEqual({ entregas: 3, noPrazo: 1, foraDoPrazo: 1, semMedicao: 1, taxaNoPrazo: 50, tempoMedioHoras: 20 });
    expect(operacional.motoristas).toEqual([
      { chave: motoristaId, nome: `${PREFIXO}DRIVER`, entregas: 2, noPrazo: 1, foraDoPrazo: 0, semMedicao: 1, taxaNoPrazo: 100, tempoMedioHoras: 15 },
      { chave: "", nome: SEM_MOTORISTA, entregas: 1, noPrazo: 0, foraDoPrazo: 1, semMedicao: 0, taxaNoPrazo: 0, tempoMedioHoras: 30 },
    ]);

    // Frete das cargas criadas no período, sem a cancelada.
    expect(comercial.frete).toBe(400);
    expect(comercial.clientes).toEqual([{ clientId: clienteId, nome: `${PREFIXO}fantasia`, cargas: 4, peso: 40, frete: 400, aCotar: 0 }]);
  });

  it("comercial: cotações do período por status, e a conversão", async () => {
    await cotar("NEW", em("2019-03-05"));
    await cotar("CONVERTED", em("2019-03-06"));
    await cotar("LOST", em("2019-04-30", "23:59"));
    await cotar("CONVERTED", em("2019-04-10"));
    await cotar("CONVERTED", em("2019-05-01", "00:00"));
    await cotar("CONTACTED", em("2019-02-28", "23:59"));

    const { comercial } = await ler();
    expect(comercial.cotacoes).toBe(4);
    expect(comercial.porStatus).toEqual({ NEW: 1, CONVERTED: 2, LOST: 1 });
    expect(comercial.conversao).toBe(50);
  });

  it("financeiro: realizado pela data do pagamento, e a inadimplência é a posição de hoje", async () => {
    const antes = (await ler()).financeiro;

    await lancar({ type: "INCOME", amount: 1000, status: "PAID", paidAt: em("2019-03-15") });
    await lancar({ type: "EXPENSE", amount: 300, status: "PAID", paidAt: em("2019-04-30", "23:30"), category: "Combustível" });
    await lancar({ type: "EXPENSE", amount: 50, status: "PAID", paidAt: em("2019-04-02") });
    // Pago fora do período, e venceu no período mas segue em aberto: nenhum dos dois é realizado.
    await lancar({ type: "INCOME", amount: 7000, status: "PAID", paidAt: em("2019-05-01", "00:00") });
    await lancar({ type: "EXPENSE", amount: 9000, status: "PENDING", dueDate: new Date("2019-03-20T00:00:00.000Z") });
    // A receber em aberto: um vencido há anos, um sem vencimento.
    await lancar({ type: "INCOME", amount: 250, status: "PENDING", dueDate: new Date("2019-03-20T00:00:00.000Z") });
    await lancar({ type: "INCOME", amount: 750, status: "PENDING" });

    const { financeiro } = await ler();
    expect(financeiro.recebido).toBe(1000);
    expect(financeiro.pago).toBe(350);
    expect(financeiro.resultado).toBe(650);
    expect(financeiro.despesasPorCategoria).toEqual([
      { categoria: "Combustível", total: 300 },
      { categoria: SEM_CATEGORIA, total: 50 },
    ]);
    // O banco de teste pode ter títulos de outra origem: confere o que esta suite somou.
    expect(financeiro.aReceberEmAberto - antes.aReceberEmAberto).toBeCloseTo(1000, 2);
    expect(financeiro.vencido - antes.vencido).toBeCloseTo(250, 2);
    expect(financeiro.inadimplencia).not.toBeNull();
  });

  it("isolamento: carga, cotação e lançamento de outra empresa não entram no relatório", async () => {
    const { db } = banco.paraEmpresa(EMPRESA_OUTRA.id);
    const alheio = await db.client.create({ data: { companyName: `${PREFIXO}da outra`, cnpj: CNPJ_DA_OUTRA } });
    await db.collection.create({
      data: {
        clientId: alheio.id,
        sender: "Remetente",
        receiver: "Destinatário",
        origin: "Rio Preto",
        destination: "Mirassol",
        volumes: 1,
        weight: 10,
        status: "DELIVERED",
        freightValue: 5000,
        freightDeadlineHours: 24,
        createdAt: em("2019-03-10"),
        statusHistory: {
          create: [
            { fromStatus: "CONFIRMED", toStatus: "COLLECTED", createdAt: em("2019-03-11", "08:00") },
            { fromStatus: "ROUTE", toStatus: "DELIVERED", createdAt: em("2019-03-11", "10:00") },
          ],
        },
      },
    });
    await db.quoteLead.create({
      data: {
        companyName: `${PREFIXO}lead da outra`,
        email: "lead@exemplo.br",
        phone: "1733330000",
        origin: "Rio Preto",
        destination: "Mirassol",
        volumes: 1,
        weight: 10,
        status: "CONVERTED",
        createdAt: em("2019-03-10"),
      },
    });
    await db.financialTransaction.create({
      data: { description: `${PREFIXO}da outra`, type: "INCOME", amount: 5000, status: "PAID", paidAt: em("2019-03-10") },
    });

    const relatorio = await ler();
    expect(relatorio.operacional.cargas).toBe(0);
    expect(relatorio.operacional.prazo.entregas).toBe(0);
    expect(relatorio.comercial.cotacoes).toBe(0);
    expect(relatorio.financeiro.recebido).toBe(0);
    expect(JSON.stringify(relatorio)).not.toContain(PREFIXO);
  });
});
