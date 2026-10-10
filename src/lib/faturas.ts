import { z } from "zod";
import { ENCARGOS_SO_NA_BAIXA, encargosDaBaixa, semEncargoForaDaBaixa } from "@/lib/financeiro";

/**
 * Faturamento: regras e formatos comuns às rotas de fatura.
 *
 * Uma carga é faturável quando já foi entregue, tem frete definido e ainda não
 * entrou em fatura nenhuma. O frete "a cotar" não é faturável: o operador
 * informa o valor na coleta antes.
 */

export const INVOICE_STATUSES = ["OPEN", "PAID", "CANCELLED"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/** Condição de carga faturável, para o `where` das consultas. */
export const FATURAVEL = { status: "DELIVERED", invoiceId: null, freightValue: { not: null } } as const;

const INVALID_BODY = "Dados inválidos.";

export const createInvoiceSchema = z.object(
  {
    clientId: z.string("Informe o cliente.").trim().min(1, "Informe o cliente."),
    collectionIds: z
      .array(z.string().trim().min(1), "Escolha ao menos uma carga.")
      .min(1, "Escolha ao menos uma carga.")
      .max(500, "Uma fatura aceita no máximo 500 cargas."),
    dueDate: z.coerce.date("Informe o vencimento."),
    notes: z
      .string(INVALID_BODY)
      .trim()
      .max(1000, "Observação muito longa.")
      .transform((value) => (value === "" ? null : value))
      .nullish(),
  },
  INVALID_BODY,
);

/** Pagar aceita os mesmos `juros`, `multa` e `desconto` da baixa de um lançamento: vão para o lançamento da fatura. */
export const invoiceActionSchema = z
  .object({ action: z.enum(["pagar", "reabrir", "cancelar"], "Ação inválida."), ...encargosDaBaixa }, INVALID_BODY)
  .refine(semEncargoForaDaBaixa, { message: ENCARGOS_SO_NA_BAIXA });

export const INVOICE_SELECT = {
  id: true,
  number: true,
  status: true,
  total: true,
  dueDate: true,
  issuedAt: true,
  paidAt: true,
  notes: true,
  client: { select: { id: true, companyName: true, tradeName: true, cnpj: true } },
  _count: { select: { collections: true } },
} as const;

/** O que a fatura mostra de cada carga cobrada. */
export const INVOICE_COLLECTION_SELECT = {
  id: true,
  trackingCode: true,
  createdAt: true,
  origin: true,
  destination: true,
  receiver: true,
  volumes: true,
  weight: true,
  invoiceValue: true,
  freightValue: true,
} as const;

export const centavos = (valor: number) => Math.round((valor + Number.EPSILON) * 100) / 100;

export function descricaoDoLancamento(numero: number, cargas: number): string {
  return `Fatura nº ${numero} (${cargas} ${cargas === 1 ? "carga" : "cargas"})`;
}
