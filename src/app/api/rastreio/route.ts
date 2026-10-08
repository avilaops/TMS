import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { sistema } from '@/lib/prisma';
import { consumeRateLimit } from '@/lib/rate-limit';
import { normalizeTaxId, normalizeTrackingCode } from '@/lib/tracking';

/**
 * Rastreio publico: CNPJ/CPF + codigo de rastreio.
 *
 * Duas propriedades sustentam esta rota, e as duas sao faceis de quebrar sem
 * querer ao mexer aqui:
 *
 * 1. O `select` e explicito e fechado. Um `include` arrastaria o registro
 *    inteiro de `Client` (limite de credito, condicao de pagamento, contato),
 *    o valor e a chave da nota, e — por `manifest.driver.user` — o hash de
 *    senha do motorista. Acrescente campo por campo, so o que a tela desenha.
 *
 * 2. Nenhuma resposta revela QUAL dado estava certo. CNPJ que nao existe,
 *    codigo que nao existe, codigo de outro cliente e formato invalido saem
 *    todos como a mesma lista vazia. Antes bastava o CNPJ, que e publico, para
 *    descobrir se uma empresa tinha carga na Mello; o par so fecha essa brecha
 *    se o erro nao contar qual metade falhou.
 *
 * O cruzamento e feito pelo banco, numa consulta so. Buscar pelo codigo e
 * conferir o CNPJ depois — no servidor ou no cliente — devolveria a carga para
 * quem tem so o codigo, e o tempo de resposta ja entregaria a diferenca.
 */

const RATE_LIMIT_ATTEMPTS = 12;
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;

/** Nunca guardamos o documento inteiro na chave: 12 hex bastam para separar. */
function rateLimitKey(request: Request, taxId: string | null): string {
  const forwarded = request.headers.get('x-forwarded-for') ?? '';
  const ip = forwarded.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'ip-desconhecido';
  const subject = taxId ? createHash('sha256').update(taxId).digest('hex').slice(0, 12) : 'sem-documento';
  return `rastreio:${ip}:${subject}`;
}

/** Uma resposta so para todos os fracassos. */
function notFound() {
  return NextResponse.json([]);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const rawTaxId = searchParams.get('cnpj');
  const rawCode = searchParams.get('codigo');

  // Faltar parametro e erro de contrato, nao resultado de busca: nao diz nada
  // sobre existir ou nao uma carga. So o CNPJ, ou so o codigo, cai aqui.
  if (!rawTaxId || !rawCode) {
    return NextResponse.json(
      { error: 'Informe o CNPJ/CPF e o código de rastreio.' },
      { status: 400 },
    );
  }

  const taxId = normalizeTaxId(rawTaxId);
  const trackingCode = normalizeTrackingCode(rawCode);

  const limit = consumeRateLimit(rateLimitKey(req, taxId), RATE_LIMIT_ATTEMPTS, RATE_LIMIT_WINDOW_MS);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Muitas consultas seguidas. Tente novamente em alguns minutos.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    );
  }

  // Formato invalido sai como "nao encontrado", igual ao par que nao casa:
  // responder 400 aqui diria ao atacante que o outro campo estava certo.
  if (!taxId || !trackingCode) return notFound();

  try {
    // Sem sessão e sem empresa: o código de rastreio é único no sistema inteiro,
    // e o CNPJ confere dentro da empresa a que a coleta pertence.
    const minuta = await sistema.collection.findFirst({
      where: {
        trackingCode,
        client: { cnpj: taxId },
      },
      select: {
        id: true,
        trackingCode: true,
        status: true,
        origin: true,
        destination: true,
        createdAt: true,
        // Linha do tempo: só o status e a hora. Quem fez a troca (`userId`) é
        // dado interno e fica de fora.
        statusHistory: {
          select: { toStatus: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        },
        // Nome da transportadora, para a página pública dizer de quem é a carga.
        tenant: { select: { name: true } },
        manifest: {
          select: {
            driver: {
              select: {
                user: { select: { name: true } },
              },
            },
          },
        },
      },
    });

    return minuta ? NextResponse.json([minuta]) : notFound();
  } catch (error) {
    console.error('Error fetching rastreio:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
