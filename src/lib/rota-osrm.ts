import { chaveDoPonto, distanciaKm, type Distancia, type Ponto } from "@/lib/roteiro";

/**
 * Distância por estrada, opcional, de um servidor OSRM (Open Source Routing
 * Machine, sobre os dados do OpenStreetMap). Só o servidor importa este arquivo.
 *
 * Só existe com `ROTA_URL` apontando para um servidor OSRM (uma instância
 * própria, por exemplo `http://osrm:5000`). NÃO há padrão de propósito: o
 * servidor de demonstração público (router.project-osrm.org) proíbe uso em
 * produção, então sem `ROTA_URL` a conta é em linha reta e a tela diz isso. O
 * endereço dele é recusado mesmo que alguém o ponha na variável.
 *
 * Qualquer falha (rede, tempo limite, resposta estranha, par de pontos sem
 * caminho, pontos demais) devolve `null`: quem chama cai para a linha reta.
 * Trânsito não entra: o OSRM calcula pela malha, sem dado de trânsito.
 */

const TEMPO_LIMITE_MS = 4_000;
/** O teto padrão do `/table` do OSRM (`--max-table-size`). */
export const MAXIMO_DE_PONTOS_NA_MATRIZ = 100;
const DEMONSTRACAO_PUBLICA = "router.project-osrm.org";

export type ConfiguracaoDaRota = { url: string; tempoLimiteMs?: number };

/** A configuração lida do ambiente, ou `null` sem `ROTA_URL` válida. */
export function configuracaoDaRota(env: Record<string, string | undefined> = process.env): ConfiguracaoDaRota | null {
  const url = (env.ROTA_URL ?? "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(url)) return null;
  try {
    if (new URL(url).hostname.toLowerCase() === DEMONSTRACAO_PUBLICA) return null;
  } catch {
    return null;
  }
  return { url };
}

/** O endereço da matriz de distâncias: `/table/v1/driving/lon,lat;lon,lat?annotations=distance`. */
export function enderecoDaMatriz(url: string, pontos: readonly Ponto[]): string {
  // O OSRM recebe longitude antes da latitude.
  const coordenadas = pontos.map((ponto) => `${ponto.lon.toFixed(6)},${ponto.lat.toFixed(6)}`).join(";");
  return `${url}/table/v1/driving/${coordenadas}?annotations=distance`;
}

/** A matriz da resposta, em metros, ou `null` se a resposta não é a matriz inteira de `n` pontos. */
export function matrizDaResposta(corpo: unknown, n: number): number[][] | null {
  const resposta = corpo as { code?: unknown; distances?: unknown } | null;
  if (resposta?.code !== "Ok" || !Array.isArray(resposta.distances) || resposta.distances.length !== n) return null;
  for (const linha of resposta.distances) {
    if (!Array.isArray(linha) || linha.length !== n) return null;
    // `null` na matriz é par de pontos sem caminho: a conta inteira volta para a linha reta.
    if (!linha.every((valor) => typeof valor === "number" && Number.isFinite(valor) && valor >= 0)) return null;
  }
  return resposta.distances as number[][];
}

/**
 * A medida por estrada entre os pontos dados, em km, ou `null` em qualquer
 * falha. A ida e a volta entre dois pontos podem diferir (mão única, retorno):
 * a medida devolvida é a média das duas, porque a melhoria 2-opt da ordem
 * (src/lib/roteiro.ts) precisa de medida simétrica.
 */
export async function distanciaPorEstrada(pontos: readonly Ponto[], configuracao: ConfiguracaoDaRota | null = configuracaoDaRota()): Promise<Distancia | null> {
  if (!configuracao || pontos.length < 2 || pontos.length > MAXIMO_DE_PONTOS_NA_MATRIZ) return null;

  let matriz: number[][] | null;
  try {
    const res = await fetch(enderecoDaMatriz(configuracao.url, pontos), {
      headers: { Accept: "application/json", "User-Agent": "TMS-Avila-Ops" },
      signal: AbortSignal.timeout(configuracao.tempoLimiteMs ?? TEMPO_LIMITE_MS),
    });
    if (!res.ok) return null;
    matriz = matrizDaResposta(await res.json(), pontos.length);
  } catch {
    return null;
  }
  if (!matriz) return null;

  const indice = new Map(pontos.map((ponto, i) => [chaveDoPonto(ponto), i]));
  const metros = matriz;
  return (a, b) => {
    const i = indice.get(chaveDoPonto(a));
    const j = indice.get(chaveDoPonto(b));
    // Quem chama só pergunta pelos pontos que mandou (`pontosDaConta`). Ponto de fora cai na linha reta, para a conta nunca dar infinito.
    if (i === undefined || j === undefined) return distanciaKm(a, b);
    return (metros[i][j] + metros[j][i]) / 2 / 1000;
  };
}
