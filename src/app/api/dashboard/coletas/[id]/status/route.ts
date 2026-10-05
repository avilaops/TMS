import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireStaff } from '@/lib/staff';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error } = await requireStaff();
    if (error) return error;

    const collectionId = (await params).id;
    const { status } = await req.json();

    if (!status || !['CONFIRMED', 'CANCELLED', 'REJECTED'].includes(status)) {
      return NextResponse.json({ error: 'Status inválido' }, { status: 400 });
    }

    const updatedCollection = await prisma.collection.update({
      where: { id: collectionId },
      data: { status }
    });

    return NextResponse.json({ success: true, collection: updatedCollection });
  } catch (error) {
    console.error('Erro ao atualizar status da coleta:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
