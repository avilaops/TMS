import type { Prisma } from "@prisma/client";

// Histórico de status da coleta: uma linha por status que ela assumiu, com
// quando e quem. A criação grava a primeira linha aninhada na própria coleta;
// toda troca posterior passa por `recordStatusChanges`.

export type StatusChange = {
  collectionId: string;
  /** `null` só na criação da coleta. */
  fromStatus: string | null;
  toStatus: string;
  /** `null` quando a troca não tem pessoa (script, integração). */
  userId: string | null;
};

/** O cliente Prisma ou o cliente de uma transação: os dois servem. */
type HistoryDb = Pick<Prisma.TransactionClient, "collectionStatusHistory">;

/**
 * Registra as trocas de status. Aceita várias de uma vez porque um manifesto
 * muda o status de todas as coletas da carga na mesma transação.
 */
export async function recordStatusChanges(db: HistoryDb, changes: readonly StatusChange[]): Promise<void> {
  if (changes.length === 0) return;

  await db.collectionStatusHistory.createMany({
    data: changes.map(({ collectionId, fromStatus, toStatus, userId }) => ({
      collectionId,
      fromStatus,
      toStatus,
      userId,
    })),
  });
}

// O que as rotas devolvem de cada linha. O usuário sai só com id e nome:
// `user: true` mandaria o hash da senha e o e-mail junto.
export const STATUS_HISTORY_SELECT = {
  id: true,
  fromStatus: true,
  toStatus: true,
  createdAt: true,
  user: { select: { id: true, name: true } },
} as const;
