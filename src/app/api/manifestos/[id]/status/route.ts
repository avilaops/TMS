import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { requireStaff } from '@/lib/staff';
import prisma from '@/lib/prisma';
import { firstIssue } from '@/lib/usuarios';
import { MANIFEST_INCLUDE, canManifestTransition, manifestStatusSchema } from '@/lib/manifestos';
import { MANIFEST_STATUS, statusBadge } from '@/lib/format';
import { ManifestError, lockManifest, requireActiveDriver, requireUsableVehicle } from '@/lib/manifestos-db';

const EMPTY = 'Não dá para liberar uma viagem sem carga.';
const VEHICLE_BUSY = 'Este veículo já está em rota em outra viagem.';
const DRIVER_BUSY = 'Este motorista já está em rota em outra viagem.';

const label = (status: string) => statusBadge(MANIFEST_STATUS, status).label;

type Tx = Prisma.TransactionClient;
type Locked = Awaited<ReturnType<typeof lockManifest>>;

// Saída: as cargas vão para "em rota" e o veículo fica ocupado.
async function dispatch(tx: Tx, manifest: Locked) {
  // Segura veículo e motorista, sempre nesta ordem: duas viagens disputando o
  // mesmo veículo saem uma depois da outra, e a segunda encontra a primeira.
  await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id = ${manifest.vehicleId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "Driver" WHERE id = ${manifest.driverId} FOR UPDATE`;

  await requireActiveDriver(tx, manifest.driverId);
  await requireUsableVehicle(tx, manifest.vehicleId);

  const others = { status: 'ROUTE', id: { not: manifest.id } };
  if (await tx.manifest.findFirst({ where: { ...others, vehicleId: manifest.vehicleId }, select: { id: true } })) {
    throw new ManifestError(409, VEHICLE_BUSY);
  }
  if (await tx.manifest.findFirst({ where: { ...others, driverId: manifest.driverId }, select: { id: true } })) {
    throw new ManifestError(409, DRIVER_BUSY);
  }

  const { count } = await tx.collection.updateMany({
    where: { manifestId: manifest.id, status: 'COLLECTED' },
    data: { status: 'ROUTE' },
  });
  if (count === 0) throw new ManifestError(409, EMPTY);

  await tx.vehicle.update({ where: { id: manifest.vehicleId }, data: { status: 'ON_ROUTE' } });
  return 0;
}

// Retorno: o que não foi entregue volta ao depósito, livre para outra viagem.
async function finish(tx: Tx, manifest: Locked) {
  const { count } = await tx.collection.updateMany({
    where: { manifestId: manifest.id, status: 'ROUTE' },
    data: { status: 'COLLECTED', manifestId: null },
  });
  // Só solta o veículo que esta viagem ocupou; em manutenção ele fica como está.
  await tx.vehicle.updateMany({
    where: { id: manifest.vehicleId, status: 'ON_ROUTE' },
    data: { status: 'AVAILABLE' },
  });
  return count;
}

async function cancel(tx: Tx, manifest: Locked) {
  const { count } = await tx.collection.updateMany({
    where: { manifestId: manifest.id },
    data: { manifestId: null },
  });
  return count;
}

const ACTIONS = { ROUTE: dispatch, FINISHED: finish, CANCELLED: cancel } as const;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireStaff();
  if (error) return error;

  try {
    const manifestId = (await params).id;

    const parsed = manifestStatusSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const { status } = parsed.data;

    // `returned`: cargas que voltaram ao depósito (no encerramento, as não
    // entregues; no cancelamento, todas).
    const returned = await prisma.$transaction(async (tx) => {
      const manifest = await lockManifest(tx, manifestId);
      if (!canManifestTransition(manifest.status, status)) {
        throw new ManifestError(409, `Não é possível passar de "${label(manifest.status)}" para "${label(status)}".`);
      }
      const count = await ACTIONS[status](tx, manifest);
      await tx.manifest.update({ where: { id: manifestId }, data: { status } });
      return count;
    });

    const manifest = await prisma.manifest.findUnique({ where: { id: manifestId }, include: MANIFEST_INCLUDE });
    return NextResponse.json({ success: true, manifest, returned });
  } catch (error) {
    if (error instanceof ManifestError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Erro ao atualizar status do manifesto:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
