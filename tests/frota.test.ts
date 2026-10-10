import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getServerSession } from "next-auth";
import { diaNoBrasil } from "../src/lib/financeiro";
import {
  CHECKLIST_ITENS,
  CHECKLIST_TUDO_OK,
  REMOVED_KM_MESSAGE,
  alertasDeVencimento,
  consumoDosAbastecimentos,
  createChecklistSchema,
  createFuelingSchema,
  createMaintenanceSchema,
  createTireSchema,
  custosDoVeiculo,
  diasAteVencer,
  kmRodadosDoPneu,
  limitesDeCalendario,
  prazoPorExtenso,
  problemasDoChecklist,
  situacaoDoVencimento,
  totaisDeCusto,
  updateDocumentSchema,
  type AlertaDeVencimento,
  type CustosDoVeiculo,
} from "../src/lib/frota";
import { EMPRESA_OUTRA } from "./empresas-de-teste";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

const dia = (data: string) => new Date(`${data}T00:00:00.000Z`);

/** As contas da frota, sem banco: linhas na mão, data de referência na mão. */
describe("contas da frota", () => {
  // Meio-dia de 15/10/2026 em Brasília.
  const HOJE = new Date("2026-10-15T15:00:00.000Z");

  const abastecer = (data: string, odometer: number, liters: number, totalCost: number) => ({ date: dia(data), odometer, liters, totalCost });

  describe("consumo entre abastecimentos", () => {
    it("o primeiro não tem base; os seguintes medem km, km/l e custo por km desde o anterior", () => {
      const trechos = consumoDosAbastecimentos([abastecer("2026-10-01", 10000, 40, 240), abastecer("2026-10-05", 10500, 50, 300), abastecer("2026-10-09", 10950, 45, 283.5)]);
      expect(trechos.map(({ km, kmPorLitro, custoPorKm }) => ({ km, kmPorLitro, custoPorKm }))).toEqual([
        { km: null, kmPorLitro: null, custoPorKm: null },
        { km: 500, kmPorLitro: 10, custoPorKm: 0.6 },
        { km: 450, kmPorLitro: 10, custoPorKm: 0.63 },
      ]);
    });

    it("põe em ordem de data (e de hodômetro no mesmo dia) antes de medir, sem mexer na lista recebida", () => {
      const lista = [abastecer("2026-10-05", 10600, 10, 60), abastecer("2026-10-05", 10500, 50, 300), abastecer("2026-10-01", 10000, 40, 240)];
      const trechos = consumoDosAbastecimentos(lista);
      expect(trechos.map((t) => [t.odometer, t.km])).toEqual([
        [10000, null],
        [10500, 500],
        [10600, 100],
      ]);
      expect(lista[0].odometer).toBe(10600);
    });

    it("hodômetro igual ou menor que o anterior fica sem medição, não com consumo negativo", () => {
      const trechos = consumoDosAbastecimentos([
        abastecer("2026-10-01", 10000, 40, 240),
        abastecer("2026-10-05", 9000, 50, 300),
        abastecer("2026-10-06", 9000, 50, 300),
        abastecer("2026-10-09", 9400, 40, 200),
      ]);
      expect(trechos.map((t) => [t.km, t.kmPorLitro, t.custoPorKm])).toEqual([
        [null, null, null],
        [null, null, null],
        [null, null, null],
        [400, 10, 0.5],
      ]);
    });

    it("litros zero não divide: fica sem consumo, mas o custo por km continua valendo", () => {
      const [, zerado, negativo] = consumoDosAbastecimentos([abastecer("2026-10-01", 10000, 40, 240), abastecer("2026-10-05", 10500, 0, 300), abastecer("2026-10-09", 11000, -5, 0)]);
      expect([zerado.km, zerado.kmPorLitro, zerado.custoPorKm]).toEqual([500, null, 0.6]);
      expect([negativo.km, negativo.kmPorLitro, negativo.custoPorKm]).toEqual([500, null, 0]);
    });

    it("sem abastecimento, ou com um só, não há o que medir", () => {
      expect(consumoDosAbastecimentos([])).toEqual([]);
      expect(consumoDosAbastecimentos([abastecer("2026-10-01", 10000, 40, 240)])[0]).toMatchObject({ km: null, kmPorLitro: null, custoPorKm: null });
    });
  });

  describe("custos do veículo", () => {
    it("sem dado nenhum: tudo zero e as médias sem valor", () => {
      expect(custosDoVeiculo({ manutencoes: [], abastecimentos: [] })).toEqual<CustosDoVeiculo>({
        manutencao: 0,
        abastecimento: 0,
        total: 0,
        litros: 0,
        kmRodados: null,
        custoPorKm: null,
        consumoMedio: null,
      });
    });

    it("só manutenção concluída é custo; agendada e em andamento ficam fora", () => {
      const manutencoes = [
        { cost: 500.1, status: "COMPLETED" },
        { cost: 200.2, status: "COMPLETED" },
        { cost: 999, status: "SCHEDULED" },
        { cost: 999, status: "IN_PROGRESS" },
      ];
      expect(totaisDeCusto(manutencoes, [{ totalCost: 100.1 }, { totalCost: 0.2 }])).toEqual({ manutencao: 700.3, abastecimento: 100.3, total: 800.6 });
    });

    it("com o abastecimento anterior ao período, o primeiro do período já conta km", () => {
      const custos = custosDoVeiculo({
        manutencoes: [{ cost: 500, status: "COMPLETED" }],
        abastecimentos: [abastecer("2026-10-01", 10500, 50, 300), abastecer("2026-10-20", 11100, 60, 360)],
        anterior: abastecer("2026-09-20", 10000, 40, 240),
      });
      expect(custos).toEqual<CustosDoVeiculo>({
        manutencao: 500,
        abastecimento: 660,
        total: 1160,
        litros: 110,
        kmRodados: 1100,
        custoPorKm: 1.05,
        consumoMedio: 10,
      });
    });

    it("sem o anterior, o primeiro abastecimento do período é só a base", () => {
      const custos = custosDoVeiculo({ manutencoes: [], abastecimentos: [abastecer("2026-10-01", 10500, 50, 300), abastecer("2026-10-20", 11100, 60, 360)] });
      expect(custos.kmRodados).toBe(600);
      expect(custos.consumoMedio).toBe(10);
      // O custo por km é o total do período (os dois abastecimentos) sobre os km medidos.
      expect(custos.custoPorKm).toBe(1.1);
      expect(custos.litros).toBe(110);
    });

    it("um abastecimento só, ou hodômetro que não anda: há custo, não há custo por km", () => {
      expect(custosDoVeiculo({ manutencoes: [], abastecimentos: [abastecer("2026-10-01", 10500, 50, 300)] })).toMatchObject({
        total: 300,
        kmRodados: null,
        custoPorKm: null,
        consumoMedio: null,
      });
      expect(
        custosDoVeiculo({ manutencoes: [], abastecimentos: [abastecer("2026-10-01", 10500, 50, 300), abastecer("2026-10-02", 10400, 50, 300)] }),
      ).toMatchObject({ total: 600, kmRodados: null, custoPorKm: null, consumoMedio: null });
    });

    it("trecho com litros zerados conta nos km, mas não no consumo médio", () => {
      const custos = custosDoVeiculo({
        manutencoes: [],
        abastecimentos: [abastecer("2026-10-01", 10000, 40, 240), abastecer("2026-10-05", 10500, 0, 0), abastecer("2026-10-09", 10900, 40, 240)],
      });
      expect(custos.kmRodados).toBe(900);
      expect(custos.consumoMedio).toBe(10);
    });

    it("período de dias do calendário: do dia 1º ao dia 1º do mês seguinte, em UTC", () => {
      expect(limitesDeCalendario("2026-10", "2026-12")).toEqual({ inicio: dia("2026-10-01"), fim: dia("2027-01-01") });
      for (const [de, ate] of [["2026-10", "2026-09"], ["2026-13", "2026-12"], ["", ""], ["2020-01", "2023-01"]]) {
        expect(limitesDeCalendario(de, ate), `${de}..${ate}`).toBeNull();
      }
    });
  });

  describe("vencimentos", () => {
    it("vencido só depois do dia; hoje e até 30 dias é a vencer; 31 dias está em dia", () => {
      const casos: [string, number, string][] = [
        ["2026-09-15", -30, "vencido"],
        ["2026-10-14", -1, "vencido"],
        ["2026-10-15", 0, "a_vencer"],
        ["2026-10-16", 1, "a_vencer"],
        ["2026-11-14", 30, "a_vencer"],
        ["2026-11-15", 31, "em_dia"],
        ["2027-10-15", 365, "em_dia"],
      ];
      for (const [vencimento, dias, situacao] of casos) {
        expect(diasAteVencer(dia(vencimento), HOJE), vencimento).toBe(dias);
        expect(situacaoDoVencimento(dia(vencimento), HOJE), vencimento).toBe(situacao);
      }
    });

    it("o dia de hoje é o do relógio do Brasil, e o vencimento é lido em UTC", () => {
      // 01:30 UTC do dia 16 ainda é dia 15 em Brasília: o que vence dia 15 não venceu.
      const madrugada = new Date("2026-10-16T01:30:00.000Z");
      expect(situacaoDoVencimento(dia("2026-10-15"), madrugada)).toBe("a_vencer");
      expect(diasAteVencer(dia("2026-10-15"), madrugada)).toBe(0);
      // Vencimento como texto ISO, que é como chega do banco pela API.
      expect(situacaoDoVencimento("2026-10-14T00:00:00.000Z", HOJE)).toBe("vencido");
    });

    it("o prazo por extenso, com singular e plural", () => {
      expect([-2, -1, 0, 1, 30].map(prazoPorExtenso)).toEqual(["Venceu há 2 dias", "Venceu há 1 dia", "Vence hoje", "Vence em 1 dia", "Vence em 30 dias"]);
    });

    it("alertas: documento e CNH na mesma lista, do vencimento mais antigo para o mais novo, sem o que está em dia", () => {
      const veiculo = { id: "v1", plate: "ABC1D23" };
      const alertas = alertasDeVencimento(
        {
          documentos: [
            { id: "d1", type: "INSURANCE", number: "APO-1", expiresAt: dia("2026-11-01"), vehicle: veiculo },
            { id: "d2", type: "LICENSING", number: null, expiresAt: dia("2026-10-01"), vehicle: veiculo },
            { id: "d3", type: "ANTT", number: null, expiresAt: dia("2027-03-01"), vehicle: veiculo },
            { id: "d4", type: "TIPO_NOVO", number: null, expiresAt: dia("2026-10-15"), vehicle: { id: "v2", plate: "XYZ9Z99" } },
          ],
          motoristas: [
            { id: "m1", nome: "Ana", cnh: "111", cnhExpiry: dia("2026-10-10") },
            { id: "m2", nome: "Bruno", cnh: "222", cnhExpiry: dia("2030-01-01") },
          ],
        },
        HOJE,
      );

      expect(alertas).toEqual<AlertaDeVencimento[]>([
        { chave: "documento-d2", origem: "DOCUMENTO", rotulo: "Licenciamento (CRLV)", de: "ABC1D23", vehicleId: "v1", numero: null, vencimento: "2026-10-01", dias: -14, situacao: "vencido" },
        { chave: "cnh-m1", origem: "CNH", rotulo: "CNH", de: "Ana", vehicleId: null, numero: "111", vencimento: "2026-10-10", dias: -5, situacao: "vencido" },
        { chave: "documento-d4", origem: "DOCUMENTO", rotulo: "TIPO_NOVO", de: "XYZ9Z99", vehicleId: "v2", numero: null, vencimento: "2026-10-15", dias: 0, situacao: "a_vencer" },
        { chave: "documento-d1", origem: "DOCUMENTO", rotulo: "Seguro", de: "ABC1D23", vehicleId: "v1", numero: "APO-1", vencimento: "2026-11-01", dias: 17, situacao: "a_vencer" },
      ]);
      expect(alertasDeVencimento({ documentos: [], motoristas: [] }, HOJE)).toEqual([]);
    });
  });

  it("pneu: km rodados só depois da retirada, e nunca negativo", () => {
    expect(kmRodadosDoPneu({ installedKm: 10000, removedKm: null })).toBeNull();
    expect(kmRodadosDoPneu({ installedKm: 10000, removedKm: 65000 })).toBe(55000);
    expect(kmRodadosDoPneu({ installedKm: 10000, removedKm: 9000 })).toBe(0);
  });

  it("checklist: os problemas saem na ordem dos itens; dado torto não vira problema inventado", () => {
    expect(problemasDoChecklist(CHECKLIST_TUDO_OK)).toEqual([]);
    expect(problemasDoChecklist({ ...CHECKLIST_TUDO_OK, luzes: false, pneus: false })).toEqual(["Pneus", "Luzes"]);
    expect(problemasDoChecklist(null)).toEqual([]);
    expect(problemasDoChecklist({ freios: "não" })).toEqual([]);
    expect(CHECKLIST_ITENS.map((item) => item.chave)).toEqual(["pneus", "freios", "luzes", "oleo", "agua", "documentos", "limpeza", "extintor"]);
  });

  describe("validação", () => {
    const erro = (resultado: { success: boolean; error?: { issues: { message: string }[] } }) => resultado.error?.issues[0]?.message;

    it("abastecimento: número do formulário com vírgula, data à meia-noite UTC e texto vazio como nulo", () => {
      const lido = createFuelingSchema.parse({ date: "2026-10-09", liters: "45,5", totalCost: "273.00", odometer: "120500", station: " ", driverId: "" });
      expect(lido).toEqual({ date: dia("2026-10-09"), liters: 45.5, totalCost: 273, odometer: 120500, station: null, driverId: null });
      // Data ISO completa vale pelo dia.
      expect(createFuelingSchema.parse({ date: "2026-10-09T23:30:00-03:00", liters: 1, totalCost: 0, odometer: 0 }).date).toEqual(dia("2026-10-09"));
    });

    it("abastecimento: litros zero, hodômetro quebrado ou negativo e data inválida são recusados", () => {
      const base = { date: "2026-10-09", liters: "40", totalCost: "240", odometer: "1000" };
      expect(erro(createFuelingSchema.safeParse({ ...base, liters: "0" }))).toMatch(/litros/);
      expect(erro(createFuelingSchema.safeParse({ ...base, liters: "" }))).toMatch(/litros/);
      expect(erro(createFuelingSchema.safeParse({ ...base, liters: "abc" }))).toMatch(/litros/);
      expect(erro(createFuelingSchema.safeParse({ ...base, totalCost: "-1" }))).toMatch(/valor total/);
      expect(erro(createFuelingSchema.safeParse({ ...base, odometer: "10,5" }))).toMatch(/hodômetro/);
      expect(erro(createFuelingSchema.safeParse({ ...base, odometer: "-1" }))).toMatch(/hodômetro/);
      expect(erro(createFuelingSchema.safeParse({ ...base, date: "09/10/2026" }))).toMatch(/data/);
      expect(erro(createFuelingSchema.safeParse({ ...base, date: "2026-13-45" }))).toMatch(/data/);
      expect(erro(createFuelingSchema.safeParse(null))).toBe("Dados inválidos.");
    });

    it("pneu: retirada em branco é pneu em uso; retirada menor que a instalação é recusada", () => {
      const base = { position: "Dianteiro esquerdo", brandModel: "Marca X 295", installedAt: "2026-01-10", installedKm: "50000" };
      expect(createTireSchema.parse({ ...base, removedKm: "" }).removedKm).toBeNull();
      expect(createTireSchema.parse(base).removedKm).toBeUndefined();
      expect(createTireSchema.parse({ ...base, removedKm: "50000" }).removedKm).toBe(50000);
      expect(erro(createTireSchema.safeParse({ ...base, removedKm: "49999" }))).toBe(REMOVED_KM_MESSAGE);
      expect(erro(createTireSchema.safeParse({ ...base, position: " " }))).toMatch(/posição/);
    });

    it("documento: alteração sem campo nenhum é recusada; observação vazia apaga", () => {
      expect(erro(updateDocumentSchema.safeParse({}))).toMatch(/ao menos um campo/);
      expect(updateDocumentSchema.parse({ notes: "" })).toEqual({ notes: null });
      expect(erro(updateDocumentSchema.safeParse({ type: "MULTA" }))).toMatch(/Tipo de documento/);
    });

    it("checklist: todo item precisa vir como OK ou problema", () => {
      expect(createChecklistSchema.parse({ items: CHECKLIST_TUDO_OK, odometer: "", notes: "" })).toEqual({ items: CHECKLIST_TUDO_OK, odometer: null, notes: null });
      const semExtintor: Record<string, boolean> = { ...CHECKLIST_TUDO_OK };
      delete semExtintor.extintor;
      expect(erro(createChecklistSchema.safeParse({ items: semExtintor }))).toMatch(/cada item/);
      expect(erro(createChecklistSchema.safeParse({ items: { ...CHECKLIST_TUDO_OK, freios: "ok" } }))).toMatch(/cada item/);
      expect(erro(createChecklistSchema.safeParse({}))).toMatch(/cada item/);
    });

    it("manutenção: o corpo que a tela antiga mandava continua valendo; tipo e hodômetro são opcionais", () => {
      expect(createMaintenanceSchema.parse({ description: "Troca de óleo", cost: "350.50", date: "2026-10-09", status: "COMPLETED" })).toEqual({
        description: "Troca de óleo",
        cost: 350.5,
        date: dia("2026-10-09"),
        status: "COMPLETED",
      });
      expect(createMaintenanceSchema.parse({ description: "Freios", cost: 100, date: "2026-10-09", kind: "", odometer: "" })).toMatchObject({ kind: null, odometer: null });
      expect(createMaintenanceSchema.parse({ description: "Freios", cost: 100, date: "2026-10-09", kind: "PREVENTIVE", odometer: "88000" })).toMatchObject({
        kind: "PREVENTIVE",
        odometer: 88000,
      });
      expect(erro(createMaintenanceSchema.safeParse({ description: "Freios", cost: "0", date: "2026-10-09" }))).toMatch(/custo/);
      expect(erro(createMaintenanceSchema.safeParse({ description: "Freios", cost: "10", date: "2026-10-09", kind: "URGENTE" }))).toMatch(/Tipo de manutenção/);
      expect(erro(createMaintenanceSchema.safeParse({}))).toMatch(/descrição/);
    });
  });
});

/** As rotas da frota, contra um Postgres de verdade. */
const temBanco = Boolean(process.env.DATABASE_URL);

if (!temBanco) {
  console.warn("\n[frota.test] DATABASE_URL ausente: testes de integração PULADOS.\n");
}

const suite = temBanco ? describe : describe.skip;

// Tudo o que esta suite cria usa estes marcadores, e só isso é apagado.
const PREFIXO = "teste-frota-";
const PLACA = "FRT0A01";
const PLACA_PARADA = "FRT0A02";
const PLACA_DA_OUTRA = "FRT0B01";
const PLACAS = [PLACA, PLACA_PARADA, PLACA_DA_OUTRA];
const CPF = "99555444017";
const CPF_INATIVO = "99555444025";
const CPF_DA_OUTRA = "99555444033";
const HASH_FALSO = "$2b$10$hashfalsoparateste000000000000000000000000000000000";
const SEM_ID = "00000000-0000-0000-0000-000000000000";

const DIA = 86_400_000;
/** Dia do calendário a `dias` de hoje (relógio do Brasil), à meia-noite UTC. */
const daquiA = (dias: number) => new Date(Date.parse(`${diaNoBrasil(new Date())}T00:00:00.000Z`) + dias * DIA);

type Corpo = Record<string, unknown>;

suite("rotas da frota", () => {
  let banco: typeof import("../src/lib/prisma");
  let abastecimentos: typeof import("../src/app/api/veiculos/[id]/abastecimentos/route");
  let abastecimento: typeof import("../src/app/api/veiculos/[id]/abastecimentos/[registroId]/route");
  let documentos: typeof import("../src/app/api/veiculos/[id]/documentos/route");
  let documento: typeof import("../src/app/api/veiculos/[id]/documentos/[registroId]/route");
  let pneus: typeof import("../src/app/api/veiculos/[id]/pneus/route");
  let pneu: typeof import("../src/app/api/veiculos/[id]/pneus/[registroId]/route");
  let checklists: typeof import("../src/app/api/veiculos/[id]/checklists/route");
  let custos: typeof import("../src/app/api/veiculos/[id]/custos/route");
  let manutencao: typeof import("../src/app/api/veiculos/[id]/manutencao/route");
  let veiculo: typeof import("../src/app/api/veiculos/[id]/route");
  let frota: typeof import("../src/app/api/frota/route");
  let checklistDoMotorista: typeof import("../src/app/api/driver/checklists/route");

  const sessao = vi.mocked(getServerSession);
  const ids = { ADMIN: "", OPERATION: "", CLIENT: "", DRIVER: "", INATIVO: "" };
  let veiculoId: string;
  let veiculoParadoId: string;
  let veiculoDaOutraId: string;
  let motoristaId: string;
  let motoristaInativoId: string;
  let motoristaDaOutraId: string;

  const entrarComo = (perfil: keyof typeof ids | null) =>
    sessao.mockResolvedValue(perfil ? { user: { id: ids[perfil], role: perfil === "INATIVO" ? "DRIVER" : perfil, clientId: null } } : null);

  const req = (method = "GET", body?: unknown, query = "") =>
    new Request(`http://localhost/api/teste${query ? `?${query}` : ""}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const ctxDe = (id: string, registroId: string) => ({ params: Promise.resolve({ id, registroId }) });

  const ABASTECIMENTO = { date: "2026-05-10", liters: "50", totalCost: "300", odometer: "10500" };
  const DOCUMENTO = { type: "INSURANCE", expiresAt: "2031-01-10", number: "APO-123", notes: "" };
  const PNEU = { position: "Dianteiro esquerdo", brandModel: `${PREFIXO}pneu 295/80`, installedAt: "2026-01-10", installedKm: "50000" };
  const CHECKLIST = { items: CHECKLIST_TUDO_OK, odometer: "10600", notes: "" };
  const MANUTENCAO = { description: `${PREFIXO}troca de óleo`, cost: "350.50", date: "2026-05-12", status: "COMPLETED" };

  async function limparRegistros() {
    const { sistema } = banco;
    const doVeiculo = { vehicle: { plate: { in: PLACAS } } };
    await sistema.fueling.deleteMany({ where: doVeiculo });
    await sistema.vehicleDocument.deleteMany({ where: doVeiculo });
    await sistema.tire.deleteMany({ where: doVeiculo });
    await sistema.vehicleChecklist.deleteMany({ where: doVeiculo });
    await sistema.maintenance.deleteMany({ where: doVeiculo });
    await sistema.manifest.deleteMany({ where: doVeiculo });
    await sistema.financialTransaction.deleteMany({ where: { description: { startsWith: `Manutenção: ${PREFIXO}` } } });
  }

  async function limpar() {
    await limparRegistros();
    await banco.sistema.vehicle.deleteMany({ where: { plate: { in: PLACAS } } });
    await banco.sistema.driver.deleteMany({ where: { cpf: { in: [CPF, CPF_INATIVO, CPF_DA_OUTRA] } } });
    await banco.sistema.user.deleteMany({ where: { email: { startsWith: PREFIXO } } });
  }

  const postar = async <T = Corpo>(rota: { POST: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response> }, corpo: unknown, id = veiculoId) => {
    const res = await rota.POST(req("POST", corpo), ctx(id));
    return { status: res.status, corpo: (await res.json()) as T & { id: string; error?: string } };
  };
  const listar = async <T = Corpo>(rota: { GET: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response> }, id = veiculoId) => {
    const res = await rota.GET(req(), ctx(id));
    expect(res.status).toBe(200);
    return (await res.json()) as (T & { id: string })[];
  };

  beforeAll(async () => {
    banco = await import("../src/lib/prisma");
    abastecimentos = await import("../src/app/api/veiculos/[id]/abastecimentos/route");
    abastecimento = await import("../src/app/api/veiculos/[id]/abastecimentos/[registroId]/route");
    documentos = await import("../src/app/api/veiculos/[id]/documentos/route");
    documento = await import("../src/app/api/veiculos/[id]/documentos/[registroId]/route");
    pneus = await import("../src/app/api/veiculos/[id]/pneus/route");
    pneu = await import("../src/app/api/veiculos/[id]/pneus/[registroId]/route");
    checklists = await import("../src/app/api/veiculos/[id]/checklists/route");
    custos = await import("../src/app/api/veiculos/[id]/custos/route");
    manutencao = await import("../src/app/api/veiculos/[id]/manutencao/route");
    veiculo = await import("../src/app/api/veiculos/[id]/route");
    frota = await import("../src/app/api/frota/route");
    checklistDoMotorista = await import("../src/app/api/driver/checklists/route");
    await limpar();

    const db = banco.default;
    for (const perfil of ["ADMIN", "OPERATION", "CLIENT", "DRIVER", "INATIVO"] as const) {
      ids[perfil] = (
        await db.user.create({
          data: {
            name: `${PREFIXO}${perfil}`,
            email: `${PREFIXO}${perfil.toLowerCase()}@exemplo.br`,
            password: HASH_FALSO,
            role: perfil === "INATIVO" ? "DRIVER" : perfil,
          },
        })
      ).id;
    }
    // CNH em dia: cada teste de alerta ajusta a validade de que precisa.
    motoristaId = (await db.driver.create({ data: { userId: ids.DRIVER, cpf: CPF, cnh: "55555555501", cnhExpiry: daquiA(400), category: "C" } })).id;
    motoristaInativoId = (
      await db.driver.create({ data: { userId: ids.INATIVO, cpf: CPF_INATIVO, cnh: "55555555502", cnhExpiry: daquiA(-50), category: "C", active: false } })
    ).id;
    veiculoId = (await db.vehicle.create({ data: { plate: PLACA, model: `${PREFIXO}caminhão`, type: "TRUCK" } })).id;
    veiculoParadoId = (await db.vehicle.create({ data: { plate: PLACA_PARADA, model: `${PREFIXO}van`, type: "VAN", status: "MAINTENANCE" } })).id;

    const outra = banco.paraEmpresa(EMPRESA_OUTRA.id).db;
    const usuarioDaOutra = await outra.user.create({
      data: { name: `${PREFIXO}motorista da outra`, email: `${PREFIXO}outra@exemplo.br`, password: HASH_FALSO, role: "DRIVER" },
    });
    motoristaDaOutraId = (
      await outra.driver.create({ data: { userId: usuarioDaOutra.id, cpf: CPF_DA_OUTRA, cnh: "55555555503", cnhExpiry: daquiA(-5), category: "C" } })
    ).id;
    veiculoDaOutraId = (await outra.vehicle.create({ data: { plate: PLACA_DA_OUTRA, model: `${PREFIXO}da outra`, type: "TRUCK", status: "MAINTENANCE" } })).id;
  });

  beforeEach(async () => {
    sessao.mockReset();
    await limparRegistros();
    await banco.default.driver.update({ where: { id: motoristaId }, data: { cnhExpiry: daquiA(400) } });
  });

  afterAll(async () => {
    if (banco) await limpar();
  });

  /** Toda rota da frota no painel, com um corpo que seria aceito. */
  const rotasDaEquipe = (): [string, () => Promise<Response>][] => [
    ["GET /api/veiculos/[id]", () => veiculo.GET(req(), ctx(veiculoId))],
    ["GET abastecimentos", () => abastecimentos.GET(req(), ctx(veiculoId))],
    ["POST abastecimentos", () => abastecimentos.POST(req("POST", ABASTECIMENTO), ctx(veiculoId))],
    ["DELETE abastecimentos/[id]", () => abastecimento.DELETE(req("DELETE"), ctxDe(veiculoId, SEM_ID))],
    ["GET documentos", () => documentos.GET(req(), ctx(veiculoId))],
    ["POST documentos", () => documentos.POST(req("POST", DOCUMENTO), ctx(veiculoId))],
    ["PATCH documentos/[id]", () => documento.PATCH(req("PATCH", { notes: "x" }), ctxDe(veiculoId, SEM_ID))],
    ["DELETE documentos/[id]", () => documento.DELETE(req("DELETE"), ctxDe(veiculoId, SEM_ID))],
    ["GET pneus", () => pneus.GET(req(), ctx(veiculoId))],
    ["POST pneus", () => pneus.POST(req("POST", PNEU), ctx(veiculoId))],
    ["PATCH pneus/[id]", () => pneu.PATCH(req("PATCH", { notes: "x" }), ctxDe(veiculoId, SEM_ID))],
    ["DELETE pneus/[id]", () => pneu.DELETE(req("DELETE"), ctxDe(veiculoId, SEM_ID))],
    ["GET checklists", () => checklists.GET(req(), ctx(veiculoId))],
    ["POST checklists", () => checklists.POST(req("POST", CHECKLIST), ctx(veiculoId))],
    ["POST manutencao", () => manutencao.POST(req("POST", MANUTENCAO), ctx(veiculoId))],
    ["GET /api/frota", () => frota.GET()],
  ];

  const quantosRegistros = async () => {
    const db = banco.default;
    return [await db.fueling.count(), await db.vehicleDocument.count(), await db.tire.count(), await db.vehicleChecklist.count(), await db.maintenance.count()];
  };

  describe("permissão", () => {
    it("sem sessão 401; cliente e motorista 403; nada é gravado nem vaza", async () => {
      const antes = await quantosRegistros();
      for (const [perfil, esperado] of [[null, 401], ["CLIENT", 403], ["DRIVER", 403]] as const) {
        entrarComo(perfil);
        for (const [nome, chamar] of [...rotasDaEquipe(), ["GET custos", () => custos.GET(req(), ctx(veiculoId))] as const]) {
          const res = await chamar();
          expect(res.status, `${nome} como ${String(perfil)}`).toBe(esperado);
          expect(JSON.stringify(await res.json())).not.toContain(PLACA);
        }
      }
      expect(await quantosRegistros()).toEqual(antes);
    });

    it("operação usa tudo, menos o que é custo: a aba de custos é 403 e o custo do mês não vai na resposta", async () => {
      entrarComo("OPERATION");
      expect((await custos.GET(req(), ctx(veiculoId))).status).toBe(403);

      for (const [nome, chamar] of rotasDaEquipe()) {
        const res = await chamar();
        expect([200, 201, 404], nome).toContain(res.status);
      }

      const alertas = await (await frota.GET()).json();
      expect(alertas).not.toHaveProperty("custoDoMes");
      expect(alertas).toHaveProperty("resumo");

      entrarComo("ADMIN");
      expect((await custos.GET(req(), ctx(veiculoId))).status).toBe(200);
      expect(await (await frota.GET()).json()).toHaveProperty("custoDoMes");
    });

    it("o app do motorista não é para a equipe: administrador e sem sessão ficam em 401", async () => {
      for (const perfil of [null, "ADMIN", "OPERATION", "CLIENT"] as const) {
        entrarComo(perfil);
        const res = await checklistDoMotorista.POST(req("POST", { ...CHECKLIST, manifestId: SEM_ID }));
        expect(res.status, String(perfil)).toBe(401);
      }
    });
  });

  describe("validação e veículo que não existe", () => {
    it("corpo inválido é 400 com a mensagem do campo, e nada é gravado", async () => {
      entrarComo("OPERATION");
      const antes = await quantosRegistros();

      expect((await postar(abastecimentos, { ...ABASTECIMENTO, liters: "0" })).corpo.error).toMatch(/litros/);
      expect((await postar(abastecimentos, {})).status).toBe(400);
      expect((await postar(documentos, { ...DOCUMENTO, type: "MULTA" })).corpo.error).toMatch(/Tipo de documento/);
      expect((await postar(documentos, { ...DOCUMENTO, expiresAt: "" })).corpo.error).toMatch(/vencimento/);
      expect((await postar(pneus, { ...PNEU, removedKm: "100" })).corpo.error).toBe(REMOVED_KM_MESSAGE);
      expect((await postar(checklists, { items: { pneus: true } })).corpo.error).toMatch(/cada item/);
      expect((await postar(manutencao, { ...MANUTENCAO, cost: "" })).corpo.error).toMatch(/custo/);
      expect((await postar(manutencao, { ...MANUTENCAO, odometer: "-5" })).status).toBe(400);
      // Corpo que não é JSON.
      const torto = await abastecimentos.POST(new Request("http://localhost/api/teste", { method: "POST", body: "{" }), ctx(veiculoId));
      expect(torto.status).toBe(400);

      expect(await quantosRegistros()).toEqual(antes);
    });

    it("veículo inexistente é 404 em toda rota, sem gravar", async () => {
      entrarComo("ADMIN");
      const antes = await quantosRegistros();
      expect((await veiculo.GET(req(), ctx(SEM_ID))).status).toBe(404);
      for (const [rota, corpo] of [[abastecimentos, ABASTECIMENTO], [documentos, DOCUMENTO], [pneus, PNEU], [checklists, CHECKLIST], [manutencao, MANUTENCAO]] as const) {
        expect((await postar(rota, corpo, SEM_ID)).status).toBe(404);
      }
      for (const rota of [abastecimentos, documentos, pneus, checklists]) {
        expect((await rota.GET(req(), ctx(SEM_ID))).status).toBe(404);
      }
      expect((await custos.GET(req(), ctx(SEM_ID))).status).toBe(404);
      expect(await quantosRegistros()).toEqual(antes);
    });

    it("motorista que não existe no abastecimento é 400", async () => {
      entrarComo("OPERATION");
      const res = await postar(abastecimentos, { ...ABASTECIMENTO, driverId: SEM_ID });
      expect(res.status).toBe(400);
      expect(res.corpo.error).toMatch(/Motorista não encontrado/);
    });
  });

  describe("abastecimentos", () => {
    it("registra, lista do mais novo para o mais antigo com o consumo de cada trecho, e exclui", async () => {
      entrarComo("OPERATION");
      const primeiro = await postar(abastecimentos, { date: "2026-05-01", liters: "40", totalCost: "240", odometer: "10000", station: "Posto Central", driverId: motoristaId });
      expect(primeiro.status).toBe(201);
      expect(primeiro.corpo).toMatchObject({ liters: 40, totalCost: 240, odometer: 10000, station: "Posto Central", driver: { user: { name: `${PREFIXO}DRIVER` } } });
      expect(primeiro.corpo.date).toBe("2026-05-01T00:00:00.000Z");

      // Lançados fora de ordem: a lista sai pela data.
      await postar(abastecimentos, { date: "2026-05-20", liters: "45,5", totalCost: "273", odometer: "10955" });
      const doMeio = await postar(abastecimentos, { date: "2026-05-10", liters: "50", totalCost: "300", odometer: "10500" });
      // Hodômetro digitado errado: fica sem medição.
      await postar(abastecimentos, { date: "2026-05-25", liters: "30", totalCost: "180", odometer: "9000" });

      type Linha = { date: string; odometer: number; km: number | null; kmPorLitro: number | null; custoPorKm: number | null; station: string | null };
      const lista = await listar<Linha>(abastecimentos);
      expect(lista.map((l) => [l.date.slice(0, 10), l.odometer, l.km, l.kmPorLitro, l.custoPorKm])).toEqual([
        ["2026-05-25", 9000, null, null, null],
        ["2026-05-20", 10955, 455, 10, 0.6],
        ["2026-05-10", 10500, 500, 10, 0.6],
        ["2026-05-01", 10000, null, null, null],
      ]);
      expect(JSON.stringify(lista)).not.toContain("password");

      // Sem o do meio, o trecho seguinte passa a ser medido contra o primeiro.
      expect((await abastecimento.DELETE(req("DELETE"), ctxDe(veiculoId, doMeio.corpo.id))).status).toBe(200);
      expect((await abastecimento.DELETE(req("DELETE"), ctxDe(veiculoId, doMeio.corpo.id))).status).toBe(404);
      const depois = await listar<Linha>(abastecimentos);
      expect(depois.map((l) => [l.odometer, l.km])).toEqual([
        [9000, null],
        [10955, 955],
        [10000, null],
      ]);
    });

    it("o registro só é excluído pelo veículo a que pertence", async () => {
      entrarComo("OPERATION");
      const criado = await postar(abastecimentos, ABASTECIMENTO);
      expect((await abastecimento.DELETE(req("DELETE"), ctxDe(veiculoParadoId, criado.corpo.id))).status).toBe(404);
      expect(await listar(abastecimentos)).toHaveLength(1);
    });
  });

  describe("documentos", () => {
    it("registra, calcula a situação de hoje, renova pelo vencimento e exclui", async () => {
      entrarComo("OPERATION");
      const vencido = await postar(documentos, { type: "LICENSING", expiresAt: daquiA(-3).toISOString().slice(0, 10), number: "", notes: "" });
      const aVencer = await postar(documentos, { type: "INSURANCE", expiresAt: daquiA(30).toISOString().slice(0, 10), number: "APO-9", notes: "Renovar com a corretora" });
      const emDia = await postar(documentos, { type: "ANTT", expiresAt: daquiA(31).toISOString().slice(0, 10) });
      expect([vencido.status, aVencer.status, emDia.status]).toEqual([201, 201, 201]);
      expect(vencido.corpo).toMatchObject({ type: "LICENSING", number: null, notes: null });

      type Linha = { type: string; situacao: string; dias: number; number: string | null; notes: string | null; expiresAt: string };
      expect((await listar<Linha>(documentos)).map((d) => [d.type, d.situacao, d.dias])).toEqual([
        ["LICENSING", "vencido", -3],
        ["INSURANCE", "a_vencer", 30],
        ["ANTT", "em_dia", 31],
      ]);

      // Renovação: o vencimento novo põe o documento em dia; o resto fica como estava.
      const renovado = await documento.PATCH(req("PATCH", { expiresAt: daquiA(365).toISOString().slice(0, 10) }), ctxDe(veiculoId, vencido.corpo.id));
      expect(renovado.status).toBe(200);
      const alterado = await documento.PATCH(req("PATCH", { notes: "", number: "APO-10" }), ctxDe(veiculoId, aVencer.corpo.id));
      expect(await alterado.json()).toMatchObject({ type: "INSURANCE", number: "APO-10", notes: null });

      const lista = await listar<Linha>(documentos);
      expect(lista.map((d) => [d.type, d.situacao])).toEqual([
        ["INSURANCE", "a_vencer"],
        ["ANTT", "em_dia"],
        ["LICENSING", "em_dia"],
      ]);

      expect((await documento.PATCH(req("PATCH", {}), ctxDe(veiculoId, vencido.corpo.id))).status).toBe(400);
      expect((await documento.PATCH(req("PATCH", { notes: "x" }), ctxDe(veiculoParadoId, vencido.corpo.id))).status).toBe(404);
      expect((await documento.DELETE(req("DELETE"), ctxDe(veiculoId, emDia.corpo.id))).status).toBe(200);
      expect((await documento.DELETE(req("DELETE"), ctxDe(veiculoId, emDia.corpo.id))).status).toBe(404);
      expect(await listar(documentos)).toHaveLength(2);
    });
  });

  describe("pneus", () => {
    it("registra, dá baixa pelo km de retirada, devolve ao veículo e exclui", async () => {
      entrarComo("OPERATION");
      const emUso = await postar(pneus, PNEU);
      const outro = await postar(pneus, { ...PNEU, position: "Dianteiro direito", installedAt: "2026-02-10", notes: "Recapado" });
      expect([emUso.status, outro.status]).toEqual([201, 201]);
      expect(emUso.corpo).toMatchObject({ position: "Dianteiro esquerdo", installedKm: 50000, removedKm: null, notes: null, installedAt: "2026-01-10T00:00:00.000Z" });

      const menor = await pneu.PATCH(req("PATCH", { removedKm: "49999" }), ctxDe(veiculoId, outro.corpo.id));
      expect(menor.status).toBe(400);
      expect((await menor.json()).error).toBe(REMOVED_KM_MESSAGE);

      const baixa = await pneu.PATCH(req("PATCH", { removedKm: "110000" }), ctxDe(veiculoId, outro.corpo.id));
      expect(await baixa.json()).toMatchObject({ removedKm: 110000, notes: "Recapado", position: "Dianteiro direito" });

      // Em uso primeiro, retirado depois.
      type Linha = { position: string; removedKm: number | null };
      expect((await listar<Linha>(pneus)).map((p) => [p.position, p.removedKm])).toEqual([
        ["Dianteiro esquerdo", null],
        ["Dianteiro direito", 110000],
      ]);

      const devolvido = await pneu.PATCH(req("PATCH", { removedKm: "", position: "Estepe" }), ctxDe(veiculoId, outro.corpo.id));
      expect(await devolvido.json()).toMatchObject({ removedKm: null, position: "Estepe" });

      expect((await pneu.PATCH(req("PATCH", { notes: "x" }), ctxDe(veiculoParadoId, emUso.corpo.id))).status).toBe(404);
      expect((await pneu.DELETE(req("DELETE"), ctxDe(veiculoId, emUso.corpo.id))).status).toBe(200);
      expect((await pneu.DELETE(req("DELETE"), ctxDe(veiculoId, emUso.corpo.id))).status).toBe(404);
      expect(await listar(pneus)).toHaveLength(1);
    });
  });

  describe("checklist", () => {
    it("pelo painel: guarda cada item, quem fez e quando; o mais recente vem primeiro", async () => {
      entrarComo("OPERATION");
      const tudoOk = await postar(checklists, CHECKLIST);
      expect(tudoOk.status).toBe(201);
      expect(tudoOk.corpo).toMatchObject({ items: CHECKLIST_TUDO_OK, odometer: 10600, notes: null, user: { name: `${PREFIXO}OPERATION` } });

      entrarComo("ADMIN");
      const comProblema = await postar(checklists, { items: { ...CHECKLIST_TUDO_OK, freios: false, extintor: false }, odometer: "", notes: "Extintor vencido" });
      expect(comProblema.status).toBe(201);

      type Linha = { items: unknown; user: { name: string } | null; notes: string | null; odometer: number | null; date: string };
      const lista = await listar<Linha>(checklists);
      expect(lista.map((c) => [c.user?.name, problemasDoChecklist(c.items), c.odometer, c.notes])).toEqual([
        [`${PREFIXO}ADMIN`, ["Freios", "Extintor"], null, "Extintor vencido"],
        [`${PREFIXO}OPERATION`, [], 10600, null],
      ]);
      expect(Math.abs(Date.now() - new Date(lista[0].date).getTime())).toBeLessThan(60_000);
    });

    it("pelo app: o motorista registra para o veículo da própria viagem em rota, e só dela", async () => {
      const db = banco.default;
      const emRota = await db.manifest.create({ data: { driverId: motoristaId, vehicleId: veiculoId, status: "ROUTE" } });
      const emMontagem = await db.manifest.create({ data: { driverId: motoristaId, vehicleId: veiculoParadoId, status: "ASSEMBLING" } });
      const deOutro = await db.manifest.create({ data: { driverId: motoristaInativoId, vehicleId: veiculoParadoId, status: "ROUTE" } });

      const enviar = (manifestId: unknown, extra: Corpo = {}) =>
        checklistDoMotorista.POST(req("POST", { items: { ...CHECKLIST_TUDO_OK, luzes: false }, odometer: "10700", notes: "Farol queimado", manifestId, ...extra }));

      entrarComo("DRIVER");
      const feito = await enviar(emRota.id, { vehicleId: veiculoParadoId });
      expect(feito.status).toBe(201);
      expect(await feito.json()).toMatchObject({ odometer: 10700, notes: "Farol queimado", user: { name: `${PREFIXO}DRIVER` } });

      for (const [nome, manifestId] of [["em montagem", emMontagem.id], ["de outro motorista", deOutro.id], ["inexistente", SEM_ID]] as const) {
        const res = await enviar(manifestId);
        expect(res.status, nome).toBe(404);
      }
      expect((await enviar(undefined)).status).toBe(400);
      expect((await checklistDoMotorista.POST(req("POST", { manifestId: emRota.id, items: { pneus: true } }))).status).toBe(400);

      // Motorista desativado não registra nem na própria viagem.
      entrarComo("INATIVO");
      expect((await enviar(deOutro.id)).status).toBe(403);

      // Um registro só, no veículo da viagem (o `vehicleId` do corpo é ignorado), e ele aparece no painel.
      entrarComo("OPERATION");
      const doVeiculo = await listar<{ items: unknown; user: { name: string } | null }>(checklists);
      expect(doVeiculo.map((c) => [c.user?.name, problemasDoChecklist(c.items)])).toEqual([[`${PREFIXO}DRIVER`, ["Luzes"]]]);
      expect(await listar(checklists, veiculoParadoId)).toEqual([]);
    });
  });

  describe("manutenção", () => {
    it("continua aceitando o corpo antigo e lançando a despesa; tipo e hodômetro são gravados quando vêm", async () => {
      entrarComo("OPERATION");
      const antiga = await postar(manutencao, MANUTENCAO);
      expect(antiga.status).toBe(201);
      expect(antiga.corpo).toMatchObject({ description: MANUTENCAO.description, cost: 350.5, status: "COMPLETED", kind: null, odometer: null, vehicleId: veiculoId });

      const nova = await postar(manutencao, { description: `${PREFIXO}freios`, cost: 800, date: "2026-05-20", kind: "CORRECTIVE", odometer: "88000" });
      expect(nova.corpo).toMatchObject({ status: "SCHEDULED", kind: "CORRECTIVE", odometer: 88000, date: "2026-05-20T00:00:00.000Z" });

      const lista = await listar<{ description: string; kind: string | null }>(manutencao);
      expect(lista.map((m) => [m.description, m.kind])).toEqual([
        [`${PREFIXO}freios`, "CORRECTIVE"],
        [MANUTENCAO.description, null],
      ]);

      const despesas = await banco.default.financialTransaction.findMany({
        where: { description: { startsWith: `Manutenção: ${PREFIXO}` } },
        orderBy: { amount: "asc" },
        select: { type: true, amount: true, status: true, dueDate: true },
      });
      expect(despesas).toEqual([
        { type: "EXPENSE", amount: 350.5, status: "PENDING", dueDate: dia("2026-05-12") },
        { type: "EXPENSE", amount: 800, status: "PENDING", dueDate: dia("2026-05-20") },
      ]);
    });
  });

  describe("custos do veículo", () => {
    const pedir = (query = "de=2019-03&ate=2019-04", id = veiculoId) => custos.GET(req("GET", undefined, query), ctx(id));

    it("período inválido é 400; sem período vale o mês corrente e os dois anteriores", async () => {
      entrarComo("ADMIN");
      for (const query of ["de=2019-04&ate=2019-03", "de=abc&ate=2019-04", "de=2015-01&ate=2019-04"]) {
        const res = await pedir(query);
        expect(res.status, query).toBe(400);
        expect((await res.json()).error).toMatch(/Período inválido/);
      }
      const padrao = await (await pedir("")).json();
      expect(padrao.periodo.ate).toBe(diaNoBrasil(new Date()).slice(0, 7));
      expect(padrao).toMatchObject({ total: 0, kmRodados: null, custoPorKm: null, consumoMedio: null });
    });

    it("soma a manutenção concluída e o abastecimento do período, pelo dia do calendário, e mede km pelo hodômetro", async () => {
      const db = banco.default;
      const abastecer = (data: string, odometer: number, liters: number, totalCost: number, vehicleId = veiculoId) =>
        db.fueling.create({ data: { vehicleId, date: dia(data), odometer, liters, totalCost } });
      const manter = (data: string, cost: number, status: string, vehicleId = veiculoId) =>
        db.maintenance.create({ data: { vehicleId, description: `${PREFIXO}serviço`, cost, date: dia(data), status } });

      // Antes do período: só dá o hodômetro de partida.
      await abastecer("2019-02-20", 10000, 40, 240);
      // Primeiro e último dia do período, à meia-noite UTC: os dois entram.
      await abastecer("2019-03-01", 10500, 50, 300);
      await abastecer("2019-04-30", 11100, 60, 360);
      // Depois do período, e de outro veículo: ficam de fora.
      await abastecer("2019-05-01", 11500, 40, 240);
      await abastecer("2019-03-15", 500, 99, 999, veiculoParadoId);

      await manter("2019-03-10", 500, "COMPLETED");
      await manter("2019-04-30", 100.5, "COMPLETED");
      await manter("2019-03-11", 999, "SCHEDULED");
      await manter("2019-03-12", 999, "IN_PROGRESS");
      await manter("2019-05-01", 999, "COMPLETED");
      await manter("2019-02-28", 999, "COMPLETED");
      await manter("2019-03-10", 999, "COMPLETED", veiculoParadoId);

      entrarComo("ADMIN");
      const res = await pedir();
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        periodo: { de: "2019-03", ate: "2019-04" },
        manutencao: 600.5,
        abastecimento: 660,
        total: 1260.5,
        litros: 110,
        kmRodados: 1100,
        custoPorKm: 1.15,
        consumoMedio: 10,
      });

      // Um mês só: o abastecimento de março parte do de fevereiro.
      expect(await (await pedir("de=2019-03&ate=2019-03")).json()).toMatchObject({ manutencao: 500, abastecimento: 300, total: 800, kmRodados: 500, custoPorKm: 1.6, consumoMedio: 10 });
    });
  });

  describe("alertas da frota", () => {
    type Alertas = {
      resumo: { vencidos: number; aVencer: number; emManutencao: number };
      alertas: AlertaDeVencimento[];
      emManutencao: { id: string; plate: string; model: string; servico: string | null }[];
      custoDoMes?: { mes: string; manutencao: number; abastecimento: number; total: number };
    };
    const ler = async (perfil: "ADMIN" | "OPERATION" = "ADMIN") => {
      entrarComo(perfil);
      const res = await frota.GET();
      expect(res.status).toBe(200);
      return (await res.json()) as Alertas;
    };
    const meus = (alertas: AlertaDeVencimento[]) => alertas.filter((a) => a.de === PLACA || a.de.startsWith(PREFIXO));

    it("documentos e CNHs vencidos ou a vencer em 30 dias, numa lista só; o que está em dia e o motorista inativo ficam de fora", async () => {
      const db = banco.default;
      const antes = await ler();

      const documentar = (type: string, dias: number, number: string | null = null) =>
        db.vehicleDocument.create({ data: { vehicleId: veiculoId, type, number, expiresAt: daquiA(dias) } });
      const vencido = await documentar("LICENSING", -10);
      const hoje = await documentar("TACHOGRAPH", 0, "TAC-1");
      const noLimite = await documentar("INSURANCE", 30);
      await documentar("ANTT", 31);
      await db.driver.update({ where: { id: motoristaId }, data: { cnhExpiry: daquiA(12) } });

      const { alertas, resumo } = await ler("OPERATION");
      expect(meus(alertas).map((a) => [a.chave, a.origem, a.rotulo, a.de, a.vehicleId, a.numero, a.dias, a.situacao])).toEqual([
        [`documento-${vencido.id}`, "DOCUMENTO", "Licenciamento (CRLV)", PLACA, veiculoId, null, -10, "vencido"],
        [`documento-${hoje.id}`, "DOCUMENTO", "Tacógrafo", PLACA, veiculoId, "TAC-1", 0, "a_vencer"],
        [`cnh-${motoristaId}`, "CNH", "CNH", `${PREFIXO}DRIVER`, null, "55555555501", 12, "a_vencer"],
        [`documento-${noLimite.id}`, "DOCUMENTO", "Seguro", PLACA, veiculoId, null, 30, "a_vencer"],
      ]);
      // A lista inteira está em ordem de vencimento, com o que mais houver no banco de teste.
      expect(alertas.map((a) => a.vencimento)).toEqual([...alertas.map((a) => a.vencimento)].sort());
      expect(resumo.vencidos - antes.resumo.vencidos).toBe(1);
      expect(resumo.aVencer - antes.resumo.aVencer).toBe(3);
      // O motorista inativo tem a CNH vencida há 50 dias e não aparece.
      expect(alertas.some((a) => a.chave === `cnh-${motoristaInativoId}`)).toBe(false);
    });

    it("veículos em manutenção, com o serviço em aberto quando há um", async () => {
      const semServico = (await ler()).emManutencao;
      expect(semServico.find((v) => v.id === veiculoParadoId)).toEqual({ id: veiculoParadoId, plate: PLACA_PARADA, model: `${PREFIXO}van`, servico: null });
      expect(semServico.some((v) => v.id === veiculoId)).toBe(false);

      const db = banco.default;
      await db.maintenance.create({ data: { vehicleId: veiculoParadoId, description: `${PREFIXO}já feito`, cost: 10, date: daquiA(-1), status: "COMPLETED" } });
      await db.maintenance.create({ data: { vehicleId: veiculoParadoId, description: `${PREFIXO}retífica`, cost: 10, date: daquiA(-2), status: "IN_PROGRESS" } });

      const { emManutencao, resumo } = await ler("OPERATION");
      expect(emManutencao.find((v) => v.id === veiculoParadoId)?.servico).toBe(`${PREFIXO}retífica`);
      expect(resumo.emManutencao).toBe(emManutencao.length);
    });

    it("custo do mês: manutenção concluída e abastecimento de todos os veículos no mês corrente, só para o administrador", async () => {
      const antes = (await ler()).custoDoMes!;
      expect(antes.mes).toBe(diaNoBrasil(new Date()).slice(0, 7));

      const db = banco.default;
      const hoje = daquiA(0);
      await db.fueling.create({ data: { vehicleId: veiculoId, date: hoje, odometer: 1000, liters: 20, totalCost: 123.45 } });
      await db.fueling.create({ data: { vehicleId: veiculoParadoId, date: hoje, odometer: 1000, liters: 10, totalCost: 60 } });
      await db.maintenance.create({ data: { vehicleId: veiculoId, description: `${PREFIXO}serviço`, cost: 100, date: hoje, status: "COMPLETED" } });
      await db.maintenance.create({ data: { vehicleId: veiculoId, description: `${PREFIXO}serviço`, cost: 999, date: hoje, status: "SCHEDULED" } });
      // De outro mês: fica de fora.
      await db.fueling.create({ data: { vehicleId: veiculoId, date: dia("2019-03-10"), odometer: 10, liters: 10, totalCost: 5000 } });

      const depois = (await ler()).custoDoMes!;
      expect(depois.abastecimento - antes.abastecimento).toBeCloseTo(183.45, 2);
      expect(depois.manutencao - antes.manutencao).toBeCloseTo(100, 2);
      expect(depois.total - antes.total).toBeCloseTo(283.45, 2);

      expect(await ler("OPERATION")).not.toHaveProperty("custoDoMes");
    });
  });

  describe("isolamento entre empresas", () => {
    it("veículo de outra empresa não existe: 404 em toda rota, e nada é gravado nele", async () => {
      entrarComo("ADMIN");
      expect((await veiculo.GET(req(), ctx(veiculoDaOutraId))).status).toBe(404);
      for (const [rota, corpo] of [[abastecimentos, ABASTECIMENTO], [documentos, DOCUMENTO], [pneus, PNEU], [checklists, CHECKLIST], [manutencao, MANUTENCAO]] as const) {
        expect((await postar(rota, corpo, veiculoDaOutraId)).status).toBe(404);
      }
      expect((await custos.GET(req(), ctx(veiculoDaOutraId))).status).toBe(404);

      const { sistema } = banco;
      const doAlheio = { vehicleId: veiculoDaOutraId };
      expect([
        await sistema.fueling.count({ where: doAlheio }),
        await sistema.vehicleDocument.count({ where: doAlheio }),
        await sistema.tire.count({ where: doAlheio }),
        await sistema.vehicleChecklist.count({ where: doAlheio }),
        await sistema.maintenance.count({ where: doAlheio }),
      ]).toEqual([0, 0, 0, 0, 0]);
    });

    it("registro de outra empresa não aparece, não muda e não é apagado; os alertas e o custo não o enxergam", async () => {
      const outra = banco.paraEmpresa(EMPRESA_OUTRA.id).db;
      const hoje = daquiA(0);
      const alheio = {
        abastecimento: await outra.fueling.create({ data: { vehicleId: veiculoDaOutraId, date: hoje, odometer: 1, liters: 1, totalCost: 7777.77 } }),
        documento: await outra.vehicleDocument.create({ data: { vehicleId: veiculoDaOutraId, type: "INSURANCE", expiresAt: daquiA(-1), number: `${PREFIXO}alheio` } }),
        pneu: await outra.tire.create({ data: { vehicleId: veiculoDaOutraId, position: "Estepe", brandModel: `${PREFIXO}alheio`, installedAt: hoje, installedKm: 1 } }),
        checklist: await outra.vehicleChecklist.create({ data: { vehicleId: veiculoDaOutraId, items: CHECKLIST_TUDO_OK, notes: `${PREFIXO}alheio` } }),
      };
      await outra.maintenance.create({ data: { vehicleId: veiculoDaOutraId, description: `${PREFIXO}alheio`, cost: 8888.88, date: hoje, status: "COMPLETED" } });

      entrarComo("ADMIN");
      const antes = await (await frota.GET()).json();
      expect(JSON.stringify(antes)).not.toContain(PLACA_DA_OUTRA);
      expect(JSON.stringify(antes)).not.toContain(`${PREFIXO}motorista da outra`);
      expect(JSON.stringify(antes)).not.toContain(`${PREFIXO}alheio`);

      // Nem usando o id do registro alheio por baixo de um veículo da própria empresa.
      expect((await abastecimento.DELETE(req("DELETE"), ctxDe(veiculoId, alheio.abastecimento.id))).status).toBe(404);
      expect((await documento.PATCH(req("PATCH", { notes: "invadido" }), ctxDe(veiculoId, alheio.documento.id))).status).toBe(404);
      expect((await documento.DELETE(req("DELETE"), ctxDe(veiculoDaOutraId, alheio.documento.id))).status).toBe(404);
      expect((await pneu.PATCH(req("PATCH", { notes: "invadido" }), ctxDe(veiculoDaOutraId, alheio.pneu.id))).status).toBe(404);
      expect((await pneu.DELETE(req("DELETE"), ctxDe(veiculoId, alheio.pneu.id))).status).toBe(404);

      const { sistema } = banco;
      expect(await sistema.fueling.count({ where: { id: alheio.abastecimento.id } })).toBe(1);
      expect((await sistema.vehicleDocument.findUniqueOrThrow({ where: { id: alheio.documento.id } })).notes).toBeNull();
      expect((await sistema.tire.findUniqueOrThrow({ where: { id: alheio.pneu.id } })).notes).toBeNull();
      expect(await sistema.vehicleChecklist.count({ where: { id: alheio.checklist.id } })).toBe(1);

      // E a outra empresa enxerga só o que é dela.
      expect(await outra.fueling.count({ where: { vehicle: { plate: PLACA } } })).toBe(0);
      expect(await outra.vehicle.count({ where: { plate: PLACA } })).toBe(0);
    });

    it("motorista de outra empresa não entra num abastecimento, nem pela rota nem direto no banco", async () => {
      entrarComo("OPERATION");
      const res = await postar(abastecimentos, { ...ABASTECIMENTO, driverId: motoristaDaOutraId });
      expect(res.status).toBe(400);

      // O gatilho do banco recusa a referência entre empresas mesmo sem a conferência da rota.
      await expect(
        banco.default.fueling.create({ data: { vehicleId: veiculoId, driverId: motoristaDaOutraId, date: dia("2026-05-10"), odometer: 1, liters: 1, totalCost: 1 } }),
      ).rejects.toThrow();
      await expect(
        banco.default.vehicleDocument.create({ data: { vehicleId: veiculoDaOutraId, type: "ANTT", expiresAt: dia("2030-01-01") } }),
      ).rejects.toThrow();
      await expect(
        banco.default.tire.create({ data: { vehicleId: veiculoDaOutraId, position: "Estepe", brandModel: "x", installedAt: dia("2026-01-01"), installedKm: 1 } }),
      ).rejects.toThrow();
      await expect(banco.default.vehicleChecklist.create({ data: { vehicleId: veiculoDaOutraId, items: CHECKLIST_TUDO_OK } })).rejects.toThrow();
      expect(await listar(abastecimentos)).toEqual([]);
    });
  });
});
