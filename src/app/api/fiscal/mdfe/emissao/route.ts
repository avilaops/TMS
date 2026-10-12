import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import { firstIssue } from '@/lib/usuarios';
import { origemDaRequisicao } from '@/lib/auditoria';
import { empresaDaSessao } from '@/lib/cobranca-gateway-db';
import { emitirSchema, viagemSchema } from '@/lib/mdfe';
import { emitirMdfe, mdfesDaViagem } from '@/lib/mdfe-db';
import { respostaDeErro } from '../erro';

/**
 * Emissão de MDF-e pela SEFAZ (modelo 58, modal rodoviário).
 *
 * `GET ?manifestId=`: a aba "MDF-e" da viagem. Uma conferência por UF de
 * descarregamento (o que vai no documento, o que falta, o MDF-e que ela já
 * tem). Nada é enviado.
 *
 * `POST { manifestId, ufDeDescarga, entradas }`: consulta os não encerrados,
 * monta, assina e transmite. A resposta traz o MDF-e como ficou e a mensagem da
 * SEFAZ; ele só volta "autorizado" com o protocolo que a SEFAZ devolveu. Falha
 * de rede é 502 ou 504, com a frase do que fazer.
 *
 * `POST { ..., contingencia: true }`: emissão em contingência off-line, pedida
 * de forma explícita por quem emite quando não se consegue a autorização. Nada
 * é transmitido: o MDF-e volta "CONTINGENCY" (emitido, sem protocolo, a
 * transmitir em até 168 horas por `POST .../emissao/[id]/transmitir`). É
 * recusada (409) quando a SEFAZ responde que o serviço está em operação.
 */
export async function GET(req: Request) {
  const { error } = await requireStaff({ pode: 'fiscalVer' });
  if (error) return error;

  const dados = viagemSchema.safeParse({ manifestId: new URL(req.url).searchParams.get('manifestId') });
  if (!dados.success) return NextResponse.json({ error: firstIssue(dados.error) }, { status: 400 });

  try {
    return NextResponse.json(await mdfesDaViagem(await empresaDaSessao(), dados.data.manifestId));
  } catch (erro) {
    return respostaDeErro(erro, 'conferir os MDF-e da viagem');
  }
}

export async function POST(req: Request) {
  const { user, error } = await requireStaff({ pode: 'fiscal' });
  if (error) return error;

  const dados = emitirSchema.safeParse(await req.json().catch(() => null));
  if (!dados.success) return NextResponse.json({ error: firstIssue(dados.error) }, { status: 400 });

  try {
    const { manifestId, ufDeDescarga, entradas, contingencia } = dados.data;
    return NextResponse.json(await emitirMdfe(await empresaDaSessao(), manifestId, ufDeDescarga, entradas, { ator: user, origem: origemDaRequisicao(req) }, { contingencia: contingencia === true }));
  } catch (erro) {
    return respostaDeErro(erro, 'emitir o MDF-e');
  }
}
