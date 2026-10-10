/**
 * Texto e número como o XML do CT-e exige.
 *
 * O tipo `TString` do esquema (tiposGeralCTe_v4.00.xsd) só aceita caracteres de
 * `!` a `ÿ` (Latin-1 imprimível), sem espaço no começo nem no fim. Um nome com
 * travessão, aspas curvas ou emoji faria a SEFAZ recusar o documento por falha
 * de esquema: aqui eles são trocados pelo equivalente simples ou retirados.
 */

const EQUIVALENTES: Record<string, string> = {
  "–": "-",
  "—": "-",
  "‘": "'",
  "’": "'",
  "“": '"',
  "”": '"',
  "…": "...",
  "•": "-",
  "№": "No",
  " ": " ",
};

/** O texto dentro do que `TString` aceita, cortado em `maximo`. Vazio quando nada sobra. */
export function textoDoXml(texto: string | null | undefined, maximo: number): string {
  const trocado = (texto ?? "").normalize("NFC").replace(/[–—‘’“”…•№ ]/g, (c) => EQUIVALENTES[c] ?? "");
  let limpo = "";
  for (const caractere of trocado) {
    const codigo = caractere.codePointAt(0) ?? 0;
    if (codigo === 0x9 || codigo === 0xa || codigo === 0xd) limpo += " ";
    else if ((codigo >= 0x20 && codigo <= 0x7e) || (codigo >= 0xa1 && codigo <= 0xff)) limpo += caractere;
  }
  return limpo.replace(/ +/g, " ").trim().slice(0, maximo).trim();
}

/**
 * O que precisa de entidade no TEXTO de um elemento: `&`, `<` e `>`. Aspas não
 * (nenhum texto de fora vai em atributo), e é assim que a biblioteca da
 * assinatura reescreve o documento: o XML montado e o assinado ficam iguais.
 */
export const escapar = (texto: string) => texto.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** `<nome>valor</nome>`, ou nada quando o valor é vazio: campo opcional sem conteúdo não vai no XML (MOC, item 3.2.5). */
export function tag(nome: string, valor: string | null | undefined): string {
  return valor === null || valor === undefined || valor === "" ? "" : `<${nome}>${escapar(valor)}</${nome}>`;
}

/** Grupo com filhos já montados, ou nada quando não há filho nenhum. */
export function grupo(nome: string, filhos: string, atributos = ""): string {
  return filhos === "" ? "" : `<${nome}${atributos}>${filhos}</${nome}>`;
}

/** Arredonda para centavos sem resto de ponto flutuante. */
export const centavos = (valor: number) => Math.round((valor + Number.EPSILON) * 100) / 100;

/** Número com casas fixas e ponto decimal (`TDec_1302`, `TDec_1104`...). */
export const decimal = (valor: number, casas: number) => valor.toFixed(casas);

/** Só os dígitos. */
export const digitos = (texto: string | null | undefined) => (texto ?? "").replace(/\D/g, "");
