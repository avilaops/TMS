"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Headset, Loader2, Plus } from "lucide-react";
import {
  OCCURRENCE_PRIORITIES,
  OCCURRENCE_STATUSES,
  OCCURRENCE_TYPES,
  PRIORIDADE_DA_OCORRENCIA,
  STATUS_DA_OCORRENCIA,
  TIPO_DA_OCORRENCIA,
  type OccurrenceStatus,
} from "@/lib/ocorrencias";
import { deniedReason, type DeniedReason } from "../financeiro/carregar";
import { CARD, Carga, INPUT, LABEL, Negado, Prioridade, Status, clienteDe, erroDe, quando, type Cliente, type Ocorrencia } from "./comum";

/**
 * Atendimento e ocorrências: os chamados da empresa, com os contadores por
 * status no topo (que também filtram), o filtro por tipo e o formulário de
 * abrir chamado. Cada chamado abre na tela dele, onde ficam a conversa e as
 * trocas de status, prioridade e responsável.
 */

type Lista = { contadores: Record<OccurrenceStatus, number>; ocorrencias: (Ocorrencia & { _count: { messages: number } })[] };

type Dados = { denied: DeniedReason } | { denied: null; erro: string } | { denied: null; erro: null; lista: Lista };

const FALHA = "Não foi possível carregar as ocorrências.";

const FORM_VAZIO = { type: "", priority: "NORMAL", trackingCode: "", clientId: "", title: "", description: "" };

const ROTULO = "before:content-[attr(data-rotulo)] before:block before:text-[11px] before:leading-tight before:text-gray-500 md:before:content-none";

async function carregar(status: string, type: string): Promise<Dados> {
  try {
    const filtros = new URLSearchParams({ ...(status ? { status } : {}), ...(type ? { type } : {}) });
    const res = await fetch(`/api/ocorrencias?${filtros}`);
    const denied = deniedReason(res.status);
    if (denied) return { denied };
    if (!res.ok) return { denied: null, erro: await erroDe(res, FALHA) };
    return { denied: null, erro: null, lista: (await res.json()) as Lista };
  } catch {
    return { denied: null, erro: FALHA };
  }
}

export default function OcorrenciasPage() {
  const router = useRouter();
  const [dados, setDados] = useState<Dados | null>(null);
  const [status, setStatus] = useState("");
  const [tipo, setTipo] = useState("");

  const [formAberto, setFormAberto] = useState(false);
  const [form, setForm] = useState(FORM_VAZIO);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [erroDoForm, setErroDoForm] = useState("");

  const recarregar = useCallback(async () => setDados(await carregar(status, tipo)), [status, tipo]);

  useEffect(() => {
    let ativo = true;
    carregar(status, tipo).then((resultado) => {
      if (ativo) setDados(resultado);
    });
    return () => {
      ativo = false;
    };
  }, [status, tipo]);

  const abrirForm = async () => {
    setForm(FORM_VAZIO);
    setErroDoForm("");
    setFormAberto(true);
    // A lista de clientes só é pedida quando o formulário abre pela primeira vez.
    if (clientes.length > 0) return;
    const res = await fetch("/api/clientes").catch(() => null);
    if (res?.ok) setClientes((await res.json()) as Cliente[]);
  };

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setSalvando(true);
    setErroDoForm("");
    try {
      const res = await fetch("/api/ocorrencias", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) return setErroDoForm(await erroDe(res, "Não foi possível abrir o chamado."));
      const criada = (await res.json()) as { id: string };
      // O chamado novo abre direto na tela dele.
      router.push(`/dashboard/ocorrencias/${criada.id}`);
    } catch {
      setErroDoForm("Não foi possível abrir o chamado.");
    } finally {
      setSalvando(false);
    }
  };

  if (dados && dados.denied !== null) return <Negado motivo={dados.denied} />;

  const lista = dados && dados.denied === null && dados.erro === null ? dados.lista : null;
  // Com o formulário aberto, o celular mostra só ele: cabe numa tela, sem rolar.
  const atrasDoForm = formAberto ? "hidden md:block" : "";

  return (
    <div className="space-y-3 md:space-y-6">
      <div className={`${formAberto ? "hidden md:flex" : "flex"} items-center justify-between gap-3`}>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold font-outfit text-gray-900 dark:text-white">Ocorrências</h1>
          <p className="hidden md:block text-gray-500 text-sm mt-1">Chamados de clientes e da equipe sobre cargas e sobre o serviço</p>
        </div>
        <button
          type="button"
          onClick={() => void abrirForm()}
          className="shrink-0 inline-flex items-center gap-2 px-3 md:px-4 py-2 md:py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium"
        >
          <Plus className="w-4 h-4" />
          Abrir chamado
        </button>
      </div>

      {formAberto && (
        <form onSubmit={enviar} aria-label="Abrir chamado" className={`${CARD} p-3 md:p-6 space-y-2 md:space-y-4`}>
          <h2 className="font-semibold text-gray-900 dark:text-white">Abrir chamado</h2>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2 md:gap-4">
            <label className="block space-y-0.5 md:space-y-1.5 min-w-0">
              <span className={LABEL}>Tipo</span>
              <select required value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className={INPUT}>
                <option value="">Escolha</option>
                {OCCURRENCE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TIPO_DA_OCORRENCIA[t]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-0.5 md:space-y-1.5 min-w-0">
              <span className={LABEL}>Prioridade</span>
              <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className={INPUT}>
                {OCCURRENCE_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {PRIORIDADE_DA_OCORRENCIA[p]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-0.5 md:space-y-1.5 min-w-0">
              <span className={LABEL}>Rastreio da carga</span>
              <input
                inputMode="numeric"
                placeholder="Opcional"
                value={form.trackingCode}
                // Com a carga informada, o cliente é o dono dela.
                onChange={(e) => setForm({ ...form, trackingCode: e.target.value, clientId: e.target.value.trim() ? "" : form.clientId })}
                className={INPUT}
              />
            </label>
            <label className="block space-y-0.5 md:space-y-1.5 min-w-0">
              <span className={LABEL}>Cliente</span>
              <select
                value={form.clientId}
                disabled={form.trackingCode.trim() !== ""}
                onChange={(e) => setForm({ ...form, clientId: e.target.value })}
                className={`${INPUT} disabled:opacity-60`}
              >
                <option value="">{form.trackingCode.trim() ? "O da carga" : "Nenhum (interno)"}</option>
                {clientes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.tradeName || c.companyName}
                  </option>
                ))}
              </select>
            </label>
            <label className="col-span-2 block space-y-0.5 md:space-y-1.5 min-w-0">
              <span className={LABEL}>Título</span>
              <input required maxLength={120} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className={INPUT} />
            </label>
            <label className="col-span-2 block space-y-0.5 md:space-y-1.5 min-w-0">
              <span className={LABEL}>O que aconteceu</span>
              <textarea required rows={4} maxLength={4000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={INPUT} />
            </label>
          </div>
          {erroDoForm && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {erroDoForm}
            </p>
          )}
          <div className="grid grid-cols-2 gap-3 md:flex md:justify-end">
            <button type="button" onClick={() => setFormAberto(false)} className="px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-300">
              Cancelar
            </button>
            <button type="submit" disabled={salvando} className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium disabled:opacity-60 inline-flex items-center justify-center gap-2">
              {salvando && <Loader2 className="w-4 h-4 animate-spin" />}
              Abrir chamado
            </button>
          </div>
        </form>
      )}

      {!dados && (
        <div className="flex items-center justify-center h-[300px]" role="status" aria-label="Carregando">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        </div>
      )}

      {dados && dados.denied === null && dados.erro !== null && (
        <div role="alert" className="px-4 py-3 text-sm text-red-700 border border-red-200 rounded-lg bg-red-50">
          {dados.erro}{" "}
          <button type="button" onClick={() => void recarregar()} className="font-medium underline">
            Tentar de novo
          </button>
        </div>
      )}

      {lista && (
        <div className={`space-y-3 md:space-y-6 ${atrasDoForm}`}>
          {/* Os contadores são também o filtro por status: tocar de novo no mesmo tira o filtro. */}
          <div className="grid grid-cols-5 gap-1.5 md:gap-4" role="group" aria-label="Filtrar por status">
            {OCCURRENCE_STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                data-contador={s}
                aria-pressed={status === s}
                onClick={() => setStatus(status === s ? "" : s)}
                className={`${CARD} min-w-0 px-1 py-2 md:p-4 text-center md:text-left ${status === s ? "ring-2 ring-blue-500 border-blue-500" : ""}`}
              >
                <p className="text-lg md:text-2xl font-bold text-gray-900 dark:text-white">{lista.contadores[s]}</p>
                <p className="text-[10px] md:text-sm leading-tight text-gray-500 truncate">{STATUS_DA_OCORRENCIA[s]}</p>
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <select aria-label="Filtrar por tipo" value={tipo} onChange={(e) => setTipo(e.target.value)} className={`${INPUT} w-auto`}>
              <option value="">Todos os tipos</option>
              {OCCURRENCE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TIPO_DA_OCORRENCIA[t]}
                </option>
              ))}
            </select>
            {(status || tipo) && (
              <button
                type="button"
                onClick={() => {
                  setStatus("");
                  setTipo("");
                }}
                className="text-sm text-blue-600 hover:underline"
              >
                Limpar filtros
              </button>
            )}
          </div>

          <div className={`${CARD} overflow-hidden`}>
            {lista.ocorrencias.length === 0 ? (
              <div className="p-10 text-center text-gray-500">
                <Headset className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                <p>{status || tipo ? "Nenhum chamado com estes filtros." : "Nenhum chamado aberto até agora."}</p>
              </div>
            ) : (
              <table className="block md:table w-full text-sm">
                <thead className="hidden md:table-header-group bg-gray-50 dark:bg-gray-950 text-gray-500 text-left">
                  <tr>
                    <th className="px-4 py-3 font-medium">Chamado</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Tipo</th>
                    <th className="px-4 py-3 font-medium">Prioridade</th>
                    <th className="px-4 py-3 font-medium">Cliente</th>
                    <th className="px-4 py-3 font-medium">Carga</th>
                    <th className="px-4 py-3 font-medium">Aberto em</th>
                    <th className="px-4 py-3 font-medium">Responsável</th>
                  </tr>
                </thead>
                <tbody className="block md:table-row-group divide-y divide-gray-100 dark:divide-gray-800">
                  {lista.ocorrencias.map((o) => (
                    <tr key={o.id} data-ocorrencia={o.id} className="grid grid-cols-2 gap-x-3 gap-y-1.5 px-3 py-2.5 md:table-row">
                      <td className="col-span-2 min-w-0 md:table-cell md:px-4 md:py-3">
                        <Link href={`/dashboard/ocorrencias/${o.id}`} className="font-medium text-blue-600 hover:underline">
                          nº {o.number} · {o.title}
                        </Link>
                        {o.origin === "CLIENT" && <span className="ml-2 text-[11px] text-gray-500">aberto pelo cliente</span>}
                      </td>
                      <td className="min-w-0 md:table-cell md:px-4 md:py-3">
                        <Status status={o.status} />
                      </td>
                      <td data-rotulo="Tipo" className={`min-w-0 md:table-cell md:px-4 md:py-3 text-gray-700 dark:text-gray-300 ${ROTULO}`}>
                        {TIPO_DA_OCORRENCIA[o.type]}
                      </td>
                      <td data-rotulo="Prioridade" className={`min-w-0 md:table-cell md:px-4 md:py-3 ${ROTULO}`}>
                        <Prioridade prioridade={o.priority} />
                      </td>
                      <td data-rotulo="Cliente" className={`min-w-0 md:table-cell md:px-4 md:py-3 text-gray-700 dark:text-gray-300 truncate ${ROTULO}`}>
                        {clienteDe(o) ?? "Interno"}
                      </td>
                      <td data-rotulo="Carga" className={`min-w-0 md:table-cell md:px-4 md:py-3 ${ROTULO}`}>
                        <Carga carga={o.collection} />
                      </td>
                      <td data-rotulo="Aberto em" className={`min-w-0 md:table-cell md:px-4 md:py-3 text-gray-600 dark:text-gray-300 whitespace-nowrap ${ROTULO}`}>
                        {quando(o.openedAt)}
                      </td>
                      <td data-rotulo="Responsável" className={`col-span-2 min-w-0 md:table-cell md:px-4 md:py-3 text-gray-600 dark:text-gray-300 truncate ${ROTULO}`}>
                        {o.assignee?.name ?? "Ninguém"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
