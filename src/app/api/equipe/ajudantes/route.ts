import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import prisma from '@/lib/prisma';
import { isUniqueViolation } from '@/lib/cadastros';
import { firstIssue } from '@/lib/usuarios';
import { CAMPOS_DO_AJUDANTE, HELPER_SELECT, createHelperSchema } from '@/lib/equipe';
import { escolher, origemDaRequisicao, registrarAuditoriaDepois } from '@/lib/auditoria';

const DUPLICATE_CPF = 'Já existe um ajudante com este CPF.';

export async function GET() {
  const { error } = await requireStaff();
  if (error) return error;

  try {
    const ajudantes = await prisma.helper.findMany({ select: HELPER_SELECT, orderBy: { name: 'asc' } });
    return NextResponse.json(ajudantes);
  } catch (error) {
    console.error('Erro ao listar ajudantes:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

/** Cadastra um ajudante. Ele não tem login: é só o registro de quem viaja junto. */
export async function POST(req: Request) {
  const { user, error } = await requireStaff();
  if (error) return error;

  try {
    const parsed = createHelperSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const data = parsed.data;

    const existente = await prisma.helper.findFirst({ where: { cpf: data.cpf }, select: { id: true } });
    if (existente) return NextResponse.json({ error: DUPLICATE_CPF }, { status: 409 });

    let ajudante;
    try {
      ajudante = await prisma.helper.create({
        data: { name: data.name, cpf: data.cpf, phone: data.phone ?? null },
        select: HELPER_SELECT,
      });
    } catch (err) {
      // Dois cadastros ao mesmo tempo: o segundo bate no índice único do CPF.
      if (isUniqueViolation(err)) return NextResponse.json({ error: DUPLICATE_CPF }, { status: 409 });
      throw err;
    }

    await registrarAuditoriaDepois(prisma, {
      ator: user,
      origem: origemDaRequisicao(req),
      acao: 'ajudante.criar',
      entidade: 'ajudante',
      entidadeId: ajudante.id,
      resumo: `Ajudante ${ajudante.name} criado`,
      depois: escolher(ajudante, CAMPOS_DO_AJUDANTE),
    });

    return NextResponse.json(ajudante, { status: 201 });
  } catch (error) {
    console.error('Erro ao criar ajudante:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
