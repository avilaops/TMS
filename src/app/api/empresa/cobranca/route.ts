import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import prisma, { empresaAtual, sistema } from '@/lib/prisma';
import { parametrosDeCobrancaSchema } from '@/lib/empresa';
import { JUROS_PADRAO_PCT, MULTA_PADRAO_PCT } from '@/lib/cobranca';
import { nadaMudou, origemDaRequisicao, registrarAuditoriaDepois } from '@/lib/auditoria';

const PARAMETROS = { lateFinePct: true, lateInterestPct: true } as const;

// A resposta usa os nomes da tela; as colunas ficam em inglês, como o resto do banco.
const paraATela = (empresa: { lateFinePct: number; lateInterestPct: number } | null) => ({
  multaPct: empresa?.lateFinePct ?? MULTA_PADRAO_PCT,
  jurosPct: empresa?.lateInterestPct ?? JUROS_PADRAO_PCT,
});

/**
 * Parâmetros de cobrança da empresa da sessão: a multa (% do valor) e os juros
 * (% ao mês) que a baixa de um título vencido sugere. Só o administrador lê e
 * altera: é configuração do financeiro.
 */
export async function GET() {
  const { error } = await requireStaff(['ADMIN']);
  if (error) return error;

  try {
    // A empresa só lê o próprio cadastro (prisma/sql/010-rls.sql).
    const empresa = await prisma.tenant.findUnique({ where: { id: await empresaAtual() }, select: PARAMETROS });
    return NextResponse.json(paraATela(empresa));
  } catch (error) {
    console.error('Erro ao ler os parâmetros de cobrança:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const { user, error } = await requireStaff(['ADMIN']);
  if (error) return error;

  const dados = parametrosDeCobrancaSchema.safeParse(await req.json().catch(() => null));
  if (!dados.success) {
    return NextResponse.json({ error: dados.error.issues[0]?.message ?? 'Dados inválidos.' }, { status: 400 });
  }

  try {
    // O papel da aplicação só lê a tabela de empresas. A gravação vai pelo
    // dono do banco, presa ao id da empresa da sessão: nunca ao que veio no corpo.
    const tenantId = await empresaAtual();
    const anterior = await sistema.tenant.findUnique({ where: { id: tenantId }, select: PARAMETROS });
    const empresa = await sistema.tenant.update({
      where: { id: tenantId },
      data: { lateFinePct: dados.data.multaPct, lateInterestPct: dados.data.jurosPct },
      select: PARAMETROS,
    });

    const antes = paraATela(anterior);
    const depois = paraATela(empresa);
    if (!nadaMudou(antes, depois)) {
      await registrarAuditoriaDepois(prisma, {
        ator: user,
        origem: origemDaRequisicao(req),
        acao: 'empresa.cobranca',
        entidade: 'empresa',
        entidadeId: tenantId,
        resumo: `Cobrança: multa de ${depois.multaPct}% e juros de ${depois.jurosPct}% ao mês`,
        antes,
        depois,
      });
    }

    return NextResponse.json(depois);
  } catch (error) {
    console.error('Erro ao alterar os parâmetros de cobrança:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
