import { z } from "zod";

/**
 * Contas a pagar e a receber, e fluxo de caixa: regras e contas comuns às
 * rotas e à tela do financeiro.
 *
 * As três contas (`situacaoDoLancamento`, `resumoFinanceiro`, `fluxoDeCaixa`)
 * são puras: recebem os lançamentos e a data de referência, sem tocar no banco.
 *
 * Duas datas, dois sentidos:
 * - vencimento (`dueDate`) é um dia do calendário, gravado à meia-noite UTC.
 *   Compará-lo no fuso do Brasil o joga para o dia anterior; por isso aqui ele
 *   é sempre lido em UTC.
 * - pagamento (`paidAt`) é um instante. O mês em que ele cai é o do relógio do
 *   Brasil, que é onde a transportadora fecha o caixa.
 */

export const TRANSACTION_TYPES = ["INCOME", "EXPENSE"] as const;
export const PAYMENT_METHODS = ["PIX", "BOLETO", "DINHEIRO", "TRANSFERENCIA", "CARTAO", "OUTRO"] as const;

export const PAYMENT_METHOD_LABEL: Record<(typeof PAYMENT_METHODS)[number], string> = {
  PIX: "Pix",
  BOLETO: "Boleto",
  DINHEIRO: "Dinheiro",
  TRANSFERENCIA: "Transferência",
  CARTAO: "Cartão",
  OUTRO: "Outro",
};

export type Situacao = "pago" | "vencido" | "aberto";

export type Lancamento = {
  type: string;
  amount: number;
  status: string;
  dueDate: Date | string | null;
  paidAt: Date | string | null;
};

const FUSO = "America/Sao_Paulo";

const centavos = (valor: number) => Math.round((valor + Number.EPSILON) * 100) / 100;

/** Dia do calendário do vencimento, como `AAAA-MM-DD` (lido em UTC). */
export function diaDoVencimento(valor: Date | string): string {
  return new Date(valor).toISOString().slice(0, 10);
}

/** Dia de um instante no relógio do Brasil, como `AAAA-MM-DD`. */
export function diaNoBrasil(instante: Date | string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(instante),
  );
}

/** Pago; ou vencido (passou do dia do vencimento e segue em aberto); ou em aberto. Vence no fim do dia, não no começo. */
export function situacaoDoLancamento(lancamento: Pick<Lancamento, "status" | "dueDate">, hoje: Date = new Date()): Situacao {
  if (lancamento.status === "PAID") return "pago";
  if (lancamento.dueDate && diaDoVencimento(lancamento.dueDate) < diaNoBrasil(hoje)) return "vencido";
  return "aberto";
}

export type Resumo = {
  aReceber: { aberto: number; vencido: number };
  aPagar: { aberto: number; vencido: number };
  /** O que entrou e saiu de verdade no mês corrente. */
  noMes: { recebido: number; pago: number };
  /** A receber menos a pagar, contando o vencido dos dois lados. */
  saldoPrevisto: number;
};

export function resumoFinanceiro(lancamentos: readonly Lancamento[], hoje: Date = new Date()): Resumo {
  const resumo: Resumo = {
    aReceber: { aberto: 0, vencido: 0 },
    aPagar: { aberto: 0, vencido: 0 },
    noMes: { recebido: 0, pago: 0 },
    saldoPrevisto: 0,
  };
  const mesAtual = diaNoBrasil(hoje).slice(0, 7);

  for (const l of lancamentos) {
    const entrada = l.type === "INCOME";
    const situacao = situacaoDoLancamento(l, hoje);

    if (situacao === "pago") {
      if (l.paidAt && diaNoBrasil(l.paidAt).slice(0, 7) === mesAtual) {
        if (entrada) resumo.noMes.recebido += l.amount;
        else resumo.noMes.pago += l.amount;
      }
      continue;
    }

    const lado = entrada ? resumo.aReceber : resumo.aPagar;
    lado[situacao] += l.amount;
  }

  resumo.aReceber.aberto = centavos(resumo.aReceber.aberto);
  resumo.aReceber.vencido = centavos(resumo.aReceber.vencido);
  resumo.aPagar.aberto = centavos(resumo.aPagar.aberto);
  resumo.aPagar.vencido = centavos(resumo.aPagar.vencido);
  resumo.noMes.recebido = centavos(resumo.noMes.recebido);
  resumo.noMes.pago = centavos(resumo.noMes.pago);
  resumo.saldoPrevisto = centavos(
    resumo.aReceber.aberto + resumo.aReceber.vencido - resumo.aPagar.aberto - resumo.aPagar.vencido,
  );
  return resumo;
}

export type MesDoFluxo = {
  /** `AAAA-MM`. */
  mes: string;
  previsto: { entradas: number; saidas: number; saldo: number };
  realizado: { entradas: number; saidas: number; saldo: number };
  /** Saldo realizado somado desde o primeiro mês do período. */
  acumulado: number;
};

const MES = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Os meses de `de` a `ate`, inclusive. Período invertido, malformado ou com mais de 36 meses devolve vazio. */
export function mesesDoPeriodo(de: string, ate: string): string[] {
  if (!MES.test(de) || !MES.test(ate) || de > ate) return [];
  const meses: string[] = [];
  let [ano, mes] = de.split("-").map(Number);
  while (meses.length < 36) {
    const chave = `${ano}-${String(mes).padStart(2, "0")}`;
    meses.push(chave);
    if (chave === ate) return meses;
    mes += 1;
    if (mes > 12) {
      mes = 1;
      ano += 1;
    }
  }
  return [];
}

/**
 * Fluxo de caixa por mês. **Previsto** é tudo o que vence no mês (pago ou não):
 * o que a transportadora esperava movimentar. **Realizado** é o que foi pago ou
 * recebido no mês, pela data do pagamento. Lançamento sem vencimento só aparece
 * no realizado, quando é pago.
 */
export function fluxoDeCaixa(lancamentos: readonly Lancamento[], de: string, ate: string): MesDoFluxo[] {
  const meses = mesesDoPeriodo(de, ate);
  const linhas = new Map<string, MesDoFluxo>(
    meses.map((mes) => [
      mes,
      { mes, previsto: { entradas: 0, saidas: 0, saldo: 0 }, realizado: { entradas: 0, saidas: 0, saldo: 0 }, acumulado: 0 },
    ]),
  );

  for (const l of lancamentos) {
    const campo = l.type === "INCOME" ? "entradas" : "saidas";

    if (l.dueDate) {
      const linha = linhas.get(diaDoVencimento(l.dueDate).slice(0, 7));
      if (linha) linha.previsto[campo] += l.amount;
    }
    if (l.status === "PAID" && l.paidAt) {
      const linha = linhas.get(diaNoBrasil(l.paidAt).slice(0, 7));
      if (linha) linha.realizado[campo] += l.amount;
    }
  }

  let acumulado = 0;
  return meses.map((mes) => {
    const linha = linhas.get(mes)!;
    for (const lado of [linha.previsto, linha.realizado]) {
      lado.entradas = centavos(lado.entradas);
      lado.saidas = centavos(lado.saidas);
      lado.saldo = centavos(lado.entradas - lado.saidas);
    }
    acumulado = centavos(acumulado + linha.realizado.saldo);
    linha.acumulado = acumulado;
    return linha;
  });
}

/** Período padrão do fluxo: três meses para trás e três para a frente. */
export function periodoPadrao(hoje: Date = new Date()): { de: string; ate: string } {
  const [ano, mes] = diaNoBrasil(hoje).split("-").map(Number);
  const deslocar = (delta: number) => {
    const total = ano * 12 + (mes - 1) + delta;
    return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
  };
  return { de: deslocar(-3), ate: deslocar(3) };
}

/* --------------------------------- Validação --------------------------------- */

const INVALID_BODY = "Dados inválidos.";
const AMOUNT_MESSAGE = "O valor precisa ser um número maior que zero.";

// O formulário manda número como texto ("1.234,56" não: só "1234,56" ou "1234.56").
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

// Data do formulário (AAAA-MM-DD) ou ISO. Vazio apaga; ausente não mexe.
const optionalDate = (message: string) =>
  z.preprocess((value) => (typeof value === "string" && value.trim() === "" ? null : value), z.coerce.date(message).nullish());

const fields = {
  type: z.enum(TRANSACTION_TYPES, "Informe se é receita ou despesa."),
  amount: z.preprocess(fromFormNumber, z.number(AMOUNT_MESSAGE).gt(0, AMOUNT_MESSAGE).max(1_000_000_000, AMOUNT_MESSAGE)),
  description: z.string("Informe a descrição.").trim().min(2, "Informe a descrição.").max(200, "Descrição muito longa."),
  dueDate: optionalDate("Vencimento inválido."),
  clientId: optionalText(64, INVALID_BODY),
  category: optionalText(80, "Categoria muito longa."),
  counterparty: optionalText(160, "Nome do fornecedor ou pagador muito longo."),
  notes: optionalText(1000, "Observação muito longa."),
  paymentMethod: z
    .preprocess((value) => (value === "" ? null : value), z.enum(PAYMENT_METHODS, "Forma de pagamento inválida.").nullish()),
  paidAt: optionalDate("Data do pagamento inválida."),
};

export const createTransactionSchema = z.object(
  {
    ...fields,
    // Lançamento que já nasce pago (despesa paga na hora, por exemplo).
    status: z.enum(["PENDING", "PAID"], "Situação inválida.").optional(),
  },
  INVALID_BODY,
);

/**
 * Alteração. `action` muda a situação: `pagar` (com `paidAt` e `paymentMethod`
 * opcionais; sem data vale agora) e `reabrir`. Sem `action`, edita os campos.
 */
export const updateTransactionSchema = z
  .object(
    {
      action: z.enum(["pagar", "reabrir"], "Ação inválida.").optional(),
      type: fields.type.optional(),
      amount: z.preprocess(fromFormNumber, z.number(AMOUNT_MESSAGE).gt(0, AMOUNT_MESSAGE).max(1_000_000_000, AMOUNT_MESSAGE).optional()),
      description: fields.description.optional(),
      dueDate: fields.dueDate,
      clientId: fields.clientId,
      category: fields.category,
      counterparty: fields.counterparty,
      notes: fields.notes,
      paymentMethod: fields.paymentMethod,
      paidAt: fields.paidAt,
    },
    INVALID_BODY,
  )
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: "Informe ao menos um campo para alterar.",
  });

/** O que as rotas devolvem de cada lançamento. */
export const TRANSACTION_SELECT = {
  id: true,
  type: true,
  amount: true,
  description: true,
  dueDate: true,
  status: true,
  paidAt: true,
  paymentMethod: true,
  category: true,
  counterparty: true,
  notes: true,
  createdAt: true,
  clientId: true,
  client: { select: { id: true, companyName: true, tradeName: true } },
  invoiceId: true,
  invoice: { select: { id: true, number: true } },
} as const;

export const FROM_INVOICE_MESSAGE =
  "Este lançamento veio de uma fatura. Para pagar, reabrir ou cancelar, use a tela de Faturamento.";
