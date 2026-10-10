import Link from "next/link";
import { LogIn, ShieldAlert } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { barrasCode128B } from "@/lib/code128";
import { SITUACAO_DO_VOLUME, type SituacaoDoVolume } from "@/lib/deposito";
import type { DeniedReason } from "../financeiro/carregar";

// O que as telas do depósito (visão, conferência, posições e etiquetas) têm em comum.

export const CARD = "bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm";
export const INPUT =
  "block w-full min-w-0 px-3 py-1.5 md:py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-2 focus:ring-blue-500 outline-none text-sm dark:text-white";
export const LABEL = "text-xs md:text-sm font-medium text-gray-700 dark:text-gray-300";
export const ROTULO =
  "before:content-[attr(data-rotulo)] before:block before:text-[11px] before:leading-tight before:text-gray-500 md:before:content-none";

/** Botão de ação principal das telas do depósito: alto o bastante para o polegar. */
export const BOTAO = "inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium disabled:opacity-60";
export const BOTAO_AZUL = `${BOTAO} bg-blue-600 hover:bg-blue-700 text-white`;
export const BOTAO_CLARO = `${BOTAO} border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300`;

const COR_DA_SITUACAO: Record<SituacaoDoVolume, string> = {
  PENDING: "bg-gray-100 text-gray-600",
  RECEIVED: "bg-emerald-100 text-emerald-800",
  DAMAGED: "bg-amber-100 text-amber-800",
  MISSING: "bg-red-100 text-red-700",
};

export function Situacao({ situacao }: { situacao: SituacaoDoVolume }) {
  return (
    <span data-situacao={situacao} className={`inline-block text-xs px-2.5 py-1 rounded-full whitespace-nowrap ${COR_DA_SITUACAO[situacao]}`}>
      {SITUACAO_DO_VOLUME[situacao]}
    </span>
  );
}

/**
 * O código de barras (Code 128 B) desenhado em SVG, sem biblioteca: uma barra
 * por retângulo, com a zona de silêncio dos dois lados. O SVG estica na
 * largura que a etiqueta der; a altura é a do `className`. Texto que o código
 * não sabe escrever não desenha nada.
 */
export function CodigoDeBarras({ texto, className = "h-14 w-full" }: { texto: string; className?: string }) {
  const desenho = barrasCode128B(texto);
  if (!desenho) return null;
  return (
    <svg
      role="img"
      aria-label={`Código de barras ${texto}`}
      viewBox={`0 0 ${desenho.largura} 10`}
      preserveAspectRatio="none"
      shapeRendering="crispEdges"
      className={className}
    >
      <rect x="0" y="0" width={desenho.largura} height="10" fill="#fff" />
      {desenho.barras.map((barra) => (
        <rect key={barra.x} x={barra.x} y="0" width={barra.largura} height="10" fill="#000" />
      ))}
    </svg>
  );
}

export const quando = (instante: string | Date) =>
  new Date(instante).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/** Sessão expirada (401) ou perfil sem acesso (403), como nas telas vizinhas. */
export function Negado({ motivo }: { motivo: DeniedReason }) {
  if (motivo === "login") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <LogIn className="w-5 h-5 text-blue-600" />
            Sessão expirada
          </CardTitle>
          <CardDescription>
            Entre de novo para usar o depósito.{" "}
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
        <CardDescription>O depósito é restrito à equipe interna.</CardDescription>
      </CardHeader>
    </Card>
  );
}

export const erroDe = async (res: Response, padrao: string) => {
  const corpo = (await res.json().catch(() => null)) as { error?: unknown } | null;
  return typeof corpo?.error === "string" ? corpo.error : padrao;
};
