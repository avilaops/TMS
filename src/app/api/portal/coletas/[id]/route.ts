import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requirePortalClient } from '@/lib/portal';

/**
 * Uma coleta do cliente logado, com a linha do tempo e o comprovante de entrega.
 *
 * O filtro por `clientId` é o que separa um cliente do outro dentro da mesma
 * transportadora (a transportadora em si já é separada pelo banco). Coleta de
 * outro cliente responde 404, igual a id que não existe.
 *
 * O comprovante só aparece depois de APROVADO pela transportadora: antes disso
 * a foto e a assinatura ainda estão em conferência e podem ser recusadas.
 * O `select` é fechado: localização do motorista, quem conferiu e o motivo de
 * uma recusa são dados internos.
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
        status: true,
        createdAt: true,
        trackingCode: true,
        client: { select: { cnpj: true } },
        statusHistory: {
          select: { toStatus: true, createdAt: true },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        },
        manifest: { select: { driver: { select: { user: { select: { name: true } } } } } },
        proof: {
          select: {
            status: true,
            receiverName: true,
            receiverDoc: true,
            photoBase64: true,
            signatureBase64: true,
            createdAt: true,
          },
        },
      },
    });

    if (!coleta) return NextResponse.json({ error: 'Coleta não encontrada.' }, { status: 404 });

    const { proof, ...resto } = coleta;
    return NextResponse.json(
      {
        ...resto,
        // Em conferência ou recusado: o cliente só fica sabendo que ainda não há comprovante liberado.
        proof: proof?.status === 'APPROVED' ? proof : null,
      },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error) {
    console.error('Erro ao buscar coleta do portal:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
