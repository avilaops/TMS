import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requirePortalClient } from '@/lib/portal';
import { DESTINATARIO_SELECT, LIMITE_DE_DESTINATARIOS, MAX_DESTINATARIOS, criarDestinatarioSchema } from '@/lib/portal-cliente';
import { firstIssue } from '@/lib/usuarios';

/**
 * Destinatários frequentes do cliente logado: ele cadastra uma vez e escolhe
 * ao pedir coleta. O filtro por `clientId` separa um cliente do outro dentro
 * da mesma transportadora; o `clientId` gravado é sempre o da sessão, nunca o
 * que vier no corpo.
 */
export async function GET() {
  const { clientId, error } = await requirePortalClient();
  if (error) return error;

  try {
    const destinatarios = await prisma.clientReceiver.findMany({
      where: { clientId },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: DESTINATARIO_SELECT,
    });
    return NextResponse.json(destinatarios);
  } catch (error) {
    console.error('Erro ao listar destinatários:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const { clientId, error } = await requirePortalClient();
  if (error) return error;

  try {
    const parsed = criarDestinatarioSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }

    const quantos = await prisma.clientReceiver.count({ where: { clientId } });
    if (quantos >= MAX_DESTINATARIOS) {
      return NextResponse.json({ error: LIMITE_DE_DESTINATARIOS }, { status: 409 });
    }

    const destinatario = await prisma.clientReceiver.create({
      data: { ...parsed.data, clientId },
      select: DESTINATARIO_SELECT,
    });
    return NextResponse.json(destinatario, { status: 201 });
  } catch (error) {
    console.error('Erro ao cadastrar destinatário:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
