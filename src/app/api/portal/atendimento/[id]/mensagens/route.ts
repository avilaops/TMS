import { NextResponse } from 'next/server';
import { transacao } from '@/lib/prisma';
import { requirePortalClient } from '@/lib/portal';
import { Refusal } from '@/lib/cadastros';
import { firstIssue } from '@/lib/usuarios';
import { PORTAL_MESSAGE_SELECT, aceitaMensagem, portalMessageSchema } from '@/lib/ocorrencias';
import { avisar, avisarEquipe, avisoDeRespostaDoCliente } from '@/lib/notificacoes';

const NOT_FOUND = 'Atendimento não encontrado.';

/**
 * Resposta do cliente num chamado dele, enquanto não estiver encerrado.
 * Chamado de outro cliente responde 404 e nada é gravado. A mensagem do
 * cliente nunca é nota interna: o corpo só aceita o texto.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { clientId, userId, error } = await requirePortalClient();
  if (error) return error;

  try {
    const { id } = await params;
    const parsed = portalMessageSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }

    const mensagem = await transacao(async (tx) => {
      // Trava o chamado: a resposta não entra num chamado que está sendo encerrado.
      await tx.$queryRaw`SELECT id FROM "Occurrence" WHERE id = ${id} AND "clientId" = ${clientId} FOR UPDATE`;
      const ocorrencia = await tx.occurrence.findFirst({ where: { id, clientId }, select: { id: true, number: true, title: true, status: true, assigneeId: true } });
      if (!ocorrencia) throw new Refusal(NOT_FOUND, 404);
      if (!aceitaMensagem(ocorrencia.status)) {
        throw new Refusal('Este atendimento foi encerrado. Abra um novo se precisar.', 409);
      }

      const criada = await tx.occurrenceMessage.create({
        data: { occurrenceId: id, authorId: userId, body: parsed.data.body, internal: false, fromClient: true },
        select: PORTAL_MESSAGE_SELECT,
      });

      // Sininho: quem cuida do chamado; sem responsável, quem atende chamados.
      const conteudo = avisoDeRespostaDoCliente(ocorrencia);
      if (ocorrencia.assigneeId) await avisar(tx, { ...conteudo, para: ocorrencia.assigneeId, autor: userId });
      else await avisarEquipe(tx, 'ocorrencias', conteudo, userId);
      return criada;
    });

    return NextResponse.json(mensagem, { status: 201 });
  } catch (err) {
    if (err instanceof Refusal) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('Erro ao gravar resposta do cliente:', err);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
