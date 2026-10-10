import { campo, filho, type No } from "@/lib/nfe";
import type { Ambiente } from "@/lib/cte";
import { CSTAT as CSTAT_DO_CTE, achar, compactar, corpoDaResposta, type Protocolo, type RespostaDaRecepcao, type RespostaDoEvento } from "@/lib/cte/sefaz";
import { SEFAZ_RESPOSTA_INVALIDA, SefazError, chamarSoap, type Credencial } from "@/lib/cte/soap";
import { escapar } from "@/lib/cte/texto";
import { FORMATO_DA_CHAVE } from "@/lib/mdfe/chave";
import { SERVICOS, enderecoDoServico, type ServicoDoMdfe } from "@/lib/mdfe/enderecos";
import { VERSAO_DO_MDFE, mensagemDeConsulta, mensagemDeNaoEncerrados, mensagemDeStatus } from "@/lib/mdfe/montar";

/**
 * As conversas com a SEFAZ que o MDF-e usa (MOC do MDF-e 3.00b, Visão Geral,
 * itens 4 e 5): status do serviço, consulta pela chave, consulta dos não
 * encerrados, recepção síncrona e registro de evento.
 *
 * O transporte é o do CT-e (src/lib/cte/soap.ts: SOAP 1.2, TLS 1.2 com
 * autenticação mútua, GZip + Base64 na recepção), com o campo `mdfeDadosMsg`.
 * A decisão sobre o que a resposta da recepção significa também é a do CT-e
 * (`decidir`, em src/lib/cte/sefaz.ts): os códigos 100, 204, 539, 108 e 109
 * querem dizer a mesma coisa nos dois documentos.
 *
 * REGRA: "autorizado" só existe com `cStat` 100 E número de protocolo, para a
 * chave e o ambiente que foram enviados.
 *
 * Só o servidor importa este arquivo.
 */

/** Códigos de resposta que o MDF-e trata de forma própria (MOC 3.00b), além dos que divide com o CT-e. */
export const CSTAT = {
  ...CSTAT_DO_CTE,
  /** Consulta de não encerrados: há MDF-e em aberto, e a resposta traz a relação. */
  NAO_ENCERRADOS_LOCALIZADOS: 111,
  /** Consulta de não encerrados: nenhum em aberto. */
  NENHUM_NAO_ENCERRADO: 112,
  ENCERRADO: 132,
  JA_ENCERRADO: 609,
  /** Rejeições da recepção por MDF-e em aberto (Anexo I, regras F85, F86, F87 e F88). */
  NAO_ENCERRADO_PARA_A_PLACA: 611,
  NAO_ENCERRADO_HA_30_DIAS: 686,
  NAO_ENCERRADO_HA_5_DIAS: 462,
  NAO_ENCERRADO_NO_SENTIDO_OPOSTO: 662,
} as const;

/** As rejeições que querem dizer "feche o MDF-e anterior primeiro". */
export const REJEICOES_POR_NAO_ENCERRADO: readonly number[] = [CSTAT.NAO_ENCERRADO_PARA_A_PLACA, CSTAT.NAO_ENCERRADO_HA_30_DIAS, CSTAT.NAO_ENCERRADO_HA_5_DIAS, CSTAT.NAO_ENCERRADO_NO_SENTIDO_OPOSTO];

/* --------------------------------- Para onde ---------------------------------- */

export type DestinoDoMdfe = {
  ambiente: Ambiente;
  credencial: Credencial | null;
  tempoLimiteMs?: number;
};

type SefazDeTeste = { url: string; autoridades: readonly string[]; tempoLimiteMs?: number };
let deTeste: SefazDeTeste | null = null;

/**
 * Só para os testes: manda todas as chamadas do MDF-e para um servidor HTTPS
 * local que imita a SEFAZ. Fora de teste a função não faz nada, de propósito.
 */
export function usarSefazDeTesteDoMdfe(servidor: SefazDeTeste | null): void {
  if (process.env.NODE_ENV === "test") deTeste = servidor;
}

async function chamar(destino: DestinoDoMdfe, servico: ServicoDoMdfe, dados: string): Promise<{ resposta: string; corpo: No }> {
  const { nome, metodo } = SERVICOS[servico];
  const resposta = await chamarSoap({
    projeto: "mdfe",
    url: deTeste ? `${deTeste.url}/${nome}` : enderecoDoServico(servico, destino.ambiente),
    servico: nome,
    metodo,
    dados,
    credencial: destino.credencial,
    tempoLimiteMs: destino.tempoLimiteMs ?? deTeste?.tempoLimiteMs,
    ...(deTeste && { autoridades: deTeste.autoridades }),
  });
  return { resposta, corpo: corpoDaResposta(resposta) };
}

/* ------------------------------ Ler as respostas ------------------------------- */

// O `cStat` do MDF-e tem 3 ou 4 dígitos desde a NT 2025.001 (item 5).
const numero = (texto: string | null) => (texto !== null && /^\d{1,4}$/.test(texto) ? Number(texto) : null);

function situacao(no: No | undefined): { cStat: number; motivo: string } {
  const cStat = numero(campo(no, "cStat"));
  if (cStat === null) throw new SefazError("resposta", SEFAZ_RESPOSTA_INVALIDA, true);
  return { cStat, motivo: campo(no, "xMotivo", 300) ?? "" };
}

const ambienteDoCodigo = (codigo: string | null): Ambiente | null => (codigo === "1" ? "PRODUCAO" : codigo === "2" ? "HOMOLOGACAO" : null);

function data(texto: string | null): Date | null {
  if (texto === null) return null;
  const lida = new Date(texto);
  return Number.isNaN(lida.getTime()) ? null : lida;
}

const PROTOCOLO_BRUTO = /<protMDFe[\s>][\s\S]*?<\/protMDFe>/;

/** O `protMDFe` da resposta, na mesma forma do protocolo do CT-e. O XML guardado é o trecho original; com prefixo de namespace, é remontado. */
function lerProtocolo(no: No | undefined, resposta: string): Protocolo | null {
  const inf = filho(no, "infProt");
  if (!no || !inf) return null;
  const lido = situacao(inf);
  const protocolo = campo(inf, "nProt");
  const chave = campo(inf, "chMDFe");
  const remontado =
    `<protMDFe versao="${VERSAO_DO_MDFE}"><infProt>` +
    ["tpAmb", "verAplic", "chMDFe", "dhRecbto", "nProt", "digVal", "cStat", "xMotivo"]
      .map((nome) => {
        const valor = campo(inf, nome, 300);
        return valor === null ? "" : `<${nome}>${escapar(valor)}</${nome}>`;
      })
      .join("") +
    "</infProt></protMDFe>";
  return {
    ...lido,
    ambiente: ambienteDoCodigo(campo(inf, "tpAmb")),
    chave: chave !== null && FORMATO_DA_CHAVE.test(chave) ? chave : null,
    numero: protocolo !== null && /^\d{15}$/.test(protocolo) ? protocolo : null,
    recebidoEm: data(campo(inf, "dhRecbto")),
    resumo: campo(inf, "digVal"),
    xml: resposta.match(PROTOCOLO_BRUTO)?.[0] ?? remontado,
  };
}

/* ----------------------------- Status do serviço ------------------------------ */

export type RespostaDeStatus = { cStat: number; motivo: string; emOperacao: boolean };

export function lerStatus(corpo: No): RespostaDeStatus {
  const lido = situacao(achar(corpo, "retConsStatServMDFe"));
  return { ...lido, emOperacao: lido.cStat === CSTAT.EM_OPERACAO };
}

export async function statusDoServico(destino: DestinoDoMdfe): Promise<RespostaDeStatus> {
  return lerStatus((await chamar(destino, "status", mensagemDeStatus(destino.ambiente))).corpo);
}

/* ------------------------------ Recepção e consulta ---------------------------- */

export function lerRecepcao(corpo: No, resposta: string): RespostaDaRecepcao {
  const ret = achar(corpo, "retMDFe");
  const lido = situacao(ret);
  return { ...lido, ambiente: ambienteDoCodigo(campo(ret, "tpAmb")), protocolo: lerProtocolo(filho(ret, "protMDFe"), resposta) };
}

/** Envia o MDF-e assinado (GZip + Base64, MOC item 3.4.1) e devolve a resposta lida. */
export async function enviarMdfe(destino: DestinoDoMdfe, xmlAssinado: string): Promise<RespostaDaRecepcao> {
  const { resposta, corpo } = await chamar(destino, "recepcao", compactar(xmlAssinado));
  return lerRecepcao(corpo, resposta);
}

/** A situação do MDF-e na SEFAZ: 100 autorizado, 101 cancelado, 132 encerrado, 217 não consta. */
export function lerConsulta(corpo: No, resposta: string): RespostaDaRecepcao {
  const ret = achar(corpo, "retConsSitMDFe");
  const lido = situacao(ret);
  return { ...lido, ambiente: ambienteDoCodigo(campo(ret, "tpAmb")), protocolo: lerProtocolo(filho(ret, "protMDFe"), resposta) };
}

export async function consultarMdfe(destino: DestinoDoMdfe, chave: string): Promise<RespostaDaRecepcao> {
  const { resposta, corpo } = await chamar(destino, "consulta", mensagemDeConsulta(chave, destino.ambiente));
  return lerConsulta(corpo, resposta);
}

/* ------------------------------- Não encerrados -------------------------------- */

export type NaoEncerrado = { chave: string; protocolo: string };

export type RespostaDeNaoEncerrados = { cStat: number; motivo: string; mdfes: NaoEncerrado[] };

/** A resposta só serve com 111 (há, e vem a relação) ou 112 (não há): qualquer outra é a SEFAZ recusando a consulta. */
export function lerNaoEncerrados(corpo: No): RespostaDeNaoEncerrados {
  const ret = achar(corpo, "retConsMDFeNaoEnc");
  const lido = situacao(ret);
  const mdfes = (ret?.filhos ?? [])
    .filter((no) => no.nome === "infMDFe")
    .flatMap((no) => {
      const chave = campo(no, "chMDFe");
      const protocolo = campo(no, "nProt");
      return chave !== null && FORMATO_DA_CHAVE.test(chave) && protocolo !== null && /^\d{15}$/.test(protocolo) ? [{ chave, protocolo }] : [];
    });
  return { ...lido, mdfes };
}

/** Os MDF-e do emitente que a SEFAZ tem como autorizados e não encerrados. */
export async function consultarNaoEncerrados(destino: DestinoDoMdfe, cnpj: string): Promise<RespostaDeNaoEncerrados> {
  return lerNaoEncerrados((await chamar(destino, "naoEncerrados", mensagemDeNaoEncerrados(cnpj, destino.ambiente))).corpo);
}

/* ----------------------------------- Evento ----------------------------------- */

const RETORNO_DO_EVENTO = /<retEventoMDFe[\s>][\s\S]*?<\/retEventoMDFe>/;

export function lerEvento(corpo: No, resposta: string): RespostaDoEvento {
  const inf = filho(achar(corpo, "retEventoMDFe"), "infEvento");
  const lido = situacao(inf);
  const protocolo = campo(inf, "nProt");
  return {
    ...lido,
    chave: campo(inf, "chMDFe"),
    tipo: campo(inf, "tpEvento"),
    protocolo: protocolo !== null && /^\d{15}$/.test(protocolo) ? protocolo : null,
    registradoEm: data(campo(inf, "dhRegEvento")),
    xml: resposta.match(RETORNO_DO_EVENTO)?.[0] ?? "",
  };
}

export async function enviarEvento(destino: DestinoDoMdfe, xmlAssinado: string): Promise<RespostaDoEvento> {
  const { resposta, corpo } = await chamar(destino, "evento", xmlAssinado);
  return lerEvento(corpo, resposta);
}
