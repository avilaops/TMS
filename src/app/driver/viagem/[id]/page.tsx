"use client";

import { useState, useEffect, useSyncExternalStore } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, MapPin, CheckCircle2, Package, Loader2, PenTool, ClipboardCheck, AlertTriangle, Navigation, Receipt, Map as IconeDeMapa, LocateFixed, LocateOff, Camera, PackageX } from "lucide-react";
import Link from "next/link";
import { linkDaRota } from "@/lib/viagem";
import { janelaDaColeta } from "@/lib/coletas";
import { enderecoCompleto } from "@/lib/endereco";
import { rotuloDaSituacao, situacaoDaParada, type SituacaoDaParada } from "@/lib/comprovantes";
import type { MapaDaViagem } from "@/lib/mapa";
import { haQuantoTempo } from "@/lib/posicao";
import { GPS_DESLIGADO, assinarGps, desligarGps, estadoDoGps, ligarGps, retomarGps } from "@/lib/gps-motorista";
import { MapaDaViagemNaTela } from "@/components/mapa/mapa-da-viagem";

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
  // Endereço da entrega, além da cidade. Tudo opcional.
  deliveryStreet: string | null;
  deliveryNumber: string | null;
  deliveryDistrict: string | null;
  deliveryZip: string | null;
  client: { tradeName: string | null; companyName: string } | null;
  // Para a situação da parada (src/lib/comprovantes.ts): o status do
  // comprovante, se houve ressalva e quantas tentativas sem sucesso.
  proofStatus?: string | null;
  withException?: boolean;
  attempts?: number;
}

// Como cada situação aparece de relance: o cartão e o selo.
const APARENCIA: Record<SituacaoDaParada, { cartao: string; selo: string }> = {
  PENDENTE: { cartao: "border-gray-100", selo: "bg-gray-100 text-gray-700" },
  INSUCESSO: { cartao: "border-amber-300 bg-amber-50/40", selo: "bg-amber-100 text-amber-800" },
  ENTREGUE: { cartao: "border-green-200 bg-green-50/30", selo: "bg-green-100 text-green-700" },
  RESSALVA: { cartao: "border-amber-300 bg-amber-50/40", selo: "bg-amber-100 text-amber-800" },
  REFAZER: { cartao: "border-red-300 bg-red-50/40", selo: "bg-red-100 text-red-700" },
};

/** O MDF-e da viagem, só para leitura: é o que o motorista mostra na fiscalização. */
interface MdfeDaViagem {
  id: string;
  number: number;
  accessKey: string;
  status: string;
  environment: string;
  unloadState: string;
}

const SITUACAO_DO_MDFE: Record<string, string> = { AUTHORIZED: "Autorizado", CLOSED: "Encerrado", CANCELLED: "Cancelado" };

interface Viagem {
  id: string;
  collections: Parada[];
  mdfes?: MdfeDaViagem[];
}

export default function ViagemDetalhes() {
  const params = useParams();
  const router = useRouter();
  const [manifesto, setManifesto] = useState<Viagem | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // O mapa só é carregado quando o motorista pede: a tela abre na lista de entregas.
  const [mapaAberto, setMapaAberto] = useState(false);
  const [mapa, setMapa] = useState<MapaDaViagem | null>(null);
  const [erroDoMapa, setErroDoMapa] = useState("");
  // O compartilhamento da localização vive fora da tela (src/lib/gps-motorista.ts): segue ligado nas outras telas do app.
  const gps = useSyncExternalStore(assinarGps, estadoDoGps, () => GPS_DESLIGADO);
  const viagemId = typeof params.id === "string" ? params.id : "";
  const compartilhando = gps.manifestId === viagemId && (gps.situacao === "ligado" || gps.situacao === "pedindo");

  // Depois de recarregar a página: religa só se ele já tinha ligado e a permissão segue concedida.
  useEffect(() => {
    if (viagemId) void retomarGps(viagemId);
  }, [viagemId]);

  useEffect(() => {
    if (!mapaAberto || !viagemId) return;
    let vivo = true;
    fetch(`/api/driver/manifestos/${viagemId}/mapa`)
      .then(async (res) => {
        if (!vivo) return;
        if (res.ok) {
          setMapa((await res.json()) as MapaDaViagem);
          setErroDoMapa("");
        } else {
          setErroDoMapa("Não foi possível carregar o mapa.");
        }
      })
      .catch(() => {
        if (vivo) setErroDoMapa("Sem conexão para carregar o mapa.");
      });
    return () => {
      vivo = false;
    };
  }, [mapaAberto, viagemId]);

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
  // Com endereço na carga o link leva o endereço inteiro; sem ele, a cidade, como antes.
  const rota = linkDaRota(manifesto.collections.filter((c) => c.status !== 'DELIVERED').map((c) => enderecoCompleto(c, c.destination)));

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

      {(manifesto.mdfes ?? []).map((mdfe) => (
        <div key={mdfe.id} data-mdfe={mdfe.status} className="bg-white rounded-2xl px-4 py-3 shadow-sm border border-gray-100 relative z-10">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-gray-900">
              MDF-e nº {mdfe.number} · descarga em {mdfe.unloadState}
            </span>
            <span className={`shrink-0 text-xs font-medium px-2.5 py-1 rounded-full ${mdfe.status === "AUTHORIZED" ? "bg-emerald-100 text-emerald-800" : "bg-gray-200 text-gray-700"}`}>
              {SITUACAO_DO_MDFE[mdfe.status] ?? mdfe.status}
              {mdfe.environment === "PRODUCAO" ? "" : " (homologação)"}
            </span>
          </div>
          <p className="mt-1 font-mono text-[11px] text-gray-600 break-all">{mdfe.accessKey.replace(/(.{4})(?=.)/g, "$1 ")}</p>
        </div>
      ))}

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
            <Navigation className="w-5 h-5 mr-2 shrink-0 text-blue-600" /> Google Maps
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
        <button
          type="button"
          onClick={() => setMapaAberto((aberto) => !aberto)}
          aria-expanded={mapaAberto}
          data-ver-mapa
          className="flex items-center justify-center min-w-0 bg-white text-gray-900 text-sm font-medium py-3 rounded-2xl border border-gray-200 shadow-sm"
        >
          <IconeDeMapa className="w-5 h-5 mr-2 shrink-0 text-blue-600" /> {mapaAberto ? "Fechar mapa" : "Ver mapa"}
        </button>
        {/* A permissão do navegador só é pedida aqui, depois do toque. */}
        <button
          type="button"
          onClick={() => (compartilhando ? desligarGps() : ligarGps(manifesto.id))}
          aria-pressed={compartilhando}
          data-compartilhar-localizacao
          className={`flex items-center justify-center min-w-0 text-sm font-medium py-3 rounded-2xl border shadow-sm ${compartilhando ? "bg-emerald-600 text-white border-emerald-600" : "bg-white text-gray-900 border-gray-200"}`}
        >
          {compartilhando ? <LocateFixed className="w-5 h-5 mr-2 shrink-0" /> : <LocateOff className="w-5 h-5 mr-2 shrink-0 text-blue-600" />}
          {compartilhando ? "Parar localização" : "Compartilhar localização"}
        </button>
      </div>
      <p data-aviso-do-gps className="text-xs text-gray-500 px-1">
        {gps.situacao === "negado"
          ? "A permissão de localização foi negada. Libere a localização para este site nos ajustes do navegador e toque de novo."
          : gps.situacao === "indisponivel"
            ? "Este aparelho ou navegador não informa a localização."
            : compartilhando
              ? `Localização ligada${gps.enviadaEm ? `, enviada ${haQuantoTempo(new Date(gps.enviadaEm))}` : gps.semSinal ? ", sem sinal de GPS no momento" : ", aguardando o GPS"}. Só funciona com o app aberto na tela: com a tela bloqueada o envio para.`
              : "Ao compartilhar, a transportadora vê onde você está enquanto o app estiver aberto na tela. O cliente não vê. Você desliga quando quiser."}
      </p>
      {mapaAberto && (
        <div data-mapa-do-motorista className="bg-white rounded-3xl p-3 shadow-sm border border-gray-100 space-y-1">
          {erroDoMapa && (
            <p role="alert" className="text-sm text-red-600">
              {erroDoMapa}
            </p>
          )}
          {mapa ? (
            <MapaDaViagemNaTela mapa={mapa} posicaoDoAparelho={gps.manifestId === viagemId ? gps.posicao : null} className="h-[44vh]" />
          ) : (
            !erroDoMapa && <p className="text-sm text-gray-500">Carregando o mapa…</p>
          )}
        </div>
      )}
      {rota.deFora > 0 && (
        <p className="text-xs text-gray-500 px-1">
          O mapa leva as {rota.incluidas} próximas paradas; abra de novo depois delas para as {rota.deFora} restantes.
        </p>
      )}

      <div className="space-y-4">
        <h3 className="font-bold text-gray-900 px-1">Entregas</h3>

        {manifesto.collections.map((coleta, index) => {
          const isDelivered = coleta.status === 'DELIVERED';
          const situacao = situacaoDaParada(coleta);
          const aparencia = APARENCIA[situacao];

          return (
            <div
              key={coleta.id}
              data-parada={coleta.id}
              data-situacao={situacao}
              className={`bg-white rounded-3xl p-5 shadow-sm border ${aparencia.cartao}`}
            >
              <div className="flex justify-between items-center gap-2 mb-3">
                <span className="text-xs font-bold px-3 py-1.5 rounded-full bg-gray-100 text-gray-700 shrink-0">
                  Parada {index + 1}
                </span>
                {/* De relance: pendente, entregue, com ressalva, tentativa sem sucesso (com o número) ou para refazer. */}
                <span data-situacao-da-parada className={`text-xs font-bold px-3 py-1.5 rounded-full text-right ${aparencia.selo}`}>
                  {rotuloDaSituacao(coleta)}
                </span>
              </div>

              <h4 className="font-bold text-gray-900 mb-1">{coleta.receiver}</h4>
              <p className="text-xs text-gray-500 mb-2">
                Carga de {coleta.client?.tradeName || coleta.client?.companyName}
              </p>

              <div className="flex items-start space-x-2 text-sm text-gray-600 mb-1">
                <MapPin className="w-4 h-4 mt-0.5 text-red-500 flex-shrink-0" />
                <span data-endereco={coleta.id}>{enderecoCompleto(coleta, coleta.destination)}</span>
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

              {situacao === "REFAZER" && (
                <Link
                  href={`/driver/entregas/${coleta.id}/refazer`}
                  className="mt-2 w-full flex items-center justify-center py-2.5 rounded-2xl bg-red-600 text-sm font-medium text-white"
                >
                  <Camera className="w-4 h-4 mr-2" /> Refazer comprovante
                </Link>
              )}

              <div className={`mt-2 grid gap-2 ${isDelivered ? "grid-cols-1" : "grid-cols-2"}`}>
                {/* Foi até lá e não entregou: motivo padronizado e foto da fachada. A carga continua na viagem. */}
                {!isDelivered && (
                  <Link
                    href={`/driver/entregas/${coleta.id}/insucesso`}
                    className="min-w-0 flex items-center justify-center py-2.5 rounded-2xl border border-gray-200 text-sm font-medium text-gray-700"
                  >
                    <PackageX className="w-4 h-4 mr-2 shrink-0 text-amber-600" /> Não entreguei
                  </Link>
                )}
                {/* Avaria, atraso, recusa: vira chamado para a equipe, ligado a esta carga. */}
                <Link
                  href={`/driver/entregas/${coleta.id}/ocorrencia`}
                  className="min-w-0 flex items-center justify-center py-2.5 rounded-2xl border border-gray-200 text-sm font-medium text-gray-700"
                >
                  <AlertTriangle className="w-4 h-4 mr-2 shrink-0 text-amber-600" /> {isDelivered ? "Registrar ocorrência" : "Ocorrência"}
                </Link>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  );
}
