import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireStaff } from '@/lib/staff';
import { pendingDeliveriesMessage } from '@/lib/manifestos';
import { MANIFEST_STATUS, statusBadge } from '@/lib/format';

const NOT_FOUND = 'Manifesto não encontrado.';
const CHANGED_MEANWHILE = 'A viagem mudou enquanto você decidia. Atualize a página e tente de novo.';

/** Encerra a viagem. Só com todas as cargas entregues ou retiradas. */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error } = await requireStaff();
    if (error) return error;

    const manifestId = (await params).id;

    const current = await prisma.manifest.findUnique({
      where: { id: manifestId },
      select: { status: true }
    });
    if (!current) {
      return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
    }

    if (current.status !== 'ROUTE') {
      return NextResponse.json(
        { error: `Só viagem em rota pode ser finalizada; esta está "${statusBadge(MANIFEST_STATUS, current.status).label}".` },
        { status: 409 }
      );
    }

    const pending = await prisma.collection.count({ where: { manifestId, status: 'ROUTE' } });
    if (pending > 0) {
      return NextResponse.json({ error: pendingDeliveriesMessage(pending) }, { status: 409 });
    }

    // Grava só se a viagem ainda estiver em rota e sem carga pendente: de duas
    // chamadas simultâneas, uma encontra zero linhas e recebe 409.
    const { count } = await prisma.manifest.updateMany({
      where: { id: manifestId, status: 'ROUTE', collections: { none: { status: 'ROUTE' } } },
      data: { status: 'FINISHED' },
    });
    if (count === 0) {
      return NextResponse.json({ error: CHANGED_MEANWHILE }, { status: 409 });
    }

    const manifest = await prisma.manifest.findUnique({ where: { id: manifestId } });
    return NextResponse.json({ success: true, manifest });
  } catch (error) {
    console.error('Erro ao finalizar manifesto:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
