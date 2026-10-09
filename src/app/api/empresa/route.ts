import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import prisma, { empresaAtual, sistema } from '@/lib/prisma';
import { identidadeSchema } from '@/lib/empresa';

const IDENTIDADE = { name: true, logo: true } as const;

/** Nome e símbolo da empresa da sessão, para o cabeçalho do painel. */
export async function GET() {
  const { error } = await requireStaff();
  if (error) return error;

  try {
    // A empresa só lê o próprio cadastro (prisma/sql/010-rls.sql).
    const empresa = await prisma.tenant.findUnique({ where: { id: await empresaAtual() }, select: IDENTIDADE });
    if (!empresa) return NextResponse.json({ error: 'Empresa não encontrada.' }, { status: 404 });
    return NextResponse.json(empresa);
  } catch (error) {
    console.error('Erro ao ler a identidade da empresa:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

/** Troca o nome e o símbolo da empresa da sessão. Só o administrador. */
export async function PATCH(req: Request) {
  const { error } = await requireStaff(["ADMIN"]);
  if (error) return error;

  const dados = identidadeSchema.safeParse(await req.json().catch(() => null));
  if (!dados.success) {
    return NextResponse.json({ error: dados.error.issues[0]?.message ?? 'Dados inválidos.' }, { status: 400 });
  }

  try {
    // O papel da aplicação só lê a tabela de empresas. A gravação vai pelo
    // dono do banco, presa ao id da empresa da sessão: nunca ao que veio no corpo.
    const empresa = await sistema.tenant.update({
      where: { id: await empresaAtual() },
      data: dados.data,
      select: IDENTIDADE,
    });
    return NextResponse.json(empresa);
  } catch (error) {
    console.error('Erro ao alterar a identidade da empresa:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
