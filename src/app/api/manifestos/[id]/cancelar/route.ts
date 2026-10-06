import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireStaff } from '@/lib/staff';
import { MANIFEST_STATUS, statusBadge } from '@/lib/format';
import { ManifestError, lockManifest } from '@/lib/manifestos-db';

/** Cancela a viagem antes da saída: as cargas voltam a ficar livres, ainda coletadas. */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error } = await requireStaff();
    if (error) return error;

    const manifestId = (await params).id;

    const released = await prisma.$transaction(async (tx) => {
      const manifest = await lockManifest(tx, manifestId);
      if (manifest.status !== 'ASSEMBLING') {
        throw new ManifestError(
          409,
          `Só viagem em montagem pode ser cancelada; esta está "${statusBadge(MANIFEST_STATUS, manifest.status).label}".`,
        );
      }

      const { count } = await tx.collection.updateMany({ where: { manifestId }, data: { manifestId: null } });
      await tx.manifest.update({ where: { id: manifestId }, data: { status: 'CANCELLED' } });
      return count;
    });

    const manifest = await prisma.manifest.findUnique({ where: { id: manifestId } });
    return NextResponse.json({ success: true, manifest, released });
  } catch (error) {
    if (error instanceof ManifestError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Erro ao cancelar manifesto:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
