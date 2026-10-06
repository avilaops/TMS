import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireStaff } from '@/lib/staff';
import { COLLECTION_STATUS, statusBadge } from '@/lib/format';

const MANIFEST_NOT_FOUND = 'Manifesto não encontrado.';
const COLLECTION_NOT_FOUND = 'Esta carga não está neste manifesto.';
const MANIFEST_NOT_IN_ROUTE = 'Só dá para retirar carga de viagem em rota; esta já foi finalizada.';
const ALREADY_DELIVERED = 'Esta carga já foi entregue e não pode ser retirada da viagem.';
const CHANGED_MEANWHILE = 'A carga mudou de status enquanto você decidia. Atualize a página e tente de novo.';

/** Retira a carga da viagem: ela volta a "Coletado", livre para outro manifesto ou para cancelar. */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; coletaId: string }> }
) {
  try {
    const { error } = await requireStaff();
    if (error) return error;

    const { id: manifestId, coletaId } = await params;

    const manifest = await prisma.manifest.findUnique({
      where: { id: manifestId },
      select: { status: true }
    });
    if (!manifest) {
      return NextResponse.json({ error: MANIFEST_NOT_FOUND }, { status: 404 });
    }

    const current = await prisma.collection.findFirst({
      where: { id: coletaId, manifestId },
      select: { status: true }
    });
    if (!current) {
      return NextResponse.json({ error: COLLECTION_NOT_FOUND }, { status: 404 });
    }

    if (manifest.status !== 'ROUTE') {
      return NextResponse.json({ error: MANIFEST_NOT_IN_ROUTE }, { status: 409 });
    }
    if (current.status === 'DELIVERED') {
      return NextResponse.json({ error: ALREADY_DELIVERED }, { status: 409 });
    }
    if (current.status !== 'ROUTE') {
      return NextResponse.json(
        { error: `Só carga em rota pode ser retirada; esta está "${statusBadge(COLLECTION_STATUS, current.status).label}".` },
        { status: 409 }
      );
    }

    // Grava só se a carga ainda estiver em rota neste manifesto: se a baixa
    // chegou antes, a contagem é zero e a resposta é 409.
    const { count } = await prisma.collection.updateMany({
      where: { id: coletaId, manifestId, status: 'ROUTE' },
      data: { status: 'COLLECTED', manifestId: null },
    });
    if (count === 0) {
      return NextResponse.json({ error: CHANGED_MEANWHILE }, { status: 409 });
    }

    const collection = await prisma.collection.findUnique({ where: { id: coletaId } });
    return NextResponse.json({ success: true, collection });
  } catch (error) {
    console.error('Erro ao retirar carga do manifesto:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
