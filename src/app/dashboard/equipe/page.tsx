"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { Loader2, LogIn, ShieldAlert } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { pode } from "@/lib/permissoes";
import { deniedReason, type DeniedReason } from "../financeiro/carregar";
import { Adiantamentos } from "./adiantamentos";
import { Ausencias } from "./ausencias";
import { Pessoas } from "./pessoas";
import { Produtividade } from "./produtividade";
import type { PessoaDaEquipe } from "./comum";

/**
 * Equipe: quem vai para a estrada (motoristas e ajudantes), as ausências, os
 * adiantamentos com acerto e a produtividade dos motoristas. Uma aba por
 * assunto; no celular cada aba cabe numa tela.
 *
 * Adiantamentos são dinheiro: a aba só aparece para quem lê os valores da
 * equipe (`equipeValoresVer`), e a API recusa os demais. Na Produtividade,
 * frete e comissão seguem a mesma regra.
 */

type Carga = { denied: DeniedReason } | { denied: null; erro: string } | { denied: null; erro: null; pessoas: PessoaDaEquipe[] };

const FALHA = "Não foi possível carregar a equipe.";

const ABAS = ["Pessoas", "Ausências", "Adiantamentos", "Produtividade"] as const;
type Aba = (typeof ABAS)[number];

async function carregar(): Promise<Carga> {
  try {
    const res = await fetch("/api/equipe");
    const denied = deniedReason(res.status);
    if (denied) return { denied };
    const corpo = await res.json().catch(() => null);
    if (!res.ok) return { denied: null, erro: typeof corpo?.error === "string" ? corpo.error : FALHA };
    return { denied: null, erro: null, pessoas: (corpo as { pessoas: PessoaDaEquipe[] }).pessoas };
  } catch {
    return { denied: null, erro: FALHA };
  }
}

export default function EquipePage() {
  const { data: session } = useSession();
  // Só para mostrar a aba: quem decide é a API, que devolve 403 para o perfil errado.
  const admin = pode(session?.user?.role, "equipeValoresVer");
  const [carga, setCarga] = useState<Carga | null>(null);
  const [aba, setAba] = useState<Aba>("Pessoas");

  useEffect(() => {
    let ativo = true;
    carregar().then((resultado) => {
      if (ativo) setCarga(resultado);
    });
    return () => {
      ativo = false;
    };
  }, []);

  const recarregar = useCallback(async () => {
    setCarga(await carregar());
  }, []);

  if (!carga) {
    return (
      <div className="flex items-center justify-center h-[300px]" role="status" aria-label="Carregando">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (carga.denied === "login") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <LogIn className="w-5 h-5 text-blue-600" />
            Sessão expirada
          </CardTitle>
          <CardDescription>
            Entre de novo para ver a equipe.{" "}
            <Link href="/login" className="font-medium text-blue-600 hover:underline">
              Ir para o login
            </Link>
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (carga.denied !== null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-red-600" />
            Acesso negado
          </CardTitle>
          <CardDescription>A equipe é restrita à equipe interna.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (carga.erro !== null) {
    return (
      <div role="alert" className="px-4 py-3 text-sm text-red-700 border border-red-200 rounded-lg bg-red-50">
        {carga.erro}
      </div>
    );
  }

  const abas = ABAS.filter((nome) => nome !== "Adiantamentos" || admin);
  // Perfil rebaixado com a aba aberta: volta para a primeira.
  const ativa = abas.includes(aba) ? aba : "Pessoas";

  return (
    <div className="space-y-3 md:space-y-6">
      <div>
        <h1 className="text-2xl font-bold font-outfit text-gray-900 dark:text-white">Equipe</h1>
        <p className="hidden md:block text-gray-500 text-sm mt-1">Motoristas e ajudantes, ausências, adiantamentos e produtividade</p>
      </div>

      <div
        role="tablist"
        aria-label="Assunto"
        className="grid gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-xl md:inline-grid"
        style={{ gridTemplateColumns: `repeat(${abas.length}, minmax(0, 1fr))` }}
      >
        {abas.map((nome) => (
          <button
            key={nome}
            type="button"
            role="tab"
            aria-selected={ativa === nome}
            data-aba={nome}
            onClick={() => setAba(nome)}
            className={`px-1 md:px-4 py-1.5 rounded-lg text-xs md:text-sm font-semibold truncate ${ativa === nome ? "bg-white dark:bg-gray-900 text-blue-700 dark:text-blue-400 shadow-sm" : "text-gray-600 dark:text-gray-300"}`}
          >
            {nome}
          </button>
        ))}
      </div>

      {ativa === "Pessoas" && <Pessoas pessoas={carga.pessoas} recarregar={recarregar} />}
      {ativa === "Ausências" && <Ausencias pessoas={carga.pessoas} recarregarPessoas={recarregar} />}
      {ativa === "Adiantamentos" && admin && <Adiantamentos pessoas={carga.pessoas} />}
      {ativa === "Produtividade" && <Produtividade />}
    </div>
  );
}
