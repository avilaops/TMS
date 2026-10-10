"use client";

import { useRef, useState } from "react";
import { Camera, Loader2, Plus } from "lucide-react";
import { MAXIMO_POR_TIPO, PHOTO_MESSAGE, ROTULO_DA_FOTO, cabeMaisUma, type FotoEnviada, type TipoDeFoto } from "@/lib/comprovantes";
import { FotoRecusada, reduzirFoto } from "@/lib/foto";

/**
 * Cartão de um tipo de foto do comprovante no aplicativo do motorista: um
 * botão grande que abre a câmera traseira e, depois de tirar, a miniatura com
 * "Trocar" e "Remover". A foto é reduzida no aparelho antes de entrar na lista
 * (src/lib/foto.ts). `fotos` é a lista inteira do comprovante: o cartão mexe só
 * nas do seu tipo e respeita o limite por tipo e o total.
 */
export function CartaoDeFoto({
  tipo,
  fotos,
  onChange,
  obrigatoria = false,
  rotulo = ROTULO_DA_FOTO[tipo],
}: {
  tipo: TipoDeFoto;
  fotos: readonly FotoEnviada[];
  onChange: (fotos: FotoEnviada[]) => void;
  obrigatoria?: boolean;
  rotulo?: string;
}) {
  const campo = useRef<HTMLInputElement>(null);
  // Posição, na lista inteira, da foto que a próxima captura substitui; `null` = acrescenta.
  const trocando = useRef<number | null>(null);
  const [preparando, setPreparando] = useState(false);
  const [erro, setErro] = useState("");

  const doTipo = fotos.flatMap((foto, posicao) => (foto.kind === tipo ? [{ foto, posicao }] : []));
  const cabeOutra = cabeMaisUma(fotos.map((foto) => foto.kind), tipo);

  const abrirCamera = (posicao: number | null) => {
    trocando.current = posicao;
    campo.current?.click();
  };

  const capturar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const arquivo = input.files?.[0];
    // Limpa o campo: tirar a mesma foto de novo precisa disparar a troca.
    input.value = "";
    if (!arquivo) return;

    setPreparando(true);
    setErro("");
    try {
      const nova: FotoEnviada = { kind: tipo, dataUrl: await reduzirFoto(arquivo) };
      const posicao = trocando.current;
      onChange(posicao === null ? [...fotos, nova] : fotos.map((foto, i) => (i === posicao ? nova : foto)));
    } catch (falha) {
      // Foto que não abriu não substitui a que já estava boa.
      setErro(falha instanceof FotoRecusada ? falha.message : PHOTO_MESSAGE);
    } finally {
      setPreparando(false);
    }
  };

  return (
    <div data-cartao-de-foto={tipo} className="min-w-0 space-y-1.5">
      {/* `capture="environment"`: abre direto a câmera traseira. */}
      <input ref={campo} type="file" accept="image/*" capture="environment" onChange={capturar} className="hidden" aria-label={rotulo} />

      {doTipo.length === 0 ? (
        <button
          type="button"
          onClick={() => abrirCamera(null)}
          disabled={preparando}
          className={`w-full min-h-[92px] rounded-2xl border-2 border-dashed px-2 py-3 flex flex-col items-center justify-center gap-1 text-sm font-medium ${
            obrigatoria ? "border-blue-400 bg-blue-50 text-blue-800" : "border-gray-300 bg-white text-gray-700"
          }`}
        >
          {preparando ? <Loader2 className="w-6 h-6 animate-spin" /> : <Camera className="w-6 h-6" />}
          <span className="text-center leading-tight">{preparando ? "Preparando a foto…" : rotulo}</span>
          {obrigatoria && !preparando && <span className="text-[11px] font-semibold uppercase tracking-wide">Obrigatória</span>}
        </button>
      ) : (
        <div className="rounded-2xl border border-gray-200 bg-white p-2 space-y-2">
          <p className="text-xs font-medium text-gray-700 flex items-center justify-between gap-2">
            <span className="truncate">{rotulo}</span>
            <span className="shrink-0 text-gray-400">
              {doTipo.length}/{MAXIMO_POR_TIPO[tipo]}
            </span>
          </p>
          {doTipo.map(({ foto, posicao }, ordem) => (
            <div key={posicao} className="flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element -- imagem embutida (data URL), não há o que otimizar */}
              <img src={foto.dataUrl} alt={`${rotulo} ${ordem + 1}`} className="w-14 h-14 rounded-xl object-cover border border-gray-200 shrink-0" />
              <div className="flex flex-col items-start text-sm">
                <button type="button" onClick={() => abrirCamera(posicao)} disabled={preparando} className="py-0.5 font-medium text-blue-700">
                  Trocar
                </button>
                <button type="button" onClick={() => onChange(fotos.filter((_, i) => i !== posicao))} disabled={preparando} className="py-0.5 font-medium text-red-600">
                  Remover
                </button>
              </div>
            </div>
          ))}
          {cabeOutra && (
            <button type="button" onClick={() => abrirCamera(null)} disabled={preparando} className="w-full py-1.5 rounded-xl border border-gray-200 text-xs font-medium text-gray-700 flex items-center justify-center gap-1">
              {preparando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              {preparando ? "Preparando…" : "Outra foto"}
            </button>
          )}
        </div>
      )}

      {erro && (
        <p role="alert" className="text-xs text-red-600">
          {erro}
        </p>
      )}
    </div>
  );
}
