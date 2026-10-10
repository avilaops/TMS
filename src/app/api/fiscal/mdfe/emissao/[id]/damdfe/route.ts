import { requireStaff } from '@/lib/staff';
import { empresaDaSessao } from '@/lib/cobranca-gateway-db';
import { respostaDoDamdfe } from '@/lib/fiscal-mcp';
import { damdfeDoMdfe } from '@/lib/mdfe-db';
import { respostaDeErro } from '../../../erro';

/**
 * O DAMDFE (PDF) de um MDF-e AUTORIZADO (ou já encerrado), gerado na hora pelo
 * serviço fiscal (ferramenta `gerar_damdfe`) a partir do arquivo guardado
 * (mdfeProc). Quem baixa o XML baixa o DAMDFE: a mesma capacidade. MDF-e sem
 * autorização (rascunho, rejeitado) e MDF-e cancelado não têm DAMDFE: 409.
 *
 * Nada é gravado. Sem `FISCAL_MCP_URL` a rota responde 503; serviço fora do ar,
 * XML recusado ou protocolo não reconhecido pelo serviço, 502; demora, 504. O
 * arquivo de homologação leva no nome que não tem valor fiscal.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireStaff({ pode: 'fiscalVer' });
  if (error) return error;

  try {
    const { id } = await params;
    const { chave, xml, homologacao } = await damdfeDoMdfe(await empresaDaSessao(), id);
    return await respostaDoDamdfe(chave, xml, homologacao);
  } catch (erro) {
    return respostaDeErro(erro, 'gerar o DAMDFE');
  }
}
