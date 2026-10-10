import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireStaff } from '@/lib/staff';
import { NOTA_NAO_ENCONTRADA } from '@/lib/nfe';
import { respostaDoDanfe } from '@/lib/fiscal-mcp';

/**
 * O DANFE (PDF) da nota, gerado na hora pelo serviço fiscal a partir do XML
 * guardado. Quem baixa o XML baixa o DANFE: a mesma capacidade.
 *
 * Nada é gravado: o PDF não fica no banco. Sem `FISCAL_MCP_URL` a rota
 * responde 503; serviço fora do ar ou XML recusado, 502; demora, 504.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireStaff({ pode: 'fiscalVer' });
  if (error) return error;

  try {
    const { id } = await params;
    // Nota de outra empresa não aparece para esta: mesma resposta do id que não existe.
    const nota = await prisma.fiscalDocument.findFirst({ where: { id }, select: { accessKey: true, xml: true } });
    if (!nota) return NextResponse.json({ error: NOTA_NAO_ENCONTRADA }, { status: 404 });

    return await respostaDoDanfe(nota.accessKey, nota.xml);
  } catch (err) {
    console.error('Erro ao gerar o DANFE da nota:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
