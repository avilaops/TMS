// Tipos do que o TMS usa do pacote `node-forge` (src/lib/cte/certificado.ts e os
// testes do CT-e): abrir o .pfx/.p12 do certificado A1 e, nos testes, gerar um
// certificado autoassinado. O pacote não traz tipos, e as dependências novas do
// módulo são só as que o roteiro permitiu.
declare module "node-forge" {
  export namespace util {
    interface ByteBuffer {
      getBytes(): string;
      toHex(): string;
    }
    function createBuffer(bytes?: string, codificacao?: string): ByteBuffer;
    function encode64(bytes: string): string;
    function decode64(texto: string): string;
  }

  export namespace asn1 {
    interface Asn1 {
      tagClass: number;
      type: number;
      constructed: boolean;
      value: string | Asn1[];
    }
    const Class: { UNIVERSAL: number; APPLICATION: number; CONTEXT_SPECIFIC: number; PRIVATE: number };
    const Type: { OID: number; OCTETSTRING: number; SEQUENCE: number; UTF8: number; PRINTABLESTRING: number; IA5STRING: number };
    function fromDer(bytes: string | util.ByteBuffer, estrito?: boolean): Asn1;
    function toDer(objeto: Asn1): util.ByteBuffer;
    function create(tagClass: number, type: number, constructed: boolean, value: string | Asn1[]): Asn1;
    function derToOid(bytes: string | util.ByteBuffer): string;
    function oidToDer(oid: string): util.ByteBuffer;
  }

  export namespace jsbn {
    interface BigInteger {
      toString(base?: number): string;
    }
  }

  export namespace md {
    interface MessageDigest {
      update(bytes: string, codificacao?: string): MessageDigest;
      digest(): util.ByteBuffer;
    }
    const sha256: { create(): MessageDigest };
    const sha1: { create(): MessageDigest };
  }

  export namespace pki {
    interface PrivateKey {
      n: jsbn.BigInteger;
    }
    interface PublicKey {
      n: jsbn.BigInteger;
    }
    interface Campo {
      name?: string;
      shortName?: string;
      type?: string;
      value: string;
    }
    interface NomeAlternativo {
      type: number;
      value?: string | asn1.Asn1[];
      /** Endereço IP, para o tipo 7. */
      ip?: string;
    }
    interface Extensao {
      id?: string;
      name?: string;
      critical?: boolean;
      value?: string;
      altNames?: NomeAlternativo[];
      [campo: string]: unknown;
    }
    interface Certificate {
      serialNumber: string;
      publicKey: PublicKey;
      validity: { notBefore: Date; notAfter: Date };
      subject: { getField(nome: string): Campo | null; attributes: Campo[] };
      issuer: { getField(nome: string): Campo | null; attributes: Campo[] };
      extensions: Extensao[];
      getExtension(nome: string | { id: string }): Extensao | null;
      setSubject(campos: Campo[]): void;
      setIssuer(campos: Campo[]): void;
      setExtensions(extensoes: Extensao[]): void;
      sign(chave: PrivateKey, resumo?: md.MessageDigest): void;
    }
    const oids: Record<string, string>;
    function createCertificate(): Certificate;
    function certificateToPem(certificado: Certificate): string;
    function certificateFromPem(pem: string): Certificate;
    function privateKeyToPem(chave: PrivateKey): string;
    function privateKeyFromPem(pem: string): PrivateKey;
    function publicKeyFromPem(pem: string): PublicKey;
  }

  export namespace pkcs12 {
    interface Bag {
      key?: pki.PrivateKey | null;
      cert?: pki.Certificate | null;
    }
    interface Pkcs12Pfx {
      getBags(filtro: { bagType: string }): Record<string, Bag[] | undefined>;
    }
    function pkcs12FromAsn1(objeto: asn1.Asn1, estrito: boolean, senha: string): Pkcs12Pfx;
    function toPkcs12Asn1(chave: pki.PrivateKey | null, certificados: pki.Certificate | pki.Certificate[], senha: string, opcoes?: { algorithm?: "aes128" | "aes192" | "aes256" | "3des"; friendlyName?: string }): asn1.Asn1;
  }

  const forge: { util: typeof util; asn1: typeof asn1; md: typeof md; pki: typeof pki; pkcs12: typeof pkcs12 };
  export default forge;
}
