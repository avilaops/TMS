import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import { Refusal } from '@/lib/cadastros';
import { firstIssue } from '@/lib/usuarios';
import { origemDaRequisicao } from '@/lib/auditoria';
import { credenciaisDoGatewaySchema } from '@/lib/cobranca-gateway';
import { empresaDaSessao, gatewayDaEmpresa, removerGateway, salvarGateway } from '@/lib/cobranca-gateway-db';

/**
 * A conta do Mercado Pago da empresa da sessão (Empresa > Cobrança). Só o
 * administrador lê e altera.
 *
 * O Access Token e o segredo do webhook entram por aqui e não saem mais: a
 * leitura devolve só "configurado", os 4 últimos caracteres de cada um e o
 * endereço de webhook que a empresa cadastra no painel do Mercado Pago. Eles
 * ficam cifrados no banco e não vão para log nem para a auditoria.
 */
export async function GET() {
  const { error } = await requireStaff({ pode: 'empresa' });
  if (error) return error;

  try {
    return NextResponse.json(await gatewayDaEmpresa(await empresaDaSessao()));
  } catch (erro) {
    console.error('Erro ao ler a conta do Mercado Pago:', erro instanceof Error ? erro.message : erro);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const { user, error } = await requireStaff({ pode: 'empresa' });
  if (error) return error;

  const dados = credenciaisDoGatewaySchema.safeParse(await req.json().catch(() => null));
  if (!dados.success) return NextResponse.json({ error: firstIssue(dados.error) }, { status: 400 });

  try {
    return NextResponse.json(await salvarGateway(await empresaDaSessao(), dados.data, { ator: user, origem: origemDaRequisicao(req) }));
  } catch (erro) {
    if (erro instanceof Refusal) return NextResponse.json({ error: erro.message }, { status: erro.status });
    // Só a mensagem: o erro inteiro poderia carregar o que veio no pedido.
    console.error('Erro ao salvar a conta do Mercado Pago:', erro instanceof Error ? erro.message : erro);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const { user, error } = await requireStaff({ pode: 'empresa' });
  if (error) return error;

  try {
    return NextResponse.json(await removerGateway(await empresaDaSessao(), { ator: user, origem: origemDaRequisicao(req) }));
  } catch (erro) {
    console.error('Erro ao remover a conta do Mercado Pago:', erro instanceof Error ? erro.message : erro);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
