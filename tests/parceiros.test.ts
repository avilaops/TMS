import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getServerSession } from "next-auth";
import type { Prisma } from "@prisma/client";
import {
  AVISO_DO_RECIBO,
  CABECALHO_DO_FECHAMENTO,
  CARRIER_LOCKED_BY_PAYMENTS,
  CARRIER_NOT_FOUND_OR_INACTIVE,
  CONTRACT_CANCELLED,
  CONTRACT_HAS_PAYMENTS,
  CONTRACT_NOT_FOUND,
  LIQUIDO_MENOR_QUE_O_PAGO,
  LIQUIDO_NEGATIVO,
  PAYMENT_ALREADY_PAID,
  PAYMENT_NOT_FOUND,
  PERCENTUAL_MESSAGE,
  QUITARIA_ANTES_DE_FINALIZAR,
  QUITA_ANTES_DE_FINALIZAR,
  TRIP_CANCELLED_NO_CONTRACT,
  TRIP_HAS_PAID_CONTRACT,
  baseDaViagem,
  cidadesSemRepetir,
  confirmacaoDoPagamento,
  contasDoContrato,
  contratoSchema,
  csvDoFechamento,
  custoParaAViagem,
  descricaoDoPagamento,
  emAberto,
  fechamentoDoParceiro,
  pagamentoSchema,
  situacaoDoContrato,
  totalAdiantado,
  valorSugerido,
  valoresDoContrato,
  type ContratoDoPeriodo,
  type ReciboDeFrete,
  type ValoresGravados,
} from "../src/lib/frete-contratado";
import {
  CARRIER_NOT_FOUND,
  CONTRATACAO_SO_DE_QUEM_PAGA,
  DUPLICATE_CARRIER,
  TAX_ID_MESSAGE,
  TP_PROP_DO_TIPO,
  contratacaoSchema,
  createCarrierSchema,
  proprietarioDoParceiro,
  updateCarrierSchema,
} from "../src/lib/parceiros";
import type { Resultado } from "../src/lib/relatorios";
import { acertoDaViagem, codigoDaViagem, type AcertoDaViagem } from "../src/lib/viagem";
import { EMPRESA_OUTRA, EMPRESA_PADRAO } from "./empresas-de-teste";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

const dia = (data: string) => new Date(`${data}T00:00:00.000Z`);

const ZERADO: ValoresGravados = { grossAmount: 0, tollAmount: 0, otherAdditions: 0, discounts: 0, inss: 0, irrf: 0, sestSenat: 0, otherWithholdings: 0 };

/* ------------------------------- Regras, sem banco ----------------------------- */

describe("regras do frete contratado", () => {
  describe("valor sugerido pela forma de contratação", () => {
    const viagem = { freteDasCargas: 2500, km: 420, entregas: 6 };

    it("fixo, percentual do frete das cargas, por km e por entrega", () => {
      expect(valorSugerido("FIXO", 1800, viagem)).toBe(1800);
      expect(valorSugerido("PERCENTUAL", 70, viagem)).toBe(1750);
      expect(valorSugerido("POR_KM", 3.25, viagem)).toBe(1365);
      expect(valorSugerido("POR_ENTREGA", 45.5, viagem)).toBe(273);
      // Arredonda para centavos.
      expect(valorSugerido("PERCENTUAL", 33.333, { ...viagem, freteDasCargas: 1000.01 })).toBe(333.33);
    });

    it("sem base, com forma desconhecida ou por km sem os hodômetros não há o que sugerir", () => {
      expect(valorSugerido("FIXO", null, viagem)).toBeNull();
      expect(valorSugerido("FIXO", undefined, viagem)).toBeNull();
      expect(valorSugerido("POR_KM", 3, { ...viagem, km: null })).toBeNull();
      expect(valorSugerido("POR_DIA", 100, viagem)).toBeNull();
      expect(valorSugerido(null, 100, viagem)).toBeNull();
      // Base zero é um valor: sugere zero.
      expect(valorSugerido("POR_ENTREGA", 0, viagem)).toBe(0);
    });

    it("a base da viagem soma o frete das cargas, conta as entregas e tira os km do hodômetro", () => {
      expect(baseDaViagem({ collections: [{ freightValue: 100.1 }, { freightValue: null }, { freightValue: 200.2 }], departureOdometer: 1000, returnOdometer: 1350 })).toEqual({
        freteDasCargas: 300.3,
        km: 350,
        entregas: 3,
      });
      expect(baseDaViagem({ collections: [], departureOdometer: 1000, returnOdometer: null }).km).toBeNull();
      expect(baseDaViagem({ collections: [], departureOdometer: 1000, returnOdometer: 900 }).km).toBeNull();
    });
  });

  describe("valores do contrato", () => {
    const contrato: ValoresGravados = { grossAmount: 1000, tollAmount: 100, otherAdditions: 25.5, discounts: 50, inss: 80, irrf: 15.25, sestSenat: 20, otherWithholdings: 4.75 };

    it("líquido = bruto + acréscimos − descontos − retenções; o custo não tira as retenções", () => {
      expect(valoresDoContrato(contrato)).toEqual({ bruto: 1000, acrescimos: 125.5, descontos: 50, retencoes: 120, liquido: 955.5, custo: 1075.5 });
      expect(valoresDoContrato(ZERADO)).toEqual({ bruto: 0, acrescimos: 0, descontos: 0, retencoes: 0, liquido: 0, custo: 0 });
    });

    it("o sistema não calcula retenção: sem valor digitado, a retenção é zero, qualquer que seja o bruto", () => {
      expect(valoresDoContrato({ ...ZERADO, grossAmount: 50_000 })).toMatchObject({ retencoes: 0, liquido: 50_000 });
    });

    it("no custo da viagem o contrato cancelado e a falta de contrato valem zero", () => {
      expect(custoParaAViagem({ ...contrato, status: "ADIANTADO" })).toBe(1075.5);
      expect(custoParaAViagem({ ...contrato, status: "CANCELADO" })).toBe(0);
      expect(custoParaAViagem(null)).toBe(0);
      expect(custoParaAViagem(undefined)).toBe(0);
    });

    it("o acerto da viagem soma o frete contratado ao custo, uma vez", () => {
      const acerto = acertoDaViagem({
        cargas: [{ freightValue: 3000 }],
        despesas: [{ type: "TOLL", amount: 100, status: "APPROVED" }],
        abastecimentos: [{ totalCost: 200 }],
        adiantamentos: [],
        freteContratado: 1075.5,
      });
      expect(acerto).toMatchObject({ frete: 3000, despesas: 100, combustivel: 200, freteContratado: 1075.5, custoTotal: 1375.5, resultado: 1624.5 });
    });
  });

  describe("situação e pagamentos", () => {
    it("a situação sai dos pagamentos; cancelado é o único estado escolhido", () => {
      expect(situacaoDoContrato({ cancelado: false, liquido: 950, pago: 0 })).toBe("ABERTO");
      expect(situacaoDoContrato({ cancelado: false, liquido: 950, pago: 300 })).toBe("ADIANTADO");
      expect(situacaoDoContrato({ cancelado: false, liquido: 950, pago: 950 })).toBe("QUITADO");
      expect(situacaoDoContrato({ cancelado: false, liquido: 950, pago: 1000 })).toBe("QUITADO");
      // Soma de centavos em ponto flutuante não deixa o contrato "quase quitado".
      expect(situacaoDoContrato({ cancelado: false, liquido: 0.3, pago: 0.1 + 0.2 })).toBe("QUITADO");
      expect(situacaoDoContrato({ cancelado: true, liquido: 950, pago: 950 })).toBe("CANCELADO");
      // Contrato ainda sem valor e sem pagamento está em aberto, não quitado.
      expect(situacaoDoContrato({ cancelado: false, liquido: 0, pago: 0 })).toBe("ABERTO");
    });

    it("pagar mais que o líquido e quitar antes de finalizar pedem, cada um, a confirmação própria", () => {
      const base = { liquido: 950, pago: 300, viagemFinalizada: false };
      // Adiantamento que não quita entra direto.
      expect(confirmacaoDoPagamento({ ...base, valor: 200 })).toBeNull();
      // Quita com a viagem em rota.
      expect(confirmacaoDoPagamento({ ...base, valor: 650 })).toEqual({ confirmar: "pagarAntesDeFinalizar", mensagem: QUITA_ANTES_DE_FINALIZAR });
      expect(confirmacaoDoPagamento({ ...base, valor: 650, pagarAntesDeFinalizar: true })).toBeNull();
      expect(confirmacaoDoPagamento({ ...base, valor: 650, viagemFinalizada: true })).toBeNull();
      // Passa do líquido: a confirmação de pagar a mais vem primeiro, e não dispensa a outra.
      const acima = confirmacaoDoPagamento({ ...base, valor: 700 });
      expect(acima?.confirmar).toBe("pagarAcima");
      expect(acima?.mensagem).toMatch(/passa do valor líquido do contrato em R\$\s50,00/);
      expect(confirmacaoDoPagamento({ ...base, valor: 700, pagarAcima: true })?.confirmar).toBe("pagarAntesDeFinalizar");
      expect(confirmacaoDoPagamento({ ...base, valor: 700, pagarAcima: true, pagarAntesDeFinalizar: true })).toBeNull();
      expect(confirmacaoDoPagamento({ ...base, valor: 700, viagemFinalizada: true })?.confirmar).toBe("pagarAcima");
    });

    it("as contas do contrato: pago, adiantado e saldo; em aberto nunca é negativo", () => {
      const contrato = { ...ZERADO, grossAmount: 1000, inss: 50, status: "ADIANTADO", payments: [{ amount: 300, kind: "ADIANTAMENTO" }, { amount: 100.5, kind: "SALDO" }] };
      expect(contasDoContrato(contrato)).toMatchObject({ pago: 400.5, adiantado: 300, saldo: 549.5 });
      expect(totalAdiantado(contrato.payments)).toBe(300);
      expect(emAberto(contrato)).toBe(549.5);
      expect(emAberto({ ...contrato, payments: [{ amount: 2000, kind: "SALDO" }] })).toBe(0);
      expect(contasDoContrato({ ...contrato, payments: [{ amount: 2000, kind: "SALDO" }] }).saldo).toBe(-1050);
      expect(emAberto({ ...contrato, status: "CANCELADO" })).toBe(0);
    });

    it("a descrição do lançamento leva o tipo do pagamento, a viagem e o parceiro", () => {
      expect(descricaoDoPagamento("ADIANTAMENTO", "abcdef12-0000", "José Agregado")).toBe("Adiantamento de frete: viagem #ABCDEF (José Agregado)");
      expect(descricaoDoPagamento("SALDO", "abcdef12-0000", "José Agregado")).toBe("Saldo de frete: viagem #ABCDEF (José Agregado)");
    });
  });

  describe("fechamento por parceiro", () => {
    const contrato = (id: string, saiu: string | null, trocas: Partial<ContratoDoPeriodo> = {}): ContratoDoPeriodo => ({
      ...ZERADO,
      id: `c-${id}`,
      status: "ABERTO",
      grossAmount: 1000,
      payments: [],
      manifest: { id: `${id}00000-aaaa`, status: "FINISHED", createdAt: "2012-05-01T12:00:00.000Z", departedAt: saiu, vehicle: { plate: "ABC1D23" }, driver: { user: { name: "João" } } },
      ...trocas,
    });

    it("uma linha por contrato, da viagem mais antiga para a mais nova, com o total; cancelado não entra", () => {
      const fechamento = fechamentoDoParceiro([
        contrato("b", "2012-05-20T15:00:00.000Z", { tollAmount: 100, inss: 80, status: "ADIANTADO", payments: [{ amount: 400, kind: "ADIANTAMENTO" }] }),
        contrato("a", "2012-05-03T15:00:00.000Z", { discounts: 50, status: "QUITADO", payments: [{ amount: 950, kind: "SALDO" }] }),
        contrato("c", "2012-05-10T15:00:00.000Z", { status: "CANCELADO" }),
        // Ainda não saiu: entra pelo dia em que foi montada.
        contrato("d", null),
      ]);
      expect(fechamento.linhas.map((linha) => [linha.codigo, linha.dia, linha.situacao, linha.liquido, linha.pago, linha.saldo])).toEqual([
        ["D00000", "2012-05-01", "ABERTO", 1000, 0, 1000],
        ["A00000", "2012-05-03", "QUITADO", 950, 950, 0],
        ["B00000", "2012-05-20", "ADIANTADO", 1020, 400, 620],
      ]);
      expect(fechamento.total).toEqual({ viagens: 3, bruto: 3000, acrescimos: 100, descontos: 50, retencoes: 80, liquido: 2970, pago: 1350, saldo: 1620 });
    });

    it("o dia da viagem é o do relógio do Brasil: saída às 02h UTC ainda é o dia anterior", () => {
      expect(fechamentoDoParceiro([contrato("a", "2012-06-01T02:00:00.000Z")]).linhas[0].dia).toBe("2012-05-31");
    });

    it("o CSV sai no formato da exportação do portal, com o total na última linha", () => {
      const csv = csvDoFechamento(fechamentoDoParceiro([contrato("a", "2012-05-03T15:00:00.000Z", { inss: 80.5, payments: [{ amount: 300, kind: "ADIANTAMENTO" }], status: "ADIANTADO" })]));
      const linhas = csv.replace(/^﻿/, "").trimEnd().split("\r\n");
      expect(csv.startsWith("﻿")).toBe(true);
      expect(linhas[0].split(";")).toHaveLength(CABECALHO_DO_FECHAMENTO.length);
      expect(linhas[1]).toBe('"#A00000";"03/05/2012";"ABC1D23";"João";"Adiantado";1000,00;0,00;0,00;80,50;919,50;300,00;619,50');
      expect(linhas[2]).toBe('"Total";"";"";"";"1 viagem(ns)";1000,00;0,00;0,00;80,50;919,50;300,00;619,50');
      // Nome que começa com sinal de fórmula não vira fórmula na planilha.
      const perigoso = csvDoFechamento(fechamentoDoParceiro([contrato("a", "2012-05-03T15:00:00.000Z", { manifest: { ...contrato("a", null).manifest, departedAt: "2012-05-03T15:00:00.000Z", driver: { user: { name: "=SOMA(A1)" } } } })]));
      expect(perigoso).toContain(`"'=SOMA(A1)"`);
    });
  });

  it("origens e destinos do recibo não se repetem e ficam na ordem da viagem", () => {
    expect(cidadesSemRepetir(["Rio Preto - SP", "Mirassol - SP", "  rio preto - sp ", "", "Mirassol  -  SP", "Bady - SP"])).toEqual(["Rio Preto - SP", "Mirassol - SP", "Bady - SP"]);
  });

  describe("validação", () => {
    it("o parceiro exige CPF ou CNPJ válido, guarda sem pontuação, e confere RNTRC, UF e e-mail", () => {
      const base = { type: "TAC_AGREGADO", name: "  José Agregado  ", taxId: "529.982.247-25" };
      expect(createCarrierSchema.parse({ ...base, rntrc: "12.345.678", state: "sp", email: " JOSE@Exemplo.br ", phone: "", pixKey: "529.982.247-25" })).toMatchObject({
        type: "TAC_AGREGADO",
        name: "José Agregado",
        taxId: "52998224725",
        rntrc: "12345678",
        state: "SP",
        email: "jose@exemplo.br",
        phone: null,
        pixKey: "529.982.247-25",
      });
      expect(createCarrierSchema.parse({ ...base, type: "TRANSPORTADORA", taxId: "99.333.111/0001-87" }).taxId).toBe("99333111000187");

      const erro = (corpo: unknown) => createCarrierSchema.safeParse(corpo).error?.issues[0].message;
      // Dígito verificador errado, tamanho errado e sequência repetida.
      for (const taxId of ["52998224724", "99333111000186", "123", "", "11111111111"]) expect(erro({ ...base, taxId }), taxId).toBe(TAX_ID_MESSAGE);
      expect(erro({ ...base, rntrc: "1234567" })).toBe("O RNTRC tem 8 dígitos.");
      expect(erro({ ...base, state: "XX" })).toBe("UF inválida.");
      expect(erro({ ...base, type: "COOPERATIVA" })).toBe("Tipo de parceiro inválido.");
      expect(erro({ ...base, name: "J" })).toBe("Informe o nome ou a razão social.");
      expect(erro({ ...base, name: "x".repeat(61) })).toBe("Nome muito longo (máximo de 60 letras).");
      expect(erro({ ...base, email: "sem-arroba" })).toBe("E-mail inválido.");
      expect(erro(null)).toBe("Dados inválidos.");
    });

    it("a alteração não aceita o documento, exige ao menos um campo e apaga o que vem em branco", () => {
      expect(updateCarrierSchema.parse({ phone: "", notes: "  obs  ", active: false })).toEqual({ phone: null, notes: "obs", active: false });
      expect(updateCarrierSchema.safeParse({}).error?.issues[0].message).toBe("Informe ao menos um campo para alterar.");
      expect(updateCarrierSchema.parse({ taxId: "52998224725", name: "Novo Nome" })).toEqual({ name: "Novo Nome" });
    });

    it("a contratação padrão: forma e valor juntos; percentual até 100; em branco tira o padrão", () => {
      expect(contratacaoSchema.parse({ defaultCalcMode: "POR_KM", defaultCalcBase: "3,25" })).toEqual({ defaultCalcMode: "POR_KM", defaultCalcBase: 3.25 });
      expect(contratacaoSchema.parse({ defaultCalcMode: "", defaultCalcBase: "" })).toEqual({ defaultCalcMode: null, defaultCalcBase: null });
      expect(contratacaoSchema.parse({ defaultCalcMode: "FIXO" })).toEqual({ defaultCalcMode: "FIXO" });
      const erro = (corpo: unknown) => contratacaoSchema.safeParse(corpo).error?.issues[0].message;
      expect(erro({ defaultCalcMode: "PERCENTUAL", defaultCalcBase: "100,5" })).toBe(PERCENTUAL_MESSAGE);
      expect(erro({ defaultCalcMode: "", defaultCalcBase: "10" })).toBe("Escolha a forma de contratação para informar o valor padrão.");
      expect(erro({ defaultCalcMode: "POR_DIA", defaultCalcBase: "10" })).toBe("Forma de contratação inválida.");
      expect(erro({ defaultCalcMode: "FIXO", defaultCalcBase: "-1" })).toBe("A base do cálculo precisa ser um número maior ou igual a zero.");
      expect(erro({ defaultCalcMode: "FIXO", defaultCalcBase: "dez" })).toBe("A base do cálculo precisa ser um número maior ou igual a zero.");
    });

    it("o contrato aceita número com vírgula, trata valor em branco como zero e recusa líquido negativo", () => {
      const corpo = { carrierId: "p1", calcMode: "FIXO", calcBase: "1000", grossAmount: "1000,50", tollAmount: "", inss: "80", notes: "" };
      expect(contratoSchema.parse(corpo)).toEqual({
        carrierId: "p1",
        calcMode: "FIXO",
        calcBase: 1000,
        grossAmount: 1000.5,
        tollAmount: 0,
        otherAdditions: 0,
        discounts: 0,
        inss: 80,
        irrf: 0,
        sestSenat: 0,
        otherWithholdings: 0,
        notes: null,
      });
      expect(contratoSchema.parse({ ...corpo, calcBase: "", irrf: null }).calcBase).toBeNull();

      const erro = (trocas: Record<string, unknown>) => contratoSchema.safeParse({ ...corpo, ...trocas }).error?.issues[0].message;
      expect(erro({ carrierId: "" })).toBe("Escolha o parceiro.");
      expect(erro({ calcMode: "POR_DIA" })).toBe("Forma de cálculo inválida.");
      expect(erro({ calcMode: "PERCENTUAL", calcBase: "101" })).toBe(PERCENTUAL_MESSAGE);
      expect(erro({ grossAmount: "-1" })).toBe("O valor bruto precisa ser um número maior ou igual a zero.");
      expect(erro({ inss: "abc" })).toBe("O INSS precisa ser um número maior ou igual a zero.");
      expect(erro({ grossAmount: "100", inss: "80", irrf: "30" })).toBe(LIQUIDO_NEGATIVO);
      expect(contratoSchema.safeParse(null).error?.issues[0].message).toBe("Dados inválidos.");
    });

    it("o pagamento exige tipo, data, valor maior que zero e forma; as confirmações são sim ou não", () => {
      const corpo = { kind: "ADIANTAMENTO", date: "2012-05-10", amount: "300,00", method: "PIX" };
      expect(pagamentoSchema.parse({ ...corpo, notes: " ", paid: true, pagarAcima: true })).toEqual({ kind: "ADIANTAMENTO", date: dia("2012-05-10"), amount: 300, method: "PIX", notes: null, paid: true, pagarAcima: true });
      const erro = (trocas: Record<string, unknown>) => pagamentoSchema.safeParse({ ...corpo, ...trocas }).error?.issues[0].message;
      expect(erro({ kind: "GORJETA" })).toBe("Informe se é adiantamento ou saldo.");
      expect(erro({ date: "" })).toBe("Informe a data do pagamento.");
      expect(erro({ amount: "0" })).toBe("O valor do pagamento precisa ser um número maior que zero.");
      expect(erro({ amount: "" })).toBe("O valor do pagamento precisa ser um número maior que zero.");
      expect(erro({ method: "BOLETO" })).toBe("Forma de pagamento inválida.");
      expect(erro({ pagarAcima: "sim" })).toBe("Confirmação inválida.");
    });
  });

  it("o tipo do parceiro vira o tpProp do MDF-e, e o proprietário leva o nome do parceiro para a pendência", () => {
    expect(TP_PROP_DO_TIPO).toEqual({ TAC_AGREGADO: "0", TAC_INDEPENDENTE: "1", TRANSPORTADORA: "2" });
    expect(proprietarioDoParceiro({ name: "José Agregado", taxId: "52998224725", rntrc: "12345678", ie: null, state: "SP", type: "TAC_AGREGADO" })).toEqual({
      documento: "52998224725",
      nome: "José Agregado",
      rntrc: "12345678",
      ie: null,
      uf: "SP",
      tipo: "0",
      parceiro: "José Agregado",
    });
    // Tipo que o sistema não conhece não vira tpProp inventado: o MDF-e lista a falta.
    expect(proprietarioDoParceiro({ name: "X", taxId: "52998224725", rntrc: null, ie: null, state: null, type: "COOPERATIVA" }).tipo).toBeNull();
  });
});

/* ------------------------------ Rotas, com o banco ----------------------------- */

const temBanco = Boolean(process.env.DATABASE_URL);

if (!temBanco) {
  console.warn("\n[parceiros.test] DATABASE_URL ausente: testes de integração PULADOS.\nRode com um Postgres real para exercitá-los.\n");
}

const suite = temBanco ? describe : describe.skip;

// Tudo o que esta suite cria usa estes marcadores, e só isso é apagado.
const PREFIXO = "teste-parceiros-";
const CNPJ_DO_CLIENTE = "99444111000155";
const CNPJ_DO_CLIENTE_DA_OUTRA = "99444111000236";
const CNPJS_DE_CLIENTE = [CNPJ_DO_CLIENTE, CNPJ_DO_CLIENTE_DA_OUTRA];
const CPF_MOTORISTA = "77888999506";
const CPF_MOTORISTA_DA_OUTRA = "77888999689";
const CPFS_DE_MOTORISTA = [CPF_MOTORISTA, CPF_MOTORISTA_DA_OUTRA];
const PLACA_PROPRIA = "PRC1A23";
const PLACA_DO_PARCEIRO = "PRC1A24";
const PLACA_DA_OUTRA = "PRC1A25";
const PLACAS = [PLACA_PROPRIA, PLACA_DO_PARCEIRO, PLACA_DA_OUTRA];
// Documentos com os dígitos verificadores certos: o cadastro confere.
const CNPJ_DO_PARCEIRO = "99333111000187";
const CNPJ_DO_SEGUNDO = "99333111000268";
const CNPJ_DO_PARCEIRO_DA_OUTRA = "99333111000349";
const CPF_DO_AUTONOMO = "99333111158";
const CPF_DO_NOVO = "99333111239";
const DOCUMENTOS = [CNPJ_DO_PARCEIRO, CNPJ_DO_SEGUNDO, CNPJ_DO_PARCEIRO_DA_OUTRA, CPF_DO_AUTONOMO, CPF_DO_NOVO];
const HASH_FALSO = "$2b$10$hashfalsoparateste000000000000000000000000000000000";
const SEM_ID = "00000000-0000-0000-0000-000000000000";

type Corpo = Record<string, unknown> & { id: string; error?: string; confirmar?: string };
type Perfil = "ADMIN" | "DIRECTOR" | "OPERATION" | "FINANCE" | "EXPEDITION" | "CLIENT" | "DRIVER";
const PERFIS_DO_TESTE = ["ADMIN", "DIRECTOR", "OPERATION", "FINANCE", "EXPEDITION", "CLIENT", "DRIVER"] as const;

type PagamentoLido = { id: string; kind: string; amount: number; method: string; transactionId: string | null; transaction: { status: string } | null };
type ContratoLido = Corpo & {
  status: string;
  carrierId: string;
  calcMode: string;
  calcBase: number | null;
  grossAmount: number;
  valores: { bruto: number; acrescimos: number; descontos: number; retencoes: number; liquido: number; custo: number };
  pago: number;
  adiantado: number;
  saldo: number;
  sugerido: number | null;
  payments: PagamentoLido[];
};
type FreteLido = Corpo & {
  viagem: { status: string; freteDasCargas: number; km: number | null; entregas: number };
  parceiroDoVeiculo: { id: string; name: string } | null;
  contrato: ContratoLido | null;
  parceiros: { id: string; name: string; defaultCalcMode: string | null }[];
};
type ParceiroLido = Corpo & { name: string; taxId: string; active: boolean; vehicles: { plate: string }[]; drivers: { id: string }[]; emAberto?: number; defaultCalcMode?: string | null; defaultCalcBase?: number | null };

suite("rotas de parceiros e frete contratado", () => {
  let banco: typeof import("../src/lib/prisma");
  let parceirosRota: typeof import("../src/app/api/parceiros/route");
  let parceiroRota: typeof import("../src/app/api/parceiros/[id]/route");
  let contratacaoRota: typeof import("../src/app/api/parceiros/[id]/contratacao/route");
  let fechamentoRota: typeof import("../src/app/api/parceiros/[id]/fechamento/route");
  let freteRota: typeof import("../src/app/api/manifestos/[id]/frete/route");
  let pagamentosRota: typeof import("../src/app/api/manifestos/[id]/frete/pagamentos/route");
  let pagamentoRota: typeof import("../src/app/api/manifestos/[id]/frete/pagamentos/[registroId]/route");
  let reciboRota: typeof import("../src/app/api/manifestos/[id]/frete/recibo/route");
  let manifestos: typeof import("../src/app/api/manifestos/route");
  let manifestoRota: typeof import("../src/app/api/manifestos/[id]/route");
  let cancelarRota: typeof import("../src/app/api/manifestos/[id]/cancelar/route");
  let acertoRota: typeof import("../src/app/api/manifestos/[id]/acerto/route");
  let relatorios: typeof import("../src/app/api/relatorios/route");
  let veiculosRota: typeof import("../src/app/api/veiculos/route");
  let veiculoRota: typeof import("../src/app/api/veiculos/[id]/route");
  let motoristaRota: typeof import("../src/app/api/motoristas/[id]/route");
  let lancamentoRota: typeof import("../src/app/api/financeiro/[id]/route");

  const sessao = vi.mocked(getServerSession);
  const ids = {} as Record<Perfil, string>;
  let clienteId: string;
  let motoristaId: string;
  let veiculoProprioId: string;
  let veiculoDoParceiroId: string;
  /** O parceiro principal: transportadora, com contratação padrão de 70% do frete das cargas. */
  let parceiroId: string;
  /** Um autônomo sem contratação padrão. */
  let autonomoId: string;
  const daOutra = { parceiroId: "", veiculoId: "", motoristaId: "", clienteId: "", viagemId: "", pagamentoId: "" };

  const entrarComo = (perfil: Perfil | null) => sessao.mockResolvedValue(perfil ? { user: { id: ids[perfil], role: perfil, clientId: null } } : null);

  const req = (method = "GET", body?: unknown, query = "") =>
    new Request(`http://localhost/api/teste${query}`, {
      method,
      headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.9" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const ctxPagamento = (id: string, registroId: string) => ({ params: Promise.resolve({ id, registroId }) });

  const nome = (n: string) => `${PREFIXO}${n}`;
  const em = (data: string, hora = "12:00") => new Date(`${data}T${hora}:00-03:00`);

  const chamar = async <T = Corpo>(resposta: Promise<Response>) => {
    const res = await resposta;
    return { status: res.status, corpo: (await res.json()) as T };
  };

  /** Os lançamentos que esta suite fez no Financeiro DESTA empresa (o da outra empresa fica de fora). */
  const lancamentos = () => banco.sistema.financialTransaction.findMany({ where: { tenantId: EMPRESA_PADRAO.id, counterparty: { startsWith: PREFIXO } }, orderBy: { createdAt: "asc" } });
  const contratoDe = (manifestId: string) => banco.sistema.freightContract.findUnique({ where: { manifestId }, include: { payments: { orderBy: { createdAt: "asc" } } } });
  const trilha = (entityId: string) =>
    banco.sistema.auditLog.findMany({ where: { entityId }, orderBy: { createdAt: "asc" }, select: { action: true, userId: true, summary: true, before: true, after: true } });

  async function limparMovimento() {
    const { sistema } = banco;
    await sistema.collection.deleteMany({ where: { client: { cnpj: { in: CNPJS_DE_CLIENTE } } } });
    // Os contratos e os pagamentos somem com a viagem (ON DELETE CASCADE).
    await sistema.manifest.deleteMany({ where: { vehicle: { plate: { in: PLACAS } } } });
    await sistema.financialTransaction.deleteMany({ where: { counterparty: { startsWith: PREFIXO } } });
    await sistema.auditLog.deleteMany({ where: { userName: { startsWith: PREFIXO } } });
  }

  async function limpar() {
    const { sistema } = banco;
    await limparMovimento();
    await sistema.vehicle.deleteMany({ where: { plate: { in: PLACAS } } });
    await sistema.driver.deleteMany({ where: { cpf: { in: CPFS_DE_MOTORISTA } } });
    await sistema.carrier.deleteMany({ where: { OR: [{ taxId: { in: DOCUMENTOS } }, { name: { startsWith: PREFIXO } }] } });
    await sistema.client.deleteMany({ where: { cnpj: { in: CNPJS_DE_CLIENTE } } });
    await sistema.user.deleteMany({ where: { email: { startsWith: PREFIXO } } });
  }

  type DadosDaCarga = { status?: string; frete?: number | null; origem?: string; destino?: string };

  const carga = (dados: DadosDaCarga = {}, cliente = clienteId) => ({
    clientId: cliente,
    sender: "Remetente",
    receiver: nome("destinatário"),
    origin: dados.origem ?? "Rio Preto - SP",
    destination: dados.destino ?? "Mirassol - SP",
    volumes: 1,
    weight: 10,
    status: dados.status ?? "ROUTE",
    freightValue: dados.frete === undefined ? 1000 : dados.frete,
  });

  /** Viagem gravada direto no banco, no veículo próprio (sem contrato automático), com as cargas pedidas. */
  async function viajar(status: string, cargas: DadosDaCarga[] = [{}], extra: Partial<Prisma.ManifestUncheckedCreateInput> = {}) {
    const viagem = await banco.default.manifest.create({ data: { driverId: motoristaId, vehicleId: veiculoProprioId, status, ...extra } });
    for (const dados of cargas) await banco.default.collection.create({ data: { ...carga(dados), manifestId: viagem.id, driverId: motoristaId } });
    return viagem.id;
  }

  // Bruto 1000 + pedágio 100 − desconto 50 = custo 1050; retenções 80 + 20 = 100; líquido 950.
  const CONTRATO = { calcMode: "FIXO", calcBase: "1000", grossAmount: "1000", tollAmount: "100", otherAdditions: "", discounts: "50", inss: "80", irrf: "", sestSenat: "20", otherWithholdings: "", notes: "" };

  const lerFrete = (viagemId: string, perfil: Perfil = "ADMIN") => {
    entrarComo(perfil);
    return chamar<FreteLido>(freteRota.GET(req(), ctx(viagemId)));
  };
  const gravarContrato = (viagemId: string, corpo: Record<string, unknown> = {}, perfil: Perfil = "ADMIN") => {
    entrarComo(perfil);
    return chamar<ContratoLido>(freteRota.PUT(req("PUT", { carrierId: parceiroId, ...CONTRATO, ...corpo }), ctx(viagemId)));
  };
  const pagar = (viagemId: string, corpo: Record<string, unknown> = {}, perfil: Perfil = "ADMIN") => {
    entrarComo(perfil);
    return chamar<Corpo & { pagamento: PagamentoLido; contrato: ContratoLido }>(
      pagamentosRota.POST(req("POST", { kind: "ADIANTAMENTO", date: "2012-05-10", amount: "300", method: "PIX", ...corpo }), ctx(viagemId)),
    );
  };
  const estornar = (viagemId: string, pagamentoId: string, perfil: Perfil = "ADMIN") => {
    entrarComo(perfil);
    return chamar<ContratoLido>(pagamentoRota.DELETE(req("DELETE"), ctxPagamento(viagemId, pagamentoId)));
  };
  const listar = async (perfil: Perfil = "ADMIN") => {
    entrarComo(perfil);
    const { status, corpo } = await chamar<ParceiroLido[]>(parceirosRota.GET());
    return { status, parceiros: status === 200 ? corpo : [] };
  };
  const criarParceiro = (corpo: Record<string, unknown>, perfil: Perfil = "OPERATION") => {
    entrarComo(perfil);
    return chamar<ParceiroLido>(parceirosRota.POST(req("POST", corpo)));
  };

  beforeAll(async () => {
    banco = await import("../src/lib/prisma");
    parceirosRota = await import("../src/app/api/parceiros/route");
    parceiroRota = await import("../src/app/api/parceiros/[id]/route");
    contratacaoRota = await import("../src/app/api/parceiros/[id]/contratacao/route");
    fechamentoRota = await import("../src/app/api/parceiros/[id]/fechamento/route");
    freteRota = await import("../src/app/api/manifestos/[id]/frete/route");
    pagamentosRota = await import("../src/app/api/manifestos/[id]/frete/pagamentos/route");
    pagamentoRota = await import("../src/app/api/manifestos/[id]/frete/pagamentos/[registroId]/route");
    reciboRota = await import("../src/app/api/manifestos/[id]/frete/recibo/route");
    manifestos = await import("../src/app/api/manifestos/route");
    manifestoRota = await import("../src/app/api/manifestos/[id]/route");
    cancelarRota = await import("../src/app/api/manifestos/[id]/cancelar/route");
    acertoRota = await import("../src/app/api/manifestos/[id]/acerto/route");
    relatorios = await import("../src/app/api/relatorios/route");
    veiculosRota = await import("../src/app/api/veiculos/route");
    veiculoRota = await import("../src/app/api/veiculos/[id]/route");
    motoristaRota = await import("../src/app/api/motoristas/[id]/route");
    lancamentoRota = await import("../src/app/api/financeiro/[id]/route");
    await limpar();

    const db = banco.default;
    for (const perfil of PERFIS_DO_TESTE) {
      ids[perfil] = (await db.user.create({ data: { name: nome(perfil), email: `${PREFIXO}${perfil.toLowerCase()}@exemplo.br`, password: HASH_FALSO, role: perfil } })).id;
    }
    clienteId = (await db.client.create({ data: { companyName: nome("cliente"), cnpj: CNPJ_DO_CLIENTE } })).id;
    const motorista = { cnh: "77888999501", cnhExpiry: new Date("2031-06-30"), category: "C" };
    motoristaId = (await db.driver.create({ data: { ...motorista, userId: ids.DRIVER, cpf: CPF_MOTORISTA } })).id;

    parceiroId = (
      await db.carrier.create({
        data: { type: "TRANSPORTADORA", name: nome("Transportes Parceiros"), taxId: CNPJ_DO_PARCEIRO, rntrc: "12345678", state: "SP", pixKey: "pix@parceiro.br", defaultCalcMode: "PERCENTUAL", defaultCalcBase: 70 },
      })
    ).id;
    autonomoId = (await db.carrier.create({ data: { type: "TAC_INDEPENDENTE", name: nome("Autônomo"), taxId: CPF_DO_AUTONOMO } })).id;
    veiculoProprioId = (await db.vehicle.create({ data: { plate: PLACA_PROPRIA, model: nome("próprio"), type: "TRUCK" } })).id;
    veiculoDoParceiroId = (await db.vehicle.create({ data: { plate: PLACA_DO_PARCEIRO, model: nome("do parceiro"), type: "TRUCK", carrierId: parceiroId } })).id;

    const outra = banco.paraEmpresa(EMPRESA_OUTRA.id).db;
    const usuario = await outra.user.create({ data: { name: nome("motorista da outra"), email: `${PREFIXO}outra@exemplo.br`, password: HASH_FALSO, role: "DRIVER" } });
    daOutra.motoristaId = (await outra.driver.create({ data: { ...motorista, userId: usuario.id, cpf: CPF_MOTORISTA_DA_OUTRA } })).id;
    daOutra.parceiroId = (await outra.carrier.create({ data: { type: "TAC_AGREGADO", name: nome("parceiro da outra"), taxId: CNPJ_DO_PARCEIRO_DA_OUTRA, defaultCalcMode: "FIXO", defaultCalcBase: 7777 } })).id;
    daOutra.veiculoId = (await outra.vehicle.create({ data: { plate: PLACA_DA_OUTRA, model: nome("da outra"), type: "TRUCK", carrierId: daOutra.parceiroId } })).id;
    daOutra.clienteId = (await outra.client.create({ data: { companyName: nome("cliente da outra"), cnpj: CNPJ_DO_CLIENTE_DA_OUTRA } })).id;
  }, 120_000);

  beforeEach(async () => {
    sessao.mockReset();
    await limparMovimento();
    await banco.sistema.vehicle.updateMany({ where: { plate: { in: PLACAS } }, data: { status: "AVAILABLE" } });
    await banco.sistema.vehicle.update({ where: { id: veiculoDoParceiroId }, data: { carrierId: parceiroId } });
    await banco.sistema.vehicle.update({ where: { id: veiculoProprioId }, data: { carrierId: null } });
    await banco.sistema.driver.update({ where: { id: motoristaId }, data: { carrierId: null } });
    await banco.sistema.carrier.deleteMany({ where: { taxId: { in: [CNPJ_DO_SEGUNDO, CPF_DO_NOVO] } } });
    await banco.sistema.carrier.update({ where: { id: parceiroId }, data: { active: true, name: nome("Transportes Parceiros"), phone: null, defaultCalcMode: "PERCENTUAL", defaultCalcBase: 70 } });
    await banco.sistema.carrier.update({ where: { id: autonomoId }, data: { active: true, defaultCalcMode: null, defaultCalcBase: null } });

    // A viagem da outra empresa, finalizada em maio de 2012, com contrato e um pagamento lançado.
    const outra = banco.paraEmpresa(EMPRESA_OUTRA.id).db;
    const viagem = await outra.manifest.create({
      data: { driverId: daOutra.motoristaId, vehicleId: daOutra.veiculoId, status: "FINISHED", departedAt: em("2012-05-02"), finishedAt: em("2012-05-04") },
    });
    daOutra.viagemId = viagem.id;
    await outra.collection.create({ data: { ...carga({ status: "DELIVERED", frete: 8888 }, daOutra.clienteId), manifestId: viagem.id } });
    const lancamento = await outra.financialTransaction.create({ data: { type: "EXPENSE", amount: 6666, description: "Adiantamento de frete da outra", status: "PENDING", counterparty: nome("parceiro da outra") } });
    const contrato = await outra.freightContract.create({ data: { manifestId: viagem.id, carrierId: daOutra.parceiroId, calcMode: "FIXO", calcBase: 7777, grossAmount: 7777, status: "ADIANTADO" } });
    daOutra.pagamentoId = (
      await outra.freightPayment.create({ data: { contractId: contrato.id, kind: "ADIANTAMENTO", date: dia("2012-05-02"), amount: 6666, method: "PIX", transactionId: lancamento.id } })
    ).id;
  });

  afterAll(async () => {
    if (banco) await limpar();
  });

  /* --------------------------------- Permissão -------------------------------- */

  describe("permissão por perfil", () => {
    it("sem sessão é 401 em tudo; cliente e motorista levam 403", async () => {
      const viagemId = await viajar("ROUTE");
      const rotas: [string, () => Promise<Response>][] = [
        ["GET /api/parceiros", () => parceirosRota.GET()],
        ["POST /api/parceiros", () => parceirosRota.POST(req("POST", {}))],
        ["PATCH /api/parceiros/[id]", () => parceiroRota.PATCH(req("PATCH", {}), ctx(parceiroId))],
        ["PUT /api/parceiros/[id]/contratacao", () => contratacaoRota.PUT(req("PUT", {}), ctx(parceiroId))],
        ["GET /api/parceiros/[id]/fechamento", () => fechamentoRota.GET(req(), ctx(parceiroId))],
        ["GET /api/manifestos/[id]/frete", () => freteRota.GET(req(), ctx(viagemId))],
        ["PUT /api/manifestos/[id]/frete", () => freteRota.PUT(req("PUT", {}), ctx(viagemId))],
        ["DELETE /api/manifestos/[id]/frete", () => freteRota.DELETE(req("DELETE"), ctx(viagemId))],
        ["POST /api/manifestos/[id]/frete/pagamentos", () => pagamentosRota.POST(req("POST", {}), ctx(viagemId))],
        ["DELETE /api/manifestos/[id]/frete/pagamentos/[registroId]", () => pagamentoRota.DELETE(req("DELETE"), ctxPagamento(viagemId, SEM_ID))],
        ["GET /api/manifestos/[id]/frete/recibo", () => reciboRota.GET(req(), ctx(viagemId))],
      ];
      entrarComo(null);
      for (const [rota, chamada] of rotas) expect((await chamada()).status, rota).toBe(401);
      for (const perfil of ["CLIENT", "DRIVER"] as const) {
        entrarComo(perfil);
        for (const [rota, chamada] of rotas) expect((await chamada()).status, `${perfil} em ${rota}`).toBe(403);
      }
    });

    it("o cadastro é da administração, da diretoria e da operação; o financeiro só lê; a expedição não entra", async () => {
      for (const perfil of ["ADMIN", "DIRECTOR", "OPERATION", "FINANCE"] as const) expect((await listar(perfil)).status, perfil).toBe(200);
      expect((await listar("EXPEDITION")).status).toBe(403);

      for (const perfil of ["FINANCE", "EXPEDITION"] as const) {
        expect((await criarParceiro({ type: "TAC_AGREGADO", name: "Invasor", taxId: CPF_DO_NOVO }, perfil)).status, perfil).toBe(403);
        entrarComo(perfil);
        expect((await parceiroRota.PATCH(req("PATCH", { phone: "1" }), ctx(parceiroId))).status, perfil).toBe(403);
      }
      expect(await banco.sistema.carrier.count({ where: { taxId: CPF_DO_NOVO } })).toBe(0);
      expect((await banco.sistema.carrier.findUniqueOrThrow({ where: { id: parceiroId } })).phone).toBeNull();
    });

    it("valores e pagamento são de quem lê e lança no financeiro: a operação e a expedição levam 403, a diretoria só lê", async () => {
      const viagemId = await viajar("ROUTE");
      for (const perfil of ["OPERATION", "EXPEDITION"] as const) {
        expect((await lerFrete(viagemId, perfil)).status, perfil).toBe(403);
        expect((await gravarContrato(viagemId, {}, perfil)).status, perfil).toBe(403);
        expect((await pagar(viagemId, {}, perfil)).status, perfil).toBe(403);
        entrarComo(perfil);
        expect((await reciboRota.GET(req(), ctx(viagemId))).status, perfil).toBe(403);
        entrarComo(perfil);
        expect((await fechamentoRota.GET(req(), ctx(parceiroId))).status, perfil).toBe(403);
        entrarComo(perfil);
        expect((await contratacaoRota.PUT(req("PUT", { defaultCalcMode: "FIXO", defaultCalcBase: "1" }), ctx(parceiroId))).status, perfil).toBe(403);
      }
      expect(await contratoDe(viagemId)).toBeNull();

      // A diretoria lê e não grava.
      expect((await lerFrete(viagemId, "DIRECTOR")).status).toBe(200);
      expect((await gravarContrato(viagemId, {}, "DIRECTOR")).status).toBe(403);
      entrarComo("DIRECTOR");
      expect((await contratacaoRota.PUT(req("PUT", { defaultCalcMode: "FIXO", defaultCalcBase: "1" }), ctx(parceiroId))).status).toBe(403);

      // O financeiro grava contrato e paga, sem ter o cadastro de parceiros.
      expect((await gravarContrato(viagemId, {}, "FINANCE")).status).toBe(201);
      expect((await pagar(viagemId, {}, "FINANCE")).status).toBe(201);
      expect((await pagar(viagemId, {}, "DIRECTOR")).status).toBe(403);
      entrarComo("DIRECTOR");
      expect((await freteRota.DELETE(req("DELETE"), ctx(viagemId))).status).toBe(403);
      expect(await lancamentos()).toHaveLength(1);
    });

    it("a lista só leva a contratação padrão e o total em aberto para quem lê o frete contratado", async () => {
      const viagemId = await viajar("ROUTE");
      await gravarContrato(viagemId);
      await pagar(viagemId);

      for (const perfil of ["ADMIN", "DIRECTOR", "FINANCE"] as const) {
        const doTeste = (await listar(perfil)).parceiros.find((p) => p.id === parceiroId);
        expect(doTeste, perfil).toMatchObject({ defaultCalcMode: "PERCENTUAL", defaultCalcBase: 70, emAberto: 650 });
      }
      const comoOperacao = (await listar("OPERATION")).parceiros.find((p) => p.id === parceiroId);
      expect(comoOperacao).toMatchObject({ name: nome("Transportes Parceiros"), taxId: CNPJ_DO_PARCEIRO, pixKey: "pix@parceiro.br" });
      expect(comoOperacao).not.toHaveProperty("emAberto");
      expect(comoOperacao).not.toHaveProperty("defaultCalcMode");
      expect(comoOperacao).not.toHaveProperty("defaultCalcBase");
      expect(comoOperacao).not.toHaveProperty("contracts");
    });
  });

  /* ---------------------------------- Cadastro -------------------------------- */

  describe("cadastro de parceiros", () => {
    it("cria com o documento sem pontuação, registra na auditoria e recusa o que é inválido", async () => {
      expect((await criarParceiro({ type: "TAC_AGREGADO", name: "José", taxId: "993.331.112-38" })).corpo.error).toBe(TAX_ID_MESSAGE);
      expect((await criarParceiro({ type: "TAC_AGREGADO", name: "José", taxId: CPF_DO_NOVO, rntrc: "123" })).status).toBe(400);
      expect((await criarParceiro({ name: "José", taxId: CPF_DO_NOVO })).status).toBe(400);
      expect(await banco.sistema.carrier.count({ where: { taxId: CPF_DO_NOVO } })).toBe(0);

      const criado = await criarParceiro({ type: "TAC_AGREGADO", name: nome("José Agregado"), taxId: "993.331.112-39", rntrc: "87654321", state: "SP", phone: "17999990000", bankInfo: "Banco 001 ag 1234 cc 5678-9" });
      expect(criado.status).toBe(201);
      expect(criado.corpo).toMatchObject({ type: "TAC_AGREGADO", name: nome("José Agregado"), taxId: CPF_DO_NOVO, rntrc: "87654321", state: "SP", active: true });
      // A operação cadastrou: a contratação padrão não volta para ela.
      expect(criado.corpo).not.toHaveProperty("defaultCalcMode");
      expect(await trilha(criado.corpo.id)).toMatchObject([{ action: "parceiro.criar", userId: ids.OPERATION, summary: `Parceiro ${nome("José Agregado")} criado` }]);

      // O mesmo documento, com ou sem máscara, não entra duas vezes.
      for (const taxId of [CPF_DO_NOVO, "993.331.112-39"]) {
        expect(await criarParceiro({ type: "TRANSPORTADORA", name: "Outro", taxId })).toMatchObject({ status: 409, corpo: { error: DUPLICATE_CARRIER } });
      }
      expect(await banco.sistema.carrier.count({ where: { taxId: CPF_DO_NOVO } })).toBe(1);
    });

    it("a contratação padrão só entra por quem altera o frete contratado", async () => {
      const corpo = { type: "TRANSPORTADORA", name: nome("Segundo"), taxId: CNPJ_DO_SEGUNDO, defaultCalcMode: "POR_KM", defaultCalcBase: "3,5" };
      for (const perfil of ["OPERATION", "DIRECTOR"] as const) {
        expect(await criarParceiro(corpo, perfil), perfil).toMatchObject({ status: 403, corpo: { error: CONTRATACAO_SO_DE_QUEM_PAGA } });
      }
      expect(await banco.sistema.carrier.count({ where: { taxId: CNPJ_DO_SEGUNDO } })).toBe(0);
      // Os campos em branco do formulário não são "informar a contratação".
      const semPadrao = await criarParceiro({ ...corpo, defaultCalcMode: "", defaultCalcBase: "" });
      expect(semPadrao.status).toBe(201);
      await banco.sistema.carrier.delete({ where: { id: semPadrao.corpo.id } });

      const comoAdmin = await criarParceiro(corpo, "ADMIN");
      expect(comoAdmin.status).toBe(201);
      expect(comoAdmin.corpo).toMatchObject({ defaultCalcMode: "POR_KM", defaultCalcBase: 3.5 });

      // O financeiro grava o padrão pela rota própria; a auditoria guarda o antes e o depois.
      entrarComo("FINANCE");
      expect((await contratacaoRota.PUT(req("PUT", { defaultCalcMode: "PERCENTUAL", defaultCalcBase: "120" }), ctx(comoAdmin.corpo.id))).status).toBe(400);
      entrarComo("FINANCE");
      const trocado = await chamar<ParceiroLido>(contratacaoRota.PUT(req("PUT", { defaultCalcMode: "PERCENTUAL", defaultCalcBase: "65" }), ctx(comoAdmin.corpo.id)));
      expect(trocado).toMatchObject({ status: 200, corpo: { defaultCalcMode: "PERCENTUAL", defaultCalcBase: 65 } });
      const linhas = await trilha(comoAdmin.corpo.id);
      expect(linhas.at(-1)).toMatchObject({ action: "parceiro.contratacao", userId: ids.FINANCE, before: { defaultCalcMode: "POR_KM", defaultCalcBase: 3.5 }, after: { defaultCalcMode: "PERCENTUAL", defaultCalcBase: 65 } });

      entrarComo("FINANCE");
      expect((await contratacaoRota.PUT(req("PUT", { defaultCalcMode: "", defaultCalcBase: "" }), ctx(comoAdmin.corpo.id))).status).toBe(200);
      expect(await banco.sistema.carrier.findUniqueOrThrow({ where: { id: comoAdmin.corpo.id } })).toMatchObject({ defaultCalcMode: null, defaultCalcBase: null });
      entrarComo("FINANCE");
      expect(await chamar(contratacaoRota.PUT(req("PUT", { defaultCalcMode: "FIXO", defaultCalcBase: "1" }), ctx(SEM_ID)))).toMatchObject({ status: 404, corpo: { error: CARRIER_NOT_FOUND } });
    });

    it("altera, desativa e reativa; o documento não muda; o que não existe é 404", async () => {
      entrarComo("OPERATION");
      const alterado = await chamar<ParceiroLido>(parceiroRota.PATCH(req("PATCH", { phone: "17 3333-0000", taxId: CPF_DO_NOVO, notes: "paga na sexta" }), ctx(parceiroId)));
      expect(alterado).toMatchObject({ status: 200, corpo: { phone: "17 3333-0000", notes: "paga na sexta", taxId: CNPJ_DO_PARCEIRO } });
      expect(alterado.corpo).not.toHaveProperty("defaultCalcMode");

      entrarComo("DIRECTOR");
      expect((await parceiroRota.PATCH(req("PATCH", { active: false }), ctx(parceiroId))).status).toBe(200);
      entrarComo("DIRECTOR");
      expect((await parceiroRota.PATCH(req("PATCH", { active: true }), ctx(parceiroId))).status).toBe(200);
      expect((await trilha(parceiroId)).map((l) => l.action)).toEqual(["parceiro.alterar", "parceiro.desativar", "parceiro.reativar"]);
      // A contratação padrão não foi tocada pelo cadastro.
      expect(await banco.sistema.carrier.findUniqueOrThrow({ where: { id: parceiroId } })).toMatchObject({ defaultCalcMode: "PERCENTUAL", defaultCalcBase: 70, active: true });

      entrarComo("OPERATION");
      expect((await parceiroRota.PATCH(req("PATCH", {}), ctx(parceiroId))).status).toBe(400);
      entrarComo("OPERATION");
      expect(await chamar(parceiroRota.PATCH(req("PATCH", { phone: "1" }), ctx(SEM_ID)))).toMatchObject({ status: 404, corpo: { error: CARRIER_NOT_FOUND } });
    });

    it("o veículo e o motorista são ligados ao parceiro pelo cadastro deles, e aparecem na lista do parceiro", async () => {
      entrarComo("OPERATION");
      expect((await veiculoRota.PATCH(req("PATCH", { carrierId: autonomoId }), ctx(veiculoProprioId))).status).toBe(200);
      entrarComo("OPERATION");
      const motorista = await chamar(motoristaRota.PATCH(req("PATCH", { carrierId: autonomoId }), ctx(motoristaId)));
      expect(motorista).toMatchObject({ status: 200, corpo: { carrierId: autonomoId } });

      const autonomo = (await listar("OPERATION")).parceiros.find((p) => p.id === autonomoId);
      expect(autonomo?.vehicles.map((v) => v.plate)).toEqual([PLACA_PROPRIA]);
      expect(autonomo?.drivers.map((d) => d.id)).toEqual([motoristaId]);

      // Parceiro que não existe (ou é de outra empresa) é recusado, e nada muda.
      for (const carrierId of [SEM_ID, daOutra.parceiroId]) {
        entrarComo("OPERATION");
        expect((await veiculoRota.PATCH(req("PATCH", { carrierId }), ctx(veiculoProprioId))).status, carrierId).toBe(400);
        entrarComo("OPERATION");
        expect((await motoristaRota.PATCH(req("PATCH", { carrierId }), ctx(motoristaId))).status, carrierId).toBe(400);
        entrarComo("OPERATION");
        expect((await veiculosRota.POST(req("POST", { plate: "PRC9Z99", model: "x", type: "TRUCK", carrierId }))).status, carrierId).toBe(400);
      }
      expect(await banco.sistema.vehicle.count({ where: { plate: "PRC9Z99" } })).toBe(0);
      expect((await banco.sistema.vehicle.findUniqueOrThrow({ where: { id: veiculoProprioId } })).carrierId).toBe(autonomoId);

      // Em branco desliga.
      entrarComo("OPERATION");
      expect((await veiculoRota.PATCH(req("PATCH", { carrierId: "" }), ctx(veiculoProprioId))).status).toBe(200);
      expect((await banco.sistema.vehicle.findUniqueOrThrow({ where: { id: veiculoProprioId } })).carrierId).toBeNull();
      entrarComo("OPERATION");
      expect((await motoristaRota.PATCH(req("PATCH", { carrierId: null }), ctx(motoristaId))).status).toBe(200);
      expect((await banco.sistema.driver.findUniqueOrThrow({ where: { id: motoristaId } })).carrierId).toBeNull();
    });
  });

  /* ------------------------------ Contrato da viagem --------------------------- */

  describe("contrato de frete da viagem", () => {
    const montar = async (vehicleId: string, fretes: (number | null)[] = [1000, 500]) => {
      const cargas: string[] = [];
      for (const frete of fretes) cargas.push((await banco.default.collection.create({ data: carga({ status: "COLLECTED", frete }) })).id);
      entrarComo("OPERATION");
      return chamar(manifestos.POST(req("POST", { driverId: motoristaId, vehicleId, collectionIds: cargas })));
    };

    it("viagem montada em veículo de parceiro já nasce com o contrato, pela forma padrão dele", async () => {
      const criada = await montar(veiculoDoParceiroId);
      expect(criada.status).toBe(201);
      // A resposta da montagem não leva valor nenhum: quem monta é a operação.
      expect(JSON.stringify(criada.corpo)).not.toMatch(/grossAmount|freightContract|calcBase/);

      const contrato = await contratoDe(criada.corpo.id);
      // 70% de 1.500 de frete das cargas.
      expect(contrato).toMatchObject({ carrierId: parceiroId, calcMode: "PERCENTUAL", calcBase: 70, grossAmount: 1050, status: "ABERTO", tollAmount: 0, inss: 0, irrf: 0, sestSenat: 0, otherWithholdings: 0 });
      expect(contrato?.payments).toEqual([]);
      expect(await trilha(contrato?.id ?? "")).toMatchObject([{ action: "frete-contratado.criar", userId: ids.OPERATION }]);
      expect(await lancamentos()).toEqual([]);

      const lido = await lerFrete(criada.corpo.id);
      expect(lido.corpo.parceiroDoVeiculo).toEqual({ id: parceiroId, name: nome("Transportes Parceiros") });
      expect(lido.corpo.viagem).toMatchObject({ status: "ASSEMBLING", freteDasCargas: 1500, km: null, entregas: 2 });
      expect(lido.corpo.contrato).toMatchObject({ sugerido: 1050, pago: 0, saldo: 1050, valores: { bruto: 1050, liquido: 1050, custo: 1050, retencoes: 0 } });
    });

    it("veículo próprio não gera contrato, nem veículo de parceiro desativado ou sem contratação padrão com valor", async () => {
      const propria = await montar(veiculoProprioId);
      expect(await contratoDe(propria.corpo.id)).toBeNull();
      expect((await lerFrete(propria.corpo.id)).corpo).toMatchObject({ parceiroDoVeiculo: null, contrato: null });

      await banco.sistema.carrier.update({ where: { id: parceiroId }, data: { active: false } });
      const doDesativado = await montar(veiculoDoParceiroId);
      expect(doDesativado.status).toBe(201);
      expect(await contratoDe(doDesativado.corpo.id)).toBeNull();

      // Parceiro sem padrão: o contrato nasce fixo, com bruto zero, para quem paga preencher.
      await banco.sistema.vehicle.update({ where: { id: veiculoProprioId }, data: { carrierId: autonomoId } });
      const doAutonomo = await montar(veiculoProprioId);
      expect(await contratoDe(doAutonomo.corpo.id)).toMatchObject({ carrierId: autonomoId, calcMode: "FIXO", calcBase: null, grossAmount: 0, status: "ABERTO" });
    });

    it("trocar o veículo da viagem em montagem por um de parceiro cria o contrato; contrato que já existe não é mexido", async () => {
      const criada = await montar(veiculoProprioId);
      entrarComo("OPERATION");
      expect((await manifestoRota.PATCH(req("PATCH", { vehicleId: veiculoDoParceiroId }), ctx(criada.corpo.id))).status).toBe(200);
      const contrato = await contratoDe(criada.corpo.id);
      expect(contrato).toMatchObject({ carrierId: parceiroId, grossAmount: 1050, status: "ABERTO" });

      // De volta ao veículo próprio: o contrato fica, para alguém decidir.
      entrarComo("OPERATION");
      expect((await manifestoRota.PATCH(req("PATCH", { vehicleId: veiculoProprioId }), ctx(criada.corpo.id))).status).toBe(200);
      entrarComo("OPERATION");
      expect((await manifestoRota.PATCH(req("PATCH", { vehicleId: veiculoDoParceiroId }), ctx(criada.corpo.id))).status).toBe(200);
      expect(await banco.sistema.freightContract.count({ where: { manifestId: criada.corpo.id } })).toBe(1);
      expect((await contratoDe(criada.corpo.id))?.id).toBe(contrato?.id);
    });

    it("o contrato é escolhido à mão em viagem de veículo próprio, com valores, retenções digitadas e o valor sugerido ao lado", async () => {
      const viagemId = await viajar("ROUTE", [{ frete: 1000 }, { frete: 500 }, { frete: null }], { departureOdometer: 1000, returnOdometer: 1400 });

      const criado = await gravarContrato(viagemId, { carrierId: autonomoId, calcMode: "POR_KM", calcBase: "2,5", notes: "combinado por telefone" });
      expect(criado.status).toBe(201);
      expect(criado.corpo).toMatchObject({
        status: "ABERTO",
        carrierId: autonomoId,
        calcMode: "POR_KM",
        calcBase: 2.5,
        grossAmount: 1000,
        // 400 km × 2,50: a tela mostra a sugestão; o que vale é o bruto gravado.
        sugerido: 1000,
        valores: { bruto: 1000, acrescimos: 100, descontos: 50, retencoes: 100, liquido: 950, custo: 1050 },
        pago: 0,
        saldo: 950,
        notes: "combinado por telefone",
      });
      expect(await contratoDe(viagemId)).toMatchObject({ inss: 80, irrf: 0, sestSenat: 20, otherWithholdings: 0, tollAmount: 100, discounts: 50 });

      // Gravar de novo altera (200), e a sugestão acompanha a forma: por entrega, 3 cargas × 200.
      const alterado = await gravarContrato(viagemId, { carrierId: autonomoId, calcMode: "POR_ENTREGA", calcBase: "200", grossAmount: "600", inss: "0", sestSenat: "0" });
      expect(alterado).toMatchObject({ status: 200, corpo: { calcMode: "POR_ENTREGA", sugerido: 600, valores: { bruto: 600, retencoes: 0, liquido: 650 } } });
      const acoes = (await trilha(criado.corpo.id)).map((l) => [l.action, l.userId]);
      expect(acoes).toEqual([
        ["frete-contratado.criar", ids.ADMIN],
        ["frete-contratado.alterar", ids.ADMIN],
      ]);

      // A leitura traz os parceiros que podem ser escolhidos, com a contratação padrão de cada um.
      const lido = await lerFrete(viagemId, "FINANCE");
      expect(lido.corpo.viagem).toEqual({ id: viagemId, status: "ROUTE", freteDasCargas: 1500, km: 400, entregas: 3 });
      expect(lido.corpo.parceiros.find((p) => p.id === parceiroId)).toMatchObject({ defaultCalcMode: "PERCENTUAL" });
      expect(lido.corpo.parceiros.map((p) => p.id)).not.toContain(daOutra.parceiroId);
    });

    it("recusa contrato inválido, parceiro que não serve, viagem cancelada e viagem que não existe", async () => {
      const viagemId = await viajar("ROUTE");
      expect((await gravarContrato(viagemId, { carrierId: "" })).status).toBe(400);
      expect((await gravarContrato(viagemId, { grossAmount: "abc" })).status).toBe(400);
      expect((await gravarContrato(viagemId, { grossAmount: "100", inss: "200" })).corpo.error).toBe(LIQUIDO_NEGATIVO);
      expect((await gravarContrato(viagemId, { calcMode: "PERCENTUAL", calcBase: "150" })).corpo.error).toBe(PERCENTUAL_MESSAGE);

      await banco.sistema.carrier.update({ where: { id: autonomoId }, data: { active: false } });
      for (const carrierId of [SEM_ID, daOutra.parceiroId, autonomoId]) {
        expect(await gravarContrato(viagemId, { carrierId }), carrierId).toMatchObject({ status: 400, corpo: { error: CARRIER_NOT_FOUND_OR_INACTIVE } });
      }
      expect(await contratoDe(viagemId)).toBeNull();

      const cancelada = await viajar("CANCELLED");
      expect(await gravarContrato(cancelada)).toMatchObject({ status: 409, corpo: { error: TRIP_CANCELLED_NO_CONTRACT } });
      expect((await gravarContrato(SEM_ID)).status).toBe(404);
      expect((await lerFrete(SEM_ID)).status).toBe(404);
    });

    it("parceiro desativado depois continua valendo no contrato que já era dele", async () => {
      const viagemId = await viajar("ROUTE");
      expect((await gravarContrato(viagemId, { carrierId: autonomoId })).status).toBe(201);
      await banco.sistema.carrier.update({ where: { id: autonomoId }, data: { active: false } });
      expect((await gravarContrato(viagemId, { carrierId: autonomoId, grossAmount: "1200" })).status).toBe(200);
      expect((await lerFrete(viagemId)).corpo.parceiros.map((p) => p.id)).toContain(autonomoId);
    });
  });

  /* --------------------------------- Pagamentos -------------------------------- */

  describe("pagamentos do contrato", () => {
    it("o adiantamento lança a despesa a pagar no Financeiro e o contrato fica adiantado, com o saldo", async () => {
      const viagemId = await viajar("ROUTE");
      const contrato = (await gravarContrato(viagemId)).corpo;

      const pago = await pagar(viagemId, { amount: "300,50", notes: "Pix da saída" }, "FINANCE");
      expect(pago.status).toBe(201);
      expect(pago.corpo.pagamento).toMatchObject({ kind: "ADIANTAMENTO", amount: 300.5, method: "PIX", transaction: { status: "PENDING" } });
      expect(pago.corpo.contrato).toMatchObject({ status: "ADIANTADO", pago: 300.5, adiantado: 300.5, saldo: 649.5 });

      const [lancamento] = await lancamentos();
      expect(lancamento).toMatchObject({
        id: pago.corpo.pagamento.transactionId,
        type: "EXPENSE",
        amount: 300.5,
        status: "PENDING",
        paidAt: null,
        paymentMethod: null,
        category: "Frete contratado",
        counterparty: nome("Transportes Parceiros"),
        costCenter: `Viagem #${codigoDaViagem(viagemId)}`,
        description: `Adiantamento de frete: viagem #${codigoDaViagem(viagemId)} (${nome("Transportes Parceiros")})`,
        notes: "Pix da saída",
      });
      expect(lancamento.dueDate).toEqual(dia("2012-05-10"));
      expect(await lancamentos()).toHaveLength(1);
      expect(await contratoDe(viagemId)).toMatchObject({ status: "ADIANTADO", payments: [{ amount: 300.5, kind: "ADIANTAMENTO", transactionId: lancamento.id }] });

      const linhas = await trilha(contrato.id);
      expect(linhas.at(-1)).toMatchObject({ action: "frete-contratado.pagar", userId: ids.FINANCE, before: { status: "ABERTO" }, after: { status: "ADIANTADO", amount: 300.5 } });
      expect(linhas.at(-1)?.summary).toContain("lançamento a pagar no Financeiro");
    });

    it("com `paid`, o lançamento já nasce pago, no dia do pagamento e com a forma informada", async () => {
      const viagemId = await viajar("ROUTE");
      await gravarContrato(viagemId);
      const pago = await pagar(viagemId, { paid: true, method: "TRANSFERENCIA", date: "2012-05-31" });
      expect(pago.corpo.pagamento.transaction).toEqual({ id: pago.corpo.pagamento.transactionId, status: "PAID" });
      const [lancamento] = await lancamentos();
      expect(lancamento).toMatchObject({ status: "PAID", paymentMethod: "TRANSFERENCIA", amount: 300 });
      // Meio-dia do Brasil do dia informado: cai em maio no fluxo de caixa, não em junho.
      expect(lancamento.paidAt).toEqual(em("2012-05-31"));
    });

    it("recusa pagamento inválido, sem contrato, com contrato cancelado e em viagem que não existe; nada é lançado", async () => {
      const semContrato = await viajar("ROUTE");
      expect(await pagar(semContrato)).toMatchObject({ status: 404, corpo: { error: CONTRACT_NOT_FOUND } });

      const viagemId = await viajar("ROUTE");
      await gravarContrato(viagemId);
      for (const corpo of [{ amount: "0" }, { amount: "" }, { kind: "GORJETA" }, { date: "ontem" }, { method: "BOLETO" }]) {
        expect((await pagar(viagemId, corpo)).status, JSON.stringify(corpo)).toBe(400);
      }
      entrarComo("ADMIN");
      expect((await freteRota.DELETE(req("DELETE"), ctx(viagemId))).status).toBe(200);
      expect(await pagar(viagemId)).toMatchObject({ status: 409, corpo: { error: CONTRACT_CANCELLED } });
      expect((await pagar(SEM_ID)).status).toBe(404);
      expect(await lancamentos()).toEqual([]);
      expect(await banco.sistema.freightPayment.count({ where: { contract: { manifestId: { in: [viagemId, semContrato] } } } })).toBe(0);
    });

    it("pagar mais que o líquido só com confirmação explícita; sem ela nada é gravado", async () => {
      const viagemId = await viajar("FINISHED", [{ status: "DELIVERED" }], { finishedAt: em("2012-05-09") });
      await gravarContrato(viagemId);
      await pagar(viagemId, { amount: "900" });

      const recusado = await pagar(viagemId, { kind: "SALDO", amount: "100" });
      expect(recusado.status).toBe(409);
      expect(recusado.corpo.confirmar).toBe("pagarAcima");
      expect(recusado.corpo.error).toMatch(/passa do valor líquido do contrato em R\$\s50,00/);
      expect(await lancamentos()).toHaveLength(1);
      expect((await contratoDe(viagemId))?.payments).toHaveLength(1);

      const confirmado = await pagar(viagemId, { kind: "SALDO", amount: "100", pagarAcima: true });
      expect(confirmado.status).toBe(201);
      expect(confirmado.corpo.contrato).toMatchObject({ status: "QUITADO", pago: 1000, adiantado: 900, saldo: -50 });
      expect(await lancamentos()).toHaveLength(2);
      // Pago a mais não vira "em aberto" negativo na lista do parceiro.
      expect((await listar()).parceiros.find((p) => p.id === parceiroId)?.emAberto).toBe(0);
    });

    it("quitar exige a viagem finalizada, ou a confirmação de pagar antes de finalizar", async () => {
      const viagemId = await viajar("ROUTE");
      await gravarContrato(viagemId);
      await pagar(viagemId, { amount: "300" });

      const recusado = await pagar(viagemId, { kind: "SALDO", amount: "650" });
      expect(recusado).toMatchObject({ status: 409, corpo: { error: QUITA_ANTES_DE_FINALIZAR, confirmar: "pagarAntesDeFinalizar" } });
      // A confirmação errada não serve.
      expect((await pagar(viagemId, { kind: "SALDO", amount: "650", pagarAcima: true })).corpo.confirmar).toBe("pagarAntesDeFinalizar");
      expect((await contratoDe(viagemId))?.status).toBe("ADIANTADO");
      expect(await lancamentos()).toHaveLength(1);

      const confirmado = await pagar(viagemId, { kind: "SALDO", amount: "650", pagarAntesDeFinalizar: true });
      expect(confirmado.status).toBe(201);
      expect(confirmado.corpo.contrato).toMatchObject({ status: "QUITADO", pago: 950, adiantado: 300, saldo: 0 });

      // Com a viagem finalizada, o saldo entra direto.
      const finalizada = await viajar("FINISHED", [{ status: "DELIVERED" }], { finishedAt: em("2012-05-09") });
      await gravarContrato(finalizada);
      const direto = await pagar(finalizada, { kind: "SALDO", amount: "950" });
      expect(direto.status).toBe(201);
      expect(direto.corpo.contrato.status).toBe("QUITADO");
    });

    it("excluir o pagamento desfaz o lançamento em aberto; com o lançamento já pago, recusa e os dois ficam", async () => {
      const viagemId = await viajar("ROUTE");
      const contrato = (await gravarContrato(viagemId)).corpo;
      const primeiro = (await pagar(viagemId, { amount: "300" })).corpo.pagamento;
      const segundo = (await pagar(viagemId, { amount: "200" })).corpo.pagamento;
      expect(await lancamentos()).toHaveLength(2);

      // O financeiro baixa o lançamento do segundo: o pagamento não sai mais em silêncio.
      entrarComo("FINANCE");
      expect((await lancamentoRota.PATCH(req("PATCH", { action: "pagar", paymentMethod: "PIX" }), ctx(segundo.transactionId as string))).status).toBe(200);
      expect(await estornar(viagemId, segundo.id)).toMatchObject({ status: 409, corpo: { error: PAYMENT_ALREADY_PAID } });
      expect(await lancamentos()).toHaveLength(2);
      expect((await contratoDe(viagemId))?.payments).toHaveLength(2);

      // O primeiro ainda está em aberto: sai com o lançamento, na mesma transação.
      const estornado = await estornar(viagemId, primeiro.id, "FINANCE");
      expect(estornado).toMatchObject({ status: 200, corpo: { status: "ADIANTADO", pago: 200, saldo: 750 } });
      expect((await lancamentos()).map((l) => l.id)).toEqual([segundo.transactionId]);
      expect(await banco.sistema.freightPayment.count({ where: { id: primeiro.id } })).toBe(0);
      expect((await trilha(contrato.id)).at(-1)).toMatchObject({ action: "frete-contratado.estornar", userId: ids.FINANCE, before: { amount: 300, kind: "ADIANTAMENTO" } });

      // Reaberto no Financeiro, o segundo também pode ser excluído, e o contrato volta a ficar em aberto.
      entrarComo("FINANCE");
      expect((await lancamentoRota.PATCH(req("PATCH", { action: "reabrir" }), ctx(segundo.transactionId as string))).status).toBe(200);
      expect(await estornar(viagemId, segundo.id)).toMatchObject({ status: 200, corpo: { status: "ABERTO", pago: 0, saldo: 950 } });
      expect(await lancamentos()).toEqual([]);

      expect(await estornar(viagemId, segundo.id)).toMatchObject({ status: 404, corpo: { error: PAYMENT_NOT_FOUND } });
    });

    it("pagamento de outra viagem não é alcançado pelo endereço desta; lançamento apagado no Financeiro não trava a exclusão", async () => {
      const umaViagem = await viajar("ROUTE");
      const outraViagem = await viajar("ROUTE");
      await gravarContrato(umaViagem);
      await gravarContrato(outraViagem);
      const pagamento = (await pagar(umaViagem)).corpo.pagamento;

      expect((await estornar(outraViagem, pagamento.id)).status).toBe(404);
      expect((await estornar(SEM_ID, pagamento.id)).status).toBe(404);
      expect(await lancamentos()).toHaveLength(1);

      // Alguém apagou o lançamento direto no Financeiro: o pagamento fica sem lançamento e ainda pode ser excluído.
      entrarComo("FINANCE");
      expect((await lancamentoRota.DELETE(req("DELETE"), ctx(pagamento.transactionId as string))).status).toBe(200);
      expect((await lerFrete(umaViagem)).corpo.contrato?.payments).toMatchObject([{ id: pagamento.id, transactionId: null, transaction: null }]);
      expect((await estornar(umaViagem, pagamento.id)).status).toBe(200);
      expect((await contratoDe(umaViagem))?.payments).toEqual([]);
    });
  });

  /* ----------------------------------- Estados --------------------------------- */

  describe("estados do contrato e da viagem", () => {
    it("com pagamento registrado: o parceiro não troca, o líquido não cai abaixo do pago e a alteração não quita antes de finalizar", async () => {
      const viagemId = await viajar("ROUTE");
      await gravarContrato(viagemId);
      await pagar(viagemId, { amount: "300" });

      expect(await gravarContrato(viagemId, { carrierId: autonomoId })).toMatchObject({ status: 409, corpo: { error: CARRIER_LOCKED_BY_PAYMENTS } });
      expect(await gravarContrato(viagemId, { grossAmount: "200" })).toMatchObject({ status: 409, corpo: { error: LIQUIDO_MENOR_QUE_O_PAGO } });
      // Bruto 350 + 100 − 50 − 100 = 300: igual ao pago, quitaria com a viagem em rota.
      expect(await gravarContrato(viagemId, { grossAmount: "350" })).toMatchObject({ status: 409, corpo: { error: QUITARIA_ANTES_DE_FINALIZAR } });
      expect(await contratoDe(viagemId)).toMatchObject({ carrierId: parceiroId, grossAmount: 1000, status: "ADIANTADO" });

      // Aumentar o contrato continua valendo, e a situação acompanha.
      expect(await gravarContrato(viagemId, { grossAmount: "2000" })).toMatchObject({ status: 200, corpo: { status: "ADIANTADO", saldo: 1650 } });

      // Com a viagem finalizada, reduzir até o pago quita.
      await banco.sistema.manifest.update({ where: { id: viagemId }, data: { status: "FINISHED", finishedAt: em("2012-05-12") } });
      expect(await gravarContrato(viagemId, { grossAmount: "350" })).toMatchObject({ status: 200, corpo: { status: "QUITADO", saldo: 0 } });
    });

    it("cancelar o contrato: só sem pagamento; cancelado sai do custo, não recebe pagamento e reabre ao ser gravado de novo", async () => {
      const viagemId = await viajar("ROUTE");
      const contrato = (await gravarContrato(viagemId)).corpo;
      const pagamento = (await pagar(viagemId)).corpo.pagamento;

      entrarComo("ADMIN");
      expect(await chamar(freteRota.DELETE(req("DELETE"), ctx(viagemId)))).toMatchObject({ status: 409, corpo: { error: CONTRACT_HAS_PAYMENTS } });
      expect((await contratoDe(viagemId))?.status).toBe("ADIANTADO");

      await estornar(viagemId, pagamento.id);
      entrarComo("FINANCE");
      expect(await chamar(freteRota.DELETE(req("DELETE"), ctx(viagemId)))).toMatchObject({ status: 200, corpo: { status: "CANCELADO" } });
      // Cancelar de novo não muda nada nem registra outra linha.
      entrarComo("FINANCE");
      expect((await freteRota.DELETE(req("DELETE"), ctx(viagemId))).status).toBe(200);
      expect((await trilha(contrato.id)).filter((l) => l.action === "frete-contratado.cancelar")).toHaveLength(1);
      expect(custoParaAViagem(await contratoDe(viagemId))).toBe(0);

      expect((await gravarContrato(viagemId, { grossAmount: "1500" })).corpo).toMatchObject({ status: "ABERTO", grossAmount: 1500 });

      entrarComo("ADMIN");
      expect(await chamar(freteRota.DELETE(req("DELETE"), ctx(await viajar("ROUTE"))))).toMatchObject({ status: 404, corpo: { error: CONTRACT_NOT_FOUND } });
    });

    it("cancelar a viagem cancela junto o contrato sem pagamento", async () => {
      const viagemId = await viajar("ASSEMBLING", [{ status: "COLLECTED" }]);
      const contrato = (await gravarContrato(viagemId)).corpo;

      entrarComo("OPERATION");
      expect((await cancelarRota.POST(req("POST"), ctx(viagemId))).status).toBe(200);
      expect((await banco.sistema.manifest.findUniqueOrThrow({ where: { id: viagemId } })).status).toBe("CANCELLED");
      expect((await contratoDe(viagemId))?.status).toBe("CANCELADO");
      expect((await trilha(contrato.id)).at(-1)).toMatchObject({ action: "frete-contratado.cancelar", userId: ids.OPERATION });

      // Viagem cancelada não recebe contrato nem pagamento.
      expect((await gravarContrato(viagemId)).corpo.error).toBe(TRIP_CANCELLED_NO_CONTRACT);
      expect((await pagar(viagemId)).corpo.error).toBe(TRIP_CANCELLED_NO_CONTRACT);
    });

    it("viagem com contrato pago não é cancelada em silêncio: a recusa avisa, e nada muda", async () => {
      const viagemId = await viajar("ASSEMBLING", [{ status: "COLLECTED" }]);
      await gravarContrato(viagemId);
      const pagamento = (await pagar(viagemId)).corpo.pagamento;

      entrarComo("OPERATION");
      expect(await chamar(cancelarRota.POST(req("POST"), ctx(viagemId)))).toMatchObject({ status: 409, corpo: { error: TRIP_HAS_PAID_CONTRACT } });
      expect((await banco.sistema.manifest.findUniqueOrThrow({ where: { id: viagemId } })).status).toBe("ASSEMBLING");
      expect(await banco.sistema.collection.count({ where: { manifestId: viagemId } })).toBe(1);
      expect((await contratoDe(viagemId))?.status).toBe("ADIANTADO");
      expect(await lancamentos()).toHaveLength(1);

      // Excluído o pagamento, a viagem cancela, com o contrato.
      await estornar(viagemId, pagamento.id);
      entrarComo("OPERATION");
      expect((await cancelarRota.POST(req("POST"), ctx(viagemId))).status).toBe(200);
      expect((await contratoDe(viagemId))?.status).toBe("CANCELADO");
    });
  });

  /* ----------------------------- Acerto e resultado ---------------------------- */

  describe("acerto e resultado da viagem", () => {
    const lerAcerto = async (viagemId: string) => {
      entrarComo("ADMIN");
      return ((await (await acertoRota.GET(req(), ctx(viagemId))).json()) as { acerto: AcertoDaViagem }).acerto;
    };

    it("o frete contratado entra no custo uma vez só: os pagamentos lançados no Financeiro não dobram a conta", async () => {
      const viagemId = await viajar("FINISHED", [{ status: "DELIVERED", frete: 3000 }], { departedAt: em("2012-05-02"), finishedAt: em("2012-05-04") });
      await banco.default.tripExpense.create({ data: { manifestId: viagemId, type: "TOLL", amount: 100, date: dia("2012-05-03"), status: "APPROVED" } });
      expect(await lerAcerto(viagemId)).toMatchObject({ frete: 3000, despesas: 100, freteContratado: 0, custoTotal: 100, resultado: 2900 });

      // Custo do contrato: 1000 + 100 − 50 = 1050 (as retenções não saem do custo).
      await gravarContrato(viagemId);
      const comContrato = await lerAcerto(viagemId);
      expect(comContrato).toMatchObject({ frete: 3000, despesas: 100, freteContratado: 1050, custoTotal: 1150, resultado: 1850 });

      // Dois pagamentos, um deles já pago: duas despesas a mais no Financeiro, e o acerto não se mexe.
      await pagar(viagemId, { amount: "300" });
      await pagar(viagemId, { kind: "SALDO", amount: "650", paid: true });
      expect(await lancamentos()).toHaveLength(2);
      expect(await lerAcerto(viagemId)).toEqual(comContrato);

      // O "Resultado por viagem" dos relatórios usa a mesma conta.
      entrarComo("ADMIN");
      const relatorio = (await (await relatorios.GET(req("GET", undefined, "?de=2012-05&ate=2012-05"))).json()) as { resultado: Resultado };
      expect(relatorio.resultado.viagens.find((v) => v.id === viagemId)).toMatchObject({ frete: 3000, custo: 1150, resultado: 1850 });
      expect(relatorio.resultado.viagens.map((v) => v.id)).not.toContain(daOutra.viagemId);
    });

    it("contrato cancelado não pesa no acerto", async () => {
      const viagemId = await viajar("FINISHED", [{ status: "DELIVERED", frete: 3000 }], { departedAt: em("2012-05-02"), finishedAt: em("2012-05-04") });
      await gravarContrato(viagemId);
      entrarComo("ADMIN");
      expect((await freteRota.DELETE(req("DELETE"), ctx(viagemId))).status).toBe(200);
      expect(await lerAcerto(viagemId)).toMatchObject({ freteContratado: 0, custoTotal: 0, resultado: 3000 });
    });
  });

  /* ------------------------------ Recibo e fechamento -------------------------- */

  describe("recibo e fechamento", () => {
    it("o recibo traz empresa, parceiro, viagem, valores, pagamentos e saldo; sem contrato é 404", async () => {
      const viagemId = await viajar(
        "FINISHED",
        [
          { status: "DELIVERED", origem: "Rio Preto - SP", destino: "Mirassol - SP" },
          { status: "DELIVERED", origem: "Rio Preto - SP", destino: "Bady Bassitt - SP" },
        ],
        { departedAt: em("2012-05-02"), finishedAt: em("2012-05-04") },
      );
      entrarComo("ADMIN");
      expect(await chamar(reciboRota.GET(req(), ctx(viagemId)))).toMatchObject({ status: 404, corpo: { error: CONTRACT_NOT_FOUND } });

      await gravarContrato(viagemId);
      await pagar(viagemId, { amount: "300", date: "2012-05-02" });
      await pagar(viagemId, { kind: "SALDO", amount: "650", method: "TRANSFERENCIA", date: "2012-05-05" });

      entrarComo("DIRECTOR");
      const { status, corpo } = await chamar<ReciboDeFrete>(reciboRota.GET(req(), ctx(viagemId)));
      expect(status).toBe(200);
      expect(corpo.parceiro).toEqual({ nome: nome("Transportes Parceiros"), documento: CNPJ_DO_PARCEIRO, rntrc: "12345678", tipo: "TRANSPORTADORA" });
      expect(corpo.viagem).toMatchObject({
        codigo: codigoDaViagem(viagemId),
        situacao: "FINISHED",
        placa: PLACA_PROPRIA,
        motorista: nome("DRIVER"),
        origens: ["Rio Preto - SP"],
        destinos: ["Mirassol - SP", "Bady Bassitt - SP"],
      });
      expect(corpo.valores).toEqual({ bruto: 1000, acrescimos: 100, descontos: 50, retencoes: 100, liquido: 950, custo: 1050 });
      expect(corpo.contrato).toMatchObject({ situacao: "QUITADO", forma: "FIXO", inss: 80, sestSenat: 20, irrf: 0 });
      expect(corpo.pagamentos.map((p) => [p.kind, p.amount, p.method])).toEqual([
        ["ADIANTAMENTO", 300, "PIX"],
        ["SALDO", 650, "TRANSFERENCIA"],
      ]);
      expect(corpo).toMatchObject({ pago: 950, saldo: 0 });
      expect(corpo.empresa.name).toBeTruthy();
      // O recibo não inventa número de RPA nem de CIOT.
      expect([...Object.keys(corpo), ...Object.keys(corpo.contrato), ...Object.keys(corpo.parceiro), ...Object.keys(corpo.viagem)].join(" ")).not.toMatch(/rpa|ciot/i);
      expect(AVISO_DO_RECIBO).toBe("Recibo de pagamento de frete. Não é documento fiscal e não substitui o RPA, o CIOT nem o comprovante de pagamento eletrônico de frete.");
    });

    it("o fechamento do parceiro lista as viagens do período pela saída, com o total, e exporta em CSV", async () => {
      const emMaio = await viajar("FINISHED", [{ status: "DELIVERED" }], { departedAt: em("2012-05-10"), finishedAt: em("2012-05-12") });
      const emJunho = await viajar("FINISHED", [{ status: "DELIVERED" }], { departedAt: em("2012-06-03"), finishedAt: em("2012-06-04") });
      const cancelado = await viajar("ROUTE", [{}], { departedAt: em("2012-05-20") });
      const doAutonomo = await viajar("ROUTE", [{}], { departedAt: em("2012-05-21") });
      await gravarContrato(emMaio);
      await pagar(emMaio, { amount: "400" });
      await gravarContrato(emJunho, { grossAmount: "2000" });
      await gravarContrato(cancelado);
      entrarComo("ADMIN");
      await freteRota.DELETE(req("DELETE"), ctx(cancelado));
      await gravarContrato(doAutonomo, { carrierId: autonomoId });

      type Resposta = { periodo: { de: string; ate: string }; parceiro: { name: string }; linhas: { manifestId: string; pago: number; saldo: number }[]; total: Record<string, number>; error?: string };
      const fechar = (query: string, perfil: Perfil = "FINANCE", id = parceiroId) => {
        entrarComo(perfil);
        return chamar<Resposta>(fechamentoRota.GET(req("GET", undefined, query), ctx(id)));
      };

      const maio = await fechar("?de=2012-05&ate=2012-05");
      expect(maio.status).toBe(200);
      expect(maio.corpo.parceiro.name).toBe(nome("Transportes Parceiros"));
      expect(maio.corpo.linhas).toMatchObject([{ manifestId: emMaio, pago: 400, saldo: 550 }]);
      expect(maio.corpo.total).toEqual({ viagens: 1, bruto: 1000, acrescimos: 100, descontos: 50, retencoes: 100, liquido: 950, pago: 400, saldo: 550 });

      const doisMeses = await fechar("?de=2012-05&ate=2012-06", "DIRECTOR");
      expect(doisMeses.corpo.linhas.map((l) => l.manifestId)).toEqual([emMaio, emJunho]);
      expect(doisMeses.corpo.total).toMatchObject({ viagens: 2, bruto: 3000, liquido: 2900, pago: 400, saldo: 2500 });
      expect((await fechar("?de=2012-07&ate=2012-07")).corpo.linhas).toEqual([]);

      entrarComo("FINANCE");
      const csv = await fechamentoRota.GET(req("GET", undefined, "?de=2012-05&ate=2012-06&formato=csv"), ctx(parceiroId));
      expect(csv.status).toBe(200);
      expect(csv.headers.get("content-type")).toBe("text/csv; charset=utf-8");
      expect(csv.headers.get("content-disposition")).toBe(`attachment; filename="fechamento-${CNPJ_DO_PARCEIRO}-2012-05-a-2012-06.csv"`);
      const linhas = (await csv.text()).trimEnd().split("\r\n");
      expect(linhas).toHaveLength(4);
      expect(linhas[1]).toContain(`"#${codigoDaViagem(emMaio)}";"10/05/2012";"${PLACA_PROPRIA}"`);
      expect(linhas[3]).toMatch(/^"Total";"";"";"";"2 viagem\(ns\)";3000,00;200,00;100,00;200,00;2900,00;400,00;2500,00$/);

      expect((await fechar("?de=2012-06&ate=2012-05")).status).toBe(400);
      expect((await fechar("?de=maio")).status).toBe(400);
      expect(await fechar("?de=2012-05&ate=2012-05", "FINANCE", SEM_ID)).toMatchObject({ status: 404, corpo: { error: CARRIER_NOT_FOUND } });
    });
  });

  /* --------------------------------- Isolamento -------------------------------- */

  describe("isolamento entre empresas", () => {
    it("parceiro, contrato, pagamento, recibo e fechamento da outra empresa não existem para esta", async () => {
      const { parceiros } = await listar("ADMIN");
      expect(parceiros.map((p) => p.id)).not.toContain(daOutra.parceiroId);
      expect(JSON.stringify(parceiros)).not.toMatch(/da outra/);

      entrarComo("ADMIN");
      expect((await parceiroRota.PATCH(req("PATCH", { name: "Invadido" }), ctx(daOutra.parceiroId))).status).toBe(404);
      entrarComo("ADMIN");
      expect((await contratacaoRota.PUT(req("PUT", { defaultCalcMode: "FIXO", defaultCalcBase: "1" }), ctx(daOutra.parceiroId))).status).toBe(404);
      entrarComo("ADMIN");
      expect((await fechamentoRota.GET(req("GET", undefined, "?de=2012-05&ate=2012-05"), ctx(daOutra.parceiroId))).status).toBe(404);

      expect((await lerFrete(daOutra.viagemId)).status).toBe(404);
      expect((await gravarContrato(daOutra.viagemId)).status).toBe(404);
      expect((await pagar(daOutra.viagemId)).status).toBe(404);
      expect((await estornar(daOutra.viagemId, daOutra.pagamentoId)).status).toBe(404);
      entrarComo("ADMIN");
      expect((await freteRota.DELETE(req("DELETE"), ctx(daOutra.viagemId))).status).toBe(404);
      entrarComo("ADMIN");
      expect((await reciboRota.GET(req(), ctx(daOutra.viagemId))).status).toBe(404);

      // O pagamento da outra empresa também não sai pelo endereço de uma viagem desta.
      const viagemId = await viajar("ROUTE");
      await gravarContrato(viagemId);
      expect((await estornar(viagemId, daOutra.pagamentoId)).status).toBe(404);

      // Nada da outra empresa mudou.
      const { sistema } = banco;
      expect(await sistema.carrier.findUniqueOrThrow({ where: { id: daOutra.parceiroId } })).toMatchObject({ name: nome("parceiro da outra"), defaultCalcMode: "FIXO", defaultCalcBase: 7777 });
      expect(await sistema.freightContract.findUniqueOrThrow({ where: { manifestId: daOutra.viagemId } })).toMatchObject({ status: "ADIANTADO", grossAmount: 7777 });
      expect(await sistema.freightPayment.count({ where: { id: daOutra.pagamentoId } })).toBe(1);
      expect(await sistema.financialTransaction.count({ where: { tenantId: EMPRESA_OUTRA.id, counterparty: nome("parceiro da outra") } })).toBe(1);
    });

    it("o mesmo CPF ou CNPJ pode ser parceiro nas duas empresas", async () => {
      const criado = await criarParceiro({ type: "TAC_AGREGADO", name: nome("mesmo documento"), taxId: CNPJ_DO_PARCEIRO_DA_OUTRA });
      expect(criado.status).toBe(201);
      await banco.sistema.carrier.delete({ where: { id: criado.corpo.id } });
    });

    it("o banco recusa veículo, motorista, contrato e pagamento apontando para registro de outra empresa", async () => {
      const db = banco.default;
      await expect(db.vehicle.update({ where: { id: veiculoProprioId }, data: { carrierId: daOutra.parceiroId } })).rejects.toThrow();
      await expect(db.driver.update({ where: { id: motoristaId }, data: { carrierId: daOutra.parceiroId } })).rejects.toThrow();

      const viagemId = await viajar("ROUTE");
      await expect(db.freightContract.create({ data: { manifestId: viagemId, carrierId: daOutra.parceiroId, calcMode: "FIXO" } })).rejects.toThrow();
      await expect(db.freightContract.create({ data: { manifestId: daOutra.viagemId, carrierId: parceiroId, calcMode: "FIXO" } })).rejects.toThrow();

      const daOutraEmpresa = await banco.sistema.freightContract.findUniqueOrThrow({ where: { manifestId: daOutra.viagemId } });
      await expect(db.freightPayment.create({ data: { contractId: daOutraEmpresa.id, kind: "SALDO", date: dia("2012-05-03"), amount: 1, method: "PIX" } })).rejects.toThrow();
      expect(await banco.sistema.freightPayment.count({ where: { contractId: daOutraEmpresa.id } })).toBe(1);
      expect(await contratoDe(viagemId)).toBeNull();
    });
  });
});
