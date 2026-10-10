import Link from "next/link";
import { LogIn, ShieldAlert } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PRIORIDADE_DA_OCORRENCIA, STATUS_DA_OCORRENCIA, type OccurrencePriority, type OccurrenceStatus, type OccurrenceType } from "@/lib/ocorrencias";
import type { DeniedReason } from "../financeiro/carregar";

// O que as duas telas de ocorrência do painel (lista e chamado) têm em comum.

export type Cliente = { id: string; companyName: string; tradeName: string | null; cnpj: string };

export type Ocorrencia = {
  id: string;
  number: number;
  type: OccurrenceType;
  title: string;
  description: string;
  status: OccurrenceStatus;
  priority: OccurrencePriority;
  origin: "CLIENT" | "STAFF";
  openedAt: string;
  resolvedAt: string | null;
  closedAt: string | null;
  client: Cliente | null;
  collection: { id: string; trackingCode: string | null; receiver: string; destination: string; client: Cliente } | null;
  openedBy: { id: string; name: string } | null;
  assignee: { id: string; name: string } | null;
};

export const CARD = "bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm";
export const INPUT =
  "block w-full min-w-0 px-3 py-1.5 md:py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-2 focus:ring-blue-500 outline-none text-sm dark:text-white";
export const LABEL = "text-xs md:text-sm font-medium text-gray-700 dark:text-gray-300";

const COR_DO_STATUS: Record<OccurrenceStatus, string> = {
  OPEN: "bg-amber-100 text-amber-800",
  ANALYSIS: "bg-sky-100 text-sky-800",
  IN_PROGRESS: "bg-violet-100 text-violet-800",
  RESOLVED: "bg-emerald-100 text-emerald-800",
  CLOSED: "bg-gray-100 text-gray-600",
};

const COR_DA_PRIORIDADE: Record<OccurrencePriority, string> = {
  LOW: "text-gray-500",
  NORMAL: "text-gray-700 dark:text-gray-300",
  HIGH: "text-red-600 font-semibold",
};

export function Status({ status }: { status: OccurrenceStatus }) {
  return (
    <span data-status={status} className={`inline-block text-xs px-2.5 py-1 rounded-full whitespace-nowrap ${COR_DO_STATUS[status]}`}>
      {STATUS_DA_OCORRENCIA[status]}
    </span>
  );
}

export function Prioridade({ prioridade }: { prioridade: OccurrencePriority }) {
  return <span className={COR_DA_PRIORIDADE[prioridade]}>{PRIORIDADE_DA_OCORRENCIA[prioridade]}</span>;
}

/** O cliente do chamado; no chamado do motorista, o dono da carga. */
export const clienteDe = (ocorrencia: Pick<Ocorrencia, "client" | "collection">) => {
  const cliente = ocorrencia.client ?? ocorrencia.collection?.client ?? null;
  return cliente ? cliente.tradeName || cliente.companyName : null;
};

/**
 * A carga do chamado, com link. O painel não tem tela de uma carga só: o link
 * abre o rastreio público dela, já preenchido, em outra aba.
 */
export function Carga({ carga }: { carga: Ocorrencia["collection"] }) {
  if (!carga) return <span className="text-gray-400">-</span>;
  if (!carga.trackingCode) return <span>{carga.destination}</span>;
  return (
    <a
      href={`/rastreio?cnpj=${carga.client.cnpj}&codigo=${carga.trackingCode}`}
      target="_blank"
      rel="noreferrer"
      title={`${carga.receiver} · ${carga.destination}`}
      className="font-mono text-xs text-blue-600 hover:underline"
    >
      {carga.trackingCode}
    </a>
  );
}

export const quando = (instante: string) =>
  new Date(instante).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/** Sessão expirada (401) ou perfil sem acesso (403), como nas telas vizinhas. */
export function Negado({ motivo }: { motivo: DeniedReason }) {
  if (motivo === "login") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <LogIn className="w-5 h-5 text-blue-600" />
            Sessão expirada
          </CardTitle>
          <CardDescription>
            Entre de novo para ver as ocorrências.{" "}
            <Link href="/login" className="font-medium text-blue-600 hover:underline">
              Ir para o login
            </Link>
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldAlert className="w-5 h-5 text-red-600" />
          Acesso negado
        </CardTitle>
        <CardDescription>As ocorrências são restritas à equipe interna.</CardDescription>
      </CardHeader>
    </Card>
  );
}

export const erroDe = async (res: Response, padrao: string) => {
  const corpo = (await res.json().catch(() => null)) as { error?: unknown } | null;
  return typeof corpo?.error === "string" ? corpo.error : padrao;
};
