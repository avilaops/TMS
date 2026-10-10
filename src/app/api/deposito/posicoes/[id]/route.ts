import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireStaff } from '@/lib/staff';
import { isUniqueViolation } from '@/lib/cadastros';
import { firstIssue } from '@/lib/usuarios';
import { POSICAO_REPETIDA, POSICAO_SELECT, updateLocationSchema } from '@/lib/deposito';
import { nadaMudou, origemDaRequisicao, registrarAuditoriaDepois } from '@/lib/auditoria';

const NOT_FOUND = 'Posição não encontrada.';

/**
 * Altera código, descrição ou a situação (ativa ou não) de uma posição.
 * Desativar não tira os volumes de lá: só impede alocar volume novo nela.
 * Posição não é apagada, para o volume que passou por ela não perder o lugar.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireStaff({ pode: 'deposito' });
  if (error) return error;

  try {
    const { id } = await params;
    const parsed = updateLocationSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }

    // Como estava, para a auditoria. Posição que não existe segue adiante e cai no 404 de sempre.
    const antes = await prisma.warehouseLocation.findFirst({ where: { id }, select: { code: true, description: true, active: true } });

    // `updateMany` porque a posição de outra empresa não existe para esta: zero linhas, 404.
    const { count } = await prisma.warehouseLocation.updateMany({ where: { id }, data: parsed.data });
    if (count === 0) return NextResponse.json({ error: NOT_FOUND }, { status: 404 });

    const posicao = await prisma.warehouseLocation.findUnique({ where: { id }, select: POSICAO_SELECT });

    if (antes && posicao) {
      const depois = { code: posicao.code, description: posicao.description, active: posicao.active };
      if (!nadaMudou(antes, depois)) {
        await registrarAuditoriaDepois(prisma, {
          ator: user,
          origem: origemDaRequisicao(req),
          acao: 'posicao.alterar',
          entidade: 'posicao',
          entidadeId: id,
          resumo: `Posição ${posicao.code} do depósito alterada`,
          antes,
          depois,
        });
      }
    }

    return NextResponse.json(posicao);
  } catch (err) {
    if (isUniqueViolation(err)) return NextResponse.json({ error: POSICAO_REPETIDA }, { status: 409 });
    console.error('Erro ao alterar posição do depósito:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
