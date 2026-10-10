"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { JUROS_PADRAO_PCT, MULTA_PADRAO_PCT, diasDeAtraso, encargosSugeridos, type ParametrosDeCobranca } from "@/lib/cobranca";
import { valorRecebido } from "@/lib/financeiro";
import { formatCalendarDate, formatCurrency } from "@/lib/format";

/**
 * Baixa de um título a receber, com juros, multa e desconto. Usada no
 * Financeiro (lançamento manual) e no Faturamento (fatura): as duas telas
 * mandam os mesmos três campos para a API.
 *
 * Título vencido abre com a multa e os juros sugeridos pelos parâmetros de
 * cobrança da empresa; o operador altera ou apaga. O valor do título não muda:
 * o que se confirma aqui é quanto entrou.
 */

const PADRAO: ParametrosDeCobranca = { multaPct: MULTA_PADRAO_PCT, jurosPct: JUROS_PADRAO_PCT };

/**
 * Os parâmetros de cobrança da empresa (`GET /api/empresa/cobranca`). Enquanto
 * não chegam, ou se a leitura falhar, vale o padrão de 2% e 1% ao mês.
 */
export function useParametrosDeCobranca(): ParametrosDeCobranca {
  const [parametros, setParametros] = useState(PADRAO);

  useEffect(() => {
    let ativo = true;
    fetch("/api/empresa/cobranca")
      .then((res) => (res.ok ? res.json() : null))
      .then((corpo: ParametrosDeCobranca | null) => {
        if (ativo && corpo && typeof corpo.multaPct === "number" && typeof corpo.jurosPct === "number") setParametros(corpo);
      })
      .catch(() => {
        // Sem a leitura a sugestão sai pelo padrão.
      });
    return () => {
      ativo = false;
    };
  }, []);

  return parametros;
}

export type EncargosDigitados = { juros: string; multa: string; desconto: string };

export type TituloDaBaixa = { descricao: string; valor: number; vencimento: string | null };

const INPUT =
  "block w-full min-w-0 px-3 py-1.5 md:py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:text-white";
const LABEL = "text-xs md:text-sm font-medium text-gray-700 dark:text-gray-300";
const CARD = "bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm";

// Zero fica em branco: campo vazio é "sem este encargo".
const paraOCampo = (valor: number) => (valor > 0 ? valor.toFixed(2).replace(".", ",") : "");

// O que o operador digitou, como número; em branco é zero e texto que não é número é inválido (`NaN`).
const doCampo = (texto: string) => {
  const limpo = texto.trim();
  if (limpo === "") return 0;
  return /^(\d+([.,]\d*)?|[.,]\d+)$/.test(limpo) ? Number(limpo.replace(",", ".")) : NaN;
};

export function Baixa({
  titulo,
  parametros,
  ocupado,
  onConfirmar,
  onCancelar,
}: {
  titulo: TituloDaBaixa;
  parametros: ParametrosDeCobranca;
  ocupado: boolean;
  onConfirmar: (encargos: EncargosDigitados) => void;
  onCancelar: () => void;
}) {
  const dias = diasDeAtraso(titulo.vencimento);
  const [campos, setCampos] = useState<EncargosDigitados>(() => {
    const sugerido = encargosSugeridos(titulo.valor, dias, parametros);
    return { multa: paraOCampo(sugerido.multa), juros: paraOCampo(sugerido.juros), desconto: "" };
  });

  const recebido = valorRecebido(titulo.valor, { juros: doCampo(campos.juros), multa: doCampo(campos.multa), desconto: doCampo(campos.desconto) });
  const invalido = Number.isNaN(recebido) || recebido < 0;

  const campo = (rotulo: string, chave: keyof EncargosDigitados) => (
    <label className="space-y-0.5 md:space-y-1.5 block min-w-0">
      <span className={LABEL}>{rotulo}</span>
      <input
        inputMode="decimal"
        placeholder="0,00"
        data-encargo={chave}
        value={campos[chave]}
        onChange={(e) => setCampos({ ...campos, [chave]: e.target.value })}
        className={INPUT}
      />
    </label>
  );

  return (
    <form
      aria-label="Baixa do título"
      onSubmit={(e) => {
        e.preventDefault();
        if (!invalido) onConfirmar(campos);
      }}
      className={`${CARD} p-3 md:p-6 space-y-2 md:space-y-4`}
    >
      <div>
        <h2 className="font-semibold text-gray-900 dark:text-white">Receber: {titulo.descricao}</h2>
        <p className="text-xs md:text-sm text-gray-500 mt-0.5">
          Valor do título {formatCurrency(titulo.valor)}
          {titulo.vencimento ? ` · vencimento ${formatCalendarDate(titulo.vencimento)}` : ""}
          {dias > 0 ? ` · ${dias} ${dias === 1 ? "dia" : "dias"} de atraso` : ""}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-2 md:gap-4 lg:grid-cols-4">
        {campo("Multa (R$)", "multa")}
        {campo("Juros (R$)", "juros")}
        {campo("Desconto (R$)", "desconto")}
        <div className="min-w-0" data-campo="recebido">
          <p className={LABEL}>Valor recebido</p>
          <p className={`mt-1 md:mt-2.5 text-lg font-bold ${invalido ? "text-red-600" : "text-gray-900 dark:text-white"}`}>
            {Number.isNaN(recebido) ? "-" : formatCurrency(recebido)}
          </p>
        </div>
      </div>

      <p className="text-xs text-gray-500">
        {dias > 0
          ? `Sugestão: multa de ${parametros.multaPct.toLocaleString("pt-BR")}% e juros de ${parametros.jurosPct.toLocaleString("pt-BR")}% ao mês, proporcionais aos dias de atraso. Altere ou apague à vontade.`
          : "Título em dia: sem multa nem juros sugeridos."}
      </p>
      {invalido && (
        <p role="alert" className="text-sm text-red-600">
          {Number.isNaN(recebido) ? "Use só números, com vírgula nos centavos." : "O desconto não pode passar do valor com juros e multa."}
        </p>
      )}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={ocupado || invalido}
          className="px-4 py-2 md:py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium disabled:opacity-60 flex items-center gap-2"
        >
          {ocupado && <Loader2 className="w-4 h-4 animate-spin" />}
          Confirmar recebimento
        </button>
        <button type="button" onClick={onCancelar} className="px-4 py-2 md:py-2.5 text-sm text-gray-600 dark:text-gray-300">
          Cancelar
        </button>
      </div>
    </form>
  );
}
