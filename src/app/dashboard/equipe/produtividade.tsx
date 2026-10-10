"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { formatCurrency, formatWeight } from "@/lib/format";
import { periodoDoRelatorio } from "@/lib/relatorios";
import type { ProdutividadeDoMotorista } from "@/lib/equipe";
import { CARD, COM_ROTULO, TABELA, TBODY, TD, TH, THEAD, TR } from "./comum";

/**
 * Produtividade por motorista num período em meses: viagens finalizadas,
 * entregas, entregas no prazo e peso. Frete e comissão só vêm para o
 * administrador (`comValores`); para a operação a API nem manda os campos.
 * A tela só lê.
 */

// Para a operação as linhas vêm sem frete nem comissão.
type Linha = Omit<ProdutividadeDoMotorista, "frete" | "comissaoPct" | "comissao"> & Partial<Pick<ProdutividadeDoMotorista, "frete" | "comissaoPct" | "comissao">>;

type Resposta = { periodo: { de: string; ate: string }; comValores: boolean; motoristas: Linha[] };

const FALHA = "Não foi possível carregar a produtividade.";
const CAMPO = "min-w-0 w-full px-2 py-1.5 md:px-3 md:py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-950";

const porcento = (valor: number | null | undefined) => (valor === null || valor === undefined ? "-" : `${valor.toLocaleString("pt-BR")}%`);

export function Produtividade() {
  const [periodo, setPeriodo] = useState(periodoDoRelatorio);
  const [resposta, setResposta] = useState<Resposta | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    fetch(`/api/equipe/produtividade?de=${encodeURIComponent(periodo.de)}&ate=${encodeURIComponent(periodo.ate)}`)
      .then(async (res) => {
        const corpo = await res.json().catch(() => null);
        if (!ativo) return;
        if (!res.ok) return setErro(typeof corpo?.error === "string" ? corpo.error : FALHA);
        setErro(null);
        setResposta(corpo as Resposta);
      })
      .catch(() => {
        if (ativo) setErro(FALHA);
      });
    return () => {
      ativo = false;
    };
  }, [periodo]);

  const mudarPeriodo = (campo: "de" | "ate", valor: string) => {
    // Campo de mês apagado manda vazio: fica o que estava.
    if (!valor) return;
    setResposta(null);
    setErro(null);
    setPeriodo((atual) => ({ ...atual, [campo]: valor }));
  };

  const comValores = resposta?.comValores ?? false;
  const totalDeComissao = (resposta?.motoristas ?? []).reduce((soma, linha) => soma + (linha.comissao ?? 0), 0);

  return (
    <div className="space-y-3 md:space-y-4">
      <div className="flex items-end justify-between gap-2">
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
        {comValores && (
          <p className="text-right text-xs text-gray-500" data-resumo="comissao">
            Comissão do período
            <strong className="block text-base text-gray-900 dark:text-white">{formatCurrency(totalDeComissao)}</strong>
          </p>
        )}
      </div>

      {erro && (
        <div role="alert" className="px-4 py-3 text-sm text-red-700 border border-red-200 rounded-lg bg-red-50">
          {erro}
        </div>
      )}

      {!resposta && !erro && (
        <div className="flex items-center justify-center h-32" role="status" aria-label="Carregando">
          <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
        </div>
      )}

      {resposta && (
        <div className={`${CARD} overflow-hidden`}>
          {resposta.motoristas.length === 0 ? (
            <p className="p-8 text-center text-sm text-gray-500">Nenhum motorista cadastrado.</p>
          ) : (
            <table className={TABELA}>
              <thead className={THEAD}>
                <tr>
                  <th className={TH}>Motorista</th>
                  <th className={`${TH} text-right`}>Viagens</th>
                  <th className={`${TH} text-right`}>Entregas</th>
                  <th className={`${TH} text-right`}>No prazo</th>
                  <th className={`${TH} text-right`}>Peso</th>
                  {comValores && <th className={`${TH} text-right`}>Frete entregue</th>}
                  {comValores && <th className={`${TH} text-right`}>Comissão</th>}
                </tr>
              </thead>
              <tbody className={TBODY}>
                {resposta.motoristas.map((linha) => (
                  <tr key={linha.driverId || "sem-motorista"} data-motorista={linha.driverId || "sem-motorista"} className={TR}>
                    <td className={`${TD} col-span-2 font-medium text-gray-900 dark:text-white`}>{linha.nome}</td>
                    <td data-rotulo="Viagens" className={`${TD} ${COM_ROTULO} md:text-right text-gray-600 dark:text-gray-300`}>{linha.viagens}</td>
                    <td data-rotulo="Entregas" className={`${TD} ${COM_ROTULO} md:text-right text-gray-600 dark:text-gray-300`}>{linha.entregas}</td>
                    <td data-rotulo="No prazo" className={`${TD} ${COM_ROTULO} md:text-right text-gray-600 dark:text-gray-300`}>
                      {linha.noPrazo} ({porcento(linha.taxaNoPrazo)})
                    </td>
                    <td data-rotulo="Peso" className={`${TD} ${COM_ROTULO} md:text-right text-gray-600 dark:text-gray-300`}>{formatWeight(linha.peso)}</td>
                    {comValores && (
                      <td data-rotulo="Frete entregue" className={`${TD} ${COM_ROTULO} md:text-right text-gray-900 dark:text-white`}>{formatCurrency(linha.frete ?? 0)}</td>
                    )}
                    {comValores && (
                      <td data-rotulo="Comissão" className={`${TD} ${COM_ROTULO} md:text-right text-gray-900 dark:text-white`}>
                        {linha.comissao === null || linha.comissao === undefined ? "Sem comissão" : `${formatCurrency(linha.comissao)} (${porcento(linha.comissaoPct)})`}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="px-3 py-2 md:px-4 md:py-3 text-xs text-gray-500 border-t border-gray-100 dark:border-gray-800">
            Viagens finalizadas e cargas entregues no período. O prazo é o da tabela de frete, da coleta à entrega; entrega sem medição fica fora do percentual.
            {comValores ? " A comissão é o percentual do cadastro do motorista sobre o frete das cargas que ele entregou." : ""}
          </p>
        </div>
      )}
    </div>
  );
}
