import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireStaff } from '@/lib/staff';
import { firstIssue } from '@/lib/usuarios';
import { INACTIVE_DRIVER_MESSAGE } from '@/lib/coletas';
import {
  EMBARKABLE_STATUSES,
  NOT_ASSEMBLING_MESSAGE,
  VEHICLE_IN_MAINTENANCE_MESSAGE,
  VEHICLE_NOT_FOUND_MESSAGE,
  cannotEmbarkMessage,
  isManifestEditable,
  updateManifestSchema,
} from '@/lib/manifestos';
import { ManifestError, lockManifest } from '@/lib/manifestos-db';

/** Troca motorista ou veículo e acrescenta carga a uma viagem em montagem. */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error } = await requireStaff();
    if (error) return error;

    const manifestId = (await params).id;

    const parsed = updateManifestSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const { driverId, vehicleId, addCollectionIds = [] } = parsed.data;

    await prisma.$transaction(async (tx) => {
      const manifest = await lockManifest(tx, manifestId);
      if (!isManifestEditable(manifest)) throw new ManifestError(409, NOT_ASSEMBLING_MESSAGE);

      if (driverId !== undefined) {
        const driver = await tx.driver.findFirst({ where: { id: driverId, active: true }, select: { id: true } });
        if (!driver) throw new ManifestError(400, INACTIVE_DRIVER_MESSAGE);
      }
      if (vehicleId !== undefined) {
        const vehicle = await tx.vehicle.findUnique({ where: { id: vehicleId }, select: { status: true } });
        if (!vehicle) throw new ManifestError(400, VEHICLE_NOT_FOUND_MESSAGE);
        if (vehicle.status === 'MAINTENANCE') throw new ManifestError(409, VEHICLE_IN_MAINTENANCE_MESSAGE);
      }

      // Mesma conferência da montagem: se alguma carga deixou de estar apta, a
      // contagem não fecha e nada desta alteração é gravado.
      if (addCollectionIds.length > 0) {
        const { count } = await tx.collection.updateMany({
          where: { id: { in: addCollectionIds }, status: { in: [...EMBARKABLE_STATUSES] }, manifestId: null },
          data: { manifestId },
        });
        if (count !== addCollectionIds.length) {
          throw new ManifestError(409, cannotEmbarkMessage(addCollectionIds.length - count));
        }
      }

      await tx.manifest.update({
        where: { id: manifestId },
        data: { driverId: driverId ?? manifest.driverId, vehicleId: vehicleId ?? manifest.vehicleId },
      });
    });

    const manifest = await prisma.manifest.findUnique({ where: { id: manifestId } });
    return NextResponse.json({ success: true, manifest });
  } catch (error) {
    if (error instanceof ManifestError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Erro ao alterar manifesto:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
