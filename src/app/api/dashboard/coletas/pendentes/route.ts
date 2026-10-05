import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireStaff } from '@/lib/staff';

export async function GET(req: Request) {
  try {
    const { error } = await requireStaff();
    if (error) return error;

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
