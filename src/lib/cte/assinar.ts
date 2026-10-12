import { createSign, createVerify } from "node:crypto";
import { SignedXml } from "xml-crypto";

/**
 * Assinatura digital do CT-e e do evento (XML Digital Signature, "enveloped").
 *
 * Os algoritmos são os que o MOC 4.00 exige (Visão Geral, item 3.2.4, e o
 * esquema xmldsig-core-schema_v1.01.xsd do pacote, que não aceita outros):
 * - canonicalização: C14N 1.0 (http://www.w3.org/TR/2001/REC-xml-c14n-20010315);
 * - assinatura: RSA-SHA1 (http://www.w3.org/2000/09/xmldsig#rsa-sha1);
 * - resumo: SHA-1 (http://www.w3.org/2000/09/xmldsig#sha1);
 * - transformações, nesta ordem: Enveloped e C14N.
 * O `KeyInfo` leva só o `X509Certificate` do emitente.
 *
 * SHA-1 não é escolha deste sistema: é o que a SEFAZ valida no CT-e 4.00.
 *
 * Só o servidor importa este arquivo.
 */

const C14N = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";
const ENVELOPED = "http://www.w3.org/2000/09/xmldsig#enveloped-signature";
const RSA_SHA1 = "http://www.w3.org/2000/09/xmldsig#rsa-sha1";
const SHA1 = "http://www.w3.org/2000/09/xmldsig#sha1";

export class AssinaturaError extends Error {}

/** O elemento assinado e o elemento pai, onde a assinatura entra como último filho. */
export type AlvoDaAssinatura =
  | { assinado: "infCte"; pai: "CTe" }
  | { assinado: "infEvento"; pai: "eventoCTe" }
  // O MDF-e usa a mesma assinatura (MOC do MDF-e 3.00b, Visão Geral, item 3.2.4): os alvos dele estão em src/lib/mdfe/montar.ts.
  | { assinado: "infMDFe"; pai: "MDFe" }
  | { assinado: "infEvento"; pai: "eventoMDFe" };

export const ALVO_DO_CTE: AlvoDaAssinatura = { assinado: "infCte", pai: "CTe" };
export const ALVO_DO_EVENTO: AlvoDaAssinatura = { assinado: "infEvento", pai: "eventoCTe" };

export type ChaveDeAssinatura = { chavePem: string; certificadoPem: string };

/**
 * Assina o elemento (pelo atributo `Id`) e devolve o XML com a `Signature` no
 * fim do elemento pai, que é onde o esquema a espera.
 */
export function assinarXml(xml: string, alvo: AlvoDaAssinatura, chave: ChaveDeAssinatura): string {
  try {
    const assinatura = new SignedXml({
      privateKey: chave.chavePem,
      publicCert: chave.certificadoPem,
      signatureAlgorithm: RSA_SHA1,
      canonicalizationAlgorithm: C14N,
    });
    assinatura.addReference({
      xpath: `//*[local-name(.)='${alvo.assinado}']`,
      transforms: [ENVELOPED, C14N],
      digestAlgorithm: SHA1,
    });
    assinatura.computeSignature(xml, { location: { reference: `//*[local-name(.)='${alvo.pai}']`, action: "append" } });
    return assinatura.getSignedXml();
  } catch (erro) {
    // Só a mensagem da biblioteca: ela não leva a chave.
    throw new AssinaturaError(`Não foi possível assinar o XML: ${erro instanceof Error ? erro.message : "erro desconhecido"}`);
  }
}

/**
 * A assinatura de um texto curto, fora do XML: RSA-SHA1 em Base64. É o
 * parâmetro `sign` do QR Code do MDF-e emitido em contingência, que assina a
 * chave de acesso "a partir do certificado digital que assina o MDFe" (MOC do
 * MDF-e 3.00b, Visão Geral, item 9.2.2).
 */
export function assinarTexto(texto: string, chavePem: string): string {
  try {
    return createSign("RSA-SHA1").update(texto, "utf8").sign(chavePem, "base64");
  } catch (erro) {
    throw new AssinaturaError(`Não foi possível assinar: ${erro instanceof Error ? erro.message : "erro desconhecido"}`);
  }
}

/** Confere uma assinatura de `assinarTexto` contra o certificado. */
export function assinaturaDoTextoConfere(texto: string, assinatura: string, certificadoPem: string): boolean {
  try {
    return createVerify("RSA-SHA1").update(texto, "utf8").verify(certificadoPem, assinatura, "base64");
  } catch {
    return false;
  }
}

const ASSINATURA = /<Signature[\s>][\s\S]*?<\/Signature>/;

/**
 * Confere a assinatura do XML contra o certificado informado: o resumo do
 * elemento assinado e a assinatura do `SignedInfo`. `false` para XML sem
 * assinatura, alterado depois de assinado ou assinado por outra chave.
 */
export function assinaturaConfere(xml: string, certificadoPem: string): boolean {
  const achada = xml.match(ASSINATURA);
  if (!achada) return false;
  try {
    const assinatura = new SignedXml({ publicCert: certificadoPem });
    assinatura.loadSignature(achada[0]);
    return assinatura.checkSignature(xml);
  } catch {
    return false;
  }
}

/** O `DigestValue` da assinatura: a SEFAZ o devolve no protocolo (`digVal`), e os dois têm de ser iguais. */
export function resumoDaAssinatura(xml: string): string | null {
  return xml.match(/<DigestValue>([A-Za-z0-9+/=]+)<\/DigestValue>/)?.[1] ?? null;
}
