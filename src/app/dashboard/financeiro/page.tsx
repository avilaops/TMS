"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Loader2, LogIn, Plus, ShieldAlert, Wallet } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCalendarDate, formatCurrency, formatDate } from "@/lib/format";
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABEL,
  resumoFinanceiro,
  situacaoDoLancamento,
  type MesDoFluxo,
  type Situacao,
} from "@/lib/financeiro";
import { Baixa, useParametrosDeCobranca, type EncargosDigitados } from "@/components/financeiro/Baixa";
import { deniedReason, loadTransactions, type DeniedReason } from "./carregar";

/**
 * Financeiro: contas a receber, contas a pagar e fluxo de caixa.
 *
 * Receber um título abre a baixa (juros, multa e desconto, com a sugestão dos
 * parâmetros de cobrança quando ele está vencido); pagar uma despesa é direto.
 *
 * Lançamento que veio de fatura aparece aqui, mas quem o paga, reabre ou
 * cancela é a tela de Faturamento: ele mostra o número da fatura e não tem ações.
 */

type Lancamento = {
  id: string;
  type: "INCOME" | "EXPENSE";
  amount: number;
  description: string;
  dueDate: string | null;
  status: string;
  paidAt: string | null;
  paymentMethod: keyof typeof PAYMENT_METHOD_LABEL | null;
  category: string | null;
  costCenter: string | null;
  counterparty: string | null;
  notes: string | null;
  /** O que entrou de fato, quando a baixa teve juros, multa ou desconto. */
  paidAmount: number | null;
  clientId: string | null;
  client: { id: string; companyName: string; tradeName: string | null } | null;
  invoice: { id: string; number: number } | null;
};

type Aba = "INCOME" | "EXPENSE" | "FLUXO";

const FORM_VAZIO = {
  type: "EXPENSE" as "INCOME" | "EXPENSE",
  amount: "",
  description: "",
  dueDate: "",
  clientId: "",
  counterparty: "",
  category: "",
  costCenter: "",
  notes: "",
  status: "PENDING",
  paymentMethod: "",
};

const SITUACAO: Record<Situacao, { rotulo: string; classe: string }> = {
  aberto: { rotulo: "Em aberto", classe: "bg-yellow-100 text-yellow-800" },
  vencido: { rotulo: "Vencido", classe: "bg-red-100 text-red-700" },
  pago: { rotulo: "Pago", classe: "bg-green-100 text-green-700" },
};

const INPUT =
  "block w-full min-w-0 px-3 py-1.5 md:py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:text-white";
const LABEL = "text-xs md:text-sm font-medium text-gray-700 dark:text-gray-300";
const CARD = "bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm";

const nomeDoMes = (mes: string) => {
  const [ano, m] = mes.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(ano, m - 1, 1)));
};

export default function FinanceiroPage() {
  const [aba, setAba] = useState<Aba>("INCOME");
  const [lancamentos, setLancamentos] = useState<Lancamento[]>([]);
  const [fluxo, setFluxo] = useState<MesDoFluxo[]>([]);
  const [clientes, setClientes] = useState<{ id: string; companyName: string; tradeName: string | null }[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [denied, setDenied] = useState<DeniedReason | null>(null);
  const [mensagem, setMensagem] = useState<{ ok: boolean; texto: string } | null>(null);
  const [filtro, setFiltro] = useState<"" | Situacao>("");
  const [centro, setCentro] = useState("");
  // Título a receber cuja baixa está aberta (juros, multa e desconto).
  const [baixa, setBaixa] = useState<Lancamento | null>(null);
  const parametros = useParametrosDeCobranca();

  const [formAberto, setFormAberto] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [form, setForm] = useState(FORM_VAZIO);
  const [ocupado, setOcupado] = useState(false);

  const fetchData = async () => {
    try {
      const result = await loadTransactions(() => fetch("/api/financeiro"));
      if (result.denied) return setDenied(result.denied);
      setLancamentos(result.transactions as Lancamento[]);

      const [resFluxo, resClientes] = await Promise.all([fetch("/api/financeiro/fluxo"), fetch("/api/clientes")]);
      if (resFluxo.ok) setFluxo(((await resFluxo.json()) as { fluxo: MesDoFluxo[] }).fluxo);
      if (resClientes.ok) setClientes(await resClientes.json());
    } catch (error) {
      console.error("Erro ao buscar o financeiro", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void fetchData();
  }, []);

  /** Trata a resposta de uma gravação; devolve true quando deu certo. */
  const conferir = async (res: Response, sucesso: string, falha: string) => {
    const negado = deniedReason(res.status);
    if (negado) {
      setFormAberto(false);
      setDenied(negado);
      return false;
    }
    if (!res.ok) {
      const corpo = (await res.json().catch(() => ({}))) as { error?: string };
      setMensagem({ ok: false, texto: corpo.error ?? falha });
      return false;
    }
    setMensagem({ ok: true, texto: sucesso });
    await fetchData();
    return true;
  };

  const abrirNovo = () => {
    setEditandoId(null);
    setBaixa(null);
    setForm({ ...FORM_VAZIO, type: aba === "INCOME" ? "INCOME" : "EXPENSE" });
    setFormAberto(true);
    setMensagem(null);
  };

  const abrirEdicao = (l: Lancamento) => {
    setEditandoId(l.id);
    setBaixa(null);
    setForm({
      type: l.type,
      amount: String(l.amount).replace(".", ","),
      description: l.description,
      dueDate: l.dueDate ? l.dueDate.slice(0, 10) : "",
      clientId: l.clientId ?? "",
      counterparty: l.counterparty ?? "",
      category: l.category ?? "",
      costCenter: l.costCenter ?? "",
      notes: l.notes ?? "",
      status: l.status,
      paymentMethod: l.paymentMethod ?? "",
    });
    setFormAberto(true);
    setMensagem(null);
  };

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    setOcupado(true);
    setMensagem(null);
    try {
      // Na edição a situação não muda pelo formulário: para isso há os botões da lista.
      const { status, paymentMethod, ...campos } = form;
      const corpo = editandoId ? campos : { ...campos, status, ...(status === "PAID" && { paymentMethod }) };
      const res = await fetch(editandoId ? `/api/financeiro/${editandoId}` : "/api/financeiro", {
        method: editandoId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
      });
      if (await conferir(res, editandoId ? "Lançamento alterado." : "Lançamento criado.", "Erro ao salvar o lançamento.")) {
        setFormAberto(false);
      }
    } catch {
      setMensagem({ ok: false, texto: "Erro ao salvar o lançamento." });
    } finally {
      setOcupado(false);
    }
  };

  /** `encargos` só vem da baixa de um título a receber (juros, multa e desconto). */
  const agir = async (l: Lancamento, action: "pagar" | "reabrir", encargos?: EncargosDigitados) => {
    setOcupado(true);
    setMensagem(null);
    try {
      const res = await fetch(`/api/financeiro/${l.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...encargos }),
      });
      const pago = l.type === "INCOME" ? "Recebimento registrado." : "Pagamento registrado.";
      if (await conferir(res, action === "pagar" ? pago : "Lançamento reaberto.", "Erro ao alterar o lançamento.")) {
        setBaixa(null);
      }
    } finally {
      setOcupado(false);
    }
  };

  // A receber passa pela baixa (juros, multa, desconto); a pagar é baixado direto, pelo valor.
  const pagar = (l: Lancamento) => {
    if (l.type !== "INCOME") return void agir(l, "pagar");
    setFormAberto(false);
    setMensagem(null);
    setBaixa(l);
  };

  const excluir = async (l: Lancamento) => {
    if (!window.confirm(`Excluir o lançamento "${l.description}" de ${formatCurrency(l.amount)}? Não dá para desfazer.`)) return;
    setOcupado(true);
    setMensagem(null);
    try {
      const res = await fetch(`/api/financeiro/${l.id}`, { method: "DELETE" });
      await conferir(res, "Lançamento excluído.", "Erro ao excluir o lançamento.");
    } finally {
      setOcupado(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (denied === "login") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <LogIn className="w-5 h-5 text-blue-600" />
            Sessão expirada
          </CardTitle>
          <CardDescription>
            Entre de novo para ver o financeiro.{" "}
            <Link href="/login" className="font-medium text-blue-600 hover:underline">
              Ir para o login
            </Link>
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (denied === "forbidden") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-red-600" />
            Acesso negado
          </CardTitle>
          <CardDescription>O financeiro é restrito ao perfil Administrador.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const resumo = resumoFinanceiro(lancamentos);
  const centros = [...new Set(lancamentos.map((l) => l.costCenter).filter((c): c is string => Boolean(c)))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const daAba = lancamentos.filter(
    (l) => l.type === aba && (!filtro || situacaoDoLancamento(l) === filtro) && (!centro || l.costCenter === centro),
  );
  // Com o formulário ou a baixa abertos, o celular fica só com eles: é o que cabe numa tela.
  const painelAberto = formAberto || baixa !== null;
  const pagoOuRecebido = aba === "INCOME" ? "Marcar recebido" : "Marcar pago";

  const campo = (rotulo: string, chave: keyof typeof FORM_VAZIO, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="space-y-0.5 md:space-y-1.5 block min-w-0">
      <span className={LABEL}>{rotulo}</span>
      <input {...extra} value={form[chave]} onChange={(e) => setForm({ ...form, [chave]: e.target.value })} className={INPUT} />
    </label>
  );

  return (
    <div className="space-y-3 md:space-y-6">
      <div className={`${painelAberto ? "hidden md:flex" : "flex"} flex-wrap justify-between items-center gap-2 md:gap-4`}>
        <div>
          <h1 className="text-2xl font-bold font-outfit text-gray-900 dark:text-white">Financeiro</h1>
          <p className="hidden md:block text-gray-500 text-sm mt-1">Contas a receber, contas a pagar e fluxo de caixa</p>
        </div>
        <button
          onClick={abrirNovo}
          className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 md:px-4 md:py-2.5 text-sm md:text-base rounded-xl flex items-center space-x-2 shadow-lg shadow-blue-500/30 transition-all"
        >
          <Plus className="w-4 h-4" />
          <span>Novo lançamento</span>
        </button>
      </div>

      {mensagem && (
        <p role="status" className={`text-sm ${mensagem.ok ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
          {mensagem.texto}
        </p>
      )}

      <div className={`${painelAberto ? "hidden md:grid" : "grid"} grid-cols-2 gap-2 md:gap-4 lg:grid-cols-5`}>
        <Cartao rotulo="A receber em aberto" valor={resumo.aReceber.aberto} icone={<ArrowUpRight className="w-5 h-5 text-green-600" />} />
        <Cartao rotulo="A receber vencido" valor={resumo.aReceber.vencido} alerta={resumo.aReceber.vencido > 0} icone={<AlertTriangle className="w-5 h-5 text-red-600" />} />
        <Cartao rotulo="A pagar em aberto" valor={resumo.aPagar.aberto} icone={<ArrowDownRight className="w-5 h-5 text-amber-600" />} />
        <Cartao rotulo="A pagar vencido" valor={resumo.aPagar.vencido} alerta={resumo.aPagar.vencido > 0} icone={<AlertTriangle className="w-5 h-5 text-red-600" />} />
        <Cartao rotulo="Saldo previsto" valor={resumo.saldoPrevisto} alerta={resumo.saldoPrevisto < 0} icone={<Wallet className="w-5 h-5 text-blue-600" />} />
      </div>

      {baixa && (
        <Baixa
          key={baixa.id}
          titulo={{ descricao: baixa.description, valor: baixa.amount, vencimento: baixa.dueDate }}
          parametros={parametros}
          ocupado={ocupado}
          onConfirmar={(encargos) => void agir(baixa, "pagar", encargos)}
          onCancelar={() => setBaixa(null)}
        />
      )}

      {formAberto && (
        <form onSubmit={salvar} className={`${CARD} p-3 md:p-6 space-y-2 md:space-y-5`}>
          <h2 className="font-semibold text-gray-900 dark:text-white">{editandoId ? "Alterar lançamento" : "Novo lançamento"}</h2>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2 md:gap-4 lg:grid-cols-3">
            <label className="space-y-0.5 md:space-y-1.5 block min-w-0">
              <span className={LABEL}>Tipo</span>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as "INCOME" | "EXPENSE" })} className={INPUT}>
                <option value="INCOME">Receita (a receber)</option>
                <option value="EXPENSE">Despesa (a pagar)</option>
              </select>
            </label>
            {campo("Descrição", "description", { required: true })}
            {campo("Valor (R$)", "amount", { required: true, inputMode: "decimal" })}
            {campo("Vencimento", "dueDate", { type: "date" })}
            {campo("Categoria", "category", { placeholder: "Combustível, manutenção, pedágio…", list: "categorias" })}
            {campo("Centro de custo", "costCenter", { placeholder: "Filial, rota, veículo…", list: "centros" })}
            <label className="space-y-0.5 md:space-y-1.5 block min-w-0">
              <span className={LABEL}>Cliente</span>
              <select value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })} className={INPUT}>
                <option value="">Nenhum</option>
                {clientes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.tradeName || c.companyName}
                  </option>
                ))}
              </select>
            </label>
            {campo(form.type === "INCOME" ? "Pagador avulso" : "Fornecedor", "counterparty")}
            {!editandoId && (
              <label className="space-y-0.5 md:space-y-1.5 block min-w-0">
                <span className={LABEL}>Situação</span>
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className={INPUT}>
                  <option value="PENDING">Em aberto</option>
                  <option value="PAID">{form.type === "INCOME" ? "Já recebido" : "Já pago"}</option>
                </select>
              </label>
            )}
            {!editandoId && form.status === "PAID" && (
              <label className="space-y-0.5 md:space-y-1.5 block min-w-0">
                <span className={LABEL}>Forma de pagamento</span>
                <select value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })} className={INPUT}>
                  <option value="">Não informada</option>
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {PAYMENT_METHOD_LABEL[m]}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <datalist id="categorias">
            {[...new Set(lancamentos.map((l) => l.category).filter(Boolean))].map((c) => (
              <option key={c} value={c as string} />
            ))}
          </datalist>
          {/* Sugestões a partir dos centros de custo já usados. */}
          <datalist id="centros">
            {centros.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <label className="space-y-0.5 md:space-y-1.5 block min-w-0">
            <span className={LABEL}>Observação</span>
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} className={INPUT} />
          </label>
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={ocupado}
              className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium disabled:opacity-60 flex items-center gap-2"
            >
              {ocupado && <Loader2 className="w-4 h-4 animate-spin" />}
              Salvar
            </button>
            <button type="button" onClick={() => setFormAberto(false)} className="px-4 py-2.5 text-sm text-gray-600 dark:text-gray-300">
              Cancelar
            </button>
          </div>
        </form>
      )}

      <div className={`${CARD} overflow-hidden`}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 dark:border-gray-800 px-4">
          <div role="tablist" className="flex">
            {(
              [
                ["INCOME", "A receber"],
                ["EXPENSE", "A pagar"],
                ["FLUXO", "Fluxo de caixa"],
              ] as const
            ).map(([chave, rotulo]) => (
              <button
                key={chave}
                role="tab"
                aria-selected={aba === chave}
                onClick={() => setAba(chave)}
                className={`px-4 py-4 text-sm font-medium border-b-2 -mb-px ${
                  aba === chave ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
              >
                {rotulo}
              </button>
            ))}
          </div>
          {aba !== "FLUXO" && (
            <div className="flex flex-wrap items-center gap-x-4">
              <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 py-2">
                Situação
                <select value={filtro} onChange={(e) => setFiltro(e.target.value as "" | Situacao)} className={`${INPUT} w-36 py-2`}>
                  <option value="">Todas</option>
                  <option value="aberto">Em aberto</option>
                  <option value="vencido">Vencido</option>
                  <option value="pago">Pago</option>
                </select>
              </label>
              {/* Só aparece quando algum lançamento tem centro de custo. */}
              {centros.length > 0 && (
                <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 py-2">
                  Centro
                  <select value={centro} onChange={(e) => setCentro(e.target.value)} data-filtro="centro" className={`${INPUT} w-36 py-2`}>
                    <option value="">Todos</option>
                    {centros.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          )}
        </div>

        {aba === "FLUXO" ? (
          <div className="overflow-x-auto">
            <table className="block md:table w-full text-sm">
              <thead className="hidden md:table-header-group bg-gray-50 dark:bg-gray-950 text-gray-500 text-right">
                <tr>
                  <th className="px-4 py-3 font-medium text-left">Mês</th>
                  <th className="px-4 py-3 font-medium">Entradas previstas</th>
                  <th className="px-4 py-3 font-medium">Saídas previstas</th>
                  <th className="px-4 py-3 font-medium">Entradas realizadas</th>
                  <th className="px-4 py-3 font-medium">Saídas realizadas</th>
                  <th className="px-4 py-3 font-medium">Saldo do mês</th>
                  <th className="px-4 py-3 font-medium">Acumulado</th>
                </tr>
              </thead>
              <tbody className="block md:table-row-group divide-y divide-gray-100 dark:divide-gray-800 text-right">
                {fluxo.map((m) => (
                  <tr key={m.mes} className="grid grid-cols-2 gap-x-3 gap-y-1.5 px-3 py-2.5 md:table-row">
                    <td className="col-span-2 min-w-0 md:table-cell md:px-4 md:py-3 text-left font-medium text-gray-900 dark:text-white capitalize">{nomeDoMes(m.mes)}</td>
                    <td data-rotulo="Entradas previstas" className="min-w-0 md:table-cell md:px-4 md:py-3 text-gray-600 dark:text-gray-300 before:content-[attr(data-rotulo)] before:block before:text-[11px] before:leading-tight before:text-gray-500 md:before:content-none">{formatCurrency(m.previsto.entradas)}</td>
                    <td data-rotulo="Saídas previstas" className="min-w-0 md:table-cell md:px-4 md:py-3 text-gray-600 dark:text-gray-300 before:content-[attr(data-rotulo)] before:block before:text-[11px] before:leading-tight before:text-gray-500 md:before:content-none">{formatCurrency(m.previsto.saidas)}</td>
                    <td data-rotulo="Entradas realizadas" className="min-w-0 md:table-cell md:px-4 md:py-3 text-gray-900 dark:text-white before:content-[attr(data-rotulo)] before:block before:text-[11px] before:leading-tight before:text-gray-500 md:before:content-none">{formatCurrency(m.realizado.entradas)}</td>
                    <td data-rotulo="Saídas realizadas" className="min-w-0 md:table-cell md:px-4 md:py-3 text-gray-900 dark:text-white before:content-[attr(data-rotulo)] before:block before:text-[11px] before:leading-tight before:text-gray-500 md:before:content-none">{formatCurrency(m.realizado.saidas)}</td>
                    <td data-rotulo="Saldo do mês" className={`min-w-0 md:table-cell md:px-4 md:py-3 font-medium before:content-[attr(data-rotulo)] before:block before:text-[11px] before:leading-tight before:text-gray-500 md:before:content-none ${m.realizado.saldo < 0 ? "text-red-600" : "text-gray-900 dark:text-white"}`}>
                      {formatCurrency(m.realizado.saldo)}
                    </td>
                    <td data-rotulo="Acumulado" className={`min-w-0 md:table-cell md:px-4 md:py-3 font-medium before:content-[attr(data-rotulo)] before:block before:text-[11px] before:leading-tight before:text-gray-500 md:before:content-none ${m.acumulado < 0 ? "text-red-600" : "text-gray-900 dark:text-white"}`}>
                      {formatCurrency(m.acumulado)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="px-4 py-3 text-xs text-gray-500">
              Previsto é o que vence no mês; realizado é o que foi pago ou recebido no mês. O acumulado soma o saldo realizado desde o primeiro mês da tabela.
            </p>
          </div>
        ) : daAba.length === 0 ? (
          <p className="p-10 text-center text-gray-500">Nenhum lançamento {filtro ? "nesta situação" : "até agora"}.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="block md:table w-full text-sm">
              <thead className="hidden md:table-header-group bg-gray-50 dark:bg-gray-950 text-gray-500 text-left">
                <tr>
                  <th className="px-4 py-3 font-medium">Descrição</th>
                  <th className="px-4 py-3 font-medium">{aba === "INCOME" ? "Cliente" : "Fornecedor"}</th>
                  <th className="px-4 py-3 font-medium">Categoria</th>
                  <th className="px-4 py-3 font-medium">Vencimento</th>
                  <th className="px-4 py-3 font-medium text-right">Valor</th>
                  <th className="px-4 py-3 font-medium">Situação</th>
                  <th className="px-4 py-3 font-medium text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="block md:table-row-group divide-y divide-gray-100 dark:divide-gray-800">
                {daAba.map((l) => {
                  const situacao = situacaoDoLancamento(l);
                  return (
                    <tr key={l.id} className="grid grid-cols-2 gap-x-3 gap-y-1.5 px-3 py-2.5 md:table-row">
                      <td className="col-span-2 min-w-0 md:table-cell md:px-4 md:py-3 text-gray-900 dark:text-white">
                        {l.description}
                        {l.invoice && (
                          <Link href={`/dashboard/faturamento/${l.invoice.id}`} className="ml-2 text-xs text-blue-600 hover:underline">
                            ver fatura
                          </Link>
                        )}
                      </td>
                      <td className="min-w-0 md:table-cell md:px-4 md:py-3 text-gray-600 dark:text-gray-300">
                        {l.client ? l.client.tradeName || l.client.companyName : l.counterparty || "-"}
                      </td>
                      <td data-rotulo="Categoria" className="min-w-0 md:table-cell md:px-4 md:py-3 text-gray-600 dark:text-gray-300 before:content-[attr(data-rotulo)] before:block before:text-[11px] before:leading-tight before:text-gray-500 md:before:content-none">
                        {l.category || "-"}
                        {l.costCenter && <span className="block text-xs text-gray-500">{l.costCenter}</span>}
                      </td>
                      <td data-rotulo="Vencimento" className="min-w-0 md:table-cell md:px-4 md:py-3 text-gray-600 dark:text-gray-300 before:content-[attr(data-rotulo)] before:block before:text-[11px] before:leading-tight before:text-gray-500 md:before:content-none">{formatCalendarDate(l.dueDate)}</td>
                      <td data-rotulo="Valor" className="min-w-0 md:table-cell md:px-4 md:py-3 md:text-right text-gray-900 dark:text-white before:content-[attr(data-rotulo)] before:block before:text-[11px] before:leading-tight before:text-gray-500 md:before:content-none">
                        {formatCurrency(l.amount)}
                        {l.paidAmount !== null && l.paidAmount !== l.amount && (
                          <span className="block text-xs text-gray-500" data-recebido>
                            recebido {formatCurrency(l.paidAmount)}
                          </span>
                        )}
                      </td>
                      <td data-rotulo="Situação" className="min-w-0 md:table-cell md:px-4 md:py-3 before:content-[attr(data-rotulo)] before:block before:text-[11px] before:leading-tight before:text-gray-500 md:before:content-none">
                        <span className={`text-xs px-2.5 py-1 rounded-full ${SITUACAO[situacao].classe}`}>{SITUACAO[situacao].rotulo}</span>
                        {l.paidAt && (
                          <span className="block text-xs text-gray-500 mt-1">
                            {formatDate(l.paidAt)}
                            {l.paymentMethod ? ` · ${PAYMENT_METHOD_LABEL[l.paymentMethod]}` : ""}
                          </span>
                        )}
                      </td>
                      <td className="col-span-2 min-w-0 md:table-cell md:px-4 md:py-3 md:text-right whitespace-nowrap space-x-3">
                        {l.type === "INCOME" && l.status === "PAID" && (
                          <Link href={`/dashboard/financeiro/recibo/${l.id}`} className="text-blue-600 hover:underline">
                            Recibo
                          </Link>
                        )}
                        {l.invoice ? (
                          <span className="text-xs text-gray-500">pelo Faturamento</span>
                        ) : (
                          <>
                            {l.status === "PAID" ? (
                              <button disabled={ocupado} onClick={() => void agir(l, "reabrir")} className="text-blue-600 hover:underline">
                                Reabrir
                              </button>
                            ) : (
                              <button disabled={ocupado} onClick={() => pagar(l)} className="text-blue-600 hover:underline">
                                {pagoOuRecebido}
                              </button>
                            )}
                            <button disabled={ocupado} onClick={() => abrirEdicao(l)} className="text-blue-600 hover:underline">
                              Editar
                            </button>
                            <button disabled={ocupado} onClick={() => void excluir(l)} className="text-red-600 hover:underline">
                              Excluir
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Cartao({ rotulo, valor, icone, alerta = false }: { rotulo: string; valor: number; icone: React.ReactNode; alerta?: boolean }) {
  return (
    <div className={`${CARD} p-3 md:p-5 last:odd:col-span-2 lg:last:odd:col-span-1`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs md:text-sm leading-tight text-gray-500">{rotulo}</p>
        {icone}
      </div>
      <p className={`mt-1 md:mt-2 text-lg md:text-xl font-bold ${alerta ? "text-red-600" : "text-gray-900 dark:text-white"}`}>{formatCurrency(valor)}</p>
    </div>
  );
}
