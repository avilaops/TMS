/**
 * Chave de acesso dos documentos fiscais eletrônicos (NF-e, CT-e e MDF-e têm o
 * mesmo formato): limpar, calcular o dígito verificador e conferir.
 *
 * Fica num arquivo sem dependência nenhuma porque os schemas da carga
 * (src/lib/coletas.ts, por src/lib/redespacho.ts) precisam conferir uma chave,
 * e src/lib/nfe.ts, que era a casa destas funções, importa os schemas da
 * carga. src/lib/nfe.ts continua exportando tudo daqui.
 */

/**
 * O formato da chave desde o CNPJ alfanumérico (Nota Técnica Conjunta 2025.001,
 * item 5, em produção desde 06/07/2026): letras maiúsculas só nas 12 primeiras
 * posições do CNPJ do emitente. A chave só de dígitos é o caso particular.
 */
const CORPO_DA_CHAVE = /^[0-9]{6}[A-Z0-9]{12}[0-9]{25}$/;
const CHAVE_INTEIRA = /^[0-9]{6}[A-Z0-9]{12}[0-9]{26}$/;

/** Uma chave como a pessoa cola (com espaços, pontos, minúsculas) no formato do documento: só letras e dígitos, em maiúsculas. */
export const limparChave = (texto: string) => texto.replace(/[^0-9a-zA-Z]/g, "").toUpperCase();

/**
 * Dígito verificador da chave: módulo 11 sobre os 43 primeiros caracteres, com
 * pesos de 2 a 9 da direita para a esquerda. Resto 0 ou 1 dá dígito 0. Cada
 * caractere vale o código ASCII menos 48 (NT Conjunta 2025.001): um dígito
 * vale ele mesmo, "A" vale 17.
 */
export function digitoDaChave(corpo: string): number | null {
  if (!CORPO_DA_CHAVE.test(corpo)) return null;
  let soma = 0;
  for (let i = 0; i < corpo.length; i += 1) {
    const peso = 2 + (i % 8);
    soma += (corpo.charCodeAt(corpo.length - 1 - i) - 48) * peso;
  }
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

export function chaveValida(chave: string): boolean {
  if (!CHAVE_INTEIRA.test(chave)) return false;
  return digitoDaChave(chave.slice(0, 43)) === Number(chave[43]);
}
