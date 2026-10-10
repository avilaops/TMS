import { NextResponse } from 'next/server';
import { transacao } from '@/lib/prisma';
import { requireStaff } from '@/lib/staff';
import { Refusal } from '@/lib/cadastros';
import { firstIssue } from '@/lib/usuarios';
import { MESSAGE_SELECT, aceitaMensagem, staffMessageSchema } from '@/lib/ocorrencias';
import { avisar, avisoDeRespostaAoCliente, usuariosDosClientes } from '@/lib/notificacoes';

/**
 * Mensagem da equipe no chamado: resposta (o cliente lê no portal) ou nota
 * interna (`internal: true`, só a equipe lê).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireStaff({ pode: 'ocorrencias' });
  if (error) return error;

  try {
    const { id } = await params;
    const parsed = staffMessageSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const { body, internal } = parsed.data;

    const mensagem = await transacao(async (tx) => {
      // Trava o chamado: a mensagem não entra num chamado que está sendo encerrado.
      await tx.$queryRaw`SELECT id FROM "Occurrence" WHERE id = ${id} FOR UPDATE`;
      const ocorrencia = await tx.occurrence.findUnique({ where: { id }, select: { id: true, number: true, title: true, status: true, clientId: true } });
      if (!ocorrencia) throw new Refusal('Chamado não encontrado.', 404);
      if (!aceitaMensagem(ocorrencia.status)) throw new Refusal('Chamado encerrado não recebe mais mensagem.', 409);

      const criada = await tx.occurrenceMessage.create({
        data: { occurrenceId: id, authorId: user.id, body, internal, fromClient: false },
        select: MESSAGE_SELECT,
      });

      // Sininho do cliente: só a resposta que ele lê no portal. Nota interna
      // e chamado só da equipe (sem cliente) não avisam ninguém de fora.
      if (!internal && ocorrencia.clientId) {
        const doCliente = await usuariosDosClientes(tx, [ocorrencia.clientId]);
        await avisar(tx, { ...avisoDeRespostaAoCliente(ocorrencia), para: doCliente.get(ocorrencia.clientId) ?? [], autor: user.id });
      }
      return criada;
    });

    return NextResponse.json(mensagem, { status: 201 });
  } catch (err) {
    if (err instanceof Refusal) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('Erro ao gravar mensagem da ocorrência:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
