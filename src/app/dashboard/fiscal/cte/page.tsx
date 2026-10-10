"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, CheckCircle2, FileText, Loader2, X } from "lucide-react";
import { COLLECTION_STATUS, formatCurrency, formatWeight, statusBadge } from "@/lib/format";
import {
  CST_DO_IBSCBS,
  JUSTIFICATIVA_MAXIMA,
  JUSTIFICATIVA_MINIMA,
  ROTULO_DO_AMBIENTE,
  SITUACOES_DO_ICMS,
  dentroDoPrazoDeCancelamento,
  seloDoCte,
  type ConferenciaDoCte,
  type CteEmitido,
  type ResultadoDaEmissao,
  type ResumoDoCte,
  type SituacaoDaEmissao,
  type StatusDoServico,
} from "@/lib/cte";
import { cteRegistrado, pendenciasParaCte, type CargaParaCte } from "@/lib/nfe";
import { BotaoDanfe } from "@/components/fiscal/botao-danfe";
import { deniedReason, type DeniedReason } from "../../financeiro/carregar";
import { BOTAO_AZUL, BOTAO_CLARO, CARD, INPUT, LABEL, ROTULO, erroDe } from "../../deposito/comum";
import { Negado, chaveEmBlocos } from "../comum";

/**
 * CT-e: as cargas alocadas numa viagem (antes da saída), em rota ou entregues, com a situação do CT-e
 * de cada uma. Daqui se confere e se emite o CT-e pela SEFAZ, se baixa o XML
 * autorizado e se cancela. O registro manual de um CT-e emitido em outro
 * sistema continua existindo.
 *
 * A tela nunca diz "autorizado" por conta própria: mostra o que a rota
 * devolveu, e a rota só devolve autorizado com o protocolo da SEFAZ.
 */

type Dados = { denied: DeniedReason } | { denied: null; erro: string } | { denied: null; erro: null; cargas: CargaParaCte[] };

const FALHA = "Não foi possível carregar as cargas.";
const FALHA_AO_REGISTRAR = "Não foi possível registrar o CT-e.";
const FALHA_NA_EMISSAO = "Não foi possível falar com o servidor. Confira a situação do CT-e antes de tentar de novo.";

async function carregar(): Promise<Dados> {
  try {
    const res = await fetch("/api/fiscal/cte");
    const denied = deniedReason(res.status);
    if (denied) return { denied };
    if (!res.ok) return { denied: null, erro: await erroDe(res, FALHA) };
    return { denied: null, erro: null, cargas: (await res.json()) as CargaParaCte[] };
  } catch {
    return { denied: null, erro: FALHA };
  }
}

const MOLDURA = "fixed inset-0 z-50 flex items-stretch md:items-center justify-center md:p-4 bg-black/50";
const JANELA = "flex flex-col w-full md:max-w-lg bg-white dark:bg-gray-900 md:rounded-2xl shadow-xl overflow-hidden";

function Cabecalho({ titulo, carga, aoFechar }: { titulo: string; carga: CargaParaCte; aoFechar: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-800">
      <div className="min-w-0">
        <h2 className="text-lg font-bold font-outfit text-gray-900 dark:text-white">{titulo}</h2>
        <p className="text-xs text-gray-500 truncate">
          Carga <span className="font-mono">{carga.trackingCode ?? "sem código"}</span> · {carga.client.tradeName || carga.client.companyName}
        </p>
      </div>
      <button type="button" onClick={aoFechar} className="p-2 text-gray-500" aria-label="Fechar">
        <X className="w-5 h-5" />
      </button>
    </div>
  );
}

const Linha = ({ rotulo, children }: { rotulo: string; children: React.ReactNode }) => (
  <div className="min-w-0">
    <dt className="text-[11px] leading-tight text-gray-500">{rotulo}</dt>
    <dd className="text-sm text-gray-900 dark:text-white break-words">{children}</dd>
  </div>
);

const FALHA_AO_CONFERIR = "Não foi possível conferir o CT-e.";

async function buscarConferencia(collectionId: string): Promise<ConferenciaDoCte | { erro: string }> {
  try {
    const res = await fetch(`/api/fiscal/cte/emissao?collectionId=${encodeURIComponent(collectionId)}`);
    if (!res.ok) return { erro: await erroDe(res, FALHA_AO_CONFERIR) };
    return (await res.json()) as ConferenciaDoCte;
  } catch {
    return { erro: FALHA_AO_CONFERIR };
  }
}

/** "Conferir e emitir": o que vai no documento, o que falta, e o botão que transmite. */
/** O ICMS do documento numa linha: a situação (ou o grupo, quando é devido a outra UF) e, havendo valor, a conta. */
function linhaDoIcms(icms: NonNullable<ResumoDoCte["icms"]>): string {
  const situacao = icms.grupo === "ICMSOutraUF" ? "Devido à UF de início (ICMSOutraUF)" : SITUACOES_DO_ICMS[icms.situacao];
  if (!(icms.valor > 0)) return situacao;
  return `${situacao} · ${icms.aliquota}% de ${formatCurrency(icms.base)} = ${formatCurrency(icms.valor)}${icms.retido ? " (retido)" : ""}`;
}

function Conferencia({ carga, aoFechar, aoMudar }: { carga: CargaParaCte; aoFechar: () => void; aoMudar: () => void }) {
  const [conferencia, setConferencia] = useState<ConferenciaDoCte | null>(null);
  const [erro, setErro] = useState("");
  const [emitindo, setEmitindo] = useState(false);
  const [resultado, setResultado] = useState<{ autorizado: boolean; mensagem: string } | null>(null);

  const aplicar = (lida: ConferenciaDoCte | { erro: string }) => {
    if ("erro" in lida) setErro(lida.erro);
    else setConferencia(lida);
  };

  useEffect(() => {
    let ativo = true;
    buscarConferencia(carga.id).then((lida) => {
      if (ativo) aplicar(lida);
    });
    return () => {
      ativo = false;
    };
  }, [carga.id]);

  const emitir = async () => {
    setEmitindo(true);
    setErro("");
    setResultado(null);
    try {
      const res = await fetch("/api/fiscal/cte/emissao", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ collectionId: carga.id }) });
      if (!res.ok) setErro(await erroDe(res, FALHA_NA_EMISSAO));
      else {
        const corpo = (await res.json()) as ResultadoDaEmissao;
        setResultado({ autorizado: corpo.autorizado, mensagem: corpo.mensagem });
      }
    } catch {
      setErro(FALHA_NA_EMISSAO);
    } finally {
      setEmitindo(false);
      aoMudar();
      aplicar(await buscarConferencia(carga.id));
    }
  };

  const resumo = conferencia?.resumo ?? null;
  const cte = conferencia?.cte ?? null;
  const emHomologacao = resumo?.ambiente === "HOMOLOGACAO";
  const podeEmitir = conferencia !== null && conferencia.pendencias.length === 0;

  return (
    <div className={MOLDURA} role="dialog" aria-modal="true" aria-label="Conferir e emitir CT-e">
      <div className={JANELA}>
        <Cabecalho titulo="Conferir e emitir CT-e" carga={carga} aoFechar={aoFechar} />
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {!conferencia && !erro && (
            <div className="flex justify-center py-8" role="status" aria-label="Carregando">
              <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
            </div>
          )}

          {resultado && (
            <p data-resultado={resultado.autorizado ? "autorizado" : "nao-autorizado"} role="status" className={`flex items-start gap-2 px-3 py-2 text-sm rounded-lg border ${resultado.autorizado ? "text-emerald-800 border-emerald-200 bg-emerald-50" : "text-red-700 border-red-200 bg-red-50"}`}>
              {resultado.autorizado ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> : <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />}
              <span>{resultado.mensagem}</span>
            </p>
          )}
          {erro && (
            <p role="alert" className="px-3 py-2 text-sm text-red-700 border border-red-200 rounded-lg bg-red-50">
              {erro}
            </p>
          )}

          {cte && !resultado && (cte.situacao === "REJECTED" || cte.semResposta) && (
            <p data-ultima-resposta className="px-3 py-2 text-xs text-amber-900 border border-amber-200 rounded-lg bg-amber-50">
              {cte.semResposta ? "O último envio ficou sem resposta: emitir de novo começa consultando a SEFAZ." : `Última resposta da SEFAZ: ${cte.cStat ?? ""} - ${cte.motivo ?? ""}`}
            </p>
          )}

          {conferencia && conferencia.pendencias.length > 0 && (
            <ul data-pendencias className="px-3 py-2 space-y-1 text-sm text-red-700 border border-red-200 rounded-lg bg-red-50 list-disc list-inside">
              {conferencia.pendencias.map((pendencia) => (
                <li key={pendencia}>{pendencia}</li>
              ))}
            </ul>
          )}
          {conferencia && !conferencia.pronta && (
            <Link href="/dashboard/empresa" className="inline-block text-sm font-medium text-blue-600 hover:underline">
              Abrir Empresa → Fiscal
            </Link>
          )}

          {resumo && (
            <dl data-resumo className="grid grid-cols-2 gap-x-3 gap-y-2">
              <Linha rotulo="Ambiente · série / número">
                {ROTULO_DO_AMBIENTE[resumo.ambiente]} · {resumo.serie} / {resumo.numeroPrevisto}
              </Linha>
              <Linha rotulo="CFOP">{resumo.cfop || "a definir"}</Linha>
              <Linha rotulo="Remetente">{resumo.remetente ? `${resumo.remetente.nome} · ${resumo.remetente.documento}` : "não identificado"}</Linha>
              <Linha rotulo="Destinatário">{resumo.destinatario ? `${resumo.destinatario.nome} · ${resumo.destinatario.documento}` : "não identificado"}</Linha>
              <Linha rotulo="Tomador (quem paga)">
                {resumo.tomador
                  ? `${resumo.tomador.papel === "REMETENTE" ? "o remetente" : resumo.tomador.papel === "DESTINATARIO" ? "o destinatário" : resumo.tomador.nome} · ${resumo.tomador.contribuinte === "9" ? "não contribuinte" : resumo.tomador.contribuinte === "2" ? "isento de IE" : "contribuinte"}`
                  : "não identificado"}
              </Linha>
              <Linha rotulo="Origem → destino">
                {resumo.origem} → {resumo.destino}
              </Linha>
              <Linha rotulo="Prestação (frete)">{resumo.valorDaPrestacao === null ? "a cotar" : formatCurrency(resumo.valorDaPrestacao)}</Linha>
              <Linha rotulo="Valor da carga">{formatCurrency(resumo.valorDaCarga)}</Linha>
              <Linha rotulo="ICMS">{resumo.icms ? linhaDoIcms(resumo.icms) : "a calcular"}</Linha>
              <Linha rotulo="IBS / CBS">
                {resumo.ibsCbs
                  ? `${CST_DO_IBSCBS[resumo.ibsCbs.cst]?.rotulo ?? resumo.ibsCbs.cst}${resumo.ibsCbs.base === null ? "" : ` · ${formatCurrency(resumo.ibsCbs.ibs)} / ${formatCurrency(resumo.ibsCbs.cbs)}`}`
                  : "sem o grupo"}
              </Linha>
              <Linha rotulo="Volumes e peso">
                {resumo.volumes} · {formatWeight(resumo.peso)}
              </Linha>
              <Linha rotulo="NF-e">{resumo.chavesDeNfe.length === 0 ? "sem NF-e" : `${resumo.chavesDeNfe.length} nota(s)`}</Linha>
            </dl>
          )}

          {conferencia && conferencia.avisos.length > 0 && (
            <ul data-avisos className="px-3 py-2 space-y-1 text-xs text-amber-900 border border-amber-200 rounded-lg bg-amber-50 list-disc list-inside">
              {conferencia.avisos.map((aviso) => (
                <li key={aviso}>{aviso}</li>
              ))}
            </ul>
          )}
        </div>
        <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-800">
          <button type="button" data-emitir disabled={!podeEmitir || emitindo} onClick={() => void emitir()} className={`${BOTAO_AZUL} w-full`}>
            {emitindo && <Loader2 className="w-4 h-4 animate-spin" />}
            {emitindo ? "Transmitindo à SEFAZ…" : emHomologacao ? "Emitir em homologação" : "Emitir"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Cancelamento: a justificativa e o envio do evento. */
function Cancelamento({ carga, cte, aoFechar, aoMudar }: { carga: CargaParaCte; cte: CteEmitido; aoFechar: () => void; aoMudar: () => void }) {
  const [justificativa, setJustificativa] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const noPrazo = dentroDoPrazoDeCancelamento(cte.autorizadoEm);

  const cancelar = async () => {
    setEnviando(true);
    setErro("");
    try {
      const res = await fetch(`/api/fiscal/cte/emissao/${cte.id}/cancelar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ justificativa }) });
      if (!res.ok) return setErro(await erroDe(res, "Não foi possível cancelar o CT-e."));
      aoMudar();
      aoFechar();
    } catch {
      setErro("Não foi possível cancelar o CT-e.");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className={MOLDURA} role="dialog" aria-modal="true" aria-label="Cancelar CT-e">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void cancelar();
        }}
        className={JANELA}
      >
        <Cabecalho titulo={`Cancelar CT-e nº ${cte.numero}`} carga={carga} aoFechar={aoFechar} />
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          <p className="text-xs text-gray-600 dark:text-gray-400">
            O cancelamento é um evento enviado à SEFAZ, aceito até 7 dias depois da autorização. O CT-e só fica cancelado quando a SEFAZ registra o evento.
          </p>
          {!noPrazo && (
            <p data-fora-do-prazo className="px-3 py-2 text-sm text-amber-900 border border-amber-200 rounded-lg bg-amber-50">
              O prazo de 7 dias já passou: a SEFAZ não aceita mais o cancelamento deste CT-e.
            </p>
          )}
          {erro && (
            <p role="alert" className="px-3 py-2 text-sm text-red-700 border border-red-200 rounded-lg bg-red-50">
              {erro}
            </p>
          )}
          <label className="block">
            <span className={LABEL}>
              Justificativa ({JUSTIFICATIVA_MINIMA} a {JUSTIFICATIVA_MAXIMA} letras)
            </span>
            <textarea required rows={3} minLength={JUSTIFICATIVA_MINIMA} maxLength={JUSTIFICATIVA_MAXIMA} value={justificativa} onChange={(e) => setJustificativa(e.target.value)} className={`${INPUT} resize-none`} />
          </label>
          <button type="submit" disabled={enviando || !noPrazo || justificativa.trim().length < JUSTIFICATIVA_MINIMA} className={`${BOTAO_AZUL} w-full`}>
            {enviando && <Loader2 className="w-4 h-4 animate-spin" />}
            Cancelar o CT-e na SEFAZ
          </button>
        </div>
      </form>
    </div>
  );
}

function Registro({ carga, aoFechar, aoGravar }: { carga: CargaParaCte; aoFechar: () => void; aoGravar: (carga: CargaParaCte) => void }) {
  const registrado = cteRegistrado(carga);
  const [numero, setNumero] = useState(carga.cteNumber === null ? "" : String(carga.cteNumber));
  const [chave, setChave] = useState(carga.cteKey ?? "");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");

  const gravar = async (cteNumber: string | null, cteKey: string | null) => {
    setEnviando(true);
    setErro("");
    try {
      const res = await fetch("/api/fiscal/cte", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collectionId: carga.id, cteNumber, cteKey }),
      });
      if (!res.ok) {
        setErro(await erroDe(res, FALHA_AO_REGISTRAR));
        return;
      }
      aoGravar((await res.json()) as CargaParaCte);
    } catch {
      setErro(FALHA_AO_REGISTRAR);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className={MOLDURA} role="dialog" aria-modal="true" aria-label="Registrar CT-e emitido em outro sistema">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void gravar(numero, chave);
        }}
        className={JANELA}
      >
        <Cabecalho titulo="Registrar CT-e" carga={carga} aoFechar={aoFechar} />

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          <p className="text-xs text-gray-600 dark:text-gray-400">
            Informe o número e a chave de um CT-e que já foi emitido e autorizado em outro sistema. Este registro só anota os dados na carga: nada é enviado à SEFAZ.
          </p>
          {erro && (
            <p role="alert" className="px-3 py-2 text-sm text-red-700 border border-red-200 rounded-lg bg-red-50">
              {erro}
            </p>
          )}
          <label className="block">
            <span className={LABEL}>Número do CT-e</span>
            <input required inputMode="numeric" value={numero} onChange={(e) => setNumero(e.target.value)} className={INPUT} />
          </label>
          <label className="block">
            <span className={LABEL}>Chave de acesso do CT-e (44 dígitos)</span>
            <textarea required rows={2} inputMode="numeric" value={chave} onChange={(e) => setChave(e.target.value)} className={`${INPUT} font-mono resize-none`} />
          </label>
          <button type="submit" disabled={enviando} className={`${BOTAO_AZUL} w-full`}>
            {enviando && <Loader2 className="w-4 h-4 animate-spin" />}
            Salvar registro
          </button>
          {registrado && (
            <button type="button" disabled={enviando} onClick={() => void gravar(null, null)} className={`${BOTAO_CLARO} w-full`}>
              Desfazer o registro
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

/** O topo da tela: o ambiente em uso, o que falta para emitir e a consulta ao serviço da SEFAZ. */
function Situacao({ situacao }: { situacao: SituacaoDaEmissao | null }) {
  const [status, setStatus] = useState<StatusDoServico | { erro: string } | null>(null);
  const [consultando, setConsultando] = useState(false);

  const consultar = async () => {
    setConsultando(true);
    try {
      const res = await fetch("/api/fiscal/cte/status-servico");
      setStatus(res.ok ? ((await res.json()) as StatusDoServico) : { erro: await erroDe(res, "Não foi possível consultar a SEFAZ.") });
    } catch {
      setStatus({ erro: "Não foi possível consultar a SEFAZ." });
    } finally {
      setConsultando(false);
    }
  };

  if (!situacao) return null;
  if (!situacao.pronta) {
    return (
      <div data-aviso-cte="falta" role="note" className="flex items-start gap-2 px-3 py-2.5 text-sm text-amber-900 border border-amber-300 rounded-xl bg-amber-50">
        <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-amber-600" />
        <div className="min-w-0">
          <p className="font-semibold">A emissão de CT-e ainda não está pronta nesta empresa.</p>
          <ul className="list-disc list-inside">
            {situacao.faltas.map((falta) => (
              <li key={falta}>{falta}</li>
            ))}
          </ul>
          <Link href="/dashboard/empresa" className="font-medium text-blue-700 hover:underline">
            Abrir Empresa → Fiscal
          </Link>
        </div>
      </div>
    );
  }
  const homologacao = situacao.ambiente === "HOMOLOGACAO";
  return (
    <div data-aviso-cte="pronta" role="note" className={`flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm border rounded-xl ${homologacao ? "text-amber-900 border-amber-300 bg-amber-50" : "text-emerald-900 border-emerald-300 bg-emerald-50"}`}>
      <p className="min-w-0">
        <strong>{homologacao ? "Emissão em homologação" : "Emissão em produção"}</strong>
        {homologacao ? ": CT-e de teste, sem valor fiscal." : ": CT-e com valor fiscal."}
        {status && (
          <span data-status-sefaz className="block text-xs">
            {"erro" in status ? status.erro : `SEFAZ ${status.autorizador}: ${status.cStat ?? ""} ${status.motivo}`}
          </span>
        )}
      </p>
      <button type="button" data-consultar-sefaz disabled={consultando} onClick={() => void consultar()} className="shrink-0 text-xs font-medium underline disabled:opacity-60">
        {consultando ? "Consultando…" : "Status da SEFAZ"}
      </button>
    </div>
  );
}

const COR_DO_SELO: Record<CteEmitido["situacao"], string> = {
  AUTHORIZED: "bg-emerald-100 text-emerald-800",
  CANCELLED: "bg-gray-200 text-gray-700",
  REJECTED: "bg-red-100 text-red-700",
  DRAFT: "bg-amber-100 text-amber-800",
};

type Aberto = { tipo: "registro" | "conferencia" | "cancelamento"; carga: CargaParaCte };

export default function CtePage() {
  const [dados, setDados] = useState<Dados | null>(null);
  const [situacao, setSituacao] = useState<SituacaoDaEmissao | null>(null);
  const [aberto, setAberto] = useState<Aberto | null>(null);

  const recarregar = useCallback(async () => {
    setDados(await carregar());
  }, []);

  useEffect(() => {
    let ativo = true;
    carregar().then((resultado) => {
      if (ativo) setDados(resultado);
    });
    fetch("/api/fiscal/cte/situacao")
      .then((res) => (res.ok ? res.json() : null))
      .then((corpo: SituacaoDaEmissao | null) => {
        if (ativo && corpo) setSituacao(corpo);
      })
      .catch(() => {
        // Sem a leitura o aviso do topo não aparece; a conferência de cada carga diz o que falta.
      });
    return () => {
      ativo = false;
    };
  }, []);

  if (dados && dados.denied !== null) return <Negado motivo={dados.denied} />;

  const cargas = dados && dados.denied === null && dados.erro === null ? dados.cargas : null;

  const aoGravar = (gravada: CargaParaCte) => {
    setDados((atual) =>
      atual && atual.denied === null && atual.erro === null
        ? { ...atual, cargas: atual.cargas.map((carga) => (carga.id === gravada.id ? gravada : carga)) }
        : atual,
    );
    setAberto(null);
  };

  return (
    <div className="space-y-3 md:space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold font-outfit text-gray-900 dark:text-white">CT-e</h1>
          <p className="hidden md:block text-gray-500 text-sm mt-1">Cargas em viagem (antes da saída), em rota ou entregues: conferir, emitir, baixar o XML e cancelar o CT-e</p>
        </div>
        <Link href="/dashboard/fiscal" className={`${BOTAO_CLARO} shrink-0`}>
          <ArrowLeft className="w-4 h-4" />
          Notas fiscais
        </Link>
      </div>

      <Situacao situacao={situacao} />

      {!dados && (
        <div className="flex items-center justify-center h-[200px]" role="status" aria-label="Carregando">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        </div>
      )}

      {dados && dados.denied === null && dados.erro !== null && (
        <p role="alert" className="px-4 py-3 text-sm text-red-700 border border-red-200 rounded-lg bg-red-50">
          {dados.erro}
        </p>
      )}

      {cargas && (
        <div className={`${CARD} overflow-hidden`}>
          {cargas.length === 0 ? (
            <div className="p-10 text-center text-gray-500">
              <FileText className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p>Nenhuma carga alocada em viagem, em rota ou entregue.</p>
            </div>
          ) : (
            <table className="block md:table w-full text-sm">
              <thead className="hidden md:table-header-group bg-gray-50 dark:bg-gray-950 text-gray-500 text-left">
                <tr>
                  <th className="px-4 py-3 font-medium">Carga</th>
                  <th className="px-4 py-3 font-medium">Remetente e destinatário</th>
                  <th className="px-4 py-3 font-medium">Rota</th>
                  <th className="px-4 py-3 font-medium">Mercadoria e frete</th>
                  <th className="px-4 py-3 font-medium">CT-e</th>
                  <th className="px-4 py-3 font-medium">Ações</th>
                </tr>
              </thead>
              <tbody className="block md:table-row-group divide-y divide-gray-100 dark:divide-gray-800">
                {cargas.map((carga) => {
                  const registrado = cteRegistrado(carga);
                  const emitido = carga.emitido ?? null;
                  // O registro manual só aparece como tal quando não é o CT-e que este sistema autorizou.
                  const registradoDeFora = registrado && !(emitido && emitido.chave === carga.cteKey);
                  const faltas = pendenciasParaCte(carga);
                  const selo = statusBadge(COLLECTION_STATUS, carga.status);
                  const temXml = emitido && (emitido.situacao === "AUTHORIZED" || emitido.situacao === "CANCELLED");
                  return (
                    <tr key={carga.id} data-carga={carga.id} className="grid grid-cols-2 gap-x-3 gap-y-1.5 px-3 py-2.5 md:table-row">
                      <td className="col-span-2 min-w-0 md:table-cell md:px-4 md:py-3">
                        <p className="font-medium text-gray-900 dark:text-white truncate">{carga.client.tradeName || carga.client.companyName}</p>
                        <p className="text-xs text-gray-500">
                          <span className="font-mono">{carga.trackingCode ?? "sem código"}</span> · {selo.label} · {carga.volumes} vol · {formatWeight(carga.weight)}
                        </p>
                      </td>
                      <td data-rotulo="Remetente e destinatário" className={`col-span-2 min-w-0 md:table-cell md:px-4 md:py-3 text-gray-700 dark:text-gray-300 ${ROTULO}`}>
                        <span className="block truncate">{carga.sender}</span>
                        <span className="block truncate">{carga.receiver}</span>
                      </td>
                      <td data-rotulo="Rota" className={`min-w-0 md:table-cell md:px-4 md:py-3 text-gray-700 dark:text-gray-300 ${ROTULO}`}>
                        <span className="block truncate">{carga.origin}</span>
                        <span className="block truncate">{carga.destination}</span>
                      </td>
                      <td data-rotulo="Mercadoria e frete" className={`min-w-0 md:table-cell md:px-4 md:py-3 text-gray-700 dark:text-gray-300 ${ROTULO}`}>
                        <span className="block">{formatCurrency(carga.invoiceValue)}</span>
                        <span className="block text-xs text-gray-500">frete {carga.freightValue === null ? "a cotar" : formatCurrency(carga.freightValue)}</span>
                      </td>
                      <td data-rotulo="CT-e" className={`col-span-2 min-w-0 md:table-cell md:px-4 md:py-3 ${ROTULO}`}>
                        {registradoDeFora ? (
                          <>
                            <span data-cte="registrado" className="inline-block text-xs px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 whitespace-nowrap">
                              Registrado nº {carga.cteNumber}
                            </span>
                            <span className="block mt-1 font-mono text-[10px] text-gray-500 break-all">{chaveEmBlocos(carga.cteKey ?? "")}</span>
                          </>
                        ) : emitido ? (
                          <>
                            <span data-cte={emitido.situacao} className={`inline-block text-xs px-2.5 py-1 rounded-full whitespace-nowrap ${COR_DO_SELO[emitido.situacao]}`}>
                              {seloDoCte(emitido)}
                            </span>
                            {emitido.situacao === "REJECTED" && (
                              <span className="block mt-1 text-[11px] text-red-700">
                                {emitido.cStat} - {emitido.motivo}
                              </span>
                            )}
                          </>
                        ) : (
                          <>
                            <span data-cte="nao-emitido" className="inline-block text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-700 whitespace-nowrap">
                              Não emitido
                            </span>
                            {faltas.length > 0 && <span className="block mt-1 text-[11px] text-amber-700">Falta: {faltas.join(", ")}</span>}
                          </>
                        )}
                      </td>
                      <td className="col-span-2 min-w-0 md:table-cell md:px-4 md:py-3">
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm font-medium">
                          {!registradoDeFora && emitido?.situacao !== "AUTHORIZED" && (
                            <button type="button" data-acao="conferir" onClick={() => setAberto({ tipo: "conferencia", carga })} className="text-blue-600 hover:underline">
                              Conferir e emitir
                            </button>
                          )}
                          {temXml && (
                            <a data-acao="xml" href={`/api/fiscal/cte/emissao/${emitido.id}/xml`} className="text-blue-600 hover:underline">
                              Baixar XML
                            </a>
                          )}
                          {emitido?.situacao === "AUTHORIZED" && situacao?.dacte && (
                            <BotaoDanfe documento="dacte" endereco={`/api/fiscal/cte/emissao/${emitido.id}/dacte`} className="text-blue-600" />
                          )}
                          {emitido?.situacao === "AUTHORIZED" && (
                            <button type="button" data-acao="cancelar" onClick={() => setAberto({ tipo: "cancelamento", carga })} className="text-red-600 hover:underline">
                              Cancelar
                            </button>
                          )}
                          {emitido?.situacao !== "AUTHORIZED" && (
                            <button type="button" data-acao="registrar" onClick={() => setAberto({ tipo: "registro", carga })} className="text-gray-600 dark:text-gray-300 hover:underline">
                              {registradoDeFora ? "Alterar registro" : "Registrar CT-e de fora"}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {aberto?.tipo === "registro" && <Registro key={aberto.carga.id} carga={aberto.carga} aoFechar={() => setAberto(null)} aoGravar={aoGravar} />}
      {aberto?.tipo === "conferencia" && <Conferencia key={aberto.carga.id} carga={aberto.carga} aoFechar={() => setAberto(null)} aoMudar={() => void recarregar()} />}
      {aberto?.tipo === "cancelamento" && aberto.carga.emitido && (
        <Cancelamento key={aberto.carga.id} carga={aberto.carga} cte={aberto.carga.emitido} aoFechar={() => setAberto(null)} aoMudar={() => void recarregar()} />
      )}
    </div>
  );
}
