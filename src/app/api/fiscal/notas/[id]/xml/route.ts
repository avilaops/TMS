import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireStaff } from '@/lib/staff';
import { NOTA_NAO_ENCONTRADA } from '@/lib/nfe';
import { respostaComXml } from '@/lib/nfe-db';

/** O XML original da nota, como foi importado, para baixar. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireStaff();
  if (error) return error;

  try {
    const { id } = await params;
    const nota = await prisma.fiscalDocument.findFirst({ where: { id }, select: { accessKey: true, xml: true } });
    if (!nota) return NextResponse.json({ error: NOTA_NAO_ENCONTRADA }, { status: 404 });

    return respostaComXml(nota.accessKey, nota.xml);
  } catch (err) {
    console.error('Erro ao baixar o XML da nota:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
