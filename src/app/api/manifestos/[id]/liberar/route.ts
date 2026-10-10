import { NextResponse } from 'next/server';
import prisma, { transacao } from '@/lib/prisma';
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
import { recordStatusChanges } from '@/lib/historico';
import { origemDaRequisicao, registrarAuditoria } from '@/lib/auditoria';
import { avisar, avisarStatusAoCliente, avisoDeViagemLiberada, usuarioDoMotorista } from '@/lib/notificacoes';
import { AVISO_DE_VIAGEM_SEM_MDFE, fraseDoBloqueioDaSaida, type FaltasParaSair } from '@/lib/mdfe';
import { documentosDaSaida, exigenciaSemMdfe } from '@/lib/mdfe-db';

/** A saída foi bloqueada por falta de documento fiscal: a resposta 409 leva a lista do que falta. */
class SaidaBloqueada extends ManifestError {
  constructor(readonly faltas: FaltasParaSair) {
    super(409, fraseDoBloqueioDaSaida(faltas));
  }
}

/**
 * Libera a saída: as cargas passam para "em rota" e o veículo fica ocupado.
 *
 * DOCUMENTOS FISCAIS: o CT-e de cada carga e o MDF-e da viagem têm de estar
 * autorizados antes de o veículo sair (Ajustes SINIEF 09/07 e 21/10).
 * - Empresa com emitente fiscal em PRODUÇÃO (emite pelo TMS): sem o CT-e de
 *   cada carga que precisa dele, ou sem o MDF-e quando a viagem o exige, a
 *   saída NÃO é liberada: 409, com `faltas` (as cargas sem CT-e e se falta o
 *   MDF-e), que a tela mostra com o atalho para emitir.
 * - Empresa em homologação ou sem emitente configurado (emite em outro
 *   sistema): a saída é liberada; quando a viagem exige MDF-e e não há um
 *   autorizado em produção, a resposta leva `aviso`.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { user, error } = await requireStaff({ pode: 'manifestos' });
    if (error) return error;

    const manifestId = (await params).id;
    const origem = origemDaRequisicao(req);

    await transacao(async (tx) => {
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

      // As cargas que embarcam, lidas e seguradas antes da troca: são elas que
      // ganham a linha no histórico, na mesma transação.
      const embarcando = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Collection" WHERE "manifestId" = ${manifestId} AND status = 'COLLECTED' FOR UPDATE`;
      if (embarcando.length === 0) throw new ManifestError(409, EMPTY_MANIFEST_MESSAGE);
      const ids = embarcando.map((c) => c.id);

      // Com a viagem e as cargas seguradas: o que falta de documento não muda até o fim da transação.
      const documentos = await documentosDaSaida(tx, manifestId);
      if (documentos.bloqueia) throw new SaidaBloqueada(documentos.faltas);

      await tx.collection.updateMany({
        where: { id: { in: ids }, manifestId, status: 'COLLECTED' },
        data: { status: 'ROUTE' },
      });
      const trocas = ids.map((collectionId) => ({ collectionId, fromStatus: 'COLLECTED', toStatus: 'ROUTE', userId: user.id }));
      await recordStatusChanges(tx, trocas);
      // Sininho: o cliente de cada carga fica sabendo que ela saiu, e o motorista, que a viagem é dele.
      await avisarStatusAoCliente(tx, trocas, user.id);
      await avisar(tx, {
        ...avisoDeViagemLiberada(manifestId, ids.length),
        para: await usuarioDoMotorista(tx, manifest.driverId),
        autor: user.id,
      });

      await tx.vehicle.update({ where: { id: manifest.vehicleId }, data: { status: 'ON_ROUTE' } });
      // A data da saída abre a janela da viagem: é dela em diante que o
      // abastecimento do veículo conta no acerto (src/lib/viagem.ts).
      await tx.manifest.update({ where: { id: manifestId }, data: { status: 'ROUTE', departedAt: new Date() } });

      await registrarAuditoria(tx, {
        ator: user,
        origem,
        acao: 'manifesto.liberar',
        entidade: 'manifesto',
        entidadeId: manifestId,
        resumo: `Manifesto liberado: ${ids.length} carga(s) em rota`,
        antes: { status: manifest.status },
        depois: { status: 'ROUTE', cargas: ids.length },
      });
    });

    const manifest = await prisma.manifest.findUnique({ where: { id: manifestId } });
    // A saída já valeu: se a leitura do aviso falhar, a resposta segue sem ele.
    const exigencia = await exigenciaSemMdfe(prisma, manifestId).catch(() => null);
    return NextResponse.json({ success: true, manifest, aviso: exigencia ? AVISO_DE_VIAGEM_SEM_MDFE[exigencia] : null });
  } catch (error) {
    if (error instanceof SaidaBloqueada) {
      return NextResponse.json({ error: error.message, faltas: error.faltas }, { status: error.status });
    }
    if (error instanceof ManifestError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Erro ao liberar manifesto:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
