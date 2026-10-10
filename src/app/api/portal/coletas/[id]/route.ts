import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requirePortalClient } from '@/lib/portal';
import { danfeLigado } from '@/lib/fiscal-mcp';

/** Tipos de foto que o cliente vê no comprovante aprovado. */
const FOTOS_DO_PORTAL = ['ENTREGA', 'CANHOTO'] as const;

/**
 * Uma coleta do cliente logado, com a linha do tempo e o comprovante de entrega.
 *
 * O filtro por `clientId` é o que separa um cliente do outro dentro da mesma
 * transportadora (a transportadora em si já é separada pelo banco). Coleta de
 * outro cliente responde 404, igual a id que não existe.
 *
 * O comprovante só aparece depois de APROVADO pela transportadora: antes disso
 * a foto e a assinatura ainda estão em conferência e podem ser recusadas.
 * O `select` é fechado: localização do motorista, a distância do endereço,
 * quem conferiu e o motivo de uma devolução são dados internos. Das fotos, só
 * as da entrega e do canhoto que valem hoje: foto de avaria, de fachada e as
 * substituídas num reenvio ficam no painel.
 *
 * A ressalva (`exception`: tipo e descrição) é a exceção à espera pela
 * aprovação: aparece assim que a entrega é registrada, porque é o cliente que
 * precisa saber que a carga chegou com avaria ou faltando volume. Vai sem foto.
 *
 * A resposta leva a foto e a assinatura de quem recebeu: não pode ficar em
 * cache de navegador compartilhado nem de intermediário.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { clientId, error } = await requirePortalClient();
  if (error) return error;

  try {
    const { id } = await params;

    const coleta = await prisma.collection.findFirst({
      where: { id, clientId },
      select: {
        id: true,
        sender: true,
        receiver: true,
        origin: true,
        destination: true,
        volumes: true,
        weight: true,
        invoiceValue: true,
        freightValue: true,
        freightDeadlineHours: true,
        pickupDate: true,
        pickupFrom: true,
        pickupTo: true,
        priority: true,
        cubicMeters: true,
        pickupNotes: true,
        status: true,
        createdAt: true,
        trackingCode: true,
        client: { select: { cnpj: true } },
        statusHistory: {
          select: { toStatus: true, createdAt: true },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        },
        manifest: { select: { driver: { select: { user: { select: { name: true } } } } } },
        // Notas fiscais ligadas à carga: só o que identifica a nota. O XML sai
        // por /api/portal/coletas/[id]/notas/[notaId].
        fiscalDocuments: {
          select: { id: true, number: true, series: true, accessKey: true },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        },
        proof: {
          select: {
            status: true,
            receiverName: true,
            receiverDoc: true,
            photoBase64: true,
            signatureBase64: true,
            createdAt: true,
            receiverRelation: true,
            exceptionType: true,
            exceptionNote: true,
            photos: {
              where: { replacedAt: null, kind: { in: [...FOTOS_DO_PORTAL] } },
              select: { id: true, kind: true, dataUrl: true, createdAt: true },
              orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            },
          },
        },
      },
    });

    if (!coleta) return NextResponse.json({ error: 'Coleta não encontrada.' }, { status: 404 });

    const { proof, ...resto } = coleta;
    const { exceptionType, exceptionNote, ...comprovante } = proof ?? { exceptionType: null, exceptionNote: null };
    return NextResponse.json(
      {
        ...resto,
        // Em conferência ou devolvido: o cliente só fica sabendo que ainda não há comprovante liberado.
        proof: proof?.status === 'APPROVED' ? comprovante : null,
        // Entrega com ressalva: tipo e descrição, desde o registro.
        exception: exceptionType ? { type: exceptionType, note: exceptionNote } : null,
        // O serviço que gera o DANFE das notas está ligado? Sem ele a tela não mostra o botão.
        danfe: danfeLigado(),
      },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error) {
    console.error('Erro ao buscar coleta do portal:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
