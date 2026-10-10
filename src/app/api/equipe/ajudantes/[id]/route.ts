import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import { transacao } from '@/lib/prisma';
import { Refusal } from '@/lib/cadastros';
import { firstIssue } from '@/lib/usuarios';
import { CAMPOS_DO_AJUDANTE, HELPER_NOT_FOUND, HELPER_SELECT, updateHelperSchema } from '@/lib/equipe';
import { escolher, nadaMudou, origemDaRequisicao, registrarAuditoria } from '@/lib/auditoria';

/** Altera nome e telefone, ou desativa e reativa. O CPF é a chave do cadastro e não muda. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireStaff({ pode: 'equipe' });
  if (error) return error;

  try {
    const { id } = await params;
    const parsed = updateHelperSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const origem = origemDaRequisicao(req);

    const ajudante = await transacao(async (tx) => {
      // Ajudante de outra empresa não existe para esta consulta: 404, como um id inventado.
      const atual = await tx.helper.findUnique({ where: { id }, select: HELPER_SELECT });
      if (!atual) throw new Refusal(HELPER_NOT_FOUND, 404);

      const atualizado = await tx.helper.update({ where: { id }, data: parsed.data, select: HELPER_SELECT });

      const antes = escolher(atual, CAMPOS_DO_AJUDANTE);
      const depois = escolher(atualizado, CAMPOS_DO_AJUDANTE);
      if (!nadaMudou(antes, depois)) {
        const desativou = antes.active && !depois.active;
        const reativou = !antes.active && depois.active;
        await registrarAuditoria(tx, {
          ator: user,
          origem,
          acao: desativou ? 'ajudante.desativar' : reativou ? 'ajudante.reativar' : 'ajudante.alterar',
          entidade: 'ajudante',
          entidadeId: id,
          resumo: `Ajudante ${atualizado.name} ${desativou ? 'desativado' : reativou ? 'reativado' : 'alterado'}`,
          antes,
          depois,
        });
      }

      return atualizado;
    });

    return NextResponse.json(ajudante);
  } catch (err) {
    if (err instanceof Refusal) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('Erro ao alterar ajudante:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
