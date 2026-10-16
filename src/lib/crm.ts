import { z } from "zod";
import { COLLECTION_FIELDS, fromFormNumber } from "@/lib/coletas";

// Regras das cotações (o funil, antes chamado de CRM): quais status, canais e
// motivos de perda existem, o que é cotação parada, os filtros da lista, o
// resumo do topo da tela, o CSV e o que as rotas aceitam gravar. Este arquivo
// também é importado pela tela, então não pode puxar nada que só exista no
// servidor.

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

/** Cotação em aberto: ainda não virou coleta nem foi perdida. É a mesma lista da conversão. */
export const LEAD_OPEN_STATUSES = LEAD_CONVERTIBLE_STATUSES;

export function isConvertible(status: string): boolean {
  return (LEAD_CONVERTIBLE_STATUSES as readonly string[]).includes(status);
}

export const isOpen = (status: string): boolean => (LEAD_OPEN_STATUSES as readonly string[]).includes(status);

/* ----------------------------- Canal e motivo de perda ----------------------------- */

/** Por onde o pedido chegou. SITE é o formulário público; os outros a equipe registra no painel. */
export const LEAD_CHANNELS = ["SITE", "WHATSAPP", "EMAIL", "TELEFONE"] as const;
export type LeadChannel = (typeof LEAD_CHANNELS)[number];

export const LEAD_CHANNEL_LABELS: Record<LeadChannel, string> = {
  SITE: "Site",
  WHATSAPP: "WhatsApp",
  EMAIL: "E-mail",
  TELEFONE: "Telefone",
};

/** Canais que a equipe escolhe ao registrar uma cotação no painel. */
export const LEAD_MANUAL_CHANNELS = ["WHATSAPP", "TELEFONE", "EMAIL"] as const;

export const LOST_REASONS = ["PRECO", "PRAZO", "DESISTIU", "SEM_RETORNO", "OUTRA_TRANSPORTADORA", "OUTRO"] as const;
export type LostReason = (typeof LOST_REASONS)[number];

export const LOST_REASON_LABELS: Record<LostReason, string> = {
  PRECO: "Preço acima do concorrente",
  PRAZO: "Prazo de entrega",
  DESISTIU: "Cliente desistiu do envio",
  SEM_RETORNO: "Sem retorno do cliente",
  OUTRA_TRANSPORTADORA: "Fechou com outra transportadora",
  OUTRO: "Outro",
};

export const rotuloDoCanal = (canal: string) => (LEAD_CHANNEL_LABELS as Record<string, string>)[canal] ?? canal;
export const rotuloDaPerda = (motivo: string | null | undefined) =>
  motivo ? ((LOST_REASON_LABELS as Record<string, string>)[motivo] ?? motivo) : "";

/* ----------------------------- Cotação parada ----------------------------- */

/** Dias sem atividade a partir dos quais uma cotação em aberto é "parada" e pede cobrança. */
export const DIAS_PARA_COBRAR = 2;

const DIA_EM_MS = 24 * 60 * 60 * 1000;

export type LeadParaParada = { status: string; lastActivityAt: string | Date };

/**
 * Há quantos dias a cotação está parada; `null` quando não está (fechada, ou
 * mexida há menos de `DIAS_PARA_COBRAR` dias).
 */
export function diasParada(lead: LeadParaParada, agora: number | Date = Date.now()): number | null {
  if (!isOpen(lead.status)) return null;
  const desde = new Date(lead.lastActivityAt).getTime();
  const dias = Math.floor((new Date(agora).getTime() - desde) / DIA_EM_MS);
  return dias >= DIAS_PARA_COBRAR ? dias : null;
}

export const estaParada = (lead: LeadParaParada, agora: number | Date = Date.now()): boolean => diasParada(lead, agora) !== null;

/** O instante antes do qual a última atividade torna a cotação parada. */
export const limiteDeParada = (agora: number | Date = Date.now()): Date => new Date(new Date(agora).getTime() - DIAS_PARA_COBRAR * DIA_EM_MS);

/* ----------------------------- Filtros da lista ----------------------------- */

export const PERIODOS_DA_LISTA = [7, 30, 90] as const;

/** `status` aceita os quatro status e `parada`; `assigneeId` aceita `ninguem` (sem responsável). */
export type FiltrosDeCotacao = {
  status?: LeadStatus | "parada";
  dias?: number;
  assigneeId?: string;
  busca?: string;
};

const ehStatus = (valor: string): valor is LeadStatus => (LEAD_STATUSES as readonly string[]).includes(valor);

export function filtrosDaLista(params: URLSearchParams): FiltrosDeCotacao {
  const status = params.get("status") ?? "";
  const dias = Number(params.get("dias") ?? "");
  const assigneeId = (params.get("assigneeId") ?? "").trim();
  const busca = (params.get("busca") ?? "").trim().slice(0, 120);
  return {
    ...(ehStatus(status) || status === "parada" ? { status } : {}),
    ...(Number.isInteger(dias) && dias > 0 && dias <= 3650 ? { dias } : {}),
    ...(assigneeId ? { assigneeId } : {}),
    ...(busca ? { busca } : {}),
  };
}

/** A cláusula `where` da lista. É um objeto simples: o Prisma só entra na rota. */
export function ondeDaLista(filtros: FiltrosDeCotacao, agora: number | Date = Date.now()): Record<string, unknown> {
  const onde: Record<string, unknown> = {};
  if (filtros.status === "parada") {
    onde.status = { in: [...LEAD_OPEN_STATUSES] };
    onde.lastActivityAt = { lt: limiteDeParada(agora) };
  } else if (filtros.status) {
    onde.status = filtros.status;
  }
  if (filtros.dias) onde.createdAt = { gte: new Date(new Date(agora).getTime() - filtros.dias * DIA_EM_MS) };
  if (filtros.assigneeId === "ninguem") onde.assigneeId = null;
  else if (filtros.assigneeId) onde.assigneeId = filtros.assigneeId;
  if (filtros.busca) {
    const contem = { contains: filtros.busca, mode: "insensitive" };
    const ou: Record<string, unknown>[] = [
      { companyName: contem },
      { email: contem },
      { phone: contem },
      { origin: contem },
      { destination: contem },
    ];
    // "1494" acha a cotação nº 1494 e também quem tem 1494 no telefone.
    if (/^\d+$/.test(filtros.busca) && Number(filtros.busca) <= 2147483647) ou.push({ number: Number(filtros.busca) });
    onde.OR = ou;
  }
  return onde;
}

/* ----------------------------- Resumo e CSV ----------------------------- */

/** O que a lista e o CSV precisam de cada cotação. É o formato que `GET /api/dashboard/crm` devolve. */
export type LeadDaLista = {
  id: string;
  number: number | null;
  companyName: string;
  email: string;
  phone: string;
  origin: string;
  destination: string;
  volumes: number;
  weight: number;
  estimatedValue: number | null;
  invoiceValue: number | null;
  status: string;
  channel: string;
  lostReason: string | null;
  lastActivityAt: string | Date;
  createdAt: string | Date;
  assignee: { id: string; name: string } | null;
  collection: { id: string; trackingCode: string | null; status: string } | null;
};

export type ResumoDoFunil = {
  total: number;
  abertas: number;
  ganhas: number;
  perdidas: number;
  /** Ganhas sobre as decididas (ganhas + perdidas); `null` sem nenhuma decidida. */
  conversao: number | null;
  /** Soma do valor estimado de todas; sem valor conta zero. */
  cotado: number;
  /** Soma do valor estimado das convertidas. */
  fechado: number;
  paradas: number;
};

export function resumoDoFunil(leads: readonly Pick<LeadDaLista, "status" | "estimatedValue" | "lastActivityAt">[], agora: number | Date = Date.now()): ResumoDoFunil {
  const ganhas = leads.filter((l) => l.status === "CONVERTED");
  const perdidas = leads.filter((l) => l.status === "LOST").length;
  const decididas = ganhas.length + perdidas;
  const soma = (lista: readonly { estimatedValue: number | null }[]) => lista.reduce((total, l) => total + (l.estimatedValue ?? 0), 0);
  return {
    total: leads.length,
    abertas: leads.filter((l) => isOpen(l.status)).length,
    ganhas: ganhas.length,
    perdidas,
    conversao: decididas ? ganhas.length / decididas : null,
    cotado: Math.round(soma(leads) * 100) / 100,
    fechado: Math.round(soma(ganhas) * 100) / 100,
    paradas: leads.filter((l) => estaParada(l, agora)).length,
  };
}

const dataHora = (valor: string | Date) =>
  new Date(valor).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

const numeroCsv = (valor: number | null) => (valor === null ? "" : String(valor).replace(".", ","));

/** As linhas do CSV, cabeçalho incluído. Números com vírgula decimal, como a planilha brasileira lê. */
export function linhasDoCsv(leads: readonly LeadDaLista[], agora: number | Date = Date.now()): string[][] {
  const cabecalho = [
    "Nº",
    "Criada em",
    "Empresa",
    "E-mail",
    "Telefone",
    "Origem",
    "Destino",
    "Volumes",
    "Peso (kg)",
    "Valor da nota (R$)",
    "Valor estimado (R$)",
    "Canal",
    "Status",
    "Motivo da perda",
    "Responsável",
    "Última atividade",
    "Parada há (dias)",
    "Rastreio da coleta",
  ];
  return [
    cabecalho,
    ...leads.map((l) => [
      l.number === null ? "" : String(l.number),
      dataHora(l.createdAt),
      l.companyName,
      l.email,
      l.phone,
      l.origin,
      l.destination,
      String(l.volumes),
      numeroCsv(l.weight),
      numeroCsv(l.invoiceValue),
      numeroCsv(l.estimatedValue),
      rotuloDoCanal(l.channel),
      (LEAD_STATUS_LABELS as Record<string, string>)[l.status] ?? l.status,
      rotuloDaPerda(l.lostReason),
      l.assignee?.name ?? "",
      dataHora(l.lastActivityAt),
      String(diasParada(l, agora) ?? ""),
      l.collection?.trackingCode ?? "",
    ]),
  ];
}

/** Texto do CSV: ponto e vírgula, BOM para o Excel abrir com acento certo, aspas só quando preciso. */
export function csvDeCotacoes(linhas: readonly (readonly string[])[]): string {
  const celula = (valor: string) => (/[;"\n\r]/.test(valor) ? `"${valor.replace(/"/g, '""')}"` : valor);
  return "﻿" + linhas.map((linha) => linha.map(celula).join(";")).join("\r\n");
}

/* ----------------------------- Mensagens e respostas ----------------------------- */

export const LEAD_NOT_FOUND_MESSAGE = "Cotação não encontrada.";
export const LEAD_LOCKED_MESSAGE = "Cotação já convertida em coleta: não pode mais ser alterada.";
export const LEAD_ALREADY_CONVERTED_MESSAGE = "Cotação já convertida em coleta.";
export const LEAD_LOST_MESSAGE = "Cotação marcada como perdida: volte para Em contato antes de converter.";
export const ASSIGNEE_MESSAGE = "O responsável precisa ser um usuário da equipe comercial.";

// O que as rotas do funil devolvem junto do lead: da coleta, só o que o cartão
// mostra; do responsável, só id e nome.
export const LEAD_INCLUDE = {
  collection: { select: { id: true, trackingCode: true, status: true } },
  assignee: { select: { id: true, name: true } },
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

/* ----------------------------- O que as rotas aceitam ----------------------------- */

const INVALID_BODY = "Dados inválidos.";
const NOTHING_TO_CHANGE = "Informe ao menos um campo para alterar.";
const ESTIMATED_VALUE_MESSAGE = "O valor precisa ser um número maior ou igual a zero.";
const MAX_ESTIMATED_VALUE = 1_000_000_000;

// Vazio ou `null` tira o responsável; ausente não mexe.
const idOuNada = (valor: unknown) => (typeof valor === "string" && valor.trim() === "" ? null : valor);

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
      assigneeId: z.preprocess(idOuNada, z.string(ASSIGNEE_MESSAGE).trim().min(1, ASSIGNEE_MESSAGE).max(64, ASSIGNEE_MESSAGE).nullish()),
      // Só faz sentido com status LOST; a rota apaga ao sair de Perdidos.
      lostReason: z.enum(LOST_REASONS, "Motivo da perda inválido.").nullish(),
      // "Falei com o cliente": só renova a última atividade e tira a cotação de parada.
      contato: z.literal(true, "Dados inválidos.").optional(),
    },
    INVALID_BODY,
  )
  .refine((data) => Object.values(data).some((value) => value !== undefined), { message: NOTHING_TO_CHANGE });

export type UpdateLead = z.infer<typeof updateLeadSchema>;

const texto = (obrigatorio: string, max: number, longo: string) => z.string(obrigatorio).trim().min(1, obrigatorio).max(max, longo);

const numeroDoFormulario = (valor: unknown) => {
  if (typeof valor !== "string") return valor;
  const limpo = valor.trim().replace(",", ".");
  return limpo === "" ? undefined : Number(limpo);
};

/**
 * Cotação registrada pela equipe no painel (pedido que chegou por WhatsApp,
 * telefone ou e-mail). Telefone ou e-mail, ao menos um: é por ali que a
 * resposta volta. O valor estimado sai da tabela padrão, como no site.
 */
export const createLeadSchema = z
  .object(
    {
      companyName: texto("Informe a empresa ou o nome do cliente.", 200, "Nome muito longo."),
      email: z.preprocess((v) => (typeof v === "string" ? v.trim().toLowerCase() : v), z.string().max(254, "E-mail muito longo.").pipe(z.union([z.literal(""), z.email("E-mail inválido.")])).optional()),
      phone: z.string().trim().max(30, "Telefone muito longo.").optional(),
      channel: z.enum(LEAD_MANUAL_CHANNELS, "Informe por onde o pedido chegou."),
      origin: texto("Informe a cidade de origem.", 200, "Origem muito longa."),
      destination: texto("Informe a cidade de destino.", 200, "Destino muito longo."),
      volumes: z.preprocess(numeroDoFormulario, z.number("Informe a quantidade de volumes.").int("A quantidade de volumes precisa ser um número inteiro.").min(1, "A quantidade de volumes precisa ser maior que zero.").max(100000, "Volumes demais.")).optional(),
      weight: z.preprocess(numeroDoFormulario, z.number("Informe o peso em kg.").positive("O peso precisa ser maior que zero.").max(1000000, "Peso acima do limite.")),
      invoiceValue: z.preprocess(numeroDoFormulario, z.number("O valor da nota precisa ser um número maior ou igual a zero.").min(0, "O valor da nota precisa ser um número maior ou igual a zero.").max(MAX_ESTIMATED_VALUE, "Valor da nota acima do limite.")).optional(),
      assigneeId: z.preprocess(idOuNada, z.string(ASSIGNEE_MESSAGE).trim().min(1, ASSIGNEE_MESSAGE).max(64, ASSIGNEE_MESSAGE).nullish()),
    },
    INVALID_BODY,
  )
  .refine((data) => Boolean(data.email) || Boolean(data.phone), { message: "Informe o telefone ou o e-mail do cliente.", path: ["phone"] });

export type CreateLead = z.infer<typeof createLeadSchema>;

// Origem, destino, volumes e peso não entram: vêm do lead, e o schema descarta
// qualquer chave fora desta lista antes de a rota gravar.
export const convertLeadSchema = z.object(COLLECTION_FIELDS, INVALID_BODY);
