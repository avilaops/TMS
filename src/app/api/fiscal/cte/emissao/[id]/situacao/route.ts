import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import { Refusal } from '@/lib/cadastros';
import { origemDaRequisicao } from '@/lib/auditoria';
import { empresaDaSessao } from '@/lib/cobranca-gateway-db';
import { conferirNaSefaz } from '@/lib/cte-db';

/**
 * "Conferir na SEFAZ": consulta a situação do CT-e pela chave e atualiza o que
 * este sistema tem (autorizado, cancelado, o envio que tinha ficado sem
 * resposta) e os eventos vinculados que a SEFAZ devolver. Grava, por isso pede
 * a capacidade de escrever no fiscal. A resposta traz o CT-e como ficou, a
 * frase para a pessoa e os eventos.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireStaff({ pode: 'fiscal' });
  if (error) return error;

  try {
    const { id } = await params;
    return NextResponse.json(await conferirNaSefaz(await empresaDaSessao(), id, { ator: user, origem: origemDaRequisicao(req) }));
  } catch (erro) {
    if (erro instanceof Refusal) return NextResponse.json({ error: erro.message }, { status: erro.status });
    console.error('Erro ao conferir o CT-e na SEFAZ:', erro instanceof Error ? erro.message : erro);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
