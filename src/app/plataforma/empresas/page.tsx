"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Building2, Loader2, Plus } from "lucide-react";
import { AvisoDeAcesso, type Acesso } from "@/components/AvisoDeAcesso";

type Empresa = {
  id: string;
  slug: string;
  name: string;
  cnpj: string | null;
  active: boolean;
  createdAt: string;
  _count: { users: number; clients: number; collections: number };
};

const VAZIO = { slug: "", name: "", cnpj: "", adminName: "", adminEmail: "" };

const campo =
  "w-full px-3 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:text-white";

/** Cadastro de empresas (transportadoras). Só a equipe da Ávila Ops chega aqui. */
export default function EmpresasDaPlataforma() {
  const [empresas, setEmpresas] = useState<Empresa[] | null>(null);
  const [form, setForm] = useState(VAZIO);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [acesso, setAcesso] = useState<{ nome: string; acesso: Acesso } | null>(null);

  const carregar = () =>
    fetch("/api/plataforma/empresas")
      .then(async (res) => {
        if (res.status === 401) return window.location.assign("/login");
        if (!res.ok) throw new Error();
        setEmpresas((await res.json()) as Empresa[]);
      })
      .catch(() => setErro("Não foi possível carregar as empresas."));

  useEffect(() => {
    void carregar();
  }, []);

  const criar = async (e: React.FormEvent) => {
    e.preventDefault();
    setSalvando(true);
    setErro("");
    setAviso("");

    const res = await fetch("/api/plataforma/empresas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const corpo = (await res.json().catch(() => ({}))) as { error?: string; name?: string; acesso?: Acesso };

    if (res.ok) {
      setAviso(`Empresa "${corpo.name}" criada.`);
      if (corpo.acesso) setAcesso({ nome: form.adminName, acesso: corpo.acesso });
      setForm(VAZIO);
      await carregar();
    } else {
      setErro(corpo.error ?? "Não foi possível criar a empresa.");
    }
    setSalvando(false);
  };

  const alternar = async (empresa: Empresa) => {
    const acao = empresa.active ? "desativar" : "reativar";
    if (!window.confirm(`Quer ${acao} "${empresa.name}"? ${empresa.active ? "Ninguém da empresa conseguirá entrar até ser reativada. Nenhum dado é apagado." : ""}`)) {
      return;
    }
    setErro("");
    const res = await fetch(`/api/plataforma/empresas/${empresa.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !empresa.active }),
    });
    if (!res.ok) setErro(`Não foi possível ${acao} a empresa.`);
    await carregar();
  };

  const mudar = (chave: keyof typeof VAZIO) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((atual) => ({ ...atual, [chave]: e.target.value }));

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 px-4 py-10">
      <div className="mx-auto w-full max-w-3xl">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Empresas</h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Transportadoras que usam o TMS.</p>
          </div>
          <Link href="/empresa" className="text-sm text-blue-600 hover:underline shrink-0">
            Entrar em uma empresa
          </Link>
        </div>

        {erro && (
          <div role="alert" className="mt-6 p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm">
            {erro}
          </div>
        )}
        {aviso && (
          <div role="status" className="mt-6 p-4 bg-green-50 border border-green-200 text-green-800 rounded-xl text-sm">
            {aviso}
          </div>
        )}

        {acesso && <AvisoDeAcesso nome={acesso.nome} acesso={acesso.acesso} onFechar={() => setAcesso(null)} />}

        <form
          onSubmit={criar}
          className="mt-6 p-5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl space-y-4"
        >
          <h2 className="font-semibold text-gray-900 dark:text-white">Nova empresa</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm text-gray-700 dark:text-gray-300 space-y-1">
              <span>Nome</span>
              <input required value={form.name} onChange={mudar("name")} className={campo} />
            </label>
            <label className="text-sm text-gray-700 dark:text-gray-300 space-y-1">
              <span>Identificador</span>
              <input
                required
                value={form.slug}
                onChange={mudar("slug")}
                autoCapitalize="none"
                placeholder="ex.: transportes-silva"
                className={campo}
              />
            </label>
            <label className="text-sm text-gray-700 dark:text-gray-300 space-y-1">
              <span>CNPJ (opcional)</span>
              <input value={form.cnpj} onChange={mudar("cnpj")} inputMode="numeric" className={campo} />
            </label>
            <span className="hidden sm:block" />
            <label className="text-sm text-gray-700 dark:text-gray-300 space-y-1">
              <span>Nome do administrador</span>
              <input required value={form.adminName} onChange={mudar("adminName")} className={campo} />
            </label>
            <label className="text-sm text-gray-700 dark:text-gray-300 space-y-1">
              <span>E-mail do administrador</span>
              <input required type="email" value={form.adminEmail} onChange={mudar("adminEmail")} className={campo} />
            </label>
          </div>
          <p className="text-xs text-gray-500">O identificador não muda depois de criado.</p>
          <button
            type="submit"
            disabled={salvando}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium disabled:opacity-60"
          >
            {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Criar empresa
          </button>
        </form>

        {empresas === null && !erro && (
          <div className="flex justify-center py-10" role="status" aria-label="Carregando">
            <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
          </div>
        )}

        <ul className="mt-6 space-y-2">
          {(empresas ?? []).map((empresa) => (
            <li
              key={empresa.id}
              className="flex flex-wrap items-center gap-3 px-4 py-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl"
            >
              <span className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-900/30 text-blue-600 flex items-center justify-center shrink-0">
                <Building2 className="w-5 h-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-gray-900 dark:text-white truncate">
                  {empresa.name}
                  {!empresa.active && <span className="ml-2 text-xs font-normal text-red-600">desativada</span>}
                </p>
                <p className="text-xs text-gray-500 truncate">
                  {empresa.slug} · {empresa._count.users} usuário(s) · {empresa._count.clients} cliente(s) ·{" "}
                  {empresa._count.collections} coleta(s)
                </p>
              </div>
              <button
                type="button"
                onClick={() => void alternar(empresa)}
                className="text-sm text-gray-600 dark:text-gray-300 hover:underline shrink-0"
              >
                {empresa.active ? "Desativar" : "Reativar"}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
