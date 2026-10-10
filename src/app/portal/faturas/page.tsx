"use client";

import { Fragment, useEffect, useState } from "react";
import { Receipt, AlertCircle } from "lucide-react";
import { PixCopiaECola } from "@/components/pix/copia-e-cola";
import { Boleto, PixDinamico } from "@/components/pix/cobranca-do-gateway";
import {
  INVOICE_STATUS,
  formatCalendarDate,
  formatCurrency,
  formatDate,
  statusBadge,
} from "@/lib/format";
import { readPortal, type PortalInvoice } from "../types";

const ROTULO_DA_CELULA =
  "before:content-[attr(data-rotulo)] before:block before:text-[11px] before:text-gray-500 md:before:content-none";

export default function PortalFaturasPage() {
  const [faturas, setFaturas] = useState<PortalInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // O título com o Pix Copia e Cola aberto.
  const [pixAberto, setPixAberto] = useState<string | null>(null);
  // O título com o boleto aberto.
  const [boletoAberto, setBoletoAberto] = useState<string | null>(null);

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
    <div className="space-y-3 md:space-y-6">
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
          <table className="block md:table w-full text-sm">
            <thead className="hidden md:table-header-group bg-gray-50 text-gray-500 text-left">
              <tr>
                <th className="font-medium px-6 py-3">Descrição</th>
                <th className="font-medium px-6 py-3 whitespace-nowrap">Emissão</th>
                <th className="font-medium px-6 py-3 whitespace-nowrap">Vencimento</th>
                <th className="font-medium px-6 py-3 whitespace-nowrap">Valor</th>
                <th className="font-medium px-6 py-3">Situação</th>
              </tr>
            </thead>
            <tbody className="block md:table-row-group divide-y divide-gray-100">
              {faturas.map((fatura) => {
                const badge = statusBadge(INVOICE_STATUS, fatura.status);
                const aberto = pixAberto === fatura.id;
                // O Pix dinâmico do Mercado Pago, quando há, entra no lugar do estático.
                const pixDinamico = fatura.cobranca?.pix ?? null;
                const boleto = fatura.cobranca?.boleto ?? null;
                const boletoVisivel = boletoAberto === fatura.id;
                return (
                  <Fragment key={fatura.id}>
                    <tr data-fatura={fatura.id} className="grid grid-cols-3 gap-x-3 gap-y-1 px-3 py-2.5 md:table-row hover:bg-gray-50/60">
                      <td className="col-span-3 min-w-0 md:table-cell md:px-6 md:py-4 font-medium text-gray-900">{fatura.description}</td>
                      <td data-rotulo="Emissão" className={`min-w-0 md:table-cell md:px-6 md:py-4 text-gray-600 ${ROTULO_DA_CELULA}`}>{formatDate(fatura.createdAt)}</td>
                      <td data-rotulo="Vencimento" className={`min-w-0 md:table-cell md:px-6 md:py-4 text-gray-600 ${ROTULO_DA_CELULA}`}>{formatCalendarDate(fatura.dueDate)}</td>
                      <td data-rotulo="Valor" className={`min-w-0 md:table-cell md:px-6 md:py-4 text-gray-900 ${ROTULO_DA_CELULA}`}>{formatCurrency(fatura.amount)}</td>
                      <td className="col-span-3 min-w-0 md:table-cell md:px-6 md:py-4">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className={`text-xs px-3 py-1 rounded-full border whitespace-nowrap ${badge.className}`}>{badge.label}</span>
                          {(pixDinamico || fatura.pix) && (
                            <button
                              type="button"
                              aria-expanded={aberto}
                              onClick={() => setPixAberto(aberto ? null : fatura.id)}
                              className="text-sm font-medium text-emerald-700 hover:underline"
                            >
                              {aberto ? "Fechar Pix" : "Pagar com Pix"}
                            </button>
                          )}
                          {boleto && (
                            <button type="button" aria-expanded={boletoVisivel} onClick={() => setBoletoAberto(boletoVisivel ? null : fatura.id)} className="text-sm font-medium text-blue-700 hover:underline">
                              {boletoVisivel ? "Fechar boleto" : "Pagar com boleto"}
                            </button>
                          )}
                        </span>
                      </td>
                    </tr>
                    {aberto && (pixDinamico || fatura.pix) && (
                      <tr data-pix-de={fatura.id} className="block md:table-row">
                        <td colSpan={5} className="block md:table-cell px-3 pb-3 md:px-6 md:pb-4">
                          {pixDinamico ? <PixDinamico pix={pixDinamico} /> : fatura.pix && <PixCopiaECola codigo={fatura.pix} />}
                        </td>
                      </tr>
                    )}
                    {boletoVisivel && boleto && (
                      <tr data-boleto-de={fatura.id} className="block md:table-row">
                        <td colSpan={5} className="block md:table-cell px-3 pb-3 md:px-6 md:pb-4">
                          <Boleto boleto={boleto} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
