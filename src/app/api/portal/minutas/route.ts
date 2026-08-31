import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requirePortalClient } from '@/lib/portal';

export async function GET() {
  const { clientId, error } = await requirePortalClient();
  if (error) return error;

  try {
    const collections = await prisma.collection.findMany({
      where: { clientId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      // Campos explícitos: o cliente não precisa (nem deve) receber dados
      // internos do motorista, do manifesto ou de outras empresas.
      select: {
        id: true,
        sender: true,
        receiver: true,
        origin: true,
        destination: true,
        volumes: true,
        weight: true,
        invoiceValue: true,
        status: true,
        createdAt: true,
        driver: { select: { user: { select: { name: true } } } },
      },
    });

    return NextResponse.json(collections);
  } catch (error) {
    console.error('Error fetching portal minutas:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
