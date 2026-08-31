import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireDriver } from '@/lib/driver';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { driverId, error } = await requireDriver();
  if (error) return error;

  try {
    const deliveryId = (await params).id;

    // A entrega precisa ser deste motorista — direto ou pelo manifesto dele.
    // Sem esta checagem, qualquer usuário logado dava baixa em qualquer entrega,
    // e o comprovante é documento de valor legal.
    const delivery = await prisma.delivery.findFirst({
      where: {
        id: deliveryId,
        OR: [{ driverId }, { manifest: { driverId } }],
      },
      select: { id: true, status: true },
    });

    if (!delivery) {
      return NextResponse.json(
        { error: 'Entrega não encontrada na sua viagem.' },
        { status: 404 }
      );
    }

    const body = await req.json();
    const {
      receiverName,
      receiverDoc,
      photoBase64,
      signatureBase64,
      latitude,
      longitude,
    } = body;

    if (!receiverName || !receiverDoc) {
      return NextResponse.json(
        { error: 'Nome e documento do recebedor são obrigatórios' },
        { status: 400 }
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      const updatedDelivery = await tx.delivery.update({
        where: { id: deliveryId },
        data: {
          status: 'DELIVERED',
          receiverName,
          receiverDoc,
        },
      });

      const proof = await tx.proofOfDelivery.upsert({
        where: { deliveryId },
        update: {
          receiverName,
          receiverDoc,
          photoBase64,
          signatureBase64,
          latitude,
          longitude,
          status: 'SUBMITTED',
        },
        create: {
          deliveryId,
          receiverName,
          receiverDoc,
          photoBase64,
          signatureBase64,
          latitude,
          longitude,
          status: 'SUBMITTED',
        },
      });

      return { updatedDelivery, proof };
    });

    return NextResponse.json({ success: true, result });
  } catch (error) {
    console.error('Erro na baixa de entrega:', error);
    return NextResponse.json(
      { error: 'Erro ao processar baixa de entrega' },
      { status: 500 }
    );
  }
}
