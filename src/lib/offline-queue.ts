/**
 * Fila de baixas de entrega feitas sem internet.
 *
 * O motorista costuma perder sinal exatamente onde entrega. Em vez de perder o
 * comprovante, a baixa vai para o IndexedDB do aparelho e é reenviada assim que
 * a conexão volta.
 *
 * Cada baixa guarda o usuário que a colheu. O aparelho pode passar de um
 * motorista para outro: o reenvio só leva as baixas de quem está logado, e as
 * do outro esperam o login dele.
 *
 * Regra de reenvio:
 *  - resposta 2xx  -> enviado, sai da fila;
 *  - 401           -> a sessão caiu. O comprovante continua no aparelho e sobe
 *                     depois do login;
 *  - 403           -> a sessão vale, mas o cadastro do motorista está parado
 *                     (inativo ou sem cadastro). Entrar de novo não resolve: a
 *                     baixa fica presa, com o motivo, até a operação acertar o
 *                     cadastro ou o motorista descartá-la;
 *  - 408 ou 429    -> o servidor pediu para tentar depois. Continua na fila;
 *  - demais 4xx    -> o servidor recusou e vai recusar de novo (entrega que não
 *                     é do motorista, dado inválido). Sai da fila e vira aviso;
 *  - 5xx ou falha de rede -> continua na fila para a próxima tentativa.
 */

const DB_NAME = "mello-driver";
const DB_VERSION = 1;
const STORE = "pending-baixas";
const OWNER_KEY = "mello:driver-user";

export type PendingBaixa = {
  /** Chave do item: usuário e coleta. Uma baixa por carga e por motorista, a mais recente substitui a anterior. */
  id: string;
  collectionId: string;
  /**
   * Usuário que colheu a baixa. `null` em item gravado por versão anterior do
   * aplicativo, ou colhido sem a sessão carregada: não dá para saber de quem é.
   */
  userId: string | null;
  payload: Record<string, unknown>;
  createdAt: number;
};

/** Baixa que continua no aparelho e não sobe sozinha: precisa de alguém agir. */
export type BlockedBaixa = {
  id: string;
  collectionId: string;
  reason: string;
  /** Quem recebeu, como o motorista digitou: é o que ele reconhece na hora de descartar. */
  receiverName: string | null;
};

export type FlushResult = {
  sent: number;
  rejected: { collectionId: string; reason: string }[];
  stillPending: number;
  /** Alguma baixa ficou na fila porque o servidor não reconheceu a sessão. */
  needsLogin: boolean;
  /** Baixas presas: o servidor reconheceu a sessão e mesmo assim não aceita o envio. */
  blocked: BlockedBaixa[];
};

export type BaixaOutcome = "sent" | "rejected" | "retry";

// 4xx que não são recusa da baixa em si: o comprovante não pode sumir do aparelho.
const SESSION_STATUS = 401;
const DRIVER_BLOCKED_STATUS = 403;
const RETRY_LATER_STATUSES = [408, 429];

export const SESSION_EXPIRED_MESSAGE =
  "Sua sessão expirou. A baixa ficou salva no aparelho: entre de novo para enviar.";
export const DRIVER_BLOCKED_FALLBACK = "Seu cadastro de motorista não está liberado.";
export const UNKNOWN_OWNER_REASON =
  "Entrega não encontrada na sua viagem. A baixa pode ser de outro motorista que usou este aparelho.";

/** Aviso da baixa presa pelo cadastro: o motivo do servidor e o que fazer. */
export function blockedMessage(reason: string) {
  return `${reason} A baixa ficou salva no aparelho. Fale com a operação para liberar o envio.`;
}

/** O que fazer com o item da fila conforme a resposta do servidor. */
export function classifyBaixaResponse(status: number): BaixaOutcome {
  if (status >= 200 && status < 300) return "sent";
  if (status === SESSION_STATUS || status === DRIVER_BLOCKED_STATUS || RETRY_LATER_STATUSES.includes(status)) {
    return "retry";
  }
  if (status >= 400 && status < 500) return "rejected";
  return "retry";
}

/** A baixa ficou na fila por falta de sessão: só sobe depois de um novo login. */
export function needsLogin(status: number) {
  return status === SESSION_STATUS;
}

/** A sessão vale, mas o cadastro do motorista está parado: novo login não resolve. */
export function isDriverBlocked(status: number) {
  return status === DRIVER_BLOCKED_STATUS;
}

/**
 * Lê um item como ele está gravado no aparelho. Versões anteriores gravavam o
 * id da coleta no campo `deliveryId` e não gravavam o dono; esses itens
 * continuam valendo.
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
    userId: typeof item.userId === "string" && item.userId !== "" ? item.userId : null,
    payload,
    createdAt: typeof item.createdAt === "number" ? item.createdAt : 0,
  };
}

/** O item é de outro motorista: fica no aparelho, à espera do login dele. */
function isFromAnotherUser(item: PendingBaixa, userId: string) {
  return item.userId !== null && item.userId !== userId;
}

/** Nome do recebedor que está na baixa guardada, quando há. */
function receiverOf(item: PendingBaixa) {
  const name = item.payload.receiverName;
  return typeof name === "string" && name.trim() !== "" ? name.trim() : null;
}

/** Monta o item da fila. Sem usuário conhecido, a chave é só a coleta, como nas versões anteriores. */
export function buildPending(
  collectionId: string,
  payload: Record<string, unknown>,
  userId: string | null,
  createdAt = Date.now(),
): PendingBaixa {
  return {
    id: userId ? `${userId}:${collectionId}` : collectionId,
    collectionId,
    userId,
    payload,
    createdAt,
  };
}

/**
 * Sem sinal a sessão não carrega, e é justamente aí que a baixa vai para a
 * fila. O aparelho lembra o último usuário que a sessão confirmou, só para
 * marcar o dono da baixa; quem autoriza o envio continua sendo o servidor.
 */
export function rememberOwner(userId: string | null) {
  try {
    if (userId) localStorage.setItem(OWNER_KEY, userId);
    else localStorage.removeItem(OWNER_KEY);
  } catch {
    // Armazenamento bloqueado: a baixa entra sem dono, como nas versões anteriores.
  }
}

export function rememberedOwner(): string | null {
  try {
    return localStorage.getItem(OWNER_KEY);
  } catch {
    return null;
  }
}

/** O que o servidor disse sobre a sessão deste aparelho. */
export type SessionCheck =
  | { state: "user"; userId: string }
  | { state: "none" }
  // Sem resposta que valha (sem rede, erro do servidor, portal de wifi): não se sabe.
  | { state: "unknown" };

/**
 * Lê a resposta de `/api/auth/session`. O servidor responde `{}` quando não há
 * sessão; qualquer outra coisa que não traga o id do usuário não prova nada.
 */
export function readSessionCheck(ok: boolean, body: unknown): SessionCheck {
  if (!ok || typeof body !== "object" || body === null || Array.isArray(body)) return { state: "unknown" };
  const user = (body as { user?: unknown }).user;
  if (user === undefined) {
    return Object.keys(body).length === 0 ? { state: "none" } : { state: "unknown" };
  }
  const id = typeof user === "object" && user !== null ? (user as { id?: unknown }).id : undefined;
  return typeof id === "string" && id !== "" ? { state: "user", userId: id } : { state: "unknown" };
}

/** Pergunta ao servidor quem está logado, sem passar pelo provedor da sessão. */
export async function checkSession(fetcher: typeof fetch = fetch): Promise<SessionCheck> {
  try {
    const response = await fetcher("/api/auth/session", { cache: "no-store" });
    return readSessionCheck(response.ok, await response.json());
  } catch {
    return { state: "unknown" };
  }
}

export type SyncOwner = {
  /** Em nome de quem reenviar; `null` quando não dá para reenviar agora. */
  owner: string | null;
  /** O servidor confirmou que não há sessão: só um novo login faz a fila subir. */
  sessionExpired: boolean;
};

/**
 * Decide em nome de quem o reenvio roda. O provedor da sessão pode ter ficado
 * sem usuário por uma consulta feita sem sinal, com o login ainda valendo: antes
 * de desistir, confirma no servidor. Só id confirmado pelo servidor autoriza o
 * reenvio; o usuário lembrado no aparelho nunca. Sem resposta do servidor não se
 * conclui nada: a fila fica como está e a próxima tentativa pergunta de novo.
 */
export async function resolveSyncOwner(
  providerUserId: string | null,
  check: () => Promise<SessionCheck> = checkSession,
): Promise<SyncOwner> {
  if (providerUserId) return { owner: providerUserId, sessionExpired: false };
  const session = await check();
  if (session.state === "user") return { owner: session.userId, sessionExpired: false };
  return { owner: null, sessionExpired: session.state === "none" };
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

export function enqueue(collectionId: string, payload: Record<string, unknown>, userId: string | null) {
  const item = buildPending(collectionId, payload, userId);
  return tx("readwrite", (store) => store.put(item)).then(() => item);
}

export async function listPending(): Promise<PendingBaixa[]> {
  const stored = await tx<unknown[]>("readonly", (store) => store.getAll());
  return stored.map(readPending).filter((item): item is PendingBaixa => item !== null);
}

export type PendingCount = {
  /** Baixas que o reenvio deste usuário leva: as dele e as sem dono. */
  mine: number;
  /** Baixas de outro motorista, paradas até o login dele. */
  others: number;
};

/** Conta pela mesma leitura do reenvio: item ilegível não é enviado, então não é contado. */
export function summarizePending(items: PendingBaixa[], userId: string | null): PendingCount {
  const others = userId === null ? 0 : items.filter((item) => isFromAnotherUser(item, userId)).length;
  return { mine: items.length - others, others };
}

/**
 * Conta pelas chaves, sem ler os itens: cada um carrega foto e assinatura, e a
 * contagem roda a cada mudança da tela. A chave diz o dono porque é
 * `buildPending` quem a monta: `<usuário>:<coleta>`, ou só a coleta quando a
 * baixa não tem dono (ids de coleta não têm dois-pontos).
 */
export function summarizeKeys(keys: unknown[], userId: string | null): PendingCount {
  const ids = keys.filter((key): key is string => typeof key === "string" && key !== "");
  const others =
    userId === null ? 0 : ids.filter((id) => id.includes(":") && !id.startsWith(`${userId}:`)).length;
  return { mine: ids.length - others, others };
}

/** Sem usuário conhecido, tudo conta como pendente: nada some da tela enquanto a sessão carrega. */
export async function countPending(userId: string | null): Promise<PendingCount> {
  return summarizeKeys(await tx<IDBValidKey[]>("readonly", (store) => store.getAllKeys()), userId);
}

function removeItem(id: string) {
  return tx("readwrite", (store) => store.delete(id));
}

/** Apaga do aparelho as baixas que o motorista decidiu descartar. O comprovante se perde. */
export async function discardPending(ids: string[]) {
  for (const id of ids) await removeItem(id);
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
 * Tenta reenviar o que está na fila em nome de `userId`, o usuário logado.
 * Baixa de outro motorista nem é enviada: a sessão é a deste usuário, o
 * servidor responderia que a entrega não é dele e o comprovante se perderia.
 * Seguro para chamar várias vezes. O `io` só existe para o teste trocar o
 * IndexedDB e a rede.
 */
export async function flushQueue(
  userId: string,
  io: QueueIo = { list: listPending, send: sendBaixa, remove: removeItem },
): Promise<FlushResult> {
  const pending = (await io.list()).filter((item) => !isFromAnotherUser(item, userId));
  const result: FlushResult = { sent: 0, rejected: [], stillPending: 0, needsLogin: false, blocked: [] };

  for (const item of pending) {
    try {
      const response = await io.send(item);

      const outcome = classifyBaixaResponse(response.status);

      if (outcome === "sent") {
        await io.remove(item.id);
        result.sent += 1;
        continue;
      }

      // Baixa sem dono que o servidor não acha na viagem deste motorista pode
      // ser de outro: fica no aparelho, e só sai se alguém mandar descartar.
      if (outcome === "rejected" && response.status === 404 && item.userId === null) {
        result.blocked.push({
          id: item.id,
          collectionId: item.collectionId,
          reason: UNKNOWN_OWNER_REASON,
          receiverName: receiverOf(item),
        });
        result.stillPending += 1;
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
      if (isDriverBlocked(response.status)) {
        const body = await response.json().catch(() => null);
        result.blocked.push({
          id: item.id,
          collectionId: item.collectionId,
          reason: blockedMessage(typeof body?.error === "string" ? body.error : DRIVER_BLOCKED_FALLBACK),
          receiverName: receiverOf(item),
        });
      }
      result.stillPending += 1;
    } catch {
      // Sem rede: mantém na fila.
      result.stillPending += 1;
    }
  }

  return result;
}
