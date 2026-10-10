import { NextResponse } from 'next/server';
import prisma, { transacao } from '@/lib/prisma';
import { requireStaff } from '@/lib/staff';
import { firstIssue } from '@/lib/usuarios';
import { ManifestError, lockManifest } from '@/lib/manifestos-db';
import { TRIP_CANCELLED, TRIP_EXPENSE_SELECT, TRIP_NOT_FOUND, createTripExpenseSchema, totalLancado } from '@/lib/viagem';
import { lancarDespesa } from '@/lib/viagem-db';
import { origemDaRequisicao } from '@/lib/auditoria';

/**
 * Despesas da viagem (pedágio, combustível, alimentação...), da mais recente
 * para a mais antiga, com quem lançou cada uma e o total do que não foi
 * recusado. Quem monta viagem lê e lança; o financeiro lê; aprovar é de quem
 * lança no financeiro (/api/manifestos/[id]/despesas/[despesaId]).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireStaff({ pode: 'manifestosVer' });
  if (error) return error;

  try {
    const manifestId = (await params).id;
    const viagem = await prisma.manifest.findUnique({ where: { id: manifestId }, select: { id: true } });
    if (!viagem) return NextResponse.json({ error: TRIP_NOT_FOUND }, { status: 404 });

    const despesas = await prisma.tripExpense.findMany({
      where: { manifestId },
      select: TRIP_EXPENSE_SELECT,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    });
    return NextResponse.json({ despesas, total: totalLancado(despesas) });
  } catch (error) {
    console.error('Erro ao listar as despesas da viagem:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

/** Lança uma despesa na viagem. Nasce pendente; só a viagem cancelada não recebe. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user, error } = await requireStaff({ pode: 'manifestos' });
    if (error) return error;

    const manifestId = (await params).id;
    const origem = origemDaRequisicao(req);

    const parsed = createTripExpenseSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }

    const despesa = await transacao(async (tx) => {
      const viagem = await lockManifest(tx, manifestId);
      if (viagem.status === 'CANCELLED') throw new ManifestError(409, TRIP_CANCELLED);
      return lancarDespesa(tx, { viagem, despesa: parsed.data, ator: user, origem });
    });

    return NextResponse.json(despesa, { status: 201 });
  } catch (error) {
    if (error instanceof ManifestError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Erro ao lançar despesa da viagem:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
