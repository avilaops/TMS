import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import prisma from '@/lib/prisma';
import { CLIENT_PUBLIC_SELECT, isUniqueViolation, updateClientSchema } from '@/lib/cadastros';
import { firstIssue } from '@/lib/usuarios';
import { nadaMudou, origemDaRequisicao, registrarAuditoriaDepois } from '@/lib/auditoria';

const DUPLICATE_MESSAGE = 'Já existe outro cliente cadastrado com este CNPJ/CPF.';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireStaff();
  if (error) return error;

  try {
    const { id } = await params;

    const parsed = updateClientSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const data = parsed.data;

    // O cadastro como estava: é o "antes" da auditoria.
    const target = await prisma.client.findUnique({ where: { id }, select: CLIENT_PUBLIC_SELECT });
    if (!target) {
      return NextResponse.json({ error: 'Cliente não encontrado.' }, { status: 404 });
    }

    if (data.cnpj !== undefined) {
      const other = await prisma.client.findFirst({
        where: { cnpj: data.cnpj, id: { not: id } },
        select: { id: true }
      });
      if (other) {
        return NextResponse.json({ error: DUPLICATE_MESSAGE }, { status: 409 });
      }
    }

    // Tabela de frete informada precisa existir nesta empresa.
    if (data.freightTableId) {
      const tabela = await prisma.freightTable.findUnique({ where: { id: data.freightTableId }, select: { id: true } });
      if (!tabela) return NextResponse.json({ error: 'Tabela de frete não encontrada.' }, { status: 400 });
    }

    try {
      // Campo ausente (`undefined`) fica como está; `null` apaga.
      const cliente = await prisma.client.update({
        where: { id },
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
          active: data.active,
        },
        select: CLIENT_PUBLIC_SELECT,
      });

      if (!nadaMudou(target, cliente)) {
        const nome = cliente.tradeName || cliente.companyName;
        const desativou = target.active && !cliente.active;
        const reativou = !target.active && cliente.active;
        await registrarAuditoriaDepois(prisma, {
          ator: user,
          origem: origemDaRequisicao(req),
          acao: desativou ? 'cliente.desativar' : reativou ? 'cliente.reativar' : 'cliente.alterar',
          entidade: 'cliente',
          entidadeId: id,
          resumo: `Cliente ${nome} ${desativou ? 'desativado' : reativou ? 'reativado' : 'alterado'}`,
          antes: target,
          depois: cliente,
        });
      }

      return NextResponse.json(cliente);
    } catch (err) {
      if (isUniqueViolation(err)) {
        return NextResponse.json({ error: DUPLICATE_MESSAGE }, { status: 409 });
      }
      throw err;
    }
  } catch (error) {
    console.error('Error updating client:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
