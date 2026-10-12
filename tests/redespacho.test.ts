import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getServerSession } from "next-auth";
import { createCollectionSchema, updateCollectionSchema } from "../src/lib/coletas";
import type { ConferenciaDoCte, ResultadoDaEmissao } from "../src/lib/cte";
import { ALVO_DO_CTE, assinarXml } from "../src/lib/cte/assinar";
import { lerCertificado } from "../src/lib/cte/certificado";
import { chaveDoCte } from "../src/lib/cte/chave";
import { chavesDeNfeDaEntrega } from "../src/lib/cte/eventos";
import { CFOP_DA_MESMA_NATUREZA, cfopDaPrestacao, montarCte, type DadosDoCte } from "../src/lib/cte/montar";
import {
  AVISO_DA_CHAVE_SEM_USO,
  AVISO_DAS_NOTAS_NO_INTERMEDIARIO,
  AVISO_DO_ICMS_NA_SUBCONTRATACAO,
  AVISO_DOS_MUNICIPIOS_NA_SUBCONTRATACAO,
  AVISO_DO_TOMADOR_TRANSPORTADORA,
  CTE_ANTERIOR_DE_OUTRA_EMPRESA,
  SEM_EXPEDIDOR,
  SEM_RECEBEDOR,
  avisoDoCfopDaMesmaNatureza,
  prepararCte,
  semCteAnterior,
  type CargaDoCte,
} from "../src/lib/cte/preparar";
import { usarSefazDeTeste } from "../src/lib/cte/sefaz";
import { montarMinuta, type CargaDaMinuta, type Minuta } from "../src/lib/minuta";
import { municipioDoTexto } from "../src/lib/municipios";
import { NOME_EM_HOMOLOGACAO } from "../src/lib/cte";
import {
  CHAVE_DO_CTE_ANTERIOR_MESSAGE,
  CHAVE_NAO_E_DE_CTE,
  ROTULO_DO_SERVICO,
  SEM_REDESPACHO,
  TIPOS_DE_SERVICO,
  TP_SERV,
  emissorDaChave,
  enderecoDaParte,
  problemaDaChaveDoCteAnterior,
  servicoDaCarga,
  temRedespacho,
  tipoDeServico,
  type ParteInformada,
  type RedespachoDaCarga,
  type ServicoDaCarga,
} from "../src/lib/redespacho";
import {
  CENARIOS_DO_CTE,
  CHAVE_DO_CTE_ANTERIOR,
  CONTRATANTE,
  EMITENTE,
  EXPEDIDOR,
  RECEBEDOR,
  REMETENTE,
  certificadoDeTeste,
  chaveDeNfe,
  errosNoEsquema,
  nfeDeExemplo,
  subirSefazDeMentira,
  type CertificadoDeTeste,
  type SefazDeMentira,
} from "./cte-apoio";
import { EMPRESA_OUTRA, EMPRESA_PADRAO } from "./empresas-de-teste";

/**
 * Redespacho, subcontratação e redespacho intermediário no CT-e: as regras
 * (funções puras, com o XML validado no esquema oficial do pacote 4.00) e,
 * com banco, o caminho pelas rotas: gravar na carga, conferir, emitir e
 * imprimir a minuta.
 *
 * NENHUM teste fala com a SEFAZ: a emissão conversa com o servidor HTTPS local
 * de tests/cte-apoio.ts, e o certificado é autoassinado.
 */
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

const temBanco = Boolean(process.env.DATABASE_URL);
if (!temBanco) {
  console.warn("\n[redespacho.test] DATABASE_URL ausente: testes de integração PULADOS.\n");
}
const suite = temBanco ? describe : describe.skip;

const AGORA = new Date("2026-10-12T15:00:00.000Z");
const QR = "https://homologacao.nfe.fazenda.sp.gov.br/CTeConsulta/qrCode";
/** Um CT-e de outra transportadora, que não é o cliente pagador. */
const CHAVE_DE_OUTRA_EMPRESA = chaveDoCte({ uf: "SP", emissao: AGORA, cnpj: RECEBEDOR.documento, serie: 1, numero: 77, codigo: "12345678", tipoDeEmissao: "1" });
/** Um CT-e de outra filial da contratante (mesmo CNPJ base, outro estabelecimento), no PR. */
const CHAVE_DE_OUTRA_FILIAL = chaveDoCte({ uf: "PR", emissao: AGORA, cnpj: "99000503000205", serie: 1, numero: 78, codigo: "12345678", tipoDeEmissao: "1" });

const parte = (de: typeof EXPEDIDOR, cidade: string): ParteInformada => ({
  nome: de.nome,
  documento: de.documento,
  ie: de.ie ?? null,
  logradouro: de.endereco.logradouro,
  numero: de.endereco.numero,
  bairro: de.endereco.bairro,
  cidade,
  cep: de.endereco.cep ?? null,
});
const DO_EXPEDIDOR = parte(EXPEDIDOR, "São José do Rio Preto - SP");
const DO_RECEBEDOR = parte(RECEBEDOR, "Belo Horizonte - MG");

/* --------------------------------- As regras ---------------------------------- */

describe("redespacho: tipo de serviço, chave do CT-e anterior e campos da carga", () => {
  it("os códigos do tpServ são os do MOC (0 a 3), e o que a carga não diz é serviço normal", () => {
    expect(TIPOS_DE_SERVICO.map((tipo) => [tipo, TP_SERV[tipo], ROTULO_DO_SERVICO[tipo]])).toEqual([
      ["NORMAL", "0", "Normal"],
      ["SUBCONTRACT", "1", "Subcontratação"],
      ["REDISPATCH", "2", "Redespacho"],
      ["INTERMEDIATE", "3", "Redespacho intermediário"],
    ]);
    expect(tipoDeServico("REDISPATCH")).toBe("REDISPATCH");
    for (const valor of [null, undefined, "", "MULTIMODAL", "normal"]) expect(tipoDeServico(valor)).toBe("NORMAL");
  });

  it("a chave do CT-e anterior: 44 posições, dígito verificador, modelo 57, e UF, data, CNPJ e número que existem (regra G065)", () => {
    expect(problemaDaChaveDoCteAnterior(CHAVE_DO_CTE_ANTERIOR, AGORA)).toBeNull();
    expect(emissorDaChave(CHAVE_DO_CTE_ANTERIOR)).toEqual({ cnpj: CONTRATANTE.documento, uf: "SP" });
    expect(emissorDaChave(CHAVE_DE_OUTRA_FILIAL)).toEqual({ cnpj: "99000503000205", uf: "PR" });
    // Curta, e com o dígito trocado.
    expect(problemaDaChaveDoCteAnterior("3526109900050300012457001000000321112345678", AGORA)).toBe(CHAVE_DO_CTE_ANTERIOR_MESSAGE);
    expect(problemaDaChaveDoCteAnterior(`${CHAVE_DO_CTE_ANTERIOR.slice(0, 43)}0`, AGORA)).toBe(CHAVE_DO_CTE_ANTERIOR_MESSAGE);
    // A chave de uma NF-e (modelo 55) não é documento de transporte anterior.
    expect(problemaDaChaveDoCteAnterior(chaveDeNfe(1234), AGORA)).toBe(CHAVE_NAO_E_DE_CTE);
    // Antes de existir CT-e, do ano que vem, e com mês 13: o dígito confere, a chave não existe.
    const comData = (aamm: string) => {
      const corpo = `35${aamm}${CHAVE_DO_CTE_ANTERIOR.slice(6, 43)}`;
      let soma = 0;
      for (let i = 0; i < corpo.length; i += 1) soma += (corpo.charCodeAt(corpo.length - 1 - i) - 48) * (2 + (i % 8));
      return `${corpo}${soma % 11 < 2 ? 0 : 11 - (soma % 11)}`;
    };
    expect(problemaDaChaveDoCteAnterior(comData("2610"), AGORA)).toBeNull();
    for (const aamm of ["0812", "2701", "2613", "2600"]) expect(problemaDaChaveDoCteAnterior(comData(aamm), AGORA), aamm).toContain("UF, data, CNPJ ou número que não existem");
  });

  it("os schemas da carga limpam a chave, o documento, a IE e o CEP; vazio apaga; o que não vale é recusado com a frase", () => {
    const BASE = { clientId: "c1", sender: "Remetente", receiver: "Destinatário", origin: "Mirassol - SP", destination: "Bauru - SP", volumes: "1", weight: "10" };
    const lido = createCollectionSchema.parse({
      ...BASE,
      serviceType: "REDISPATCH",
      previousCteKey: "3526 1099 0005 0300 0124 5700 1000 0003 2111 2345 6785",
      shipperName: "  Centro de Distribuição  ",
      shipperDocument: "99.000.903/0001-30",
      shipperIe: "222.333.444.555",
      shipperCity: "Santos - SP",
      shipperZip: "11010-000",
      consigneeDocument: "529.982.247-25",
      consigneeIe: "isenta",
      consigneeName: "",
    });
    expect(lido).toMatchObject({
      serviceType: "REDISPATCH",
      previousCteKey: CHAVE_DO_CTE_ANTERIOR,
      shipperName: "Centro de Distribuição",
      shipperDocument: "99000903000130",
      shipperIe: "222333444555",
      shipperCity: "Santos - SP",
      shipperZip: "11010000",
      consigneeDocument: "52998224725",
      consigneeIe: "ISENTO",
      consigneeName: null,
    });
    // Sem os campos, a carga é o que sempre foi: nada de redespacho no pedido.
    expect(createCollectionSchema.parse(BASE).serviceType).toBeUndefined();

    const erro = (campos: Record<string, unknown>) => updateCollectionSchema.safeParse(campos).error?.issues[0]?.message;
    expect(erro({ serviceType: "MULTIMODAL" })).toBe("Tipo de serviço inválido.");
    expect(erro({ previousCteKey: "123" })).toBe(CHAVE_DO_CTE_ANTERIOR_MESSAGE);
    expect(erro({ previousCteKey: chaveDeNfe(1234) })).toBe(CHAVE_NAO_E_DE_CTE);
    expect(erro({ shipperDocument: "99.000.903/0001-31" })).toBe("Informe um CNPJ ou CPF válido para o expedidor e o recebedor.");
    expect(erro({ consigneeDocument: "111.111.111-11" })).toBe("Informe um CNPJ ou CPF válido para o expedidor e o recebedor.");
    expect(erro({ consigneeIe: "abc" })).toBe("A inscrição estadual precisa ter de 2 a 14 dígitos, ou ISENTO.");
    expect(erro({ shipperName: "X" })).toBe("O nome do expedidor e do recebedor precisa ter de 2 a 60 letras.");
    expect(erro({ shipperZip: "123" })).toBe("O CEP precisa ter 8 dígitos.");
    expect(updateCollectionSchema.parse({ previousCteKey: "", shipperDocument: " " })).toMatchObject({ previousCteKey: null, shipperDocument: null });
  });

  it("a leitura da carga: sem nada digitado não há expedidor nem recebedor; o endereço sai numa linha", () => {
    expect(servicoDaCarga(SEM_REDESPACHO)).toEqual({ tipo: "NORMAL", chaveDoCteAnterior: null, expedidor: null, recebedor: null });
    expect(temRedespacho(SEM_REDESPACHO)).toBe(false);
    expect(temRedespacho({ ...SEM_REDESPACHO, consigneeCity: "Bauru - SP" })).toBe(true);
    expect(temRedespacho({ ...SEM_REDESPACHO, serviceType: "SUBCONTRACT" })).toBe(true);
    const carga: RedespachoDaCarga = { ...SEM_REDESPACHO, serviceType: "INTERMEDIATE", previousCteKey: CHAVE_DO_CTE_ANTERIOR, shipperName: "Expedidor", shipperStreet: "Rua das Docas", shipperNumber: "50", shipperDistrict: "Centro", shipperCity: "Santos - SP", shipperZip: "11010000" };
    const servico = servicoDaCarga(carga);
    expect(servico).toMatchObject({ tipo: "INTERMEDIATE", chaveDoCteAnterior: CHAVE_DO_CTE_ANTERIOR, recebedor: null });
    expect(enderecoDaParte(servico.expedidor!)).toBe("Rua das Docas, 50 - Centro, Santos - SP, 11010-000");
    expect(enderecoDaParte({ ...servico.expedidor!, logradouro: null, numero: null, bairro: null, cep: null })).toBe("Santos - SP");
  });

  it("comprovante de entrega: as NF-e só são relacionadas quando o CT-e é de serviço normal (regra O10, rejeição 871)", () => {
    const notas = "<infDoc><infNFe><chave>35261099000303000171550010000012341000012341</chave></infNFe></infDoc>";
    expect(chavesDeNfeDaEntrega(`<ide><tpServ>0</tpServ></ide>${notas}`)).toEqual(["35261099000303000171550010000012341000012341"]);
    for (const tpServ of ["1", "2", "3"]) expect(chavesDeNfeDaEntrega(`<ide><tpServ>${tpServ}</tpServ></ide>${notas}`)).toEqual([]);
  });
});

/* ------------------------------ O XML do CT-e --------------------------------- */

describe("redespacho: o XML do CT-e, validado no esquema oficial (cte_v4.00.xsd)", () => {
  let lido: ReturnType<typeof lerCertificado>;
  beforeAll(() => {
    const certificado = certificadoDeTeste();
    lido = lerCertificado(certificado.pfx, certificado.senha);
  });
  const assinado = (dados: DadosDoCte) => {
    const montado = montarCte(dados);
    return { ...montado, xml: assinarXml(montado.xml, ALVO_DO_CTE, { chavePem: lido.chavePem, certificadoPem: lido.titularPem }) };
  };
  const valido = async (xml: string) => expect(await errosNoEsquema(xml, "cte_v4.00.xsd")).toEqual([]);
  const DOC_ANT = `<docAnt><emiDocAnt><CNPJ>99000503000124</CNPJ><IE>111222333444</IE><UF>SP</UF><xNome>Transportadora Contratante Ltda</xNome><idDocAnt><idDocAntEle><chCTe>${CHAVE_DO_CTE_ANTERIOR}</chCTe></idDocAntEle></idDocAnt></emiDocAnt></docAnt>`;
  const NOTAS = "<infDoc><infNFe><chave>35261099000303000171550010000012341000012341</chave></infNFe></infDoc>";

  it("subcontratação (tpServ 1): documento anterior depois das notas, tomador outro (toma4) e CFOP 6351", async () => {
    const { xml, cfop } = assinado(CENARIOS_DO_CTE["subcontratacao"]());
    await valido(xml);
    expect(xml).toContain("<tpServ>1</tpServ>");
    expect(xml).toContain(`${NOTAS}${DOC_ANT}<infModal versaoModal="4.00">`);
    expect(xml).toContain("<toma4><toma>4</toma><CNPJ>99000503000124</CNPJ><IE>111222333444</IE><xNome>Transportadora Contratante Ltda</xNome>");
    expect(cfop).toBe("6351");
    expect(xml).toContain("<CFOP>6351</CFOP>");
    expect(xml).not.toMatch(/<exped>|<receb>/);
    // O ICMS não muda com o tipo de serviço: é o da configuração do emitente.
    expect(xml).toContain("<ICMS00><CST>00</CST><vBC>850.50</vBC><pICMS>12.00</pICMS><vICMS>102.06</vICMS></ICMS00>");
  });

  it("redespacho (tpServ 2), sem e com expedidor e recebedor; o tomador que é o expedidor vai no toma3 = 1", async () => {
    const sem = assinado(CENARIOS_DO_CTE["redespacho-sem-expedidor-nem-recebedor"]());
    await valido(sem.xml);
    expect(sem.xml).toContain("<tpServ>2</tpServ>");
    expect(sem.xml).toContain(`${NOTAS}${DOC_ANT}`);
    expect(sem.xml).not.toMatch(/<exped>|<receb>/);

    const com = assinado(CENARIOS_DO_CTE["redespacho-tomador-expedidor"]());
    await valido(com.xml);
    expect(com.xml).toContain("<indIEToma>1</indIEToma><toma3><toma>1</toma></toma3>");
    // A ordem do esquema: remetente, expedidor, recebedor, destinatário. Em homologação o nome é a frase da SEFAZ (regras G003 e G004).
    expect(com.xml).toMatch(/<\/rem><exped><CNPJ>99000503000124<\/CNPJ><IE>111222333444<\/IE><xNome>CTE EMITIDO EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL<\/xNome><enderExped>.*<\/enderExped><\/exped><receb><CNPJ>99001103000133<\/CNPJ><xNome>CTE EMITIDO[^<]*<\/xNome><enderReceb>.*<\/enderReceb><\/receb><dest>/);
    expect(com.xml).toContain("<enderReceb><xLgr>Av. do Contorno</xLgr><nro>8000</nro><xBairro>Santo Agostinho</xBairro><cMun>3106200</cMun><xMun>Belo Horizonte</xMun><CEP>30110932</CEP><UF>MG</UF></enderReceb>");

    // Em produção vai o nome de verdade.
    const producao = assinado({ ...CENARIOS_DO_CTE["redespacho-tomador-expedidor"](), emitente: { ...EMITENTE, ambiente: "PRODUCAO" } });
    await valido(producao.xml);
    expect(producao.xml).toContain("<xNome>Transportes Recebedor Ltda</xNome><enderReceb>");
    expect(producao.xml).not.toContain(NOME_EM_HOMOLOGACAO);
  });

  it("redespacho intermediário (tpServ 3): sem as notas (regra G037), com expedidor e recebedor; remetente e destinatário podem faltar", async () => {
    const semPartes = assinado(CENARIOS_DO_CTE["redespacho-intermediario"]());
    await valido(semPartes.xml);
    expect(semPartes.xml).toContain("<tpServ>3</tpServ>");
    expect(semPartes.xml).not.toMatch(/<infDoc>|<rem>|<dest>/);
    expect(semPartes.xml).toContain(`</infCarga>${DOC_ANT}<infModal`);
    expect(semPartes.xml).toMatch(/<\/emit><exped>.*<\/exped><receb>.*<\/receb><vPrest>/);

    // Com remetente e destinatário, e as notas na carga: as partes vão, as notas não. Sem IE no emissor, a UF também não vai.
    const comPartes = assinado(CENARIOS_DO_CTE["redespacho-intermediario-com-remetente-e-destinatario"]());
    await valido(comPartes.xml);
    expect(comPartes.xml).not.toContain("<infDoc>");
    expect(comPartes.xml).toMatch(/<rem>.*<\/rem><exped>.*<\/exped><receb>.*<\/receb><dest>.*<\/dest>/);
    expect(comPartes.xml).toContain(`<emiDocAnt><CNPJ>99000503000124</CNPJ><xNome>Transportadora Contratante Ltda</xNome><idDocAnt>`);
  });

  it("serviço normal: expedidor e recebedor são opcionais e não mudam o resto; o tomador pode ser o recebedor (toma3 = 2)", async () => {
    const normal = assinado(CENARIOS_DO_CTE["normal-com-expedidor-e-recebedor"]());
    await valido(normal.xml);
    expect(normal.xml).toContain("<tpServ>0</tpServ>");
    expect(normal.xml).toContain("<CFOP>6353</CFOP>");
    expect(normal.xml).not.toContain("<docAnt>");
    expect(normal.xml).toMatch(/<exped><CNPJ>99000903000130<\/CNPJ><IE>222333444555<\/IE>/);
    const recebedor = assinado(CENARIOS_DO_CTE["normal-tomador-recebedor"]());
    await valido(recebedor.xml);
    expect(recebedor.xml).toContain("<toma3><toma>2</toma></toma3>");
    // O CT-e de sempre continua igual: nada de redespacho nele.
    const deSempre = assinado(CENARIOS_DO_CTE["interestadual-12-sp-mg"]()).xml;
    expect(deSempre).toContain("<tpServ>0</tpServ>");
    expect(deSempre).not.toMatch(/<exped>|<receb>|<docAnt>/);
  });

  it("CFOP: 5351 ou 6351 quando o tomador é outra transportadora; a prestação que começa em outra UF continua 5932 ou 6932 (regra G051)", () => {
    const emitente = { cfopDentro: "5353", cfopFora: "6353", uf: "SP" };
    expect(CFOP_DA_MESMA_NATUREZA).toEqual({ dentro: "5351", fora: "6351" });
    expect(cfopDaPrestacao(emitente, "SP", "SP", true)).toBe("5351");
    expect(cfopDaPrestacao(emitente, "SP", "MG", true)).toBe("6351");
    expect(cfopDaPrestacao(emitente, "MG", "MG", true)).toBe("5932");
    expect(cfopDaPrestacao(emitente, "MG", "RJ", true)).toBe("6932");
    expect(cfopDaPrestacao(emitente, "SP", "MG")).toBe("6353");
    expect(cfopDaPrestacao(emitente, "SP", "SP", false)).toBe("5353");
  });
});

/* --------------------------- Da carga ao documento ---------------------------- */

describe("redespacho: da carga aos dados do CT-e (o que a conferência exige e avisa)", () => {
  const DA_CONTRATANTE = { companyName: "Transportadora Contratante Ltda", tradeName: null, cnpj: "99.000.503/0001-24", ie: "111.222.333.444", email: null, phone: null, address: "Rodovia Washington Luís, 440 - Zona Rural, São José do Rio Preto - SP, CEP 15090-000" };

  const carga = (servico: Partial<ServicoDaCarga> | null, trocas: Partial<CargaDoCte> = {}): CargaDoCte => ({
    trackingCode: "1234567890",
    sender: "Indústria Remetente S/A",
    receiver: "Comércio Destinatário Ltda",
    origin: "São José do Rio Preto - SP",
    destination: "Belo Horizonte - MG",
    volumes: 12,
    weight: 1250.5,
    invoiceKey: null,
    invoiceValue: 32500.9,
    freightValue: 850.5,
    freightDetails: null,
    deliveryStreet: null,
    deliveryNumber: null,
    deliveryDistrict: null,
    deliveryZip: null,
    client: DA_CONTRATANTE,
    notas: [{ accessKey: "35261099000303000171550010000012341000012341", xml: nfeDeExemplo() }],
    destinatarios: [],
    viagem: null,
    servico: servico && { tipo: "NORMAL", chaveDoCteAnterior: null, expedidor: null, recebedor: null, ...servico },
    ...trocas,
  });
  const preparar = (c: CargaDoCte) => prepararCte(c, EMITENTE, QR, municipioDoTexto, AGORA);

  it("subcontratação: o cliente pagador é o tomador e o emissor do CT-e anterior; CFOP 6351; avisa do ICMS e dos municípios", () => {
    const preparo = preparar(carga({ tipo: "SUBCONTRACT", chaveDoCteAnterior: CHAVE_DO_CTE_ANTERIOR }));
    expect(preparo.pendencias).toEqual([]);
    const dados = preparo.dados!;
    expect(dados.servico).toEqual({ tipo: "SUBCONTRACT", anterior: { cnpj: "99000503000124", ie: "111222333444", uf: "SP", nome: "Transportadora Contratante Ltda", chave: CHAVE_DO_CTE_ANTERIOR } });
    expect(dados.tomador).toMatchObject({ papel: "OUTRO", participante: { documento: "99000503000124", ie: "111222333444" } });
    expect(dados.contribuinte).toBe("1");
    // As notas continuam no documento (regra G036), e o início e o fim são a origem e o destino da carga.
    expect(dados.chavesDeNfe).toEqual(["35261099000303000171550010000012341000012341"]);
    expect(dados.inicio.codigoMunicipio).toBe("3549805");
    expect(dados.fim.codigoMunicipio).toBe("3106200");
    expect(preparo.resumo).toMatchObject({
      cfop: "6351",
      servico: { tipo: "SUBCONTRACT", chaveDoCteAnterior: CHAVE_DO_CTE_ANTERIOR, emissorDoAnterior: "Transportadora Contratante Ltda · 99.000.503/0001-24" },
      expedidor: null,
      recebedor: null,
      tomador: { papel: "OUTRO", documento: "99.000.503/0001-24", contribuinte: "1" },
      // O ICMS é o da configuração do emitente: o sistema não decide diferimento.
      icms: { situacao: "00", grupo: "ICMS00", aliquota: 12, valor: 102.06 },
    });
    expect(preparo.avisos).toEqual(expect.arrayContaining([AVISO_DO_ICMS_NA_SUBCONTRATACAO, AVISO_DOS_MUNICIPIOS_NA_SUBCONTRATACAO, avisoDoCfopDaMesmaNatureza("6351")]));
    expect(AVISO_DO_ICMS_NA_SUBCONTRATACAO).toContain("confirme com o contador se o ICMS é devido por você ou pela contratante");
  });

  it("fora do serviço normal a chave do CT-e anterior é obrigatória, tem de valer e tem de ser de um CT-e do cliente pagador", () => {
    for (const tipo of ["SUBCONTRACT", "REDISPATCH", "INTERMEDIATE"] as const) {
      const semChave = preparar(carga({ tipo, expedidor: DO_EXPEDIDOR, recebedor: DO_RECEBEDOR }));
      expect(semChave.dados, tipo).toBeNull();
      expect(semChave.pendencias, tipo).toEqual([semCteAnterior(tipo)]);
      expect(semChave.resumo?.servico).toEqual({ tipo, chaveDoCteAnterior: null, emissorDoAnterior: null });
    }
    expect(semCteAnterior("REDISPATCH")).toContain("CT-e de redespacho exige a chave do CT-e anterior");
    expect(preparar(carga({ tipo: "REDISPATCH", chaveDoCteAnterior: chaveDeNfe(1234) })).pendencias).toEqual([CHAVE_NAO_E_DE_CTE]);
    // Regras G062 e G063: quem emitiu o CT-e anterior é o tomador.
    const deOutra = preparar(carga({ tipo: "REDISPATCH", chaveDoCteAnterior: CHAVE_DE_OUTRA_EMPRESA }));
    expect(deOutra.pendencias).toEqual([CTE_ANTERIOR_DE_OUTRA_EMPRESA]);
    expect(deOutra.resumo?.servico.emissorDoAnterior).toBeNull();
    // Outra filial da contratante (mesmo CNPJ base): vale, com o CNPJ e a UF da chave e sem a IE, que é a do estabelecimento do cadastro.
    const filial = preparar(carga({ tipo: "REDISPATCH", chaveDoCteAnterior: CHAVE_DE_OUTRA_FILIAL }));
    expect(filial.pendencias).toEqual([]);
    expect(filial.dados?.servico?.anterior).toEqual({ cnpj: "99000503000205", ie: null, uf: "PR", nome: "Transportadora Contratante Ltda", chave: CHAVE_DE_OUTRA_FILIAL });
    // Cliente isento de inscrição: o emissor vai sem IE e sem UF (o tipo do campo só aceita dígitos).
    const isento = preparar(carga({ tipo: "REDISPATCH", chaveDoCteAnterior: CHAVE_DO_CTE_ANTERIOR }, { client: { ...DA_CONTRATANTE, ie: "ISENTO" } }));
    expect(isento.dados?.servico?.anterior?.ie).toBeNull();
  });

  it("serviço normal não leva documento anterior: a chave esquecida na carga vira aviso; e o tomador que pode ser transportadora, também (regra G064)", () => {
    const normal = preparar(carga({ chaveDoCteAnterior: CHAVE_DO_CTE_ANTERIOR }));
    expect(normal.pendencias).toEqual([]);
    expect(normal.dados?.servico).toEqual({ tipo: "NORMAL" });
    expect(normal.resumo?.cfop).toBe("6353");
    expect(normal.avisos).toEqual(expect.arrayContaining([AVISO_DA_CHAVE_SEM_USO, AVISO_DO_TOMADOR_TRANSPORTADORA]));
    // A carga de sempre (sem os campos novos) não ganha aviso nenhum de redespacho.
    const deSempre = preparar(carga(null, { client: { companyName: "Indústria Remetente S/A", tradeName: "Remetente", cnpj: "99000303000171", ie: "110042490114", email: null, phone: null, address: null } }));
    expect(deSempre.pendencias).toEqual([]);
    expect(deSempre.dados).toMatchObject({ servico: { tipo: "NORMAL" }, expedidor: null, recebedor: null, tomador: { papel: "REMETENTE" } });
    expect(deSempre.avisos.join(" ")).not.toMatch(/subcontrata|redespacho|CT-e anterior|mesma natureza|rejeita o serviço normal/i);
  });

  it("expedidor e recebedor: opcionais, mas completos; o cliente pagador que é o expedidor (ou o recebedor) é o tomador nesse papel", () => {
    const comOsDois = preparar(carga({ tipo: "REDISPATCH", chaveDoCteAnterior: CHAVE_DO_CTE_ANTERIOR, expedidor: parte(CONTRATANTE, "São José do Rio Preto - SP"), recebedor: DO_RECEBEDOR }));
    expect(comOsDois.pendencias).toEqual([]);
    expect(comOsDois.dados?.tomador).toEqual({ papel: "EXPEDIDOR" });
    expect(comOsDois.dados?.expedidor).toMatchObject({ documento: "99000503000124", ie: "111222333444", endereco: { codigoMunicipio: "3549805", municipio: "São José do Rio Preto", uf: "SP", cep: "15090000" } });
    expect(comOsDois.dados?.recebedor).toMatchObject({ documento: "99001103000133", ie: null, endereco: { codigoMunicipio: "3106200", uf: "MG" } });
    expect(comOsDois.resumo).toMatchObject({ tomador: { papel: "EXPEDIDOR" }, expedidor: { nome: "Transportadora Contratante Ltda", documento: "99.000.503/0001-24" }, recebedor: { documento: "99.001.103/0001-33" } });

    const tomadorRecebedor = preparar(carga({ tipo: "REDISPATCH", chaveDoCteAnterior: CHAVE_DO_CTE_ANTERIOR, recebedor: parte(CONTRATANTE, "São José do Rio Preto - SP") }));
    expect(tomadorRecebedor.dados?.tomador).toEqual({ papel: "RECEBEDOR" });
    // O recebedor fica noutra cidade que o destino da carga: o fim da prestação continua o destino, com aviso.
    expect(tomadorRecebedor.dados?.fim.codigoMunicipio).toBe("3106200");
    expect(tomadorRecebedor.avisos.join(" ")).toContain("O recebedor fica em São José do Rio Preto - SP, e o fim da prestação no CT-e é o destino da carga (Belo Horizonte - MG)");

    // Pela metade: diz o que falta. Cidade fora da tabela do IBGE não serve de endereço.
    const incompleto = preparar(carga({ expedidor: { ...DO_EXPEDIDOR, documento: null, cidade: "Lugar Nenhum" } }));
    expect(incompleto.dados).toBeNull();
    expect(incompleto.pendencias).toHaveLength(1);
    expect(incompleto.pendencias[0]).toContain("O expedidor da carga está incompleto: falta o CNPJ/CPF, o endereço");
    expect(preparar(carga({ recebedor: { ...DO_RECEBEDOR, nome: null } })).pendencias[0]).toContain("O recebedor da carga está incompleto: falta o nome.");
  });

  it("redespacho intermediário: exige expedidor e recebedor, as notas não vão, e remetente e destinatário podem faltar", async () => {
    const semOsDois = preparar(carga({ tipo: "INTERMEDIATE", chaveDoCteAnterior: CHAVE_DO_CTE_ANTERIOR }));
    expect(semOsDois.dados).toBeNull();
    expect(semOsDois.pendencias).toEqual([SEM_EXPEDIDOR, SEM_RECEBEDOR]);

    const completo = preparar(carga({ tipo: "INTERMEDIATE", chaveDoCteAnterior: CHAVE_DO_CTE_ANTERIOR, expedidor: DO_EXPEDIDOR, recebedor: DO_RECEBEDOR }));
    expect(completo.pendencias).toEqual([]);
    expect(completo.dados?.chavesDeNfe).toEqual([]);
    expect(completo.resumo?.chavesDeNfe).toEqual([]);
    expect(completo.avisos).toContain(AVISO_DAS_NOTAS_NO_INTERMEDIARIO);
    expect(completo.dados?.remetente?.documento).toBe("99000303000171");

    // Sem NF-e e interestadual: no serviço normal seria pendência (813); aqui não há notas no documento, nem remetente e destinatário conhecidos.
    const semNota = preparar(carga({ tipo: "INTERMEDIATE", chaveDoCteAnterior: CHAVE_DO_CTE_ANTERIOR, expedidor: DO_EXPEDIDOR, recebedor: DO_RECEBEDOR }, { notas: [], sender: "Alguém", receiver: "Outro alguém" }));
    expect(semNota.pendencias).toEqual([]);
    expect(semNota.dados).toMatchObject({ remetente: null, destinatario: null, tomador: { papel: "OUTRO" }, servico: { tipo: "INTERMEDIATE" } });
    expect(preparar(carga({ tipo: "REDISPATCH", chaveDoCteAnterior: CHAVE_DO_CTE_ANTERIOR }, { notas: [], sender: "Alguém", receiver: "Outro alguém" })).pendencias).toHaveLength(3);

    // E o que sai daqui monta um CT-e válido no esquema.
    const certificado = certificadoDeTeste();
    const lido = lerCertificado(certificado.pfx, certificado.senha);
    for (const preparo of [completo, semNota]) {
      const montado = montarCte({ ...preparo.dados!, numero: 9, codigo: "12345678", emissao: AGORA });
      const xml = assinarXml(montado.xml, ALVO_DO_CTE, { chavePem: lido.chavePem, certificadoPem: lido.titularPem });
      expect(await errosNoEsquema(xml, "cte_v4.00.xsd")).toEqual([]);
      expect(xml).toContain("<tpServ>3</tpServ>");
      expect(xml).not.toContain("<infDoc>");
    }
  });
});

/* ---------------------------------- A minuta ---------------------------------- */

describe("redespacho: a minuta de despacho", () => {
  const base: CargaDaMinuta = {
    ...SEM_REDESPACHO,
    id: "c1",
    trackingCode: "1234567890",
    sender: "Serilon Brasil",
    receiver: "Mercado Bom Preço",
    origin: "São José do Rio Preto - SP",
    destination: "Mirassol - SP",
    volumes: 3,
    weight: 120.5,
    cubicMeters: null,
    invoiceKey: null,
    invoiceValue: null,
    freightValue: null,
    freightManual: false,
    freightDetails: null,
    pickupNotes: null,
    deliveryStreet: null,
    deliveryNumber: null,
    deliveryDistrict: null,
    deliveryZip: null,
    cteKey: null,
    cteNumber: null,
    cteStatus: "PENDING",
    client: { companyName: "Transportadora Contratante Ltda", tradeName: null, cnpj: "99000503000124", address: null, paymentCondition: null },
    driver: null,
    manifest: null,
    fiscalDocuments: [],
  };
  const montar = (trocas: Partial<CargaDaMinuta>): Minuta => montarMinuta({ ...base, ...trocas }, { name: "Transportes Avila", logo: null }, { verFrete: true, agora: AGORA });

  it("serviço normal sem nada: a minuta não ganha seção nenhuma", () => {
    expect(montar({})).toMatchObject({ servico: null, expedidor: null, recebedor: null });
  });

  it("mostra o tipo de serviço, a chave do CT-e anterior, o expedidor e o recebedor que a carga tem", () => {
    const minuta = montar({
      serviceType: "REDISPATCH",
      previousCteKey: CHAVE_DO_CTE_ANTERIOR,
      shipperName: "Centro de Distribuição Expedidor Ltda",
      shipperDocument: "99000903000130",
      shipperStreet: "Rua das Docas",
      shipperNumber: "50",
      shipperDistrict: "Distrito Industrial",
      shipperCity: "São José do Rio Preto - SP",
      shipperZip: "15035100",
      consigneeName: "Transportes Recebedor Ltda",
    });
    expect(minuta.servico).toEqual({ rotulo: "Redespacho", chaveDoCteAnterior: CHAVE_DO_CTE_ANTERIOR });
    expect(minuta.expedidor).toEqual({ nome: "Centro de Distribuição Expedidor Ltda", documento: "99000903000130", endereco: "Rua das Docas, 50 - Distrito Industrial, São José do Rio Preto - SP, 15035-100" });
    expect(minuta.recebedor).toEqual({ nome: "Transportes Recebedor Ltda", documento: null, endereco: null });
    // Expedidor num serviço normal também aparece; sem nome, não há quem mostrar.
    expect(montar({ shipperName: "Só o expedidor" })).toMatchObject({ servico: null, expedidor: { nome: "Só o expedidor" }, recebedor: null });
    expect(montar({ shipperCity: "Santos - SP" }).expedidor).toBeNull();
  });
});

/* ------------------------------ Rotas, com banco ------------------------------ */

const PREFIXO = "teste-redespacho-";
const HASH_FALSO = "$2b$10$hashfalsoparateste000000000000000000000000000000000";
const SENHA = "senha-secreta-do-certificado-REDESPACHO";
const CNPJ_DA_PADRAO = "99000108000141";

type Perfil = "ADMIN" | "OPERATION" | "EXPEDITION" | "ADMIN_DA_OUTRA";
type Corpo = Record<string, unknown> & { error?: string };

const FORMULARIO = {
  cnpj: "99.000.108/0001-41",
  ie: "123456789012",
  razaoSocial: `${PREFIXO}Transportadora Ltda`,
  fantasia: "Trans Teste",
  logradouro: "Rua das Flores",
  numero: "120",
  complemento: "",
  bairro: "Centro",
  cidade: "mirassol",
  uf: "SP",
  cep: "15130-000",
  telefone: "(17) 3242-1000",
  contato: "Maria da Silva",
  email: "fiscal@transteste.example",
  rntrc: "12345678",
  regime: "3",
  serie: "1",
  proximoNumero: "700",
  ambiente: "HOMOLOGACAO",
  cfopDentro: "5353",
  cfopFora: "6353",
  icms: "00",
  aliquota: "12",
  ibsCbsCst: "000",
  ibsCbsClasse: "000001",
};

suite("redespacho: rotas da carga, da conferência, da emissão e da minuta", () => {
  let banco: typeof import("../src/lib/prisma");
  let fiscalRota: typeof import("../src/app/api/empresa/fiscal/route");
  let certificadoRota: typeof import("../src/app/api/empresa/fiscal/certificado/route");
  let coletasRota: typeof import("../src/app/api/coletas/route");
  let coletaRota: typeof import("../src/app/api/coletas/[id]/route");
  let minutaRota: typeof import("../src/app/api/coletas/[id]/minuta/route");
  let emissaoRota: typeof import("../src/app/api/fiscal/cte/emissao/route");

  const sessao = vi.mocked(getServerSession);
  const ids = {} as Record<Perfil, string>;
  let contratanteId: string;
  let sefaz: SefazDeMentira;
  let certificado: CertificadoDeTeste;
  let sequencia = 0;

  const DAS_EMPRESAS = { tenantId: { in: [EMPRESA_PADRAO.id, EMPRESA_OUTRA.id] } };
  const DAS_CARGAS = { client: { companyName: { startsWith: PREFIXO } } };

  const entrarComo = (perfil: Perfil | null) =>
    sessao.mockResolvedValue(perfil ? { user: { id: ids[perfil], role: perfil === "ADMIN_DA_OUTRA" ? "ADMIN" : perfil, clientId: null, ...(perfil === "ADMIN_DA_OUTRA" && { tenantId: EMPRESA_OUTRA.id }) } } : null);

  const req = (method = "GET", body?: unknown, url = "http://localhost/api/teste") =>
    new Request(url, { method, headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.9" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const lida = async <T = Corpo>(res: Response): Promise<{ status: number; corpo: T }> => ({ status: res.status, corpo: (await res.json()) as T });

  const criar = async (campos: Record<string, unknown> = {}, perfil: Perfil = "OPERATION") => {
    entrarComo(perfil);
    return lida<Corpo & RedespachoDaCarga & { id: string }>(
      await coletasRota.POST(req("POST", { clientId: contratanteId, sender: "Indústria Remetente S/A", receiver: "Comércio Destinatário Ltda", origin: "São José do Rio Preto - SP", destination: "Belo Horizonte - MG", volumes: "12", weight: "1250,5", invoiceValue: "32500.90", ...campos })),
    );
  };
  const alterar = async (id: string, campos: Record<string, unknown>, perfil: Perfil = "OPERATION") => {
    entrarComo(perfil);
    return lida<Corpo & RedespachoDaCarga>(await coletaRota.PATCH(req("PATCH", campos), ctx(id)));
  };
  const conferir = async (collectionId: string, perfil: Perfil = "OPERATION") => {
    entrarComo(perfil);
    return lida<ConferenciaDoCte & Corpo>(await emissaoRota.GET(req("GET", undefined, `http://localhost/api/fiscal/cte/emissao?collectionId=${collectionId}`)));
  };
  const emitir = async (collectionId: string, perfil: Perfil = "OPERATION") => {
    entrarComo(perfil);
    return lida<ResultadoDaEmissao & Corpo>(await emissaoRota.POST(req("POST", { collectionId })));
  };
  const minuta = async (id: string, perfil: Perfil = "OPERATION") => {
    entrarComo(perfil);
    return lida<Minuta & Corpo>(await minutaRota.GET(req(), ctx(id)));
  };
  const ler = (id: string) => banco.sistema.collection.findUniqueOrThrow({ where: { id } });

  /** A carga pronta para o CT-e: com o frete, a NF-e importada e ligada, e em rota (como fica depois da viagem). */
  async function prontaParaOCte(id: string) {
    const numero = 7000 + (sequencia += 1);
    await banco.sistema.collection.update({ where: { id }, data: { status: "ROUTE", freightValue: 850.5, invoiceKey: chaveDeNfe(numero) } });
    await banco.default.fiscalDocument.create({
      data: { accessKey: chaveDeNfe(numero), number: numero, series: 1, issuerTaxId: REMETENTE.documento, issuerName: "Indústria Remetente S/A", totalValue: 32500.9, xml: nfeDeExemplo({ numero }), collectionId: id },
      select: { id: true },
    });
  }

  async function limparMovimento() {
    const { sistema } = banco;
    await sistema.outboxEvent.deleteMany({ where: DAS_EMPRESAS });
    await sistema.cteEvent.deleteMany({ where: DAS_EMPRESAS });
    await sistema.cte.deleteMany({ where: DAS_EMPRESAS });
    await sistema.cteNumbering.deleteMany({ where: DAS_EMPRESAS });
    await sistema.fiscalIssuer.deleteMany({ where: DAS_EMPRESAS });
    await sistema.fiscalDocument.deleteMany({ where: { collection: DAS_CARGAS } });
    await sistema.collection.deleteMany({ where: DAS_CARGAS });
    await sistema.notification.deleteMany({ where: { user: { email: { startsWith: PREFIXO } } } });
    await sistema.auditLog.deleteMany({ where: { ...DAS_EMPRESAS, userName: { startsWith: PREFIXO } } });
  }

  async function limpar() {
    await limparMovimento();
    await banco.sistema.user.deleteMany({ where: { email: { startsWith: PREFIXO } } });
    await banco.sistema.client.deleteMany({ where: { companyName: { startsWith: PREFIXO } } });
  }

  const anteriores = { chave: process.env.TMS_CHAVE_DE_DADOS, url: process.env.NEXTAUTH_URL, fiscal: process.env.FISCAL_MCP_URL };
  const restaurar = (nome: string, valor: string | undefined) => {
    if (valor === undefined) delete process.env[nome];
    else process.env[nome] = valor;
  };

  beforeAll(async () => {
    sefaz = await subirSefazDeMentira();
    usarSefazDeTeste({ url: sefaz.url, autoridades: sefaz.autoridades, tempoLimiteMs: 1500 });
    certificado = certificadoDeTeste({ cnpj: CNPJ_DA_PADRAO, senha: SENHA });
    delete process.env.FISCAL_MCP_URL;
    process.env.TMS_CHAVE_DE_DADOS = "chave-de-dados-dos-testes-de-redespacho-0123456789";
    process.env.NEXTAUTH_URL = "https://tms.exemplo.br";

    banco = await import("../src/lib/prisma");
    fiscalRota = await import("../src/app/api/empresa/fiscal/route");
    certificadoRota = await import("../src/app/api/empresa/fiscal/certificado/route");
    coletasRota = await import("../src/app/api/coletas/route");
    coletaRota = await import("../src/app/api/coletas/[id]/route");
    minutaRota = await import("../src/app/api/coletas/[id]/minuta/route");
    emissaoRota = await import("../src/app/api/fiscal/cte/emissao/route");
    await limpar();

    const outra = banco.paraEmpresa(EMPRESA_OUTRA.id).db;
    // Quem contrata é um CLIENTE: a transportadora que emitiu o CT-e anterior e paga o frete.
    contratanteId = (
      await banco.default.client.create({
        data: { companyName: `${PREFIXO}Transportadora Contratante Ltda`, cnpj: CONTRATANTE.documento, ie: "111222333444", address: "Rodovia Washington Luís, 440 - Zona Rural, São José do Rio Preto - SP, CEP 15090-000" },
      })
    ).id;
    for (const perfil of ["ADMIN", "OPERATION", "EXPEDITION"] as const) {
      ids[perfil] = (await banco.default.user.create({ data: { name: `${PREFIXO}${perfil}`, email: `${PREFIXO}${perfil.toLowerCase()}@exemplo.br`, password: HASH_FALSO, role: perfil } })).id;
    }
    ids.ADMIN_DA_OUTRA = (await outra.user.create({ data: { name: `${PREFIXO}admin-da-outra`, email: `${PREFIXO}admin-da-outra@exemplo.br`, password: HASH_FALSO, role: "ADMIN" } })).id;
  }, 180_000);

  beforeEach(async () => {
    sessao.mockReset();
    sefaz.modo = "autorizar";
    sefaz.chamadas.length = 0;
    await limparMovimento();
    entrarComo("ADMIN");
    expect((await fiscalRota.PUT(req("PUT", FORMULARIO))).status).toBe(200);
    expect((await certificadoRota.PUT(req("PUT", { arquivo: certificado.pfx.toString("base64"), senha: certificado.senha }))).status).toBe(200);
  });

  afterAll(async () => {
    usarSefazDeTeste(null);
    if (banco) await limpar();
    restaurar("TMS_CHAVE_DE_DADOS", anteriores.chave);
    restaurar("NEXTAUTH_URL", anteriores.url);
    restaurar("FISCAL_MCP_URL", anteriores.fiscal);
    await sefaz.fechar();
  });

  it("a carga nasce como serviço normal; os campos de redespacho são gravados limpos, alterados e apagados, e entram na auditoria", async () => {
    const normal = await criar();
    expect(normal.status, normal.corpo.error).toBe(201);
    expect(normal.corpo).toMatchObject(SEM_REDESPACHO);

    const criada = await criar({
      serviceType: "REDISPATCH",
      previousCteKey: "3526 1099 0005 0300 0124 5700 1000 0003 2111 2345 6785",
      shipperName: "Centro de Distribuição Expedidor Ltda",
      shipperDocument: "99.000.903/0001-30",
      shipperIe: "222.333.444.555",
      shipperStreet: "Rua das Docas",
      shipperNumber: "50",
      shipperDistrict: "Distrito Industrial",
      shipperCity: "São José do Rio Preto - SP",
      shipperZip: "15035-100",
    });
    expect(criada.status, criada.corpo.error).toBe(201);
    expect(await ler(criada.corpo.id)).toMatchObject({ serviceType: "REDISPATCH", previousCteKey: CHAVE_DO_CTE_ANTERIOR, shipperDocument: "99000903000130", shipperIe: "222333444555", shipperZip: "15035100", consigneeName: null });

    const alterada = await alterar(criada.corpo.id, { serviceType: "INTERMEDIATE", shipperIe: "", consigneeName: "Transportes Recebedor Ltda", consigneeDocument: "99.001.103/0001-33" });
    expect(alterada.status, alterada.corpo.error).toBe(200);
    expect(alterada.corpo).toMatchObject({ serviceType: "INTERMEDIATE", previousCteKey: CHAVE_DO_CTE_ANTERIOR, shipperIe: null, shipperName: "Centro de Distribuição Expedidor Ltda", consigneeDocument: "99001103000133" });
    const [registro] = await banco.sistema.auditLog.findMany({ where: { action: "coleta.alterar", entityId: criada.corpo.id } });
    expect(registro.before).toMatchObject({ serviceType: "REDISPATCH", consigneeName: null });
    expect(registro.after).toMatchObject({ serviceType: "INTERMEDIATE", consigneeName: "Transportes Recebedor Ltda" });
  });

  it("validação (400) e permissão: chave que não é de CT-e, documento errado e tipo desconhecido não são gravados; sem sessão 401, expedição 403", async () => {
    expect(await criar({ previousCteKey: chaveDeNfe(1234) })).toMatchObject({ status: 400, corpo: { error: CHAVE_NAO_E_DE_CTE } });
    expect(await criar({ previousCteKey: "123" })).toMatchObject({ status: 400, corpo: { error: CHAVE_DO_CTE_ANTERIOR_MESSAGE } });
    expect(await criar({ serviceType: "MULTIMODAL" })).toMatchObject({ status: 400, corpo: { error: "Tipo de serviço inválido." } });
    const carga = await criar();
    expect(await alterar(carga.corpo.id, { shipperDocument: "99.000.903/0001-31" })).toMatchObject({ status: 400, corpo: { error: "Informe um CNPJ ou CPF válido para o expedidor e o recebedor." } });
    expect(await ler(carga.corpo.id)).toMatchObject(SEM_REDESPACHO);

    entrarComo(null);
    expect((await coletaRota.PATCH(req("PATCH", { serviceType: "REDISPATCH" }), ctx(carga.corpo.id))).status).toBe(401);
    expect((await alterar(carga.corpo.id, { serviceType: "REDISPATCH" }, "EXPEDITION")).status).toBe(403);
    expect((await ler(carga.corpo.id)).serviceType).toBe("NORMAL");
  });

  it("a conferência lista o que falta em cada tipo, e a emissão é recusada (409) sem falar com a SEFAZ", async () => {
    const semChave = await criar({ serviceType: "SUBCONTRACT" });
    await prontaParaOCte(semChave.corpo.id);
    const conferida = await conferir(semChave.corpo.id);
    expect(conferida.status).toBe(200);
    expect(conferida.corpo.pendencias).toEqual([semCteAnterior("SUBCONTRACT")]);
    expect(conferida.corpo.resumo).toMatchObject({ servico: { tipo: "SUBCONTRACT", chaveDoCteAnterior: null, emissorDoAnterior: null }, cfop: "6351" });
    expect(await emitir(semChave.corpo.id)).toMatchObject({ status: 409, corpo: { error: semCteAnterior("SUBCONTRACT") } });

    const deOutra = await criar({ serviceType: "REDISPATCH", previousCteKey: CHAVE_DE_OUTRA_EMPRESA });
    await prontaParaOCte(deOutra.corpo.id);
    expect((await conferir(deOutra.corpo.id)).corpo.pendencias).toEqual([CTE_ANTERIOR_DE_OUTRA_EMPRESA]);

    const intermediario = await criar({ serviceType: "INTERMEDIATE", previousCteKey: CHAVE_DO_CTE_ANTERIOR, shipperName: "Expedidor pela metade" });
    await prontaParaOCte(intermediario.corpo.id);
    const pendencias = (await conferir(intermediario.corpo.id)).corpo.pendencias;
    expect(pendencias).toHaveLength(2);
    expect(pendencias[0]).toContain("O expedidor da carga está incompleto: falta o CNPJ/CPF, o endereço");
    expect(pendencias[1]).toBe(SEM_RECEBEDOR);
    expect(sefaz.chamadas).toHaveLength(0);
    expect(await banco.sistema.cte.count({ where: DAS_EMPRESAS })).toBe(0);
  });

  it("subcontratação, do começo ao fim: a conferência mostra o serviço e avisa do ICMS; o CT-e autorizado leva tpServ 1, o documento anterior e o tomador outro", async () => {
    const carga = await criar({ serviceType: "SUBCONTRACT", previousCteKey: CHAVE_DO_CTE_ANTERIOR });
    await prontaParaOCte(carga.corpo.id);

    const conferida = await conferir(carga.corpo.id);
    expect(conferida.corpo.pendencias).toEqual([]);
    expect(conferida.corpo.resumo).toMatchObject({
      numeroPrevisto: 700,
      cfop: "6351",
      servico: { tipo: "SUBCONTRACT", chaveDoCteAnterior: CHAVE_DO_CTE_ANTERIOR, emissorDoAnterior: `${PREFIXO}Transportadora Contratante Ltda · 99.000.503/0001-24` },
      tomador: { papel: "OUTRO", documento: "99.000.503/0001-24", contribuinte: "1" },
      icms: { situacao: "00", grupo: "ICMS00", aliquota: 12 },
    });
    expect(conferida.corpo.avisos).toEqual(expect.arrayContaining([AVISO_DO_ICMS_NA_SUBCONTRATACAO, avisoDoCfopDaMesmaNatureza("6351")]));

    const emitida = await emitir(carga.corpo.id);
    expect(emitida.status, emitida.corpo.error).toBe(200);
    expect(emitida.corpo).toMatchObject({ autorizado: true, cte: { situacao: "AUTHORIZED", numero: 700 } });
    const enviado = sefaz.chamadas.find((chamada) => chamada.servico === "CTeRecepcaoSincV4")!.dados;
    expect(await errosNoEsquema(enviado, "cte_v4.00.xsd")).toEqual([]);
    expect(enviado).toContain("<CFOP>6351</CFOP>");
    expect(enviado).toContain("<tpServ>1</tpServ>");
    expect(enviado).toContain(`<docAnt><emiDocAnt><CNPJ>99000503000124</CNPJ><IE>111222333444</IE><UF>SP</UF><xNome>${PREFIXO}Transportadora Contratante Ltda</xNome><idDocAnt><idDocAntEle><chCTe>${CHAVE_DO_CTE_ANTERIOR}</chCTe></idDocAntEle></idDocAnt></emiDocAnt></docAnt>`);
    expect(enviado).toContain("<indIEToma>1</indIEToma><toma4><toma>4</toma><CNPJ>99000503000124</CNPJ><IE>111222333444</IE>");
    expect(enviado).toMatch(/<infDoc><infNFe><chave>\d{44}<\/chave><\/infNFe><\/infDoc><docAnt>/);
  });

  it("redespacho intermediário, do começo ao fim: expedidor e recebedor no documento, o tomador é o expedidor, e as notas ficam de fora", async () => {
    const carga = await criar({
      serviceType: "INTERMEDIATE",
      previousCteKey: CHAVE_DO_CTE_ANTERIOR,
      shipperName: "Transportadora Contratante Ltda",
      shipperDocument: CONTRATANTE.documento,
      shipperStreet: "Rodovia Washington Luís",
      shipperNumber: "440",
      shipperDistrict: "Zona Rural",
      shipperCity: "São José do Rio Preto - SP",
      consigneeName: "Transportes Recebedor Ltda",
      consigneeDocument: RECEBEDOR.documento,
      consigneeStreet: "Av. do Contorno",
      consigneeNumber: "8000",
      consigneeDistrict: "Santo Agostinho",
      consigneeCity: "Belo Horizonte - MG",
      consigneeZip: "30110-932",
    });
    expect(carga.status, carga.corpo.error).toBe(201);
    await prontaParaOCte(carga.corpo.id);

    const conferida = await conferir(carga.corpo.id);
    expect(conferida.corpo.pendencias).toEqual([]);
    expect(conferida.corpo.resumo).toMatchObject({ servico: { tipo: "INTERMEDIATE" }, tomador: { papel: "EXPEDIDOR" }, expedidor: { documento: "99.000.503/0001-24" }, recebedor: { nome: "Transportes Recebedor Ltda" }, chavesDeNfe: [] });
    expect(conferida.corpo.avisos).toContain(AVISO_DAS_NOTAS_NO_INTERMEDIARIO);

    const emitida = await emitir(carga.corpo.id);
    expect(emitida.status, emitida.corpo.error).toBe(200);
    expect(emitida.corpo.autorizado).toBe(true);
    const enviado = sefaz.chamadas.find((chamada) => chamada.servico === "CTeRecepcaoSincV4")!.dados;
    expect(await errosNoEsquema(enviado, "cte_v4.00.xsd")).toEqual([]);
    expect(enviado).toContain("<tpServ>3</tpServ>");
    expect(enviado).toContain("<toma3><toma>1</toma></toma3>");
    expect(enviado).toMatch(/<exped><CNPJ>99000503000124<\/CNPJ><IE>111222333444<\/IE>.*<\/exped><receb><CNPJ>99001103000133<\/CNPJ>/);
    expect(enviado).not.toContain("<infDoc>");
    expect(enviado).toContain("<docAnt>");
  });

  it("a minuta de despacho mostra o tipo de serviço, o CT-e anterior, o expedidor e o recebedor", async () => {
    const carga = await criar({ serviceType: "REDISPATCH", previousCteKey: CHAVE_DO_CTE_ANTERIOR, shipperName: "Centro de Distribuição Expedidor Ltda", shipperDocument: EXPEDIDOR.documento, shipperCity: "Santos - SP" });
    const lidaDaRota = await minuta(carga.corpo.id);
    expect(lidaDaRota.status).toBe(200);
    expect(lidaDaRota.corpo).toMatchObject({
      servico: { rotulo: "Redespacho", chaveDoCteAnterior: CHAVE_DO_CTE_ANTERIOR },
      expedidor: { nome: "Centro de Distribuição Expedidor Ltda", documento: "99000903000130", endereco: "Santos - SP" },
      recebedor: null,
    });
    expect((await minuta((await criar()).corpo.id)).corpo).toMatchObject({ servico: null, expedidor: null, recebedor: null });
  });

  it("isolamento entre empresas: a outra empresa não lê, não altera, não confere e não emite a carga de redespacho desta", async () => {
    const carga = await criar({ serviceType: "SUBCONTRACT", previousCteKey: CHAVE_DO_CTE_ANTERIOR });
    await prontaParaOCte(carga.corpo.id);
    const id = carga.corpo.id;

    expect((await alterar(id, { serviceType: "NORMAL", previousCteKey: "" }, "ADMIN_DA_OUTRA")).status).toBe(404);
    expect((await minuta(id, "ADMIN_DA_OUTRA")).status).toBe(404);
    expect((await conferir(id, "ADMIN_DA_OUTRA")).status).toBe(404);
    // A outra empresa nem tem emitente: a recusa vem antes ou depois de procurar a carga, e nunca é uma emissão.
    expect([404, 409]).toContain((await emitir(id, "ADMIN_DA_OUTRA")).status);
    entrarComo("ADMIN_DA_OUTRA");
    const daOutra = (await (await coletasRota.GET()).json()) as { id: string }[];
    expect(daOutra.some((linha) => linha.id === id)).toBe(false);
    expect(await banco.paraEmpresa(EMPRESA_OUTRA.id).db.collection.findFirst({ where: { previousCteKey: CHAVE_DO_CTE_ANTERIOR } })).toBeNull();

    expect(await ler(id)).toMatchObject({ serviceType: "SUBCONTRACT", previousCteKey: CHAVE_DO_CTE_ANTERIOR });
    expect(sefaz.chamadas).toHaveLength(0);
  });
});
