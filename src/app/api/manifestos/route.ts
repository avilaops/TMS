import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import prisma from '@/lib/prisma';

export async function GET() {
  const { error } = await requireStaff();
  if (error) return error;

  try {
    const manifestos = await prisma.manifest.findMany({
      include: {
        driver: { include: { user: true } },
        vehicle: true,
        collections: true,
      },
      orderBy: { createdAt: 'desc' }
    });
    return NextResponse.json(manifestos);
  } catch (error) {
    console.error('Error fetching manifestos:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const { error } = await requireStaff();
  if (error) return error;

  try {
    const data = await req.json();
    
    if (!data.driverId || !data.vehicleId || !data.collectionIds || !data.collectionIds.length) {
      return NextResponse.json({ error: 'Motorista, Veículo e pelo menos 1 Minuta são obrigatórios.' }, { status: 400 });
    }

    const newManifest = await prisma.$transaction(async (tx) => {
      const manifest = await tx.manifest.create({
        data: {
          driverId: data.driverId,
          vehicleId: data.vehicleId,
          status: 'ROUTE',
        }
      });

      await tx.collection.updateMany({
        where: { id: { in: data.collectionIds } },
        data: { manifestId: manifest.id, status: 'ROUTE' }
      });

      return manifest;
    });

    return NextResponse.json(newManifest, { status: 201 });
  } catch (error) {
    console.error('Error creating manifest:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
