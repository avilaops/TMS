import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import prisma from '@/lib/prisma';
import { DRIVER_USER_SELECT } from '@/lib/usuarios';

export async function GET() {
  const { error } = await requireStaff();
  if (error) return error;

  try {
    const veiculos = await prisma.vehicle.findMany({
      include: {
        driver: { include: { user: { select: DRIVER_USER_SELECT } } },
      },
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
    const data = await req.json();
    
    if (!data.plate || !data.model || !data.type) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const existingVehicle = await prisma.vehicle.findUnique({
      where: { plate: data.plate }
    });

    if (existingVehicle) {
      return NextResponse.json({ error: 'Já existe um veículo com esta placa.' }, { status: 409 });
    }

    const newVehicle = await prisma.vehicle.create({
      data: {
        plate: data.plate,
        model: data.model,
        type: data.type,
        capacity: data.capacityKg ? parseFloat(data.capacityKg) : null,
        year: data.year ? parseInt(data.year) : null,
        driverId: data.defaultDriverId || null,
      }
    });

    return NextResponse.json(newVehicle, { status: 201 });
  } catch (error) {
    console.error('Error creating vehicle:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
