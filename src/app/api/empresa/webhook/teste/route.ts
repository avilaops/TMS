import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import prisma from '@/lib/prisma';

/** Põe um evento de teste na fila do endereço cadastrado. Só o administrador. */
export async function POST() {
  const { user, error } = await requireStaff(["ADMIN"]);
  if (error) return error;

  try {
    if (!(await prisma.webhook.findFirst({ select: { id: true } }))) {
      return NextResponse.json({ error: 'Cadastre o endereço antes de enviar o teste.' }, { status: 409 });
    }
    const evento = await prisma.outboxEvent.create({
      data: { type: 'teste', payload: { mensagem: 'Evento de teste do TMS.', pedidoPor: user.name } },
      select: { id: true },
    });
    return NextResponse.json({ id: evento.id }, { status: 202 });
  } catch (error) {
    console.error('Erro ao enfileirar o evento de teste:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
