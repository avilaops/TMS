/**
 * Código de barras Code 128, subconjunto B, sem dependência.
 *
 * O subconjunto B cobre os caracteres ASCII de 32 (espaço) a 126 (~): letras
 * maiúsculas e minúsculas, dígitos e pontuação. É o que basta para o código do
 * volume ("1234567890-02") e o da posição no depósito ("A-01-03").
 *
 * O símbolo é: início B, um padrão por caractere, o dígito verificador e o
 * fim. Cada padrão tem 11 módulos (3 barras e 3 espaços, alternados, começando
 * por barra); o fim tem 13 (uma barra a mais). A tabela abaixo é a da norma
 * (ISO/IEC 15417), escrita como as larguras de barra e espaço, em módulos.
 */

const PADROES = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
] as const;

/** Valor do símbolo de início do subconjunto B. */
export const INICIO_B = 104;
/** Valor do símbolo de fim. */
export const FIM = 106;
/** O dígito verificador é o resto da soma ponderada por este número. */
const MODULO = 103;

const PRIMEIRO_CARACTERE = 32;
const ULTIMO_CARACTERE = 126;

/** Zona de silêncio de cada lado, em módulos. A norma pede 10. */
export const ZONA_DE_SILENCIO = 10;

/** As larguras de barra e espaço do símbolo de valor `valor` (0 a 106). */
export const padraoDe = (valor: number): string => PADROES[valor];

/** Quantos símbolos a tabela tem: 103 de dado, 3 de início e o de fim. */
export const TOTAL_DE_PADROES = PADROES.length;

/** Só o que o subconjunto B escreve: ASCII de espaço a til, e ao menos um caractere. */
export function cabeNoCode128B(texto: string): boolean {
  if (texto.length === 0) return false;
  for (let i = 0; i < texto.length; i += 1) {
    const codigo = texto.charCodeAt(i);
    if (codigo < PRIMEIRO_CARACTERE || codigo > ULTIMO_CARACTERE) return false;
  }
  return true;
}

/** No subconjunto B o valor do caractere é o código ASCII menos 32. */
const valoresDoTexto = (texto: string): number[] => Array.from(texto, (c) => c.charCodeAt(0) - PRIMEIRO_CARACTERE);

/**
 * Dígito verificador: início mais cada valor vezes a sua posição (a primeira
 * é 1), resto da divisão por 103.
 */
export function digitoVerificador(valores: readonly number[]): number {
  return valores.reduce((soma, valor, i) => soma + valor * (i + 1), INICIO_B) % MODULO;
}

/**
 * Os valores do símbolo inteiro, na ordem em que são impressos: início B, os
 * caracteres, o dígito verificador e o fim. `null` se o texto tem caractere
 * fora do subconjunto B (acento, por exemplo) ou está vazio.
 */
export function valoresCode128B(texto: string): number[] | null {
  if (!cabeNoCode128B(texto)) return null;
  const dados = valoresDoTexto(texto);
  return [INICIO_B, ...dados, digitoVerificador(dados), FIM];
}

/** Larguras viram módulos: "212222" → "11011001100" (barra = 1, espaço = 0). */
const modulosDoPadrao = (larguras: string): string =>
  Array.from(larguras, (largura, i) => (i % 2 === 0 ? "1" : "0").repeat(Number(largura))).join("");

/**
 * O código de barras como uma sequência de módulos, sem a zona de silêncio:
 * "1" é barra, "0" é espaço. `null` se o texto não cabe no subconjunto B.
 */
export function code128B(texto: string): string | null {
  const valores = valoresCode128B(texto);
  return valores ? valores.map((valor) => modulosDoPadrao(PADROES[valor])).join("") : null;
}

export type Barra = { x: number; largura: number };

/**
 * As barras a desenhar, em módulos, já deslocadas pela zona de silêncio, e a
 * largura total (com as duas zonas). Módulos vizinhos viram uma barra só, para
 * a impressão não deixar fresta entre retângulos colados.
 */
export function barrasCode128B(texto: string): { barras: Barra[]; largura: number } | null {
  const modulos = code128B(texto);
  if (modulos === null) return null;

  const barras: Barra[] = [];
  for (const trecho of modulos.matchAll(/1+/g)) {
    barras.push({ x: ZONA_DE_SILENCIO + trecho.index, largura: trecho[0].length });
  }
  return { barras, largura: modulos.length + 2 * ZONA_DE_SILENCIO };
}
