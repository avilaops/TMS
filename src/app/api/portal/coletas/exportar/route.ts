import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requirePortalClient } from '@/lib/portal';
import { MAX_LINHAS_DA_EXPORTACAO, csvDasColetas, periodoDaExportacao } from '@/lib/portal-cliente';

/**
 * As coletas do cliente logado no período (`de` e `ate`, `AAAA-MM-DD`; sem
 * eles, os últimos 30 dias), em CSV para abrir no Excel. O arquivo é montado
 * aqui no servidor, só com as cargas do `clientId` da sessão.
 */
export async function GET(req: Request) {
  const { clientId, error } = await requirePortalClient();
  if (error) return error;

  try {
    const { searchParams } = new URL(req.url);
    const periodo = periodoDaExportacao(searchParams.get('de'), searchParams.get('ate'));
    if (!periodo.ok) return NextResponse.json({ error: periodo.erro }, { status: 400 });

    const coletas = await prisma.collection.findMany({
      where: { clientId, createdAt: { gte: periodo.inicio, lt: periodo.fim } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: MAX_LINHAS_DA_EXPORTACAO,
      select: {
        trackingCode: true,
        createdAt: true,
        destination: true,
        receiver: true,
        volumes: true,
        weight: true,
        freightValue: true,
        status: true,
      },
    });

    return new NextResponse(csvDasColetas(coletas), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="coletas-${periodo.de}-a-${periodo.ate}.csv"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    console.error('Erro ao exportar coletas do portal:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
