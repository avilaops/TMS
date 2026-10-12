import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import { origemDaRequisicao } from '@/lib/auditoria';
import { empresaDaSessao } from '@/lib/cobranca-gateway-db';
import { transmitirContingencia } from '@/lib/mdfe-db';
import { respostaDeErro } from '../../../erro';

/**
 * Transmite à SEFAZ um MDF-e emitido em contingência off-line: o mesmo XML,
 * com a mesma chave. O MDF-e só volta "autorizado" com o protocolo que a SEFAZ
 * devolver; rejeitado ou sem resposta, continua "emitido em contingência", com
 * o motivo. MDF-e que não está em contingência responde 409.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireStaff({ pode: 'fiscal' });
  if (error) return error;

  try {
    const { id } = await params;
    return NextResponse.json(await transmitirContingencia(await empresaDaSessao(), id, { ator: user, origem: origemDaRequisicao(req) }));
  } catch (erro) {
    return respostaDeErro(erro, 'transmitir o MDF-e de contingência');
  }
}
