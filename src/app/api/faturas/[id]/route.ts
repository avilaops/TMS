import { NextResponse } from 'next/server';
import prisma, { empresaAtual, transacao } from '@/lib/prisma';
import { requireStaff } from '@/lib/staff';
import { Refusal } from '@/lib/cadastros';
import { firstIssue } from '@/lib/usuarios';
import { INVOICE_COLLECTION_SELECT, INVOICE_SELECT, invoiceActionSchema } from '@/lib/faturas';
import { INVOICE_NOT_FOUND as NOT_FOUND, alterarFatura } from '@/lib/faturas-db';
import { origemDaRequisicao } from '@/lib/auditoria';
import { RECEBEDOR_SELECT, pixCopiaECola, recebedorDaEmpresa, txidDaFatura } from '@/lib/pix';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireStaff({ pode: 'faturamentoVer' });
  if (error) return error;

  try {
    const { id } = await params;
    const fatura = await prisma.invoice.findUnique({
      where: { id },
      select: {
        ...INVOICE_SELECT,
        collections: { select: INVOICE_COLLECTION_SELECT, orderBy: { createdAt: 'asc' } },
        // O lançamento a receber da fatura: é por ele que a tela chega ao recibo.
        transaction: { select: { id: true } },
      },
    });
    if (!fatura) return NextResponse.json({ error: NOT_FOUND }, { status: 404 });

    // Pix Copia e Cola (estático) da fatura em aberto, se a empresa cadastrou a
    // chave em Empresa > Cobrança. A empresa só lê o próprio cadastro.
    let pix: string | null = null;
    if (fatura.status === 'OPEN' && fatura.total > 0) {
      const empresa = await prisma.tenant.findUnique({ where: { id: await empresaAtual() }, select: RECEBEDOR_SELECT });
      const recebedor = recebedorDaEmpresa(empresa);
      if (recebedor) pix = pixCopiaECola({ ...recebedor, valor: fatura.total, txid: txidDaFatura(fatura.number) });
    }

    return NextResponse.json({ ...fatura, pix });
  } catch (error) {
    console.error('Erro ao buscar fatura:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

/**
 * Pagar, reabrir ou cancelar. O lançamento do financeiro acompanha a fatura na
 * mesma transação: pago com ela, pendente quando reaberta, apagado no
 * cancelamento. Pagar aceita `juros`, `multa` e `desconto`, que vão para o
 * lançamento (o valor recebido entra no caixa; o total da fatura não muda).
 * Cancelar solta as cargas, que voltam a ser faturáveis; o número
 * da fatura cancelada não é reaproveitado. A regra mora em `alterarFatura`
 * (src/lib/faturas-db.ts), que a conciliação bancária também usa.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireStaff({ pode: 'faturamento' });
  if (error) return error;

  try {
    const { id } = await params;
    const parsed = invoiceActionSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const { action, ...encargos } = parsed.data;
    const origem = origemDaRequisicao(req);

    const fatura = await transacao((tx) => alterarFatura(tx, id, action, { ator: user, origem, encargos }));

    return NextResponse.json(fatura);
  } catch (err) {
    if (err instanceof Refusal) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('Erro ao alterar fatura:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
