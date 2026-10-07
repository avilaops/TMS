/**
 * Fila de baixas de entrega feitas sem internet.
 *
 * O motorista costuma perder sinal exatamente onde entrega. Em vez de perder o
 * comprovante, a baixa vai para o IndexedDB do aparelho e é reenviada assim que
 * a conexão volta.
 *
 * Regra de reenvio:
 *  - resposta 2xx  -> enviado, sai da fila;
 *  - 401 ou 403    -> a sessão caiu (ou o cadastro do motorista está parado).
 *                     O comprovante continua no aparelho e sobe depois do login;
 *  - 408 ou 429    -> o servidor pediu para tentar depois. Continua na fila;
 *  - demais 4xx    -> o servidor recusou e vai recusar de novo (entrega que não
 *                     é do motorista, dado inválido). Sai da fila e vira aviso;
 *  - 5xx ou falha de rede -> continua na fila para a próxima tentativa.
 */

const DB_NAME = "mello-driver";
const DB_VERSION = 1;
const STORE = "pending-baixas";

export type PendingBaixa = {
  /** Chave do item: o id da coleta. Uma baixa por carga, a mais recente substitui a anterior. */
  id: string;
  collectionId: string;
  payload: Record<string, unknown>;
  createdAt: number;
};

export type FlushResult = {
  sent: number;
  rejected: { collectionId: string; reason: string }[];
  stillPending: number;
  /** Alguma baixa ficou na fila porque o servidor não reconheceu a sessão. */
  needsLogin: boolean;
};

export type BaixaOutcome = "sent" | "rejected" | "retry";

// 4xx que não são recusa da baixa em si: repetir o mesmo envio pode dar certo.
const AUTH_STATUSES = [401, 403];
const RETRY_LATER_STATUSES = [408, 429];

export const SESSION_EXPIRED_MESSAGE =
  "Sua sessão expirou. A baixa ficou salva no aparelho: entre de novo para enviar.";

/** O que fazer com o item da fila conforme a resposta do servidor. */
export function classifyBaixaResponse(status: number): BaixaOutcome {
  if (status >= 200 && status < 300) return "sent";
  if (AUTH_STATUSES.includes(status) || RETRY_LATER_STATUSES.includes(status)) return "retry";
  if (status >= 400 && status < 500) return "rejected";
  return "retry";
}

/** A baixa ficou na fila por falta de sessão: só sobe depois de um novo login. */
export function needsLogin(status: number) {
  return AUTH_STATUSES.includes(status);
}

/**
 * Lê um item como ele está gravado no aparelho. Versões anteriores gravavam o
 * id da coleta no campo `deliveryId`; esses itens continuam valendo.
 */
export function readPending(raw: unknown): PendingBaixa | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const collectionId = [item.collectionId, item.deliveryId, item.id].find(
    (value): value is string => typeof value === "string" && value !== "",
  );
  if (!collectionId) return null;
  const payload = item.payload && typeof item.payload === "object" ? (item.payload as Record<string, unknown>) : {};
  return {
    id: typeof item.id === "string" && item.id !== "" ? item.id : collectionId,
    collectionId,
    payload,
    createdAt: typeof item.createdAt === "number" ? item.createdAt : 0,
  };
}

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

export function enqueue(collectionId: string, payload: Record<string, unknown>) {
  const item: PendingBaixa = {
    id: collectionId,
    collectionId,
    payload,
    createdAt: Date.now(),
  };
  return tx("readwrite", (store) => store.put(item)).then(() => item);
}

export async function listPending(): Promise<PendingBaixa[]> {
  const stored = await tx<unknown[]>("readonly", (store) => store.getAll());
  return stored.map(readPending).filter((item): item is PendingBaixa => item !== null);
}

export function countPending(): Promise<number> {
  return tx<number>("readonly", (store) => store.count());
}

function removeItem(id: string) {
  return tx("readwrite", (store) => store.delete(id));
}

function sendBaixa(item: PendingBaixa) {
  return fetch(`/api/driver/entregas/${item.collectionId}/baixa`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(item.payload),
  });
}

type QueueIo = {
  list: () => Promise<PendingBaixa[]>;
  send: (item: PendingBaixa) => Promise<Pick<Response, "status" | "json">>;
  remove: (id: string) => Promise<unknown>;
};

/**
 * Tenta reenviar tudo o que está na fila. Seguro para chamar várias vezes.
 * O `io` só existe para o teste trocar o IndexedDB e a rede.
 */
export async function flushQueue(
  io: QueueIo = { list: listPending, send: sendBaixa, remove: removeItem },
): Promise<FlushResult> {
  const pending = await io.list();
  const result: FlushResult = { sent: 0, rejected: [], stillPending: 0, needsLogin: false };

  for (const item of pending) {
    try {
      const response = await io.send(item);

      const outcome = classifyBaixaResponse(response.status);

      if (outcome === "sent") {
        await io.remove(item.id);
        result.sent += 1;
        continue;
      }

      if (outcome === "rejected") {
        const body = await response.json().catch(() => null);
        await io.remove(item.id);
        result.rejected.push({
          collectionId: item.collectionId,
          reason: body?.error ?? `Recusado pelo servidor (${response.status})`,
        });
        continue;
      }

      if (needsLogin(response.status)) result.needsLogin = true;
      result.stillPending += 1;
    } catch {
      // Sem rede: mantém na fila.
      result.stillPending += 1;
    }
  }

  return result;
}
