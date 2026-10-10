import { NextResponse } from 'next/server';
import { requireUsuario } from '@/lib/usuario-logado';
import { chavePublicaDoPush } from '@/lib/notificacoes-push';

/**
 * A chave pública com que o navegador se inscreve para receber push. Sem as
 * variáveis `VAPID_*` no servidor o push está desligado: `ativo` vem falso e
 * o sininho segue funcionando sem o botão de ativar.
 */
export async function GET() {
  const { error } = await requireUsuario();
  if (error) return error;

  const chave = chavePublicaDoPush();
  return NextResponse.json({ ativo: chave !== null, chave });
}
