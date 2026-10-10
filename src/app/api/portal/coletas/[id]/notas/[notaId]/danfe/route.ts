import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requirePortalClient } from '@/lib/portal';
import { NOTA_NAO_ENCONTRADA } from '@/lib/nfe';
import { respostaDoDanfe } from '@/lib/fiscal-mcp';

/**
 * O DANFE (PDF) de uma nota ligada a uma coleta do cliente logado.
 *
 * A regra de acesso é a do XML (a rota de cima): o filtro pelo `clientId` da
 * coleta separa um cliente do outro, e nota de coleta de outro cliente (ou
 * nota sem coleta) responde 404, igual a id que não existe. O serviço fiscal
 * só é chamado depois de a nota ser achada.
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

    return await respostaDoDanfe(nota.accessKey, nota.xml);
  } catch (err) {
    console.error('Erro ao gerar o DANFE da nota no portal:', err);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
