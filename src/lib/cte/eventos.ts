import { createHash } from "node:crypto";
import { TIPO_DO_EVENTO_DO_CTE, type Ambiente, type CorrecaoDaCarta, type TipoDoEventoDoCte } from "@/lib/cte";
import { dataHoraDoEvento } from "@/lib/cte/chave";
import { codigoDoAmbiente } from "@/lib/cte/enderecos";
import { NAMESPACE_DO_CTE, VERSAO_DO_CTE } from "@/lib/cte/montar";
import { grupo, tag, textoDoXml } from "@/lib/cte/texto";

/**
 * Os eventos do CT-e que o emitente envia além do cancelamento (que está em
 * src/lib/cte/montar.ts, onde já estava): carta de correção (110110),
 * comprovante de entrega (110180) e cancelamento do comprovante de entrega
 * (110181). Funções puras: recebem os dados já conferidos e devolvem o XML,
 * ainda sem assinatura.
 *
 * FONTES (lidas em 12/10/2026):
 * - MOC do CT-e 4.00, Visão Geral, itens 5.1.1 (parte geral do evento), 6.4
 *   (carta de correção), 6.8 (comprovante de entrega) e 6.9 (cancelamento do
 *   comprovante);
 * - esquemas `evCCeCTe_v4.00.xsd`, `evCECTe_v4.00.xsd` e
 *   `evCancCECTe_v4.00.xsd` do pacote PL_CTe_400_NT2026.004 RTC_1.00
 *   (fiscal/esquemas/cte-4.00), contra os quais os testes validam o que sai
 *   daqui.
 *
 * Só o servidor importa este arquivo.
 */

type BaseDoEvento = {
  chave: string;
  /** CNPJ do emitente (o autor do evento). */
  cnpj: string;
  ambiente: Ambiente;
  quando: Date;
  /** `nSeqEvento`: sequência do evento DESTE tipo para o CT-e. */
  sequencia: number;
};

export type EventoMontado = { xml: string; id: string; tipo: TipoDoEventoDoCte; sequencia: number };

/**
 * O envelope do evento (`eventoCTe`), ainda sem assinatura. O Id é "ID" + tipo
 * do evento + chave + sequência com 3 dígitos (`eventoCTeTiposBasico_v4.00.xsd`);
 * o órgão é a UF do emitente (os 2 primeiros dígitos da chave).
 */
function montarEvento(base: BaseDoEvento, tipo: TipoDoEventoDoCte, detalhe: string): EventoMontado {
  const id = `ID${tipo}${base.chave}${String(base.sequencia).padStart(3, "0")}`;
  const infEvento = grupo(
    "infEvento",
    [
      tag("cOrgao", base.chave.slice(0, 2)),
      tag("tpAmb", codigoDoAmbiente(base.ambiente)),
      tag("CNPJ", base.cnpj),
      tag("chCTe", base.chave),
      tag("dhEvento", dataHoraDoEvento(base.quando, base.chave)),
      tag("tpEvento", tipo),
      tag("nSeqEvento", String(base.sequencia)),
      grupo("detEvento", detalhe, ` versaoEvento="${VERSAO_DO_CTE}"`),
    ].join(""),
    ` Id="${id}"`,
  );
  return { xml: `<eventoCTe xmlns="${NAMESPACE_DO_CTE}" versao="${VERSAO_DO_CTE}">${infEvento}</eventoCTe>`, id, tipo, sequencia: base.sequencia };
}

/* ------------------------------ Carta de correção ----------------------------- */

/**
 * As condições de uso (`xCondUso`): a literal que o MOC 4.00 (item 6.4, campo
 * IP08) e o esquema `evCCeCTe_v4.00.xsd` exigem, na forma sem acentuação (o
 * esquema aceita esta ou a acentuada, e nenhuma outra). É a transcrição do
 * art. 58-B do Convênio SINIEF 06/89.
 */
export const CONDICAO_DE_USO_DA_CARTA =
  "A Carta de Correcao e disciplinada pelo Art. 58-B do CONVENIO/SINIEF 06/89: Fica permitida a utilizacao de carta de correcao, para regularizacao de erro ocorrido na emissao de documentos fiscais relativos a prestacao de servico de transporte, desde que o erro nao esteja relacionado com: I - as variaveis que determinam o valor do imposto tais como: base de calculo, aliquota, diferenca de preco, quantidade, valor da prestacao;II - a correcao de dados cadastrais que implique mudanca do emitente, tomador, remetente ou do destinatario;III - a data de emissao ou de saida.";

/**
 * A carta de correção (110110). Cada correção diz o grupo, o campo e o valor
 * novo (`infCorrecao`); `nroItemAlterado` só quando o campo está numa lista (o
 * índice começa em 1 e vai com dois dígitos). Quem chama já recusou os campos
 * que a carta não pode corrigir (`campoProibidoNaCarta`, em src/lib/cte.ts).
 */
export function montarCartaDeCorrecao(dados: BaseDoEvento & { correcoes: readonly CorrecaoDaCarta[] }): EventoMontado {
  const correcoes = dados.correcoes
    .map((correcao) =>
      grupo(
        "infCorrecao",
        tag("grupoAlterado", correcao.grupo) +
          tag("campoAlterado", correcao.campo) +
          tag("valorAlterado", textoDoXml(correcao.valor, 500)) +
          tag("nroItemAlterado", correcao.item ? String(correcao.item).padStart(2, "0") : ""),
      ),
    )
    .join("");
  return montarEvento(dados, TIPO_DO_EVENTO_DO_CTE.CARTA_DE_CORRECAO, grupo("evCCeCTe", tag("descEvento", "Carta de Correcao") + correcoes + tag("xCondUso", CONDICAO_DE_USO_DA_CARTA)));
}

/* ----------------------------- Comprovante de entrega -------------------------- */

/**
 * O `hashEntrega` (MOC 4.00, item 6.8, campo IP09, e o esquema): "Hash (SHA1)
 * no formato Base64 resultante da concatenação: Chave de acesso do CT-e +
 * Base64 da imagem capturada da entrega (exemplo: imagem capturada da
 * assinatura eletrônica, digital do recebedor, foto, etc)". São 20 bytes, que
 * em Base64 dão 28 caracteres.
 *
 * `imagemEmBase64` é o texto Base64 da imagem (o que vem depois da vírgula de
 * uma data URL), sem o prefixo. O MOC avisa que "a SEFAZ não tem nenhum
 * controle sobre a informação deste campo": ele serve para o emitente provar,
 * depois, de qual imagem o evento falava.
 */
export const hashDaEntrega = (chave: string, imagemEmBase64: string) => createHash("sha1").update(`${chave}${imagemEmBase64}`, "utf8").digest("base64");

/** Latitude e longitude como o esquema as quer (`TLatitude`, `TLongitude`): seis casas. Fora da faixa, ou só uma das duas, não vai nenhuma. */
function coordenadaDoXml(latitude: number | null | undefined, longitude: number | null | undefined): string {
  if (typeof latitude !== "number" || typeof longitude !== "number" || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return "";
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return "";
  return tag("latitude", latitude.toFixed(6)) + tag("longitude", longitude.toFixed(6));
}

export type DadosDoComprovanteDeEntrega = BaseDoEvento & {
  /** Protocolo de autorização do CT-e. */
  protocolo: string;
  /** Quando a entrega foi concluída. */
  entregueEm: Date;
  /** Documento e nome de quem recebeu. */
  documento: string;
  nome: string;
  latitude?: number | null;
  longitude?: number | null;
  /** O `hashEntrega` (`hashDaEntrega`) e quando ele foi gerado. */
  hash: string;
  hashEm: Date;
  /** As chaves das NF-e entregues (`infEntrega`): as que o CT-e transporta. Vazio: o CT-e não tem NF-e. */
  chavesDeNfe: readonly string[];
};

/**
 * O comprovante de entrega (110180). As datas vão no fuso da UF do emitente,
 * como as do CT-e. O grupo `infEntrega` leva cada NF-e uma vez só (regra O15,
 * rejeição 861) e é obrigatório quando o CT-e, de serviço normal, tem NF-e
 * (regra O09, rejeição 865).
 */
export function montarComprovanteDeEntrega(dados: DadosDoComprovanteDeEntrega): EventoMontado {
  const detalhe = grupo(
    "evCECTe",
    [
      tag("descEvento", "Comprovante de Entrega do CT-e"),
      tag("nProt", dados.protocolo),
      tag("dhEntrega", dataHoraDoEvento(dados.entregueEm, dados.chave)),
      tag("nDoc", textoDoXml(dados.documento, 20)),
      tag("xNome", textoDoXml(dados.nome, 60)),
      coordenadaDoXml(dados.latitude, dados.longitude),
      tag("hashEntrega", dados.hash),
      tag("dhHashEntrega", dataHoraDoEvento(dados.hashEm, dados.chave)),
      [...new Set(dados.chavesDeNfe)].map((chave) => grupo("infEntrega", tag("chNFe", chave))).join(""),
    ].join(""),
  );
  return montarEvento(dados, TIPO_DO_EVENTO_DO_CTE.COMPROVANTE_DE_ENTREGA, detalhe);
}

/** O cancelamento do comprovante de entrega (110181): o protocolo do CT-e e o do evento de entrega que se cancela (`nProtCE`). */
export function montarCancelamentoDoComprovante(dados: BaseDoEvento & { protocolo: string; protocoloDoComprovante: string }): EventoMontado {
  const detalhe = grupo("evCancCECTe", tag("descEvento", "Cancelamento do Comprovante de Entrega do CT-e") + tag("nProt", dados.protocolo) + tag("nProtCE", dados.protocoloDoComprovante));
  return montarEvento(dados, TIPO_DO_EVENTO_DO_CTE.CANCELAMENTO_DO_COMPROVANTE, detalhe);
}

/** O evento registrado com o retorno da SEFAZ (`procEventoCTe`): é o que fica guardado. */
export function montarProcEventoCte(eventoAssinado: string, retorno: string): string {
  return `<procEventoCTe xmlns="${NAMESPACE_DO_CTE}" versao="${VERSAO_DO_CTE}">${eventoAssinado}${retorno}</procEventoCTe>`;
}
