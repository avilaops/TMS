import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import { empresaDaSessao } from '@/lib/cobranca-gateway-db';
import { listarMdfes } from '@/lib/mdfe-db';
import { respostaDeErro } from './erro';

/**
 * Os MDF-e emitidos pela empresa, do mais recente para o mais antigo (até 200),
 * com a situação de cada um e os eventos registrados. `?manifestId=` traz só os
 * de uma viagem. Sem XML.
 */
export async function GET(req: Request) {
  const { error } = await requireStaff({ pode: 'fiscalVer' });
  if (error) return error;

  try {
    const manifestId = new URL(req.url).searchParams.get('manifestId')?.trim().slice(0, 64) || null;
    return NextResponse.json(await listarMdfes(await empresaDaSessao(), manifestId));
  } catch (erro) {
    return respostaDeErro(erro, 'listar os MDF-e');
  }
}
