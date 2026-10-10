import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requirePortalClient } from '@/lib/portal';
import { DESTINATARIO_SELECT, alterarDestinatarioSchema } from '@/lib/portal-cliente';
import { firstIssue } from '@/lib/usuarios';

const NOT_FOUND = 'Destinatário não encontrado.';

/**
 * Alterar e apagar um destinatário frequente. As duas gravações levam o
 * `clientId` da sessão no filtro: destinatário de outro cliente responde 404,
 * igual a id que não existe.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { clientId, error } = await requirePortalClient();
  if (error) return error;

  try {
    const { id } = await params;
    const parsed = alterarDestinatarioSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }

    const { count } = await prisma.clientReceiver.updateMany({ where: { id, clientId }, data: parsed.data });
    if (count === 0) return NextResponse.json({ error: NOT_FOUND }, { status: 404 });

    const destinatario = await prisma.clientReceiver.findFirst({ where: { id, clientId }, select: DESTINATARIO_SELECT });
    return NextResponse.json(destinatario);
  } catch (error) {
    console.error('Erro ao alterar destinatário:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { clientId, error } = await requirePortalClient();
  if (error) return error;

  try {
    const { id } = await params;
    const { count } = await prisma.clientReceiver.deleteMany({ where: { id, clientId } });
    if (count === 0) return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Erro ao apagar destinatário:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
