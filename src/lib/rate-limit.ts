/**
 * Limitador de taxa em memoria, por processo.
 *
 * O projeto nao tinha nenhuma infraestrutura de rate limit (nem Redis, nem
 * middleware, nem dependencia): auditado antes de escrever isto. Como a app roda
 * em um unico container (docker-compose, servico `app`), um contador em memoria
 * cobre o caso real sem acrescentar dependencia nova.
 *
 * Limitacoes assumidas, e por que sao aceitaveis aqui:
 *  - reinicia quando o container reinicia. Um atacante ganha uma janela nova por
 *    deploy, o que nao viabiliza percorrer 10^10 codigos.
 *  - nao e compartilhado entre instancias. Se um dia houver mais de uma replica,
 *    o teto efetivo vira (limite x replicas) e isto aqui precisa virar Redis.
 */
type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/** Sem isto o Map cresce sem limite: cada IP novo deixa uma chave para tras. */
function evictExpired(now: number) {
  if (buckets.size < 1000) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };

export function consumeRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  evictExpired(now);

  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  bucket.count += 1;

  if (bucket.count > limit) {
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
  }

  return { allowed: true, retryAfterSeconds: 0 };
}

/** Usado pelos testes para isolar um caso do outro. */
export function resetRateLimit() {
  buckets.clear();
}
