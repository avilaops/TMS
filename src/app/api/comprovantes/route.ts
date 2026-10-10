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
 *
 * `?ressalva=1` traz só as entregas com ressalva, em qualquer situação (ou na
 * de `?status`, se vier junto), da mais nova para a mais antiga: ali não é
 * fila, é o que aconteceu por último. `?status=REJECTED` são os devolvidos ao
 * motorista, à espera das fotos novas.
 */
export async function GET(req: Request) {
  try {
    const { error } = await requireStaff({ pode: 'comprovantes' });
    if (error) return error;

    const params = new URL(req.url).searchParams;
    const comRessalva = params.get('ressalva') === '1';
    const status = params.get('status') ?? (comRessalva ? null : 'SUBMITTED');
    if (status !== null && !(PROOF_STATUSES as readonly string[]).includes(status)) {
      return NextResponse.json({ error: PROOF_STATUS_FILTER_MESSAGE }, { status: 400 });
    }

    const comprovantes = await prisma.proofOfDelivery.findMany({
      where: { ...(status !== null && { status }), ...(comRessalva && { exceptionType: { not: null } }) },
      orderBy: comRessalva ? [{ createdAt: 'desc' }, { id: 'asc' }] : [{ createdAt: 'asc' }, { id: 'asc' }],
      take: PROOF_LIST_LIMIT,
      select: PROOF_LIST_SELECT,
    });

    return NextResponse.json(comprovantes);
  } catch (error) {
    console.error('Erro ao listar comprovantes:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
