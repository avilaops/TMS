import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireStaff } from '@/lib/staff';
import {
  PROOF_LIST_LIMIT,
  PROOF_LIST_SELECT,
  PROOF_STATUSES,
  PROOF_STATUS_FILTER_MESSAGE,
} from '@/lib/entregas';

/**
 * Fila de comprovantes do painel. Sem `?status`, os que aguardam conferência.
 * O mais antigo vem primeiro: é fila.
 */
export async function GET(req: Request) {
  try {
    const { error } = await requireStaff({ pode: 'comprovantes' });
    if (error) return error;

    const status = new URL(req.url).searchParams.get('status') ?? 'SUBMITTED';
    if (!(PROOF_STATUSES as readonly string[]).includes(status)) {
      return NextResponse.json({ error: PROOF_STATUS_FILTER_MESSAGE }, { status: 400 });
    }

    const comprovantes = await prisma.proofOfDelivery.findMany({
      where: { status },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: PROOF_LIST_LIMIT,
      select: PROOF_LIST_SELECT,
    });

    return NextResponse.json(comprovantes);
  } catch (error) {
    console.error('Erro ao listar comprovantes:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
