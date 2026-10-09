import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import prisma from '@/lib/prisma';
import { entregasPorDia, semanaCorrente } from '@/lib/relatorios';

export async function GET() {
  const { user, error } = await requireStaff();
  if (error) return error;

  try {
    const coletasCount = await prisma.collection.count();
    const manifestosCount = await prisma.manifest.count();
    const clientesCount = await prisma.client.count();
    const veiculosCount = await prisma.vehicle.count();

    // Entregas de cada dia da semana corrente (segunda a domingo), pela hora em
    // que a carga virou "Entregue" no histórico.
    const hoje = new Date();
    const semana = semanaCorrente(hoje);
    const entregues = await prisma.collectionStatusHistory.findMany({
      where: { toStatus: 'DELIVERED', createdAt: { gte: semana.inicio, lt: semana.fim } },
      select: { createdAt: true },
    });

    const stats: Record<string, number | number[]> = {
      coletas: coletasCount,
      manifestos: manifestosCount,
      clientes: clientesCount,
      veiculos: veiculosCount,
      entregasDaSemana: entregasPorDia(entregues.map((linha) => linha.createdAt), hoje),
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
