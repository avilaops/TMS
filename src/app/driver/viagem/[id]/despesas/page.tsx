"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { formatCalendarDate, formatCurrency } from "@/lib/format";
import { diaNoBrasil } from "@/lib/financeiro";
import { EXPENSE_STATUS, EXPENSE_TYPES, EXPENSE_TYPE_LABEL, rotuloDaDespesa } from "@/lib/viagem";

/**
 * Despesas da viagem lançadas pelo motorista: pedágio, combustível, alimentação...
 * Ele vê as que ele mesmo lançou e o total delas; quem aprova é o administrador,
 * no painel. Precisa de sinal: diferente da baixa de entrega, não fica na fila offline.
 */

type Despesa = {
  id: string;
  type: string;
  amount: number;
  date: string;
  notes: string | null;
  status: string;
};

type Lista = { despesas: Despesa[]; total: number };

const FALHA_AO_LER = "Não foi possível carregar as despesas. Confira o sinal e tente de novo.";
const FALHA_AO_LANCAR = "Não foi possível lançar a despesa. Confira o sinal e tente de novo.";
const CAMPO = "block w-full min-w-0 px-3 py-2 rounded-xl border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-blue-500";
const EM_BRANCO = { type: "TOLL", amount: "", notes: "", liters: "", odometer: "" };

export default function DespesasDoMotorista({ params }: { params: Promise<{ id: string }> }) {
  const manifestId = use(params).id;
  const voltar = `/driver/viagem/${manifestId}`;
  const base = `/api/driver/manifestos/${manifestId}/despesas`;

  const [lista, setLista] = useState<Lista | null>(null);
  const [form, setForm] = useState(EM_BRANCO);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => {
    let ativo = true;
    fetch(base)
      .then(async (res) => {
        if (!ativo) return;
        if (res.ok) return setLista(await res.json());
        const corpo = (await res.json().catch(() => ({}))) as { error?: string };
        setErro(corpo.error ?? FALHA_AO_LER);
      })
      .catch(() => {
        if (ativo) setErro(FALHA_AO_LER);
      });
    return () => {
      ativo = false;
    };
  }, [base]);

  const mudar = (campo: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((atual) => ({ ...atual, [campo]: e.target.value }));

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setOcupado(true);
    setErro("");
    try {
      const res = await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // A despesa é de hoje: o motorista lança na hora, com o comprovante na mão.
        body: JSON.stringify({ ...form, date: diaNoBrasil(new Date()) }),
      });
      if (!res.ok) {
        const corpo = (await res.json().catch(() => ({}))) as { error?: string };
        return setErro(corpo.error ?? FALHA_AO_LANCAR);
      }
      setForm((atual) => ({ ...EM_BRANCO, type: atual.type }));
      const relida = await fetch(base);
      if (relida.ok) setLista(await relida.json());
    } catch {
      setErro(FALHA_AO_LANCAR);
    } finally {
      setOcupado(false);
    }
  };

  return (
    <div className="space-y-4 pb-6">
      <div className="flex items-center text-white relative z-10">
        <Link href={voltar} aria-label="Voltar para a viagem" className="p-2 -ml-2 mr-2">
          <ArrowLeft className="w-6 h-6" />
        </Link>
        <h1 className="text-xl font-bold font-outfit">Despesas da viagem</h1>
      </div>

      <form onSubmit={enviar} className="bg-white rounded-3xl p-4 shadow-lg shadow-blue-900/5 relative z-10 space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <label className="block min-w-0 space-y-1">
            <span className="text-xs font-medium text-gray-700">Tipo</span>
            <select name="type" value={form.type} onChange={mudar("type")} className={CAMPO}>
              {EXPENSE_TYPES.map((tipo) => (
                <option key={tipo} value={tipo}>
                  {EXPENSE_TYPE_LABEL[tipo]}
                </option>
              ))}
            </select>
          </label>
          <label className="block min-w-0 space-y-1">
            <span className="text-xs font-medium text-gray-700">Valor (R$)</span>
            <input name="amount" inputMode="decimal" required value={form.amount} onChange={mudar("amount")} className={CAMPO} />
          </label>
          {form.type === "FUEL" && (
            <>
              <label className="block min-w-0 space-y-1">
                <span className="text-xs font-medium text-gray-700">Litros</span>
                <input name="liters" inputMode="decimal" value={form.liters} onChange={mudar("liters")} className={CAMPO} />
              </label>
              <label className="block min-w-0 space-y-1">
                <span className="text-xs font-medium text-gray-700">Hodômetro (km)</span>
                <input name="odometer" inputMode="numeric" value={form.odometer} onChange={mudar("odometer")} className={CAMPO} />
              </label>
            </>
          )}
          <label className="col-span-2 block min-w-0 space-y-1">
            <span className="text-xs font-medium text-gray-700">{form.type === "FUEL" ? "Posto" : "Observação"}</span>
            <input name="notes" value={form.notes} onChange={mudar("notes")} maxLength={500} className={CAMPO} />
          </label>
        </div>

        {erro && (
          <p role="alert" className="text-sm text-red-600">
            {erro}
          </p>
        )}

        <button
          type="submit"
          disabled={ocupado}
          className="w-full bg-gray-900 hover:bg-gray-800 disabled:opacity-60 text-white font-medium py-3 rounded-2xl flex items-center justify-center"
        >
          {ocupado && <Loader2 className="w-5 h-5 mr-2 animate-spin" />}
          Lançar despesa
        </button>
      </form>

      <div className="bg-white rounded-3xl p-4 shadow-sm border border-gray-100 space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-gray-900">Lançadas por você</h2>
          <span className="text-sm font-bold text-blue-600" data-total-do-motorista>
            {formatCurrency(lista?.total ?? 0)}
          </span>
        </div>

        {!lista ? (
          !erro && (
            <div className="flex justify-center py-4" role="status" aria-label="Carregando">
              <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
            </div>
          )
        ) : lista.despesas.length === 0 ? (
          <p className="text-sm text-gray-500">Nenhuma despesa lançada nesta viagem.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {lista.despesas.map((despesa) => {
              const selo = EXPENSE_STATUS[despesa.status] ?? { label: despesa.status, className: "" };
              return (
                <li key={despesa.id} data-despesa={despesa.id} className="flex items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{rotuloDaDespesa(despesa.type)}</p>
                    <p className="text-xs text-gray-500 truncate">
                      {formatCalendarDate(despesa.date)}
                      {despesa.notes ? ` · ${despesa.notes}` : ""}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-semibold text-gray-900">{formatCurrency(despesa.amount)}</p>
                    <span className={`inline-block px-2 py-0.5 text-[11px] font-medium rounded-full border ${selo.className}`}>{selo.label}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
