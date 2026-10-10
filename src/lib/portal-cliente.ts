import { z } from "zod";
import { fromFormNumber } from "@/lib/coletas";
import { dataPorExtenso } from "@/lib/cobranca";
import { diaNoBrasil } from "@/lib/financeiro";
import { COLLECTION_STATUS, statusBadge } from "@/lib/format";
import type { Frete, TabelaDeFrete } from "@/lib/frete";

/**
 * Portal do cliente: cotação, destinatários frequentes, exportação das coletas
 * e a tabela de frete que ele pode ver.
 *
 * Aqui ficam as validações e as contas puras. O que identifica o cliente
 * (`requirePortalClient`) mora em src/lib/portal.ts, que só o servidor importa;
 * este arquivo também é importado pelas telas.
 *
 * Regra que vale para tudo: o cliente vê o resultado (valor, prazo, avisos,
 * frete mínimo da cidade), nunca a regra da tabela (percentual, R$ por kg,
 * limite de nota, nome da tabela, composição da conta).
 */

const INVALID_BODY = "Dados inválidos.";

/* ------------------------------- Cotação ----------------------------------- */

const WEIGHT_MESSAGE = "O peso precisa ser um número maior que zero.";
const VOLUMES_MESSAGE = "Os volumes precisam ser um número inteiro maior ou igual a 1.";
const INVOICE_VALUE_MESSAGE = "O valor da nota precisa ser um número maior ou igual a zero.";
const CUBIC_METERS_MESSAGE = "A cubagem precisa ser um número maior que zero, em m³.";

export const cotacaoDoPortalSchema = z.object(
  {
    destination: z.string("Informe a cidade de destino.").trim().min(2, "Informe a cidade de destino.").max(120, "Destino muito longo."),
    weight: z.preprocess(fromFormNumber, z.number(WEIGHT_MESSAGE).gt(0, WEIGHT_MESSAGE).max(1_000_000, WEIGHT_MESSAGE)),
    volumes: z.preprocess(fromFormNumber, z.number(VOLUMES_MESSAGE).int(VOLUMES_MESSAGE).min(1, VOLUMES_MESSAGE).max(100_000, VOLUMES_MESSAGE)),
    invoiceValue: z.preprocess(fromFormNumber, z.number(INVOICE_VALUE_MESSAGE).min(0, INVOICE_VALUE_MESSAGE).nullish()),
    cubicMeters: z.preprocess(fromFormNumber, z.number(CUBIC_METERS_MESSAGE).gt(0, CUBIC_METERS_MESSAGE).max(100_000, CUBIC_METERS_MESSAGE).nullish()),
  },
  INVALID_BODY,
);

export type CotacaoDoPortal =
  | { atendida: false; motivo: "sem_tabela" | "fora_da_tabela" }
  | { atendida: true; cidade: string; valor: number; prazoHoras: number; avisos: string[] };

/**
 * O que a cotação devolve ao cliente. A composição da conta e o peso taxável
 * ficam de fora de propósito: entregariam a regra da tabela.
 */
export function cotacaoParaOCliente(frete: Frete | null): CotacaoDoPortal {
  if (!frete) return { atendida: false, motivo: "sem_tabela" };
  if (!frete.atendida) return { atendida: false, motivo: "fora_da_tabela" };
  return { atendida: true, cidade: frete.cidade, valor: frete.valor, prazoHoras: frete.prazoHoras, avisos: frete.avisos };
}

/** Prazo em horas como o cliente lê: "24 horas", "2 dias". */
export function prazoPorExtenso(horas: number): string {
  if (horas % 24 !== 0 || horas < 48) return `${horas} ${horas === 1 ? "hora" : "horas"}`;
  return `${horas / 24} dias`;
}

/* --------------------------- Tabela de frete -------------------------------- */

export type CidadeAtendida = { city: string; minimum: number; deadlineHours: number; dedicated: boolean };

/** As cidades da tabela que vale para o cliente, em ordem alfabética, só com o que ele pode ver. */
export function cidadesAtendidas(tabela: Pick<TabelaDeFrete, "cities"> | null): CidadeAtendida[] {
  if (!tabela) return [];
  return tabela.cities
    .map(({ city, minimum, deadlineHours, dedicated }) => ({ city, minimum, deadlineHours, dedicated }))
    .sort((a, b) => a.city.localeCompare(b.city, "pt-BR"));
}

/* ------------------------ Destinatários frequentes -------------------------- */

/** Teto por cliente: a lista é um apoio para preencher o pedido, não um cadastro geral. */
export const MAX_DESTINATARIOS = 200;
export const LIMITE_DE_DESTINATARIOS = `Limite de ${MAX_DESTINATARIOS} destinatários atingido. Apague um para cadastrar outro.`;

const DOCUMENT_MESSAGE = "O CNPJ/CPF precisa ter 14 ou 11 dígitos.";

const opcional = (max: number, longo: string) =>
  z
    .string(INVALID_BODY)
    .trim()
    .max(max, longo)
    .transform((valor) => (valor === "" ? null : valor))
    .nullish();

const CAMPOS_DO_DESTINATARIO = {
  name: z.string("Informe o nome do destinatário.").trim().min(2, "Informe o nome do destinatário.").max(200, "Nome muito longo."),
  // Guarda só os dígitos: o documento chega com ponto, barra e traço.
  document: z
    .string(DOCUMENT_MESSAGE)
    .trim()
    .transform((valor) => (valor === "" ? null : valor.replace(/\D/g, "")))
    .pipe(z.string().regex(/^(\d{11}|\d{14})$/, DOCUMENT_MESSAGE).nullable())
    .nullish(),
  city: z.string("Informe a cidade e a UF.").trim().min(2, "Informe a cidade e a UF.").max(120, "Cidade muito longa."),
  address: opcional(300, "Endereço muito longo."),
  contactName: opcional(120, "Nome do contato muito longo."),
  phone: opcional(30, "Telefone muito longo."),
} as const;

export const criarDestinatarioSchema = z.object(CAMPOS_DO_DESTINATARIO, INVALID_BODY);

export const alterarDestinatarioSchema = z
  .object(CAMPOS_DO_DESTINATARIO, INVALID_BODY)
  .partial()
  .refine((dados) => Object.values(dados).some((valor) => valor !== undefined), "Informe ao menos um campo para alterar.");

export const DESTINATARIO_SELECT = {
  id: true,
  name: true,
  document: true,
  city: true,
  address: true,
  contactName: true,
  phone: true,
} as const;

export type Destinatario = {
  id: string;
  name: string;
  document: string | null;
  city: string;
  address: string | null;
  contactName: string | null;
  phone: string | null;
};

/* ----------------------- Exportação das coletas (CSV) ----------------------- */

/** Maior período de uma exportação, em dias, e o teto de linhas do arquivo. */
export const MAX_DIAS_DA_EXPORTACAO = 366;
export const MAX_LINHAS_DA_EXPORTACAO = 5000;

const DIA = /^\d{4}-\d{2}-\d{2}$/;
const DIA_EM_MS = 24 * 60 * 60 * 1000;

const diaValido = (dia: string) => {
  if (!DIA.test(dia)) return false;
  const data = new Date(`${dia}T00:00:00.000Z`);
  return !Number.isNaN(data.getTime()) && data.toISOString().slice(0, 10) === dia;
};

export type PeriodoDaExportacao =
  | { ok: false; erro: string }
  | { ok: true; de: string; ate: string; inicio: Date; fim: Date };

/**
 * O período pedido (`de` e `ate`, dias do calendário do Brasil), como instantes
 * para filtrar `createdAt`: do começo do primeiro dia até o começo do dia
 * seguinte ao último (`fim` fica de fora). Sem os dois, vale os últimos 30 dias.
 */
export function periodoDaExportacao(de: string | null, ate: string | null, hoje: Date = new Date()): PeriodoDaExportacao {
  const ultimo = ate || diaNoBrasil(hoje);
  const primeiro = de || new Date(Date.parse(`${ultimo}T00:00:00.000Z`) - 29 * DIA_EM_MS).toISOString().slice(0, 10);

  if (!diaValido(primeiro) || !diaValido(ultimo)) return { ok: false, erro: "Informe o período com datas válidas." };
  if (primeiro > ultimo) return { ok: false, erro: "A data inicial precisa ser antes da final." };

  const dias = (Date.parse(`${ultimo}T00:00:00.000Z`) - Date.parse(`${primeiro}T00:00:00.000Z`)) / DIA_EM_MS + 1;
  if (dias > MAX_DIAS_DA_EXPORTACAO) return { ok: false, erro: `O período pode ter no máximo ${MAX_DIAS_DA_EXPORTACAO} dias.` };

  // O Brasil não tem horário de verão: o dia começa sempre às 03:00 UTC.
  const inicio = new Date(`${primeiro}T00:00:00-03:00`);
  const fim = new Date(new Date(`${ultimo}T00:00:00-03:00`).getTime() + DIA_EM_MS);
  return { ok: true, de: primeiro, ate: ultimo, inicio, fim };
}

/**
 * Uma célula de texto do CSV. Planilha trata como fórmula o que começa com
 * `=`, `+`, `-` ou `@` (e com tabulação ou quebra de linha na frente): o
 * destinatário "=HYPERLINK(...)" digitado por alguém rodaria no Excel de quem
 * abre o arquivo. Um apóstrofo na frente faz a planilha ler como texto.
 */
export function celulaDeTexto(valor: string | null | undefined): string {
  const texto = (valor ?? "").replace(/\r?\n|\r/g, " ");
  const seguro = /^[=+\-@\t]/.test(texto.trimStart()) ? `'${texto}` : texto;
  return `"${seguro.replace(/"/g, '""')}"`;
}

// Número com vírgula decimal, como o Excel em português espera.
const numero = (valor: number, casas: number) =>
  valor.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: Math.max(casas, 3), useGrouping: false });

export type ColetaExportada = {
  trackingCode: string | null;
  createdAt: Date | string;
  destination: string;
  receiver: string;
  volumes: number;
  weight: number;
  freightValue: number | null;
  status: string;
};

export const CABECALHO_DO_CSV = ["Código", "Data", "Destino", "Destinatário", "Volumes", "Peso (kg)", "Frete (R$)", "Situação"] as const;

/**
 * O arquivo das coletas do período: separador `;`, linhas com CRLF e a marca
 * de UTF-8 (BOM) na frente, que é o que faz o Excel ler os acentos.
 */
export function csvDasColetas(coletas: readonly ColetaExportada[]): string {
  const linhas = coletas.map((coleta) =>
    [
      celulaDeTexto(coleta.trackingCode),
      celulaDeTexto(dataPorExtenso(diaNoBrasil(coleta.createdAt))),
      celulaDeTexto(coleta.destination),
      celulaDeTexto(coleta.receiver),
      String(coleta.volumes),
      numero(coleta.weight, 0),
      // Frete ainda sem valor: a transportadora vai informar.
      coleta.freightValue === null ? celulaDeTexto("A cotar") : numero(coleta.freightValue, 2),
      celulaDeTexto(statusBadge(COLLECTION_STATUS, coleta.status).label),
    ].join(";"),
  );
  return `﻿${[CABECALHO_DO_CSV.map((titulo) => celulaDeTexto(titulo)).join(";"), ...linhas].join("\r\n")}\r\n`;
}
