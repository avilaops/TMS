import { STATUS_DA_OCORRENCIA, type OccurrenceStatus, type OccurrenceType } from "@/lib/ocorrencias";

// O que a lista e a conversa do atendimento no portal têm em comum.

export type Atendimento = {
  id: string;
  number: number;
  type: OccurrenceType;
  title: string;
  description: string;
  status: OccurrenceStatus;
  /** CLIENT = aberto por alguém da empresa do cliente; STAFF = aberto pela transportadora. */
  origin: "CLIENT" | "STAFF";
  openedAt: string;
  resolvedAt: string | null;
  closedAt: string | null;
  collection: { id: string; trackingCode: string | null; receiver: string; destination: string } | null;
};

export const INPUT =
  "block w-full min-w-0 px-3 py-1.5 md:py-2.5 rounded-xl border border-gray-200 bg-white focus:ring-2 focus:ring-orange-400 focus:border-transparent outline-none text-sm";
export const LABEL = "text-xs md:text-sm font-medium text-gray-700";

const COR: Record<OccurrenceStatus, string> = {
  OPEN: "bg-amber-50 text-amber-700 border-amber-200",
  ANALYSIS: "bg-sky-50 text-sky-700 border-sky-200",
  IN_PROGRESS: "bg-violet-50 text-violet-700 border-violet-200",
  RESOLVED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  CLOSED: "bg-gray-100 text-gray-600 border-gray-200",
};

export function Situacao({ status }: { status: OccurrenceStatus }) {
  return (
    <span data-status={status} className={`inline-block text-xs px-2.5 py-1 rounded-full border whitespace-nowrap ${COR[status]}`}>
      {STATUS_DA_OCORRENCIA[status]}
    </span>
  );
}

export const quando = (instante: string) =>
  new Date(instante).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
