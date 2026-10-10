import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import prisma from '@/lib/prisma';
import { limitesDoPeriodo, montarRelatorio, periodoDoRelatorio } from '@/lib/relatorios';

/**
 * Relatórios básicos (operação, comercial e financeiro) de um período.
 * `?de=AAAA-MM&ate=AAAA-MM`; sem os dois, o mês corrente e os dois anteriores.
 * Só leitura. As contas estão em src/lib/relatorios.ts.
 */
export async function GET(req?: Request) {
  const { error } = await requireStaff(["ADMIN"]);
  if (error) return error;

  try {
    const query = req ? new URL(req.url).searchParams : new URLSearchParams();
    const padrao = periodoDoRelatorio();
    const de = query.get('de') ?? padrao.de;
    const ate = query.get('ate') ?? padrao.ate;

    const limites = limitesDoPeriodo(de, ate);
    if (!limites) {
      return NextResponse.json({ error: 'Período inválido. Use de=AAAA-MM e ate=AAAA-MM, com no máximo 36 meses.' }, { status: 400 });
    }
    const noPeriodo = { gte: limites.inicio, lt: limites.fim };

    // Uma consulta por vez: cada uma abre a própria transação (src/lib/prisma.ts), e em
    // paralelo um pedido só ocuparia cinco conexões do pool.
    const cargas = await prisma.collection.findMany({
      where: { createdAt: noPeriodo },
      select: {
        status: true,
        weight: true,
        freightValue: true,
        client: { select: { id: true, companyName: true, tradeName: true } },
      },
    });
    const entregas = await prisma.collectionStatusHistory.findMany({
      where: { toStatus: 'DELIVERED', createdAt: noPeriodo },
      select: {
        createdAt: true,
        collection: {
          select: {
            freightDeadlineHours: true,
            driver: { select: { id: true, user: { select: { name: true } } } },
            statusHistory: {
              where: { toStatus: 'COLLECTED' },
              orderBy: { createdAt: 'asc' },
              take: 1,
              select: { createdAt: true },
            },
          },
        },
      },
    });
    const cotacoes = await prisma.quoteLead.findMany({ where: { createdAt: noPeriodo }, select: { status: true } });
    const pagos = await prisma.financialTransaction.findMany({
      where: { status: 'PAID', paidAt: noPeriodo },
      select: { type: true, amount: true, category: true, paidAmount: true, costCenter: true },
    });
    const aReceber = await prisma.financialTransaction.findMany({
      where: { type: 'INCOME', status: 'PENDING' },
      select: { amount: true, dueDate: true },
    });

    return NextResponse.json({
      periodo: { de, ate },
      ...montarRelatorio({
        cargas,
        entregas: entregas.map(({ createdAt, collection }) => ({
          entregueEm: createdAt,
          coletadaEm: collection.statusHistory[0]?.createdAt ?? null,
          freightDeadlineHours: collection.freightDeadlineHours,
          motorista: collection.driver ? { id: collection.driver.id, nome: collection.driver.user.name } : null,
        })),
        cotacoes,
        pagos,
        aReceber,
      }),
    });
  } catch (error) {
    console.error('Erro ao montar os relatórios:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
