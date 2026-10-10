import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import prisma, { transacao } from '@/lib/prisma';
import { Refusal } from '@/lib/cadastros';
import { firstIssue } from '@/lib/usuarios';
import { FROM_INVOICE_MESSAGE, TRANSACTION_SELECT, updateTransactionSchema } from '@/lib/financeiro';
import { CAMPOS_DO_LANCAMENTO, escolher, nadaMudou, origemDaRequisicao, registrarAuditoria, registrarAuditoriaDepois } from '@/lib/auditoria';

const NOT_FOUND = 'Lançamento não encontrado.';

/**
 * Edita, marca como pago (ou recebido) ou reabre um lançamento manual.
 *
 * Lançamento que veio de fatura não passa por aqui: quem o mantém em sincronia
 * com a fatura é o Faturamento, e mexer só nele deixaria a fatura "em aberto"
 * com o lançamento "pago" (ou o contrário).
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireStaff(["ADMIN"]);
  if (error) return error;

  try {
    const { id } = await params;
    const parsed = updateTransactionSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const { action, paidAt, paymentMethod, ...campos } = parsed.data;
    const origem = origemDaRequisicao(req);

    const lancamento = await transacao(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "FinancialTransaction" WHERE id = ${id} FOR UPDATE`;
      // O lançamento inteiro, como estava: é o "antes" da auditoria.
      const atual = await tx.financialTransaction.findUnique({ where: { id }, select: TRANSACTION_SELECT });
      if (!atual) throw new Refusal(NOT_FOUND, 404);
      if (atual.invoiceId) throw new Refusal(FROM_INVOICE_MESSAGE, 409);

      if (campos.clientId) {
        const cliente = await tx.client.findUnique({ where: { id: campos.clientId }, select: { id: true } });
        if (!cliente) throw new Refusal('Cliente não encontrado.', 400);
      }

      let situacao: { status: string; paidAt: Date | null; paymentMethod: string | null } | undefined;

      if (action === 'pagar') {
        if (atual.status === 'PAID') throw new Refusal('Este lançamento já está pago.', 409);
        situacao = { status: 'PAID', paidAt: paidAt ?? new Date(), paymentMethod: paymentMethod ?? null };
      } else if (action === 'reabrir') {
        if (atual.status !== 'PAID') throw new Refusal('Só lançamento pago pode ser reaberto.', 409);
        situacao = { status: 'PENDING', paidAt: null, paymentMethod: null };
      }

      const atualizado = await tx.financialTransaction.update({
        where: { id },
        data: {
          ...campos,
          ...situacao,
          // Sem `action`, data e forma de pagamento só se corrigem em lançamento já pago.
          ...(!action && atual.status === 'PAID' && paidAt !== undefined && paidAt !== null && { paidAt }),
          ...(!action && atual.status === 'PAID' && paymentMethod !== undefined && { paymentMethod }),
        },
        select: TRANSACTION_SELECT,
      });

      const antes = escolher(atual, CAMPOS_DO_LANCAMENTO);
      const depois = escolher(atualizado, CAMPOS_DO_LANCAMENTO);
      if (!nadaMudou(antes, depois)) {
        await registrarAuditoria(tx, {
          ator: user,
          origem,
          acao: action === 'pagar' ? 'lancamento.pagar' : action === 'reabrir' ? 'lancamento.reabrir' : 'lancamento.alterar',
          entidade: 'lancamento',
          entidadeId: id,
          resumo: `Lançamento "${atualizado.description}" ${action === 'pagar' ? 'pago' : action === 'reabrir' ? 'reaberto' : 'alterado'}`,
          antes,
          depois,
        });
      }

      return atualizado;
    });

    return NextResponse.json(lancamento);
  } catch (err) {
    if (err instanceof Refusal) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('Erro ao alterar lançamento:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

/** Exclui um lançamento manual. O de fatura sai quando a fatura é cancelada. */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireStaff(["ADMIN"]);
  if (error) return error;

  try {
    const { id } = await params;

    // O lançamento que vai sumir: depois de apagado, só a auditoria sabe o que ele era.
    const apagado = await prisma.financialTransaction.findUnique({ where: { id }, select: TRANSACTION_SELECT });

    const { count } = await prisma.financialTransaction.deleteMany({ where: { id, invoiceId: null } });
    if (count === 0) {
      const existe = await prisma.financialTransaction.findUnique({ where: { id }, select: { id: true } });
      return existe
        ? NextResponse.json({ error: FROM_INVOICE_MESSAGE }, { status: 409 })
        : NextResponse.json({ error: NOT_FOUND }, { status: 404 });
    }

    await registrarAuditoriaDepois(prisma, {
      ator: user,
      origem: origemDaRequisicao(req),
      acao: 'lancamento.excluir',
      entidade: 'lancamento',
      entidadeId: id,
      resumo: `Lançamento "${apagado?.description ?? id}" excluído`,
      antes: apagado ? escolher(apagado, CAMPOS_DO_LANCAMENTO) : null,
    });

    return NextResponse.json({ id, excluido: true });
  } catch (error) {
    console.error('Erro ao excluir lançamento:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
