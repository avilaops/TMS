import { NextResponse } from 'next/server';
import { sistema } from '@/lib/prisma';
import { Refusal } from '@/lib/cadastros';
import { origemDaRequisicao } from '@/lib/auditoria';
import { consumeRateLimit } from '@/lib/rate-limit';
import { ID_DE_PAGAMENTO, MercadoPagoError, assinaturaValida } from '@/lib/mercado-pago';
import { credenciaisDaEmpresa, empresaPorId, sincronizarPagamento } from '@/lib/cobranca-gateway-db';

/** Avisos por minuto, por empresa. O Mercado Pago manda poucos por pagamento; acima disto é ruído ou abuso. */
const LIMITE_POR_MINUTO = 120;

/**
 * Webhook do Mercado Pago: `POST /api/pagamentos/mercado-pago/<slug da empresa>`.
 *
 * Rota pública, sem sessão: quem a protege é a assinatura. A empresa é a do
 * endereço, e a assinatura (`x-signature`) é conferida com o segredo DELA: um
 * aviso assinado para outra empresa não passa (401).
 *
 * O corpo do aviso não é usado para nada que valha dinheiro. O que se aproveita
 * dele é o id do pagamento (o `data.id` da URL, que faz parte do que é
 * assinado), e o pagamento é buscado no Mercado Pago com o token da empresa:
 * vale o que a API responder. Pagamento que não existe na conta da empresa, ou
 * que não é de uma cobrança dela, não muda nada.
 *
 * Responde 200 quando o aviso foi tratado (mesmo que não houvesse o que fazer)
 * e 503 quando não deu para consultar o Mercado Pago: ele reenvia, e a
 * conferência periódica cobre o que faltar.
 */
export async function POST(req: Request, { params }: { params: Promise<{ empresa: string }> }) {
  const { empresa: slug } = await params;

  const limite = consumeRateLimit(`mercado-pago:${slug.slice(0, 80)}`, LIMITE_POR_MINUTO, 60_000);
  if (!limite.allowed) {
    return NextResponse.json({ error: 'Muitos avisos em pouco tempo.' }, { status: 429, headers: { 'Retry-After': String(limite.retryAfterSeconds) } });
  }

  try {
    // Antes de existir empresa na requisição: é o caminho de sistema que acha a empresa pelo slug.
    const tenant = await sistema.tenant.findUnique({ where: { slug }, select: { id: true, active: true } });
    if (!tenant?.active) return NextResponse.json({ error: 'Empresa não encontrada.' }, { status: 404 });

    const empresa = empresaPorId(tenant.id);
    const credenciais = await credenciaisDaEmpresa(empresa);
    if (!credenciais) return NextResponse.json({ error: 'Esta empresa não recebe avisos do Mercado Pago.' }, { status: 404 });

    const url = new URL(req.url);
    const dataId = url.searchParams.get('data.id') ?? '';
    const assinado = assinaturaValida(
      { assinatura: req.headers.get('x-signature'), requestId: req.headers.get('x-request-id'), dataId },
      credenciais.webhookSecret,
    );
    if (!assinado) return NextResponse.json({ error: 'Assinatura inválida.' }, { status: 401 });

    // Só aviso de pagamento, e só com o id que foi assinado.
    const corpo = (await req.json().catch(() => null)) as { type?: unknown } | null;
    const tipo = url.searchParams.get('type') ?? (typeof corpo?.type === 'string' ? corpo.type : '');
    if (tipo !== 'payment' || !ID_DE_PAGAMENTO.test(dataId)) return NextResponse.json({ ok: true, resultado: 'ignorado' });

    const resultado = await sincronizarPagamento(empresa, credenciais, dataId, origemDaRequisicao(req));
    return NextResponse.json({ ok: true, resultado });
  } catch (erro) {
    if (erro instanceof MercadoPagoError || erro instanceof Refusal) {
      return NextResponse.json({ error: 'Não foi possível tratar o aviso agora.' }, { status: 503 });
    }
    // Só a mensagem: nada do pedido nem das credenciais vai para o log.
    console.error('Erro no aviso do Mercado Pago:', erro instanceof Error ? erro.message : 'erro desconhecido');
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
