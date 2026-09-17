import { randomInt } from "node:crypto";

/**
 * Codigo publico de rastreio.
 *
 * O rastreio publico passou a exigir CNPJ + codigo justamente para que o CNPJ
 * — que e dado publico — deixe de ser chave de consulta. Para isso o codigo
 * precisa ser impossivel de adivinhar ou percorrer:
 *
 *  - 10 digitos, sorteados de 0 a 9.999.999.999 com `randomInt` do `node:crypto`
 *    (CSPRNG). `Math.random()` nao serve: e previsivel a partir de amostras.
 *  - nao deriva de id, CNPJ, numero de minuta nem de contador. Duas coletas
 *    seguidas do mesmo cliente nao tem relacao entre si.
 *  - zero a esquerda e valido: o codigo e string, nao numero. "0000000123" e
 *    tao valido quanto "9184726350", e isso preserva os 10^10 valores.
 */
export const TRACKING_CODE_LENGTH = 10;

const TRACKING_CODE_SPACE = 10 ** TRACKING_CODE_LENGTH;

export function generateTrackingCode(): string {
  return String(randomInt(0, TRACKING_CODE_SPACE)).padStart(TRACKING_CODE_LENGTH, "0");
}

/**
 * Aceita o que o cliente digitar (espaco, ponto, hifen) e devolve os 10 digitos,
 * ou `null` se nao for um codigo possivel. Quem chama trata `null` igual a
 * "nao encontrado": informar que o formato estava errado ja seria um oraculo.
 */
export function normalizeTrackingCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const digits = raw.replace(/\D/g, "");
  return digits.length === TRACKING_CODE_LENGTH ? digits : null;
}

/**
 * Digitos do codigo enquanto a pessoa digita ou cola, cortados no comprimento.
 *
 * Existe porque o caminho obvio — `maxLength={10}` no input — corta o texto
 * BRUTO: colar "9184-726.350" (12 caracteres) virava "9184-726.3" e, depois de
 * tirar a pontuacao, chegava como 8 digitos e nao achava a carga. O corte tem
 * de vir depois da normalizacao, nunca antes.
 */
export function takeTrackingCodeDigits(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, TRACKING_CODE_LENGTH);
}

/** CPF tem 11 digitos, CNPJ tem 14. Qualquer outro tamanho nao e documento. */
export function normalizeTaxId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const digits = raw.replace(/\D/g, "");
  return digits.length === 11 || digits.length === 14 ? digits : null;
}

function isTrackingCodeCollision(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; meta?: { target?: unknown } };
  if (candidate.code !== "P2002") return false;
  const target = candidate.meta?.target;
  if (typeof target === "string") return target.includes("trackingCode");
  if (Array.isArray(target)) return target.some((field) => String(field).includes("trackingCode"));
  // P2002 sem `target` legivel: tratamos como colisao e deixamos o retry decidir.
  return true;
}

/**
 * Cria a coleta ja com codigo. Em 10^10 valores a colisao e improvavel, mas o
 * banco e a autoridade: a constraint UNIQUE rejeita a repetida e aqui sorteamos
 * de novo. Sem isso, uma colisao viraria erro 500 para o operador.
 */
export async function withTrackingCode<T>(
  create: (trackingCode: string) => Promise<T>,
  attempts = 5,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await create(generateTrackingCode());
    } catch (error) {
      lastError = error;
      if (!isTrackingCodeCollision(error)) throw error;
    }
  }
  throw lastError;
}
