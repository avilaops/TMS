import { gzipSync } from "node:zlib";
import { XmlInvalido, campo, filho, lerXml, type No } from "@/lib/nfe";
import type { Ambiente } from "@/lib/cte";
import { CODIGO_DA_UF } from "@/lib/cte/chave";
import { codigoDoAmbiente, enderecosDaUf, type Servico } from "@/lib/cte/enderecos";
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

/** Códigos de resposta que a emissão trata de forma própria (MOC 4.00). */
export const CSTAT = {
  AUTORIZADO: 100,
  CANCELADO: 101,
  EM_OPERACAO: 107,
  PARALISADO: 108,
  PARALISADO_SEM_PREVISAO: 109,
  EVENTO_REGISTRADO: 135,
  DUPLICIDADE: 204,
  NAO_CONSTA: 217,
  JA_CANCELADO: 218,
  DUPLICIDADE_COM_OUTRA_CHAVE: 539,
} as const;

/* --------------------------------- Para onde ---------------------------------- */

export type Destino = {
  uf: string;
  ambiente: Ambiente;
  credencial: Credencial | null;
  tempoLimiteMs?: number;
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
  const enderecos = enderecosDaUf(destino.uf, destino.ambiente);
  if (!enderecos) throw new SefazError("conexao", `Não há serviço de CT-e para a UF ${destino.uf}.`, false);
  const { nome, metodo } = SERVICOS[servico];
  const resposta = await chamarSoap({
    url: deTeste ? `${deTeste.url}/${nome}` : enderecos[servico],
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

export type RespostaDeStatus = { cStat: number; motivo: string; emOperacao: boolean };

export function lerStatus(corpo: No): RespostaDeStatus {
  const lido = situacao(achar(corpo, "retConsStatServCTe"));
  return { ...lido, emOperacao: lido.cStat === CSTAT.EM_OPERACAO };
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
  /** A resposta diz "autorizado" mas não fecha com o que foi enviado: não vale como autorização. */
  | { tipo: "incoerente"; motivo: string };

/** O que a resposta da recepção (ou da consulta) significa para o CT-e enviado. */
export function decidir(resposta: RespostaDaRecepcao, esperado: Esperado): Decisao {
  const protocolo = resposta.protocolo;
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

/** A situação do CT-e na SEFAZ, com o protocolo quando ele está autorizado: tem a mesma forma da resposta da recepção. */
export function lerConsulta(corpo: No, resposta: string): RespostaDaRecepcao {
  const ret = achar(corpo, "retConsSitCTe");
  const lido = situacao(ret);
  return { ...lido, ambiente: ambienteDoCodigo(campo(ret, "tpAmb")), protocolo: lerProtocolo(filho(ret, "protCTe"), resposta) };
}

export async function consultarCte(destino: Destino, chave: string): Promise<RespostaDaRecepcao> {
  const { resposta, corpo } = await chamar(destino, "consulta", mensagemDeConsulta(chave, destino.ambiente));
  return lerConsulta(corpo, resposta);
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

export async function enviarEvento(destino: Destino, xmlAssinado: string): Promise<RespostaDoEvento> {
  const { resposta, corpo } = await chamar(destino, "evento", xmlAssinado);
  return lerEvento(corpo, resposta);
}
