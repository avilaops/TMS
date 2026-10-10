"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { formatCalendarDate, formatCurrency, formatDate } from "@/lib/format";
import { diaNoBrasil } from "@/lib/financeiro";
import {
  ADVANCE_REASONS,
  ADVANCE_REASON_LABEL,
  ADVANCE_STATUS_LABEL,
  acertoDoAdiantamento,
  acertoPorExtenso,
  nomeDaPessoa,
  pessoaDaChave,
  rotuloDoMotivo,
  type Acerto,
} from "@/lib/equipe";
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
 * Adiantamentos e acertos (só administrador). Registrar o adiantamento lança a
 * despesa no Financeiro; o acerto, na volta, guarda quanto foi gasto com
 * comprovante e mostra a diferença: a devolver ou a receber.
 */

type Adiantamento = {
  id: string;
  date: string;
  amount: number;
  reason: string;
  status: string;
  spentAmount: number | null;
  settledAt: string | null;
  notes: string | null;
  manifest: { id: string; createdAt: string } | null;
  driver: { id: string; user: { name: string } } | null;
  helper: { id: string; name: string } | null;
  acerto: Acerto | null;
};

type Viagem = { id: string; status: string; createdAt: string; driver: { user: { name: string } }; vehicle: { plate: string } };

const FALHA = "Não foi possível carregar os adiantamentos.";

type Lido = { erro: string } | { erro: null; adiantamentos: Adiantamento[] };

async function carregar(): Promise<Lido> {
  try {
    const res = await fetch("/api/equipe/adiantamentos");
    if (!res.ok) return { erro: await erroDe(res, FALHA) };
    return { erro: null, adiantamentos: (await res.json()) as Adiantamento[] };
  } catch {
    return { erro: FALHA };
  }
}

// Quantas viagens o campo de escolha oferece: as mais recentes.
const VIAGENS_NO_CAMPO = 30;

const formVazio = () => ({ pessoa: "", date: diaNoBrasil(new Date()), amount: "", reason: "TRIP", manifestId: "", notes: "" });

// O que o operador digitou, como número; em branco ou inválido não mostra diferença.
const doCampo = (texto: string) => (/^(\d+([.,]\d*)?|[.,]\d+)$/.test(texto.trim()) ? Number(texto.trim().replace(",", ".")) : null);

export function Adiantamentos({ pessoas }: { pessoas: PessoaDaEquipe[] }) {
  const [adiantamentos, setAdiantamentos] = useState<Adiantamento[] | null>(null);
  const [viagens, setViagens] = useState<Viagem[]>([]);
  const [formAberto, setFormAberto] = useState(false);
  const [form, setForm] = useState(formVazio);
  // Adiantamento cujo acerto está aberto, e o valor gasto digitado.
  const [acertando, setAcertando] = useState<Adiantamento | null>(null);
  const [gasto, setGasto] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<Aviso>(null);

  const mostrar = useCallback((lido: Lido) => {
    if (lido.erro !== null) return setAviso({ ok: false, texto: lido.erro });
    setAdiantamentos(lido.adiantamentos);
  }, []);

  const ler = async () => mostrar(await carregar());

  useEffect(() => {
    let ativo = true;
    carregar().then((lido) => {
      if (ativo) mostrar(lido);
    });
    // As viagens só alimentam o campo opcional do formulário: sem elas ele fica só com "Nenhuma".
    fetch("/api/manifestos")
      .then((res) => (res.ok ? res.json() : []))
      .then((lista: Viagem[]) => {
        if (ativo) setViagens(lista.filter((v) => v.status !== "CANCELLED").slice(0, VIAGENS_NO_CAMPO));
      })
      .catch(() => undefined);
    return () => {
      ativo = false;
    };
  }, [mostrar]);

  const gravar = async (res: Response, sucesso: string, falha: string) => {
    if (!res.ok) {
      setAviso({ ok: false, texto: await erroDe(res, falha) });
      return false;
    }
    setAviso({ ok: true, texto: sucesso });
    await ler();
    return true;
  };

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    setOcupado(true);
    setAviso(null);
    try {
      const { pessoa, ...dados } = form;
      const res = await enviar("/api/equipe/adiantamentos", "POST", { ...pessoaDaChave(pessoa), ...dados });
      if (await gravar(res, "Adiantamento registrado. A despesa foi lançada no Financeiro.", "Erro ao registrar o adiantamento.")) setFormAberto(false);
    } catch {
      setAviso({ ok: false, texto: "Erro ao registrar o adiantamento." });
    } finally {
      setOcupado(false);
    }
  };

  const acertar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!acertando) return;
    setOcupado(true);
    setAviso(null);
    try {
      const res = await enviar(`/api/equipe/adiantamentos/${acertando.id}`, "PATCH", { action: "acertar", spentAmount: gasto });
      if (await gravar(res, "Adiantamento acertado.", "Erro ao acertar o adiantamento.")) setAcertando(null);
    } finally {
      setOcupado(false);
    }
  };

  const reabrir = async (adiantamento: Adiantamento) => {
    if (!window.confirm(`Desfazer o acerto do adiantamento de ${nomeDaPessoa(adiantamento)}?`)) return;
    setOcupado(true);
    setAviso(null);
    try {
      await gravar(await enviar(`/api/equipe/adiantamentos/${adiantamento.id}`, "PATCH", { action: "reabrir" }), "Acerto desfeito.", "Erro ao reabrir o adiantamento.");
    } finally {
      setOcupado(false);
    }
  };

  const painelAberto = formAberto || acertando !== null;
  const emAberto = (adiantamentos ?? []).filter((a) => a.status === "OPEN").reduce((soma, a) => soma + a.amount, 0);
  const gastoDigitado = doCampo(gasto);
  const previa = acertando && gastoDigitado !== null ? acertoDoAdiantamento(acertando.amount, gastoDigitado) : null;

  return (
    <div className="space-y-3 md:space-y-4">
      <div className={`${painelAberto ? "hidden md:flex" : "flex"} items-center justify-between gap-2`}>
        <p className="text-sm text-gray-600 dark:text-gray-300" data-resumo="em-aberto">
          Em aberto: <strong className="text-gray-900 dark:text-white">{formatCurrency(emAberto)}</strong>
        </p>
        <button
          type="button"
          onClick={() => {
            setAcertando(null);
            setForm(formVazio());
            setAviso(null);
            setFormAberto(true);
          }}
          className={BOTAO}
        >
          <Plus className="w-4 h-4" />
          Novo adiantamento
        </button>
      </div>

      <Mensagem aviso={aviso} />

      {formAberto && (
        <form onSubmit={salvar} aria-label="Adiantamento" className={`${CARD} p-3 md:p-6 space-y-2 md:space-y-4`}>
          <h2 className="font-semibold text-gray-900 dark:text-white">Novo adiantamento</h2>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2 md:gap-4 lg:grid-cols-3">
            <EscolhaDePessoa pessoas={pessoas} valor={form.pessoa} aoMudar={(pessoa) => setForm({ ...form, pessoa })} />
            <label className="space-y-0.5 md:space-y-1.5 block min-w-0">
              <span className={LABEL}>Data</span>
              <input required type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className={INPUT} />
            </label>
            <label className="space-y-0.5 md:space-y-1.5 block min-w-0">
              <span className={LABEL}>Valor (R$)</span>
              <input required inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className={INPUT} />
            </label>
            <label className="space-y-0.5 md:space-y-1.5 block min-w-0">
              <span className={LABEL}>Motivo</span>
              <select value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} className={INPUT}>
                {ADVANCE_REASONS.map((motivo) => (
                  <option key={motivo} value={motivo}>
                    {ADVANCE_REASON_LABEL[motivo]}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-0.5 md:space-y-1.5 block min-w-0">
              <span className={LABEL}>Viagem (opcional)</span>
              <select value={form.manifestId} onChange={(e) => setForm({ ...form, manifestId: e.target.value })} className={INPUT}>
                <option value="">Nenhuma</option>
                {viagens.map((viagem) => (
                  <option key={viagem.id} value={viagem.id}>
                    {formatDate(viagem.createdAt)} · {viagem.driver.user.name} · {viagem.vehicle.plate}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-0.5 md:space-y-1.5 block min-w-0">
              <span className={LABEL}>Observação</span>
              <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={INPUT} />
            </label>
          </div>
          <div className="flex gap-3">
            <button type="submit" disabled={ocupado} className={BOTAO}>
              {ocupado && <Loader2 className="w-4 h-4 animate-spin" />}
              Registrar
            </button>
            <button type="button" onClick={() => setFormAberto(false)} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300">
              Cancelar
            </button>
          </div>
        </form>
      )}

      {acertando && (
        <form onSubmit={acertar} aria-label="Acerto" className={`${CARD} p-3 md:p-6 space-y-2 md:space-y-4`}>
          <div>
            <h2 className="font-semibold text-gray-900 dark:text-white">Acerto: {nomeDaPessoa(acertando)}</h2>
            <p className="text-xs md:text-sm text-gray-500 mt-0.5">
              {rotuloDoMotivo(acertando.reason)} de {formatCurrency(acertando.amount)} em {formatCalendarDate(acertando.date)}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2 md:gap-4">
            <label className="space-y-0.5 md:space-y-1.5 block min-w-0">
              <span className={LABEL}>Gasto comprovado (R$)</span>
              <input required inputMode="decimal" data-campo="gasto" value={gasto} onChange={(e) => setGasto(e.target.value)} className={INPUT} />
            </label>
            <div className="min-w-0" data-campo="diferenca">
              <p className={LABEL}>Diferença</p>
              <p className="mt-1 md:mt-2.5 text-lg font-bold text-gray-900 dark:text-white">{previa ? acertoPorExtenso(previa, formatCurrency) : "-"}</p>
            </div>
          </div>
          <div className="flex gap-3">
            <button type="submit" disabled={ocupado || gastoDigitado === null} className={BOTAO}>
              {ocupado && <Loader2 className="w-4 h-4 animate-spin" />}
              Confirmar acerto
            </button>
            <button type="button" onClick={() => setAcertando(null)} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300">
              Cancelar
            </button>
          </div>
        </form>
      )}

      <div className={`${painelAberto ? "hidden md:block " : ""}${CARD} overflow-hidden`}>
        {adiantamentos === null ? (
          <div className="flex items-center justify-center h-32" role="status" aria-label="Carregando">
            <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
          </div>
        ) : adiantamentos.length === 0 ? (
          <p className="p-8 text-center text-sm text-gray-500">Nenhum adiantamento registrado.</p>
        ) : (
          <table className={TABELA}>
            <thead className={THEAD}>
              <tr>
                <th className={TH}>Pessoa</th>
                <th className={TH}>Motivo</th>
                <th className={TH}>Data</th>
                <th className={`${TH} text-right`}>Valor</th>
                <th className={TH}>Situação</th>
                <th className={`${TH} text-right`}>Ações</th>
              </tr>
            </thead>
            <tbody className={TBODY}>
              {adiantamentos.map((adiantamento) => (
                <tr key={adiantamento.id} data-adiantamento={adiantamento.id} className={TR}>
                  <td className={`${TD} font-medium text-gray-900 dark:text-white`}>{nomeDaPessoa(adiantamento)}</td>
                  <td className={`${TD} text-gray-600 dark:text-gray-300`}>{rotuloDoMotivo(adiantamento.reason)}</td>
                  <td data-rotulo="Data" className={`${TD} ${COM_ROTULO} text-gray-600 dark:text-gray-300`}>{formatCalendarDate(adiantamento.date)}</td>
                  <td data-rotulo="Valor" className={`${TD} ${COM_ROTULO} md:text-right text-gray-900 dark:text-white`}>{formatCurrency(adiantamento.amount)}</td>
                  <td className={TD}>
                    <span className={`text-xs px-2.5 py-1 rounded-full ${adiantamento.status === "OPEN" ? "bg-yellow-100 text-yellow-800" : "bg-green-100 text-green-700"}`}>
                      {ADVANCE_STATUS_LABEL[adiantamento.status] ?? adiantamento.status}
                    </span>
                    {adiantamento.acerto && adiantamento.spentAmount !== null && (
                      <span className="block text-xs text-gray-500 mt-1" data-acerto>
                        Gastou {formatCurrency(adiantamento.spentAmount)} · {acertoPorExtenso(adiantamento.acerto, formatCurrency)}
                      </span>
                    )}
                  </td>
                  <td className={`${TD} md:text-right whitespace-nowrap`}>
                    {adiantamento.status === "OPEN" ? (
                      <button
                        type="button"
                        disabled={ocupado}
                        onClick={() => {
                          setFormAberto(false);
                          setGasto("");
                          setAviso(null);
                          setAcertando(adiantamento);
                        }}
                        className="text-blue-600 hover:underline"
                      >
                        Acertar
                      </button>
                    ) : (
                      <button type="button" disabled={ocupado} onClick={() => void reabrir(adiantamento)} className="text-blue-600 hover:underline">
                        Reabrir
                      </button>
                    )}
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
