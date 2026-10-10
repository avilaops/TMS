import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import prisma, { transacao } from '@/lib/prisma';
import { requireDriver } from '@/lib/driver';
import { Refusal, isUniqueViolation } from '@/lib/cadastros';
import { firstIssue } from '@/lib/usuarios';
import { DELIVERY_NOT_FOUND_MESSAGE, NOT_IN_ROUTE_MESSAGE } from '@/lib/entregas';
import { driverOccurrenceSchema, tituloDoMotorista } from '@/lib/ocorrencias';
import { abrirOcorrencia } from '@/lib/ocorrencias-db';
import {
  ROTULO_DO_INSUCESSO,
  distanciaEmMetros,
  ehInsucesso,
  insucessoSchema,
  problemaNoInsucesso,
  tituloDoInsucesso,
} from '@/lib/comprovantes';
import { TRANSACAO_COM_FOTOS, gravarFotos, perfilDaEmpresa } from '@/lib/comprovantes-db';
import { origemDaRequisicao, registrarAuditoria, type Ator } from '@/lib/auditoria';
import { avisarEquipe, avisoDeChamadoNovo } from '@/lib/notificacoes';

/**
 * Ocorrência registrada pelo motorista numa entrega (o `[id]` é o da carga).
 *
 * Só vale para carga de uma viagem liberada deste motorista: sem isso qualquer
 * motorista logado abriria chamado na carga de outro. Nasce como chamado
 * interno, ligado à carga e sem `clientId`: o que o motorista escreveu é para a
 * equipe, e o portal só mostra chamado que tem o cliente como dono.
 *
 * Dois corpos chegam aqui:
 *
 * - `{ type, description }`: a ocorrência de sempre (avaria, atraso...);
 * - `{ reason, ... }`: a tentativa de entrega sem sucesso, com motivo
 *   padronizado (`insucesso`, abaixo). É a mesma ocorrência, com o registro da
 *   tentativa a mais.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { driverId, userId, ator, error } = await requireDriver();
  if (error) return error;

  try {
    const collectionId = (await params).id;
    const origem = origemDaRequisicao(req);
    const corpo: unknown = await req.json().catch(() => null);
    if (ehInsucesso(corpo)) return await insucesso({ corpo, collectionId, driverId, userId, ator, origem });

    const parsed = driverOccurrenceSchema.safeParse(corpo);
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const { type, description } = parsed.data;

    const ocorrencia = await transacao(async (tx) => {
      const carga = await tx.collection.findFirst({
        where: { id: collectionId, manifest: { driverId, status: 'ROUTE' } },
        select: { id: true, receiver: true },
      });
      if (!carga) throw new Refusal(DELIVERY_NOT_FOUND_MESSAGE, 404);

      const title = tituloDoMotorista(type, carga.receiver);
      const criada = await abrirOcorrencia(tx, {
        type,
        title,
        description,
        collectionId: carga.id,
        clientId: null,
        openedById: userId,
        origin: 'STAFF',
      });

      await registrarAuditoria(tx, {
        ator,
        origem,
        acao: 'ocorrencia.abrir',
        entidade: 'ocorrencia',
        entidadeId: criada.id,
        resumo: `Chamado nº ${criada.number} aberto pelo motorista: ${title}`,
        depois: { number: criada.number, type, title, cargaId: carga.id },
      });
      // Sininho: quem atende chamados sabe que o motorista registrou um na rua.
      await avisarEquipe(tx, 'ocorrencias', avisoDeChamadoNovo({ ...criada, title }, 'motorista'), userId);
      return criada;
    });

    return NextResponse.json({ success: true, id: ocorrencia.id, number: ocorrencia.number }, { status: 201 });
  } catch (err) {
    if (err instanceof Refusal) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('Erro ao registrar ocorrência do motorista:', err);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

/** A tentativa já gravada com esta chave nesta carga, com o chamado dela e o total de tentativas da carga. */
async function tentativaJaRegistrada(db: Pick<Prisma.TransactionClient, 'deliveryAttempt'>, key: string, collectionId: string) {
  const repetida = await db.deliveryAttempt.findFirst({
    where: { clientKey: key, collectionId },
    select: { id: true, occurrence: { select: { id: true, number: true } } },
  });
  if (!repetida) return null;
  const tentativas = await db.deliveryAttempt.count({ where: { collectionId } });
  return { repetida: true, attemptId: repetida.id, chamado: repetida.occurrence, tentativas };
}

type Insucesso = { corpo: unknown; collectionId: string; driverId: string; userId: string; ator: Ator; origem: ReturnType<typeof origemDaRequisicao> };

/**
 * Tentativa de entrega sem sucesso: o motorista foi até lá e não entregou.
 *
 * - Motivo padronizado (ausente, endereço não localizado, recusou, fechado,
 *   mudou-se, área de risco, ou outro com descrição).
 * - Com perfil de e-commerce ou de carga B2B na empresa, a foto da fachada é
 *   obrigatória; no perfil livre, opcional.
 * - Fica registrada por tentativa (uma carga pode ter várias), com a posição
 *   quando houver e a distância do endereço.
 * - Abre um chamado de reentrega para a equipe, como toda ocorrência do
 *   motorista: é por ele que a operação decide o que fazer.
 * - A carga NÃO muda de status: continua em rota, na mesma viagem, como já era
 *   depois de qualquer ocorrência. O que muda é o contador de tentativas.
 * - Só carga ainda em rota: não se registra tentativa sem sucesso de carga já
 *   entregue.
 * - Repetir o envio com a mesma `key` responde 200 com a tentativa já gravada.
 */
async function insucesso({ corpo, collectionId, driverId, userId, ator, origem }: Insucesso) {
  const parsed = insucessoSchema.safeParse(corpo);
  if (!parsed.success) {
    return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
  }
  const { reason, note, latitude, longitude, key } = parsed.data;
  const fotos = parsed.data.photos ?? [];
  const perfil = await perfilDaEmpresa();

  const registrar = () => transacao(async (tx) => {
    const carga = await tx.collection.findFirst({
      where: { id: collectionId, manifest: { driverId, status: 'ROUTE' } },
      select: { id: true, receiver: true, status: true, manifestId: true, deliveryLat: true, deliveryLon: true },
    });
    if (!carga) throw new Refusal(DELIVERY_NOT_FOUND_MESSAGE, 404);

    const repetida = key ? await tentativaJaRegistrada(tx, key, carga.id) : null;
    if (repetida) return repetida;

    if (carga.status !== 'ROUTE') throw new Refusal(NOT_IN_ROUTE_MESSAGE, 409);
    const problema = problemaNoInsucesso(perfil, fotos.map((foto) => foto.kind));
    if (problema) throw new Refusal(problema, 400);

    const title = tituloDoInsucesso(reason, carga.receiver);
    const anteriores = await tx.deliveryAttempt.count({ where: { collectionId: carga.id } });
    const tentativas = anteriores + 1;
    const criada = await abrirOcorrencia(tx, {
      type: 'REDELIVERY',
      title,
      description: `${tentativas}ª tentativa de entrega sem sucesso. Motivo: ${ROTULO_DO_INSUCESSO[reason]}.${note ? ` ${note}` : ''}`,
      collectionId: carga.id,
      clientId: null,
      openedById: userId,
      origin: 'STAFF',
    });
    const tentativa = await tx.deliveryAttempt.create({
      data: {
        collectionId: carga.id,
        manifestId: carga.manifestId,
        occurrenceId: criada.id,
        reason,
        note: note ?? null,
        latitude,
        longitude,
        distanceMeters: distanciaEmMetros({ latitude, longitude }, carga),
        clientKey: key ?? null,
      },
      select: { id: true },
    });
    await gravarFotos(tx, { attemptId: tentativa.id }, fotos);

    // Só o motivo e o número da tentativa: foto e posição ficam no registro.
    await registrarAuditoria(tx, {
      ator,
      origem,
      acao: 'entrega.insucesso',
      entidade: 'coleta',
      entidadeId: carga.id,
      resumo: `${tentativas}ª tentativa de entrega sem sucesso: ${ROTULO_DO_INSUCESSO[reason]} (chamado nº ${criada.number})`,
      depois: { motivo: reason, tentativa: tentativas, chamado: criada.number },
    });
    // Sininho: quem atende chamados sabe que a entrega não saiu.
    await avisarEquipe(tx, 'ocorrencias', avisoDeChamadoNovo({ ...criada, title }, 'motorista'), userId);
    return { repetida: false, attemptId: tentativa.id, chamado: criada, tentativas };
  }, TRANSACAO_COM_FOTOS);

  // Dois envios simultâneos com a mesma chave: o segundo esbarra na chave
  // única e recebe a tentativa que o primeiro gravou.
  const resultado = await registrar().catch(async (erro: unknown) => {
    const gravada = key && isUniqueViolation(erro) ? await tentativaJaRegistrada(prisma, key, collectionId) : null;
    if (!gravada) throw erro;
    return gravada;
  });

  return NextResponse.json(
    {
      success: true,
      attemptId: resultado.attemptId,
      id: resultado.chamado?.id ?? null,
      number: resultado.chamado?.number ?? null,
      attempts: resultado.tentativas,
      ...(resultado.repetida && { alreadyRegistered: true }),
    },
    { status: resultado.repetida ? 200 : 201 },
  );
}
