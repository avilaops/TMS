import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import prisma from '@/lib/prisma';
import { diaNoBrasil } from '@/lib/financeiro';
import { DIAS_DE_AVISO, alertasDeVencimento, limitesDeCalendario, totaisDeCusto } from '@/lib/frota';

const DIA = 86_400_000;

/**
 * Alertas da frota: documentos de veículo e CNHs vencidos ou a vencer em até 30
 * dias, e os veículos em manutenção. Para o ADMIN vai também o custo do mês
 * corrente (manutenção concluída e abastecimento de todos os veículos); para os
 * demais o campo nem vai na resposta. Só leitura.
 */
export async function GET() {
  const { user, error } = await requireStaff();
  if (error) return error;

  try {
    const hoje = new Date();
    const diaDeHoje = diaNoBrasil(hoje);
    // Vencimento é dia do calendário à meia-noite UTC: o que vence depois deste
    // limite ainda está em dia. Quem decide a situação é `alertasDeVencimento`.
    const limite = new Date(Date.parse(`${diaDeHoje}T00:00:00.000Z`) + (DIAS_DE_AVISO + 1) * DIA);

    const documentos = await prisma.vehicleDocument.findMany({
      where: { expiresAt: { lt: limite } },
      select: { id: true, type: true, number: true, expiresAt: true, vehicle: { select: { id: true, plate: true } } },
    });
    // Motorista desativado não dirige: a CNH dele não é alerta.
    const motoristas = await prisma.driver.findMany({
      where: { active: true, cnhExpiry: { lt: limite } },
      select: { id: true, cnh: true, cnhExpiry: true, user: { select: { name: true } } },
    });
    const parados = await prisma.vehicle.findMany({
      where: { status: 'MAINTENANCE' },
      orderBy: { plate: 'asc' },
      select: {
        id: true,
        plate: true,
        model: true,
        // O serviço em aberto mais recente, quando há um registrado.
        maintenances: {
          where: { status: { in: ['SCHEDULED', 'IN_PROGRESS'] } },
          orderBy: { date: 'desc' },
          take: 1,
          select: { description: true },
        },
      },
    });

    const alertas = alertasDeVencimento(
      {
        documentos,
        motoristas: motoristas.map((m) => ({ id: m.id, nome: m.user.name, cnh: m.cnh, cnhExpiry: m.cnhExpiry })),
      },
      hoje,
    );
    const emManutencao = parados.map(({ maintenances, ...veiculo }) => ({ ...veiculo, servico: maintenances[0]?.description ?? null }));

    const resposta: Record<string, unknown> = {
      resumo: {
        vencidos: alertas.filter((alerta) => alerta.situacao === 'vencido').length,
        aVencer: alertas.filter((alerta) => alerta.situacao === 'a_vencer').length,
        emManutencao: emManutencao.length,
      },
      alertas,
      emManutencao,
    };

    if (user.role === 'ADMIN') {
      const mes = diaDeHoje.slice(0, 7);
      const limites = limitesDeCalendario(mes, mes);
      if (limites) {
        const noMes = { gte: limites.inicio, lt: limites.fim };
        const manutencoes = await prisma.maintenance.findMany({ where: { date: noMes }, select: { cost: true, status: true } });
        const abastecimentos = await prisma.fueling.findMany({ where: { date: noMes }, select: { totalCost: true } });
        resposta.custoDoMes = { mes, ...totaisDeCusto(manutencoes, abastecimentos) };
      }
    }

    return NextResponse.json(resposta);
  } catch (error) {
    console.error('Erro ao montar os alertas da frota:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
