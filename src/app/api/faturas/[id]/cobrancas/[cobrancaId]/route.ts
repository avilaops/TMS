import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import { Refusal } from '@/lib/cadastros';
import { origemDaRequisicao } from '@/lib/auditoria';
import { atualizarCobranca, empresaDaSessao } from '@/lib/cobranca-gateway-db';

/**
 * "Atualizar situação": consulta o Mercado Pago sobre a cobrança e aplica o que
 * ele responder (paga a fatura, encerra a cobrança ou deixa "a conferir"), pelo
 * mesmo caminho do aviso automático. É para quando o aviso não chega.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string; cobrancaId: string }> }) {
  const { error } = await requireStaff({ pode: 'faturamento' });
  if (error) return error;

  try {
    const { id, cobrancaId } = await params;
    return NextResponse.json(await atualizarCobranca(await empresaDaSessao(), id, cobrancaId, origemDaRequisicao(req)));
  } catch (erro) {
    if (erro instanceof Refusal) return NextResponse.json({ error: erro.message }, { status: erro.status });
    console.error('Erro ao atualizar cobrança:', erro instanceof Error ? erro.message : erro);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
