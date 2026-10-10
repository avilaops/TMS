import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireUsuario } from '@/lib/usuario-logado';
import { firstIssue } from '@/lib/usuarios';
import { lidasSchema } from '@/lib/notificacoes';

/**
 * Marca avisos como lidos: `{ ids: [...] }` (um ou vários) ou `{ todas: true }`.
 * Só os avisos de quem está logado mudam; id de aviso de outra pessoa não
 * marca nada e não vira erro. Devolve quantos faltam ler.
 */
export async function POST(req: Request) {
  const { userId, error } = await requireUsuario();
  if (error) return error;

  try {
    const parsed = lidasSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }

    const { count } = await prisma.notification.updateMany({
      where: { userId, readAt: null, ...('ids' in parsed.data ? { id: { in: parsed.data.ids } } : {}) },
      data: { readAt: new Date() },
    });
    const naoLidos = await prisma.notification.count({ where: { userId, readAt: null } });
    return NextResponse.json({ marcados: count, naoLidos });
  } catch (err) {
    console.error('Erro ao marcar avisos como lidos:', err);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
