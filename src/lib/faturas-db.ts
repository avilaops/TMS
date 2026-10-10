import type { Prisma } from "@prisma/client";
import { Refusal } from "@/lib/cadastros";
import { registrarAuditoria, type Ator, type Origem } from "@/lib/auditoria";
import { INVOICE_SELECT } from "@/lib/faturas";
import { DESCONTO_MAIOR_QUE_O_VALOR, temEncargos, valorRecebido, type Encargos } from "@/lib/financeiro";
import { recusarSeConciliado } from "@/lib/financeiro-db";

// Pagar, reabrir e cancelar fatura dentro de transação. A rota do Faturamento e
// a conciliação bancária passam por aqui: é o único caminho que mexe na fatura
// e no lançamento dela juntos. Só o servidor importa este arquivo.

type Tx = Prisma.TransactionClient;

export type AcaoDaFatura = "pagar" | "reabrir" | "cancelar";

// A ação e o que ela vira na auditoria.
const NA_AUDITORIA = {
  pagar: { acao: "fatura.pagar", feito: "paga" },
  reabrir: { acao: "fatura.reabrir", feito: "reaberta" },
  cancelar: { acao: "fatura.cancelar", feito: "cancelada" },
} as const;

export const INVOICE_NOT_FOUND = "Fatura não encontrada.";

// Baixa pelo valor cheio, e fatura reaberta: o lançamento não guarda encargo.
const SEM_ENCARGOS = { interest: null, fine: null, discount: null, paidAmount: null };

export type OpcoesDaFatura = {
  ator: Ator;
  origem: Origem;
  /** Juros, multa e desconto da baixa (só em `pagar`). */
  encargos?: Encargos;
  /** Quando foi paga. Padrão: agora. A conciliação passa o dia do extrato. */
  pagaEm?: Date;
  /** Forma de pagamento do lançamento. Ausente não mexe na coluna. */
  formaDePagamento?: string | null;
  /** A chamada vem da conciliação, que já cuidou da linha do extrato: não recusa por estar conciliada. */
  daConciliacao?: boolean;
};

/**
 * Pagar, reabrir ou cancelar. O lançamento do financeiro acompanha a fatura na
 * mesma transação: pago com ela, pendente quando reaberta, apagado no
 * cancelamento. Pagar aceita `juros`, `multa` e `desconto`, que vão para o
 * lançamento (o valor recebido entra no caixa; o total da fatura não muda).
 * Cancelar solta as cargas, que voltam a ser faturáveis; o número da fatura
 * cancelada não é reaproveitado.
 *
 * Fatura cujo lançamento está conciliado com o extrato não é reaberta por aqui
 * (409): desfaz-se a conciliação, que reabre a fatura.
 */
export async function alterarFatura(tx: Tx, id: string, action: AcaoDaFatura, { ator, origem, encargos = {}, pagaEm, formaDePagamento, daConciliacao = false }: OpcoesDaFatura) {
  await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${id} FOR UPDATE`;
  const atual = await tx.invoice.findUnique({ where: { id }, select: { status: true, paidAt: true, total: true, transaction: { select: { id: true } } } });
  if (!atual) throw new Refusal(INVOICE_NOT_FOUND, 404);
  let baixa: { interest: number; fine: number; discount: number; paidAmount: number } | null = null;

  if (action === "pagar") {
    if (atual.status !== "OPEN") throw new Refusal("Só fatura em aberto pode ser marcada como paga.", 409);
    // Juros, multa e desconto ficam no lançamento da fatura: o total da fatura é o emitido e não muda.
    const comEncargos = temEncargos(encargos);
    const recebido = valorRecebido(atual.total, encargos);
    if (recebido < 0) throw new Refusal(DESCONTO_MAIOR_QUE_O_VALOR, 400);
    baixa = comEncargos ? { interest: encargos.juros ?? 0, fine: encargos.multa ?? 0, discount: encargos.desconto ?? 0, paidAmount: recebido } : null;

    const quando = pagaEm ?? new Date();
    await tx.invoice.update({ where: { id }, data: { status: "PAID", paidAt: quando }, select: { id: true } });
    // `paidAt` é o que põe a fatura no fluxo de caixa realizado.
    await tx.financialTransaction.updateMany({
      where: { invoiceId: id },
      data: { status: "PAID", paidAt: quando, ...(formaDePagamento !== undefined && { paymentMethod: formaDePagamento }), ...(baixa ?? SEM_ENCARGOS) },
    });
  }

  if (action === "reabrir") {
    if (atual.status !== "PAID") throw new Refusal("Só fatura paga pode ser reaberta.", 409);
    if (!daConciliacao && atual.transaction) await recusarSeConciliado(tx, atual.transaction.id);
    await tx.invoice.update({ where: { id }, data: { status: "OPEN", paidAt: null }, select: { id: true } });
    await tx.financialTransaction.updateMany({
      where: { invoiceId: id },
      data: { status: "PENDING", paidAt: null, paymentMethod: null, ...SEM_ENCARGOS },
    });
  }

  if (action === "cancelar") {
    if (atual.status !== "OPEN") {
      throw new Refusal(atual.status === "PAID" ? "Fatura paga não pode ser cancelada. Reabra antes." : "Esta fatura já está cancelada.", 409);
    }
    await tx.collection.updateMany({ where: { invoiceId: id }, data: { invoiceId: null } });
    await tx.financialTransaction.deleteMany({ where: { invoiceId: id } });
    await tx.invoice.update({ where: { id }, data: { status: "CANCELLED" }, select: { id: true } });
  }

  const depois = await tx.invoice.findUniqueOrThrow({ where: { id }, select: INVOICE_SELECT });

  await registrarAuditoria(tx, {
    ator,
    origem,
    acao: NA_AUDITORIA[action].acao,
    entidade: "fatura",
    entidadeId: id,
    resumo: `Fatura nº ${depois.number} ${NA_AUDITORIA[action].feito}`,
    antes: { status: atual.status, paidAt: atual.paidAt },
    depois: { status: depois.status, paidAt: depois.paidAt, ...baixa },
  });

  return depois;
}
