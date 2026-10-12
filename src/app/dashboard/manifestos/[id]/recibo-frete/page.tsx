"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, LogIn, Printer, ShieldAlert } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ReciboDeFrete } from "@/lib/frete-contratado";
import { deniedReason, type DeniedReason } from "../../../financeiro/carregar";
import { BOTAO_AZUL, erroDe } from "../../../deposito/comum";
import { ESTILO_DE_IMPRESSAO, FolhaDoRecibo } from "./folha";

/**
 * Recibo de pagamento de frete do contrato de uma viagem, para imprimir: uma
 * folha A4 com a empresa, o parceiro, a viagem, os valores, os pagamentos e as
 * assinaturas. Abre pelo botão "Recibo" da aba Frete da viagem. Não é documento
 * fiscal.
 *
 * Na impressão só a folha sai (`ESTILO_DE_IMPRESSAO`, em ./folha.tsx). O botão
 * de imprimir fica no alto para aparecer no celular sem rolar.
 */

type Dados = { denied: DeniedReason } | { denied: null; erro: string } | { denied: null; erro: null; recibo: ReciboDeFrete };

const FALHA = "Não foi possível carregar o recibo de frete.";

/** Sessão expirada (401) ou perfil sem acesso (403), como nas telas vizinhas. */
function Negado({ motivo }: { motivo: DeniedReason }) {
  if (motivo === "login") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <LogIn className="w-5 h-5 text-blue-600" />
            Sessão expirada
          </CardTitle>
          <CardDescription>
            Entre de novo para ver o recibo.{" "}
            <Link href="/login" className="font-medium text-blue-600 hover:underline">
              Ir para o login
            </Link>
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldAlert className="w-5 h-5 text-red-600" />
          Acesso negado
        </CardTitle>
        <CardDescription>Seu perfil não tem acesso ao frete contratado.</CardDescription>
      </CardHeader>
    </Card>
  );
}

export default function ReciboDeFretePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [dados, setDados] = useState<Dados | null>(null);

  useEffect(() => {
    let ativo = true;
    fetch(`/api/manifestos/${id}/frete/recibo`)
      .then(async (res): Promise<Dados> => {
        const denied = deniedReason(res.status);
        if (denied) return { denied };
        if (!res.ok) return { denied: null, erro: await erroDe(res, FALHA) };
        return { denied: null, erro: null, recibo: (await res.json()) as ReciboDeFrete };
      })
      .catch((): Dados => ({ denied: null, erro: FALHA }))
      .then((resultado) => {
        if (ativo) setDados(resultado);
      });
    return () => {
      ativo = false;
    };
  }, [id]);

  if (!dados) {
    return (
      <div className="flex justify-center py-16" role="status" aria-label="Carregando">
        <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
      </div>
    );
  }

  if (dados.denied !== null) return <Negado motivo={dados.denied} />;

  const voltar = (
    <Link href="/dashboard/manifestos" className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-300">
      <ArrowLeft className="w-4 h-4" />
      Manifestos
    </Link>
  );

  if (dados.erro !== null) {
    return (
      <div className="space-y-4">
        {voltar}
        <p role="alert" className="px-4 py-3 text-sm text-red-700 border border-red-200 rounded-lg bg-red-50">
          {dados.erro}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 md:space-y-6">
      <style>{ESTILO_DE_IMPRESSAO}</style>

      <div className="flex items-center justify-between gap-3">
        {voltar}
        <button type="button" onClick={() => window.print()} className={BOTAO_AZUL}>
          <Printer className="w-4 h-4" />
          Imprimir
        </button>
      </div>

      <FolhaDoRecibo recibo={dados.recibo} />
    </div>
  );
}
