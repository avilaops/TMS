import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import { firstIssue } from '@/lib/usuarios';
import { origemDaRequisicao } from '@/lib/auditoria';
import { empresaDaSessao } from '@/lib/cobranca-gateway-db';
import { configuracaoSchema } from '@/lib/mdfe';
import { configuracaoDoMdfe, salvarConfiguracao } from '@/lib/mdfe-db';
import { respostaDeErro } from '../erro';

/**
 * A configuração do MDF-e da empresa (Notas fiscais → MDF-e → Configuração): série,
 * próximo número, tipo de emitente e o seguro da carga que vale por padrão. Só
 * o administrador lê e altera, como os outros dados fiscais.
 */
export async function GET() {
  const { error } = await requireStaff({ pode: 'empresa' });
  if (error) return error;

  try {
    return NextResponse.json(await configuracaoDoMdfe(await empresaDaSessao()));
  } catch (erro) {
    return respostaDeErro(erro, 'ler a configuração do MDF-e');
  }
}

export async function PUT(req: Request) {
  const { user, error } = await requireStaff({ pode: 'empresa' });
  if (error) return error;

  const dados = configuracaoSchema.safeParse(await req.json().catch(() => null));
  if (!dados.success) return NextResponse.json({ error: firstIssue(dados.error) }, { status: 400 });

  try {
    return NextResponse.json(await salvarConfiguracao(await empresaDaSessao(), dados.data, { ator: user, origem: origemDaRequisicao(req) }));
  } catch (erro) {
    return respostaDeErro(erro, 'salvar a configuração do MDF-e');
  }
}
