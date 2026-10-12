import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import { Refusal } from '@/lib/cadastros';
import { origemDaRequisicao } from '@/lib/auditoria';
import { empresaDaSessao } from '@/lib/cobranca-gateway-db';
import { cancelarEntrega, registrarEntrega } from '@/lib/cte-db';

/**
 * O comprovante de entrega do CT-e na SEFAZ. É ação de quem escreve no fiscal:
 * nada aqui é enviado sozinho.
 *
 * `POST`: registra o evento 110180 com o que o comprovante APROVADO da carga
 * tem (quem recebeu, quando, a posição e o hash da imagem). Não leva corpo.
 *
 * `DELETE`: cancela o comprovante em vigor (evento 110181).
 *
 * As duas devolvem os eventos do CT-e como ficaram; nada é dado como
 * registrado sem o retorno da SEFAZ.
 */
function respostaDeErro(erro: unknown, oQue: string): NextResponse {
  if (erro instanceof Refusal) return NextResponse.json({ error: erro.message }, { status: erro.status });
  console.error(`Erro ao ${oQue}:`, erro instanceof Error ? erro.message : erro);
  return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireStaff({ pode: 'fiscal' });
  if (error) return error;

  try {
    const { id } = await params;
    return NextResponse.json(await registrarEntrega(await empresaDaSessao(), id, { ator: user, origem: origemDaRequisicao(req) }));
  } catch (erro) {
    return respostaDeErro(erro, 'registrar a entrega do CT-e na SEFAZ');
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireStaff({ pode: 'fiscal' });
  if (error) return error;

  try {
    const { id } = await params;
    return NextResponse.json(await cancelarEntrega(await empresaDaSessao(), id, { ator: user, origem: origemDaRequisicao(req) }));
  } catch (erro) {
    return respostaDeErro(erro, 'cancelar o comprovante de entrega do CT-e');
  }
}
