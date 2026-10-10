import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import { firstIssue } from '@/lib/usuarios';
import { empresaDaSessao } from '@/lib/cobranca-gateway-db';
import { emitirSchema } from '@/lib/mdfe';
import { conferirMdfe } from '@/lib/mdfe-db';
import { respostaDeErro } from '../erro';

/**
 * "Conferir": o que vai no MDF-e de uma UF de descarregamento da viagem com o
 * que a pessoa informou no formulário (percurso, CIOT, seguro...), e o que
 * ainda falta. É um POST porque leva o formulário; nada é enviado à SEFAZ nem
 * gravado.
 */
export async function POST(req: Request) {
  const { error } = await requireStaff({ pode: 'fiscalVer' });
  if (error) return error;

  const dados = emitirSchema.safeParse(await req.json().catch(() => null));
  if (!dados.success) return NextResponse.json({ error: firstIssue(dados.error) }, { status: 400 });

  try {
    return NextResponse.json(await conferirMdfe(await empresaDaSessao(), dados.data.manifestId, dados.data.ufDeDescarga, dados.data.entradas));
  } catch (erro) {
    return respostaDeErro(erro, 'conferir o MDF-e');
  }
}
