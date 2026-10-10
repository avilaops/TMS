import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import { empresaDaSessao } from '@/lib/cobranca-gateway-db';
import { situacaoDaEmissao } from '@/lib/mdfe-db';
import { respostaDeErro } from '../erro';

/**
 * A empresa está pronta para emitir MDF-e? Diz o ambiente em uso, o tipo de
 * emitente e o que falta (dados fiscais, certificado), para a tela explicar e
 * apontar para Empresa → Fiscal. Não traz dado fiscal nenhum.
 */
export async function GET() {
  const { error } = await requireStaff({ pode: 'fiscalVer' });
  if (error) return error;

  try {
    return NextResponse.json(await situacaoDaEmissao(await empresaDaSessao()));
  } catch (erro) {
    return respostaDeErro(erro, 'ler a situação da emissão de MDF-e');
  }
}
