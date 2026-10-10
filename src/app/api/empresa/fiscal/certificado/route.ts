import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import { Refusal } from '@/lib/cadastros';
import { firstIssue } from '@/lib/usuarios';
import { origemDaRequisicao } from '@/lib/auditoria';
import { empresaDaSessao } from '@/lib/cobranca-gateway-db';
import { certificadoSchema } from '@/lib/cte';
import { removerCertificado, salvarCertificado } from '@/lib/cte-db';

/**
 * O certificado digital A1 da empresa da sessão. Só o administrador envia e
 * remove.
 *
 * O arquivo (.pfx/.p12, em base64) e a senha entram por aqui e não saem mais:
 * ficam cifrados no banco, e a resposta traz só o titular, o CNPJ e a validade.
 * Nada do que chega vai para log nem para a auditoria.
 */
export async function PUT(req: Request) {
  const { user, error } = await requireStaff({ pode: 'empresa' });
  if (error) return error;

  const envio = certificadoSchema.safeParse(await req.json().catch(() => null));
  if (!envio.success) return NextResponse.json({ error: firstIssue(envio.error) }, { status: 400 });

  try {
    return NextResponse.json(await salvarCertificado(await empresaDaSessao(), envio.data, { ator: user, origem: origemDaRequisicao(req) }));
  } catch (erro) {
    if (erro instanceof Refusal) return NextResponse.json({ error: erro.message }, { status: erro.status });
    // Só a mensagem: o erro inteiro poderia carregar o que veio no pedido.
    console.error('Erro ao salvar o certificado digital:', erro instanceof Error ? erro.message : erro);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const { user, error } = await requireStaff({ pode: 'empresa' });
  if (error) return error;

  try {
    return NextResponse.json(await removerCertificado(await empresaDaSessao(), { ator: user, origem: origemDaRequisicao(req) }));
  } catch (erro) {
    console.error('Erro ao remover o certificado digital:', erro instanceof Error ? erro.message : erro);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
