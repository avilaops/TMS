import { NextResponse } from 'next/server';
import prisma, { transacao } from '@/lib/prisma';
import { requireStaff } from '@/lib/staff';
import { pendingDeliveriesMessage } from '@/lib/manifestos';
import { MANIFEST_STATUS, statusBadge } from '@/lib/format';
import { ManifestError, lockManifest } from '@/lib/manifestos-db';
import { origemDaRequisicao, registrarAuditoria } from '@/lib/auditoria';

const CHANGED_MEANWHILE = 'A viagem mudou enquanto você decidia. Atualize a página e tente de novo.';

/** Encerra a viagem. Só com todas as cargas entregues ou retiradas. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { user, error } = await requireStaff();
    if (error) return error;

    const manifestId = (await params).id;
    const origem = origemDaRequisicao(req);

    await transacao(async (tx) => {
      const current = await lockManifest(tx, manifestId);
      if (current.status !== 'ROUTE') {
        throw new ManifestError(
          409,
          `Só viagem em rota pode ser finalizada; esta está "${statusBadge(MANIFEST_STATUS, current.status).label}".`,
        );
      }

      const pending = await tx.collection.count({ where: { manifestId, status: 'ROUTE' } });
      if (pending > 0) throw new ManifestError(409, pendingDeliveriesMessage(pending));

      // Segura o veículo antes de gravar, na mesma ordem da liberação (manifesto,
      // depois veículo): a saída de outra viagem com este veículo corre antes ou
      // depois desta transação inteira, nunca entre a gravação e a soltura.
      await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id = ${current.vehicleId} FOR UPDATE`;

      // Grava só se a viagem ainda estiver em rota e sem carga pendente. A data
      // da finalização é própria: `updatedAt` muda de novo quando alguém
      // completa o hodômetro de retorno depois, e a viagem mudaria de mês.
      const { count } = await tx.manifest.updateMany({
        where: { id: manifestId, status: 'ROUTE', collections: { none: { status: 'ROUTE' } } },
        data: { status: 'FINISHED', finishedAt: new Date() },
      });
      if (count === 0) throw new ManifestError(409, CHANGED_MEANWHILE);

      // Solta o veículo que a saída ocupou. Em manutenção ele fica como está, e
      // só é solto se nenhuma outra viagem em rota o estiver usando.
      await tx.vehicle.updateMany({
        where: { id: current.vehicleId, status: 'ON_ROUTE', manifests: { none: { status: 'ROUTE' } } },
        data: { status: 'AVAILABLE' },
      });

      await registrarAuditoria(tx, {
        ator: user,
        origem,
        acao: 'manifesto.finalizar',
        entidade: 'manifesto',
        entidadeId: manifestId,
        resumo: 'Manifesto finalizado',
        antes: { status: current.status },
        depois: { status: 'FINISHED' },
      });
    });

    const manifest = await prisma.manifest.findUnique({ where: { id: manifestId } });
    return NextResponse.json({ success: true, manifest });
  } catch (error) {
    if (error instanceof ManifestError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Erro ao finalizar manifesto:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
