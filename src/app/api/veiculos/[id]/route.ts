import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import prisma from '@/lib/prisma';
import { VEHICLE_PUBLIC_INCLUDE, updateVehicleSchema } from '@/lib/cadastros';
import { firstIssue } from '@/lib/usuarios';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireStaff();
  if (error) return error;

  try {
    const { id } = await params;

    const parsed = updateVehicleSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const data = parsed.data;

    const target = await prisma.vehicle.findUnique({ where: { id }, select: { id: true } });
    if (!target) {
      return NextResponse.json({ error: 'Veículo não encontrado.' }, { status: 404 });
    }

    if (data.defaultDriverId) {
      const driver = await prisma.driver.findUnique({
        where: { id: data.defaultDriverId },
        select: { id: true }
      });
      if (!driver) {
        return NextResponse.json({ error: 'Motorista padrão não encontrado.' }, { status: 400 });
      }
    }

    // Campo ausente (`undefined`) fica como está; `null` apaga — em
    // `defaultDriverId`, desvincula o motorista.
    const veiculo = await prisma.vehicle.update({
      where: { id },
      data: {
        model: data.model,
        type: data.type,
        capacity: data.capacityKg,
        maxWeight: data.maxWeight,
        year: data.year,
        driverId: data.defaultDriverId,
        status: data.status,
      },
      include: VEHICLE_PUBLIC_INCLUDE,
    });

    return NextResponse.json(veiculo);
  } catch (error) {
    console.error('Error updating vehicle:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
