"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Printer } from "lucide-react";
import { formatCalendarDate, formatCurrency, formatDate, formatDocument, formatWeight } from "@/lib/format";
import { PixCopiaECola } from "@/components/pix/copia-e-cola";

/** A fatura como vai para o cliente: cabeçalho, cargas cobradas e total. Imprime ou salva em PDF. */

type Fatura = {
  number: number;
  status: "OPEN" | "PAID" | "CANCELLED";
  total: number;
  dueDate: string;
  issuedAt: string;
  paidAt: string | null;
  notes: string | null;
  client: { companyName: string; tradeName: string | null; cnpj: string };
  /** O lançamento a receber da fatura; é dele o recibo. */
  transaction: { id: string } | null;
  /** Pix Copia e Cola da fatura em aberto; nulo sem chave cadastrada em Empresa. */
  pix: string | null;
  collections: {
    id: string;
    trackingCode: string | null;
    createdAt: string;
    origin: string;
    destination: string;
    receiver: string;
    volumes: number;
    weight: number;
    freightValue: number | null;
  }[];
};

const SITUACAO = { OPEN: "Em aberto", PAID: "Paga", CANCELLED: "Cancelada" } as const;

export default function FaturaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [fatura, setFatura] = useState<Fatura | null>(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    fetch(`/api/faturas/${id}`)
      .then(async (res) => {
        if (res.status === 404) return setErro("Fatura não encontrada.");
        if (res.status === 401 || res.status === 403) return setErro("O faturamento é restrito ao perfil Administrador.");
        if (!res.ok) throw new Error();
        setFatura((await res.json()) as Fatura);
      })
      .catch(() => setErro("Não foi possível carregar a fatura."));
  }, [id]);

  if (erro) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 p-8">
        <h1 className="font-outfit font-bold text-lg">{erro}</h1>
        <Link href="/dashboard/faturamento" className="text-sm text-blue-600 hover:underline">
          Voltar para o faturamento
        </Link>
      </div>
    );
  }

  if (!fatura) {
    return (
      <div className="flex justify-center py-16" role="status" aria-label="Carregando">
        <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between print:hidden">
        <Link href="/dashboard/faturamento" className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900">
          <ArrowLeft className="w-4 h-4" />
          Faturamento
        </Link>
        <div className="flex items-center gap-5">
          {fatura.status === "PAID" && fatura.transaction && (
            <Link href={`/dashboard/financeiro/recibo/${fatura.transaction.id}`} className="text-sm text-blue-600 hover:underline">
              Recibo
            </Link>
          )}
          <button onClick={() => window.print()} className="inline-flex items-center gap-2 text-sm text-blue-600 hover:underline">
            <Printer className="w-4 h-4" />
            Imprimir ou salvar em PDF
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-8 text-gray-900">
        <div className="flex flex-wrap justify-between gap-6">
          <div>
            <h1 className="text-2xl font-outfit font-bold">Fatura nº {fatura.number}</h1>
            <p className="text-sm text-gray-600 mt-1">
              {SITUACAO[fatura.status]}
              {fatura.paidAt ? ` em ${formatDate(fatura.paidAt)}` : ""}
            </p>
          </div>
          <dl className="text-sm text-right">
            <dt className="text-xs text-gray-500">Emissão</dt>
            <dd>{formatDate(fatura.issuedAt)}</dd>
            <dt className="text-xs text-gray-500 mt-2">Vencimento</dt>
            <dd className="font-medium">{formatCalendarDate(fatura.dueDate)}</dd>
          </dl>
        </div>

        <div className="mt-6 text-sm">
          <p className="text-xs text-gray-500">Cliente</p>
          <p className="font-medium">{fatura.client.companyName}</p>
          {fatura.client.tradeName && <p className="text-gray-600">{fatura.client.tradeName}</p>}
          <p className="text-gray-600">{formatDocument(fatura.client.cnpj)}</p>
        </div>

        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-gray-500 border-b border-gray-200">
              <tr>
                <th className="py-2 pr-4 font-medium">Data</th>
                <th className="py-2 pr-4 font-medium">Rastreio</th>
                <th className="py-2 pr-4 font-medium">Trajeto</th>
                <th className="py-2 pr-4 font-medium">Destinatário</th>
                <th className="py-2 pr-4 font-medium">Volumes / Peso</th>
                <th className="py-2 font-medium text-right">Frete</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {fatura.collections.map((c) => (
                <tr key={c.id}>
                  <td className="py-2 pr-4">{formatDate(c.createdAt)}</td>
                  <td className="py-2 pr-4 font-mono text-xs">{c.trackingCode ?? "-"}</td>
                  <td className="py-2 pr-4">
                    {c.origin} → {c.destination}
                  </td>
                  <td className="py-2 pr-4">{c.receiver}</td>
                  <td className="py-2 pr-4">
                    {c.volumes} · {formatWeight(c.weight)}
                  </td>
                  <td className="py-2 text-right">{formatCurrency(c.freightValue)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-gray-300">
                <td colSpan={5} className="py-3 text-right font-medium">
                  Total
                </td>
                <td className="py-3 text-right text-lg font-bold">{formatCurrency(fatura.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {fatura.pix && <PixCopiaECola codigo={fatura.pix} className="mt-4 max-w-xl" />}
        {fatura.status === "OPEN" && !fatura.pix && (
          <p data-sem-pix className="mt-4 text-xs text-gray-500 print:hidden">
            Para a fatura sair com o Pix Copia e Cola, cadastre a chave Pix em Empresa &gt; Cobrança.
          </p>
        )}

        {fatura.status === "CANCELLED" && (
          <p className="mt-4 text-sm text-gray-600">
            Fatura cancelada: as cargas voltaram a ficar disponíveis e não aparecem mais aqui.
          </p>
        )}
        {fatura.notes && <p className="mt-4 text-sm text-gray-600 whitespace-pre-wrap">{fatura.notes}</p>}
      </div>
    </div>
  );
}
