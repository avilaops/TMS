import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import { transacao } from '@/lib/prisma';
import { Refusal } from '@/lib/cadastros';
import { firstIssue } from '@/lib/usuarios';
import { CAMPOS_DO_PARCEIRO, CARRIER_NOT_FOUND, CARRIER_SELECT, updateCarrierSchema } from '@/lib/parceiros';
import { escolher, nadaMudou, origemDaRequisicao, registrarAuditoria } from '@/lib/auditoria';

/**
 * Altera o cadastro do parceiro, desativa ou reativa. O CPF ou CNPJ é a chave
 * do cadastro e não muda; a forma padrão de contratação tem rota própria
 * (`PUT /api/parceiros/[id]/contratacao`), de quem altera o frete contratado.
 *
 * Desativar não desliga os veículos nem os motoristas do parceiro: o MDF-e
 * continua lendo o proprietário dele. Só deixa de nascer contrato novo.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireStaff({ pode: 'parceiros' });
  if (error) return error;

  try {
    const { id } = await params;
    const parsed = updateCarrierSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const data = parsed.data;
    const origem = origemDaRequisicao(req);

    const parceiro = await transacao(async (tx) => {
      // O cadastro inteiro, como estava: é o "antes" da auditoria.
      const atual = await tx.carrier.findUnique({ where: { id }, select: CARRIER_SELECT });
      if (!atual) throw new Refusal(CARRIER_NOT_FOUND, 404);

      // Campo ausente (`undefined`) fica como está; `null` apaga.
      const atualizado = await tx.carrier.update({ where: { id }, data, select: CARRIER_SELECT });

      const antes = escolher(atual, CAMPOS_DO_PARCEIRO);
      const depois = escolher(atualizado, CAMPOS_DO_PARCEIRO);
      if (!nadaMudou(antes, depois)) {
        const desativou = atual.active && !atualizado.active;
        const reativou = !atual.active && atualizado.active;
        await registrarAuditoria(tx, {
          ator: user,
          origem,
          acao: desativou ? 'parceiro.desativar' : reativou ? 'parceiro.reativar' : 'parceiro.alterar',
          entidade: 'parceiro',
          entidadeId: id,
          resumo: `Parceiro ${atualizado.name} ${desativou ? 'desativado' : reativou ? 'reativado' : 'alterado'}`,
          antes,
          depois,
        });
      }
      return atualizado;
    });

    return NextResponse.json(parceiro);
  } catch (err) {
    if (err instanceof Refusal) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('Erro ao alterar parceiro:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
