import { gzipSync } from "node:zlib";
import { XmlInvalido, campo, filho, lerXml, type No } from "@/lib/nfe";
import type { Ambiente } from "@/lib/cte";
import { CODIGO_DA_UF, type Svc } from "@/lib/cte/chave";
import { codigoDoAmbiente, enderecosDaSvc, enderecosDaUf, type Servico } from "@/lib/cte/enderecos";
import { NAMESPACE_DO_CTE, VERSAO_DO_CTE } from "@/lib/cte/montar";
import { SEFAZ_RESPOSTA_INVALIDA, SefazError, chamarSoap, type Credencial } from "@/lib/cte/soap";
import { escapar } from "@/lib/cte/texto";

/**
 * As quatro conversas com a SEFAZ que a emissão usa (MOC 4.00, Visão Geral,
 * item 4): status do serviço, consulta pela chave, recepção síncrona do CT-e e
 * registro de evento (cancelamento). Aqui estão a mensagem de cada uma, a
 * leitura da resposta e a decisão sobre o que a resposta significa.
 *
 * REGRA: "autorizado" só existe com `cStat` 100 E número de protocolo, para a
 * chave e o ambiente que foram enviados. Resposta que diga 100 sem protocolo,
 * para outra chave ou com resumo diferente do XML enviado não autoriza nada.
 *
 * Só o servidor importa este arquivo.
 */

/**
 * Códigos de resposta que a emissão trata de forma própria. Conferidos, em
 * 12/10/2026, contra o MOC do CT-e 4.00 (Visão Geral e Anexo I):
 *
 * | cStat | Onde no MOC | O que quer dizer |
 * | --- | --- | --- |
 * | 100 | Visão Geral, 4.2.6 e 4.5.6 | Autorizado o uso (a recepção e a consulta trazem o `protCTe`) |
 * | 101 | Visão Geral, 4.5.6 | Consulta: o CT-e está CANCELADO (o `protCTe` que vem junto é o da autorização) |
 * | 107, 108, 109 | Visão Geral, 4.6.5 e 4.6.6 (regras M02 e M03) e regras B03 e B04 | Serviço em operação, paralisado momentaneamente, paralisado sem previsão |
 * | 113, 114 | Visão Geral, 4.6.5 (regras M04 e M05) e regra C09 | Status pedido à SVC: 113 = a SVC está em operação para a UF (a SEFAZ de origem a acionou); 114 = SVC desabilitada pela SEFAZ de origem |
 * | 134, 135, 136 | Visão Geral, 5.1.7 | Evento guardado: 135 vinculado ao CT-e; 134 vinculado, com alerta de que o CT-e não está "autorizado"; 136 guardado SEM vínculo (o CT-e não existe lá) |
 * | 204 | Anexo I, regra G158 | Duplicidade: este mesmo CT-e (mesma chave) já está autorizado |
 * | 217 | Visão Geral, regra L04 | Consulta: o CT-e não consta |
 * | 218 | Anexo I, regra G159; Visão Geral, regra O05 | O CT-e desta chave já está cancelado |
 * | 539 | Anexo I, regra G157 | Duplicidade com diferença na chave: o número foi usado por outro documento |
 *
 * Os códigos 103, 104 e 105 (lote recebido, processado, em processamento) são
 * do serviço assíncrono, que o CT-e 4.00 não tem: este sistema só usa a
 * recepção síncrona, e eles não são tratados.
 */
export const CSTAT = {
  AUTORIZADO: 100,
  CANCELADO: 101,
  EM_OPERACAO: 107,
  PARALISADO: 108,
  PARALISADO_SEM_PREVISAO: 109,
  SVC_EM_OPERACAO: 113,
  SVC_DESABILITADA: 114,
  EVENTO_REGISTRADO_COM_ALERTA: 134,
  EVENTO_REGISTRADO: 135,
  EVENTO_REGISTRADO_SEM_VINCULO: 136,
  DUPLICIDADE: 204,
  NAO_CONSTA: 217,
  JA_CANCELADO: 218,
  DUPLICIDADE_COM_OUTRA_CHAVE: 539,
} as const;

/* --------------------------------- Para onde ---------------------------------- */

export type Destino = {
  /** A UF do emitente. */
  uf: string;
  ambiente: Ambiente;
  credencial: Credencial | null;
  tempoLimiteMs?: number;
  /**
   * A conversa é com a SVC que atende a UF, e não com a autorizadora dela
   * (MOC 4.00, Visão Geral, item 11.3.3). Ausente: a autorizadora normal.
   */
  svc?: Svc | null;
};

type SefazDeTeste = { url: string; autoridades: readonly string[]; tempoLimiteMs?: number };
let deTeste: SefazDeTeste | null = null;

/**
 * Só para os testes: manda todas as chamadas para um servidor HTTPS local que
 * imita a SEFAZ. Fora de teste a função não faz nada, de propósito: não pode
 * existir um jeito de desviar a emissão de produção para outro servidor.
 */
export function usarSefazDeTeste(servidor: SefazDeTeste | null): void {
  if (process.env.NODE_ENV === "test") deTeste = servidor;
}

const SERVICOS: Record<Servico, { nome: string; metodo: string }> = {
  status: { nome: "CTeStatusServicoV4", metodo: "cteStatusServicoCT" },
  consulta: { nome: "CTeConsultaV4", metodo: "cteConsultaCT" },
  recepcao: { nome: "CTeRecepcaoSincV4", metodo: "cteRecepcao" },
  evento: { nome: "CTeRecepcaoEventoV4", metodo: "cteRecepcaoEvento" },
};

/** Chama o serviço e devolve a resposta inteira (o texto) e o `Body` já lido. */
async function chamar(destino: Destino, servico: Servico, dados: string): Promise<{ resposta: string; corpo: No }> {
  const daUf = enderecosDaUf(destino.uf, destino.ambiente);
  if (!daUf) throw new SefazError("conexao", `Não há serviço de CT-e para a UF ${destino.uf}.`, false);
  const enderecos = destino.svc ? enderecosDaSvc(destino.svc, destino.ambiente) : daUf;
  const { nome, metodo } = SERVICOS[servico];
  const resposta = await chamarSoap({
    // No servidor de teste a SVC atende num caminho próprio, para o teste saber com quem a emissão falou.
    url: deTeste ? `${deTeste.url}/${destino.svc ? `${destino.svc}/` : ""}${nome}` : enderecos[servico],
    servico: nome,
    metodo,
    dados,
    credencial: destino.credencial,
    tempoLimiteMs: destino.tempoLimiteMs ?? deTeste?.tempoLimiteMs,
    ...(deTeste && { autoridades: deTeste.autoridades }),
  });
  return { resposta, corpo: corpoDaResposta(resposta) };
}

/* ------------------------------ Ler a resposta SOAP ---------------------------- */

/** O primeiro elemento com este nome, em qualquer profundidade. */
export function achar(no: No | undefined, nome: string): No | undefined {
  if (!no) return undefined;
  if (no.nome === nome) return no;
  for (const f of no.filhos) {
    const achado = achar(f, nome);
    if (achado) return achado;
  }
  return undefined;
}

/**
 * O `Body` do envelope, já lido. O envio só passou da rede: resposta que não é
 * XML, que não é um envelope ou que traz um erro de SOAP (`Fault`) vira
 * `SefazError`, marcada como incerta (a mensagem chegou lá).
 */
export function corpoDaResposta(resposta: string): No {
  let raiz: No;
  try {
    raiz = lerXml(resposta);
  } catch (erro) {
    if (erro instanceof XmlInvalido) throw new SefazError("resposta", SEFAZ_RESPOSTA_INVALIDA, true);
    throw erro;
  }
  const corpo = raiz.nome === "Envelope" ? filho(raiz, "Body") : undefined;
  if (!corpo) throw new SefazError("resposta", SEFAZ_RESPOSTA_INVALIDA, true);
  const falha = filho(corpo, "Fault");
  if (falha) {
    const motivo = campo(achar(falha, "Reason"), "Text", 300) ?? campo(falha, "faultstring", 300) ?? "sem descrição";
    throw new SefazError("resposta", `A SEFAZ recusou a mensagem: ${motivo}`, true);
  }
  return corpo;
}

const numero = (texto: string | null) => (texto !== null && /^\d{1,4}$/.test(texto) ? Number(texto) : null);

/** `cStat` e `xMotivo` de um elemento de resposta. Sem `cStat` numérico a resposta não serve. */
function situacao(no: No | undefined): { cStat: number; motivo: string } {
  const cStat = numero(campo(no, "cStat"));
  if (cStat === null) throw new SefazError("resposta", SEFAZ_RESPOSTA_INVALIDA, true);
  return { cStat, motivo: campo(no, "xMotivo", 300) ?? "" };
}

const ambienteDoCodigo = (codigo: string | null): Ambiente | null => (codigo === "1" ? "PRODUCAO" : codigo === "2" ? "HOMOLOGACAO" : null);

/* ----------------------------- Status do serviço ------------------------------ */

export function mensagemDeStatus(uf: string, ambiente: Ambiente): string {
  return `<consStatServCTe xmlns="${NAMESPACE_DO_CTE}" versao="${VERSAO_DO_CTE}"><tpAmb>${codigoDoAmbiente(ambiente)}</tpAmb><cUF>${CODIGO_DA_UF[uf]}</cUF><xServ>STATUS</xServ></consStatServCTe>`;
}

export type RespostaDeStatus = {
  cStat: number;
  motivo: string;
  emOperacao: boolean;
  /**
   * Só faz sentido no status pedido à SVC: ela está em operação PARA A UF
   * consultada (113), isto é, a SEFAZ de origem a acionou. Com 114 ("SVC
   * desabilitada pela SEFAZ de origem") ou qualquer outro código ela rejeita o
   * CT-e (regra C09). MOC 4.00, Visão Geral, item 4.6.1 (campo HP04: "em caso
   * de UF que autoriza em modo SVC o sistema irá responder com o status da
   * ativação da SVC") e item 4.6.5 (regras M04 e M05).
   */
  svcAtiva: boolean;
};

export function lerStatus(corpo: No): RespostaDeStatus {
  const lido = situacao(achar(corpo, "retConsStatServCTe"));
  return { ...lido, emOperacao: lido.cStat === CSTAT.EM_OPERACAO, svcAtiva: lido.cStat === CSTAT.SVC_EM_OPERACAO };
}

export async function statusDoServico(destino: Destino): Promise<RespostaDeStatus> {
  return lerStatus((await chamar(destino, "status", mensagemDeStatus(destino.uf, destino.ambiente))).corpo);
}

/* ---------------------------------- Protocolo --------------------------------- */

export type Protocolo = {
  cStat: number;
  motivo: string;
  ambiente: Ambiente | null;
  chave: string | null;
  /** Número do protocolo de autorização (15 dígitos). Só existe quando a SEFAZ autorizou. */
  numero: string | null;
  recebidoEm: Date | null;
  /** O resumo (DigestValue) do CT-e que a SEFAZ processou. */
  resumo: string | null;
  /** O `protCTe` como a SEFAZ devolveu, para o arquivo `cteProc`. */
  xml: string;
};

const PROTOCOLO_BRUTO = /<protCTe[\s>][\s\S]*?<\/protCTe>/;

function data(texto: string | null): Date | null {
  if (texto === null) return null;
  const lida = new Date(texto);
  return Number.isNaN(lida.getTime()) ? null : lida;
}

/** O `protCTe` da resposta. O XML guardado é o trecho original; se ele vier com prefixo de namespace, é remontado com os mesmos campos. */
function lerProtocolo(no: No | undefined, resposta: string): Protocolo | null {
  const inf = filho(no, "infProt");
  if (!no || !inf) return null;
  const lido = situacao(inf);
  const protocolo = campo(inf, "nProt");
  const chave = campo(inf, "chCTe");
  const resumo = campo(inf, "digVal");
  const bruto = resposta.match(PROTOCOLO_BRUTO)?.[0] ?? null;
  const remontado =
    `<protCTe versao="${VERSAO_DO_CTE}"><infProt>` +
    ["tpAmb", "verAplic", "chCTe", "dhRecbto", "nProt", "digVal", "cStat", "xMotivo"]
      .map((nome) => {
        const valor = campo(inf, nome, 300);
        return valor === null ? "" : `<${nome}>${escapar(valor)}</${nome}>`;
      })
      .join("") +
    "</infProt></protCTe>";
  return {
    ...lido,
    ambiente: ambienteDoCodigo(campo(inf, "tpAmb")),
    chave: chave !== null && /^[0-9]{6}[A-Z0-9]{12}[0-9]{26}$/.test(chave) ? chave : null,
    numero: protocolo !== null && /^\d{15}$/.test(protocolo) ? protocolo : null,
    recebidoEm: data(campo(inf, "dhRecbto")),
    resumo,
    xml: bruto ?? remontado,
  };
}

/* ------------------------------ Recepção do CT-e ------------------------------ */

/** O conteúdo do `cteDadosMsg` na recepção: o XML assinado, compactado em GZip e escrito em Base64 (MOC, item 3.4.1). */
export const compactar = (xml: string) => gzipSync(Buffer.from(xml, "utf8")).toString("base64");

export type RespostaDaRecepcao = { cStat: number; motivo: string; ambiente: Ambiente | null; protocolo: Protocolo | null };

export function lerRecepcao(corpo: No, resposta: string): RespostaDaRecepcao {
  const ret = achar(corpo, "retCTe");
  const lido = situacao(ret);
  return { ...lido, ambiente: ambienteDoCodigo(campo(ret, "tpAmb")), protocolo: lerProtocolo(filho(ret, "protCTe"), resposta) };
}

export type Esperado = { chave: string; ambiente: Ambiente; resumo: string | null };

export type Decisao =
  /** A SEFAZ autorizou: há protocolo, para esta chave, neste ambiente. */
  | { tipo: "autorizado"; protocolo: Protocolo & { numero: string } }
  /** Este mesmo CT-e (mesma chave) já está autorizado lá: falta buscar o protocolo pela consulta. */
  | { tipo: "ja-autorizado"; cStat: number; motivo: string }
  /** O número já foi usado por outro documento: este CT-e precisa de número novo. */
  | { tipo: "numero-usado"; cStat: number; motivo: string }
  /** O serviço está parado: nada foi processado. */
  | { tipo: "parado"; cStat: number; motivo: string }
  | { tipo: "rejeitado"; cStat: number; motivo: string }
  /**
   * O documento desta chave existe na SEFAZ, mas já foi cancelado (ou, no
   * MDF-e, encerrado) lá: não vale como autorização, e o número foi usado.
   */
  | { tipo: "finalizado"; situacao: SituacaoFinal; cStat: number; motivo: string }
  /** A resposta diz "autorizado" mas não fecha com o que foi enviado: não vale como autorização. */
  | { tipo: "incoerente"; motivo: string };

export type SituacaoFinal = "cancelado" | "encerrado";

/**
 * Os códigos que dizem que o documento da chave já não está "autorizado" na
 * SEFAZ. No CT-e: 101 (consulta, MOC 4.00, Visão Geral, item 4.5.6) e 218
 * (recepção, Anexo I, regra G159). O MDF-e acrescenta os do encerramento
 * (src/lib/mdfe/sefaz.ts).
 */
export const FINALIZADOS_DO_CTE: Readonly<Record<number, SituacaoFinal>> = { [CSTAT.CANCELADO]: "cancelado", [CSTAT.JA_CANCELADO]: "cancelado" };

/**
 * O que a resposta da recepção (ou da consulta) significa para o CT-e enviado.
 *
 * A SITUAÇÃO ATUAL É A DO TOPO DA RESPOSTA. Na consulta, o `protCTe` é sempre o
 * protocolo da AUTORIZAÇÃO (com `cStat` 100 dentro), mesmo quando o documento
 * já foi cancelado: quem diz isso é o `cStat` do `retConsSitCTe` (MOC 4.00,
 * Visão Geral, itens 4.5.2 e 4.5.6: "retornando o cStat com um dos valores, 100
 * ou 101, e o respectivo protocolo de autorização de uso"). Por isso o topo é
 * olhado antes do protocolo: documento cancelado não é gravado como autorizado.
 */
export function decidir(resposta: RespostaDaRecepcao, esperado: Esperado, finalizados: Readonly<Record<number, SituacaoFinal>> = FINALIZADOS_DO_CTE): Decisao {
  const protocolo = resposta.protocolo;
  const situacaoFinal = finalizados[resposta.cStat];
  if (situacaoFinal) return { tipo: "finalizado", situacao: situacaoFinal, cStat: resposta.cStat, motivo: resposta.motivo.trim() || "sem descrição" };
  const cStat = protocolo?.cStat ?? resposta.cStat;
  const motivo = (protocolo?.motivo || resposta.motivo || "").trim() || "sem descrição";

  if (cStat === CSTAT.AUTORIZADO) {
    if (!protocolo || protocolo.numero === null) return { tipo: "incoerente", motivo: "A SEFAZ respondeu \"autorizado\" sem número de protocolo." };
    if (protocolo.chave !== esperado.chave) return { tipo: "incoerente", motivo: "O protocolo devolvido é de outra chave de acesso." };
    if ((protocolo.ambiente ?? resposta.ambiente) !== esperado.ambiente) return { tipo: "incoerente", motivo: "O protocolo devolvido é de outro ambiente." };
    if (esperado.resumo !== null && protocolo.resumo !== null && protocolo.resumo !== esperado.resumo) {
      return { tipo: "incoerente", motivo: "O protocolo devolvido não corresponde ao XML que foi enviado." };
    }
    return { tipo: "autorizado", protocolo: { ...protocolo, numero: protocolo.numero } };
  }
  if (cStat === CSTAT.DUPLICIDADE) return { tipo: "ja-autorizado", cStat, motivo };
  if (cStat === CSTAT.DUPLICIDADE_COM_OUTRA_CHAVE) return { tipo: "numero-usado", cStat, motivo };
  if (cStat === CSTAT.PARALISADO || cStat === CSTAT.PARALISADO_SEM_PREVISAO) return { tipo: "parado", cStat, motivo };
  return { tipo: "rejeitado", cStat, motivo };
}

export async function enviarCte(destino: Destino, xmlAssinado: string): Promise<RespostaDaRecepcao> {
  const { resposta, corpo } = await chamar(destino, "recepcao", compactar(xmlAssinado));
  return lerRecepcao(corpo, resposta);
}

/* ----------------------------- Consulta pela chave ----------------------------- */

export function mensagemDeConsulta(chave: string, ambiente: Ambiente): string {
  return `<consSitCTe xmlns="${NAMESPACE_DO_CTE}" versao="${VERSAO_DO_CTE}"><tpAmb>${codigoDoAmbiente(ambiente)}</tpAmb><xServ>CONSULTAR</xServ><chCTe>${chave}</chCTe></consSitCTe>`;
}

/**
 * Um evento vinculado ao CT-e, como a consulta pela chave o devolve
 * (`procEventoCTe`: o evento e o retorno do registro; MOC 4.00, Visão Geral,
 * item 4.5.2, campo GR09, e item 4.5.3).
 */
export type EventoDaConsulta = {
  tipo: string;
  sequencia: number;
  /** Protocolo do registro do evento. */
  protocolo: string | null;
  cStat: number;
  motivo: string;
  registradoEm: Date | null;
  /** A descrição que a SEFAZ dá ao evento (`xEvento`) ou, na falta, a do próprio evento (`descEvento`). */
  descricao: string | null;
  /** No cancelamento do comprovante de entrega (110181): o protocolo do comprovante que ele cancelou (`nProtCE`). */
  protocoloCancelado: string | null;
  /** O `procEventoCTe` como a SEFAZ devolveu. */
  xml: string;
};

export type RespostaDaConsulta = RespostaDaRecepcao & { eventos: EventoDaConsulta[] };

const EVENTO_BRUTO = /<procEventoCTe[\s>][\s\S]*?<\/procEventoCTe>/g;
const QUINZE_DIGITOS = /^\d{15}$/;

/**
 * Os eventos da consulta que valem para a chave consultada: registrados e
 * VINCULADOS ao CT-e (135, ou 134, vinculado com alerta), com tipo e sequência
 * legíveis. O que vier de outra chave, sem vínculo (136) ou fora do formato é
 * ignorado: nada entra no sistema por uma resposta que não fecha.
 */
function lerEventosDaConsulta(ret: No | undefined, resposta: string, chave: string): EventoDaConsulta[] {
  const brutos = resposta.match(EVENTO_BRUTO) ?? [];
  const eventos: EventoDaConsulta[] = [];
  for (const [indice, proc] of (ret?.filhos.filter((f) => f.nome === "procEventoCTe") ?? []).entries()) {
    const enviado = filho(filho(proc, "eventoCTe"), "infEvento");
    const retorno = filho(filho(proc, "retEventoCTe"), "infEvento");
    const cStat = numero(campo(retorno, "cStat"));
    const tipo = campo(retorno, "tpEvento") ?? campo(enviado, "tpEvento");
    const sequencia = numero(campo(retorno, "nSeqEvento") ?? campo(enviado, "nSeqEvento"));
    const vinculado = cStat === CSTAT.EVENTO_REGISTRADO || cStat === CSTAT.EVENTO_REGISTRADO_COM_ALERTA;
    if (!vinculado || tipo === null || !/^\d{6}$/.test(tipo) || sequencia === null || sequencia < 1) continue;
    if ((campo(retorno, "chCTe") ?? campo(enviado, "chCTe")) !== chave) continue;
    const protocolo = campo(retorno, "nProt");
    const detalhe = filho(enviado, "detEvento")?.filhos[0];
    const cancelado = campo(detalhe, "nProtCE");
    eventos.push({
      tipo,
      sequencia,
      protocolo: protocolo !== null && QUINZE_DIGITOS.test(protocolo) ? protocolo : null,
      cStat,
      motivo: campo(retorno, "xMotivo", 300) ?? "",
      registradoEm: data(campo(retorno, "dhRegEvento")),
      descricao: campo(retorno, "xEvento", 60) ?? campo(detalhe, "descEvento", 60),
      protocoloCancelado: cancelado !== null && QUINZE_DIGITOS.test(cancelado) ? cancelado : null,
      // Os trechos originais vêm na mesma ordem dos elementos lidos.
      xml: brutos[indice] ?? "",
    });
  }
  return eventos;
}

/** A situação do CT-e na SEFAZ, com o protocolo quando ele está autorizado (a mesma forma da resposta da recepção) e os eventos vinculados. */
export function lerConsulta(corpo: No, resposta: string, chave: string | null = null): RespostaDaConsulta {
  const ret = achar(corpo, "retConsSitCTe");
  const lido = situacao(ret);
  return {
    ...lido,
    ambiente: ambienteDoCodigo(campo(ret, "tpAmb")),
    protocolo: lerProtocolo(filho(ret, "protCTe"), resposta),
    eventos: chave === null ? [] : lerEventosDaConsulta(ret, resposta, chave),
  };
}

/**
 * Consulta a situação do CT-e pela chave. O CT-e autorizado pela SVC é
 * consultado NA SVC (`destino.svc`): "os documentos autorizados na SVC poderão
 * ser consultados diretamente neste ambiente a qualquer tempo", e ela só
 * responde pelos que autorizou (MOC 4.00, Visão Geral, item 4.5.6).
 */
export async function consultarCte(destino: Destino, chave: string): Promise<RespostaDaConsulta> {
  const { resposta, corpo } = await chamar(destino, "consulta", mensagemDeConsulta(chave, destino.ambiente));
  return lerConsulta(corpo, resposta, chave);
}

/* ----------------------------------- Evento ----------------------------------- */

export type RespostaDoEvento = {
  cStat: number;
  motivo: string;
  chave: string | null;
  tipo: string | null;
  /** Protocolo do registro do evento (15 dígitos). */
  protocolo: string | null;
  registradoEm: Date | null;
  /** O `retEventoCTe` como a SEFAZ devolveu. */
  xml: string;
};

const RETORNO_DO_EVENTO = /<retEventoCTe[\s>][\s\S]*?<\/retEventoCTe>/;

export function lerEvento(corpo: No, resposta: string): RespostaDoEvento {
  const inf = filho(achar(corpo, "retEventoCTe"), "infEvento");
  const lido = situacao(inf);
  const protocolo = campo(inf, "nProt");
  return {
    ...lido,
    chave: campo(inf, "chCTe"),
    tipo: campo(inf, "tpEvento"),
    protocolo: protocolo !== null && /^\d{15}$/.test(protocolo) ? protocolo : null,
    registradoEm: data(campo(inf, "dhRegEvento")),
    xml: resposta.match(RETORNO_DO_EVENTO)?.[0] ?? "",
  };
}

/** O evento só vale como registrado com `cStat` 135, protocolo, e para a chave e o tipo enviados. */
export function eventoRegistrado(resposta: RespostaDoEvento, esperado: { chave: string; tipo: string }): boolean {
  return resposta.cStat === CSTAT.EVENTO_REGISTRADO && resposta.protocolo !== null && resposta.chave === esperado.chave && resposta.tipo === esperado.tipo;
}

/**
 * A SEFAZ GUARDOU o evento, com ressalva: 134 (vinculado ao documento, que não
 * está "autorizado") ou 136 (guardado sem vínculo: o documento não existe lá),
 * com protocolo, para a chave e o tipo enviados (MOC do CT-e 4.00 e do MDF-e
 * 3.00b, Visão Geral, item 5.1.7). Não é recusa, e também não prova que o
 * documento mudou de situação: quem chama confere pela consulta.
 */
export function eventoGuardadoComRessalva(resposta: RespostaDoEvento, esperado: { chave: string; tipo: string }): boolean {
  const comRessalva = resposta.cStat === CSTAT.EVENTO_REGISTRADO_COM_ALERTA || resposta.cStat === CSTAT.EVENTO_REGISTRADO_SEM_VINCULO;
  return comRessalva && resposta.protocolo !== null && resposta.chave === esperado.chave && resposta.tipo === esperado.tipo;
}

/** A frase para a pessoa quando o evento foi guardado com ressalva e nada confirmou que ele valeu para o documento. */
export const fraseDoEventoComRessalva = (oQue: string, resposta: Pick<RespostaDoEvento, "cStat" | "motivo" | "protocolo">) =>
  `A SEFAZ guardou ${oQue} com ressalva (${resposta.cStat} - ${resposta.motivo.trim() || "sem descrição"}; protocolo ${resposta.protocolo ?? "não informado"}), sem confirmar que valeu para o documento: ele continua como estava neste sistema. Confira a situação na SEFAZ antes de tentar de novo.`;

export async function enviarEvento(destino: Destino, xmlAssinado: string): Promise<RespostaDoEvento> {
  const { resposta, corpo } = await chamar(destino, "evento", xmlAssinado);
  return lerEvento(corpo, resposta);
}
