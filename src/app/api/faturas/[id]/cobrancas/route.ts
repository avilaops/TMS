import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import { Refusal } from '@/lib/cadastros';
import { firstIssue } from '@/lib/usuarios';
import { origemDaRequisicao } from '@/lib/auditoria';
import { criarCobrancaSchema } from '@/lib/cobranca-gateway';
import { criarCobranca, empresaDaSessao } from '@/lib/cobranca-gateway-db';

/**
 * "Gerar Pix" e "Gerar boleto": cria no Mercado Pago, na conta da empresa, a
 * cobrança de uma fatura em aberto. Quem paga a fatura depois é o aviso do
 * Mercado Pago (`POST /api/pagamentos/mercado-pago/[empresa]`). A regra está em
 * `criarCobranca` (src/lib/cobranca-gateway-db.ts).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireStaff({ pode: 'faturamento' });
  if (error) return error;

  const dados = criarCobrancaSchema.safeParse(await req.json().catch(() => null));
  if (!dados.success) return NextResponse.json({ error: firstIssue(dados.error) }, { status: 400 });

  try {
    const { id } = await params;
    const cobranca = await criarCobranca(await empresaDaSessao(), id, dados.data.tipo, { ator: user, origem: origemDaRequisicao(req) });
    return NextResponse.json(cobranca, { status: 201 });
  } catch (erro) {
    if (erro instanceof Refusal) return NextResponse.json({ error: erro.message }, { status: erro.status });
    console.error('Erro ao gerar cobrança:', erro instanceof Error ? erro.message : erro);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
