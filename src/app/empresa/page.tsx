"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { Building2, Loader2, Search } from "lucide-react";
import { sair } from "@/lib/sair";

type Empresa = { slug: string; name: string };

/**
 * Escolha (ou troca) de empresa. Quem tem cadastro numa empresa só nem passa
 * por aqui. Chegam aqui a equipe da Ávila Ops, que entra em qualquer uma, quem
 * tem cadastro em mais de uma e quem não tem em nenhuma.
 */
export default function EscolherEmpresa() {
  const { update } = useSession();
  const [empresas, setEmpresas] = useState<Empresa[] | null>(null);
  const [equipe, setEquipe] = useState(false);
  const [busca, setBusca] = useState("");
  const [entrando, setEntrando] = useState<string | null>(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    fetch("/api/empresas")
      .then(async (res) => {
        if (res.status === 401) return window.location.assign("/login");
        if (!res.ok) throw new Error();
        const dados = (await res.json()) as { equipe: boolean; empresas: Empresa[] };
        setEquipe(dados.equipe);
        setEmpresas(dados.empresas);
      })
      .catch(() => setErro("Não foi possível carregar as empresas. Atualize a página."));
  }, []);

  const entrar = async (slug: string) => {
    setEntrando(slug);
    setErro("");
    const sessao = await update({ empresa: slug });
    if (sessao?.user?.tenantId && sessao.user.situacao === "dentro") {
      // Navegação completa: a área carrega já com o token da empresa nova.
      window.location.assign("/");
      return;
    }
    setErro("Não foi possível entrar nesta empresa.");
    setEntrando(null);
  };

  const termo = busca.trim().toLowerCase();
  const visiveis = (empresas ?? []).filter((e) => !termo || e.name.toLowerCase().includes(termo) || e.slug.includes(termo));

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 px-4 py-10">
      <div className="mx-auto w-full max-w-lg">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Escolha a empresa</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {equipe ? "Equipe Ávila Ops: você entra em qualquer empresa." : "Sua conta tem acesso a estas empresas."}
        </p>

        {erro && (
          <div role="alert" className="mt-6 p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm">
            {erro}
          </div>
        )}

        {empresas === null && !erro && (
          <div className="flex justify-center py-10" role="status" aria-label="Carregando">
            <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
          </div>
        )}

        {empresas !== null && empresas.length === 0 && (
          <div className="mt-6 p-5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl text-sm text-gray-700 dark:text-gray-300">
            {equipe
              ? "Ainda não há nenhuma empresa cadastrada."
              : "Sua conta não tem cadastro em nenhuma empresa do TMS. Peça o acesso a quem administra a sua empresa."}
          </div>
        )}

        {empresas !== null && empresas.length > 6 && (
          <label className="mt-6 flex items-center gap-2 px-4 py-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl">
            <Search className="w-4 h-4 text-gray-400" />
            <span className="sr-only">Buscar empresa</span>
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar empresa"
              className="flex-1 bg-transparent outline-none text-sm dark:text-white"
            />
          </label>
        )}

        <ul className="mt-4 space-y-2">
          {visiveis.map((empresa) => (
            <li key={empresa.slug}>
              <button
                type="button"
                disabled={entrando !== null}
                onClick={() => void entrar(empresa.slug)}
                className="w-full flex items-center gap-3 px-4 py-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl text-left hover:border-blue-500 disabled:opacity-60 transition-colors"
              >
                <span className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-900/30 text-blue-600 flex items-center justify-center shrink-0">
                  {entrando === empresa.slug ? <Loader2 className="w-5 h-5 animate-spin" /> : <Building2 className="w-5 h-5" />}
                </span>
                <span className="min-w-0">
                  <span className="block font-medium text-gray-900 dark:text-white truncate">{empresa.name}</span>
                  <span className="block text-xs text-gray-500 truncate">{empresa.slug}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>

        <div className="mt-8 flex items-center justify-between text-sm">
          {equipe ? (
            <Link href="/plataforma/empresas" className="text-blue-600 hover:underline">
              Gerenciar empresas
            </Link>
          ) : (
            <span />
          )}
          <button type="button" onClick={() => void sair()} className="text-gray-600 dark:text-gray-300 hover:underline">
            Sair
          </button>
        </div>
      </div>
    </div>
  );
}
