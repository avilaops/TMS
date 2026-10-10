import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import prisma from '@/lib/prisma';
import { limitesDoPeriodo, montarRelatorio, montarResultado, periodoDoRelatorio } from '@/lib/relatorios';
import { acertoDaViagem, finalizadaEm, finalizadaNoPeriodo } from '@/lib/viagem';
import { combustivelDasViagens } from '@/lib/viagem-db';

/**
 * Relatórios básicos (operação, comercial e financeiro) de um período, e o
 * resultado dele (`resultado`): DRE básico, margem por cliente e resultado por viagem.
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
            weight: true,
            freightValue: true,
            manifestId: true,
            client: { select: { id: true, companyName: true, tradeName: true } },
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

    // Resultado: as viagens finalizadas no período e as que levaram alguma carga
    // entregue nele (o custo delas é rateado entre as cargas, por peso).
    const viagensDasEntregas = [...new Set(entregas.map((entrega) => entrega.collection.manifestId).filter((id): id is string => id !== null))];
    const viagens = await prisma.manifest.findMany({
      where: { OR: [{ id: { in: viagensDasEntregas } }, finalizadaNoPeriodo(noPeriodo)] },
      select: {
        id: true,
        status: true,
        vehicleId: true,
        createdAt: true,
        updatedAt: true,
        departedAt: true,
        finishedAt: true,
        departureOdometer: true,
        returnOdometer: true,
        driver: { select: { user: { select: { name: true } } } },
        vehicle: { select: { plate: true } },
        collections: { select: { weight: true, freightValue: true } },
        expenses: { where: { status: 'APPROVED' }, select: { type: true, amount: true, status: true } },
      },
    });
    const combustivel = await combustivelDasViagens(prisma, viagens);
    const contas = viagens.map((viagem) => ({
      viagem,
      acerto: acertoDaViagem({
        cargas: viagem.collections,
        despesas: viagem.expenses,
        abastecimentos: combustivel.get(viagem.id) ?? [],
        adiantamentos: [],
        departureOdometer: viagem.departureOdometer,
        returnOdometer: viagem.returnOdometer,
      }),
    }));

    const resultado = montarResultado({
      pagos,
      entregues: entregas.map(({ collection }) => ({
        client: collection.client,
        weight: collection.weight,
        freightValue: collection.freightValue,
        manifestId: collection.manifestId,
      })),
      custos: contas.map(({ viagem, acerto }) => ({
        id: viagem.id,
        custo: acerto.custoTotal,
        peso: viagem.collections.reduce((soma, carga) => soma + carga.weight, 0),
        cargas: viagem.collections.length,
      })),
      finalizadas: contas.flatMap(({ viagem, acerto }) => {
        const quando = finalizadaEm(viagem);
        // Viagem que só entrou pelo rateio (finalizada fora do período, ou ainda em rota) não é linha do período.
        if (!quando || quando < limites.inicio || quando >= limites.fim) return [];
        return [
          {
            id: viagem.id,
            finalizadaEm: quando,
            motorista: viagem.driver.user.name,
            placa: viagem.vehicle.plate,
            cargas: acerto.cargas,
            frete: acerto.frete,
            custo: acerto.custoTotal,
            km: acerto.km,
          },
        ];
      }),
    });

    return NextResponse.json({
      periodo: { de, ate },
      resultado,
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
