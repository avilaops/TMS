import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/**
 * Cifra de dados guardados no banco (AES-256-GCM): hoje, as credenciais do
 * Mercado Pago de cada empresa (src/lib/cobranca-gateway-db.ts).
 *
 * A chave sai da variável de ambiente `TMS_CHAVE_DE_DADOS` (HKDF-SHA256). Sem a
 * variável, ou com um valor curto demais para ser segredo, não há cifra: quem
 * chama trata o recurso como desligado. Trocar a variável torna ilegível o que
 * já foi gravado (a leitura falha com `CifraError`), e as credenciais precisam
 * ser cadastradas de novo.
 *
 * O `contexto` (empresa e campo) entra como dado autenticado: um texto cifrado
 * copiado para outra empresa, ou para outro campo, não abre.
 *
 * Só o servidor importa este arquivo.
 */

export const VARIAVEL_DA_CHAVE = "TMS_CHAVE_DE_DADOS";
/** Menos que isto não é segredo: a variável é tratada como ausente. */
export const TAMANHO_MINIMO_DA_CHAVE = 32;

const VERSAO = "v1";
const SAL = "tms-avila-ops";
const INFO = "dados-cifrados-v1";

export class CifraError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "CifraError";
  }
}

/** A chave de 32 bytes, ou `null` sem a variável (ou com valor curto demais). */
function chave(): Buffer | null {
  const segredo = (process.env[VARIAVEL_DA_CHAVE] ?? "").trim();
  if (segredo.length < TAMANHO_MINIMO_DA_CHAVE) return null;
  return Buffer.from(hkdfSync("sha256", segredo, SAL, INFO, 32));
}

/** Há chave para cifrar e decifrar? */
export const cifraLigada = (): boolean => chave() !== null;

/** Cifra o texto. O resultado é `v1.<iv>.<etiqueta>.<dados>`, em base64url. */
export function cifrar(texto: string, contexto: string): string {
  const segredo = chave();
  if (!segredo) throw new CifraError(`Sem ${VARIAVEL_DA_CHAVE}: não há como cifrar.`);
  const iv = randomBytes(12);
  const cifra = createCipheriv("aes-256-gcm", segredo, iv);
  cifra.setAAD(Buffer.from(contexto, "utf8"));
  const dados = Buffer.concat([cifra.update(texto, "utf8"), cifra.final()]);
  return [VERSAO, iv.toString("base64url"), cifra.getAuthTag().toString("base64url"), dados.toString("base64url")].join(".");
}

/** Abre o que `cifrar` gravou. Chave errada, contexto errado ou texto adulterado: `CifraError`. */
export function decifrar(cifrado: string, contexto: string): string {
  const segredo = chave();
  if (!segredo) throw new CifraError(`Sem ${VARIAVEL_DA_CHAVE}: não há como decifrar.`);
  const [versao, iv, etiqueta, dados, ...resto] = cifrado.split(".");
  if (versao !== VERSAO || !iv || !etiqueta || dados === undefined || resto.length > 0) throw new CifraError("Texto cifrado em formato desconhecido.");
  try {
    const cifra = createDecipheriv("aes-256-gcm", segredo, Buffer.from(iv, "base64url"));
    cifra.setAAD(Buffer.from(contexto, "utf8"));
    cifra.setAuthTag(Buffer.from(etiqueta, "base64url"));
    return Buffer.concat([cifra.update(Buffer.from(dados, "base64url")), cifra.final()]).toString("utf8");
  } catch {
    // Nunca o motivo do Node: ele não ajuda quem lê e não deve ir para log com dado junto.
    throw new CifraError("Não foi possível decifrar: a chave de dados mudou ou o conteúdo foi alterado.");
  }
}
