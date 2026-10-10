import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireStaff } from '@/lib/staff';
import { FATURAVEL, INVOICE_COLLECTION_SELECT } from '@/lib/faturas';

/**
 * Cargas prontas para faturar. Com `?clientId=`, as cargas daquele cliente; sem
 * ele, o resumo por cliente (quantas cargas e quanto), para a tela escolher por
 * onde começar. Também conta as entregues que ainda estão "a cotar", que só
 * entram em fatura depois de o operador informar o frete.
 */
export async function GET(req: Request) {
  const { error } = await requireStaff({ pode: 'faturamentoVer' });
  if (error) return error;

  try {
    const clientId = new URL(req.url).searchParams.get('clientId');

    if (clientId) {
      const cargas = await prisma.collection.findMany({
        where: { clientId, ...FATURAVEL },
        orderBy: { createdAt: 'asc' },
        select: INVOICE_COLLECTION_SELECT,
      });
      // Entregues sem valor: aparecem na tela para o operador informar o frete.
      const aCotar = await prisma.collection.findMany({
        where: { clientId, status: 'DELIVERED', invoiceId: null, freightValue: null },
        orderBy: { createdAt: 'asc' },
        select: INVOICE_COLLECTION_SELECT,
      });
      return NextResponse.json({ cargas, aCotar });
    }

    const grupos = await prisma.collection.groupBy({
      by: ['clientId'],
      where: FATURAVEL,
      _count: { _all: true },
      _sum: { freightValue: true },
    });
    const clientes = await prisma.client.findMany({
      where: { id: { in: grupos.map((g) => g.clientId) } },
      select: { id: true, companyName: true, tradeName: true },
    });
    const nome = new Map(clientes.map((c) => [c.id, c.tradeName || c.companyName]));

    return NextResponse.json(
      grupos
        .map((g) => ({
          clientId: g.clientId,
          cliente: nome.get(g.clientId) ?? '',
          cargas: g._count._all,
          total: Math.round(((g._sum.freightValue ?? 0) + Number.EPSILON) * 100) / 100,
        }))
        .sort((a, b) => a.cliente.localeCompare(b.cliente, 'pt-BR')),
    );
  } catch (error) {
    console.error('Erro ao listar cargas faturáveis:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
