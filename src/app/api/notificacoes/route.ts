import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireUsuario } from '@/lib/usuario-logado';
import { firstIssue } from '@/lib/usuarios';
import { AVISOS_POR_PAGINA, AVISO_SELECT, paginaDeAvisosSchema } from '@/lib/notificacoes';

/**
 * Os avisos de quem está logado (o sininho), do mais novo para o mais antigo,
 * com o total de não lidos. Qualquer perfil lê, e só os próprios: o filtro
 * pelo usuário da sessão é o que separa uma pessoa da outra.
 *
 * Uma página por vez: `proximo` é o cursor da página seguinte (`?cursor=`), ou
 * `null` quando acabou.
 */
export async function GET(req: Request) {
  const { userId, error } = await requireUsuario();
  if (error) return error;

  try {
    const parsed = paginaDeAvisosSchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const { cursor } = parsed.data;

    // O cursor só vale se for um aviso da própria pessoa.
    if (cursor && !(await prisma.notification.findFirst({ where: { id: cursor, userId }, select: { id: true } }))) {
      return NextResponse.json({ error: 'Dados inválidos.' }, { status: 400 });
    }

    // Uma linha a mais do que a página: é ela que diz se há página seguinte.
    const linhas = await prisma.notification.findMany({
      where: { userId },
      // O id desempata os avisos gravados no mesmo instante.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: AVISOS_POR_PAGINA + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: AVISO_SELECT,
    });
    const naoLidos = await prisma.notification.count({ where: { userId, readAt: null } });

    const avisos = linhas.slice(0, AVISOS_POR_PAGINA);
    const proximo = linhas.length > AVISOS_POR_PAGINA ? avisos[avisos.length - 1].id : null;
    return NextResponse.json({ avisos, naoLidos, proximo });
  } catch (err) {
    console.error('Erro ao ler os avisos:', err);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
