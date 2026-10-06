import { z } from "zod";
import { DRIVER_USER_SELECT } from "@/lib/usuarios";

// Regras da coleta no painel: quais status existem, quais trocas o operador
// pode fazer e o que as rotas aceitam gravar. Este arquivo também é importado
// pela tela, então não pode puxar nada que só exista no servidor.

export const COLLECTION_STATUSES = [
  "PENDING",
  "CONFIRMED",
  "COLLECTED",
  "ROUTE",
  "DELIVERED",
  "CANCELLED",
  "REJECTED",
] as const;

export type CollectionStatus = (typeof COLLECTION_STATUSES)[number];

// Trocas que o operador faz pelo painel. `→ ROUTE` não está aqui de propósito:
// quem põe a carga em rota é a criação do manifesto.
export const OPERATOR_TRANSITIONS: Record<CollectionStatus, readonly CollectionStatus[]> = {
  PENDING: ["CONFIRMED", "REJECTED", "CANCELLED"],
  CONFIRMED: ["COLLECTED", "CANCELLED"],
  COLLECTED: ["CANCELLED"],
  ROUTE: ["DELIVERED"],
  DELIVERED: [],
  CANCELLED: [],
  REJECTED: [],
};

/** Status que o operador pode pedir pela rota de status. */
export const OPERATOR_TARGET_STATUSES = ["CONFIRMED", "REJECTED", "CANCELLED", "COLLECTED", "DELIVERED"] as const;

/** Status em que os dados da coleta ainda podem ser corrigidos. */
export const EDITABLE_STATUSES = ["PENDING", "CONFIRMED", "COLLECTED"] as const;

export function allowedTransitions(from: string): readonly CollectionStatus[] {
  return Object.hasOwn(OPERATOR_TRANSITIONS, from) ? OPERATOR_TRANSITIONS[from as CollectionStatus] : [];
}

export function canTransition(from: string, to: string): boolean {
  return (allowedTransitions(from) as readonly string[]).includes(to);
}

/** Só enquanto a carga não embarcou: depois do manifesto os dados já estão no papel. */
export function isEditable(collection: { status: string; manifestId: string | null }): boolean {
  return (EDITABLE_STATUSES as readonly string[]).includes(collection.status) && collection.manifestId === null;
}

// O que as rotas devolvem junto da coleta. O usuário do motorista sai só com
// id, nome e e-mail: `user: true` mandaria o hash da senha junto.
export const COLLECTION_INCLUDE = {
  client: true,
  driver: { include: { user: { select: DRIVER_USER_SELECT } } },
} as const;

const INVALID_BODY = "Dados inválidos.";
const NOTHING_TO_CHANGE = "Informe ao menos um campo para alterar.";

export const INACTIVE_CLIENT_MESSAGE = "Cliente não encontrado ou inativo.";
export const INACTIVE_DRIVER_MESSAGE = "Motorista não encontrado ou inativo.";

// O formulário manda número como texto ("12,5", "" quando em branco). Só
// dígitos com uma vírgula ou ponto decimal: `Number()` sozinho leria "0x10"
// como 16 e "1e3" como 1000.
const FORM_NUMBER = /^\d+([.,]\d+)?$/;

const fromFormNumber = (value: unknown) => {
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (text === "") return null;
  return FORM_NUMBER.test(text) ? Number(text.replace(",", ".")) : NaN;
};

const text = (required: string, tooLong: string) => z.string(required).trim().min(1, required).max(200, tooLong);

const sender = text("Informe o remetente.", "Remetente muito longo.");
const receiver = text("Informe o destinatário.", "Destinatário muito longo.");
const origin = text("Informe a origem.", "Origem muito longa.");
const destination = text("Informe o destino.", "Destino muito longo.");

const VOLUMES_MESSAGE = "Os volumes precisam ser um número inteiro maior ou igual a 1.";
const WEIGHT_MESSAGE = "O peso precisa ser um número maior que zero.";
const INVOICE_VALUE_MESSAGE = "O valor da NF precisa ser um número maior ou igual a zero.";
const INVOICE_KEY_MESSAGE = "A chave da NF precisa ter 44 dígitos.";
const DRIVER_MESSAGE = "Motorista inválido.";

// A coluna é int4: acima do teto o banco recusaria com erro em vez de 400.
const MAX_VOLUMES = 2147483647;

const volumesNumber = z
  .number(VOLUMES_MESSAGE)
  .int(VOLUMES_MESSAGE)
  .min(1, VOLUMES_MESSAGE)
  .max(MAX_VOLUMES, VOLUMES_MESSAGE);
const weightNumber = z.number(WEIGHT_MESSAGE).gt(0, WEIGHT_MESSAGE);

// Vazio vira `null` (apaga o campo); ausente não mexe.
const invoiceValue = z.preprocess(
  fromFormNumber,
  z.number(INVOICE_VALUE_MESSAGE).min(0, INVOICE_VALUE_MESSAGE).nullish(),
);

// Guarda só os dígitos: a chave chega com espaço e ponto quando é colada da nota.
const invoiceKey = z
  .string(INVOICE_KEY_MESSAGE)
  .trim()
  .transform((value) => (value === "" ? null : value.replace(/\D/g, "")))
  .pipe(z.string().length(44, INVOICE_KEY_MESSAGE).nullable())
  .nullish();

// Vazio ou `null` deixa a coleta sem motorista.
const driverId = z
  .string(DRIVER_MESSAGE)
  .trim()
  .max(64, DRIVER_MESSAGE)
  .transform((value) => (value === "" ? null : value))
  .nullish();

export const createCollectionSchema = z.object(
  {
    clientId: z.string("Informe o cliente.").trim().min(1, "Informe o cliente.").max(64, "Cliente inválido."),
    sender,
    receiver,
    origin,
    destination,
    volumes: z.preprocess(fromFormNumber, volumesNumber),
    weight: z.preprocess(fromFormNumber, weightNumber),
    invoiceKey,
    invoiceValue,
    driverId,
  },
  INVALID_BODY,
);

// Cliente, status, código de rastreio, manifesto e CT-e não entram aqui: o
// schema descarta qualquer chave fora desta lista antes de a rota gravar.
export const updateCollectionSchema = z
  .object(
    {
      sender: sender.optional(),
      receiver: receiver.optional(),
      origin: origin.optional(),
      destination: destination.optional(),
      volumes: z.preprocess(fromFormNumber, volumesNumber.optional()),
      weight: z.preprocess(fromFormNumber, weightNumber.optional()),
      invoiceKey,
      invoiceValue,
      driverId,
    },
    INVALID_BODY,
  )
  .refine((data) => Object.values(data).some((value) => value !== undefined), { message: NOTHING_TO_CHANGE });

/**
 * Campos do formulário de edição que diferem do que está gravado. A tela manda
 * só estes no PATCH: coleta antiga com chave de NF fora do padrão continua
 * editável nos outros campos.
 */
export function changedFields<T extends Record<string, unknown>>(original: T, current: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(current).filter(([field, value]) => value !== original[field]),
  ) as Partial<T>;
}

const RECEIVER_NAME_MESSAGE = "Informe o nome de quem recebeu (2 a 120 caracteres).";

export const statusChangeSchema = z
  .object(
    {
      status: z.enum(OPERATOR_TARGET_STATUSES, "Status inválido."),
      receiverName: z
        .string(RECEIVER_NAME_MESSAGE)
        .trim()
        .min(2, RECEIVER_NAME_MESSAGE)
        .max(120, RECEIVER_NAME_MESSAGE)
        .optional(),
    },
    INVALID_BODY,
  )
  .refine((data) => data.status !== "DELIVERED" || data.receiverName !== undefined, {
    message: RECEIVER_NAME_MESSAGE,
  });
