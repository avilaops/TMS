import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import prisma from '@/lib/prisma';
import { firstIssue } from '@/lib/usuarios';
import { EVENTO_SELECT, FILTRO_DA_SITUACAO, TAMANHO_DA_PAGINA, filtrosDeAvisosSchema } from '@/lib/mensageria';

/**
 * Os avisos que o TMS gerou para sistemas de fora, do mais novo para o mais
 * antigo, e o endereço para onde eles vão (`integracao.url`, nulo se a empresa
 * não cadastrou nenhum). Só o administrador.
 *
 * Filtros na query: `tipo` (ex. `coleta.status`) e `situacao` (entregue, fila,
 * falhou ou desistiu). Uma página por vez: `proximo` é o cursor da seguinte.
 */
export async function GET(req: Request) {
  const { error } = await requireStaff({ pode: 'mensageriaVer' });
  if (error) return error;

  try {
    const parsed = filtrosDeAvisosSchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const { tipo, situacao, cursor } = parsed.data;

    const webhook = await prisma.webhook.findFirst({ select: { url: true } });
    // Uma linha a mais do que a página: é ela que diz se há página seguinte.
    const linhas = await prisma.outboxEvent.findMany({
      where: { ...(tipo ? { type: tipo } : {}), ...(situacao ? FILTRO_DA_SITUACAO[situacao] : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: TAMANHO_DA_PAGINA + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: EVENTO_SELECT,
    });

    const eventos = linhas.slice(0, TAMANHO_DA_PAGINA);
    const proximo = linhas.length > TAMANHO_DA_PAGINA ? eventos[eventos.length - 1].id : null;
    return NextResponse.json({ integracao: { url: webhook?.url ?? null }, eventos, proximo });
  } catch (error) {
    console.error('Erro ao listar os avisos:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
