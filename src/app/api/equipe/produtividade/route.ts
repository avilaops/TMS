import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import prisma from '@/lib/prisma';
import { limitesDoPeriodo, periodoDoRelatorio } from '@/lib/relatorios';
import { produtividadeDaEquipe, semValores } from '@/lib/equipe';
import { finalizadaNoPeriodo } from '@/lib/viagem';

/**
 * Produtividade e comissão por motorista num período em meses
 * (`?de=AAAA-MM&ate=AAAA-MM`; sem os dois, o mês corrente e os dois anteriores,
 * como nos relatórios). Só leitura; as contas estão em src/lib/equipe.ts.
 *
 * - Viagens: manifestos finalizados, pela data da finalização (`finishedAt`).
 *   Viagem anterior a essa coluna conta pela data da última alteração, como
 *   sempre contou (`finalizadaNoPeriodo`).
 * - Entregas, prazo, peso e frete: as cargas que viraram "Entregue" no período,
 *   pelo histórico de status, com o motorista da carga.
 *
 * Frete e comissão são dinheiro: só o administrador recebe. Para a operação os
 * campos nem vão na resposta.
 */
export async function GET(req?: Request) {
  const { user, error } = await requireStaff();
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

    // Uma consulta por vez: cada uma abre a própria transação (src/lib/prisma.ts).
    const motoristas = await prisma.driver.findMany({
      select: { id: true, active: true, commissionPct: true, user: { select: { name: true } } },
    });
    const viagens = await prisma.manifest.findMany({
      where: finalizadaNoPeriodo(noPeriodo),
      select: { driverId: true },
    });
    const entregas = await prisma.collectionStatusHistory.findMany({
      where: { toStatus: 'DELIVERED', createdAt: noPeriodo },
      select: {
        createdAt: true,
        collection: {
          select: {
            weight: true,
            freightValue: true,
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

    // Motorista desativado só aparece se trabalhou no período.
    const inativos = new Set(motoristas.filter((m) => !m.active).map((m) => m.id));

    const linhas = produtividadeDaEquipe({
      motoristas: motoristas.map((m) => ({ id: m.id, nome: m.user.name, commissionPct: m.commissionPct })),
      viagens,
      entregas: entregas.map(({ createdAt, collection }) => ({
        entregueEm: createdAt,
        coletadaEm: collection.statusHistory[0]?.createdAt ?? null,
        freightDeadlineHours: collection.freightDeadlineHours,
        motorista: collection.driver ? { id: collection.driver.id, nome: collection.driver.user.name } : null,
        weight: collection.weight,
        freightValue: collection.freightValue,
      })),
    }).filter((linha) => !inativos.has(linha.driverId) || linha.entregas > 0 || linha.viagens > 0);

    const comValores = user.role === 'ADMIN';
    return NextResponse.json({
      periodo: { de, ate },
      comValores,
      motoristas: comValores ? linhas : linhas.map(semValores),
    });
  } catch (error) {
    console.error('Erro ao montar a produtividade:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
