import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { requireStaff } from '@/lib/staff';
import prisma, { SemEmpresaError, empresaAtual, sistema } from '@/lib/prisma';
import { identidadeSchema } from '@/lib/empresa';
import { nadaMudou, origemDaRequisicao, registrarAuditoriaDepois } from '@/lib/auditoria';

// O símbolo é uma imagem: na auditoria entra só se há um, nunca a imagem.
const SIMBOLO_PADRAO = 'padrão';
const SIMBOLO_PROPRIO = 'próprio';

const IDENTIDADE = { name: true, logo: true } as const;

/**
 * Nome e símbolo da empresa da sessão, para os cabeçalhos do painel, do portal
 * do cliente e do app do motorista: qualquer perfil lê, desde que a sessão seja
 * de um usuário que ainda existe na empresa.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  const usuario = session?.user?.id
    ? await prisma.user.findUnique({ where: { id: session.user.id }, select: { id: true } }).catch((erro: unknown) => {
        // Sessão sem empresa (anterior ao multi-tenant) não chega ao banco.
        if (erro instanceof SemEmpresaError) return null;
        throw erro;
      })
    : null;
  if (!usuario) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  try {
    // A empresa só lê o próprio cadastro (prisma/sql/010-rls.sql).
    const empresa = await prisma.tenant.findUnique({ where: { id: await empresaAtual() }, select: IDENTIDADE });
    if (!empresa) return NextResponse.json({ error: 'Empresa não encontrada.' }, { status: 404 });
    return NextResponse.json(empresa);
  } catch (error) {
    console.error('Erro ao ler a identidade da empresa:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

/** Troca o nome e o símbolo da empresa da sessão. Só o administrador. */
export async function PATCH(req: Request) {
  const { user, error } = await requireStaff(["ADMIN"]);
  if (error) return error;

  const dados = identidadeSchema.safeParse(await req.json().catch(() => null));
  if (!dados.success) {
    return NextResponse.json({ error: dados.error.issues[0]?.message ?? 'Dados inválidos.' }, { status: 400 });
  }

  try {
    // O papel da aplicação só lê a tabela de empresas. A gravação vai pelo
    // dono do banco, presa ao id da empresa da sessão: nunca ao que veio no corpo.
    const tenantId = await empresaAtual();
    const anterior = await sistema.tenant.findUnique({ where: { id: tenantId }, select: IDENTIDADE });
    const empresa = await sistema.tenant.update({
      where: { id: tenantId },
      data: dados.data,
      select: IDENTIDADE,
    });

    const antes = { name: anterior?.name ?? null, simbolo: anterior?.logo ? SIMBOLO_PROPRIO : SIMBOLO_PADRAO };
    const trocouDeImagem = Boolean(anterior?.logo && empresa.logo && anterior.logo !== empresa.logo);
    const depois = { name: empresa.name, simbolo: empresa.logo ? (trocouDeImagem ? `${SIMBOLO_PROPRIO} (imagem nova)` : SIMBOLO_PROPRIO) : SIMBOLO_PADRAO };
    if (!nadaMudou(antes, depois)) {
      await registrarAuditoriaDepois(prisma, {
        ator: user,
        origem: origemDaRequisicao(req),
        acao: 'empresa.alterar',
        entidade: 'empresa',
        entidadeId: tenantId,
        resumo: antes.name !== depois.name ? `Nome da empresa trocado para ${empresa.name}` : 'Símbolo da empresa trocado',
        antes,
        depois,
      });
    }

    return NextResponse.json(empresa);
  } catch (error) {
    console.error('Erro ao alterar a identidade da empresa:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
