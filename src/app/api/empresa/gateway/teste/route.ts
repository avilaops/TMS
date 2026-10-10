import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import { Refusal } from '@/lib/cadastros';
import { GATEWAY_INDISPONIVEL, GATEWAY_NAO_LIGADO } from '@/lib/cobranca-gateway';
import { credenciaisDaEmpresa, empresaDaSessao } from '@/lib/cobranca-gateway-db';
import { cifraLigada } from '@/lib/cifra';
import { MercadoPagoError, contaDoMercadoPago } from '@/lib/mercado-pago';

/**
 * "Testar conexão": pergunta ao Mercado Pago de quem é o Access Token guardado
 * (`GET /users/me`) e devolve o nome da conta. Não cria nem altera nada lá.
 */
export async function POST() {
  const { error } = await requireStaff({ pode: 'empresa' });
  if (error) return error;

  try {
    if (!cifraLigada()) return NextResponse.json({ error: GATEWAY_INDISPONIVEL }, { status: 503 });
    const credenciais = await credenciaisDaEmpresa(await empresaDaSessao());
    if (!credenciais) return NextResponse.json({ error: GATEWAY_NAO_LIGADO }, { status: 409 });
    const conta = await contaDoMercadoPago(credenciais.accessToken);
    return NextResponse.json({ conta: conta.nome });
  } catch (erro) {
    if (erro instanceof Refusal) return NextResponse.json({ error: erro.message }, { status: erro.status });
    if (erro instanceof MercadoPagoError) return NextResponse.json({ error: erro.message }, { status: 502 });
    console.error('Erro ao testar a conta do Mercado Pago:', erro instanceof Error ? erro.message : erro);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
