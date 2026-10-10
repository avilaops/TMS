import { digitoDaChave } from "@/lib/nfe";
import { CODIGO_DA_UF, ChaveInvalida, TIPO_DE_EMISSAO_NORMAL, anoEMes } from "@/lib/cte/chave";

/**
 * A chave de acesso do MDF-e (44 posições), como o MOC do MDF-e 3.00b a define
 * (Anexo I, campo `Id`, e Visão Geral, item 9.2):
 *
 *   cUF (2) + AAMM da emissão (4) + CNPJ do emitente (14) + modelo 58 (2) +
 *   série (3) + número (9) + tipo de emissão (1) + cMDF (8) + dígito (1)
 *
 * É a mesma conta da chave do CT-e e da NF-e (módulo 11, `digitoDaChave`), que
 * já vale para o CNPJ alfanumérico (NT Conjunta 2025.001; o tipo `TChMDFe` do
 * pacote de esquemas aceita letras nas 12 primeiras posições do CNPJ desde a
 * NT 2025.001 do MDF-e). Tudo aqui é puro.
 *
 * ATENÇÃO, CNPJ COM LETRAS: a chave é montada e conferida, mas o atributo `Id`
 * do `infMDFe` no pacote de esquemas vigente (PL_MDFe_300b_NT012025, de
 * 25/04/2026) ainda é `MDFe[0-9]{44}`: um MDF-e de emitente com CNPJ
 * alfanumérico não passa nesse esquema. Os testes registram isso
 * (tests/mdfe.test.ts); quando o portal publicar o pacote corrigido, basta
 * trocar os arquivos de fiscal/esquemas/mdfe-3.00.
 */

export const MODELO_DO_MDFE = "58";

export type PartesDaChaveDoMdfe = {
  uf: string;
  /** Instante da emissão: entram o ano e o mês no relógio da UF do emitente (o mesmo do `dhEmi`). */
  emissao: Date;
  /** CNPJ do emitente, 14 posições. */
  cnpj: string;
  serie: number;
  numero: number;
  /** Código numérico aleatório (`cMDF`), 8 dígitos. */
  codigo: string;
};

/** A chave de 44 posições, com o dígito verificador. Parte fora do formato é erro de programação, não de usuário. */
export function chaveDoMdfe(partes: PartesDaChaveDoMdfe): string {
  const uf = CODIGO_DA_UF[partes.uf];
  if (!uf) throw new ChaveInvalida(`UF desconhecida: ${partes.uf}`);
  if (!/^[A-Z0-9]{12}[0-9]{2}$/.test(partes.cnpj)) throw new ChaveInvalida("O CNPJ do emitente precisa ter 14 posições.");
  // Série de 920 a 969 é de emitente pessoa física (MOC, Anexo I, regra F69): este sistema só emite com CNPJ.
  if (!Number.isInteger(partes.serie) || partes.serie < 0 || partes.serie > 999) throw new ChaveInvalida("Série fora de 0 a 999.");
  if (!Number.isInteger(partes.numero) || partes.numero < 1 || partes.numero > 999_999_999) throw new ChaveInvalida("Número fora de 1 a 999999999.");
  if (!/^\d{8}$/.test(partes.codigo)) throw new ChaveInvalida("O código numérico (cMDF) precisa ter 8 dígitos.");

  const corpo = [
    uf,
    anoEMes(partes.emissao, partes.uf),
    partes.cnpj,
    MODELO_DO_MDFE,
    String(partes.serie).padStart(3, "0"),
    String(partes.numero).padStart(9, "0"),
    TIPO_DE_EMISSAO_NORMAL,
    partes.codigo,
  ].join("");
  const digito = digitoDaChave(corpo);
  if (digito === null) throw new ChaveInvalida("A chave montada não tem 43 posições.");
  return `${corpo}${digito}`;
}

/** O formato de uma chave de acesso de DF-e: 44 posições, com letras só no CNPJ. */
export const FORMATO_DA_CHAVE = /^[0-9]{6}[A-Z0-9]{12}[0-9]{26}$/;

/** O modelo do documento de uma chave (55 = NF-e, 57 = CT-e, 58 = MDF-e). */
export const modeloDaChave = (chave: string) => chave.slice(20, 22);

/** O CNPJ do emitente de uma chave. */
export const cnpjDaChave = (chave: string) => chave.slice(6, 20);

/** "AAMM" de uma chave. */
export const anoEMesDaChave = (chave: string) => chave.slice(2, 6);
