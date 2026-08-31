"use client";

import { useEffect, useState } from "react";
import { Receipt, AlertCircle } from "lucide-react";
import {
  INVOICE_STATUS,
  formatCalendarDate,
  formatCurrency,
  formatDate,
  statusBadge,
} from "@/lib/format";
import { readPortal, type PortalInvoice } from "../types";

export default function PortalFaturasPage() {
  const [faturas, setFaturas] = useState<PortalInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/portal/faturas")
      .then((r) => readPortal<PortalInvoice[]>(r))
      .then(setFaturas)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const total = faturas
    .filter((f) => f.status === "PENDING")
    .reduce((sum, f) => sum + f.amount, 0);

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
      <div>
        <h1 className="text-2xl font-outfit font-bold text-gray-900">Faturas</h1>
        <p className="text-gray-500">
          {loading ? "Carregando…" : `Total em aberto: ${formatCurrency(total)}`}
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        {loading ? (
          <p className="p-6 text-gray-500">Carregando…</p>
        ) : faturas.length === 0 ? (
          <div className="p-10 text-center">
            <Receipt className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-600">Nenhuma fatura emitida até agora.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500">
                <tr>
                  <th className="text-left font-medium px-6 py-3">Descrição</th>
                  <th className="text-left font-medium px-6 py-3 whitespace-nowrap">Emissão</th>
                  <th className="text-left font-medium px-6 py-3 whitespace-nowrap">Vencimento</th>
                  <th className="text-left font-medium px-6 py-3 whitespace-nowrap">Valor</th>
                  <th className="text-left font-medium px-6 py-3">Situação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {faturas.map((fatura) => {
                  const badge = statusBadge(INVOICE_STATUS, fatura.status);
                  return (
                    <tr key={fatura.id} className="hover:bg-gray-50/60">
                      <td className="px-6 py-4 font-medium text-gray-900">{fatura.description}</td>
                      <td className="px-6 py-4 text-gray-600 whitespace-nowrap">
                        {formatDate(fatura.createdAt)}
                      </td>
                      <td className="px-6 py-4 text-gray-600 whitespace-nowrap">
                        {formatCalendarDate(fatura.dueDate)}
                      </td>
                      <td className="px-6 py-4 text-gray-900 whitespace-nowrap">
                        {formatCurrency(fatura.amount)}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`text-xs px-3 py-1.5 rounded-full border whitespace-nowrap ${badge.className}`}>
                          {badge.label}
                        </span>
                      </td>
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
