/**
 * O percurso do MDF-e (`ide/infPercurso`): as UFs que o veículo atravessa ENTRE
 * a UF de carregamento e a de descarregamento, na ordem da viagem.
 *
 * A regra da SEFAZ (MOC do MDF-e 3.00b, Anexo I, regra F90, rejeição 663): o
 * percurso é obrigatório "sempre que existir pelo menos uma UF entre a UF de
 * carregamento e a UF de descarregamento", e é conferido pelas divisas
 * possíveis, na ordem informada.
 *
 * O que este sistema faz, e o que não faz:
 * - mesma UF ou UFs vizinhas: não há percurso a informar;
 * - UFs não vizinhas com UM ÚNICO caminho mais curto pelas divisas (SP → SC só
 *   passa pelo PR): o percurso é esse, e a pessoa pode trocar;
 * - mais de um caminho mais curto (SP → BA pode ser por MG ou por RJ e ES...):
 *   o sistema NÃO escolhe rota. A pessoa informa, e a emissão fica pendente até
 *   ela informar.
 * O percurso informado é sempre conferido pelas divisas.
 *
 * Tudo aqui é puro e pode ir para a tela.
 */

/** As divisas terrestres entre as UFs (IBGE). Simétrica: os testes conferem. */
export const DIVISAS: Readonly<Record<string, readonly string[]>> = {
  AC: ["AM", "RO"],
  AL: ["BA", "PE", "SE"],
  AM: ["AC", "MT", "PA", "RO", "RR"],
  AP: ["PA"],
  BA: ["AL", "ES", "GO", "MG", "PE", "PI", "SE", "TO"],
  CE: ["PB", "PE", "PI", "RN"],
  DF: ["GO", "MG"],
  ES: ["BA", "MG", "RJ"],
  GO: ["BA", "DF", "MG", "MS", "MT", "TO"],
  MA: ["PA", "PI", "TO"],
  MG: ["BA", "DF", "ES", "GO", "MS", "RJ", "SP"],
  MS: ["GO", "MG", "MT", "PR", "SP"],
  MT: ["AM", "GO", "MS", "PA", "RO", "TO"],
  PA: ["AM", "AP", "MA", "MT", "RR", "TO"],
  PB: ["CE", "PE", "RN"],
  PE: ["AL", "BA", "CE", "PB", "PI"],
  PI: ["BA", "CE", "MA", "PE", "TO"],
  PR: ["MS", "SC", "SP"],
  RJ: ["ES", "MG", "SP"],
  RN: ["CE", "PB"],
  RO: ["AC", "AM", "MT"],
  RR: ["AM", "PA"],
  RS: ["SC"],
  SC: ["PR", "RS"],
  SE: ["AL", "BA"],
  SP: ["MG", "MS", "PR", "RJ"],
  TO: ["BA", "GO", "MA", "MT", "PA", "PI"],
};

/** O esquema aceita até 25 UFs de percurso. */
export const MAXIMO_DE_UFS_NO_PERCURSO = 25;

export const saoVizinhas = (a: string, b: string) => (DIVISAS[a] ?? []).includes(b);

/** Todos os caminhos mais curtos de `inicio` a `fim`, pelas divisas, só com as UFs do meio. */
export function caminhosMaisCurtos(inicio: string, fim: string): string[][] {
  if (!DIVISAS[inicio] || !DIVISAS[fim] || inicio === fim) return [];
  // Busca em largura, guardando de onde se chega a cada UF pela menor distância.
  const distancia = new Map<string, number>([[inicio, 0]]);
  const anteriores = new Map<string, string[]>();
  let fronteira = [inicio];
  while (fronteira.length > 0 && !distancia.has(fim)) {
    const proxima: string[] = [];
    for (const uf of fronteira) {
      for (const vizinha of DIVISAS[uf]) {
        const passo = (distancia.get(uf) ?? 0) + 1;
        if (!distancia.has(vizinha)) {
          distancia.set(vizinha, passo);
          anteriores.set(vizinha, [uf]);
          proxima.push(vizinha);
        } else if (distancia.get(vizinha) === passo) {
          anteriores.get(vizinha)?.push(uf);
        }
      }
    }
    fronteira = proxima;
  }
  if (!distancia.has(fim)) return [];

  const caminhos: string[][] = [];
  const voltar = (uf: string, resto: string[]) => {
    if (uf === inicio) {
      caminhos.push(resto);
      return;
    }
    for (const anterior of anteriores.get(uf) ?? []) voltar(anterior, anterior === inicio ? resto : [anterior, ...resto]);
  };
  voltar(fim, []);
  return caminhos.sort((a, b) => a.join().localeCompare(b.join()));
}

export type PercursoInferido =
  /** Mesma UF ou UFs vizinhas: nada a informar. */
  | { tipo: "direto"; percurso: readonly [] }
  /** Um caminho só: é o percurso, salvo a pessoa trocar. */
  | { tipo: "unico"; percurso: readonly string[] }
  /** Mais de um caminho possível: a pessoa informa. `opcoes` são os caminhos mais curtos, para ela escolher. */
  | { tipo: "informar"; opcoes: readonly (readonly string[])[] };

/** O que dá para dizer do percurso só pelas UFs de carregamento e descarregamento. */
export function inferirPercurso(inicio: string, fim: string): PercursoInferido {
  if (inicio === fim || saoVizinhas(inicio, fim)) return { tipo: "direto", percurso: [] };
  const caminhos = caminhosMaisCurtos(inicio, fim);
  if (caminhos.length === 1) return { tipo: "unico", percurso: caminhos[0] };
  return { tipo: "informar", opcoes: caminhos };
}

export const PERCURSO_OBRIGATORIO = (inicio: string, fim: string) =>
  `Informe as UFs do percurso entre ${inicio} e ${fim}, na ordem da viagem: há mais de um caminho possível e o sistema não escolhe a rota.`;

/**
 * O que há de errado no percurso informado. Vazio = serve. Confere o que a
 * SEFAZ confere (regra F90): cada passo, do carregamento ao descarregamento,
 * cruza uma divisa que existe.
 */
export function errosDoPercurso(inicio: string, fim: string, percurso: readonly string[]): string[] {
  const erros: string[] = [];
  if (percurso.length > MAXIMO_DE_UFS_NO_PERCURSO) erros.push(`O percurso aceita no máximo ${MAXIMO_DE_UFS_NO_PERCURSO} UFs.`);
  const desconhecida = percurso.find((uf) => !DIVISAS[uf]);
  if (desconhecida) return [...erros, `UF desconhecida no percurso: ${desconhecida}.`];
  if (percurso.includes(inicio) || percurso.includes(fim)) erros.push("O percurso leva só as UFs do meio: não repita a UF de carregamento nem a de descarregamento.");
  if (new Set(percurso).size !== percurso.length) erros.push("O percurso tem UF repetida.");
  if (erros.length > 0) return erros;

  const rota = [inicio, ...percurso, fim];
  for (let i = 0; i < rota.length - 1; i += 1) {
    if (rota[i] !== rota[i + 1] && !saoVizinhas(rota[i], rota[i + 1])) {
      return [`Percurso inválido: ${rota[i]} e ${rota[i + 1]} não fazem divisa. Informe as UFs na ordem em que o veículo passa.`];
    }
  }
  return [];
}
