import { z } from "zod";
import { DRIVER_OMIT, DRIVER_USER_SELECT } from "@/lib/usuarios";
import { CAMPOS_DE_ENDERECO } from "@/lib/endereco";

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
  driver: { include: { user: { select: DRIVER_USER_SELECT } }, omit: DRIVER_OMIT },
  // Só o que a lista precisa para saber se há comprovante: foto e assinatura
  // pesam megabytes e ficam para a tela do comprovante.
  proof: { select: { id: true, status: true, exceptionType: true } },
  // Tentativas de entrega sem sucesso registradas pelo motorista (src/lib/comprovantes.ts).
  _count: { select: { deliveryAttempts: true } },
} as const;

const INVALID_BODY = "Dados inválidos.";
const NOTHING_TO_CHANGE = "Informe ao menos um campo para alterar.";

export const INACTIVE_CLIENT_MESSAGE = "Cliente não encontrado ou inativo.";
export const INACTIVE_DRIVER_MESSAGE = "Motorista não encontrado ou inativo.";

// O formulário manda número como texto ("12,5", "" quando em branco). Só
// dígitos com uma vírgula ou ponto decimal: `Number()` sozinho leria "0x10"
// como 16 e "1e3" como 1000. O campo `type="number"` entrega ".5" e "5."
// quando o operador digita sem o zero, então um dos lados pode faltar.
const FORM_NUMBER = /^(\d+([.,]\d*)?|[.,]\d+)$/;

export const fromFormNumber = (value: unknown) => {
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
const FREIGHT_VALUE_MESSAGE = "O frete precisa ser um número maior ou igual a zero.";
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

const clientId = z.string("Informe o cliente.").trim().min(1, "Informe o cliente.").max(64, "Cliente inválido.");

// --- Pedido de coleta: quando buscar, urgência, cubagem e observação ---------
// Tudo opcional, no painel e no portal. Vazio vira `null` (apaga); ausente não mexe.

export const PRIORIDADES = ["NORMAL", "URGENT"] as const;
export type Prioridade = (typeof PRIORIDADES)[number];
export const PRIORIDADE_LABEL: Record<Prioridade, string> = { NORMAL: "Normal", URGENT: "Urgente" };

const PICKUP_DATE_MESSAGE = "A data da coleta precisa ser um dia válido.";
const PICKUP_TIME_MESSAGE = "O horário da janela precisa estar no formato HH:MM.";
const CUBIC_METERS_MESSAGE = "A cubagem precisa ser um número maior que zero, em m³.";
const PICKUP_NOTES_MESSAGE = "Observação muito longa (máximo de 500 letras).";
export const JANELA_INVERTIDA = "O fim da janela de coleta precisa ser depois do início.";

const emBrancoViraNulo = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);

// Dia do calendário (`AAAA-MM-DD`), gravado à meia-noite UTC como o vencimento.
// O `Date` aceita "2026-02-31" e devolve março: a volta para texto confere.
const pickupDate = z.preprocess(
  emBrancoViraNulo,
  z
    .string(PICKUP_DATE_MESSAGE)
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, PICKUP_DATE_MESSAGE)
    .refine((dia) => {
      const data = new Date(`${dia}T00:00:00.000Z`);
      return !Number.isNaN(data.getTime()) && data.toISOString().slice(0, 10) === dia;
    }, PICKUP_DATE_MESSAGE)
    .transform((dia) => new Date(`${dia}T00:00:00.000Z`))
    .nullish(),
);

const pickupTime = z.preprocess(
  emBrancoViraNulo,
  z.string(PICKUP_TIME_MESSAGE).trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/, PICKUP_TIME_MESSAGE).nullish(),
);

const priority = z.enum(PRIORIDADES, "Prioridade inválida.").optional();

const cubicMeters = z.preprocess(
  fromFormNumber,
  z.number(CUBIC_METERS_MESSAGE).gt(0, CUBIC_METERS_MESSAGE).max(100000, CUBIC_METERS_MESSAGE).nullish(),
);

const pickupNotes = z.preprocess(
  emBrancoViraNulo,
  z.string(PICKUP_NOTES_MESSAGE).trim().max(500, PICKUP_NOTES_MESSAGE).nullish(),
);

/** Os campos do pedido, para os schemas do painel e para o do portal. */
export const CAMPOS_DO_PEDIDO = {
  pickupDate,
  pickupFrom: pickupTime,
  pickupTo: pickupTime,
  priority,
  cubicMeters,
  pickupNotes,
} as const;

/** O que o portal manda além dos dados da carga (que a rota dele confere à mão). */
export const pedidoDeColetaSchema = z.object(CAMPOS_DO_PEDIDO, INVALID_BODY);

/**
 * A janela só faz sentido com o fim depois do início. Fica fora dos schemas de
 * propósito: na edição um dos lados pode vir do que já está gravado, e schema
 * com `refine` não aceita `omit` (src/lib/nfe.ts usa).
 */
export function janelaInvertida(de: string | null | undefined, ate: string | null | undefined): boolean {
  return Boolean(de && ate && de >= ate);
}

/** A janela como aparece nas telas: "12/10 das 08:00 às 12:00", ou só o que foi informado. Vazio = sem janela. */
export function janelaDaColeta(coleta: {
  pickupDate?: Date | string | null;
  pickupFrom?: string | null;
  pickupTo?: string | null;
}): string {
  const partes: string[] = [];
  if (coleta.pickupDate) {
    // Dia do calendário: lido em UTC, sem passar pelo fuso do aparelho.
    const [, mes, dia] = new Date(coleta.pickupDate).toISOString().slice(0, 10).split("-");
    partes.push(`${dia}/${mes}`);
  }
  if (coleta.pickupFrom && coleta.pickupTo) partes.push(`das ${coleta.pickupFrom} às ${coleta.pickupTo}`);
  else if (coleta.pickupFrom) partes.push(`a partir das ${coleta.pickupFrom}`);
  else if (coleta.pickupTo) partes.push(`até as ${coleta.pickupTo}`);
  return partes.join(" ");
}

/** Campos que a conversão de cotação em coleta (src/lib/crm.ts) valida do mesmo jeito. */
export const COLLECTION_FIELDS = { clientId, sender, receiver, invoiceKey, invoiceValue } as const;

export const createCollectionSchema = z.object(
  {
    clientId,
    sender,
    receiver,
    origin,
    destination,
    volumes: z.preprocess(fromFormNumber, volumesNumber),
    weight: z.preprocess(fromFormNumber, weightNumber),
    invoiceKey,
    invoiceValue,
    driverId,
    ...CAMPOS_DO_PEDIDO,
    // Endereço da entrega, além da cidade: opcional (src/lib/endereco.ts).
    ...CAMPOS_DE_ENDERECO,
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
      ...CAMPOS_DO_PEDIDO,
      ...CAMPOS_DE_ENDERECO,
      // Frete informado à mão. Número fixa o valor; vazio ou `null` devolve o
      // cálculo para a tabela de frete.
      freightValue: z.preprocess(
        fromFormNumber,
        z.number(FREIGHT_VALUE_MESSAGE).min(0, FREIGHT_VALUE_MESSAGE).nullish(),
      ),
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
