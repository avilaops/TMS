import { NextResponse } from 'next/server';
import prisma, { empresaAtual, sistema } from '@/lib/prisma';
import { requireUsuario } from '@/lib/usuario-logado';
import { firstIssue } from '@/lib/usuarios';
import { aparelhoSchema, desinscreverSchema } from '@/lib/notificacoes';
import { chavePublicaDoPush } from '@/lib/notificacoes-push';
import { origemDaRequisicao } from '@/lib/auditoria';

const PUSH_DESLIGADO = 'As notificações por push não estão ligadas neste sistema.';

/**
 * Inscreve este aparelho (navegador) para receber por push os avisos de quem
 * está logado. Repetir a mesma inscrição só atualiza as chaves.
 */
export async function POST(req: Request) {
  const { userId, error } = await requireUsuario();
  if (error) return error;

  try {
    if (!chavePublicaDoPush()) return NextResponse.json({ error: PUSH_DESLIGADO }, { status: 409 });

    const parsed = aparelhoSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const { endpoint, keys } = parsed.data;
    const userAgent = origemDaRequisicao(req).dispositivo;

    // Um aparelho recebe os avisos de uma pessoa só. O endereço é do navegador
    // e é o mesmo para quem entrar nele depois, em qualquer empresa: a
    // inscrição que estava com outra pessoa (ou em outra empresa) sai antes de
    // esta entrar. Vai pelo dono do banco porque a empresa da sessão não
    // enxerga a linha da outra; só quem tem o aparelho conhece o endereço.
    const tenantId = await empresaAtual();
    await sistema.pushSubscription.deleteMany({ where: { endpoint, NOT: { tenantId, userId } } });

    await prisma.pushSubscription.upsert({
      where: { endpoint },
      create: { userId, endpoint, p256dh: keys.p256dh, auth: keys.auth, userAgent },
      update: { p256dh: keys.p256dh, auth: keys.auth, userAgent },
      select: { id: true },
    });
    return NextResponse.json({ ativo: true }, { status: 201 });
  } catch (err) {
    console.error('Erro ao inscrever o aparelho:', err);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

/**
 * Desliga o push neste aparelho: apaga a inscrição, se ela for de quem está
 * logado. Inscrição de outra pessoa fica como está, e a resposta é a mesma.
 */
export async function DELETE(req: Request) {
  const { userId, error } = await requireUsuario();
  if (error) return error;

  try {
    const parsed = desinscreverSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    await prisma.pushSubscription.deleteMany({ where: { endpoint: parsed.data.endpoint, userId } });
    return NextResponse.json({ ativo: false });
  } catch (err) {
    console.error('Erro ao desinscrever o aparelho:', err);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
