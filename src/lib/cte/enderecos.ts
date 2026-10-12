/**
 * Endereços dos web services do CT-e 4.00, por autorizador e ambiente.
 *
 * FONTE: Portal do CT-e, página "Relação de Serviços Web", lida em 10/10/2026
 * e conferida de novo em 12/10/2026 (as 48 URL de cada ambiente, sem diferença):
 * - produção:    https://www.cte.fazenda.gov.br/portal/webServices.aspx
 * - homologação: https://hom.cte.fazenda.gov.br/portal/webServices.aspx
 *
 * Os endereços estão como a página os publica, sem o `?wsdl` que MT e PR trazem
 * no fim (a chamada SOAP vai para o endereço do serviço, não para o do WSDL).
 * O endereço do QR Code também é o da página, que é para onde o MOC (item 9.2)
 * manda olhar.
 *
 * Quem autoriza cada UF (mesma página): MT, MS, MG, PR, RS e SP têm autorizador
 * próprio; AP, PE e RR usam a SVSP; os outros estados usam a SVRS.
 *
 * NADA DISTO FOI EXERCITADO COM CERTIFICADO: sem um A1 a SEFAZ responde 403
 * antes de olhar a mensagem. Ver o README, seção "CT-e".
 */

import type { Svc } from "@/lib/cte/chave";

export type Ambiente = "HOMOLOGACAO" | "PRODUCAO";

export type Servico = "status" | "consulta" | "evento" | "recepcao";

export type Autorizador = "MT" | "MS" | "MG" | "PR" | "RS" | "SP" | "SVRS" | "SVSP";

type Enderecos = Record<Servico, string> & { qrCode: string };

const svrs = (base: string): Enderecos => ({
  status: `${base}/ws/CTeStatusServicoV4/CTeStatusServicoV4.asmx`,
  consulta: `${base}/ws/CTeConsultaV4/CTeConsultaV4.asmx`,
  evento: `${base}/ws/CTeRecepcaoEventoV4/CTeRecepcaoEventoV4.asmx`,
  recepcao: `${base}/ws/CTeRecepcaoSincV4/CTeRecepcaoSincV4.asmx`,
  qrCode: "https://dfe-portal.svrs.rs.gov.br/cte/qrCode",
});

const sp = (base: string): Enderecos => ({
  status: `${base}/CTeWS/WS/CTeStatusServicoV4.asmx`,
  consulta: `${base}/CTeWS/WS/CTeConsultaV4.asmx`,
  evento: `${base}/CTeWS/WS/CTeRecepcaoEventoV4.asmx`,
  recepcao: `${base}/CTeWS/WS/CTeRecepcaoSincV4.asmx`,
  qrCode: `${base}/CTeConsulta/qrCode`,
});

// Serviços com o mesmo nome no fim do endereço: MT, MS, MG e PR.
const porNome = (base: string, qrCode: string): Enderecos => ({
  status: `${base}/CTeStatusServicoV4`,
  consulta: `${base}/CTeConsultaV4`,
  evento: `${base}/CTeRecepcaoEventoV4`,
  recepcao: `${base}/CTeRecepcaoSincV4`,
  qrCode,
});

const SVRS_HOMOLOGACAO = svrs("https://cte-homologacao.svrs.rs.gov.br");
const SVRS_PRODUCAO = svrs("https://cte.svrs.rs.gov.br");
const SP_HOMOLOGACAO = sp("https://homologacao.nfe.fazenda.sp.gov.br");
const SP_PRODUCAO = sp("https://nfe.fazenda.sp.gov.br");

export const ENDERECOS: Record<Autorizador, Record<Ambiente, Enderecos>> = {
  MT: {
    HOMOLOGACAO: porNome("https://homologacao.sefaz.mt.gov.br/ctews2/services", "https://homologacao.sefaz.mt.gov.br/cte/qrcode"),
    PRODUCAO: porNome("https://cte.sefaz.mt.gov.br/ctews2/services", "https://www.sefaz.mt.gov.br/cte/qrcode"),
  },
  MS: {
    HOMOLOGACAO: porNome("https://homologacao.cte.ms.gov.br/ws", "http://www.dfe.ms.gov.br/cte/qrcode"),
    PRODUCAO: porNome("https://producao.cte.ms.gov.br/ws", "http://www.dfe.ms.gov.br/cte/qrcode"),
  },
  MG: {
    HOMOLOGACAO: porNome("https://hcte.fazenda.mg.gov.br/cte/services", "https://portalcte.fazenda.mg.gov.br/portalcte/sistema/qrcode.xhtml"),
    PRODUCAO: porNome("https://cte.fazenda.mg.gov.br/cte/services", "https://portalcte.fazenda.mg.gov.br/portalcte/sistema/qrcode.xhtml"),
  },
  PR: {
    HOMOLOGACAO: porNome("https://homologacao.cte.fazenda.pr.gov.br/cte4", "http://www.fazenda.pr.gov.br/cte/qrcode"),
    PRODUCAO: porNome("https://cte.fazenda.pr.gov.br/cte4", "http://www.fazenda.pr.gov.br/cte/qrcode"),
  },
  // O RS autoriza nos mesmos endereços da SVRS.
  RS: { HOMOLOGACAO: SVRS_HOMOLOGACAO, PRODUCAO: SVRS_PRODUCAO },
  SVRS: { HOMOLOGACAO: SVRS_HOMOLOGACAO, PRODUCAO: SVRS_PRODUCAO },
  // A SVSP autoriza nos mesmos endereços de SP.
  SP: { HOMOLOGACAO: SP_HOMOLOGACAO, PRODUCAO: SP_PRODUCAO },
  SVSP: { HOMOLOGACAO: SP_HOMOLOGACAO, PRODUCAO: SP_PRODUCAO },
};

const COM_AUTORIZADOR_PROPRIO: readonly string[] = ["MT", "MS", "MG", "PR", "RS", "SP"];
const NA_SVSP: readonly string[] = ["AP", "PE", "RR"];
const NA_SVRS: readonly string[] = ["AC", "AL", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "PA", "PB", "PI", "RJ", "RN", "RO", "SC", "SE", "TO"];

/** O autorizador da UF do emitente, ou `null` para uma sigla que não é UF. */
export function autorizadorDaUf(uf: string): Autorizador | null {
  if (COM_AUTORIZADOR_PROPRIO.includes(uf)) return uf as Autorizador;
  if (NA_SVSP.includes(uf)) return "SVSP";
  if (NA_SVRS.includes(uf)) return "SVRS";
  return null;
}

/** Os endereços da UF no ambiente, ou `null` para UF desconhecida. */
export function enderecosDaUf(uf: string, ambiente: Ambiente): (Enderecos & { autorizador: Autorizador }) | null {
  const autorizador = autorizadorDaUf(uf);
  return autorizador ? { ...ENDERECOS[autorizador][ambiente], autorizador } : null;
}

/**
 * A SVC (Sistema Virtual de Contingência) que atende cada autorizador.
 *
 * FONTE: a mesma página do Portal do CT-e, bloco "Autorizadores de
 * contingência", lida em 12/10/2026 (produção e homologação, mesmo texto):
 * - "Estados que devem utilizar a SVC-SP: aqueles que autorizam na SVRS, MG, PR, RS";
 * - "Estados que devem utilizar a SVC-RS: aqueles que autorizam na SVSP, MT, MS, SP".
 * A página publica os endereços num bloco só para cada dupla: "Sefaz Virtual
 * Rio Grande do Sul (SVRS) e Sefaz Virtual de Contingência do RS (SVC-RS)" e
 * "Sefaz Virtual São Paulo (SVSP) e Sefaz Virtual de Contingência de SP
 * (SVC-SP)". Ou seja: a SVC-RS atende nos endereços da SVRS, e a SVC-SP, nos da
 * SVSP.
 */
const SVC_DO_AUTORIZADOR: Record<Autorizador, Svc> = { SVRS: "SVC-SP", MG: "SVC-SP", PR: "SVC-SP", RS: "SVC-SP", SVSP: "SVC-RS", MT: "SVC-RS", MS: "SVC-RS", SP: "SVC-RS" };
const AUTORIZADOR_DA_SVC: Record<Svc, Autorizador> = { "SVC-RS": "SVRS", "SVC-SP": "SVSP" };

/** A SVC que atende a UF do emitente, ou `null` para uma sigla que não é UF. */
export function svcDaUf(uf: string): Svc | null {
  const autorizador = autorizadorDaUf(uf);
  return autorizador ? SVC_DO_AUTORIZADOR[autorizador] : null;
}

/** Os endereços dos serviços da SVC no ambiente (os do QR Code não são usados: o do CT-e continua o da UF do emitente). */
export const enderecosDaSvc = (svc: Svc, ambiente: Ambiente): Record<Servico, string> => ENDERECOS[AUTORIZADOR_DA_SVC[svc]][ambiente];

/** `tpAmb` do XML: 1 = produção, 2 = homologação. */
export const codigoDoAmbiente = (ambiente: Ambiente) => (ambiente === "PRODUCAO" ? "1" : "2");

/**
 * A URL do QR Code que vai em `infCTeSupl/qrCodCTe` (MOC 4.00, itens 9.2.1 e
 * 9.4, emissão normal): endereço da consulta + `?chCTe=<chave>&tpAmb=<ambiente>`.
 */
export const urlDoQrCode = (endereco: string, chave: string, ambiente: Ambiente) => `${endereco}?chCTe=${chave}&tpAmb=${codigoDoAmbiente(ambiente)}`;
