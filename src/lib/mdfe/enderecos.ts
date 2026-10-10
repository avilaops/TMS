import type { Ambiente } from "@/lib/cte";

/**
 * Endereços dos web services do MDF-e 3.00, por ambiente.
 *
 * O MDF-e tem um autorizador só, nacional: a SEFAZ Virtual do Rio Grande do Sul
 * (SVRS), para o emitente de qualquer UF (MOC do MDF-e 3.00b, Visão Geral, item
 * 3.2.2).
 *
 * FONTE: Portal do MDF-e, "Serviços" → "Relação de Serviços Web"
 * (https://dfe-portal.svrs.rs.gov.br/Mdfe/Servicos), lida em 10/10/2026. O
 * endereço do QR Code é o mesmo nos dois ambientes (a página e o MOC, item
 * 9.2.1, dizem isso: quem separa é o `tpAmb` da própria URL).
 *
 * Os serviços assíncronos (`MDFeRecepcao` e `MDFeRetRecepcao`) foram desligados
 * em 30/06/2024 (NT 2024.001): só existe a recepção síncrona.
 *
 * Os servidores apresentam certificado da ICP-Brasil (cadeia até a "Autoridade
 * Certificadora Raiz Brasileira v10", conferida em 10/10/2026), a mesma raiz que
 * o CT-e já carrega em src/lib/cte/raizes-icp-brasil.ts.
 *
 * NADA DISTO FOI EXERCITADO COM CERTIFICADO: sem um A1 a SEFAZ recusa a conexão
 * antes de olhar a mensagem. Ver o README, seção "MDF-e".
 */

export type ServicoDoMdfe = "status" | "consulta" | "naoEncerrados" | "evento" | "recepcao";

/** Nome e método de cada serviço, como no MOC (Visão Geral, itens 4.2 a 4.5 e 5.1). */
export const SERVICOS: Record<ServicoDoMdfe, { nome: string; metodo: string }> = {
  recepcao: { nome: "MDFeRecepcaoSinc", metodo: "mdfeRecepcao" },
  consulta: { nome: "MDFeConsulta", metodo: "mdfeConsultaMDF" },
  naoEncerrados: { nome: "MDFeConsNaoEnc", metodo: "mdfeConsNaoEnc" },
  status: { nome: "MDFeStatusServico", metodo: "mdfeStatusServicoMDF" },
  evento: { nome: "MDFeRecepcaoEvento", metodo: "mdfeRecepcaoEvento" },
};

const BASE: Record<Ambiente, string> = {
  HOMOLOGACAO: "https://mdfe-homologacao.svrs.rs.gov.br",
  PRODUCAO: "https://mdfe.svrs.rs.gov.br",
};

export const AUTORIZADOR_DO_MDFE = "SVRS";

/** Endereço da consulta por QR Code, igual nos dois ambientes. */
export const ENDERECO_DO_QR_CODE = "https://dfe-portal.svrs.rs.gov.br/mdfe/qrCode";

/** O endereço do serviço no ambiente. */
export const enderecoDoServico = (servico: ServicoDoMdfe, ambiente: Ambiente) => `${BASE[ambiente]}/ws/${SERVICOS[servico].nome}/${SERVICOS[servico].nome}.asmx`;
