import { z } from "zod";
import { chaveDaCidade } from "@/lib/frete";
import { normalizeText } from "@/lib/normalization";

/**
 * Roteirização por cidade: a ordem sugerida das entregas de uma viagem.
 *
 * O que esta conta é, e o que não é:
 * - Trabalha com a CIDADE de cada entrega, não com o endereço. A distância é em
 *   linha reta (haversine) entre os centros das cidades: serve para pôr as
 *   cidades numa ordem que não vai e volta, não para dizer quantos km o caminhão
 *   roda. Não conhece estrada, trânsito, pedágio nem janela de entrega.
 * - A ordem sai de "vizinho mais próximo" seguido de melhoria 2-opt. Entregas
 *   na mesma cidade ficam juntas, na ordem em que já estavam entre si.
 * - Carga cuja cidade não foi achada ("sem localização") vai para o fim, na
 *   ordem atual, e é devolvida à parte para a tela avisar.
 *
 * Tudo aqui é puro: as coordenadas chegam por parâmetro (`IndiceDeCidades`). A
 * tabela dos municípios mora em `src/lib/municipios.ts`, que só o servidor
 * importa; a tela importa daqui só os tipos.
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

type Ponto = Pick<Cidade, "lat" | "lon">;

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
export function comprimentoKm(pontos: readonly Ponto[], partida: Ponto | null, retorno: Ponto | null): number {
  const caminho = [...(partida ? [partida] : []), ...pontos, ...(retorno ? [retorno] : [])];
  let total = 0;
  for (let i = 1; i < caminho.length; i += 1) total += distanciaKm(caminho[i - 1], caminho[i]);
  return total;
}

/* -------------------------------- Ordem sugerida ------------------------------ */

/** Vizinho mais próximo: da partida (ou do primeiro ponto), sempre para o ponto mais perto que falta. */
function vizinhoMaisProximo<T extends Ponto>(pontos: readonly T[], partida: Ponto | null): T[] {
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
      const d = distanciaKm(atual as Ponto, faltam[i]);
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
 * sai de quatro distâncias. Sem partida, o primeiro ponto fica preso no lugar
 * (é de onde o caminho sai).
 */
function doisOpt<T extends Ponto>(ordem: readonly T[], partida: Ponto | null, retorno: Ponto | null): T[] {
  const rota = [...ordem];
  const n = rota.length;
  const d = (a: Ponto | null, b: Ponto | null) => (a && b ? distanciaKm(a, b) : 0);
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
  /** Já entregue: fica onde está, no começo, e não entra na conta. */
  feita?: boolean;
};

export type Roteiro = {
  /** Todas as cargas, na ordem sugerida: feitas, localizadas e, no fim, as sem localização. */
  ordem: string[];
  /** Km em linha reta, entre centros das cidades, na ordem atual e na sugerida. Uma casa decimal. */
  distanciaAntesKm: number;
  distanciaDepoisKm: number;
  /** Cargas a entregar cuja cidade não foi achada. */
  naoLocalizadas: string[];
  /** `false` quando a ordem atual já é a melhor que a conta achou (ou não há o que ordenar). */
  mudou: boolean;
};

const umaCasa = (valor: number) => Math.round(valor * 10) / 10;
const mesmaCidade = (a: Cidade, b: Cidade) => a.nome === b.nome && a.uf === b.uf;

/**
 * A ordem sugerida das entregas.
 *
 * - `origem`: de onde o caminhão sai (e para onde volta, com `voltar`). Sem ela
 *   o caminho começa na primeira entrega da ordem atual, que fica onde está.
 * - `partida`: de onde o caminho começa quando não é a origem (viagem já na rua:
 *   a cidade da última entrega feita). Padrão: a origem.
 * - `voltar`: conta a volta à origem (padrão: sim). Muda a ordem: sem a volta, a
 *   melhor rota termina longe; com ela, fecha o laço.
 *
 * A sugestão nunca é pior que a ordem atual: se a conta não achar caminho mais
 * curto, devolve a ordem atual com `mudou: false`.
 */
export function sugerirRoteiro(
  paradas: readonly ParadaDoRoteiro[],
  { origem, partida, voltar = true }: { origem: Cidade | null; partida?: Cidade | null; voltar?: boolean },
): Roteiro {
  const feitas = paradas.filter((parada) => parada.feita);
  const aEntregar = paradas.filter((parada) => !parada.feita);
  const localizadas = aEntregar.filter((parada): parada is ParadaDoRoteiro & { cidade: Cidade } => parada.cidade !== null);
  const semLocal = aEntregar.filter((parada) => parada.cidade === null);

  const inicio = partida ?? origem;
  const retorno = voltar ? origem : null;

  // Uma parada por cidade, na ordem em que as cidades aparecem; as cargas de cada uma ficam juntas.
  const grupos: { cidade: Cidade; lat: number; lon: number; ids: string[] }[] = [];
  for (const parada of localizadas) {
    const grupo = grupos.find((g) => mesmaCidade(g.cidade, parada.cidade));
    if (grupo) grupo.ids.push(parada.id);
    else grupos.push({ cidade: parada.cidade, lat: parada.cidade.lat, lon: parada.cidade.lon, ids: [parada.id] });
  }

  const antes = comprimentoKm(localizadas.map((parada) => parada.cidade), inicio, retorno);

  // Dois pontos de partida para o 2-opt: o vizinho mais próximo e a própria ordem atual. Fica o menor.
  const candidatas = [doisOpt(vizinhoMaisProximo(grupos, inicio), inicio, retorno), doisOpt(grupos, inicio, retorno)];
  let melhor = candidatas[0];
  let depois = comprimentoKm(melhor, inicio, retorno);
  for (const candidata of candidatas.slice(1)) {
    const comprimento = comprimentoKm(candidata, inicio, retorno);
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

/** O que `POST /api/manifestos/[id]/roteiro` devolve. Não grava nada: quem aplica é `PUT .../ordem`. */
export type RespostaDoRoteiro = Roteiro & {
  /** A cidade de origem achada ("Mirassol/SP"), ou `null`. */
  origem: string | null;
  voltar: boolean;
  /** A cidade achada de cada carga, pelo id; `null` é sem localização. */
  cidades: Record<string, string | null>;
};

/** A frase que acompanha a distância em toda tela: ninguém pode ler esse número como km de estrada. */
export const AVISO_DA_DISTANCIA = "em linha reta, entre centros das cidades";

export type CargaDaViagem = { id: string; origin: string; destination: string; status: string };

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

/**
 * O roteiro de uma viagem a partir das cargas dela, já na ordem atual.
 *
 * - A origem é a origem mais comum das cargas.
 * - Cidade sem UF e com nome repetido em vários estados é procurada na UF da
 *   origem; se a própria origem é ambígua, na UF mais escrita nas cargas.
 * - Carga entregue não muda de lugar; com alguma entregue, o caminho parte da
 *   cidade da última entrega feita (é onde o caminhão está), não da origem.
 */
export function roteiroDaViagem(cargas: readonly CargaDaViagem[], indice: IndiceDeCidades, { voltar = true }: { voltar?: boolean } = {}): RespostaDoRoteiro {
  const textoDaOrigem = textoMaisComum(cargas.map((carga) => carga.origin));
  let origem = localizarCidade(textoDaOrigem, indice);
  const ufPreferida = origem?.uf ?? ufMaisEscrita(cargas.flatMap((carga) => [carga.origin, carga.destination]));
  if (!origem) origem = localizarCidade(textoDaOrigem, indice, ufPreferida);

  const paradas: ParadaDoRoteiro[] = cargas.map((carga) => ({
    id: carga.id,
    cidade: localizarCidade(carga.destination, indice, ufPreferida),
    feita: carga.status === "DELIVERED",
  }));
  const ultimaFeita = paradas.filter((parada) => parada.feita && parada.cidade).pop();

  return {
    ...sugerirRoteiro(paradas, { origem, partida: ultimaFeita?.cidade ?? null, voltar }),
    origem: origem ? nomeDaCidade(origem) : null,
    voltar,
    cidades: Object.fromEntries(paradas.map((parada) => [parada.id, parada.cidade ? nomeDaCidade(parada.cidade) : null])),
  };
}
