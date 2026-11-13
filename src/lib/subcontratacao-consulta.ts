import type { Ambiente } from "@/lib/cte";
import type { RespostaDaRecepcao } from "@/lib/cte/sefaz";
import type { TipoDeDocumento } from "@/lib/subcontratacao";

export class ConsultaSubcontratadaInvalida extends Error {}

/** Só respostas conclusivas, vinculadas à chave/ambiente, substituem evidência. */
export function conferirConsultaDaSubcontratada(
  resposta: RespostaDaRecepcao,
  esperado: { kind: TipoDeDocumento; accessKey: string; environment: Ambiente },
) {
  const { protocolo, cStat } = resposta;
  const permitidos = esperado.kind === "MDFE" ? [100, 101, 132, 217] : [100, 101, 217];
  // O chamador recebe esta resposta da consulta autenticada à chave esperada.
  // TRetConsSitCTe/MDFe não ecoam a chave fora do protocolo (XSDs oficiais).
  const coerente = resposta.ambiente === esperado.environment;
  const protocoloCoerente = protocolo !== null && protocolo.chave === esperado.accessKey && protocolo.ambiente === esperado.environment && protocolo.cStat === 100 && /^\d{15}$/.test(protocolo.numero ?? "");
  const protocoloValido = cStat === 217 ? protocolo === null : cStat === 100 ? protocoloCoerente : protocolo === null || protocoloCoerente;
  if (!coerente || !permitidos.includes(cStat) || !protocoloValido) {
    throw new ConsultaSubcontratadaInvalida(`A consulta não confirmou uma situação coerente para esta chave e ambiente (${cStat}). O registro anterior foi preservado.`);
  }
  return { sefazCode: cStat, sefazReason: resposta.motivo.trim().slice(0, 300) || "Sem descrição", sefazProtocol: protocolo?.numero ?? null };
}
