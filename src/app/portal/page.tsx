"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Package, Truck, Receipt, ArrowRight, AlertCircle } from "lucide-react";
import {
  COLLECTION_STATUS,
  formatCurrency,
  formatDate,
  statusBadge,
} from "@/lib/format";
import { readPortal, type PortalCollection, type PortalInvoice } from "./types";

export default function PortalHomePage() {
  const [coletas, setColetas] = useState<PortalCollection[]>([]);
  const [faturas, setFaturas] = useState<PortalInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      fetch("/api/portal/coletas").then((r) => readPortal<PortalCollection[]>(r)),
      fetch("/api/portal/faturas").then((r) => readPortal<PortalInvoice[]>(r)),
    ])
      .then(([c, f]) => {
        setColetas(c);
        setFaturas(f);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const emAndamento = coletas.filter((c) => c.status !== "DELIVERED").length;
  const entregues = coletas.filter((c) => c.status === "DELIVERED").length;
  const emAberto = faturas
    .filter((f) => f.status === "PENDING")
    .reduce((total, f) => total + f.amount, 0);

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

  const cards = [
    { label: "Coletas em andamento", value: emAndamento, icon: Truck },
    { label: "Entregas concluídas", value: entregues, icon: Package },
    { label: "Faturas em aberto", value: formatCurrency(emAberto), icon: Receipt },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-outfit font-bold text-gray-900">Visão geral</h1>
        <p className="text-gray-500">Acompanhe suas coletas e faturas com a Mello.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <div key={card.label} className="bg-white rounded-2xl border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-gray-500">{card.label}</span>
              <card.icon className="w-5 h-5 text-orange-500" />
            </div>
            <p className="text-3xl font-outfit font-bold text-gray-900">
              {loading ? "-" : card.value}
            </p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <h2 className="font-outfit font-bold text-lg">Últimas coletas</h2>
          <Link
            href="/portal/coletas"
            className="text-sm text-orange-600 hover:text-orange-700 flex items-center gap-1"
          >
            Ver todas <ArrowRight className="w-4 h-4" />
          </Link>
        </div>

        {loading ? (
          <p className="p-6 text-gray-500">Carregando…</p>
        ) : coletas.length === 0 ? (
          <div className="p-10 text-center">
            <Package className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-600 mb-4">Você ainda não tem coletas registradas.</p>
            <Link
              href="/portal/coletas"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-orange-500 text-white font-medium hover:bg-orange-600 transition-colors"
            >
              Solicitar coleta
            </Link>
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {coletas.slice(0, 5).map((coleta) => {
              const badge = statusBadge(COLLECTION_STATUS, coleta.status);
              return (
                <li key={coleta.id} className="p-6 flex flex-wrap gap-4 items-center justify-between">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900 truncate">
                      {coleta.origin} → {coleta.destination}
                    </p>
                    <p className="text-sm text-gray-500 truncate">
                      {coleta.receiver} · {formatDate(coleta.createdAt)}
                    </p>
                  </div>
                  <span className={`text-xs px-3 py-1.5 rounded-full border ${badge.className}`}>
                    {badge.label}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
