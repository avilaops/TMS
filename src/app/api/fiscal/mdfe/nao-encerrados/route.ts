import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import { empresaDaSessao } from '@/lib/cobranca-gateway-db';
import { naoEncerradosDaEmpresa } from '@/lib/mdfe-db';
import { respostaDeErro } from '../erro';

/**
 * Os MDF-e do emitente que a SEFAZ tem como autorizados e NÃO encerrados
 * (serviço MDFeConsNaoEnc), com o registro daqui de cada um, quando foi este
 * sistema que emitiu. É a mesma consulta que a emissão faz antes de enviar: a
 * SEFAZ rejeita MDF-e novo da mesma placa e UF com outro em aberto.
 */
export async function GET() {
  const { error } = await requireStaff({ pode: 'fiscalVer' });
  if (error) return error;

  try {
    return NextResponse.json(await naoEncerradosDaEmpresa(await empresaDaSessao()));
  } catch (erro) {
    return respostaDeErro(erro, 'consultar os MDF-e não encerrados');
  }
}
