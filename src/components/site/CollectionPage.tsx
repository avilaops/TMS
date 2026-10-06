"use client";
import dynamic from "next/dynamic";
const CollectionCenter = dynamic(() => import("@/components/CollectionCenter").then((mod) => mod.CollectionCenter), { ssr: false, loading: () => <p role="status">Carregando formulário de coleta…</p> });
export function CollectionPage() { return <div className="ui-collection"><CollectionCenter /></div>; }
