"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Printer, Trash2 } from "lucide-react";
import { diaNoBrasil } from "@/lib/financeiro";
import { formatCalendarDate, formatCurrency } from "@/lib/format";
import {
  AVISO_DAS_RETENCOES,
  CALC_BASE_LABEL,
  CALC_MODES,
  CALC_MODE_LABEL,
  CONTRACT_STATUS,
  FREIGHT_PAYMENT_METHODS,
  FREIGHT_PAYMENT_METHOD_LABEL,
  PAYMENT_KINDS,
  PAYMENT_KIND_LABEL,
  rotuloDaFormaDePagamento,
  rotuloDoPagamento,
  valorSugerido,
  type BaseDaViagem,
  type FormaDeCalculo,
  type ValoresDoContrato,
} from "@/lib/frete-contratado";

/**
 * A aba Frete da tela da viagem: o contrato de frete com o parceiro dono do
 * veículo (agregado ou terceiro), os pagamentos e o saldo. Só aparece para quem
 * lê o frete contratado; gravar e pagar, só para quem o altera.
 *
 * Uma parte por vez, para caber na tela do celular: o resumo (com os
 * pagamentos), os valores do contrato ou o registro de um pagamento.
 */

const CAMPO =
  "block w-full min-w-0 px-3 py-1.5 md:py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:text-white";
const ROTULO = "text-xs md:text-sm font-medium text-gray-700 dark:text-gray-300";
const BOTAO = "bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2 rounded-xl flex items-center justify-center gap-2";
const BOTAO_CLARO = "border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-200 px-4 py-2 rounded-xl flex items-center justify-center gap-2 disabled:opacity-50";

type Pagamento = {
  id: string;
  kind: string;
  date: string;
  amount: number;
  method: string;
  notes: string | null;
  transactionId: string | null;
  transaction: { id: string; status: string } | null;
};

type Contrato = {
  id: string;
  carrierId: string;
  calcMode: string;
  calcBase: number | null;
  grossAmount: number;
  tollAmount: number;
  otherAdditions: number;
  discounts: number;
  inss: number;
  irrf: number;
  sestSenat: number;
  otherWithholdings: number;
  status: string;
  notes: string | null;
  carrier: { id: string; name: string };
  payments: Pagamento[];
  valores: ValoresDoContrato;
  pago: number;
  saldo: number;
  sugerido: number | null;
};

type Parceiro = { id: string; name: string; active: boolean; defaultCalcMode: string | null; defaultCalcBase: number | null };

type Frete = {
  viagem: BaseDaViagem & { id: string; status: string };
  parceiroDoVeiculo: { id: string; name: string } | null;
  contrato: Contrato | null;
  parceiros: Parceiro[];
};

type Parte = "resumo" | "valores" | "pagar";

const CAMPOS_DE_VALOR = [
  ["grossAmount", "Valor bruto (R$)"],
  ["tollAmount", "Pedágio à parte (R$)"],
  ["otherAdditions", "Outros acréscimos (R$)"],
  ["discounts", "Descontos (R$)"],
  ["inss", "INSS retido (R$)"],
  ["irrf", "IRRF retido (R$)"],
  ["sestSenat", "SEST/SENAT retido (R$)"],
  ["otherWithholdings", "Outras retenções (R$)"],
] as const;

type CampoDeValor = (typeof CAMPOS_DE_VALOR)[number][0];
type FormDoContrato = Record<CampoDeValor | "carrierId" | "calcMode" | "calcBase" | "notes", string>;

/** O número como o campo mostra: com vírgula, e em branco quando é zero. */
const paraCampo = (valor: number | null | undefined) => (valor === null || valor === undefined || valor === 0 ? "" : String(valor).replace(".", ","));

/** O que a pessoa digitou no campo, como número; em branco ou inválido, `null`. */
const doCampo = (texto: string) => {
  const limpo = texto.trim().replace(",", ".");
  return limpo === "" || Number.isNaN(Number(limpo)) ? null : Number(limpo);
};

const formDoContrato = (contrato: Contrato | null, parceiro: Parceiro | null): FormDoContrato => ({
  carrierId: contrato?.carrierId ?? parceiro?.id ?? "",
  calcMode: contrato?.calcMode ?? parceiro?.defaultCalcMode ?? "FIXO",
  calcBase: paraCampo(contrato ? contrato.calcBase : parceiro?.defaultCalcBase),
  grossAmount: paraCampo(contrato?.grossAmount),
  tollAmount: paraCampo(contrato?.tollAmount),
  otherAdditions: paraCampo(contrato?.otherAdditions),
  discounts: paraCampo(contrato?.discounts),
  inss: paraCampo(contrato?.inss),
  irrf: paraCampo(contrato?.irrf),
  sestSenat: paraCampo(contrato?.sestSenat),
  otherWithholdings: paraCampo(contrato?.otherWithholdings),
  notes: contrato?.notes ?? "",
});

async function mensagemDeErro(res: Response, padrao: string): Promise<string> {
  const corpo = await res.json().catch(() => null);
  return typeof corpo?.error === "string" ? corpo.error : padrao;
}

const json = (method: string, corpo?: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: corpo === undefined ? undefined : JSON.stringify(corpo),
});

export function FreteDaViagem({ manifestId, podeAlterar }: { manifestId: string; /** O perfil grava contrato e pagamento (capacidade `freteContratado`). */ podeAlterar: boolean }) {
  const [frete, setFrete] = useState<Frete | null>(null);
  const [erro, setErro] = useState("");
  const [parte, setParte] = useState<Parte>("resumo");
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [form, setForm] = useState<FormDoContrato>(() => formDoContrato(null, null));
  const [pagamento, setPagamento] = useState(() => ({ kind: "ADIANTAMENTO", date: diaNoBrasil(new Date()), amount: "", method: "PIX", notes: "", paid: false }));
  const base = `/api/manifestos/${manifestId}/frete`;

  // Lê o frete e deixa o formulário como o contrato está (ou, sem contrato, com o parceiro do veículo e o padrão dele).
  const receber = useCallback((lido: Frete) => {
    setFrete(lido);
    const doVeiculo = lido.parceiros.find((parceiro) => parceiro.id === lido.parceiroDoVeiculo?.id) ?? null;
    setForm(formDoContrato(lido.contrato, doVeiculo));
  }, []);

  const ler = useCallback(async () => {
    try {
      const res = await fetch(base);
      if (res.ok) receber((await res.json()) as Frete);
      else if (res.status === 403) setErro("Seu perfil não tem acesso ao frete contratado.");
      else setErro(await mensagemDeErro(res, "Não foi possível carregar o frete contratado."));
    } catch {
      setErro("Não foi possível carregar o frete contratado.");
    }
  }, [base, receber]);

  useEffect(() => {
    let ativo = true;
    fetch(base)
      .then(async (res) => {
        if (!ativo) return;
        if (res.ok) receber((await res.json()) as Frete);
        else if (res.status === 403) setErro("Seu perfil não tem acesso ao frete contratado.");
        else setErro(await mensagemDeErro(res, "Não foi possível carregar o frete contratado."));
      })
      .catch(() => {
        if (ativo) setErro("Não foi possível carregar o frete contratado.");
      });
    return () => {
      ativo = false;
    };
  }, [base, receber]);

  if (!frete) {
    return erro ? (
      <p role="alert" className="text-sm text-red-600">
        {erro}
      </p>
    ) : (
      <div className="flex justify-center py-6" role="status" aria-label="Carregando">
        <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
      </div>
    );
  }

  const { contrato, viagem, parceiros } = frete;
  const cancelada = viagem.status === "CANCELLED";
  const ativo = contrato !== null && contrato.status !== "CANCELADO";
  const escreve = podeAlterar && !cancelada;

  const mudar = (campo: keyof FormDoContrato) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setErro("");
    setForm((atual) => ({ ...atual, [campo]: e.target.value }));
  };

  // Trocar o parceiro num contrato novo traz a forma padrão dele.
  const escolherParceiro = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const escolhido = parceiros.find((parceiro) => parceiro.id === e.target.value);
    setErro("");
    setForm((atual) => ({
      ...atual,
      carrierId: e.target.value,
      ...(!contrato && escolhido?.defaultCalcMode ? { calcMode: escolhido.defaultCalcMode, calcBase: paraCampo(escolhido.defaultCalcBase) } : {}),
    }));
  };

  const sugerido = valorSugerido(form.calcMode, doCampo(form.calcBase), viagem);

  const gravar = async (e: React.FormEvent) => {
    e.preventDefault();
    setOcupado("contrato");
    setErro("");
    try {
      const res = await fetch(base, json("PUT", form));
      if (res.ok) {
        await ler();
        setParte("resumo");
      } else {
        setErro(await mensagemDeErro(res, "Erro ao gravar o frete contratado."));
      }
    } catch {
      setErro("Erro ao gravar o frete contratado.");
    } finally {
      setOcupado(null);
    }
  };

  const cancelar = async () => {
    if (!confirm("Cancelar o frete contratado desta viagem? Ele sai do custo da viagem.")) return;
    setOcupado("cancelar");
    setErro("");
    try {
      const res = await fetch(base, { method: "DELETE" });
      if (res.ok) await ler();
      else setErro(await mensagemDeErro(res, "Erro ao cancelar o frete contratado."));
    } catch {
      setErro("Erro ao cancelar o frete contratado.");
    } finally {
      setOcupado(null);
    }
  };

  // Pagar a mais e quitar antes de finalizar voltam como 409 com `confirmar`: a pessoa diz sim e o pedido vai de novo com a confirmação.
  const pagar = async (e: React.FormEvent) => {
    e.preventDefault();
    setOcupado("pagar");
    setErro("");
    try {
      const confirmacoes: Record<string, boolean> = {};
      for (let tentativa = 0; tentativa < 3; tentativa += 1) {
        const res = await fetch(`${base}/pagamentos`, json("POST", { ...pagamento, ...confirmacoes }));
        if (res.ok) {
          await ler();
          setPagamento((atual) => ({ ...atual, amount: "", notes: "" }));
          setParte("resumo");
          return;
        }
        const corpo = (await res.json().catch(() => null)) as { error?: string; confirmar?: string } | null;
        const frase = typeof corpo?.error === "string" ? corpo.error : "Erro ao registrar o pagamento.";
        if (res.status !== 409 || !corpo?.confirmar || !confirm(frase)) {
          setErro(frase);
          return;
        }
        confirmacoes[corpo.confirmar] = true;
      }
    } catch {
      setErro("Erro ao registrar o pagamento.");
    } finally {
      setOcupado(null);
    }
  };

  const excluir = async (item: Pagamento) => {
    if (!confirm(`Excluir ${rotuloDoPagamento(item.kind).toLowerCase()} de ${formatCurrency(item.amount)}? O lançamento do Financeiro sai junto.`)) return;
    setOcupado(item.id);
    setErro("");
    try {
      const res = await fetch(`${base}/pagamentos/${item.id}`, { method: "DELETE" });
      if (res.ok) await ler();
      else setErro(await mensagemDeErro(res, "Erro ao excluir o pagamento."));
    } catch {
      setErro("Erro ao excluir o pagamento.");
    } finally {
      setOcupado(null);
    }
  };

  const abrirPagamento = (kind: "ADIANTAMENTO" | "SALDO") => {
    setErro("");
    // O saldo já vem com o que falta pagar.
    setPagamento((atual) => ({ ...atual, kind, amount: kind === "SALDO" && contrato && contrato.saldo > 0 ? paraCampo(contrato.saldo) : "" }));
    setParte("pagar");
  };

  const aviso = erro && (
    <p role="alert" className="text-sm text-red-600">
      {erro}
    </p>
  );

  /* ------------------------------ Valores do contrato --------------------------- */

  if (parte === "valores" || (!contrato && escreve)) {
    const forma = form.calcMode as FormaDeCalculo;
    return (
      <form onSubmit={gravar} data-frete="valores" className="grid grid-cols-2 gap-x-3 gap-y-1.5 md:gap-3">
        <label className="col-span-2 block min-w-0 space-y-0.5">
          <span className={ROTULO}>Parceiro</span>
          <select name="carrierId" required value={form.carrierId} onChange={escolherParceiro} disabled={Boolean(contrato && contrato.payments.length > 0)} className={CAMPO}>
            <option value="">Escolha o parceiro…</option>
            {parceiros.map((parceiro) => (
              <option key={parceiro.id} value={parceiro.id}>
                {parceiro.name}
                {parceiro.active ? "" : " (inativo)"}
              </option>
            ))}
          </select>
        </label>
        <label className="block min-w-0 space-y-0.5">
          <span className={ROTULO}>Forma</span>
          <select name="calcMode" value={form.calcMode} onChange={mudar("calcMode")} className={CAMPO}>
            {CALC_MODES.map((modo) => (
              <option key={modo} value={modo}>
                {CALC_MODE_LABEL[modo]}
              </option>
            ))}
          </select>
        </label>
        <label className="block min-w-0 space-y-0.5">
          <span className={ROTULO}>{CALC_BASE_LABEL[forma] ?? "Base"}</span>
          <input name="calcBase" inputMode="decimal" value={form.calcBase} onChange={mudar("calcBase")} className={CAMPO} />
        </label>
        {CAMPOS_DE_VALOR.map(([campo, rotulo]) => (
          <label key={campo} className="block min-w-0 space-y-0.5">
            <span className={ROTULO}>{rotulo}</span>
            <input name={campo} inputMode="decimal" value={form[campo]} onChange={mudar(campo)} className={CAMPO} />
          </label>
        ))}
        <p className="col-span-2 text-[11px] leading-tight text-gray-500" data-sugerido>
          {sugerido === null ? (
            form.calcMode === "POR_KM" && viagem.km === null ? "Por km: informe os hodômetros de saída e de retorno na aba Dados para o sistema sugerir o valor." : "Sem base, o sistema não sugere o valor bruto."
          ) : (
            <>
              Sugerido pela forma: <span className="font-semibold text-gray-900 dark:text-white">{formatCurrency(sugerido)}</span>
              {doCampo(form.grossAmount) !== sugerido && (
                <button type="button" onClick={() => setForm((atual) => ({ ...atual, grossAmount: paraCampo(sugerido) }))} className="ml-2 font-medium text-blue-700 dark:text-blue-400 underline">
                  Usar
                </button>
              )}
            </>
          )}
        </p>
        <p className="col-span-2 text-[11px] leading-tight text-amber-700 dark:text-amber-400" data-aviso-das-retencoes>
          {AVISO_DAS_RETENCOES}
        </p>
        <label className="col-span-2 block min-w-0 space-y-0.5">
          <span className={ROTULO}>Observação</span>
          <input name="notes" value={form.notes} onChange={mudar("notes")} maxLength={1000} className={CAMPO} />
        </label>
        {aviso && <div className="col-span-2">{aviso}</div>}
        <div className="col-span-2 flex justify-end gap-2">
          {contrato && (
            <button
              type="button"
              disabled={ocupado !== null}
              onClick={() => {
                setErro("");
                setForm(formDoContrato(contrato, null));
                setParte("resumo");
              }}
              className={BOTAO_CLARO}
            >
              Voltar
            </button>
          )}
          <button type="submit" disabled={ocupado !== null} className={BOTAO}>
            {ocupado === "contrato" && <Loader2 className="w-4 h-4 animate-spin" />}
            {ativo ? "Salvar frete" : contrato ? "Reabrir frete" : "Criar frete"}
          </button>
        </div>
      </form>
    );
  }

  if (!contrato) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-gray-500" data-frete="sem-contrato">
          {cancelada ? "Viagem cancelada: não há frete contratado." : "Esta viagem não tem frete contratado com parceiro."}
        </p>
        {aviso}
      </div>
    );
  }

  /* ---------------------------------- Pagamento --------------------------------- */

  if (parte === "pagar") {
    return (
      <form onSubmit={pagar} data-frete="pagar" className="grid grid-cols-2 gap-x-3 gap-y-2 md:gap-3">
        <p className="col-span-2 text-sm text-gray-700 dark:text-gray-300">
          {contrato.carrier.name} · saldo <span className="font-semibold text-gray-900 dark:text-white">{formatCurrency(contrato.saldo)}</span>
        </p>
        <label className="block min-w-0 space-y-0.5">
          <span className={ROTULO}>Tipo</span>
          <select name="kind" value={pagamento.kind} onChange={(e) => setPagamento({ ...pagamento, kind: e.target.value })} className={CAMPO}>
            {PAYMENT_KINDS.map((tipo) => (
              <option key={tipo} value={tipo}>
                {PAYMENT_KIND_LABEL[tipo]}
              </option>
            ))}
          </select>
        </label>
        <label className="block min-w-0 space-y-0.5">
          <span className={ROTULO}>Valor (R$)</span>
          <input name="amount" inputMode="decimal" required value={pagamento.amount} onChange={(e) => setPagamento({ ...pagamento, amount: e.target.value })} className={CAMPO} />
        </label>
        <label className="block min-w-0 space-y-0.5">
          <span className={ROTULO}>Data</span>
          <input name="date" type="date" required value={pagamento.date} onChange={(e) => setPagamento({ ...pagamento, date: e.target.value })} className={CAMPO} />
        </label>
        <label className="block min-w-0 space-y-0.5">
          <span className={ROTULO}>Forma</span>
          <select name="method" value={pagamento.method} onChange={(e) => setPagamento({ ...pagamento, method: e.target.value })} className={CAMPO}>
            {FREIGHT_PAYMENT_METHODS.map((forma) => (
              <option key={forma} value={forma}>
                {FREIGHT_PAYMENT_METHOD_LABEL[forma]}
              </option>
            ))}
          </select>
        </label>
        <label className="col-span-2 block min-w-0 space-y-0.5">
          <span className={ROTULO}>Observação</span>
          <input name="notes" value={pagamento.notes} onChange={(e) => setPagamento({ ...pagamento, notes: e.target.value })} maxLength={500} className={CAMPO} />
        </label>
        <label className="col-span-2 flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
          <input name="paid" type="checkbox" checked={pagamento.paid} onChange={(e) => setPagamento({ ...pagamento, paid: e.target.checked })} />
          Já paguei: lançar como pago no Financeiro
        </label>
        <p className="col-span-2 text-[11px] leading-tight text-gray-500">
          O pagamento lança a despesa no Financeiro (categoria Frete contratado). Sem marcar acima, ela fica a pagar, vencendo nesta data.
        </p>
        {aviso && <div className="col-span-2">{aviso}</div>}
        <div className="col-span-2 flex justify-end gap-2">
          <button
            type="button"
            disabled={ocupado !== null}
            onClick={() => {
              setErro("");
              setParte("resumo");
            }}
            className={BOTAO_CLARO}
          >
            Voltar
          </button>
          <button type="submit" disabled={ocupado !== null} className={BOTAO}>
            {ocupado === "pagar" && <Loader2 className="w-4 h-4 animate-spin" />}
            Registrar pagamento
          </button>
        </div>
      </form>
    );
  }

  /* ----------------------------------- Resumo ----------------------------------- */

  const selo = CONTRACT_STATUS[contrato.status] ?? { label: contrato.status, className: "" };
  const { valores } = contrato;
  const linhas: [string, number][] = [
    ["Bruto", valores.bruto],
    ["Acréscimos", valores.acrescimos],
    ["Descontos", valores.descontos],
    ["Retenções", valores.retencoes],
  ];

  return (
    <div className="space-y-2.5" data-frete="resumo">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{contrato.carrier.name}</p>
          <p className="text-xs text-gray-500 truncate">
            {CALC_MODE_LABEL[contrato.calcMode as FormaDeCalculo] ?? contrato.calcMode}
            {contrato.notes ? ` · ${contrato.notes}` : ""}
          </p>
        </div>
        <span data-situacao-do-frete={contrato.status} className={`shrink-0 px-2.5 py-1 text-xs font-medium rounded-full border ${selo.className}`}>
          {selo.label}
        </span>
      </div>

      <dl className="grid grid-cols-3 gap-2 rounded-2xl border border-gray-200 dark:border-gray-700 px-3 py-2">
        <div data-linha="Líquido">
          <dt className="text-[11px] text-gray-500">Líquido</dt>
          <dd className="text-sm md:text-base font-bold text-gray-900 dark:text-white">{formatCurrency(valores.liquido)}</dd>
        </div>
        <div data-linha="Pago">
          <dt className="text-[11px] text-gray-500">Pago</dt>
          <dd className="text-sm md:text-base font-bold text-gray-900 dark:text-white">{formatCurrency(contrato.pago)}</dd>
        </div>
        <div data-linha="Saldo">
          <dt className="text-[11px] text-gray-500">{contrato.saldo < 0 ? "Pago a mais" : "Saldo a pagar"}</dt>
          <dd className={`text-sm md:text-base font-bold ${contrato.saldo < 0 ? "text-red-700" : contrato.saldo === 0 ? "text-emerald-700" : "text-amber-700"}`}>{formatCurrency(Math.abs(contrato.saldo))}</dd>
        </div>
      </dl>

      <dl className="grid grid-cols-4 gap-x-2">
        {linhas.map(([rotulo, valor]) => (
          <div key={rotulo} data-linha={rotulo} className="min-w-0">
            <dt className="text-[11px] text-gray-500 truncate">{rotulo}</dt>
            <dd className="text-xs md:text-sm font-semibold text-gray-900 dark:text-white truncate">{formatCurrency(valor)}</dd>
          </div>
        ))}
      </dl>

      {ativo && contrato.sugerido !== null && contrato.sugerido !== contrato.grossAmount && (
        <p className="text-[11px] leading-tight text-amber-700 dark:text-amber-400" data-sugerido-diferente>
          A forma de cálculo dá {formatCurrency(contrato.sugerido)} hoje; o bruto gravado é {formatCurrency(contrato.grossAmount)}.
        </p>
      )}

      {aviso}

      <div className="border-t border-gray-100 dark:border-gray-800 pt-2">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Pagamentos</h3>
        {contrato.payments.length === 0 ? (
          <p className="text-xs text-gray-500">Nenhum pagamento registrado.</p>
        ) : (
          <ul className="mt-1 divide-y divide-gray-100 dark:divide-gray-800">
            {contrato.payments.map((item) => (
              <li key={item.id} data-pagamento={item.id} className="flex items-center gap-2 py-1.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-gray-900 dark:text-white truncate">
                    {rotuloDoPagamento(item.kind)} · {formatCalendarDate(item.date)} · {rotuloDaFormaDePagamento(item.method)}
                  </p>
                  <p className="text-[11px] text-gray-500 truncate">
                    {item.transaction ? (item.transaction.status === "PAID" ? "Pago no Financeiro" : "A pagar no Financeiro") : "Sem lançamento no Financeiro"}
                    {item.notes ? ` · ${item.notes}` : ""}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-semibold text-gray-900 dark:text-white">{formatCurrency(item.amount)}</span>
                {podeAlterar && (
                  <button type="button" aria-label="Excluir pagamento" disabled={ocupado !== null} onClick={() => excluir(item)} className="shrink-0 p-1 text-gray-400 hover:text-red-600 disabled:opacity-50">
                    {ocupado === item.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        <a href={`/dashboard/manifestos/${manifestId}/recibo-frete`} target="_blank" rel="noopener noreferrer" data-recibo-de-frete className={BOTAO_CLARO}>
          <Printer className="w-4 h-4" /> Recibo
        </a>
        {escreve && (
          <button type="button" disabled={ocupado !== null} onClick={() => setParte("valores")} data-editar-frete className={BOTAO_CLARO}>
            {ativo ? "Valores" : "Reabrir"}
          </button>
        )}
        {escreve && ativo && contrato.payments.length === 0 && (
          <button type="button" disabled={ocupado !== null} onClick={cancelar} data-cancelar-frete className={`${BOTAO_CLARO} text-red-600 dark:text-red-400`}>
            {ocupado === "cancelar" && <Loader2 className="w-4 h-4 animate-spin" />}
            Cancelar
          </button>
        )}
        {escreve && ativo && (
          <>
            <button type="button" disabled={ocupado !== null} onClick={() => abrirPagamento("ADIANTAMENTO")} data-adiantar-frete className={BOTAO_CLARO}>
              Adiantar
            </button>
            <button type="button" disabled={ocupado !== null} onClick={() => abrirPagamento("SALDO")} data-pagar-saldo className={BOTAO}>
              Pagar saldo
            </button>
          </>
        )}
      </div>
    </div>
  );
}
