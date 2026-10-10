import { NextResponse } from 'next/server';
import prisma, { transacao } from '@/lib/prisma';
import { requireDriver } from '@/lib/driver';
import { Refusal } from '@/lib/cadastros';
import { firstIssue } from '@/lib/usuarios';
import { DRIVER_EXPENSE_SELECT, TRIP_NOT_FOUND, createTripExpenseSchema, totalLancado } from '@/lib/viagem';
import { lancarDespesa } from '@/lib/viagem-db';
import { origemDaRequisicao } from '@/lib/auditoria';

type Contexto = { params: Promise<{ id: string }> };

/**
 * Despesas que o motorista lançou na viagem dele (o `[id]` é o do manifesto).
 *
 * Só vale para viagem liberada deste motorista: a de outro, a em montagem e a
 * finalizada respondem 404, como a que não existe. Ele vê as despesas que ele
 * mesmo lançou e o total delas — as que o painel lançou e o que foi para o
 * Financeiro não vão para o aparelho.
 */
export async function GET(_req: Request, { params }: Contexto) {
  const { driverId, userId, error } = await requireDriver();
  if (error) return error;

  try {
    const manifestId = (await params).id;
    const viagem = await prisma.manifest.findFirst({ where: { id: manifestId, driverId, status: 'ROUTE' }, select: { id: true } });
    if (!viagem) return NextResponse.json({ error: TRIP_NOT_FOUND }, { status: 404 });

    const despesas = await prisma.tripExpense.findMany({
      where: { manifestId, createdById: userId },
      select: DRIVER_EXPENSE_SELECT,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    });
    return NextResponse.json({ despesas, total: totalLancado(despesas) });
  } catch (err) {
    console.error('Erro ao listar despesas do motorista:', err);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

/** O motorista lança uma despesa na viagem dele. Nasce pendente, para o administrador aprovar. */
export async function POST(req: Request, { params }: Contexto) {
  const { driverId, userId, error } = await requireDriver();
  if (error) return error;

  try {
    const manifestId = (await params).id;
    const origem = origemDaRequisicao(req);

    const parsed = createTripExpenseSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }

    const despesa = await transacao(async (tx) => {
      const viagem = await tx.manifest.findFirst({
        where: { id: manifestId, driverId, status: 'ROUTE' },
        select: { id: true, vehicleId: true, driverId: true },
      });
      if (!viagem) throw new Refusal(TRIP_NOT_FOUND, 404);

      // Quem fez, para a auditoria: o usuário do motorista.
      const usuario = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, name: true, role: true } });
      const criada = await lancarDespesa(tx, { viagem, despesa: parsed.data, ator: usuario, origem });

      return tx.tripExpense.findUniqueOrThrow({ where: { id: criada.id }, select: DRIVER_EXPENSE_SELECT });
    });

    return NextResponse.json(despesa, { status: 201 });
  } catch (err) {
    if (err instanceof Refusal) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('Erro ao lançar despesa do motorista:', err);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
