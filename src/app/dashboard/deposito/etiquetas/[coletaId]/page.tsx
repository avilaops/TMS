"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Printer } from "lucide-react";
import { MAX_VOLUMES_CONFERIVEIS, type CargaConferida } from "@/lib/deposito";
import { deniedReason, type DeniedReason } from "../../../financeiro/carregar";
import { BOTAO_AZUL, CodigoDeBarras, Negado, erroDe } from "../../comum";

/**
 * Etiquetas da carga: uma por volume, com cliente, destino, destinatário,
 * "volume 2 de 3", o código legível e o código de barras (Code 128, desenhado
 * em SVG por src/lib/code128.ts). É o código que a conferência lê.
 *
 * Na impressão só as etiquetas saem: o menu e o cabeçalho do painel somem pelo
 * estilo de impressão abaixo, que vale só nesta página.
 */

type Dados = { denied: DeniedReason } | { denied: null; erro: string } | { denied: null; erro: null; carga: CargaConferida };

const FALHA = "Não foi possível carregar as etiquetas.";

// Tudo o que não é etiqueta fica invisível no papel, e as etiquetas sobem para
// o canto da folha. Duas por linha numa A4; nenhuma é cortada entre páginas.
const ESTILO_DE_IMPRESSAO = `
@media print {
  body * { visibility: hidden; }
  [data-etiquetas], [data-etiquetas] * { visibility: visible; }
  [data-etiquetas] { position: absolute; left: 0; top: 0; width: 100%; }
  [data-etiqueta] { break-inside: avoid; }
}
@page { margin: 8mm; }
`;

export default function EtiquetasPage({ params }: { params: Promise<{ coletaId: string }> }) {
  const { coletaId } = use(params);
  const [dados, setDados] = useState<Dados | null>(null);

  useEffect(() => {
    let ativo = true;
    fetch(`/api/deposito/coletas/${coletaId}`)
      .then(async (res): Promise<Dados> => {
        const denied = deniedReason(res.status);
        if (denied) return { denied };
        if (!res.ok) return { denied: null, erro: await erroDe(res, FALHA) };
        return { denied: null, erro: null, carga: (await res.json()) as CargaConferida };
      })
      .catch((): Dados => ({ denied: null, erro: FALHA }))
      .then((resultado) => {
        if (ativo) setDados(resultado);
      });
    return () => {
      ativo = false;
    };
  }, [coletaId]);

  if (!dados) {
    return (
      <div className="flex justify-center py-16" role="status" aria-label="Carregando">
        <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
      </div>
    );
  }

  if (dados.denied !== null) return <Negado motivo={dados.denied} />;

  const voltar = (
    <Link href="/dashboard/deposito" className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-300">
      <ArrowLeft className="w-4 h-4" />
      Depósito
    </Link>
  );

  if (dados.erro !== null) {
    return (
      <div className="space-y-4">
        {voltar}
        <p role="alert" className="px-4 py-3 text-sm text-red-700 border border-red-200 rounded-lg bg-red-50">
          {dados.erro}
        </p>
      </div>
    );
  }

  const { carga, volumes } = dados.carga;

  return (
    <div className="space-y-3 md:space-y-6">
      <style>{ESTILO_DE_IMPRESSAO}</style>

      <div className="flex items-center justify-between gap-3">
        {voltar}
        {volumes.length > 0 && (
          <button type="button" onClick={() => window.print()} className={BOTAO_AZUL}>
            <Printer className="w-4 h-4" />
            Imprimir
          </button>
        )}
      </div>

      {volumes.length === 0 ? (
        <p role="alert" className="px-4 py-3 text-sm text-amber-800 border border-amber-200 rounded-lg bg-amber-50">
          {carga.trackingCode
            ? `Esta carga tem mais de ${MAX_VOLUMES_CONFERIVEIS} volumes: não é etiquetada volume a volume.`
            : "Esta carga não tem código de rastreio: não há o que imprimir na etiqueta."}
        </p>
      ) : (
        <div data-etiquetas className="grid grid-cols-1 sm:grid-cols-2 gap-3 print:grid-cols-2 print:gap-[4mm]">
          {volumes.map((volume) => (
            <article key={volume.sequence} data-etiqueta={volume.code} className="bg-white text-black border border-gray-400 rounded-lg p-3 flex flex-col gap-1.5">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-bold leading-tight break-words min-w-0">{carga.cliente}</p>
                <p className="shrink-0 text-sm font-bold whitespace-nowrap">
                  Volume {volume.sequence} de {carga.volumes}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-gray-600 leading-tight">Destino</p>
                <p className="text-lg font-bold leading-tight break-words">{carga.destination}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-gray-600 leading-tight">Destinatário</p>
                <p className="text-sm leading-tight break-words">{carga.receiver}</p>
              </div>
              <CodigoDeBarras texto={volume.code} className="h-14 w-full mt-1" />
              <p className="text-center font-mono text-base font-semibold tracking-widest leading-none">{volume.code}</p>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
