import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import prisma, { empresaAtual, sistema } from '@/lib/prisma';
import { parametrosDeCobrancaSchema, type PixDaEmpresa } from '@/lib/empresa';
import { TIPOS_DE_CHAVE, TIPO_DE_CHAVE_LABEL, type TipoDeChave } from '@/lib/pix';
import { JUROS_PADRAO_PCT, MULTA_PADRAO_PCT } from '@/lib/cobranca';
import { nadaMudou, origemDaRequisicao, registrarAuditoriaDepois } from '@/lib/auditoria';

const PARAMETROS = { lateFinePct: true, lateInterestPct: true, pixKeyType: true, pixKey: true, pixName: true, pixCity: true } as const;

type Colunas = {
  lateFinePct: number;
  lateInterestPct: number;
  pixKeyType: string | null;
  pixKey: string | null;
  pixName: string | null;
  pixCity: string | null;
};

const pixDaEmpresa = (empresa: Colunas | null): PixDaEmpresa | null => {
  if (!empresa?.pixKey || !empresa.pixName || !empresa.pixCity) return null;
  if (!(TIPOS_DE_CHAVE as readonly string[]).includes(empresa.pixKeyType ?? '')) return null;
  return { tipo: empresa.pixKeyType as TipoDeChave, chave: empresa.pixKey, nome: empresa.pixName, cidade: empresa.pixCity };
};

// A resposta usa os nomes da tela; as colunas ficam em inglês, como o resto do
// banco. `pix` só vai quando há chave cadastrada: sem ela, a chave nem aparece.
const paraATela = (empresa: Colunas | null) => {
  const pix = pixDaEmpresa(empresa);
  return {
    multaPct: empresa?.lateFinePct ?? MULTA_PADRAO_PCT,
    jurosPct: empresa?.lateInterestPct ?? JUROS_PADRAO_PCT,
    ...(pix && { pix }),
  };
};

// Na trilha de auditoria o Pix vai numa linha só, por extenso: é o dado que muda para onde o dinheiro vai.
const paraAAuditoria = ({ pix, ...parametros }: ReturnType<typeof paraATela>) => ({
  ...parametros,
  pix: pix ? `${pix.tipo} ${pix.chave} | ${pix.nome} | ${pix.cidade}` : null,
});

/**
 * Parâmetros de cobrança da empresa da sessão: a multa (% do valor) e os juros
 * (% ao mês) que a baixa de um título vencido sugere, e o recebimento por Pix
 * (a chave e o recebedor que vão no "Pix Copia e Cola" das faturas). Só o
 * administrador lê e altera: é configuração do financeiro.
 */
export async function GET() {
  const { error } = await requireStaff({ pode: 'empresa' });
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
  const { user, error } = await requireStaff({ pode: 'empresa' });
  if (error) return error;

  const dados = parametrosDeCobrancaSchema.safeParse(await req.json().catch(() => null));
  if (!dados.success) {
    return NextResponse.json({ error: dados.error.issues[0]?.message ?? 'Dados inválidos.' }, { status: 400 });
  }

  try {
    // O papel da aplicação só lê a tabela de empresas. A gravação vai pelo
    // dono do banco, presa ao id da empresa da sessão: nunca ao que veio no corpo.
    const tenantId = await empresaAtual();
    const { pix } = dados.data;
    const anterior = await sistema.tenant.findUnique({ where: { id: tenantId }, select: PARAMETROS });
    const empresa = await sistema.tenant.update({
      where: { id: tenantId },
      data: {
        lateFinePct: dados.data.multaPct,
        lateInterestPct: dados.data.jurosPct,
        // `pix` ausente não mexe; `null` remove a chave e o recebedor.
        ...(pix !== undefined && {
          pixKeyType: pix?.tipo ?? null,
          pixKey: pix?.chave ?? null,
          pixName: pix?.nome ?? null,
          pixCity: pix?.cidade ?? null,
        }),
      },
      select: PARAMETROS,
    });

    const depois = paraATela(empresa);
    const antes = paraAAuditoria(paraATela(anterior));
    const agora = paraAAuditoria(depois);
    if (!nadaMudou(antes, agora)) {
      await registrarAuditoriaDepois(prisma, {
        ator: user,
        origem: origemDaRequisicao(req),
        acao: 'empresa.cobranca',
        entidade: 'empresa',
        entidadeId: tenantId,
        resumo: `Cobrança: multa de ${depois.multaPct}% e juros de ${depois.jurosPct}% ao mês${depois.pix ? `, Pix por ${TIPO_DE_CHAVE_LABEL[depois.pix.tipo]}` : ''}`,
        antes,
        depois: agora,
      });
    }

    return NextResponse.json(depois);
  } catch (error) {
    console.error('Erro ao alterar os parâmetros de cobrança:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
