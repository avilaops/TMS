import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import prisma from '@/lib/prisma';
import { fluxoDeCaixa, mesesDoPeriodo, periodoPadrao, resumoFinanceiro } from '@/lib/financeiro';

/**
 * Resumo (a receber, a pagar, vencido, realizado no mês) e fluxo de caixa por
 * mês. `?de=AAAA-MM&ate=AAAA-MM`; sem os dois, três meses para trás e três para
 * a frente. O resumo é sempre de todos os lançamentos, não só do período: conta
 * vencida há um ano continua vencida.
 */
export async function GET(req?: Request) {
  const { error } = await requireStaff(["ADMIN"]);
  if (error) return error;

  try {
    const query = req ? new URL(req.url).searchParams : new URLSearchParams();
    const padrao = periodoPadrao();
    const de = query.get('de') ?? padrao.de;
    const ate = query.get('ate') ?? padrao.ate;

    if (mesesDoPeriodo(de, ate).length === 0) {
      return NextResponse.json({ error: 'Período inválido. Use de=AAAA-MM e ate=AAAA-MM, com no máximo 36 meses.' }, { status: 400 });
    }

    const lancamentos = await prisma.financialTransaction.findMany({
      select: { type: true, amount: true, status: true, dueDate: true, paidAt: true, paidAmount: true },
    });

    return NextResponse.json({
      periodo: { de, ate },
      resumo: resumoFinanceiro(lancamentos),
      fluxo: fluxoDeCaixa(lancamentos, de, ate),
    });
  } catch (error) {
    console.error('Erro ao montar o fluxo de caixa:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
