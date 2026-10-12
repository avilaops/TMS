"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, CheckCircle2, FileText, Loader2, X } from "lucide-react";
import { COLLECTION_STATUS, formatCurrency, formatWeight, statusBadge } from "@/lib/format";
import {
  CST_DO_IBSCBS,
  JUSTIFICATIVA_DA_SVC_MAXIMA,
  JUSTIFICATIVA_DA_SVC_MINIMA,
  JUSTIFICATIVA_MAXIMA,
  JUSTIFICATIVA_MINIMA,
  MAXIMO_DE_CORRECOES_POR_CARTA,
  QUANDO_REGISTRAR_A_ENTREGA,
  ROTULO_DO_AMBIENTE,
  ROTULO_DO_EVENTO_DO_CTE,
  SITUACOES_DO_ICMS,
  TIPO_DO_EVENTO_DO_CTE,
  campoProibidoNaCarta,
  dentroDoPrazoDeCancelamento,
  fraseDoCampoProibido,
  seloDoCte,
  type ConferenciaDoCte,
  type ConferenciaNaSefaz,
  type CteEmitido,
  type EventoDoCte,
  type EventosDoCte,
  type ResultadoDaEmissao,
  type ResumoDoCte,
  type SituacaoDaEmissao,
  type StatusDoServico,
} from "@/lib/cte";
import { cteRegistrado, pendenciasParaCte, type CargaParaCte } from "@/lib/nfe";
import { ROTULO_DO_SERVICO } from "@/lib/redespacho";
import { BotaoDanfe } from "@/components/fiscal/botao-danfe";
import { deniedReason, type DeniedReason } from "../../financeiro/carregar";
import { BOTAO_AZUL, BOTAO_CLARO, CARD, INPUT, LABEL, ROTULO, erroDe } from "../../deposito/comum";
import { Negado, chaveEmBlocos } from "../comum";

/**
 * CT-e: as cargas alocadas numa viagem (antes da saída), em rota ou entregues, com a situação do CT-e
 * de cada uma. Daqui se confere e se emite o CT-e pela SEFAZ (ou, quando ela
 * não responde, pela SVC), se baixa o XML autorizado, se corrige por carta de
 * correção, se registra a entrega, se confere a situação na SEFAZ e se
 * cancela. O registro manual de um CT-e emitido em outro sistema continua
 * existindo.
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

/** Como a conferência chama o tomador que é uma das partes do documento. "Outro" aparece pelo nome. */
const PAPEL_DO_TOMADOR: Partial<Record<NonNullable<ResumoDoCte["tomador"]>["papel"], string>> = {
  REMETENTE: "o remetente",
  EXPEDIDOR: "o expedidor",
  RECEBEDOR: "o recebedor",
  DESTINATARIO: "o destinatário",
};

function Conferencia({ carga, aoFechar, aoMudar }: { carga: CargaParaCte; aoFechar: () => void; aoMudar: () => void }) {
  const [conferencia, setConferencia] = useState<ConferenciaDoCte | null>(null);
  const [erro, setErro] = useState("");
  const [emitindo, setEmitindo] = useState(false);
  const [resultado, setResultado] = useState<{ autorizado: boolean; mensagem: string } | null>(null);
  // A emissão pela SVC é um pedido explícito: a pessoa abre o bloco e escreve a justificativa.
  const [pelaSvc, setPelaSvc] = useState(false);
  const [justificativa, setJustificativa] = useState("");

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

  const emitir = async (svc: { justificativa: string } | null = null) => {
    setEmitindo(true);
    setErro("");
    setResultado(null);
    try {
      const res = await fetch("/api/fiscal/cte/emissao", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(svc ? { collectionId: carga.id, svc } : { collectionId: carga.id }) });
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
  const svc = conferencia?.svc?.oferecida ? conferencia.svc.nome : null;
  const justificativaServe = justificativa.trim().length >= JUSTIFICATIVA_DA_SVC_MINIMA;

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
              {/* Redespacho e subcontratação: as linhas só aparecem quando a carga tem o que mostrar. */}
              {resumo.servico.tipo !== "NORMAL" && (
                <>
                  <Linha rotulo="Tipo de serviço">
                    <span data-servico={resumo.servico.tipo}>{ROTULO_DO_SERVICO[resumo.servico.tipo]}</span>
                  </Linha>
                  <Linha rotulo="CT-e anterior">
                    <span data-cte-anterior>
                      {resumo.servico.chaveDoCteAnterior ? `${resumo.servico.emissorDoAnterior ?? "chave a conferir"} · ${chaveEmBlocos(resumo.servico.chaveDoCteAnterior)}` : "falta a chave"}
                    </span>
                  </Linha>
                </>
              )}
              <Linha rotulo="Remetente">{resumo.remetente ? `${resumo.remetente.nome} · ${resumo.remetente.documento}` : "não identificado"}</Linha>
              <Linha rotulo="Destinatário">{resumo.destinatario ? `${resumo.destinatario.nome} · ${resumo.destinatario.documento}` : "não identificado"}</Linha>
              {(resumo.expedidor || resumo.servico.tipo === "INTERMEDIATE") && (
                <Linha rotulo="Expedidor">
                  <span data-expedidor>{resumo.expedidor ? `${resumo.expedidor.nome} · ${resumo.expedidor.documento}` : "falta informar"}</span>
                </Linha>
              )}
              {(resumo.recebedor || resumo.servico.tipo === "INTERMEDIATE") && (
                <Linha rotulo="Recebedor">
                  <span data-recebedor>{resumo.recebedor ? `${resumo.recebedor.nome} · ${resumo.recebedor.documento}` : "falta informar"}</span>
                </Linha>
              )}
              <Linha rotulo="Tomador (quem paga)">
                {resumo.tomador
                  ? `${PAPEL_DO_TOMADOR[resumo.tomador.papel] ?? resumo.tomador.nome} · ${resumo.tomador.contribuinte === "9" ? "não contribuinte" : resumo.tomador.contribuinte === "2" ? "isento de IE" : "contribuinte"}`
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
        <div className="px-4 py-3 space-y-2 border-t border-gray-100 dark:border-gray-800">
          {svc && pelaSvc && (
            <label data-svc className="block">
              <span className={LABEL}>
                Por que a contingência ({JUSTIFICATIVA_DA_SVC_MINIMA} a {JUSTIFICATIVA_DA_SVC_MAXIMA} letras)
              </span>
              <textarea rows={2} maxLength={JUSTIFICATIVA_DA_SVC_MAXIMA} value={justificativa} onChange={(e) => setJustificativa(e.target.value)} className={`${INPUT} resize-none`} />
              <span className="block mt-1 text-[11px] leading-tight text-gray-500">
                A {svc} só autoriza quando a SEFAZ do seu estado a aciona. O CT-e sai com número novo; o envio anterior é conferido depois.
              </span>
            </label>
          )}
          {svc && pelaSvc ? (
            <button type="button" data-emitir-svc disabled={!podeEmitir || emitindo || !justificativaServe} onClick={() => void emitir({ justificativa })} className={`${BOTAO_AZUL} w-full`}>
              {emitindo && <Loader2 className="w-4 h-4 animate-spin" />}
              {emitindo ? `Transmitindo à ${svc}…` : `Emitir pela ${svc}`}
            </button>
          ) : (
            <button type="button" data-emitir disabled={!podeEmitir || emitindo} onClick={() => void emitir()} className={`${BOTAO_AZUL} w-full`}>
              {emitindo && <Loader2 className="w-4 h-4 animate-spin" />}
              {emitindo ? "Transmitindo à SEFAZ…" : emHomologacao ? "Emitir em homologação" : "Emitir"}
            </button>
          )}
          {svc && (
            <button type="button" data-alternar-svc disabled={emitindo} onClick={() => setPelaSvc((atual) => !atual)} className="block w-full text-xs font-medium text-center text-blue-600 hover:underline disabled:opacity-60">
              {pelaSvc ? "Voltar à emissão normal" : `A SEFAZ não responde? Emitir pela ${svc} (contingência)`}
            </button>
          )}
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
          <p data-o-que-barra className="text-xs text-gray-600 dark:text-gray-400">
            Com carta de correção registrada, o cancelamento não volta mais. Com comprovante de entrega registrado, volta depois de cancelar o comprovante.
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

/* ------------------------- Eventos: correção, entrega, conferência ---------------------- */

const FALHA_NOS_EVENTOS = "Não foi possível ler os eventos do CT-e.";
const DIA_E_HORA = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
const diaEHora = (instante: string | null) => (instante ? DIA_E_HORA.format(new Date(instante)) : "");

async function buscarEventos(cteId: string): Promise<EventosDoCte | { erro: string }> {
  try {
    const res = await fetch(`/api/fiscal/cte/emissao/${cteId}/eventos`);
    if (!res.ok) return { erro: await erroDe(res, FALHA_NOS_EVENTOS) };
    return (await res.json()) as EventosDoCte;
  } catch {
    return { erro: FALHA_NOS_EVENTOS };
  }
}

/** Os eventos que a SEFAZ registrou, um por linha: o que é, quando, o protocolo e o que disse. */
function ListaDeEventos({ eventos, vazio }: { eventos: EventoDoCte[]; vazio?: string }) {
  if (eventos.length === 0) return vazio ? <p className="text-xs text-gray-500">{vazio}</p> : null;
  return (
    <ul data-eventos className="text-xs border border-gray-200 divide-y divide-gray-100 rounded-lg dark:border-gray-700 dark:divide-gray-800">
      {eventos.map((evento) => (
        <li key={evento.id} data-evento={evento.tipo} className="px-3 py-1.5 min-w-0">
          <span className="font-medium text-gray-900 dark:text-white">
            {ROTULO_DO_EVENTO_DO_CTE[evento.tipo] ?? `Evento ${evento.tipo}`} nº {evento.sequencia}
          </span>
          {evento.canceladoEm && <span className="text-red-700"> (cancelado)</span>}
          <span className="text-gray-500">
            {" "}
            · {diaEHora(evento.registradoEm)}
            {evento.protocolo ? ` · prot. ${evento.protocolo}` : ""}
          </span>
          <span className="block text-gray-600 break-words dark:text-gray-400">{evento.descricao}</span>
        </li>
      ))}
    </ul>
  );
}

const Erro = ({ texto }: { texto: string }) =>
  texto ? (
    <p role="alert" className="px-3 py-2 text-sm text-red-700 border border-red-200 rounded-lg bg-red-50">
      {texto}
    </p>
  ) : null;

const Carregando = () => (
  <div className="flex justify-center py-6" role="status" aria-label="Carregando">
    <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
  </div>
);

/** Lê os eventos do CT-e ao abrir o painel. */
function useEventos(cteId: string) {
  const [dados, setDados] = useState<EventosDoCte | null>(null);
  const [erro, setErro] = useState("");
  useEffect(() => {
    let ativo = true;
    buscarEventos(cteId).then((lidos) => {
      if (!ativo) return;
      if ("erro" in lidos) setErro(lidos.erro);
      else setDados(lidos);
    });
    return () => {
      ativo = false;
    };
  }, [cteId]);
  return { dados, setDados, erro, setErro };
}

/** O campo do item da lista: o mesmo campo de sempre, estreito, ao lado do valor. */
const INPUT_CURTO = INPUT.replace("w-full", "w-16 shrink-0");

type Correcao = { grupo: string; campo: string; valor: string; item: string };
const CORRECAO_VAZIA: Correcao = { grupo: "", campo: "", valor: "", item: "" };

/** Carta de correção: as cartas já registradas e o formulário da próxima (grupo, campo e valor novo de cada correção). */
function CartaDeCorrecao({ carga, cte, aoFechar }: { carga: CargaParaCte; cte: CteEmitido; aoFechar: () => void }) {
  const { dados, setDados, erro, setErro } = useEventos(cte.id);
  const [correcoes, setCorrecoes] = useState<Correcao[]>([CORRECAO_VAZIA]);
  const [enviando, setEnviando] = useState(false);
  const [registrada, setRegistrada] = useState(false);

  const mudar = (indice: number, campo: keyof Correcao, valor: string) => setCorrecoes((atuais) => atuais.map((correcao, i) => (i === indice ? { ...correcao, [campo]: valor } : correcao)));
  const proibida = correcoes.find((correcao) => correcao.grupo.trim() !== "" && correcao.campo.trim() !== "" && campoProibidoNaCarta(correcao.grupo, correcao.campo));
  const completa = correcoes.every((correcao) => correcao.grupo.trim() !== "" && correcao.campo.trim() !== "" && correcao.valor.trim() !== "");

  const enviar = async () => {
    setEnviando(true);
    setErro("");
    setRegistrada(false);
    try {
      const res = await fetch(`/api/fiscal/cte/emissao/${cte.id}/correcao`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ correcoes }) });
      if (!res.ok) return setErro(await erroDe(res, "Não foi possível registrar a carta de correção."));
      setDados((await res.json()) as EventosDoCte);
      setCorrecoes([CORRECAO_VAZIA]);
      setRegistrada(true);
    } catch {
      setErro("Não foi possível falar com o servidor. Confira na SEFAZ antes de tentar de novo.");
    } finally {
      setEnviando(false);
    }
  };

  const cartas = dados?.eventos.filter((evento) => evento.tipo === TIPO_DO_EVENTO_DO_CTE.CARTA_DE_CORRECAO) ?? [];

  return (
    <div className={MOLDURA} role="dialog" aria-modal="true" aria-label="Carta de correção do CT-e">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void enviar();
        }}
        className={JANELA}
      >
        <Cabecalho titulo={`Corrigir CT-e nº ${cte.numero}`} carga={carga} aoFechar={aoFechar} />
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          <p className="text-[11px] leading-tight text-gray-600 dark:text-gray-400">
            A carta não corrige valor do imposto ou da prestação, quem é o emitente, o tomador, o remetente ou o destinatário, nem a data de emissão. Com carta registrada, o CT-e não pode mais ser cancelado.
          </p>
          {registrada && (
            <p data-resultado="registrada" role="status" className="flex items-start gap-2 px-3 py-2 text-sm border rounded-lg text-emerald-800 border-emerald-200 bg-emerald-50">
              <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
              <span>Carta de correção registrada pela SEFAZ.</span>
            </p>
          )}
          <Erro texto={erro} />
          {proibida && <Erro texto={fraseDoCampoProibido(proibida.grupo.trim(), proibida.campo.trim())} />}

          {correcoes.map((correcao, indice) => (
            <fieldset key={indice} data-correcao={indice} className="grid grid-cols-2 gap-x-3 gap-y-2">
              <label className="block min-w-0">
                <span className={LABEL}>Grupo (ex.: compl)</span>
                <input required maxLength={20} autoCapitalize="none" value={correcao.grupo} onChange={(e) => mudar(indice, "grupo", e.target.value)} className={`${INPUT} font-mono`} />
              </label>
              <label className="block min-w-0">
                <span className={LABEL}>Campo (ex.: xObs)</span>
                <input required maxLength={20} autoCapitalize="none" value={correcao.campo} onChange={(e) => mudar(indice, "campo", e.target.value)} className={`${INPUT} font-mono`} />
              </label>
              <label className="block min-w-0 col-span-2">
                <span className="flex items-center justify-between gap-2">
                  <span className={LABEL}>Valor novo</span>
                  {correcoes.length > 1 && (
                    <button type="button" data-remover-correcao onClick={() => setCorrecoes((atuais) => atuais.filter((_, i) => i !== indice))} className="text-xs text-red-600 hover:underline">
                      Remover
                    </button>
                  )}
                </span>
                <span className="flex gap-2">
                  <input required maxLength={500} value={correcao.valor} onChange={(e) => mudar(indice, "valor", e.target.value)} className={INPUT} />
                  {/* Só quando o campo está numa lista (o 2º `infQ`, por exemplo): a posição, de 1 a 99. */}
                  <input inputMode="numeric" maxLength={2} placeholder="item" aria-label="Item da lista (opcional)" value={correcao.item} onChange={(e) => mudar(indice, "item", e.target.value)} className={INPUT_CURTO} />
                </span>
              </label>
            </fieldset>
          ))}
          {correcoes.length < MAXIMO_DE_CORRECOES_POR_CARTA && (
            <button type="button" data-mais-correcao onClick={() => setCorrecoes((atuais) => [...atuais, CORRECAO_VAZIA])} className="text-xs font-medium text-blue-600 hover:underline">
              + outra correção na mesma carta
            </button>
          )}

          {!dados && !erro && <Carregando />}
          {dados && <ListaDeEventos eventos={cartas} vazio="Nenhuma carta de correção registrada para este CT-e." />}
        </div>
        <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-800">
          <button type="submit" data-registrar-carta disabled={enviando || !completa || Boolean(proibida)} className={`${BOTAO_AZUL} w-full`}>
            {enviando && <Loader2 className="w-4 h-4 animate-spin" />}
            {enviando ? "Enviando à SEFAZ…" : "Registrar carta na SEFAZ"}
          </button>
        </div>
      </form>
    </div>
  );
}

/** Comprovante de entrega do CT-e na SEFAZ: registrar com o comprovante aprovado da carga, ou cancelar o que está registrado. */
function EntregaNaSefaz({ carga, cte, aoFechar }: { carga: CargaParaCte; cte: CteEmitido; aoFechar: () => void }) {
  const { dados, setDados, erro, setErro } = useEventos(cte.id);
  const [enviando, setEnviando] = useState(false);

  const enviar = async (metodo: "POST" | "DELETE") => {
    setEnviando(true);
    setErro("");
    try {
      const res = await fetch(`/api/fiscal/cte/emissao/${cte.id}/entrega`, { method: metodo });
      if (!res.ok) return setErro(await erroDe(res, "Não foi possível falar com a SEFAZ."));
      setDados((await res.json()) as EventosDoCte);
    } catch {
      setErro("Não foi possível falar com o servidor. Confira na SEFAZ antes de tentar de novo.");
    } finally {
      setEnviando(false);
    }
  };

  const entrega = dados?.entrega ?? null;
  const daEntrega = dados?.eventos.filter((evento) => evento.tipo === TIPO_DO_EVENTO_DO_CTE.COMPROVANTE_DE_ENTREGA || evento.tipo === TIPO_DO_EVENTO_DO_CTE.CANCELAMENTO_DO_COMPROVANTE) ?? [];

  return (
    <div className={MOLDURA} role="dialog" aria-modal="true" aria-label="Comprovante de entrega do CT-e na SEFAZ">
      <div className={JANELA}>
        <Cabecalho titulo={`Entrega do CT-e nº ${cte.numero}`} carga={carga} aoFechar={aoFechar} />
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          <p data-quando-registrar className="text-[11px] leading-tight text-gray-600 dark:text-gray-400">
            {QUANDO_REGISTRAR_A_ENTREGA}
          </p>
          <Erro texto={erro} />
          {!dados && !erro && <Carregando />}
          {entrega && (
            <dl data-entrega={entrega.situacao} className="grid grid-cols-2 gap-x-3 gap-y-2">
              <Linha rotulo="Quem recebeu">{entrega.recebedor ?? "não informado"}</Linha>
              <Linha rotulo="Entregue em">{diaEHora(entrega.entregueEm) || "não informado"}</Linha>
              <Linha rotulo="Na SEFAZ">{entrega.situacao === "REGISTRADA" ? `Registrada · prot. ${entrega.protocolo ?? ""}` : "Não registrada"}</Linha>
              <Linha rotulo="Imagem do hash">{entrega.imagem ?? "sem imagem"}</Linha>
            </dl>
          )}
          {entrega?.motivo && (
            <p data-impedimento className="px-3 py-2 text-xs text-amber-900 border border-amber-200 rounded-lg bg-amber-50">
              {entrega.motivo}
            </p>
          )}
          {dados && <ListaDeEventos eventos={daEntrega} />}
        </div>
        <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-800">
          {entrega?.situacao === "REGISTRADA" ? (
            <button type="button" data-cancelar-entrega disabled={enviando} onClick={() => void enviar("DELETE")} className={`${BOTAO_CLARO} w-full`}>
              {enviando && <Loader2 className="w-4 h-4 animate-spin" />}
              Cancelar comprovante na SEFAZ
            </button>
          ) : (
            <button type="button" data-registrar-entrega disabled={enviando || entrega?.situacao !== "DISPONIVEL"} onClick={() => void enviar("POST")} className={`${BOTAO_AZUL} w-full`}>
              {enviando && <Loader2 className="w-4 h-4 animate-spin" />}
              {enviando ? "Enviando à SEFAZ…" : "Registrar entrega na SEFAZ"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** "Conferir na SEFAZ": consulta pela chave ao abrir e mostra a situação que voltou e os eventos vinculados. */
function ConferenciaNaSefazDoCte({ carga, cte, aoFechar, aoMudar }: { carga: CargaParaCte; cte: CteEmitido; aoFechar: () => void; aoMudar: () => void }) {
  const [resultado, setResultado] = useState<ConferenciaNaSefaz | null>(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    let ativo = true;
    (async () => {
      try {
        const res = await fetch(`/api/fiscal/cte/emissao/${cte.id}/situacao`, { method: "POST" });
        const lido = res.ok ? ((await res.json()) as ConferenciaNaSefaz) : null;
        const falha = lido ? "" : await erroDe(res, "Não foi possível conferir o CT-e na SEFAZ.");
        if (!ativo) return;
        if (lido) setResultado(lido);
        else setErro(falha);
      } catch {
        if (ativo) setErro("Não foi possível conferir o CT-e na SEFAZ.");
      } finally {
        // A consulta pode ter mudado a situação do CT-e: a lista é lida de novo.
        if (ativo) aoMudar();
      }
    })();
    return () => {
      ativo = false;
    };
    // Só ao abrir: `aoMudar` troca a cada desenho da lista.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cte.id]);

  return (
    <div className={MOLDURA} role="dialog" aria-modal="true" aria-label="Conferir o CT-e na SEFAZ">
      <div className={JANELA}>
        <Cabecalho titulo={`CT-e nº ${cte.numero} na SEFAZ`} carga={carga} aoFechar={aoFechar} />
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {!resultado && !erro && <Carregando />}
          <Erro texto={erro} />
          {resultado && (
            <>
              <p data-situacao-na-sefaz={resultado.cte.situacao} role="status" className="px-3 py-2 text-sm text-gray-900 border border-gray-200 rounded-lg bg-gray-50 dark:bg-gray-950 dark:border-gray-700 dark:text-white">
                {resultado.mensagem}
              </p>
              <ListaDeEventos eventos={resultado.eventos} vazio="Nenhum evento vinculado a este CT-e." />
            </>
          )}
        </div>
        <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-800">
          <button type="button" onClick={aoFechar} className={`${BOTAO_CLARO} w-full`}>
            Fechar
          </button>
        </div>
      </div>
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

/** O painel aberto. `cte`: o CT-e de que ele trata, quando não é o da linha (`aResolver`). */
type Aberto = { tipo: "registro" | "conferencia" | "cancelamento" | "correcao" | "entrega" | "sefaz"; carga: CargaParaCte; cte?: CteEmitido };

/** Dá para perguntar à SEFAZ por este CT-e? Só pelo que foi enviado: autorizado, cancelado ou sem resposta. */
const conferivel = (cte: CteEmitido) => cte.situacao === "AUTHORIZED" || cte.situacao === "CANCELLED" || (cte.situacao === "DRAFT" && cte.semResposta);

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

  // O CT-e do painel aberto: o que a ação apontou ou o da linha.
  const alvo = aberto ? (aberto.cte ?? aberto.carga.emitido ?? null) : null;
  // A carta e o comprovante mudam o que a linha permite (o cancelamento, por exemplo): ao fechar, a lista é lida de novo.
  const fecharERecarregar = () => {
    setAberto(null);
    void recarregar();
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
            <table className="block md:table md:table-fixed w-full text-sm">
              {/* Largura fixa no computador: as colunas dividem o cartão e o texto longo corta com reticências, em vez de empurrar "Ações" para fora dele. */}
              <thead className="hidden md:table-header-group bg-gray-50 dark:bg-gray-950 text-gray-500 text-left">
                <tr>
                  <th className="px-4 py-3 font-medium md:w-[13%]">Carga</th>
                  <th className="px-4 py-3 font-medium md:w-[18%]">Remetente e destinatário</th>
                  <th className="px-4 py-3 font-medium md:w-[14%]">Rota</th>
                  <th className="px-4 py-3 font-medium md:w-[13%]">Mercadoria e frete</th>
                  <th className="px-4 py-3 font-medium md:w-[19%]">CT-e</th>
                  <th className="px-4 py-3 font-medium md:w-[23%]">Ações</th>
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
                            <span data-cte={emitido.situacao} className={`inline-block text-xs px-2.5 py-1 rounded-full whitespace-nowrap md:whitespace-normal ${COR_DO_SELO[emitido.situacao]}`}>
                              {seloDoCte(emitido)}
                            </span>
                            {emitido.situacao === "REJECTED" && (
                              <span className="block mt-1 text-[11px] text-red-700">
                                {emitido.cStat} - {emitido.motivo}
                              </span>
                            )}
                            {(carga.aResolver ?? []).map((outro) => (
                              <span key={outro.id} data-a-resolver={outro.id} className="block mt-1 text-[11px] leading-tight text-amber-800">
                                {outro.situacao === "AUTHORIZED" ? `O CT-e nº ${outro.numero} também foi autorizado: cancele-o. ` : `O envio anterior (nº ${outro.numero}) ficou sem resposta. `}
                                <button
                                  type="button"
                                  data-acao={outro.situacao === "AUTHORIZED" ? "cancelar-outro" : "conferir-outro"}
                                  onClick={() => setAberto({ tipo: outro.situacao === "AUTHORIZED" ? "cancelamento" : "sefaz", carga, cte: outro })}
                                  className="font-medium text-blue-600 hover:underline"
                                >
                                  {outro.situacao === "AUTHORIZED" ? `Cancelar o nº ${outro.numero}` : "Conferir na SEFAZ"}
                                </button>
                              </span>
                            ))}
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
                            <button type="button" data-acao="corrigir" onClick={() => setAberto({ tipo: "correcao", carga })} className="text-blue-600 hover:underline">
                              Corrigir
                            </button>
                          )}
                          {emitido?.situacao === "AUTHORIZED" && carga.comprovanteAceito && (
                            <button type="button" data-acao="entrega" onClick={() => setAberto({ tipo: "entrega", carga })} className="text-blue-600 hover:underline">
                              Entrega na SEFAZ
                            </button>
                          )}
                          {emitido && !registradoDeFora && conferivel(emitido) && (
                            <button type="button" data-acao="sefaz" onClick={() => setAberto({ tipo: "sefaz", carga })} className="text-blue-600 hover:underline">
                              Conferir na SEFAZ
                            </button>
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
      {aberto?.tipo === "cancelamento" && alvo && <Cancelamento key={alvo.id} carga={aberto.carga} cte={alvo} aoFechar={() => setAberto(null)} aoMudar={() => void recarregar()} />}
      {aberto?.tipo === "correcao" && alvo && <CartaDeCorrecao key={alvo.id} carga={aberto.carga} cte={alvo} aoFechar={fecharERecarregar} />}
      {aberto?.tipo === "entrega" && alvo && <EntregaNaSefaz key={alvo.id} carga={aberto.carga} cte={alvo} aoFechar={fecharERecarregar} />}
      {aberto?.tipo === "sefaz" && alvo && <ConferenciaNaSefazDoCte key={alvo.id} carga={aberto.carga} cte={alvo} aoFechar={() => setAberto(null)} aoMudar={() => void recarregar()} />}
    </div>
  );
}
