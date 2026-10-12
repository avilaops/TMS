import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import { firstIssue } from '@/lib/usuarios';
import { origemDaRequisicao } from '@/lib/auditoria';
import { empresaDaSessao } from '@/lib/cobranca-gateway-db';
import { alteracaoDoPagamentoSchema, pagamentoDaOperacaoSchema } from '@/lib/mdfe';
import { alterarPagamento, informarPagamento } from '@/lib/mdfe-db';
import { respostaDeErro } from '../../../erro';

/**
 * Os eventos de pagamento do frete de um MDF-e autorizado (ou já encerrado).
 * O evento só existe para este sistema quando a SEFAZ o registra.
 *
 * `POST { viagens: { quantidade, numero }, pagamento }`: pagamento da operação
 * de transporte (evento 110116). É o pagamento do TAC agregado informado depois
 * da emissão, no fim do período; um por MDF-e. MDF-e cujo veículo de tração não
 * é de TAC agregado responde 409, sem enviar (a SEFAZ rejeitaria: 723).
 *
 * `PUT { pagamento }`: alteração do pagamento do serviço de transporte (evento
 * 110118), com os novos dados; até 99 por MDF-e.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireStaff({ pode: 'fiscal' });
  if (error) return error;

  const dados = pagamentoDaOperacaoSchema.safeParse(await req.json().catch(() => null));
  if (!dados.success) return NextResponse.json({ error: firstIssue(dados.error) }, { status: 400 });

  try {
    const { id } = await params;
    return NextResponse.json(await informarPagamento(await empresaDaSessao(), id, dados.data, { ator: user, origem: origemDaRequisicao(req) }));
  } catch (erro) {
    return respostaDeErro(erro, 'informar o pagamento no MDF-e');
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireStaff({ pode: 'fiscal' });
  if (error) return error;

  const dados = alteracaoDoPagamentoSchema.safeParse(await req.json().catch(() => null));
  if (!dados.success) return NextResponse.json({ error: firstIssue(dados.error) }, { status: 400 });

  try {
    const { id } = await params;
    return NextResponse.json(await alterarPagamento(await empresaDaSessao(), id, dados.data, { ator: user, origem: origemDaRequisicao(req) }));
  } catch (erro) {
    return respostaDeErro(erro, 'alterar o pagamento no MDF-e');
  }
}
