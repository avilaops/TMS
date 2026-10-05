import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import prisma from '@/lib/prisma';

export async function GET() {
  const { error } = await requireStaff();
  if (error) return error;

  try {
    const coletasCount = await prisma.collection.count();
    const manifestosCount = await prisma.manifest.count();
    const clientesCount = await prisma.client.count();
    const veiculosCount = await prisma.vehicle.count();

    // Calculando Receita Total
    const transacoes = await prisma.financialTransaction.findMany({
      where: { type: 'INCOME', status: 'PAID' }
    });
    const receitaTotal = transacoes.reduce((acc, t) => acc + t.amount, 0);

    return NextResponse.json({
      coletas: coletasCount,
      manifestos: manifestosCount,
      clientes: clientesCount,
      veiculos: veiculosCount,
      receita: receitaTotal
    });
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
