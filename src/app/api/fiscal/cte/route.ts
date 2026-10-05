import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import prisma from '@/lib/prisma';

function generateCteKey() {
  const uf = '35'; // SP
  const aamm = new Date().toISOString().slice(2, 7).replace('-', '');
  const cnpj = '12345678000199';
  const mod = '57'; // CT-e
  const serie = '001';
  const number = Math.floor(Math.random() * 900000000) + 100000000;
  const type = '1';
  const code = Math.floor(Math.random() * 90000000) + 10000000;
  const digit = Math.floor(Math.random() * 9);
  return `${uf}${aamm}${cnpj}${mod}${serie}${number}${type}${code}${digit}`;
}

export async function POST(req: Request) {
  const { error } = await requireStaff();
  if (error) return error;

  try {
    const { collectionId } = await req.json();
    
    if (!collectionId) {
      return NextResponse.json({ error: 'Missing collectionId' }, { status: 400 });
    }

    // Simula a latência da comunicação com a Sefaz (1.5 segundos)
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Gera a chave de acesso fictícia
    const cteKey = generateCteKey();
    const cteNumber = Math.floor(Math.random() * 9000) + 1000;

    // Atualiza a Collection
    const updatedCollection = await prisma.collection.update({
      where: { id: collectionId },
      data: {
        cteKey,
        cteNumber,
        cteStatus: 'ISSUED',
        // Opcional: já marcar a minuta como "CONFIRMED" ou "ROUTE" se aplicável
      }
    });

    return NextResponse.json({
      message: 'CT-e emitido com sucesso',
      cteKey: updatedCollection.cteKey,
      cteNumber: updatedCollection.cteNumber
    });
  } catch (error) {
    console.error('Error issuing CT-e:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
