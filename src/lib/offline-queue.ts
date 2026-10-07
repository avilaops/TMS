/**
 * Fila de baixas de entrega feitas sem internet.
 *
 * O motorista costuma perder sinal exatamente onde entrega. Em vez de perder o
 * comprovante, a baixa vai para o IndexedDB do aparelho e é reenviada assim que
 * a conexão volta.
 *
 * Regra de reenvio:
 *  - resposta 2xx  -> enviado, sai da fila;
 *  - resposta 4xx  -> o servidor recusou e vai recusar de novo (entrega que não
 *                     é do motorista, dado inválido). Sai da fila e vira aviso;
 *  - 5xx ou falha de rede -> continua na fila para a próxima tentativa.
 */

const DB_NAME = "mello-driver";
const DB_VERSION = 1;
const STORE = "pending-baixas";

export type PendingBaixa = {
  /** Id da coleta: uma baixa por carga, a mais recente substitui a anterior. */
  id: string;
  deliveryId: string;
  payload: Record<string, unknown>;
  createdAt: number;
};

export type FlushResult = {
  sent: number;
  rejected: { deliveryId: string; reason: string }[];
  stillPending: number;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = run(transaction.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        transaction.oncomplete = () => db.close();
      })
  );
}

/** O que fazer com o item da fila conforme a resposta do servidor. */
export function classifyBaixaResponse(status: number): "sent" | "rejected" | "retry" {
  if (status >= 200 && status < 300) return "sent";
  if (status >= 400 && status < 500) return "rejected";
  return "retry";
}

export function enqueue(deliveryId: string, payload: Record<string, unknown>) {
  const item: PendingBaixa = {
    id: deliveryId,
    deliveryId,
    payload,
    createdAt: Date.now(),
  };
  return tx("readwrite", (store) => store.put(item)).then(() => item);
}

export function listPending(): Promise<PendingBaixa[]> {
  return tx<PendingBaixa[]>("readonly", (store) => store.getAll() as IDBRequest<PendingBaixa[]>);
}

export function countPending(): Promise<number> {
  return tx<number>("readonly", (store) => store.count());
}

function removeItem(id: string) {
  return tx("readwrite", (store) => store.delete(id));
}

/** Tenta reenviar tudo o que está na fila. Seguro para chamar várias vezes. */
export async function flushQueue(): Promise<FlushResult> {
  const pending = await listPending();
  const result: FlushResult = { sent: 0, rejected: [], stillPending: 0 };

  for (const item of pending) {
    try {
      const response = await fetch(`/api/driver/entregas/${item.deliveryId}/baixa`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item.payload),
      });

      const outcome = classifyBaixaResponse(response.status);

      if (outcome === "sent") {
        await removeItem(item.id);
        result.sent += 1;
        continue;
      }

      if (outcome === "rejected") {
        const body = await response.json().catch(() => null);
        await removeItem(item.id);
        result.rejected.push({
          deliveryId: item.deliveryId,
          reason: body?.error ?? `Recusado pelo servidor (${response.status})`,
        });
        continue;
      }

      result.stillPending += 1;
    } catch {
      // Sem rede: mantém na fila.
      result.stillPending += 1;
    }
  }

  return result;
}
