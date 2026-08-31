"use client";

import { useEffect, useState } from "react";
import { Package, Plus, X, Loader2, AlertCircle } from "lucide-react";
import {
  COLLECTION_STATUS,
  formatCurrency,
  formatDate,
  formatWeight,
  statusBadge,
} from "@/lib/format";
import { readPortal, type PortalCollection } from "../types";

const EMPTY_FORM = {
  sender: "",
  receiver: "",
  origin: "",
  destination: "",
  volumes: "",
  weight: "",
  invoiceValue: "",
};

export default function PortalColetasPage() {
  const [coletas, setColetas] = useState<PortalCollection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [success, setSuccess] = useState("");

  const carregar = () =>
    fetch("/api/portal/coletas")
      .then((r) => readPortal<PortalCollection[]>(r))
      .then(setColetas)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setFormError("");

    try {
      const response = await fetch("/api/portal/coletas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      const body = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(body?.error ?? "Não foi possível enviar a solicitação.");
      }

      setForm(EMPTY_FORM);
      setFormOpen(false);
      setSuccess("Solicitação enviada. A Mello confirma a coleta pelo WhatsApp.");
      await carregar();
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const setField = (field: keyof typeof EMPTY_FORM) => (
    event: React.ChangeEvent<HTMLInputElement>
  ) => setForm((current) => ({ ...current, [field]: event.target.value }));

  if (error) {
    return (
      <div className="max-w-xl bg-white border border-amber-200 rounded-2xl p-6 flex gap-4">
        <AlertCircle className="w-6 h-6 text-amber-600 shrink-0" />
        <div>
          <h1 className="font-outfit font-bold text-lg mb-1">Não foi possível carregar</h1>
          <p className="text-gray-600 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-4 items-center justify-between">
        <div>
          <h1 className="text-2xl font-outfit font-bold text-gray-900">Minhas coletas</h1>
          <p className="text-gray-500">Solicite uma coleta e acompanhe o andamento.</p>
        </div>
        <button
          onClick={() => {
            setFormOpen((open) => !open);
            setSuccess("");
          }}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-orange-500 text-white font-medium hover:bg-orange-600 transition-colors"
        >
          {formOpen ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          {formOpen ? "Cancelar" : "Solicitar coleta"}
        </button>
      </div>

      {success && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-2xl p-4 text-sm">
          {success}
        </div>
      )}

      {formOpen && (
        <form
          onSubmit={handleSubmit}
          className="bg-white border border-gray-200 rounded-2xl p-6 space-y-4"
        >
          <h2 className="font-outfit font-bold text-lg">Nova solicitação de coleta</h2>

          {formError && (
            <p className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm">
              {formError}
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Remetente" value={form.sender} onChange={setField("sender")} required />
            <Field label="Destinatário" value={form.receiver} onChange={setField("receiver")} required />
            <Field label="Cidade de origem" value={form.origin} onChange={setField("origin")} required />
            <Field label="Cidade de destino" value={form.destination} onChange={setField("destination")} required />
            <Field label="Volumes" type="number" min="1" value={form.volumes} onChange={setField("volumes")} required />
            <Field label="Peso (kg)" type="number" min="0.1" step="0.1" value={form.weight} onChange={setField("weight")} required />
            <Field
              label="Valor da mercadoria (opcional)"
              type="number"
              min="0"
              step="0.01"
              value={form.invoiceValue}
              onChange={setField("invoiceValue")}
            />
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-orange-500 text-white font-medium hover:bg-orange-600 transition-colors disabled:opacity-60"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              Enviar solicitação
            </button>
            <p className="text-sm text-gray-500">A confirmação da coleta é sempre humana, pelo WhatsApp.</p>
          </div>
        </form>
      )}

      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        {loading ? (
          <p className="p-6 text-gray-500">Carregando…</p>
        ) : coletas.length === 0 ? (
          <div className="p-10 text-center">
            <Package className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-600">Nenhuma coleta registrada até agora.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500">
                <tr>
                  <Th>Data</Th>
                  <Th>Trajeto</Th>
                  <Th>Destinatário</Th>
                  <Th>Volumes</Th>
                  <Th>Peso</Th>
                  <Th>Valor</Th>
                  <Th>Situação</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {coletas.map((coleta) => {
                  const badge = statusBadge(COLLECTION_STATUS, coleta.status);
                  return (
                    <tr key={coleta.id} className="hover:bg-gray-50/60">
                      <Td>{formatDate(coleta.createdAt)}</Td>
                      <Td className="font-medium text-gray-900">
                        {coleta.origin} → {coleta.destination}
                      </Td>
                      <Td>{coleta.receiver}</Td>
                      <Td>{coleta.volumes}</Td>
                      <Td>{formatWeight(coleta.weight)}</Td>
                      <Td>{formatCurrency(coleta.invoiceValue)}</Td>
                      <Td>
                        <span className={`text-xs px-3 py-1.5 rounded-full border whitespace-nowrap ${badge.className}`}>
                          {badge.label}
                        </span>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  ...props
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-gray-700">{label}</span>
      <input
        {...props}
        className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:ring-2 focus:ring-orange-400 focus:border-transparent outline-none transition-all"
      />
    </label>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="text-left font-medium px-6 py-3 whitespace-nowrap">{children}</th>;
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-6 py-4 text-gray-600 whitespace-nowrap ${className}`}>{children}</td>;
}
