"use client";
import dynamic from "next/dynamic";
import { useState } from "react";
const RouteMap = dynamic(() => import("@/components/RouteMap").then((mod) => mod.RouteMap), { ssr: false, loading: () => <p>Carregando mapa…</p> });
export function PublicMap() {
  const [open, setOpen] = useState(false);
  return <details className="ui-map-disclosure" onToggle={(event) => setOpen(event.currentTarget.open)}><summary>Ver mapa das rotas</summary>{open && <div className="ui-map"><RouteMap /></div>}<p>Polos regionais. Confirme a rota e o prazo para seu envio.</p></details>;
}
