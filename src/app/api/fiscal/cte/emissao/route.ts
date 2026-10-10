import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import { Refusal } from '@/lib/cadastros';
import { firstIssue } from '@/lib/usuarios';
import { origemDaRequisicao } from '@/lib/auditoria';
import { empresaDaSessao } from '@/lib/cobranca-gateway-db';
import { emitirSchema } from '@/lib/cte';
import { conferirCte, emitirCte } from '@/lib/cte-db';

/**
 * Emissão de CT-e pela SEFAZ (modelo 57, modal rodoviário).
 *
 * `GET ?collectionId=`: "conferir e emitir". O que vai no documento, o que
 * falta para emitir e o CT-e que a carga já tem. Nada é enviado.
 *
 * `POST { collectionId }`: monta, assina e transmite. A resposta traz o CT-e
 * como ficou e a mensagem da SEFAZ; ele só volta "autorizado" com o protocolo
 * que a SEFAZ devolveu. Falha de rede é 502 ou 504, com a frase do que fazer.
 */
export async function GET(req: Request) {
  const { error } = await requireStaff({ pode: 'fiscalVer' });
  if (error) return error;

  const dados = emitirSchema.safeParse({ collectionId: new URL(req.url).searchParams.get('collectionId') });
  if (!dados.success) return NextResponse.json({ error: firstIssue(dados.error) }, { status: 400 });

  try {
    return NextResponse.json(await conferirCte(await empresaDaSessao(), dados.data.collectionId));
  } catch (erro) {
    if (erro instanceof Refusal) return NextResponse.json({ error: erro.message }, { status: erro.status });
    console.error('Erro ao conferir o CT-e:', erro instanceof Error ? erro.message : erro);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const { user, error } = await requireStaff({ pode: 'fiscal' });
  if (error) return error;

  const dados = emitirSchema.safeParse(await req.json().catch(() => null));
  if (!dados.success) return NextResponse.json({ error: firstIssue(dados.error) }, { status: 400 });

  try {
    return NextResponse.json(await emitirCte(await empresaDaSessao(), dados.data.collectionId, { ator: user, origem: origemDaRequisicao(req) }));
  } catch (erro) {
    if (erro instanceof Refusal) return NextResponse.json({ error: erro.message }, { status: erro.status });
    // Só a mensagem: o erro inteiro poderia carregar o XML ou a chave do certificado.
    console.error('Erro ao emitir o CT-e:', erro instanceof Error ? erro.message : erro);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
