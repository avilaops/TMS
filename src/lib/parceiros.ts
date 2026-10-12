import { z } from "zod";
import { limparCnpj } from "@/lib/cte";
import { documentoValido } from "@/lib/mdfe";
import { CALC_MODES, CALC_BASE_MESSAGE, PERCENTUAL_MESSAGE, baseCabeNaForma } from "@/lib/frete-contratado";

/**
 * Parceiros de transporte: o agregado, o autônomo e a transportadora donos de
 * veículo que roda para a empresa. Regras comuns às rotas e à tela; este
 * arquivo não toca no banco.
 *
 * O veículo e o motorista do parceiro apontam para ele (`Vehicle.carrierId`,
 * `Driver.carrierId`). Quando o veículo tem parceiro, o MDF-e lê o proprietário
 * do cadastro do parceiro (`proprietarioDoParceiro`); sem parceiro continuam
 * valendo os campos soltos de proprietário do veículo.
 *
 * A forma padrão de contratação (`defaultCalcMode`, `defaultCalcBase`) é
 * dinheiro: as rotas só a devolvem a quem lê o frete contratado, e só quem
 * altera o frete contratado a grava (`PUT /api/parceiros/[id]/contratacao`).
 * O contrato e os pagamentos de cada viagem estão em src/lib/frete-contratado.ts.
 */

export const CARRIER_TYPES = ["TAC_AGREGADO", "TAC_INDEPENDENTE", "TRANSPORTADORA"] as const;
export type TipoDeParceiro = (typeof CARRIER_TYPES)[number];

export const CARRIER_TYPE_LABEL: Record<TipoDeParceiro, string> = {
  TAC_AGREGADO: "TAC agregado",
  TAC_INDEPENDENTE: "TAC independente",
  TRANSPORTADORA: "Transportadora",
};

export const rotuloDoTipo = (tipo: string) => (CARRIER_TYPE_LABEL as Record<string, string>)[tipo] ?? tipo;

/** O `tpProp` do MDF-e para cada tipo de parceiro: 0 TAC agregado, 1 TAC independente, 2 outros. */
export const TP_PROP_DO_TIPO: Record<TipoDeParceiro, "0" | "1" | "2"> = {
  TAC_AGREGADO: "0",
  TAC_INDEPENDENTE: "1",
  TRANSPORTADORA: "2",
};

/** O que o MDF-e lê do parceiro dono do veículo. */
export type ParceiroDoVeiculo = { name: string; taxId: string; rntrc: string | null; ie: string | null; state: string | null; type: string };

/**
 * O proprietário do veículo como o MDF-e espera (src/lib/mdfe/preparar.ts), a
 * partir do cadastro do parceiro. `parceiro` leva o nome dele: é o que faz a
 * pendência apontar para o cadastro de Parceiros, e não para o do veículo.
 */
export function proprietarioDoParceiro(parceiro: ParceiroDoVeiculo) {
  return {
    documento: parceiro.taxId,
    nome: parceiro.name,
    rntrc: parceiro.rntrc,
    ie: parceiro.ie,
    uf: parceiro.state,
    tipo: (TP_PROP_DO_TIPO as Record<string, string>)[parceiro.type] ?? null,
    parceiro: parceiro.name,
  };
}

/* ---------------------------------- Validação --------------------------------- */

const INVALID_BODY = "Dados inválidos.";
const NOTHING_TO_CHANGE = "Informe ao menos um campo para alterar.";
export const TAX_ID_MESSAGE = "Informe um CPF ou CNPJ válido.";
const RNTRC_MESSAGE = "O RNTRC tem 8 dígitos.";

const UFS = ["AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO"] as const;
export const UFS_DO_PARCEIRO: readonly string[] = UFS;

// Texto opcional: vazio vira `null` (apaga o campo); ausente não mexe.
const optionalText = (max: number, tooLong: string) =>
  z
    .string(INVALID_BODY)
    .trim()
    .max(max, tooLong)
    .transform((value) => (value === "" ? null : value))
    .nullish();

// O formulário manda número como texto ("1234,56" ou "1234.56"; "" quando em branco).
const fromFormNumber = (value: unknown) => {
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (text === "") return null;
  return /^(\d+([.,]\d*)?|[.,]\d+)$/.test(text) ? Number(text.replace(",", ".")) : NaN;
};

const emBrancoComoNulo = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);

// CPF ou CNPJ sem pontuação e com os dígitos verificadores certos (o CNPJ pode ter letras, desde 2026).
const taxId = z.preprocess((value) => (typeof value === "string" ? limparCnpj(value) : value), z.string(TAX_ID_MESSAGE).refine(documentoValido, TAX_ID_MESSAGE));

// O nome vai para o MDF-e (`xNome` do proprietário), que aceita até 60 letras.
const name = z.string("Informe o nome ou a razão social.").trim().min(2, "Informe o nome ou a razão social.").max(60, "Nome muito longo (máximo de 60 letras).");

const optionalFields = {
  rntrc: z.preprocess(
    (value) => (typeof value === "string" ? value.replace(/\D/g, "") : value),
    z
      .string(RNTRC_MESSAGE)
      .regex(/^(\d{8})?$/, RNTRC_MESSAGE)
      .transform((value) => (value === "" ? null : value))
      .nullish(),
  ),
  ie: optionalText(14, "Inscrição estadual muito longa."),
  // "sp" e " SP " são a mesma UF.
  state: z.preprocess((value) => (typeof value === "string" ? emBrancoComoNulo(value.trim().toUpperCase()) : value), z.enum(UFS, "UF inválida.").nullish()),
  phone: optionalText(30, "Telefone muito longo."),
  email: z
    .string(INVALID_BODY)
    .trim()
    .toLowerCase()
    .max(254, "E-mail inválido.")
    .transform((value) => (value === "" ? null : value))
    .pipe(z.email("E-mail inválido.").nullable())
    .nullish(),
  pixKey: optionalText(140, "Chave Pix muito longa."),
  bankInfo: optionalText(300, "Dados bancários muito longos."),
  notes: optionalText(1000, "Observação muito longa."),
};

/** A forma padrão de contratação: as duas em branco tiram o padrão; ausentes, não mexem. */
const contratacao = {
  defaultCalcMode: z.preprocess(emBrancoComoNulo, z.enum(CALC_MODES, "Forma de contratação inválida.").nullish()),
  defaultCalcBase: z.preprocess(fromFormNumber, z.number(CALC_BASE_MESSAGE).min(0, CALC_BASE_MESSAGE).max(1_000_000_000, CALC_BASE_MESSAGE).nullish()),
};

const formaCoerente = (dados: { defaultCalcMode?: string | null; defaultCalcBase?: number | null }) => baseCabeNaForma({ calcMode: dados.defaultCalcMode, calcBase: dados.defaultCalcBase });
const BASE_SEM_FORMA = "Escolha a forma de contratação para informar o valor padrão.";
const baseTemForma = (dados: { defaultCalcMode?: string | null; defaultCalcBase?: number | null }) => !(typeof dados.defaultCalcBase === "number" && !dados.defaultCalcMode);

export const createCarrierSchema = z
  .object({ type: z.enum(CARRIER_TYPES, "Tipo de parceiro inválido."), name, taxId, ...optionalFields, ...contratacao }, INVALID_BODY)
  .refine(formaCoerente, { message: PERCENTUAL_MESSAGE, path: ["defaultCalcBase"] })
  .refine(baseTemForma, { message: BASE_SEM_FORMA, path: ["defaultCalcMode"] });

// O CPF ou CNPJ é a chave do cadastro e não entra aqui, como no cliente e no motorista.
export const updateCarrierSchema = z
  .object(
    {
      type: z.enum(CARRIER_TYPES, "Tipo de parceiro inválido.").optional(),
      name: name.optional(),
      ...optionalFields,
      active: z.boolean("Informe se o cadastro está ativo.").optional(),
    },
    INVALID_BODY,
  )
  .refine((data) => Object.values(data).some((value) => value !== undefined), { message: NOTHING_TO_CHANGE });

/** A forma padrão de contratação, gravada por quem altera o frete contratado. As duas vão sempre juntas. */
export const contratacaoSchema = z
  .object(contratacao, INVALID_BODY)
  .refine(formaCoerente, { message: PERCENTUAL_MESSAGE, path: ["defaultCalcBase"] })
  .refine(baseTemForma, { message: BASE_SEM_FORMA, path: ["defaultCalcMode"] });

/* ------------------------------ O que as rotas leem ---------------------------- */

/** O cadastro, sem o que é dinheiro. */
export const CARRIER_SELECT = {
  id: true,
  type: true,
  name: true,
  taxId: true,
  rntrc: true,
  ie: true,
  state: true,
  phone: true,
  email: true,
  pixKey: true,
  bankInfo: true,
  notes: true,
  active: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** A forma padrão de contratação: só para quem lê o frete contratado. */
export const CARRIER_VALUES_SELECT = { defaultCalcMode: true, defaultCalcBase: true } as const;

/** O que entra em `antes`/`depois` da auditoria. */
export const CAMPOS_DO_PARCEIRO = ["type", "name", "taxId", "rntrc", "ie", "state", "phone", "email", "pixKey", "bankInfo", "notes", "active"] as const;
export const CAMPOS_DA_CONTRATACAO = ["defaultCalcMode", "defaultCalcBase"] as const;

export const CARRIER_NOT_FOUND = "Parceiro não encontrado.";
export const DUPLICATE_CARRIER = "Já existe um parceiro cadastrado com este CPF ou CNPJ.";
export const CONTRATACAO_SO_DE_QUEM_PAGA = "A forma padrão de contratação é de quem altera o frete contratado.";
