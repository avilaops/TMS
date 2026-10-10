import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import { firstIssue } from '@/lib/usuarios';
import { origemDaRequisicao } from '@/lib/auditoria';
import { empresaDaSessao } from '@/lib/cobranca-gateway-db';
import { cancelarSchema } from '@/lib/mdfe';
import { cancelarMdfe } from '@/lib/mdfe-db';
import { respostaDeErro } from '../../../erro';

/**
 * Cancela um MDF-e autorizado: envia à SEFAZ o evento de cancelamento, com a
 * justificativa (15 a 255 letras), dentro de 24 horas da autorização e sem o
 * transporte ter começado (a pessoa confirma). O MDF-e só volta "cancelado"
 * quando a SEFAZ registra o evento.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireStaff({ pode: 'fiscal' });
  if (error) return error;

  const dados = cancelarSchema.safeParse(await req.json().catch(() => null));
  if (!dados.success) return NextResponse.json({ error: firstIssue(dados.error) }, { status: 400 });

  try {
    const { id } = await params;
    return NextResponse.json(await cancelarMdfe(await empresaDaSessao(), id, dados.data.justificativa, { ator: user, origem: origemDaRequisicao(req) }));
  } catch (erro) {
    return respostaDeErro(erro, 'cancelar o MDF-e');
  }
}
