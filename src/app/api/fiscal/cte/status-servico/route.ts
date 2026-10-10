import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import { Refusal } from '@/lib/cadastros';
import { empresaDaSessao } from '@/lib/cobranca-gateway-db';
import { statusDoServicoDaEmpresa } from '@/lib/cte-db';

/**
 * Pergunta à SEFAZ (da UF do emitente, no ambiente em uso) se o serviço de
 * CT-e está em operação. Usa o certificado da empresa na conexão; sem ele, ou
 * sem os dados fiscais, responde 409 com o que falta.
 */
export async function GET() {
  const { error } = await requireStaff({ pode: 'fiscalVer' });
  if (error) return error;

  try {
    return NextResponse.json(await statusDoServicoDaEmpresa(await empresaDaSessao()));
  } catch (erro) {
    if (erro instanceof Refusal) return NextResponse.json({ error: erro.message }, { status: erro.status });
    console.error('Erro ao consultar o status do serviço de CT-e:', erro instanceof Error ? erro.message : erro);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
