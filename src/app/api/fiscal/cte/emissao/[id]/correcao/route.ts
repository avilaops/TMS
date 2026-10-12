import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import { Refusal } from '@/lib/cadastros';
import { firstIssue } from '@/lib/usuarios';
import { origemDaRequisicao } from '@/lib/auditoria';
import { empresaDaSessao } from '@/lib/cobranca-gateway-db';
import { cartaDeCorrecaoSchema } from '@/lib/cte';
import { corrigirCte } from '@/lib/cte-db';

/**
 * Carta de correção eletrônica do CT-e (evento 110110): `{ correcoes: [{ grupo,
 * campo, valor, item? }] }`. O servidor recusa (400) o campo que a carta não
 * pode corrigir. A carta só fica registrada quando a SEFAZ registra o evento; a
 * resposta traz os eventos do CT-e como ficaram.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireStaff({ pode: 'fiscal' });
  if (error) return error;

  const dados = cartaDeCorrecaoSchema.safeParse(await req.json().catch(() => null));
  if (!dados.success) return NextResponse.json({ error: firstIssue(dados.error) }, { status: 400 });

  try {
    const { id } = await params;
    return NextResponse.json(await corrigirCte(await empresaDaSessao(), id, dados.data.correcoes, { ator: user, origem: origemDaRequisicao(req) }));
  } catch (erro) {
    if (erro instanceof Refusal) return NextResponse.json({ error: erro.message }, { status: erro.status });
    console.error('Erro ao registrar a carta de correção do CT-e:', erro instanceof Error ? erro.message : erro);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
