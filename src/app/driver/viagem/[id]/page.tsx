"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, MapPin, CheckCircle2, Package, ShieldCheck, Loader2, PenTool, ClipboardCheck, AlertTriangle, Navigation, Receipt } from "lucide-react";
import Link from "next/link";
import { linkDaRota } from "@/lib/viagem";
import { janelaDaColeta } from "@/lib/coletas";

interface Parada {
  id: string;
  receiver: string;
  destination: string;
  volumes: number;
  weight: number;
  status: string;
  receiverName: string | null;
  // O que o cliente pediu: janela de horário, urgência, cubagem e observação.
  pickupDate: string | null;
  pickupFrom: string | null;
  pickupTo: string | null;
  priority: string;
  cubicMeters: number | null;
  pickupNotes: string | null;
  client: { tradeName: string | null; companyName: string } | null;
}

interface Viagem {
  id: string;
  collections: Parada[];
}

export default function ViagemDetalhes() {
  const params = useParams();
  const router = useRouter();
  const [manifesto, setManifesto] = useState<Viagem | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch('/api/driver/manifestos');
        if (res.ok && active) {
          const all: Viagem[] = await res.json();
          setManifesto(all.find((m) => m.id === params.id) ?? null);
        }
      } catch (error) {
        console.error("Failed to fetch manifesto", error);
      } finally {
        if (active) setIsLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [params.id]);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 mt-10">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600 mb-4" />
        <p className="text-gray-500 font-medium">Carregando viagem...</p>
      </div>
    );
  }

  if (!manifesto) {
    return (
      <div className="text-center mt-20">
        <p className="text-gray-500">Viagem não encontrada.</p>
        <button onClick={() => router.push('/driver')} className="text-blue-600 font-medium mt-4">
          Voltar
        </button>
      </div>
    );
  }

  const total = manifesto.collections.length;
  const pendentes = manifesto.collections.filter((c) => c.status !== 'DELIVERED').length;
  const concluidas = total - pendentes;
  const progress = total === 0 ? 0 : (concluidas / total) * 100;
  const rota = linkDaRota(manifesto.collections.filter((c) => c.status !== 'DELIVERED').map((c) => c.destination));

  return (
    <div className="space-y-6 pb-6">
      <div className="flex items-center text-white mb-2 relative z-10">
        <Link href="/driver" className="p-2 -ml-2 mr-2">
          <ArrowLeft className="w-6 h-6" />
        </Link>
        <h1 className="text-xl font-bold font-outfit">Viagem #{manifesto.id.substring(0,6).toUpperCase()}</h1>
      </div>

      <div className="bg-white rounded-3xl p-6 shadow-lg shadow-blue-900/5 relative z-10 -mt-2">
        <div className="flex justify-between items-center mb-4">
          <span className="text-sm font-medium text-gray-500">Progresso</span>
          <span className="text-sm font-bold text-blue-600">{concluidas} / {total}</span>
        </div>

        <div className="w-full bg-gray-100 rounded-full h-3 mb-2 overflow-hidden">
          <div
            className="bg-blue-600 h-3 rounded-full transition-all duration-1000 ease-out"
            style={{ width: `${progress}%` }}
          ></div>
        </div>

        <div className="flex justify-between text-xs font-medium text-gray-400">
          <span>{pendentes} Restantes</span>
          <span>{Math.round(progress)}% Concluído</span>
        </div>
      </div>

      {/* O checklist é do veículo desta viagem; a rota confere que ela é deste motorista. */}
      <Link
        href={`/driver/viagem/${manifesto.id}/checklist`}
        className="flex items-center justify-center w-full bg-white text-gray-900 font-medium py-3 rounded-2xl border border-gray-200 shadow-sm"
      >
        <ClipboardCheck className="w-5 h-5 mr-2 text-blue-600" /> Checklist do veículo
      </Link>

      <div className="grid grid-cols-2 gap-3">
        {/* As paradas que faltam, na ordem da viagem; o mapa parte de onde o aparelho está. */}
        {rota.url ? (
          <a
            href={rota.url}
            target="_blank"
            rel="noopener noreferrer"
            data-rota-no-mapa
            className="flex items-center justify-center min-w-0 bg-white text-gray-900 text-sm font-medium py-3 rounded-2xl border border-gray-200 shadow-sm"
          >
            <Navigation className="w-5 h-5 mr-2 shrink-0 text-blue-600" /> Abrir rota no mapa
          </a>
        ) : (
          <span className="flex items-center justify-center min-w-0 bg-gray-50 text-gray-400 text-sm font-medium py-3 rounded-2xl border border-gray-200">
            Sem parada pendente
          </span>
        )}
        <Link
          href={`/driver/viagem/${manifesto.id}/despesas`}
          className="flex items-center justify-center min-w-0 bg-white text-gray-900 text-sm font-medium py-3 rounded-2xl border border-gray-200 shadow-sm"
        >
          <Receipt className="w-5 h-5 mr-2 shrink-0 text-blue-600" /> Despesas
        </Link>
      </div>
      {rota.deFora > 0 && (
        <p className="text-xs text-gray-500 px-1">
          O mapa leva as {rota.incluidas} próximas paradas; abra de novo depois delas para as {rota.deFora} restantes.
        </p>
      )}

      <div className="space-y-4">
        <h3 className="font-bold text-gray-900 px-1">Entregas</h3>

        {manifesto.collections.map((coleta, index) => {
          const isDelivered = coleta.status === 'DELIVERED';

          return (
            <div
              key={coleta.id}
              className={`bg-white rounded-3xl p-5 shadow-sm border ${isDelivered ? 'border-green-200 bg-green-50/30' : 'border-gray-100'}`}
            >
              <div className="flex justify-between items-start mb-3">
                <span className={`text-xs font-bold px-3 py-1.5 rounded-full ${isDelivered ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}`}>
                  Parada {index + 1}
                </span>
                {isDelivered && (
                  <span className="flex items-center text-green-600 text-xs font-bold">
                    <ShieldCheck className="w-4 h-4 mr-1" /> Realizada
                  </span>
                )}
              </div>

              <h4 className="font-bold text-gray-900 mb-1">{coleta.receiver}</h4>
              <p className="text-xs text-gray-500 mb-2">
                Carga de {coleta.client?.tradeName || coleta.client?.companyName}
              </p>

              <div className="flex items-start space-x-2 text-sm text-gray-600 mb-1">
                <MapPin className="w-4 h-4 mt-0.5 text-red-500 flex-shrink-0" />
                <span>{coleta.destination}</span>
              </div>

              <div className="flex items-center space-x-2 text-sm text-gray-600 mb-4">
                <Package className="w-4 h-4 text-blue-500 flex-shrink-0" />
                <span>
                  {coleta.volumes} volumes ({coleta.weight} kg{coleta.cubicMeters ? `, ${coleta.cubicMeters.toLocaleString("pt-BR")} m³` : ""})
                </span>
              </div>

              {(coleta.priority === "URGENT" || janelaDaColeta(coleta) || coleta.pickupNotes) && (
                <div data-pedido={coleta.id} className="mb-4 rounded-2xl bg-amber-50 border border-amber-100 px-3 py-2 text-sm text-amber-900 space-y-0.5">
                  {coleta.priority === "URGENT" && <p className="font-bold text-red-700">Urgente</p>}
                  {janelaDaColeta(coleta) && <p>Janela: {janelaDaColeta(coleta)}</p>}
                  {coleta.pickupNotes && <p className="break-words">{coleta.pickupNotes}</p>}
                </div>
              )}

              {!isDelivered ? (
                // A baixa é uma tela própria: é ela que grava no servidor e que
                // guarda o comprovante na fila quando o sinal cai.
                <Link
                  href={`/driver/entregas/${coleta.id}/baixa`}
                  className="w-full bg-gray-900 hover:bg-gray-800 text-white font-medium py-3 rounded-2xl flex items-center justify-center transition-colors shadow-lg shadow-gray-900/20"
                >
                  <PenTool className="w-5 h-5 mr-2" /> Dar Baixa na Entrega
                </Link>
              ) : (
                <div className="w-full bg-green-100 text-green-800 font-medium py-3 rounded-2xl flex flex-col items-center justify-center opacity-90 cursor-default">
                  <div className="flex items-center"><CheckCircle2 className="w-5 h-5 mr-2" /> Entrega Registrada</div>
                  {coleta.receiverName && (
                    <span className="text-xs mt-1 text-green-700 font-normal">Recebedor: {coleta.receiverName}</span>
                  )}
                </div>
              )}

              {/* Avaria, atraso, recusa: vira chamado para a equipe, ligado a esta carga. */}
              <Link
                href={`/driver/entregas/${coleta.id}/ocorrencia`}
                className="mt-2 w-full flex items-center justify-center py-2.5 rounded-2xl border border-gray-200 text-sm font-medium text-gray-700"
              >
                <AlertTriangle className="w-4 h-4 mr-2 text-amber-600" /> Registrar ocorrência
              </Link>
            </div>
          )
        })}
      </div>
    </div>
  );
}
