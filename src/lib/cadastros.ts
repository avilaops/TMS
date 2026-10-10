import { z } from "zod";
import { normalizeTaxId } from "@/lib/tracking";
import { DRIVER_OMIT, DRIVER_USER_SELECT } from "@/lib/usuarios";

// Validação dos cadastros de clientes, motoristas e veículos. As rotas gravam
// só o que sai destes schemas: documento e placa já normalizados, texto vazio
// como `null` e número como número.

// O que as rotas devolvem do motorista e do veículo. O usuário do motorista sai
// só com id, nome e e-mail: `user: true` mandaria o hash da senha junto.
export const DRIVER_PUBLIC_INCLUDE = {
  user: { select: DRIVER_USER_SELECT },
} as const;

export const VEHICLE_PUBLIC_INCLUDE = {
  driver: { include: DRIVER_PUBLIC_INCLUDE, omit: DRIVER_OMIT },
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
  freightTableId: true,
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
  // Tabela de frete negociada. Vazio ou null volta para a padrão da transportadora.
  freightTableId: z
    .string(INVALID_BODY)
    .trim()
    .transform((value) => (value === "" ? null : value))
    .nullish(),
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

/* ------------------------------ Tabelas de frete ------------------------------ */

const numero = (message: string, min = 0) => z.preprocess(fromFormNumber, z.number(message).min(min, message));
const numeroOpcional = (message: string, min = 0) =>
  z.preprocess(fromFormNumber, z.number(message).min(min, message).nullish());
const percentual = (message: string) =>
  z.preprocess(fromFormNumber, z.number(message).min(0, message).max(100, message).nullish());
const inteiroOpcional = (message: string) =>
  z.preprocess(fromFormNumber, z.number(message).int(message).min(1, message).nullish());

// Data do formulário (AAAA-MM-DD) ou ISO. Vazio apaga; ausente não mexe.
const dataOpcional = (message: string) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    z.coerce.date(message).nullish(),
  );

const freightTableFields = {
  includedWeightKg: numero("O peso coberto pelo frete mínimo precisa ser um número maior ou igual a zero."),
  excessPerKg: numero("O valor do kg excedente precisa ser um número maior ou igual a zero."),
  cubageFactor: numeroOpcional("O fator de cubagem precisa ser um número maior ou igual a zero."),
  invoiceLimit: numeroOpcional("O limite de valor da nota precisa ser um número maior ou igual a zero."),
  adValoremPct: percentual("O percentual sobre a nota precisa estar entre 0 e 100."),
  maxVolumes: inteiroOpcional("O máximo de volumes precisa ser um número inteiro maior que zero."),
  redeliveryPct: percentual("O percentual de reentrega precisa estar entre 0 e 100."),
  returnPct: percentual("O percentual de devolução precisa estar entre 0 e 100."),
  validFrom: dataOpcional("Data de início inválida."),
  validTo: dataOpcional("Data de fim inválida."),
  notes: optionalText(1000, "Observação muito longa."),
};

const freightTableName = z.string("Informe o nome da tabela.").trim().min(2, "Informe o nome da tabela.").max(120, "Nome muito longo.");

const validadeCoerente = (data: { validFrom?: Date | null; validTo?: Date | null }) =>
  !data.validFrom || !data.validTo || data.validFrom <= data.validTo;
const VALIDADE_INVERTIDA = { message: "O fim da validade não pode ser antes do início.", path: ["validTo"] };

export const createFreightTableSchema = z
  .object(
    {
      name: freightTableName,
      ...freightTableFields,
      isDefault: z.boolean("Informe se a tabela é a padrão.").optional(),
    },
    INVALID_BODY,
  )
  .refine(validadeCoerente, VALIDADE_INVERTIDA);

export const updateFreightTableSchema = z
  .object(
    {
      name: freightTableName.optional(),
      includedWeightKg: freightTableFields.includedWeightKg.optional(),
      excessPerKg: freightTableFields.excessPerKg.optional(),
      cubageFactor: freightTableFields.cubageFactor,
      invoiceLimit: freightTableFields.invoiceLimit,
      adValoremPct: freightTableFields.adValoremPct,
      maxVolumes: freightTableFields.maxVolumes,
      redeliveryPct: freightTableFields.redeliveryPct,
      returnPct: freightTableFields.returnPct,
      validFrom: freightTableFields.validFrom,
      validTo: freightTableFields.validTo,
      notes: freightTableFields.notes,
      isDefault: z.boolean("Informe se a tabela é a padrão.").optional(),
      active: activeFlag.optional(),
    },
    INVALID_BODY,
  )
  .refine((data) => Object.values(data).some((value) => value !== undefined), { message: NOTHING_TO_CHANGE })
  .refine(validadeCoerente, VALIDADE_INVERTIDA);

/** Tamanho máximo de uma tabela: folga larga sobre o maior estado do país (853 municípios). */
export const MAX_CIDADES_POR_TABELA = 2000;

export const freightCitiesSchema = z.object(
  {
    cities: z
      .array(
        z.object(
          {
            city: z.string("Informe o nome da cidade.").trim().min(2, "Informe o nome da cidade.").max(120, "Nome de cidade muito longo."),
            minimum: numero("O frete mínimo da cidade precisa ser um número maior ou igual a zero."),
            deadlineHours: z.preprocess(
              fromFormNumber,
              z.number("O prazo precisa ser um número de horas.").int("O prazo precisa ser um número inteiro de horas.").min(1, "O prazo precisa ser de pelo menos 1 hora.").max(24 * 60, "Prazo muito longo."),
            ),
            dedicated: z.boolean("Informe se a cidade é só com veículo dedicado.").optional(),
          },
          INVALID_BODY,
        ),
        "Envie a lista de cidades.",
      )
      .max(MAX_CIDADES_POR_TABELA, `A tabela aceita no máximo ${MAX_CIDADES_POR_TABELA} cidades.`),
  },
  INVALID_BODY,
);

export const simulateFreightSchema = z.object(
  {
    city: z.string("Informe a cidade de destino.").trim().min(2, "Informe a cidade de destino.").max(120),
    weight: numero("Informe o peso em kg."),
    volumes: inteiroOpcional("A quantidade de volumes precisa ser um número inteiro maior que zero."),
    invoiceValue: numeroOpcional("O valor da nota precisa ser um número maior ou igual a zero."),
    cubicMeters: numeroOpcional("O volume em m³ precisa ser um número maior ou igual a zero."),
    clientId: z.string().trim().min(1).nullish(),
    tableId: z.string().trim().min(1).nullish(),
  },
  INVALID_BODY,
);

export const FREIGHT_TABLE_SELECT = {
  id: true,
  name: true,
  active: true,
  isDefault: true,
  validFrom: true,
  validTo: true,
  includedWeightKg: true,
  excessPerKg: true,
  cubageFactor: true,
  invoiceLimit: true,
  adValoremPct: true,
  maxVolumes: true,
  redeliveryPct: true,
  returnPct: true,
  notes: true,
  updatedAt: true,
  _count: { select: { cities: true, clients: true } },
} as const;

export const FREIGHT_CITY_SELECT = {
  id: true,
  city: true,
  minimum: true,
  deadlineHours: true,
  dedicated: true,
} as const;

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

// Percentual do frete entregue que vira comissão. Vazio ou `null` tira a comissão.
const commissionPct = percentual("A comissão precisa ser um percentual entre 0 e 100.");

export const COMMISSION_ADMIN_ONLY = "Só o administrador altera o percentual de comissão.";

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
      // Só o administrador manda este campo: a rota recusa dos demais perfis.
      commissionPct,
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

// O que o MDF-e pede do veículo (grupos veicTracao, veicReboque e prop do modal
// rodoviário, leiaute 3.00). Tudo opcional: vazio vira `null`, e a emissão do
// MDF-e lista o que falta (src/lib/mdfe/preparar.ts).
const soDigitosOuVazio = (value: unknown) => (typeof value === "string" ? value.replace(/\D/g, "") : value);
const codigoOpcional = (valores: readonly string[], message: string) =>
  z.preprocess((value) => (typeof value === "string" && value.trim() === "" ? null : value), z.enum(valores as [string, ...string[]], message).nullish());
const UFS_DO_VEICULO = ["AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO"] as const;
const RENAVAM_MESSAGE = "O RENAVAM tem de 9 a 11 dígitos.";
const TARA_MESSAGE = "A tara precisa ser um número inteiro de 0 a 999999 kg.";
const OWNER_TAX_ID_MESSAGE = "Informe um CPF (11 dígitos) ou CNPJ (14 posições) para o proprietário.";
const OWNER_RNTRC_MESSAGE = "O RNTRC do proprietário tem 8 dígitos.";

const vehicleFiscalFields = {
  renavam: z.preprocess(soDigitosOuVazio, z.string(RENAVAM_MESSAGE).regex(/^(\d{9,11})?$/, RENAVAM_MESSAGE).transform((value) => (value === "" ? null : value)).nullish()),
  tareKg: z.preprocess(fromFormNumber, z.number(TARA_MESSAGE).int(TARA_MESSAGE).min(0, TARA_MESSAGE).max(999_999, TARA_MESSAGE).nullish()),
  // tpRod: 01 truck, 02 toco, 03 cavalo mecânico, 04 van, 05 utilitário, 06 outros.
  wheelType: codigoOpcional(["01", "02", "03", "04", "05", "06"], "Tipo de rodado inválido."),
  // tpCar: 00 não aplicável, 01 aberta, 02 fechada/baú, 03 graneleira, 04 porta-contêiner, 05 sider.
  bodyType: codigoOpcional(["00", "01", "02", "03", "04", "05"], "Tipo de carroceria inválido."),
  licenseState: codigoOpcional(UFS_DO_VEICULO, "UF de licenciamento inválida."),
  // Proprietário: só quando o veículo não é da empresa. CNPJ pode ter letras (alfanumérico, desde 2026).
  ownerTaxId: z.preprocess(
    (value) => (typeof value === "string" ? value.toUpperCase().replace(/[^0-9A-Z]/g, "") : value),
    z.string(OWNER_TAX_ID_MESSAGE).regex(/^(\d{11}|[A-Z0-9]{12}\d{2})?$/, OWNER_TAX_ID_MESSAGE).transform((value) => (value === "" ? null : value)).nullish(),
  ),
  ownerName: optionalText(60, "Nome do proprietário muito longo (máximo de 60 letras)."),
  ownerRntrc: z.preprocess(soDigitosOuVazio, z.string(OWNER_RNTRC_MESSAGE).regex(/^(\d{8})?$/, OWNER_RNTRC_MESSAGE).transform((value) => (value === "" ? null : value)).nullish()),
  ownerIe: optionalText(14, "Inscrição estadual do proprietário muito longa."),
  ownerState: codigoOpcional(UFS_DO_VEICULO, "UF do proprietário inválida."),
  // tpProp: 0 TAC agregado, 1 TAC independente, 2 outros.
  ownerType: codigoOpcional(["0", "1", "2"], "Tipo de proprietário inválido."),
};

/** Os campos do veículo que só o MDF-e usa, na ordem do formulário. */
export const VEHICLE_FISCAL_FIELDS = ["renavam", "tareKg", "wheelType", "bodyType", "licenseState", "ownerTaxId", "ownerName", "ownerRntrc", "ownerIe", "ownerState", "ownerType"] as const;

const vehicleOptionalFields = {
  capacityKg: optionalAmount("A capacidade precisa ser um número maior ou igual a zero."),
  maxWeight: optionalAmount("O peso máximo precisa ser um número maior ou igual a zero."),
  year: vehicleYear,
  // Vazio ou `null` desvincula o motorista.
  defaultDriverId: optionalText(64, "Motorista inválido."),
  ...vehicleFiscalFields,
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
