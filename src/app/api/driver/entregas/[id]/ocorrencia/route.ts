import { NextResponse } from 'next/server';
import { transacao } from '@/lib/prisma';
import { requireDriver } from '@/lib/driver';
import { Refusal } from '@/lib/cadastros';
import { firstIssue } from '@/lib/usuarios';
import { DELIVERY_NOT_FOUND_MESSAGE } from '@/lib/entregas';
import { driverOccurrenceSchema, tituloDoMotorista } from '@/lib/ocorrencias';
import { abrirOcorrencia } from '@/lib/ocorrencias-db';

/**
 * Ocorrência registrada pelo motorista numa entrega (o `[id]` é o da carga).
 *
 * Só vale para carga de uma viagem liberada deste motorista: sem isso qualquer
 * motorista logado abriria chamado na carga de outro. Nasce como chamado
 * interno, ligado à carga e sem `clientId`: o que o motorista escreveu é para a
 * equipe, e o portal só mostra chamado que tem o cliente como dono.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { driverId, userId, error } = await requireDriver();
  if (error) return error;

  try {
    const collectionId = (await params).id;
    const parsed = driverOccurrenceSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const { type, description } = parsed.data;

    const ocorrencia = await transacao(async (tx) => {
      const carga = await tx.collection.findFirst({
        where: { id: collectionId, manifest: { driverId, status: 'ROUTE' } },
        select: { id: true, receiver: true },
      });
      if (!carga) throw new Refusal(DELIVERY_NOT_FOUND_MESSAGE, 404);

      return abrirOcorrencia(tx, {
        type,
        title: tituloDoMotorista(type, carga.receiver),
        description,
        collectionId: carga.id,
        clientId: null,
        openedById: userId,
        origin: 'STAFF',
      });
    });

    return NextResponse.json({ success: true, id: ocorrencia.id, number: ocorrencia.number }, { status: 201 });
  } catch (err) {
    if (err instanceof Refusal) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('Erro ao registrar ocorrência do motorista:', err);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
