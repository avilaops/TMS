import { z } from "zod";
import { COLLECTION_FIELDS, fromFormNumber } from "@/lib/coletas";

// Regras do funil de cotações: quais status existem, quais o operador escolhe
// e o que as rotas aceitam gravar. Este arquivo também é importado pela tela,
// então não pode puxar nada que só exista no servidor.

export const LEAD_STATUSES = ["NEW", "CONTACTED", "CONVERTED", "LOST"] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  NEW: "Novos",
  CONTACTED: "Em contato",
  CONVERTED: "Convertidos",
  LOST: "Perdidos",
};

// `CONVERTED` não está aqui de propósito: só a conversão em coleta põe o lead
// nesse status, e é ela que cria a coleta junto.
export const LEAD_MANUAL_STATUSES = ["NEW", "CONTACTED", "LOST"] as const;

/** Status de onde o lead pode ser convertido em coleta. */
export const LEAD_CONVERTIBLE_STATUSES = ["NEW", "CONTACTED"] as const;

export function isConvertible(status: string): boolean {
  return (LEAD_CONVERTIBLE_STATUSES as readonly string[]).includes(status);
}

export const LEAD_NOT_FOUND_MESSAGE = "Cotação não encontrada.";
export const LEAD_LOCKED_MESSAGE = "Cotação já convertida em coleta: não pode mais ser alterada.";
export const LEAD_ALREADY_CONVERTED_MESSAGE = "Cotação já convertida em coleta.";
export const LEAD_LOST_MESSAGE = "Cotação marcada como perdida: volte para Em contato antes de converter.";

// O que as rotas do funil devolvem junto do lead: da coleta, só o que o cartão mostra.
export const LEAD_INCLUDE = {
  collection: { select: { id: true, trackingCode: true, status: true } },
} as const;

// O que a conversão devolve da coleta criada. Sem o cadastro do cliente.
// `freightValue` vai junto para a tela comparar com o valor estimado do lead.
export const CONVERTED_COLLECTION_SELECT = {
  id: true,
  trackingCode: true,
  status: true,
  clientId: true,
  sender: true,
  receiver: true,
  origin: true,
  destination: true,
  volumes: true,
  weight: true,
  invoiceValue: true,
  freightValue: true,
} as const;

/**
 * O valor estimado no lead e o frete com que a coleta nasceu são números
 * diferentes: o primeiro é o que o comercial combinou no funil, o segundo sai
 * da tabela de frete e é o que o faturamento cobra. A conversão não troca um
 * pelo outro; quando divergem, a tela mostra os dois para o operador decidir
 * se ajusta o frete na coleta. Sem valor estimado não há o que comparar.
 */
export function divergenciaDeFrete(
  estimatedValue: number | null | undefined,
  freightValue: number | null | undefined,
): { estimado: number; frete: number | null } | null {
  if (estimatedValue === null || estimatedValue === undefined || freightValue === undefined) return null;
  if (freightValue !== null && Math.round(estimatedValue * 100) === Math.round(freightValue * 100)) return null;
  return { estimado: estimatedValue, frete: freightValue };
}

const INVALID_BODY = "Dados inválidos.";
const NOTHING_TO_CHANGE = "Informe ao menos um campo para alterar.";
const ESTIMATED_VALUE_MESSAGE = "O valor precisa ser um número maior ou igual a zero.";
const MAX_ESTIMATED_VALUE = 1_000_000_000;

export const updateLeadSchema = z
  .object(
    {
      status: z.enum(LEAD_MANUAL_STATUSES, "Status inválido.").optional(),
      // Vazio ou `null` apaga o valor; ausente não mexe.
      estimatedValue: z.preprocess(
        fromFormNumber,
        z
          .number(ESTIMATED_VALUE_MESSAGE)
          .min(0, ESTIMATED_VALUE_MESSAGE)
          .max(MAX_ESTIMATED_VALUE, ESTIMATED_VALUE_MESSAGE)
          .nullish(),
      ),
    },
    INVALID_BODY,
  )
  .refine((data) => Object.values(data).some((value) => value !== undefined), { message: NOTHING_TO_CHANGE });

// Origem, destino, volumes e peso não entram: vêm do lead, e o schema descarta
// qualquer chave fora desta lista antes de a rota gravar.
export const convertLeadSchema = z.object(COLLECTION_FIELDS, INVALID_BODY);
