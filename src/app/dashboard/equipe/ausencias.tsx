"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { formatCalendarDate } from "@/lib/format";
import { ABSENCE_TYPES, ABSENCE_TYPE_LABEL, diasDaAusencia, nomeDaPessoa, pessoaDaChave, rotuloDaAusencia } from "@/lib/equipe";
import {
  BOTAO,
  CARD,
  COM_ROTULO,
  EscolhaDePessoa,
  INPUT,
  LABEL,
  Mensagem,
  TABELA,
  TBODY,
  TD,
  TH,
  THEAD,
  TR,
  enviar,
  erroDe,
  type Aviso,
  type PessoaDaEquipe,
} from "./comum";

/**
 * Ausências: férias, folga, atestado, falta. O período conta o primeiro e o
 * último dia. Quem está ausente hoje aparece na aba Pessoas e, se for
 * motorista, vira um aviso na montagem de viagem.
 */

type Ausencia = {
  id: string;
  type: string;
  startDate: string;
  endDate: string;
  notes: string | null;
  driver: { id: string; user: { name: string } } | null;
  helper: { id: string; name: string } | null;
};

const FORM_VAZIO = { pessoa: "", type: "DAY_OFF", startDate: "", endDate: "", notes: "" };

const FALHA = "Não foi possível carregar as ausências.";

type Lido = { erro: string } | { erro: null; ausencias: Ausencia[] };

async function carregar(): Promise<Lido> {
  try {
    const res = await fetch("/api/equipe/ausencias");
    if (!res.ok) return { erro: await erroDe(res, FALHA) };
    return { erro: null, ausencias: (await res.json()) as Ausencia[] };
  } catch {
    return { erro: FALHA };
  }
}

export function Ausencias({ pessoas, recarregarPessoas }: { pessoas: PessoaDaEquipe[]; recarregarPessoas: () => Promise<void> }) {
  const [ausencias, setAusencias] = useState<Ausencia[] | null>(null);
  const [formAberto, setFormAberto] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [form, setForm] = useState(FORM_VAZIO);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<Aviso>(null);

  const mostrar = useCallback((lido: Lido) => {
    if (lido.erro !== null) return setAviso({ ok: false, texto: lido.erro });
    setAusencias(lido.ausencias);
  }, []);

  const ler = async () => mostrar(await carregar());

  useEffect(() => {
    let ativo = true;
    carregar().then((lido) => {
      if (ativo) mostrar(lido);
    });
    return () => {
      ativo = false;
    };
  }, [mostrar]);

  const abrirNovo = () => {
    setEditandoId(null);
    setForm(FORM_VAZIO);
    setAviso(null);
    setFormAberto(true);
  };

  const abrirEdicao = (ausencia: Ausencia) => {
    setEditandoId(ausencia.id);
    setForm({
      pessoa: "",
      type: ausencia.type,
      startDate: ausencia.startDate.slice(0, 10),
      endDate: ausencia.endDate.slice(0, 10),
      notes: ausencia.notes ?? "",
    });
    setAviso(null);
    setFormAberto(true);
  };

  /** Depois de gravar: a lista e, porque "ausente hoje" pode ter mudado, as pessoas. */
  const gravar = async (res: Response, sucesso: string, falha: string) => {
    if (!res.ok) {
      setAviso({ ok: false, texto: await erroDe(res, falha) });
      return false;
    }
    setAviso({ ok: true, texto: sucesso });
    await ler();
    await recarregarPessoas();
    return true;
  };

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    setOcupado(true);
    setAviso(null);
    try {
      const { pessoa, ...periodo } = form;
      // Na edição a pessoa não muda: só tipo, período e observação.
      const res = editandoId
        ? await enviar(`/api/equipe/ausencias/${editandoId}`, "PATCH", periodo)
        : await enviar("/api/equipe/ausencias", "POST", { ...pessoaDaChave(pessoa), ...periodo });
      if (await gravar(res, editandoId ? "Ausência alterada." : "Ausência registrada.", "Erro ao salvar a ausência.")) setFormAberto(false);
    } catch {
      setAviso({ ok: false, texto: "Erro ao salvar a ausência." });
    } finally {
      setOcupado(false);
    }
  };

  const excluir = async (ausencia: Ausencia) => {
    if (!window.confirm(`Excluir a ausência de ${nomeDaPessoa(ausencia)}? Não dá para desfazer.`)) return;
    setOcupado(true);
    setAviso(null);
    try {
      await gravar(await enviar(`/api/equipe/ausencias/${ausencia.id}`, "DELETE"), "Ausência excluída.", "Erro ao excluir a ausência.");
    } finally {
      setOcupado(false);
    }
  };

  return (
    <div className="space-y-3 md:space-y-4">
      <div className={`${formAberto ? "hidden md:flex" : "flex"} items-center justify-between gap-2`}>
        <p className="text-sm text-gray-600 dark:text-gray-300">Férias, folgas, atestados e faltas.</p>
        <button type="button" onClick={abrirNovo} className={BOTAO}>
          <Plus className="w-4 h-4" />
          Nova ausência
        </button>
      </div>

      <Mensagem aviso={aviso} />

      {formAberto && (
        <form onSubmit={salvar} aria-label="Ausência" className={`${CARD} p-3 md:p-6 space-y-2 md:space-y-4`}>
          <h2 className="font-semibold text-gray-900 dark:text-white">{editandoId ? "Alterar ausência" : "Nova ausência"}</h2>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2 md:gap-4 lg:grid-cols-4">
            {!editandoId && <EscolhaDePessoa pessoas={pessoas} valor={form.pessoa} aoMudar={(pessoa) => setForm({ ...form, pessoa })} />}
            <label className="space-y-0.5 md:space-y-1.5 block min-w-0">
              <span className={LABEL}>Tipo</span>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className={INPUT}>
                {ABSENCE_TYPES.map((tipo) => (
                  <option key={tipo} value={tipo}>
                    {ABSENCE_TYPE_LABEL[tipo]}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-0.5 md:space-y-1.5 block min-w-0">
              <span className={LABEL}>De</span>
              <input
                required
                type="date"
                value={form.startDate}
                // Um dia só é o caso mais comum: o "até" acompanha o "de" enquanto estiver vazio ou antes dele.
                onChange={(e) => setForm({ ...form, startDate: e.target.value, endDate: !form.endDate || form.endDate < e.target.value ? e.target.value : form.endDate })}
                className={INPUT}
              />
            </label>
            <label className="space-y-0.5 md:space-y-1.5 block min-w-0">
              <span className={LABEL}>Até</span>
              <input required type="date" min={form.startDate} value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} className={INPUT} />
            </label>
            <label className="col-span-2 lg:col-span-4 space-y-0.5 md:space-y-1.5 block min-w-0">
              <span className={LABEL}>Observação</span>
              <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={INPUT} />
            </label>
          </div>
          <div className="flex gap-3">
            <button type="submit" disabled={ocupado} className={BOTAO}>
              {ocupado && <Loader2 className="w-4 h-4 animate-spin" />}
              Salvar
            </button>
            <button type="button" onClick={() => setFormAberto(false)} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300">
              Cancelar
            </button>
          </div>
        </form>
      )}

      <div className={`${formAberto ? "hidden md:block " : ""}${CARD} overflow-hidden`}>
        {ausencias === null ? (
          <div className="flex items-center justify-center h-32" role="status" aria-label="Carregando">
            <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
          </div>
        ) : ausencias.length === 0 ? (
          <p className="p-8 text-center text-sm text-gray-500">Nenhuma ausência registrada.</p>
        ) : (
          <table className={TABELA}>
            <thead className={THEAD}>
              <tr>
                <th className={TH}>Pessoa</th>
                <th className={TH}>Tipo</th>
                <th className={TH}>Período</th>
                <th className={TH}>Dias</th>
                <th className={TH}>Observação</th>
                <th className={`${TH} text-right`}>Ações</th>
              </tr>
            </thead>
            <tbody className={TBODY}>
              {ausencias.map((ausencia) => (
                <tr key={ausencia.id} data-ausencia={ausencia.id} className={TR}>
                  <td className={`${TD} font-medium text-gray-900 dark:text-white`}>{nomeDaPessoa(ausencia)}</td>
                  <td className={`${TD} text-gray-600 dark:text-gray-300`}>{rotuloDaAusencia(ausencia.type)}</td>
                  <td data-rotulo="Período" className={`${TD} ${COM_ROTULO} text-gray-600 dark:text-gray-300`}>
                    {formatCalendarDate(ausencia.startDate)}
                    {ausencia.endDate.slice(0, 10) !== ausencia.startDate.slice(0, 10) && ` a ${formatCalendarDate(ausencia.endDate)}`}
                  </td>
                  <td data-rotulo="Dias" className={`${TD} ${COM_ROTULO} text-gray-600 dark:text-gray-300`}>{diasDaAusencia(ausencia)}</td>
                  <td className={`${TD} ${ausencia.notes ? "col-span-2" : "hidden md:table-cell"} text-gray-600 dark:text-gray-300`}>{ausencia.notes || "-"}</td>
                  <td className={`${TD} col-span-2 md:text-right whitespace-nowrap space-x-3`}>
                    <button type="button" disabled={ocupado} onClick={() => abrirEdicao(ausencia)} className="text-blue-600 hover:underline">
                      Editar
                    </button>
                    <button type="button" disabled={ocupado} onClick={() => void excluir(ausencia)} className="text-red-600 hover:underline">
                      Excluir
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
