"use client";

import { use, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Loader2 } from "lucide-react";
import { CHECKLIST_ITENS, CHECKLIST_TUDO_OK, type ChaveDoChecklist, type ItensDoChecklist } from "@/lib/frota";

/**
 * Checklist do veículo, feito pelo motorista antes de sair (ou na volta). O
 * veículo é o da viagem: a rota confere que ela é deste motorista e está em rota.
 * Precisa de sinal: diferente da baixa de entrega, não fica na fila offline.
 */

const FALHA = "Não foi possível registrar o checklist. Confira o sinal e tente de novo.";

export default function ChecklistDoMotorista({ params }: { params: Promise<{ id: string }> }) {
  const manifestId = use(params).id;
  const voltar = `/driver/viagem/${manifestId}`;

  const [itens, setItens] = useState<ItensDoChecklist>(CHECKLIST_TUDO_OK);
  const [odometer, setOdometer] = useState("");
  const [notes, setNotes] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  const [feito, setFeito] = useState(false);

  const alternar = (chave: ChaveDoChecklist) => setItens((atual) => ({ ...atual, [chave]: !atual[chave] }));

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setOcupado(true);
    setErro("");
    try {
      const res = await fetch("/api/driver/checklists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manifestId, items: itens, odometer, notes }),
      });
      if (res.ok) return setFeito(true);
      const corpo = (await res.json().catch(() => ({}))) as { error?: string };
      setErro(corpo.error ?? FALHA);
    } catch {
      setErro(FALHA);
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
        <h1 className="text-xl font-bold font-outfit">Checklist do veículo</h1>
      </div>

      {feito ? (
        <div role="status" className="bg-white rounded-3xl p-6 shadow-lg shadow-blue-900/5 relative z-10 text-center space-y-4">
          <CheckCircle2 className="w-12 h-12 text-green-600 mx-auto" />
          <p className="font-bold text-gray-900">Checklist registrado</p>
          <Link href={voltar} className="block w-full bg-gray-900 text-white font-medium py-3 rounded-2xl">
            Voltar para a viagem
          </Link>
        </div>
      ) : (
        <form onSubmit={enviar} className="bg-white rounded-3xl p-4 shadow-lg shadow-blue-900/5 relative z-10 space-y-3">
          <p className="text-xs text-gray-500">Toque no item que estiver com problema.</p>
          <div className="grid grid-cols-2 gap-2">
            {CHECKLIST_ITENS.map((item) => {
              const ok = itens[item.chave];
              return (
                <button
                  key={item.chave}
                  type="button"
                  data-item={item.chave}
                  aria-pressed={!ok}
                  onClick={() => alternar(item.chave)}
                  className={`flex items-center justify-between gap-2 min-w-0 px-3 py-2.5 rounded-2xl border text-sm ${
                    ok ? "border-green-200 bg-green-50 text-green-800" : "border-red-300 bg-red-50 text-red-700"
                  }`}
                >
                  <span className="truncate font-medium">{item.rotulo}</span>
                  <span className="shrink-0 text-xs">{ok ? "OK" : "Problema"}</span>
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="block min-w-0 space-y-1">
              <span className="text-xs font-medium text-gray-700">Hodômetro (km)</span>
              <input
                name="odometer"
                inputMode="numeric"
                value={odometer}
                onChange={(e) => setOdometer(e.target.value)}
                className="block w-full min-w-0 px-3 py-2 rounded-xl border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-blue-500"
              />
            </label>
            <label className="block min-w-0 space-y-1">
              <span className="text-xs font-medium text-gray-700">Observação</span>
              <input
                name="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="block w-full min-w-0 px-3 py-2 rounded-xl border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-blue-500"
              />
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
            className="w-full bg-gray-900 hover:bg-gray-800 disabled:opacity-60 text-white font-medium py-3 rounded-2xl flex items-center justify-center gap-2"
          >
            {ocupado && <Loader2 className="w-5 h-5 animate-spin" />}
            Registrar checklist
          </button>
        </form>
      )}
    </div>
  );
}
