import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import prisma from '@/lib/prisma';
import {
  COLLECTION_INCLUDE,
  EDITABLE_STATUSES,
  INACTIVE_DRIVER_MESSAGE,
  isEditable,
  updateCollectionSchema,
} from '@/lib/coletas';
import { firstIssue } from '@/lib/usuarios';
import { freteDaColeta, type FreteDaColeta } from '@/lib/frete-coleta';
import { Prisma } from '@prisma/client';

const NOT_FOUND = 'Coleta não encontrada.';
const IN_MANIFEST = 'Esta coleta já está em um manifesto e não pode mais ser alterada.';
const CHANGED_MEANWHILE = 'A coleta mudou enquanto você editava. Atualize a página e tente de novo.';

const lockedByStatus = (status: string) =>
  `Coleta com status ${status} não pode mais ser alterada.`;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireStaff();
  if (error) return error;

  try {
    const { id } = await params;

    const coleta = await prisma.collection.findUnique({ where: { id }, include: COLLECTION_INCLUDE });
    if (!coleta) {
      return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
    }

    return NextResponse.json(coleta);
  } catch (error) {
    console.error('Error fetching collection:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireStaff();
  if (error) return error;

  try {
    const { id } = await params;

    const parsed = updateCollectionSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const data = parsed.data;

    const target = await prisma.collection.findUnique({
      where: { id },
      select: {
        status: true,
        manifestId: true,
        driverId: true,
        clientId: true,
        destination: true,
        weight: true,
        volumes: true,
        invoiceValue: true,
        freightManual: true,
      }
    });
    if (!target) {
      return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
    }

    if (!isEditable(target)) {
      const message = target.manifestId !== null ? IN_MANIFEST : lockedByStatus(target.status);
      return NextResponse.json({ error: message }, { status: 409 });
    }

    // O motorista que já estava na coleta passa mesmo inativo: o formulário
    // reenvia o campo sem o operador ter mexido nele.
    if (data.driverId && data.driverId !== target.driverId) {
      const driver = await prisma.driver.findFirst({
        where: { id: data.driverId, active: true },
        select: { id: true }
      });
      if (!driver) {
        return NextResponse.json({ error: INACTIVE_DRIVER_MESSAGE }, { status: 400 });
      }
    }

    // Frete: número no corpo fixa o valor à mão; `null` devolve o cálculo para a
    // tabela. Sem o campo, o valor só é refeito se não estava fixado e algo que
    // entra na conta mudou.
    const { freightValue, ...campos } = data;
    let frete: (FreteDaColeta & { freightManual: boolean }) | undefined;

    if (typeof freightValue === 'number') {
      frete = { freightValue, freightDeadlineHours: null, freightTableId: null, freightDetails: null, freightManual: true };
    } else {
      const mudouAConta =
        campos.destination !== undefined ||
        campos.weight !== undefined ||
        campos.volumes !== undefined ||
        campos.invoiceValue !== undefined;
      if (freightValue === null || (mudouAConta && !target.freightManual)) {
        const calculado = await freteDaColeta(prisma, {
          clientId: target.clientId,
          destination: campos.destination ?? target.destination,
          weight: campos.weight ?? target.weight,
          volumes: campos.volumes ?? target.volumes,
          invoiceValue: campos.invoiceValue === undefined ? target.invoiceValue : campos.invoiceValue,
        });
        frete = { ...calculado, freightManual: false };
      }
    }

    // Campo ausente (`undefined`) fica como está; `null` apaga. O filtro repete
    // a condição lida acima: se a carga entrou em manifesto ou mudou de status
    // nesse meio-tempo, nada é gravado.
    const { count } = await prisma.collection.updateMany({
      where: { id, status: { in: [...EDITABLE_STATUSES] }, manifestId: null },
      data: {
        sender: data.sender,
        receiver: data.receiver,
        origin: data.origin,
        destination: data.destination,
        volumes: data.volumes,
        weight: data.weight,
        invoiceKey: data.invoiceKey,
        invoiceValue: data.invoiceValue,
        driverId: data.driverId,
        ...(frete && {
          freightValue: frete.freightValue,
          freightDeadlineHours: frete.freightDeadlineHours,
          freightTableId: frete.freightTableId,
          freightDetails: frete.freightDetails ?? Prisma.DbNull,
          freightManual: frete.freightManual,
        }),
      },
    });
    if (count === 0) {
      return NextResponse.json({ error: CHANGED_MEANWHILE }, { status: 409 });
    }

    const coleta = await prisma.collection.findUnique({ where: { id }, include: COLLECTION_INCLUDE });
    return NextResponse.json(coleta);
  } catch (error) {
    console.error('Error updating collection:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
