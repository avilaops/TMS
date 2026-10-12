import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import prisma, { empresaAtual, sistema } from '@/lib/prisma';
import { visibilidadeSchema } from '@/lib/remuneracao';
import { origemDaRequisicao, registrarAuditoriaDepois } from '@/lib/auditoria';

/**
 * O interruptor da empresa da sessão: o aplicativo do motorista mostra a ele a
 * remuneração variável das viagens dele (`GET /api/driver/remuneracao`)?
 * Desligado por padrão: o dono pode não querer mostrar. Só o administrador lê
 * e altera por aqui.
 */
export async function GET() {
  const { error } = await requireStaff({ pode: 'empresa' });
  if (error) return error;

  try {
    const empresa = await prisma.tenant.findUnique({ where: { id: await empresaAtual() }, select: { driverPayVisible: true } });
    return NextResponse.json({ visivelAoMotorista: empresa?.driverPayVisible ?? false });
  } catch (error) {
    console.error('Erro ao ler a visibilidade da remuneração:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const { user, error } = await requireStaff({ pode: 'empresa' });
  if (error) return error;

  const dados = visibilidadeSchema.safeParse(await req.json().catch(() => null));
  if (!dados.success) {
    return NextResponse.json({ error: dados.error.issues[0]?.message ?? 'Dados inválidos.' }, { status: 400 });
  }

  try {
    // O papel da aplicação só lê a tabela de empresas. A gravação vai pelo
    // dono do banco, presa ao id da empresa da sessão: nunca ao que veio no corpo.
    const tenantId = await empresaAtual();
    const anterior = await sistema.tenant.findUnique({ where: { id: tenantId }, select: { driverPayVisible: true } });
    const empresa = await sistema.tenant.update({ where: { id: tenantId }, data: { driverPayVisible: dados.data.visivelAoMotorista }, select: { driverPayVisible: true } });

    if (anterior?.driverPayVisible !== empresa.driverPayVisible) {
      await registrarAuditoriaDepois(prisma, {
        ator: user,
        origem: origemDaRequisicao(req),
        acao: 'empresa.remuneracao',
        entidade: 'empresa',
        entidadeId: tenantId,
        resumo: `Remuneração no aplicativo do motorista ${empresa.driverPayVisible ? 'ligada' : 'desligada'}`,
        antes: { visivelAoMotorista: anterior?.driverPayVisible ?? false },
        depois: { visivelAoMotorista: empresa.driverPayVisible },
      });
    }

    return NextResponse.json({ visivelAoMotorista: empresa.driverPayVisible });
  } catch (error) {
    console.error('Erro ao alterar a visibilidade da remuneração:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
