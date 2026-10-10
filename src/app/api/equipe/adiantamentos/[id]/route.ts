import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import { transacao } from '@/lib/prisma';
import { Refusal } from '@/lib/cadastros';
import { firstIssue } from '@/lib/usuarios';
import { ADVANCE_NOT_FOUND, ADVANCE_SELECT, CAMPOS_DO_ADIANTAMENTO, advanceActionSchema, comAcerto, nomeDaPessoa } from '@/lib/equipe';
import { escolher, origemDaRequisicao, registrarAuditoria } from '@/lib/auditoria';

/**
 * Acerta um adiantamento (`action: "acertar"`, com o valor gasto comprovado) ou
 * desfaz um acerto digitado errado (`action: "reabrir"`). A diferença (a
 * devolver ou a receber) não é gravada: sai do adiantado menos o gasto.
 *
 * O acerto não mexe na despesa lançada no Financeiro quando o adiantamento foi
 * registrado: a sobra devolvida ou o complemento pago são lançados lá, à mão.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireStaff(['ADMIN']);
  if (error) return error;

  try {
    const { id } = await params;
    const parsed = advanceActionSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const data = parsed.data;
    const origem = origemDaRequisicao(req);

    const adiantamento = await transacao(async (tx) => {
      // Dois acertos ao mesmo tempo: o segundo espera e encontra o adiantamento já acertado.
      await tx.$queryRaw`SELECT id FROM "CrewAdvance" WHERE id = ${id} FOR UPDATE`;
      const atual = await tx.crewAdvance.findUnique({ where: { id }, select: ADVANCE_SELECT });
      if (!atual) throw new Refusal(ADVANCE_NOT_FOUND, 404);

      let mudanca;
      if (data.action === 'acertar') {
        if (atual.status !== 'OPEN') throw new Refusal('Este adiantamento já foi acertado.', 409);
        mudanca = {
          status: 'SETTLED',
          spentAmount: data.spentAmount,
          settledAt: new Date(),
          ...(data.notes !== undefined && { notes: data.notes }),
        };
      } else {
        if (atual.status !== 'SETTLED') throw new Refusal('Só adiantamento acertado pode ser reaberto.', 409);
        mudanca = { status: 'OPEN', spentAmount: null, settledAt: null };
      }

      const atualizado = await tx.crewAdvance.update({ where: { id }, data: mudanca, select: ADVANCE_SELECT });

      await registrarAuditoria(tx, {
        ator: user,
        origem,
        acao: data.action === 'acertar' ? 'adiantamento.acertar' : 'adiantamento.reabrir',
        entidade: 'adiantamento',
        entidadeId: id,
        resumo:
          data.action === 'acertar'
            ? `Adiantamento de ${nomeDaPessoa(atualizado)} acertado`
            : `Acerto do adiantamento de ${nomeDaPessoa(atualizado)} desfeito`,
        antes: escolher(atual, CAMPOS_DO_ADIANTAMENTO),
        depois: escolher(atualizado, CAMPOS_DO_ADIANTAMENTO),
      });

      return atualizado;
    });

    return NextResponse.json(comAcerto(adiantamento));
  } catch (err) {
    if (err instanceof Refusal) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('Erro ao acertar adiantamento:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
