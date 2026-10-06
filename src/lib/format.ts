const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function formatCurrency(value: number | null | undefined) {
  if (value === null || value === undefined) return "-";
  return currency.format(value);
}

/** Para instantes reais (createdAt, updatedAt): converte para o fuso do usuário. */
export function formatDate(value: string | Date | null | undefined) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("pt-BR");
}

/**
 * Para datas de calendário (vencimento de fatura, validade de CNH).
 *
 * O Prisma grava esses campos à meia-noite UTC. Formatando no fuso de Brasília
 * (UTC-3), 2030-01-01 vira 31/12/2029 — um dia a menos. Como aqui a data é o
 * dado em si, e não um instante, a leitura tem que ser feita em UTC.
 */
export function formatCalendarDate(value: string | Date | null | undefined) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

const DIA_EM_MS = 1000 * 60 * 60 * 24;

/** Dias até uma data de calendário. Negativo significa vencida. */
export function daysUntil(value: string | Date) {
  const alvo = new Date(value);
  const alvoUTC = Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth(), alvo.getUTCDate());

  const hoje = new Date();
  const hojeUTC = Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());

  return Math.round((alvoUTC - hojeUTC) / DIA_EM_MS);
}

export function formatWeight(value: number | null | undefined) {
  if (value === null || value === undefined) return "-";
  return `${value.toLocaleString("pt-BR")} kg`;
}

/** Status de coleta/minuta como o cliente deve enxergar. */
export const COLLECTION_STATUS: Record<string, { label: string; className: string }> = {
  PENDING: { label: "Aguardando confirmação", className: "bg-amber-50 text-amber-700 border-amber-200" },
  CONFIRMED: { label: "Coleta confirmada", className: "bg-sky-50 text-sky-700 border-sky-200" },
  COLLECTED: { label: "Coletado", className: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  ROUTE: { label: "Em rota de entrega", className: "bg-violet-50 text-violet-700 border-violet-200" },
  DELIVERED: { label: "Entregue", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  CANCELLED: { label: "Cancelada", className: "bg-gray-100 text-gray-600 border-gray-200" },
  REJECTED: { label: "Recusada", className: "bg-red-50 text-red-700 border-red-200" },
};

export const INVOICE_STATUS: Record<string, { label: string; className: string }> = {
  PENDING: { label: "Em aberto", className: "bg-amber-50 text-amber-700 border-amber-200" },
  PAID: { label: "Pago", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
};

export function statusBadge(
  map: Record<string, { label: string; className: string }>,
  status: string
) {
  return map[status] ?? { label: status, className: "bg-gray-50 text-gray-600 border-gray-200" };
}
