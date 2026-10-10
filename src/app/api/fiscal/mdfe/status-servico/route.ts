import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import { empresaDaSessao } from '@/lib/cobranca-gateway-db';
import { statusDoServicoDaEmpresa } from '@/lib/mdfe-db';
import { respostaDeErro } from '../erro';

/**
 * Pergunta à SVRS (o autorizador nacional do MDF-e), no ambiente em uso, se o
 * serviço está em operação. Usa o certificado da empresa na conexão; sem ele,
 * ou sem os dados fiscais, responde 409 com o que falta.
 */
export async function GET() {
  const { error } = await requireStaff({ pode: 'fiscalVer' });
  if (error) return error;

  try {
    return NextResponse.json(await statusDoServicoDaEmpresa(await empresaDaSessao()));
  } catch (erro) {
    return respostaDeErro(erro, 'consultar o status do serviço de MDF-e');
  }
}
