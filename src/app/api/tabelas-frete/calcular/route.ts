import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireStaff } from '@/lib/staff';
import { simulateFreightSchema } from '@/lib/cadastros';
import { firstIssue } from '@/lib/usuarios';
import { TABELA_PARA_CALCULO, calcularFrete, tabelaVigente } from '@/lib/frete';

/**
 * Simulador do painel: quanto sai um frete para uma cidade.
 *
 * Sem `tableId`, usa a tabela que valeria de verdade (a do cliente informado,
 * ou a padrão). Com `tableId`, calcula naquela tabela mesmo que esteja inativa
 * ou fora da validade: serve para conferir uma tabela antes de colocá-la em uso.
 */
export async function POST(req: Request) {
  const { error } = await requireStaff();
  if (error) return error;

  try {
    const parsed = simulateFreightSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const data = parsed.data;

    const tabela = data.tableId
      ? await prisma.freightTable.findUnique({ where: { id: data.tableId }, select: TABELA_PARA_CALCULO })
      : await tabelaVigente(prisma, data.clientId);

    if (!tabela) {
      return NextResponse.json(
        { error: data.tableId ? 'Tabela de frete não encontrada.' : 'Não há tabela de frete padrão em vigor. Cadastre uma em Tabelas de frete.' },
        { status: 404 },
      );
    }

    const frete = calcularFrete(tabela, data.city, {
      peso: data.weight,
      volumes: data.volumes,
      valorNota: data.invoiceValue,
      metrosCubicos: data.cubicMeters,
    });

    return NextResponse.json({ tabela: { id: tabela.id, name: tabela.name }, frete });
  } catch (error) {
    console.error('Erro ao simular frete:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
