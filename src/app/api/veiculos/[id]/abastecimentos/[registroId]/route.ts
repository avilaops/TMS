import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import prisma from '@/lib/prisma';

/** Apaga um abastecimento lançado errado. O consumo dos vizinhos é refeito na próxima leitura. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; registroId: string }> }) {
  const { error } = await requireStaff({ pode: 'frota' });
  if (error) return error;

  try {
    const { id, registroId } = await params;
    const { count } = await prisma.fueling.deleteMany({ where: { id: registroId, vehicleId: id } });
    if (count === 0) return NextResponse.json({ error: 'Abastecimento não encontrado.' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Erro ao apagar abastecimento:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
