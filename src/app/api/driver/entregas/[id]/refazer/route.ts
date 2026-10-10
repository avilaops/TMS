import { NextResponse } from 'next/server';
import { transacao } from '@/lib/prisma';
import { requireDriver } from '@/lib/driver';
import { Refusal } from '@/lib/cadastros';
import { firstIssue } from '@/lib/usuarios';
import {
  COMPROVANTE_DO_MOTORISTA_NAO_ENCONTRADO,
  DEVOLUCAO_NAO_ENCONTRADA,
  NAO_FOI_DEVOLVIDO,
  mensagemDoQueFalta,
  oQueFaltaNasFotos,
  reenvioSchema,
} from '@/lib/comprovantes';
import { TRANSACAO_COM_FOTOS, arquivarFotoAntiga, gravarFotos, perfilDaEmpresa } from '@/lib/comprovantes-db';
import { origemDaRequisicao, registrarAuditoria } from '@/lib/auditoria';
import { avisarEquipe, avisoDeComprovanteRefeito } from '@/lib/notificacoes';

/**
 * Reenvio de um comprovante devolvido pela conferência: o motorista manda
 * fotos novas e, se quiser, corrige o nome e o documento de quem recebeu. O
 * `[id]` é o da carga.
 *
 * - Só o motorista da viagem daquela carga refaz (viagem em rota ou já
 *   finalizada: a devolução costuma chegar depois do retorno).
 * - A carga não muda: continua entregue, sem linha nova no histórico.
 * - Nada é apagado: as fotos devolvidas ficam marcadas como substituídas e a
 *   devolução fica registrada, agora com a hora da resposta.
 * - O comprovante volta para `SUBMITTED` e entra de novo na fila.
 * - Repetir o mesmo envio responde 200 sem gravar de novo: o `rejectionId` diz
 *   a qual devolução ele responde, e devolução já respondida não é respondida
 *   outra vez.
 * - As fotos novas substituem todas as anteriores, então precisam atender,
 *   sozinhas, ao perfil da empresa e à ressalva do comprovante.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { driverId, userId, ator, error } = await requireDriver();
  if (error) return error;

  try {
    const collectionId = (await params).id;
    const origem = origemDaRequisicao(req);

    const parsed = reenvioSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const { rejectionId, photos, receiverName, receiverDoc } = parsed.data;
    const perfil = await perfilDaEmpresa();

    const resultado = await transacao(async (tx) => {
      const proof = await tx.proofOfDelivery.findFirst({
        where: { collectionId, collection: { manifest: { driverId, status: { in: ['ROUTE', 'FINISHED'] } } } },
        select: {
          id: true,
          status: true,
          photoBase64: true,
          createdAt: true,
          exceptionType: true,
          receiverName: true,
          collection: { select: { receiver: true, destination: true } },
        },
      });
      if (!proof) throw new Refusal(COMPROVANTE_DO_MOTORISTA_NAO_ENCONTRADO, 404);

      const devolucao = await tx.proofRejection.findFirst({
        where: { id: rejectionId, proofId: proof.id },
        select: { id: true, resubmittedAt: true },
      });
      if (!devolucao) throw new Refusal(DEVOLUCAO_NAO_ENCONTRADA, 404);
      // A mesma resposta chegando de novo (a primeira valeu e só a resposta se perdeu).
      if (devolucao.resubmittedAt) return { proofId: proof.id, repetido: true };
      if (proof.status !== 'REJECTED') throw new Refusal(NAO_FOI_DEVOLVIDO, 409);

      const falta = mensagemDoQueFalta(oQueFaltaNasFotos(perfil, photos.map((foto) => foto.kind), proof.exceptionType));
      if (falta) throw new Refusal(falta, 400);

      // De dois reenvios simultâneos, só um encontra a devolução em aberto.
      const agora = new Date();
      const { count } = await tx.proofRejection.updateMany({
        where: { id: devolucao.id, resubmittedAt: null },
        data: { resubmittedAt: agora },
      });
      if (count === 0) return { proofId: proof.id, repetido: true };

      await arquivarFotoAntiga(tx, proof, agora);
      await tx.proofPhoto.updateMany({ where: { proofId: proof.id, replacedAt: null }, data: { replacedAt: agora } });
      await gravarFotos(tx, { proofId: proof.id }, photos);
      // O motivo e quem devolveu saem do comprovante: ficam na devolução, que é o histórico.
      await tx.proofOfDelivery.update({
        where: { id: proof.id },
        data: {
          status: 'SUBMITTED',
          reviewedAt: null,
          reviewedById: null,
          rejectionReason: null,
          ...(receiverName !== undefined && { receiverName }),
          ...(receiverDoc !== undefined && { receiverDoc }),
        },
        select: { id: true },
      });
      // O nome de quem recebeu também está na carga: os dois andam juntos.
      if (receiverName !== undefined) {
        await tx.collection.update({ where: { id: collectionId }, data: { receiverName }, select: { id: true } });
      }

      await avisarEquipe(tx, 'comprovantes', avisoDeComprovanteRefeito({ id: collectionId, ...proof.collection }), userId);
      // Só o nome de quem recebeu: documento e fotos ficam no comprovante.
      const nome = receiverName ?? proof.receiverName;
      await registrarAuditoria(tx, {
        ator,
        origem,
        acao: 'comprovante.reenviar',
        entidade: 'comprovante',
        entidadeId: proof.id,
        resumo: `Comprovante refeito pelo motorista (${photos.length} ${photos.length === 1 ? 'foto nova' : 'fotos novas'})`,
        antes: { status: 'REJECTED', receiverName: proof.receiverName },
        depois: { status: 'SUBMITTED', receiverName: nome, cargaId: collectionId },
      });
      return { proofId: proof.id, repetido: false };
    }, TRANSACAO_COM_FOTOS);

    // A resposta não devolve as fotos: o aparelho acabou de enviá-las.
    return NextResponse.json({
      success: true,
      collectionId,
      proofId: resultado.proofId,
      ...(resultado.repetido && { alreadyResubmitted: true }),
    });
  } catch (err) {
    if (err instanceof Refusal) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('Erro ao reenviar comprovante:', err);
    return NextResponse.json({ error: 'Erro ao reenviar o comprovante' }, { status: 500 });
  }
}
