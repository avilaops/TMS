"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, LogIn, Printer, ShieldAlert } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ReciboDoFechamento } from "@/lib/remuneracao";
import { deniedReason, type DeniedReason } from "../../../../financeiro/carregar";
import { BOTAO_AZUL, erroDe } from "../../../../deposito/comum";
import { ESTILO_DE_IMPRESSAO, FolhaDoDemonstrativo } from "./folha";

/**
 * Demonstrativo de remuneração variável de um fechamento mensal, para imprimir:
 * uma folha A4 com a empresa, o motorista ou ajudante (nome e CPF), o mês, as
 * viagens com dias, km, entregas, frete e o valor de cada forma, os
 * adiantamentos descontados, o saldo e as assinaturas. Abre pelo botão
 * "Recibo" do fechamento, na aba Fechamento da Equipe. Não é holerite.
 *
 * Na impressão só a folha sai (`ESTILO_DE_IMPRESSAO`, em ./folha.tsx). O botão
 * de imprimir fica no alto para aparecer no celular sem rolar.
 */

type Dados = { denied: DeniedReason } | { denied: null; erro: string } | { denied: null; erro: null; recibo: ReciboDoFechamento };

const FALHA = "Não foi possível carregar o demonstrativo.";

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
            Entre de novo para ver o demonstrativo.{" "}
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
        <CardDescription>Seu perfil não tem acesso aos valores da equipe.</CardDescription>
      </CardHeader>
    </Card>
  );
}

export default function ReciboDoFechamentoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [dados, setDados] = useState<Dados | null>(null);

  useEffect(() => {
    let ativo = true;
    fetch(`/api/equipe/fechamento/${id}`)
      .then(async (res): Promise<Dados> => {
        const denied = deniedReason(res.status);
        if (denied) return { denied };
        if (!res.ok) return { denied: null, erro: await erroDe(res, FALHA) };
        return { denied: null, erro: null, recibo: (await res.json()) as ReciboDoFechamento };
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
    <Link href="/dashboard/equipe" className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-300">
      <ArrowLeft className="w-4 h-4" />
      Equipe
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

      <FolhaDoDemonstrativo recibo={dados.recibo} />
    </div>
  );
}
