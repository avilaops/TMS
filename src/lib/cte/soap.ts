import { request } from "node:https";
import { rootCertificates } from "node:tls";
import { RAIZES_DA_ICP_BRASIL } from "@/lib/cte/raizes-icp-brasil";

/**
 * Cliente SOAP 1.2 dos web services do CT-e, com autenticação mútua (o
 * certificado e a chave do emitente identificam quem chama).
 *
 * Como o MOC 4.00 define (Visão Geral, itens 3.2.2 e 3.4.1):
 * - TLS 1.2 com autenticação mútua;
 * - SOAP 1.2, Document/Literal, com a mensagem no campo `cteDadosMsg`, sem
 *   cabeçalho SOAP (a versão e a UF vão dentro da mensagem);
 * - o espaço de nomes do campo é `http://www.portalfiscal.inf.br/cte/wsdl/<serviço>`.
 *
 * O NOME DO SERVIÇO NO ESPAÇO DE NOMES: o exemplo do MOC traz `.../wsdl/CTeRecepcaoSinc`,
 * sem o "V4", mas os serviços se chamam `CTeRecepcaoSincV4` etc. e as bibliotecas
 * abertas que emitem em produção (nfephp-org/sped-cte) usam o nome com "V4". É
 * o que está aqui. Não foi possível conferir no WSDL: a SEFAZ responde 403 a
 * quem pede o WSDL sem certificado.
 *
 * A conexão fica presa em TLS 1.2 de propósito: é o que o MOC manda, e os
 * servidores que pedem o certificado do cliente depois do aperto de mão (IIS)
 * não conseguem fazê-lo com o Node em TLS 1.3.
 *
 * Só o servidor importa este arquivo.
 */

export const TEMPO_LIMITE_MS = 30_000;
/** A resposta de um serviço do CT-e tem poucos kB; isto é só um teto contra resposta sem fim. */
const LIMITE_DA_RESPOSTA_BYTES = 2 * 1024 * 1024;

export type MotivoDaFalha = "tempo" | "conexao" | "http" | "resposta";

/**
 * A chamada não deu resposta utilizável. `incerto` diz que a mensagem pode ter
 * chegado à SEFAZ (foi enviada inteira e a resposta não veio): para o envio de
 * um CT-e, isso obriga a consultar pela chave antes de tentar de novo.
 */
export class SefazError extends Error {
  constructor(
    readonly motivo: MotivoDaFalha,
    message: string,
    readonly incerto: boolean,
  ) {
    super(message);
    this.name = "SefazError";
  }
}

export const SEFAZ_TEMPO_ESGOTADO = "A SEFAZ não respondeu no tempo limite.";
export const SEFAZ_FORA_DO_AR = "Não foi possível conectar ao serviço da SEFAZ.";
export const SEFAZ_RESPOSTA_INVALIDA = "A SEFAZ devolveu uma resposta que o sistema não reconhece.";

export type Credencial = {
  /** Chave privada do emitente, em PEM. */
  chavePem: string;
  /** Certificado do emitente (e a cadeia que veio no A1), em PEM. */
  certificadoPem: string;
};

export type ChamadaSoap = {
  url: string;
  /** Nome do serviço, como no MOC: `CTeStatusServicoV4`, `CTeRecepcaoSincV4`... */
  servico: string;
  /** Nome do método: `cteStatusServicoCT`, `cteRecepcao`... */
  metodo: string;
  /** Conteúdo do `cteDadosMsg`: o XML da mensagem, ou o texto em base64 no envio do CT-e. */
  dados: string;
  credencial: Credencial | null;
  tempoLimiteMs?: number;
  /** O projeto dono do serviço: muda o campo da mensagem (`cteDadosMsg` ou `mdfeDadosMsg`) e o espaço de nomes. Padrão: CT-e. */
  projeto?: Projeto;
  /** Autoridades aceitas para o servidor. Padrão: as do Node mais as raízes da ICP-Brasil. Os testes passam a do servidor local. */
  autoridades?: readonly string[];
};

/**
 * O MDF-e fala o mesmo protocolo (MOC do MDF-e 3.00b, Visão Geral, itens 3.2.2
 * e 3.4.1): só mudam o nome do campo e o espaço de nomes.
 */
export type Projeto = "cte" | "mdfe";

const espacoDeNomes = (projeto: Projeto) => `http://www.portalfiscal.inf.br/${projeto}/wsdl`;

/** O envelope SOAP 1.2 com a mensagem. */
export function envelope(servico: string, dados: string, projeto: Projeto = "cte"): string {
  const campo = `${projeto}DadosMsg`;
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">' +
    `<soap12:Body><${campo} xmlns="${espacoDeNomes(projeto)}/${servico}">${dados}</${campo}></soap12:Body>` +
    "</soap12:Envelope>"
  );
}

const AUTORIDADES_PADRAO = () => [...rootCertificates, ...RAIZES_DA_ICP_BRASIL];

/**
 * Faz a chamada e devolve o corpo da resposta HTTP (o envelope SOAP inteiro,
 * como texto). Status diferente de 200 e falha de rede viram `SefazError`.
 */
export function chamarSoap(chamada: ChamadaSoap): Promise<string> {
  const projeto = chamada.projeto ?? "cte";
  const corpo = Buffer.from(envelope(chamada.servico, chamada.dados, projeto), "utf8");
  const limite = chamada.tempoLimiteMs ?? TEMPO_LIMITE_MS;
  const endereco = new URL(chamada.url);
  if (endereco.protocol !== "https:") return Promise.reject(new SefazError("conexao", SEFAZ_FORA_DO_AR, false));

  return new Promise((resolve, reject) => {
    let enviado = false;
    let terminado = false;
    const terminar = (resultado: string | SefazError) => {
      if (terminado) return;
      terminado = true;
      clearTimeout(relogio);
      if (typeof resultado === "string") resolve(resultado);
      else reject(resultado);
    };

    const req = request(
      {
        protocol: "https:",
        hostname: endereco.hostname,
        port: endereco.port || 443,
        path: `${endereco.pathname}${endereco.search}`,
        method: "POST",
        headers: {
          "Content-Type": `application/soap+xml; charset=utf-8; action="${espacoDeNomes(projeto)}/${chamada.servico}/${chamada.metodo}"`,
          "Content-Length": corpo.byteLength,
        },
        ...(chamada.credencial && { key: chamada.credencial.chavePem, cert: chamada.credencial.certificadoPem }),
        ca: [...(chamada.autoridades ?? AUTORIDADES_PADRAO())],
        minVersion: "TLSv1.2",
        maxVersion: "TLSv1.2",
        // Uma conexão por chamada: a credencial é da empresa, e conexão reaproveitada levaria a de outra.
        agent: false,
      },
      (res) => {
        const partes: Buffer[] = [];
        let tamanho = 0;
        res.on("data", (parte: Buffer) => {
          tamanho += parte.byteLength;
          if (tamanho > LIMITE_DA_RESPOSTA_BYTES) {
            req.destroy();
            terminar(new SefazError("resposta", SEFAZ_RESPOSTA_INVALIDA, enviado));
            return;
          }
          partes.push(parte);
        });
        res.on("end", () => {
          const texto = Buffer.concat(partes).toString("utf8");
          // O erro de SOAP (Fault) chega com status 500 e é uma resposta: quem lê é `corpoDaResposta`.
          if (res.statusCode === 200 || (res.statusCode === 500 && texto.includes("Fault"))) terminar(texto);
          // Erro do servidor (5xx) sem resposta SOAP não diz se a mensagem foi processada: fica como incerto.
          else terminar(new SefazError("http", `A SEFAZ respondeu com o status ${res.statusCode ?? "desconhecido"}.`, (res.statusCode ?? 500) >= 500));
        });
        res.on("error", () => terminar(new SefazError("conexao", SEFAZ_FORA_DO_AR, enviado)));
      },
    );

    const relogio = setTimeout(() => {
      req.destroy();
      terminar(new SefazError("tempo", SEFAZ_TEMPO_ESGOTADO, enviado));
    }, limite);

    req.on("finish", () => {
      enviado = true;
    });
    req.on("error", () => terminar(new SefazError("conexao", SEFAZ_FORA_DO_AR, enviado)));
    req.end(corpo);
  });
}
