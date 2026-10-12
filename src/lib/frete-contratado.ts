import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { diaDoVencimento, diaNoBrasil } from "@/lib/financeiro";
import { celulaDeTexto } from "@/lib/portal-cliente";
import { codigoDaViagem } from "@/lib/viagem";

/**
 * Frete contratado: o que a empresa paga ao parceiro (agregado, autônomo ou
 * transportadora) por uma viagem feita no veículo dele. Um contrato por viagem,
 * com os pagamentos (adiantamento e saldo). Regras e contas comuns às rotas e
 * às telas; este arquivo não toca no banco.
 *
 * As contas do contrato:
 * - **Bruto**: o valor do frete contratado. A tela sugere pela forma de cálculo
 *   (`valorSugerido`), e quem paga confirma ou corrige: o que vale é o gravado.
 * - **Acréscimos**: pedágio (ou vale-pedágio pago à parte) e outros.
 * - **Retenções** (INSS, IRRF, SEST/SENAT e outras): valores DIGITADOS por quem
 *   paga. O sistema não calcula imposto: a conta é do contador.
 * - **Líquido** = bruto + acréscimos − descontos − retenções: é o que o parceiro
 *   recebe.
 * - **Custo da viagem** = bruto + acréscimos − descontos. A retenção não sai do
 *   custo: a empresa deixa de pagar ao parceiro para recolher em nome dele.
 * - **Saldo** = líquido − pagamentos registrados.
 *
 * A situação não é escolhida, sai dos pagamentos (`situacaoDoContrato`); só o
 * cancelamento é um ato.
 *
 * Datas: o dia do pagamento é dia do calendário (meia-noite UTC, lido em UTC),
 * como o vencimento do financeiro.
 */

const centavos = (valor: number) => Math.round((valor + Number.EPSILON) * 100) / 100;

/* ------------------------------- Forma de cálculo ------------------------------ */

export const CALC_MODES = ["FIXO", "PERCENTUAL", "POR_KM", "POR_ENTREGA"] as const;
export type FormaDeCalculo = (typeof CALC_MODES)[number];

export const CALC_MODE_LABEL: Record<FormaDeCalculo, string> = {
  FIXO: "Valor fixo por viagem",
  PERCENTUAL: "Percentual do frete das cargas",
  POR_KM: "Por km rodado",
  POR_ENTREGA: "Por entrega",
};

/** O que a base da forma de cálculo é, para o rótulo do campo. */
export const CALC_BASE_LABEL: Record<FormaDeCalculo, string> = {
  FIXO: "Valor (R$)",
  PERCENTUAL: "Percentual (%)",
  POR_KM: "R$ por km",
  POR_ENTREGA: "R$ por entrega",
};

export const rotuloDaForma = (forma: string | null | undefined) => (forma ? ((CALC_MODE_LABEL as Record<string, string>)[forma] ?? forma) : "-");

/** O que a viagem tem para a sugestão do valor bruto. */
export type BaseDaViagem = {
  /** A soma do frete das cargas da viagem (carga a cotar não soma). */
  freteDasCargas: number;
  /** Km rodados (hodômetro de retorno menos o de saída); `null` enquanto não há os dois. */
  km: number | null;
  /** Quantas cargas a viagem leva. */
  entregas: number;
};

/**
 * O valor bruto que a forma de cálculo dá para a viagem. `null` quando não há
 * como sugerir: sem base, ou por km numa viagem ainda sem os dois hodômetros.
 */
export function valorSugerido(forma: string | null | undefined, base: number | null | undefined, viagem: BaseDaViagem): number | null {
  if (base === null || base === undefined || !Number.isFinite(base)) return null;
  if (forma === "FIXO") return centavos(base);
  if (forma === "PERCENTUAL") return centavos((viagem.freteDasCargas * base) / 100);
  if (forma === "POR_KM") return viagem.km === null ? null : centavos(viagem.km * base);
  if (forma === "POR_ENTREGA") return centavos(viagem.entregas * base);
  return null;
}

/** A base da viagem, a partir do que as rotas leem dela. */
export function baseDaViagem(viagem: {
  collections: readonly { freightValue: number | null }[];
  departureOdometer?: number | null;
  returnOdometer?: number | null;
}): BaseDaViagem {
  const { departureOdometer: saida, returnOdometer: retorno } = viagem;
  return {
    freteDasCargas: centavos(viagem.collections.reduce((soma, carga) => soma + (carga.freightValue ?? 0), 0)),
    km: typeof saida === "number" && typeof retorno === "number" && retorno >= saida ? retorno - saida : null,
    entregas: viagem.collections.length,
  };
}

/* ----------------------------------- Valores ---------------------------------- */

/** Os valores gravados no contrato. */
export type ValoresGravados = {
  grossAmount: number;
  tollAmount: number;
  otherAdditions: number;
  discounts: number;
  inss: number;
  irrf: number;
  sestSenat: number;
  otherWithholdings: number;
};

export const CAMPOS_DE_VALOR = ["grossAmount", "tollAmount", "otherAdditions", "discounts", "inss", "irrf", "sestSenat", "otherWithholdings"] as const;

export type ValoresDoContrato = {
  bruto: number;
  /** Pedágio mais outros acréscimos. */
  acrescimos: number;
  descontos: number;
  /** INSS + IRRF + SEST/SENAT + outras. */
  retencoes: number;
  /** O que o parceiro recebe: bruto + acréscimos − descontos − retenções. */
  liquido: number;
  /** O que a viagem custa: bruto + acréscimos − descontos. */
  custo: number;
};

export function valoresDoContrato(contrato: ValoresGravados): ValoresDoContrato {
  const acrescimos = contrato.tollAmount + contrato.otherAdditions;
  const retencoes = contrato.inss + contrato.irrf + contrato.sestSenat + contrato.otherWithholdings;
  const custo = contrato.grossAmount + acrescimos - contrato.discounts;
  return {
    bruto: centavos(contrato.grossAmount),
    acrescimos: centavos(acrescimos),
    descontos: centavos(contrato.discounts),
    retencoes: centavos(retencoes),
    liquido: centavos(custo - retencoes),
    custo: centavos(custo),
  };
}

/* ------------------------------ Situação e pagamentos ------------------------- */

export const CONTRACT_STATUSES = ["ABERTO", "ADIANTADO", "QUITADO", "CANCELADO"] as const;
export type SituacaoDoContrato = (typeof CONTRACT_STATUSES)[number];

export const CONTRACT_STATUS: Record<string, { label: string; className: string }> = {
  ABERTO: { label: "Em aberto", className: "bg-amber-50 text-amber-700 border-amber-200" },
  ADIANTADO: { label: "Adiantado", className: "bg-sky-50 text-sky-700 border-sky-200" },
  QUITADO: { label: "Quitado", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  CANCELADO: { label: "Cancelado", className: "bg-gray-100 text-gray-600 border-gray-200" },
};

export const rotuloDaSituacao = (situacao: string) => CONTRACT_STATUS[situacao]?.label ?? situacao;

/**
 * A situação do contrato, pelos pagamentos: sem pagamento, em aberto; com
 * pagamento menor que o líquido, adiantado; com o líquido inteiro pago (ou
 * mais), quitado. Cancelado é o único estado que alguém escolhe.
 */
export function situacaoDoContrato(dados: { cancelado: boolean; liquido: number; pago: number }): SituacaoDoContrato {
  if (dados.cancelado) return "CANCELADO";
  if (centavos(dados.pago) <= 0) return "ABERTO";
  return centavos(dados.pago) >= centavos(dados.liquido) ? "QUITADO" : "ADIANTADO";
}

export const PAYMENT_KINDS = ["ADIANTAMENTO", "SALDO"] as const;
export type TipoDePagamento = (typeof PAYMENT_KINDS)[number];

export const PAYMENT_KIND_LABEL: Record<TipoDePagamento, string> = { ADIANTAMENTO: "Adiantamento", SALDO: "Saldo" };

export const rotuloDoPagamento = (tipo: string) => (PAYMENT_KIND_LABEL as Record<string, string>)[tipo] ?? tipo;

/** As formas de pagar o parceiro. São valores de `PAYMENT_METHODS` do financeiro: o lançamento leva a mesma. */
export const FREIGHT_PAYMENT_METHODS = ["PIX", "TRANSFERENCIA", "DINHEIRO", "CARTAO", "OUTRO"] as const;

export const FREIGHT_PAYMENT_METHOD_LABEL: Record<(typeof FREIGHT_PAYMENT_METHODS)[number], string> = {
  PIX: "Pix",
  TRANSFERENCIA: "Transferência",
  DINHEIRO: "Dinheiro",
  CARTAO: "Cartão-frete",
  OUTRO: "Outro",
};

export const rotuloDaFormaDePagamento = (forma: string) => (FREIGHT_PAYMENT_METHOD_LABEL as Record<string, string>)[forma] ?? forma;

/** A soma dos pagamentos registrados. */
export const totalPago = (pagamentos: readonly { amount: number }[]) => centavos(pagamentos.reduce((soma, pagamento) => soma + pagamento.amount, 0));

/** A soma só dos adiantamentos: é o que o MDF-e chama de `vAdiant`. */
export const totalAdiantado = (pagamentos: readonly { amount: number; kind: string }[]) => totalPago(pagamentos.filter((pagamento) => pagamento.kind === "ADIANTAMENTO"));

/** Os dois avisos que pedem um "sim" explícito de quem paga. O nome é o campo que o corpo manda como `true` para confirmar. */
export type Confirmacao = "pagarAcima" | "pagarAntesDeFinalizar";

export const PAGA_A_MAIS = (excesso: number) =>
  `Este pagamento passa do valor líquido do contrato em ${excesso.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}. Confirme para registrar mesmo assim.`;
export const QUITA_ANTES_DE_FINALIZAR = "Este pagamento quita o contrato, e a viagem ainda não foi finalizada. Confirme para pagar antes de finalizar.";

/**
 * O que impede um pagamento de ser registrado sem confirmação, ou `null` se
 * ele entra direto. Pagar mais que o líquido e quitar antes de a viagem ser
 * finalizada exigem, cada um, o "sim" explícito de quem paga.
 */
export function confirmacaoDoPagamento(dados: {
  liquido: number;
  /** O que já está pago, sem contar este pagamento. */
  pago: number;
  valor: number;
  viagemFinalizada: boolean;
  pagarAcima?: boolean;
  pagarAntesDeFinalizar?: boolean;
}): { confirmar: Confirmacao; mensagem: string } | null {
  const depois = centavos(dados.pago + dados.valor);
  const liquido = centavos(dados.liquido);
  if (depois > liquido && !dados.pagarAcima) return { confirmar: "pagarAcima", mensagem: PAGA_A_MAIS(centavos(depois - liquido)) };
  if (depois >= liquido && !dados.viagemFinalizada && !dados.pagarAntesDeFinalizar) return { confirmar: "pagarAntesDeFinalizar", mensagem: QUITA_ANTES_DE_FINALIZAR };
  return null;
}

/** Categoria da despesa que cada pagamento lança no Financeiro. */
export const CATEGORIA_DO_FRETE_CONTRATADO = "Frete contratado";

/** Descrição do lançamento do pagamento no Financeiro. */
export function descricaoDoPagamento(tipo: string, manifestId: string, parceiro: string): string {
  return `${rotuloDoPagamento(tipo)} de frete: viagem #${codigoDaViagem(manifestId)} (${parceiro})`;
}

/* -------------------------- O contrato como as rotas devolvem ------------------ */

export type PagamentoGravado = { amount: number; kind: string };

/** As contas de um contrato com os pagamentos dele: valores, pago, adiantado e saldo. */
export function contasDoContrato(contrato: ValoresGravados & { status: string; payments: readonly PagamentoGravado[] }) {
  const valores = valoresDoContrato(contrato);
  const pago = totalPago(contrato.payments);
  return {
    valores,
    pago,
    adiantado: totalAdiantado(contrato.payments),
    /** Negativo quando se pagou mais que o líquido. */
    saldo: centavos(valores.liquido - pago),
  };
}

/** O que falta pagar de um contrato: o saldo, nunca negativo; contrato cancelado não deve nada. */
export function emAberto(contrato: ValoresGravados & { status: string; payments: readonly PagamentoGravado[] }): number {
  if (contrato.status === "CANCELADO") return 0;
  return Math.max(0, contasDoContrato(contrato).saldo);
}

/**
 * Quanto o contrato pesa no custo da viagem (acerto e "Resultado por viagem"):
 * bruto + acréscimos − descontos. Sem contrato, ou com ele cancelado, zero.
 * As despesas que os pagamentos lançam no Financeiro não entram nessa conta:
 * o custo é o do contrato, uma vez só.
 */
export function custoParaAViagem(contrato: (ValoresGravados & { status: string }) | null | undefined): number {
  if (!contrato || contrato.status === "CANCELADO") return 0;
  return valoresDoContrato(contrato).custo;
}

/* ---------------------------- Fechamento por parceiro -------------------------- */

export type ContratoDoPeriodo = ValoresGravados & {
  id: string;
  status: string;
  payments: readonly PagamentoGravado[];
  manifest: {
    id: string;
    status: string;
    createdAt: Date | string;
    departedAt: Date | string | null;
    vehicle: { plate: string };
    driver: { user: { name: string } };
  };
};

export type LinhaDoFechamento = {
  contratoId: string;
  manifestId: string;
  codigo: string;
  /** O dia da viagem (`AAAA-MM-DD`, relógio do Brasil): a saída, ou a criação enquanto não saiu. */
  dia: string;
  placa: string;
  motorista: string;
  situacao: string;
  bruto: number;
  acrescimos: number;
  descontos: number;
  retencoes: number;
  liquido: number;
  pago: number;
  saldo: number;
};

export type Fechamento = {
  linhas: LinhaDoFechamento[];
  total: { viagens: number; bruto: number; acrescimos: number; descontos: number; retencoes: number; liquido: number; pago: number; saldo: number };
};

/** O dia que situa a viagem no período do fechamento: a saída; sem ela, a criação. */
export const diaDaViagem = (viagem: { createdAt: Date | string; departedAt: Date | string | null }) => diaNoBrasil(viagem.departedAt ?? viagem.createdAt);

/**
 * O fechamento do parceiro: uma linha por contrato, da viagem mais antiga para
 * a mais nova, e o total. Contrato cancelado não entra: não há o que conferir
 * nem o que pagar.
 */
export function fechamentoDoParceiro(contratos: readonly ContratoDoPeriodo[]): Fechamento {
  const linhas = contratos
    .filter((contrato) => contrato.status !== "CANCELADO")
    .map((contrato): LinhaDoFechamento => {
      const { valores, pago, saldo } = contasDoContrato(contrato);
      return {
        contratoId: contrato.id,
        manifestId: contrato.manifest.id,
        codigo: codigoDaViagem(contrato.manifest.id),
        dia: diaDaViagem(contrato.manifest),
        placa: contrato.manifest.vehicle.plate,
        motorista: contrato.manifest.driver.user.name,
        situacao: contrato.status,
        bruto: valores.bruto,
        acrescimos: valores.acrescimos,
        descontos: valores.descontos,
        retencoes: valores.retencoes,
        liquido: valores.liquido,
        pago,
        saldo,
      };
    })
    .sort((a, b) => a.dia.localeCompare(b.dia) || a.codigo.localeCompare(b.codigo));

  const soma = (campo: "bruto" | "acrescimos" | "descontos" | "retencoes" | "liquido" | "pago" | "saldo") => centavos(linhas.reduce((total, linha) => total + linha[campo], 0));
  return {
    linhas,
    total: {
      viagens: linhas.length,
      bruto: soma("bruto"),
      acrescimos: soma("acrescimos"),
      descontos: soma("descontos"),
      retencoes: soma("retencoes"),
      liquido: soma("liquido"),
      pago: soma("pago"),
      saldo: soma("saldo"),
    },
  };
}

export const CABECALHO_DO_FECHAMENTO = ["Viagem", "Data", "Placa", "Motorista", "Situação", "Bruto (R$)", "Acréscimos (R$)", "Descontos (R$)", "Retenções (R$)", "Líquido (R$)", "Pago (R$)", "Saldo (R$)"] as const;

// Número com vírgula decimal, como o Excel em português espera.
const numeroDoCsv = (valor: number) => valor.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });

/**
 * O fechamento em CSV, no mesmo formato da exportação do portal
 * (src/lib/portal-cliente.ts): separador `;`, linhas com CRLF e a marca de
 * UTF-8 (BOM) na frente. A última linha é o total.
 */
export function csvDoFechamento(fechamento: Fechamento): string {
  const valores = (linha: Pick<LinhaDoFechamento, "bruto" | "acrescimos" | "descontos" | "retencoes" | "liquido" | "pago" | "saldo">) =>
    [linha.bruto, linha.acrescimos, linha.descontos, linha.retencoes, linha.liquido, linha.pago, linha.saldo].map(numeroDoCsv);
  const linhas = fechamento.linhas.map((linha) =>
    [
      celulaDeTexto(`#${linha.codigo}`),
      celulaDeTexto(linha.dia.split("-").reverse().join("/")),
      celulaDeTexto(linha.placa),
      celulaDeTexto(linha.motorista),
      celulaDeTexto(rotuloDaSituacao(linha.situacao)),
      ...valores(linha),
    ].join(";"),
  );
  const total = [celulaDeTexto("Total"), celulaDeTexto(""), celulaDeTexto(""), celulaDeTexto(""), celulaDeTexto(`${fechamento.total.viagens} viagem(ns)`), ...valores(fechamento.total)].join(";");
  return `﻿${[CABECALHO_DO_FECHAMENTO.map((titulo) => celulaDeTexto(titulo)).join(";"), ...linhas, total].join("\r\n")}\r\n`;
}

/* ------------------------------------ Recibo ---------------------------------- */

export const TITULO_DO_RECIBO = "RECIBO DE PAGAMENTO DE FRETE";
export const AVISO_DO_RECIBO = "Recibo de pagamento de frete. Não é documento fiscal e não substitui o RPA, o CIOT nem o comprovante de pagamento eletrônico de frete.";
export const AVISO_DAS_RETENCOES = "As retenções são valores informados por quem paga: o sistema não calcula INSS, IRRF nem SEST/SENAT. O cálculo é do contador.";

/** O que a página do recibo recebe (`GET /api/manifestos/[id]/frete/recibo`). */
export type ReciboDeFrete = {
  empresa: { name: string; logo: string | null };
  emitidoEm: string;
  parceiro: { nome: string; documento: string; rntrc: string | null; tipo: string };
  viagem: { id: string; codigo: string; situacao: string; saiuEm: string | null; finalizadaEm: string | null; placa: string; veiculo: string; motorista: string; origens: string[]; destinos: string[] };
  contrato: { situacao: string; forma: string; base: number | null; observacao: string | null } & ValoresGravados;
  valores: ValoresDoContrato;
  pagamentos: { id: string; kind: string; date: string; amount: number; method: string; notes: string | null }[];
  pago: number;
  saldo: number;
};

/** As cidades sem repetir, na ordem em que aparecem: origens e destinos do recibo. */
export function cidadesSemRepetir(cidades: readonly string[]): string[] {
  const vistas = new Set<string>();
  const lista: string[] = [];
  for (const cidade of cidades) {
    const limpa = cidade.replace(/\s+/g, " ").trim();
    const chave = limpa.toLocaleLowerCase("pt-BR");
    if (limpa === "" || vistas.has(chave)) continue;
    vistas.add(chave);
    lista.push(limpa);
  }
  return lista;
}

/* ---------------------------------- Validação --------------------------------- */

const INVALID_BODY = "Dados inválidos.";

// O formulário manda número como texto ("1234,56" ou "1234.56"; "" quando em branco).
const fromFormNumber = (value: unknown) => {
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (text === "") return undefined;
  return /^(\d+([.,]\d*)?|[.,]\d+)$/.test(text) ? Number(text.replace(",", ".")) : NaN;
};

const optionalText = (max: number, tooLong: string) =>
  z
    .string(INVALID_BODY)
    .trim()
    .max(max, tooLong)
    .transform((value) => (value === "" ? null : value))
    .nullish();

const diaDoCalendario = (message: string) =>
  z
    .string(message)
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}/, message)
    .transform((value) => new Date(`${value.slice(0, 10)}T00:00:00.000Z`))
    .pipe(z.date(message));

/** Valor em reais, maior ou igual a zero. Em branco, `null` ou ausente vale zero. */
const valor = (message: string) =>
  z.preprocess((value) => (value === null ? undefined : fromFormNumber(value)), z.number(message).min(0, message).max(1_000_000_000, message).optional()).transform((value) => value ?? 0);

export const CALC_BASE_MESSAGE = "A base do cálculo precisa ser um número maior ou igual a zero.";
export const PERCENTUAL_MESSAGE = "O percentual precisa ficar entre 0 e 100.";

/** A forma de cálculo e a base dela. Valem no contrato e no padrão do parceiro. */
export const formaDeCalculo = {
  calcMode: z.enum(CALC_MODES, "Forma de cálculo inválida."),
  // Em branco, `null` ou ausente: sem base (a tela não sugere valor).
  calcBase: z
    .preprocess((value) => (value === null ? undefined : fromFormNumber(value)), z.number(CALC_BASE_MESSAGE).min(0, CALC_BASE_MESSAGE).max(1_000_000_000, CALC_BASE_MESSAGE).optional())
    .transform((value) => value ?? null),
};

/** `true` quando a base cabe na forma: percentual não passa de 100. */
export const baseCabeNaForma = (dados: { calcMode?: string | null; calcBase?: number | null }) => !(dados.calcMode === "PERCENTUAL" && typeof dados.calcBase === "number" && dados.calcBase > 100);

export const LIQUIDO_NEGATIVO = "Os descontos e as retenções passam do valor do frete: o líquido ficaria negativo.";

/**
 * O contrato inteiro, como a aba Frete manda (`PUT /api/manifestos/[id]/frete`):
 * cria o contrato da viagem ou troca os valores do que já existe. Valor em
 * branco vale zero.
 */
export const contratoSchema = z
  .object(
    {
      carrierId: z.string("Escolha o parceiro.").trim().min(1, "Escolha o parceiro.").max(64, "Parceiro inválido."),
      ...formaDeCalculo,
      grossAmount: valor("O valor bruto precisa ser um número maior ou igual a zero."),
      tollAmount: valor("O pedágio precisa ser um número maior ou igual a zero."),
      otherAdditions: valor("Os acréscimos precisam ser um número maior ou igual a zero."),
      discounts: valor("Os descontos precisam ser um número maior ou igual a zero."),
      inss: valor("O INSS precisa ser um número maior ou igual a zero."),
      irrf: valor("O IRRF precisa ser um número maior ou igual a zero."),
      sestSenat: valor("O SEST/SENAT precisa ser um número maior ou igual a zero."),
      otherWithholdings: valor("As outras retenções precisam ser um número maior ou igual a zero."),
      notes: optionalText(1000, "Observação muito longa."),
    },
    INVALID_BODY,
  )
  .refine(baseCabeNaForma, { message: PERCENTUAL_MESSAGE, path: ["calcBase"] })
  .refine((dados) => valoresDoContrato(dados).liquido >= 0, { message: LIQUIDO_NEGATIVO, path: ["grossAmount"] });

const PAYMENT_AMOUNT_MESSAGE = "O valor do pagamento precisa ser um número maior que zero.";
const confirmacao = z.boolean("Confirmação inválida.").optional();

export const pagamentoSchema = z.object(
  {
    kind: z.enum(PAYMENT_KINDS, "Informe se é adiantamento ou saldo."),
    date: diaDoCalendario("Informe a data do pagamento."),
    amount: z.preprocess(fromFormNumber, z.number(PAYMENT_AMOUNT_MESSAGE).gt(0, PAYMENT_AMOUNT_MESSAGE).max(1_000_000_000, PAYMENT_AMOUNT_MESSAGE)),
    method: z.enum(FREIGHT_PAYMENT_METHODS, "Forma de pagamento inválida."),
    notes: optionalText(500, "Observação muito longa."),
    // O lançamento no Financeiro nasce em aberto; com `paid`, já nasce pago.
    paid: z.boolean("Informe se o pagamento já saiu.").optional(),
    pagarAcima: confirmacao,
    pagarAntesDeFinalizar: confirmacao,
  },
  INVALID_BODY,
);

/* ------------------------------ O que as rotas leem ---------------------------- */

export const PAYMENT_SELECT = {
  id: true,
  kind: true,
  date: true,
  amount: true,
  method: true,
  notes: true,
  createdAt: true,
  transactionId: true,
  // Do lançamento, só a situação: é ela que diz se o pagamento ainda pode ser excluído.
  transaction: { select: { id: true, status: true } },
} as const;

export const CONTRACT_SELECT = {
  id: true,
  manifestId: true,
  carrierId: true,
  calcMode: true,
  calcBase: true,
  grossAmount: true,
  tollAmount: true,
  otherAdditions: true,
  discounts: true,
  inss: true,
  irrf: true,
  sestSenat: true,
  otherWithholdings: true,
  status: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  carrier: { select: { id: true, name: true, taxId: true, type: true, rntrc: true, pixKey: true, bankInfo: true } },
  payments: { select: PAYMENT_SELECT, orderBy: [{ date: "asc" }, { createdAt: "asc" }] },
} satisfies Prisma.FreightContractSelect;

/** O que o acerto e o resultado da viagem leem do contrato: a situação e os valores. */
export const CONTRACT_COST_SELECT = {
  status: true,
  grossAmount: true,
  tollAmount: true,
  otherAdditions: true,
  discounts: true,
  inss: true,
  irrf: true,
  sestSenat: true,
  otherWithholdings: true,
} as const;

/** O que entra em `antes`/`depois` da auditoria. */
export const CAMPOS_DO_CONTRATO = ["manifestId", "carrierId", "calcMode", "calcBase", ...CAMPOS_DE_VALOR, "status", "notes"] as const;
export const CAMPOS_DO_PAGAMENTO = ["kind", "date", "amount", "method", "notes", "transactionId"] as const;

export const CONTRACT_NOT_FOUND = "Esta viagem não tem frete contratado.";
export const PAYMENT_NOT_FOUND = "Pagamento não encontrado.";
export const CARRIER_NOT_FOUND_OR_INACTIVE = "Parceiro não encontrado ou desativado.";
export const TRIP_CANCELLED_NO_CONTRACT = "Viagem cancelada não recebe frete contratado.";
export const CONTRACT_CANCELLED = "O frete contratado desta viagem está cancelado. Grave o contrato de novo para reabrir.";
export const CONTRACT_HAS_PAYMENTS = "Este frete contratado tem pagamento registrado. Exclua os pagamentos antes de cancelar.";
export const CARRIER_LOCKED_BY_PAYMENTS = "O contrato já tem pagamento registrado: o parceiro não pode ser trocado.";
export const TRIP_HAS_PAID_CONTRACT = "A viagem tem frete contratado com pagamento registrado. Exclua os pagamentos na aba Frete antes de cancelar a viagem.";
export const PAYMENT_ALREADY_PAID = "O lançamento deste pagamento já está pago no Financeiro. Reabra o lançamento lá antes de excluir o pagamento.";
export const LIQUIDO_MENOR_QUE_O_PAGO = "O líquido ficaria menor do que já foi pago. Exclua um pagamento antes de reduzir o contrato.";
export const QUITARIA_ANTES_DE_FINALIZAR = "Com estes valores o contrato ficaria quitado, e a viagem ainda não foi finalizada. Finalize a viagem ou ajuste os pagamentos.";

/** O dia do pagamento por extenso (`DD/MM/AAAA`), lido em UTC. */
export const diaDoPagamento = (data: Date | string) => diaDoVencimento(data).split("-").reverse().join("/");
