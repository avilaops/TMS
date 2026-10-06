import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import prisma from '@/lib/prisma';
import { STATUS_HISTORY_SELECT } from '@/lib/historico';

const NOT_FOUND = 'Coleta não encontrada.';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireStaff();
  if (error) return error;

  try {
    const { id } = await params;

    const coleta = await prisma.collection.findUnique({ where: { id }, select: { id: true } });
    if (!coleta) {
      return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
    }

    // Coleta anterior ao histórico devolve lista vazia, não erro.
    const historico = await prisma.collectionStatusHistory.findMany({
      where: { collectionId: id },
      select: STATUS_HISTORY_SELECT,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return NextResponse.json(historico);
  } catch (error) {
    console.error('Error fetching collection status history:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
