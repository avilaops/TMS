import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import prisma, { empresaAtual } from '@/lib/prisma';

const NOT_FOUND = 'Lançamento não encontrado.';

/**
 * Dados do recibo de um valor já recebido. Só receita paga tem recibo: despesa
 * e título em aberto respondem 409. Lançamento de outra empresa não aparece
 * para esta e responde o mesmo 404 do inexistente.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireStaff(["ADMIN"]);
  if (error) return error;

  try {
    const { id } = await params;
    const lancamento = await prisma.financialTransaction.findUnique({
      where: { id },
      select: {
        id: true,
        type: true,
        status: true,
        amount: true,
        description: true,
        paidAt: true,
        paymentMethod: true,
        dueDate: true,
        counterparty: true,
        client: { select: { companyName: true, cnpj: true } },
        invoice: { select: { id: true, number: true } },
      },
    });
    if (!lancamento) return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
    if (lancamento.type !== 'INCOME' || lancamento.status !== 'PAID' || !lancamento.paidAt) {
      return NextResponse.json({ error: 'Só há recibo de valor já recebido.' }, { status: 409 });
    }

    const empresa = await prisma.tenant.findUnique({ where: { id: await empresaAtual() }, select: { name: true, cnpj: true } });

    return NextResponse.json({
      id: lancamento.id,
      amount: lancamento.amount,
      description: lancamento.description,
      paidAt: lancamento.paidAt,
      paymentMethod: lancamento.paymentMethod,
      dueDate: lancamento.dueDate,
      invoice: lancamento.invoice,
      // Quem pagou: o cliente cadastrado ou, sem ele, o pagador digitado no lançamento.
      pagador: lancamento.client
        ? { nome: lancamento.client.companyName, cnpj: lancamento.client.cnpj }
        : { nome: lancamento.counterparty, cnpj: null },
      empresa: { name: empresa?.name ?? '', cnpj: empresa?.cnpj ?? null },
    });
  } catch (error) {
    console.error('Erro ao montar o recibo:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
