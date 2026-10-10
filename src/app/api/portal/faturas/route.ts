import { NextResponse } from 'next/server';
import prisma, { empresaAtual } from '@/lib/prisma';
import { requirePortalClient } from '@/lib/portal';
import { RECEBEDOR_SELECT, pixDoTitulo, recebedorDaEmpresa } from '@/lib/pix';

export async function GET() {
  const { clientId, error } = await requirePortalClient();
  if (error) return error;

  try {
    const invoices = await prisma.financialTransaction.findMany({
      where: { type: 'INCOME', clientId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        amount: true,
        description: true,
        dueDate: true,
        status: true,
        createdAt: true,
        invoice: { select: { number: true } },
      },
    });

    // A chave Pix é da transportadora (a empresa só lê o próprio cadastro) e é
    // pública por natureza: vai no código que o cliente cola no banco.
    const empresa = await prisma.tenant.findUnique({ where: { id: await empresaAtual() }, select: RECEBEDOR_SELECT });
    const recebedor = recebedorDaEmpresa(empresa);

    return NextResponse.json(
      invoices.map(({ invoice, ...titulo }) => ({
        ...titulo,
        // Pix Copia e Cola (estático) do título em aberto; nulo se a transportadora não cadastrou chave.
        pix: titulo.status === 'PENDING' ? pixDoTitulo(recebedor, { ...titulo, invoice }) : null,
      })),
    );
  } catch (error) {
    console.error('Error fetching portal invoices:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
