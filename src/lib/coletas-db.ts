import type { Prisma } from "@prisma/client";
import { recordStatusChanges } from "@/lib/historico";

// Apoio das rotas que trocam o status de uma coleta dentro de transação: a do
// painel de minutas e a conferência do depósito. Só o servidor importa este
// arquivo.

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
