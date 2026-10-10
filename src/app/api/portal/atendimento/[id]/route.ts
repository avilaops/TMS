import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requirePortalClient } from '@/lib/portal';
import {
  MENSAGEM_DO_PORTAL,
  ORDEM_DA_CONVERSA,
  PORTAL_MESSAGE_SELECT,
  PORTAL_OCCURRENCE_SELECT,
  aceitaMensagem,
} from '@/lib/ocorrencias';

/**
 * Um chamado do cliente logado, com a conversa.
 *
 * Chamado de outro cliente responde 404, igual a id que não existe. As notas
 * internas ficam de fora no próprio `where` das mensagens, e o `select` é
 * fechado: prioridade, responsável e o nome de quem respondeu pela
 * transportadora são dados internos.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { clientId, error } = await requirePortalClient();
  if (error) return error;

  try {
    const { id } = await params;
    const ocorrencia = await prisma.occurrence.findFirst({
      where: { id, clientId },
      select: {
        ...PORTAL_OCCURRENCE_SELECT,
        messages: { where: MENSAGEM_DO_PORTAL, select: PORTAL_MESSAGE_SELECT, orderBy: [...ORDEM_DA_CONVERSA] },
      },
    });
    if (!ocorrencia) return NextResponse.json({ error: 'Atendimento não encontrado.' }, { status: 404 });

    return NextResponse.json(
      { ...ocorrencia, podeResponder: aceitaMensagem(ocorrencia.status) },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    console.error('Erro ao buscar atendimento do portal:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
