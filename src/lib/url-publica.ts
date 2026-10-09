import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Confere que um endereço informado pelo usuário aponta para a internet, e não
 * para dentro da nossa rede. O servidor vai fazer um POST nesse endereço
 * (src/lib/eventos.ts): sem esta conferência, o administrador de uma empresa
 * poderia mandar o servidor chamar um serviço interno.
 *
 * `TMS_WEBHOOK_PERMITE_LOCAL=1` libera http e endereços locais. Existe para os
 * testes e para desenvolvimento; em produção fica desligado.
 */

export const ENDERECO_INVALIDO = "Informe um endereço completo, começando com https://.";
export const ENDERECO_INTERNO = "Esse endereço não é público. Use um endereço acessível pela internet.";
export const ENDERECO_NAO_ENCONTRADO = "Não foi possível encontrar esse endereço. Confira se está correto.";

const permiteLocal = () => process.env.TMS_WEBHOOK_PERMITE_LOCAL === "1";

function v4Privado(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) || // testes de rede
    a >= 224 // multicast e reservado
  );
}

/** Endereço IP que não é da internet: local, privado, link-local, multicast. */
export function ipPrivado(ip: string): boolean {
  if (isIP(ip) === 4) return v4Privado(ip);
  const v6 = ip.toLowerCase();
  // IPv4 embutido em IPv6 (::ffff:10.0.0.1).
  const embutido = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (embutido) return v4Privado(embutido[1]);
  return (
    v6 === "::" ||
    v6 === "::1" ||
    v6.startsWith("fc") ||
    v6.startsWith("fd") || // rede privada (fc00::/7)
    /^fe[89ab]/.test(v6) || // link-local (fe80::/10)
    v6.startsWith("ff") || // multicast
    v6.startsWith("::ffff:") // embutido em hexadecimal: recusa por garantia
  );
}

export type Conferencia = { ok: true; url: URL } | { ok: false; erro: string };

/** Só a forma: https, sem usuário e senha, e sem IP privado escrito direto. */
export function conferirFormato(texto: string): Conferencia {
  let url: URL;
  try {
    url = new URL(texto.trim());
  } catch {
    return { ok: false, erro: ENDERECO_INVALIDO };
  }
  const local = permiteLocal();
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) return { ok: false, erro: ENDERECO_INVALIDO };
  if (url.username || url.password) return { ok: false, erro: ENDERECO_INVALIDO };
  if (texto.trim().length > 500) return { ok: false, erro: ENDERECO_INVALIDO };

  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!local && (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || (isIP(host) !== 0 && ipPrivado(host)))) {
    return { ok: false, erro: ENDERECO_INTERNO };
  }
  return { ok: true, url };
}

/**
 * Forma e destino: resolve o nome e recusa se algum dos endereços for interno.
 * Roda ao salvar e de novo a cada entrega, porque o DNS pode mudar depois.
 */
export async function conferirEnderecoPublico(texto: string): Promise<Conferencia> {
  const formato = conferirFormato(texto);
  if (!formato.ok || permiteLocal()) return formato;

  const host = formato.url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) !== 0) return formato;

  try {
    const enderecos = await lookup(host, { all: true });
    if (enderecos.length === 0) return { ok: false, erro: ENDERECO_NAO_ENCONTRADO };
    if (enderecos.some((endereco) => ipPrivado(endereco.address))) return { ok: false, erro: ENDERECO_INTERNO };
  } catch {
    return { ok: false, erro: ENDERECO_NAO_ENCONTRADO };
  }
  return formato;
}
