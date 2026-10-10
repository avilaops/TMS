"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { AVISO_PIX_ESTATICO } from "@/lib/pix";

/**
 * O "Pix Copia e Cola" de um título, com o botão de copiar e o aviso de que é
 * Pix estático (pagar não dá baixa). Usado na fatura do painel e nas faturas
 * do portal do cliente.
 *
 * Não há QR Code: o projeto não tem gerador de QR e não se acrescentou
 * dependência para isso. O código abaixo é o mesmo conteúdo que o QR levaria.
 */
export function PixCopiaECola({ codigo, className = "" }: { codigo: string; className?: string }) {
  const [copia, setCopia] = useState<"copiado" | "falhou" | null>(null);

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(codigo);
      setCopia("copiado");
    } catch {
      // Sem permissão ou fora de HTTPS: o código continua na tela para copiar à mão.
      setCopia("falhou");
    }
  };

  return (
    <div data-pix className={`rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 space-y-2 print:hidden ${className}`}>
      <p className="text-sm font-semibold text-emerald-900">Pix Copia e Cola</p>
      <textarea
        readOnly
        aria-label="Código Pix Copia e Cola"
        value={codigo}
        rows={3}
        onFocus={(e) => e.target.select()}
        className="block w-full min-w-0 px-3 py-2 rounded-lg border border-emerald-200 bg-white text-xs font-mono text-gray-800 break-all resize-none"
      />
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void copiar()}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium"
        >
          {copia === "copiado" ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          Copiar código
        </button>
        {copia && (
          <p role="status" className={`text-sm ${copia === "copiado" ? "text-emerald-700" : "text-red-600"}`}>
            {copia === "copiado" ? "Código copiado. Cole no aplicativo do banco." : "Não foi possível copiar. Selecione o código e copie."}
          </p>
        )}
      </div>
      <p className="text-xs text-emerald-900/80">{AVISO_PIX_ESTATICO}</p>
    </div>
  );
}
