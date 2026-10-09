"use client";

import { useEffect, useState } from "react";
import {
  LEAD_MANUAL_STATUSES,
  LEAD_STATUSES,
  LEAD_STATUS_LABELS,
  divergenciaDeFrete,
  isConvertible,
  type LeadStatus,
} from "@/lib/crm";
import { formatCurrency } from "@/lib/format";

type QuoteLead = {
  id: string;
  companyName: string;
  email: string;
  phone: string;
  origin: string;
  destination: string;
  volumes: number;
  weight: number;
  estimatedValue: number | null;
  invoiceValue: number | null;
  status: string;
  createdAt: string;
  collection: { id: string; trackingCode: string | null; status: string } | null;
};

type Cliente = { id: string; companyName: string; tradeName: string | null; active: boolean };

type Conversao = { leadId: string; clientId: string; sender: string; receiver: string; invoiceValue: string };

const STATUS_COLORS: Record<LeadStatus, string> = {
  NEW: "bg-blue-100 text-blue-800",
  CONTACTED: "bg-yellow-100 text-yellow-800",
  CONVERTED: "bg-green-100 text-green-800",
  LOST: "bg-red-100 text-red-800",
};

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

async function buscarLeads(): Promise<Resposta<QuoteLead[]>> {
  const res = await chamar<QuoteLead[]>("/api/dashboard/crm");
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

export default function CRMPage() {
  const [leads, setLeads] = useState<QuoteLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [editingLead, setEditingLead] = useState<QuoteLead | null>(null);
  const [estimatedValue, setEstimatedValue] = useState("");
  const [clientes, setClientes] = useState<Cliente[] | null>(null);
  const [conversao, setConversao] = useState<Conversao | null>(null);
  const [enviando, setEnviando] = useState(false);
  // Confirmação da última conversão, quando o frete da coleta não é o valor estimado do lead.
  const [confirmacao, setConfirmacao] = useState<string | null>(null);

  function receber(res: Resposta<QuoteLead[]>) {
    if (res.ok) setLeads(res.dados);
    setErro(res.ok ? null : res.erro);
    setLoading(false);
  }

  useEffect(() => {
    let ativo = true;
    buscarLeads().then((res) => {
      if (ativo) receber(res);
    });
    return () => {
      ativo = false;
    };
  }, []);

  async function fetchLeads() {
    receber(await buscarLeads());
  }

  // Troca na lista o lead que a rota devolveu, sem buscar tudo de novo.
  function trocar(lead: QuoteLead) {
    setErro(null);
    setLeads((atuais) => atuais.map((l) => (l.id === lead.id ? lead : l)));
  }

  async function updateLeadStatus(id: string, newStatus: string) {
    const res = await chamar<QuoteLead>(`/api/dashboard/crm/${id}`, json("PATCH", { status: newStatus }));
    if (!res.ok) return setErro(res.erro);
    trocar(res.dados);
  }

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

  if (loading) {
    return <div className="p-8">Carregando CRM...</div>;
  }

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="mb-8 flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-black text-gray-900">CRM & Cotações</h1>
          <p className="text-gray-500 mt-1">Gerencie leads e solicitações de frete</p>
        </div>
        <button
          onClick={fetchLeads}
          className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-medium transition"
        >
          Atualizar Lista
        </button>
      </div>

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

      <div className="flex flex-col gap-8 md:flex-row md:items-start overflow-x-auto pb-8">
        {LEAD_STATUSES.map((status) => {
          const columnLeads = leads.filter((l) => l.status === status);

          return (
            <div key={status} data-coluna={status} className="min-w-[320px] w-full md:w-80 flex-shrink-0 bg-gray-50 rounded-2xl p-4 border border-gray-200">
              <div className="flex justify-between items-center mb-4 px-2">
                <h3 className="font-bold text-gray-700">{LEAD_STATUS_LABELS[status]}</h3>
                <span className="bg-gray-200 text-gray-600 text-xs font-bold px-2 py-1 rounded-full">
                  {columnLeads.length}
                </span>
              </div>

              <div className="flex flex-col gap-4">
                {columnLeads.map((lead) => {
                  const convertido = lead.status === "CONVERTED";
                  const form = conversao?.leadId === lead.id ? conversao : null;

                  return (
                    <div key={lead.id} data-lead={lead.id} className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                      <div className="flex justify-between items-start mb-2">
                        <h4 className="font-bold text-gray-900 text-sm truncate" title={lead.companyName}>
                          {lead.companyName}
                        </h4>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_COLORS[status]}`}>
                          {LEAD_STATUS_LABELS[status]}
                        </span>
                      </div>

                      <div className="text-xs text-gray-500 mb-3">
                        <p>📧 {lead.email}</p>
                        <p>📞 {lead.phone || "Não informado"}</p>
                        <p className="mt-1">📍 {lead.origin} ➔ {lead.destination}</p>
                        <p>📦 {lead.volumes} vol | ⚖️ {lead.weight} kg</p>
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
                        <p className="text-xs text-gray-600">
                          Rastreio:{" "}
                          {lead.collection?.trackingCode ? (
                            <span className="font-mono font-semibold text-gray-900">{lead.collection.trackingCode}</span>
                          ) : (
                            "sem coleta vinculada"
                          )}
                        </p>
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
    </div>
  );
}
