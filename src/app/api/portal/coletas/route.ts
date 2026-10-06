import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requirePortalClient } from '@/lib/portal';
import { withTrackingCode } from '@/lib/tracking';

const COLLECTION_FIELDS = {
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
} as const;

export async function GET() {
  const { clientId, error } = await requirePortalClient();
  if (error) return error;

  try {
    const coletas = await prisma.collection.findMany({
      where: { clientId },
      orderBy: { createdAt: 'desc' },
      select: COLLECTION_FIELDS,
    });

    return NextResponse.json(coletas);
  } catch (error) {
    console.error('Erro ao buscar coletas:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const { clientId, userId, error } = await requirePortalClient();
  if (error) return error;

  try {
    const body = await req.json();
    const { sender, receiver, origin, destination, volumes, weight, invoiceValue } = body;

    if (!sender || !receiver || !origin || !destination || !volumes || !weight) {
      return NextResponse.json({ error: 'Dados obrigatórios incompletos' }, { status: 400 });
    }

    const volumesNumber = Number(volumes);
    const weightNumber = Number(weight);

    if (!Number.isFinite(volumesNumber) || volumesNumber <= 0) {
      return NextResponse.json({ error: 'Quantidade de volumes inválida' }, { status: 400 });
    }

    if (!Number.isFinite(weightNumber) || weightNumber <= 0) {
      return NextResponse.json({ error: 'Peso inválido' }, { status: 400 });
    }

    let invoiceValueNumber: number | null = null;
    if (invoiceValue !== undefined && invoiceValue !== null && invoiceValue !== '') {
      invoiceValueNumber = Number(invoiceValue);
      if (!Number.isFinite(invoiceValueNumber) || invoiceValueNumber < 0) {
        return NextResponse.json({ error: 'Valor da mercadoria inválido' }, { status: 400 });
      }
    }

    const collection = await withTrackingCode((trackingCode) =>
      prisma.collection.create({
        data: {
          clientId,
          sender: String(sender),
          receiver: String(receiver),
          origin: String(origin),
          destination: String(destination),
          volumes: volumesNumber,
          weight: weightNumber,
          invoiceValue: invoiceValueNumber,
          status: 'PENDING',
          trackingCode,
          // Primeira linha do histórico, gravada junto da coleta.
          statusHistory: { create: { fromStatus: null, toStatus: 'PENDING', userId } },
        },
        select: COLLECTION_FIELDS,
      })
    );

    return NextResponse.json({ success: true, collection }, { status: 201 });
  } catch (error) {
    console.error('Erro ao criar solicitação de coleta:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
