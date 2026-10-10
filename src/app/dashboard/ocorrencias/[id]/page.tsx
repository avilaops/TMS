"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Lock } from "lucide-react";
import {
  OCCURRENCE_PRIORITIES,
  PRIORIDADE_DA_OCORRENCIA,
  STATUS_DA_OCORRENCIA,
  TIPO_DA_OCORRENCIA,
  aceitaMensagem,
  type OccurrenceStatus,
} from "@/lib/ocorrencias";
import { deniedReason, type DeniedReason } from "../../financeiro/carregar";
import { CARD, Carga, INPUT, LABEL, Negado, Status, clienteDe, erroDe, quando, type Ocorrencia } from "../comum";

/**
 * Um chamado: os dados, a conversa (resposta ao cliente ou nota interna) e as
 * trocas de status, prioridade e responsável. A descrição de quem abriu é a
 * primeira fala da conversa. Cada troca é gravada na hora, sem botão de salvar.
 */

type Mensagem = { id: string; body: string; internal: boolean; fromClient: boolean; createdAt: string; author: { id: string; name: string } | null };

type Chamado = Ocorrencia & { messages: Mensagem[]; proximosStatus: OccurrenceStatus[]; equipe: { id: string; name: string }[] };

type Dados = { denied: DeniedReason } | { denied: null; erro: string } | { denied: null; erro: null; chamado: Chamado };

const FALHA = "Não foi possível carregar o chamado.";
const FALHA_AO_GRAVAR = "Não foi possível gravar. Tente de novo.";

async function carregar(id: string): Promise<Dados> {
  try {
    const res = await fetch(`/api/ocorrencias/${id}`);
    const denied = deniedReason(res.status);
    if (denied) return { denied };
    if (!res.ok) return { denied: null, erro: await erroDe(res, FALHA) };
    return { denied: null, erro: null, chamado: (await res.json()) as Chamado };
  } catch {
    return { denied: null, erro: FALHA };
  }
}

export default function OcorrenciaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [dados, setDados] = useState<Dados | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  const [texto, setTexto] = useState("");
  const [interna, setInterna] = useState(false);

  const recarregar = useCallback(async () => setDados(await carregar(id)), [id]);

  useEffect(() => {
    let ativo = true;
    carregar(id).then((resultado) => {
      if (ativo) setDados(resultado);
    });
    return () => {
      ativo = false;
    };
  }, [id]);

  /** Grava e relê o chamado: a recusa (troca de status fora do fluxo) aparece e a tela volta ao que vale. */
  const gravar = async (caminho: string, method: "PATCH" | "POST", corpo: unknown) => {
    setOcupado(true);
    setErro("");
    try {
      const res = await fetch(caminho, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
      if (!res.ok) setErro(await erroDe(res, FALHA_AO_GRAVAR));
      await recarregar();
      return res.ok;
    } catch {
      setErro(FALHA_AO_GRAVAR);
      return false;
    } finally {
      setOcupado(false);
    }
  };

  const alterar = (corpo: Record<string, string>) => void gravar(`/api/ocorrencias/${id}`, "PATCH", corpo);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await gravar(`/api/ocorrencias/${id}/mensagens`, "POST", { body: texto, internal: interna })) {
      setTexto("");
      setInterna(false);
    }
  };

  if (dados && dados.denied !== null) return <Negado motivo={dados.denied} />;

  if (!dados) {
    return (
      <div className="flex items-center justify-center h-[300px]" role="status" aria-label="Carregando">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  const voltar = (
    <Link href="/dashboard/ocorrencias" className="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900">
      <ArrowLeft className="w-4 h-4" />
      Ocorrências
    </Link>
  );

  if (dados.erro !== null) {
    return (
      <div className="space-y-3">
        {voltar}
        <div role="alert" className="px-4 py-3 text-sm text-red-700 border border-red-200 rounded-lg bg-red-50">
          {dados.erro}
        </div>
      </div>
    );
  }

  const { chamado } = dados;
  const cliente = clienteDe(chamado);
  const aberto = aceitaMensagem(chamado.status);
  // Sem cliente no chamado não há a quem responder: tudo o que se escreve é anotação da equipe.
  const temCliente = chamado.client !== null;

  return (
    <div className="space-y-3 md:space-y-5">
      {voltar}

      <div className={`${CARD} p-3 md:p-6 space-y-2 md:space-y-4`}>
        <div className="flex items-start justify-between gap-3">
          <h1 className="min-w-0 text-base md:text-xl font-bold font-outfit text-gray-900 dark:text-white">
            nº {chamado.number} · {chamado.title}
          </h1>
          <Status status={chamado.status} />
        </div>
        <p className="text-xs md:text-sm text-gray-600 dark:text-gray-300">
          {TIPO_DA_OCORRENCIA[chamado.type]} · {cliente ?? "Interno"}
          {chamado.collection && (
            <>
              {" · carga "}
              <Carga carga={chamado.collection} />
            </>
          )}
          {" · aberto em "}
          {quando(chamado.openedAt)}
          {chamado.resolvedAt && ` · resolvido em ${quando(chamado.resolvedAt)}`}
          {chamado.closedAt && ` · encerrado em ${quando(chamado.closedAt)}`}
        </p>

        <div className="grid grid-cols-3 gap-x-2 md:gap-4">
          <label className="block space-y-0.5 md:space-y-1.5 min-w-0">
            <span className={LABEL}>Status</span>
            <select
              aria-label="Status"
              value={chamado.status}
              disabled={ocupado || chamado.proximosStatus.length === 0}
              onChange={(e) => alterar({ status: e.target.value })}
              className={`${INPUT} disabled:opacity-60`}
            >
              <option value={chamado.status}>{STATUS_DA_OCORRENCIA[chamado.status]}</option>
              {chamado.proximosStatus.map((s) => (
                <option key={s} value={s}>
                  {chamado.status === "RESOLVED" && s === "IN_PROGRESS" ? "Reabrir" : STATUS_DA_OCORRENCIA[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-0.5 md:space-y-1.5 min-w-0">
            <span className={LABEL}>Prioridade</span>
            <select aria-label="Prioridade" value={chamado.priority} disabled={ocupado} onChange={(e) => alterar({ priority: e.target.value })} className={`${INPUT} disabled:opacity-60`}>
              {OCCURRENCE_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORIDADE_DA_OCORRENCIA[p]}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-0.5 md:space-y-1.5 min-w-0">
            <span className={LABEL}>Responsável</span>
            <select aria-label="Responsável" value={chamado.assignee?.id ?? ""} disabled={ocupado} onChange={(e) => alterar({ assigneeId: e.target.value })} className={`${INPUT} disabled:opacity-60`}>
              <option value="">Ninguém</option>
              {chamado.equipe.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {erro && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {erro}
          </p>
        )}
      </div>

      <div className={`${CARD} p-3 md:p-6 space-y-3`}>
        <h2 className="hidden md:block font-semibold text-gray-900 dark:text-white">Conversa</h2>
        <ol className="space-y-2" aria-label="Conversa">
          <Fala
            autor={chamado.openedBy?.name ?? (chamado.origin === "CLIENT" ? "Cliente" : "Equipe")}
            quem={chamado.origin === "CLIENT" ? "cliente" : "equipe"}
            instante={chamado.openedAt}
            texto={chamado.description}
          />
          {chamado.messages.map((m) => (
            <Fala
              key={m.id}
              autor={m.author?.name ?? (m.fromClient ? "Cliente" : "Equipe")}
              quem={m.internal ? "interna" : m.fromClient ? "cliente" : "equipe"}
              instante={m.createdAt}
              texto={m.body}
            />
          ))}
        </ol>

        {aberto ? (
          <form onSubmit={enviar} className="space-y-2 pt-2 border-t border-gray-100 dark:border-gray-800">
            <textarea
              required
              rows={2}
              maxLength={4000}
              aria-label="Mensagem"
              placeholder={interna || !temCliente ? "Anotação para a equipe" : "Resposta para o cliente"}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              className={INPUT}
            />
            <div className="flex items-center justify-between gap-3">
              {temCliente ? (
                <label className="inline-flex items-center gap-2 text-xs md:text-sm text-gray-700 dark:text-gray-300">
                  <input type="checkbox" checked={interna} onChange={(e) => setInterna(e.target.checked)} />
                  Nota interna (o cliente não vê)
                </label>
              ) : (
                <span className="text-xs text-gray-500">Chamado interno: nenhum cliente lê esta conversa.</span>
              )}
              <button type="submit" disabled={ocupado || !texto.trim()} className="shrink-0 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium disabled:opacity-60 inline-flex items-center gap-2">
                {ocupado && <Loader2 className="w-4 h-4 animate-spin" />}
                {interna || !temCliente ? "Anotar" : "Responder"}
              </button>
            </div>
          </form>
        ) : (
          <p className="pt-2 border-t border-gray-100 dark:border-gray-800 text-sm text-gray-500">Chamado encerrado: não recebe mais mensagem.</p>
        )}
      </div>
    </div>
  );
}

const ESTILO = {
  cliente: "mr-6 bg-gray-100 dark:bg-gray-800",
  equipe: "ml-6 bg-blue-50 dark:bg-blue-900/20",
  interna: "ml-6 bg-amber-50 dark:bg-amber-900/20 border border-dashed border-amber-300",
} as const;

function Fala({ autor, quem, instante, texto }: { autor: string; quem: keyof typeof ESTILO; instante: string; texto: string }) {
  return (
    <li data-fala={quem} className={`rounded-2xl px-3 py-2 ${ESTILO[quem]}`}>
      <p className="flex items-center gap-1.5 text-[11px] text-gray-500">
        {quem === "interna" && <Lock className="w-3 h-3" aria-hidden />}
        <span className="font-medium text-gray-700 dark:text-gray-300">{autor}</span>
        {quem === "interna" && "· nota interna"}
        {quem === "cliente" && "· cliente"}
        <span>· {quando(instante)}</span>
      </p>
      <p className="text-sm text-gray-900 dark:text-white whitespace-pre-wrap break-words">{texto}</p>
    </li>
  );
}
