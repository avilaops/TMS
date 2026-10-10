import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import { firstIssue } from '@/lib/usuarios';
import { origemDaRequisicao } from '@/lib/auditoria';
import { empresaDaSessao } from '@/lib/cobranca-gateway-db';
import { condutorSchema } from '@/lib/mdfe';
import { incluirCondutor } from '@/lib/mdfe-db';
import { respostaDeErro } from '../../../erro';

/**
 * Inclui um condutor num MDF-e autorizado (troca de motorista no meio da
 * viagem): envia à SEFAZ o evento de inclusão de condutor, com o nome e o CPF.
 * O condutor só aparece no MDF-e quando a SEFAZ registra o evento.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireStaff({ pode: 'fiscal' });
  if (error) return error;

  const dados = condutorSchema.safeParse(await req.json().catch(() => null));
  if (!dados.success) return NextResponse.json({ error: firstIssue(dados.error) }, { status: 400 });

  try {
    const { id } = await params;
    return NextResponse.json(await incluirCondutor(await empresaDaSessao(), id, dados.data, { ator: user, origem: origemDaRequisicao(req) }));
  } catch (erro) {
    return respostaDeErro(erro, 'incluir o condutor no MDF-e');
  }
}
