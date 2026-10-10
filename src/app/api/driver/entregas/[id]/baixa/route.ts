import { NextResponse } from 'next/server';
import prisma, { transacao } from '@/lib/prisma';
import { requireDriver } from '@/lib/driver';
import { firstIssue } from '@/lib/usuarios';
import {
  DELIVERED_BY_PANEL_MESSAGE,
  DELIVERY_NOT_FOUND_MESSAGE,
  NOT_IN_ROUTE_MESSAGE,
  baixaSchema,
} from '@/lib/entregas';
import { recordStatusChanges } from '@/lib/historico';
import { origemDaRequisicao, registrarAuditoria } from '@/lib/auditoria';

/**
 * Baixa de entrega pelo motorista, com o comprovante.
 *
 * A entrega é a própria carga: o `[id]` é o da coleta. Duas propriedades
 * sustentam esta rota:
 *
 * 1. Só a carga em rota numa viagem liberada deste motorista recebe baixa. Sem
 *    isso qualquer motorista logado daria baixa na entrega de outro, e o
 *    comprovante é documento de valor legal.
 *
 * 2. Repetir a mesma baixa responde 200. O aplicativo guarda a baixa numa fila
 *    quando a rede cai e reenvia depois; se a primeira tentativa chegou e só a
 *    resposta se perdeu, o reenvio não pode virar erro nem um segundo comprovante.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { driverId, userId, ator, error } = await requireDriver();
  if (error) return error;

  try {
    const collectionId = (await params).id;
    const origem = origemDaRequisicao(req);

    const parsed = baixaSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const { receiverName, receiverDoc, photoBase64, signatureBase64, latitude, longitude } = parsed.data;

    // Viagem finalizada também entra na busca: é onde a carga está quando o
    // reenvio de uma baixa já registrada chega depois do retorno.
    const find = () =>
      prisma.collection.findFirst({
        where: { id: collectionId, manifest: { driverId, status: { in: ['ROUTE', 'FINISHED'] } } },
        select: { status: true, manifest: { select: { status: true } }, proof: { select: { id: true } } },
      });

    const alreadyDone = (proofId: string) =>
      NextResponse.json({ success: true, alreadyDelivered: true, collectionId, proofId });

    const current = await find();
    if (!current) {
      return NextResponse.json({ error: DELIVERY_NOT_FOUND_MESSAGE }, { status: 404 });
    }
    if (current.status === 'DELIVERED') {
      return current.proof
        ? alreadyDone(current.proof.id)
        : NextResponse.json({ error: DELIVERED_BY_PANEL_MESSAGE }, { status: 409 });
    }
    if (current.status !== 'ROUTE' || current.manifest?.status !== 'ROUTE') {
      return NextResponse.json({ error: NOT_IN_ROUTE_MESSAGE }, { status: 409 });
    }

    const proofId = await transacao(async (tx) => {
      // Grava só se a carga ainda estiver em rota nesta viagem: de duas baixas
      // simultâneas, ou de baixa e retirada ao mesmo tempo, uma encontra zero linhas.
      // Comprovante, linha do histórico e linha da auditoria vão na mesma
      // transação: ou ficam as quatro gravações, ou nenhuma.
      const { count } = await tx.collection.updateMany({
        where: { id: collectionId, status: 'ROUTE', manifest: { driverId, status: 'ROUTE' } },
        data: { status: 'DELIVERED', receiverName },
      });
      if (count === 0) return null;

      const proof = await tx.proofOfDelivery.create({
        data: { collectionId, receiverName, receiverDoc, photoBase64, signatureBase64, latitude, longitude },
        select: { id: true },
      });
      await recordStatusChanges(tx, [
        { collectionId, fromStatus: 'ROUTE', toStatus: 'DELIVERED', userId },
      ]);
      // Só o nome de quem recebeu: documento, foto, assinatura e localização ficam no comprovante.
      await registrarAuditoria(tx, {
        ator,
        origem,
        acao: 'entrega.baixar',
        entidade: 'coleta',
        entidadeId: collectionId,
        resumo: `Entrega baixada pelo motorista, recebida por ${receiverName}`,
        antes: { status: 'ROUTE' },
        depois: { status: 'DELIVERED', receiverName },
      });
      return proof.id;
    });

    if (proofId === null) {
      // Perdeu a corrida. Se quem ganhou foi a mesma baixa, está feito.
      const after = await find();
      if (after?.status === 'DELIVERED' && after.proof) return alreadyDone(after.proof.id);
      return NextResponse.json(
        { error: after ? NOT_IN_ROUTE_MESSAGE : DELIVERY_NOT_FOUND_MESSAGE },
        { status: after ? 409 : 404 }
      );
    }

    // A resposta não devolve foto nem assinatura: o aparelho acabou de enviá-las.
    return NextResponse.json({ success: true, collectionId, proofId });
  } catch (error) {
    console.error('Erro na baixa de entrega:', error);
    return NextResponse.json(
      { error: 'Erro ao processar baixa de entrega' },
      { status: 500 }
    );
  }
}
