"use client";

import { useEffect, useState } from "react";
import { Download, Loader2, Printer } from "lucide-react";
import { formatCurrency } from "@/lib/format";
import { CONTRACT_STATUS, type Fechamento } from "@/lib/frete-contratado";
import { periodoDoRelatorio } from "@/lib/relatorios";

/**
 * O fechamento de um parceiro: as viagens dele no período, com bruto,
 * retenções, pago e saldo de cada uma, e o total. É o que o agregado confere no
 * fim do mês. Abre pela lista de parceiros, para quem lê o frete contratado.
 *
 * O período é em meses, como nos relatórios. "Exportar" baixa o mesmo quadro em
 * CSV; "Imprimir" usa a impressão do navegador (só este quadro sai no papel).
 */

type Resposta = Fechamento & { periodo: { de: string; ate: string }; parceiro: { id: string; name: string } };

const CAMPO = "min-w-0 w-full px-2 py-1.5 md:px-3 md:py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-950";
const BOTAO_CLARO = "inline-flex items-center justify-center gap-1.5 border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-200 px-3 py-1.5 rounded-xl";
const VALOR = "min-w-0 md:table-cell md:px-3 md:py-2 md:text-right tabular-nums before:content-[attr(data-rotulo)] before:block before:text-[11px] before:font-normal before:text-gray-500 md:before:content-none";

// No papel só o fechamento sai: o menu, a lista de parceiros e os botões ficam invisíveis.
const ESTILO_DE_IMPRESSAO = `
@media print {
  body * { visibility: hidden; }
  [data-fechamento], [data-fechamento] * { visibility: visible; }
  [data-fechamento] { position: absolute; left: 0; top: 0; width: 100%; max-height: none; overflow: visible; }
  [data-fechamento] [data-nao-imprimir] { display: none; }
}
`;

const diaPorExtenso = (dia: string) => dia.split("-").reverse().join("/");

export function FechamentoDoParceiro({ parceiro, onClose }: { parceiro: { id: string; name: string }; onClose: () => void }) {
  const [periodo, setPeriodo] = useState(periodoDoRelatorio);
  const [estado, setEstado] = useState<{ erro: string } | Resposta | null>(null);
  const endereco = `/api/parceiros/${parceiro.id}/fechamento?de=${encodeURIComponent(periodo.de)}&ate=${encodeURIComponent(periodo.ate)}`;

  useEffect(() => {
    let ativo = true;
    fetch(endereco)
      .then(async (res) => {
        if (!ativo) return;
        const corpo = await res.json().catch(() => null);
        if (res.ok) setEstado(corpo as Resposta);
        else if (res.status === 403) setEstado({ erro: "Seu perfil não tem acesso ao fechamento." });
        else setEstado({ erro: typeof corpo?.error === "string" ? corpo.error : "Não foi possível carregar o fechamento." });
      })
      .catch(() => {
        if (ativo) setEstado({ erro: "Não foi possível carregar o fechamento." });
      });
    return () => {
      ativo = false;
    };
  }, [endereco]);

  const mudarPeriodo = (campo: "de" | "ate", valor: string) => {
    // Campo de mês apagado manda vazio: fica o que estava.
    if (!valor) return;
    setEstado(null);
    setPeriodo((atual) => ({ ...atual, [campo]: valor }));
  };

  const pronto = estado && !("erro" in estado) ? estado : null;

  return (
    <div className="fixed inset-0 z-50 flex items-stretch md:items-center justify-center md:p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
      <style>{ESTILO_DE_IMPRESSAO}</style>
      <div
        role="dialog"
        aria-label={`Fechamento de ${parceiro.name}`}
        data-fechamento
        className="bg-white dark:bg-gray-900 md:rounded-2xl w-full max-w-4xl md:max-h-[90vh] overflow-hidden flex flex-col shadow-2xl border border-gray-100 dark:border-gray-800"
      >
        <div className="px-3 py-2 md:px-6 md:py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-base md:text-xl font-bold font-outfit text-gray-900 dark:text-white truncate">Fechamento</h2>
            <p className="text-xs text-gray-500 truncate">
              {parceiro.name} · {periodo.de.split("-").reverse().join("/")} a {periodo.ate.split("-").reverse().join("/")}
            </p>
          </div>
          <button onClick={onClose} aria-label="Fechar" data-nao-imprimir className="shrink-0 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 md:p-6 space-y-2.5">
          <div data-nao-imprimir className="flex items-end gap-2">
            <label className="min-w-0 flex-1 text-xs text-gray-500">
              De
              <input type="month" value={periodo.de} onChange={(e) => mudarPeriodo("de", e.target.value)} className={`${CAMPO} block mt-0.5`} />
            </label>
            <label className="min-w-0 flex-1 text-xs text-gray-500">
              Até
              <input type="month" value={periodo.ate} onChange={(e) => mudarPeriodo("ate", e.target.value)} className={`${CAMPO} block mt-0.5`} />
            </label>
            <a href={`${endereco}&formato=csv`} data-exportar-fechamento aria-label="Exportar CSV" className={BOTAO_CLARO}>
              <Download className="w-4 h-4" /> <span className="hidden md:inline">Exportar</span>
            </a>
            <button type="button" onClick={() => window.print()} aria-label="Imprimir" className={BOTAO_CLARO}>
              <Printer className="w-4 h-4" /> <span className="hidden md:inline">Imprimir</span>
            </button>
          </div>

          {!estado && (
            <div className="flex justify-center py-6" role="status" aria-label="Carregando">
              <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
            </div>
          )}
          {estado && "erro" in estado && (
            <p role="alert" className="text-sm text-red-600">
              {estado.erro}
            </p>
          )}

          {pronto && (
            <>
              <dl data-total-do-fechamento className="grid grid-cols-4 gap-2 rounded-2xl border border-gray-200 dark:border-gray-700 px-3 py-2">
                {(
                  [
                    ["Viagens", String(pronto.total.viagens)],
                    ["Líquido", formatCurrency(pronto.total.liquido)],
                    ["Pago", formatCurrency(pronto.total.pago)],
                    ["Saldo", formatCurrency(pronto.total.saldo)],
                  ] as const
                ).map(([rotulo, valor]) => (
                  <div key={rotulo} data-linha={rotulo} className="min-w-0">
                    <dt className="text-[11px] text-gray-500">{rotulo}</dt>
                    <dd className="text-xs md:text-base font-bold text-gray-900 dark:text-white truncate">{valor}</dd>
                  </div>
                ))}
              </dl>
              <p className="text-[11px] text-gray-500">
                Bruto {formatCurrency(pronto.total.bruto)} · acréscimos {formatCurrency(pronto.total.acrescimos)} · descontos {formatCurrency(pronto.total.descontos)} · retenções{" "}
                {formatCurrency(pronto.total.retencoes)}
              </p>

              {pronto.linhas.length === 0 ? (
                <p className="text-sm text-gray-500">Nenhuma viagem com frete contratado neste período.</p>
              ) : (
                <table className="block md:table w-full text-sm">
                  <thead className="hidden md:table-header-group text-left text-xs text-gray-500">
                    <tr>
                      <th className="px-3 py-2 font-medium">Viagem</th>
                      <th className="px-3 py-2 font-medium">Situação</th>
                      <th className="px-3 py-2 font-medium text-right">Bruto</th>
                      <th className="px-3 py-2 font-medium text-right">Retenções</th>
                      <th className="px-3 py-2 font-medium text-right">Líquido</th>
                      <th className="px-3 py-2 font-medium text-right">Pago</th>
                      <th className="px-3 py-2 font-medium text-right">Saldo</th>
                    </tr>
                  </thead>
                  <tbody className="block md:table-row-group divide-y divide-gray-100 dark:divide-gray-800">
                    {pronto.linhas.map((linha) => {
                      const selo = CONTRACT_STATUS[linha.situacao] ?? { label: linha.situacao, className: "" };
                      return (
                        <tr key={linha.contratoId} data-contrato={linha.contratoId} className="grid grid-cols-4 gap-x-2 gap-y-1 px-1 py-2 md:table-row">
                          <td className="col-span-3 min-w-0 md:table-cell md:px-3 md:py-2">
                            <p className="font-medium text-gray-900 dark:text-white truncate">
                              #{linha.codigo} · {diaPorExtenso(linha.dia)}
                            </p>
                            <p className="text-xs text-gray-500 truncate">
                              {linha.placa} · {linha.motorista}
                            </p>
                          </td>
                          <td className="min-w-0 text-right md:text-left md:table-cell md:px-3 md:py-2">
                            <span className={`inline-block px-2 py-0.5 text-[11px] font-medium rounded-full border ${selo.className}`}>{selo.label}</span>
                          </td>
                          <td data-rotulo="Bruto" className={`hidden md:table-cell ${VALOR}`}>
                            {formatCurrency(linha.bruto)}
                          </td>
                          <td data-rotulo="Retenções" className={VALOR}>
                            {formatCurrency(linha.retencoes)}
                          </td>
                          <td data-rotulo="Líquido" className={VALOR}>
                            {formatCurrency(linha.liquido)}
                          </td>
                          <td data-rotulo="Pago" className={VALOR}>
                            {formatCurrency(linha.pago)}
                          </td>
                          <td data-rotulo="Saldo" className={`${VALOR} font-semibold`}>
                            {formatCurrency(linha.saldo)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
