import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getServerSession } from "next-auth";
import { diaNoBrasil } from "../src/lib/financeiro";
import { SEM_MOTORISTA } from "../src/lib/relatorios";
import { updateDriverSchema } from "../src/lib/cadastros";
import {
  ABSENCE_TYPES,
  ABSENCE_TYPE_LABEL,
  ADVANCE_REASONS,
  ADVANCE_REASON_LABEL,
  CATEGORIA_DO_ADIANTAMENTO,
  acertoDoAdiantamento,
  acertoPorExtenso,
  advanceActionSchema,
  ausenciaNoDia,
  ausentesNoDia,
  chaveDaPessoa,
  cobreODia,
  comAcerto,
  comissaoDoFrete,
  createAbsenceSchema,
  createAdvanceSchema,
  createHelperSchema,
  descricaoDaDespesa,
  diasDaAusencia,
  estaAusente,
  pessoaDaChave,
  produtividadeDaEquipe,
  semValores,
  updateAbsenceSchema,
  updateHelperSchema,
  type EntregaDaEquipe,
} from "../src/lib/equipe";
import { EMPRESA_OUTRA } from "./empresas-de-teste";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

const dia = (data: string) => new Date(`${data}T00:00:00.000Z`);

/** As contas da equipe, sem banco: linhas na mão, dia de referência na mão. */
describe("contas da equipe", () => {
  describe("pessoa", () => {
    it("a chave diz se é motorista ou ajudante, e volta a ser as duas colunas", () => {
      expect(chaveDaPessoa({ driverId: "m1", helperId: null })).toBe("motorista:m1");
      expect(chaveDaPessoa({ driverId: null, helperId: "a1" })).toBe("ajudante:a1");
      expect(pessoaDaChave("motorista:m1")).toEqual({ driverId: "m1", helperId: null });
      expect(pessoaDaChave("ajudante:a1")).toEqual({ driverId: null, helperId: "a1" });
    });

    it("chave vazia ou inventada não vira pessoa nenhuma", () => {
      for (const chave of ["", "motorista:", "gerente:x", "m1"]) {
        expect(pessoaDaChave(chave), chave).toEqual({ driverId: null, helperId: null });
      }
    });
  });

  describe("ausência", () => {
    const ferias = { startDate: dia("2026-10-10"), endDate: dia("2026-10-20") };

    it("cobre do primeiro ao último dia, os dois inclusive, e nada fora", () => {
      expect(cobreODia(ferias, "2026-10-09")).toBe(false);
      expect(cobreODia(ferias, "2026-10-10")).toBe(true);
      expect(cobreODia(ferias, "2026-10-15")).toBe(true);
      expect(cobreODia(ferias, "2026-10-20")).toBe(true);
      expect(cobreODia(ferias, "2026-10-21")).toBe(false);
    });

    it("o dia é o do calendário: lido em UTC, a data não volta um dia no fuso do Brasil", () => {
      const umDia = { startDate: "2026-10-15T00:00:00.000Z", endDate: "2026-10-15T00:00:00.000Z" };
      expect(cobreODia(umDia, "2026-10-15")).toBe(true);
      expect(cobreODia(umDia, "2026-10-14")).toBe(false);
      expect(diasDaAusencia(umDia)).toBe(1);
      expect(diasDaAusencia(ferias)).toBe(11);
      // Virada de mês.
      expect(diasDaAusencia({ startDate: dia("2026-01-30"), endDate: dia("2026-02-02") })).toBe(4);
    });

    it("está ausente no dia X: sem ausência não, e com duas no mesmo dia vale a que começou primeiro", () => {
      const atestado = { startDate: dia("2026-10-18"), endDate: dia("2026-10-25"), tipo: "atestado" };
      const comTipo = { ...ferias, tipo: "férias" };

      expect(estaAusente([], "2026-10-15")).toBe(false);
      expect(estaAusente([ferias], "2026-10-15")).toBe(true);
      expect(estaAusente([ferias], "2026-10-21")).toBe(false);
      expect(ausenciaNoDia([atestado, comTipo], "2026-10-19")?.tipo).toBe("férias");
      expect(ausenciaNoDia([atestado, comTipo], "2026-10-22")?.tipo).toBe("atestado");
      expect(ausenciaNoDia([atestado, comTipo], "2026-10-26")).toBeNull();
    });

    it("ausentes no dia: por pessoa, sem misturar motorista e ajudante de mesmo id", () => {
      const ausencias = [
        { driverId: "x", helperId: null, ...ferias },
        { driverId: null, helperId: "x", startDate: dia("2026-11-01"), endDate: dia("2026-11-02") },
        { driverId: null, helperId: "y", startDate: dia("2026-10-15"), endDate: dia("2026-10-15") },
      ];
      expect([...ausentesNoDia(ausencias, "2026-10-15").keys()].sort()).toEqual(["ajudante:y", "motorista:x"]);
      expect([...ausentesNoDia(ausencias, "2026-11-01").keys()]).toEqual(["ajudante:x"]);
      expect(ausentesNoDia(ausencias, "2026-12-01").size).toBe(0);
    });

    it("os cinco tipos têm rótulo", () => {
      expect(ABSENCE_TYPES.map((tipo) => ABSENCE_TYPE_LABEL[tipo])).toEqual(["Férias", "Folga", "Atestado", "Falta", "Outro"]);
    });
  });

  describe("adiantamento e acerto", () => {
    const reais = (valor: number) => `R$ ${valor.toFixed(2)}`;

    it("gastou menos devolve a sobra; gastou mais recebe o complemento; igual fica quitado", () => {
      expect(acertoDoAdiantamento(500, 420.5)).toEqual({ diferenca: 79.5, sentido: "devolver" });
      expect(acertoDoAdiantamento(500, 530.1)).toEqual({ diferenca: 30.1, sentido: "receber" });
      expect(acertoDoAdiantamento(500, 500)).toEqual({ diferenca: 0, sentido: "quitado" });
      expect(acertoDoAdiantamento(500, 0)).toEqual({ diferenca: 500, sentido: "devolver" });
      // Em centavos: 0,3 − 0,1 não vira 0,19999999999999998.
      expect(acertoDoAdiantamento(0.3, 0.1)).toEqual({ diferenca: 0.2, sentido: "devolver" });
    });

    it("por extenso, para a lista", () => {
      expect(acertoPorExtenso(acertoDoAdiantamento(500, 420.5), reais)).toBe("Devolve R$ 79.50");
      expect(acertoPorExtenso(acertoDoAdiantamento(500, 530), reais)).toBe("Recebe R$ 30.00");
      expect(acertoPorExtenso(acertoDoAdiantamento(500, 500), reais)).toBe("Quitado");
    });

    it("a rota devolve o acerto só do adiantamento já acertado", () => {
      expect(comAcerto({ amount: 100, spentAmount: null }).acerto).toBeNull();
      expect(comAcerto({ amount: 100, spentAmount: 0 }).acerto).toEqual({ diferenca: 100, sentido: "devolver" });
    });

    it("os três motivos têm rótulo, e a despesa do Financeiro leva o motivo e o nome", () => {
      expect(ADVANCE_REASONS.map((motivo) => ADVANCE_REASON_LABEL[motivo])).toEqual(["Adiantamento de viagem", "Vale", "Outro"]);
      expect(descricaoDaDespesa("TRIP", "João")).toBe("Adiantamento de viagem: João");
      expect(descricaoDaDespesa("VOUCHER", "Maria")).toBe("Vale: Maria");
      expect(CATEGORIA_DO_ADIANTAMENTO).toBe("Adiantamento");
    });
  });

  describe("produtividade e comissão", () => {
    const entrega = (horas: number | null, extra: Partial<EntregaDaEquipe> = {}): EntregaDaEquipe => ({
      entregueEm: new Date("2026-10-10T15:00:00.000Z"),
      coletadaEm: horas === null ? null : new Date(new Date("2026-10-10T15:00:00.000Z").getTime() - horas * 3_600_000),
      freightDeadlineHours: 24,
      motorista: { id: "m1", nome: "Ana" },
      weight: 10,
      freightValue: 100,
      ...extra,
    });

    it("comissão é o percentual do frete; sem percentual não há comissão, que é diferente de zero", () => {
      expect(comissaoDoFrete(1000, 5)).toBe(50);
      expect(comissaoDoFrete(333.33, 2.5)).toBe(8.33);
      expect(comissaoDoFrete(1000, 0)).toBe(0);
      expect(comissaoDoFrete(1000, null)).toBeNull();
      expect(comissaoDoFrete(1000, undefined)).toBeNull();
    });

    it("por motorista: viagens, entregas, prazo, peso, frete e comissão; quem entregou mais primeiro", () => {
      const linhas = produtividadeDaEquipe({
        motoristas: [
          { id: "m1", nome: "Ana", commissionPct: 10 },
          { id: "m2", nome: "Bruno", commissionPct: null },
          { id: "m3", nome: "Carla", commissionPct: 10 },
        ],
        viagens: [{ driverId: "m1" }, { driverId: "m1" }, { driverId: "m3" }],
        entregas: [
          entrega(10, { weight: 10.5, freightValue: 100.1 }),
          entrega(30, { weight: 20, freightValue: 200.2 }),
          entrega(null, { weight: 5, freightValue: null }),
          entrega(5, { motorista: { id: "m2", nome: "Bruno" }, weight: 7, freightValue: 80 }),
        ],
      });

      expect(linhas).toEqual([
        { driverId: "m1", nome: "Ana", viagens: 2, entregas: 3, noPrazo: 1, foraDoPrazo: 1, semMedicao: 1, taxaNoPrazo: 50, peso: 35.5, frete: 300.3, comissaoPct: 10, comissao: 30.03 },
        { driverId: "m2", nome: "Bruno", viagens: 0, entregas: 1, noPrazo: 1, foraDoPrazo: 0, semMedicao: 0, taxaNoPrazo: 100, peso: 7, frete: 80, comissaoPct: null, comissao: null },
        // Viagem sem entrega no período: aparece, com comissão zero (tem percentual, não teve frete).
        { driverId: "m3", nome: "Carla", viagens: 1, entregas: 0, noPrazo: 0, foraDoPrazo: 0, semMedicao: 0, taxaNoPrazo: null, peso: 0, frete: 0, comissaoPct: 10, comissao: 0 },
      ]);
    });

    it("entrega de carga sem motorista não some: fica numa linha à parte, sem comissão", () => {
      const linhas = produtividadeDaEquipe({
        motoristas: [{ id: "m1", nome: "Ana", commissionPct: 5 }],
        viagens: [],
        entregas: [entrega(10, { motorista: null, freightValue: 50 })],
      });
      expect(linhas.map((l) => [l.driverId, l.nome, l.entregas, l.frete, l.comissao])).toEqual([
        ["", SEM_MOTORISTA, 1, 50, null],
        ["m1", "Ana", 0, 0, 0],
      ]);
    });

    it("sem valores: a linha da operação não leva frete, percentual nem comissão", () => {
      const [linha] = produtividadeDaEquipe({ motoristas: [{ id: "m1", nome: "Ana", commissionPct: 5 }], viagens: [], entregas: [entrega(10)] });
      const contagens = semValores(linha);
      expect(contagens).toEqual({ driverId: "m1", nome: "Ana", viagens: 0, entregas: 1, noPrazo: 1, foraDoPrazo: 0, semMedicao: 0, taxaNoPrazo: 100, peso: 10 });
      expect(JSON.stringify(contagens)).not.toMatch(/frete|comissao/);
    });
  });

  describe("validação", () => {
    it("ajudante: nome e CPF com 11 dígitos, com ou sem máscara; telefone vazio vira nulo; CPF não se altera", () => {
      expect(createHelperSchema.parse({ name: "  José  ", cpf: "555.666.777-11", phone: "" })).toEqual({ name: "José", cpf: "55566677711", phone: null });
      for (const corpo of [{ name: "J", cpf: "55566677711" }, { name: "José", cpf: "123" }, { name: "José" }, { cpf: "55566677711" }, null]) {
        expect(createHelperSchema.safeParse(corpo).success, JSON.stringify(corpo)).toBe(false);
      }
      expect(updateHelperSchema.parse({ active: false })).toEqual({ active: false });
      expect(updateHelperSchema.safeParse({}).success).toBe(false);
      // CPF mandado na alteração é ignorado: não está no schema.
      expect(updateHelperSchema.parse({ name: "José", cpf: "00000000000" })).not.toHaveProperty("cpf");
    });

    it("ausência: de uma pessoa só, tipo da lista, e o último dia não antes do primeiro", () => {
      const base = { type: "VACATION", startDate: "2026-10-10", endDate: "2026-10-20" };
      const valida = createAbsenceSchema.parse({ driverId: "m1", helperId: "", ...base, notes: "" });
      expect(valida).toMatchObject({ driverId: "m1", helperId: null, type: "VACATION", notes: null });
      expect(valida.startDate.toISOString()).toBe("2026-10-10T00:00:00.000Z");
      expect(valida.endDate.toISOString()).toBe("2026-10-20T00:00:00.000Z");
      expect(createAbsenceSchema.safeParse({ helperId: "a1", ...base, endDate: "2026-10-10" }).success).toBe(true);

      for (const [corpo, mensagem] of [
        [{ ...base }, /motorista ou um ajudante/],
        [{ driverId: "m1", helperId: "a1", ...base }, /motorista ou um ajudante/],
        [{ driverId: "m1", ...base, endDate: "2026-10-09" }, /último dia não pode ser antes/],
        [{ driverId: "m1", ...base, type: "PASSEIO" }, /Tipo de ausência inválido/],
        [{ driverId: "m1", ...base, startDate: "10/10/2026" }, /primeiro dia/],
        [{ driverId: "m1", type: "VACATION", startDate: "2026-10-10" }, /último dia/],
      ] as const) {
        const recusada = createAbsenceSchema.safeParse(corpo);
        expect(recusada.success, JSON.stringify(corpo)).toBe(false);
        expect(recusada.error?.issues[0]?.message).toMatch(mensagem);
      }

      expect(updateAbsenceSchema.safeParse({ ...base, endDate: "2026-10-01" }).success).toBe(false);
      expect(updateAbsenceSchema.parse(base).type).toBe("VACATION");
    });

    it("adiantamento: de uma pessoa só, valor maior que zero, com vírgula; viagem e observação opcionais", () => {
      const base = { driverId: "m1", date: "2026-10-10", amount: "350,50", reason: "TRIP" };
      expect(createAdvanceSchema.parse({ ...base, manifestId: "", notes: "" })).toMatchObject({ driverId: "m1", amount: 350.5, reason: "TRIP", manifestId: null, notes: null });

      for (const corpo of [
        { ...base, amount: "0" },
        { ...base, amount: -10 },
        { ...base, amount: "abc" },
        { ...base, reason: "PRESENTE" },
        { ...base, date: "" },
        { ...base, driverId: "" },
        { ...base, helperId: "a1" },
      ]) {
        expect(createAdvanceSchema.safeParse(corpo).success, JSON.stringify(corpo)).toBe(false);
      }
    });

    it("acerto: gasto maior ou igual a zero; reabrir não leva valor; ação inventada é recusada", () => {
      expect(advanceActionSchema.parse({ action: "acertar", spentAmount: "0" })).toMatchObject({ action: "acertar", spentAmount: 0 });
      expect(advanceActionSchema.parse({ action: "acertar", spentAmount: "420,50" })).toMatchObject({ spentAmount: 420.5 });
      expect(advanceActionSchema.parse({ action: "reabrir" })).toEqual({ action: "reabrir" });
      for (const corpo of [{ action: "acertar" }, { action: "acertar", spentAmount: -1 }, { action: "acertar", spentAmount: "" }, { action: "apagar" }, {}]) {
        expect(advanceActionSchema.safeParse(corpo).success, JSON.stringify(corpo)).toBe(false);
      }
    });

    it("comissão do motorista: percentual de 0 a 100, com vírgula; vazio tira a comissão", () => {
      expect(updateDriverSchema.parse({ commissionPct: "2,5" })).toMatchObject({ commissionPct: 2.5 });
      expect(updateDriverSchema.parse({ commissionPct: "" })).toMatchObject({ commissionPct: null });
      expect(updateDriverSchema.parse({ commissionPct: 0 })).toMatchObject({ commissionPct: 0 });
      for (const commissionPct of [-1, 101, "abc"]) {
        expect(updateDriverSchema.safeParse({ commissionPct }).success, String(commissionPct)).toBe(false);
      }
    });
  });
});

/** As rotas da equipe, contra um Postgres de verdade. */
const temBanco = Boolean(process.env.DATABASE_URL);

if (!temBanco) {
  console.warn("\n[equipe.test] DATABASE_URL ausente: testes de integração PULADOS.\n");
}

const suite = temBanco ? describe : describe.skip;

// Tudo o que esta suite cria usa estes marcadores, e só isso é apagado.
const PREFIXO = "teste-equipe-";
const CNPJ = "99444333000177";
const CNPJ_DA_OUTRA = "99444333000188";
const CPF_MOTORISTA = "55566677701";
const CPF_MOTORISTA_DA_OUTRA = "55566677702";
const CPF_AJUDANTE = "55566677711";
const CPF_SEGUNDO = "55566677712";
const CPF_AJUDANTE_DA_OUTRA = "55566677713";
const CPFS_DE_AJUDANTE = [CPF_AJUDANTE, CPF_SEGUNDO, CPF_AJUDANTE_DA_OUTRA];
const PLACA = "RHT1A23";
const PLACA_DA_OUTRA = "RHT1A24";
const HASH_FALSO = "$2b$10$hashfalsoparateste000000000000000000000000000000000";
const SEM_ID = "00000000-0000-0000-0000-000000000000";

type Corpo = Record<string, unknown> & { id: string; error?: string };

suite("rotas da equipe", () => {
  let banco: typeof import("../src/lib/prisma");
  let equipe: typeof import("../src/app/api/equipe/route");
  let ajudantes: typeof import("../src/app/api/equipe/ajudantes/route");
  let ajudantePorId: typeof import("../src/app/api/equipe/ajudantes/[id]/route");
  let ausencias: typeof import("../src/app/api/equipe/ausencias/route");
  let ausenciaPorId: typeof import("../src/app/api/equipe/ausencias/[id]/route");
  let adiantamentos: typeof import("../src/app/api/equipe/adiantamentos/route");
  let adiantamentoPorId: typeof import("../src/app/api/equipe/adiantamentos/[id]/route");
  let produtividade: typeof import("../src/app/api/equipe/produtividade/route");
  let motoristas: typeof import("../src/app/api/motoristas/route");
  let motoristaPorId: typeof import("../src/app/api/motoristas/[id]/route");
  let manifestos: typeof import("../src/app/api/manifestos/route");
  let veiculos: typeof import("../src/app/api/veiculos/route");
  let coletas: typeof import("../src/app/api/coletas/route");

  const sessao = vi.mocked(getServerSession);
  const ids = { ADMIN: "", OPERATION: "", CLIENT: "", DRIVER: "" };
  let clienteId: string;
  let motoristaId: string;
  let veiculoId: string;
  let ajudanteId: string;
  const daOutra = { motoristaId: "", ajudanteId: "", veiculoId: "", clienteId: "" };

  const entrarComo = (perfil: keyof typeof ids | null) =>
    sessao.mockResolvedValue(perfil ? { user: { id: ids[perfil], role: perfil, clientId: null } } : null);

  const req = (method = "GET", body?: unknown, query = "") =>
    new Request(`http://localhost/api/teste${query}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

  const nome = (n: string) => `${PREFIXO}${n}`;
  const em = (data: string, hora = "12:00") => new Date(`${data}T${hora}:00-03:00`);

  // Dia do calendário a `n` dias de hoje, no relógio do Brasil.
  const HOJE = diaNoBrasil(new Date());
  const daquiA = (n: number) => new Date(dia(HOJE).getTime() + n * 86_400_000).toISOString().slice(0, 10);

  async function limparMovimento() {
    const { sistema } = banco;
    const daSuite = { OR: [{ driver: { cpf: { in: [CPF_MOTORISTA, CPF_MOTORISTA_DA_OUTRA] } } }, { helper: { cpf: { in: CPFS_DE_AJUDANTE } } }] };
    await sistema.crewAdvance.deleteMany({ where: daSuite });
    await sistema.absence.deleteMany({ where: daSuite });
    await sistema.financialTransaction.deleteMany({ where: { counterparty: { startsWith: PREFIXO } } });
    await sistema.collection.deleteMany({ where: { client: { cnpj: { in: [CNPJ, CNPJ_DA_OUTRA] } } } });
    await sistema.manifest.deleteMany({ where: { vehicle: { plate: { in: [PLACA, PLACA_DA_OUTRA] } } } });
    // Só o ajudante fixo da suite fica de um teste para o outro.
    await sistema.helper.deleteMany({ where: { cpf: CPF_SEGUNDO } });
    await sistema.auditLog.deleteMany({ where: { userName: { startsWith: PREFIXO } } });
  }

  async function limpar() {
    const { sistema } = banco;
    await limparMovimento();
    await sistema.vehicle.deleteMany({ where: { plate: { in: [PLACA, PLACA_DA_OUTRA] } } });
    await sistema.helper.deleteMany({ where: { cpf: { in: CPFS_DE_AJUDANTE } } });
    await sistema.driver.deleteMany({ where: { cpf: { in: [CPF_MOTORISTA, CPF_MOTORISTA_DA_OUTRA] } } });
    await sistema.client.deleteMany({ where: { cnpj: { in: [CNPJ, CNPJ_DA_OUTRA] } } });
    await sistema.user.deleteMany({ where: { email: { startsWith: PREFIXO } } });
  }

  const chamar = async (resposta: Promise<Response>) => {
    const res = await resposta;
    return { status: res.status, corpo: (await res.json()) as Corpo };
  };

  const AUSENCIA = { type: "VACATION", startDate: "2026-03-10", endDate: "2026-03-20", notes: "" };
  const ADIANTAMENTO = { date: "2026-03-10", amount: "500", reason: "TRIP" };

  const registrarAusencia = (corpo: Record<string, unknown>, perfil: keyof typeof ids = "OPERATION") => {
    entrarComo(perfil);
    return chamar(ausencias.POST(req("POST", { ...AUSENCIA, ...corpo })));
  };
  const registrarAdiantamento = (corpo: Record<string, unknown> = {}) => {
    entrarComo("ADMIN");
    return chamar(adiantamentos.POST(req("POST", { driverId: motoristaId, ...ADIANTAMENTO, ...corpo })));
  };
  const agirNoAdiantamento = (id: string, corpo: Record<string, unknown>) => {
    entrarComo("ADMIN");
    return chamar(adiantamentoPorId.PATCH(req("PATCH", corpo), ctx(id)));
  };
  const trilha = (entityId: string) =>
    banco.sistema.auditLog.findMany({ where: { entityId }, orderBy: { createdAt: "asc" }, select: { action: true, userId: true, before: true, after: true, summary: true } });

  beforeAll(async () => {
    banco = await import("../src/lib/prisma");
    equipe = await import("../src/app/api/equipe/route");
    ajudantes = await import("../src/app/api/equipe/ajudantes/route");
    ajudantePorId = await import("../src/app/api/equipe/ajudantes/[id]/route");
    ausencias = await import("../src/app/api/equipe/ausencias/route");
    ausenciaPorId = await import("../src/app/api/equipe/ausencias/[id]/route");
    adiantamentos = await import("../src/app/api/equipe/adiantamentos/route");
    adiantamentoPorId = await import("../src/app/api/equipe/adiantamentos/[id]/route");
    produtividade = await import("../src/app/api/equipe/produtividade/route");
    motoristas = await import("../src/app/api/motoristas/route");
    motoristaPorId = await import("../src/app/api/motoristas/[id]/route");
    manifestos = await import("../src/app/api/manifestos/route");
    veiculos = await import("../src/app/api/veiculos/route");
    coletas = await import("../src/app/api/coletas/route");
    await limpar();

    const db = banco.default;
    for (const perfil of ["ADMIN", "OPERATION", "CLIENT", "DRIVER"] as const) {
      ids[perfil] = (
        await db.user.create({ data: { name: nome(perfil), email: `${PREFIXO}${perfil.toLowerCase()}@exemplo.br`, password: HASH_FALSO, role: perfil } })
      ).id;
    }
    clienteId = (await db.client.create({ data: { companyName: nome("cliente"), cnpj: CNPJ } })).id;
    motoristaId = (await db.driver.create({ data: { userId: ids.DRIVER, cpf: CPF_MOTORISTA, cnh: "66666666601", cnhExpiry: new Date("2031-06-30"), category: "C" } })).id;
    veiculoId = (await db.vehicle.create({ data: { plate: PLACA, model: nome("caminhão"), type: "TRUCK", driverId: motoristaId } })).id;
    ajudanteId = (await db.helper.create({ data: { name: nome("ajudante"), cpf: CPF_AJUDANTE, phone: "1733330000" } })).id;

    const outra = banco.paraEmpresa(EMPRESA_OUTRA.id).db;
    const usuario = await outra.user.create({ data: { name: nome("motorista da outra"), email: `${PREFIXO}outra@exemplo.br`, password: HASH_FALSO, role: "DRIVER" } });
    daOutra.motoristaId = (
      await outra.driver.create({ data: { userId: usuario.id, cpf: CPF_MOTORISTA_DA_OUTRA, cnh: "66666666602", cnhExpiry: new Date("2031-06-30"), category: "C", commissionPct: 50 } })
    ).id;
    daOutra.ajudanteId = (await outra.helper.create({ data: { name: nome("ajudante da outra"), cpf: CPF_AJUDANTE_DA_OUTRA } })).id;
    daOutra.veiculoId = (await outra.vehicle.create({ data: { plate: PLACA_DA_OUTRA, model: nome("da outra"), type: "TRUCK" } })).id;
    daOutra.clienteId = (await outra.client.create({ data: { companyName: nome("cliente da outra"), cnpj: CNPJ_DA_OUTRA } })).id;
  });

  beforeEach(async () => {
    sessao.mockReset();
    await limparMovimento();
    await banco.sistema.driver.update({ where: { id: motoristaId }, data: { commissionPct: null, active: true } });
    await banco.sistema.helper.update({ where: { id: ajudanteId }, data: { name: nome("ajudante"), phone: "1733330000", active: true } });
  });

  afterAll(async () => {
    if (banco) await limpar();
  });

  describe("permissão", () => {
    it("pessoas, ajudantes, ausências e produtividade são da equipe interna: sem sessão 401; cliente e motorista 403", async () => {
      const ausencia = (await registrarAusencia({ driverId: motoristaId })).corpo;
      const rotas: [string, () => Promise<Response>][] = [
        ["GET /api/equipe", () => equipe.GET()],
        ["GET ajudantes", () => ajudantes.GET()],
        ["POST ajudantes", () => ajudantes.POST(req("POST", { name: nome("invasor"), cpf: CPF_SEGUNDO }))],
        ["PATCH ajudantes/[id]", () => ajudantePorId.PATCH(req("PATCH", { active: false }), ctx(ajudanteId))],
        ["GET ausencias", () => ausencias.GET()],
        ["POST ausencias", () => ausencias.POST(req("POST", { helperId: ajudanteId, ...AUSENCIA }))],
        ["PATCH ausencias/[id]", () => ausenciaPorId.PATCH(req("PATCH", { ...AUSENCIA, type: "MISSED" }), ctx(ausencia.id))],
        ["DELETE ausencias/[id]", () => ausenciaPorId.DELETE(req("DELETE"), ctx(ausencia.id))],
        ["GET produtividade", () => produtividade.GET()],
      ];

      for (const [perfil, esperado] of [[null, 401], ["CLIENT", 403], ["DRIVER", 403]] as const) {
        for (const [rota, pedir] of rotas) {
          entrarComo(perfil);
          expect((await pedir()).status, `${rota} como ${perfil}`).toBe(esperado);
        }
      }

      expect(await banco.default.helper.count({ where: { cpf: CPF_SEGUNDO } })).toBe(0);
      expect((await banco.default.helper.findUniqueOrThrow({ where: { id: ajudanteId } })).active).toBe(true);
      expect(await banco.default.absence.findMany({ select: { id: true, type: true } })).toEqual([{ id: ausencia.id, type: "VACATION" }]);
    });

    it("adiantamentos são dinheiro: só o administrador; operação, cliente e motorista 403, sem vazar nada", async () => {
      const adiantamento = (await registrarAdiantamento()).corpo;
      const rotas: [string, () => Promise<Response>][] = [
        ["GET adiantamentos", () => adiantamentos.GET()],
        ["POST adiantamentos", () => adiantamentos.POST(req("POST", { helperId: ajudanteId, ...ADIANTAMENTO, amount: "999" }))],
        ["PATCH adiantamentos/[id]", () => adiantamentoPorId.PATCH(req("PATCH", { action: "acertar", spentAmount: "1" }), ctx(adiantamento.id))],
      ];

      for (const [perfil, esperado] of [[null, 401], ["OPERATION", 403], ["CLIENT", 403], ["DRIVER", 403]] as const) {
        for (const [rota, pedir] of rotas) {
          entrarComo(perfil);
          const res = await pedir();
          expect(res.status, `${rota} como ${perfil}`).toBe(esperado);
          expect(JSON.stringify(await res.json())).not.toContain("500");
        }
      }

      expect(await banco.default.crewAdvance.findMany({ select: { id: true, status: true, amount: true } })).toEqual([{ id: adiantamento.id, status: "OPEN", amount: 500 }]);
    });
  });

  describe("ajudantes", () => {
    it("cadastra com CPF normalizado e registra na auditoria; a lista traz os da empresa em ordem de nome", async () => {
      entrarComo("OPERATION");
      const criado = await chamar(ajudantes.POST(req("POST", { name: `  ${nome("zé")}  `, cpf: "555.666.777-12", phone: "" })));
      expect(criado.status).toBe(201);
      expect(criado.corpo).toMatchObject({ name: nome("zé"), cpf: CPF_SEGUNDO, phone: null, active: true });

      const [linha] = await trilha(criado.corpo.id);
      expect(linha).toMatchObject({ action: "ajudante.criar", userId: ids.OPERATION, after: { name: nome("zé"), cpf: CPF_SEGUNDO, active: true } });

      entrarComo("OPERATION");
      const lista = (await (await ajudantes.GET()).json()) as Corpo[];
      expect(lista.filter((a) => String(a.name).startsWith(PREFIXO)).map((a) => a.cpf)).toEqual([CPF_AJUDANTE, CPF_SEGUNDO]);
      expect(JSON.stringify(lista)).not.toContain(CPF_AJUDANTE_DA_OUTRA);
    });

    it("recusa dado inválido (400) e CPF repetido na empresa (409); o mesmo CPF em outra empresa não atrapalha", async () => {
      for (const corpo of [{}, { name: nome("x") }, { name: nome("x"), cpf: "123" }, { name: "x", cpf: CPF_SEGUNDO }]) {
        entrarComo("ADMIN");
        expect((await ajudantes.POST(req("POST", corpo))).status, JSON.stringify(corpo)).toBe(400);
      }

      entrarComo("ADMIN");
      const repetido = await chamar(ajudantes.POST(req("POST", { name: nome("clone"), cpf: CPF_AJUDANTE })));
      expect(repetido).toMatchObject({ status: 409, corpo: { error: "Já existe um ajudante com este CPF." } });

      // O CPF do ajudante da outra empresa está livre nesta: a unicidade é por empresa.
      await banco.sistema.helper.deleteMany({ where: { cpf: CPF_SEGUNDO } });
      await banco.paraEmpresa(EMPRESA_OUTRA.id).db.helper.create({ data: { name: nome("homônimo"), cpf: CPF_SEGUNDO } });
      entrarComo("ADMIN");
      expect((await ajudantes.POST(req("POST", { name: nome("zé"), cpf: CPF_SEGUNDO }))).status).toBe(201);
    });

    it("altera nome e telefone, desativa e reativa, com a auditoria de cada passo; o CPF não muda", async () => {
      const alterar = (corpo: unknown) => {
        entrarComo("OPERATION");
        return chamar(ajudantePorId.PATCH(req("PATCH", corpo), ctx(ajudanteId)));
      };

      expect((await alterar({ name: nome("renomeado"), phone: "", cpf: "00000000000" })).corpo).toMatchObject({ name: nome("renomeado"), phone: null, cpf: CPF_AJUDANTE });
      expect((await alterar({ active: false })).corpo).toMatchObject({ active: false });
      expect((await alterar({ active: true })).corpo).toMatchObject({ active: true });
      // Gravar o que já está não deixa linha.
      expect((await alterar({ active: true })).status).toBe(200);
      expect((await alterar({})).status).toBe(400);
      expect((await alterar({ name: "x" })).status).toBe(400);

      expect((await trilha(ajudanteId)).map((l) => l.action)).toEqual(["ajudante.alterar", "ajudante.desativar", "ajudante.reativar"]);
    });

    it("isolamento: ajudante de outra empresa responde 404, como um id inventado, e não muda", async () => {
      for (const id of [daOutra.ajudanteId, SEM_ID]) {
        entrarComo("ADMIN");
        const res = await chamar(ajudantePorId.PATCH(req("PATCH", { active: false }), ctx(id)));
        expect(res).toMatchObject({ status: 404, corpo: { error: "Ajudante não encontrado." } });
      }
      expect((await banco.sistema.helper.findUniqueOrThrow({ where: { id: daOutra.ajudanteId } })).active).toBe(true);
    });
  });

  describe("ausências", () => {
    it("registra para motorista e para ajudante, com o dia gravado à meia-noite UTC e a auditoria", async () => {
      const doMotorista = await registrarAusencia({ driverId: motoristaId, notes: "  viagem  " });
      expect(doMotorista.status).toBe(201);
      expect(doMotorista.corpo).toMatchObject({
        type: "VACATION",
        startDate: "2026-03-10T00:00:00.000Z",
        endDate: "2026-03-20T00:00:00.000Z",
        notes: "viagem",
        driverId: motoristaId,
        helperId: null,
        driver: { id: motoristaId, user: { name: nome("DRIVER") } },
        helper: null,
      });

      const doAjudante = await registrarAusencia({ helperId: ajudanteId, type: "SICK_NOTE" });
      expect(doAjudante.corpo).toMatchObject({ type: "SICK_NOTE", driverId: null, helper: { id: ajudanteId, name: nome("ajudante") } });

      const [linha] = await trilha(doMotorista.corpo.id);
      expect(linha).toMatchObject({ action: "ausencia.registrar", userId: ids.OPERATION, after: { driverId: motoristaId, type: "VACATION" } });
      expect(linha.summary).toContain(nome("DRIVER"));
    });

    it("recusa (400) sem gravar: sem pessoa, com as duas, período invertido, tipo inventado, e pessoa de outra empresa ou inexistente", async () => {
      for (const corpo of [
        {},
        { driverId: motoristaId, helperId: ajudanteId },
        { driverId: motoristaId, endDate: "2026-03-09" },
        { driverId: motoristaId, type: "PASSEIO" },
        { driverId: daOutra.motoristaId },
        { helperId: daOutra.ajudanteId },
        { driverId: SEM_ID },
      ]) {
        expect((await registrarAusencia(corpo)).status, JSON.stringify(corpo)).toBe(400);
      }
      expect(await banco.sistema.absence.count({ where: { OR: [{ driverId: { in: [motoristaId, daOutra.motoristaId] } }, { helperId: { in: [ajudanteId, daOutra.ajudanteId] } }] } })).toBe(0);
    });

    it("filtro por dia: só as ausências que cobrem aquele dia; dia malformado é 400", async () => {
      const ferias = (await registrarAusencia({ driverId: motoristaId })).corpo;
      const folga = (await registrarAusencia({ helperId: ajudanteId, type: "DAY_OFF", startDate: "2026-03-20", endDate: "2026-03-20" })).corpo;

      const noDia = async (valor: string) => {
        entrarComo("OPERATION");
        const res = await ausencias.GET(req("GET", undefined, `?dia=${valor}`));
        expect(res.status).toBe(200);
        return ((await res.json()) as Corpo[]).map((a) => a.id).sort();
      };

      expect(await noDia("2026-03-09")).toEqual([]);
      expect(await noDia("2026-03-10")).toEqual([ferias.id]);
      expect(await noDia("2026-03-20")).toEqual([ferias.id, folga.id].sort());
      expect(await noDia("2026-03-21")).toEqual([]);

      for (const valor of ["20/03/2026", "2026-13-45", "hoje", ""]) {
        entrarComo("OPERATION");
        expect((await ausencias.GET(req("GET", undefined, `?dia=${valor}`))).status, valor).toBe(400);
      }

      // Sem filtro: todas, da que começa mais tarde para a mais antiga.
      entrarComo("OPERATION");
      expect(((await (await ausencias.GET()).json()) as Corpo[]).map((a) => a.id)).toEqual([folga.id, ferias.id]);
    });

    it("quem está ausente hoje aparece na lista de pessoas; quem volta amanhã ou saiu ontem, não", async () => {
      await registrarAusencia({ driverId: motoristaId, type: "SICK_NOTE", startDate: daquiA(-2), endDate: daquiA(0) });
      await registrarAusencia({ helperId: ajudanteId, startDate: daquiA(-5), endDate: daquiA(-1) });
      await registrarAusencia({ helperId: ajudanteId, startDate: daquiA(1), endDate: daquiA(3) });

      entrarComo("OPERATION");
      const res = await equipe.GET();
      expect(res.status).toBe(200);
      const { hoje, pessoas } = (await res.json()) as { hoje: string; pessoas: (Corpo & { chave: string; ausencia: { type: string } | null })[] };
      expect(hoje).toBe(HOJE);

      const minhas = pessoas.filter((p) => String(p.nome).startsWith(PREFIXO));
      expect(minhas.map((p) => [p.chave, p.tipo, p.nome, p.cpf, p.ativo, p.ausencia?.type ?? null])).toEqual([
        [`ajudante:${ajudanteId}`, "ajudante", nome("ajudante"), CPF_AJUDANTE, true, null],
        [`motorista:${motoristaId}`, "motorista", nome("DRIVER"), CPF_MOTORISTA, true, "SICK_NOTE"],
      ]);
      // Não é tela de dinheiro, e não mostra gente de outra empresa.
      expect(JSON.stringify(pessoas)).not.toMatch(/commissionPct|da outra/);
    });

    it("altera tipo, período e observação; apaga; e a auditoria guarda o antes e o depois", async () => {
      const ausencia = (await registrarAusencia({ driverId: motoristaId })).corpo;

      entrarComo("OPERATION");
      const alterada = await chamar(ausenciaPorId.PATCH(req("PATCH", { type: "DAY_OFF", startDate: "2026-03-12", endDate: "2026-03-12", notes: "trocou" }), ctx(ausencia.id)));
      expect(alterada.corpo).toMatchObject({ type: "DAY_OFF", startDate: "2026-03-12T00:00:00.000Z", endDate: "2026-03-12T00:00:00.000Z", notes: "trocou", driverId: motoristaId });

      entrarComo("OPERATION");
      expect((await ausenciaPorId.PATCH(req("PATCH", { type: "DAY_OFF", startDate: "2026-03-12", endDate: "2026-03-11" }), ctx(ausencia.id))).status).toBe(400);

      entrarComo("OPERATION");
      expect(await chamar(ausenciaPorId.DELETE(req("DELETE"), ctx(ausencia.id)))).toMatchObject({ status: 200, corpo: { excluido: true } });
      expect(await banco.default.absence.findUnique({ where: { id: ausencia.id } })).toBeNull();
      entrarComo("OPERATION");
      expect((await ausenciaPorId.DELETE(req("DELETE"), ctx(ausencia.id))).status).toBe(404);

      const linhas = await trilha(ausencia.id);
      expect(linhas.map((l) => l.action)).toEqual(["ausencia.registrar", "ausencia.alterar", "ausencia.excluir"]);
      expect(linhas[1].before).toMatchObject({ type: "VACATION", startDate: "2026-03-10T00:00:00.000Z" });
      expect(linhas[1].after).toMatchObject({ type: "DAY_OFF", startDate: "2026-03-12T00:00:00.000Z", notes: "trocou" });
      expect(linhas[2].before).toMatchObject({ type: "DAY_OFF", driverId: motoristaId });
    });

    it("isolamento: ausência de outra empresa não aparece na lista, e alterar ou apagar responde 404", async () => {
      const alheia = await banco.paraEmpresa(EMPRESA_OUTRA.id).db.absence.create({
        data: { driverId: daOutra.motoristaId, type: "VACATION", startDate: dia(daquiA(-1)), endDate: dia(daquiA(1)) },
      });

      entrarComo("ADMIN");
      expect(JSON.stringify(await (await ausencias.GET()).json())).not.toContain(alheia.id);
      entrarComo("ADMIN");
      expect(JSON.stringify(await (await ausencias.GET(req("GET", undefined, `?dia=${HOJE}`))).json())).not.toContain(alheia.id);
      entrarComo("ADMIN");
      expect(JSON.stringify(await (await equipe.GET()).json())).not.toContain(daOutra.motoristaId);

      entrarComo("ADMIN");
      expect((await ausenciaPorId.PATCH(req("PATCH", { ...AUSENCIA }), ctx(alheia.id))).status).toBe(404);
      entrarComo("ADMIN");
      expect((await ausenciaPorId.DELETE(req("DELETE"), ctx(alheia.id))).status).toBe(404);
      expect(await banco.sistema.absence.findUnique({ where: { id: alheia.id } })).toMatchObject({ type: "VACATION" });
    });
  });

  describe("adiantamentos e acertos", () => {
    const despesas = () =>
      banco.default.financialTransaction.findMany({
        where: { counterparty: { startsWith: PREFIXO } },
        select: { type: true, amount: true, description: true, dueDate: true, status: true, category: true, counterparty: true },
      });

    it("registrar grava o adiantamento em aberto e lança a despesa no Financeiro, categoria Adiantamento", async () => {
      const viagem = await banco.default.manifest.create({ data: { driverId: motoristaId, vehicleId: veiculoId } });
      const { status, corpo } = await registrarAdiantamento({ amount: "350,50", manifestId: viagem.id, notes: "  pedágio e diesel " });

      expect(status).toBe(201);
      expect(corpo).toMatchObject({
        date: "2026-03-10T00:00:00.000Z",
        amount: 350.5,
        reason: "TRIP",
        status: "OPEN",
        spentAmount: null,
        settledAt: null,
        notes: "pedágio e diesel",
        manifestId: viagem.id,
        driver: { id: motoristaId },
        helper: null,
        acerto: null,
      });

      expect(await despesas()).toEqual([
        {
          type: "EXPENSE",
          amount: 350.5,
          description: `Adiantamento de viagem: ${nome("DRIVER")}`,
          dueDate: dia("2026-03-10"),
          status: "PENDING",
          category: "Adiantamento",
          counterparty: nome("DRIVER"),
        },
      ]);

      const [linha] = await trilha(corpo.id);
      expect(linha).toMatchObject({ action: "adiantamento.registrar", userId: ids.ADMIN, after: { driverId: motoristaId, amount: 350.5, reason: "TRIP", status: "OPEN" } });
    });

    it("vale para ajudante, sem viagem: a despesa leva o nome dele", async () => {
      const { status, corpo } = await registrarAdiantamento({ driverId: "", helperId: ajudanteId, reason: "VOUCHER", amount: 80 });
      expect(status).toBe(201);
      expect(corpo).toMatchObject({ reason: "VOUCHER", driver: null, helper: { id: ajudanteId }, manifestId: null });
      expect((await despesas()).map((d) => [d.description, d.amount])).toEqual([[`Vale: ${nome("ajudante")}`, 80]]);
    });

    it("recusa (400) sem gravar nem lançar despesa: valor inválido, sem pessoa, pessoa ou viagem de outra empresa", async () => {
      const viagemDaOutra = await banco.paraEmpresa(EMPRESA_OUTRA.id).db.manifest.create({ data: { driverId: daOutra.motoristaId, vehicleId: daOutra.veiculoId } });

      for (const corpo of [
        { amount: "0" },
        { amount: "-5" },
        { reason: "PRESENTE" },
        { driverId: "" },
        { helperId: ajudanteId },
        { driverId: daOutra.motoristaId },
        { driverId: "", helperId: daOutra.ajudanteId },
        { manifestId: viagemDaOutra.id },
        { manifestId: SEM_ID },
      ]) {
        expect((await registrarAdiantamento(corpo)).status, JSON.stringify(corpo)).toBe(400);
      }
      expect(await banco.sistema.crewAdvance.count({ where: { OR: [{ driverId: { in: [motoristaId, daOutra.motoristaId] } }, { helperId: { in: [ajudanteId, daOutra.ajudanteId] } }] } })).toBe(0);
      expect(await despesas()).toEqual([]);
    });

    it("acerto: gastou menos devolve, gastou mais recebe, igual quita; acertar duas vezes é 409", async () => {
      const menos = (await registrarAdiantamento()).corpo;
      const mais = (await registrarAdiantamento()).corpo;
      const igual = (await registrarAdiantamento()).corpo;

      const acertado = await agirNoAdiantamento(menos.id, { action: "acertar", spentAmount: "420,50", notes: "notas conferidas" });
      expect(acertado.status).toBe(200);
      expect(acertado.corpo).toMatchObject({ status: "SETTLED", spentAmount: 420.5, notes: "notas conferidas", acerto: { diferenca: 79.5, sentido: "devolver" } });
      expect(Date.now() - new Date(String(acertado.corpo.settledAt)).getTime()).toBeLessThan(60_000);

      expect((await agirNoAdiantamento(mais.id, { action: "acertar", spentAmount: 530 })).corpo.acerto).toEqual({ diferenca: 30, sentido: "receber" });
      expect((await agirNoAdiantamento(igual.id, { action: "acertar", spentAmount: "500" })).corpo.acerto).toEqual({ diferenca: 0, sentido: "quitado" });

      const deNovo = await agirNoAdiantamento(menos.id, { action: "acertar", spentAmount: "1" });
      expect(deNovo).toMatchObject({ status: 409, corpo: { error: "Este adiantamento já foi acertado." } });
      expect((await banco.default.crewAdvance.findUniqueOrThrow({ where: { id: menos.id } })).spentAmount).toBe(420.5);

      // O acerto não mexe na despesa lançada no registro.
      expect((await despesas()).map((d) => [d.amount, d.status])).toEqual([[500, "PENDING"], [500, "PENDING"], [500, "PENDING"]]);

      entrarComo("ADMIN");
      const lista = (await (await adiantamentos.GET()).json()) as (Corpo & { acerto: { sentido: string } | null })[];
      expect(lista.filter((a) => [menos.id, mais.id, igual.id].includes(a.id)).map((a) => a.acerto?.sentido).sort()).toEqual(["devolver", "quitado", "receber"]);
    });

    it("reabrir desfaz o acerto; só vale no acertado; dado inválido é 400; e a auditoria conta a história", async () => {
      const { corpo } = await registrarAdiantamento();

      expect((await agirNoAdiantamento(corpo.id, { action: "reabrir" })).status).toBe(409);
      for (const invalido of [{}, { action: "acertar" }, { action: "acertar", spentAmount: "-1" }, { action: "apagar" }]) {
        expect((await agirNoAdiantamento(corpo.id, invalido)).status, JSON.stringify(invalido)).toBe(400);
      }

      await agirNoAdiantamento(corpo.id, { action: "acertar", spentAmount: "100" });
      const reaberto = await agirNoAdiantamento(corpo.id, { action: "reabrir" });
      expect(reaberto.corpo).toMatchObject({ status: "OPEN", spentAmount: null, settledAt: null, acerto: null });

      const linhas = await trilha(corpo.id);
      expect(linhas.map((l) => l.action)).toEqual(["adiantamento.registrar", "adiantamento.acertar", "adiantamento.reabrir"]);
      expect(linhas[1].before).toMatchObject({ status: "OPEN" });
      expect(linhas[1].after).toMatchObject({ status: "SETTLED", spentAmount: 100 });
      expect(linhas[2].after).toMatchObject({ status: "OPEN" });
    });

    it("isolamento: adiantamento de outra empresa não aparece na lista e acertar responde 404", async () => {
      const alheio = await banco.paraEmpresa(EMPRESA_OUTRA.id).db.crewAdvance.create({
        data: { driverId: daOutra.motoristaId, date: dia("2026-03-10"), amount: 777, reason: "TRIP" },
      });

      entrarComo("ADMIN");
      expect(JSON.stringify(await (await adiantamentos.GET()).json())).not.toContain(alheio.id);
      for (const id of [alheio.id, SEM_ID]) {
        expect(await agirNoAdiantamento(id, { action: "acertar", spentAmount: "1" })).toMatchObject({ status: 404, corpo: { error: "Adiantamento não encontrado." } });
      }
      expect(await banco.sistema.crewAdvance.findUniqueOrThrow({ where: { id: alheio.id } })).toMatchObject({ status: "OPEN", spentAmount: null });
    });

    it("o banco recusa adiantamento apontando para motorista de outra empresa, mesmo por fora da rota", async () => {
      await expect(
        banco.default.crewAdvance.create({ data: { driverId: daOutra.motoristaId, date: dia("2026-03-10"), amount: 1, reason: "TRIP" } }),
      ).rejects.toThrow();
      await expect(
        banco.default.absence.create({ data: { helperId: daOutra.ajudanteId, type: "VACATION", startDate: dia("2026-03-10"), endDate: dia("2026-03-10") } }),
      ).rejects.toThrow();
    });
  });

  describe("comissão do motorista", () => {
    const definir = (perfil: keyof typeof ids, commissionPct: unknown) => {
      entrarComo(perfil);
      return chamar(motoristaPorId.PATCH(req("PATCH", { commissionPct }), ctx(motoristaId)));
    };
    const gravada = async () => (await banco.default.driver.findUniqueOrThrow({ where: { id: motoristaId }, select: { commissionPct: true } })).commissionPct;

    it("só o administrador altera: a operação recebe 403 e nada muda; a auditoria registra a troca", async () => {
      expect(await definir("OPERATION", "5")).toMatchObject({ status: 403, corpo: { error: "Só o administrador altera o percentual de comissão." } });
      expect(await gravada()).toBeNull();

      const definida = await definir("ADMIN", "5,5");
      expect(definida.status).toBe(200);
      expect(definida.corpo.commissionPct).toBe(5.5);
      expect(await gravada()).toBe(5.5);

      expect((await definir("ADMIN", "")).corpo.commissionPct).toBeNull();
      expect((await definir("ADMIN", 101)).status).toBe(400);

      const linhas = await trilha(motoristaId);
      expect(linhas.map((l) => [l.action, l.before, l.after])).toEqual([
        ["motorista.comissao", { commissionPct: null }, { commissionPct: 5.5 }],
        ["motorista.comissao", { commissionPct: 5.5 }, { commissionPct: null }],
      ]);
    });

    it("a operação continua alterando o resto do cadastro, sem ver nem apagar o percentual", async () => {
      await definir("ADMIN", 7);

      entrarComo("OPERATION");
      const alterado = await chamar(motoristaPorId.PATCH(req("PATCH", { phone: "17999990000" }), ctx(motoristaId)));
      expect(alterado.status).toBe(200);
      expect(alterado.corpo.phone).toBe("17999990000");
      expect(alterado.corpo).not.toHaveProperty("commissionPct");
      expect(await gravada()).toBe(7);
    });

    it("o percentual só sai para o administrador, e só em /api/motoristas: nem viagem, nem veículo, nem carga o levam", async () => {
      await definir("ADMIN", 7);
      await banco.default.manifest.create({ data: { driverId: motoristaId, vehicleId: veiculoId } });
      await banco.default.collection.create({
        data: { clientId: clienteId, driverId: motoristaId, sender: "Remetente", receiver: "Destinatário", origin: "Rio Preto", destination: "Mirassol", volumes: 1, weight: 10 },
      });

      const doMotorista = async (perfil: keyof typeof ids) => {
        entrarComo(perfil);
        const lista = (await (await motoristas.GET()).json()) as Corpo[];
        return lista.find((m) => m.id === motoristaId)!;
      };
      expect((await doMotorista("ADMIN")).commissionPct).toBe(7);
      expect(await doMotorista("OPERATION")).not.toHaveProperty("commissionPct");

      for (const perfil of ["ADMIN", "OPERATION"] as const) {
        for (const [rota, pedir] of [
          ["manifestos", () => manifestos.GET()],
          ["veiculos", () => veiculos.GET()],
          ["coletas", () => coletas.GET()],
        ] as const) {
          entrarComo(perfil);
          const res = await pedir();
          expect(res.status, rota).toBe(200);
          const texto = JSON.stringify(await res.json());
          // A resposta traz o motorista da suite, e nenhum percentual.
          expect(texto, rota).toContain(motoristaId);
          expect(texto, `${rota} como ${perfil}`).not.toContain("commissionPct");
        }
      }
    });
  });

  describe("produtividade", () => {
    type Linha = Record<string, unknown> & { driverId: string };
    type Resposta = { periodo: { de: string; ate: string }; comValores: boolean; motoristas: Linha[] };

    const ler = async (perfil: keyof typeof ids, query = "?de=2017-03&ate=2017-03") => {
      entrarComo(perfil);
      const res = await produtividade.GET(req("GET", undefined, query));
      expect(res.status).toBe(200);
      return (await res.json()) as Resposta;
    };

    /** Carga entregue em `entregueEm`; `coletadaEm` nulo deixa o histórico sem a coleta. */
    const entregar = (dados: { entregueEm: Date; coletadaEm?: Date | null; peso?: number; frete?: number | null; comMotorista?: boolean }) =>
      banco.default.collection.create({
        data: {
          clientId: clienteId,
          driverId: dados.comMotorista === false ? null : motoristaId,
          sender: "Remetente",
          receiver: "Destinatário",
          origin: "Rio Preto",
          destination: "Mirassol",
          volumes: 1,
          weight: dados.peso ?? 10,
          status: "DELIVERED",
          freightValue: dados.frete === undefined ? 100 : dados.frete,
          freightDeadlineHours: 24,
          statusHistory: {
            create: [
              ...(dados.coletadaEm ? [{ fromStatus: "CONFIRMED", toStatus: "COLLECTED", createdAt: dados.coletadaEm }] : []),
              { fromStatus: "ROUTE", toStatus: "DELIVERED", createdAt: dados.entregueEm },
            ],
          },
        },
      });

    const viajar = (status: string, finalizadaEm: Date) =>
      banco.default.manifest.create({ data: { driverId: motoristaId, vehicleId: veiculoId, status, updatedAt: finalizadaEm } });

    async function movimentoDeMarco() {
      await banco.sistema.driver.update({ where: { id: motoristaId }, data: { commissionPct: 5 } });
      await viajar("FINISHED", em("2017-03-05"));
      await viajar("FINISHED", em("2017-03-31", "23:30"));
      // Fora da conta: finalizada em abril, e ainda em rota em março.
      await viajar("FINISHED", em("2017-04-01", "00:00"));
      await viajar("ROUTE", em("2017-03-10"));

      await entregar({ coletadaEm: em("2017-03-10", "08:00"), entregueEm: em("2017-03-10", "10:00"), peso: 10, frete: 100 });
      await entregar({ coletadaEm: em("2017-03-10", "08:00"), entregueEm: em("2017-03-12", "08:00"), peso: 20.5, frete: 200.4 });
      await entregar({ entregueEm: em("2017-03-15"), peso: 5, frete: null });
      // Fora da conta: entregue em abril.
      await entregar({ coletadaEm: em("2017-03-31", "08:00"), entregueEm: em("2017-04-01", "00:00"), frete: 9000 });
      await entregar({ entregueEm: em("2017-03-20"), frete: 50, comMotorista: false });
    }

    it("o administrador vê viagens, entregas, prazo, peso, frete e comissão do período", async () => {
      await movimentoDeMarco();

      const resposta = await ler("ADMIN");
      expect(resposta.periodo).toEqual({ de: "2017-03", ate: "2017-03" });
      expect(resposta.comValores).toBe(true);
      expect(resposta.motoristas.find((l) => l.driverId === motoristaId)).toEqual({
        driverId: motoristaId,
        nome: nome("DRIVER"),
        viagens: 2,
        entregas: 3,
        noPrazo: 1,
        foraDoPrazo: 1,
        semMedicao: 1,
        taxaNoPrazo: 50,
        peso: 35.5,
        frete: 300.4,
        comissaoPct: 5,
        comissao: 15.02,
      });
      // A carga sem motorista fica à parte, sem comissão.
      expect(resposta.motoristas.find((l) => l.driverId === "")).toMatchObject({ nome: SEM_MOTORISTA, entregas: 1, frete: 50, comissao: null });
    });

    it("a operação vê as mesmas contagens, sem frete nem comissão: os campos nem vão na resposta", async () => {
      await movimentoDeMarco();

      const resposta = await ler("OPERATION");
      expect(resposta.comValores).toBe(false);
      expect(resposta.motoristas.find((l) => l.driverId === motoristaId)).toEqual({
        driverId: motoristaId,
        nome: nome("DRIVER"),
        viagens: 2,
        entregas: 3,
        noPrazo: 1,
        foraDoPrazo: 1,
        semMedicao: 1,
        taxaNoPrazo: 50,
        peso: 35.5,
      });
      expect(JSON.stringify(resposta)).not.toMatch(/frete|comissao|300\.4|15\.02/);
    });

    it("sem movimento o motorista ativo aparece zerado; o desativado só aparece se trabalhou no período", async () => {
      const zerado = (await ler("ADMIN")).motoristas.find((l) => l.driverId === motoristaId);
      expect(zerado).toMatchObject({ viagens: 0, entregas: 0, taxaNoPrazo: null, peso: 0, frete: 0, comissaoPct: null, comissao: null });

      await banco.sistema.driver.update({ where: { id: motoristaId }, data: { active: false } });
      expect((await ler("ADMIN")).motoristas.find((l) => l.driverId === motoristaId)).toBeUndefined();

      await entregar({ entregueEm: em("2017-03-15") });
      expect((await ler("ADMIN")).motoristas.find((l) => l.driverId === motoristaId)).toMatchObject({ entregas: 1 });
    });

    it("período inválido é 400; sem período vale o mês corrente e os dois anteriores", async () => {
      for (const query of ["?de=2017-04&ate=2017-03", "?de=2017-3&ate=2017-04", "?de=abc&ate=2017-04", "?de=2013-01&ate=2017-04"]) {
        entrarComo("ADMIN");
        const res = await produtividade.GET(req("GET", undefined, query));
        expect(res.status, query).toBe(400);
        expect((await res.json()).error).toMatch(/Período inválido/);
      }

      const mes = HOJE.slice(0, 7);
      expect((await ler("ADMIN", "")).periodo.ate).toBe(mes);
      // Chamada sem requisição, como o teste de permissões faz.
      entrarComo("ADMIN");
      expect((await produtividade.GET()).status).toBe(200);
    });

    it("isolamento: viagem, entrega e motorista de outra empresa não entram", async () => {
      const { db } = banco.paraEmpresa(EMPRESA_OUTRA.id);
      await db.manifest.create({ data: { driverId: daOutra.motoristaId, vehicleId: daOutra.veiculoId, status: "FINISHED", updatedAt: em("2017-03-05") } });
      await db.collection.create({
        data: {
          clientId: daOutra.clienteId,
          driverId: daOutra.motoristaId,
          sender: "Remetente",
          receiver: "Destinatário",
          origin: "Rio Preto",
          destination: "Mirassol",
          volumes: 1,
          weight: 999,
          status: "DELIVERED",
          freightValue: 7777,
          statusHistory: { create: [{ fromStatus: "ROUTE", toStatus: "DELIVERED", createdAt: em("2017-03-11") }] },
        },
      });

      const resposta = await ler("ADMIN");
      expect(resposta.motoristas.find((l) => l.driverId === daOutra.motoristaId)).toBeUndefined();
      expect(JSON.stringify(resposta)).not.toMatch(/da outra|7777/);
      expect(resposta.motoristas.find((l) => l.driverId === motoristaId)).toMatchObject({ viagens: 0, entregas: 0 });
    });
  });
});
