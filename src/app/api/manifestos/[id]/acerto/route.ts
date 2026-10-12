import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireStaff } from '@/lib/staff';
import { ADVANCE_SELECT, acertoDoAdiantamento, comAcerto } from '@/lib/equipe';
import { NOT_FINISHED_MESSAGE, TRIP_EXPENSE_SELECT, TRIP_NOT_FOUND, acertoDaViagem, finalizadaEm } from '@/lib/viagem';
import { combustivelDasViagens } from '@/lib/viagem-db';
import { CONTRACT_COST_SELECT, custoParaAViagem } from '@/lib/frete-contratado';
import { VIAGEM_DA_REMUNERACAO_SELECT, remuneracaoDasViagens } from '@/lib/remuneracao-db';

/**
 * O acerto da viagem finalizada: frete das cargas, despesas aprovadas,
 * combustível, frete contratado com o parceiro, remuneração variável do motorista e do ajudante
 * (src/lib/remuneracao.ts), custo total, resultado e margem, os km rodados e os
 * adiantamentos ligados a ela. Só leitura; as contas estão em src/lib/viagem.ts.
 *
 * É dinheiro: só quem lê o financeiro (`financeiroVer`). O saldo do adiantamento compara o que foi
 * adiantado para a viagem com as despesas aprovadas dela — sobra, a equipe
 * devolve; falta, a empresa completa (a mesma conta do acerto de adiantamento).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireStaff({ pode: 'financeiroVer' });
  if (error) return error;

  try {
    const manifestId = (await params).id;

    // Uma consulta por vez: cada uma abre a própria transação (src/lib/prisma.ts).
    const viagem = await prisma.manifest.findUnique({
      where: { id: manifestId },
      select: {
        id: true,
        status: true,
        vehicleId: true,
        createdAt: true,
        updatedAt: true,
        departedAt: true,
        finishedAt: true,
        departureOdometer: true,
        returnOdometer: true,
        driver: { select: { id: true, user: { select: { name: true } } } },
        helper: { select: { id: true, name: true } },
        vehicle: { select: { id: true, plate: true, model: true } },
        collections: { select: { freightValue: true } },
        freightContract: { select: CONTRACT_COST_SELECT },
      },
    });
    if (!viagem) return NextResponse.json({ error: TRIP_NOT_FOUND }, { status: 404 });
    if (viagem.status !== 'FINISHED') return NextResponse.json({ error: NOT_FINISHED_MESSAGE }, { status: 409 });

    const despesas = await prisma.tripExpense.findMany({
      where: { manifestId },
      select: TRIP_EXPENSE_SELECT,
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    });
    const adiantamentos = await prisma.crewAdvance.findMany({
      where: { manifestId },
      select: ADVANCE_SELECT,
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    });
    const abastecimentos = (await combustivelDasViagens(prisma, [viagem])).get(viagem.id) ?? [];
    // A remuneração variável do motorista e do ajudante: custo da viagem, mostrado à parte.
    const paraARemuneracao = await prisma.manifest.findUnique({ where: { id: manifestId }, select: VIAGEM_DA_REMUNERACAO_SELECT });
    const remuneracao = paraARemuneracao ? ((await remuneracaoDasViagens(prisma, [paraARemuneracao])).get(manifestId) ?? null) : null;

    const acerto = acertoDaViagem({
      cargas: viagem.collections,
      despesas,
      abastecimentos,
      adiantamentos,
      // O custo do contrato com o parceiro, uma vez só: os pagamentos dele não são despesa de viagem.
      freteContratado: custoParaAViagem(viagem.freightContract),
      // Uma vez só: o lançamento do fechamento mensal não é despesa de viagem, e motorista de parceiro com contrato pesa zero aqui.
      remuneracao: remuneracao?.total ?? 0,
      departureOdometer: viagem.departureOdometer,
      returnOdometer: viagem.returnOdometer,
    });

    return NextResponse.json({
      viagem: {
        id: viagem.id,
        motorista: viagem.driver.user.name,
        ajudante: viagem.helper?.name ?? null,
        placa: viagem.vehicle.plate,
        saiuEm: viagem.departedAt,
        finalizadaEm: finalizadaEm(viagem),
        departureOdometer: viagem.departureOdometer,
        returnOdometer: viagem.returnOdometer,
      },
      acerto,
      // O que a viagem rende ao motorista e ao ajudante, separado, e por que o motorista ficou de fora ou sem o valor por km.
      remuneracao,
      // Sem adiantamento não há saldo a acertar.
      saldoDoAdiantamento: adiantamentos.length > 0 ? acertoDoAdiantamento(acerto.adiantado, acerto.despesas) : null,
      adiantamentos: adiantamentos.map(comAcerto),
      despesas: despesas.filter((despesa) => despesa.status === 'APPROVED'),
    });
  } catch (error) {
    console.error('Erro ao montar o acerto da viagem:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
