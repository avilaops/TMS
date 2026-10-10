"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, Loader2 } from "lucide-react";
import { formatCurrency } from "@/lib/format";
import { prazoPorExtenso, type CotacaoDoPortal } from "@/lib/portal-cliente";
import { BOTAO, BOTAO_SECUNDARIO, Campo } from "../comum";

/**
 * Cotação pelo portal: o cliente informa a carga e vê o valor e o prazo pela
 * tabela de frete dele. Nada é gravado; "Pedir coleta com estes dados" leva ao
 * pedido de coleta já preenchido.
 */

const VAZIO = { destination: "", weight: "", volumes: "", invoiceValue: "", cubicMeters: "" };

const SEM_VALOR: Record<"sem_tabela" | "fora_da_tabela", string> = {
  sem_tabela: "Ainda não há tabela de frete em vigor para a sua empresa. Peça a coleta mesmo assim: a transportadora informa o valor.",
  fora_da_tabela: "Esta cidade não está na sua tabela de frete. Peça a coleta mesmo assim: a transportadora informa o valor.",
};

export default function PortalCotacaoPage() {
  const [form, setForm] = useState(VAZIO);
  const [calculando, setCalculando] = useState(false);
  const [erro, setErro] = useState("");
  // O resultado guarda os dados com que foi calculado: é com eles que o pedido de coleta abre.
  const [resultado, setResultado] = useState<{ cotacao: CotacaoDoPortal; dados: typeof VAZIO } | null>(null);

  const campo = (nome: keyof typeof VAZIO) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((atual) => ({ ...atual, [nome]: e.target.value }));
    setResultado(null);
  };

  const cotar = async (e: React.FormEvent) => {
    e.preventDefault();
    setCalculando(true);
    setErro("");
    setResultado(null);
    try {
      const res = await fetch("/api/portal/cotacao", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const corpo = await res.json().catch(() => null);
      if (!res.ok || !corpo) throw new Error(corpo?.error ?? "Não foi possível calcular a cotação.");
      setResultado({ cotacao: corpo as CotacaoDoPortal, dados: form });
    } catch (falha) {
      setErro((falha as Error).message);
    } finally {
      setCalculando(false);
    }
  };

  // Só o que foi preenchido vai no endereço do pedido de coleta.
  const pedido = resultado
    ? `/portal/coletas?${new URLSearchParams(Object.entries(resultado.dados).filter(([, valor]) => valor.trim() !== "")).toString()}`
    : "";

  return (
    <div className="space-y-3 md:space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-outfit font-bold text-gray-900">Cotação</h1>
        <p className="hidden md:block text-gray-500">Veja o valor e o prazo do frete pela sua tabela.</p>
      </div>

      <form onSubmit={cotar} aria-label="Cotação" className="bg-white border border-gray-200 rounded-2xl p-3 md:p-6 space-y-3">
        <div className="grid grid-cols-2 gap-x-3 gap-y-2 md:gap-4">
          <Campo rotulo="Cidade de destino" className="col-span-2" required value={form.destination} onChange={campo("destination")} placeholder="Ex.: Mirassol - SP" />
          <Campo rotulo="Peso (kg)" required inputMode="decimal" value={form.weight} onChange={campo("weight")} />
          <Campo rotulo="Volumes" required inputMode="numeric" value={form.volumes} onChange={campo("volumes")} />
          <Campo rotulo="Valor da nota (R$)" inputMode="decimal" value={form.invoiceValue} onChange={campo("invoiceValue")} />
          <Campo rotulo="Cubagem (m³, opcional)" inputMode="decimal" value={form.cubicMeters} onChange={campo("cubicMeters")} />
        </div>

        {erro && (
          <p role="alert" className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm">
            {erro}
          </p>
        )}

        <button type="submit" disabled={calculando} className={BOTAO}>
          {calculando && <Loader2 className="w-4 h-4 animate-spin" />}
          Calcular
        </button>
      </form>

      {resultado && (
        <div data-resultado className="bg-white border border-gray-200 rounded-2xl p-3 md:p-6 space-y-3">
          {resultado.cotacao.atendida ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-gray-500">Frete para {resultado.cotacao.cidade}</p>
                  <p data-valor className="text-2xl font-outfit font-bold text-gray-900">{formatCurrency(resultado.cotacao.valor)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Prazo de entrega</p>
                  <p data-prazo className="text-2xl font-outfit font-bold text-gray-900">{prazoPorExtenso(resultado.cotacao.prazoHoras)}</p>
                </div>
              </div>
              {resultado.cotacao.avisos.length > 0 && (
                <ul className="space-y-1">
                  {resultado.cotacao.avisos.map((aviso) => (
                    <li key={aviso} className="flex gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                      {aviso}
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-gray-500">Valor estimado pela sua tabela. A transportadora confirma o frete ao aprovar a coleta.</p>
            </>
          ) : (
            <p data-sem-valor className="text-sm text-gray-700">{SEM_VALOR[resultado.cotacao.motivo]}</p>
          )}

          <div className="flex flex-wrap gap-2">
            <Link href={pedido} className={BOTAO}>
              Pedir coleta com estes dados
            </Link>
            <button type="button" onClick={() => { setForm(VAZIO); setResultado(null); }} className={BOTAO_SECUNDARIO}>
              Nova cotação
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
