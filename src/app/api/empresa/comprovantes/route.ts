import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import prisma, { empresaAtual, sistema } from '@/lib/prisma';
import { ROTULO_DO_PERFIL_DE_COMPROVANTE, lerPerfil, perfilDeComprovanteSchema } from '@/lib/comprovantes';
import { perfilDaEmpresa } from '@/lib/comprovantes-db';
import { origemDaRequisicao, registrarAuditoriaDepois } from '@/lib/auditoria';

/**
 * Perfil do comprovante de entrega da empresa da sessão: o que a baixa do
 * motorista exige. LIVRE (foto e assinatura opcionais), ECOMMERCE (foto da
 * carga no local) ou B2B (foto do canhoto assinado). Só o administrador lê e
 * altera por aqui; o aplicativo do motorista lê por /api/driver/comprovantes.
 */
export async function GET() {
  const { error } = await requireStaff({ pode: 'empresa' });
  if (error) return error;

  try {
    return NextResponse.json({ perfil: await perfilDaEmpresa() });
  } catch (error) {
    console.error('Erro ao ler o perfil do comprovante:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const { user, error } = await requireStaff({ pode: 'empresa' });
  if (error) return error;

  const dados = perfilDeComprovanteSchema.safeParse(await req.json().catch(() => null));
  if (!dados.success) {
    return NextResponse.json({ error: dados.error.issues[0]?.message ?? 'Dados inválidos.' }, { status: 400 });
  }

  try {
    // O papel da aplicação só lê a tabela de empresas. A gravação vai pelo
    // dono do banco, presa ao id da empresa da sessão: nunca ao que veio no corpo.
    const tenantId = await empresaAtual();
    const anterior = await sistema.tenant.findUnique({ where: { id: tenantId }, select: { podProfile: true } });
    const empresa = await sistema.tenant.update({ where: { id: tenantId }, data: { podProfile: dados.data.perfil }, select: { podProfile: true } });

    const antes = lerPerfil(anterior?.podProfile);
    const perfil = lerPerfil(empresa.podProfile);
    if (antes !== perfil) {
      await registrarAuditoriaDepois(prisma, {
        ator: user,
        origem: origemDaRequisicao(req),
        acao: 'empresa.comprovante',
        entidade: 'empresa',
        entidadeId: tenantId,
        resumo: `Comprovante de entrega: perfil ${ROTULO_DO_PERFIL_DE_COMPROVANTE[perfil]}`,
        antes: { perfil: antes },
        depois: { perfil },
      });
    }

    return NextResponse.json({ perfil });
  } catch (error) {
    console.error('Erro ao alterar o perfil do comprovante:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
