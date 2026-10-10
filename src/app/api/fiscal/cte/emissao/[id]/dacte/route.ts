import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import { Refusal } from '@/lib/cadastros';
import { empresaDaSessao } from '@/lib/cobranca-gateway-db';
import { dacteDoCte } from '@/lib/cte-db';
import { respostaDoDacte } from '@/lib/fiscal-mcp';

/**
 * O DACTE (PDF) de um CT-e AUTORIZADO, gerado na hora pelo serviço fiscal a
 * partir do arquivo guardado (cteProc). Quem baixa o XML baixa o DACTE: a mesma
 * capacidade. CT-e sem autorização (rascunho, rejeitado) e CT-e cancelado não
 * têm DACTE: 409.
 *
 * Nada é gravado: o PDF não fica no banco. Sem `FISCAL_MCP_URL` a rota
 * responde 503; serviço fora do ar, XML recusado ou protocolo não reconhecido
 * pelo serviço, 502; demora, 504. O arquivo de homologação leva no nome que não
 * tem valor fiscal.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireStaff({ pode: 'fiscalVer' });
  if (error) return error;

  try {
    const { id } = await params;
    const { chave, xml, homologacao } = await dacteDoCte(await empresaDaSessao(), id);
    return await respostaDoDacte(chave, xml, homologacao);
  } catch (erro) {
    if (erro instanceof Refusal) return NextResponse.json({ error: erro.message }, { status: erro.status });
    console.error('Erro ao gerar o DACTE:', erro instanceof Error ? erro.message : erro);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
