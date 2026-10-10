"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, MapPin, Pencil, Plus } from "lucide-react";
import { deniedReason, type DeniedReason } from "../../financeiro/carregar";
import { BOTAO_AZUL, BOTAO_CLARO, CARD, INPUT, LABEL, Negado, ROTULO, erroDe } from "../comum";

/**
 * Posições do depósito: o cadastro dos lugares onde os volumes ficam, cada um
 * com um código curto, o que está escrito na prateleira ("A-01-03"). É esse
 * código que a conferência lê para alocar os volumes. Posição não é apagada:
 * é desativada, e aí não recebe volume novo.
 */

type Posicao = { id: string; code: string; description: string | null; active: boolean; _count: { volumes: number } };

type Dados = { denied: DeniedReason } | { denied: null; erro: string } | { denied: null; erro: null; posicoes: Posicao[] };

const FALHA = "Não foi possível carregar as posições.";
const FALHA_AO_GRAVAR = "Não foi possível gravar a posição.";

const FORM_VAZIO = { id: "", code: "", description: "" };

async function carregar(): Promise<Dados> {
  try {
    const res = await fetch("/api/deposito/posicoes");
    const denied = deniedReason(res.status);
    if (denied) return { denied };
    if (!res.ok) return { denied: null, erro: await erroDe(res, FALHA) };
    return { denied: null, erro: null, posicoes: (await res.json()) as Posicao[] };
  } catch {
    return { denied: null, erro: FALHA };
  }
}

export default function PosicoesPage() {
  const [dados, setDados] = useState<Dados | null>(null);
  const [form, setForm] = useState<typeof FORM_VAZIO | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  const recarregar = useCallback(async () => setDados(await carregar()), []);

  useEffect(() => {
    let ativo = true;
    carregar().then((resultado) => {
      if (ativo) setDados(resultado);
    });
    return () => {
      ativo = false;
    };
  }, []);

  const abrirForm = (posicao?: Posicao) => {
    setErro("");
    setForm(posicao ? { id: posicao.id, code: posicao.code, description: posicao.description ?? "" } : FORM_VAZIO);
  };

  /** Cria ou altera; devolve se deu certo, já com a lista atualizada. */
  const gravar = async (id: string, corpo: Record<string, unknown>) => {
    setSalvando(true);
    setErro("");
    try {
      const res = await fetch(id ? `/api/deposito/posicoes/${id}` : "/api/deposito/posicoes", {
        method: id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
      });
      if (!res.ok) {
        setErro(await erroDe(res, FALHA_AO_GRAVAR));
        return false;
      }
      await recarregar();
      return true;
    } catch {
      setErro(FALHA_AO_GRAVAR);
      return false;
    } finally {
      setSalvando(false);
    }
  };

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    if (await gravar(form.id, { code: form.code, description: form.description })) setForm(null);
  };

  if (dados && dados.denied !== null) return <Negado motivo={dados.denied} />;

  const posicoes = dados && dados.denied === null && dados.erro === null ? dados.posicoes : null;

  return (
    <div className="space-y-3 md:space-y-6 max-w-4xl">
      <div className={`${form ? "hidden md:flex" : "flex"} items-center justify-between gap-3`}>
        <div className="flex items-center gap-2 min-w-0">
          <Link href="/dashboard/deposito" aria-label="Voltar para o depósito" className="p-2 -ml-2 text-gray-500 hover:text-gray-900 dark:hover:text-white">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <h1 className="text-2xl font-bold font-outfit text-gray-900 dark:text-white truncate">Posições</h1>
        </div>
        <button type="button" onClick={() => abrirForm()} className={`${BOTAO_AZUL} shrink-0`}>
          <Plus className="w-4 h-4" />
          Nova posição
        </button>
      </div>

      {form && (
        <form onSubmit={enviar} aria-label={form.id ? "Alterar posição" : "Nova posição"} className={`${CARD} p-3 md:p-6 space-y-2 md:space-y-4`}>
          <h2 className="font-semibold text-gray-900 dark:text-white">{form.id ? "Alterar posição" : "Nova posição"}</h2>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2 md:gap-4">
            <label className="block space-y-0.5 md:space-y-1.5 min-w-0">
              <span className={LABEL}>Código</span>
              <input
                required
                autoFocus
                maxLength={20}
                autoCapitalize="characters"
                placeholder="Ex.: A-01-03"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                className={`${INPUT} font-mono`}
              />
            </label>
            <label className="block space-y-0.5 md:space-y-1.5 min-w-0">
              <span className={LABEL}>Descrição</span>
              <input maxLength={120} placeholder="Opcional" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={INPUT} />
            </label>
          </div>
          <p className="text-xs text-gray-500">Letras, números e hífen, com ao menos uma letra. É o código que a conferência lê.</p>
          {erro && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {erro}
            </p>
          )}
          <div className="grid grid-cols-2 gap-3 md:flex md:justify-end">
            <button type="button" onClick={() => setForm(null)} className={BOTAO_CLARO}>
              Cancelar
            </button>
            <button type="submit" disabled={salvando} className={BOTAO_AZUL}>
              {salvando && <Loader2 className="w-4 h-4 animate-spin" />}
              Gravar
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

      {posicoes && (
        <div className={`${CARD} overflow-hidden ${form ? "hidden md:block" : ""}`}>
          {!form && erro && (
            <p role="alert" className="px-3 py-2 text-sm text-red-600 dark:text-red-400">
              {erro}
            </p>
          )}
          {posicoes.length === 0 ? (
            <div className="p-10 text-center text-gray-500">
              <MapPin className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p>Nenhuma posição cadastrada. Cadastre a primeira para alocar os volumes.</p>
            </div>
          ) : (
            <table className="block md:table w-full text-sm">
              <thead className="hidden md:table-header-group bg-gray-50 dark:bg-gray-950 text-gray-500 text-left">
                <tr>
                  <th className="px-4 py-3 font-medium">Código</th>
                  <th className="px-4 py-3 font-medium">Descrição</th>
                  <th className="px-4 py-3 font-medium">Volumes</th>
                  <th className="px-4 py-3 font-medium">Situação</th>
                  <th className="px-4 py-3 font-medium">Ações</th>
                </tr>
              </thead>
              <tbody className="block md:table-row-group divide-y divide-gray-100 dark:divide-gray-800">
                {posicoes.map((posicao) => (
                  <tr key={posicao.id} data-posicao={posicao.code} className={`grid grid-cols-2 gap-x-3 gap-y-1.5 px-3 py-2.5 md:table-row ${posicao.active ? "" : "opacity-60"}`}>
                    <td className="min-w-0 md:table-cell md:px-4 md:py-3 font-mono font-medium text-gray-900 dark:text-white">{posicao.code}</td>
                    <td data-rotulo="Descrição" className={`min-w-0 md:table-cell md:px-4 md:py-3 text-gray-700 dark:text-gray-300 truncate ${ROTULO}`}>
                      {posicao.description ?? "-"}
                    </td>
                    <td data-rotulo="Volumes" className={`min-w-0 md:table-cell md:px-4 md:py-3 text-gray-700 dark:text-gray-300 ${ROTULO}`}>
                      {posicao._count.volumes}
                    </td>
                    <td data-rotulo="Situação" className={`min-w-0 md:table-cell md:px-4 md:py-3 text-gray-700 dark:text-gray-300 ${ROTULO}`}>
                      {posicao.active ? "Ativa" : "Inativa"}
                    </td>
                    <td className="col-span-2 min-w-0 md:table-cell md:px-4 md:py-3">
                      <div className="flex gap-2">
                        <button type="button" disabled={salvando} onClick={() => abrirForm(posicao)} className={`${BOTAO_CLARO} px-3 py-1.5`}>
                          <Pencil className="w-4 h-4" />
                          Alterar
                        </button>
                        <button type="button" disabled={salvando} onClick={() => void gravar(posicao.id, { active: !posicao.active })} className={`${BOTAO_CLARO} px-3 py-1.5`}>
                          {posicao.active ? "Desativar" : "Reativar"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
