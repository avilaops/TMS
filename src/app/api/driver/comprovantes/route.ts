import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireDriver } from '@/lib/driver';
import { perfilDaEmpresa } from '@/lib/comprovantes-db';
import type { ComprovantesDoMotorista } from '@/lib/comprovantes';

/** Quantos comprovantes devolvidos a tela inicial do motorista lista. */
const LIMITE = 50;

/**
 * O que o aplicativo do motorista precisa saber sobre comprovantes:
 *
 * - `perfil`: o que a empresa exige na baixa (LIVRE, ECOMMERCE ou B2B). A tela
 *   guarda no aparelho para marcar o que é obrigatório mesmo sem sinal;
 * - `refazer`: os comprovantes que a conferência devolveu a este motorista,
 *   com o motivo. Só os das viagens dele, em rota ou já finalizadas. Sem foto,
 *   assinatura nem posição: a lista é só para ele saber qual refazer.
 */
export async function GET() {
  const { driverId, error } = await requireDriver();
  if (error) return error;

  try {
    const perfil = await perfilDaEmpresa();
    const devolvidos = await prisma.proofOfDelivery.findMany({
      where: { status: 'REJECTED', collection: { manifest: { driverId, status: { in: ['ROUTE', 'FINISHED'] } } } },
      orderBy: [{ reviewedAt: 'desc' }, { id: 'asc' }],
      take: LIMITE,
      select: {
        receiverName: true,
        receiverDoc: true,
        exceptionType: true,
        collection: { select: { id: true, receiver: true, destination: true } },
        // A devolução em aberto: é a ela que o reenvio responde.
        rejections: {
          where: { resubmittedAt: null },
          orderBy: [{ rejectedAt: 'desc' }, { id: 'asc' }],
          take: 1,
          select: { id: true, reason: true, rejectedAt: true },
        },
      },
    });

    const resposta: ComprovantesDoMotorista = {
      perfil,
      refazer: devolvidos.flatMap((comprovante) => {
        const [devolucao] = comprovante.rejections;
        // Devolvido sem devolução registrada é dado gravado por fora: não há o que responder.
        if (!devolucao) return [];
        return [
          {
            collectionId: comprovante.collection.id,
            receiver: comprovante.collection.receiver,
            destination: comprovante.collection.destination,
            receiverName: comprovante.receiverName,
            receiverDoc: comprovante.receiverDoc,
            exceptionType: comprovante.exceptionType,
            rejectionId: devolucao.id,
            reason: devolucao.reason,
            rejectedAt: devolucao.rejectedAt.toISOString(),
          },
        ];
      }),
    };

    return NextResponse.json(resposta, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('Erro ao buscar comprovantes do motorista:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
