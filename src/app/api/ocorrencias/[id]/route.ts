import { NextResponse } from 'next/server';
import prisma, { transacao } from '@/lib/prisma';
import { requireStaff } from '@/lib/staff';
import { Refusal } from '@/lib/cadastros';
import { firstIssue } from '@/lib/usuarios';
import {
  MESSAGE_SELECT,
  OCCURRENCE_SELECT,
  ORDEM_DA_CONVERSA,
  datasDaMudanca,
  podeMudarStatus,
  proximosStatus,
  recusaDeStatus,
  updateOccurrenceSchema,
} from '@/lib/ocorrencias';
import { avisarOcorrencia } from '@/lib/ocorrencias-db';

const NOT_FOUND = 'Chamado não encontrado.';

// Quem pode ser responsável por um chamado: a equipe interna.
const DA_EQUIPE = { role: { in: ['ADMIN', 'OPERATION'] as ('ADMIN' | 'OPERATION')[] } };

const DETALHE = {
  ...OCCURRENCE_SELECT,
  messages: { select: MESSAGE_SELECT, orderBy: [...ORDEM_DA_CONVERSA] },
};

/**
 * O chamado com a conversa inteira (notas internas inclusive), os status para
 * onde ele pode ir e a equipe que pode assumi-lo. A lista da equipe vem daqui
 * porque `/api/usuarios` é só do administrador, e o operador também atribui.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireStaff();
  if (error) return error;

  try {
    const { id } = await params;
    const ocorrencia = await prisma.occurrence.findUnique({ where: { id }, select: DETALHE });
    if (!ocorrencia) return NextResponse.json({ error: NOT_FOUND }, { status: 404 });

    const equipe = await prisma.user.findMany({ where: DA_EQUIPE, orderBy: { name: 'asc' }, select: { id: true, name: true } });
    return NextResponse.json({ ...ocorrencia, proximosStatus: proximosStatus(ocorrencia.status), equipe });
  } catch (error) {
    console.error('Erro ao buscar ocorrência:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

/**
 * Troca status, prioridade e responsável. A troca de status segue o fluxo
 * (src/lib/ocorrencias.ts) e, quando acontece, avisa os sistemas de fora na
 * mesma transação.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireStaff();
  if (error) return error;

  try {
    const { id } = await params;
    const parsed = updateOccurrenceSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const { status, priority, assigneeId } = parsed.data;

    const ocorrencia = await transacao(async (tx) => {
      // Trava o chamado: duas trocas de status simultâneas decidem em fila.
      await tx.$queryRaw`SELECT id FROM "Occurrence" WHERE id = ${id} FOR UPDATE`;
      const atual = await tx.occurrence.findUnique({ where: { id }, select: { status: true } });
      if (!atual) throw new Refusal(NOT_FOUND, 404);

      if (status !== undefined && !podeMudarStatus(atual.status, status)) {
        throw new Refusal(recusaDeStatus(atual.status, status), 409);
      }

      if (assigneeId) {
        const responsavel = await tx.user.findFirst({ where: { id: assigneeId, ...DA_EQUIPE }, select: { id: true } });
        if (!responsavel) throw new Refusal('O responsável precisa ser um usuário da equipe.', 400);
      }

      await tx.occurrence.update({
        where: { id },
        data: {
          ...(status !== undefined ? { status, ...datasDaMudanca(status, new Date()) } : {}),
          ...(priority !== undefined ? { priority } : {}),
          ...(assigneeId !== undefined ? { assigneeId } : {}),
        },
        select: { id: true },
      });

      if (status !== undefined) await avisarOcorrencia(tx, 'ocorrencia.status', id);

      return tx.occurrence.findUniqueOrThrow({ where: { id }, select: OCCURRENCE_SELECT });
    });

    return NextResponse.json({ ...ocorrencia, proximosStatus: proximosStatus(ocorrencia.status) });
  } catch (err) {
    if (err instanceof Refusal) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('Erro ao alterar ocorrência:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
