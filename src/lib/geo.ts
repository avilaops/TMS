import { logradouroNormalizado, numeroNormalizado, type EnderecoParaLocalizar } from "@/lib/endereco";
import type { Ponto } from "@/lib/roteiro";

/**
 * Localizar um endereço (geocodificação) no Nominatim, o serviço de busca do
 * OpenStreetMap. Só o cliente HTTP e a fila; o cache e o que grava na carga
 * estão em src/lib/geo-db.ts. Só o servidor importa este arquivo.
 *
 * A política de uso do serviço público (https://operations.osmfoundation.org/policies/nominatim/)
 * manda, e este arquivo cumpre:
 * - no máximo UMA consulta por segundo, somando tudo o que o servidor faz: a
 *   fila abaixo é uma só para o processo inteiro e põe uma consulta atrás da outra;
 * - `User-Agent` que identifique o sistema e um contato: sem `GEO_CONTATO` não
 *   há consulta nenhuma;
 * - guardar o resultado para não repetir a pergunta: é o `GeoCache`;
 * - nada de consulta disparada por digitação de usuário: quem chama é o
 *   despachante, em segundo plano, poucas por volta.
 *
 * `GEO_URL` troca o servidor (instância própria do Nominatim, ou o servidor
 * local dos testes). Padrão: o público.
 */

export const GEO_URL_PADRAO = "https://nominatim.openstreetmap.org";
const INTERVALO_MS = 1_100;
const TEMPO_LIMITE_MS = 8_000;

export type ConfiguracaoDoGeo = {
  /** Endereço do servidor, sem a barra do fim. */
  url: string;
  /** E-mail ou site de quem responde pelo uso: vai no `User-Agent`. */
  contato: string;
  /** Intervalo mínimo entre duas consultas, em ms. Só os testes mudam. */
  intervaloMs?: number;
  tempoLimiteMs?: number;
};

/**
 * A configuração lida do ambiente, ou `null` quando a localização por endereço
 * está desligada: sem `GEO_CONTATO` não se consulta o serviço (a rota segue pelo
 * centro da cidade).
 */
export function configuracaoDoGeo(env: Record<string, string | undefined> = process.env): ConfiguracaoDoGeo | null {
  const contato = (env.GEO_CONTATO ?? "").trim();
  if (contato === "") return null;
  const url = (env.GEO_URL ?? "").trim().replace(/\/+$/, "") || GEO_URL_PADRAO;
  return /^https?:\/\//i.test(url) ? { url, contato } : null;
}

/** O `User-Agent` de toda consulta: o sistema e quem procurar se houver abuso. */
export const agenteDoGeo = (contato: string) => `TMS-Avila-Ops/1.0 (${contato})`;

/**
 * A consulta estruturada do Nominatim para um endereço do Brasil. Vai o
 * logradouro com o número, a cidade e a UF; bairro e CEP ficam de fora (ver
 * `chaveDoEndereco` em src/lib/endereco.ts).
 */
export function consultaDoEndereco(endereco: EnderecoParaLocalizar): URLSearchParams {
  const numero = numeroNormalizado(endereco.numero);
  return new URLSearchParams({
    format: "jsonv2",
    limit: "1",
    countrycodes: "br",
    addressdetails: "0",
    street: [numero, logradouroNormalizado(endereco.rua)].filter(Boolean).join(" "),
    city: endereco.cidade,
    state: endereco.uf,
    country: "Brasil",
  });
}

/* ------------------------------------ Fila ------------------------------------ */

// O Next recarrega módulos em desenvolvimento: a fila fica no global para o
// intervalo valer para o processo inteiro, e não por cópia do módulo.
const global = globalThis as { tmsFilaDoGeo?: { fim: Promise<unknown>; ultima: number } };
const fila = (global.tmsFilaDoGeo ??= { fim: Promise.resolve(), ultima: 0 });

const esperar = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Roda `tarefa` depois de todas as que já estão na fila e nunca antes de `intervaloMs` da anterior. */
function naVez<T>(tarefa: () => Promise<T>, intervaloMs: number): Promise<T> {
  const vez = fila.fim.then(async () => {
    const falta = fila.ultima + intervaloMs - Date.now();
    if (falta > 0) await esperar(falta);
    try {
      return await tarefa();
    } finally {
      // Conta do fim da consulta: é o que garante o intervalo mesmo com resposta lenta.
      fila.ultima = Date.now();
    }
  });
  // Uma consulta que falha não trava as seguintes.
  fila.fim = vez.catch(() => undefined);
  return vez;
}

/** Só os testes usam: esquece a hora da última consulta. */
export function zerarFilaDoGeo(): void {
  fila.fim = Promise.resolve();
  fila.ultima = 0;
}

/* ---------------------------------- Consulta ---------------------------------- */

export type RespostaDoGeo =
  /** O serviço respondeu: achou o ponto, ou disse que não achou (`ponto: null`). As duas respostas vão para o cache. */
  | { ok: true; ponto: Ponto | null }
  /** Não deu para saber (rede, tempo limite, serviço fora, limite estourado): não vai para o cache e se tenta depois. */
  | { ok: false; erro: string };

const numero = (valor: unknown) => (typeof valor === "string" || typeof valor === "number" ? Number(valor) : NaN);

function pontoDaResposta(corpo: unknown): Ponto | null {
  if (!Array.isArray(corpo) || corpo.length === 0) return null;
  const primeiro = corpo[0] as { lat?: unknown; lon?: unknown } | null;
  const lat = numero(primeiro?.lat);
  const lon = numero(primeiro?.lon);
  const valido = Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  return valido ? { lat, lon } : null;
}

/**
 * Pergunta ao Nominatim onde fica o endereço. Entra na fila de uma consulta por
 * segundo; nunca lança: rede, tempo limite e resposta estranha voltam como
 * `{ ok: false }`.
 */
export function localizarNoNominatim(endereco: EnderecoParaLocalizar, configuracao: ConfiguracaoDoGeo): Promise<RespostaDoGeo> {
  const endpoint = `${configuracao.url}/search?${consultaDoEndereco(endereco).toString()}`;

  return naVez(async (): Promise<RespostaDoGeo> => {
    try {
      const res = await fetch(endpoint, {
        headers: { "User-Agent": agenteDoGeo(configuracao.contato), Accept: "application/json", "Accept-Language": "pt-BR" },
        signal: AbortSignal.timeout(configuracao.tempoLimiteMs ?? TEMPO_LIMITE_MS),
      });
      // 429 e 5xx são do serviço, não do endereço: tenta-se depois. Um 4xx é da
      // pergunta (endereço que o serviço não aceita) e repetir não muda nada.
      if (res.status === 429 || res.status >= 500) return { ok: false, erro: `Resposta ${res.status}` };
      if (!res.ok) return { ok: true, ponto: null };
      return { ok: true, ponto: pontoDaResposta(await res.json()) };
    } catch (erro) {
      return { ok: false, erro: erro instanceof Error && erro.name === "TimeoutError" ? "Sem resposta no tempo limite." : "Não foi possível consultar." };
    }
  }, configuracao.intervaloMs ?? INTERVALO_MS);
}
