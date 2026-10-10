import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import prisma, { empresaAtual } from '@/lib/prisma';
import { diaNoBrasil } from '@/lib/financeiro';
import { TITULO_SELECT, posicaoDeCobranca } from '@/lib/cobranca';
import { RECEBEDOR_SELECT, recebedorDaEmpresa } from '@/lib/pix';

/**
 * Posição de cobrança: o que há a receber em aberto, por devedor e por faixa de
 * atraso. Só leitura: a baixa continua no Faturamento e no Financeiro, e o
 * título pago some daqui na consulta seguinte.
 */
export async function GET() {
  const { error } = await requireStaff(["ADMIN"]);
  if (error) return error;

  try {
    const hoje = new Date();
    const titulos = await prisma.financialTransaction.findMany({
      where: { type: 'INCOME', status: 'PENDING' },
      select: TITULO_SELECT,
    });
    // A empresa só lê o próprio cadastro (prisma/sql/010-rls.sql): é ela que assina o aviso.
    const empresa = await prisma.tenant.findUnique({ where: { id: await empresaAtual() }, select: { name: true, ...RECEBEDOR_SELECT } });

    return NextResponse.json({
      hoje: diaNoBrasil(hoje),
      empresa: { name: empresa?.name ?? '' },
      // Com a chave Pix cadastrada, cada título sai com o seu Copia e Cola, que entra no aviso.
      ...posicaoDeCobranca(titulos, hoje, recebedorDaEmpresa(empresa)),
    });
  } catch (error) {
    console.error('Erro ao montar a posição de cobrança:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
