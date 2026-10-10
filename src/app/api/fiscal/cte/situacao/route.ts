import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import { empresaDaSessao } from '@/lib/cobranca-gateway-db';
import { situacaoDaEmissao } from '@/lib/cte-db';

/**
 * A empresa está pronta para emitir CT-e? Diz o ambiente em uso e o que falta
 * (dados fiscais, certificado), para a tela explicar e apontar para Empresa →
 * Fiscal. Não traz dado fiscal nenhum: quem lê o fiscal não é, por isso,
 * administrador da empresa.
 */
export async function GET() {
  const { error } = await requireStaff({ pode: 'fiscalVer' });
  if (error) return error;

  try {
    return NextResponse.json(await situacaoDaEmissao(await empresaDaSessao()));
  } catch (erro) {
    console.error('Erro ao ler a situação da emissão de CT-e:', erro instanceof Error ? erro.message : erro);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
