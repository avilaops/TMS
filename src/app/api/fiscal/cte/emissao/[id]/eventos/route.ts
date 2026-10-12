import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import { Refusal } from '@/lib/cadastros';
import { empresaDaSessao } from '@/lib/cobranca-gateway-db';
import { eventosDoCte } from '@/lib/cte-db';

/**
 * Os eventos que a SEFAZ registrou para o CT-e (cartas de correção,
 * cancelamento, comprovante de entrega) e a situação do comprovante de entrega:
 * se já há um registrado, se dá para registrar e, quando não dá, por quê. Nada
 * é enviado. Sem XML, sem documento de quem recebeu e sem imagem.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireStaff({ pode: 'fiscalVer' });
  if (error) return error;

  try {
    const { id } = await params;
    return NextResponse.json(await eventosDoCte(await empresaDaSessao(), id));
  } catch (erro) {
    if (erro instanceof Refusal) return NextResponse.json({ error: erro.message }, { status: erro.status });
    console.error('Erro ao ler os eventos do CT-e:', erro instanceof Error ? erro.message : erro);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
