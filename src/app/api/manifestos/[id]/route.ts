import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import prisma from '@/lib/prisma';
import { firstIssue } from '@/lib/usuarios';
import { MANIFEST_INCLUDE, isManifestEditable, updateManifestSchema } from '@/lib/manifestos';
import {
  ManifestError,
  loadCollections,
  lockManifest,
  requireActiveDriver,
  requireUsableVehicle,
  unloadCollections,
} from '@/lib/manifestos-db';

const NOT_EDITABLE = 'Só dá para alterar a viagem enquanto ela está em montagem.';

/** Troca motorista ou veículo e põe ou retira cargas de uma viagem em montagem. */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireStaff();
  if (error) return error;

  try {
    const manifestId = (await params).id;

    const parsed = updateManifestSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const { driverId, vehicleId, addCollectionIds = [], removeCollectionIds = [] } = parsed.data;

    await prisma.$transaction(async (tx) => {
      const manifest = await lockManifest(tx, manifestId);
      if (!isManifestEditable(manifest)) throw new ManifestError(409, NOT_EDITABLE);

      if (driverId !== undefined) await requireActiveDriver(tx, driverId);
      if (vehicleId !== undefined) await requireUsableVehicle(tx, vehicleId);

      await unloadCollections(tx, manifestId, removeCollectionIds);
      await loadCollections(tx, manifestId, addCollectionIds);

      // Grava mesmo sem trocar motorista ou veículo: `updatedAt` passa a
      // registrar a última mexida na carga.
      await tx.manifest.update({
        where: { id: manifestId },
        data: { driverId: driverId ?? manifest.driverId, vehicleId: vehicleId ?? manifest.vehicleId },
      });
    });

    const updated = await prisma.manifest.findUnique({ where: { id: manifestId }, include: MANIFEST_INCLUDE });
    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof ManifestError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Erro ao alterar manifesto:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
