import forge, { type asn1, type pkcs12, type pki } from "node-forge";
import type { ConferenciaDoCertificado } from "@/lib/cte";

/**
 * Leitura do certificado digital A1 (arquivo .pfx/.p12 com a senha) e as
 * conferências antes de guardá-lo: é um e-CNPJ, é A1, está na validade e é da
 * empresa emitente.
 *
 * O que NÃO é conferido aqui: a cadeia do certificado até a raiz da ICP-Brasil
 * e a revogação. Quem confere as duas é a SEFAZ, a cada mensagem (MOC 4.00,
 * Visão Geral, item 4.1.1); um certificado fora da ICP-Brasil que carregue as
 * marcas de e-CNPJ A1 passa por aqui e é recusado lá.
 *
 * Nenhuma mensagem de erro leva o conteúdo do arquivo nem a senha.
 *
 * Só o servidor importa este arquivo.
 */

/** Onde a ICP-Brasil guarda o CNPJ do titular: `otherName` do nome alternativo, com este OID. */
const OID_DO_CNPJ = "2.16.76.1.3.3";
/** Políticas de certificado da ICP-Brasil: `2.16.76.1.2.<tipo>.<AC>`. O tipo 1 é o A1 (chave em arquivo). */
const PREFIXO_DO_A1 = "2.16.76.1.2.1.";
const OID_DAS_POLITICAS = "2.5.29.32";

export const SENHA_ERRADA = "Não foi possível abrir o certificado: a senha não confere ou o arquivo não é um .pfx/.p12 válido.";
export const SEM_CHAVE = "O arquivo não traz a chave privada junto do certificado. Exporte o A1 com a chave privada.";
export const NAO_E_ECNPJ = "Este certificado não é um e-CNPJ: não traz o CNPJ do titular. O CT-e é assinado com o e-CNPJ da transportadora.";
export const NAO_E_A1 = "Este certificado não é do tipo A1. Só o A1 (arquivo) pode ser enviado; o A3 fica em cartão ou token.";
export const VENCIDO = "Este certificado está vencido.";
export const AINDA_NAO_VALE = "Este certificado ainda não está na validade.";
export const DE_OUTRO_CNPJ = "Este certificado é de outro CNPJ: precisa ser da mesma empresa do emitente.";

export class CertificadoError extends Error {}

export type CertificadoLido = {
  /** Chave privada, em PEM. Nunca sai do servidor. */
  chavePem: string;
  /** O certificado do titular seguido da cadeia que veio no arquivo, em PEM (é o que a conexão com a SEFAZ apresenta). */
  certificadoPem: string;
  /** Só o certificado do titular, em PEM (é o que vai no `KeyInfo` da assinatura). */
  titularPem: string;
  /** Nome comum (CN) do certificado. */
  titular: string;
  cnpj: string | null;
  validoDe: Date;
  validoAte: Date;
  a1: boolean;
};

/** O texto de um nó ASN.1, descendo pelos invólucros até a primeira cadeia de bytes. */
function textoDoNo(no: asn1.Asn1 | string): string {
  if (typeof no === "string") return no;
  if (typeof no.value === "string") return no.value;
  return no.value.length > 0 ? textoDoNo(no.value[0]) : "";
}

/** O CNPJ do titular: o `otherName` da ICP-Brasil; sem ele, os 14 dígitos depois dos dois-pontos do CN ("EMPRESA LTDA:12345678000199"). */
function cnpjDoCertificado(certificado: pki.Certificate): string | null {
  const alternativos = certificado.getExtension("subjectAltName")?.altNames ?? [];
  for (const nome of alternativos) {
    if (nome.type !== 0 || !Array.isArray(nome.value) || nome.value.length < 2) continue;
    const [oid, valor] = nome.value;
    if (typeof oid.value !== "string" || forge.asn1.derToOid(oid.value) !== OID_DO_CNPJ) continue;
    // O CNPJ pode ter letras nas 12 primeiras posições (NT Conjunta 2025.001).
    const cnpj = textoDoNo(valor).toUpperCase().replace(/[^0-9A-Z]/g, "");
    if (/^[A-Z0-9]{12}\d{2}$/.test(cnpj)) return cnpj;
  }
  const doNome = /:([A-Z0-9]{12}\d{2})$/.exec((certificado.subject.getField("CN")?.value ?? "").toUpperCase());
  return doNome ? doNome[1] : null;
}

/** As políticas do certificado (extensão 2.5.29.32), como lista de OIDs. */
function politicas(certificado: pki.Certificate): string[] {
  const extensao = certificado.getExtension({ id: OID_DAS_POLITICAS });
  if (!extensao || typeof extensao.value !== "string") return [];
  try {
    const sequencia = forge.asn1.fromDer(extensao.value);
    if (typeof sequencia.value === "string") return [];
    return sequencia.value.flatMap((politica) => {
      const oid = typeof politica.value === "string" ? null : politica.value[0];
      return oid && typeof oid.value === "string" ? [forge.asn1.derToOid(oid.value)] : [];
    });
  } catch {
    return [];
  }
}

/**
 * Abre o .pfx/.p12 com a senha. Lança `CertificadoError` com uma frase para a
 * pessoa quando a senha não confere, o arquivo não é um PKCS#12 ou não traz a
 * chave privada.
 */
export function lerCertificado(arquivo: Buffer, senha: string): CertificadoLido {
  let pfx: pkcs12.Pkcs12Pfx;
  try {
    pfx = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(forge.util.createBuffer(arquivo.toString("binary"))), false, senha);
  } catch {
    // O motivo da biblioteca não ajuda quem lê e não deve ir para log.
    throw new CertificadoError(SENHA_ERRADA);
  }

  const sacolas = (tipo: string) => pfx.getBags({ bagType: tipo })[tipo] ?? [];
  const chave = [...sacolas(forge.pki.oids.pkcs8ShroudedKeyBag), ...sacolas(forge.pki.oids.keyBag)].find((sacola) => sacola.key)?.key ?? null;
  if (!chave) throw new CertificadoError(SEM_CHAVE);

  const certificados = sacolas(forge.pki.oids.certBag).flatMap((sacola) => (sacola.cert ? [sacola.cert] : []));
  // O do titular é o que tem a chave pública da chave privada; os outros são a cadeia.
  const modulo = chave.n.toString(16);
  const doTitular = certificados.find((certificado) => certificado.publicKey.n?.toString(16) === modulo);
  if (!doTitular) throw new CertificadoError(SEM_CHAVE);

  const titularPem = forge.pki.certificateToPem(doTitular);
  const cadeia = certificados.filter((certificado) => certificado !== doTitular).map((certificado) => forge.pki.certificateToPem(certificado));
  const oids = politicas(doTitular);

  return {
    chavePem: forge.pki.privateKeyToPem(chave),
    certificadoPem: [titularPem, ...cadeia].join(""),
    titularPem,
    titular: (doTitular.subject.getField("CN")?.value ?? "").slice(0, 200),
    cnpj: cnpjDoCertificado(doTitular),
    validoDe: doTitular.validity.notBefore,
    validoAte: doTitular.validity.notAfter,
    a1: oids.some((oid) => oid.startsWith(PREFIXO_DO_A1)),
  };
}

/** Como o CNPJ do certificado confere com o do emitente, ou `null` quando é de outra empresa. */
export function conferenciaDoCnpj(cnpjDoCertificadoLido: string | null, cnpjDoEmitente: string): ConferenciaDoCertificado | null {
  if (!cnpjDoCertificadoLido) return null;
  if (cnpjDoCertificadoLido === cnpjDoEmitente) return "MESMO_CNPJ";
  // O MOC (item 3.2.3) aceita o certificado de qualquer estabelecimento da empresa: mesma raiz de 8 dígitos.
  return cnpjDoCertificadoLido.slice(0, 8) === cnpjDoEmitente.slice(0, 8) ? "MESMA_EMPRESA" : null;
}

/**
 * As conferências antes de guardar o certificado. Devolve como ele confere com
 * o emitente; lança `CertificadoError` com o motivo quando não serve.
 */
export function conferirCertificado(lido: Pick<CertificadoLido, "cnpj" | "validoDe" | "validoAte" | "a1">, cnpjDoEmitente: string, agora: Date = new Date()): ConferenciaDoCertificado {
  if (!lido.cnpj) throw new CertificadoError(NAO_E_ECNPJ);
  if (!lido.a1) throw new CertificadoError(NAO_E_A1);
  if (agora.getTime() > lido.validoAte.getTime()) throw new CertificadoError(VENCIDO);
  if (agora.getTime() < lido.validoDe.getTime()) throw new CertificadoError(AINDA_NAO_VALE);
  const confere = conferenciaDoCnpj(lido.cnpj, cnpjDoEmitente);
  if (!confere) throw new CertificadoError(DE_OUTRO_CNPJ);
  return confere;
}

export { OID_DO_CNPJ, OID_DAS_POLITICAS, PREFIXO_DO_A1 };
