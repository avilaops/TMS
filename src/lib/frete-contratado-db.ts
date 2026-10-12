import type { Prisma } from "@prisma/client";
import { type Ator, type Origem, escolher, registrarAuditoria } from "@/lib/auditoria";
import {
  CAMPOS_DO_CONTRATO,
  CONTRACT_SELECT,
  TRIP_HAS_PAID_CONTRACT,
  baseDaViagem,
  contasDoContrato,
  valorSugerido,
  type BaseDaViagem,
} from "@/lib/frete-contratado";
import { ManifestError } from "@/lib/manifestos-db";
import { codigoDaViagem } from "@/lib/viagem";

// Apoio das rotas do frete contratado e das rotas da viagem que mexem nele
// (montagem, troca de veículo e cancelamento). Só o servidor importa este arquivo.

type Tx = Prisma.TransactionClient;

export type ContratoGravado = Prisma.FreightContractGetPayload<{ select: typeof CONTRACT_SELECT }>;

/** O que as contas do contrato precisam da viagem. */
export const VIAGEM_DO_FRETE_SELECT = {
  id: true,
  status: true,
  departureOdometer: true,
  returnOdometer: true,
  collections: { select: { freightValue: true } },
  vehicle: {
    select: {
      id: true,
      plate: true,
      carrier: { select: { id: true, name: true, active: true, defaultCalcMode: true, defaultCalcBase: true } },
    },
  },
} as const;

/** O contrato como as rotas o devolvem: com as contas (valores, pago, saldo) e o valor que a forma de cálculo sugere hoje. */
export function contratoComContas(contrato: ContratoGravado, base: BaseDaViagem) {
  return { ...contrato, ...contasDoContrato(contrato), sugerido: valorSugerido(contrato.calcMode, contrato.calcBase, base) };
}

/**
 * Cria o contrato de frete da viagem quando o veículo dela é de um parceiro
 * ativo e a viagem ainda não tem contrato. A forma de cálculo e a base vêm do
 * padrão do parceiro, e o bruto nasce com o que a forma sugere agora (zero
 * quando não há como sugerir). Quem paga confere e corrige na aba Frete.
 *
 * Roda dentro da transação da montagem e da troca de veículo. Não mexe em
 * contrato que já existe: trocar o veículo de uma viagem com contrato deixa o
 * contrato como está, para alguém decidir.
 */
export async function criarContratoDoParceiro(tx: Tx, dados: { manifestId: string; ator: Ator; origem: Origem }): Promise<void> {
  const { manifestId, ator, origem } = dados;
  const viagem = await tx.manifest.findUnique({ where: { id: manifestId }, select: { ...VIAGEM_DO_FRETE_SELECT, freightContract: { select: { id: true } } } });
  const parceiro = viagem?.vehicle.carrier;
  if (!viagem || !parceiro || !parceiro.active || viagem.freightContract) return;

  const calcMode = parceiro.defaultCalcMode ?? "FIXO";
  const criado = await tx.freightContract.create({
    data: {
      manifestId,
      carrierId: parceiro.id,
      calcMode,
      calcBase: parceiro.defaultCalcBase,
      grossAmount: valorSugerido(calcMode, parceiro.defaultCalcBase, baseDaViagem(viagem)) ?? 0,
    },
    select: CONTRACT_SELECT,
  });

  await registrarAuditoria(tx, {
    ator,
    origem,
    acao: "frete-contratado.criar",
    entidade: "frete-contratado",
    entidadeId: criado.id,
    resumo: `Frete contratado criado na viagem #${codigoDaViagem(manifestId)}: veículo ${viagem.vehicle.plate} é do parceiro ${parceiro.name}`,
    depois: escolher(criado, CAMPOS_DO_CONTRATO),
  });
}

/**
 * O que o cancelamento da viagem faz com o contrato dela: sem pagamento, ele é
 * cancelado junto; com pagamento registrado, a viagem não é cancelada (409) e a
 * frase diz o que fazer. Dinheiro pago não some em silêncio.
 */
export async function cancelarContratoDaViagem(tx: Tx, dados: { manifestId: string; ator: Ator; origem: Origem }): Promise<void> {
  const { manifestId, ator, origem } = dados;
  const contrato = await tx.freightContract.findUnique({ where: { manifestId }, select: CONTRACT_SELECT });
  if (!contrato || contrato.status === "CANCELADO") return;
  if (contrato.payments.length > 0) throw new ManifestError(409, TRIP_HAS_PAID_CONTRACT);

  const cancelado = await tx.freightContract.update({ where: { id: contrato.id }, data: { status: "CANCELADO" }, select: CONTRACT_SELECT });
  await registrarAuditoria(tx, {
    ator,
    origem,
    acao: "frete-contratado.cancelar",
    entidade: "frete-contratado",
    entidadeId: contrato.id,
    resumo: `Frete contratado da viagem #${codigoDaViagem(manifestId)} cancelado junto com a viagem`,
    antes: escolher(contrato, CAMPOS_DO_CONTRATO),
    depois: escolher(cancelado, CAMPOS_DO_CONTRATO),
  });
}
