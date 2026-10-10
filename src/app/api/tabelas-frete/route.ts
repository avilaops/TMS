import { NextResponse } from 'next/server';
import prisma, { transacao } from '@/lib/prisma';
import { requireStaff } from '@/lib/staff';
import { FREIGHT_TABLE_SELECT, createFreightTableSchema, isUniqueViolation } from '@/lib/cadastros';
import { firstIssue } from '@/lib/usuarios';
import { origemDaRequisicao, registrarAuditoria } from '@/lib/auditoria';

const DUPLICATE_MESSAGE = 'Já existe uma tabela de frete com este nome.';

export async function GET() {
  const { error } = await requireStaff();
  if (error) return error;

  try {
    const tabelas = await prisma.freightTable.findMany({
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      select: FREIGHT_TABLE_SELECT,
    });
    return NextResponse.json(tabelas);
  } catch (error) {
    console.error('Erro ao listar tabelas de frete:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// Preço é decisão de quem administra a transportadora: criar e alterar tabela é só ADMIN.
export async function POST(req: Request) {
  const { user, error } = await requireStaff(['ADMIN']);
  if (error) return error;

  try {
    const parsed = createFreightTableSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const { isDefault, ...data } = parsed.data;

    const existing = await prisma.freightTable.findFirst({ where: { name: data.name }, select: { id: true } });
    if (existing) return NextResponse.json({ error: DUPLICATE_MESSAGE }, { status: 409 });

    const origem = origemDaRequisicao(req);
    try {
      const tabela = await transacao(async (tx) => {
        // Só uma padrão por empresa: a nova toma o lugar da anterior na mesma transação.
        if (isDefault) await tx.freightTable.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
        const criada = await tx.freightTable.create({ data: { ...data, isDefault: isDefault ?? false }, select: FREIGHT_TABLE_SELECT });
        await registrarAuditoria(tx, {
          ator: user,
          origem,
          acao: 'tabela-frete.criar',
          entidade: 'tabela-frete',
          entidadeId: criada.id,
          resumo: `Tabela de frete ${criada.name} criada`,
          depois: criada,
        });
        return criada;
      });
      return NextResponse.json(tabela, { status: 201 });
    } catch (err) {
      if (isUniqueViolation(err)) return NextResponse.json({ error: DUPLICATE_MESSAGE }, { status: 409 });
      throw err;
    }
  } catch (error) {
    console.error('Erro ao criar tabela de frete:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
