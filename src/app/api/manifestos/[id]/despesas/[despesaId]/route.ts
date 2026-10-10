import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { transacao } from '@/lib/prisma';
import { requireStaff } from '@/lib/staff';
import { Refusal } from '@/lib/cadastros';
import { firstIssue } from '@/lib/usuarios';
import {
  CAMPOS_DA_DESPESA,
  EXPENSE_ALREADY_REVIEWED,
  EXPENSE_NOT_FOUND,
  EXPENSE_NOT_PENDING,
  EXPENSE_TYPE_LABEL,
  TRIP_EXPENSE_SELECT,
  centroDeCustoDaViagem,
  codigoDaViagem,
  descricaoDoLancamento,
  rotuloDaDespesa,
  tripExpenseActionSchema,
} from '@/lib/viagem';
import { escolher, origemDaRequisicao, registrarAuditoria } from '@/lib/auditoria';

type Contexto = { params: Promise<{ id: string; despesaId: string }> };

/**
 * Lê a despesa segurando a linha até o fim da transação: aprovar duas vezes ao
 * mesmo tempo criaria dois lançamentos no Financeiro; a segunda chamada espera
 * e já encontra a despesa aprovada. Despesa de outra viagem é 404, como a que não existe.
 */
async function segurarDespesa(tx: Prisma.TransactionClient, manifestId: string, despesaId: string) {
  await tx.$queryRaw`SELECT id FROM "TripExpense" WHERE id = ${despesaId} FOR UPDATE`;
  const despesa = await tx.tripExpense.findFirst({ where: { id: despesaId, manifestId }, select: TRIP_EXPENSE_SELECT });
  if (!despesa) throw new Refusal(EXPENSE_NOT_FOUND, 404);
  return despesa;
}

/**
 * Aprova ou recusa uma despesa pendente. Só quem lança no financeiro
 * (`financeiro`: administrador e financeiro): aprovar cria o
 * lançamento a pagar (ou já pago) no Financeiro, na mesma transação, como a
 * manutenção e o adiantamento fazem — ou ficam os dois, ou nenhum.
 *
 * O lançamento leva a categoria do tipo da despesa ("Pedágio", "Combustível"...)
 * e a viagem como centro de custo. Recusar desfaz o abastecimento que a despesa
 * de combustível tinha gerado na frota.
 */
export async function PATCH(req: Request, { params }: Contexto) {
  const { user, error } = await requireStaff({ pode: 'financeiro' });
  if (error) return error;

  try {
    const { id: manifestId, despesaId } = await params;
    const origem = origemDaRequisicao(req);

    const parsed = tripExpenseActionSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const acao = parsed.data;

    const despesa = await transacao(async (tx) => {
      const atual = await segurarDespesa(tx, manifestId, despesaId);
      if (atual.status !== 'PENDING') throw new Refusal(EXPENSE_ALREADY_REVIEWED, 409);
      const conferida = { reviewedById: user.id, reviewedAt: new Date() };

      if (acao.action === 'recusar') {
        const recusada = await tx.tripExpense.update({
          where: { id: despesaId },
          data: { status: 'REJECTED', fuelingId: null, ...conferida },
          select: TRIP_EXPENSE_SELECT,
        });
        if (atual.fuelingId) await tx.fueling.deleteMany({ where: { id: atual.fuelingId } });

        await registrarAuditoria(tx, {
          ator: user,
          origem,
          acao: 'despesa-viagem.recusar',
          entidade: 'despesa-viagem',
          entidadeId: despesaId,
          resumo: `${rotuloDaDespesa(atual.type)} da viagem #${codigoDaViagem(manifestId)} recusado`,
          antes: escolher(atual, CAMPOS_DA_DESPESA),
          depois: escolher(recusada, CAMPOS_DA_DESPESA),
        });
        return recusada;
      }

      const paga = acao.paid === true;
      const lancamento = await tx.financialTransaction.create({
        data: {
          type: 'EXPENSE',
          amount: atual.amount,
          description: descricaoDoLancamento(atual.type, manifestId),
          dueDate: atual.date,
          status: paga ? 'PAID' : 'PENDING',
          paidAt: paga ? new Date() : null,
          paymentMethod: paga ? (acao.paymentMethod ?? null) : null,
          category: (EXPENSE_TYPE_LABEL as Record<string, string>)[atual.type] ?? atual.type,
          costCenter: centroDeCustoDaViagem(manifestId),
          // Quem lançou é, em geral, quem pagou do bolso: é para ele o reembolso.
          counterparty: atual.createdBy?.name ?? null,
          notes: atual.notes,
        },
        select: { id: true },
      });

      const aprovada = await tx.tripExpense.update({
        where: { id: despesaId },
        data: { status: 'APPROVED', transactionId: lancamento.id, ...conferida },
        select: TRIP_EXPENSE_SELECT,
      });

      await registrarAuditoria(tx, {
        ator: user,
        origem,
        acao: 'despesa-viagem.aprovar',
        entidade: 'despesa-viagem',
        entidadeId: despesaId,
        resumo: `${rotuloDaDespesa(atual.type)} da viagem #${codigoDaViagem(manifestId)} aprovado: lançamento ${paga ? 'pago' : 'a pagar'} no Financeiro`,
        antes: escolher(atual, CAMPOS_DA_DESPESA),
        depois: escolher(aprovada, CAMPOS_DA_DESPESA),
      });
      return aprovada;
    });

    return NextResponse.json(despesa);
  } catch (err) {
    if (err instanceof Refusal) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('Erro ao conferir despesa da viagem:', err);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

/**
 * Exclui uma despesa pendente (lançada errada), com o abastecimento que ela
 * tinha gerado. A aprovada já está no Financeiro e a recusada é histórico: as
 * duas ficam.
 */
export async function DELETE(req: Request, { params }: Contexto) {
  const { user, error } = await requireStaff({ pode: 'manifestos' });
  if (error) return error;

  try {
    const { id: manifestId, despesaId } = await params;
    const origem = origemDaRequisicao(req);

    await transacao(async (tx) => {
      const atual = await segurarDespesa(tx, manifestId, despesaId);
      if (atual.status !== 'PENDING') throw new Refusal(EXPENSE_NOT_PENDING, 409);

      await tx.tripExpense.delete({ where: { id: despesaId } });
      if (atual.fuelingId) await tx.fueling.deleteMany({ where: { id: atual.fuelingId } });

      await registrarAuditoria(tx, {
        ator: user,
        origem,
        acao: 'despesa-viagem.excluir',
        entidade: 'despesa-viagem',
        entidadeId: despesaId,
        resumo: `${rotuloDaDespesa(atual.type)} da viagem #${codigoDaViagem(manifestId)} excluído`,
        antes: escolher(atual, CAMPOS_DA_DESPESA),
      });
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Refusal) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('Erro ao excluir despesa da viagem:', err);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
