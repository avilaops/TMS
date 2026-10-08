import { NextResponse } from 'next/server';
import prisma, { transacao } from '@/lib/prisma';
import { requireStaff } from '@/lib/staff';
import { COLLECTION_STATUS, statusBadge } from '@/lib/format';
import { recordStatusChanges } from '@/lib/historico';

const MANIFEST_NOT_FOUND = 'Manifesto não encontrado.';
const COLLECTION_NOT_FOUND = 'Esta carga não está neste manifesto.';
const MANIFEST_CLOSED = 'Só dá para retirar carga de viagem em montagem ou em rota; esta já foi finalizada ou cancelada.';
const ALREADY_DELIVERED = 'Esta carga já foi entregue e não pode ser retirada da viagem.';
const CHANGED_MEANWHILE = 'A carga mudou de status enquanto você decidia. Atualize a página e tente de novo.';

/** Retira a carga da viagem: ela volta a "Coletado", livre para outro manifesto ou para cancelar. */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; coletaId: string }> }
) {
  try {
    const { user, error } = await requireStaff();
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

    // Em montagem a carga está reservada, ainda coletada; em rota, está na rua.
    // Nos dois casos ela sai da viagem como "Coletado".
    const expected = manifest.status === 'ASSEMBLING' ? 'COLLECTED' : 'ROUTE';

    if (manifest.status !== 'ASSEMBLING' && manifest.status !== 'ROUTE') {
      return NextResponse.json({ error: MANIFEST_CLOSED }, { status: 409 });
    }
    if (current.status === 'DELIVERED') {
      return NextResponse.json({ error: ALREADY_DELIVERED }, { status: 409 });
    }
    if (current.status !== expected) {
      return NextResponse.json(
        { error: `Só carga ${expected === 'ROUTE' ? 'em rota' : 'coletada'} pode ser retirada; esta está "${statusBadge(COLLECTION_STATUS, current.status).label}".` },
        { status: 409 }
      );
    }

    // Grava só se a viagem e a carga ainda estiverem como lidas acima: se a
    // baixa ou a liberação da saída chegou antes, a contagem é zero e a
    // resposta é 409. Só a carga que estava em rota muda de status, e é ela
    // que ganha linha no histórico, na mesma transação; a de viagem em
    // montagem sai "Coletado" como entrou.
    const changed = await transacao(async (tx) => {
      const { count } = await tx.collection.updateMany({
        where: { id: coletaId, manifestId, status: expected, manifest: { status: manifest.status } },
        data: { status: 'COLLECTED', manifestId: null },
      });
      if (count === 0) return false;

      if (expected === 'ROUTE') {
        await recordStatusChanges(tx, [
          { collectionId: coletaId, fromStatus: 'ROUTE', toStatus: 'COLLECTED', userId: user.id },
        ]);
      }
      return true;
    });
    if (!changed) {
      return NextResponse.json({ error: CHANGED_MEANWHILE }, { status: 409 });
    }

    const collection = await prisma.collection.findUnique({ where: { id: coletaId } });
    return NextResponse.json({ success: true, collection });
  } catch (error) {
    console.error('Erro ao retirar carga do manifesto:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
