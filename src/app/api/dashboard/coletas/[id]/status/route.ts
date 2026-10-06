import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireStaff } from '@/lib/staff';
import { canTransition, statusChangeSchema } from '@/lib/coletas';
import { firstIssue } from '@/lib/usuarios';
import { COLLECTION_STATUS, statusBadge } from '@/lib/format';

const NOT_FOUND = 'Coleta não encontrada.';
const IN_MANIFEST = 'Esta coleta está em um manifesto: retire a carga do manifesto antes de cancelar.';
const CHANGED_MEANWHILE = 'A coleta mudou de status enquanto você decidia. Atualize a página e tente de novo.';

const label = (status: string) => statusBadge(COLLECTION_STATUS, status).label;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error } = await requireStaff();
    if (error) return error;

    const collectionId = (await params).id;

    const parsed = statusChangeSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const { status, receiverName } = parsed.data;

    const current = await prisma.collection.findUnique({
      where: { id: collectionId },
      select: { status: true, manifestId: true }
    });
    if (!current) {
      return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
    }

    if (!canTransition(current.status, status)) {
      return NextResponse.json(
        { error: `Não é possível passar de "${label(current.status)}" para "${label(status)}".` },
        { status: 409 }
      );
    }

    const cancelling = status === 'CANCELLED';
    if (cancelling && current.manifestId !== null) {
      return NextResponse.json({ error: IN_MANIFEST }, { status: 409 });
    }

    // Grava só se a coleta ainda estiver no status lido acima: de duas chamadas
    // simultâneas, uma encontra zero linhas e recebe 409.
    const { count } = await prisma.collection.updateMany({
      where: {
        id: collectionId,
        status: current.status,
        ...(cancelling ? { manifestId: null } : {}),
      },
      data: {
        status,
        ...(status === 'DELIVERED' ? { receiverName } : {}),
      },
    });
    if (count === 0) {
      return NextResponse.json({ error: CHANGED_MEANWHILE }, { status: 409 });
    }

    const updatedCollection = await prisma.collection.findUnique({ where: { id: collectionId } });
    return NextResponse.json({ success: true, collection: updatedCollection });
  } catch (error) {
    console.error('Erro ao atualizar status da coleta:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
