import { NextResponse } from 'next/server';
import { Refusal } from '@/lib/cadastros';

/**
 * A resposta de erro das rotas do MDF-e: a recusa de regra vira o status e a
 * frase dela; o resto vira 500, e no log vai só a mensagem (o erro inteiro
 * poderia carregar o XML ou a chave do certificado).
 */
export function respostaDeErro(erro: unknown, oQue: string): NextResponse {
  if (erro instanceof Refusal) return NextResponse.json({ error: erro.message }, { status: erro.status });
  console.error(`Erro ao ${oQue}:`, erro instanceof Error ? erro.message : erro);
  return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
}
