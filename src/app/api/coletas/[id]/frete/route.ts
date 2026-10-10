import { NextResponse } from 'next/server';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { requireStaff } from '@/lib/staff';
import { firstIssue } from '@/lib/usuarios';
import { origemDaRequisicao, registrarAuditoriaDepois } from '@/lib/auditoria';

const MESSAGE = 'O frete precisa ser um número maior ou igual a zero.';

const schema = z.object(
  {
    freightValue: z.preprocess(
      (value) => (typeof value === 'string' ? Number(value.trim().replace(',', '.') || NaN) : value),
      z.number(MESSAGE).min(0, MESSAGE),
    ),
  },
  'Dados inválidos.',
);

/**
 * Informa o frete de uma carga à mão, em qualquer status.
 *
 * A edição da coleta trava depois que a carga embarca; este caminho existe
 * para a carga que foi entregue "a cotar" e precisa de valor para entrar em
 * fatura, e para acertar um valor antes de faturar. Depois de faturada, o
 * frete não muda mais: a fatura já saiu com ele.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireStaff();
  if (error) return error;

  try {
    const { id } = await params;
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }

    // O frete como estava: é o "antes" da auditoria.
    const anterior = await prisma.collection.findUnique({
      where: { id },
      select: { trackingCode: true, freightValue: true, freightManual: true },
    });

    const { count } = await prisma.collection.updateMany({
      where: { id, invoiceId: null },
      data: {
        freightValue: parsed.data.freightValue,
        freightManual: true,
        freightDeadlineHours: null,
        freightTableId: null,
      },
    });

    if (count === 0) {
      const existe = await prisma.collection.findUnique({ where: { id }, select: { id: true } });
      return existe
        ? NextResponse.json({ error: 'Esta carga já está em uma fatura. Cancele a fatura para mudar o frete.' }, { status: 409 })
        : NextResponse.json({ error: 'Coleta não encontrada.' }, { status: 404 });
    }

    await registrarAuditoriaDepois(prisma, {
      ator: user,
      origem: origemDaRequisicao(req),
      acao: 'coleta.frete',
      entidade: 'coleta',
      entidadeId: id,
      resumo: `Frete da carga ${anterior?.trackingCode ?? ''} informado à mão`,
      antes: { freightValue: anterior?.freightValue ?? null, freightManual: anterior?.freightManual ?? null },
      depois: { freightValue: parsed.data.freightValue, freightManual: true },
    });

    return NextResponse.json({ id, freightValue: parsed.data.freightValue, freightManual: true });
  } catch (error) {
    console.error('Erro ao informar frete:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
