import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requirePortalClient } from '@/lib/portal';
import { calcularFrete, tabelaVigente } from '@/lib/frete';
import { cotacaoDoPortalSchema, cotacaoParaOCliente } from '@/lib/portal-cliente';
import { firstIssue } from '@/lib/usuarios';

/**
 * Cotação pelo portal: quanto sai e em quanto tempo chega uma carga do cliente
 * logado, pela tabela DELE (a do cadastro; senão a padrão da transportadora).
 *
 * É a mesma conta do simulador do painel (`calcularFrete`), mas a resposta é
 * fechada: valor, prazo e avisos. A composição, o nome da tabela e as regras
 * ficam com a transportadora. Nada é gravado: é só consulta.
 */
export async function POST(req: Request) {
  const { clientId, error } = await requirePortalClient();
  if (error) return error;

  try {
    const parsed = cotacaoDoPortalSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const pedido = parsed.data;

    const tabela = await tabelaVigente(prisma, clientId);
    const frete = tabela
      ? calcularFrete(tabela, pedido.destination, {
          peso: pedido.weight,
          volumes: pedido.volumes,
          valorNota: pedido.invoiceValue,
          metrosCubicos: pedido.cubicMeters,
        })
      : null;

    return NextResponse.json(cotacaoParaOCliente(frete));
  } catch (error) {
    console.error('Erro ao cotar pelo portal:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
