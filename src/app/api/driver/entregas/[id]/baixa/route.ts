import { NextResponse } from 'next/server';
import prisma, { transacao } from '@/lib/prisma';
import { requireDriver } from '@/lib/driver';
import { firstIssue } from '@/lib/usuarios';
import {
  DELIVERED_BY_PANEL_MESSAGE,
  DELIVERY_NOT_FOUND_MESSAGE,
  NOT_IN_ROUTE_MESSAGE,
  baixaSchema,
  fotosDaBaixa,
} from '@/lib/entregas';
import { ROTULO_DA_RESSALVA, distanciaEmMetros, mensagemDoQueFalta, oQueFaltaNasFotos } from '@/lib/comprovantes';
import { TRANSACAO_COM_FOTOS, gravarFotos, perfilDaEmpresa } from '@/lib/comprovantes-db';
import { recordStatusChanges } from '@/lib/historico';
import { origemDaRequisicao, registrarAuditoria } from '@/lib/auditoria';
import { avisarEquipe, avisarStatusAoCliente, avisoDeComprovante, avisoDeRessalva } from '@/lib/notificacoes';

/**
 * Baixa de entrega pelo motorista, com o comprovante.
 *
 * A entrega é a própria carga: o `[id]` é o da coleta. Três propriedades
 * sustentam esta rota:
 *
 * 1. Só a carga em rota numa viagem liberada deste motorista recebe baixa. Sem
 *    isso qualquer motorista logado daria baixa na entrega de outro, e o
 *    comprovante é documento de valor legal.
 *
 * 2. Repetir a mesma baixa responde 200. O aplicativo guarda a baixa numa fila
 *    quando a rede cai e reenvia depois; se a primeira tentativa chegou e só a
 *    resposta se perdeu, o reenvio não pode virar erro nem um segundo comprovante.
 *
 * 3. O que o comprovante precisa ter depende do perfil da empresa
 *    (`Tenant.podProfile`): foto da carga no local (e-commerce) ou do canhoto
 *    assinado (carga B2B). Ressalva de avaria ou de embalagem violada pede a
 *    foto da avaria. Faltando, a baixa é recusada com 400 dizendo o que falta.
 *
 * A entrega com ressalva é concluída do mesmo jeito: a carga vira entregue, o
 * comprovante fica marcado e quem atende chamados é avisado.
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
    const { receiverName, receiverDoc, signatureBase64, latitude, longitude, receiverRelation, exception } = parsed.data;
    const fotos = fotosDaBaixa(parsed.data);

    // Viagem finalizada também entra na busca: é onde a carga está quando o
    // reenvio de uma baixa já registrada chega depois do retorno.
    const find = () =>
      prisma.collection.findFirst({
        where: { id: collectionId, manifest: { driverId, status: { in: ['ROUTE', 'FINISHED'] } } },
        select: {
          status: true,
          receiver: true,
          destination: true,
          deliveryLat: true,
          deliveryLon: true,
          manifest: { select: { status: true } },
          proof: { select: { id: true } },
        },
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

    // Só agora, com a carga pronta para a baixa: a repetição de uma baixa já
    // registrada responde 200 acima, mesmo que o perfil tenha mudado depois.
    const falta = mensagemDoQueFalta(oQueFaltaNasFotos(await perfilDaEmpresa(), fotos.map((foto) => foto.kind), exception?.type));
    if (falta) {
      return NextResponse.json({ error: falta }, { status: 400 });
    }

    const proofId = await transacao(async (tx) => {
      // Grava só se a carga ainda estiver em rota nesta viagem: de duas baixas
      // simultâneas, ou de baixa e retirada ao mesmo tempo, uma encontra zero linhas.
      // Comprovante, linha do histórico, avisos do sininho e linha da auditoria
      // vão na mesma transação: ou ficam todas as gravações, ou nenhuma.
      const { count } = await tx.collection.updateMany({
        where: { id: collectionId, status: 'ROUTE', manifest: { driverId, status: 'ROUTE' } },
        data: { status: 'DELIVERED', receiverName },
      });
      if (count === 0) return null;

      // As fotos vão só para a tabela de fotos: a coluna `photoBase64` fica
      // para os comprovantes antigos. A distância do endereço não bloqueia nada:
      // fica gravada para o painel avisar quando a baixa foi feita longe.
      const proof = await tx.proofOfDelivery.create({
        data: {
          collectionId,
          receiverName,
          receiverDoc,
          receiverRelation: receiverRelation ?? null,
          signatureBase64,
          latitude,
          longitude,
          distanceMeters: distanciaEmMetros({ latitude, longitude }, current),
          exceptionType: exception?.type ?? null,
          exceptionNote: exception?.note ?? null,
        },
        select: { id: true },
      });
      await gravarFotos(tx, { proofId: proof.id }, fotos);
      const trocas = [{ collectionId, fromStatus: 'ROUTE', toStatus: 'DELIVERED', userId }];
      await recordStatusChanges(tx, trocas);
      // Sininho: o cliente sabe que chegou, e quem confere comprovante sabe que há um novo.
      await avisarStatusAoCliente(tx, trocas, userId);
      const carga = { id: collectionId, receiver: current.receiver, destination: current.destination };
      await avisarEquipe(tx, 'comprovantes', avisoDeComprovante(carga, receiverName), userId);
      // Ressalva: quem atende chamados fica sabendo. Só o tipo vai no aviso.
      if (exception) await avisarEquipe(tx, 'ocorrencias', avisoDeRessalva(carga, ROTULO_DA_RESSALVA[exception.type]), userId);
      // Só o nome de quem recebeu e o tipo da ressalva: documento, foto,
      // assinatura, localização e a descrição da ressalva ficam no comprovante.
      await registrarAuditoria(tx, {
        ator,
        origem,
        acao: 'entrega.baixar',
        entidade: 'coleta',
        entidadeId: collectionId,
        resumo: `Entrega baixada pelo motorista, recebida por ${receiverName}${exception ? `, com ressalva (${ROTULO_DA_RESSALVA[exception.type]})` : ''}`,
        antes: { status: 'ROUTE' },
        depois: { status: 'DELIVERED', receiverName, ...(exception && { ressalva: exception.type }) },
      });
      return proof.id;
    }, TRANSACAO_COM_FOTOS);

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
