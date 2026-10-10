import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import prisma, { transacao } from '@/lib/prisma';
import { Refusal } from '@/lib/cadastros';
import { AVISO_NAO_ENCONTRADO, EVENTO_SELECT, NAO_REENVIAVEL, REENVIAVEL, SEM_ENDERECO, rotuloDoTipo } from '@/lib/mensageria';
import { origemDaRequisicao, registrarAuditoria } from '@/lib/auditoria';

/**
 * "Tentar de novo": devolve à fila um aviso que falhou (ou de que o
 * despachante já desistiu). Zera as tentativas e marca a próxima para agora; o
 * despachante o pega na volta seguinte (src/lib/eventos.ts). Só o administrador.
 *
 * Aviso entregue não é reenviado (o destino o receberia duas vezes), nem o que
 * ainda está na fila. Sem endereço cadastrado não há para onde mandar: 409.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireStaff(['ADMIN']);
  if (error) return error;

  try {
    const { id } = await params;
    const origem = origemDaRequisicao(req);

    if (!(await prisma.webhook.findFirst({ select: { id: true } }))) {
      return NextResponse.json({ error: SEM_ENDERECO }, { status: 409 });
    }

    const evento = await transacao(async (tx) => {
      // A condição vai no próprio UPDATE: se o despachante entregou o aviso
      // neste meio-tempo, nada é gravado e a resposta é 409.
      const { count } = await tx.outboxEvent.updateMany({
        where: { id, ...REENVIAVEL },
        data: { attempts: 0, nextAttemptAt: new Date(), lastError: null },
      });
      if (count === 0) {
        const existe = await tx.outboxEvent.findUnique({ where: { id }, select: { id: true } });
        throw existe ? new Refusal(NAO_REENVIAVEL, 409) : new Refusal(AVISO_NAO_ENCONTRADO, 404);
      }

      const reenviado = await tx.outboxEvent.findUniqueOrThrow({ where: { id }, select: EVENTO_SELECT });
      await registrarAuditoria(tx, {
        ator: user,
        origem,
        acao: 'aviso.reenviar',
        entidade: 'aviso',
        entidadeId: id,
        resumo: `Aviso "${rotuloDoTipo(reenviado.type)}" devolvido à fila`,
      });
      return reenviado;
    });

    return NextResponse.json(evento);
  } catch (err) {
    if (err instanceof Refusal) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('Erro ao reenviar o aviso:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
