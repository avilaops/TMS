import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getServerSession } from "next-auth";
import type { Prisma } from "@prisma/client";
import { updateDriverSchema } from "../src/lib/cadastros";
import { adiantamentoNoFechamento } from "../src/lib/equipe";
import {
  ADVANCES_CHANGED,
  ALREADY_CLOSED,
  AVISO_DO_DEMONSTRATIVO,
  CATEGORIA_DA_REMUNERACAO,
  CLOSING_ALREADY_PAID,
  CLOSING_NOT_FOUND,
  FUTURE_MONTH,
  MES_MESSAGE,
  NOTHING_TO_CLOSE,
  REMUNERACAO_SO_DE_QUEM_PAGA,
  SEM_FORMAS,
  type FechamentoDoMes,
  type LinhaDeViagem,
  type PessoaDoFechamento,
  type ReciboDoFechamento,
  type RemuneracaoDoMotorista,
  adiantamentosDoFechamento,
  apurarAjudante,
  apurarViagem,
  avisoDeSemAcerto,
  basesPorExtenso,
  contaCongelada,
  contaDoMes,
  descontoDoAdiantamento,
  descontoPorExtenso,
  descricaoDoFechamento,
  diasDeViagem,
  diferencaDoFechamento,
  fecharMesSchema,
  formasPorExtenso,
  lerDetalhes,
  limitesDoMes,
  mesAtual,
  mesDaViagem,
  mesValido,
  mesVizinho,
  parcelasPorExtenso,
  remuneracaoDoAjudanteSchema,
  saldoAnteriorPorExtenso,
  saldoDevedor,
  temForma,
  temOQueFechar,
  valorALancar,
  visibilidadeSchema,
} from "../src/lib/remuneracao";
import { acertoDaViagem, type AcertoDaViagem } from "../src/lib/viagem";
import type { Resultado } from "../src/lib/relatorios";
import { EMPRESA_OUTRA, EMPRESA_PADRAO } from "./empresas-de-teste";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

const em = (data: string, hora = "12:00") => new Date(`${data}T${hora}:00-03:00`);

/** As contas da remuneração variável, sem banco: viagens na mão. */
describe("contas da remuneração variável", () => {
  const TODAS = { commissionPct: 10, dailyRate: 100, perKmRate: 0.5, perDeliveryRate: 20, perTripRate: 50 };

  const viagem = (extra: Record<string, unknown> = {}) => ({
    status: "FINISHED",
    createdAt: em("2013-08-01"),
    updatedAt: em("2013-08-07", "18:00"),
    departedAt: em("2013-08-05", "10:00"),
    finishedAt: em("2013-08-07", "18:00"),
    departureOdometer: 1000 as number | null,
    returnOdometer: 1400 as number | null,
    collections: [
      { status: "DELIVERED", freightValue: 1000 as number | null },
      { status: "DELIVERED", freightValue: 500 as number | null },
    ],
    freightContract: null as { status: string } | null,
    ...extra,
  });

  describe("dias de viagem", () => {
    it("conta o dia da saída e o da finalização, no relógio do Brasil", () => {
      expect(diasDeViagem(viagem())).toBe(3);
      expect(diasDeViagem(viagem({ departedAt: em("2013-08-05", "08:00"), finishedAt: em("2013-08-05", "20:00") }))).toBe(1);
    });

    it("a virada do dia é a do Brasil, não a de UTC", () => {
      // 22h do dia 5 no Brasil já é dia 6 em UTC: a viagem saiu e voltou no dia 5.
      expect(diasDeViagem(viagem({ departedAt: em("2013-08-05", "20:00"), finishedAt: em("2013-08-05", "22:30") }))).toBe(1);
      // Saiu às 23h30 do dia 5 e voltou à 0h30 do dia 6: dois dias de calendário.
      expect(diasDeViagem(viagem({ departedAt: em("2013-08-05", "23:30"), finishedAt: em("2013-08-06", "00:30") }))).toBe(2);
    });

    it("sem a data da saída vale a da criação; sem a da finalização, a da última alteração", () => {
      expect(diasDeViagem(viagem({ departedAt: null, finishedAt: null }))).toBe(7);
    });
  });

  describe("apuração por viagem", () => {
    it("cada forma com valor entra na conta, e o total é a soma", () => {
      const apuracao = apurarViagem(viagem(), TODAS);
      expect(apuracao).toMatchObject({ dias: 3, km: 400, entregas: 2, frete: 1500, semKm: false, fora: null });
      expect(apuracao.parcelas).toEqual({ comissao: 150, diarias: 300, porKm: 200, porEntrega: 40, fixo: 50 });
      expect(apuracao.total).toBe(740);
    });

    it("forma sem valor no cadastro fica de fora (`null`), que é diferente de valor zero", () => {
      const apuracao = apurarViagem(viagem(), { ...SEM_FORMAS, dailyRate: 80, perTripRate: 0 });
      expect(apuracao.parcelas).toEqual({ comissao: null, diarias: 240, porKm: null, porEntrega: null, fixo: 0 });
      expect(apuracao.total).toBe(240);
      expect(apurarViagem(viagem(), SEM_FORMAS).total).toBe(0);
      expect(temForma(SEM_FORMAS)).toBe(false);
      expect(temForma({ perKmRate: 0 })).toBe(true);
    });

    it("viagem sem os dois hodômetros não gera valor por km, e a apuração diz", () => {
      for (const extra of [{ returnOdometer: null }, { departureOdometer: null }, { departureOdometer: 1400, returnOdometer: 1000 }]) {
        const apuracao = apurarViagem(viagem(extra), TODAS);
        expect(apuracao.km, JSON.stringify(extra)).toBeNull();
        expect(apuracao.parcelas.porKm).toBeNull();
        expect(apuracao.semKm).toBe(true);
        expect(apuracao.total).toBe(540);
      }
      // Sem valor por km no cadastro não há o que explicar.
      expect(apurarViagem(viagem({ returnOdometer: null }), { ...TODAS, perKmRate: null }).semKm).toBe(false);
    });

    it("só carga entregue conta como entrega e entra no frete da comissão; carga a cotar não soma", () => {
      const cargas = [
        { status: "DELIVERED", freightValue: 1000 },
        { status: "DELIVERED", freightValue: null },
        { status: "ROUTE", freightValue: 700 },
        { status: "COLLECTED", freightValue: 300 },
      ];
      const apuracao = apurarViagem(viagem({ collections: cargas }), TODAS);
      expect(apuracao).toMatchObject({ entregas: 2, frete: 1000 });
      expect(apuracao.parcelas).toMatchObject({ comissao: 100, porEntrega: 40 });
    });

    it("arredonda cada parcela em centavos", () => {
      const apuracao = apurarViagem(viagem({ returnOdometer: 1333, collections: [{ status: "DELIVERED", freightValue: 333.33 }] }), { ...SEM_FORMAS, commissionPct: 3.3, perKmRate: 0.333 });
      expect(apuracao.parcelas).toMatchObject({ comissao: 11, porKm: 110.89 });
      expect(apuracao.total).toBe(121.89);
    });

    it("viagem que não foi finalizada ainda não rende nada", () => {
      for (const status of ["ASSEMBLING", "ROUTE", "CANCELLED"]) {
        expect(apurarViagem(viagem({ status }), TODAS, { hoje: em("2013-08-08") }).total, status).toBe(0);
      }
    });

    it("motorista de parceiro em viagem com contrato de frete fica fora: o pagamento é o do contrato", () => {
      const comContrato = viagem({ freightContract: { status: "ABERTO" } });
      const apuracao = apurarViagem(comContrato, TODAS, { motoristaDeParceiro: true });
      expect(apuracao).toMatchObject({ total: 0, fora: "PARCEIRO", semKm: false, dias: 3, km: 400, entregas: 2 });
      expect(apuracao.parcelas).toEqual({ comissao: null, diarias: null, porKm: null, porEntrega: null, fixo: null });

      // Contrato cancelado não paga ninguém: a remuneração volta a valer.
      expect(apurarViagem(viagem({ freightContract: { status: "CANCELADO" } }), TODAS, { motoristaDeParceiro: true })).toMatchObject({ total: 740, fora: null });
      // Motorista de parceiro em viagem sem contrato (veículo da frota própria): vale a remuneração.
      expect(apurarViagem(viagem(), TODAS, { motoristaDeParceiro: true })).toMatchObject({ total: 740, fora: null });
      // Motorista da empresa dirigindo veículo de parceiro com contrato: a remuneração dele é dele.
      expect(apurarViagem(comContrato, TODAS)).toMatchObject({ total: 740, fora: null });
    });

    it("o ajudante tem só diária e fixo, e o contrato com o parceiro não o tira da conta", () => {
      const apuracao = apurarAjudante(viagem({ freightContract: { status: "ABERTO" } }), { dailyRate: 60, perTripRate: 30 });
      expect(apuracao.parcelas).toEqual({ comissao: null, diarias: 180, porKm: null, porEntrega: null, fixo: 30 });
      expect(apuracao).toMatchObject({ total: 210, fora: null });
      expect(apurarAjudante(viagem(), { dailyRate: null, perTripRate: null }).total).toBe(0);
    });
  });

  describe("fechamento do mês", () => {
    const linha = (manifestId: string, finalizada: string, total: number, parcelas: Partial<LinhaDeViagem["parcelas"]> = {}): LinhaDeViagem => ({
      manifestId,
      codigo: manifestId.toUpperCase(),
      saida: finalizada,
      finalizada,
      placa: "ABC1D23",
      dias: 1,
      km: null,
      entregas: 1,
      frete: 0,
      parcelas: { comissao: null, diarias: total, porKm: null, porEntrega: null, fixo: null, ...parcelas },
      total,
      semKm: false,
      fora: null,
    });
    const adiantamento = (id: string, date: string, amount: number) => ({ id, date, amount, reason: "VOUCHER" });

    it("soma o variável, desconta os adiantamentos e dá o saldo; as viagens saem da mais antiga para a mais nova", () => {
      const conta = contaDoMes([linha("b", "2013-08-20", 190.1), linha("a", "2013-08-07", 740.2)], [adiantamento("y", "2013-08-15", 100), adiantamento("x", "2013-08-10", 200.05)]);
      expect(conta.viagens.map((v) => v.manifestId)).toEqual(["a", "b"]);
      expect(conta.adiantamentos.map((a) => a.id)).toEqual(["x", "y"]);
      expect(conta).toMatchObject({ variavel: 930.3, adiantado: 300.05, saldo: 630.25 });
      expect(conta.parcelas).toEqual({ comissao: 0, diarias: 930.3, porKm: 0, porEntrega: 0, fixo: 0 });
      expect(valorALancar(conta)).toBe(630.25);
    });

    it("desconto maior que o variável deixa saldo negativo, e nada é lançado", () => {
      const conta = contaDoMes([linha("a", "2013-08-07", 100)], [adiantamento("x", "2013-08-10", 250)]);
      expect(conta.saldo).toBe(-150);
      expect(valorALancar(conta)).toBe(0);
      expect(valorALancar(contaDoMes([], []))).toBe(0);
    });

    it("a diferença do fechado para a conta de hoje é nula enquanto nada muda", () => {
      const conta = contaDoMes([linha("a", "2013-08-07", 500)], [adiantamento("x", "2013-08-10", 100)]);
      const fechado = { variableTotal: 500, advancesTotal: 100, balance: 400 };
      expect(diferencaDoFechamento(fechado, conta)).toBeNull();
      const depois = contaDoMes([linha("a", "2013-08-07", 500), linha("b", "2013-08-30", 80)], [adiantamento("x", "2013-08-10", 100), adiantamento("z", "2013-08-31", 30)]);
      expect(diferencaDoFechamento(fechado, depois)).toEqual({ variavel: 80, adiantado: 30, saldo: 50 });
    });

    it("a conta congelada sai do que o fechamento guardou; `details` estranho vira listas vazias", () => {
      const viagens = [linha("a", "2013-08-07", 500)];
      const congelada = contaCongelada({ variableTotal: 500, advancesTotal: 100, balance: 400, details: { formas: { dailyRate: 500 }, viagens, adiantamentos: [adiantamento("x", "2013-08-10", 100)] } });
      expect(congelada).toMatchObject({ variavel: 500, adiantado: 100, saldo: 400 });
      expect(congelada.viagens).toHaveLength(1);
      for (const estranho of [null, "texto", 7, { viagens: "nada", saldoAnterior: "muito" }, []]) {
        expect(lerDetalhes(estranho), JSON.stringify(estranho)).toEqual({ formas: {}, viagens: [], adiantamentos: [], semAcerto: [], saldoAnterior: null });
      }
      // Fechamento gravado antes de existirem "de meses anteriores" e "sem acerto": tudo é do mês, sem aviso.
      expect(congelada).toMatchObject({ anteriores: 0, saldoAnterior: null, semAcerto: [] });
    });

    it("só é desconto o que a pessoa deve: o vale em aberto e a sobra a devolver de um acerto; adiantamento sem acerto fica de fora", () => {
      const de = (reason: string, status: string, amount: number, spentAmount: number | null = null) => descontoDoAdiantamento({ reason, status, amount, spentAmount });
      // Vale em aberto: inteiro.
      expect(de("VOUCHER", "OPEN", 200)).toEqual({ valor: 200, origem: "VALE" });
      // Adiantamento de viagem (e o de motivo "outro") em aberto: não se sabe quanto foi gasto.
      expect(de("TRIP", "OPEN", 300)).toBe("SEM_ACERTO");
      expect(de("OTHER", "OPEN", 300)).toBe("SEM_ACERTO");
      // Acertado: só a sobra a devolver é dívida, qualquer que seja o motivo.
      expect(de("TRIP", "SETTLED", 300, 220.5)).toEqual({ valor: 79.5, origem: "SOBRA" });
      expect(de("VOUCHER", "SETTLED", 200, 0)).toEqual({ valor: 200, origem: "SOBRA" });
      // Gastou tudo, ou gastou mais (a empresa é que completa): nada a descontar.
      expect(de("TRIP", "SETTLED", 300, 300)).toBeNull();
      expect(de("TRIP", "SETTLED", 300, 350)).toBeNull();
      expect(de("TRIP", "SETTLED", 300, null)).toBeNull();
    });

    it("separa os adiantamentos do fechamento: os do mês, os de meses anteriores e os sem acerto", () => {
      const bruto = (id: string, date: string, reason: string, status: string, amount: number, spentAmount: number | null = null) => ({ id, date: new Date(`${date}T00:00:00.000Z`), reason, status, amount, spentAmount });
      const { descontos, semAcerto } = adiantamentosDoFechamento(
        [
          bruto("vale-do-mes", "2013-08-10", "VOUCHER", "OPEN", 150),
          bruto("vale-antigo", "2013-06-30", "VOUCHER", "OPEN", 200),
          bruto("sobra", "2013-07-31", "TRIP", "SETTLED", 300, 250),
          bruto("quitado", "2013-08-12", "TRIP", "SETTLED", 100, 100),
          bruto("sem-acerto", "2013-08-20", "TRIP", "OPEN", 400),
          bruto("primeiro-dia", "2013-08-01", "VOUCHER", "OPEN", 10),
        ],
        "2013-08",
      );
      expect(descontos).toEqual([
        { id: "vale-do-mes", date: "2013-08-10", reason: "VOUCHER", amount: 150, origem: "VALE", anterior: false },
        { id: "vale-antigo", date: "2013-06-30", reason: "VOUCHER", amount: 200, origem: "VALE", anterior: true },
        { id: "sobra", date: "2013-07-31", reason: "TRIP", amount: 50, origem: "SOBRA", anterior: true },
        { id: "primeiro-dia", date: "2013-08-01", reason: "VOUCHER", amount: 10, origem: "VALE", anterior: false },
      ]);
      expect(semAcerto).toEqual([{ id: "sem-acerto", date: "2013-08-20", reason: "TRIP", amount: 400, anterior: false }]);

      const conta = contaDoMes([linha("a", "2013-08-07", 1000)], descontos, { semAcerto });
      expect(conta).toMatchObject({ variavel: 1000, adiantado: 410, anteriores: 250, saldo: 590, saldoAnterior: null });
      expect(conta.adiantamentos.map((a) => a.id)).toEqual(["vale-antigo", "sobra", "primeiro-dia", "vale-do-mes"]);
      // O adiantamento sem acerto não entra em número nenhum: só no aviso.
      expect(conta.semAcerto.map((a) => a.id)).toEqual(["sem-acerto"]);
      expect(avisoDeSemAcerto(conta.semAcerto)).toMatch(/^1 adiantamento sem acerto \(R\$\s400,00\) ficou fora da conta: acerte na aba Adiantamentos/);
      expect(avisoDeSemAcerto([...conta.semAcerto, ...conta.semAcerto], true)).toMatch(/^2 adiantamentos sem acerto \(R\$\s800,00\) ficaram fora da conta: a sobra a devolver/);
      expect(avisoDeSemAcerto([])).toBeNull();
      expect(descontos.map(descontoPorExtenso)).toEqual(["Vale", "Vale", "Sobra do adiantamento de viagem", "Vale"]);
    });

    it("o saldo devedor do último fechamento anterior entra como dívida de meses anteriores", () => {
      expect(saldoDevedor(null)).toBeNull();
      expect(saldoDevedor({ month: "2013-07", balance: 0 })).toBeNull();
      expect(saldoDevedor({ month: "2013-07", balance: 120 })).toBeNull();
      const trazido = saldoDevedor({ month: "2013-07", balance: -290.4 });
      expect(trazido).toEqual({ mes: "2013-07", valor: 290.4 });
      expect(saldoAnteriorPorExtenso(trazido!)).toBe("Saldo devedor do fechamento de 07/2013");

      const conta = contaDoMes([linha("a", "2013-08-07", 500)], [{ ...adiantamento("x", "2013-08-10", 100), anterior: false }], { saldoAnterior: trazido });
      expect(conta).toMatchObject({ variavel: 500, adiantado: 390.4, anteriores: 290.4, saldo: 109.6 });
      // Só a dívida trazida, sem viagem nem adiantamento novo, não fecha mês: ela segue para o próximo.
      expect(temOQueFechar(contaDoMes([], [], { saldoAnterior: trazido }))).toBe(false);
      expect(temOQueFechar(conta)).toBe(true);
      expect(temOQueFechar(contaDoMes([], [adiantamento("x", "2013-08-10", 100)]))).toBe(true);
    });

    it("o mês: validade, vizinhos, limites e o mês em que a viagem foi finalizada", () => {
      for (const mes of ["2013-08", "2026-12", "2026-01"]) expect(mesValido(mes), mes).toBe(true);
      for (const mes of ["2013-13", "2013-00", "2013-8", "13-08", "", "2013-08-01"]) expect(mesValido(mes), mes).toBe(false);
      expect(mesVizinho("2013-12", 1)).toBe("2014-01");
      expect(mesVizinho("2014-01", -1)).toBe("2013-12");
      expect(mesAtual(em("2013-08-31", "23:30"))).toBe("2013-08");
      expect(mesAtual(new Date("2013-09-01T01:00:00.000Z"))).toBe("2013-08");

      const limites = limitesDoMes("2013-12");
      expect(limites.instantes.gte.toISOString()).toBe("2013-12-01T03:00:00.000Z");
      expect(limites.instantes.lt.toISOString()).toBe("2014-01-01T03:00:00.000Z");
      expect(limites.dias.gte.toISOString()).toBe("2013-12-01T00:00:00.000Z");
      expect(limites.dias.lt.toISOString()).toBe("2014-01-01T00:00:00.000Z");

      // Finalizada às 23h do dia 31 no Brasil (já dia 1º em UTC): é de agosto.
      expect(mesDaViagem(viagem({ finishedAt: em("2013-08-31", "23:00") }))).toBe("2013-08");
      expect(mesDaViagem(viagem({ status: "ROUTE" }))).toBeNull();
    });

    it("os textos da tela e do recibo", () => {
      expect(formasPorExtenso(SEM_FORMAS)).toBe("Sem forma de remuneração no cadastro");
      expect(formasPorExtenso({ commissionPct: 2.5, dailyRate: 80 })).toMatch(/^Comissão 2,5% · Diária R\$\s80,00$/);
      expect(parcelasPorExtenso({ parcelas: { comissao: 50, diarias: null, porKm: 126.5, porEntrega: null, fixo: null } })).toMatch(/^Comissão R\$\s50,00 · Por km R\$\s126,50$/);
      expect(basesPorExtenso({ dias: 1, km: null, entregas: 1 })).toBe("1 dia · sem km · 1 entrega");
      expect(basesPorExtenso({ dias: 3, km: 1420, entregas: 5 })).toBe("3 dias · 1.420 km · 5 entregas");
      expect(descricaoDoFechamento("2013-08", "Ana")).toBe("Remuneração variável de 08/2013: Ana");
      expect(AVISO_DO_DEMONSTRATIVO).toBe("Demonstrativo de remuneração variável. Não é holerite nem recibo de salário: os encargos e a folha são do contador.");
    });
  });

  describe("custo da viagem", () => {
    it("a remuneração entra no custo total e no resultado, ao lado do frete contratado, uma vez só", () => {
      const base = { cargas: [{ freightValue: 3000 }], despesas: [{ type: "TOLL", amount: 100, status: "APPROVED" }], abastecimentos: [{ totalCost: 200 }], adiantamentos: [] };
      expect(acertoDaViagem(base)).toMatchObject({ remuneracao: 0, custoTotal: 300, resultado: 2700 });
      expect(acertoDaViagem({ ...base, remuneracao: 950.5 })).toMatchObject({ remuneracao: 950.5, custoTotal: 1250.5, resultado: 1749.5, margem: 58.3 });
      expect(acertoDaViagem({ ...base, freteContratado: 1050, remuneracao: 0 })).toMatchObject({ freteContratado: 1050, remuneracao: 0, custoTotal: 1350 });
    });
  });

  describe("validação", () => {
    it("as formas do motorista: vírgula decimal, em branco tira a forma, negativo e texto são recusados", () => {
      expect(updateDriverSchema.parse({ dailyRate: "120,50", perKmRate: "0,35", perDeliveryRate: 8, perTripRate: "" })).toMatchObject({ dailyRate: 120.5, perKmRate: 0.35, perDeliveryRate: 8, perTripRate: null });
      for (const campo of ["dailyRate", "perKmRate", "perDeliveryRate", "perTripRate"] as const) {
        for (const valor of [-1, "abc", 2_000_000]) {
          const recusa = updateDriverSchema.safeParse({ [campo]: valor });
          expect(recusa.success, `${campo}=${String(valor)}`).toBe(false);
          if (!recusa.success) expect(recusa.error.issues[0].message).toMatch(/precisa ser/);
        }
      }
    });

    it("a remuneração do ajudante pede ao menos um campo", () => {
      expect(remuneracaoDoAjudanteSchema.parse({ dailyRate: "60", perTripRate: null })).toEqual({ dailyRate: 60, perTripRate: null });
      expect(remuneracaoDoAjudanteSchema.safeParse({}).success).toBe(false);
      expect(remuneracaoDoAjudanteSchema.safeParse({ dailyRate: -5 }).success).toBe(false);
      expect(remuneracaoDoAjudanteSchema.safeParse(null).success).toBe(false);
    });

    it("fechar o mês pede a pessoa (motorista ou ajudante) e o mês", () => {
      expect(fecharMesSchema.parse({ pessoa: "motorista:abc", mes: "2013-08" })).toEqual({ pessoa: { driverId: "abc", helperId: null }, mes: "2013-08" });
      expect(fecharMesSchema.parse({ pessoa: "ajudante:xyz", mes: "2013-08" }).pessoa).toEqual({ driverId: null, helperId: "xyz" });
      for (const corpo of [{ pessoa: "cliente:abc", mes: "2013-08" }, { pessoa: "motorista:", mes: "2013-08" }, { pessoa: "motorista:abc", mes: "2013-13" }, { mes: "2013-08" }, null]) {
        expect(fecharMesSchema.safeParse(corpo).success, JSON.stringify(corpo)).toBe(false);
      }
    });

    it("o interruptor da empresa é verdadeiro ou falso", () => {
      expect(visibilidadeSchema.parse({ visivelAoMotorista: true })).toEqual({ visivelAoMotorista: true });
      for (const corpo of [{ visivelAoMotorista: "sim" }, {}, null]) expect(visibilidadeSchema.safeParse(corpo).success).toBe(false);
    });
  });
});

/** As rotas da remuneração variável, contra um Postgres de verdade. */
const temBanco = Boolean(process.env.DATABASE_URL);

if (!temBanco) {
  console.warn("\n[remuneracao.test] DATABASE_URL ausente: testes de integração PULADOS.\n");
}

const suite = temBanco ? describe : describe.skip;

// Tudo o que esta suite cria usa estes marcadores, e só isso é apagado.
const PREFIXO = "teste-remuneracao-";
const CNPJ = "99555222000131";
const CNPJ_DA_OUTRA = "99555222000212";
const CPF_MOTORISTA = "44433322201";
const CPF_SEGUNDO = "44433322202";
const CPF_DO_PARCEIRO = "44433322203";
const CPF_MOTORISTA_DA_OUTRA = "44433322204";
const CPFS_DE_MOTORISTA = [CPF_MOTORISTA, CPF_SEGUNDO, CPF_DO_PARCEIRO, CPF_MOTORISTA_DA_OUTRA];
const CPF_AJUDANTE = "44433322211";
const CPF_AJUDANTE_DA_OUTRA = "44433322212";
const CPFS_DE_AJUDANTE = [CPF_AJUDANTE, CPF_AJUDANTE_DA_OUTRA];
const PLACA = "RMV1A23";
const PLACA_DO_PARCEIRO = "RMV1A24";
const PLACA_DA_OUTRA = "RMV1A25";
const PLACAS = [PLACA, PLACA_DO_PARCEIRO, PLACA_DA_OUTRA];
const CNPJ_DO_PARCEIRO = "99555222000808";
const HASH_FALSO = "$2b$10$hashfalsoparateste000000000000000000000000000000000";
const SEM_ID = "00000000-0000-0000-0000-000000000000";
// Um mês que nenhuma outra suite usa: as contas daqui não se misturam com as delas.
const MES = "2013-08";

type Corpo = Record<string, unknown> & { id: string; error?: string };
type Perfil = "ADMIN" | "DIRECTOR" | "OPERATION" | "FINANCE" | "CLIENT" | "DRIVER" | "DRIVER2" | "DRIVER3";
const PERFIS_DO_TESTE: [Perfil, string][] = [
  ["ADMIN", "ADMIN"],
  ["DIRECTOR", "DIRECTOR"],
  ["OPERATION", "OPERATION"],
  ["FINANCE", "FINANCE"],
  ["CLIENT", "CLIENT"],
  ["DRIVER", "DRIVER"],
  ["DRIVER2", "DRIVER"],
  ["DRIVER3", "DRIVER"],
];

const TODAS = { commissionPct: 10, dailyRate: 100, perKmRate: 0.5, perDeliveryRate: 20, perTripRate: 50 };

suite("rotas da remuneração variável", () => {
  let banco: typeof import("../src/lib/prisma");
  let fechamentoRota: typeof import("../src/app/api/equipe/fechamento/route");
  let fechamentoPorId: typeof import("../src/app/api/equipe/fechamento/[id]/route");
  let remuneracaoDoAjudante: typeof import("../src/app/api/equipe/ajudantes/[id]/remuneracao/route");
  let ajudantes: typeof import("../src/app/api/equipe/ajudantes/route");
  let motoristas: typeof import("../src/app/api/motoristas/route");
  let motoristaPorId: typeof import("../src/app/api/motoristas/[id]/route");
  let manifestos: typeof import("../src/app/api/manifestos/route");
  let veiculos: typeof import("../src/app/api/veiculos/route");
  let coletas: typeof import("../src/app/api/coletas/route");
  let acertoRota: typeof import("../src/app/api/manifestos/[id]/acerto/route");
  let relatorios: typeof import("../src/app/api/relatorios/route");
  let empresaRota: typeof import("../src/app/api/empresa/remuneracao/route");
  let doMotorista: typeof import("../src/app/api/driver/remuneracao/route");
  let adiantamentosRota: typeof import("../src/app/api/equipe/adiantamentos/route");
  let adiantamentoPorId: typeof import("../src/app/api/equipe/adiantamentos/[id]/route");

  const sessao = vi.mocked(getServerSession);
  const ids = {} as Record<Perfil, string>;
  let clienteId: string;
  /** O motorista principal: da empresa, com todas as formas de remuneração. */
  let motoristaId: string;
  /** O segundo motorista da empresa: só diária. */
  let segundoId: string;
  /** O motorista do parceiro (`carrierId`), também com formas no cadastro. */
  let doParceiroId: string;
  let veiculoId: string;
  let veiculoDoParceiroId: string;
  let parceiroId: string;
  /** O ajudante: diária de 60 e fixo de 30. */
  let ajudanteId: string;
  const daOutra = { motoristaId: "", ajudanteId: "", veiculoId: "", clienteId: "", fechamentoId: "", viagemId: "" };

  const entrarComo = (perfil: Perfil | null) => sessao.mockResolvedValue(perfil ? { user: { id: ids[perfil], role: perfil.startsWith("DRIVER") ? "DRIVER" : perfil, clientId: null } } : null);

  const req = (method = "GET", body?: unknown, query = "") =>
    new Request(`http://localhost/api/teste${query}`, {
      method,
      headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.9" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const nome = (n: string) => `${PREFIXO}${n}`;
  const dia = (data: string) => new Date(`${data}T00:00:00.000Z`);

  const chamar = async <T = Corpo>(resposta: Promise<Response>) => {
    const res = await resposta;
    return { status: res.status, corpo: (await res.json()) as T };
  };

  const chaveDoMotorista = (id: string) => `motorista:${id}`;
  const chaveDoAjudante = (id: string) => `ajudante:${id}`;

  /** Os lançamentos que esta suite fez no Financeiro DESTA empresa. */
  const lancamentos = () => banco.sistema.financialTransaction.findMany({ where: { tenantId: EMPRESA_PADRAO.id, counterparty: { startsWith: PREFIXO } }, orderBy: { createdAt: "asc" } });
  const fechamentos = () => banco.sistema.crewPayClosing.findMany({ where: { tenantId: EMPRESA_PADRAO.id, OR: [{ driver: { cpf: { in: CPFS_DE_MOTORISTA } } }, { helper: { cpf: { in: CPFS_DE_AJUDANTE } } }] } });
  const trilha = (entityId: string) => banco.sistema.auditLog.findMany({ where: { entityId }, orderBy: { createdAt: "asc" }, select: { action: true, userId: true, summary: true, before: true, after: true } });

  async function limparMovimento() {
    const { sistema } = banco;
    // O fechamento da outra empresa é fixo da suite: fica de um teste para o outro.
    await sistema.crewPayClosing.deleteMany({ where: { tenantId: EMPRESA_PADRAO.id, OR: [{ driver: { cpf: { in: CPFS_DE_MOTORISTA } } }, { helper: { cpf: { in: CPFS_DE_AJUDANTE } } }] } });
    await sistema.crewAdvance.deleteMany({ where: { OR: [{ driver: { cpf: { in: CPFS_DE_MOTORISTA } } }, { helper: { cpf: { in: CPFS_DE_AJUDANTE } } }] } });
    await sistema.collection.deleteMany({ where: { tenantId: EMPRESA_PADRAO.id, client: { cnpj: CNPJ } } });
    // Os contratos de frete e as despesas somem com a viagem (ON DELETE CASCADE).
    await sistema.manifest.deleteMany({ where: { tenantId: EMPRESA_PADRAO.id, vehicle: { plate: { in: PLACAS } } } });
    await sistema.financialTransaction.deleteMany({ where: { counterparty: { startsWith: PREFIXO } } });
    await sistema.auditLog.deleteMany({ where: { userName: { startsWith: PREFIXO } } });
  }

  async function limpar() {
    const { sistema } = banco;
    await limparMovimento();
    await sistema.crewPayClosing.deleteMany({ where: { OR: [{ driver: { cpf: { in: CPFS_DE_MOTORISTA } } }, { helper: { cpf: { in: CPFS_DE_AJUDANTE } } }] } });
    await sistema.collection.deleteMany({ where: { client: { cnpj: { in: [CNPJ, CNPJ_DA_OUTRA] } } } });
    await sistema.manifest.deleteMany({ where: { vehicle: { plate: { in: PLACAS } } } });
    await sistema.vehicle.deleteMany({ where: { plate: { in: PLACAS } } });
    await sistema.helper.deleteMany({ where: { cpf: { in: CPFS_DE_AJUDANTE } } });
    await sistema.driver.deleteMany({ where: { cpf: { in: CPFS_DE_MOTORISTA } } });
    await sistema.carrier.deleteMany({ where: { taxId: CNPJ_DO_PARCEIRO } });
    await sistema.client.deleteMany({ where: { cnpj: { in: [CNPJ, CNPJ_DA_OUTRA] } } });
    await sistema.user.deleteMany({ where: { email: { startsWith: PREFIXO } } });
  }

  type DadosDaViagem = { fretes?: (number | null)[]; saida?: Date; fim?: Date; km?: [number, number] | null; extra?: Partial<Prisma.ManifestUncheckedCreateInput> };

  /** Viagem finalizada gravada direto no banco, com as cargas entregues. Por padrão: 3 dias, 400 km, fretes de 1000 e 500. */
  async function viajar(dados: DadosDaViagem = {}) {
    const { fretes = [1000, 500], saida = em("2013-08-05", "10:00"), fim = em("2013-08-07", "18:00"), km = [1000, 1400] } = dados;
    const viagem = await banco.default.manifest.create({
      data: { driverId: motoristaId, vehicleId: veiculoId, status: "FINISHED", departedAt: saida, finishedAt: fim, departureOdometer: km?.[0] ?? null, returnOdometer: km?.[1] ?? null, ...dados.extra },
    });
    for (const frete of fretes) {
      await banco.default.collection.create({
        data: { clientId: clienteId, sender: "Remetente", receiver: nome("destinatário"), origin: "Rio Preto - SP", destination: "Mirassol - SP", volumes: 1, weight: 10, status: "DELIVERED", freightValue: frete, manifestId: viagem.id, driverId: viagem.driverId },
      });
    }
    return viagem.id;
  }

  /** Um adiantamento gravado direto no banco. Por padrão: um vale de 300 do motorista principal, em aberto, no mês. */
  const adiantar = (dados: Partial<Prisma.CrewAdvanceUncheckedCreateInput> = {}) =>
    banco.default.crewAdvance.create({ data: { driverId: dados.helperId ? null : motoristaId, date: dia("2013-08-10"), amount: 300, reason: "VOUCHER", ...dados } });
  const adiantamentoGravado = (id: string) => banco.sistema.crewAdvance.findUniqueOrThrow({ where: { id }, select: { status: true, spentAmount: true, closingId: true } });
  const agirNoAdiantamento = (id: string, corpo: unknown) => {
    entrarComo("ADMIN");
    return chamar(adiantamentoPorId.PATCH(req("PATCH", corpo), ctx(id)));
  };

  /** Duas viagens do motorista principal (740 + 190 = 930), a primeira com o ajudante (210), e um vale de 300 em aberto. */
  async function mesCheio() {
    const primeira = await viajar({ extra: { helperId: ajudanteId } });
    const segunda = await viajar({ fretes: [200], saida: em("2013-08-20", "08:00"), fim: em("2013-08-20", "19:00"), km: null });
    const vale = (await adiantar()).id;
    // Fora da conta: adiantamento acertado sem sobra (gastou tudo) e vale do mês seguinte.
    const quitado = (await adiantar({ amount: 100, date: dia("2013-08-12"), reason: "TRIP", status: "SETTLED", spentAmount: 100, settledAt: new Date() })).id;
    const doMesSeguinte = (await adiantar({ amount: 50, date: dia("2013-09-01") })).id;
    return { primeira, segunda, vale, quitado, doMesSeguinte };
  }

  const lerFechamento = async (perfil: Perfil = "ADMIN", mes = MES) => {
    entrarComo(perfil);
    return chamar<FechamentoDoMes & { error?: string }>(fechamentoRota.GET(req("GET", undefined, `?mes=${mes}`)));
  };
  /** A pessoa no fechamento do mês, pela chave. */
  const pessoaNoMes = async (chave: string, mes = MES): Promise<PessoaDoFechamento | undefined> => (await lerFechamento("ADMIN", mes)).corpo.pessoas.find((pessoa) => pessoa.chave === chave);
  const fechar = (chave: string, perfil: Perfil = "ADMIN", mes = MES) => {
    entrarComo(perfil);
    return chamar<Corpo & { conta: PessoaDoFechamento["atual"]; lancamento: { id: string; status: string; amount: number } | null }>(fechamentoRota.POST(req("POST", { pessoa: chave, mes })));
  };
  const reabrir = (id: string, perfil: Perfil = "ADMIN") => {
    entrarComo(perfil);
    return chamar(fechamentoPorId.DELETE(req("DELETE"), ctx(id)));
  };
  const lerAcerto = async (viagemId: string) => {
    entrarComo("ADMIN");
    return chamar<Corpo & { acerto: AcertoDaViagem; remuneracao: { motorista: number; ajudante: number; total: number; fora: string | null; semKm: boolean } | null }>(acertoRota.GET(req(), ctx(viagemId)));
  };
  const ligarNoApp = async (ligado: boolean) => {
    await banco.sistema.tenant.update({ where: { id: EMPRESA_PADRAO.id }, data: { driverPayVisible: ligado } });
  };
  const ganhos = async (perfil: Perfil | null, mes = MES) => {
    entrarComo(perfil);
    return chamar<RemuneracaoDoMotorista & { error?: string }>(doMotorista.GET(req("GET", undefined, `?mes=${mes}`)));
  };

  beforeAll(async () => {
    banco = await import("../src/lib/prisma");
    fechamentoRota = await import("../src/app/api/equipe/fechamento/route");
    fechamentoPorId = await import("../src/app/api/equipe/fechamento/[id]/route");
    remuneracaoDoAjudante = await import("../src/app/api/equipe/ajudantes/[id]/remuneracao/route");
    ajudantes = await import("../src/app/api/equipe/ajudantes/route");
    motoristas = await import("../src/app/api/motoristas/route");
    motoristaPorId = await import("../src/app/api/motoristas/[id]/route");
    manifestos = await import("../src/app/api/manifestos/route");
    veiculos = await import("../src/app/api/veiculos/route");
    coletas = await import("../src/app/api/coletas/route");
    acertoRota = await import("../src/app/api/manifestos/[id]/acerto/route");
    relatorios = await import("../src/app/api/relatorios/route");
    empresaRota = await import("../src/app/api/empresa/remuneracao/route");
    doMotorista = await import("../src/app/api/driver/remuneracao/route");
    adiantamentosRota = await import("../src/app/api/equipe/adiantamentos/route");
    adiantamentoPorId = await import("../src/app/api/equipe/adiantamentos/[id]/route");
    await limpar();

    const db = banco.default;
    for (const [perfil, role] of PERFIS_DO_TESTE) {
      ids[perfil] = (await db.user.create({ data: { name: nome(perfil), email: `${PREFIXO}${perfil.toLowerCase()}@exemplo.br`, password: HASH_FALSO, role: role as "ADMIN" } })).id;
    }
    clienteId = (await db.client.create({ data: { companyName: nome("cliente"), cnpj: CNPJ } })).id;
    const habilitacao = { cnh: "44433322299", cnhExpiry: new Date("2031-06-30"), category: "C" };
    parceiroId = (await db.carrier.create({ data: { type: "TAC_AGREGADO", name: nome("parceiro"), taxId: CNPJ_DO_PARCEIRO } })).id;
    motoristaId = (await db.driver.create({ data: { ...habilitacao, userId: ids.DRIVER, cpf: CPF_MOTORISTA } })).id;
    segundoId = (await db.driver.create({ data: { ...habilitacao, userId: ids.DRIVER2, cpf: CPF_SEGUNDO } })).id;
    doParceiroId = (await db.driver.create({ data: { ...habilitacao, userId: ids.DRIVER3, cpf: CPF_DO_PARCEIRO, carrierId: parceiroId } })).id;
    veiculoId = (await db.vehicle.create({ data: { plate: PLACA, model: nome("próprio"), type: "TRUCK" } })).id;
    veiculoDoParceiroId = (await db.vehicle.create({ data: { plate: PLACA_DO_PARCEIRO, model: nome("do parceiro"), type: "TRUCK", carrierId: parceiroId } })).id;
    ajudanteId = (await db.helper.create({ data: { name: nome("ajudante"), cpf: CPF_AJUDANTE } })).id;

    // A outra empresa: um motorista com formas, uma viagem finalizada no mesmo mês e um fechamento gravado.
    const outra = banco.paraEmpresa(EMPRESA_OUTRA.id).db;
    const usuario = await outra.user.create({ data: { name: nome("motorista da outra"), email: `${PREFIXO}outra@exemplo.br`, password: HASH_FALSO, role: "DRIVER" } });
    daOutra.motoristaId = (await outra.driver.create({ data: { ...habilitacao, userId: usuario.id, cpf: CPF_MOTORISTA_DA_OUTRA, dailyRate: 7777, perTripRate: 8888 } })).id;
    daOutra.ajudanteId = (await outra.helper.create({ data: { name: nome("ajudante da outra"), cpf: CPF_AJUDANTE_DA_OUTRA, dailyRate: 6666 } })).id;
    daOutra.veiculoId = (await outra.vehicle.create({ data: { plate: PLACA_DA_OUTRA, model: nome("da outra"), type: "TRUCK" } })).id;
    daOutra.clienteId = (await outra.client.create({ data: { companyName: nome("cliente da outra"), cnpj: CNPJ_DA_OUTRA } })).id;
    daOutra.viagemId = (
      await outra.manifest.create({ data: { driverId: daOutra.motoristaId, vehicleId: daOutra.veiculoId, helperId: daOutra.ajudanteId, status: "FINISHED", departedAt: em("2013-08-05"), finishedAt: em("2013-08-06") } })
    ).id;
    daOutra.fechamentoId = (
      await outra.crewPayClosing.create({
        data: { driverId: daOutra.motoristaId, month: MES, variableTotal: 24442, advancesTotal: 0, balance: 24442, details: { formas: {}, viagens: [], adiantamentos: [] }, closedByName: nome("alguém da outra") },
      })
    ).id;
  }, 120_000);

  beforeEach(async () => {
    sessao.mockReset();
    await limparMovimento();
    await ligarNoApp(false);
    const { sistema } = banco;
    await sistema.driver.update({ where: { id: motoristaId }, data: { ...TODAS, active: true } });
    await sistema.driver.update({ where: { id: segundoId }, data: { commissionPct: null, dailyRate: 80, perKmRate: null, perDeliveryRate: null, perTripRate: null } });
    await sistema.driver.update({ where: { id: doParceiroId }, data: { ...TODAS, carrierId: parceiroId } });
    await sistema.helper.update({ where: { id: ajudanteId }, data: { dailyRate: 60, perTripRate: 30, active: true } });
  });

  afterAll(async () => {
    if (!banco) return;
    await ligarNoApp(false);
    await limpar();
  });

  describe("permissão", () => {
    it("sem sessão 401; cliente, motorista e operação 403: ninguém fora de quem lê os valores da equipe vê o fechamento", async () => {
      const rotas: [string, () => Promise<Response>][] = [
        ["GET fechamento", () => fechamentoRota.GET(req("GET", undefined, `?mes=${MES}`))],
        ["POST fechamento", () => fechamentoRota.POST(req("POST", { pessoa: chaveDoMotorista(motoristaId), mes: MES }))],
        ["GET fechamento/[id]", () => fechamentoPorId.GET(req(), ctx(SEM_ID))],
        ["DELETE fechamento/[id]", () => fechamentoPorId.DELETE(req("DELETE"), ctx(SEM_ID))],
        ["PATCH ajudantes/[id]/remuneracao", () => remuneracaoDoAjudante.PATCH(req("PATCH", { dailyRate: "1" }), ctx(ajudanteId))],
        ["GET empresa/remuneracao", () => empresaRota.GET()],
        ["PATCH empresa/remuneracao", () => empresaRota.PATCH(req("PATCH", { visivelAoMotorista: true }))],
      ];
      await viajar();
      for (const [rota, pedir] of rotas) {
        entrarComo(null);
        expect((await pedir()).status, `${rota} sem sessão`).toBe(401);
        for (const perfil of ["CLIENT", "DRIVER", "OPERATION"] as const) {
          entrarComo(perfil);
          expect((await pedir()).status, `${rota} como ${perfil}`).toBe(403);
        }
      }
      expect(await fechamentos()).toHaveLength(0);
      expect(await lancamentos()).toHaveLength(0);
      expect((await banco.sistema.helper.findUniqueOrThrow({ where: { id: ajudanteId } })).dailyRate).toBe(60);
    });

    it("diretoria e financeiro leem; fechar e reabrir é só do administrador; financeiro altera a remuneração, diretoria não", async () => {
      await viajar();
      for (const perfil of ["DIRECTOR", "FINANCE"] as const) {
        expect((await lerFechamento(perfil)).status, perfil).toBe(200);
        expect((await fechar(chaveDoMotorista(motoristaId), perfil)).status, `fechar como ${perfil}`).toBe(403);
      }
      const fechado = await fechar(chaveDoMotorista(motoristaId));
      expect(fechado.status).toBe(201);
      for (const perfil of ["DIRECTOR", "FINANCE"] as const) {
        expect((await reabrir(fechado.corpo.id, perfil)).status, `reabrir como ${perfil}`).toBe(403);
        entrarComo(perfil);
        expect((await fechamentoPorId.GET(req(), ctx(fechado.corpo.id))).status, `recibo como ${perfil}`).toBe(200);
      }
      expect(await fechamentos()).toHaveLength(1);

      entrarComo("DIRECTOR");
      expect((await remuneracaoDoAjudante.PATCH(req("PATCH", { dailyRate: "70" }), ctx(ajudanteId))).status).toBe(403);
      entrarComo("FINANCE");
      expect((await remuneracaoDoAjudante.PATCH(req("PATCH", { dailyRate: "70" }), ctx(ajudanteId))).status).toBe(200);
      // O interruptor da empresa é só do administrador.
      for (const perfil of ["DIRECTOR", "FINANCE"] as const) {
        entrarComo(perfil);
        expect((await empresaRota.PATCH(req("PATCH", { visivelAoMotorista: true }))).status, perfil).toBe(403);
      }
    });
  });

  describe("formas de remuneração no cadastro", () => {
    const definir = (perfil: Perfil, corpo: Record<string, unknown>) => {
      entrarComo(perfil);
      return chamar(motoristaPorId.PATCH(req("PATCH", corpo), ctx(motoristaId)));
    };
    const gravadas = () => banco.default.driver.findUniqueOrThrow({ where: { id: motoristaId }, select: { commissionPct: true, dailyRate: true, perKmRate: true, perDeliveryRate: true, perTripRate: true } });

    it("a operação não altera: 403 e nada muda; o administrador altera, apaga e a auditoria registra", async () => {
      expect(await definir("OPERATION", { dailyRate: "150" })).toMatchObject({ status: 403, corpo: { error: REMUNERACAO_SO_DE_QUEM_PAGA } });
      expect(await gravadas()).toEqual(TODAS);

      const alterado = await definir("ADMIN", { dailyRate: "150,50", perKmRate: "", perTripRate: 0 });
      expect(alterado.status).toBe(200);
      expect(alterado.corpo).toMatchObject({ dailyRate: 150.5, perKmRate: null, perTripRate: 0, commissionPct: 10, perDeliveryRate: 20 });
      expect(await gravadas()).toEqual({ commissionPct: 10, dailyRate: 150.5, perKmRate: null, perDeliveryRate: 20, perTripRate: 0 });

      for (const corpo of [{ dailyRate: -1 }, { perKmRate: "abc" }, { perTripRate: 2_000_000 }]) {
        expect((await definir("ADMIN", corpo)).status, JSON.stringify(corpo)).toBe(400);
      }

      const linhas = await trilha(motoristaId);
      expect(linhas.map((l) => [l.action, l.before, l.after])).toEqual([["motorista.remuneracao", { dailyRate: 100, perKmRate: 0.5, perTripRate: 50 }, { dailyRate: 150.5, perKmRate: null, perTripRate: 0 }]]);
      expect(linhas[0].userId).toBe(ids.ADMIN);
    });

    it("a operação continua alterando o resto do cadastro, sem ver nem apagar os valores", async () => {
      const alterado = await definir("OPERATION", { phone: "17999990000" });
      expect(alterado.status).toBe(200);
      for (const campo of Object.keys(TODAS)) expect(alterado.corpo, campo).not.toHaveProperty(campo);
      expect(await gravadas()).toEqual(TODAS);
    });

    it("os valores só saem em /api/motoristas, para quem lê os valores da equipe: nem viagem, nem veículo, nem carga os levam", async () => {
      await viajar();
      const naLista = async (perfil: Perfil) => {
        entrarComo(perfil);
        return ((await (await motoristas.GET()).json()) as Corpo[]).find((m) => m.id === motoristaId)!;
      };
      expect(await naLista("ADMIN")).toMatchObject(TODAS);
      expect(await naLista("FINANCE")).toMatchObject(TODAS);
      const paraAOperacao = await naLista("OPERATION");
      for (const campo of Object.keys(TODAS)) expect(paraAOperacao, campo).not.toHaveProperty(campo);

      for (const perfil of ["ADMIN", "OPERATION"] as const) {
        for (const [rota, pedir] of [
          ["manifestos", () => manifestos.GET()],
          ["veiculos", () => veiculos.GET()],
          ["coletas", () => coletas.GET()],
          ["ajudantes", () => ajudantes.GET()],
        ] as const) {
          entrarComo(perfil);
          const res = await pedir();
          expect(res.status, rota).toBe(200);
          expect(JSON.stringify(await res.json()), `${rota} como ${perfil}`).not.toMatch(/dailyRate|perKmRate|perDeliveryRate|perTripRate|commissionPct/);
        }
      }
    });

    it("a remuneração do ajudante: validação, caminho feliz, auditoria e ajudante de outra empresa", async () => {
      const mudar = (id: string, corpo: unknown) => {
        entrarComo("ADMIN");
        return chamar(remuneracaoDoAjudante.PATCH(req("PATCH", corpo), ctx(id)));
      };
      expect((await mudar(ajudanteId, {})).status).toBe(400);
      expect((await mudar(ajudanteId, { dailyRate: -1 })).status).toBe(400);
      expect(await mudar(daOutra.ajudanteId, { dailyRate: "1" })).toMatchObject({ status: 404 });
      expect(await mudar(SEM_ID, { dailyRate: "1" })).toMatchObject({ status: 404 });
      expect((await banco.sistema.helper.findUniqueOrThrow({ where: { id: daOutra.ajudanteId } })).dailyRate).toBe(6666);

      const alterado = await mudar(ajudanteId, { dailyRate: "75,5", perTripRate: "" });
      expect(alterado).toMatchObject({ status: 200, corpo: { dailyRate: 75.5, perTripRate: null } });
      expect((await trilha(ajudanteId)).map((l) => [l.action, l.before, l.after])).toEqual([["ajudante.remuneracao", { dailyRate: 60, perTripRate: 30 }, { dailyRate: 75.5, perTripRate: null }]]);
    });
  });

  describe("fechamento do mês", () => {
    it("mês inválido é 400", async () => {
      expect(await lerFechamento("ADMIN", "2013-13")).toMatchObject({ status: 400, corpo: { error: MES_MESSAGE } });
    });

    it("por pessoa: as viagens finalizadas no mês com a apuração de cada uma, o variável, os vales em aberto e o saldo", async () => {
      const { primeira, segunda } = await mesCheio();
      // Fora do mês: viagem finalizada em setembro e viagem ainda em rota.
      await viajar({ saida: em("2013-08-30"), fim: em("2013-09-01", "09:00") });
      await viajar({ extra: { status: "ROUTE", finishedAt: null } });

      const motorista = await pessoaNoMes(chaveDoMotorista(motoristaId));
      expect(motorista).toMatchObject({ tipo: "motorista", nome: nome("DRIVER"), cpf: CPF_MOTORISTA, formas: TODAS, fechamento: null, diferenca: null });
      expect(motorista!.atual.viagens.map((v) => [v.manifestId, v.dias, v.km, v.entregas, v.frete, v.total, v.semKm])).toEqual([
        [primeira, 3, 400, 2, 1500, 740, false],
        [segunda, 1, null, 1, 200, 190, true],
      ]);
      expect(motorista!.atual.viagens[0].parcelas).toEqual({ comissao: 150, diarias: 300, porKm: 200, porEntrega: 40, fixo: 50 });
      expect(motorista!.atual.viagens[1].parcelas).toEqual({ comissao: 20, diarias: 100, porKm: null, porEntrega: 20, fixo: 50 });
      expect(motorista!.atual).toMatchObject({ variavel: 930, adiantado: 300, saldo: 630 });
      expect(motorista!.atual.adiantamentos).toHaveLength(1);
      expect(motorista!.atual.adiantamentos[0]).toMatchObject({ date: "2013-08-10", amount: 300, reason: "VOUCHER", origem: "VALE", anterior: false });
      expect(motorista!.atual).toMatchObject({ anteriores: 0, saldoAnterior: null, semAcerto: [] });

      // O ajudante: linha própria, só diária e fixo, só na viagem em que foi.
      const ajudante = await pessoaNoMes(chaveDoAjudante(ajudanteId));
      expect(ajudante).toMatchObject({ tipo: "ajudante", cpf: CPF_AJUDANTE, formas: { dailyRate: 60, perTripRate: 30 } });
      expect(ajudante!.atual.viagens.map((v) => [v.manifestId, v.total])).toEqual([[primeira, 210]]);
      expect(ajudante!.atual.viagens[0].parcelas).toEqual({ comissao: null, diarias: 180, porKm: null, porEntrega: null, fixo: 30 });
      expect(ajudante!.atual).toMatchObject({ variavel: 210, adiantado: 0, saldo: 210 });
    });

    it("motorista de parceiro em viagem com frete contratado fica fora da apuração; com o contrato cancelado, volta", async () => {
      const viagemId = await viajar({ extra: { driverId: doParceiroId, vehicleId: veiculoDoParceiroId } });
      const contrato = await banco.default.freightContract.create({ data: { manifestId: viagemId, carrierId: parceiroId, calcMode: "FIXO", calcBase: 1000, grossAmount: 1000 } });

      const fora = await pessoaNoMes(chaveDoMotorista(doParceiroId));
      expect(fora!.atual.viagens).toHaveLength(1);
      expect(fora!.atual.viagens[0]).toMatchObject({ manifestId: viagemId, total: 0, fora: "PARCEIRO" });
      expect(fora!.atual).toMatchObject({ variavel: 0, saldo: 0 });

      // No custo da viagem: o frete contratado conta, a remuneração do motorista não.
      const acerto = await lerAcerto(viagemId);
      expect(acerto.corpo.acerto).toMatchObject({ freteContratado: 1000, remuneracao: 0, custoTotal: 1000 });
      expect(acerto.corpo.remuneracao).toMatchObject({ motorista: 0, total: 0, fora: "PARCEIRO" });

      await banco.sistema.freightContract.update({ where: { id: contrato.id }, data: { status: "CANCELADO" } });
      const dentro = await pessoaNoMes(chaveDoMotorista(doParceiroId));
      expect(dentro!.atual.viagens[0]).toMatchObject({ total: 740, fora: null });
      expect((await lerAcerto(viagemId)).corpo.acerto).toMatchObject({ freteContratado: 0, remuneracao: 740, custoTotal: 740 });
    });

    it("fechar: validação, pessoa de outra empresa, mês futuro e mês sem nada", async () => {
      const pedir = (corpo: unknown) => {
        entrarComo("ADMIN");
        return chamar(fechamentoRota.POST(req("POST", corpo)));
      };
      for (const corpo of [null, {}, { pessoa: "cliente:x", mes: MES }, { pessoa: chaveDoMotorista(motoristaId), mes: "08/2013" }]) {
        expect((await pedir(corpo)).status, JSON.stringify(corpo)).toBe(400);
      }
      expect(await pedir({ pessoa: chaveDoMotorista(motoristaId), mes: mesVizinho(mesAtual(), 1) })).toMatchObject({ status: 400, corpo: { error: FUTURE_MONTH } });
      // Motorista e ajudante de outra empresa não existem para esta: 400, como um id inventado.
      for (const pessoa of [chaveDoMotorista(daOutra.motoristaId), chaveDoAjudante(daOutra.ajudanteId), chaveDoMotorista(SEM_ID)]) {
        expect((await pedir({ pessoa, mes: MES })).status, pessoa).toBe(400);
      }
      expect(await pedir({ pessoa: chaveDoMotorista(motoristaId), mes: MES })).toMatchObject({ status: 409, corpo: { error: NOTHING_TO_CLOSE } });
      expect(await fechamentos()).toHaveLength(0);
      expect(await lancamentos()).toHaveLength(0);
    });

    it("fechar grava os valores congelados e quem fechou, e lança o saldo a pagar no Financeiro; fechar de novo é 409", async () => {
      const { primeira } = await mesCheio();

      const fechado = await fechar(chaveDoMotorista(motoristaId));
      expect(fechado.status).toBe(201);
      expect(fechado.corpo.conta).toMatchObject({ variavel: 930, adiantado: 300, saldo: 630 });
      expect(fechado.corpo.lancamento).toMatchObject({ status: "PENDING", amount: 630 });

      const [gravado] = await fechamentos();
      expect(gravado).toMatchObject({ driverId: motoristaId, helperId: null, month: MES, variableTotal: 930, advancesTotal: 300, balance: 630, closedById: ids.ADMIN, closedByName: nome("ADMIN") });
      const detalhes = lerDetalhes(gravado.details);
      expect(detalhes.formas).toEqual(TODAS);
      expect(detalhes.viagens.map((v) => v.total)).toEqual([740, 190]);
      expect(detalhes.adiantamentos.map((a) => a.amount)).toEqual([300]);

      // O lançamento: o saldo a pagar (o adiantamento já virou despesa quando foi entregue), em aberto.
      const lancados = await lancamentos();
      expect(lancados).toHaveLength(1);
      expect(lancados[0]).toMatchObject({ id: gravado.transactionId, type: "EXPENSE", status: "PENDING", amount: 630, category: CATEGORIA_DA_REMUNERACAO, counterparty: nome("DRIVER"), description: `Remuneração variável de 08/2013: ${nome("DRIVER")}` });

      const [linha] = await trilha(gravado.id);
      expect(linha).toMatchObject({ action: "fechamento-equipe.fechar", userId: ids.ADMIN });
      expect(linha.after).toMatchObject({ month: MES, variableTotal: 930, advancesTotal: 300, balance: 630 });

      expect(await fechar(chaveDoMotorista(motoristaId))).toMatchObject({ status: 409, corpo: { error: ALREADY_CLOSED } });
      expect(await fechamentos()).toHaveLength(1);
      expect(await lancamentos()).toHaveLength(1);

      // O ajudante fecha à parte: o fechamento de um não fecha o do outro.
      const doAjudante = await fechar(chaveDoAjudante(ajudanteId));
      expect(doAjudante.status).toBe(201);
      expect(doAjudante.corpo.conta.viagens.map((v) => v.manifestId)).toEqual([primeira]);
      expect(doAjudante.corpo.lancamento).toMatchObject({ amount: 210 });
      expect((await lancamentos()).map((l) => [l.counterparty, l.amount])).toEqual([[nome("DRIVER"), 630], [nome("ajudante"), 210]]);
    });

    it("dois fechamentos ao mesmo tempo: um vale, o outro é 409, e fica um lançamento só", async () => {
      await mesCheio();
      entrarComo("ADMIN");
      const corpo = { pessoa: chaveDoMotorista(motoristaId), mes: MES };
      const respostas = await Promise.all([fechamentoRota.POST(req("POST", corpo)), fechamentoRota.POST(req("POST", corpo))]);
      expect(respostas.map((res) => res.status).sort()).toEqual([201, 409]);
      expect(await fechamentos()).toHaveLength(1);
      // A despesa nasce na mesma transação do fechamento: a tentativa recusada não deixa lançamento órfão.
      expect(await lancamentos()).toHaveLength(1);
    });

    it("sem saldo a pagar o mês fecha sem lançamento", async () => {
      await viajar({ extra: { helperId: ajudanteId } });
      await adiantar({ driverId: null, helperId: ajudanteId, amount: 500 });
      const fechado = await fechar(chaveDoAjudante(ajudanteId));
      expect(fechado.status).toBe(201);
      expect(fechado.corpo.conta).toMatchObject({ variavel: 210, adiantado: 500, saldo: -290 });
      expect(fechado.corpo.lancamento).toBeNull();
      expect((await fechamentos())[0]).toMatchObject({ balance: -290, transactionId: null });
      expect(await lancamentos()).toHaveLength(0);
    });

    it("fechamento fechado não muda quando a viagem, o cadastro ou os adiantamentos mudam depois: a tela recebe a diferença", async () => {
      const { primeira } = await mesCheio();
      const fechado = await fechar(chaveDoMotorista(motoristaId));
      expect((await pessoaNoMes(chaveDoMotorista(motoristaId)))!.diferenca).toBeNull();

      // Depois do fechamento: a diária dobra, a viagem ganha 100 km e entra um vale.
      await banco.sistema.driver.update({ where: { id: motoristaId }, data: { dailyRate: 200 } });
      await banco.sistema.manifest.update({ where: { id: primeira }, data: { returnOdometer: 1500 } });
      await adiantar({ amount: 40, date: dia("2013-08-25"), reason: "VOUCHER" });

      const pessoa = (await pessoaNoMes(chaveDoMotorista(motoristaId)))!;
      expect(pessoa.fechamento).toMatchObject({ id: fechado.corpo.id, fechadoPor: nome("ADMIN") });
      expect(pessoa.fechamento!.conta).toMatchObject({ variavel: 930, adiantado: 300, saldo: 630 });
      expect(pessoa.fechamento!.conta.viagens.map((v) => v.total)).toEqual([740, 190]);
      // A conta de hoje: +300 e +100 de diária, +50 de km; +40 de adiantamento.
      expect(pessoa.atual).toMatchObject({ variavel: 1380, adiantado: 340, saldo: 1040 });
      expect(pessoa.diferenca).toEqual({ variavel: 450, adiantado: 40, saldo: 410 });

      expect((await fechamentos())[0]).toMatchObject({ variableTotal: 930, advancesTotal: 300, balance: 630 });
      expect((await lancamentos()).map((l) => l.amount)).toEqual([630]);
      // O total do mês usa o que foi congelado para quem está fechado.
      const { corpo } = await lerFechamento();
      expect(corpo.pessoas.find((p) => p.chave === chaveDoMotorista(motoristaId))!.fechamento!.conta.saldo).toBe(630);
    });

    it("reabrir desfaz o fechamento e o lançamento em aberto; a auditoria guarda o que havia", async () => {
      await mesCheio();
      const fechado = await fechar(chaveDoMotorista(motoristaId));
      expect(await lancamentos()).toHaveLength(1);

      expect(await reabrir(fechado.corpo.id)).toMatchObject({ status: 200, corpo: { success: true } });
      expect(await fechamentos()).toHaveLength(0);
      expect(await lancamentos()).toHaveLength(0);
      expect((await pessoaNoMes(chaveDoMotorista(motoristaId)))!.fechamento).toBeNull();

      const linhas = await trilha(fechado.corpo.id);
      expect(linhas.map((l) => l.action)).toEqual(["fechamento-equipe.fechar", "fechamento-equipe.reabrir"]);
      expect(linhas[1].before).toMatchObject({ month: MES, variableTotal: 930, advancesTotal: 300, balance: 630 });

      // Reaberto, fecha de novo com os valores de hoje.
      await banco.sistema.driver.update({ where: { id: motoristaId }, data: { perTripRate: 0 } });
      const deNovo = await fechar(chaveDoMotorista(motoristaId));
      expect(deNovo.status).toBe(201);
      expect(deNovo.corpo.conta).toMatchObject({ variavel: 830, saldo: 530 });
      expect((await lancamentos()).map((l) => l.amount)).toEqual([530]);
    });

    it("reabrir com o lançamento já pago no Financeiro é recusado, e nada muda", async () => {
      await mesCheio();
      const fechado = await fechar(chaveDoMotorista(motoristaId));
      await banco.sistema.financialTransaction.update({ where: { id: fechado.corpo.lancamento!.id }, data: { status: "PAID", paidAt: new Date() } });

      expect(await reabrir(fechado.corpo.id)).toMatchObject({ status: 409, corpo: { error: CLOSING_ALREADY_PAID } });
      expect(await fechamentos()).toHaveLength(1);
      expect((await lancamentos()).map((l) => [l.status, l.amount])).toEqual([["PAID", 630]]);
      expect((await pessoaNoMes(chaveDoMotorista(motoristaId)))!.fechamento!.lancamento).toMatchObject({ status: "PAID", amount: 630 });
    });

    it("o demonstrativo do fechamento traz a empresa, a pessoa com o CPF, o mês e a conta congelada", async () => {
      const { primeira, segunda } = await mesCheio();
      const fechado = await fechar(chaveDoMotorista(motoristaId));
      await banco.sistema.driver.update({ where: { id: motoristaId }, data: { dailyRate: 999 } });

      entrarComo("FINANCE");
      const { status, corpo } = await chamar<ReciboDoFechamento>(fechamentoPorId.GET(req(), ctx(fechado.corpo.id)));
      expect(status).toBe(200);
      // O nome da empresa da sessão (outra suite pode tê-lo alterado; a da outra empresa nunca).
      expect(corpo.empresa.name.length).toBeGreaterThan(0);
      expect(corpo.empresa.name).not.toBe(EMPRESA_OUTRA.name);
      expect(corpo.pessoa).toEqual({ tipo: "motorista", nome: nome("DRIVER"), cpf: CPF_MOTORISTA });
      expect(corpo).toMatchObject({ mes: MES, fechadoPor: nome("ADMIN"), formas: TODAS });
      expect(corpo.conta).toMatchObject({ variavel: 930, adiantado: 300, saldo: 630 });
      expect(corpo.conta.parcelas).toEqual({ comissao: 170, diarias: 400, porKm: 200, porEntrega: 60, fixo: 100 });
      expect(corpo.conta.viagens.map((v) => [v.manifestId, v.dias, v.km, v.entregas, v.frete, v.total])).toEqual([
        [primeira, 3, 400, 2, 1500, 740],
        [segunda, 1, null, 1, 200, 190],
      ]);
      expect(corpo.conta.adiantamentos.map((a) => [a.date, a.amount])).toEqual([["2013-08-10", 300]]);
    });
  });

  describe("adiantamentos no fechamento", () => {
    const chave = () => chaveDoMotorista(motoristaId);

    it("fechar dá baixa nos adiantamentos descontados e lança o saldo; os que não entraram na conta ficam como estavam", async () => {
      const { vale, quitado, doMesSeguinte } = await mesCheio();
      const semAcerto = (await adiantar({ amount: 400, date: dia("2013-08-15"), reason: "TRIP" })).id;

      const fechado = await fechar(chave());
      expect(fechado.status).toBe(201);
      expect(fechado.corpo.conta).toMatchObject({ variavel: 930, adiantado: 300, anteriores: 0, saldo: 630 });
      expect(fechado.corpo.conta.semAcerto.map((a) => [a.id, a.amount])).toEqual([[semAcerto, 400]]);

      // O vale passa a apontar para o fechamento, sem mudar de situação; os outros não são tocados.
      expect(await adiantamentoGravado(vale)).toEqual({ status: "OPEN", spentAmount: null, closingId: fechado.corpo.id });
      for (const id of [quitado, doMesSeguinte, semAcerto]) expect((await adiantamentoGravado(id)).closingId, id).toBeNull();
      expect((await lancamentos()).map((l) => l.amount)).toEqual([630]);

      // Na aba Adiantamentos ele vem com o fechamento que o descontou.
      entrarComo("ADMIN");
      const lista = (await (await adiantamentosRota.GET()).json()) as (Corpo & { closing: { id: string; month: string } | null })[];
      expect(lista.find((a) => a.id === vale)!.closing).toEqual({ id: fechado.corpo.id, month: MES });
      expect(lista.find((a) => a.id === semAcerto)!.closing).toBeNull();

      const [gravado] = await fechamentos();
      expect(lerDetalhes(gravado.details).semAcerto.map((a) => a.id)).toEqual([semAcerto]);
      expect((await trilha(fechado.corpo.id))[0].after).toMatchObject({ adiantamentosDescontados: 1 });
      // A conta de hoje do mês fechado continua igual à congelada: o vale descontado por ELE segue na conta dele.
      const pessoa = (await pessoaNoMes(chave()))!;
      expect(pessoa.atual).toMatchObject({ adiantado: 300, saldo: 630 });
      expect(pessoa.diferenca).toBeNull();
    });

    it("a baixa, o fechamento e o lançamento são uma transação só: se a baixa falha, nada fica gravado", async () => {
      const { vale } = await mesCheio();
      const doAjudante = await fechar(chaveDoAjudante(ajudanteId));
      expect(doAjudante.status).toBe(201);

      // No meio do fechamento do motorista, o vale aparece descontado por outro fechamento: a baixa não o encontra mais livre.
      const apoio = await import("../src/lib/remuneracao-db");
      const original = apoio.contaDaPessoa;
      const espiao = vi.spyOn(apoio, "contaDaPessoa").mockImplementationOnce(async (tx, pessoa, mes) => {
        const apurado = await original(tx, pessoa, mes);
        await tx.crewAdvance.update({ where: { id: vale }, data: { closingId: doAjudante.corpo.id } });
        return apurado;
      });
      try {
        expect(await fechar(chave())).toMatchObject({ status: 409, corpo: { error: ADVANCES_CHANGED } });
        expect(espiao).toHaveBeenCalledTimes(1);
      } finally {
        espiao.mockRestore();
      }

      // Nem o fechamento, nem o lançamento do saldo, nem a troca feita dentro da transação ficaram.
      expect((await fechamentos()).map((f) => f.id)).toEqual([doAjudante.corpo.id]);
      expect((await lancamentos()).map((l) => [l.counterparty, l.amount])).toEqual([[nome("ajudante"), 210]]);
      expect((await adiantamentoGravado(vale)).closingId).toBeNull();
    });

    it("adiantamento descontado não se acerta nem se reabre na aba Adiantamentos; reabrir o mês devolve todos ao estado em que estavam", async () => {
      await viajar();
      const vale = (await adiantar()).id;
      // Adiantamento de viagem de 500 já acertado: gastou 420, tem 80 a devolver.
      const sobra = (await adiantar({ amount: 500, reason: "TRIP", date: dia("2013-08-11"), status: "SETTLED", spentAmount: 420, settledAt: new Date() })).id;

      const fechado = await fechar(chave());
      expect(fechado.corpo.conta).toMatchObject({ variavel: 740, adiantado: 380, saldo: 360 });
      expect(fechado.corpo.conta.adiantamentos.map((a) => [a.id, a.amount, a.origem])).toEqual([
        [vale, 300, "VALE"],
        [sobra, 80, "SOBRA"],
      ]);

      const recusa = { status: 409, corpo: { error: adiantamentoNoFechamento(MES) } };
      expect(recusa.corpo.error).toBe("Este adiantamento foi descontado no fechamento de 08/2013. Reabra o mês na aba Fechamento para mexer nele.");
      expect(await agirNoAdiantamento(vale, { action: "acertar", spentAmount: "10" })).toMatchObject(recusa);
      expect(await agirNoAdiantamento(sobra, { action: "reabrir" })).toMatchObject(recusa);
      expect(await agirNoAdiantamento(sobra, { action: "acertar", spentAmount: "1" })).toMatchObject(recusa);
      // Excluir adiantamento não existe em rota nenhuma: não há por onde apagar o que foi descontado.
      expect(Object.keys(adiantamentoPorId)).toEqual(["PATCH"]);
      expect(await adiantamentoGravado(vale)).toEqual({ status: "OPEN", spentAmount: null, closingId: fechado.corpo.id });
      expect(await adiantamentoGravado(sobra)).toEqual({ status: "SETTLED", spentAmount: 420, closingId: fechado.corpo.id });

      expect((await reabrir(fechado.corpo.id)).status).toBe(200);
      expect(await adiantamentoGravado(vale)).toEqual({ status: "OPEN", spentAmount: null, closingId: null });
      expect(await adiantamentoGravado(sobra)).toEqual({ status: "SETTLED", spentAmount: 420, closingId: null });
      expect(await lancamentos()).toHaveLength(0);
      expect((await trilha(fechado.corpo.id))[1].before).toMatchObject({ adiantamentosDescontados: 2 });
      expect((await pessoaNoMes(chave()))!.atual).toMatchObject({ adiantado: 380, saldo: 360 });

      // Reaberto o mês, voltam a aceitar o que a aba Adiantamentos faz.
      expect((await agirNoAdiantamento(sobra, { action: "reabrir" })).corpo).toMatchObject({ status: "OPEN", spentAmount: null });
      expect((await agirNoAdiantamento(vale, { action: "acertar", spentAmount: "300" })).corpo).toMatchObject({ status: "SETTLED" });
    });

    it("adiantamento de viagem sem acerto fica fora da conta, com aviso; acertado, entra só a sobra a devolver", async () => {
      await viajar();
      const deViagem = (await adiantar({ amount: 400, reason: "TRIP" })).id;
      const outro = (await adiantar({ amount: 90, reason: "OTHER", date: dia("2013-08-11") })).id;

      const antes = (await pessoaNoMes(chave()))!;
      expect(antes.atual).toMatchObject({ variavel: 740, adiantado: 0, saldo: 740, adiantamentos: [] });
      expect(antes.atual.semAcerto.map((a) => [a.id, a.amount])).toEqual([
        [deViagem, 400],
        [outro, 90],
      ]);

      // O de viagem: gastou 340 com comprovante, sobram 60 a devolver. O outro: gastou 100, a empresa é que completa.
      expect((await agirNoAdiantamento(deViagem, { action: "acertar", spentAmount: "340" })).status).toBe(200);
      expect((await agirNoAdiantamento(outro, { action: "acertar", spentAmount: "100" })).status).toBe(200);
      const depois = (await pessoaNoMes(chave()))!;
      expect(depois.atual).toMatchObject({ adiantado: 60, saldo: 680, semAcerto: [] });
      expect(depois.atual.adiantamentos.map((a) => [a.id, a.amount, a.origem])).toEqual([[deViagem, 60, "SOBRA"]]);

      const fechado = await fechar(chave());
      expect(fechado.corpo.lancamento).toMatchObject({ amount: 680 });
      expect((await adiantamentoGravado(deViagem)).closingId).toBe(fechado.corpo.id);
      expect((await adiantamentoGravado(outro)).closingId).toBeNull();
    });

    it("vale e sobra de mês que nunca foi fechado entram no próximo fechamento, numa linha à parte, e uma única vez", async () => {
      await viajar();
      const deJulho = (await adiantar({ amount: 200, date: dia("2013-07-15") })).id;
      const deJunho = (await adiantar({ amount: 80, reason: "TRIP", date: dia("2013-06-20"), status: "SETTLED", spentAmount: 50, settledAt: new Date() })).id;
      const doMes = (await adiantar({ amount: 100 })).id;
      // Setembro: uma viagem de 190.
      await viajar({ fretes: [200], saida: em("2013-09-10", "08:00"), fim: em("2013-09-10", "19:00"), km: null });

      const agosto = (await pessoaNoMes(chave()))!;
      expect(agosto.atual).toMatchObject({ variavel: 740, adiantado: 330, anteriores: 230, saldo: 410 });
      expect(agosto.atual.adiantamentos.map((a) => [a.id, a.amount, a.anterior])).toEqual([
        [deJunho, 30, true],
        [deJulho, 200, true],
        [doMes, 100, false],
      ]);
      // Julho só enxerga o que tem data até julho; setembro, enquanto agosto não fecha, enxerga tudo como dívida anterior.
      expect((await pessoaNoMes(chave(), "2013-07"))!.atual).toMatchObject({ variavel: 0, adiantado: 230, anteriores: 30 });
      expect((await pessoaNoMes(chave(), "2013-09"))!.atual).toMatchObject({ variavel: 190, adiantado: 330, anteriores: 330, saldo: -140 });

      const fechado = await fechar(chave());
      expect(fechado.corpo.conta).toMatchObject({ adiantado: 330, anteriores: 230, saldo: 410 });
      for (const id of [deJulho, deJunho, doMes]) expect((await adiantamentoGravado(id)).closingId, id).toBe(fechado.corpo.id);
      const [gravado] = await fechamentos();
      expect(gravado).toMatchObject({ advancesTotal: 330, balance: 410 });

      // O recibo traz a dívida de meses anteriores separada.
      entrarComo("ADMIN");
      const recibo = await chamar<ReciboDoFechamento>(fechamentoPorId.GET(req(), ctx(fechado.corpo.id)));
      expect(recibo.corpo.conta).toMatchObject({ adiantado: 330, anteriores: 230 });
      expect(recibo.corpo.conta.adiantamentos.filter((a) => a.anterior).map((a) => a.id)).toEqual([deJunho, deJulho]);

      // Descontados em agosto, não entram em mais nenhum mês: nem no seguinte, nem no que ficou para trás.
      expect((await pessoaNoMes(chave(), "2013-09"))!.atual).toMatchObject({ variavel: 190, adiantado: 0, anteriores: 0, saldo: 190 });
      const setembro = await fechar(chave(), "ADMIN", "2013-09");
      expect(setembro.corpo.conta).toMatchObject({ adiantado: 0, saldo: 190 });
      expect((await lancamentos()).map((l) => l.amount)).toEqual([410, 190]);
      expect(await fechar(chave(), "ADMIN", "2013-07")).toMatchObject({ status: 409, corpo: { error: NOTHING_TO_CLOSE } });
    });

    it("mês que fecha com saldo negativo: a dívida vai para o próximo fechamento da pessoa, uma vez só", async () => {
      const doAjudante = chaveDoAjudante(ajudanteId);
      await viajar({ extra: { helperId: ajudanteId } });
      const vale = (await adiantar({ driverId: null, helperId: ajudanteId, amount: 500 })).id;
      const agosto = await fechar(doAjudante);
      expect(agosto.corpo.conta).toMatchObject({ variavel: 210, adiantado: 500, saldo: -290 });
      expect((await adiantamentoGravado(vale)).closingId).toBe(agosto.corpo.id);

      // Setembro rende 210: a dívida de 290 vem do fechamento de agosto, e o vale (já descontado lá) não volta.
      await viajar({ extra: { helperId: ajudanteId }, saida: em("2013-09-10", "08:00"), fim: em("2013-09-12", "18:00") });
      const emSetembro = (await pessoaNoMes(doAjudante, "2013-09"))!;
      expect(emSetembro.atual).toMatchObject({ variavel: 210, adiantado: 290, anteriores: 290, saldo: -80, saldoAnterior: { mes: MES, valor: 290 }, adiantamentos: [] });
      const setembro = await fechar(doAjudante, "ADMIN", "2013-09");
      expect(setembro.corpo.conta).toMatchObject({ saldo: -80, saldoAnterior: { mes: MES, valor: 290 } });
      expect(setembro.corpo.lancamento).toBeNull();

      // Outubro traz só o que o ÚLTIMO fechamento deixou (80), não a soma dos dois.
      await viajar({ extra: { helperId: ajudanteId }, saida: em("2013-10-10", "08:00"), fim: em("2013-10-12", "18:00") });
      expect((await pessoaNoMes(doAjudante, "2013-10"))!.atual).toMatchObject({ variavel: 210, adiantado: 80, anteriores: 80, saldo: 130, saldoAnterior: { mes: "2013-09", valor: 80 } });
      expect(await lancamentos()).toHaveLength(0);

      // Reabrir agosto não muda o que setembro congelou; a conta de hoje de setembro muda, e a tela recebe a diferença.
      expect((await reabrir(agosto.corpo.id)).status).toBe(200);
      const depois = (await pessoaNoMes(doAjudante, "2013-09"))!;
      expect(depois.fechamento!.conta).toMatchObject({ adiantado: 290, saldo: -80 });
      expect(depois.atual).toMatchObject({ adiantado: 500, anteriores: 500, saldo: -290, saldoAnterior: null });
      expect(depois.diferenca).toEqual({ variavel: 0, adiantado: 210, saldo: -210 });
    });

    it("isolamento: o fechamento daqui não enxerga nem toca adiantamento da outra empresa, e o banco recusa a ligação entre empresas", async () => {
      await viajar();
      const meu = (await adiantar()).id;
      const outra = banco.paraEmpresa(EMPRESA_OUTRA.id).db;
      const alheio = await outra.crewAdvance.create({ data: { driverId: daOutra.motoristaId, date: dia("2013-07-10"), amount: 7771, reason: "VOUCHER" } });
      const alheioDescontado = await outra.crewAdvance.create({ data: { driverId: daOutra.motoristaId, date: dia("2013-08-10"), amount: 8881, reason: "VOUCHER", closingId: daOutra.fechamentoId } });

      const { corpo } = await lerFechamento();
      const texto = JSON.stringify(corpo);
      for (const deLa of [alheio.id, alheioDescontado.id, "7771", "8881"]) expect(texto, deLa).not.toContain(deLa);

      const fechado = await fechar(chave());
      expect(fechado.corpo.conta).toMatchObject({ adiantado: 300, anteriores: 0 });
      expect((await adiantamentoGravado(meu)).closingId).toBe(fechado.corpo.id);
      expect((await adiantamentoGravado(alheio.id)).closingId).toBeNull();

      // O fechamento de lá não se reabre por aqui (404), e o adiantamento que ele descontou continua descontado.
      expect((await reabrir(daOutra.fechamentoId)).status).toBe(404);
      expect((await adiantamentoGravado(alheioDescontado.id)).closingId).toBe(daOutra.fechamentoId);
      // Adiantamento de lá não existe para esta empresa: 404, e não a recusa de "descontado no fechamento".
      expect((await agirNoAdiantamento(alheioDescontado.id, { action: "acertar", spentAmount: "1" })).status).toBe(404);

      // Mesmo por fora das rotas, o banco não deixa um adiantamento apontar para o fechamento de outra empresa.
      await expect(banco.default.crewAdvance.update({ where: { id: meu }, data: { closingId: daOutra.fechamentoId } })).rejects.toThrow();
      await expect(outra.crewAdvance.update({ where: { id: alheio.id }, data: { closingId: fechado.corpo.id } })).rejects.toThrow();
      expect((await adiantamentoGravado(meu)).closingId).toBe(fechado.corpo.id);
    });
  });

  describe("custo da viagem", () => {
    it("a remuneração do motorista e do ajudante entra no acerto, separada, sem contar em dobro com despesa nem com o lançamento do fechamento", async () => {
      const viagemId = await viajar({ extra: { helperId: ajudanteId } });
      await banco.default.tripExpense.create({ data: { manifestId: viagemId, type: "TOLL", amount: 100, date: dia("2013-08-06"), status: "APPROVED" } });

      const antes = await lerAcerto(viagemId);
      expect(antes.status).toBe(200);
      expect(antes.corpo.remuneracao).toEqual({ motorista: 740, ajudante: 210, total: 950, fora: null, semKm: false });
      expect(antes.corpo.acerto).toMatchObject({ frete: 1500, despesas: 100, freteContratado: 0, remuneracao: 950, custoTotal: 1050, resultado: 450 });

      // Fechar o mês lança a despesa no Financeiro, que não é despesa de viagem: o custo não muda.
      await fechar(chaveDoMotorista(motoristaId));
      await fechar(chaveDoAjudante(ajudanteId));
      expect(await lancamentos()).toHaveLength(2);
      expect((await lerAcerto(viagemId)).corpo.acerto).toMatchObject({ despesas: 100, remuneracao: 950, custoTotal: 1050 });

      // Mês fechado: o cadastro muda e o custo da viagem continua o congelado.
      await banco.sistema.driver.update({ where: { id: motoristaId }, data: { dailyRate: 500 } });
      await banco.sistema.helper.update({ where: { id: ajudanteId }, data: { dailyRate: 500 } });
      expect((await lerAcerto(viagemId)).corpo.remuneracao).toMatchObject({ motorista: 740, ajudante: 210, total: 950 });
    });

    it("o Resultado por viagem dos relatórios leva a remuneração no custo, e só da empresa da sessão", async () => {
      const viagemId = await viajar({ extra: { helperId: ajudanteId } });
      entrarComo("ADMIN");
      const { status, corpo } = await chamar<{ resultado: Resultado }>(relatorios.GET(req("GET", undefined, `?de=${MES}&ate=${MES}`)));
      expect(status).toBe(200);
      const linha = corpo.resultado.viagens.find((viagem) => viagem.id === viagemId);
      expect(linha).toMatchObject({ frete: 1500, custo: 950, resultado: 550 });
      expect(corpo.resultado.viagens.map((viagem) => viagem.id)).not.toContain(daOutra.viagemId);
    });

    it("viagem sem os hodômetros: o acerto diz que o valor por km ficou de fora", async () => {
      const viagemId = await viajar({ km: null });
      expect((await lerAcerto(viagemId)).corpo.remuneracao).toMatchObject({ motorista: 540, semKm: true, fora: null });
    });
  });

  describe("isolamento entre empresas", () => {
    it("o fechamento do mês não traz ninguém da outra empresa, e o fechamento gravado lá não existe para esta", async () => {
      await viajar();
      const { corpo } = await lerFechamento();
      const texto = JSON.stringify(corpo);
      expect(corpo.pessoas.map((pessoa) => pessoa.chave)).toContain(chaveDoMotorista(motoristaId));
      expect(texto).not.toContain(daOutra.motoristaId);
      expect(texto).not.toContain(daOutra.ajudanteId);
      expect(texto).not.toMatch(/da outra/);
      // Os valores de lá (diária de 7777, fixo de 8888, fechamento de 24442) não entram em conta nenhuma daqui.
      for (const pessoa of corpo.pessoas) {
        expect([pessoa.formas.dailyRate, pessoa.formas.perTripRate], pessoa.nome).not.toContain(7777);
        expect(pessoa.formas.perTripRate, pessoa.nome).not.toBe(8888);
        expect(pessoa.fechamento?.conta.variavel, pessoa.nome).not.toBe(24442);
      }

      entrarComo("ADMIN");
      expect(await chamar(fechamentoPorId.GET(req(), ctx(daOutra.fechamentoId)))).toMatchObject({ status: 404, corpo: { error: CLOSING_NOT_FOUND } });
      expect(await reabrir(daOutra.fechamentoId)).toMatchObject({ status: 404, corpo: { error: CLOSING_NOT_FOUND } });
      expect(await reabrir(SEM_ID)).toMatchObject({ status: 404 });
      expect(await banco.sistema.crewPayClosing.findUnique({ where: { id: daOutra.fechamentoId } })).not.toBeNull();
    });

    it("o banco recusa fechamento apontando para motorista de outra empresa", async () => {
      await expect(
        banco.default.crewPayClosing.create({ data: { driverId: daOutra.motoristaId, month: "2013-07", variableTotal: 1, advancesTotal: 0, balance: 1, details: {}, closedByName: nome("invasor") } }),
      ).rejects.toThrow();
    });

    it("o interruptor vale só para a empresa da sessão", async () => {
      entrarComo("ADMIN");
      expect(await chamar(empresaRota.GET())).toMatchObject({ status: 200, corpo: { visivelAoMotorista: false } });
      expect((await empresaRota.PATCH(req("PATCH", { visivelAoMotorista: "sim" }))).status).toBe(400);
      expect(await chamar(empresaRota.PATCH(req("PATCH", { visivelAoMotorista: true })))).toMatchObject({ status: 200, corpo: { visivelAoMotorista: true } });
      expect((await banco.sistema.tenant.findUniqueOrThrow({ where: { id: EMPRESA_PADRAO.id } })).driverPayVisible).toBe(true);
      expect((await banco.sistema.tenant.findUniqueOrThrow({ where: { id: EMPRESA_OUTRA.id } })).driverPayVisible).toBe(false);

      const linhas = (await trilha(EMPRESA_PADRAO.id)).filter((l) => l.action === "empresa.remuneracao" && l.userId === ids.ADMIN);
      expect(linhas.map((l) => [l.before, l.after])).toEqual([[{ visivelAoMotorista: false }, { visivelAoMotorista: true }]]);
    });
  });

  describe("aplicativo do motorista", () => {
    it("sem sessão e com perfil que não é motorista: 401", async () => {
      expect((await ganhos(null)).status).toBe(401);
      expect((await ganhos("ADMIN")).status).toBe(401);
      expect((await ganhos("CLIENT")).status).toBe(401);
    });

    it("com o interruptor desligado (o padrão) nenhum valor sai do servidor", async () => {
      await viajar();
      const { status, corpo } = await ganhos("DRIVER");
      expect(status).toBe(200);
      expect(corpo).toEqual({ visivel: false });
    });

    it("ligado: o motorista vê o que cada viagem finalizada dele rendeu e o total do mês, e mais nada", async () => {
      const primeira = await viajar({ extra: { helperId: ajudanteId } });
      const segunda = await viajar({ fretes: [200], saida: em("2013-08-20", "08:00"), fim: em("2013-08-20", "19:00"), km: null });
      await adiantar();
      await ligarNoApp(true);

      const { status, corpo } = await ganhos("DRIVER");
      expect(status).toBe(200);
      if (!corpo.visivel) throw new Error("esperava a remuneração visível");
      expect(corpo).toMatchObject({ visivel: true, mes: MES, fechado: false, total: 930 });
      expect(corpo.viagens.map((v) => [v.manifestId, v.total, v.semKm])).toEqual([
        [primeira, 740, false],
        [segunda, 190, true],
      ]);
      // Nem adiantamento, nem saldo, nem o frete das cargas, nem as formas do cadastro, nem o ajudante.
      expect(JSON.stringify(corpo)).not.toMatch(/adiant|saldo|frete|commissionPct|dailyRate|perKmRate|ajudante/i);
      expect(Object.keys(corpo).sort()).toEqual(["fechado", "mes", "total", "viagens", "visivel"]);
      expect(Object.keys(corpo.viagens[0]).sort()).toEqual(["codigo", "dias", "entregas", "finalizada", "fora", "km", "manifestId", "parcelas", "placa", "semKm", "total"]);
      expect((await ganhos("DRIVER", "2013-13")).status).toBe(400);
    });

    it("mês fechado vem com os valores congelados", async () => {
      await viajar();
      await fechar(chaveDoMotorista(motoristaId));
      await banco.sistema.driver.update({ where: { id: motoristaId }, data: { dailyRate: 999 } });
      await ligarNoApp(true);
      expect((await ganhos("DRIVER")).corpo).toMatchObject({ visivel: true, fechado: true, total: 740 });
    });

    it("cada motorista só recebe o que é dele: nem o do colega, nem o da outra empresa", async () => {
      const minha = await viajar();
      const doColega = await viajar({ extra: { driverId: segundoId }, fretes: [5000] });
      await ligarNoApp(true);

      const meu = (await ganhos("DRIVER")).corpo;
      const dele = (await ganhos("DRIVER2")).corpo;
      if (!meu.visivel || !dele.visivel) throw new Error("esperava a remuneração visível");
      expect(meu.viagens.map((v) => v.manifestId)).toEqual([minha]);
      expect(meu.total).toBe(740);
      // O colega só tem diária: 3 dias × 80.
      expect(dele.viagens.map((v) => v.manifestId)).toEqual([doColega]);
      expect(dele.total).toBe(240);
      for (const corpo of [meu, dele]) {
        expect(JSON.stringify(corpo)).not.toContain(daOutra.viagemId);
        expect(JSON.stringify(corpo)).not.toContain(daOutra.motoristaId);
      }
      // O interruptor da outra empresa continua desligado, e as viagens dela têm valor: nada disso vaza.
      expect((await banco.sistema.tenant.findUniqueOrThrow({ where: { id: EMPRESA_OUTRA.id } })).driverPayVisible).toBe(false);
    });
  });
});
