import type { Prisma } from "@prisma/client";
import { COLLECTION_INCLUDE, INACTIVE_CLIENT_MESSAGE, INACTIVE_DRIVER_MESSAGE } from "@/lib/coletas";
import { freteDaColeta } from "@/lib/frete-coleta";
import { recordStatusChanges } from "@/lib/historico";

// Apoio das rotas que criam uma coleta pelo painel (a de minutas e a importação
// de NF-e) e das que trocam o status dela dentro de transação (a do painel de
// minutas e a conferência do depósito). Só o servidor importa este arquivo.

/** O cliente Prisma da empresa ou o cliente de uma transação: os dois servem. */
type ColetasDb = Pick<Prisma.TransactionClient, "collection" | "client" | "driver">;

export type ColetaNova = {
  clientId: string;
  sender: string;
  receiver: string;
  origin: string;
  destination: string;
  volumes: number;
  weight: number;
  invoiceKey?: string | null;
  invoiceValue?: number | null;
  driverId?: string | null;
};

/** Por que a coleta não pode nascer (cliente ou motorista inativo ou de fora), ou `null`. */
export async function recusaDaColetaNova(db: ColetasDb, dados: Pick<ColetaNova, "clientId" | "driverId">): Promise<string | null> {
  const client = await db.client.findFirst({ where: { id: dados.clientId, active: true }, select: { id: true } });
  if (!client) return INACTIVE_CLIENT_MESSAGE;

  if (dados.driverId) {
    const driver = await db.driver.findFirst({ where: { id: dados.driverId, active: true }, select: { id: true } });
    if (!driver) return INACTIVE_DRIVER_MESSAGE;
  }
  return null;
}

/**
 * Cria a coleta como o painel cria: frete pela tabela do cliente (ou a padrão;
 * sem tabela fica a cotar), já confirmada, com o código de rastreio e a
 * primeira linha do histórico. Quem chama já passou por `recusaDaColetaNova` e
 * sorteia o código com `withTrackingCode` (src/lib/tracking.ts).
 */
export async function criarColetaConfirmada(db: ColetasDb, dados: ColetaNova, userId: string, trackingCode: string) {
  const frete = await freteDaColeta(db, {
    clientId: dados.clientId,
    destination: dados.destination,
    weight: dados.weight,
    volumes: dados.volumes,
    invoiceValue: dados.invoiceValue,
  });

  return db.collection.create({
    data: {
      clientId: dados.clientId,
      sender: dados.sender,
      receiver: dados.receiver,
      origin: dados.origin,
      destination: dados.destination,
      volumes: dados.volumes,
      weight: dados.weight,
      invoiceKey: dados.invoiceKey ?? null,
      invoiceValue: dados.invoiceValue ?? null,
      driverId: dados.driverId ?? null,
      ...frete,
      freightDetails: frete.freightDetails ?? undefined,
      // Quem cria pelo painel é o operador que aprovaria: nasce confirmada.
      // `PENDING` fica para o pedido que vem do portal do cliente.
      status: "CONFIRMED",
      trackingCode,
      // Primeira linha do histórico, gravada junto da coleta.
      statusHistory: { create: { fromStatus: null, toStatus: "CONFIRMED", userId } },
    },
    include: COLLECTION_INCLUDE,
  });
}

export type TrocaDeStatus = {
  collectionId: string;
  /** O status que quem chama leu e contra o qual decidiu. */
  de: string;
  para: string;
  userId: string | null;
  /** Só na entrega: quem recebeu. */
  receiverName?: string;
};

/**
 * Troca o status da coleta e grava a linha do histórico, na mesma transação:
 * ou ficam as duas gravações, ou nenhuma.
 *
 * Grava só se a coleta ainda estiver no status `de`: de duas chamadas
 * simultâneas, uma encontra zero linhas e recebe `false`. Cancelar exige ainda
 * que a coleta continue fora de manifesto. Quem chama já conferiu, com
 * `canTransition`, que a troca é permitida.
 */
export async function mudarStatusDaColeta(tx: Prisma.TransactionClient, troca: TrocaDeStatus): Promise<boolean> {
  const { collectionId, de, para, userId, receiverName } = troca;

  const { count } = await tx.collection.updateMany({
    where: {
      id: collectionId,
      status: de,
      ...(para === "CANCELLED" ? { manifestId: null } : {}),
    },
    data: {
      status: para,
      ...(para === "DELIVERED" ? { receiverName } : {}),
    },
  });
  if (count === 0) return false;

  await recordStatusChanges(tx, [{ collectionId, fromStatus: de, toStatus: para, userId }]);
  return true;
}
