"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { formatCurrency } from "@/lib/format";
import { periodoDoRelatorio } from "@/lib/relatorios";
import type { CustosDoVeiculo } from "@/lib/frota";
import { deniedReason, type DeniedReason } from "../../financeiro/carregar";
import { CARD } from "./registros";

/**
 * Aba de custos do veículo: manutenção concluída, abastecimento, total, custo
 * por km e consumo médio de um período em meses. Só leitura e só para o
 * administrador; as contas vêm prontas de `/api/veiculos/[id]/custos`.
 */

type Resposta = CustosDoVeiculo & { periodo: { de: string; ate: string } };

type Carga = { denied: DeniedReason } | { denied: null; erro: string } | { denied: null; erro: null; custos: Resposta };

const FALHA = "Não foi possível carregar os custos.";

const CAMPO = "min-w-0 w-full px-2 py-1.5 md:px-3 md:py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-950";

async function carregar(vehicleId: string, de: string, ate: string): Promise<Carga> {
  try {
    const res = await fetch(`/api/veiculos/${vehicleId}/custos?de=${encodeURIComponent(de)}&ate=${encodeURIComponent(ate)}`);
    const denied = deniedReason(res.status);
    if (denied) return { denied };
    const corpo = await res.json().catch(() => null);
    if (!res.ok) return { denied: null, erro: typeof corpo?.error === "string" ? corpo.error : FALHA };
    return { denied: null, erro: null, custos: corpo as Resposta };
  } catch {
    return { denied: null, erro: FALHA };
  }
}

const numero = (valor: number | null, unidade: string) => (valor === null ? "-" : `${valor.toLocaleString("pt-BR")} ${unidade}`);

export function AbaCustos({ vehicleId, onNegado }: { vehicleId: string; onNegado: (motivo: DeniedReason) => void }) {
  const [periodo, setPeriodo] = useState(periodoDoRelatorio);
  const [carga, setCarga] = useState<Exclude<Carga, { denied: DeniedReason }> | null>(null);

  useEffect(() => {
    let ativo = true;
    carregar(vehicleId, periodo.de, periodo.ate).then((resultado) => {
      if (!ativo) return;
      if (resultado.denied !== null) return onNegado(resultado.denied);
      setCarga(resultado);
    });
    return () => {
      ativo = false;
    };
  }, [vehicleId, periodo, onNegado]);

  const mudarPeriodo = (campo: "de" | "ate", valor: string) => {
    // Campo de mês apagado manda vazio: fica o que estava.
    if (!valor) return;
    setCarga(null);
    setPeriodo((atual) => ({ ...atual, [campo]: valor }));
  };

  return (
    <div className="space-y-3 md:space-y-4">
      <div className="flex items-end gap-2 md:gap-3">
        <label className="min-w-0 text-xs text-gray-500">
          De
          <input type="month" value={periodo.de} onChange={(e) => mudarPeriodo("de", e.target.value)} className={`${CAMPO} block mt-1`} />
        </label>
        <label className="min-w-0 text-xs text-gray-500">
          Até
          <input type="month" value={periodo.ate} onChange={(e) => mudarPeriodo("ate", e.target.value)} className={`${CAMPO} block mt-1`} />
        </label>
      </div>

      {!carga && (
        <div className="flex items-center justify-center h-40" role="status" aria-label="Carregando">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        </div>
      )}

      {carga && carga.erro !== null && (
        <div role="alert" className="px-4 py-3 text-sm text-red-700 border border-red-200 rounded-lg bg-red-50">
          {carga.erro}
        </div>
      )}

      {carga && carga.erro === null && (
        <section className={`${CARD} overflow-hidden`} aria-label="Custos">
          <dl className="grid grid-cols-2 gap-x-3 gap-y-3 p-3 md:gap-4 md:p-5 lg:grid-cols-4">
            {(
              [
                ["Total", formatCurrency(carga.custos.total)],
                ["Custo por km", carga.custos.custoPorKm === null ? "-" : formatCurrency(carga.custos.custoPorKm)],
                ["Manutenção concluída", formatCurrency(carga.custos.manutencao)],
                ["Abastecimento", formatCurrency(carga.custos.abastecimento)],
                ["Km rodados", numero(carga.custos.kmRodados, "km")],
                ["Consumo médio", numero(carga.custos.consumoMedio, "km/l")],
                ["Litros abastecidos", numero(carga.custos.litros, "l")],
              ] as const
            ).map(([rotulo, valor]) => (
              <div key={rotulo} data-linha={rotulo}>
                <dt className="text-[11px] md:text-xs leading-tight text-gray-500">{rotulo}</dt>
                <dd className="mt-0.5 md:mt-1 text-sm md:text-base font-semibold text-gray-900 dark:text-white">{valor}</dd>
              </div>
            ))}
          </dl>
          <p className="px-3 pb-3 md:px-5 md:pb-5 text-xs text-gray-500">
            Os km rodados e o consumo saem dos hodômetros dos abastecimentos: sem dois abastecimentos em sequência não há medição. Manutenção agendada ou em
            andamento não entra no custo.
          </p>
        </section>
      )}
    </div>
  );
}
