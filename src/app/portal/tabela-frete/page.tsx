"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Search, TableProperties } from "lucide-react";
import { formatCurrency } from "@/lib/format";
import { chaveDaCidade } from "@/lib/frete";
import { prazoPorExtenso, type CidadeAtendida } from "@/lib/portal-cliente";
import { readPortal } from "../types";
import { CAMPO, NaoCarregou } from "../comum";

/**
 * A tabela de frete do cliente, só para leitura: cidades atendidas, frete
 * mínimo e prazo. O valor de uma carga específica sai na Cotação.
 */

type Tabela = { temTabela: boolean; cidades: CidadeAtendida[] };

export default function PortalTabelaDeFretePage() {
  const [tabela, setTabela] = useState<Tabela | null>(null);
  const [erro, setErro] = useState("");
  const [busca, setBusca] = useState("");

  useEffect(() => {
    fetch("/api/portal/tabela-frete")
      .then((r) => readPortal<Tabela>(r))
      .then(setTabela)
      .catch((e: Error) => setErro(e.message));
  }, []);

  if (erro) return <NaoCarregou mensagem={erro} />;

  // Mesma chave da cotação: "sao jose" acha "São José do Rio Preto".
  const procurada = chaveDaCidade(busca);
  const cidades = (tabela?.cidades ?? []).filter((cidade) => chaveDaCidade(cidade.city).includes(procurada));

  return (
    <div className="space-y-3 md:space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-outfit font-bold text-gray-900">Tabela de frete</h1>
          <p className="hidden md:block text-gray-500">Cidades atendidas, frete mínimo e prazo da sua tabela.</p>
        </div>
        <Link href="/portal/cotacao" className="text-sm font-medium text-orange-600 hover:underline">
          Fazer uma cotação
        </Link>
      </div>

      {tabela && tabela.cidades.length > 0 && (
        <label className="relative block max-w-sm">
          <span className="sr-only">Procurar cidade</span>
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Procurar cidade" className={`${CAMPO} pl-9`} />
        </label>
      )}

      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        {!tabela ? (
          <p className="p-6 text-gray-500">Carregando…</p>
        ) : tabela.cidades.length === 0 ? (
          <div className="p-10 text-center">
            <TableProperties className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-600">
              {tabela.temTabela
                ? "A sua tabela de frete ainda não tem cidades cadastradas."
                : "Ainda não há tabela de frete em vigor para a sua empresa. A transportadora informa o valor a cada coleta."}
            </p>
          </div>
        ) : cidades.length === 0 ? (
          <p className="p-6 text-gray-600 text-sm">Nenhuma cidade com esse nome na sua tabela.</p>
        ) : (
          <table className="block md:table w-full text-sm">
            <thead className="hidden md:table-header-group bg-gray-50 text-gray-500 text-left">
              <tr>
                <th className="px-6 py-3 font-medium">Cidade</th>
                <th className="px-6 py-3 font-medium">Frete mínimo</th>
                <th className="px-6 py-3 font-medium">Prazo</th>
              </tr>
            </thead>
            <tbody className="block md:table-row-group divide-y divide-gray-100">
              {cidades.map((cidade) => (
                <tr key={cidade.city} data-cidade={cidade.city} className="grid grid-cols-2 gap-x-3 gap-y-0.5 px-3 py-2 md:table-row">
                  <td className="col-span-2 min-w-0 md:table-cell md:px-6 md:py-3 font-medium text-gray-900">
                    {cidade.city}
                    {cidade.dedicated && <span className="ml-2 text-xs font-normal text-amber-700">só com veículo dedicado</span>}
                  </td>
                  <td data-rotulo="Frete mínimo" className="min-w-0 md:table-cell md:px-6 md:py-3 text-gray-700 before:content-[attr(data-rotulo)] before:block before:text-[11px] before:text-gray-500 md:before:content-none">
                    {formatCurrency(cidade.minimum)}
                  </td>
                  <td data-rotulo="Prazo" className="min-w-0 md:table-cell md:px-6 md:py-3 text-gray-700 before:content-[attr(data-rotulo)] before:block before:text-[11px] before:text-gray-500 md:before:content-none">
                    {prazoPorExtenso(cidade.deadlineHours)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-xs text-gray-500">
        O frete mínimo vale para a carga dentro do peso coberto pela tabela. Peso, volumes e valor da nota podem mudar o valor final: use a Cotação.
      </p>
    </div>
  );
}
