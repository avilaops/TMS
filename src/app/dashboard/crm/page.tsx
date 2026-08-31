"use client";

import { useEffect, useState } from "react";

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
  status: string;
  createdAt: string;
};

const STATUSES = [
  { id: "NEW", label: "Novos", color: "bg-blue-100 text-blue-800" },
  { id: "CONTACTED", label: "Em Contato", color: "bg-yellow-100 text-yellow-800" },
  { id: "CONVERTED", label: "Convertidos", color: "bg-green-100 text-green-800" },
  { id: "LOST", label: "Perdidos", color: "bg-red-100 text-red-800" },
];

export default function CRMPage() {
  const [leads, setLeads] = useState<QuoteLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingLead, setEditingLead] = useState<QuoteLead | null>(null);
  const [estimatedValue, setEstimatedValue] = useState("");

  useEffect(() => {
    fetchLeads();
  }, []);

  async function fetchLeads() {
    try {
      const res = await fetch("/api/dashboard/crm");
      const data = await res.json();
      setLeads(data);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }

  async function updateLeadStatus(id: string, newStatus: string) {
    try {
      await fetch(`/api/dashboard/crm/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      fetchLeads();
    } catch (error) {
      console.error(error);
    }
  }

  async function saveEstimatedValue(id: string) {
    try {
      await fetch(`/api/dashboard/crm/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estimatedValue: Number(estimatedValue) }),
      });
      setEditingLead(null);
      fetchLeads();
    } catch (error) {
      console.error(error);
    }
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

      <div className="flex flex-col gap-8 md:flex-row md:items-start overflow-x-auto pb-8">
        {STATUSES.map((column) => {
          const columnLeads = leads.filter((l) => l.status === column.id);
          
          return (
            <div key={column.id} className="min-w-[320px] w-full md:w-80 flex-shrink-0 bg-gray-50 rounded-2xl p-4 border border-gray-200">
              <div className="flex justify-between items-center mb-4 px-2">
                <h3 className="font-bold text-gray-700">{column.label}</h3>
                <span className="bg-gray-200 text-gray-600 text-xs font-bold px-2 py-1 rounded-full">
                  {columnLeads.length}
                </span>
              </div>

              <div className="flex flex-col gap-4">
                {columnLeads.map((lead) => (
                  <div key={lead.id} className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                    <div className="flex justify-between items-start mb-2">
                      <h4 className="font-bold text-gray-900 text-sm truncate" title={lead.companyName}>
                        {lead.companyName}
                      </h4>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${column.color}`}>
                        {column.id}
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
                            type="number"
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
                            Preço: {lead.estimatedValue ? `R$ ${lead.estimatedValue.toFixed(2)}` : "Não definido"}
                          </span>
                          <button
                            onClick={() => {
                              setEditingLead(lead);
                              setEstimatedValue(lead.estimatedValue?.toString() || "");
                            }}
                            className="text-xs text-blue-600 hover:underline"
                          >
                            Editar
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Ações de Status */}
                    <div className="flex gap-2 mt-2">
                      <select
                        value={lead.status}
                        onChange={(e) => updateLeadStatus(lead.id, e.target.value)}
                        className="w-full text-xs bg-gray-50 border border-gray-200 rounded p-1 outline-none"
                      >
                        {STATUSES.map((s) => (
                          <option key={s.id} value={s.id}>{s.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                ))}

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
