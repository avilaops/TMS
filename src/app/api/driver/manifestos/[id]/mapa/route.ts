import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireDriver } from '@/lib/driver';
import { TRIP_NOT_FOUND } from '@/lib/viagem';
import { lerMapaDaViagem } from '@/lib/mapa-db';

/**
 * O mapa da viagem para o motorista: as paradas dele, na ordem, com o ponto de
 * cada uma. Só a viagem liberada deste motorista: a de outro, a em montagem e a
 * finalizada respondem 404, como a que não existe.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { driverId, error } = await requireDriver();
  if (error) return error;

  try {
    const mapa = await lerMapaDaViagem(prisma, { id: (await params).id, driverId, status: 'ROUTE' });
    if (!mapa) return NextResponse.json({ error: TRIP_NOT_FOUND }, { status: 404 });
    return NextResponse.json(mapa);
  } catch (err) {
    console.error('Erro ao montar o mapa do motorista:', err);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
