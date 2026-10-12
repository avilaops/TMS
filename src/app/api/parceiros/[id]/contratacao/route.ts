import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import { transacao } from '@/lib/prisma';
import { Refusal } from '@/lib/cadastros';
import { firstIssue } from '@/lib/usuarios';
import { CAMPOS_DA_CONTRATACAO, CARRIER_NOT_FOUND, CARRIER_SELECT, CARRIER_VALUES_SELECT, contratacaoSchema } from '@/lib/parceiros';
import { rotuloDaForma } from '@/lib/frete-contratado';
import { escolher, nadaMudou, origemDaRequisicao, registrarAuditoria } from '@/lib/auditoria';

/**
 * Grava a forma padrão de contratação do parceiro (fixo por viagem, percentual
 * do frete das cargas, por km ou por entrega) e o valor padrão. As duas em
 * branco tiram o padrão. É dinheiro: só quem altera o frete contratado.
 *
 * O padrão vale para os contratos que nascerem depois; contrato que já existe
 * guarda a forma e a base dele.
 */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireStaff({ pode: 'freteContratado' });
  if (error) return error;

  try {
    const { id } = await params;
    const parsed = contratacaoSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const data = { defaultCalcMode: parsed.data.defaultCalcMode ?? null, defaultCalcBase: parsed.data.defaultCalcBase ?? null };
    const origem = origemDaRequisicao(req);
    const select = { ...CARRIER_SELECT, ...CARRIER_VALUES_SELECT };

    const parceiro = await transacao(async (tx) => {
      const atual = await tx.carrier.findUnique({ where: { id }, select });
      if (!atual) throw new Refusal(CARRIER_NOT_FOUND, 404);

      const atualizado = await tx.carrier.update({ where: { id }, data, select });

      const antes = escolher(atual, CAMPOS_DA_CONTRATACAO);
      const depois = escolher(atualizado, CAMPOS_DA_CONTRATACAO);
      if (!nadaMudou(antes, depois)) {
        await registrarAuditoria(tx, {
          ator: user,
          origem,
          acao: 'parceiro.contratacao',
          entidade: 'parceiro',
          entidadeId: id,
          resumo: atualizado.defaultCalcMode
            ? `Contratação padrão de ${atualizado.name}: ${rotuloDaForma(atualizado.defaultCalcMode).toLowerCase()}`
            : `Contratação padrão de ${atualizado.name} retirada`,
          antes,
          depois,
        });
      }
      return atualizado;
    });

    return NextResponse.json(parceiro);
  } catch (err) {
    if (err instanceof Refusal) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('Erro ao gravar a contratação padrão do parceiro:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
