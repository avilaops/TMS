import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const doc = searchParams.get('doc');

  if (!doc) {
    return NextResponse.json({ error: 'Documento é obrigatório' }, { status: 400 });
  }

  // Remove formatação do documento
  const cleanDoc = doc.replace(/\D/g, '');

  try {
    const minutas = await prisma.collection.findMany({
      where: {
        client: {
          cnpj: cleanDoc
        }
      },
      include: {
        client: true,
        manifest: {
          include: {
            driver: { include: { user: true } },
            vehicle: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    return NextResponse.json(minutas);
  } catch (error) {
    console.error('Error fetching rastreio:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
