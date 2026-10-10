import type { Prisma } from "@prisma/client";
import { Refusal } from "@/lib/cadastros";
import { CAMPOS_DO_LANCAMENTO, escolher, registrarAuditoria, type Ator, type Origem } from "@/lib/auditoria";
import { CONCILIADO_NAO_MEXE, TITULO_NAO_ENCONTRADO } from "@/lib/conciliacao";
import {
  DESCONTO_MAIOR_QUE_O_VALOR,
  ENCARGOS_SO_A_RECEBER,
  FROM_INVOICE_MESSAGE,
  TRANSACTION_SELECT,
  temEncargos,
  valorRecebido,
  type Encargos,
} from "@/lib/financeiro";

// Apoio das rotas que dão baixa ou reabrem um lançamento dentro de transação: a
// tela do Financeiro e a conciliação bancária usam a mesma regra. Só o servidor
// importa este arquivo.

type Tx = Prisma.TransactionClient;

/** As colunas que dizem se o lançamento está pago e como. */
export type SituacaoDoTitulo = {
  status: string;
  paidAt: Date | null;
  paymentMethod: string | null;
  interest: number | null;
  fine: number | null;
  discount: number | null;
  paidAmount: number | null;
};

/** O lançamento reaberto: em aberto, sem pagamento e sem encargo. */
export const TITULO_EM_ABERTO: SituacaoDoTitulo = {
  status: "PENDING",
  paidAt: null,
  paymentMethod: null,
  interest: null,
  fine: null,
  discount: null,
  paidAmount: null,
};

/**
 * A regra da baixa: como ficam as colunas do lançamento pago em `quando`.
 * Juros, multa e desconto valem só para título a receber, e o desconto não
 * passa do valor com juros e multa (recusa 400). Baixa pelo valor cheio não
 * guarda encargo: `paidAmount` nulo é "recebeu o original".
 */
export function situacaoDaBaixa(titulo: { type: string; amount: number }, encargos: Encargos, quando: Date, forma: string | null): SituacaoDoTitulo {
  const comEncargos = temEncargos(encargos);
  if (comEncargos && titulo.type !== "INCOME") throw new Refusal(ENCARGOS_SO_A_RECEBER, 400);
  const recebido = valorRecebido(titulo.amount, encargos);
  if (recebido < 0) throw new Refusal(DESCONTO_MAIOR_QUE_O_VALOR, 400);
  return {
    status: "PAID",
    paidAt: quando,
    paymentMethod: forma,
    interest: comEncargos ? (encargos.juros ?? 0) : null,
    fine: comEncargos ? (encargos.multa ?? 0) : null,
    discount: comEncargos ? (encargos.desconto ?? 0) : null,
    paidAmount: comEncargos ? recebido : null,
  };
}

/**
 * Recusa (409) mexer num lançamento conciliado com o extrato: reabrir ou apagar
 * por fora deixaria a linha do extrato "conciliada" com um título em aberto, ou
 * com nada. O caminho é desfazer a conciliação.
 */
export async function recusarSeConciliado(tx: Pick<Tx, "bankStatementLine">, transactionId: string): Promise<void> {
  const linha = await tx.bankStatementLine.findFirst({ where: { transactionId }, select: { id: true } });
  if (linha) throw new Refusal(CONCILIADO_NAO_MEXE, 409);
}

type Quem = { ator: Ator; origem: Origem };

async function travar(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM "FinancialTransaction" WHERE id = ${id} FOR UPDATE`;
  const atual = await tx.financialTransaction.findUnique({ where: { id }, select: TRANSACTION_SELECT });
  if (!atual) throw new Refusal(TITULO_NAO_ENCONTRADO, 404);
  // O de fatura é pago e reaberto pela fatura (src/lib/faturas-db.ts), que mantém os dois em sincronia.
  if (atual.invoiceId) throw new Refusal(FROM_INVOICE_MESSAGE, 409);
  return atual;
}

/** Dá baixa num lançamento manual em aberto, com a regra de `situacaoDaBaixa`, e registra na auditoria. */
export async function pagarLancamento(tx: Tx, id: string, { encargos, quando, forma, ator, origem }: Quem & { encargos: Encargos; quando: Date; forma: string | null }) {
  const atual = await travar(tx, id);
  if (atual.status === "PAID") throw new Refusal("Este lançamento já está pago.", 409);

  const atualizado = await tx.financialTransaction.update({
    where: { id },
    data: situacaoDaBaixa(atual, encargos, quando, forma),
    select: TRANSACTION_SELECT,
  });
  await registrarAuditoria(tx, {
    ator,
    origem,
    acao: "lancamento.pagar",
    entidade: "lancamento",
    entidadeId: id,
    resumo: `Lançamento "${atualizado.description}" pago`,
    antes: escolher(atual, CAMPOS_DO_LANCAMENTO),
    depois: escolher(atualizado, CAMPOS_DO_LANCAMENTO),
  });
  return atualizado;
}

/** Reabre um lançamento manual pago e registra na auditoria. Quem chama já desfez a ligação com o extrato, se havia. */
export async function reabrirLancamento(tx: Tx, id: string, { ator, origem }: Quem) {
  const atual = await travar(tx, id);
  if (atual.status !== "PAID") throw new Refusal("Só lançamento pago pode ser reaberto.", 409);

  const atualizado = await tx.financialTransaction.update({ where: { id }, data: TITULO_EM_ABERTO, select: TRANSACTION_SELECT });
  await registrarAuditoria(tx, {
    ator,
    origem,
    acao: "lancamento.reabrir",
    entidade: "lancamento",
    entidadeId: id,
    resumo: `Lançamento "${atualizado.description}" reaberto`,
    antes: escolher(atual, CAMPOS_DO_LANCAMENTO),
    depois: escolher(atualizado, CAMPOS_DO_LANCAMENTO),
  });
  return atualizado;
}
