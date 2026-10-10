import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import { firstIssue } from '@/lib/usuarios';
import { origemDaRequisicao } from '@/lib/auditoria';
import { empresaDaSessao } from '@/lib/cobranca-gateway-db';
import { encerrarSchema } from '@/lib/mdfe';
import { encerrarMdfe } from '@/lib/mdfe-db';
import { respostaDeErro } from '../../../erro';

/**
 * Encerra um MDF-e autorizado: envia à SEFAZ o evento de encerramento, com o
 * dia e o município em que a viagem terminou. O MDF-e só volta "encerrado"
 * quando a SEFAZ registra o evento.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireStaff({ pode: 'fiscal' });
  if (error) return error;

  const dados = encerrarSchema.safeParse(await req.json().catch(() => null));
  if (!dados.success) return NextResponse.json({ error: firstIssue(dados.error) }, { status: 400 });

  try {
    const { id } = await params;
    return NextResponse.json(await encerrarMdfe(await empresaDaSessao(), id, dados.data, { ator: user, origem: origemDaRequisicao(req) }));
  } catch (erro) {
    return respostaDeErro(erro, 'encerrar o MDF-e');
  }
}
