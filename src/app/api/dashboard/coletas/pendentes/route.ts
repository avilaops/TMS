import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    
    // Validar se é ADMIN ou OPERATION
    if (!session || !session.user || !['ADMIN', 'OPERATION'].includes(session.user.role)) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const pendentes = await prisma.collection.findMany({
      where: { status: 'PENDING' },
      include: {
        client: {
          select: { companyName: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    return NextResponse.json(pendentes);
  } catch (error) {
    console.error('Erro ao buscar coletas pendentes:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
