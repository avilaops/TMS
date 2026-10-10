import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import { pode } from '@/lib/permissoes';
import prisma from '@/lib/prisma';
import { entregasPorDia, semanaCorrente } from '@/lib/relatorios';
import { diaNoBrasil, valorRealizado } from '@/lib/financeiro';

export async function GET() {
  const { user, error } = await requireStaff({ pode: 'painel' });
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

    // O que os cartões mostram em destaque e em segundo plano. Carga ativa é a
    // que ainda não terminou: nem entregue, nem cancelada, nem recusada.
    const coletasPorStatus = await prisma.collection.groupBy({ by: ['status'], _count: { _all: true } });
    const viagensPorStatus = await prisma.manifest.groupBy({ by: ['status'], _count: { _all: true } });
    const clientesAtivos = await prisma.client.count({ where: { active: true } });
    const motoristasCount = await prisma.driver.count();
    const quantas = (linhas: { status: string; _count: { _all: number } }[], ...status: string[]) =>
      linhas.filter((linha) => status.includes(linha.status)).reduce((soma, linha) => soma + linha._count._all, 0);
    const coletasEntregues = quantas(coletasPorStatus, 'DELIVERED');

    const stats: Record<string, number | number[] | Record<string, number>> = {
      coletas: coletasCount,
      manifestos: manifestosCount,
      clientes: clientesCount,
      veiculos: veiculosCount,
      entregasDaSemana: entregasPorDia(entregues.map((linha) => linha.createdAt), hoje),
      detalhe: {
        coletasAtivas: coletasCount - coletasEntregues - quantas(coletasPorStatus, 'CANCELLED', 'REJECTED'),
        coletasEntregues,
        viagensEmRota: quantas(viagensPorStatus, 'ROUTE'),
        viagensEmMontagem: quantas(viagensPorStatus, 'ASSEMBLING'),
        viagensFinalizadas: quantas(viagensPorStatus, 'FINISHED'),
        clientesAtivos,
        clientesInativos: clientesCount - clientesAtivos,
        motoristas: motoristasCount,
      },
    };

    // Receita é dado financeiro: só para quem lê o financeiro, como em
    // /api/financeiro. Para os demais o campo nem vai na resposta.
    if (pode(user.role, 'financeiroVer')) {
      const transacoes = await prisma.financialTransaction.findMany({
        where: { type: 'INCOME', status: 'PAID' },
        select: { amount: true, paidAt: true, paidAmount: true },
      });
      const mes = diaNoBrasil(hoje).slice(0, 7);
      // Receita é o que entrou de fato: com juros, multa e desconto da baixa, quando houve.
      stats.receita = transacoes.reduce((acc, t) => acc + valorRealizado(t), 0);
      stats.receitaDoMes = transacoes
        .filter((t) => t.paidAt && diaNoBrasil(t.paidAt).slice(0, 7) === mes)
        .reduce((acc, t) => acc + valorRealizado(t), 0);
    }

    return NextResponse.json(stats);
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
