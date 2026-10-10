import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireStaff } from '@/lib/staff';
import { MANIFEST_NOT_FOUND_MESSAGE } from '@/lib/manifestos';
import { lerMapaDaViagem } from '@/lib/mapa-db';

/**
 * O mapa da viagem para o painel: as paradas na ordem, com o ponto de cada uma
 * (o endereço localizado, ou o centro da cidade), a origem e, com a viagem em
 * rota, a última posição que o motorista compartilhou.
 *
 * Vale para quem lê viagens. Não consulta serviço de fora: os pontos já estão
 * na carga ou na tabela de municípios (src/lib/mapa.ts).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireStaff({ pode: 'manifestosVer' });
  if (error) return error;

  try {
    const mapa = await lerMapaDaViagem(prisma, { id: (await params).id });
    if (!mapa) return NextResponse.json({ error: MANIFEST_NOT_FOUND_MESSAGE }, { status: 404 });
    return NextResponse.json(mapa);
  } catch (error) {
    console.error('Erro ao montar o mapa da viagem:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
