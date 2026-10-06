import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import prisma from '@/lib/prisma';
import { firstIssue } from '@/lib/usuarios';
import { MANIFEST_INCLUDE, createManifestSchema } from '@/lib/manifestos';
import { ManifestError, loadCollections, requireActiveDriver, requireUsableVehicle } from '@/lib/manifestos-db';

export async function GET() {
  const { error } = await requireStaff();
  if (error) return error;

  try {
    const manifestos = await prisma.manifest.findMany({
      include: MANIFEST_INCLUDE,
      orderBy: { createdAt: 'desc' }
    });
    return NextResponse.json(manifestos);
  } catch (error) {
    console.error('Error fetching manifestos:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// O manifesto nasce em montagem, com as cargas reservadas mas ainda no
// depósito. Quem as põe em rota é a liberação da saída (rota de status).
export async function POST(req: Request) {
  const { error } = await requireStaff();
  if (error) return error;

  try {
    const parsed = createManifestSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const { driverId, vehicleId, collectionIds } = parsed.data;

    const manifestId = await prisma.$transaction(async (tx) => {
      await requireActiveDriver(tx, driverId);
      await requireUsableVehicle(tx, vehicleId);
      const manifest = await tx.manifest.create({ data: { driverId, vehicleId, status: 'ASSEMBLING' } });
      await loadCollections(tx, manifest.id, collectionIds);
      return manifest.id;
    });

    const created = await prisma.manifest.findUnique({ where: { id: manifestId }, include: MANIFEST_INCLUDE });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    if (error instanceof ManifestError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error creating manifest:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
