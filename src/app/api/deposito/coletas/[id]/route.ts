import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireStaff } from '@/lib/staff';
import { CARGA_NAO_ENCONTRADA, cargaConferida } from '@/lib/deposito';
import { lerCarga } from '@/lib/deposito-db';

/**
 * A carga com os volumes, um por sequência: os conferidos com situação, peso,
 * avaria e posição; os outros "a conferir", com o código que a etiqueta leva.
 * É o que a página de etiquetas imprime. Sem dado financeiro.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireStaff();
  if (error) return error;

  try {
    const { id } = await params;
    const carga = await lerCarga(prisma, { id });
    if (!carga) return NextResponse.json({ error: CARGA_NAO_ENCONTRADA }, { status: 404 });
    return NextResponse.json(cargaConferida(carga));
  } catch (error) {
    console.error('Erro ao buscar a carga no depósito:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
