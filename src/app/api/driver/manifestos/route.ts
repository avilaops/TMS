import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireDriver } from '@/lib/driver';

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
        collections: {
          select: {
            id: true,
            receiver: true,
            origin: true,
            destination: true,
            volumes: true,
            weight: true,
            status: true,
          },
        },
        deliveries: {
          select: {
            id: true,
            receiverName: true,
            status: true,
          },
        },
      },
    });

    return NextResponse.json(manifestos);
  } catch (error) {
    console.error('Erro ao buscar viagens do motorista:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
