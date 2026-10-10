import { NextResponse } from 'next/server';
import prisma, { empresaAtual } from '@/lib/prisma';
import { requirePortalClient } from '@/lib/portal';
import { RECEBEDOR_SELECT, pixDoTitulo, recebedorDaEmpresa } from '@/lib/pix';
import { emAbertoPorFatura } from '@/lib/cobranca-gateway-db';
import type { CobrancaDaTela } from '@/lib/cobranca-gateway';

/** O que o cliente recebe de uma cobrança em aberto: só o que serve para pagar. */
const paraOCliente = (cobranca: CobrancaDaTela | null) =>
  cobranca && {
    copiaECola: cobranca.copiaECola,
    qrCodeBase64: cobranca.qrCodeBase64,
    link: cobranca.link,
    linhaDigitavel: cobranca.linhaDigitavel,
    venceEm: cobranca.venceEm,
  };

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
        invoice: { select: { id: true, number: true } },
      },
    });

    // A chave Pix é da transportadora (a empresa só lê o próprio cadastro) e é
    // pública por natureza: vai no código que o cliente cola no banco.
    const empresa = await prisma.tenant.findUnique({ where: { id: await empresaAtual() }, select: RECEBEDOR_SELECT });
    const recebedor = recebedorDaEmpresa(empresa);

    // Cobranças do Mercado Pago em aberto das faturas deste cliente: o Pix
    // dinâmico (com QR Code e baixa automática) e o boleto. Só as faturas
    // listadas acima, que já são só as dele.
    const cobrancas = await emAbertoPorFatura(prisma, invoices.flatMap(({ invoice }) => (invoice ? [invoice.id] : [])));

    return NextResponse.json(
      invoices.map(({ invoice, ...titulo }) => {
        const emAberto = titulo.status === 'PENDING' && invoice ? cobrancas.get(invoice.id) : undefined;
        return {
          ...titulo,
          // Pix Copia e Cola (estático) do título em aberto; nulo se a transportadora não cadastrou
          // chave. Com Pix dinâmico em aberto, é ele que aparece no lugar do estático.
          pix: titulo.status === 'PENDING' && !emAberto?.pix ? pixDoTitulo(recebedor, { ...titulo, invoice }) : null,
          cobranca: emAberto ? { pix: paraOCliente(emAberto.pix), boleto: paraOCliente(emAberto.boleto) } : null,
        };
      }),
    );
  } catch (error) {
    console.error('Error fetching portal invoices:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
