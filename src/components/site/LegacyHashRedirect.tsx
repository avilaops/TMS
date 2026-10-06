"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const legacyRoutes: Record<string, string> = {
  "/cidades": "/cidades", "/frota": "/frota", "/mercadorias": "/mercadorias", "/marca": "/marca", "/duvidas": "/duvidas", "/coleta": "/coleta",
  cidades: "/cidades", frota: "/frota", coleta: "/coleta", servicos: "/servicos", rotas: "/cidades",
};

export function LegacyHashRedirect() {
  const router = useRouter();
  useEffect(() => {
    const follow = () => { const destination = legacyRoutes[window.location.hash.slice(1)]; if (destination) router.replace(destination); };
    follow();
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, [router]);
  return null;
}
