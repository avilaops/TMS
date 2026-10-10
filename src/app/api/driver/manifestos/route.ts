import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireDriver } from '@/lib/driver';
import { ORDEM_DAS_CARGAS } from '@/lib/manifestos-db';

/** Viagens do motorista logado. Nunca devolve manifesto de outro motorista. */
export async function GET() {
  const { driverId, error } = await requireDriver();
  if (error) return error;

  try {
    const manifestos = await prisma.manifest.findMany({
      // Só a viagem liberada: em montagem ela ainda pode mudar de carga, de
      // veículo e até de motorista.
      where: { driverId, status: 'ROUTE' },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        createdAt: true,
        vehicle: { select: { plate: true, model: true } },
        // O MDF-e da viagem, só para o motorista ler na fiscalização: chave e situação. Sem XML.
        mdfes: {
          where: { status: { in: ['AUTHORIZED', 'CLOSED', 'CANCELLED'] } },
          orderBy: { number: 'asc' },
          select: { id: true, number: true, accessKey: true, status: true, environment: true, unloadState: true },
        },
        collections: {
          select: {
            id: true,
            receiver: true,
            origin: true,
            destination: true,
            volumes: true,
            weight: true,
            status: true,
            receiverName: true,
            // O que o cliente pediu para a coleta: janela, urgência e observação.
            pickupDate: true,
            pickupFrom: true,
            pickupTo: true,
            priority: true,
            cubicMeters: true,
            pickupNotes: true,
            // O endereço da entrega, para o cartão da parada e o link do mapa.
            deliveryStreet: true,
            deliveryNumber: true,
            deliveryDistrict: true,
            deliveryZip: true,
            // Só o nome de quem embarcou: limite de crédito e contato do
            // cliente não vão para o aparelho do motorista.
            client: { select: { tradeName: true, companyName: true } },
            // Para a situação da parada: só o status do comprovante, se houve
            // ressalva e quantas tentativas sem sucesso. Foto nenhuma vem por aqui.
            proof: { select: { status: true, exceptionType: true } },
            _count: { select: { deliveryAttempts: true } },
          },
          // A ordem das entregas que a operação definiu na viagem.
          orderBy: ORDEM_DAS_CARGAS,
        },
      },
    });

    // A parada sai com três campos planos no lugar do comprovante e da contagem:
    // `proofStatus`, `withException` e `attempts` (src/lib/comprovantes.ts).
    return NextResponse.json(
      manifestos.map((manifesto) => ({
        ...manifesto,
        collections: manifesto.collections.map(({ proof, _count, ...carga }) => ({
          ...carga,
          proofStatus: proof?.status ?? null,
          withException: Boolean(proof?.exceptionType),
          attempts: _count.deliveryAttempts,
        })),
      })),
    );
  } catch (error) {
    console.error('Erro ao buscar viagens do motorista:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
