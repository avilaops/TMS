import { requireStaff } from '@/lib/staff';
import { empresaDaSessao } from '@/lib/cobranca-gateway-db';
import { nomeDoArquivoDoMdfe } from '@/lib/mdfe';
import { xmlDoMdfe } from '@/lib/mdfe-db';
import { respostaDeErro } from '../../../erro';

/** O arquivo do MDF-e autorizado (mdfeProc: o MDF-e assinado e o protocolo da SEFAZ), para baixar. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireStaff({ pode: 'fiscalVer' });
  if (error) return error;

  try {
    const { id } = await params;
    const { chave, xml } = await xmlDoMdfe(await empresaDaSessao(), id);
    // Vai como anexo, com `nosniff` e sem cache, como o XML da NF-e e do CT-e.
    return new Response(xml, {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Disposition': `attachment; filename="${nomeDoArquivoDoMdfe(chave)}"`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (erro) {
    return respostaDeErro(erro, 'baixar o XML do MDF-e');
  }
}
