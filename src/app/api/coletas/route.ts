import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import prisma from '@/lib/prisma';
import {
  COLLECTION_INCLUDE,
  INACTIVE_CLIENT_MESSAGE,
  INACTIVE_DRIVER_MESSAGE,
  createCollectionSchema,
} from '@/lib/coletas';
import { firstIssue } from '@/lib/usuarios';
import { withTrackingCode } from '@/lib/tracking';

export async function GET() {
  const { error } = await requireStaff();
  if (error) return error;

  try {
    const coletas = await prisma.collection.findMany({
      include: COLLECTION_INCLUDE,
      orderBy: { createdAt: 'desc' }
    });
    return NextResponse.json(coletas);
  } catch (error) {
    console.error('Error fetching collections:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const { error } = await requireStaff();
  if (error) return error;

  try {
    const parsed = createCollectionSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const data = parsed.data;

    const client = await prisma.client.findFirst({
      where: { id: data.clientId, active: true },
      select: { id: true }
    });
    if (!client) {
      return NextResponse.json({ error: INACTIVE_CLIENT_MESSAGE }, { status: 400 });
    }

    if (data.driverId) {
      const driver = await prisma.driver.findFirst({
        where: { id: data.driverId, active: true },
        select: { id: true }
      });
      if (!driver) {
        return NextResponse.json({ error: INACTIVE_DRIVER_MESSAGE }, { status: 400 });
      }
    }

    // Toda coleta nasce com codigo: e ele, com o CNPJ, que abre o rastreio
    // publico. Uma coleta sem codigo simplesmente nao seria rastreavel.
    const newCollection = await withTrackingCode((trackingCode) =>
      prisma.collection.create({
        data: {
          clientId: data.clientId,
          sender: data.sender,
          receiver: data.receiver,
          origin: data.origin,
          destination: data.destination,
          volumes: data.volumes,
          weight: data.weight,
          invoiceKey: data.invoiceKey ?? null,
          invoiceValue: data.invoiceValue ?? null,
          driverId: data.driverId ?? null,
          // Quem cria pelo painel é o operador que aprovaria: nasce confirmada.
          // `PENDING` fica para o pedido que vem do portal do cliente.
          status: 'CONFIRMED',
          trackingCode,
        },
        include: COLLECTION_INCLUDE,
      })
    );

    return NextResponse.json(newCollection, { status: 201 });
  } catch (error) {
    console.error('Error creating collection:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
