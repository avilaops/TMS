"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, Headset, Loader2, Plus } from "lucide-react";
import { OCCURRENCE_TYPES, TIPO_DA_OCORRENCIA } from "@/lib/ocorrencias";
import { readPortal, type PortalCollection } from "../types";
import { INPUT, LABEL, Situacao, quando, type Atendimento } from "./comum";

/**
 * Atendimento: o cliente abre um chamado (sobre uma carga dele ou sobre o
 * serviço) e acompanha os da empresa dele. Cada chamado abre na conversa.
 */

const FORM_VAZIO = { type: "", collectionId: "", title: "", description: "" };

const ROTULO = "before:content-[attr(data-rotulo)] before:block before:text-[11px] before:leading-tight before:text-gray-500 md:before:content-none";

export default function PortalAtendimentoPage() {
  const router = useRouter();
  const [atendimentos, setAtendimentos] = useState<Atendimento[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");

  const [formAberto, setFormAberto] = useState(false);
  const [form, setForm] = useState(FORM_VAZIO);
  const [cargas, setCargas] = useState<PortalCollection[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [erroDoForm, setErroDoForm] = useState("");

  useEffect(() => {
    fetch("/api/portal/atendimento")
      .then((r) => readPortal<Atendimento[]>(r))
      .then(setAtendimentos)
      .catch((e: Error) => setErro(e.message))
      .finally(() => setCarregando(false));
  }, []);

  const abrirForm = async () => {
    setForm(FORM_VAZIO);
    setErroDoForm("");
    setFormAberto(true);
    // As cargas do cliente só são pedidas quando o formulário abre pela primeira vez.
    if (cargas.length > 0) return;
    const res = await fetch("/api/portal/coletas").catch(() => null);
    if (res?.ok) setCargas((await res.json()) as PortalCollection[]);
  };

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setSalvando(true);
    setErroDoForm("");
    try {
      const res = await fetch("/api/portal/atendimento", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const criado = await readPortal<{ id: string }>(res);
      // O chamado novo abre direto na conversa.
      router.push(`/portal/atendimento/${criado.id}`);
    } catch (e) {
      setErroDoForm((e as Error).message);
    } finally {
      setSalvando(false);
    }
  };

  if (erro) {
    return (
      <div className="max-w-xl bg-white border border-amber-200 rounded-2xl p-6 flex gap-4">
        <AlertCircle className="w-6 h-6 text-amber-600 shrink-0" />
        <div>
          <h1 className="font-outfit font-bold text-lg mb-1">Não foi possível carregar</h1>
          <p className="text-gray-600 text-sm">{erro}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 md:space-y-6">
      {/* Com o formulário aberto, o celular mostra só ele: cabe numa tela, sem rolar. */}
      <div className={`${formAberto ? "hidden md:flex" : "flex"} items-center justify-between gap-3`}>
        <div className="min-w-0">
          <h1 className="text-2xl font-outfit font-bold text-gray-900">Atendimento</h1>
          <p className="hidden md:block text-gray-500">Fale com a transportadora sobre uma carga ou sobre o serviço.</p>
        </div>
        <button
          type="button"
          onClick={() => void abrirForm()}
          className="shrink-0 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-orange-500 text-white text-sm font-medium hover:bg-orange-600 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Abrir atendimento
        </button>
      </div>

      {formAberto && (
        <form onSubmit={enviar} aria-label="Abrir atendimento" className="bg-white border border-gray-200 rounded-2xl p-3 md:p-6 space-y-2 md:space-y-4">
          <h2 className="font-outfit font-bold text-lg">Abrir atendimento</h2>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2 md:gap-4">
            <label className="block space-y-0.5 md:space-y-1.5 min-w-0">
              <span className={LABEL}>Assunto</span>
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
              <span className={LABEL}>Carga (opcional)</span>
              <select value={form.collectionId} onChange={(e) => setForm({ ...form, collectionId: e.target.value })} className={INPUT}>
                <option value="">Nenhuma</option>
                {cargas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.trackingCode ?? "s/ código"} · {c.destination}
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
              <textarea required rows={5} maxLength={4000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={INPUT} />
            </label>
          </div>
          {erroDoForm && (
            <p role="alert" className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm">
              {erroDoForm}
            </p>
          )}
          <div className="grid grid-cols-2 gap-3 md:flex md:justify-end">
            <button type="button" onClick={() => setFormAberto(false)} className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-700">
              Cancelar
            </button>
            <button type="submit" disabled={salvando} className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-orange-500 text-white text-sm font-medium hover:bg-orange-600 disabled:opacity-60">
              {salvando && <Loader2 className="w-4 h-4 animate-spin" />}
              Enviar
            </button>
          </div>
        </form>
      )}

      <div className={`${formAberto ? "hidden md:block " : ""}bg-white rounded-2xl border border-gray-200 overflow-hidden`}>
        {carregando ? (
          <p className="p-6 text-gray-500">Carregando…</p>
        ) : atendimentos.length === 0 ? (
          <div className="p-10 text-center">
            <Headset className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-600">Nenhum atendimento aberto até agora.</p>
          </div>
        ) : (
          <table className="block md:table w-full text-sm">
            <thead className="hidden md:table-header-group bg-gray-50 text-gray-500 text-left">
              <tr>
                <th className="px-6 py-3 font-medium">Atendimento</th>
                <th className="px-6 py-3 font-medium">Situação</th>
                <th className="px-6 py-3 font-medium">Assunto</th>
                <th className="px-6 py-3 font-medium">Carga</th>
                <th className="px-6 py-3 font-medium">Aberto em</th>
              </tr>
            </thead>
            <tbody className="block md:table-row-group divide-y divide-gray-100">
              {atendimentos.map((a) => (
                <tr key={a.id} data-atendimento={a.id} className="grid grid-cols-2 gap-x-3 gap-y-1.5 px-3 py-2.5 md:table-row">
                  <td className="col-span-2 min-w-0 md:table-cell md:px-6 md:py-4">
                    <Link href={`/portal/atendimento/${a.id}`} className="font-medium text-gray-900 hover:text-orange-600 hover:underline">
                      nº {a.number} · {a.title}
                    </Link>
                  </td>
                  <td className="min-w-0 md:table-cell md:px-6 md:py-4">
                    <Situacao status={a.status} />
                  </td>
                  <td data-rotulo="Assunto" className={`min-w-0 md:table-cell md:px-6 md:py-4 text-gray-600 ${ROTULO}`}>
                    {TIPO_DA_OCORRENCIA[a.type]}
                  </td>
                  <td data-rotulo="Carga" className={`min-w-0 md:table-cell md:px-6 md:py-4 text-gray-600 ${ROTULO}`}>
                    {a.collection ? (
                      <Link href={`/portal/coletas/${a.collection.id}`} className="font-mono text-xs hover:text-orange-600 hover:underline">
                        {a.collection.trackingCode ?? a.collection.destination}
                      </Link>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td data-rotulo="Aberto em" className={`min-w-0 md:table-cell md:px-6 md:py-4 text-gray-600 whitespace-nowrap ${ROTULO}`}>
                    {quando(a.openedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
