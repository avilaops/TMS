import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import prisma from '@/lib/prisma';
import { CLIENT_PUBLIC_SELECT, createClientSchema, isUniqueViolation } from '@/lib/cadastros';
import { firstIssue } from '@/lib/usuarios';
import { origemDaRequisicao, registrarAuditoriaDepois } from '@/lib/auditoria';

const DUPLICATE_MESSAGE = 'Já existe um cliente cadastrado com este CNPJ/CPF.';

export async function GET() {
  const { error } = await requireStaff();
  if (error) return error;

  try {
    // Ativos e inativos: a tela mostra o selo e é por ela que se reativa.
    const clientes = await prisma.client.findMany({
      select: CLIENT_PUBLIC_SELECT,
      orderBy: { createdAt: 'desc' }
    });
    return NextResponse.json(clientes);
  } catch (error) {
    console.error('Error fetching clients:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const { user, error } = await requireStaff();
  if (error) return error;

  try {
    const parsed = createClientSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const data = parsed.data;

    // `data.cnpj` já vem só com dígitos: com ou sem máscara é o mesmo cliente.
    const existingClient = await prisma.client.findFirst({
      where: { cnpj: data.cnpj },
      select: { id: true }
    });

    if (existingClient) {
      return NextResponse.json({ error: DUPLICATE_MESSAGE }, { status: 409 });
    }

    // Tabela de frete informada precisa existir nesta empresa.
    if (data.freightTableId) {
      const tabela = await prisma.freightTable.findUnique({ where: { id: data.freightTableId }, select: { id: true } });
      if (!tabela) return NextResponse.json({ error: 'Tabela de frete não encontrada.' }, { status: 400 });
    }

    try {
      const newClient = await prisma.client.create({
        data: {
          cnpj: data.cnpj,
          companyName: data.companyName,
          tradeName: data.tradeName,
          ie: data.ie,
          contactName: data.contactName,
          email: data.email,
          phone: data.phone,
          address: data.address,
          paymentCondition: data.paymentCondition,
          creditLimit: data.creditLimit,
          freightTableId: data.freightTableId,
        },
        select: CLIENT_PUBLIC_SELECT,
      });

      await registrarAuditoriaDepois(prisma, {
        ator: user,
        origem: origemDaRequisicao(req),
        acao: 'cliente.criar',
        entidade: 'cliente',
        entidadeId: newClient.id,
        resumo: `Cliente ${newClient.tradeName || newClient.companyName} criado`,
        depois: newClient,
      });

      return NextResponse.json(newClient, { status: 201 });
    } catch (err) {
      // Duas criações simultâneas com o mesmo CNPJ: a segunda bate no índice único.
      if (isUniqueViolation(err)) {
        return NextResponse.json({ error: DUPLICATE_MESSAGE }, { status: 409 });
      }
      throw err;
    }
  } catch (error) {
    console.error('Error creating client:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
