"use client";

import { useEffect, useState } from "react";
import { Loader2, Wallet } from "lucide-react";
import { formatCurrency } from "@/lib/format";
import { EXPLICACAO_DO_PARCEIRO_NO_APP, EXPLICACAO_SEM_KM, type RemuneracaoDoMotorista, basesPorExtenso, mesAtual, mesPorExtenso, mesVizinho, parcelasPorExtenso } from "@/lib/remuneracao";

/**
 * O que as viagens finalizadas do motorista renderam no mês, e o total. Só
 * leitura, e só quando a empresa ligou isso em Empresa: com o interruptor
 * desligado a rota não manda valor nenhum e a tela diz que não está disponível.
 * O motorista escolhe entre este mês e o anterior.
 */

const dia = (data: string) => data.slice(5).split("-").reverse().join("/");

export default function RemuneracaoDoMotoristaPage() {
  const esteMes = mesAtual();
  const [mes, setMes] = useState(esteMes);
  const [estado, setEstado] = useState<{ erro: string } | RemuneracaoDoMotorista | null>(null);

  useEffect(() => {
    let ativo = true;
    fetch(`/api/driver/remuneracao?mes=${encodeURIComponent(mes)}`)
      .then(async (res) => {
        if (!ativo) return;
        const corpo = await res.json().catch(() => null);
        if (!res.ok) return setEstado({ erro: typeof corpo?.error === "string" ? corpo.error : "Não foi possível carregar os seus ganhos." });
        setEstado(corpo as RemuneracaoDoMotorista);
      })
      .catch(() => {
        if (ativo) setEstado({ erro: "Não foi possível carregar os seus ganhos." });
      });
    return () => {
      ativo = false;
    };
  }, [mes]);

  const trocar = (novo: string) => {
    if (novo === mes) return;
    setEstado(null);
    setMes(novo);
  };

  return (
    <div className="space-y-2 mt-4">
      {!estado ? (
        <div className="flex items-center justify-center h-40" role="status" aria-label="Carregando">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        </div>
      ) : "erro" in estado ? (
        <p role="alert" className="bg-white rounded-2xl p-4 text-sm text-red-700 shadow-sm">
          {estado.erro}
        </p>
      ) : !estado.visivel ? (
        <p data-ganhos="indisponivel" className="bg-white rounded-2xl p-4 text-sm text-gray-600 shadow-sm">
          Os ganhos por viagem não estão disponíveis no aplicativo. Fale com a empresa.
        </p>
      ) : (
        <>
          <div data-ganhos="total" className="bg-white rounded-2xl p-4 shadow-xl shadow-blue-900/5">
            <p className="flex items-center gap-2 text-sm text-gray-500">
              <Wallet className="w-4 h-4 text-blue-600" /> Meus ganhos em {mesPorExtenso(estado.mes)}
            </p>
            <p className="text-3xl font-bold text-gray-900">{formatCurrency(estado.total)}</p>
            <p className="text-xs text-gray-500">
              {estado.viagens.length} {estado.viagens.length === 1 ? "viagem finalizada" : "viagens finalizadas"} · {estado.fechado ? "mês fechado pela empresa" : "mês em aberto: o valor ainda pode mudar"}
            </p>
            <div role="tablist" aria-label="Mês" className="mt-2 grid grid-cols-2 gap-1 p-1 bg-gray-100 rounded-xl">
              {(
                [
                  [esteMes, "Este mês"],
                  [mesVizinho(esteMes, -1), "Mês anterior"],
                ] as const
              ).map(([valor, rotulo]) => (
                <button key={valor} type="button" role="tab" aria-selected={mes === valor} data-mes={valor} onClick={() => trocar(valor)} className={`py-1.5 rounded-lg text-sm font-semibold ${mes === valor ? "bg-white text-blue-700 shadow-sm" : "text-gray-600"}`}>
                  {rotulo}
                </button>
              ))}
            </div>
          </div>

          {estado.viagens.length === 0 ? (
            <p className="bg-white rounded-2xl p-4 text-sm text-gray-500 shadow-sm">Nenhuma viagem finalizada neste mês.</p>
          ) : (
            <ul className="space-y-2">
              {estado.viagens.map((viagem) => (
                <li key={viagem.manifestId} data-viagem={viagem.manifestId} className="bg-white rounded-2xl px-4 py-2.5 shadow-sm border border-gray-100">
                  <p className="flex justify-between gap-2">
                    <span className="min-w-0 truncate font-bold text-gray-900">
                      Viagem #{viagem.codigo} · {dia(viagem.finalizada)}
                    </span>
                    <span className="shrink-0 font-bold text-blue-700">{formatCurrency(viagem.total)}</span>
                  </p>
                  <p className="text-xs text-gray-500">
                    {viagem.placa} · {basesPorExtenso(viagem)}
                  </p>
                  <p className="text-xs text-gray-600">{viagem.fora === "PARCEIRO" ? EXPLICACAO_DO_PARCEIRO_NO_APP :parcelasPorExtenso(viagem) || "Sem valor nesta viagem"}</p>
                  {viagem.semKm && <p className="text-xs text-amber-700">{EXPLICACAO_SEM_KM}</p>}
                </li>
              ))}
            </ul>
          )}
          <p className="px-1 text-[11px] text-gray-500">Remuneração variável das viagens. Não inclui salário, encargos nem descontos: isso é com a empresa.</p>
        </>
      )}
    </div>
  );
}
