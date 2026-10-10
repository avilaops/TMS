import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import { Refusal } from '@/lib/cadastros';
import { empresaDaSessao } from '@/lib/cobranca-gateway-db';
import { nomeDoArquivoDoCte } from '@/lib/cte';
import { xmlDoCte } from '@/lib/cte-db';

/** O arquivo do CT-e autorizado (cteProc: o CT-e assinado e o protocolo da SEFAZ), para baixar. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireStaff({ pode: 'fiscalVer' });
  if (error) return error;

  try {
    const { id } = await params;
    const { chave, xml } = await xmlDoCte(await empresaDaSessao(), id);
    // Vai como anexo, com `nosniff` e sem cache, como o XML da NF-e.
    return new Response(xml, {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Disposition': `attachment; filename="${nomeDoArquivoDoCte(chave)}"`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (erro) {
    if (erro instanceof Refusal) return NextResponse.json({ error: erro.message }, { status: erro.status });
    console.error('Erro ao baixar o XML do CT-e:', erro instanceof Error ? erro.message : erro);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
