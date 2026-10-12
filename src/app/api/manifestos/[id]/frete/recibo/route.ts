import { NextResponse } from 'next/server';
import prisma, { empresaAtual } from '@/lib/prisma';
import { requireStaff } from '@/lib/staff';
import { CONTRACT_NOT_FOUND, CONTRACT_SELECT, cidadesSemRepetir, contasDoContrato, type ReciboDeFrete } from '@/lib/frete-contratado';
import { ORDEM_DAS_CARGAS } from '@/lib/manifestos-db';
import { TRIP_NOT_FOUND, codigoDaViagem, finalizadaEm } from '@/lib/viagem';

/**
 * O recibo de pagamento de frete do contrato da viagem, pronto para a folha de
 * impressão (/dashboard/manifestos/[id]/recibo-frete): empresa, parceiro,
 * viagem, veículo, motorista, origens e destinos, os valores do contrato, os
 * pagamentos feitos e o saldo. Não é documento fiscal e não tem número de RPA.
 * É dinheiro: só quem lê o frete contratado.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireStaff({ pode: 'freteContratadoVer' });
  if (error) return error;

  try {
    const manifestId = (await params).id;

    const viagem = await prisma.manifest.findUnique({
      where: { id: manifestId },
      select: {
        id: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        departedAt: true,
        finishedAt: true,
        driver: { select: { user: { select: { name: true } } } },
        vehicle: { select: { plate: true, model: true } },
        collections: { select: { origin: true, destination: true }, orderBy: ORDEM_DAS_CARGAS },
        freightContract: { select: CONTRACT_SELECT },
      },
    });
    if (!viagem) return NextResponse.json({ error: TRIP_NOT_FOUND }, { status: 404 });
    const contrato = viagem.freightContract;
    if (!contrato) return NextResponse.json({ error: CONTRACT_NOT_FOUND }, { status: 404 });

    // A empresa só lê o próprio cadastro (prisma/sql/010-rls.sql).
    const empresa = await prisma.tenant.findUnique({ where: { id: await empresaAtual() }, select: { name: true, logo: true } });
    if (!empresa) return NextResponse.json({ error: 'Empresa não encontrada.' }, { status: 404 });

    const { valores, pago, saldo } = contasDoContrato(contrato);
    const recibo: ReciboDeFrete = {
      empresa,
      emitidoEm: new Date().toISOString(),
      parceiro: { nome: contrato.carrier.name, documento: contrato.carrier.taxId, rntrc: contrato.carrier.rntrc, tipo: contrato.carrier.type },
      viagem: {
        id: viagem.id,
        codigo: codigoDaViagem(viagem.id),
        situacao: viagem.status,
        saiuEm: viagem.departedAt?.toISOString() ?? null,
        finalizadaEm: finalizadaEm(viagem)?.toISOString() ?? null,
        placa: viagem.vehicle.plate,
        veiculo: viagem.vehicle.model,
        motorista: viagem.driver.user.name,
        origens: cidadesSemRepetir(viagem.collections.map((carga) => carga.origin)),
        destinos: cidadesSemRepetir(viagem.collections.map((carga) => carga.destination)),
      },
      contrato: {
        situacao: contrato.status,
        forma: contrato.calcMode,
        base: contrato.calcBase,
        observacao: contrato.notes,
        grossAmount: contrato.grossAmount,
        tollAmount: contrato.tollAmount,
        otherAdditions: contrato.otherAdditions,
        discounts: contrato.discounts,
        inss: contrato.inss,
        irrf: contrato.irrf,
        sestSenat: contrato.sestSenat,
        otherWithholdings: contrato.otherWithholdings,
      },
      valores,
      pagamentos: contrato.payments.map((pagamento) => ({
        id: pagamento.id,
        kind: pagamento.kind,
        date: pagamento.date.toISOString(),
        amount: pagamento.amount,
        method: pagamento.method,
        notes: pagamento.notes,
      })),
      pago,
      saldo,
    };
    return NextResponse.json(recibo);
  } catch (error) {
    console.error('Erro ao montar o recibo de frete:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
