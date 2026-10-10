import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requirePortalClient } from '@/lib/portal';
import { NOTA_NAO_ENCONTRADA } from '@/lib/nfe';
import { respostaComXml } from '@/lib/nfe-db';

/**
 * O XML de uma nota ligada a uma coleta do cliente logado, para baixar.
 *
 * O filtro pelo `clientId` da coleta é o que separa um cliente do outro: nota
 * de coleta de outro cliente (ou nota sem coleta) responde 404, igual a id que
 * não existe.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; notaId: string }> }) {
  const { clientId, error } = await requirePortalClient();
  if (error) return error;

  try {
    const { id, notaId } = await params;
    const nota = await prisma.fiscalDocument.findFirst({
      where: { id: notaId, collectionId: id, collection: { clientId } },
      select: { accessKey: true, xml: true },
    });
    if (!nota) return NextResponse.json({ error: NOTA_NAO_ENCONTRADA }, { status: 404 });

    return respostaComXml(nota.accessKey, nota.xml);
  } catch (err) {
    console.error('Erro ao baixar o XML da nota no portal:', err);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
