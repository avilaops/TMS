"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Ruler, Trash2 } from "lucide-react";
import { calcularDimensoesDosVolumes, type UnidadeDeDimensao } from "@/lib/dimensoes-volume";

export type TotaisDasDimensoes = {
  volumes: number;
  cubicMeters: number;
  detailedWeight: number | null;
};

type Linha = {
  id: number;
  quantidade: string;
  comprimento: string;
  largura: string;
  altura: string;
  unidade: UnidadeDeDimensao;
  pesoUnitario: string;
};

const NOVA_LINHA = (id: number): Linha => ({
  id,
  quantidade: "1",
  comprimento: "",
  largura: "",
  altura: "",
  unidade: "cm",
  pesoUnitario: "",
});

const numero = (texto: string) => Number(texto.trim().replace(",", "."));
const formatar = (valor: number, casas = 6) =>
  valor.toLocaleString("pt-BR", { maximumFractionDigits: casas });

const INPUT = "min-w-0 w-full rounded-lg border border-gray-200 bg-white px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500";

export function EditorDeDimensoes({
  onChange,
  onInvalidChange,
}: {
  onChange: (totais: TotaisDasDimensoes | null) => void;
  onInvalidChange?: (invalidas: boolean) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const proximoId = useRef(1);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const completas = linhas.length > 0 && linhas.every((linha) => {
    const quantidade = numero(linha.quantidade);
    const positivoFinito = (valor: string) => Number.isFinite(numero(valor)) && numero(valor) > 0;
    const medidasValidas = [linha.comprimento, linha.largura, linha.altura].every(positivoFinito);
    const pesoValido = !linha.pesoUnitario.trim() || positivoFinito(linha.pesoUnitario);
    return Number.isInteger(quantidade) && quantidade > 0 && medidasValidas && pesoValido;
  });
  const calculo = useMemo(() => completas
    ? calcularDimensoesDosVolumes(linhas.map((linha) => ({
        quantidade: numero(linha.quantidade),
        comprimento: numero(linha.comprimento),
        largura: numero(linha.largura),
        altura: numero(linha.altura),
        unidade: linha.unidade,
        pesoUnitario: linha.pesoUnitario.trim() ? numero(linha.pesoUnitario) : null,
      })))
    : null, [completas, linhas]);

  useEffect(() => {
    onChangeRef.current(calculo
      ? { volumes: calculo.volumes, cubicMeters: calculo.metrosCubicos, detailedWeight: calculo.pesoDetalhado }
      : null);
  }, [calculo]);

  useEffect(() => {
    onInvalidChange?.(aberto && calculo === null);
  }, [aberto, calculo, onInvalidChange]);

  const abrirOuFechar = () => {
    if (aberto) {
      setAberto(false);
      setLinhas([]);
      return;
    }
    setAberto(true);
    setLinhas([NOVA_LINHA(proximoId.current++)]);
  };

  const mudar = (id: number, campo: keyof Omit<Linha, "id">, valor: string) =>
    setLinhas((atuais) => atuais.map((linha) => linha.id === id ? { ...linha, [campo]: valor } : linha));

  return (
    <div className="col-span-full rounded-xl border border-dashed border-gray-300 bg-gray-50/70 p-3">
      <button type="button" onClick={abrirOuFechar} className="flex items-center gap-2 text-sm font-medium text-blue-700">
        <Ruler className="h-4 w-4" />
        {aberto ? "Ocultar dimensões" : "Informar dimensões"}
      </button>

      {aberto && (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-gray-500">Informe uma linha para cada tamanho de caixa, pacote ou peça.</p>
          {linhas.map((linha, indice) => (
            <fieldset key={linha.id} data-tipo-volume className="rounded-xl border border-gray-200 bg-white p-3">
              <legend className="px-1 text-xs font-semibold text-gray-600">Tipo {indice + 1}</legend>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
                <label className="text-xs text-gray-600">
                  Quantidade
                  <input aria-label={`Quantidade do tipo ${indice + 1}`} required inputMode="numeric" value={linha.quantidade} onChange={(e) => mudar(linha.id, "quantidade", e.target.value)} className={INPUT} />
                </label>
                <label className="text-xs text-gray-600">
                  Comprimento
                  <input aria-label={`Comprimento do tipo ${indice + 1}`} required inputMode="decimal" value={linha.comprimento} onChange={(e) => mudar(linha.id, "comprimento", e.target.value)} className={INPUT} />
                </label>
                <label className="text-xs text-gray-600">
                  Largura
                  <input aria-label={`Largura do tipo ${indice + 1}`} required inputMode="decimal" value={linha.largura} onChange={(e) => mudar(linha.id, "largura", e.target.value)} className={INPUT} />
                </label>
                <label className="text-xs text-gray-600">
                  Altura
                  <input aria-label={`Altura do tipo ${indice + 1}`} required inputMode="decimal" value={linha.altura} onChange={(e) => mudar(linha.id, "altura", e.target.value)} className={INPUT} />
                </label>
                <label className="text-xs text-gray-600">
                  Unidade
                  <select aria-label={`Unidade do tipo ${indice + 1}`} value={linha.unidade} onChange={(e) => mudar(linha.id, "unidade", e.target.value)} className={INPUT}>
                    <option value="cm">cm</option>
                    <option value="m">m</option>
                  </select>
                </label>
                <label className="text-xs text-gray-600">
                  Peso unit. (kg)
                  <input aria-label={`Peso unitário do tipo ${indice + 1}`} inputMode="decimal" value={linha.pesoUnitario} onChange={(e) => mudar(linha.id, "pesoUnitario", e.target.value)} className={INPUT} />
                </label>
              </div>
              {calculo?.linhas[indice] && (
                <p className="mt-2 text-xs font-medium text-blue-700">
                  {formatar(calculo.linhas[indice].metrosCubicosUnitarios)} m³ cada · {formatar(calculo.linhas[indice].metrosCubicosTotais)} m³ neste tipo
                </p>
              )}
              {linhas.length > 1 && (
                <button type="button" aria-label={`Remover tipo ${indice + 1}`} onClick={() => setLinhas((atuais) => atuais.filter((item) => item.id !== linha.id))} className="mt-2 flex items-center gap-1 text-xs text-red-600">
                  <Trash2 className="h-3.5 w-3.5" /> Remover
                </button>
              )}
            </fieldset>
          ))}

          <button type="button" onClick={() => setLinhas((atuais) => [...atuais, NOVA_LINHA(proximoId.current++)])} className="flex items-center gap-1 text-sm text-blue-700">
            <Plus className="h-4 w-4" /> Adicionar tipo de volume
          </button>

          {calculo && (
            <div aria-live="polite" className="flex flex-wrap gap-x-4 gap-y-1 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-900">
              <strong>{calculo.volumes} volumes</strong>
              <span>Cubagem total: {formatar(calculo.metrosCubicos)} m³</span>
              {calculo.pesoDetalhado !== null && <span>Peso detalhado: {formatar(calculo.pesoDetalhado, 3)} kg</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
