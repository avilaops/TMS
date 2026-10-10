import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireStaff } from '@/lib/staff';
import { isUniqueViolation } from '@/lib/cadastros';
import { firstIssue } from '@/lib/usuarios';
import { POSICAO_REPETIDA, POSICAO_SELECT, createLocationSchema } from '@/lib/deposito';

/** As posições do depósito, as ativas primeiro, com quantos volumes há em cada uma. */
export async function GET() {
  const { error } = await requireStaff({ pode: 'deposito' });
  if (error) return error;

  try {
    const posicoes = await prisma.warehouseLocation.findMany({
      orderBy: [{ active: 'desc' }, { code: 'asc' }],
      select: POSICAO_SELECT,
    });
    return NextResponse.json(posicoes);
  } catch (error) {
    console.error('Erro ao listar posições do depósito:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

/** Cadastra uma posição. O código é único na empresa. */
export async function POST(req: Request) {
  const { error } = await requireStaff({ pode: 'deposito' });
  if (error) return error;

  try {
    const parsed = createLocationSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }

    const posicao = await prisma.warehouseLocation.create({
      data: { code: parsed.data.code, description: parsed.data.description ?? null },
      select: POSICAO_SELECT,
    });
    return NextResponse.json(posicao, { status: 201 });
  } catch (err) {
    if (isUniqueViolation(err)) return NextResponse.json({ error: POSICAO_REPETIDA }, { status: 409 });
    console.error('Erro ao cadastrar posição do depósito:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
