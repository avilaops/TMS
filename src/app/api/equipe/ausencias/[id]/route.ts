import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import { transacao } from '@/lib/prisma';
import { Refusal } from '@/lib/cadastros';
import { firstIssue } from '@/lib/usuarios';
import { ABSENCE_NOT_FOUND, ABSENCE_SELECT, CAMPOS_DA_AUSENCIA, nomeDaPessoa, updateAbsenceSchema } from '@/lib/equipe';
import { escolher, nadaMudou, origemDaRequisicao, registrarAuditoria } from '@/lib/auditoria';

/** Corrige tipo, período ou observação de uma ausência. De quem ela é não muda: para isso, apague e registre de novo. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireStaff({ pode: 'equipe' });
  if (error) return error;

  try {
    const { id } = await params;
    const parsed = updateAbsenceSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const data = parsed.data;
    const origem = origemDaRequisicao(req);

    const ausencia = await transacao(async (tx) => {
      const atual = await tx.absence.findUnique({ where: { id }, select: ABSENCE_SELECT });
      if (!atual) throw new Refusal(ABSENCE_NOT_FOUND, 404);

      const atualizada = await tx.absence.update({
        where: { id },
        data: { type: data.type, startDate: data.startDate, endDate: data.endDate, ...(data.notes !== undefined && { notes: data.notes }) },
        select: ABSENCE_SELECT,
      });

      const antes = escolher(atual, CAMPOS_DA_AUSENCIA);
      const depois = escolher(atualizada, CAMPOS_DA_AUSENCIA);
      if (!nadaMudou(antes, depois)) {
        await registrarAuditoria(tx, {
          ator: user,
          origem,
          acao: 'ausencia.alterar',
          entidade: 'ausencia',
          entidadeId: id,
          resumo: `Ausência de ${nomeDaPessoa(atualizada)} alterada`,
          antes,
          depois,
        });
      }

      return atualizada;
    });

    return NextResponse.json(ausencia);
  } catch (err) {
    if (err instanceof Refusal) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('Erro ao alterar ausência:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

/** Apaga uma ausência lançada por engano. A auditoria guarda o que ela era. */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireStaff({ pode: 'equipe' });
  if (error) return error;

  try {
    const { id } = await params;
    const origem = origemDaRequisicao(req);

    await transacao(async (tx) => {
      const atual = await tx.absence.findUnique({ where: { id }, select: ABSENCE_SELECT });
      if (!atual) throw new Refusal(ABSENCE_NOT_FOUND, 404);

      await tx.absence.delete({ where: { id }, select: { id: true } });

      await registrarAuditoria(tx, {
        ator: user,
        origem,
        acao: 'ausencia.excluir',
        entidade: 'ausencia',
        entidadeId: id,
        resumo: `Ausência de ${nomeDaPessoa(atual)} excluída`,
        antes: escolher(atual, CAMPOS_DA_AUSENCIA),
      });
    });

    return NextResponse.json({ id, excluido: true });
  } catch (err) {
    if (err instanceof Refusal) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('Erro ao excluir ausência:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
