"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCheck, Loader2, LogIn, ShieldAlert, Upload } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCalendarDate, formatCurrency, formatDate } from "@/lib/format";
import { TAMANHO_MAXIMO_DO_OFX, OFX_GRANDE } from "@/lib/ofx";
import {
  FILTROS_DA_LISTA,
  type FiltroDaLista,
  type LinhaDaTela,
  type RespostaDaConciliacao,
  type RespostaDaImportacao,
  type TituloDaTela,
} from "@/lib/conciliacao";
import { deniedReason, type DeniedReason } from "../carregar";

/**
 * Conciliação bancária: o administrador envia o extrato que exportou do banco
 * (OFX) e casa cada movimentação com um lançamento do Financeiro. Não fala com
 * banco nenhum: as regras da sugestão estão em src/lib/conciliacao.ts.
 *
 * Celular primeiro: uma linha do extrato por cartão, com a sugestão e os botões
 * no próprio cartão; "Escolher outro" e "Criar lançamento" abrem em tela cheia.
 */

const CAMPO =
  "block w-full min-w-0 px-3 py-1.5 md:py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:text-white";
const ROTULO = "text-xs md:text-sm font-medium text-gray-700 dark:text-gray-300";
const PRIMARIO = "bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed text-white text-sm font-medium px-3 py-1.5 rounded-xl flex items-center justify-center gap-1.5";
const SECUNDARIO = "border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-200 px-3 py-1.5 rounded-xl disabled:opacity-50";

const ROTULO_DO_FILTRO: Record<FiltroDaLista, string> = { pendentes: "Pendentes", conciliadas: "Conciliadas", ignoradas: "Ignoradas" };

type Aviso = { ok: boolean; texto: string };
type Modal = { tipo: "outro" | "criar"; linha: LinhaDaTela };

async function mensagemDeErro(res: Response, padrao: string): Promise<string> {
  const corpo = await res.json().catch(() => null);
  return typeof corpo?.error === "string" ? corpo.error : padrao;
}

type Leitura = { denied: DeniedReason } | { erro: string } | { dados: RespostaDaConciliacao };

/** Lê a lista do servidor. Fora do componente: quem chama decide o que fazer com o resultado. */
async function buscar(situacao: FiltroDaLista): Promise<Leitura> {
  try {
    const res = await fetch(`/api/financeiro/conciliacao?situacao=${situacao}`);
    const negado = deniedReason(res.status);
    if (negado) return { denied: negado };
    if (!res.ok) return { erro: await mensagemDeErro(res, "Erro ao carregar o extrato.") };
    return { dados: (await res.json()) as RespostaDaConciliacao };
  } catch {
    return { erro: "Erro ao carregar o extrato." };
  }
}

const nomeDoCliente = (titulo: Pick<TituloDaTela, "client" | "counterparty">) => titulo.client?.tradeName || titulo.client?.companyName || titulo.counterparty || "";

/** "vence 05/10/2026" no título em aberto; "pago em 05/10/2026" no pago. */
function dataDoTitulo(titulo: Pick<TituloDaTela, "status" | "paidAt" | "dueDate">): string {
  if (titulo.status === "PAID") return `pago em ${formatDate(titulo.paidAt)}`;
  return titulo.dueDate ? `vence ${formatCalendarDate(titulo.dueDate)}` : "sem vencimento";
}

export default function ConciliacaoPage() {
  const [filtro, setFiltro] = useState<FiltroDaLista>("pendentes");
  const [dados, setDados] = useState<RespostaDaConciliacao | null>(null);
  const [denied, setDenied] = useState<DeniedReason | null>(null);
  const [carregando, setCarregando] = useState(true);
  // O id da linha em que há uma ação em curso, "lote" ou "envio".
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [modal, setModal] = useState<Modal | null>(null);
  const arquivo = useRef<HTMLInputElement>(null);

  const mostrar = useCallback((leitura: Leitura) => {
    if ("denied" in leitura) setDenied(leitura.denied);
    else if ("erro" in leitura) setAviso({ ok: false, texto: leitura.erro });
    else setDados(leitura.dados);
    setCarregando(false);
  }, []);

  /** Lê de novo a lista depois de uma ação. */
  const carregar = async (situacao: FiltroDaLista) => mostrar(await buscar(situacao));

  // A lista da aba escolhida. Se a aba mudar antes da resposta chegar, a resposta antiga é descartada.
  useEffect(() => {
    let ativo = true;
    void buscar(filtro).then((leitura) => {
      if (ativo) mostrar(leitura);
    });
    return () => {
      ativo = false;
    };
  }, [filtro, mostrar]);

  const enviar = async (escolhido: File | undefined) => {
    if (!escolhido) return;
    if (escolhido.size > TAMANHO_MAXIMO_DO_OFX) {
      setAviso({ ok: false, texto: OFX_GRANDE });
      return;
    }
    setOcupado("envio");
    setAviso(null);
    try {
      // O arquivo vai como está (bytes): OFX antigo não é UTF-8, e quem lê é o servidor.
      const res = await fetch("/api/financeiro/conciliacao", { method: "POST", headers: { "Content-Type": "application/x-ofx" }, body: escolhido });
      if (!res.ok) {
        setAviso({ ok: false, texto: await mensagemDeErro(res, "Erro ao importar o extrato.") });
        return;
      }
      const { importadas, repetidas } = (await res.json()) as RespostaDaImportacao;
      const novas = importadas === 1 ? "1 movimentação nova" : `${importadas} movimentações novas`;
      setAviso({ ok: true, texto: repetidas > 0 ? `${novas}; ${repetidas} já estavam importadas.` : `${novas}.` });
      setFiltro("pendentes");
      await carregar("pendentes");
    } catch {
      setAviso({ ok: false, texto: "Erro ao importar o extrato." });
    } finally {
      setOcupado(null);
      if (arquivo.current) arquivo.current.value = "";
    }
  };

  /** Uma ação sobre uma linha. Devolve `true` se o servidor aceitou. */
  const agir = async (linha: LinhaDaTela, corpo: Record<string, unknown>, feito: string): Promise<boolean> => {
    setOcupado(linha.id);
    setAviso(null);
    try {
      const res = await fetch(`/api/financeiro/conciliacao/${linha.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
      if (!res.ok) {
        setAviso({ ok: false, texto: await mensagemDeErro(res, "Erro ao gravar.") });
        return false;
      }
      setAviso({ ok: true, texto: feito });
      await carregar(filtro);
      return true;
    } catch {
      setAviso({ ok: false, texto: "Erro ao gravar." });
      return false;
    } finally {
      setOcupado(null);
    }
  };

  const conciliarCerteiros = async () => {
    setOcupado("lote");
    setAviso(null);
    try {
      const res = await fetch("/api/financeiro/conciliacao/certeiros", { method: "POST" });
      if (!res.ok) {
        setAviso({ ok: false, texto: await mensagemDeErro(res, "Erro ao conciliar os certeiros.") });
        return;
      }
      const { conciliadas, falhas } = (await res.json()) as { conciliadas: number; falhas: { id: string; error: string }[] };
      const feitas = conciliadas === 1 ? "1 linha conciliada" : `${conciliadas} linhas conciliadas`;
      setAviso({ ok: falhas.length === 0, texto: falhas.length === 0 ? `${feitas}.` : `${feitas}; ${falhas.length} não ${falhas.length === 1 ? "pôde" : "puderam"} ser: ${falhas[0].error}` });
      await carregar(filtro);
    } catch {
      setAviso({ ok: false, texto: "Erro ao conciliar os certeiros." });
    } finally {
      setOcupado(null);
    }
  };

  if (carregando) {
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
            Entre de novo para conciliar o extrato.{" "}
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
          <CardDescription>Seu perfil não tem acesso a esta área.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const linhas = dados?.linhas ?? [];
  const contagem = dados?.contagem ?? { pendentes: 0, conciliadas: 0, ignoradas: 0 };
  const certeiros = dados?.certeiros ?? 0;

  return (
    <div className="space-y-2 md:space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Link href="/dashboard/financeiro" aria-label="Voltar ao Financeiro" className="shrink-0 p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <h1 className="text-xl md:text-2xl font-bold font-outfit text-gray-900 dark:text-white truncate">Conciliação</h1>
        </div>
        <div className="flex items-center gap-2">
          {filtro === "pendentes" && certeiros > 0 && (
            <button type="button" onClick={conciliarCerteiros} disabled={ocupado !== null} data-conciliar-certeiros className={SECUNDARIO + " flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400"}>
              {ocupado === "lote" ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCheck className="w-4 h-4" />}
              Certeiros ({certeiros})
            </button>
          )}
          <input ref={arquivo} type="file" accept=".ofx,.OFX,application/x-ofx,text/plain" className="hidden" data-arquivo-ofx onChange={(e) => void enviar(e.target.files?.[0])} />
          <button type="button" onClick={() => arquivo.current?.click()} disabled={ocupado !== null} className={PRIMARIO}>
            {ocupado === "envio" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            Enviar OFX
          </button>
        </div>
      </div>

      <div role="tablist" aria-label="Situação das linhas do extrato" className="grid grid-cols-3 gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-xl">
        {FILTROS_DA_LISTA.map((nome) => (
          <button
            key={nome}
            type="button"
            role="tab"
            aria-selected={filtro === nome}
            data-filtro={nome}
            onClick={() => setFiltro(nome)}
            className={`py-1.5 rounded-lg text-sm font-semibold ${filtro === nome ? "bg-white dark:bg-gray-900 text-blue-700 dark:text-blue-400 shadow-sm" : "text-gray-600 dark:text-gray-300"}`}
          >
            {ROTULO_DO_FILTRO[nome]} ({contagem[nome]})
          </button>
        ))}
      </div>

      {aviso && (
        <p role={aviso.ok ? "status" : "alert"} className={`text-sm ${aviso.ok ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
          {aviso.texto}
        </p>
      )}

      {linhas.length === 0 ? (
        <p className="text-sm text-gray-500 py-6 text-center" data-lista-vazia>
          {filtro === "pendentes"
            ? contagem.conciliadas + contagem.ignoradas === 0
              ? "Nenhum extrato importado ainda. No site do banco, exporte o extrato em OFX (Money) e envie aqui."
              : "Nada pendente: todas as linhas do extrato foram conciliadas ou ignoradas."
            : `Nenhuma linha ${filtro === "conciliadas" ? "conciliada" : "ignorada"}.`}
        </p>
      ) : (
        <ul className="space-y-2">
          {linhas.map((linha) => (
            <CartaoDaLinha
              key={linha.id}
              linha={linha}
              ocupado={ocupado !== null}
              girando={ocupado === linha.id}
              onConciliar={(titulo) => void agir(linha, { action: "conciliar", transactionId: titulo.id }, "Linha conciliada.")}
              onOutro={() => setModal({ tipo: "outro", linha })}
              onCriar={() => setModal({ tipo: "criar", linha })}
              onIgnorar={() => void agir(linha, { action: "ignorar" }, "Linha ignorada.")}
              onDesfazer={() => void agir(linha, { action: "desfazer" }, linha.status === "IGNORED" ? "A linha voltou a pendente." : "Conciliação desfeita.")}
            />
          ))}
        </ul>
      )}

      {dados && linhas.length < contagem[filtro] && (
        <p className="text-xs text-gray-500 text-center">
          Mostrando {linhas.length} de {contagem[filtro]}. As demais aparecem conforme estas saem da fila.
        </p>
      )}

      {modal?.tipo === "outro" && (
        <EscolherOutro
          linha={modal.linha}
          ocupado={ocupado !== null}
          onFechar={() => setModal(null)}
          onEscolher={async (titulo) => {
            if (await agir(modal.linha, { action: "conciliar", transactionId: titulo.id }, "Linha conciliada.")) setModal(null);
          }}
        />
      )}
      {modal?.tipo === "criar" && (
        <CriarLancamento
          linha={modal.linha}
          ocupado={ocupado !== null}
          onFechar={() => setModal(null)}
          onCriar={async (corpo) => {
            if (await agir(modal.linha, { action: "criar", ...corpo }, "Lançamento criado e conciliado.")) setModal(null);
          }}
        />
      )}
    </div>
  );
}

/* ----------------------------------- Cartão ----------------------------------- */

function ValorDaLinha({ valor }: { valor: number }) {
  return (
    <span className={`shrink-0 text-sm font-bold ${valor > 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
      {valor > 0 ? "+" : "−"} {formatCurrency(Math.abs(valor))}
    </span>
  );
}

function CartaoDaLinha({
  linha,
  ocupado,
  girando,
  onConciliar,
  onOutro,
  onCriar,
  onIgnorar,
  onDesfazer,
}: {
  linha: LinhaDaTela;
  ocupado: boolean;
  girando: boolean;
  onConciliar: (titulo: TituloDaTela) => void;
  onOutro: () => void;
  onCriar: () => void;
  onIgnorar: () => void;
  onDesfazer: () => void;
}) {
  const sugerido = linha.candidatos[0];
  const certeiro = sugerido && linha.certeiro === sugerido.id;

  return (
    <li data-linha={linha.id} className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl px-3 py-2.5 md:px-4 md:py-3 space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-900 dark:text-white line-clamp-2 break-words">{linha.description}</p>
          <p className="text-[11px] text-gray-500">
            {formatCalendarDate(linha.postedAt)} · conta {linha.account}
          </p>
        </div>
        <ValorDaLinha valor={linha.amount} />
      </div>

      {linha.status === "PENDING" && (
        <>
          {sugerido ? (
            <div data-sugestao={sugerido.id} className={`rounded-xl px-2.5 py-1.5 text-xs ${certeiro ? "bg-emerald-50 dark:bg-emerald-900/20" : "bg-gray-50 dark:bg-gray-800/50"}`}>
              <p className="font-medium text-gray-900 dark:text-white truncate">
                {certeiro && <span className="mr-1 text-emerald-700 dark:text-emerald-400">Certeiro ·</span>}
                {sugerido.titulo.description}
              </p>
              <p className="text-gray-600 dark:text-gray-300 truncate">
                {[nomeDoCliente(sugerido.titulo), formatCurrency(sugerido.titulo.amount), dataDoTitulo(sugerido.titulo)].filter(Boolean).join(" · ")}
              </p>
              <p className="text-gray-500 truncate">{sugerido.motivos.join(", ")}</p>
              {sugerido.diferenca !== 0 && (
                <p className="text-amber-700 dark:text-amber-400">
                  Ao conciliar, a diferença entra na baixa como {sugerido.diferenca > 0 ? "juros" : "desconto"}.
                </p>
              )}
            </div>
          ) : (
            <p className="text-xs text-gray-500">Nenhum lançamento parecido. Escolha um, crie o lançamento ou ignore.</p>
          )}
          <div className="grid grid-cols-4 gap-1.5">
            <button type="button" disabled={ocupado || !sugerido} onClick={() => sugerido && onConciliar(sugerido.titulo)} data-acao="conciliar" className={PRIMARIO + " px-1"}>
              {girando ? <Loader2 className="w-4 h-4 animate-spin" /> : "Conciliar"}
            </button>
            <button type="button" disabled={ocupado} onClick={onOutro} data-acao="outro" className={SECUNDARIO + " px-1"}>
              Outro
            </button>
            <button type="button" disabled={ocupado} onClick={onCriar} data-acao="criar" className={SECUNDARIO + " px-1"}>
              Criar
            </button>
            <button type="button" disabled={ocupado} onClick={onIgnorar} data-acao="ignorar" className={SECUNDARIO + " px-1"}>
              Ignorar
            </button>
          </div>
        </>
      )}

      {linha.status !== "PENDING" && (
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 text-xs text-gray-600 dark:text-gray-300 truncate">
            {linha.transaction
              ? `${linha.transaction.description} · ${formatCurrency(linha.transaction.amount)}${linha.settled ? " · baixa pela conciliação" : ""}`
              : "Fora da conciliação."}
          </p>
          <button type="button" disabled={ocupado} onClick={onDesfazer} data-acao="desfazer" className={SECUNDARIO + " shrink-0"}>
            {girando ? <Loader2 className="w-4 h-4 animate-spin" /> : linha.status === "IGNORED" ? "Voltar a pendente" : "Desfazer"}
          </button>
        </div>
      )}
    </li>
  );
}

/* ------------------------------- Telas de escolha ------------------------------ */

function Janela({ titulo, linha, onFechar, children }: { titulo: string; linha: LinhaDaTela; onFechar: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-stretch md:items-center justify-center md:p-4 bg-black/50 backdrop-blur-sm">
      <div role="dialog" aria-label={titulo} className="bg-white dark:bg-gray-900 md:rounded-2xl w-full max-w-xl md:max-h-[90vh] overflow-hidden flex flex-col shadow-2xl border border-gray-100 dark:border-gray-800">
        <div className="px-3 py-2 md:px-6 md:py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-base md:text-lg font-bold font-outfit text-gray-900 dark:text-white truncate">{titulo}</h2>
            <p className="text-xs text-gray-500 truncate">
              {formatCalendarDate(linha.postedAt)} · {linha.description}
            </p>
          </div>
          <ValorDaLinha valor={linha.amount} />
          <button type="button" onClick={onFechar} aria-label="Fechar" className="shrink-0 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 md:p-6">{children}</div>
      </div>
    </div>
  );
}

const semAcento = (texto: string) => texto.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/** Outro lançamento para a linha: os do mesmo lado (a receber para crédito, a pagar para débito), com busca. */
function EscolherOutro({ linha, ocupado, onFechar, onEscolher }: { linha: LinhaDaTela; ocupado: boolean; onFechar: () => void; onEscolher: (titulo: TituloDaTela) => void }) {
  const [titulos, setTitulos] = useState<TituloDaTela[] | null>(null);
  const [erro, setErro] = useState("");
  const [busca, setBusca] = useState("");
  const tipo = linha.amount > 0 ? "INCOME" : "EXPENSE";
  const valor = Math.abs(linha.amount);

  useEffect(() => {
    let ativo = true;
    fetch(`/api/financeiro?tipo=${tipo}`)
      .then(async (res) => {
        if (!ativo) return;
        if (res.ok) setTitulos((await res.json()) as TituloDaTela[]);
        else setErro(await mensagemDeErro(res, "Erro ao carregar os lançamentos."));
      })
      .catch(() => {
        if (ativo) setErro("Erro ao carregar os lançamentos.");
      });
    return () => {
      ativo = false;
    };
  }, [tipo]);

  const termo = semAcento(busca.trim());
  // Primeiro os de valor mais perto do extrato; em aberto antes de pago.
  const lista = (titulos ?? [])
    .filter((titulo) => termo === "" || semAcento(`${titulo.description} ${nomeDoCliente(titulo)} ${titulo.amount.toFixed(2).replace(".", ",")}`).includes(termo))
    .sort((a, b) => Math.abs(a.amount - valor) - Math.abs(b.amount - valor) || Number(a.status === "PAID") - Number(b.status === "PAID"))
    .slice(0, 40);

  return (
    <Janela titulo="Escolher outro lançamento" linha={linha} onFechar={onFechar}>
      <input autoFocus value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por descrição, cliente ou valor" aria-label="Buscar lançamento" className={CAMPO} />
      {erro && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {erro}
        </p>
      )}
      {titulos === null && !erro && <Loader2 className="mt-4 mx-auto w-6 h-6 animate-spin text-blue-600" />}
      {titulos !== null && lista.length === 0 && <p className="mt-3 text-sm text-gray-500">Nenhum lançamento {tipo === "INCOME" ? "a receber" : "a pagar"} com essa busca.</p>}
      <ul className="mt-2 space-y-1.5">
        {lista.map((titulo) => (
          <li key={titulo.id}>
            <button
              type="button"
              disabled={ocupado}
              onClick={() => onEscolher(titulo)}
              data-outro={titulo.id}
              className="w-full text-left bg-gray-50 dark:bg-gray-800/50 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-xl px-3 py-2 disabled:opacity-50"
            >
              <span className="flex items-center justify-between gap-2">
                <span className="min-w-0 text-sm font-medium text-gray-900 dark:text-white truncate">{titulo.description}</span>
                <span className="shrink-0 text-sm font-semibold text-gray-900 dark:text-white">{formatCurrency(titulo.amount)}</span>
              </span>
              <span className="block text-xs text-gray-500 truncate">{[nomeDoCliente(titulo), dataDoTitulo(titulo)].filter(Boolean).join(" · ")}</span>
            </button>
          </li>
        ))}
      </ul>
    </Janela>
  );
}

/** Lançamento já pago a partir da linha: o que só existe no extrato (tarifa, juros do banco, imposto). */
function CriarLancamento({
  linha,
  ocupado,
  onFechar,
  onCriar,
}: {
  linha: LinhaDaTela;
  ocupado: boolean;
  onFechar: () => void;
  onCriar: (corpo: { description: string; category: string; costCenter: string; counterparty: string }) => void;
}) {
  const [form, setForm] = useState({ description: linha.description.slice(0, 200), category: "", costCenter: "", counterparty: "" });
  const mudar = (campo: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((atual) => ({ ...atual, [campo]: e.target.value }));

  return (
    <Janela titulo="Criar lançamento" linha={linha} onFechar={onFechar}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onCriar(form);
        }}
        className="grid grid-cols-2 gap-x-3 gap-y-2 md:gap-4"
      >
        <p className="col-span-2 text-xs text-gray-500">
          Nasce como {linha.amount > 0 ? "receita recebida" : "despesa paga"} em {formatCalendarDate(linha.postedAt)}, pelo valor do extrato, já conciliado.
        </p>
        <label className="col-span-2 block min-w-0 space-y-0.5">
          <span className={ROTULO}>Descrição</span>
          <input name="description" required minLength={2} maxLength={200} value={form.description} onChange={mudar("description")} className={CAMPO} />
        </label>
        <label className="block min-w-0 space-y-0.5">
          <span className={ROTULO}>Categoria</span>
          <input name="category" list="categorias-do-extrato" maxLength={80} value={form.category} onChange={mudar("category")} className={CAMPO} />
          <datalist id="categorias-do-extrato">
            {["Tarifa bancária", "Juros e multas", "Impostos", "Rendimento", "Transferência entre contas"].map((categoria) => (
              <option key={categoria} value={categoria} />
            ))}
          </datalist>
        </label>
        <label className="block min-w-0 space-y-0.5">
          <span className={ROTULO}>Centro de custo</span>
          <input name="costCenter" maxLength={80} value={form.costCenter} onChange={mudar("costCenter")} className={CAMPO} />
        </label>
        <label className="col-span-2 block min-w-0 space-y-0.5">
          <span className={ROTULO}>{linha.amount > 0 ? "Pagador" : "Fornecedor"}</span>
          <input name="counterparty" maxLength={160} value={form.counterparty} onChange={mudar("counterparty")} className={CAMPO} />
        </label>
        <div className="col-span-2 flex justify-end gap-2">
          <button type="button" onClick={onFechar} disabled={ocupado} className={SECUNDARIO}>
            Cancelar
          </button>
          <button type="submit" disabled={ocupado} className={PRIMARIO}>
            {ocupado && <Loader2 className="w-4 h-4 animate-spin" />}
            Criar e conciliar
          </button>
        </div>
      </form>
    </Janela>
  );
}
