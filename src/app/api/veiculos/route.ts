import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import prisma from '@/lib/prisma';
import { INACTIVE_DRIVER_MESSAGE, VEHICLE_PUBLIC_INCLUDE, createVehicleSchema, isUniqueViolation } from '@/lib/cadastros';
import { firstIssue } from '@/lib/usuarios';

const DUPLICATE_MESSAGE = 'Já existe um veículo com esta placa.';

export async function GET() {
  const { error } = await requireStaff();
  if (error) return error;

  try {
    const veiculos = await prisma.vehicle.findMany({
      include: VEHICLE_PUBLIC_INCLUDE,
      orderBy: { createdAt: 'desc' }
    });
    return NextResponse.json(veiculos);
  } catch (error) {
    console.error('Error fetching vehicles:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const { error } = await requireStaff();
  if (error) return error;

  try {
    const parsed = createVehicleSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const data = parsed.data;

    // `data.plate` já vem em maiúsculas e sem hífen: "abc-1d23" e "ABC1D23" são o mesmo veículo.
    const existingVehicle = await prisma.vehicle.findFirst({
      where: { plate: data.plate },
      select: { id: true }
    });

    if (existingVehicle) {
      return NextResponse.json({ error: DUPLICATE_MESSAGE }, { status: 409 });
    }

    if (data.defaultDriverId) {
      const driver = await prisma.driver.findUnique({
        where: { id: data.defaultDriverId },
        select: { id: true, active: true }
      });
      if (!driver) {
        return NextResponse.json({ error: 'Motorista padrão não encontrado.' }, { status: 400 });
      }
      if (!driver.active) {
        return NextResponse.json({ error: INACTIVE_DRIVER_MESSAGE }, { status: 400 });
      }
    }

    try {
      // O formulário usa capacityKg/defaultDriverId; no banco são capacity/driverId.
      const newVehicle = await prisma.vehicle.create({
        data: {
          plate: data.plate,
          model: data.model,
          type: data.type,
          capacity: data.capacityKg ?? null,
          maxWeight: data.maxWeight ?? null,
          year: data.year ?? null,
          driverId: data.defaultDriverId ?? null,
        },
        include: VEHICLE_PUBLIC_INCLUDE,
      });

      return NextResponse.json(newVehicle, { status: 201 });
    } catch (err) {
      // Duas criações simultâneas com a mesma placa: a segunda bate no índice único.
      if (isUniqueViolation(err)) {
        return NextResponse.json({ error: DUPLICATE_MESSAGE }, { status: 409 });
      }
      throw err;
    }
  } catch (error) {
    console.error('Error creating vehicle:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
