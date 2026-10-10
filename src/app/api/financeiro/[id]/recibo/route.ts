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
        paidAmount: true,
        interest: true,
        fine: true,
        discount: true,
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
      // O recibo é do que entrou: com juros, multa e desconto, quando a baixa teve.
      amount: lancamento.paidAmount ?? lancamento.amount,
      // Só vem quando o recebido difere do valor do título: é o que a tela detalha.
      encargos:
        lancamento.paidAmount === null
          ? null
          : { original: lancamento.amount, juros: lancamento.interest ?? 0, multa: lancamento.fine ?? 0, desconto: lancamento.discount ?? 0 },
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
