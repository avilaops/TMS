"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, MapPin, ScanLine, Warehouse } from "lucide-react";
import { formatWeight } from "@/lib/format";
import {
  ALERTAS_DO_DEPOSITO,
  ROTULO_DO_ALERTA,
  buscarNoDeposito,
  type AlertaDoDeposito,
  type CargaNoDeposito,
  type ContadoresDoDeposito,
} from "@/lib/deposito";
import { deniedReason, type DeniedReason } from "../financeiro/carregar";
import { BOTAO_AZUL, BOTAO_CLARO, CARD, INPUT, Negado, ROTULO, erroDe, quando } from "./comum";

/**
 * Visão do depósito: o que está lá agora (cargas coletadas ainda sem
 * manifesto), com os volumes, a posição, a data de entrada e os dias parada.
 * Os cartões do topo contam cargas e volumes e cada alerta; tocar num alerta
 * filtra a lista. A busca é por código, cliente ou posição. A tela só lê;
 * conferir e alocar ficam na conferência.
 */

type Visao = { diasDeAlerta: number; contadores: ContadoresDoDeposito; cargas: CargaNoDeposito[] };

type Dados = { denied: DeniedReason } | { denied: null; erro: string } | { denied: null; erro: null; visao: Visao };

const FALHA = "Não foi possível carregar o depósito.";

// Rótulo curto de cada alerta, para o cartão e para a etiqueta na linha da carga.
const ALERTA_CURTO: Record<AlertaDoDeposito, string> = {
  PARADA: "Paradas",
  DIVERGENCIA: "Divergência",
  AVARIA: "Avaria",
  SEM_POSICAO: "Sem posição",
};

const COR_DO_ALERTA: Record<AlertaDoDeposito, string> = {
  PARADA: "bg-red-100 text-red-700",
  DIVERGENCIA: "bg-amber-100 text-amber-800",
  AVARIA: "bg-amber-100 text-amber-800",
  SEM_POSICAO: "bg-sky-100 text-sky-800",
};

async function carregar(): Promise<Dados> {
  try {
    const res = await fetch("/api/deposito");
    const denied = deniedReason(res.status);
    if (denied) return { denied };
    if (!res.ok) return { denied: null, erro: await erroDe(res, FALHA) };
    return { denied: null, erro: null, visao: (await res.json()) as Visao };
  } catch {
    return { denied: null, erro: FALHA };
  }
}

/** "3 de 3", ou o que chegou e o que falta, ou só o declarado quando não houve conferência. */
function volumesDe(carga: CargaNoDeposito) {
  if (!carga.conferencia) return `${carga.volumes} (sem conferência)`;
  const { receivedVolumes, damagedVolumes, missingVolumes } = carga.conferencia;
  const partes = [`${receivedVolumes + damagedVolumes} de ${carga.volumes}`];
  if (damagedVolumes > 0) partes.push(`${damagedVolumes} avariado${damagedVolumes > 1 ? "s" : ""}`);
  if (missingVolumes > 0) partes.push(`${missingVolumes} faltando`);
  return partes.join(" · ");
}

const diasDe = (dias: number) => (dias === 0 ? "hoje" : dias === 1 ? "1 dia" : `${dias} dias`);

export default function DepositoPage() {
  const [dados, setDados] = useState<Dados | null>(null);
  const [busca, setBusca] = useState("");
  const [alerta, setAlerta] = useState<AlertaDoDeposito | null>(null);

  const recarregar = useCallback(async () => setDados(await carregar()), []);

  useEffect(() => {
    let ativo = true;
    carregar().then((resultado) => {
      if (ativo) setDados(resultado);
    });
    return () => {
      ativo = false;
    };
  }, []);

  if (dados && dados.denied !== null) return <Negado motivo={dados.denied} />;

  const visao = dados && dados.denied === null && dados.erro === null ? dados.visao : null;
  const filtradas = visao ? buscarNoDeposito(visao.cargas, busca).filter((carga) => alerta === null || carga.alertas.includes(alerta)) : [];

  return (
    <div className="space-y-3 md:space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold font-outfit text-gray-900 dark:text-white">Depósito</h1>
          <p className="hidden md:block text-gray-500 text-sm mt-1">Cargas coletadas que ainda não saíram em viagem</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Link href="/dashboard/deposito/posicoes" className={BOTAO_CLARO}>
            <MapPin className="w-4 h-4" />
            Posições
          </Link>
          <Link href="/dashboard/deposito/conferencia" className={BOTAO_AZUL}>
            <ScanLine className="w-4 h-4" />
            Conferir
          </Link>
        </div>
      </div>

      {!dados && (
        <div className="flex items-center justify-center h-[300px]" role="status" aria-label="Carregando">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        </div>
      )}

      {dados && dados.denied === null && dados.erro !== null && (
        <div role="alert" className="px-4 py-3 text-sm text-red-700 border border-red-200 rounded-lg bg-red-50">
          {dados.erro}{" "}
          <button type="button" onClick={() => void recarregar()} className="font-medium underline">
            Tentar de novo
          </button>
        </div>
      )}

      {visao && (
        <>
          {/* Cargas e volumes só contam; os quatro alertas também filtram: tocar de novo tira o filtro. */}
          <div className="grid grid-cols-3 md:grid-cols-6 gap-1.5 md:gap-4">
            <div data-contador="cargas" className={`${CARD} min-w-0 px-1 py-2 md:p-4 text-center md:text-left`}>
              <p className="text-lg md:text-2xl font-bold text-gray-900 dark:text-white">{visao.contadores.cargas}</p>
              <p className="text-[10px] md:text-sm leading-tight text-gray-500 truncate">Cargas</p>
            </div>
            <div data-contador="volumes" className={`${CARD} min-w-0 px-1 py-2 md:p-4 text-center md:text-left`}>
              <p className="text-lg md:text-2xl font-bold text-gray-900 dark:text-white">{visao.contadores.volumes}</p>
              <p className="text-[10px] md:text-sm leading-tight text-gray-500 truncate">Volumes</p>
            </div>
            {ALERTAS_DO_DEPOSITO.map((tipo) => (
              <button
                key={tipo}
                type="button"
                data-contador={tipo}
                aria-pressed={alerta === tipo}
                title={ROTULO_DO_ALERTA[tipo]}
                onClick={() => setAlerta(alerta === tipo ? null : tipo)}
                className={`${CARD} min-w-0 px-1 py-2 md:p-4 text-center md:text-left ${alerta === tipo ? "ring-2 ring-blue-500 border-blue-500" : ""}`}
              >
                <p className={`text-lg md:text-2xl font-bold ${visao.contadores[tipo] > 0 ? "text-red-600" : "text-gray-900 dark:text-white"}`}>{visao.contadores[tipo]}</p>
                <p className="text-[10px] md:text-sm leading-tight text-gray-500 truncate">{ALERTA_CURTO[tipo]}</p>
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <input
              type="search"
              aria-label="Buscar por código, cliente ou posição"
              placeholder="Código, cliente ou posição"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className={INPUT}
            />
            {(busca || alerta) && (
              <button
                type="button"
                onClick={() => {
                  setBusca("");
                  setAlerta(null);
                }}
                className="shrink-0 text-sm text-blue-600 hover:underline"
              >
                Limpar
              </button>
            )}
          </div>

          <div className={`${CARD} overflow-hidden`}>
            {filtradas.length === 0 ? (
              <div className="p-10 text-center text-gray-500">
                <Warehouse className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                <p>{visao.cargas.length === 0 ? "Nenhuma carga no depósito agora." : "Nenhuma carga com este filtro."}</p>
              </div>
            ) : (
              <table className="block md:table w-full text-sm">
                <thead className="hidden md:table-header-group bg-gray-50 dark:bg-gray-950 text-gray-500 text-left">
                  <tr>
                    <th className="px-4 py-3 font-medium">Carga</th>
                    <th className="px-4 py-3 font-medium">Destino</th>
                    <th className="px-4 py-3 font-medium">Volumes</th>
                    <th className="px-4 py-3 font-medium">Posição</th>
                    <th className="px-4 py-3 font-medium">Entrada</th>
                    <th className="px-4 py-3 font-medium">Parada</th>
                    <th className="px-4 py-3 font-medium">Alertas</th>
                    <th className="px-4 py-3 font-medium">Ações</th>
                  </tr>
                </thead>
                <tbody className="block md:table-row-group divide-y divide-gray-100 dark:divide-gray-800">
                  {filtradas.map((carga) => (
                    <tr key={carga.id} data-carga={carga.id} className="grid grid-cols-2 gap-x-3 gap-y-1.5 px-3 py-2.5 md:table-row">
                      <td className="col-span-2 min-w-0 md:table-cell md:px-4 md:py-3">
                        <p className="font-medium text-gray-900 dark:text-white truncate">{carga.cliente}</p>
                        <p className="font-mono text-xs text-gray-500">{carga.trackingCode ?? "sem código"}</p>
                      </td>
                      <td data-rotulo="Destino" className={`min-w-0 md:table-cell md:px-4 md:py-3 text-gray-700 dark:text-gray-300 truncate ${ROTULO}`}>
                        {carga.destination}
                      </td>
                      <td data-rotulo="Volumes" className={`min-w-0 md:table-cell md:px-4 md:py-3 text-gray-700 dark:text-gray-300 ${ROTULO}`}>
                        {volumesDe(carga)}
                        <span className="block text-xs text-gray-500">{formatWeight(carga.weight)}</span>
                      </td>
                      <td data-rotulo="Posição" className={`min-w-0 md:table-cell md:px-4 md:py-3 font-mono text-xs text-gray-700 dark:text-gray-300 ${ROTULO}`}>
                        {carga.posicoes.length > 0 ? carga.posicoes.join(", ") : <span className="font-sans text-gray-400">sem posição</span>}
                      </td>
                      <td data-rotulo="Entrada" className={`min-w-0 md:table-cell md:px-4 md:py-3 text-gray-600 dark:text-gray-300 whitespace-nowrap ${ROTULO}`}>
                        {quando(carga.entrouEm)}
                      </td>
                      <td
                        data-rotulo="Parada"
                        className={`min-w-0 md:table-cell md:px-4 md:py-3 whitespace-nowrap ${carga.dias > visao.diasDeAlerta ? "text-red-600 font-semibold" : "text-gray-600 dark:text-gray-300"} ${ROTULO}`}
                      >
                        {diasDe(carga.dias)}
                      </td>
                      <td className="col-span-2 min-w-0 md:table-cell md:px-4 md:py-3">
                        <div className="flex flex-wrap gap-1">
                          {carga.alertas.map((tipo) => (
                            <span key={tipo} data-alerta={tipo} title={ROTULO_DO_ALERTA[tipo]} className={`text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap ${COR_DO_ALERTA[tipo]}`}>
                              {ROTULO_DO_ALERTA[tipo]}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="col-span-2 min-w-0 md:table-cell md:px-4 md:py-3">
                        {carga.trackingCode && (
                          <div className="flex gap-3 text-sm">
                            <Link href={`/dashboard/deposito/conferencia?codigo=${carga.trackingCode}`} className="font-medium text-blue-600 hover:underline">
                              Conferir
                            </Link>
                            <Link href={`/dashboard/deposito/etiquetas/${carga.id}`} className="text-blue-600 hover:underline">
                              Etiquetas
                            </Link>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
