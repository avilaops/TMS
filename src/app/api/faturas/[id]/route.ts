import { NextResponse } from 'next/server';
import prisma, { transacao } from '@/lib/prisma';
import { requireStaff } from '@/lib/staff';
import { Refusal } from '@/lib/cadastros';
import { firstIssue } from '@/lib/usuarios';
import { INVOICE_COLLECTION_SELECT, INVOICE_SELECT, invoiceActionSchema } from '@/lib/faturas';
import { DESCONTO_MAIOR_QUE_O_VALOR, temEncargos, valorRecebido } from '@/lib/financeiro';
import { origemDaRequisicao, registrarAuditoria } from '@/lib/auditoria';

// A ação da rota e o que ela vira na auditoria.
const NA_AUDITORIA = {
  pagar: { acao: 'fatura.pagar', feito: 'paga' },
  reabrir: { acao: 'fatura.reabrir', feito: 'reaberta' },
  cancelar: { acao: 'fatura.cancelar', feito: 'cancelada' },
} as const;

const NOT_FOUND = 'Fatura não encontrada.';

// Baixa pelo valor cheio, e fatura reaberta: o lançamento não guarda encargo.
const SEM_ENCARGOS = { interest: null, fine: null, discount: null, paidAmount: null };

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireStaff(['ADMIN']);
  if (error) return error;

  try {
    const { id } = await params;
    const fatura = await prisma.invoice.findUnique({
      where: { id },
      select: {
        ...INVOICE_SELECT,
        collections: { select: INVOICE_COLLECTION_SELECT, orderBy: { createdAt: 'asc' } },
        // O lançamento a receber da fatura: é por ele que a tela chega ao recibo.
        transaction: { select: { id: true } },
      },
    });
    if (!fatura) return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
    return NextResponse.json(fatura);
  } catch (error) {
    console.error('Erro ao buscar fatura:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

/**
 * Pagar, reabrir ou cancelar. O lançamento do financeiro acompanha a fatura na
 * mesma transação: pago com ela, pendente quando reaberta, apagado no
 * cancelamento. Pagar aceita `juros`, `multa` e `desconto`, que vão para o
 * lançamento (o valor recebido entra no caixa; o total da fatura não muda).
 * Cancelar solta as cargas, que voltam a ser faturáveis; o número
 * da fatura cancelada não é reaproveitado.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireStaff(['ADMIN']);
  if (error) return error;

  try {
    const { id } = await params;
    const parsed = invoiceActionSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const { action, ...encargos } = parsed.data;
    const origem = origemDaRequisicao(req);

    const fatura = await transacao(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${id} FOR UPDATE`;
      const atual = await tx.invoice.findUnique({ where: { id }, select: { status: true, paidAt: true, total: true } });
      if (!atual) throw new Refusal(NOT_FOUND, 404);
      let baixa: { interest: number; fine: number; discount: number; paidAmount: number } | null = null;

      if (action === 'pagar') {
        if (atual.status !== 'OPEN') throw new Refusal('Só fatura em aberto pode ser marcada como paga.', 409);
        // Juros, multa e desconto ficam no lançamento da fatura: o total da fatura é o emitido e não muda.
        const comEncargos = temEncargos(encargos);
        const recebido = valorRecebido(atual.total, encargos);
        if (recebido < 0) throw new Refusal(DESCONTO_MAIOR_QUE_O_VALOR, 400);
        baixa = comEncargos
          ? { interest: encargos.juros ?? 0, fine: encargos.multa ?? 0, discount: encargos.desconto ?? 0, paidAmount: recebido }
          : null;

        const pagaEm = new Date();
        await tx.invoice.update({ where: { id }, data: { status: 'PAID', paidAt: pagaEm }, select: { id: true } });
        // `paidAt` é o que põe a fatura no fluxo de caixa realizado.
        await tx.financialTransaction.updateMany({
          where: { invoiceId: id },
          data: { status: 'PAID', paidAt: pagaEm, ...(baixa ?? SEM_ENCARGOS) },
        });
      }

      if (action === 'reabrir') {
        if (atual.status !== 'PAID') throw new Refusal('Só fatura paga pode ser reaberta.', 409);
        await tx.invoice.update({ where: { id }, data: { status: 'OPEN', paidAt: null }, select: { id: true } });
        await tx.financialTransaction.updateMany({
          where: { invoiceId: id },
          data: { status: 'PENDING', paidAt: null, paymentMethod: null, ...SEM_ENCARGOS },
        });
      }

      if (action === 'cancelar') {
        if (atual.status !== 'OPEN') {
          throw new Refusal(
            atual.status === 'PAID' ? 'Fatura paga não pode ser cancelada. Reabra antes.' : 'Esta fatura já está cancelada.',
            409,
          );
        }
        await tx.collection.updateMany({ where: { invoiceId: id }, data: { invoiceId: null } });
        await tx.financialTransaction.deleteMany({ where: { invoiceId: id } });
        await tx.invoice.update({ where: { id }, data: { status: 'CANCELLED' }, select: { id: true } });
      }

      const depois = await tx.invoice.findUniqueOrThrow({ where: { id }, select: INVOICE_SELECT });

      await registrarAuditoria(tx, {
        ator: user,
        origem,
        acao: NA_AUDITORIA[action].acao,
        entidade: 'fatura',
        entidadeId: id,
        resumo: `Fatura nº ${depois.number} ${NA_AUDITORIA[action].feito}`,
        antes: { status: atual.status, paidAt: atual.paidAt },
        depois: { status: depois.status, paidAt: depois.paidAt, ...baixa },
      });

      return depois;
    });

    return NextResponse.json(fatura);
  } catch (err) {
    if (err instanceof Refusal) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('Erro ao alterar fatura:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
