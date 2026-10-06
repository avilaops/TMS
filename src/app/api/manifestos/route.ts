import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import prisma from '@/lib/prisma';
import { DRIVER_USER_SELECT, firstIssue } from '@/lib/usuarios';
import { INACTIVE_DRIVER_MESSAGE } from '@/lib/coletas';
import {
  EMBARKABLE_STATUSES,
  VEHICLE_IN_MAINTENANCE_MESSAGE,
  VEHICLE_NOT_FOUND_MESSAGE,
  canEmbark,
  cannotEmbarkMessage,
  createManifestSchema,
} from '@/lib/manifestos';

/** Desfaz a transação quando alguma carga deixou de estar apta entre a conferência e a gravação. */
class CannotEmbark extends Error {
  constructor(readonly count: number) {
    super('Carga não pode embarcar.');
  }
}

export async function GET() {
  const { error } = await requireStaff();
  if (error) return error;

  try {
    const manifestos = await prisma.manifest.findMany({
      include: {
        driver: { include: { user: { select: DRIVER_USER_SELECT } } },
        vehicle: true,
        collections: {
          include: { client: { select: { tradeName: true, companyName: true } } },
          orderBy: { createdAt: 'asc' },
        },
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
    const parsed = createManifestSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const { driverId, vehicleId, collectionIds } = parsed.data;

    const driver = await prisma.driver.findFirst({
      where: { id: driverId, active: true },
      select: { id: true }
    });
    if (!driver) {
      return NextResponse.json({ error: INACTIVE_DRIVER_MESSAGE }, { status: 400 });
    }

    const vehicle = await prisma.vehicle.findUnique({
      where: { id: vehicleId },
      select: { status: true }
    });
    if (!vehicle) {
      return NextResponse.json({ error: VEHICLE_NOT_FOUND_MESSAGE }, { status: 400 });
    }
    if (vehicle.status === 'MAINTENANCE') {
      return NextResponse.json({ error: VEHICLE_IN_MAINTENANCE_MESSAGE }, { status: 409 });
    }

    // Id que não existe conta como carga que não embarca: o manifesto não pode
    // nascer com menos cargas do que o operador marcou.
    const found = await prisma.collection.findMany({
      where: { id: { in: collectionIds } },
      select: { status: true, manifestId: true }
    });
    const embarkable = found.filter(canEmbark).length;
    if (embarkable !== collectionIds.length) {
      return NextResponse.json(
        { error: cannotEmbarkMessage(collectionIds.length - embarkable) },
        { status: 409 }
      );
    }

    const newManifest = await prisma.$transaction(async (tx) => {
      const manifest = await tx.manifest.create({
        data: { driverId, vehicleId, status: 'ROUTE' }
      });

      // A conferência vale aqui: de duas montagens simultâneas com a mesma
      // carga, a segunda encontra menos linhas e a transação inteira é desfeita.
      const { count } = await tx.collection.updateMany({
        where: {
          id: { in: collectionIds },
          status: { in: [...EMBARKABLE_STATUSES] },
          manifestId: null,
        },
        data: { manifestId: manifest.id, status: 'ROUTE' }
      });
      if (count !== collectionIds.length) {
        throw new CannotEmbark(collectionIds.length - count);
      }

      return manifest;
    });

    return NextResponse.json(newManifest, { status: 201 });
  } catch (error) {
    if (error instanceof CannotEmbark) {
      return NextResponse.json({ error: cannotEmbarkMessage(error.count) }, { status: 409 });
    }
    console.error('Error creating manifest:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
