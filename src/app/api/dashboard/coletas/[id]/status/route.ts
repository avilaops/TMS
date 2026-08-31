import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    
    // Validar se é ADMIN ou OPERATION
    if (!session || !session.user || !['ADMIN', 'OPERATION'].includes(session.user.role)) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

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
