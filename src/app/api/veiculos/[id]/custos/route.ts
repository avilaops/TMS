import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import prisma from '@/lib/prisma';
import { custosDoVeiculo, limitesDeCalendario } from '@/lib/frota';
import { periodoDoRelatorio } from '@/lib/relatorios';
import { acharVeiculo, veiculoNaoEncontrado } from '@/lib/frota-db';

const ABASTECIMENTO = { date: true, odometer: true, liters: true, totalCost: true } as const;

/**
 * Custos do veículo num período em meses: manutenção concluída, abastecimento,
 * total, km rodados, custo por km e consumo médio.
 * `?de=AAAA-MM&ate=AAAA-MM`; sem os dois, o mês corrente e os dois anteriores.
 * Custo é dado financeiro: só ADMIN. As contas estão em src/lib/frota.ts.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireStaff(["ADMIN"]);
  if (error) return error;

  try {
    const { id } = await params;
    const query = new URL(req.url).searchParams;
    const padrao = periodoDoRelatorio();
    const de = query.get('de') ?? padrao.de;
    const ate = query.get('ate') ?? padrao.ate;

    const limites = limitesDeCalendario(de, ate);
    if (!limites) {
      return NextResponse.json({ error: 'Período inválido. Use de=AAAA-MM e ate=AAAA-MM, com no máximo 36 meses.' }, { status: 400 });
    }
    const noPeriodo = { gte: limites.inicio, lt: limites.fim };

    if (!(await acharVeiculo(id))) return veiculoNaoEncontrado();

    // Uma consulta por vez: cada uma abre a própria transação (src/lib/prisma.ts).
    const manutencoes = await prisma.maintenance.findMany({
      where: { vehicleId: id, date: noPeriodo },
      select: { cost: true, status: true },
    });
    const abastecimentos = await prisma.fueling.findMany({ where: { vehicleId: id, date: noPeriodo }, select: ABASTECIMENTO });
    // O último abastecimento antes do período dá o hodômetro de onde ele parte.
    const anterior = await prisma.fueling.findFirst({
      where: { vehicleId: id, date: { lt: limites.inicio } },
      orderBy: [{ date: 'desc' }, { odometer: 'desc' }],
      select: ABASTECIMENTO,
    });

    return NextResponse.json({ periodo: { de, ate }, ...custosDoVeiculo({ manutencoes, abastecimentos, anterior }) });
  } catch (error) {
    console.error('Erro ao calcular os custos do veículo:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
