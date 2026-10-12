import { z } from "zod";
import { cnpjValido, limparCnpj } from "@/lib/cte";
import { CODIGO_DA_UF, MODELO_DO_CTE } from "@/lib/cte/chave";
import { CAMPOS_DE_ENDERECO, cepFormatado } from "@/lib/endereco";
import { chaveValida, limparChave } from "@/lib/chave-dfe";
import { cpfValido } from "@/lib/mdfe";

/**
 * Redespacho, subcontratação e redespacho intermediário: o que a carga guarda
 * para o CT-e sair com o tipo de serviço certo (`ide/tpServ`), o documento de
 * transporte anterior (`infCTeNorm/docAnt`) e o expedidor e o recebedor
 * (`exped` e `receb`).
 *
 * É o caso em que OUTRA transportadora contrata esta: ela é o cliente pagador
 * da carga e o CT-e dela é o documento anterior. O caso inverso (esta empresa
 * contratar outra transportadora) não é daqui.
 *
 * Fontes: MOC do CT-e 4.00, Anexo I (leiaute, campos 25, 136 a 171 e 337 a 353,
 * e regras de validação G003, G004, G019, G020, G036, G037 e G053 a G069) e o
 * esquema `cteTiposBasico_v4.00.xsd` do pacote PL_CTe_400. A definição legal de
 * cada tipo de serviço (Convênio SINIEF 06/89) e o Ajuste SINIEF 09/07 NÃO
 * foram lidos na fonte oficial: o site do CONFAZ recusou a conexão em
 * 12/10/2026. Por isso as frases daqui dizem o que o documento exige em cada
 * tipo, e não quando a operação é de um tipo ou de outro: isso é com o contador.
 *
 * Tudo aqui é puro e também é importado pelas telas: nada daqui pode puxar o
 * que só existe no servidor.
 */

/* ------------------------------- Tipo de serviço ------------------------------ */

export const TIPOS_DE_SERVICO = ["NORMAL", "SUBCONTRACT", "REDISPATCH", "INTERMEDIATE"] as const;
export type TipoDeServico = (typeof TIPOS_DE_SERVICO)[number];

/**
 * O `tpServ` de cada tipo (MOC 4.00, Anexo I, campo 25 do `ide`: 0 - Normal;
 * 1 - Subcontratação; 2 - Redespacho; 3 - Redespacho Intermediário). O 4
 * (serviço vinculado a multimodal) não é emitido por este sistema.
 */
export const TP_SERV: Record<TipoDeServico, "0" | "1" | "2" | "3"> = { NORMAL: "0", SUBCONTRACT: "1", REDISPATCH: "2", INTERMEDIATE: "3" };

export const ROTULO_DO_SERVICO: Record<TipoDeServico, string> = {
  NORMAL: "Normal",
  SUBCONTRACT: "Subcontratação",
  REDISPATCH: "Redespacho",
  INTERMEDIATE: "Redespacho intermediário",
};

/** O que o CT-e de cada tipo exige, em uma linha. Não diz quando a operação é de cada tipo: isso é com o contador. */
export const EXIGENCIA_DO_SERVICO: Record<TipoDeServico, string> = {
  NORMAL: "Sem documento de transporte anterior.",
  SUBCONTRACT: "Exige a chave do CT-e da transportadora que contratou você: ela é o cliente pagador (o tomador).",
  REDISPATCH: "Exige a chave do CT-e da transportadora do trecho anterior: ela é o cliente pagador (o tomador).",
  INTERMEDIATE: "Exige a chave do CT-e anterior, o expedidor e o recebedor. As NF-e não vão no CT-e.",
};

/** A linha que acompanha a escolha do tipo, na tela e na conferência. */
export const QUEM_DECIDE_O_SERVICO = "Em dúvida sobre o tipo, confirme com o contador: o sistema não decide por você.";

/** O tipo gravado na carga; o que não for um dos quatro é serviço normal. */
export const tipoDeServico = (valor: string | null | undefined): TipoDeServico => ((TIPOS_DE_SERVICO as readonly string[]).includes(valor ?? "") ? (valor as TipoDeServico) : "NORMAL");

/* ---------------------------- Chave do CT-e anterior -------------------------- */

const UF_DO_CODIGO = Object.fromEntries(Object.entries(CODIGO_DA_UF).map(([uf, codigo]) => [codigo, uf])) as Record<string, string>;

/** O primeiro ano em que existe CT-e (MOC 4.00, Anexo I, regra G065: "Ano < 2009"). */
const PRIMEIRO_ANO_DO_CTE = 2009;

export const CHAVE_DO_CTE_ANTERIOR_MESSAGE = "A chave do CT-e anterior precisa ter 44 posições, com o dígito verificador certo.";
export const CHAVE_NAO_E_DE_CTE = "A chave informada não é de CT-e (modelo 57). O documento anterior é o CT-e da outra transportadora, não a NF-e.";

/** O que a chave de um CT-e diz de quem o emitiu: o CNPJ (posições 7 a 20) e a UF (as 2 primeiras, o código IBGE). */
export function emissorDaChave(chave: string): { cnpj: string; uf: string | null } {
  return { cnpj: chave.slice(6, 20), uf: UF_DO_CODIGO[chave.slice(0, 2)] ?? null };
}

/**
 * Por que a chave não serve como CT-e anterior, ou `null`. É o que a SEFAZ
 * confere na regra G065 do Anexo I (rejeição 844): UF, ano (de 2009 ao atual),
 * mês, CNPJ do emitente, modelo 57, número diferente de zero e dígito
 * verificador. A existência do CT-e na base da SEFAZ (regras G066 a G068) só
 * ela sabe.
 */
export function problemaDaChaveDoCteAnterior(chave: string, agora: Date = new Date()): string | null {
  if (!chaveValida(chave)) return CHAVE_DO_CTE_ANTERIOR_MESSAGE;
  if (chave.slice(20, 22) !== MODELO_DO_CTE) return CHAVE_NAO_E_DE_CTE;
  const { cnpj, uf } = emissorDaChave(chave);
  const ano = 2000 + Number(chave.slice(2, 4));
  const mes = Number(chave.slice(4, 6));
  if (uf === null || !cnpjValido(cnpj) || ano < PRIMEIRO_ANO_DO_CTE || ano > agora.getUTCFullYear() || mes < 1 || mes > 12 || Number(chave.slice(25, 34)) === 0) {
    return "A chave do CT-e anterior tem UF, data, CNPJ ou número que não existem: confira os 44 caracteres com o documento.";
  }
  return null;
}

/* ----------------------------- Campos do formulário --------------------------- */

const SERVICO_MESSAGE = "Tipo de serviço inválido.";
const NOME_MESSAGE = "O nome do expedidor e do recebedor precisa ter de 2 a 60 letras.";
const DOCUMENTO_MESSAGE = "Informe um CNPJ ou CPF válido para o expedidor e o recebedor.";
const IE_MESSAGE = "A inscrição estadual precisa ter de 2 a 14 dígitos, ou ISENTO.";
const CIDADE_MESSAGE = "Cidade muito longa (máximo de 100 letras). Escreva como \"Cidade - UF\".";

const emBrancoViraNulo = (valor: unknown) => (typeof valor === "string" && valor.trim() === "" ? null : valor);

// Guarda a chave limpa: ela chega com espaço e ponto quando é colada do documento.
const chaveDoCteAnterior = z.preprocess(
  emBrancoViraNulo,
  z
    .string(CHAVE_DO_CTE_ANTERIOR_MESSAGE)
    .transform((chave) => limparChave(chave))
    .superRefine((chave, contexto) => {
      const problema = problemaDaChaveDoCteAnterior(chave);
      if (problema) contexto.addIssue({ code: "custom", message: problema });
    })
    .nullish(),
);

// `xNome` do expedidor e do recebedor: de 2 a 60 (MOC 4.00, Anexo I, campos 140 e 158).
const nome = z.preprocess(emBrancoViraNulo, z.string(NOME_MESSAGE).trim().min(2, NOME_MESSAGE).max(60, NOME_MESSAGE).nullish());

const documento = z.preprocess(
  emBrancoViraNulo,
  z
    .string(DOCUMENTO_MESSAGE)
    .transform((valor) => limparCnpj(valor))
    .refine((valor) => (valor.length === 11 ? cpfValido(valor) : cnpjValido(valor)), DOCUMENTO_MESSAGE)
    .nullish(),
);

// Só dígitos ou o literal ISENTO, como o esquema pede (`TIeDest`).
const inscricaoEstadual = z.preprocess(
  emBrancoViraNulo,
  z
    .string(IE_MESSAGE)
    .transform((valor) => (/^\s*isent[oa]\s*$/i.test(valor) ? "ISENTO" : valor.replace(/\D/g, "")))
    .refine((valor) => valor === "ISENTO" || (valor.length >= 2 && valor.length <= 14), IE_MESSAGE)
    .nullish(),
);

const cidade = z.preprocess(emBrancoViraNulo, z.string(CIDADE_MESSAGE).trim().max(100, CIDADE_MESSAGE).nullish());

/**
 * Os campos de redespacho da carga, para os schemas do painel. Vazio vira
 * `null` (apaga); ausente não mexe. O que cada tipo de serviço EXIGE não é
 * conferido aqui, e sim na conferência do CT-e (src/lib/cte/preparar.ts): a
 * carga pode nascer antes de a chave do CT-e anterior existir.
 */
export const CAMPOS_DO_REDESPACHO = {
  serviceType: z.enum(TIPOS_DE_SERVICO, SERVICO_MESSAGE).optional(),
  previousCteKey: chaveDoCteAnterior,
  shipperName: nome,
  shipperDocument: documento,
  shipperIe: inscricaoEstadual,
  shipperStreet: CAMPOS_DE_ENDERECO.deliveryStreet,
  shipperNumber: CAMPOS_DE_ENDERECO.deliveryNumber,
  shipperDistrict: CAMPOS_DE_ENDERECO.deliveryDistrict,
  shipperCity: cidade,
  shipperZip: CAMPOS_DE_ENDERECO.deliveryZip,
  consigneeName: nome,
  consigneeDocument: documento,
  consigneeIe: inscricaoEstadual,
  consigneeStreet: CAMPOS_DE_ENDERECO.deliveryStreet,
  consigneeNumber: CAMPOS_DE_ENDERECO.deliveryNumber,
  consigneeDistrict: CAMPOS_DE_ENDERECO.deliveryDistrict,
  consigneeCity: cidade,
  consigneeZip: CAMPOS_DE_ENDERECO.deliveryZip,
} as const;

/** Os nomes das colunas de redespacho da carga: é o que as rotas gravam, a auditoria compara e as consultas leem. */
export const COLUNAS_DO_REDESPACHO = Object.keys(CAMPOS_DO_REDESPACHO) as (keyof typeof CAMPOS_DO_REDESPACHO)[];

/** As mesmas colunas, no formato do `select` do Prisma. */
export const REDESPACHO_SELECT = {
  serviceType: true,
  previousCteKey: true,
  shipperName: true,
  shipperDocument: true,
  shipperIe: true,
  shipperStreet: true,
  shipperNumber: true,
  shipperDistrict: true,
  shipperCity: true,
  shipperZip: true,
  consigneeName: true,
  consigneeDocument: true,
  consigneeIe: true,
  consigneeStreet: true,
  consigneeNumber: true,
  consigneeDistrict: true,
  consigneeCity: true,
  consigneeZip: true,
} as const;

/* ------------------------------ Leitura da carga ------------------------------ */

/** As colunas de redespacho como a carga as guarda. */
export type RedespachoDaCarga = {
  serviceType: string;
  previousCteKey: string | null;
  shipperName: string | null;
  shipperDocument: string | null;
  shipperIe: string | null;
  shipperStreet: string | null;
  shipperNumber: string | null;
  shipperDistrict: string | null;
  shipperCity: string | null;
  shipperZip: string | null;
  consigneeName: string | null;
  consigneeDocument: string | null;
  consigneeIe: string | null;
  consigneeStreet: string | null;
  consigneeNumber: string | null;
  consigneeDistrict: string | null;
  consigneeCity: string | null;
  consigneeZip: string | null;
};

/** O serviço normal, sem nada preenchido: o que toda carga antiga é. */
export const SEM_REDESPACHO: RedespachoDaCarga = {
  serviceType: "NORMAL",
  previousCteKey: null,
  shipperName: null,
  shipperDocument: null,
  shipperIe: null,
  shipperStreet: null,
  shipperNumber: null,
  shipperDistrict: null,
  shipperCity: null,
  shipperZip: null,
  consigneeName: null,
  consigneeDocument: null,
  consigneeIe: null,
  consigneeStreet: null,
  consigneeNumber: null,
  consigneeDistrict: null,
  consigneeCity: null,
  consigneeZip: null,
};

/** O expedidor ou o recebedor como foi digitado na carga. Cada campo pode faltar. */
export type ParteInformada = {
  nome: string | null;
  documento: string | null;
  ie: string | null;
  logradouro: string | null;
  numero: string | null;
  bairro: string | null;
  /** "Cidade - UF". */
  cidade: string | null;
  cep: string | null;
};

const algumCampo = (parte: ParteInformada) => Object.values(parte).some((valor) => valor !== null && valor.trim() !== "");

/** O serviço da carga para o CT-e e para a minuta. `expedidor` e `recebedor` nulos: nada foi digitado. */
export type ServicoDaCarga = { tipo: TipoDeServico; chaveDoCteAnterior: string | null; expedidor: ParteInformada | null; recebedor: ParteInformada | null };

export function servicoDaCarga(carga: RedespachoDaCarga): ServicoDaCarga {
  const expedidor: ParteInformada = {
    nome: carga.shipperName,
    documento: carga.shipperDocument,
    ie: carga.shipperIe,
    logradouro: carga.shipperStreet,
    numero: carga.shipperNumber,
    bairro: carga.shipperDistrict,
    cidade: carga.shipperCity,
    cep: carga.shipperZip,
  };
  const recebedor: ParteInformada = {
    nome: carga.consigneeName,
    documento: carga.consigneeDocument,
    ie: carga.consigneeIe,
    logradouro: carga.consigneeStreet,
    numero: carga.consigneeNumber,
    bairro: carga.consigneeDistrict,
    cidade: carga.consigneeCity,
    cep: carga.consigneeZip,
  };
  return {
    tipo: tipoDeServico(carga.serviceType),
    chaveDoCteAnterior: carga.previousCteKey,
    expedidor: algumCampo(expedidor) ? expedidor : null,
    recebedor: algumCampo(recebedor) ? recebedor : null,
  };
}

/** A carga tem algo de redespacho preenchido? É o que abre o bloco no formulário e põe a seção na minuta. */
export function temRedespacho(carga: RedespachoDaCarga): boolean {
  const servico = servicoDaCarga(carga);
  return servico.tipo !== "NORMAL" || servico.chaveDoCteAnterior !== null || servico.expedidor !== null || servico.recebedor !== null;
}

/** "Rua das Docas, 50 - Centro, Santos - SP, 11010-000": o endereço digitado numa linha, só com o que existe. */
export function enderecoDaParte(parte: ParteInformada): string {
  const rua = [parte.logradouro, parte.numero].filter(Boolean).join(", ");
  return [[rua, parte.bairro].filter(Boolean).join(" - "), parte.cidade, cepFormatado(parte.cep)].filter(Boolean).join(", ");
}
