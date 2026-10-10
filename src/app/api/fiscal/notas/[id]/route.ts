import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireStaff } from '@/lib/staff';
import { NOTA_NAO_ENCONTRADA, NOTA_SELECT } from '@/lib/nfe';
import { sugestaoDaNota } from '@/lib/nfe-db';

/** Uma nota importada, com a carga sugerida enquanto ela não estiver ligada a nenhuma. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireStaff();
  if (error) return error;

  try {
    const { id } = await params;
    // Nota de outra empresa não aparece para esta: mesma resposta do id que não existe.
    const nota = await prisma.fiscalDocument.findFirst({ where: { id }, select: NOTA_SELECT });
    if (!nota) return NextResponse.json({ error: NOTA_NAO_ENCONTRADA }, { status: 404 });

    return NextResponse.json({ nota, ...(await sugestaoDaNota(prisma, nota)) });
  } catch (err) {
    console.error('Erro ao buscar nota fiscal:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
