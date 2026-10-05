import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import prisma from '@/lib/prisma';

export async function GET() {
  const { user, error } = await requireStaff();
  if (error) return error;

  try {
    const coletasCount = await prisma.collection.count();
    const manifestosCount = await prisma.manifest.count();
    const clientesCount = await prisma.client.count();
    const veiculosCount = await prisma.vehicle.count();

    const stats: Record<string, number> = {
      coletas: coletasCount,
      manifestos: manifestosCount,
      clientes: clientesCount,
      veiculos: veiculosCount,
    };

    // Receita é dado financeiro: só ADMIN, como em /api/financeiro. Para os
    // demais o campo nem vai na resposta.
    if (user.role === 'ADMIN') {
      const transacoes = await prisma.financialTransaction.findMany({
        where: { type: 'INCOME', status: 'PAID' }
      });
      stats.receita = transacoes.reduce((acc, t) => acc + t.amount, 0);
    }

    return NextResponse.json(stats);
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
