import { z } from "zod";
import { normalizeTaxId } from "@/lib/tracking";
import { DRIVER_USER_SELECT } from "@/lib/usuarios";

// Validação dos cadastros de clientes, motoristas e veículos. As rotas gravam
// só o que sai destes schemas: documento e placa já normalizados, texto vazio
// como `null` e número como número.

// O que as rotas devolvem do motorista e do veículo. O usuário do motorista sai
// só com id, nome e e-mail: `user: true` mandaria o hash da senha junto.
export const DRIVER_PUBLIC_INCLUDE = {
  user: { select: DRIVER_USER_SELECT },
} as const;

export const VEHICLE_PUBLIC_INCLUDE = {
  driver: { include: DRIVER_PUBLIC_INCLUDE },
} as const;

export const CLIENT_PUBLIC_SELECT = {
  id: true,
  companyName: true,
  tradeName: true,
  cnpj: true,
  ie: true,
  contactName: true,
  email: true,
  phone: true,
  address: true,
  paymentCondition: true,
  creditLimit: true,
  active: true,
  createdAt: true,
  updatedAt: true,
} as const;

export const CNH_CATEGORIES = ["A", "B", "C", "D", "E", "AB", "AC", "AD", "AE"] as const;
export const VEHICLE_STATUSES = ["AVAILABLE", "ON_ROUTE", "MAINTENANCE"] as const;

const INVALID_BODY = "Dados inválidos.";
const NOTHING_TO_CHANGE = "Informe ao menos um campo para alterar.";

// Texto opcional: vazio vira `null` (apaga o campo); ausente não mexe.
// `wrongType` é a mensagem para quem manda número, lista ou objeto no lugar.
const optionalText = (max: number, tooLong: string, wrongType = INVALID_BODY) =>
  z
    .string(wrongType)
    .trim()
    .max(max, tooLong)
    .transform((value) => (value === "" ? null : value))
    .nullish();

// O formulário manda número como texto ("5000", "" quando em branco).
const fromFormNumber = (value: unknown) => {
  if (typeof value !== "string") return value;
  const text = value.trim().replace(",", ".");
  return text === "" ? null : Number(text);
};

const optionalAmount = (message: string) =>
  z.preprocess(fromFormNumber, z.number(message).min(0, message).nullish());

const activeFlag = z.boolean("Informe se o cadastro está ativo.");

// Normaliza antes de validar: espaço nas pontas e maiúsculas não criam um segundo usuário.
const email = z.string("Informe o e-mail.").trim().toLowerCase().max(254, "E-mail inválido.").pipe(z.email("E-mail inválido."));

/* ---------------------------------- Clientes --------------------------------- */

const TAX_ID_MESSAGE = "Informe um CNPJ (14 dígitos) ou CPF (11 dígitos) válido.";

// Só dígitos: é assim que o rastreio público procura o cliente, e é o que
// impede o mesmo CNPJ de entrar duas vezes, com e sem máscara.
const taxId = z
  .string(TAX_ID_MESSAGE)
  .transform((value) => normalizeTaxId(value) ?? "")
  .pipe(z.string().min(1, TAX_ID_MESSAGE));

const companyName = z
  .string("Informe a razão social.")
  .trim()
  .min(2, "Informe a razão social.")
  .max(200, "Razão social muito longa.");

const clientOptionalFields = {
  tradeName: optionalText(200, "Nome fantasia muito longo."),
  ie: optionalText(30, "Inscrição estadual muito longa."),
  contactName: optionalText(120, "Nome do contato muito longo."),
  email: z
    .string(INVALID_BODY)
    .trim()
    .toLowerCase()
    .max(254, "E-mail inválido.")
    .transform((value) => (value === "" ? null : value))
    .pipe(z.email("E-mail inválido.").nullable())
    .nullish(),
  phone: optionalText(30, "Telefone muito longo."),
  address: optionalText(300, "Endereço muito longo."),
  paymentCondition: optionalText(120, "Condição de pagamento muito longa."),
  creditLimit: optionalAmount("O limite de crédito precisa ser um número maior ou igual a zero."),
};

export const createClientSchema = z.object(
  { cnpj: taxId, companyName, ...clientOptionalFields },
  INVALID_BODY,
);

export const updateClientSchema = z
  .object(
    {
      cnpj: taxId.optional(),
      companyName: companyName.optional(),
      ...clientOptionalFields,
      active: activeFlag.optional(),
    },
    INVALID_BODY,
  )
  .refine((data) => Object.values(data).some((value) => value !== undefined), { message: NOTHING_TO_CHANGE });

/* --------------------------------- Motoristas -------------------------------- */

const CPF_MESSAGE = "Informe um CPF com 11 dígitos.";

const cpf = z
  .string(CPF_MESSAGE)
  .transform((value) => value.replace(/\D/g, ""))
  .pipe(z.string().length(11, CPF_MESSAGE));

const driverName = z.string("Informe o nome.").trim().min(2, "Informe o nome.").max(120, "Nome muito longo.");
const cnh = z.string("Informe o número da CNH.").trim().min(1, "Informe o número da CNH.").max(20, "CNH muito longa.");
const cnhCategory = z.enum(CNH_CATEGORIES, "Categoria da CNH inválida.");

const CNH_EXPIRY_MESSAGE = "Informe uma validade de CNH válida.";

// Aceita o "AAAA-MM-DD" do campo de data e também data ISO completa.
const cnhExpiry = z
  .string(CNH_EXPIRY_MESSAGE)
  .trim()
  .min(1, CNH_EXPIRY_MESSAGE)
  .transform((value) => new Date(value))
  .pipe(z.date(CNH_EXPIRY_MESSAGE));

const driverPhone = optionalText(30, "Telefone muito longo.", "O telefone precisa ser um texto.");

export const createDriverSchema = z.object(
  {
    name: driverName,
    cpf,
    email,
    cnh,
    category: cnhCategory,
    cnhExpiry,
    phone: driverPhone,
  },
  INVALID_BODY,
);

// CPF é a chave do registro e não entra aqui: erro nele se resolve desativando
// e cadastrando de novo.
export const updateDriverSchema = z
  .object(
    {
      name: driverName.optional(),
      email: email.optional(),
      cnh: cnh.optional(),
      category: cnhCategory.optional(),
      cnhExpiry: cnhExpiry.optional(),
      phone: driverPhone,
      active: activeFlag.optional(),
    },
    INVALID_BODY,
  )
  .refine((data) => Object.values(data).some((value) => value !== undefined), { message: NOTHING_TO_CHANGE });

/* ---------------------------------- Veículos --------------------------------- */

const PLATE_MESSAGE = "Informe uma placa válida (AAA9999 ou AAA9A99).";

// Maiúscula, sem espaço nem hífen. Padrão antigo (AAA9999) e Mercosul (AAA9A99).
const plate = z
  .string(PLATE_MESSAGE)
  .transform((value) => value.toUpperCase().replace(/[\s-]/g, ""))
  .pipe(z.string().regex(/^[A-Z]{3}\d[A-Z0-9]\d{2}$/, PLATE_MESSAGE));

const vehicleModel = z.string("Informe o modelo.").trim().min(1, "Informe o modelo.").max(120, "Modelo muito longo.");
const vehicleType = z.string("Informe o tipo.").trim().min(1, "Informe o tipo.").max(40, "Tipo muito longo.");

export const INACTIVE_DRIVER_MESSAGE = "Motorista inativo não pode ser o motorista padrão.";

const YEAR_MIN = 1950;

const vehicleYear = z.preprocess(
  fromFormNumber,
  z
    .number("Ano inválido.")
    .int("Ano inválido.")
    .min(YEAR_MIN, `O ano precisa ser ${YEAR_MIN} ou posterior.`)
    // O limite é lido a cada validação: o processo atravessa a virada do ano.
    .refine((year) => year <= new Date().getFullYear() + 1, { message: "O ano não pode passar do ano que vem." })
    .nullish(),
);

const vehicleOptionalFields = {
  capacityKg: optionalAmount("A capacidade precisa ser um número maior ou igual a zero."),
  maxWeight: optionalAmount("O peso máximo precisa ser um número maior ou igual a zero."),
  year: vehicleYear,
  // Vazio ou `null` desvincula o motorista.
  defaultDriverId: optionalText(64, "Motorista inválido."),
};

export const createVehicleSchema = z.object(
  { plate, model: vehicleModel, type: vehicleType, ...vehicleOptionalFields },
  INVALID_BODY,
);

// Placa é a chave do registro e não entra aqui.
export const updateVehicleSchema = z
  .object(
    {
      model: vehicleModel.optional(),
      type: vehicleType.optional(),
      ...vehicleOptionalFields,
      status: z.enum(VEHICLE_STATUSES, "Status inválido.").optional(),
    },
    INVALID_BODY,
  )
  .refine((data) => Object.values(data).some((value) => value !== undefined), { message: NOTHING_TO_CHANGE });

/** Erro do Prisma para violação de índice único (duas gravações simultâneas). */
export function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "P2002";
}

/** Recusa de regra de negócio dentro de uma transação: vira a resposta HTTP. */
export class Refusal extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
