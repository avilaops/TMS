import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import prisma from '@/lib/prisma';
import { firstIssue } from '@/lib/usuarios';
import { FUELING_SELECT, consumoDosAbastecimentos, createFuelingSchema } from '@/lib/frota';
import { acharVeiculo, veiculoNaoEncontrado } from '@/lib/frota-db';
import { escolher, origemDaRequisicao, registrarAuditoriaDepois } from '@/lib/auditoria';

/**
 * Abastecimentos do veículo, do mais novo para o mais antigo, cada um com o
 * consumo (km/l) e o custo por km desde o abastecimento anterior. As contas
 * estão em src/lib/frota.ts.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireStaff({ pode: 'frotaVer' });
  if (error) return error;

  try {
    const { id } = await params;
    if (!(await acharVeiculo(id))) return veiculoNaoEncontrado();

    const abastecimentos = await prisma.fueling.findMany({ where: { vehicleId: id }, select: FUELING_SELECT });
    return NextResponse.json(consumoDosAbastecimentos(abastecimentos).reverse());
  } catch (error) {
    console.error('Erro ao buscar abastecimentos:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireStaff({ pode: 'frota' });
  if (error) return error;

  try {
    const { id } = await params;
    const parsed = createFuelingSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const data = parsed.data;

    if (!(await acharVeiculo(id))) return veiculoNaoEncontrado();

    if (data.driverId) {
      // Motorista desativado continua valendo: o abastecimento pode ser de antes.
      const motorista = await prisma.driver.findUnique({ where: { id: data.driverId }, select: { id: true } });
      if (!motorista) return NextResponse.json({ error: 'Motorista não encontrado.' }, { status: 400 });
    }

    const abastecimento = await prisma.fueling.create({
      data: {
        vehicleId: id,
        date: data.date,
        liters: data.liters,
        totalCost: data.totalCost,
        odometer: data.odometer,
        station: data.station ?? null,
        driverId: data.driverId ?? null,
      },
      select: FUELING_SELECT,
    });

    await registrarAuditoriaDepois(prisma, {
      ator: user,
      origem: origemDaRequisicao(req),
      acao: 'abastecimento.registrar',
      entidade: 'veiculo',
      entidadeId: id,
      resumo: `Abastecimento de ${abastecimento.liters.toLocaleString('pt-BR')} l registrado`,
      depois: escolher(abastecimento, ['date', 'liters', 'totalCost', 'odometer', 'station', 'driverId']),
    });

    return NextResponse.json(abastecimento, { status: 201 });
  } catch (error) {
    console.error('Erro ao registrar abastecimento:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
