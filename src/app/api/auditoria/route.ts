import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import prisma from '@/lib/prisma';
import { firstIssue } from '@/lib/usuarios';
import { AUDIT_SELECT, TAMANHO_DA_PAGINA, filtroDeAuditoria, filtrosDeAuditoriaSchema } from '@/lib/auditoria';

/**
 * A trilha de auditoria da empresa, da ação mais recente para a mais antiga.
 * Só o administrador, e só leitura: não existe rota que altere ou apague linha.
 *
 * Filtros na query, todos opcionais: `de`/`ate` (AAAA-MM-DD, dias do Brasil),
 * `usuario` (id), `acao` (ex. `fatura.pagar`), `entidade` (ex. `fatura`) e
 * `id` (o da entidade, inteiro ou só o começo).
 *
 * Uma página por vez: `proximo` é o cursor da página seguinte (`?cursor=`), ou
 * `null` quando acabou.
 */
export async function GET(req: Request) {
  const { error } = await requireStaff({ pode: 'auditoria' });
  if (error) return error;

  try {
    const parsed = filtrosDeAuditoriaSchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const { cursor, ...filtros } = parsed.data;

    // Uma linha a mais do que a página: é ela que diz se há página seguinte.
    const linhas = await prisma.auditLog.findMany({
      where: filtroDeAuditoria(filtros),
      // O id desempata as linhas gravadas no mesmo instante: sem ele a página seguinte poderia repetir ou pular uma.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: TAMANHO_DA_PAGINA + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: AUDIT_SELECT,
    });

    const registros = linhas.slice(0, TAMANHO_DA_PAGINA);
    const proximo = linhas.length > TAMANHO_DA_PAGINA ? registros[registros.length - 1].id : null;
    return NextResponse.json({ registros, proximo });
  } catch (error) {
    console.error('Erro ao ler a auditoria:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
