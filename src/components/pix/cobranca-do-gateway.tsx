"use client";

import { useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { PixCopiaECola } from "@/components/pix/copia-e-cola";

/**
 * O que serve para pagar uma cobrança do Mercado Pago em aberto: o Pix dinâmico
 * (QR Code e Copia e Cola) e o boleto (link e linha digitável). Usado na fatura
 * do painel e nas faturas do portal do cliente.
 */

export const AVISO_PIX_DINAMICO = "Pix do Mercado Pago: depois de pago, a baixa da fatura é automática.";

const quando = (instante: string) => new Date(instante).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export type PixDaCobranca = { copiaECola: string | null; qrCodeBase64: string | null; link: string | null; venceEm: string };
export type BoletoDaCobranca = { link: string | null; linhaDigitavel: string | null; venceEm: string };

export function PixDinamico({ pix, className = "" }: { pix: PixDaCobranca; className?: string }) {
  if (!pix.copiaECola) {
    return pix.link ? (
      <a data-pix-link href={pix.link} target="_blank" rel="noopener noreferrer" className={`inline-flex items-center gap-2 text-sm font-medium text-emerald-700 hover:underline ${className}`}>
        <ExternalLink className="w-4 h-4" />
        Abrir o Pix no Mercado Pago
      </a>
    ) : null;
  }
  return <PixCopiaECola codigo={pix.copiaECola} qrCodeBase64={pix.qrCodeBase64} aviso={`${AVISO_PIX_DINAMICO} Vale até ${quando(pix.venceEm)}.`} className={className} />;
}

export function Boleto({ boleto, className = "" }: { boleto: BoletoDaCobranca; className?: string }) {
  const [copia, setCopia] = useState<"copiado" | "falhou" | null>(null);

  const copiar = async () => {
    if (!boleto.linhaDigitavel) return;
    try {
      await navigator.clipboard.writeText(boleto.linhaDigitavel);
      setCopia("copiado");
    } catch {
      setCopia("falhou");
    }
  };

  return (
    <div data-boleto className={`rounded-xl border border-blue-200 bg-blue-50/60 p-3 space-y-2 print:hidden ${className}`}>
      <p className="text-sm font-semibold text-blue-900">Boleto</p>
      {boleto.linhaDigitavel && <p className="text-xs font-mono text-gray-800 break-all">{boleto.linhaDigitavel}</p>}
      <div className="flex flex-wrap items-center gap-3">
        {boleto.link && (
          <a href={boleto.link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium">
            <ExternalLink className="w-4 h-4" />
            Abrir boleto
          </a>
        )}
        {boleto.linhaDigitavel && (
          <button type="button" onClick={() => void copiar()} className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-blue-200 bg-white text-sm text-blue-800">
            {copia === "copiado" ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            Copiar linha digitável
          </button>
        )}
        {copia && (
          <p role="status" className={`text-sm ${copia === "copiado" ? "text-blue-700" : "text-red-600"}`}>
            {copia === "copiado" ? "Linha copiada." : "Não foi possível copiar."}
          </p>
        )}
      </div>
      <p className="text-xs text-blue-900/80">Boleto do Mercado Pago: a baixa é automática depois da compensação. Vence em {quando(boleto.venceEm)}.</p>
    </div>
  );
}
