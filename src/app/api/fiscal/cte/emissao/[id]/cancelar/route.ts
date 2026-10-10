import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import { Refusal } from '@/lib/cadastros';
import { firstIssue } from '@/lib/usuarios';
import { origemDaRequisicao } from '@/lib/auditoria';
import { empresaDaSessao } from '@/lib/cobranca-gateway-db';
import { cancelarSchema } from '@/lib/cte';
import { cancelarCte } from '@/lib/cte-db';

/**
 * Cancela um CT-e autorizado: envia à SEFAZ o evento de cancelamento, com a
 * justificativa (15 a 255 letras), dentro de 7 dias da autorização. O CT-e só
 * volta "cancelado" quando a SEFAZ registra o evento.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireStaff({ pode: 'fiscal' });
  if (error) return error;

  const dados = cancelarSchema.safeParse(await req.json().catch(() => null));
  if (!dados.success) return NextResponse.json({ error: firstIssue(dados.error) }, { status: 400 });

  try {
    const { id } = await params;
    return NextResponse.json(await cancelarCte(await empresaDaSessao(), id, dados.data.justificativa, { ator: user, origem: origemDaRequisicao(req) }));
  } catch (erro) {
    if (erro instanceof Refusal) return NextResponse.json({ error: erro.message }, { status: erro.status });
    console.error('Erro ao cancelar o CT-e:', erro instanceof Error ? erro.message : erro);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
