import { gunzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chaveValida } from "../src/lib/nfe";
import {
  CIOT_OBRIGATORIO_DESDE,
  CONFIRME_QUE_NAO_SAIU,
  SEGURO_INCOMPLETO,
  cancelarSchema,
  ciotObrigatorio,
  condutorSchema,
  configuracaoSchema,
  cpfValido,
  dentroDoPrazoDeCancelamento,
  diasDesde,
  emitirSchema,
  encerrarSchema,
  entradasSchema,
  exigenciaDeMdfe,
  seloDoMdfe,
} from "../src/lib/mdfe";
import { assinarXml, assinaturaConfere, resumoDaAssinatura } from "../src/lib/cte/assinar";
import { lerCertificado } from "../src/lib/cte/certificado";
import { ChaveInvalida } from "../src/lib/cte/chave";
import { compactar, decidir, eventoRegistrado } from "../src/lib/cte/sefaz";
import { SEFAZ_FORA_DO_AR, SEFAZ_TEMPO_ESGOTADO, SefazError, envelope } from "../src/lib/cte/soap";
import { chaveDoMdfe } from "../src/lib/mdfe/chave";
import { ENDERECO_DO_QR_CODE, SERVICOS, enderecoDoServico } from "../src/lib/mdfe/enderecos";
import {
  ALVO_DO_EVENTO_DO_MDFE,
  ALVO_DO_MDFE,
  TIPO_DO_EVENTO,
  mensagemDeConsulta,
  mensagemDeNaoEncerrados,
  mensagemDeStatus,
  montarCancelamento,
  montarEncerramento,
  montarInclusaoDeCondutor,
  montarInclusaoDeDfe,
  montarMdfe,
  montarProcEvento,
  montarProcMdfe,
  tipoDeTransportador,
  totalDeDocumentos,
  urlDoQrCode,
} from "../src/lib/mdfe/montar";
import { DIVISAS, caminhosMaisCurtos, errosDoPercurso, inferirPercurso } from "../src/lib/mdfe/percurso";
import { SEM_EMITENTE, prepararMdfe, ufsDeDescarga, type CargaDaViagem, type Contexto, type VeiculoDaViagem, type ViagemDoMdfe } from "../src/lib/mdfe/preparar";
import {
  CSTAT,
  consultarMdfe,
  consultarNaoEncerrados,
  enviarEvento,
  enviarMdfe,
  statusDoServico,
  usarSefazDeTesteDoMdfe,
  type DestinoDoMdfe,
} from "../src/lib/mdfe/sefaz";
import { municipioDoTexto } from "../src/lib/municipios";
import { montarCte } from "../src/lib/cte/montar";
import { certificadoDeTeste, dadosDeExemplo, impressaoDigital, type CertificadoDeTeste } from "./cte-apoio";
import { EMITENTE_DO_MDFE, RODO, SEGURO, chaveDeExemplo, detalheDoEvento, errosNoEsquemaDoMdfe, mdfeDeExemplo, modalDoXml, subirSefazDoMdfe, type SefazDoMdfe } from "./mdfe-apoio";

/**
 * Emissão de MDF-e, na parte que não precisa de banco: a chave de acesso, a
 * montagem do XML (validada contra os esquemas oficiais do pacote
 * PL_MDFe_300b_NT012025), o percurso, o agrupamento por UF e município, a
 * assinatura, os eventos e a conversa SOAP.
 *
 * NENHUM teste fala com a SEFAZ: a conversa é com um servidor HTTPS local
 * (tests/mdfe-apoio.ts), e o certificado é autoassinado, gerado aqui.
 */

let certificado: CertificadoDeTeste;
let lido: ReturnType<typeof lerCertificado>;

beforeAll(() => {
  certificado = certificadoDeTeste();
  lido = lerCertificado(certificado.pfx, certificado.senha);
});

const chaveDeAssinatura = () => ({ chavePem: lido.chavePem, certificadoPem: lido.titularPem });

const assinado = (dados = mdfeDeExemplo()) => {
  const montado = montarMdfe(dados);
  return { ...montado, xml: assinarXml(montado.xml, ALVO_DO_MDFE, chaveDeAssinatura()) };
};

/** Valida o MDF-e assinado no esquema principal e o grupo `rodo` no esquema do modal. */
async function erros(dados = mdfeDeExemplo()): Promise<string[]> {
  const { xml } = assinado(dados);
  return [...(await errosNoEsquemaDoMdfe(xml, "mdfe_v3.00.xsd")), ...(await errosNoEsquemaDoMdfe(modalDoXml(xml), "mdfeModalRodoviario_v3.00.xsd"))];
}

/* ------------------------------- Chave de acesso ------------------------------ */

describe("chave de acesso do MDF-e", () => {
  it("monta as 44 posições com o dígito verificador (exemplo do MOC 3.00b, item 9.2.1)", () => {
    // 43181207312871000190580010000334041421310776: RS, 12/2018, modelo 58, série 1, nº 33404, cMDF 42131077.
    const chave = chaveDoMdfe({ uf: "RS", emissao: new Date("2018-12-10T12:00:00-03:00"), cnpj: "07312871000190", serie: 1, numero: 33404, codigo: "42131077" });
    expect(chave).toBe("43181207312871000190580010000334041421310776");
    expect(chaveValida(chave)).toBe(true);
    expect(chave.slice(20, 22)).toBe("58");
  });

  it("o ano e o mês são os do relógio de Brasília", () => {
    const virada = new Date("2026-11-01T01:30:00.000Z");
    expect(chaveDoMdfe({ uf: "SP", emissao: virada, cnpj: "11222333000181", serie: 1, numero: 1, codigo: "00000001" }).slice(2, 6)).toBe("2610");
  });

  it("aceita CNPJ alfanumérico (NT Conjunta 2025.001) e o dígito confere", () => {
    const chave = chaveDoMdfe({ uf: "SP", emissao: new Date("2026-10-10T12:00:00Z"), cnpj: "12ABC34501DE35", serie: 3, numero: 120, codigo: "12345678" });
    expect(chave).toMatch(/^[0-9]{6}[A-Z0-9]{12}[0-9]{26}$/);
    expect(chaveValida(chave)).toBe(true);
  });

  it("recusa parte fora do formato", () => {
    const base = { uf: "SP", emissao: new Date(), cnpj: "11222333000181", serie: 1, numero: 1, codigo: "00000001" };
    expect(() => chaveDoMdfe({ ...base, uf: "XX" })).toThrow(ChaveInvalida);
    expect(() => chaveDoMdfe({ ...base, cnpj: "123" })).toThrow(ChaveInvalida);
    expect(() => chaveDoMdfe({ ...base, numero: 0 })).toThrow(ChaveInvalida);
    expect(() => chaveDoMdfe({ ...base, serie: 1000 })).toThrow(ChaveInvalida);
    expect(() => chaveDoMdfe({ ...base, codigo: "1" })).toThrow(ChaveInvalida);
  });
});

/* ------------------------------------ Percurso -------------------------------- */

describe("percurso entre as UFs", () => {
  it("a tabela de divisas tem as 27 UFs e é simétrica", () => {
    expect(Object.keys(DIVISAS)).toHaveLength(27);
    for (const [uf, vizinhas] of Object.entries(DIVISAS)) {
      for (const vizinha of vizinhas) expect(DIVISAS[vizinha], `${vizinha} tem de fazer divisa com ${uf}`).toContain(uf);
      expect(vizinhas).not.toContain(uf);
    }
  });

  it("mesma UF e UFs vizinhas não têm percurso", () => {
    expect(inferirPercurso("SP", "SP")).toEqual({ tipo: "direto", percurso: [] });
    expect(inferirPercurso("SP", "MG")).toEqual({ tipo: "direto", percurso: [] });
  });

  it("um caminho só: o percurso é ele", () => {
    expect(inferirPercurso("SP", "SC")).toEqual({ tipo: "unico", percurso: ["PR"] });
    expect(inferirPercurso("SP", "RS")).toEqual({ tipo: "unico", percurso: ["PR", "SC"] });
    expect(inferirPercurso("RS", "SP")).toEqual({ tipo: "unico", percurso: ["SC", "PR"] });
  });

  it("mais de um caminho: não escolhe, devolve as opções", () => {
    // SP → BA só tem um caminho de um passo (por MG); SP → GO tem dois (por MG ou por MS).
    expect(inferirPercurso("SP", "BA")).toEqual({ tipo: "unico", percurso: ["MG"] });
    expect(caminhosMaisCurtos("SP", "GO")).toEqual([["MG"], ["MS"]]);
    expect(inferirPercurso("SP", "GO")).toEqual({ tipo: "informar", opcoes: [["MG"], ["MS"]] });
  });

  it("confere o percurso informado pelas divisas, na ordem", () => {
    expect(errosDoPercurso("SP", "GO", ["MG"])).toEqual([]);
    expect(errosDoPercurso("SP", "GO", ["MS"])).toEqual([]);
    expect(errosDoPercurso("SP", "RS", ["SC", "PR"])[0]).toMatch(/SP e SC não fazem divisa/);
    expect(errosDoPercurso("SP", "GO", [])[0]).toMatch(/SP e GO não fazem divisa/);
    expect(errosDoPercurso("SP", "GO", ["SP"])[0]).toMatch(/não repita/);
    expect(errosDoPercurso("SP", "GO", ["MG", "MG"])[0]).toMatch(/repetida/);
    expect(errosDoPercurso("SP", "GO", ["XX"])[0]).toMatch(/desconhecida/);
    // Dentro do estado ou entre vizinhas, o percurso vazio serve.
    expect(errosDoPercurso("SP", "SP", [])).toEqual([]);
    expect(errosDoPercurso("SP", "MG", [])).toEqual([]);
  });
});

/* ----------------------------------- Montagem --------------------------------- */

describe("montagem do MDF-e, validada no esquema oficial", () => {
  it("transportadora, duas UFs vizinhas, dois municípios de descarga, só CT-e, com seguro e CIOT", async () => {
    const { xml, chave, id, documentos } = assinado();
    expect(await erros()).toEqual([]);
    expect(id).toBe(`MDFe${chave}`);
    expect(documentos).toBe(2);
    expect(xml).toContain("<tpEmit>1</tpEmit>");
    expect(xml).toContain("<mod>58</mod>");
    expect(xml).toContain("<modal>1</modal>");
    expect(xml).toContain("<UFIni>SP</UFIni><UFFim>MG</UFFim>");
    expect(xml).toContain("<dhEmi>2026-10-10T11:30:00-03:00</dhEmi>");
    expect(xml).toContain("<dhIniViagem>2026-10-10T13:00:00-03:00</dhIniViagem>");
    expect(xml).toContain(`<cDV>${chave.slice(43)}</cDV>`);
    expect(xml).toContain("<qCTe>2</qCTe>");
    expect(xml).not.toContain("<qNFe>");
    expect(xml).not.toContain("<tpTransp>");
    expect(xml).toContain("<vCarga>65001.80</vCarga><cUnid>01</cUnid><qCarga>2501.0000</qCarga>");
    expect(xml.match(/<infMunDescarga>/g)).toHaveLength(2);
    expect(xml).toContain(`<infCIOT><CIOT>123456789012</CIOT><CNPJ>11222333000181</CNPJ></infCIOT>`);
    expect(xml).toContain("<seg><infResp><respSeg>1</respSeg></infResp><infSeg><xSeg>Seguradora de Teste S/A</xSeg><CNPJ>61198164000160</CNPJ></infSeg><nApol>AP-2026-0001</nApol><nAver>");
    expect(xml).toContain("<prodPred><tpCarga>05</tpCarga><xProd>Peças automotivas</xProd></prodPred>");
    // O QR Code: endereço do portal + chave + ambiente (MOC, item 9.2.1), com o "&" escrito como entidade.
    expect(xml).toContain(`<qrCodMDFe>https://dfe-portal.svrs.rs.gov.br/mdfe/qrCode?chMDFe=${chave}&amp;tpAmb=2</qrCodMDFe>`);
    expect(urlDoQrCode(ENDERECO_DO_QR_CODE, chave, "PRODUCAO")).toBe(`https://dfe-portal.svrs.rs.gov.br/mdfe/qrCode?chMDFe=${chave}&tpAmb=1`);
  });

  it("uma UF só (transporte dentro do estado)", async () => {
    const dados = mdfeDeExemplo({ ufDeFim: "SP", descargas: [{ municipio: { codigo: "3550308", nome: "São Paulo" }, chaves: [chaveDeExemplo("57", 20), chaveDeExemplo("57", 21)] }] });
    expect(await erros(dados)).toEqual([]);
    const { xml } = assinado(dados);
    expect(xml).toContain("<UFIni>SP</UFIni><UFFim>SP</UFFim>");
    expect(xml).not.toContain("<infPercurso>");
  });

  it("duas UFs com percurso, na ordem informada", async () => {
    const dados = mdfeDeExemplo({ ufDeFim: "RS", percurso: ["PR", "SC"], descargas: [{ municipio: { codigo: "4314902", nome: "Porto Alegre" }, chaves: [chaveDeExemplo("57", 30), chaveDeExemplo("57", 31)] }] });
    expect(await erros(dados)).toEqual([]);
    expect(assinado(dados).xml).toContain("<infPercurso><UFPer>PR</UFPer></infPercurso><infPercurso><UFPer>SC</UFPer></infPercurso>");
  });

  it("carga própria: só NF-e, sem seguro, sem produto e sem contratante", async () => {
    const dados = mdfeDeExemplo({
      emitente: { ...EMITENTE_DO_MDFE, tipo: "2", rntrc: null },
      descargas: [{ municipio: { codigo: "3106200", nome: "Belo Horizonte" }, chaves: [chaveDeExemplo("55", 100, "35", "45543915000181"), chaveDeExemplo("55", 101, "35", "45543915000181")] }],
      rodo: { ...RODO, contratantes: [] },
      seguros: [],
      produto: null,
    });
    expect(await erros(dados)).toEqual([]);
    const { xml } = assinado(dados);
    expect(xml).toContain("<tpEmit>2</tpEmit>");
    expect(xml).toContain("<qNFe>2</qNFe>");
    expect(xml).not.toContain("<qCTe>");
    expect(xml).not.toContain("<infCTe>");
    expect(xml).not.toContain("<seg>");
    expect(xml).not.toContain("<infANTT>");
  });

  it("com reboque e cavalo mecânico", async () => {
    const dados = mdfeDeExemplo({
      rodo: {
        ...RODO,
        tracao: { ...RODO.tracao, rodado: "03", carroceria: "00" },
        reboques: [
          { placa: "DEF4G56", renavam: "98765432101", taraKg: 7000, capacidadeKg: 30000, carroceria: "05", uf: "SP" },
          { placa: "GHI7J89", taraKg: 6500, capacidadeKg: 28000, carroceria: "02", uf: "MG" },
        ],
      },
    });
    expect(await erros(dados)).toEqual([]);
    const { xml } = assinado(dados);
    expect(xml.match(/<veicReboque>/g)).toHaveLength(2);
    expect(xml).toContain("<veicReboque><placa>DEF4G56</placa><RENAVAM>98765432101</RENAVAM><tara>7000</tara><capKG>30000</capKG><tpCar>05</tpCar><UF>SP</UF></veicReboque>");
  });

  it("veículo de terceiro: proprietário, tpTransp e o emitente como contratante", async () => {
    const tac = { documento: "52998224725", rntrc: "87654321", nome: "José Autônomo", ie: "", uf: "SP", tipo: "1" as const };
    const dados = mdfeDeExemplo({ rodo: { ...RODO, ciots: [{ documento: "52998224725" }], contratantes: [{ nome: EMITENTE_DO_MDFE.razaoSocial, documento: EMITENTE_DO_MDFE.cnpj }], tracao: { ...RODO.tracao, proprietario: tac } } });
    expect(await erros(dados)).toEqual([]);
    const { xml, tipoDeTransportador: tpTransp } = assinado(dados);
    expect(tpTransp).toBe("2");
    // Regra F18: CPF do proprietário → TAC (2).
    expect(xml).toContain("<tpEmit>1</tpEmit><tpTransp>2</tpTransp>");
    // A inscrição do proprietário é obrigatória no esquema e vai vazia (a assinatura a reescreve como elemento vazio).
    expect(xml).toMatch(/<prop><CPF>52998224725<\/CPF><RNTRC>87654321<\/RNTRC><xNome>José Autônomo<\/xNome><IE(\/>|><\/IE>)<UF>SP<\/UF><tpProp>1<\/tpProp><\/prop>/);
    // CIOT sem o código: só quem gerou (NT 2025.001).
    expect(xml).toContain("<infCIOT><CPF>52998224725</CPF></infCIOT>");
    expect(tipoDeTransportador({ ...tac, documento: "45543915000181" })).toBe("1");
    expect(tipoDeTransportador(null)).toBeNull();
  });

  it("com vale-pedágio e pagamento do frete a prazo (carga lotação)", async () => {
    const dados = mdfeDeExemplo({
      descargas: [{ municipio: { codigo: "3106200", nome: "Belo Horizonte" }, chaves: [chaveDeExemplo("57", 40)] }],
      produto: { tipoDeCarga: "05", descricao: "Rolamentos", ncm: "84821010", lotacao: { cepDeCarregamento: "15035000", cepDeDescarregamento: "30160011" } },
      rodo: {
        ...RODO,
        ciots: [{ codigo: "123456789012", documento: "11222333000181" }],
        valePedagio: { categoria: "04", dispositivos: [{ cnpjDoFornecedor: "61198164000160", pagador: "11222333000181", compra: "12345", valor: 150.5, tipo: "01" }] },
        pagamentos: [
          {
            nome: "Indústria Remetente S/A",
            documento: "45543915000181",
            valor: 3000,
            aPrazo: true,
            adiantamento: 1000,
            parcelas: [
              { vencimento: "2026-11-10", valor: 1000 },
              { vencimento: "2026-12-10", valor: 1000 },
            ],
            conta: { pix: "financeiro@transportadora.com.br" },
          },
        ],
      },
    });
    expect(await erros(dados)).toEqual([]);
    const { xml } = assinado(dados);
    expect(xml).toContain("<valePed><disp><CNPJForn>61198164000160</CNPJForn><CNPJPg>11222333000181</CNPJPg><nCompra>12345</nCompra><vValePed>150.50</vValePed><tpValePed>01</tpValePed></disp><categCombVeic>04</categCombVeic></valePed>");
    expect(xml).toContain("<Comp><tpComp>04</tpComp><vComp>3000.00</vComp></Comp><vContrato>3000.00</vContrato><indPag>1</indPag><vAdiant>1000.00</vAdiant>");
    expect(xml).toContain("<infPrazo><nParcela>001</nParcela><dVenc>2026-11-10</dVenc><vParcela>1000.00</vParcela></infPrazo><infPrazo><nParcela>002</nParcela>");
    expect(xml).toContain("<infBanc><PIX>financeiro@transportadora.com.br</PIX></infBanc>");
    expect(xml).toContain("<NCM>84821010</NCM><infLotacao><infLocalCarrega><CEP>15035000</CEP></infLocalCarrega><infLocalDescarrega><CEP>30160011</CEP></infLocalDescarrega></infLotacao>");
  });

  it("pagamento à vista em banco e agência, e por instituição de pagamento", async () => {
    const pagamento = { documento: "45543915000181", valor: 1200.4, aPrazo: false, adiantamento: 500, parcelas: [{ vencimento: "2026-11-10", valor: 700.4 }] };
    const comBanco = mdfeDeExemplo({ rodo: { ...RODO, ciots: mdfeDeExemplo().rodo.ciots, pagamentos: [{ ...pagamento, conta: { banco: "001", agencia: "1234" } }, { ...pagamento, conta: { cnpjDaIpef: "61198164000160" } }] } });
    expect(await erros(comBanco)).toEqual([]);
    const { xml } = assinado(comBanco);
    // À vista não leva adiantamento nem parcela, mesmo que tenham vindo (regras F53 e F63).
    expect(xml).not.toContain("<vAdiant>");
    expect(xml).not.toContain("<infPrazo>");
    expect(xml).toContain("<infBanc><codBanco>001</codBanco><codAgencia>1234</codAgencia></infBanc>");
    expect(xml).toContain("<infBanc><CNPJIPEF>61198164000160</CNPJIPEF></infBanc>");
  });

  it("lacres, seguro por conta do contratante e texto fora do padrão do esquema", async () => {
    const dados = mdfeDeExemplo({
      emitente: { ...EMITENTE_DO_MDFE, razaoSocial: "Transportes “Rápido” – Açaí & Cia <Ltda>", telefone: "(17) 3242-1000" },
      seguros: [{ ...SEGURO, responsavel: "2", documento: "45543915000181", averbacoes: ["AV-1", "AV-2"] }],
      lacres: ["LACRE-001", "LACRE-002"],
      observacao: "Viagem A1B2C3 — conferir\nlacres",
    });
    expect(await erros(dados)).toEqual([]);
    const { xml } = assinado(dados);
    expect(xml).toContain('<xNome>Transportes "Rápido" - Açaí &amp; Cia &lt;Ltda&gt;</xNome>');
    expect(xml).toContain("<fone>1732421000</fone>");
    expect(xml).toContain("<infResp><respSeg>2</respSeg><CNPJ>45543915000181</CNPJ></infResp>");
    expect(xml).toContain("<nAver>AV-1</nAver><nAver>AV-2</nAver>");
    expect(xml).toContain("<lacres><nLacre>LACRE-001</nLacre></lacres><lacres><nLacre>LACRE-002</nLacre></lacres>");
    expect(xml).toContain("<infAdic><infCpl>Viagem A1B2C3 - conferir lacres</infCpl></infAdic>");
  });

  it("a mesma chave não entra duas vezes no mesmo município, e o total fecha com o que foi relacionado", async () => {
    const repetida = chaveDeExemplo("57", 50);
    const dados = mdfeDeExemplo({ descargas: [{ municipio: { codigo: "3106200", nome: "Belo Horizonte" }, chaves: [repetida, repetida, chaveDeExemplo("57", 51)] }] });
    expect(await erros(dados)).toEqual([]);
    expect(totalDeDocumentos(dados.descargas)).toBe(2);
    expect(assinado(dados).xml).toContain("<qCTe>2</qCTe>");
  });

  it("em produção o tpAmb e o QR Code mudam", async () => {
    const dados = mdfeDeExemplo({ emitente: { ...EMITENTE_DO_MDFE, ambiente: "PRODUCAO" } });
    expect(await erros(dados)).toEqual([]);
    const { xml } = assinado(dados);
    expect(xml).toContain("<tpAmb>1</tpAmb>");
    expect(xml).toContain("&amp;tpAmb=1</qrCodMDFe>");
  });

  it("CNPJ alfanumérico: a chave e o CNPJ passam; o Id do pacote vigente ainda é só de dígitos", async () => {
    const dados = mdfeDeExemplo({ emitente: { ...EMITENTE_DO_MDFE, cnpj: "12ABC34501DE35" } });
    const falhas = await erros(dados);
    // O ÚNICO erro é o atributo Id (`MDFe[0-9]{44}` no PL_MDFe_300b_NT012025 de 25/04/2026): CNPJ, chave e QR Code passam.
    expect(falhas.length).toBeGreaterThan(0);
    expect(falhas.every((falha) => falha.includes("'Id'") || falha.includes("attribute 'Id'"))).toBe(true);
  });

  it("o mdfeProc (MDF-e + protocolo) é válido no esquema", async () => {
    const { xml, chave } = assinado();
    const protocolo = `<protMDFe versao="3.00"><infProt><tpAmb>2</tpAmb><verAplic>TESTE-1.0</verAplic><chMDFe>${chave}</chMDFe><dhRecbto>2026-10-10T11:30:05-03:00</dhRecbto><nProt>935260000000001</nProt><digVal>${resumoDaAssinatura(xml)}</digVal><cStat>100</cStat><xMotivo>Autorizado o uso do MDF-e</xMotivo></infProt></protMDFe>`;
    const proc = montarProcMdfe(xml, protocolo);
    expect(proc.startsWith('<?xml version="1.0" encoding="UTF-8"?><mdfeProc xmlns="http://www.portalfiscal.inf.br/mdfe" versao="3.00"><MDFe')).toBe(true);
    expect(await errosNoEsquemaDoMdfe(proc, "procMDFe_v3.00.xsd")).toEqual([]);
  });

  it("o esquema recusa o que a montagem não deixa passar por descuido (prova de que a validação morde)", async () => {
    const { xml } = assinado();
    expect((await errosNoEsquemaDoMdfe(xml.replace("<mod>58</mod>", "<mod>57</mod>"), "mdfe_v3.00.xsd")).length).toBeGreaterThan(0);
    expect((await errosNoEsquemaDoMdfe(xml.replace(/<tot>.*<\/tot>/, ""), "mdfe_v3.00.xsd")).length).toBeGreaterThan(0);
    expect((await errosNoEsquemaDoMdfe(modalDoXml(xml).replace("<tara>8500</tara>", ""), "mdfeModalRodoviario_v3.00.xsd")).length).toBeGreaterThan(0);
  });
});

/* ---------------------------------- Assinatura -------------------------------- */

describe("assinatura do MDF-e", () => {
  it("assina o infMDFe com os algoritmos do MOC e a assinatura confere", () => {
    const { xml, id } = assinado();
    expect(xml).toContain(`<Reference URI="#${id}">`);
    expect(xml).toContain('<SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"/>');
    expect(xml).toContain('<CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>');
    expect(xml).toContain('<Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/>');
    // A assinatura é o último filho do MDFe, depois do infMDFeSupl, como o esquema pede.
    expect(xml).toMatch(/<\/infMDFeSupl><Signature xmlns="http:\/\/www.w3.org\/2000\/09\/xmldsig#">[\s\S]*<\/Signature><\/MDFe>$/);
    expect(assinaturaConfere(xml, lido.titularPem)).toBe(true);
    expect(resumoDaAssinatura(xml)).toMatch(/^[A-Za-z0-9+/]{27}=$/);
  });

  it("XML alterado depois de assinado e certificado de outra empresa não conferem", () => {
    const { xml } = assinado();
    expect(assinaturaConfere(xml.replace("<UFFim>MG</UFFim>", "<UFFim>RJ</UFFim>"), lido.titularPem)).toBe(false);
    const deOutraEmpresa = certificadoDeTeste({ cnpj: "45543915000181" });
    const outro = lerCertificado(deOutraEmpresa.pfx, deOutraEmpresa.senha);
    expect(assinaturaConfere(xml, outro.titularPem)).toBe(false);
  });
});

/* ------------------------------------ Eventos --------------------------------- */

describe("eventos do MDF-e, validados no esquema oficial", () => {
  const chave = chaveDeExemplo("58", 7);
  const base = { chave, cnpj: "11222333000181", ambiente: "HOMOLOGACAO" as const, quando: new Date("2026-10-11T12:00:00.000Z") };
  const protocolo = "935260000000001";

  const validar = async (evento: { xml: string }, esquemaDoDetalhe: string) => {
    const xml = assinarXml(evento.xml, ALVO_DO_EVENTO_DO_MDFE, chaveDeAssinatura());
    expect(assinaturaConfere(xml, lido.titularPem)).toBe(true);
    return { xml, erros: [...(await errosNoEsquemaDoMdfe(xml, "eventoMDFe_v3.00.xsd")), ...(await errosNoEsquemaDoMdfe(detalheDoEvento(xml), esquemaDoDetalhe))] };
  };

  it("encerramento (110112): protocolo, dia, UF e município", async () => {
    const evento = montarEncerramento({ ...base, protocolo, dia: "2026-10-11", municipio: { codigo: "3106200", uf: "MG" } });
    const { xml, erros: falhas } = await validar(evento, "evEncMDFe_v3.00.xsd");
    expect(falhas).toEqual([]);
    expect(evento.id).toBe(`ID110112${chave}01`);
    expect(xml).toContain(`<cOrgao>35</cOrgao><tpAmb>2</tpAmb><CNPJ>11222333000181</CNPJ><chMDFe>${chave}</chMDFe><dhEvento>2026-10-11T09:00:00-03:00</dhEvento><tpEvento>110112</tpEvento><nSeqEvento>1</nSeqEvento>`);
    expect(xml).toContain('<detEvento versaoEvento="3.00"><evEncMDFe><descEvento>Encerramento</descEvento><nProt>935260000000001</nProt><dtEnc>2026-10-11</dtEnc><cUF>31</cUF><cMun>3106200</cMun></evEncMDFe></detEvento>');
  });

  it("cancelamento (110111): protocolo e justificativa", async () => {
    const evento = montarCancelamento({ ...base, protocolo, justificativa: "Viagem cancelada pelo cliente antes da saída" });
    const { xml, erros: falhas } = await validar(evento, "evCancMDFe_v3.00.xsd");
    expect(falhas).toEqual([]);
    expect(evento.id).toBe(`ID110111${chave}01`);
    expect(xml).toContain("<evCancMDFe><descEvento>Cancelamento</descEvento><nProt>935260000000001</nProt><xJust>Viagem cancelada pelo cliente antes da saída</xJust></evCancMDFe>");
  });

  it("inclusão de condutor (110114): um condutor por evento, com a sequência no Id", async () => {
    const evento = montarInclusaoDeCondutor({ ...base, sequencia: 3, condutor: { nome: "Maria de Souza", cpf: "11144477735" } });
    const { xml, erros: falhas } = await validar(evento, "evIncCondutorMDFe_v3.00.xsd");
    expect(falhas).toEqual([]);
    expect(evento.id).toBe(`ID110114${chave}03`);
    expect(xml).toContain("<nSeqEvento>3</nSeqEvento>");
    expect(xml).toContain("<evIncCondutorMDFe><descEvento>Inclusao Condutor</descEvento><condutor><xNome>Maria de Souza</xNome><CPF>11144477735</CPF></condutor></evIncCondutorMDFe>");
  });

  it("inclusão de DF-e (110115): município de carregamento e as NF-e com a descarga de cada uma", async () => {
    const evento = montarInclusaoDeDfe({
      ...base,
      sequencia: 1,
      protocolo,
      carregamento: { codigo: "3530300", nome: "Mirassol" },
      documentos: [
        { descarga: { codigo: "3549805", nome: "São José do Rio Preto" }, chave: chaveDeExemplo("55", 200, "35", "45543915000181") },
        { descarga: { codigo: "3549805", nome: "São José do Rio Preto" }, chave: chaveDeExemplo("55", 201, "35", "45543915000181") },
      ],
    });
    const { xml, erros: falhas } = await validar(evento, "evInclusaoDFeMDFe_v3.00.xsd");
    expect(falhas).toEqual([]);
    expect(xml.match(/<infDoc>/g)).toHaveLength(2);
  });

  it("o evento registrado com o retorno (procEventoMDFe) é válido no esquema", async () => {
    const evento = montarEncerramento({ ...base, protocolo, dia: "2026-10-11", municipio: { codigo: "3106200", uf: "MG" } });
    const xml = assinarXml(evento.xml, ALVO_DO_EVENTO_DO_MDFE, chaveDeAssinatura());
    const retorno = `<retEventoMDFe xmlns="http://www.portalfiscal.inf.br/mdfe" versao="3.00"><infEvento><tpAmb>2</tpAmb><verAplic>TESTE-1.0</verAplic><cOrgao>35</cOrgao><cStat>135</cStat><xMotivo>Evento registrado e vinculado a MDF-e</xMotivo><chMDFe>${chave}</chMDFe><tpEvento>110112</tpEvento><xEvento>Encerramento</xEvento><nSeqEvento>1</nSeqEvento><dhRegEvento>2026-10-11T09:00:05-03:00</dhRegEvento><nProt>935260000000002</nProt></infEvento></retEventoMDFe>`;
    expect(await errosNoEsquemaDoMdfe(montarProcEvento(xml, retorno), "procEventoMDFe_v3.00.xsd")).toEqual([]);
  });

  it("as consultas (status, situação e não encerrados) são válidas no esquema", async () => {
    expect(await errosNoEsquemaDoMdfe(mensagemDeStatus("HOMOLOGACAO"), "consStatServMDFe_v3.00.xsd")).toEqual([]);
    expect(await errosNoEsquemaDoMdfe(mensagemDeConsulta(chave, "PRODUCAO"), "consSitMDFe_v3.00.xsd")).toEqual([]);
    expect(await errosNoEsquemaDoMdfe(mensagemDeNaoEncerrados("11222333000181", "HOMOLOGACAO"), "consMDFeNaoEnc_v3.00.xsd")).toEqual([]);
    expect(mensagemDeNaoEncerrados("11222333000181", "HOMOLOGACAO")).toContain("<xServ>CONSULTAR NÃO ENCERRADOS</xServ><CNPJ>11222333000181</CNPJ>");
    // O status do MDF-e não leva a UF: o autorizador é nacional.
    expect(mensagemDeStatus("PRODUCAO")).toBe('<consStatServMDFe xmlns="http://www.portalfiscal.inf.br/mdfe" versao="3.00"><tpAmb>1</tpAmb><xServ>STATUS</xServ></consStatServMDFe>');
  });
});

/* ----------------------------- Da viagem ao documento -------------------------- */

const VEICULO: VeiculoDaViagem = { id: "v1", placa: "ABC1D23", renavam: "12345678901", taraKg: 8500, capacidadeKg: 14000, rodado: "01", carroceria: "02", uf: "SP", proprietario: null };

/** O XML assinado de um CT-e de exemplo, com início e fim trocados. */
function cteDe(numero: number, fim: { codigoMunicipio: string; municipio: string; uf: string }, inicio = { codigoMunicipio: "3549805", municipio: "São José do Rio Preto", uf: "SP" }) {
  const montado = montarCte(dadosDeExemplo({ numero, inicio, fim, valorDaCarga: 1000 * numero, pesoKg: 100 * numero, produto: "Peças" }));
  return { chave: montado.chave, xml: montado.xml };
}

const carga = (numero: number, trocas: Partial<CargaDaViagem> = {}): CargaDaViagem => ({
  id: `c${numero}`,
  trackingCode: `TRK${numero}`,
  origin: "São José do Rio Preto - SP",
  destination: "Belo Horizonte - MG",
  weight: 50,
  invoiceValue: 500,
  invoiceKey: null,
  deliveryZip: "30160-011",
  cliente: { nome: "Indústria Remetente S/A", documento: "45.543.915/0001-81" },
  cte: cteDe(numero, { codigoMunicipio: "3106200", municipio: "Belo Horizonte", uf: "MG" }),
  notas: [],
  ...trocas,
});

const viagem = (cargas: CargaDaViagem[], trocas: Partial<ViagemDoMdfe> = {}): ViagemDoMdfe => ({
  id: "a1b2c3d4",
  codigo: "A1B2C3",
  saida: new Date("2026-10-10T16:00:00.000Z"),
  motorista: { nome: "João da Silva", cpf: "529.982.247-25" },
  veiculo: VEICULO,
  cargas,
  ...trocas,
});

const contexto = (trocas: Partial<Contexto> = {}): Contexto => ({
  emitente: EMITENTE_DO_MDFE,
  seguroPadrao: { seguradora: SEGURO.seguradora, cnpjDaSeguradora: SEGURO.cnpjDaSeguradora, apolice: SEGURO.apolice },
  reboques: [],
  enderecoDoQrCode: ENDERECO_DO_QR_CODE,
  achar: municipioDoTexto,
  agora: new Date("2026-10-10T15:00:00.000Z"),
  ...trocas,
});

const ENTRADAS = entradasSchema.parse({ ciots: [{ codigo: "123456789012", documento: "11.222.333/0001-81" }], seguro: { ...SEGURO, averbacoes: ["AV-123"] } });

describe("da viagem ao MDF-e", () => {
  it("um MDF-e por UF de descarregamento, com os documentos agrupados por município de descarga", async () => {
    const cargas = [
      carga(1),
      carga(2, { cte: cteDe(2, { codigoMunicipio: "3170206", municipio: "Uberlândia", uf: "MG" }), destination: "Uberlândia - MG" }),
      carga(3),
      carga(4, { cte: cteDe(4, { codigoMunicipio: "3304557", municipio: "Rio de Janeiro", uf: "RJ" }), destination: "Rio de Janeiro - RJ" }),
    ];
    const daViagem = viagem(cargas);
    expect(ufsDeDescarga(daViagem, "1", municipioDoTexto)).toEqual(["MG", "RJ"]);

    const mg = prepararMdfe(daViagem, "MG", ENTRADAS, contexto());
    expect(mg.pendencias).toEqual([]);
    expect(mg.resumo.descargas).toEqual([
      { municipio: "Belo Horizonte", documentos: 2 },
      { municipio: "Uberlândia", documentos: 1 },
    ]);
    expect(mg.resumo).toMatchObject({ ufDeInicio: "SP", ufDeFim: "MG", documentos: 3, percurso: [], lotacao: false, carregamento: ["São José do Rio Preto"] });
    // Valor e peso vêm dos CT-e (1000 e 100 por número), não da carga.
    expect(mg.resumo.valorDaCarga).toBe(6000);
    expect(mg.resumo.pesoKg).toBe(600);
    expect(mg.dados?.descargas[0].chaves).toEqual([cargas[0].cte?.chave, cargas[2].cte?.chave]);
    expect(mg.dados?.produto).toMatchObject({ tipoDeCarga: "05", descricao: "Peças" });
    expect(mg.dados?.rodo.contratantes).toEqual([{ nome: "Indústria Remetente S/A", documento: "45543915000181" }]);

    // O que foi preparado monta e passa no esquema.
    const montado = montarMdfe({ ...mg.dados!, numero: 1, codigo: "12345678", emissao: new Date("2026-10-10T15:00:00.000Z") });
    const xml = assinarXml(montado.xml, ALVO_DO_MDFE, chaveDeAssinatura());
    expect(await errosNoEsquemaDoMdfe(xml, "mdfe_v3.00.xsd")).toEqual([]);
    expect(await errosNoEsquemaDoMdfe(modalDoXml(xml), "mdfeModalRodoviario_v3.00.xsd")).toEqual([]);

    // O do RJ tem um documento só: é carga lotação, e a SEFAZ pede NCM e pagamento.
    const rj = prepararMdfe(daViagem, "RJ", ENTRADAS, contexto());
    expect(rj.resumo.lotacao).toBe(true);
    expect(rj.pendencias.join(" ")).toMatch(/NCM/);
    expect(rj.pendencias.join(" ")).toMatch(/pagamento do frete/);
    expect(rj.dados).toBeNull();
  });

  it("carga lotação com tudo informado: prepara, monta e passa no esquema", async () => {
    const entradas = entradasSchema.parse({
      ...ENTRADAS,
      produto: { tipoDeCarga: "05", descricao: "Rolamentos", ncm: "8482.10.10" },
      lotacao: { cepDeCarregamento: "15035-000", cepDeDescarregamento: "30160-011" },
      pagamento: { documento: "45.543.915/0001-81", valor: "850,50", aPrazo: false, conta: { pix: "11222333000181" } },
    });
    const preparo = prepararMdfe(viagem([carga(1)]), "MG", entradas, contexto());
    expect(preparo.pendencias).toEqual([]);
    const montado = montarMdfe({ ...preparo.dados!, numero: 2, codigo: "12345678", emissao: new Date("2026-10-10T15:00:00.000Z") });
    const xml = assinarXml(montado.xml, ALVO_DO_MDFE, chaveDeAssinatura());
    expect(await errosNoEsquemaDoMdfe(xml, "mdfe_v3.00.xsd")).toEqual([]);
    expect(await errosNoEsquemaDoMdfe(modalDoXml(xml), "mdfeModalRodoviario_v3.00.xsd")).toEqual([]);
    expect(xml).toContain("<NCM>84821010</NCM><infLotacao>");
    expect(xml).toContain("<vContrato>850.50</vContrato><indPag>0</indPag>");
  });

  it("percurso: usa o caminho único, pede quando há mais de um e confere o informado", () => {
    const paraSc = [carga(1, { cte: cteDe(1, { codigoMunicipio: "4205407", municipio: "Florianópolis", uf: "SC" }), destination: "Florianópolis - SC" }), carga(2, { cte: cteDe(2, { codigoMunicipio: "4205407", municipio: "Florianópolis", uf: "SC" }), destination: "Florianópolis - SC" })];
    expect(prepararMdfe(viagem(paraSc), "SC", ENTRADAS, contexto()).resumo.percurso).toEqual(["PR"]);

    const paraGo = [1, 2].map((numero) => carga(numero, { cte: cteDe(numero, { codigoMunicipio: "5208707", municipio: "Goiânia", uf: "GO" }), destination: "Goiânia - GO" }));
    const semPercurso = prepararMdfe(viagem(paraGo), "GO", ENTRADAS, contexto());
    expect(semPercurso.resumo.percurso).toBeNull();
    expect(semPercurso.resumo.opcoesDePercurso).toEqual([["MG"], ["MS"]]);
    expect(semPercurso.pendencias[0]).toMatch(/Informe as UFs do percurso entre SP e GO/);
    expect(semPercurso.dados).toBeNull();

    const informado = prepararMdfe(viagem(paraGo), "GO", { ...ENTRADAS, percurso: ["MS"] }, contexto());
    expect(informado.pendencias).toEqual([]);
    expect(informado.dados?.percurso).toEqual(["MS"]);

    const errado = prepararMdfe(viagem(paraGo), "GO", { ...ENTRADAS, percurso: ["PR"] }, contexto());
    expect(errado.pendencias[0]).toMatch(/PR e GO não fazem divisa/);
  });

  it("lista o que falta no veículo, no motorista e nos documentos, em vez de montar incompleto", () => {
    const semCadastro = viagem([carga(1, { cte: null }), carga(2, { destination: "Cidade Que Não Existe - ZZ", cte: null })], {
      veiculo: { ...VEICULO, taraKg: null, rodado: null, carroceria: null, renavam: null },
      motorista: { nome: "João", cpf: "111.111.111-11" },
    });
    const preparo = prepararMdfe(semCadastro, "MG", {}, contexto({ seguroPadrao: null }));
    const texto = preparo.pendencias.join("\n");
    expect(texto).toMatch(/Falta no cadastro do veículo ABC1D23 \(Frota\): tara \(kg\), tipo de rodado, tipo de carroceria/);
    expect(texto).toMatch(/CPF do motorista João não é válido/);
    expect(texto).toMatch(/carga TRK1 não tem CT-e autorizado neste ambiente/);
    expect(texto).toMatch(/cidade de destino da carga TRK2/);
    expect(texto).toMatch(/seguro da carga é obrigatório/);
    expect(texto).toMatch(/Informe o CIOT/);
    expect(preparo.avisos.join(" ")).toMatch(/sem RENAVAM/);
    expect(preparo.dados).toBeNull();
    expect(prepararMdfe(viagem([carga(1)]), "MG", ENTRADAS, contexto({ emitente: null })).pendencias[0]).toBe(SEM_EMITENTE);
  });

  it("o CIOT vira exigência na data da NT 2026.001, por ambiente", () => {
    expect(CIOT_OBRIGATORIO_DESDE).toEqual({ HOMOLOGACAO: "2026-09-21", PRODUCAO: "2026-11-23" });
    expect(ciotObrigatorio("HOMOLOGACAO", new Date("2026-09-20T12:00:00Z"))).toBe(false);
    expect(ciotObrigatorio("HOMOLOGACAO", new Date("2026-09-21T03:00:00Z"))).toBe(true);
    expect(ciotObrigatorio("PRODUCAO", new Date("2026-10-10T12:00:00Z"))).toBe(false);
    // 23/11 à 00:00 de Brasília é 03:00 UTC.
    expect(ciotObrigatorio("PRODUCAO", new Date("2026-11-23T02:59:00Z"))).toBe(false);
    expect(ciotObrigatorio("PRODUCAO", new Date("2026-11-23T03:00:00Z"))).toBe(true);

    const semCiot = { seguro: ENTRADAS.seguro };
    const cargas = [carga(1), carga(2)];
    // Em produção, antes da data: aviso, não pendência.
    const producao = prepararMdfe(viagem(cargas), "MG", semCiot, contexto({ emitente: { ...EMITENTE_DO_MDFE, ambiente: "PRODUCAO" } }));
    expect(producao.pendencias).toEqual([]);
    expect(producao.avisos.join(" ")).toMatch(/a partir de 23\/11\/2026 em produção/);
    // Em homologação já é exigido.
    expect(prepararMdfe(viagem(cargas), "MG", semCiot, contexto()).pendencias.join(" ")).toMatch(/rejeição 684/);
  });

  it("carga própria: relaciona as NF-e, sem exigir seguro, CIOT nem contratante", async () => {
    const nota = (numero: number) => ({ chave: chaveDeExemplo("55", numero, "35", "11222333000181"), valor: 1500, peso: 80 });
    const cargas = [carga(1, { cte: null, notas: [nota(1), nota(2)] }), carga(2, { cte: null, notas: [], invoiceKey: chaveDeExemplo("55", 3, "35", "11222333000181") })];
    const propria = contexto({ emitente: { ...EMITENTE_DO_MDFE, tipo: "2" }, seguroPadrao: null });
    const preparo = prepararMdfe(viagem(cargas), "MG", {}, propria);
    expect(preparo.pendencias).toEqual([]);
    expect(preparo.resumo.documentos).toBe(3);
    expect(preparo.dados?.rodo.contratantes).toEqual([]);
    expect(preparo.dados?.seguros).toEqual([]);
    expect(preparo.dados?.produto).toBeNull();
    const montado = montarMdfe({ ...preparo.dados!, numero: 3, codigo: "12345678", emissao: new Date("2026-10-10T15:00:00.000Z") });
    const xml = assinarXml(montado.xml, ALVO_DO_MDFE, chaveDeAssinatura());
    expect(await errosNoEsquemaDoMdfe(xml, "mdfe_v3.00.xsd")).toEqual([]);
    expect(xml).toContain("<tpEmit>2</tpEmit>");
    expect(xml).toContain("<qNFe>3</qNFe>");
    // Sem NF-e, a carga própria fica pendente.
    expect(prepararMdfe(viagem([carga(1, { cte: null })]), "MG", {}, propria).pendencias.join(" ")).toMatch(/não tem NF-e/);
  });

  it("veículo de terceiro e reboques do cadastro", () => {
    const deTerceiro: VeiculoDaViagem = { ...VEICULO, rodado: "03", proprietario: { documento: "529.982.247-25", nome: "José Autônomo", rntrc: "87654321", ie: null, uf: "SP", tipo: "0" } };
    const cargas = [carga(1), carga(2)];
    const semReboque = prepararMdfe(viagem(cargas, { veiculo: deTerceiro }), "MG", ENTRADAS, contexto());
    expect(semReboque.pendencias.join(" ")).toMatch(/cavalo mecânico: escolha pelo menos um reboque/);

    const reboque: VeiculoDaViagem = { id: "r1", placa: "DEF4G56", renavam: null, taraKg: 7000, capacidadeKg: 30000, rodado: null, carroceria: "05", uf: "SP", proprietario: null };
    const completo = prepararMdfe(viagem(cargas, { veiculo: deTerceiro }), "MG", { ...ENTRADAS, reboques: ["r1"] }, contexto({ reboques: [reboque] }));
    expect(completo.pendencias).toEqual([]);
    expect(completo.dados?.rodo.tracao.proprietario).toMatchObject({ documento: "52998224725", tipo: "0" });
    // Regra F65: com proprietário informado, o contratante é o próprio emitente.
    expect(completo.dados?.rodo.contratantes).toEqual([{ nome: EMITENTE_DO_MDFE.razaoSocial, documento: EMITENTE_DO_MDFE.cnpj }]);
    expect(completo.dados?.rodo.reboques).toHaveLength(1);

    const reboqueIncompleto = prepararMdfe(viagem(cargas, { veiculo: deTerceiro }), "MG", { ...ENTRADAS, reboques: ["r1"] }, contexto({ reboques: [{ ...reboque, capacidadeKg: null }] }));
    expect(reboqueIncompleto.pendencias.join(" ")).toMatch(/reboque DEF4G56 \(Frota\): capacidade \(kg\)/);

    const donoIncompleto = prepararMdfe(viagem(cargas, { veiculo: { ...VEICULO, proprietario: { documento: "52998224725", nome: null, rntrc: null, ie: null, uf: null, tipo: null } } }), "MG", ENTRADAS, contexto());
    expect(donoIncompleto.pendencias.join(" ")).toMatch(/Falta no proprietário do veículo ABC1D23 \(Frota\): o nome, o RNTRC \(8 dígitos\), a UF, o tipo/);
    // Proprietário igual ao emitente não se informa (regra F64).
    const daEmpresa = prepararMdfe(viagem(cargas, { veiculo: { ...VEICULO, proprietario: { documento: "11222333000181", nome: "x", rntrc: null, ie: null, uf: null, tipo: null } } }), "MG", ENTRADAS, contexto());
    expect(daEmpresa.pendencias).toEqual([]);
    expect(daEmpresa.dados?.rodo.tracao.proprietario).toBeNull();
  });

  it("cargas que carregam em UFs diferentes não cabem num MDF-e", () => {
    const cargas = [carga(1), carga(2, { cte: cteDe(2, { codigoMunicipio: "3106200", municipio: "Belo Horizonte", uf: "MG" }, { codigoMunicipio: "4106902", municipio: "Curitiba", uf: "PR" }) })];
    expect(prepararMdfe(viagem(cargas), "MG", ENTRADAS, contexto()).pendencias.join(" ")).toMatch(/carregam em mais de uma UF \(SP, PR\)/);
  });
});

/* ----------------------------------- Validação -------------------------------- */

describe("o que a pessoa informa", () => {
  it("CPF: dígitos verificadores e sequências repetidas", () => {
    expect(cpfValido("52998224725")).toBe(true);
    expect(cpfValido("11144477735")).toBe(true);
    expect(cpfValido("52998224726")).toBe(false);
    expect(cpfValido("11111111111")).toBe(false);
    expect(cpfValido("123")).toBe(false);
  });

  it("configuração: série fora da faixa de pessoa física e seguro inteiro ou nada", () => {
    const base = { serie: "1", proximoNumero: "1", tipoDeEmitente: "1" };
    expect(configuracaoSchema.safeParse(base).success).toBe(true);
    expect(configuracaoSchema.safeParse({ ...base, serie: "920" }).success).toBe(false);
    expect(configuracaoSchema.safeParse({ ...base, tipoDeEmitente: "3" }).success).toBe(false);
    const meio = configuracaoSchema.safeParse({ ...base, seguradora: "Seguradora X" });
    expect(meio.success ? "" : meio.error.issues[0].message).toBe(SEGURO_INCOMPLETO);
    const inteiro = configuracaoSchema.parse({ ...base, seguradora: "Seguradora X", cnpjDaSeguradora: "61.198.164/0001-60", apolice: "123" });
    expect(inteiro.cnpjDaSeguradora).toBe("61198164000160");
  });

  it("entradas: CIOT, vale-pedágio, seguro e pagamento", () => {
    expect(entradasSchema.safeParse({}).success).toBe(true);
    expect(entradasSchema.safeParse({ ciots: [{ codigo: "123", documento: "11222333000181" }] }).success).toBe(false);
    expect(entradasSchema.parse({ ciots: [{ codigo: "", documento: "529.982.247-25" }] }).ciots).toEqual([{ codigo: null, documento: "52998224725" }]);
    expect(entradasSchema.safeParse({ ciots: [{ documento: "52998224726" }] }).success).toBe(false);
    expect(entradasSchema.safeParse({ percurso: ["PR", "XX"] }).success).toBe(false);
    expect(entradasSchema.safeParse({ reboques: ["a", "b", "c", "d"] }).success).toBe(false);
    expect(entradasSchema.safeParse({ valePedagio: { categoria: "03", cnpjDoFornecedor: "61198164000160", valor: "10" } }).success).toBe(false);
    expect(entradasSchema.safeParse({ valePedagio: { categoria: "04", cnpjDoFornecedor: "61198164000160", valor: "10", tipo: "02" } }).success).toBe(false);
    expect(entradasSchema.safeParse({ seguro: { ...SEGURO, responsavel: "2" } }).success).toBe(false);

    const pagamento = { documento: "45543915000181", valor: "3000", conta: { pix: "chave@pix.com" } };
    expect(entradasSchema.safeParse({ pagamento: { ...pagamento, aPrazo: false } }).success).toBe(true);
    expect(entradasSchema.safeParse({ pagamento: { ...pagamento, aPrazo: false, adiantamento: "100" } }).success).toBe(false);
    expect(entradasSchema.safeParse({ pagamento: { ...pagamento, aPrazo: true } }).success).toBe(false);
    const parcelas = [
      { vencimento: "2026-11-10", valor: "1000" },
      { vencimento: "2026-12-10", valor: "1000" },
    ];
    expect(entradasSchema.safeParse({ pagamento: { ...pagamento, aPrazo: true, adiantamento: "1000", parcelas } }).success).toBe(true);
    expect(entradasSchema.safeParse({ pagamento: { ...pagamento, aPrazo: true, parcelas } }).success).toBe(false);
    expect(entradasSchema.safeParse({ pagamento: { ...pagamento, aPrazo: true, adiantamento: "1000", parcelas: [...parcelas].reverse() } }).success).toBe(false);
    expect(entradasSchema.safeParse({ pagamento: { ...pagamento, aPrazo: false, conta: {} } }).success).toBe(false);
  });

  it("emitir, encerrar, cancelar e incluir condutor", () => {
    expect(emitirSchema.parse({ manifestId: "m1", ufDeDescarga: "MG" }).entradas).toEqual({});
    expect(emitirSchema.safeParse({ manifestId: "m1", ufDeDescarga: "XX" }).success).toBe(false);
    expect(encerrarSchema.safeParse({ dia: "2026-10-11", cidade: "Belo Horizonte", uf: "MG" }).success).toBe(true);
    expect(encerrarSchema.safeParse({ dia: "11/10/2026", cidade: "Belo Horizonte", uf: "MG" }).success).toBe(false);
    const semConfirmar = cancelarSchema.safeParse({ justificativa: "Viagem cancelada pelo cliente" });
    expect(semConfirmar.success ? "" : semConfirmar.error.issues[0].message).toBe(CONFIRME_QUE_NAO_SAIU);
    expect(cancelarSchema.safeParse({ justificativa: "curta", transporteNaoIniciado: true }).success).toBe(false);
    expect(cancelarSchema.safeParse({ justificativa: "Viagem cancelada pelo cliente", transporteNaoIniciado: true }).success).toBe(true);
    expect(condutorSchema.parse({ nome: " Maria de Souza ", cpf: "111.444.777-35" })).toEqual({ nome: "Maria de Souza", cpf: "11144477735" });
    expect(condutorSchema.safeParse({ nome: "Maria", cpf: "11144477736" }).success).toBe(false);
  });

  it("prazo do cancelamento (24 horas), dias em aberto, selo e exigência de MDF-e", () => {
    const agora = new Date("2026-10-11T12:00:00Z");
    expect(dentroDoPrazoDeCancelamento("2026-10-10T12:00:00Z", agora)).toBe(true);
    expect(dentroDoPrazoDeCancelamento("2026-10-10T11:59:59Z", agora)).toBe(false);
    expect(dentroDoPrazoDeCancelamento(null, agora)).toBe(false);
    expect(diasDesde("2026-10-08T11:00:00Z", agora)).toBe(3);
    expect(seloDoMdfe({ situacao: "AUTHORIZED", ambiente: "HOMOLOGACAO", numero: 7, semResposta: false })).toBe("Autorizado nº 7 (homologação)");
    expect(seloDoMdfe({ situacao: "CLOSED", ambiente: "PRODUCAO", numero: 7, semResposta: false })).toBe("Encerrado nº 7");
    expect(seloDoMdfe({ situacao: "DRAFT", ambiente: "PRODUCAO", numero: 7, semResposta: true })).toBe("Sem resposta da SEFAZ");
    expect(exigenciaDeMdfe([{ ufDeOrigem: "SP", ufDeDestino: "MG", mesmoMunicipio: false }])).toBe("interestadual");
    expect(exigenciaDeMdfe([{ ufDeOrigem: "SP", ufDeDestino: "SP", mesmoMunicipio: false }])).toBe("intermunicipal");
    expect(exigenciaDeMdfe([{ ufDeOrigem: "SP", ufDeDestino: "SP", mesmoMunicipio: true }])).toBe("nenhuma");
  });
});

/* -------------------------- A conversa com a SEFAZ (local) --------------------- */

describe("web services do MDF-e contra o servidor local", () => {
  let sefaz: SefazDoMdfe;
  let destino: DestinoDoMdfe;

  beforeAll(async () => {
    sefaz = await subirSefazDoMdfe();
    usarSefazDeTesteDoMdfe({ url: sefaz.url, autoridades: sefaz.autoridades, tempoLimiteMs: 1500 });
    destino = { ambiente: "HOMOLOGACAO", credencial: { chavePem: lido.chavePem, certificadoPem: lido.certificadoPem } };
  });

  afterAll(async () => {
    usarSefazDeTesteDoMdfe(null);
    await sefaz.fechar();
  });

  const esperado = (mdfe: { chave: string; xml: string }) => ({ chave: mdfe.chave, ambiente: "HOMOLOGACAO" as const, resumo: resumoDaAssinatura(mdfe.xml) });

  it("endereços: SVRS, um por serviço e ambiente, e o envelope com mdfeDadosMsg", () => {
    expect(enderecoDoServico("recepcao", "PRODUCAO")).toBe("https://mdfe.svrs.rs.gov.br/ws/MDFeRecepcaoSinc/MDFeRecepcaoSinc.asmx");
    expect(enderecoDoServico("naoEncerrados", "HOMOLOGACAO")).toBe("https://mdfe-homologacao.svrs.rs.gov.br/ws/MDFeConsNaoEnc/MDFeConsNaoEnc.asmx");
    expect(enderecoDoServico("evento", "HOMOLOGACAO")).toBe("https://mdfe-homologacao.svrs.rs.gov.br/ws/MDFeRecepcaoEvento/MDFeRecepcaoEvento.asmx");
    expect(Object.values(SERVICOS).map((servico) => servico.metodo)).toEqual(["mdfeRecepcao", "mdfeConsultaMDF", "mdfeConsNaoEnc", "mdfeStatusServicoMDF", "mdfeRecepcaoEvento"]);
    expect(envelope("MDFeRecepcaoSinc", "abc", "mdfe")).toContain('<soap12:Body><mdfeDadosMsg xmlns="http://www.portalfiscal.inf.br/mdfe/wsdl/MDFeRecepcaoSinc">abc</mdfeDadosMsg></soap12:Body>');
    // O envelope do CT-e continua como era.
    expect(envelope("CTeRecepcaoSincV4", "abc")).toContain('<cteDadosMsg xmlns="http://www.portalfiscal.inf.br/cte/wsdl/CTeRecepcaoSincV4">abc</cteDadosMsg>');
  });

  it("status do serviço: em operação e parado", async () => {
    sefaz.modo = "autorizar";
    expect(await statusDoServico(destino)).toEqual({ cStat: 107, motivo: "Serviço em Operação", emOperacao: true });
    sefaz.modo = "parado";
    expect((await statusDoServico(destino)).emOperacao).toBe(false);
    sefaz.modo = "autorizar";
    const chamada = sefaz.chamadas.at(-1);
    expect(chamada?.servico).toBe("MDFeStatusServico");
    expect(chamada?.acao).toContain('action="http://www.portalfiscal.inf.br/mdfe/wsdl/MDFeStatusServico/mdfeStatusServicoMDF"');
    // A conexão apresentou o certificado do emitente (autenticação mútua).
    expect(chamada?.certificadoDoCliente).toBe(impressaoDigital(lido.titularPem));
  });

  it("recepção: envia compactado (GZip + Base64) e autoriza com protocolo para a chave enviada", async () => {
    sefaz.modo = "autorizar";
    const mdfe = assinado(mdfeDeExemplo({ numero: 101 }));
    const resposta = await enviarMdfe(destino, mdfe.xml);
    const decisao = decidir(resposta, esperado(mdfe));
    expect(decisao.tipo).toBe("autorizado");
    if (decisao.tipo !== "autorizado") return;
    expect(decisao.protocolo.numero).toMatch(/^9\d{14}$/);
    expect(decisao.protocolo.chave).toBe(mdfe.chave);
    expect(decisao.protocolo.xml.startsWith("<protMDFe")).toBe(true);
    // O servidor recebeu exatamente o XML assinado.
    expect(sefaz.chamadas.at(-1)?.dados).toBe(mdfe.xml);
    expect(assinaturaConfere(sefaz.chamadas.at(-1)?.dados ?? "", lido.titularPem)).toBe(true);
    // O mdfeProc com o protocolo devolvido é válido.
    expect(await errosNoEsquemaDoMdfe(montarProcMdfe(mdfe.xml, decisao.protocolo.xml), "procMDFe_v3.00.xsd")).toEqual([]);
  });

  it("rejeição comum e rejeição por MDF-e não encerrado (611) não autorizam", async () => {
    const mdfe = assinado(mdfeDeExemplo({ numero: 102 }));
    sefaz.modo = "rejeitar";
    expect(decidir(await enviarMdfe(destino, mdfe.xml), esperado(mdfe))).toMatchObject({ tipo: "rejeitado", cStat: 698 });
    sefaz.modo = "nao-encerrado";
    const decisao = decidir(await enviarMdfe(destino, mdfe.xml), esperado(mdfe));
    expect(decisao).toMatchObject({ tipo: "rejeitado", cStat: CSTAT.NAO_ENCERRADO_PARA_A_PLACA });
    expect(decisao.tipo === "rejeitado" ? decisao.motivo : "").toMatch(/não encerrado para esta placa/);
    sefaz.modo = "autorizar";
  });

  it("duplicidade (204), número usado (539), serviço parado e respostas que não fecham", async () => {
    const mdfe = assinado(mdfeDeExemplo({ numero: 103 }));
    sefaz.modo = "duplicidade";
    expect(decidir(await enviarMdfe(destino, mdfe.xml), esperado(mdfe)).tipo).toBe("ja-autorizado");
    sefaz.modo = "numero-usado";
    expect(decidir(await enviarMdfe(destino, mdfe.xml), esperado(mdfe)).tipo).toBe("numero-usado");
    sefaz.modo = "parado";
    expect(decidir(await enviarMdfe(destino, mdfe.xml), esperado(mdfe))).toMatchObject({ tipo: "parado", cStat: 108 });
    // "Autorizado" sem protocolo, ou com protocolo de outra chave, não vale como autorização.
    sefaz.modo = "sem-protocolo";
    expect(decidir(await enviarMdfe(destino, mdfe.xml), esperado(mdfe)).tipo).toBe("incoerente");
    sefaz.modo = "outra-chave";
    expect(decidir(await enviarMdfe(destino, mdfe.xml), esperado(mdfe)).tipo).toBe("incoerente");
    sefaz.modo = "autorizar";
    expect(sefaz.autorizados.has(mdfe.chave)).toBe(false);
  });

  it("serviço que não responde, erro de SOAP e conexão sem certificado", async () => {
    const mdfe = assinado(mdfeDeExemplo({ numero: 104 }));
    sefaz.modo = "mudo";
    await expect(enviarMdfe({ ...destino, tempoLimiteMs: 300 }, mdfe.xml)).rejects.toMatchObject({ name: "SefazError", motivo: "tempo", message: SEFAZ_TEMPO_ESGOTADO, incerto: true });
    sefaz.modo = "fault";
    await expect(enviarMdfe(destino, mdfe.xml)).rejects.toMatchObject({ motivo: "resposta", incerto: true });
    sefaz.modo = "autorizar";
    await expect(statusDoServico({ ...destino, credencial: null })).rejects.toBeInstanceOf(SefazError);
    usarSefazDeTesteDoMdfe({ url: "https://127.0.0.1:1", autoridades: sefaz.autoridades, tempoLimiteMs: 1500 });
    await expect(statusDoServico(destino)).rejects.toMatchObject({ motivo: "conexao", message: SEFAZ_FORA_DO_AR, incerto: false });
    usarSefazDeTesteDoMdfe({ url: sefaz.url, autoridades: sefaz.autoridades, tempoLimiteMs: 1500 });
  });

  it("consulta pela chave: não consta, autorizado, encerrado e cancelado", async () => {
    sefaz.modo = "autorizar";
    const mdfe = assinado(mdfeDeExemplo({ numero: 105 }));
    expect((await consultarMdfe(destino, mdfe.chave)).cStat).toBe(CSTAT.NAO_CONSTA);
    await enviarMdfe(destino, mdfe.xml);
    expect(decidir(await consultarMdfe(destino, mdfe.chave), esperado(mdfe)).tipo).toBe("autorizado");
    sefaz.encerrados.add(mdfe.chave);
    expect((await consultarMdfe(destino, mdfe.chave)).cStat).toBe(CSTAT.ENCERRADO);
    sefaz.encerrados.delete(mdfe.chave);
    sefaz.cancelados.add(mdfe.chave);
    expect((await consultarMdfe(destino, mdfe.chave)).cStat).toBe(CSTAT.CANCELADO);
  });

  it("consulta de não encerrados: nenhum (112), a relação (111) e a recusa da consulta", async () => {
    sefaz.modo = "autorizar";
    const outroCnpj = await consultarNaoEncerrados(destino, "45543915000181");
    expect(outroCnpj).toEqual({ cStat: CSTAT.NENHUM_NAO_ENCERRADO, motivo: "MDF-e não encerrados não localizados", mdfes: [] });

    const mdfe = assinado(mdfeDeExemplo({ numero: 106 }));
    await enviarMdfe(destino, mdfe.xml);
    const abertos = await consultarNaoEncerrados(destino, "11222333000181");
    expect(abertos.cStat).toBe(CSTAT.NAO_ENCERRADOS_LOCALIZADOS);
    expect(abertos.mdfes.map((aberto) => aberto.chave)).toContain(mdfe.chave);
    expect(abertos.mdfes.find((aberto) => aberto.chave === mdfe.chave)?.protocolo).toBe(sefaz.autorizados.get(mdfe.chave)?.protocolo);
    expect(sefaz.chamadas.at(-1)?.dados).toBe(mensagemDeNaoEncerrados("11222333000181", "HOMOLOGACAO"));

    sefaz.modo = "rejeitar";
    expect(await consultarNaoEncerrados(destino, "11222333000181")).toMatchObject({ cStat: 203, mdfes: [] });
    sefaz.modo = "autorizar";
  });

  it("eventos: encerramento registrado, repetição recusada (609) e cancelamento fora do prazo (220)", async () => {
    sefaz.modo = "autorizar";
    const mdfe = assinado(mdfeDeExemplo({ numero: 107 }));
    await enviarMdfe(destino, mdfe.xml);
    const protocolo = sefaz.autorizados.get(mdfe.chave)?.protocolo ?? "";
    const base = { chave: mdfe.chave, cnpj: "11222333000181", ambiente: "HOMOLOGACAO" as const, quando: new Date() };

    const condutor = assinarXml(montarInclusaoDeCondutor({ ...base, sequencia: 1, condutor: { nome: "Maria de Souza", cpf: "11144477735" } }).xml, ALVO_DO_EVENTO_DO_MDFE, chaveDeAssinatura());
    const incluido = await enviarEvento(destino, condutor);
    expect(eventoRegistrado(incluido, { chave: mdfe.chave, tipo: TIPO_DO_EVENTO.INCLUSAO_DE_CONDUTOR })).toBe(true);
    expect(sefaz.chamadas.at(-1)?.dados).toBe(condutor);

    sefaz.modo = "rejeitar";
    const cancelamento = assinarXml(montarCancelamento({ ...base, protocolo, justificativa: "Viagem cancelada pelo cliente" }).xml, ALVO_DO_EVENTO_DO_MDFE, chaveDeAssinatura());
    const recusado = await enviarEvento(destino, cancelamento);
    expect(recusado.cStat).toBe(220);
    expect(eventoRegistrado(recusado, { chave: mdfe.chave, tipo: TIPO_DO_EVENTO.CANCELAMENTO })).toBe(false);
    sefaz.modo = "autorizar";

    const encerramento = assinarXml(montarEncerramento({ ...base, protocolo, dia: "2026-10-11", municipio: { codigo: "3106200", uf: "MG" } }).xml, ALVO_DO_EVENTO_DO_MDFE, chaveDeAssinatura());
    const encerrado = await enviarEvento(destino, encerramento);
    expect(eventoRegistrado(encerrado, { chave: mdfe.chave, tipo: TIPO_DO_EVENTO.ENCERRAMENTO })).toBe(true);
    expect(encerrado.protocolo).toMatch(/^\d{15}$/);
    expect(encerrado.xml.startsWith("<retEventoMDFe")).toBe(true);
    expect((await consultarMdfe(destino, mdfe.chave)).cStat).toBe(CSTAT.ENCERRADO);
    expect((await enviarEvento(destino, encerramento)).cStat).toBe(CSTAT.JA_ENCERRADO);
    // Encerrado, sai da relação de não encerrados.
    expect((await consultarNaoEncerrados(destino, "11222333000181")).mdfes.map((aberto) => aberto.chave)).not.toContain(mdfe.chave);
  });

  it("o conteúdo da recepção é mesmo GZip em Base64", () => {
    // Conferência direta do que vai no `mdfeDadosMsg` da recepção, sem passar pelo servidor.
    const mdfe = assinado(mdfeDeExemplo({ numero: 108 }));
    const base64 = compactar(mdfe.xml);
    expect(base64).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(gunzipSync(Buffer.from(base64, "base64")).toString("utf8")).toBe(mdfe.xml);
  });
});
