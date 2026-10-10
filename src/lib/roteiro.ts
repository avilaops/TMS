import { z } from "zod";
import { chaveDaCidade } from "@/lib/frete";
import { normalizeText } from "@/lib/normalization";

/**
 * Roteirização: a ordem sugerida das entregas de uma viagem.
 *
 * O que esta conta é, e o que não é:
 * - Cada entrega fica num ponto: a coordenada do ENDEREÇO da carga, quando ele
 *   foi localizado (src/lib/geo-db.ts), senão o centro da CIDADE do destino.
 *   Com endereço, as entregas de uma mesma cidade também entram na ordem.
 * - A distância padrão é em linha reta (haversine): serve para pôr as paradas
 *   numa ordem que não vai e volta, não para dizer quantos km o caminhão roda.
 *   Quem chama pode passar outra medida (`distancia`): a rota usa a distância
 *   por estrada de um servidor OSRM quando `ROTA_URL` está definida
 *   (src/lib/rota-osrm.ts). Em nenhum caso conhece trânsito, pedágio nem janela
 *   de entrega: trânsito não existe em fonte aberta.
 * - A ordem sai de "vizinho mais próximo" seguido de melhoria 2-opt. Entregas
 *   no mesmo ponto (mesma cidade sem endereço, ou a mesma coordenada) ficam
 *   juntas, na ordem em que já estavam entre si.
 * - Carga sem endereço localizado e cuja cidade não foi achada ("sem
 *   localização") vai para o fim, na ordem atual, e é devolvida à parte para a
 *   tela avisar.
 *
 * Tudo aqui é puro: as coordenadas chegam por parâmetro (`IndiceDeCidades` e os
 * campos da carga). A tabela dos municípios mora em `src/lib/municipios.ts`,
 * que só o servidor importa; a tela importa daqui só os tipos.
 */

export type Cidade = { nome: string; uf: string; lat: number; lon: number };

/** Chave da cidade (`chaveDaCidade`) → as cidades com esse nome, uma por UF. */
export type IndiceDeCidades = ReadonlyMap<string, readonly Cidade[]>;

export const UFS = [
  "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA",
  "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO",
] as const;

const ehUf = (texto: string) => (UFS as readonly string[]).includes(texto.toUpperCase());

/** Monta o índice de busca a partir da lista de municípios. */
export function indiceDeCidades(cidades: readonly Cidade[]): IndiceDeCidades {
  const indice = new Map<string, Cidade[]>();
  const incluir = (chave: string, cidade: Cidade) => {
    if (!chave) return;
    const lista = indice.get(chave);
    if (!lista) indice.set(chave, [cidade]);
    else if (!lista.includes(cidade)) lista.push(cidade);
  };
  for (const cidade of cidades) {
    incluir(chaveDaCidade(cidade.nome), cidade);
    // `chaveDaCidade` corta um "-xx" do fim como se fosse UF ("Xangri-lá" vira
    // "xangri"). Com a UF escrita ("Xangri-lá - RS") o corte pega a UF e o nome
    // chega inteiro: a cidade entra no índice também pela chave do nome inteiro.
    incluir(chaveDaCidade(`${cidade.nome} - ${cidade.uf}`), cidade);
  }
  return indice;
}

/* ------------------------------- Achar a cidade ------------------------------- */

// "Mirassol - SP", "Mirassol/SP", "Mirassol (SP)", "Mirassol, SP".
const UF_NO_FIM = /\s*[/(,-]\s*([a-z]{2})\)?$/u;

/** A UF escrita no fim do texto, ou `null`. Só vale sigla que existe. */
export function ufDoTexto(texto: string): string | null {
  const sigla = normalizeText(texto).match(UF_NO_FIM)?.[1];
  return sigla && ehUf(sigla) ? sigla.toUpperCase() : null;
}

function escolher(lista: readonly Cidade[] | undefined, uf: string | null, ufPreferida: string | null): Cidade | null {
  if (!lista || lista.length === 0) return null;
  // UF escrita manda: cidade com esse nome em outro estado não serve.
  if (uf) return lista.find((cidade) => cidade.uf === uf) ?? null;
  if (lista.length === 1) return lista[0];
  // Nome repetido em vários estados e sem UF: só a preferida desempata.
  return (ufPreferida && lista.find((cidade) => cidade.uf === ufPreferida)) || null;
}

function localizarTrecho(trecho: string, indice: IndiceDeCidades, ufPreferida: string | null): Cidade | null {
  const uf = ufDoTexto(trecho);
  // Duas letras no fim que não são UF ("Mirassol - XX", "Xangri-lá") fazem parte
  // do nome: a chave é a do texto inteiro, sem o corte que `chaveDaCidade` faria.
  const fimQueNaoEUf = uf === null && UF_NO_FIM.test(normalizeText(trecho));
  const chave = chaveDaCidade(fimQueNaoEUf ? `${trecho} - SP` : trecho);
  if (!chave) return null;

  const achada = escolher(indice.get(chave), uf, ufPreferida);
  if (achada) return achada;

  // "Mirassol SP" e "Mirassol, SP": a UF veio como última palavra da chave.
  const palavras = chave.split(" ");
  const ultima = palavras[palavras.length - 1];
  if (palavras.length > 1 && ehUf(ultima)) {
    return escolher(indice.get(palavras.slice(0, -1).join(" ")), ultima.toUpperCase(), ufPreferida);
  }
  return null;
}

/**
 * A cidade de um texto de origem ou destino: "Mirassol - SP", "São José do Rio
 * Preto", "MIRASSOL/SP", "Rua Tal, 100, Centro, Mirassol - SP". Compara pela
 * mesma chave das tabelas de frete (sem acento, sem caixa, sem a UF do fim).
 *
 * Tenta o texto inteiro e, se for um endereço, os trechos entre vírgulas, do
 * fim para o começo (a cidade costuma ser o último). Nome que existe em mais de
 * um estado, sem UF escrita, só é aceito na `ufPreferida`; sem ela, ou se ela
 * também não tem a cidade, devolve `null`: sem localização.
 */
export function localizarCidade(texto: string | null | undefined, indice: IndiceDeCidades, ufPreferida: string | null = null): Cidade | null {
  const limpo = (texto ?? "").replace(/\s+/g, " ").trim();
  if (limpo === "") return null;

  const inteiro = localizarTrecho(limpo, indice, ufPreferida);
  if (inteiro) return inteiro;

  const trechos = limpo.split(",").map((trecho) => trecho.trim()).filter(Boolean);
  if (trechos.length < 2) return null;
  for (let i = trechos.length - 1; i >= 0; i -= 1) {
    // "…, Mirassol, SP": o trecho junto com o seguinte, antes do trecho sozinho.
    if (i < trechos.length - 1) {
      const comOSeguinte = localizarTrecho(`${trechos[i]}, ${trechos[i + 1]}`, indice, ufPreferida);
      if (comOSeguinte) return comOSeguinte;
    }
    const sozinho = localizarTrecho(trechos[i], indice, ufPreferida);
    if (sozinho) return sozinho;
  }
  return null;
}

/** "Mirassol/SP": como a tela mostra a cidade achada. */
export const nomeDaCidade = (cidade: Pick<Cidade, "nome" | "uf">) => `${cidade.nome}/${cidade.uf}`;

/** O texto que mais se repete (pela chave da cidade); no empate, o que aparece primeiro. `null` sem texto nenhum. */
export function textoMaisComum(textos: readonly (string | null | undefined)[]): string | null {
  const contagem = new Map<string, { texto: string; vezes: number }>();
  for (const texto of textos) {
    const chave = chaveDaCidade(texto ?? "");
    if (!chave) continue;
    const atual = contagem.get(chave);
    if (atual) atual.vezes += 1;
    else contagem.set(chave, { texto: texto as string, vezes: 1 });
  }
  let melhor: { texto: string; vezes: number } | null = null;
  for (const item of contagem.values()) if (!melhor || item.vezes > melhor.vezes) melhor = item;
  return melhor?.texto ?? null;
}

/* ---------------------------------- Distância --------------------------------- */

const RAIO_DA_TERRA_KM = 6371.0088;
const emRadianos = (graus: number) => (graus * Math.PI) / 180;

export type Ponto = Pick<Cidade, "lat" | "lon">;

/** A medida entre dois pontos, em km. Padrão: linha reta (`distanciaKm`). */
export type Distancia = (a: Ponto, b: Ponto) => number;

/** Distância em linha reta entre dois pontos, em km (fórmula de haversine). */
export function distanciaKm(a: Ponto, b: Ponto): number {
  const dLat = emRadianos(b.lat - a.lat);
  const dLon = emRadianos(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(emRadianos(a.lat)) * Math.cos(emRadianos(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * RAIO_DA_TERRA_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * O comprimento do caminho `partida → pontos, na ordem → retorno`. Sem partida
 * o caminho começa no primeiro ponto; sem retorno termina no último.
 */
export function comprimentoKm(pontos: readonly Ponto[], partida: Ponto | null, retorno: Ponto | null, distancia: Distancia = distanciaKm): number {
  const caminho = [...(partida ? [partida] : []), ...pontos, ...(retorno ? [retorno] : [])];
  let total = 0;
  for (let i = 1; i < caminho.length; i += 1) total += distancia(caminho[i - 1], caminho[i]);
  return total;
}

/* -------------------------------- Ordem sugerida ------------------------------ */

/** Vizinho mais próximo: da partida (ou do primeiro ponto), sempre para o ponto mais perto que falta. */
function vizinhoMaisProximo<T extends Ponto>(pontos: readonly T[], partida: Ponto | null, distancia: Distancia): T[] {
  const faltam = [...pontos];
  const ordem: T[] = [];
  let atual: Ponto | null = partida;
  if (!atual && faltam.length > 0) {
    ordem.push(faltam.shift() as T);
    atual = ordem[0];
  }
  while (faltam.length > 0) {
    let melhor = 0;
    let menor = Infinity;
    for (let i = 0; i < faltam.length; i += 1) {
      const d = distancia(atual as Ponto, faltam[i]);
      // Só troca se for menor de verdade: no empate fica o que veio antes na ordem atual.
      if (d < menor - 1e-9) {
        menor = d;
        melhor = i;
      }
    }
    atual = faltam[melhor];
    ordem.push(faltam.splice(melhor, 1)[0]);
  }
  return ordem;
}

/**
 * 2-opt: inverte um trecho da ordem sempre que isso encurta o caminho, até não
 * haver mais ganho. Só as duas pontas do trecho mudam de vizinho, então o ganho
 * sai de quatro distâncias (por isso a medida precisa ser simétrica: ida igual
 * à volta). Sem partida, o primeiro ponto fica preso no lugar (é de onde o
 * caminho sai).
 */
function doisOpt<T extends Ponto>(ordem: readonly T[], partida: Ponto | null, retorno: Ponto | null, distancia: Distancia): T[] {
  const rota = [...ordem];
  const n = rota.length;
  const d = (a: Ponto | null, b: Ponto | null) => (a && b ? distancia(a, b) : 0);
  const primeiro = partida ? 0 : 1;

  let melhorou = n > 1;
  // O laço termina sozinho (cada troca encurta o caminho); o teto é só garantia.
  for (let passada = 0; melhorou && passada < 1000; passada += 1) {
    melhorou = false;
    for (let i = primeiro; i < n - 1; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        const antes = i === 0 ? partida : rota[i - 1];
        const depois = j === n - 1 ? retorno : rota[j + 1];
        const ganho = d(antes, rota[i]) + d(rota[j], depois) - d(antes, rota[j]) - d(rota[i], depois);
        if (ganho > 1e-9) {
          for (let a = i, b = j; a < b; a += 1, b -= 1) [rota[a], rota[b]] = [rota[b], rota[a]];
          melhorou = true;
        }
      }
    }
  }
  return rota;
}

export type ParadaDoRoteiro = {
  id: string;
  /** A cidade da entrega, ou `null` quando não foi achada. */
  cidade: Cidade | null;
  /** A coordenada do endereço da entrega, quando ele foi localizado. Vale no lugar do centro da cidade. */
  ponto?: Ponto | null;
  /** Já entregue: fica onde está, no começo, e não entra na conta. */
  feita?: boolean;
};

export type Roteiro = {
  /** Todas as cargas, na ordem sugerida: feitas, localizadas e, no fim, as sem localização. */
  ordem: string[];
  /** Km na ordem atual e na sugerida, na medida usada (linha reta, ou estrada). Uma casa decimal. */
  distanciaAntesKm: number;
  distanciaDepoisKm: number;
  /** Cargas a entregar sem endereço localizado e cuja cidade não foi achada. */
  naoLocalizadas: string[];
  /** `false` quando a ordem atual já é a melhor que a conta achou (ou não há o que ordenar). */
  mudou: boolean;
};

const umaCasa = (valor: number) => Math.round(valor * 10) / 10;

/** Onde a parada fica para a conta: o endereço localizado, senão o centro da cidade, senão em lugar nenhum. */
export const lugarDaParada = (parada: Pick<ParadaDoRoteiro, "cidade" | "ponto">): Ponto | null => parada.ponto ?? parada.cidade;

/** A mesma chave para o mesmo lugar: é o que junta as cargas numa parada só e o que acha o ponto na matriz por estrada. */
export const chaveDoPonto = (ponto: Ponto) => `${ponto.lat.toFixed(6)},${ponto.lon.toFixed(6)}`;

/**
 * A ordem sugerida das entregas.
 *
 * - `origem`: de onde o caminhão sai (e para onde volta, com `voltar`). Sem ela
 *   o caminho começa na primeira entrega da ordem atual, que fica onde está.
 * - `partida`: de onde o caminho começa quando não é a origem (viagem já na rua:
 *   o lugar da última entrega feita). Padrão: a origem.
 * - `voltar`: conta a volta à origem (padrão: sim). Muda a ordem: sem a volta, a
 *   melhor rota termina longe; com ela, fecha o laço.
 * - `distancia`: a medida entre dois pontos (padrão: linha reta).
 *
 * A sugestão nunca é pior que a ordem atual: se a conta não achar caminho mais
 * curto, devolve a ordem atual com `mudou: false`.
 */
export function sugerirRoteiro(
  paradas: readonly ParadaDoRoteiro[],
  { origem, partida, voltar = true, distancia = distanciaKm }: { origem: Ponto | null; partida?: Ponto | null; voltar?: boolean; distancia?: Distancia },
): Roteiro {
  const feitas = paradas.filter((parada) => parada.feita);
  const aEntregar = paradas.filter((parada) => !parada.feita);
  const localizadas = aEntregar.flatMap((parada) => {
    const lugar = lugarDaParada(parada);
    return lugar ? [{ id: parada.id, lugar }] : [];
  });
  const semLocal = aEntregar.filter((parada) => lugarDaParada(parada) === null);

  const inicio = partida ?? origem;
  const retorno = voltar ? origem : null;

  // Uma parada por lugar, na ordem em que os lugares aparecem; as cargas de cada um ficam juntas.
  const grupos: { chave: string; lat: number; lon: number; ids: string[] }[] = [];
  for (const parada of localizadas) {
    const chave = chaveDoPonto(parada.lugar);
    const grupo = grupos.find((g) => g.chave === chave);
    if (grupo) grupo.ids.push(parada.id);
    else grupos.push({ chave, lat: parada.lugar.lat, lon: parada.lugar.lon, ids: [parada.id] });
  }

  const antes = comprimentoKm(localizadas.map((parada) => parada.lugar), inicio, retorno, distancia);

  // Dois pontos de partida para o 2-opt: o vizinho mais próximo e a própria ordem atual. Fica o menor.
  const candidatas = [doisOpt(vizinhoMaisProximo(grupos, inicio, distancia), inicio, retorno, distancia), doisOpt(grupos, inicio, retorno, distancia)];
  let melhor = candidatas[0];
  let depois = comprimentoKm(melhor, inicio, retorno, distancia);
  for (const candidata of candidatas.slice(1)) {
    const comprimento = comprimentoKm(candidata, inicio, retorno, distancia);
    if (comprimento < depois - 1e-9) {
      melhor = candidata;
      depois = comprimento;
    }
  }

  const atual = paradas.map((parada) => parada.id);
  // Ganho menor que 100 m é arredondamento: não vale mexer na ordem de ninguém.
  const mudou = depois < antes - 0.1;
  const sugerida = mudou
    ? [...feitas.map((parada) => parada.id), ...melhor.flatMap((grupo) => grupo.ids), ...semLocal.map((parada) => parada.id)]
    : atual;

  return {
    ordem: sugerida,
    distanciaAntesKm: umaCasa(antes),
    distanciaDepoisKm: umaCasa(mudou ? depois : antes),
    naoLocalizadas: semLocal.map((parada) => parada.id),
    mudou: mudou && sugerida.join() !== atual.join(),
  };
}

/* ------------------------------ O que a rota troca ---------------------------- */

/** Corpo de `POST /api/manifestos/[id]/roteiro`. Sem corpo vale o padrão: com a volta à origem. */
export const roteiroSchema = z.object({ voltar: z.boolean("Informe se a rota volta à origem.").optional() }, "Dados inválidos.");

/** De onde veio o ponto da parada: do endereço da carga, ou do centro da cidade do destino. */
export type PrecisaoDoPonto = "endereco" | "cidade";

export type PontoDaParada = Ponto & { precisao: PrecisaoDoPonto };

/** A medida da distância: linha reta (padrão) ou estrada (com `ROTA_URL`). */
export type MedidaDaDistancia = "reta" | "estrada";

/** O que `POST /api/manifestos/[id]/roteiro` devolve. Não grava nada: quem aplica é `PUT .../ordem`. */
export type RespostaDoRoteiro = Roteiro & {
  /** A cidade de origem achada ("Mirassol/SP"), ou `null`. */
  origem: string | null;
  voltar: boolean;
  /** A cidade achada de cada carga, pelo id; `null` é cidade não reconhecida. */
  cidades: Record<string, string | null>;
  /** Quantas cargas a entregar entraram na conta pelo endereço, e não pelo centro da cidade. */
  porEndereco: number;
  /** Como a distância foi medida. */
  medida: MedidaDaDistancia;
};

/**
 * A frase que acompanha a distância em toda tela: ninguém pode ler esse número
 * como km rodado, nem como tempo de viagem.
 */
export function avisoDaDistancia(medida: MedidaDaDistancia): string {
  return medida === "estrada"
    ? "por estrada, pelo mapa do OpenStreetMap, sem contar trânsito"
    : "em linha reta, entre os endereços localizados ou os centros das cidades: não é o km de estrada";
}

/** A frase sobre trânsito que acompanha o mapa e a ordem sugerida. */
export const AVISO_DO_TRANSITO = "Trânsito não entra na conta: não existe em fonte aberta. Para ver o trânsito, abra a rota no Google Maps.";

export type CargaDaViagem = {
  id: string;
  origin: string;
  destination: string;
  status: string;
  /** A coordenada do endereço da entrega, quando localizada. */
  deliveryLat?: number | null;
  deliveryLon?: number | null;
};

/** A UF escrita mais vezes nos textos ("Mirassol - SP"), ou `null` se nenhum traz UF. */
function ufMaisEscrita(textos: readonly string[]): string | null {
  const contagem = new Map<string, number>();
  for (const texto of textos) {
    const uf = ufDoTexto(texto);
    if (uf) contagem.set(uf, (contagem.get(uf) ?? 0) + 1);
  }
  let melhor: string | null = null;
  for (const [uf, vezes] of contagem) if (melhor === null || vezes > (contagem.get(melhor) ?? 0)) melhor = uf;
  return melhor;
}

/** A coordenada gravada na carga, ou `null` se não há (ou se o que há não é coordenada). */
export function pontoDaCarga(carga: Pick<CargaDaViagem, "deliveryLat" | "deliveryLon">): Ponto | null {
  const { deliveryLat: lat, deliveryLon: lon } = carga;
  if (typeof lat !== "number" || typeof lon !== "number" || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}

export type LugaresDaViagem = {
  /** A cidade de origem (a mais comum entre as cargas), ou `null`. */
  origem: Cidade | null;
  /** As paradas na ordem atual, cada uma com a cidade e o ponto do endereço. */
  paradas: ParadaDoRoteiro[];
  /** O lugar da última entrega feita: é de onde o caminho parte com a viagem na rua. */
  partida: Ponto | null;
};

/**
 * Onde fica cada coisa de uma viagem, a partir das cargas dela, já na ordem atual.
 *
 * - A origem é a origem mais comum das cargas.
 * - Cidade sem UF e com nome repetido em vários estados é procurada na UF da
 *   origem; se a própria origem é ambígua, na UF mais escrita nas cargas.
 * - Carga entregue não muda de lugar; com alguma entregue, o caminho parte do
 *   lugar da última entrega feita (é onde o caminhão está), não da origem.
 */
export function lugaresDaViagem(cargas: readonly CargaDaViagem[], indice: IndiceDeCidades): LugaresDaViagem {
  const textoDaOrigem = textoMaisComum(cargas.map((carga) => carga.origin));
  let origem = localizarCidade(textoDaOrigem, indice);
  const ufPreferida = origem?.uf ?? ufMaisEscrita(cargas.flatMap((carga) => [carga.origin, carga.destination]));
  if (!origem) origem = localizarCidade(textoDaOrigem, indice, ufPreferida);

  const paradas: ParadaDoRoteiro[] = cargas.map((carga) => ({
    id: carga.id,
    cidade: localizarCidade(carga.destination, indice, ufPreferida),
    ponto: pontoDaCarga(carga),
    feita: carga.status === "DELIVERED",
  }));
  const ultimaFeita = paradas.filter((parada) => parada.feita && lugarDaParada(parada)).pop();

  return { origem, paradas, partida: ultimaFeita ? lugarDaParada(ultimaFeita) : null };
}

/** O ponto de cada parada como o mapa e a rota recebem: a coordenada e de onde ela veio. `null` é sem localização. */
export function pontoDaParada(parada: Pick<ParadaDoRoteiro, "cidade" | "ponto">): PontoDaParada | null {
  if (parada.ponto) return { lat: parada.ponto.lat, lon: parada.ponto.lon, precisao: "endereco" };
  return parada.cidade ? { lat: parada.cidade.lat, lon: parada.cidade.lon, precisao: "cidade" } : null;
}

/** Todos os pontos que entram na conta de uma viagem, sem repetir: é o que a matriz por estrada precisa conhecer. */
export function pontosDaConta(lugares: LugaresDaViagem): Ponto[] {
  const pontos = new Map<string, Ponto>();
  const incluir = (ponto: Ponto | null) => {
    if (ponto) pontos.set(chaveDoPonto(ponto), { lat: ponto.lat, lon: ponto.lon });
  };
  incluir(lugares.origem);
  incluir(lugares.partida);
  for (const parada of lugares.paradas) if (!parada.feita) incluir(lugarDaParada(parada));
  return [...pontos.values()];
}

/**
 * O roteiro de uma viagem a partir das cargas dela, já na ordem atual. Com
 * `distancia` (a medida por estrada), a resposta diz `medida: "estrada"`.
 */
export function roteiroDaViagem(
  cargas: readonly CargaDaViagem[],
  indice: IndiceDeCidades,
  { voltar = true, distancia, lugares = lugaresDaViagem(cargas, indice) }: { voltar?: boolean; distancia?: Distancia | null; lugares?: LugaresDaViagem } = {},
): RespostaDoRoteiro {
  const { origem, paradas, partida } = lugares;
  return {
    ...sugerirRoteiro(paradas, { origem, partida, voltar, distancia: distancia ?? distanciaKm }),
    origem: origem ? nomeDaCidade(origem) : null,
    voltar,
    cidades: Object.fromEntries(paradas.map((parada) => [parada.id, parada.cidade ? nomeDaCidade(parada.cidade) : null])),
    porEndereco: paradas.filter((parada) => !parada.feita && parada.ponto).length,
    medida: distancia ? "estrada" : "reta",
  };
}
