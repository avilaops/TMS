"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Plus, RefreshCw } from "lucide-react";
import {
  DIAS_PARA_COBRAR,
  LEAD_CHANNEL_LABELS,
  LEAD_MANUAL_CHANNELS,
  LEAD_MANUAL_STATUSES,
  LEAD_STATUSES,
  LEAD_STATUS_LABELS,
  LOST_REASONS,
  LOST_REASON_LABELS,
  PERIODOS_DA_LISTA,
  csvDeCotacoes,
  diasParada,
  divergenciaDeFrete,
  isConvertible,
  isOpen,
  linhasDoCsv,
  resumoDoFunil,
  rotuloDoCanal,
  rotuloDaPerda,
  type LeadDaLista,
  type LeadStatus,
} from "@/lib/crm";
import { formatCurrency } from "@/lib/format";

/**
 * Cotações: tudo o que chegou pedindo preço (site, WhatsApp, telefone,
 * e-mail), em duas visões sobre a mesma lista. O **funil** é o quadro por
 * etapa, onde se troca status, valor e responsável e se converte em coleta; a
 * **lista** é a tabela para achar, cobrar e exportar. Os filtros do topo valem
 * para as duas, e os números do resumo são do que está filtrado.
 *
 * As regras ficam nas rotas (src/lib/crm.ts); aqui é só o que a tela mostra e
 * o que ela manda em cada ação.
 */

type QuoteLead = LeadDaLista & { createdAt: string; lastActivityAt: string };

type Cliente = { id: string; companyName: string; tradeName: string | null; active: boolean };

type Pessoa = { id: string; name: string };

type Conversao = { leadId: string; clientId: string; sender: string; receiver: string; invoiceValue: string };

type Visao = "funil" | "lista";

type Filtros = { busca: string; dias: string; status: string; assigneeId: string };

const SEM_FILTRO: Filtros = { busca: "", dias: "", status: "", assigneeId: "" };

const STATUS_COLORS: Record<LeadStatus, string> = {
  NEW: "bg-blue-100 text-blue-800",
  CONTACTED: "bg-yellow-100 text-yellow-800",
  CONVERTED: "bg-green-100 text-green-800",
  LOST: "bg-red-100 text-red-800",
};

const INPUT = "bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-500";
const LABEL = "flex flex-col gap-1 text-xs font-medium text-gray-600";

const FORM_VAZIO = { companyName: "", phone: "", email: "", channel: "WHATSAPP", origin: "", destination: "", volumes: "1", weight: "", invoiceValue: "", assigneeId: "" };

type Resposta<T> = { ok: true; dados: T } | { ok: false; erro: string };

// Toda chamada da tela passa por aqui: o erro mostrado é o do corpo (`error`).
async function chamar<T>(url: string, init?: RequestInit): Promise<Resposta<T>> {
  try {
    const res = await fetch(url, init);
    const corpo = await res.json().catch(() => null);
    if (!res.ok) {
      return {
        ok: false,
        erro: typeof corpo?.error === "string" ? corpo.error : `Erro ${res.status} ao falar com o servidor.`,
      };
    }
    return { ok: true, dados: corpo as T };
  } catch {
    return { ok: false, erro: "Não foi possível falar com o servidor. Tente de novo." };
  }
}

// Sem filtro nenhum a URL é a de sempre, sem "?".
function urlDaLista(filtros: Filtros): string {
  const params = new URLSearchParams();
  if (filtros.status) params.set("status", filtros.status);
  if (filtros.dias) params.set("dias", filtros.dias);
  if (filtros.assigneeId) params.set("assigneeId", filtros.assigneeId);
  if (filtros.busca.trim()) params.set("busca", filtros.busca.trim());
  const query = params.toString();
  return `/api/dashboard/crm${query ? `?${query}` : ""}`;
}

async function buscarLeads(filtros: Filtros): Promise<Resposta<QuoteLead[]>> {
  const res = await chamar<QuoteLead[]>(urlDaLista(filtros));
  if (res.ok && !Array.isArray(res.dados)) return { ok: false, erro: "Não foi possível carregar as cotações." };
  return res;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

// Número no campo de texto como o operador digita: vírgula decimal.
const paraCampo = (valor: number | null) => (valor === null ? "" : String(valor).replace(".", ","));

const quando = (valor: string) => new Date(valor).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

const pct = (valor: number | null) => (valor === null ? "—" : `${Math.round(valor * 100)}%`);

/** Baixa o CSV do que está na tela. Fora do navegador (teste) não há o que baixar. */
function baixarCsv(leads: QuoteLead[]) {
  if (typeof URL.createObjectURL !== "function") return;
  const blob = new Blob([csvDeCotacoes(linhasDoCsv(leads))], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `cotacoes-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 500);
}

export default function CRMPage() {
  const [leads, setLeads] = useState<QuoteLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [editingLead, setEditingLead] = useState<QuoteLead | null>(null);
  const [estimatedValue, setEstimatedValue] = useState("");
  const [clientes, setClientes] = useState<Cliente[] | null>(null);
  const [equipe, setEquipe] = useState<Pessoa[]>([]);
  const [conversao, setConversao] = useState<Conversao | null>(null);
  const [enviando, setEnviando] = useState(false);
  // Confirmação da última conversão, quando o frete da coleta não é o valor estimado do lead.
  const [confirmacao, setConfirmacao] = useState<string | null>(null);
  // No celular aparece uma coluna por vez, escolhida nas abas; no computador, as quatro lado a lado.
  const [colunaAtiva, setColunaAtiva] = useState<LeadStatus>("NEW");
  const [visao, setVisao] = useState<Visao>("funil");
  const [filtros, setFiltros] = useState<Filtros>(SEM_FILTRO);
  // A busca só vai ao servidor depois de uma pausa na digitação.
  const [buscaDigitada, setBuscaDigitada] = useState("");
  const [formAberto, setFormAberto] = useState(false);
  const [form, setForm] = useState(FORM_VAZIO);
  const [erroDoForm, setErroDoForm] = useState("");

  function receber(res: Resposta<QuoteLead[]>) {
    if (res.ok) setLeads(res.dados);
    setErro(res.ok ? null : res.erro);
    setLoading(false);
  }

  useEffect(() => {
    let ativo = true;
    buscarLeads(filtros).then((res) => {
      if (ativo) receber(res);
    });
    return () => {
      ativo = false;
    };
  }, [filtros]);

  // A equipe comercial, para os selects de responsável. Falha aqui não é erro
  // de tela: os selects só ficam sem opções.
  useEffect(() => {
    let ativo = true;
    chamar<Pessoa[]>("/api/dashboard/crm/equipe").then((res) => {
      if (ativo && res.ok && Array.isArray(res.dados)) setEquipe(res.dados);
    });
    return () => {
      ativo = false;
    };
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setFiltros((atuais) => (atuais.busca === buscaDigitada ? atuais : { ...atuais, busca: buscaDigitada })), 300);
    return () => clearTimeout(t);
  }, [buscaDigitada]);

  const fetchLeads = useCallback(async () => receber(await buscarLeads(filtros)), [filtros]);

  const resumo = useMemo(() => resumoDoFunil(leads), [leads]);

  // Troca na lista o lead que a rota devolveu, sem buscar tudo de novo.
  function trocar(lead: QuoteLead) {
    setErro(null);
    setLeads((atuais) => atuais.map((l) => (l.id === lead.id ? lead : l)));
  }

  async function alterar(id: string, body: Record<string, unknown>) {
    const res = await chamar<QuoteLead>(`/api/dashboard/crm/${id}`, json("PATCH", body));
    if (!res.ok) return setErro(res.erro);
    trocar(res.dados);
  }

  const updateLeadStatus = (id: string, newStatus: string) => alterar(id, { status: newStatus });

  async function saveEstimatedValue(id: string) {
    // O texto vai como foi digitado: a rota aceita vírgula decimal, e vazio apaga o valor.
    const res = await chamar<QuoteLead>(`/api/dashboard/crm/${id}`, json("PATCH", { estimatedValue }));
    if (!res.ok) return setErro(res.erro);
    setEditingLead(null);
    trocar(res.dados);
  }

  async function abrirConversao(lead: QuoteLead) {
    setEditingLead(null);
    setConfirmacao(null);
    setVisao("funil");
    setColunaAtiva(lead.status as LeadStatus);
    setConversao({
      leadId: lead.id,
      clientId: "",
      sender: lead.companyName,
      receiver: "",
      invoiceValue: paraCampo(lead.invoiceValue),
    });
    if (clientes) return;
    const res = await chamar<Cliente[]>("/api/clientes");
    if (!res.ok || !Array.isArray(res.dados)) {
      return setErro(res.ok ? "Não foi possível carregar os clientes." : res.erro);
    }
    // Coleta só nasce para cliente ativo.
    setClientes(res.dados.filter((c) => c.active));
  }

  async function converter(form: Conversao) {
    setEnviando(true);
    const res = await chamar<{ lead: QuoteLead; collection?: { freightValue?: number | null } }>(
      `/api/dashboard/crm/${form.leadId}/converter`,
      json("POST", {
        clientId: form.clientId,
        sender: form.sender,
        receiver: form.receiver,
        invoiceValue: form.invoiceValue,
      }),
    );
    setEnviando(false);
    if (!res.ok) return setErro(res.erro);
    setConversao(null);
    trocar(res.dados.lead);

    // A coleta nasce com o frete da tabela, não com o valor da cotação. Quando
    // os dois não batem, o operador precisa saber antes de a carga ser faturada.
    const { lead } = res.dados;
    const divergencia = divergenciaDeFrete(lead.estimatedValue, res.dados.collection?.freightValue);
    setConfirmacao(
      divergencia &&
        `Cotação de ${lead.companyName} convertida em coleta. Valor estimado na cotação: ${formatCurrency(divergencia.estimado)}. ` +
          (divergencia.frete === null
            ? "A coleta nasceu sem frete (a cotar): não há tabela para este destino. "
            : `Frete da coleta pela tabela: ${formatCurrency(divergencia.frete)}. `) +
          "É o frete da coleta que vai para a fatura: para cobrar o valor da cotação, edite o frete na coleta.",
    );
  }

  async function registrar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setErroDoForm("");
    // Responsável em branco fica com quem registra (a rota decide); "ninguem" grava sem responsável.
    const { assigneeId, ...resto } = form;
    const corpo = assigneeId === "" ? resto : { ...resto, assigneeId: assigneeId === "ninguem" ? null : assigneeId };
    const res = await chamar<QuoteLead>("/api/dashboard/crm", json("POST", corpo));
    setEnviando(false);
    if (!res.ok) return setErroDoForm(res.erro);
    setErro(null);
    setFormAberto(false);
    setForm(FORM_VAZIO);
    setLeads((atuais) => [res.dados, ...atuais]);
    setColunaAtiva("NEW");
  }

  const campo = (nome: keyof typeof FORM_VAZIO) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((atual) => ({ ...atual, [nome]: e.target.value }));

  /** O select de responsável; a pessoa atual entra mesmo se saiu da equipe. */
  function SelectResponsavel({ lead, className }: { lead: QuoteLead; className?: string }) {
    const opcoes = lead.assignee && !equipe.some((p) => p.id === lead.assignee!.id) ? [lead.assignee, ...equipe] : equipe;
    return (
      <select
        aria-label="Responsável"
        value={lead.assignee?.id ?? ""}
        onChange={(e) => alterar(lead.id, { assigneeId: e.target.value })}
        className={className ?? `w-full text-xs ${INPUT}`}
      >
        <option value="">Sem responsável</option>
        {opcoes.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
    );
  }

  function SelectMotivo({ lead, className }: { lead: QuoteLead; className?: string }) {
    return (
      <select
        aria-label="Motivo da perda"
        value={lead.lostReason ?? ""}
        onChange={(e) => alterar(lead.id, { lostReason: e.target.value || null })}
        className={className ?? `w-full text-xs ${INPUT}`}
      >
        <option value="">Motivo da perda</option>
        {LOST_REASONS.map((m) => (
          <option key={m} value={m}>{LOST_REASON_LABELS[m]}</option>
        ))}
      </select>
    );
  }

  function Parada({ lead }: { lead: QuoteLead }) {
    const dias = diasParada(lead);
    if (dias === null) return null;
    return (
      <span data-parada className="inline-block text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 whitespace-nowrap">
        parada há {dias} dias
      </span>
    );
  }

  if (loading) {
    return <div className="md:p-8">Carregando cotações...</div>;
  }

  return (
    <div className="md:p-8 max-w-7xl mx-auto">
      <div className="mb-4 md:mb-6 flex justify-between items-start gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-black text-gray-900">Cotações</h1>
          <p className="hidden md:block text-gray-500 mt-1">Pedidos de frete do site, do WhatsApp, do telefone e do e-mail: cotar, cobrar e converter em coleta</p>
        </div>
        {/* No celular os botões secundários ficam só com o ícone: com o texto, a linha passava da largura da tela. */}
        <div className="flex flex-wrap justify-end gap-2 min-w-0">
          <button
            type="button"
            onClick={() => {
              setErroDoForm("");
              setFormAberto((aberto) => !aberto);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-2 md:px-4 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition"
          >
            <Plus className="w-4 h-4" />
            Registrar cotação
          </button>
          <button
            type="button"
            onClick={() => baixarCsv(leads)}
            disabled={leads.length === 0}
            aria-label="Exportar CSV"
            title="Exportar CSV"
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-700 rounded-lg font-medium transition"
          >
            <Download className="w-4 h-4" />
            <span className="hidden md:inline">Exportar CSV</span>
          </button>
          <button
            onClick={fetchLeads}
            aria-label="Atualizar Lista"
            title="Atualizar Lista"
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-medium transition"
          >
            <RefreshCw className="w-4 h-4" />
            <span className="hidden md:inline">Atualizar Lista</span>
          </button>
        </div>
      </div>

      {formAberto && (
        <form onSubmit={registrar} aria-label="Registrar cotação" className="mb-4 md:mb-6 bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-3">
          <p className="font-semibold text-gray-900">Registrar cotação</p>
          <p className="text-xs text-gray-500">Pedido que chegou fora do site. O valor estimado sai da tabela de frete padrão; sem tabela para o destino, fica para você preencher.</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <label className={`${LABEL} col-span-2`}>Empresa ou cliente<input name="companyName" required value={form.companyName} onChange={campo("companyName")} className={INPUT} /></label>
            <label className={LABEL}>Telefone<input name="phone" inputMode="tel" value={form.phone} onChange={campo("phone")} className={INPUT} /></label>
            <label className={LABEL}>E-mail<input name="email" type="email" value={form.email} onChange={campo("email")} className={INPUT} /></label>
            <label className={LABEL}>Chegou por
              <select name="channel" value={form.channel} onChange={campo("channel")} className={INPUT}>
                {LEAD_MANUAL_CHANNELS.map((c) => (
                  <option key={c} value={c}>{LEAD_CHANNEL_LABELS[c]}</option>
                ))}
              </select>
            </label>
            <label className={LABEL}>Origem<input name="origin" required value={form.origin} onChange={campo("origin")} placeholder="Cidade" className={INPUT} /></label>
            <label className={LABEL}>Destino<input name="destination" required value={form.destination} onChange={campo("destination")} placeholder="Cidade" className={INPUT} /></label>
            <label className={LABEL}>Volumes<input name="volumes" inputMode="numeric" value={form.volumes} onChange={campo("volumes")} className={INPUT} /></label>
            <label className={LABEL}>Peso (kg)<input name="weight" required inputMode="decimal" value={form.weight} onChange={campo("weight")} className={INPUT} /></label>
            <label className={LABEL}>Valor da nota (R$)<input name="invoiceValue" inputMode="decimal" value={form.invoiceValue} onChange={campo("invoiceValue")} className={INPUT} /></label>
            <label className={`${LABEL} col-span-2`}>Responsável
              <select name="assigneeId" value={form.assigneeId} onChange={campo("assigneeId")} className={INPUT}>
                <option value="">Quem registra</option>
                <option value="ninguem">Sem responsável</option>
                {equipe.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>
          </div>
          {erroDoForm && (
            <p role="alert" className="px-3 py-2 text-sm text-red-700 border border-red-200 rounded-lg bg-red-50">{erroDoForm}</p>
          )}
          <div className="flex gap-2">
            <button type="submit" disabled={enviando} className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg font-medium">Salvar cotação</button>
            <button type="button" onClick={() => setFormAberto(false)} className="px-4 py-2 text-sm rounded-lg border border-gray-200 text-gray-600">Cancelar</button>
          </div>
        </form>
      )}

      {erro && (
        <div role="alert" className="mb-6 px-4 py-3 text-sm text-red-700 border border-red-200 rounded-lg bg-red-50">
          {erro}
        </div>
      )}

      {confirmacao && (
        <div role="status" className="mb-6 px-4 py-3 text-sm text-amber-800 border border-amber-200 rounded-lg bg-amber-50">
          {confirmacao}
        </div>
      )}

      <div data-resumo className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-4 mb-4 md:mb-6">
        <div className="bg-white rounded-xl border border-gray-200 p-3 md:p-4">
          <p className="text-xs text-gray-500">Cotações</p>
          <p className="text-xl md:text-2xl font-bold text-gray-900">{resumo.total}</p>
          <p className="text-xs text-gray-500">{resumo.abertas} em aberto</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-3 md:p-4">
          <p className="text-xs text-gray-500">Conversão</p>
          <p className="text-xl md:text-2xl font-bold text-gray-900">{pct(resumo.conversao)}</p>
          <p className="text-xs text-gray-500">{resumo.ganhas} de {resumo.ganhas + resumo.perdidas} decididas</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-3 md:p-4">
          <p className="text-xs text-gray-500">Fechado × cotado</p>
          <p className="text-xl md:text-2xl font-bold text-gray-900">{formatCurrency(resumo.fechado)}</p>
          <p className="text-xs text-gray-500">de {formatCurrency(resumo.cotado)} cotados</p>
        </div>
        <button
          type="button"
          data-paradas
          onClick={() => setFiltros((f) => ({ ...f, status: f.status === "parada" ? "" : "parada" }))}
          className={`text-left rounded-xl border p-3 md:p-4 ${filtros.status === "parada" ? "bg-amber-50 border-amber-300" : "bg-white border-gray-200 hover:bg-gray-50"}`}
        >
          <p className="text-xs text-gray-500">Paradas</p>
          <p className={`text-xl md:text-2xl font-bold ${resumo.paradas ? "text-amber-700" : "text-gray-900"}`}>{resumo.paradas}</p>
          <p className="text-xs text-gray-500">sem atividade há {DIAS_PARA_COBRAR}+ dias</p>
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          type="search"
          aria-label="Buscar cotação"
          placeholder="Buscar por nº, empresa, cidade, telefone"
          value={buscaDigitada}
          onChange={(e) => setBuscaDigitada(e.target.value)}
          className={`${INPUT} w-full md:w-64`}
        />
        <select aria-label="Período" value={filtros.dias} onChange={(e) => setFiltros({ ...filtros, dias: e.target.value })} className={INPUT}>
          <option value="">Todo o período</option>
          {PERIODOS_DA_LISTA.map((d) => (
            <option key={d} value={d}>Últimos {d} dias</option>
          ))}
        </select>
        <select aria-label="Etapa" value={filtros.status} onChange={(e) => setFiltros({ ...filtros, status: e.target.value })} className={INPUT}>
          <option value="">Todas as etapas</option>
          {LEAD_STATUSES.map((s) => (
            <option key={s} value={s}>{LEAD_STATUS_LABELS[s]}</option>
          ))}
          <option value="parada">Paradas</option>
        </select>
        <select aria-label="Filtrar por responsável" value={filtros.assigneeId} onChange={(e) => setFiltros({ ...filtros, assigneeId: e.target.value })} className={INPUT}>
          <option value="">Qualquer responsável</option>
          <option value="ninguem">Sem responsável</option>
          {equipe.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <div role="group" aria-label="Visão" className="ml-auto inline-flex rounded-lg border border-gray-200 bg-gray-100 p-0.5 text-sm">
          {(["funil", "lista"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={visao === v}
              data-visao={v}
              onClick={() => setVisao(v)}
              className={`px-3 py-1 rounded-md font-medium ${visao === v ? "bg-white text-blue-700 shadow-sm" : "text-gray-600"}`}
            >
              {v === "funil" ? "Funil" : "Lista"}
            </button>
          ))}
        </div>
      </div>

      {visao === "lista" && (
        <div data-lista className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          {leads.length === 0 ? (
            <p className="p-6 text-center text-sm text-gray-400">Nenhuma cotação com estes filtros</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-3 py-2">Nº</th>
                  <th className="px-3 py-2">Criada</th>
                  <th className="px-3 py-2">Empresa</th>
                  <th className="px-3 py-2">Rota</th>
                  <th className="px-3 py-2">Carga</th>
                  <th className="px-3 py-2 text-right">Valor</th>
                  <th className="px-3 py-2">Canal</th>
                  <th className="px-3 py-2">Etapa</th>
                  <th className="px-3 py-2">Responsável</th>
                  <th className="px-3 py-2 whitespace-nowrap">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {leads.map((lead) => {
                  const convertido = lead.status === "CONVERTED";
                  return (
                    <tr key={lead.id} data-linha={lead.id} className="align-top">
                      <td className="px-3 py-2 tabular-nums text-xs text-gray-700">{lead.number ?? "—"}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600">{quando(lead.createdAt)}</td>
                      <td className="px-3 py-2 min-w-[11rem]">
                        <p className="font-semibold text-gray-900">{lead.companyName}</p>
                        <p className="text-xs text-gray-500">{lead.phone || lead.email}</p>
                      </td>
                      <td className="px-3 py-2 text-gray-700 min-w-[10rem]">{lead.origin} ➔ {lead.destination}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600">{lead.volumes} vol · {lead.weight} kg</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap font-semibold text-gray-900">{lead.estimatedValue === null ? "—" : formatCurrency(lead.estimatedValue)}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600">{rotuloDoCanal(lead.channel)}</td>
                      <td className="px-3 py-2">
                        {convertido ? (
                          <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_COLORS.CONVERTED}`}>
                            {LEAD_STATUS_LABELS.CONVERTED}
                            {lead.collection?.trackingCode && <span className="font-mono font-normal ml-1">{lead.collection.trackingCode}</span>}
                          </span>
                        ) : (
                          <div className="flex flex-col gap-1">
                            <select aria-label="Status da cotação" value={lead.status} onChange={(e) => updateLeadStatus(lead.id, e.target.value)} className={`text-xs ${INPUT}`}>
                              {LEAD_MANUAL_STATUSES.map((s) => (
                                <option key={s} value={s}>{LEAD_STATUS_LABELS[s]}</option>
                              ))}
                            </select>
                            {lead.status === "LOST" && <SelectMotivo lead={lead} className={`text-xs ${INPUT}`} />}
                            <Parada lead={lead} />
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2">{convertido ? <span className="text-gray-600">{lead.assignee?.name ?? "—"}</span> : <SelectResponsavel lead={lead} className={`text-xs ${INPUT}`} />}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {!convertido && (
                          <div className="flex flex-col gap-1">
                            {isOpen(lead.status) && (
                              <button type="button" onClick={() => alterar(lead.id, { contato: true })} className="text-xs text-blue-600 hover:underline text-left">
                                Registrar contato
                              </button>
                            )}
                            {isConvertible(lead.status) && (
                              <button type="button" onClick={() => abrirConversao(lead)} className="text-xs text-green-700 hover:underline text-left">
                                Converter em coleta
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {visao === "funil" && (
        <>
      <div role="tablist" aria-label="Etapa" className="md:hidden grid grid-cols-4 gap-1 mb-3 p-1 bg-gray-100 rounded-xl">
        {LEAD_STATUSES.map((status) => {
          const ativa = colunaAtiva === status;
          return (
            <button
              key={status}
              type="button"
              role="tab"
              aria-selected={ativa}
              data-aba={status}
              onClick={() => setColunaAtiva(status)}
              className={`px-1 py-1.5 rounded-lg text-xs font-semibold leading-tight ${ativa ? "bg-white text-blue-700 shadow-sm" : "text-gray-600"}`}
            >
              {LEAD_STATUS_LABELS[status]}
              <span className="block text-[11px] font-bold">{leads.filter((l) => l.status === status).length}</span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-4 md:gap-8 md:flex-row md:items-start md:overflow-x-auto pb-4 md:pb-8">
        {LEAD_STATUSES.map((status) => {
          const columnLeads = leads.filter((l) => l.status === status);

          return (
            <div key={status} data-coluna={status} className={`${colunaAtiva === status ? "" : "hidden md:block "}min-w-0 w-full md:min-w-[320px] md:w-80 md:flex-shrink-0 md:bg-gray-50 md:rounded-2xl md:p-4 md:border md:border-gray-200`}>
              <div className="hidden md:flex justify-between items-center mb-4 px-2">
                <h3 className="font-bold text-gray-700">{LEAD_STATUS_LABELS[status]}</h3>
                <span className="bg-gray-200 text-gray-600 text-xs font-bold px-2 py-1 rounded-full">
                  {columnLeads.length}
                </span>
              </div>

              <div className="flex flex-col gap-3 md:gap-4">
                {columnLeads.map((lead) => {
                  const convertido = lead.status === "CONVERTED";
                  const form = conversao?.leadId === lead.id ? conversao : null;

                  return (
                    <div key={lead.id} data-lead={lead.id} className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                      <div className="flex justify-between items-start gap-2 mb-1">
                        <h4 className="min-w-0 font-bold text-gray-900 text-sm truncate" title={lead.companyName}>
                          {lead.companyName}
                        </h4>
                        <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_COLORS[status]}`}>
                          {LEAD_STATUS_LABELS[status]}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-gray-500 mb-2">
                        {lead.number !== null && lead.number !== undefined && <span className="tabular-nums">nº {lead.number}</span>}
                        <span>{rotuloDoCanal(lead.channel)}</span>
                        <span>{quando(lead.createdAt)}</span>
                        <Parada lead={lead} />
                      </div>

                      <div className="text-xs text-gray-500 mb-3">
                        <p>📧 {lead.email || "Não informado"}</p>
                        <p>📞 {lead.phone || "Não informado"}</p>
                        <p className="mt-1">📍 {lead.origin} ➔ {lead.destination}</p>
                        <p>📦 {lead.volumes} vol | ⚖️ {lead.weight} kg</p>
                        {lead.status === "LOST" && lead.lostReason && <p className="mt-1 text-red-700">Perdida: {rotuloDaPerda(lead.lostReason)}</p>}
                      </div>

                      {/* Preço Estimado */}
                      <div className="mb-3 pt-3 border-t border-gray-100">
                        {editingLead?.id === lead.id ? (
                          <div className="flex gap-2">
                            <input
                              type="text"
                              inputMode="decimal"
                              aria-label="Preço estimado"
                              value={estimatedValue}
                              onChange={(e) => setEstimatedValue(e.target.value)}
                              placeholder="R$"
                              className="w-full text-xs px-2 py-1 border rounded"
                            />
                            <button
                              onClick={() => saveEstimatedValue(lead.id)}
                              className="bg-blue-600 text-white px-2 py-1 rounded text-xs"
                            >
                              Salvar
                            </button>
                          </div>
                        ) : (
                          <div className="flex justify-between items-center">
                            <span className="text-xs font-semibold text-gray-700">
                              Preço: {lead.estimatedValue === null ? "Não definido" : formatCurrency(lead.estimatedValue)}
                            </span>
                            {!convertido && (
                              <button
                                onClick={() => {
                                  setEditingLead(lead);
                                  setEstimatedValue(paraCampo(lead.estimatedValue));
                                }}
                                className="text-xs text-blue-600 hover:underline"
                              >
                                Editar
                              </button>
                            )}
                          </div>
                        )}
                      </div>

                      {convertido ? (
                        // Lead convertido está travado: só mostra a coleta que nasceu dele.
                        <div className="text-xs text-gray-600 space-y-1">
                          <p>
                            Rastreio:{" "}
                            {lead.collection?.trackingCode ? (
                              <span className="font-mono font-semibold text-gray-900">{lead.collection.trackingCode}</span>
                            ) : (
                              "sem coleta vinculada"
                            )}
                          </p>
                          {lead.assignee && <p>Responsável: {lead.assignee.name}</p>}
                        </div>
                      ) : (
                        <>
                          {/* Ações de Status */}
                          <div className="flex gap-2 mt-2">
                            <select
                              aria-label="Status da cotação"
                              value={lead.status}
                              onChange={(e) => updateLeadStatus(lead.id, e.target.value)}
                              className="w-full text-xs bg-gray-50 border border-gray-200 rounded p-1 outline-none"
                            >
                              {LEAD_MANUAL_STATUSES.map((s) => (
                                <option key={s} value={s}>{LEAD_STATUS_LABELS[s]}</option>
                              ))}
                            </select>
                          </div>
                          {lead.status === "LOST" && (
                            <div className="mt-2">
                              <SelectMotivo lead={lead} className="w-full text-xs bg-gray-50 border border-gray-200 rounded p-1 outline-none" />
                            </div>
                          )}
                          <div className="mt-2">
                            <SelectResponsavel lead={lead} className="w-full text-xs bg-gray-50 border border-gray-200 rounded p-1 outline-none" />
                          </div>
                          {isOpen(lead.status) && (
                            <button
                              type="button"
                              onClick={() => alterar(lead.id, { contato: true })}
                              className="mt-2 w-full text-xs text-blue-700 border border-blue-200 hover:bg-blue-50 px-2 py-1 rounded"
                              title="Falei com o cliente: renova a atividade e tira a cotação de parada"
                            >
                              Registrar contato
                            </button>
                          )}

                          {isConvertible(lead.status) && !form && (
                            <button
                              onClick={() => abrirConversao(lead)}
                              className="mt-2 w-full bg-green-600 hover:bg-green-700 text-white px-2 py-1.5 rounded text-xs font-semibold"
                            >
                              Converter em coleta
                            </button>
                          )}

                          {form && (
                            <form
                              className="mt-3 pt-3 border-t border-gray-100 flex flex-col gap-2 text-xs"
                              onSubmit={(e) => {
                                e.preventDefault();
                                converter(form);
                              }}
                            >
                              <label className="flex flex-col gap-1 text-gray-600">
                                Cliente
                                <select
                                  name="clientId"
                                  value={form.clientId}
                                  onChange={(e) => setConversao({ ...form, clientId: e.target.value })}
                                  className="bg-gray-50 border border-gray-200 rounded p-1"
                                >
                                  <option value="">{clientes ? "Selecione o cliente" : "Carregando clientes..."}</option>
                                  {(clientes ?? []).map((c) => (
                                    <option key={c.id} value={c.id}>{c.tradeName || c.companyName}</option>
                                  ))}
                                </select>
                              </label>
                              <label className="flex flex-col gap-1 text-gray-600">
                                Remetente
                                <input
                                  name="sender"
                                  value={form.sender}
                                  onChange={(e) => setConversao({ ...form, sender: e.target.value })}
                                  className="px-2 py-1 border rounded"
                                />
                              </label>
                              <label className="flex flex-col gap-1 text-gray-600">
                                Destinatário
                                <input
                                  name="receiver"
                                  value={form.receiver}
                                  onChange={(e) => setConversao({ ...form, receiver: e.target.value })}
                                  className="px-2 py-1 border rounded"
                                />
                              </label>
                              <label className="flex flex-col gap-1 text-gray-600">
                                Valor da nota (R$)
                                <input
                                  name="invoiceValue"
                                  inputMode="decimal"
                                  value={form.invoiceValue}
                                  onChange={(e) => setConversao({ ...form, invoiceValue: e.target.value })}
                                  className="px-2 py-1 border rounded"
                                />
                                <span className="text-gray-400">Vazio: a coleta nasce sem valor de nota.</span>
                              </label>
                              <p data-carga className="text-gray-500">
                                Carga do pedido: {lead.origin} ➔ {lead.destination}, {lead.volumes} vol, {lead.weight} kg
                              </p>
                              <div className="flex gap-2">
                                <button
                                  type="submit"
                                  disabled={enviando}
                                  className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white px-2 py-1.5 rounded font-semibold"
                                >
                                  Confirmar conversão
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConversao(null)}
                                  className="px-2 py-1.5 rounded border border-gray-200 text-gray-600"
                                >
                                  Cancelar
                                </button>
                              </div>
                            </form>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}

                {columnLeads.length === 0 && (
                  <div className="text-center text-gray-400 text-xs py-4 border-2 border-dashed border-gray-200 rounded-xl">
                    Nenhum lead
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
        </>
      )}
    </div>
  );
}
