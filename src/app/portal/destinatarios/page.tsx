"use client";

import { useEffect, useState } from "react";
import { Loader2, Pencil, Plus, Trash2, Users } from "lucide-react";
import { formatDocument } from "@/lib/format";
import type { Destinatario } from "@/lib/portal-cliente";
import { readPortal } from "../types";
import { BOTAO, BOTAO_SECUNDARIO, Campo, NaoCarregou } from "../comum";

/**
 * Destinatários frequentes: o cliente cadastra uma vez e escolhe ao pedir
 * coleta. Cada cliente só vê os seus.
 */

const VAZIO = { name: "", document: "", city: "", address: "", contactName: "", phone: "" };

const paraOFormulario = (d: Destinatario) => ({
  name: d.name,
  document: d.document ?? "",
  city: d.city,
  address: d.address ?? "",
  contactName: d.contactName ?? "",
  phone: d.phone ?? "",
});

export default function PortalDestinatariosPage() {
  const [destinatarios, setDestinatarios] = useState<Destinatario[] | null>(null);
  const [erro, setErro] = useState("");
  // `null` = formulário fechado; "novo" = cadastrando; senão, o id em edição.
  const [editando, setEditando] = useState<string | null>(null);
  const [form, setForm] = useState(VAZIO);
  const [salvando, setSalvando] = useState(false);
  const [erroDoFormulario, setErroDoFormulario] = useState("");
  const [apagando, setApagando] = useState<string | null>(null);

  const carregar = () =>
    fetch("/api/portal/destinatarios")
      .then((r) => readPortal<Destinatario[]>(r))
      .then(setDestinatarios)
      .catch((e: Error) => setErro(e.message));

  useEffect(() => {
    void carregar();
  }, []);

  const abrir = (destinatario: Destinatario | null) => {
    setEditando(destinatario ? destinatario.id : "novo");
    setForm(destinatario ? paraOFormulario(destinatario) : VAZIO);
    setErroDoFormulario("");
  };

  const fechar = () => {
    setEditando(null);
    setForm(VAZIO);
    setErroDoFormulario("");
  };

  const campo = (nome: keyof typeof VAZIO) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((atual) => ({ ...atual, [nome]: e.target.value }));

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    setSalvando(true);
    setErroDoFormulario("");
    try {
      const novo = editando === "novo";
      const res = await fetch(novo ? "/api/portal/destinatarios" : `/api/portal/destinatarios/${editando}`, {
        method: novo ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const corpo = await res.json().catch(() => null);
      if (!res.ok) throw new Error(corpo?.error ?? "Não foi possível salvar o destinatário.");
      fechar();
      await carregar();
    } catch (falha) {
      setErroDoFormulario((falha as Error).message);
    } finally {
      setSalvando(false);
    }
  };

  const apagar = async (destinatario: Destinatario) => {
    if (!window.confirm(`Apagar o destinatário ${destinatario.name}?`)) return;
    setApagando(destinatario.id);
    try {
      const res = await fetch(`/api/portal/destinatarios/${destinatario.id}`, { method: "DELETE" });
      if (!res.ok) {
        const corpo = await res.json().catch(() => null);
        throw new Error(corpo?.error ?? "Não foi possível apagar o destinatário.");
      }
      await carregar();
    } catch (falha) {
      setErro((falha as Error).message);
    } finally {
      setApagando(null);
    }
  };

  if (erro) return <NaoCarregou mensagem={erro} />;

  const aberto = editando !== null;

  return (
    <div className="space-y-3 md:space-y-6">
      {/* Com o formulário aberto, o título e a lista saem da tela do celular. */}
      <div className={`${aberto ? "hidden md:flex" : "flex"} flex-wrap gap-3 items-center justify-between`}>
        <div>
          <h1 className="text-2xl font-outfit font-bold text-gray-900">Destinatários</h1>
          <p className="hidden md:block text-gray-500">Quem recebe as suas cargas com frequência, para escolher ao pedir coleta.</p>
        </div>
        <button onClick={() => abrir(null)} className={BOTAO}>
          <Plus className="w-4 h-4" />
          Novo destinatário
        </button>
      </div>

      {aberto && (
        <form onSubmit={salvar} aria-label="Destinatário" className="bg-white border border-gray-200 rounded-2xl p-3 md:p-6 space-y-3">
          <h2 className="font-outfit font-bold text-lg">{editando === "novo" ? "Novo destinatário" : "Editar destinatário"}</h2>

          {erroDoFormulario && (
            <p role="alert" className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm">
              {erroDoFormulario}
            </p>
          )}

          <div className="grid grid-cols-2 gap-x-3 gap-y-2 md:gap-4">
            <Campo rotulo="Nome" className="col-span-2" required maxLength={200} value={form.name} onChange={campo("name")} />
            <Campo rotulo="Cidade - UF" required maxLength={120} value={form.city} onChange={campo("city")} placeholder="Ex.: Mirassol - SP" />
            <Campo rotulo="CNPJ/CPF (opcional)" inputMode="numeric" value={form.document} onChange={campo("document")} />
            <Campo rotulo="Endereço (opcional)" className="col-span-2" maxLength={300} value={form.address} onChange={campo("address")} />
            <Campo rotulo="Contato (opcional)" maxLength={120} value={form.contactName} onChange={campo("contactName")} />
            <Campo rotulo="Telefone (opcional)" type="tel" maxLength={30} value={form.phone} onChange={campo("phone")} />
          </div>

          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={salvando} className={BOTAO}>
              {salvando && <Loader2 className="w-4 h-4 animate-spin" />}
              Salvar
            </button>
            <button type="button" onClick={fechar} className={BOTAO_SECUNDARIO}>
              Cancelar
            </button>
          </div>
        </form>
      )}

      <div className={`${aberto ? "hidden md:block " : ""}bg-white rounded-2xl border border-gray-200 overflow-hidden`}>
        {!destinatarios ? (
          <p className="p-6 text-gray-500">Carregando…</p>
        ) : destinatarios.length === 0 ? (
          <div className="p-10 text-center">
            <Users className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-600">Nenhum destinatário cadastrado até agora.</p>
          </div>
        ) : (
          <table className="block md:table w-full text-sm">
            <thead className="hidden md:table-header-group bg-gray-50 text-gray-500 text-left">
              <tr>
                <th className="px-6 py-3 font-medium">Destinatário</th>
                <th className="px-6 py-3 font-medium">Cidade</th>
                <th className="px-6 py-3 font-medium">Contato</th>
                <th className="px-6 py-3 font-medium text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="block md:table-row-group divide-y divide-gray-100">
              {destinatarios.map((d) => (
                <tr key={d.id} data-destinatario={d.id} className="grid grid-cols-2 gap-x-3 gap-y-1 px-3 py-2.5 md:table-row">
                  <td className="col-span-2 min-w-0 md:table-cell md:px-6 md:py-3">
                    <p className="font-medium text-gray-900 break-words">{d.name}</p>
                    {d.document && <p className="text-xs text-gray-500">{formatDocument(d.document)}</p>}
                  </td>
                  <td data-rotulo="Cidade" className="min-w-0 md:table-cell md:px-6 md:py-3 text-gray-700 before:content-[attr(data-rotulo)] before:block before:text-[11px] before:text-gray-500 md:before:content-none">
                    {d.city}
                    {d.address && <span className="block text-xs text-gray-500 break-words">{d.address}</span>}
                  </td>
                  <td data-rotulo="Contato" className="min-w-0 md:table-cell md:px-6 md:py-3 text-gray-700 before:content-[attr(data-rotulo)] before:block before:text-[11px] before:text-gray-500 md:before:content-none">
                    {d.contactName || d.phone ? [d.contactName, d.phone].filter(Boolean).join(" · ") : "-"}
                  </td>
                  <td className="col-span-2 min-w-0 md:table-cell md:px-6 md:py-3 md:text-right whitespace-nowrap">
                    <button onClick={() => abrir(d)} className="inline-flex items-center gap-1 text-orange-600 hover:underline mr-4">
                      <Pencil className="w-3.5 h-3.5" />
                      Editar
                    </button>
                    <button onClick={() => void apagar(d)} disabled={apagando === d.id} className="inline-flex items-center gap-1 text-red-600 hover:underline disabled:opacity-60">
                      <Trash2 className="w-3.5 h-3.5" />
                      Apagar
                    </button>
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
