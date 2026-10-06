import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireStaff } from '@/lib/staff';
import { INACTIVE_DRIVER_MESSAGE } from '@/lib/coletas';
import {
  DRIVER_BUSY_MESSAGE,
  EMPTY_MANIFEST_MESSAGE,
  VEHICLE_BUSY_MESSAGE,
  VEHICLE_IN_MAINTENANCE_MESSAGE,
  VEHICLE_NOT_FOUND_MESSAGE,
} from '@/lib/manifestos';
import { MANIFEST_STATUS, statusBadge } from '@/lib/format';
import { ManifestError, lockManifest } from '@/lib/manifestos-db';

/** Libera a saída: as cargas passam para "em rota" e o veículo fica ocupado. */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error } = await requireStaff();
    if (error) return error;

    const manifestId = (await params).id;

    await prisma.$transaction(async (tx) => {
      const manifest = await lockManifest(tx, manifestId);
      if (manifest.status !== 'ASSEMBLING') {
        throw new ManifestError(
          409,
          `Só viagem em montagem pode ser liberada; esta está "${statusBadge(MANIFEST_STATUS, manifest.status).label}".`,
        );
      }

      // Segura veículo e motorista, sempre nesta ordem: duas viagens disputando
      // o mesmo veículo saem uma depois da outra, e a segunda encontra a primeira.
      await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id = ${manifest.vehicleId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "Driver" WHERE id = ${manifest.driverId} FOR UPDATE`;

      const driver = await tx.driver.findUnique({ where: { id: manifest.driverId }, select: { active: true } });
      if (!driver?.active) throw new ManifestError(400, INACTIVE_DRIVER_MESSAGE);

      const vehicle = await tx.vehicle.findUnique({ where: { id: manifest.vehicleId }, select: { status: true } });
      if (!vehicle) throw new ManifestError(400, VEHICLE_NOT_FOUND_MESSAGE);
      if (vehicle.status === 'MAINTENANCE') throw new ManifestError(409, VEHICLE_IN_MAINTENANCE_MESSAGE);

      // Quem diz que o veículo está ocupado é outra viagem em rota, não o campo
      // `status` do veículo, que o cadastro deixa editar à mão.
      const emRota = { status: 'ROUTE', id: { not: manifestId } };
      if (await tx.manifest.findFirst({ where: { ...emRota, vehicleId: manifest.vehicleId }, select: { id: true } })) {
        throw new ManifestError(409, VEHICLE_BUSY_MESSAGE);
      }
      if (await tx.manifest.findFirst({ where: { ...emRota, driverId: manifest.driverId }, select: { id: true } })) {
        throw new ManifestError(409, DRIVER_BUSY_MESSAGE);
      }

      const { count } = await tx.collection.updateMany({
        where: { manifestId, status: 'COLLECTED' },
        data: { status: 'ROUTE' },
      });
      if (count === 0) throw new ManifestError(409, EMPTY_MANIFEST_MESSAGE);

      await tx.vehicle.update({ where: { id: manifest.vehicleId }, data: { status: 'ON_ROUTE' } });
      await tx.manifest.update({ where: { id: manifestId }, data: { status: 'ROUTE' } });
    });

    const manifest = await prisma.manifest.findUnique({ where: { id: manifestId } });
    return NextResponse.json({ success: true, manifest });
  } catch (error) {
    if (error instanceof ManifestError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Erro ao liberar manifesto:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
