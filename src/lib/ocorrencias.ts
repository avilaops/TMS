import { z } from "zod";

/**
 * Atendimento e ocorrências: chamados de clientes ou da equipe sobre uma carga
 * ou sobre o serviço. Regras e formatos comuns às rotas e às telas (painel,
 * portal do cliente e aplicativo do motorista).
 *
 * Fluxo: Aberto → Em análise → Em tratamento → Resolvido → Encerrado. A equipe
 * só anda para a frente (pode pular etapa: resolver direto um chamado aberto),
 * com uma exceção: o Resolvido pode ser reaberto e volta para Em tratamento.
 * Encerrado é final: não muda de status nem recebe mensagem.
 *
 * Quem enxerga o quê: o portal lê só os chamados do `clientId` do usuário e
 * nunca recebe nota interna. É o `where` de cada rota do portal que garante
 * isso (`MENSAGEM_DO_PORTAL` abaixo), não a tela.
 */

export const OCCURRENCE_TYPES = ["DELAY", "DAMAGE", "LOSS", "BILLING", "REDELIVERY", "OTHER"] as const;
export type OccurrenceType = (typeof OCCURRENCE_TYPES)[number];

export const OCCURRENCE_STATUSES = ["OPEN", "ANALYSIS", "IN_PROGRESS", "RESOLVED", "CLOSED"] as const;
export type OccurrenceStatus = (typeof OCCURRENCE_STATUSES)[number];

export const OCCURRENCE_PRIORITIES = ["LOW", "NORMAL", "HIGH"] as const;
export type OccurrencePriority = (typeof OCCURRENCE_PRIORITIES)[number];

/** De que lado o chamado nasceu: portal do cliente, ou equipe (painel e motorista). */
export const OCCURRENCE_ORIGINS = ["CLIENT", "STAFF"] as const;
export type OccurrenceOrigin = (typeof OCCURRENCE_ORIGINS)[number];

export const TIPO_DA_OCORRENCIA: Record<OccurrenceType, string> = {
  DELAY: "Atraso",
  DAMAGE: "Avaria",
  LOSS: "Extravio",
  BILLING: "Cobrança",
  REDELIVERY: "Reentrega",
  OTHER: "Outro",
};

export const STATUS_DA_OCORRENCIA: Record<OccurrenceStatus, string> = {
  OPEN: "Aberto",
  ANALYSIS: "Em análise",
  IN_PROGRESS: "Em tratamento",
  RESOLVED: "Resolvido",
  CLOSED: "Encerrado",
};

export const PRIORIDADE_DA_OCORRENCIA: Record<OccurrencePriority, string> = {
  LOW: "Baixa",
  NORMAL: "Normal",
  HIGH: "Alta",
};

const TITLE_MAX = 120;
const TEXT_MAX = 4000;

/** Para onde o Resolvido volta quando é reaberto. */
const STATUS_AO_REABRIR: OccurrenceStatus = "IN_PROGRESS";

const ehStatus = (valor: string): valor is OccurrenceStatus => (OCCURRENCE_STATUSES as readonly string[]).includes(valor);

/**
 * Status para os quais o chamado pode ir a partir de `de`, na ordem do fluxo.
 * Status desconhecido (linha gravada por fora) não vai para lugar nenhum.
 */
export function proximosStatus(de: string): OccurrenceStatus[] {
  if (!ehStatus(de) || de === "CLOSED") return [];
  const adiante = OCCURRENCE_STATUSES.slice(OCCURRENCE_STATUSES.indexOf(de) + 1);
  return de === "RESOLVED" ? [STATUS_AO_REABRIR, ...adiante] : adiante;
}

export const podeMudarStatus = (de: string, para: string): boolean => (proximosStatus(de) as string[]).includes(para);

/** Encerrado não recebe mais mensagem, nem do cliente nem da equipe. */
export const aceitaMensagem = (status: string): boolean => status !== "CLOSED";

/**
 * As datas que acompanham a troca de status. Resolver marca `resolvedAt`;
 * reabrir apaga; encerrar marca `closedAt` e, se o chamado foi encerrado sem
 * passar por Resolvido, `resolvedAt` continua nulo (ele não foi resolvido).
 */
export function datasDaMudanca(para: OccurrenceStatus, agora: Date): { resolvedAt?: Date | null; closedAt?: Date } {
  if (para === "RESOLVED") return { resolvedAt: agora };
  if (para === "CLOSED") return { closedAt: agora };
  return { resolvedAt: null };
}

/** Mensagem de recusa para uma troca de status que o fluxo não permite. */
export function recusaDeStatus(de: string, para: OccurrenceStatus): string {
  if (de === "CLOSED") return "Chamado encerrado não muda mais de status.";
  if (de === para) return `O chamado já está em "${STATUS_DA_OCORRENCIA[para]}".`;
  return `O chamado não pode voltar de "${ehStatus(de) ? STATUS_DA_OCORRENCIA[de] : de}" para "${STATUS_DA_OCORRENCIA[para]}".`;
}

/** Contagem por status com todos os status presentes, inclusive os zerados. */
export function contadoresPorStatus(linhas: readonly { status: string; total: number }[]): Record<OccurrenceStatus, number> {
  const contadores = { OPEN: 0, ANALYSIS: 0, IN_PROGRESS: 0, RESOLVED: 0, CLOSED: 0 };
  for (const linha of linhas) {
    if (ehStatus(linha.status)) contadores[linha.status] += linha.total;
  }
  return contadores;
}

/** Título do chamado que o motorista abre numa entrega: ele só informa tipo e descrição. */
export function tituloDoMotorista(tipo: OccurrenceType, destinatario: string): string {
  return `${TIPO_DA_OCORRENCIA[tipo]} na entrega para ${destinatario}`.slice(0, TITLE_MAX);
}

/* -------------------------------- Validação -------------------------------- */

const INVALID_BODY = "Dados inválidos.";
const NOTHING_TO_CHANGE = "Informe ao menos um campo para alterar.";

const texto = (message: string, max: number, tooLong: string) => z.string(message).trim().min(1, message).max(max, tooLong);

// Campo opcional do formulário: vazio vira `null`; ausente não mexe.
const vazioComoNulo = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);

const idOpcional = (message: string) => z.preprocess(vazioComoNulo, z.string(message).trim().max(64, message).nullish());

const tipo = z.enum(OCCURRENCE_TYPES, "Escolha o tipo do chamado.");
const titulo = texto("Informe o título.", TITLE_MAX, "Título muito longo.");
const descricao = texto("Descreva o que aconteceu.", TEXT_MAX, "Descrição muito longa.");
const prioridade = z.enum(OCCURRENCE_PRIORITIES, "Prioridade inválida.");
const corpoDaMensagem = texto("Escreva a mensagem.", TEXT_MAX, "Mensagem muito longa.");

/**
 * Chamado aberto pela equipe. A carga vem pelo código de rastreio (é o que o
 * operador tem em mãos); o cliente, quando há carga, é o dono dela.
 */
export const createOccurrenceSchema = z.object(
  {
    type: tipo,
    title: titulo,
    description: descricao,
    priority: z.preprocess(vazioComoNulo, prioridade.nullish()),
    trackingCode: z.preprocess(
      vazioComoNulo,
      z
        .string("Código de rastreio inválido.")
        .trim()
        .regex(/^\d{1,20}$/, "Código de rastreio inválido.")
        .nullish(),
    ),
    clientId: idOpcional("Cliente inválido."),
  },
  INVALID_BODY,
);

export const updateOccurrenceSchema = z
  .object(
    {
      status: z.enum(OCCURRENCE_STATUSES, "Status inválido.").optional(),
      priority: prioridade.optional(),
      // `null` ou vazio tira o responsável.
      assigneeId: idOpcional("Responsável inválido."),
    },
    INVALID_BODY,
  )
  .refine((dados) => dados.status !== undefined || dados.priority !== undefined || dados.assigneeId !== undefined, NOTHING_TO_CHANGE);

/** Mensagem da equipe: resposta ao cliente ou nota interna. */
export const staffMessageSchema = z.object(
  { body: corpoDaMensagem, internal: z.boolean(INVALID_BODY).optional().default(false) },
  INVALID_BODY,
);

/** Chamado aberto pelo cliente no portal. A carga, se houver, é uma das dele. */
export const portalOccurrenceSchema = z.object(
  { type: tipo, title: titulo, description: descricao, collectionId: idOpcional("Carga inválida.") },
  INVALID_BODY,
);

export const portalMessageSchema = z.object({ body: corpoDaMensagem }, INVALID_BODY);

/** Ocorrência registrada pelo motorista numa entrega da viagem dele. */
export const driverOccurrenceSchema = z.object({ type: tipo, description: descricao }, INVALID_BODY);

/** Filtros da lista do painel (`?status=&type=`). Valor desconhecido é ignorado. */
export function filtrosDaLista(params: URLSearchParams): { status?: OccurrenceStatus; type?: OccurrenceType } {
  const status = params.get("status") ?? "";
  const type = params.get("type") ?? "";
  return {
    ...(ehStatus(status) ? { status } : {}),
    ...((OCCURRENCE_TYPES as readonly string[]).includes(type) ? { type: type as OccurrenceType } : {}),
  };
}

/* ----------------------------- O que cada lado lê ----------------------------- */

const CARGA = { id: true, trackingCode: true, receiver: true, destination: true } as const;
const CLIENTE = { id: true, companyName: true, tradeName: true, cnpj: true } as const;

/** Lista e cabeçalho do chamado no painel. */
export const OCCURRENCE_SELECT = {
  id: true,
  number: true,
  type: true,
  title: true,
  description: true,
  status: true,
  priority: true,
  origin: true,
  openedAt: true,
  resolvedAt: true,
  closedAt: true,
  client: { select: CLIENTE },
  // O dono da carga vai junto: o chamado do motorista não tem `clientId`, e o
  // CNPJ dele monta o link do rastreio público.
  collection: { select: { ...CARGA, client: { select: CLIENTE } } },
  openedBy: { select: { id: true, name: true } },
  assignee: { select: { id: true, name: true } },
} as const;

/** Mensagem como a equipe lê: com o autor e a marca de nota interna. */
export const MESSAGE_SELECT = {
  id: true,
  body: true,
  internal: true,
  fromClient: true,
  createdAt: true,
  author: { select: { id: true, name: true } },
} as const;

/** A conversa em ordem cronológica; o id desempata mensagens do mesmo instante. */
export const ORDEM_DA_CONVERSA = [{ createdAt: "asc" }, { id: "asc" }] as const;

/** O chamado como o cliente lê: sem prioridade, sem responsável e sem quem da equipe abriu. */
export const PORTAL_OCCURRENCE_SELECT = {
  id: true,
  number: true,
  type: true,
  title: true,
  description: true,
  status: true,
  origin: true,
  openedAt: true,
  resolvedAt: true,
  closedAt: true,
  collection: { select: CARGA },
} as const;

/** Só o que não é nota interna chega ao portal. */
export const MENSAGEM_DO_PORTAL = { internal: false } as const;

/** Mensagem como o cliente lê: sem o nome de quem respondeu pela transportadora. */
export const PORTAL_MESSAGE_SELECT = { id: true, body: true, fromClient: true, createdAt: true } as const;
