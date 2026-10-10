'use client';

import { useState } from 'react';
import { ROTULO_DA_FOTO, fotosPorTipo, type TipoDeFoto } from '@/lib/comprovantes';

/** A foto como a página (montada no servidor) entrega para esta parte da tela. */
export type FotoDaTela = {
  id: string;
  kind: TipoDeFoto;
  dataUrl: string;
  sha256: string | null;
  /** Data e hora já formatadas no fuso de São Paulo. */
  quando: string;
};

/** O SHA-256 da foto em texto pequeno; o toque copia. */
function Hash({ sha256 }: { sha256: string }) {
  const [copiado, setCopiado] = useState(false);

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(sha256);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Sem permissão de área de transferência: o texto continua selecionável.
    }
  };

  return (
    <button type="button" onClick={copiar} title="Copiar o SHA-256 da foto" data-sha256={sha256} className="block w-full text-left font-mono text-[10px] leading-tight text-gray-500 break-all select-all hover:text-gray-700">
      {copiado ? 'SHA-256 copiado' : `SHA-256 ${sha256}`}
    </button>
  );
}

/**
 * As fotos de um comprovante (ou de uma tentativa de entrega), agrupadas por
 * tipo. O toque amplia a foto na própria página: imagem embutida não abre em
 * outra aba. Embaixo de cada uma, quando foi tirada e o SHA-256 dos bytes.
 */
export function Fotos({ fotos, vazio = 'Nenhuma foto registrada' }: { fotos: FotoDaTela[]; vazio?: string }) {
  const [ampliada, setAmpliada] = useState<FotoDaTela | null>(null);

  if (fotos.length === 0) {
    return <div className="border rounded-md bg-gray-100 flex items-center justify-center h-32 text-gray-400">{vazio}</div>;
  }

  return (
    <div className="space-y-4">
      {fotosPorTipo(fotos).map(({ tipo, fotos: doTipo }) => (
        <div key={tipo} data-fotos={tipo}>
          <p className="text-sm text-gray-500 mb-2">
            {ROTULO_DA_FOTO[tipo]}
            {doTipo.length > 1 ? ` (${doTipo.length})` : ''}
          </p>
          <div className="grid grid-cols-2 gap-3">
            {doTipo.map((foto) => (
              <figure key={foto.id} className="min-w-0 space-y-1">
                <button
                  type="button"
                  onClick={() => setAmpliada(foto)}
                  aria-label={`Ampliar: ${ROTULO_DA_FOTO[tipo]}`}
                  className="block w-full border rounded-md overflow-hidden bg-gray-50 h-40 cursor-zoom-in"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- imagem embutida (data URL), não há o que otimizar */}
                  <img src={foto.dataUrl} alt={ROTULO_DA_FOTO[tipo]} className="w-full h-full object-contain" />
                </button>
                <figcaption className="space-y-0.5">
                  <span className="block text-xs text-gray-500">{foto.quando}</span>
                  {foto.sha256 ? <Hash sha256={foto.sha256} /> : <span className="block text-[10px] text-gray-400">Foto anterior ao registro do SHA-256</span>}
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      ))}

      {ampliada && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={ROTULO_DA_FOTO[ampliada.kind]}
          onClick={() => setAmpliada(null)}
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-3 cursor-zoom-out"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- imagem embutida (data URL), não há o que otimizar */}
          <img src={ampliada.dataUrl} alt={ROTULO_DA_FOTO[ampliada.kind]} className="max-w-full max-h-full object-contain" />
          <button type="button" onClick={() => setAmpliada(null)} className="absolute top-3 right-3 px-3 py-1.5 rounded-lg bg-white text-sm font-medium text-gray-900">
            Fechar
          </button>
        </div>
      )}
    </div>
  );
}
