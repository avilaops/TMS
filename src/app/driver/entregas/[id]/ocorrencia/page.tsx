"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, Loader2 } from "lucide-react";
import { OCCURRENCE_TYPES, TIPO_DA_OCORRENCIA, type OccurrenceType } from "@/lib/ocorrencias";

/**
 * Ocorrência numa entrega, registrada pelo motorista: o que houve (avaria,
 * atraso, reentrega…) e uma descrição. Vira um chamado interno para a equipe,
 * ligado à carga. Precisa de sinal: diferente da baixa de entrega, não fica na
 * fila offline.
 */

const FALHA = "Não foi possível registrar a ocorrência. Confira o sinal e tente de novo.";

export default function OcorrenciaDoMotorista({ params }: { params: Promise<{ id: string }> }) {
  const collectionId = use(params).id;
  const router = useRouter();

  const [tipo, setTipo] = useState<OccurrenceType | "">("");
  const [descricao, setDescricao] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  const [numero, setNumero] = useState<number | null>(null);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setOcupado(true);
    setErro("");
    try {
      const res = await fetch(`/api/driver/entregas/${collectionId}/ocorrencia`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: tipo, description: descricao }),
      });
      const corpo = (await res.json().catch(() => ({}))) as { error?: string; number?: number };
      if (res.ok) return setNumero(corpo.number ?? 0);
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
        <button type="button" onClick={() => router.back()} aria-label="Voltar para a viagem" className="p-2 -ml-2 mr-2">
          <ArrowLeft className="w-6 h-6" />
        </button>
        <h1 className="text-xl font-bold font-outfit">Registrar ocorrência</h1>
      </div>

      {numero !== null ? (
        <div role="status" className="bg-white rounded-3xl p-6 shadow-lg shadow-blue-900/5 relative z-10 text-center space-y-4">
          <CheckCircle2 className="w-12 h-12 text-green-600 mx-auto" />
          <p className="font-bold text-gray-900">Ocorrência registrada{numero ? ` (chamado nº ${numero})` : ""}</p>
          <p className="text-sm text-gray-500">A equipe já foi avisada.</p>
          <button type="button" onClick={() => router.back()} className="block w-full bg-gray-900 text-white font-medium py-3 rounded-2xl">
            Voltar para a viagem
          </button>
        </div>
      ) : (
        <form onSubmit={enviar} className="bg-white rounded-3xl p-4 shadow-lg shadow-blue-900/5 relative z-10 space-y-3">
          <p className="text-xs text-gray-500">O que aconteceu nesta entrega?</p>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Tipo da ocorrência">
            {OCCURRENCE_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={tipo === t}
                data-tipo={t}
                onClick={() => setTipo(t)}
                className={`min-w-0 px-2 py-2.5 rounded-2xl border text-sm font-medium ${
                  tipo === t ? "border-blue-600 bg-blue-50 text-blue-700" : "border-gray-200 bg-white text-gray-700"
                }`}
              >
                {TIPO_DA_OCORRENCIA[t]}
              </button>
            ))}
          </div>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-gray-700">Descrição</span>
            <textarea
              required
              rows={4}
              maxLength={4000}
              placeholder="Ex.: caixa chegou amassada, cliente recusou receber"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              className="block w-full min-w-0 px-3 py-2 rounded-xl border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>
          {erro && (
            <p role="alert" className="text-sm text-red-600">
              {erro}
            </p>
          )}
          <button
            type="submit"
            disabled={ocupado || !tipo || !descricao.trim()}
            className="w-full bg-gray-900 text-white font-medium py-3 rounded-2xl flex items-center justify-center disabled:opacity-60"
          >
            {ocupado && <Loader2 className="w-5 h-5 mr-2 animate-spin" />}
            Registrar ocorrência
          </button>
        </form>
      )}
    </div>
  );
}
