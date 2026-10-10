import type { Prisma } from "@prisma/client";
import type { z } from "zod";
import { type Ator, type Origem, escolher, registrarAuditoria } from "@/lib/auditoria";
import {
  CAMPOS_DA_DESPESA,
  TRIP_EXPENSE_SELECT,
  type ViagemNoTempo,
  type createTripExpenseSchema,
  abastecidoNaViagem,
  codigoDaViagem,
  geraAbastecimento,
  janelaDaViagem,
  rotuloDaDespesa,
} from "@/lib/viagem";

// Apoio das rotas de despesa de viagem, do painel e do aplicativo do motorista.
// Só o servidor importa este arquivo.

type Tx = Prisma.TransactionClient;

type DespesaValidada = z.infer<typeof createTripExpenseSchema>;

type ViagemComVeiculo = ViagemNoTempo & { id: string; vehicleId: string };

/**
 * Os abastecimentos da frota que contam como combustível de cada viagem: os do
 * veículo dela, feitos entre a saída e a finalização, que não nasceram de uma
 * despesa de viagem (esses já estão nas despesas). Devolve por id da viagem.
 *
 * Uma consulta só para todas as viagens pedidas; quem separa por viagem é a
 * janela de cada uma (`janelaDaViagem`). Duas viagens do mesmo veículo no mesmo
 * dia dividem esse dia: o abastecimento dele aparece nas duas.
 */
export async function combustivelDasViagens(
  db: Pick<Tx, "fueling">,
  viagens: readonly ViagemComVeiculo[],
  hoje: Date = new Date(),
): Promise<Map<string, { totalCost: number }[]>> {
  const porViagem = new Map<string, { totalCost: number }[]>();
  if (viagens.length === 0) return porViagem;

  const janelas = viagens.map((viagem) => ({ viagem, janela: janelaDaViagem(viagem, hoje) }));
  const inicio = janelas.reduce((menor, { janela }) => (janela.inicio < menor ? janela.inicio : menor), janelas[0].janela.inicio);
  const fim = janelas.reduce((maior, { janela }) => (janela.fim > maior ? janela.fim : maior), janelas[0].janela.fim);

  const abastecimentos = await db.fueling.findMany({
    where: {
      vehicleId: { in: [...new Set(viagens.map((viagem) => viagem.vehicleId))] },
      tripExpense: { is: null },
      date: { gte: new Date(`${inicio}T00:00:00.000Z`), lte: new Date(`${fim}T00:00:00.000Z`) },
    },
    select: { vehicleId: true, date: true, totalCost: true },
  });

  for (const { viagem, janela } of janelas) {
    porViagem.set(
      viagem.id,
      abastecimentos.filter((abastecimento) => abastecimento.vehicleId === viagem.vehicleId && abastecidoNaViagem(abastecimento, janela)),
    );
  }
  return porViagem;
}

/**
 * Lança a despesa na viagem, dentro da transação de quem chama.
 *
 * Combustível com litros e hodômetro gera também o abastecimento da frota, no
 * veículo e com o motorista da viagem, ligado à despesa: é ele que dá o consumo
 * do veículo, e por estar ligado não entra duas vezes no custo da viagem. Sem
 * litros ou sem hodômetro fica só a despesa.
 */
export async function lancarDespesa(
  tx: Tx,
  dados: {
    viagem: { id: string; vehicleId: string; driverId: string };
    despesa: DespesaValidada;
    ator: Ator;
    origem: Origem;
  },
) {
  const { viagem, despesa, ator, origem } = dados;

  let fuelingId: string | null = null;
  if (geraAbastecimento(despesa)) {
    const abastecimento = await tx.fueling.create({
      data: {
        vehicleId: viagem.vehicleId,
        driverId: viagem.driverId,
        date: despesa.date,
        liters: despesa.liters as number,
        totalCost: despesa.amount,
        odometer: despesa.odometer as number,
        station: despesa.notes ?? null,
      },
      select: { id: true },
    });
    fuelingId = abastecimento.id;
  }

  const criada = await tx.tripExpense.create({
    data: {
      manifestId: viagem.id,
      type: despesa.type,
      amount: despesa.amount,
      date: despesa.date,
      notes: despesa.notes ?? null,
      liters: despesa.liters ?? null,
      odometer: despesa.odometer ?? null,
      fuelingId,
      createdById: ator.id,
    },
    select: TRIP_EXPENSE_SELECT,
  });

  await registrarAuditoria(tx, {
    ator,
    origem,
    acao: "despesa-viagem.lancar",
    entidade: "despesa-viagem",
    entidadeId: criada.id,
    resumo: `${rotuloDaDespesa(criada.type)} lançado na viagem #${codigoDaViagem(viagem.id)}`,
    depois: escolher(criada, CAMPOS_DA_DESPESA),
  });

  return criada;
}
