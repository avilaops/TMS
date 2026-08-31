"use client";

import { useEffect, useState } from "react";
import { Loader2, MapPin, Navigation, Package, Route as RouteIcon } from "lucide-react";
import { findServiceArea } from "@/data/serviceAreas";
import { formatWeight } from "@/lib/format";

type Parada = {
  id: string;
  receiver: string;
  origin: string;
  destination: string;
  volumes: number;
  weight: number;
  status: string;
};

type Viagem = {
  id: string;
  vehicle: { plate: string; model: string };
  collections: Parada[];
};

// Não temos coordenadas por cidade no cadastro — só por polo regional. Em vez
// de desenhar um mapa impreciso, entregamos a lista de paradas com atalho para
// o app de navegação do próprio celular, que é o que o motorista usa na rua.
function linkGoogleMaps(cidade: string) {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${cidade}, SP`)}`;
}

function linkWaze(cidade: string) {
  return `https://waze.com/ul?q=${encodeURIComponent(`${cidade}, SP`)}&navigate=yes`;
}

export default function DriverMapaPage() {
  const [viagens, setViagens] = useState<Viagem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/driver/manifestos")
      .then((r) => (r.ok ? r.json() : []))
      .then(setViagens)
      .catch(() => setViagens([]))
      .finally(() => setLoading(false));
  }, []);

  const paradas = viagens.flatMap((v) =>
    v.collections.map((c) => ({ ...c, placa: v.vehicle?.plate }))
  );

  const pendentes = paradas.filter((p) => p.status !== "DELIVERED");

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl p-6 shadow-xl shadow-blue-900/5 mt-4">
        <h1 className="text-xl font-bold font-outfit text-gray-900 mb-1">Rota do dia</h1>
        <p className="text-gray-500 text-sm">
          {pendentes.length === 0
            ? "Nenhuma parada pendente."
            : `${pendentes.length} ${pendentes.length === 1 ? "parada pendente" : "paradas pendentes"}.`}
        </p>
      </div>

      {paradas.length === 0 ? (
        <div className="bg-white rounded-2xl p-8 text-center shadow-sm">
          <RouteIcon className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">Nenhuma parada na sua viagem.</p>
        </div>
      ) : (
        <ul className="space-y-4">
          {paradas.map((parada, index) => {
            const area = findServiceArea(parada.destination);
            const entregue = parada.status === "DELIVERED";

            return (
              <li
                key={parada.id}
                className={`bg-white rounded-2xl p-5 shadow-sm border border-gray-100 ${
                  entregue ? "opacity-60" : ""
                }`}
              >
                <div className="flex items-start gap-3 mb-4">
                  <span className="w-7 h-7 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center shrink-0">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-gray-900 flex items-center gap-1">
                      <MapPin className="w-4 h-4 text-gray-400 shrink-0" />
                      {parada.destination}
                    </p>
                    <p className="text-sm text-gray-500 truncate">{parada.receiver}</p>
                  </div>
                  {entregue && (
                    <span className="text-xs px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 whitespace-nowrap">
                      Entregue
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600 mb-4">
                  <span className="flex items-center gap-1">
                    <Package className="w-4 h-4 text-gray-400" />
                    {parada.volumes} {parada.volumes === 1 ? "volume" : "volumes"} ·{" "}
                    {formatWeight(parada.weight)}
                  </span>
                  {area && (
                    <span className="text-gray-500">
                      Polo {area.hub} · {area.deadline}
                    </span>
                  )}
                </div>

                {!entregue && (
                  <div className="flex gap-2">
                    <a
                      href={linkGoogleMaps(parada.destination)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-medium active:scale-95 transition-transform"
                    >
                      <Navigation className="w-4 h-4" />
                      Google Maps
                    </a>
                    <a
                      href={linkWaze(parada.destination)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gray-100 text-gray-700 text-sm font-medium active:scale-95 transition-transform"
                    >
                      <Navigation className="w-4 h-4" />
                      Waze
                    </a>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
