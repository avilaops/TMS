import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import { transacao } from '@/lib/prisma';
import { Refusal } from '@/lib/cadastros';
import { firstIssue } from '@/lib/usuarios';
import { HELPER_NOT_FOUND } from '@/lib/equipe';
import { CAMPOS_DAS_FORMAS_DO_AJUDANTE, remuneracaoDoAjudanteSchema } from '@/lib/remuneracao';
import { escolher, nadaMudou, origemDaRequisicao, registrarAuditoria } from '@/lib/auditoria';

const SELECT = { id: true, name: true, dailyRate: true, perTripRate: true } as const;

/**
 * A remuneração variável do ajudante: diária (por dia de viagem) e fixo por
 * viagem. Em branco ou `null` tira a forma. É dinheiro, numa rota à parte do
 * cadastro do ajudante (que é da operação): só quem altera os valores da equipe
 * (`equipeValores`), e os valores não vão em `GET /api/equipe/ajudantes`.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireStaff({ pode: 'equipeValores' });
  if (error) return error;

  try {
    const { id } = await params;
    const parsed = remuneracaoDoAjudanteSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    const origem = origemDaRequisicao(req);

    const ajudante = await transacao(async (tx) => {
      // Ajudante de outra empresa não existe para esta consulta: 404, como um id inventado.
      const atual = await tx.helper.findUnique({ where: { id }, select: SELECT });
      if (!atual) throw new Refusal(HELPER_NOT_FOUND, 404);

      const atualizado = await tx.helper.update({ where: { id }, data: parsed.data, select: SELECT });
      const antes = escolher(atual, CAMPOS_DAS_FORMAS_DO_AJUDANTE);
      const depois = escolher(atualizado, CAMPOS_DAS_FORMAS_DO_AJUDANTE);
      if (!nadaMudou(antes, depois)) {
        await registrarAuditoria(tx, {
          ator: user,
          origem,
          acao: 'ajudante.remuneracao',
          entidade: 'ajudante',
          entidadeId: id,
          resumo: `Remuneração variável do ajudante ${atualizado.name} alterada`,
          antes,
          depois,
        });
      }
      return atualizado;
    });

    return NextResponse.json(ajudante);
  } catch (err) {
    if (err instanceof Refusal) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('Erro ao alterar a remuneração do ajudante:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
