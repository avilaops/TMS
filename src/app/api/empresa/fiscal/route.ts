import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import { Refusal } from '@/lib/cadastros';
import { firstIssue } from '@/lib/usuarios';
import { origemDaRequisicao } from '@/lib/auditoria';
import { empresaDaSessao } from '@/lib/cobranca-gateway-db';
import { dadosFiscaisSchema } from '@/lib/cte';
import { fiscalDaEmpresa, salvarDadosFiscais } from '@/lib/cte-db';

/**
 * Os dados fiscais do emitente de CT-e da empresa da sessão (Empresa → Fiscal).
 * Só o administrador lê e altera.
 *
 * A leitura traz também o certificado A1, mas só o que a tela mostra: titular,
 * CNPJ e validade. O arquivo e a senha entram por
 * /api/empresa/fiscal/certificado e não saem mais.
 */
export async function GET() {
  const { error } = await requireStaff({ pode: 'empresa' });
  if (error) return error;

  try {
    return NextResponse.json(await fiscalDaEmpresa(await empresaDaSessao()));
  } catch (erro) {
    console.error('Erro ao ler os dados fiscais:', erro instanceof Error ? erro.message : erro);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const { user, error } = await requireStaff({ pode: 'empresa' });
  if (error) return error;

  const dados = dadosFiscaisSchema.safeParse(await req.json().catch(() => null));
  if (!dados.success) return NextResponse.json({ error: firstIssue(dados.error) }, { status: 400 });

  try {
    return NextResponse.json(await salvarDadosFiscais(await empresaDaSessao(), dados.data, { ator: user, origem: origemDaRequisicao(req) }));
  } catch (erro) {
    if (erro instanceof Refusal) return NextResponse.json({ error: erro.message }, { status: erro.status });
    console.error('Erro ao salvar os dados fiscais:', erro instanceof Error ? erro.message : erro);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
