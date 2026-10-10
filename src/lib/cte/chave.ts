import { digitoDaChave } from "@/lib/nfe";

/**
 * A chave de acesso do CT-e (44 dígitos), como o MOC 4.00 a define:
 *
 *   cUF (2) + AAMM da emissão (4) + CNPJ do emitente (14) + modelo (2) +
 *   série (3) + número (9) + tipo de emissão (1) + cCT (8) + dígito (1)
 *
 * O dígito verificador é o mesmo módulo 11 da NF-e (`digitoDaChave`, em
 * src/lib/nfe.ts), que já conta o CNPJ alfanumérico: as 12 primeiras posições
 * do CNPJ podem ter letras (Nota Técnica Conjunta 2025.001). Tudo aqui é puro: o `cCT` aleatório vem de quem chama
 * (`sortearCodigo`, que a tela nunca importa).
 */

export const MODELO_DO_CTE = "57";
/** Emissão normal: é a única que este sistema faz (sem contingência). */
export const TIPO_DE_EMISSAO_NORMAL = "1";

/** Código IBGE de cada UF, que abre a chave e vai em `ide/cUF`. */
export const CODIGO_DA_UF: Record<string, string> = {
  RO: "11",
  AC: "12",
  AM: "13",
  RR: "14",
  PA: "15",
  AP: "16",
  TO: "17",
  MA: "21",
  PI: "22",
  CE: "23",
  RN: "24",
  PB: "25",
  PE: "26",
  AL: "27",
  SE: "28",
  BA: "29",
  MG: "31",
  ES: "32",
  RJ: "33",
  SP: "35",
  PR: "41",
  SC: "42",
  RS: "43",
  MS: "50",
  MT: "51",
  GO: "52",
  DF: "53",
};

export type PartesDaChaveDoCte = {
  uf: string;
  /** Instante da emissão: entram o ano e o mês no relógio de Brasília. */
  emissao: Date;
  /** CNPJ do emitente, 14 dígitos. */
  cnpj: string;
  serie: number;
  numero: number;
  /** Código numérico aleatório, 8 dígitos. */
  codigo: string;
};

export class ChaveInvalida extends Error {}

// O Brasil não tem horário de verão desde 2019: o relógio de Brasília é UTC-3 o ano inteiro.
const DESLOCAMENTO_DE_BRASILIA_MS = -3 * 3_600_000;

/** O instante no relógio de Brasília, como o XML escreve: `2026-10-10T08:15:00-03:00`. */
export function dataHoraDoXml(instante: Date): string {
  const local = new Date(instante.getTime() + DESLOCAMENTO_DE_BRASILIA_MS);
  return `${local.toISOString().slice(0, 19)}-03:00`;
}

/** "AAMM" da emissão, no relógio de Brasília. */
export const anoEMes = (instante: Date) => dataHoraDoXml(instante).replace(/^\d\d(\d\d)-(\d\d).*$/, "$1$2");

/** A chave de 44 dígitos, com o dígito verificador. Parte fora do formato é erro de programação, não de usuário. */
export function chaveDoCte(partes: PartesDaChaveDoCte): string {
  const uf = CODIGO_DA_UF[partes.uf];
  if (!uf) throw new ChaveInvalida(`UF desconhecida: ${partes.uf}`);
  // Doze letras maiúsculas ou dígitos e dois dígitos verificadores (CNPJ alfanumérico, NT Conjunta 2025.001).
  if (!/^[A-Z0-9]{12}[0-9]{2}$/.test(partes.cnpj)) throw new ChaveInvalida("O CNPJ do emitente precisa ter 14 posições.");
  if (!Number.isInteger(partes.serie) || partes.serie < 0 || partes.serie > 999) throw new ChaveInvalida("Série fora de 0 a 999.");
  if (!Number.isInteger(partes.numero) || partes.numero < 1 || partes.numero > 999_999_999) throw new ChaveInvalida("Número fora de 1 a 999999999.");
  if (!/^\d{8}$/.test(partes.codigo)) throw new ChaveInvalida("O código numérico (cCT) precisa ter 8 dígitos.");

  const corpo = [
    uf,
    anoEMes(partes.emissao),
    partes.cnpj,
    MODELO_DO_CTE,
    String(partes.serie).padStart(3, "0"),
    String(partes.numero).padStart(9, "0"),
    TIPO_DE_EMISSAO_NORMAL,
    partes.codigo,
  ].join("");
  const digito = digitoDaChave(corpo);
  if (digito === null) throw new ChaveInvalida("A chave montada não tem 43 posições.");
  return `${corpo}${digito}`;
}

/** As partes de uma chave de CT-e já montada. */
export function lerChaveDoCte(chave: string) {
  return {
    codigoDaUf: chave.slice(0, 2),
    anoEMes: chave.slice(2, 6),
    cnpj: chave.slice(6, 20),
    modelo: chave.slice(20, 22),
    serie: Number(chave.slice(22, 25)),
    numero: Number(chave.slice(25, 34)),
    tipoDeEmissao: chave.slice(34, 35),
    codigo: chave.slice(35, 43),
    digito: chave.slice(43),
  };
}
