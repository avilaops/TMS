import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import prisma from '@/lib/prisma';
import { firstIssue } from '@/lib/usuarios';
import { TIRE_SELECT, createTireSchema } from '@/lib/frota';
import { acharVeiculo, veiculoNaoEncontrado } from '@/lib/frota-db';

/** Pneus do veículo: os que estão nele primeiro, depois os retirados, pela instalação mais recente. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireStaff();
  if (error) return error;

  try {
    const { id } = await params;
    if (!(await acharVeiculo(id))) return veiculoNaoEncontrado();

    const pneus = await prisma.tire.findMany({
      where: { vehicleId: id },
      orderBy: [{ installedAt: 'desc' }, { id: 'asc' }],
      select: TIRE_SELECT,
    });
    return NextResponse.json([...pneus.filter((pneu) => pneu.removedKm === null), ...pneus.filter((pneu) => pneu.removedKm !== null)]);
  } catch (error) {
    console.error('Erro ao buscar pneus:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireStaff();
  if (error) return error;

  try {
    const { id } = await params;
    const parsed = createTireSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const data = parsed.data;

    if (!(await acharVeiculo(id))) return veiculoNaoEncontrado();

    const pneu = await prisma.tire.create({
      data: {
        vehicleId: id,
        position: data.position,
        brandModel: data.brandModel,
        installedAt: data.installedAt,
        installedKm: data.installedKm,
        removedKm: data.removedKm ?? null,
        notes: data.notes ?? null,
      },
      select: TIRE_SELECT,
    });

    return NextResponse.json(pneu, { status: 201 });
  } catch (error) {
    console.error('Erro ao registrar pneu:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
