import { createHash, generateKeyPairSync, randomBytes, X509Certificate } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import type { TLSSocket } from "node:tls";
import { gunzipSync } from "node:zlib";
import forge, { type asn1, type pki } from "node-forge";
import { digitoDaChave } from "../src/lib/nfe";
import { validateXML } from "xmllint-wasm";
import { OID_DAS_POLITICAS, OID_DO_CNPJ, PREFIXO_DO_A1 } from "../src/lib/cte/certificado";
import type { DadosDoCte, EmitenteDoCte, ParticipanteDoCte } from "../src/lib/cte/montar";
import type { ResponsavelTecnico } from "../src/lib/cte/responsavel-tecnico";

/**
 * Apoio dos testes do CT-e: certificado autoassinado com as marcas de um e-CNPJ
 * A1, validação contra os esquemas oficiais (fiscal/esquemas/cte-4.00) e um
 * servidor HTTPS local que imita a SEFAZ.
 *
 * Nada aqui fala com a SEFAZ de verdade nem usa certificado de verdade.
 */

/* ------------------------------- Certificado -------------------------------- */

export type CertificadoDeTeste = { pfx: Buffer; senha: string; chavePem: string; certificadoPem: string; cnpj: string };

type OpcoesDoCertificado = {
  cnpj?: string;
  nome?: string;
  senha?: string;
  validoDe?: Date;
  validoAte?: Date;
  /** `false`: sem o CNPJ no certificado (como um e-CPF). */
  comCnpj?: boolean;
  /** Tipo na política da ICP-Brasil: 1 = A1, 3 = A3. `null`: sem política nenhuma. */
  tipo?: 1 | 3 | null;
  /** `false`: o .pfx sai só com o certificado, sem a chave privada. */
  comChave?: boolean;
};

const A = forge.asn1;
const UM_DIA = 86_400_000;

const sequencia = (filhos: asn1.Asn1[]) => A.create(A.Class.UNIVERSAL, A.Type.SEQUENCE, true, filhos);
const oid = (valor: string) => A.create(A.Class.UNIVERSAL, A.Type.OID, false, A.oidToDer(valor).getBytes());

/** O par de chaves do Node (rápido), já como objetos do forge. */
function parDeChaves() {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
  });
  return { chavePem: privateKey, chave: forge.pki.privateKeyFromPem(privateKey), publica: forge.pki.publicKeyFromPem(publicKey) };
}

/**
 * Um certificado autoassinado com o que a ICP-Brasil põe num e-CNPJ A1: o CNPJ
 * no `otherName` 2.16.76.1.3.3 do nome alternativo e uma política 2.16.76.1.2.1.x.
 * Não é da ICP-Brasil (a SEFAZ o recusaria): serve para testar a leitura, a
 * assinatura e a conexão com autenticação mútua contra o servidor local.
 */
export function certificadoDeTeste(opcoes: OpcoesDoCertificado = {}): CertificadoDeTeste {
  const cnpj = opcoes.cnpj ?? "11222333000181";
  const senha = opcoes.senha ?? "senha-do-teste";
  const tipo = opcoes.tipo === undefined ? 1 : opcoes.tipo;
  const { chavePem, chave, publica } = parDeChaves();

  const certificado = forge.pki.createCertificate();
  certificado.publicKey = publica;
  certificado.serialNumber = `01${randomBytes(8).toString("hex")}`;
  certificado.validity = { notBefore: opcoes.validoDe ?? new Date(Date.now() - UM_DIA), notAfter: opcoes.validoAte ?? new Date(Date.now() + 365 * UM_DIA) };
  const nome = [
    { name: "commonName", value: opcoes.nome ?? "TRANSPORTADORA DE TESTE LTDA" },
    { name: "organizationName", value: "Teste do TMS (fora da ICP-Brasil)" },
    { name: "countryName", value: "BR" },
  ];
  certificado.setSubject(nome);
  certificado.setIssuer(nome);

  const extensoes: pki.Extensao[] = [
    { name: "basicConstraints", cA: false },
    { name: "keyUsage", digitalSignature: true, nonRepudiation: true, keyEncipherment: true },
    { name: "extKeyUsage", clientAuth: true },
  ];
  if (opcoes.comCnpj !== false) {
    const alternativos = sequencia([
      A.create(A.Class.CONTEXT_SPECIFIC, 0, true, [oid(OID_DO_CNPJ), A.create(A.Class.CONTEXT_SPECIFIC, 0, true, [A.create(A.Class.UNIVERSAL, A.Type.OCTETSTRING, false, cnpj)])]),
    ]);
    extensoes.push({ id: "2.5.29.17", name: "subjectAltName", value: A.toDer(alternativos).getBytes() });
  }
  if (tipo !== null) {
    const politicas = sequencia([sequencia([oid(`${tipo === 1 ? PREFIXO_DO_A1 : "2.16.76.1.2.3."}999`)])]);
    extensoes.push({ id: OID_DAS_POLITICAS, name: "certificatePolicies", value: A.toDer(politicas).getBytes() });
  }
  certificado.setExtensions(extensoes);
  certificado.sign(chave, forge.md.sha256.create());

  const p12 = forge.pkcs12.toPkcs12Asn1(opcoes.comChave === false ? null : chave, [certificado], senha, { algorithm: "3des" });
  return { pfx: Buffer.from(A.toDer(p12).getBytes(), "binary"), senha, chavePem, certificadoPem: forge.pki.certificateToPem(certificado), cnpj };
}

/** O certificado do servidor local: autoassinado, para `127.0.0.1` e `localhost`. */
export function certificadoDoServidor(): { chavePem: string; certificadoPem: string } {
  const { chavePem, chave, publica } = parDeChaves();
  const certificado = forge.pki.createCertificate();
  certificado.publicKey = publica;
  certificado.serialNumber = `02${randomBytes(8).toString("hex")}`;
  certificado.validity = { notBefore: new Date(Date.now() - UM_DIA), notAfter: new Date(Date.now() + 30 * UM_DIA) };
  const nome = [{ name: "commonName", value: "SEFAZ de mentira (teste do TMS)" }];
  certificado.setSubject(nome);
  certificado.setIssuer(nome);
  certificado.setExtensions([
    { name: "basicConstraints", cA: true },
    { name: "subjectAltName", altNames: [{ type: 2, value: "localhost" }, { type: 7, ip: "127.0.0.1" }] },
  ]);
  certificado.sign(chave, forge.md.sha256.create());
  return { chavePem, certificadoPem: forge.pki.certificateToPem(certificado) };
}

/* --------------------------------- Esquemas --------------------------------- */

const PASTA_DOS_ESQUEMAS = "fiscal/esquemas/cte-4.00";

const esquemas = new Map<string, { fileName: string; contents: string }[]>();

function arquivosDosEsquemas(pasta: string) {
  let lidos = esquemas.get(pasta);
  if (!lidos) {
    lidos = readdirSync(pasta)
      .filter((nome) => nome.endsWith(".xsd"))
      .map((nome) => ({ fileName: nome, contents: readFileSync(`${pasta}/${nome}`, "utf8") }));
    esquemas.set(pasta, lidos);
  }
  return lidos;
}

/**
 * Valida o XML contra um esquema oficial do pacote (ex.: `cte_v4.00.xsd`). Devolve
 * os erros que o validador (libxml2, o mesmo `xmllint`) apontou; vazio = válido.
 * `pasta` troca o pacote: o MDF-e usa o dele (tests/mdfe-apoio.ts).
 */
export async function errosNoEsquema(xml: string, esquema: string, pasta: string = PASTA_DOS_ESQUEMAS): Promise<string[]> {
  const todos = arquivosDosEsquemas(pasta);
  const principal = todos.find((arquivo) => arquivo.fileName === esquema);
  if (!principal) throw new Error(`Esquema ${esquema} não está em ${pasta}.`);
  const resultado = await validateXML({
    xml: [{ fileName: "documento.xml", contents: xml }],
    schema: [principal],
    preload: todos.filter((arquivo) => arquivo !== principal),
  });
  return resultado.valid ? [] : resultado.errors.map((erro) => erro.message);
}

/* ------------------------------ Dados de exemplo ----------------------------- */

export const EMITENTE: EmitenteDoCte = {
  cnpj: "11222333000181",
  ie: "123456789012",
  razaoSocial: "Transportadora de Teste Ltda",
  fantasia: "Trans Teste",
  endereco: { logradouro: "Rua das Flores", numero: "120", complemento: "Galpão 2", bairro: "Centro", codigoMunicipio: "3530300", municipio: "Mirassol", uf: "SP", cep: "15130000" },
  telefone: "1732421000",
  rntrc: "12345678",
  regime: "3",
  serie: 1,
  ambiente: "HOMOLOGACAO",
  cfopDentro: "5353",
  cfopFora: "6353",
  icms: "00",
  aliquota: 12,
  ibsCbs: { cst: "000", classe: "000001", ibsUf: 0.1, ibsMunicipio: 0, cbs: 0.9, pis: 0, cofins: 0 },
};

export const REMETENTE: ParticipanteDoCte = {
  documento: "45543915000181",
  ie: "110042490114",
  nome: "Indústria Remetente S/A",
  fantasia: "Remetente",
  telefone: "1133334444",
  endereco: { logradouro: "Av. Brasil", numero: "1500", bairro: "Distrito Industrial", codigoMunicipio: "3549805", municipio: "São José do Rio Preto", uf: "SP", cep: "15035000" },
};

export const DESTINATARIO: ParticipanteDoCte = {
  documento: "07526557000100",
  ie: "0623079040081",
  nome: "Comércio Destinatário Ltda",
  endereco: { logradouro: "Rua da Bahia", numero: "900", bairro: "Centro", codigoMunicipio: "3106200", municipio: "Belo Horizonte", uf: "MG", cep: "30160011" },
};

/** Um CT-e completo de exemplo (interestadual, tomador remetente, uma NF-e); cada teste troca o que quer. */
export function dadosDeExemplo(trocas: Partial<DadosDoCte> = {}): DadosDoCte {
  return {
    emitente: EMITENTE,
    numero: 15,
    codigo: "48215937",
    emissao: new Date("2026-10-10T14:30:00.000Z"),
    remetente: REMETENTE,
    destinatario: DESTINATARIO,
    tomador: { papel: "REMETENTE" },
    contribuinte: "1",
    inicio: { codigoMunicipio: "3549805", municipio: "São José do Rio Preto", uf: "SP" },
    fim: { codigoMunicipio: "3106200", municipio: "Belo Horizonte", uf: "MG" },
    valorDaPrestacao: 850.5,
    componentes: [
      { nome: "Frete peso", valor: 700 },
      { nome: "Pedágio", valor: 150.5 },
    ],
    valorDaCarga: 32500.9,
    produto: "Peças automotivas",
    pesoKg: 1250.5,
    volumes: 12,
    chavesDeNfe: ["35261045543915000181550010000012341000012341"],
    documento: "1234567890",
    observacao: "Veiculo placa ABC1D23. Motorista João da Silva.",
    enderecoDoQrCode: "https://homologacao.nfe.fazenda.sp.gov.br/CTeConsulta/qrCode",
    ...trocas,
  };
}

/** Um responsável técnico de mentira, no formato do esquema (`TRespTec`). Os dados de verdade vêm das variáveis RESPTEC_*. */
export const RESPONSAVEL_TECNICO: ResponsavelTecnico = { cnpj: "99888777000100", contato: "Suporte de Teste", email: "suporte@desenvolvedora.example", telefone: "1730001000" };

const MIRASSOL = { codigoMunicipio: "3530300", municipio: "Mirassol", uf: "SP" };
const SALVADOR = { codigoMunicipio: "2927408", municipio: "Salvador", uf: "BA" };
const BELO_HORIZONTE = { codigoMunicipio: "3106200", municipio: "Belo Horizonte", uf: "MG" };
const RIO_DE_JANEIRO = { codigoMunicipio: "3304557", municipio: "Rio de Janeiro", uf: "RJ" };
const CURITIBA = { codigoMunicipio: "4106902", municipio: "Curitiba", uf: "PR" };

/** O emitente de exemplo instalado em outra UF (endereço e QR Code de lá). */
const emitenteEm = (uf: "MT" | "AC"): EmitenteDoCte => ({
  ...EMITENTE,
  endereco:
    uf === "MT"
      ? { logradouro: "Av. do CPA", numero: "500", bairro: "Centro Político", codigoMunicipio: "5103403", municipio: "Cuiabá", uf: "MT", cep: "78049000" }
      : { logradouro: "Av. Ceará", numero: "900", bairro: "Centro", codigoMunicipio: "1200401", municipio: "Rio Branco", uf: "AC", cep: "69900000" },
});
const CUIABA = { codigoMunicipio: "5103403", municipio: "Cuiabá", uf: "MT" };
const RIO_BRANCO = { codigoMunicipio: "1200401", municipio: "Rio Branco", uf: "AC" };

/**
 * Os cenários de CT-e que os testes validam no esquema oficial e que são
 * passados, à mão, pelo validador do serviço fiscal da casa
 * (`validar_xml_fiscal`). O nome de cada um diz a regra que ele exercita.
 */
export const CENARIOS_DO_CTE: Record<string, () => DadosDoCte> = {
  // Os que já existiam.
  "interestadual-12-sp-mg": () => dadosDeExemplo(),
  "interno-aliquota-interna": () => dadosDeExemplo({ fim: MIRASSOL }),
  "isenta-40": () => dadosDeExemplo({ emitente: { ...EMITENTE, icms: "40", aliquota: 0 } }),
  "nao-tributada-41": () => dadosDeExemplo({ emitente: { ...EMITENTE, icms: "41", aliquota: 0 } }),
  "outras-90": () => dadosDeExemplo({ emitente: { ...EMITENTE, icms: "90", aliquota: 7 } }),
  "simples-nacional": () => dadosDeExemplo({ emitente: { ...EMITENTE, regime: "1", icms: "SN", aliquota: 0, ibsCbs: null } }),
  "producao": () => dadosDeExemplo({ emitente: { ...EMITENTE, ambiente: "PRODUCAO" }, enderecoDoQrCode: "https://nfe.fazenda.sp.gov.br/CTeConsulta/qrCode" }),
  "sem-nfe": () => dadosDeExemplo({ chavesDeNfe: [], fim: MIRASSOL }),
  "cnpj-alfanumerico": () => dadosDeExemplo({ emitente: { ...EMITENTE, cnpj: "12ABC34501DE35" } }),
  "ibscbs-410-imune": () => dadosDeExemplo({ emitente: { ...EMITENTE, ibsCbs: { ...EMITENTE.ibsCbs!, cst: "410", classe: "410004" } } }),
  // As correções da revisão contra o MOC 4.00.
  "interestadual-7-sp-ba": () => dadosDeExemplo({ fim: SALVADOR }),
  "outra-uf-6932-mg-rj-12": () => dadosDeExemplo({ inicio: BELO_HORIZONTE, fim: RIO_DE_JANEIRO }),
  "outra-uf-6932-pr-ba-7": () => dadosDeExemplo({ inicio: CURITIBA, fim: SALVADOR }),
  // Situação 20: a interestadual só sai quando a configuração diz que a redução vale fora do estado.
  "icms-20-reducao-de-base": () => dadosDeExemplo({ emitente: { ...EMITENTE, icms: "20", reducaoDaBase: 20, reducaoNaInterestadual: true } }),
  "icms-20-reducao-de-base-interna": () => dadosDeExemplo({ emitente: { ...EMITENTE, icms: "20", reducaoDaBase: 20 }, fim: MIRASSOL }),
  "icms-60-substituicao": () => dadosDeExemplo({ emitente: { ...EMITENTE, icms: "60" } }),
  "ibscbs-200-aliquota-zero": () => dadosDeExemplo({ emitente: { ...EMITENTE, ibsCbs: { ...EMITENTE.ibsCbs!, cst: "200", classe: "200001" } } }),
  "ibscbs-200-reducao-40": () => dadosDeExemplo({ emitente: { ...EMITENTE, ibsCbs: { ...EMITENTE.ibsCbs!, cst: "200", classe: "200050" } } }),
  "emitente-utc-4-mt": () => dadosDeExemplo({ emitente: emitenteEm("MT"), inicio: CUIABA, fim: BELO_HORIZONTE, enderecoDoQrCode: "https://homologacao.sefaz.mt.gov.br/cte/qrcode" }),
  "emitente-utc-5-ac": () => dadosDeExemplo({ emitente: emitenteEm("AC"), inicio: RIO_BRANCO, fim: BELO_HORIZONTE, enderecoDoQrCode: "https://dfe-portal.svrs.rs.gov.br/cte/qrCode" }),
  "com-responsavel-tecnico": () => dadosDeExemplo({ responsavelTecnico: RESPONSAVEL_TECNICO }),
};

/** A chave de acesso de uma NF-e de exemplo (modelo 55, do remetente de exemplo), com o dígito verificador certo. */
export function chaveDeNfe(numero: number): string {
  const corpo = `352610${REMETENTE.documento}55001${String(numero).padStart(9, "0")}1${String(numero).padStart(8, "0")}`;
  return `${corpo}${digitoDaChave(corpo)}`;
}

/** O XML de uma NF-e autorizada, com o que a emissão do CT-e lê dela: emitente, destinatário (com IE e endereço com código IBGE) e o primeiro produto. */
export function nfeDeExemplo(trocas: { numero?: number; destCnpj?: string; destIe?: string } = {}): string {
  const chave = chaveDeNfe(trocas.numero ?? 1234);
  return `<?xml version="1.0" encoding="UTF-8"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe${chave}" versao="4.00"><ide><mod>55</mod><serie>1</serie><nNF>${trocas.numero ?? 1234}</nNF></ide><emit><CNPJ>45543915000181</CNPJ><xNome>Indústria Remetente S/A</xNome><xFant>Remetente</xFant><enderEmit><xLgr>Av. Brasil</xLgr><nro>1500</nro><xBairro>Distrito Industrial</xBairro><cMun>3549805</cMun><xMun>SAO JOSE DO RIO PRETO</xMun><UF>SP</UF><CEP>15035000</CEP><fone>1733334444</fone></enderEmit><IE>110042490114</IE></emit><dest><CNPJ>${trocas.destCnpj ?? "07526557000100"}</CNPJ><xNome>Comércio Destinatário Ltda</xNome><enderDest><xLgr>Rua da Bahia</xLgr><nro>900</nro><xCpl>Loja 2</xCpl><xBairro>Centro</xBairro><cMun>3106200</cMun><xMun>Belo Horizonte</xMun><UF>MG</UF><CEP>30160011</CEP></enderDest><IE>${trocas.destIe ?? "0623079040081"}</IE></dest><det nItem="1"><prod><xProd>Rolamento de esferas 6204</xProd></prod></det><total><ICMSTot><vNF>32500.90</vNF></ICMSTot></total></infNFe></NFe></nfeProc>`;
}

/* ---------------------------- A SEFAZ de mentira ----------------------------- */

export type ModoDaSefaz =
  | "autorizar"
  | "rejeitar"
  | "duplicidade"
  | "numero-usado"
  | "parado"
  /** Recebe e nunca responde, sem processar. */
  | "mudo"
  /** Processa (autoriza o CT-e, registra o cancelamento) e nunca responde: a resposta "se perdeu". */
  | "mudo-processando"
  | "fault"
  | "sem-protocolo"
  | "outra-chave";

export type ChamadaRecebida = {
  servico: string;
  acao: string;
  /** Conteúdo do `cteDadosMsg`, já descompactado quando é o envio do CT-e. */
  dados: string;
  /** Impressão digital (SHA-256) do certificado que o cliente apresentou, ou `null` sem certificado. */
  certificadoDoCliente: string | null;
};

export type SefazDeMentira = {
  url: string;
  /** O certificado do servidor, que o cliente precisa aceitar como autoridade. */
  autoridades: string[];
  modo: ModoDaSefaz;
  /** Atraso antes de responder, para os testes de concorrência. */
  atrasoMs: number;
  /** Quantas consultas ainda respondem "não consta" (217) mesmo para um CT-e autorizado: a consulta que chega antes de a autorização aparecer. */
  consultasCegas: number;
  chamadas: ChamadaRecebida[];
  /** Chaves que este servidor já autorizou (a consulta responde por elas) e cancelou. */
  autorizados: Map<string, { protocolo: string; resumo: string; recebidoEm: string; ambiente: string }>;
  cancelados: Set<string>;
  fechar: () => Promise<void>;
};

const NS = "http://www.portalfiscal.inf.br/cte";

const envelope = (servico: string, metodo: string, conteudo: string) =>
  `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><${metodo}Result xmlns="${NS}/wsdl/${servico}">${conteudo}</${metodo}Result></soap:Body></soap:Envelope>`;

const horario = () => `${new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 19)}-03:00`;

let sequencial = 0;
const novoProtocolo = () => `1352600${String(Date.now() % 100000).padStart(5, "0")}${String((sequencial += 1) % 1000).padStart(3, "0")}`;

function protocoloXml(chave: string, autorizado: { protocolo: string; resumo: string; recebidoEm: string; ambiente: string }, cStat = 100, motivo = "Autorizado o uso do CT-e") {
  return `<protCTe versao="4.00"><infProt Id="ID${autorizado.protocolo}"><tpAmb>${autorizado.ambiente}</tpAmb><verAplic>TESTE-1.0</verAplic><chCTe>${chave}</chCTe><dhRecbto>${autorizado.recebidoEm}</dhRecbto><nProt>${autorizado.protocolo}</nProt><digVal>${autorizado.resumo}</digVal><cStat>${cStat}</cStat><xMotivo>${motivo}</xMotivo></infProt></protCTe>`;
}

/**
 * Sobe um servidor HTTPS em 127.0.0.1 que responde como os web services do
 * CT-e. Pede o certificado do cliente (autenticação mútua) e recusa com 403
 * quem não apresenta um, como a SEFAZ.
 */
export async function subirSefazDeMentira(): Promise<SefazDeMentira> {
  const { chavePem, certificadoPem } = certificadoDoServidor();
  const estado: SefazDeMentira = {
    url: "",
    autoridades: [certificadoPem],
    modo: "autorizar",
    atrasoMs: 0,
    consultasCegas: 0,
    chamadas: [],
    autorizados: new Map(),
    cancelados: new Set(),
    fechar: async () => undefined,
  };

  const responder = (servico: string, dados: string): string | null => {
    // O ambiente da resposta é o da mensagem recebida, como na SEFAZ.
    const ambiente = /<tpAmb>([12])<\/tpAmb>/.exec(dados)?.[1] ?? "2";
    const retorno = (raiz: string, cStat: number, motivo: string, resto = "") =>
      `<${raiz} xmlns="${NS}" versao="4.00"><tpAmb>${ambiente}</tpAmb><cUF>35</cUF><verAplic>TESTE-1.0</verAplic><cStat>${cStat}</cStat><xMotivo>${motivo}</xMotivo>${resto}</${raiz}>`;

    if (servico === "CTeStatusServicoV4") {
      const parado = estado.modo === "parado";
      return envelope(
        servico,
        "cteStatusServicoCT",
        `<retConsStatServCTe xmlns="${NS}" versao="4.00"><tpAmb>${ambiente}</tpAmb><verAplic>TESTE-1.0</verAplic><cStat>${parado ? 108 : 107}</cStat><xMotivo>${parado ? "Serviço Paralisado Momentaneamente" : "Serviço em Operação"}</xMotivo><cUF>35</cUF><dhRecbto>${horario()}</dhRecbto><tMed>1</tMed></retConsStatServCTe>`,
      );
    }

    if (servico === "CTeRecepcaoSincV4") {
      const chave = /Id="CTe([0-9A-Z]{44})"/.exec(dados)?.[1] ?? "";
      const resumo = /<DigestValue>([^<]+)<\/DigestValue>/.exec(dados)?.[1] ?? "";
      if (estado.modo === "parado") return envelope(servico, "cteRecepcao", retorno("retCTe", 108, "Serviço Paralisado Momentaneamente"));
      if (estado.modo === "rejeitar") return envelope(servico, "cteRecepcao", retorno("retCTe", 481, "Rejeição: IE deve ser informada para tomador Contribuinte"));
      if (estado.modo === "numero-usado") {
        return envelope(servico, "cteRecepcao", retorno("retCTe", 539, "Rejeição: Duplicidade de CTe, com diferença na Chave de Acesso [chCTe: 35261011222333000181570010000000011999999990]"));
      }
      if (estado.modo === "duplicidade" || estado.autorizados.has(chave)) {
        return envelope(servico, "cteRecepcao", retorno("retCTe", 204, "Rejeição: Duplicidade de CTe [nProt:135260000000001][dhAut: 2026-10-10T10:00:00-03:00]"));
      }
      if (estado.modo === "sem-protocolo") return envelope(servico, "cteRecepcao", retorno("retCTe", 100, "Autorizado o uso do CT-e"));
      const autorizado = { protocolo: novoProtocolo(), resumo, recebidoEm: horario(), ambiente };
      if (estado.modo === "outra-chave") {
        return envelope(servico, "cteRecepcao", retorno("retCTe", 100, "Autorizado o uso do CT-e", protocoloXml(`${chave.slice(0, 43)}${(Number(chave[43]) + 1) % 10}`, autorizado)));
      }
      estado.autorizados.set(chave, autorizado);
      return envelope(servico, "cteRecepcao", retorno("retCTe", 100, "Autorizado o uso do CT-e", protocoloXml(chave, autorizado)));
    }

    if (servico === "CTeConsultaV4") {
      const chave = /<chCTe>([0-9A-Z]{44})<\/chCTe>/.exec(dados)?.[1] ?? "";
      const autorizado = estado.autorizados.get(chave);
      const raiz = (cStat: number, motivo: string, resto = "") =>
        `<retConsSitCTe xmlns="${NS}" versao="4.00"><tpAmb>${ambiente}</tpAmb><verAplic>TESTE-1.0</verAplic><cStat>${cStat}</cStat><xMotivo>${motivo}</xMotivo><cUF>35</cUF>${resto}</retConsSitCTe>`;
      const cega = estado.consultasCegas > 0;
      if (cega) estado.consultasCegas -= 1;
      if (!autorizado || cega) return envelope(servico, "cteConsultaCT", raiz(217, "Rejeição: CTe não consta na base de dados da SEFAZ"));
      if (estado.cancelados.has(chave)) return envelope(servico, "cteConsultaCT", raiz(101, "Cancelamento de CT-e homologado", protocoloXml(chave, autorizado, 101, "Cancelamento de CT-e homologado")));
      return envelope(servico, "cteConsultaCT", raiz(100, "Autorizado o uso do CT-e", protocoloXml(chave, autorizado)));
    }

    if (servico === "CTeRecepcaoEventoV4") {
      const chave = /<chCTe>([0-9A-Z]{44})<\/chCTe>/.exec(dados)?.[1] ?? "";
      const evento = (cStat: number, motivo: string, resto = "") =>
        `<retEventoCTe xmlns="${NS}" versao="4.00"><infEvento><tpAmb>${ambiente}</tpAmb><verAplic>TESTE-1.0</verAplic><cOrgao>35</cOrgao><cStat>${cStat}</cStat><xMotivo>${motivo}</xMotivo><chCTe>${chave}</chCTe><tpEvento>110111</tpEvento>${resto}</infEvento></retEventoCTe>`;
      if (estado.modo === "rejeitar") return envelope(servico, "cteRecepcaoEvento", evento(220, "Rejeição: CTe autorizado há mais de 7 dias (168 horas)"));
      if (!estado.autorizados.has(chave)) return envelope(servico, "cteRecepcaoEvento", evento(217, "Rejeição: CTe não consta na base de dados da SEFAZ"));
      if (estado.cancelados.has(chave)) {
        return envelope(servico, "cteRecepcaoEvento", evento(218, "Rejeição: CTe já está cancelado na base de dados da SEFAZ [nProt:135260000000002][dhCanc: 2026-10-10T10:00:00-03:00]"));
      }
      estado.cancelados.add(chave);
      return envelope(
        servico,
        "cteRecepcaoEvento",
        evento(135, "Evento registrado e vinculado a CT-e", `<xEvento>Cancelamento</xEvento><nSeqEvento>1</nSeqEvento><dhRegEvento>${horario()}</dhRegEvento><nProt>${novoProtocolo()}</nProt>`),
      );
    }
    return null;
  };

  const servidor: Server = createServer({ key: chavePem, cert: certificadoPem, requestCert: true, rejectUnauthorized: false, minVersion: "TLSv1.2" }, (req, res) => {
    const partes: Buffer[] = [];
    req.on("data", (parte: Buffer) => partes.push(parte));
    req.on("end", () => {
      const corpo = Buffer.concat(partes).toString("utf8");
      const servico = (req.url ?? "").split("/").pop() ?? "";
      const bruto = /<cteDadosMsg[^>]*>([\s\S]*)<\/cteDadosMsg>/.exec(corpo)?.[1] ?? "";
      const dados = servico === "CTeRecepcaoSincV4" ? gunzipSync(Buffer.from(bruto, "base64")).toString("utf8") : bruto;
      const doCliente = (req.socket as TLSSocket).getPeerCertificate();
      const certificadoDoCliente = doCliente?.raw ? createHash("sha256").update(doCliente.raw).digest("hex") : null;
      estado.chamadas.push({ servico, acao: String(req.headers["content-type"] ?? ""), dados, certificadoDoCliente });

      if (!certificadoDoCliente) {
        res.writeHead(403, { "Content-Type": "text/html" }).end("<html><title>403 - Forbidden: Access is denied.</title></html>");
        return;
      }
      if (estado.modo === "mudo") return; // nunca responde: o cliente desiste pelo tempo limite
      if (estado.modo === "mudo-processando") {
        // Processa como se fosse autorizar, e a resposta se perde.
        estado.modo = "autorizar";
        responder(servico, dados);
        estado.modo = "mudo-processando";
        return;
      }
      if (estado.modo === "fault") {
        res.writeHead(500, { "Content-Type": "application/soap+xml; charset=utf-8" }).end(
          `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><soap:Fault><soap:Code><soap:Value>soap:Receiver</soap:Value></soap:Code><soap:Reason><soap:Text xml:lang="pt-BR">Falha no processamento da mensagem</soap:Text></soap:Reason></soap:Fault></soap:Body></soap:Envelope>`,
        );
        return;
      }
      const resposta = responder(servico, dados);
      const enviar = () => {
        if (resposta === null) res.writeHead(404).end();
        else res.writeHead(200, { "Content-Type": "application/soap+xml; charset=utf-8" }).end(resposta);
      };
      if (estado.atrasoMs > 0) setTimeout(enviar, estado.atrasoMs);
      else enviar();
    });
  });

  await new Promise<void>((resolve) => servidor.listen(0, "127.0.0.1", resolve));
  estado.url = `https://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  estado.fechar = () =>
    new Promise<void>((resolve) => {
      servidor.closeAllConnections();
      servidor.close(() => resolve());
    });
  return estado;
}

/** Impressão digital (SHA-256, hexadecimal) de um certificado em PEM, como o servidor de mentira a registra. */
export const impressaoDigital = (certificadoPem: string) => createHash("sha256").update(new X509Certificate(certificadoPem).raw).digest("hex");
