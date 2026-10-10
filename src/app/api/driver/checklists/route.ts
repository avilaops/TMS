import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireDriver } from '@/lib/driver';
import { firstIssue } from '@/lib/usuarios';
import { CHECKLIST_SELECT, createDriverChecklistSchema } from '@/lib/frota';

/**
 * Checklist do veículo feito pelo motorista no app. O veículo não vem no corpo:
 * é o da viagem informada, que precisa ser do motorista logado e estar liberada
 * (em rota). Assim ele não registra checklist de veículo que não está com ele.
 */
export async function POST(req: Request) {
  const { driverId, userId, error } = await requireDriver();
  if (error) return error;

  try {
    const parsed = createDriverChecklistSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const data = parsed.data;

    const viagem = await prisma.manifest.findFirst({
      where: { id: data.manifestId, driverId, status: 'ROUTE' },
      select: { vehicleId: true },
    });
    if (!viagem) return NextResponse.json({ error: 'Viagem não encontrada.' }, { status: 404 });

    const checklist = await prisma.vehicleChecklist.create({
      data: { vehicleId: viagem.vehicleId, userId, items: data.items, odometer: data.odometer ?? null, notes: data.notes ?? null },
      select: CHECKLIST_SELECT,
    });

    return NextResponse.json(checklist, { status: 201 });
  } catch (error) {
    console.error('Erro ao registrar checklist do motorista:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
