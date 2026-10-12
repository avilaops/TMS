import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chaveValida } from "../src/lib/nfe";
import {
  CIOT_OBRIGATORIO_DESDE,
  CONFIRME_QUE_NAO_SAIU,
  PRAZO_DA_CONTINGENCIA_HORAS,
  QUANDO_ALTERAR_O_PAGAMENTO,
  QUANDO_INFORMAR_O_PAGAMENTO,
  SEGURO_INCOMPLETO,
  alteracaoDoPagamentoSchema,
  avisoDoPrazoDaContingencia,
  chaveDeContingencia,
  pagamentoDaOperacaoSchema,
  prazoDaContingencia,
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
  faltasParaSair,
  fraseDoBloqueioDaSaida,
  haFaltasParaSair,
  rotuloDaFaltaDeMdfe,
  avisoDeViagemSemMdfe,
  AVISO_DE_VIAGEM_SEM_MDFE,
  seloDoMdfe,
} from "../src/lib/mdfe";
import { ALVO_DO_CTE, assinarTexto, assinarXml, assinaturaConfere, assinaturaDoTextoConfere, resumoDaAssinatura } from "../src/lib/cte/assinar";
import { lerCertificado } from "../src/lib/cte/certificado";
import { ChaveInvalida } from "../src/lib/cte/chave";
import { compactar, decidir, eventoGuardadoComRessalva, eventoRegistrado, fraseDoEventoComRessalva, type Protocolo, type RespostaDoEvento } from "../src/lib/cte/sefaz";
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
  montarAlteracaoDoPagamento,
  montarCancelamento,
  montarEncerramento,
  montarPagamentoDaOperacao,
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
  FINALIZADOS_DO_MDFE,
  REJEICOES_POR_NAO_ENCERRADO,
  consultarMdfe,
  consultarNaoEncerrados,
  decidirMdfe,
  enviarEvento,
  enviarMdfe,
  statusDoServico,
  usarSefazDeTesteDoMdfe,
  type DestinoDoMdfe,
} from "../src/lib/mdfe/sefaz";
import { municipioDoTexto } from "../src/lib/municipios";
import { montarCte } from "../src/lib/cte/montar";
import { codigoDeSeguranca, hashDoCsrt, responsavelTecnico, responsavelTecnicoDoXml, semResponsavelTecnico } from "../src/lib/cte/responsavel-tecnico";
import { RESPONSAVEL_TECNICO, certificadoDeTeste, dadosDeExemplo, errosNoEsquema, impressaoDigital, type CertificadoDeTeste } from "./cte-apoio";
import { CENARIOS_DO_MDFE, EMITENTE_DO_MDFE, RODO, SEGURO, chaveDeExemplo, detalheDoEvento, errosNoEsquemaDoMdfe, mdfeDeExemplo, modalDoXml, subirSefazDoMdfe, type SefazDoMdfe } from "./mdfe-apoio";

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
    expect(chaveDoMdfe({ uf: "SP", emissao: virada, cnpj: "99000108000141", serie: 1, numero: 1, codigo: "00000001" }).slice(2, 6)).toBe("2610");
  });

  it("aceita CNPJ alfanumérico (NT Conjunta 2025.001) e o dígito confere", () => {
    const chave = chaveDoMdfe({ uf: "SP", emissao: new Date("2026-10-10T12:00:00Z"), cnpj: "12ABC34501DE35", serie: 3, numero: 120, codigo: "12345678" });
    expect(chave).toMatch(/^[0-9]{6}[A-Z0-9]{12}[0-9]{26}$/);
    expect(chaveValida(chave)).toBe(true);
  });

  it("recusa parte fora do formato", () => {
    const base = { uf: "SP", emissao: new Date(), cnpj: "99000108000141", serie: 1, numero: 1, codigo: "00000001" };
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
    expect(xml).toContain(`<infCIOT><CIOT>123456789012</CIOT><CNPJ>99000108000141</CNPJ></infCIOT>`);
    expect(xml).toContain("<seg><infResp><respSeg>1</respSeg></infResp><infSeg><xSeg>Seguradora de Teste S/A</xSeg><CNPJ>99000502000180</CNPJ></infSeg><nApol>AP-2026-0001</nApol><nAver>");
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
      descargas: [{ municipio: { codigo: "3106200", nome: "Belo Horizonte" }, chaves: [chaveDeExemplo("55", 100, "35", "99000303000171"), chaveDeExemplo("55", 101, "35", "99000303000171")] }],
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
    expect(tipoDeTransportador({ ...tac, documento: "99000303000171" })).toBe("1");
    expect(tipoDeTransportador(null)).toBeNull();
  });

  it("com vale-pedágio e pagamento do frete a prazo (carga lotação)", async () => {
    const dados = mdfeDeExemplo({
      descargas: [{ municipio: { codigo: "3106200", nome: "Belo Horizonte" }, chaves: [chaveDeExemplo("57", 40)] }],
      produto: { tipoDeCarga: "05", descricao: "Rolamentos", ncm: "84821010", lotacao: { cepDeCarregamento: "15035000", cepDeDescarregamento: "30160011" } },
      rodo: {
        ...RODO,
        ciots: [{ codigo: "123456789012", documento: "99000108000141" }],
        valePedagio: { categoria: "04", dispositivos: [{ cnpjDoFornecedor: "99000502000180", pagador: "99000108000141", compra: "12345", valor: 150.5, tipo: "01" }] },
        pagamentos: [
          {
            nome: "Indústria Remetente S/A",
            documento: "99000303000171",
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
    expect(xml).toContain("<valePed><disp><CNPJForn>99000502000180</CNPJForn><CNPJPg>99000108000141</CNPJPg><nCompra>12345</nCompra><vValePed>150.50</vValePed><tpValePed>01</tpValePed></disp><categCombVeic>04</categCombVeic></valePed>");
    expect(xml).toContain("<Comp><tpComp>04</tpComp><vComp>3000.00</vComp></Comp><vContrato>3000.00</vContrato><indPag>1</indPag><vAdiant>1000.00</vAdiant>");
    expect(xml).toContain("<infPrazo><nParcela>001</nParcela><dVenc>2026-11-10</dVenc><vParcela>1000.00</vParcela></infPrazo><infPrazo><nParcela>002</nParcela>");
    expect(xml).toContain("<infBanc><PIX>financeiro@transportadora.com.br</PIX></infBanc>");
    expect(xml).toContain("<NCM>84821010</NCM><infLotacao><infLocalCarrega><CEP>15035000</CEP></infLocalCarrega><infLocalDescarrega><CEP>30160011</CEP></infLocalDescarrega></infLotacao>");
  });

  it("pagamento à vista em banco e agência, e por instituição de pagamento", async () => {
    const pagamento = { documento: "99000303000171", valor: 1200.4, aPrazo: false, adiantamento: 500, parcelas: [{ vencimento: "2026-11-10", valor: 700.4 }] };
    const comBanco = mdfeDeExemplo({ rodo: { ...RODO, ciots: mdfeDeExemplo().rodo.ciots, pagamentos: [{ ...pagamento, conta: { banco: "001", agencia: "1234" } }, { ...pagamento, conta: { cnpjDaIpef: "99000502000180" } }] } });
    expect(await erros(comBanco)).toEqual([]);
    const { xml } = assinado(comBanco);
    // À vista não leva adiantamento nem parcela, mesmo que tenham vindo (regras F53 e F63).
    expect(xml).not.toContain("<vAdiant>");
    expect(xml).not.toContain("<infPrazo>");
    expect(xml).toContain("<infBanc><codBanco>001</codBanco><codAgencia>1234</codAgencia></infBanc>");
    expect(xml).toContain("<infBanc><CNPJIPEF>99000502000180</CNPJIPEF></infBanc>");
  });

  it("lacres, seguro por conta do contratante e texto fora do padrão do esquema", async () => {
    const dados = mdfeDeExemplo({
      emitente: { ...EMITENTE_DO_MDFE, razaoSocial: "Transportes “Rápido” – Açaí & Cia <Ltda>", telefone: "(17) 3242-1000" },
      seguros: [{ ...SEGURO, responsavel: "2", documento: "99000303000171", averbacoes: ["AV-1", "AV-2"] }],
      lacres: ["LACRE-001", "LACRE-002"],
      observacao: "Viagem A1B2C3 — conferir\nlacres",
    });
    expect(await erros(dados)).toEqual([]);
    const { xml } = assinado(dados);
    expect(xml).toContain('<xNome>Transportes "Rápido" - Açaí &amp; Cia &lt;Ltda&gt;</xNome>');
    expect(xml).toContain("<fone>1732421000</fone>");
    expect(xml).toContain("<infResp><respSeg>2</respSeg><CNPJ>99000303000171</CNPJ></infResp>");
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
    const deOutraEmpresa = certificadoDeTeste({ cnpj: "99000303000171" });
    const outro = lerCertificado(deOutraEmpresa.pfx, deOutraEmpresa.senha);
    expect(assinaturaConfere(xml, outro.titularPem)).toBe(false);
  });
});

/* ------------------------------------ Eventos --------------------------------- */

describe("eventos do MDF-e, validados no esquema oficial", () => {
  const chave = chaveDeExemplo("58", 7);
  const base = { chave, cnpj: "99000108000141", ambiente: "HOMOLOGACAO" as const, quando: new Date("2026-10-11T12:00:00.000Z") };
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
    expect(xml).toContain(`<cOrgao>35</cOrgao><tpAmb>2</tpAmb><CNPJ>99000108000141</CNPJ><chMDFe>${chave}</chMDFe><dhEvento>2026-10-11T09:00:00-03:00</dhEvento><tpEvento>110112</tpEvento><nSeqEvento>1</nSeqEvento>`);
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
        { descarga: { codigo: "3549805", nome: "São José do Rio Preto" }, chave: chaveDeExemplo("55", 200, "35", "99000303000171") },
        { descarga: { codigo: "3549805", nome: "São José do Rio Preto" }, chave: chaveDeExemplo("55", 201, "35", "99000303000171") },
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
    expect(await errosNoEsquemaDoMdfe(mensagemDeNaoEncerrados("99000108000141", "HOMOLOGACAO"), "consMDFeNaoEnc_v3.00.xsd")).toEqual([]);
    expect(mensagemDeNaoEncerrados("99000108000141", "HOMOLOGACAO")).toContain("<xServ>CONSULTAR NÃO ENCERRADOS</xServ><CNPJ>99000108000141</CNPJ>");
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
  cliente: { nome: "Indústria Remetente S/A", documento: "99.000.303/0001-71" },
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

const ENTRADAS = entradasSchema.parse({ ciots: [{ codigo: "123456789012", documento: "99.000.108/0001-41" }], seguro: { ...SEGURO, averbacoes: ["AV-123"] } });

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
    expect(mg.dados?.rodo.contratantes).toEqual([{ nome: "Indústria Remetente S/A", documento: "99000303000171" }]);

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
      pagamento: { documento: "99.000.303/0001-71", valor: "850,50", aPrazo: false, conta: { pix: "99000108000141" } },
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
    const nota = (numero: number) => ({ chave: chaveDeExemplo("55", numero, "35", "99000108000141"), valor: 1500, peso: 80 });
    const cargas = [carga(1, { cte: null, notas: [nota(1), nota(2)] }), carga(2, { cte: null, notas: [], invoiceKey: chaveDeExemplo("55", 3, "35", "99000108000141") })];
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
    const daEmpresa = prepararMdfe(viagem(cargas, { veiculo: { ...VEICULO, proprietario: { documento: "99000108000141", nome: "x", rntrc: null, ie: null, uf: null, tipo: null } } }), "MG", ENTRADAS, contexto());
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
    const inteiro = configuracaoSchema.parse({ ...base, seguradora: "Seguradora X", cnpjDaSeguradora: "99.000.502/0001-80", apolice: "123" });
    expect(inteiro.cnpjDaSeguradora).toBe("99000502000180");
  });

  it("entradas: CIOT, vale-pedágio, seguro e pagamento", () => {
    expect(entradasSchema.safeParse({}).success).toBe(true);
    expect(entradasSchema.safeParse({ ciots: [{ codigo: "123", documento: "99000108000141" }] }).success).toBe(false);
    expect(entradasSchema.parse({ ciots: [{ codigo: "", documento: "529.982.247-25" }] }).ciots).toEqual([{ codigo: null, documento: "52998224725" }]);
    expect(entradasSchema.safeParse({ ciots: [{ documento: "52998224726" }] }).success).toBe(false);
    expect(entradasSchema.safeParse({ percurso: ["PR", "XX"] }).success).toBe(false);
    expect(entradasSchema.safeParse({ reboques: ["a", "b", "c", "d"] }).success).toBe(false);
    expect(entradasSchema.safeParse({ valePedagio: { categoria: "03", cnpjDoFornecedor: "99000502000180", valor: "10" } }).success).toBe(false);
    expect(entradasSchema.safeParse({ valePedagio: { categoria: "04", cnpjDoFornecedor: "99000502000180", valor: "10", tipo: "02" } }).success).toBe(false);
    expect(entradasSchema.safeParse({ seguro: { ...SEGURO, responsavel: "2" } }).success).toBe(false);

    const pagamento = { documento: "99000303000171", valor: "3000", conta: { pix: "chave@pix.com" } };
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
    const outroCnpj = await consultarNaoEncerrados(destino, "99000303000171");
    expect(outroCnpj).toEqual({ cStat: CSTAT.NENHUM_NAO_ENCERRADO, motivo: "MDF-e não encerrados não localizados", mdfes: [] });

    const mdfe = assinado(mdfeDeExemplo({ numero: 106 }));
    await enviarMdfe(destino, mdfe.xml);
    const abertos = await consultarNaoEncerrados(destino, "99000108000141");
    expect(abertos.cStat).toBe(CSTAT.NAO_ENCERRADOS_LOCALIZADOS);
    expect(abertos.mdfes.map((aberto) => aberto.chave)).toContain(mdfe.chave);
    expect(abertos.mdfes.find((aberto) => aberto.chave === mdfe.chave)?.protocolo).toBe(sefaz.autorizados.get(mdfe.chave)?.protocolo);
    expect(sefaz.chamadas.at(-1)?.dados).toBe(mensagemDeNaoEncerrados("99000108000141", "HOMOLOGACAO"));

    sefaz.modo = "rejeitar";
    expect(await consultarNaoEncerrados(destino, "99000108000141")).toMatchObject({ cStat: 203, mdfes: [] });
    sefaz.modo = "autorizar";
  });

  it("eventos: encerramento registrado, repetição recusada (609) e cancelamento fora do prazo (220)", async () => {
    sefaz.modo = "autorizar";
    const mdfe = assinado(mdfeDeExemplo({ numero: 107 }));
    await enviarMdfe(destino, mdfe.xml);
    const protocolo = sefaz.autorizados.get(mdfe.chave)?.protocolo ?? "";
    const base = { chave: mdfe.chave, cnpj: "99000108000141", ambiente: "HOMOLOGACAO" as const, quando: new Date() };

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
    expect((await consultarNaoEncerrados(destino, "99000108000141")).mdfes.map((aberto) => aberto.chave)).not.toContain(mdfe.chave);
  });

  it("o conteúdo da recepção é mesmo GZip em Base64", () => {
    // Conferência direta do que vai no `mdfeDadosMsg` da recepção, sem passar pelo servidor.
    const mdfe = assinado(mdfeDeExemplo({ numero: 108 }));
    const base64 = compactar(mdfe.xml);
    expect(base64).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(gunzipSync(Buffer.from(base64, "base64")).toString("utf8")).toBe(mdfe.xml);
  });
});

/* ------------------- Correções da revisão fiscal do MDF-e ---------------------- */

describe("correções da revisão: fuso da UF do emitente e responsável técnico", () => {
  // 01/11/2026 às 03:30 UTC: 00:30 de 01/11 em Brasília, 23:30 de 31/10 em Cuiabá, 22:30 de 31/10 em Rio Branco.
  const virada = new Date("2026-11-01T03:30:00.000Z");
  const emitenteEm = (uf: "MT" | "AC") => ({
    ...EMITENTE_DO_MDFE,
    endereco:
      uf === "MT"
        ? { logradouro: "Av. do CPA", numero: "500", bairro: "Centro Político", codigoMunicipio: "5103403", municipio: "Cuiabá", uf: "MT", cep: "78049000" }
        : { logradouro: "Av. Ceará", numero: "900", bairro: "Centro", codigoMunicipio: "1200401", municipio: "Rio Branco", uf: "AC", cep: "69900000" },
  });

  it.each(Object.keys(CENARIOS_DO_MDFE))("o cenário %s passa no esquema oficial, assinado, com o modal", async (nome) => {
    expect(await erros(CENARIOS_DO_MDFE[nome]())).toEqual([]);
  });

  it("emitente em UF de UTC-4 (MT): dhEmi e dhIniViagem no fuso da UF, e a chave com o AAMM do dhEmi", async () => {
    const dados = mdfeDeExemplo({ emitente: emitenteEm("MT"), emissao: virada, inicioDaViagem: new Date("2026-11-01T05:00:00.000Z") });
    expect(await erros(dados)).toEqual([]);
    const { xml, chave } = assinado(dados);
    expect(xml).toContain("<cUF>51</cUF>");
    expect(xml).toContain("<dhEmi>2026-10-31T23:30:00-04:00</dhEmi>");
    expect(xml).toContain("<dhIniViagem>2026-11-01T01:00:00-04:00</dhIniViagem>");
    expect(chave.slice(0, 6)).toBe("512610");
    expect(chaveValida(chave)).toBe(true);
  });

  it("emitente em UF de UTC-5 (AC), e o de UTC-3 no mesmo instante cai no mês seguinte", async () => {
    const dados = mdfeDeExemplo({ emitente: emitenteEm("AC"), emissao: virada, inicioDaViagem: null });
    expect(await erros(dados)).toEqual([]);
    const ac = assinado(dados);
    expect(ac.xml).toContain("<dhEmi>2026-10-31T22:30:00-05:00</dhEmi>");
    expect(ac.chave.slice(0, 6)).toBe("122610");

    const sp = assinado(mdfeDeExemplo({ emissao: virada }));
    expect(sp.xml).toContain("<dhEmi>2026-11-01T00:30:00-03:00</dhEmi>");
    expect(sp.chave.slice(0, 6)).toBe("352611");
    expect(chaveDoMdfe({ uf: "AM", emissao: virada, cnpj: "99000108000141", serie: 1, numero: 1, codigo: "00000001" }).slice(0, 6)).toBe("132610");
  });

  it("os eventos vão no fuso da UF do emitente (a que abre a chave do MDF-e), e passam no esquema", async () => {
    const quando = new Date("2026-10-11T12:00:00.000Z");
    const comum = { cnpj: "99000108000141", ambiente: "HOMOLOGACAO" as const, quando, protocolo: "951260000000001" };
    const assinar = (xml: string) => assinarXml(xml, ALVO_DO_EVENTO_DO_MDFE, chaveDeAssinatura());

    const deMt = montarEncerramento({ ...comum, chave: chaveDeExemplo("58", 7, "51"), dia: "2026-10-11", municipio: { codigo: "3106200", uf: "MG" } });
    expect(deMt.xml).toContain("<cOrgao>51</cOrgao>");
    expect(deMt.xml).toContain("<dhEvento>2026-10-11T08:00:00-04:00</dhEvento>");
    expect(await errosNoEsquemaDoMdfe(assinar(deMt.xml), "eventoMDFe_v3.00.xsd")).toEqual([]);

    const doAc = montarCancelamento({ ...comum, chave: chaveDeExemplo("58", 7, "12"), justificativa: "Viagem cancelada pelo cliente antes da saída" });
    expect(doAc.xml).toContain("<dhEvento>2026-10-11T07:00:00-05:00</dhEvento>");
    expect(await errosNoEsquemaDoMdfe(assinar(doAc.xml), "eventoMDFe_v3.00.xsd")).toEqual([]);

    const deRo = montarInclusaoDeCondutor({ ...comum, chave: chaveDeExemplo("58", 7, "11"), sequencia: 1, condutor: { nome: "Maria de Souza", cpf: "11144477735" } });
    expect(deRo.xml).toContain("<dhEvento>2026-10-11T08:00:00-04:00</dhEvento>");
    const deSp = montarInclusaoDeCondutor({ ...comum, chave: chaveDeExemplo("58", 7, "35"), sequencia: 1, condutor: { nome: "Maria de Souza", cpf: "11144477735" } });
    expect(deSp.xml).toContain("<dhEvento>2026-10-11T09:00:00-03:00</dhEvento>");
    expect(() => montarCancelamento({ ...comum, chave: chaveDeExemplo("58", 7, "99"), justificativa: "Viagem cancelada pelo cliente antes da saída" })).toThrow(ChaveInvalida);
  });

  it("infRespTec: com os dados o grupo vai depois de infAdic e passa no esquema; sem eles o MDF-e vai sem o grupo", async () => {
    const com = assinado(mdfeDeExemplo({ responsavelTecnico: RESPONSAVEL_TECNICO }));
    expect(await erros(mdfeDeExemplo({ responsavelTecnico: RESPONSAVEL_TECNICO }))).toEqual([]);
    expect(com.xml).toContain(
      "<infAdic><infCpl>Viagem A1B2C3</infCpl></infAdic><infRespTec><CNPJ>99888777000100</CNPJ><xContato>Suporte de Teste</xContato><email>suporte@desenvolvedora.example</email><fone>1730001000</fone></infRespTec></infMDFe>",
    );
    const sem = assinado();
    expect(await erros()).toEqual([]);
    expect(sem.xml).not.toContain("infRespTec");
    expect(sem.xml).toContain("</infAdic></infMDFe>");
    // Sem observação o grupo continua no lugar: depois do total.
    const semObservacao = assinado(mdfeDeExemplo({ observacao: null, responsavelTecnico: RESPONSAVEL_TECNICO }));
    expect(await errosNoEsquemaDoMdfe(semObservacao.xml, "mdfe_v3.00.xsd")).toEqual([]);
    expect(semObservacao.xml).toContain("</tot><infRespTec>");
    // O validador recusa o grupo fora do tipo.
    const errado = com.xml.replace("<fone>1730001000</fone></infRespTec>", "<fone>17-3000</fone></infRespTec>");
    expect((await errosNoEsquemaDoMdfe(errado, "mdfe_v3.00.xsd")).join(" ")).toMatch(/fone/);
  });

  it("a conferência avisa quando o servidor não tem os dados do responsável técnico, e leva o grupo quando tem", () => {
    const sem = prepararMdfe(viagem([carga(1), carga(2)]), "MG", ENTRADAS, contexto());
    expect(sem.pendencias).toEqual([]);
    expect(sem.avisos).toContain(semResponsavelTecnico("mdfe"));
    expect(semResponsavelTecnico("mdfe")).toContain("(720)");
    expect(sem.dados?.responsavelTecnico).toBeNull();

    const com = prepararMdfe(viagem([carga(1), carga(2)]), "MG", ENTRADAS, contexto({ responsavelTecnico: RESPONSAVEL_TECNICO }));
    expect(com.avisos).not.toContain(semResponsavelTecnico("mdfe"));
    expect(com.dados?.responsavelTecnico).toEqual(RESPONSAVEL_TECNICO);
    expect(montarMdfe({ ...com.dados!, numero: 3, codigo: "12345678", emissao: new Date("2026-10-10T15:00:00.000Z") }).xml).toContain("<infRespTec><CNPJ>99888777000100</CNPJ>");
  });
});

/* ----------------------- Documentos antes da saída ----------------------------- */

describe("o que falta de documento fiscal para a viagem sair (Ajustes SINIEF 09/07 e 21/10)", () => {
  const interestadual = { id: "c1", codigo: "TRK1", ufDeOrigem: "SP", ufDeDestino: "MG", mesmoMunicipio: false, cteAutorizado: false };
  const intermunicipal = { id: "c2", codigo: "TRK2", ufDeOrigem: "SP", ufDeDestino: "SP", mesmoMunicipio: false, cteAutorizado: false };
  const municipal = { id: "c3", codigo: "TRK3", ufDeOrigem: "SP", ufDeDestino: "SP", mesmoMunicipio: true, cteAutorizado: false };

  it("transportadora: CT-e de cada carga que sai do município, e MDF-e quando a viagem o exige", () => {
    expect(faltasParaSair([interestadual, intermunicipal, municipal], "1", ["MG", "SP"], [])).toEqual({ ctes: [{ id: "c1", codigo: "TRK1" }, { id: "c2", codigo: "TRK2" }], mdfe: { exigencia: "interestadual", ufs: ["MG", "SP"] } });
    expect(faltasParaSair([{ ...interestadual, cteAutorizado: true }, intermunicipal], "1", ["MG", "SP"], ["SP"])).toEqual({ ctes: [{ id: "c2", codigo: "TRK2" }], mdfe: { exigencia: "interestadual", ufs: ["MG"] } });
    expect(faltasParaSair([{ ...intermunicipal, cteAutorizado: true }], "1", ["SP"], [])).toEqual({ ctes: [], mdfe: { exigencia: "intermunicipal", ufs: ["SP"] } });
    const tudo = faltasParaSair([{ ...interestadual, cteAutorizado: true }], "1", ["MG"], ["MG"]);
    expect(tudo).toEqual({ ctes: [], mdfe: null });
    expect(haFaltasParaSair(tudo)).toBe(false);
    // Dentro do município não há CT-e nem MDF-e a exigir.
    expect(haFaltasParaSair(faltasParaSair([municipal], "1", [], []))).toBe(false);
    // Cidade fora da tabela: não dá para dizer que é municipal, então exige.
    expect(faltasParaSair([{ ...municipal, ufDeOrigem: null, mesmoMunicipio: false }], "1", ["SP"], [])).toEqual({ ctes: [{ id: "c3", codigo: "TRK3" }], mdfe: { exigencia: "intermunicipal", ufs: ["SP"] } });
  });

  it("um MDF-e por UF de descarregamento: o de uma UF não cobre a outra", () => {
    const paraORio = { ...interestadual, id: "c4", codigo: "TRK4", ufDeDestino: "RJ", cteAutorizado: true };
    const cargas = [{ ...interestadual, cteAutorizado: true }, paraORio];
    // SP -> MG + RJ com o MDF-e de MG só: falta o do RJ.
    expect(faltasParaSair(cargas, "1", ["MG", "RJ"], ["MG"])).toEqual({ ctes: [], mdfe: { exigencia: "interestadual", ufs: ["RJ"] } });
    expect(faltasParaSair(cargas, "1", ["MG", "RJ"], [])).toEqual({ ctes: [], mdfe: { exigencia: "interestadual", ufs: ["MG", "RJ"] } });
    expect(haFaltasParaSair(faltasParaSair(cargas, "1", ["MG", "RJ"], ["RJ", "MG"]))).toBe(false);
    // MDF-e de uma UF em que a viagem não descarrega não cobre nenhuma.
    expect(faltasParaSair(cargas, "1", ["MG", "RJ"], ["GO"]).mdfe?.ufs).toEqual(["MG", "RJ"]);
    // Destino fora da tabela de municípios (sem UF conhecida): exige algum MDF-e na viagem.
    expect(faltasParaSair([interestadual], "2", [], [])).toEqual({ ctes: [], mdfe: { exigencia: "interestadual", ufs: [] } });
    expect(faltasParaSair([interestadual], "2", [], ["MG"]).mdfe).toBeNull();
  });

  it("carga própria (tipo 2) não emite CT-e: só o MDF-e é exigido", () => {
    expect(faltasParaSair([interestadual, intermunicipal], "2", ["MG", "SP"], [])).toEqual({ ctes: [], mdfe: { exigencia: "interestadual", ufs: ["MG", "SP"] } });
    expect(haFaltasParaSair(faltasParaSair([interestadual], "2", ["MG"], ["MG"]))).toBe(false);
  });

  it("a frase do bloqueio diz o que falta e cita os Ajustes", () => {
    expect(fraseDoBloqueioDaSaida({ ctes: [{ id: "c1", codigo: "TRK1" }], mdfe: { exigencia: "interestadual", ufs: ["MG", "RJ"] } })).toBe(
      "A saída não foi liberada. Falta: CT-e autorizado de 1 carga (TRK1) e MDF-e com descarga em MG e RJ autorizado. Os documentos têm de estar autorizados antes de o veículo sair (Ajustes SINIEF 09/07 e 21/10).",
    );
    expect(fraseDoBloqueioDaSaida({ ctes: [{ id: "c1", codigo: "TRK1" }, { id: "c2", codigo: "TRK2" }], mdfe: null })).toContain("Falta: CT-e autorizado de 2 cargas (TRK1, TRK2).");
    expect(fraseDoBloqueioDaSaida({ ctes: [], mdfe: { exigencia: "intermunicipal", ufs: [] } })).toContain("Falta: MDF-e da viagem autorizado.");
    expect(rotuloDaFaltaDeMdfe({ exigencia: "interestadual", ufs: ["MG", "RJ", "GO"] })).toBe("MDF-e com descarga em MG, RJ e GO");
    // O aviso (homologação ou empresa que emite fora) diz as UF que faltam.
    expect(avisoDeViagemSemMdfe({ exigencia: "interestadual", ufs: ["RJ"] })).toBe(`${AVISO_DE_VIAGEM_SEM_MDFE.interestadual} Falta o MDF-e (um por UF de descarregamento) com descarga em RJ.`);
    expect(avisoDeViagemSemMdfe({ exigencia: "intermunicipal", ufs: [] })).toBe(AVISO_DE_VIAGEM_SEM_MDFE.intermunicipal);
  });
});

/* ---------------- Pendências fiscais: retorno, CSRT, contingência, pagamento --------------- */

describe("revisão do retorno da SEFAZ e dos endereços do MDF-e (MOC 3.00b)", () => {
  const CHAVE = chaveDeExemplo("58", 7);
  const protocolo = (cStat: number): Protocolo => ({ cStat, motivo: "Autorizado o uso do MDF-e", ambiente: "HOMOLOGACAO", chave: CHAVE, numero: "935260000000001", recebidoEm: new Date(), resumo: "abc=", xml: "<protMDFe/>" });
  const esperado = { chave: CHAVE, ambiente: "HOMOLOGACAO" as const, resumo: "abc=" };

  it("endereços: os cinco serviços da SVRS, nos dois ambientes, e o QR Code, como o Portal do MDF-e publica", () => {
    const servicos = ["recepcao", "consulta", "naoEncerrados", "status", "evento"] as const;
    expect(servicos.map((servico) => enderecoDoServico(servico, "PRODUCAO"))).toEqual([
      "https://mdfe.svrs.rs.gov.br/ws/MDFeRecepcaoSinc/MDFeRecepcaoSinc.asmx",
      "https://mdfe.svrs.rs.gov.br/ws/MDFeConsulta/MDFeConsulta.asmx",
      "https://mdfe.svrs.rs.gov.br/ws/MDFeConsNaoEnc/MDFeConsNaoEnc.asmx",
      "https://mdfe.svrs.rs.gov.br/ws/MDFeStatusServico/MDFeStatusServico.asmx",
      "https://mdfe.svrs.rs.gov.br/ws/MDFeRecepcaoEvento/MDFeRecepcaoEvento.asmx",
    ]);
    expect(servicos.map((servico) => enderecoDoServico(servico, "HOMOLOGACAO"))).toEqual([
      "https://mdfe-homologacao.svrs.rs.gov.br/ws/MDFeRecepcaoSinc/MDFeRecepcaoSinc.asmx",
      "https://mdfe-homologacao.svrs.rs.gov.br/ws/MDFeConsulta/MDFeConsulta.asmx",
      "https://mdfe-homologacao.svrs.rs.gov.br/ws/MDFeConsNaoEnc/MDFeConsNaoEnc.asmx",
      "https://mdfe-homologacao.svrs.rs.gov.br/ws/MDFeStatusServico/MDFeStatusServico.asmx",
      "https://mdfe-homologacao.svrs.rs.gov.br/ws/MDFeRecepcaoEvento/MDFeRecepcaoEvento.asmx",
    ]);
    expect(ENDERECO_DO_QR_CODE).toBe("https://dfe-portal.svrs.rs.gov.br/mdfe/qrCode");
    // Nome e método de cada serviço: MOC, Visão Geral, itens 4.2 a 4.5 e 5.1.
    expect(SERVICOS).toEqual({
      recepcao: { nome: "MDFeRecepcaoSinc", metodo: "mdfeRecepcao" },
      consulta: { nome: "MDFeConsulta", metodo: "mdfeConsultaMDF" },
      naoEncerrados: { nome: "MDFeConsNaoEnc", metodo: "mdfeConsNaoEnc" },
      status: { nome: "MDFeStatusServico", metodo: "mdfeStatusServicoMDF" },
      evento: { nome: "MDFeRecepcaoEvento", metodo: "mdfeRecepcaoEvento" },
    });
  });

  it("os códigos tratados são os do manual", () => {
    expect(CSTAT).toMatchObject({
      AUTORIZADO: 100,
      CANCELADO: 101,
      EM_OPERACAO: 107,
      PARALISADO: 108,
      PARALISADO_SEM_PREVISAO: 109,
      NAO_ENCERRADOS_LOCALIZADOS: 111,
      NENHUM_NAO_ENCERRADO: 112,
      ENCERRADO: 132,
      EVENTO_REGISTRADO_COM_ALERTA: 134,
      EVENTO_REGISTRADO: 135,
      EVENTO_REGISTRADO_SEM_VINCULO: 136,
      DUPLICIDADE: 204,
      NAO_CONSTA: 217,
      JA_CANCELADO: 218,
      NAO_ENCERRADO_HA_5_DIAS: 462,
      DUPLICIDADE_COM_OUTRA_CHAVE: 539,
      JA_ENCERRADO: 609,
      NAO_ENCERRADO_PARA_A_PLACA: 611,
      NAO_ENCERRADO_NO_SENTIDO_OPOSTO: 662,
      NAO_ENCERRADO_HA_30_DIAS: 686,
    });
    expect([...REJEICOES_POR_NAO_ENCERRADO].sort()).toEqual([462, 611, 662, 686]);
    expect(FINALIZADOS_DO_MDFE).toEqual({ 101: "cancelado", 218: "cancelado", 132: "encerrado", 609: "encerrado" });
  });

  it("consulta de MDF-e cancelado (101) ou encerrado (132): o protMDFe é o da autorização, e mesmo assim NÃO vale como autorizado", () => {
    // É assim que a SEFAZ responde (MOC, Visão Geral, 4.3.2 e 4.3.6): a situação no topo, o protocolo de autorização (cStat 100) dentro.
    const cancelado = decidirMdfe({ cStat: 101, motivo: "Cancelamento de MDF-e homologado", ambiente: "HOMOLOGACAO", protocolo: protocolo(100) }, esperado);
    expect(cancelado).toEqual({ tipo: "finalizado", situacao: "cancelado", cStat: 101, motivo: "Cancelamento de MDF-e homologado" });
    const encerrado = decidirMdfe({ cStat: 132, motivo: "Encerramento de MDF-e homologado", ambiente: "HOMOLOGACAO", protocolo: protocolo(100) }, esperado);
    expect(encerrado).toMatchObject({ tipo: "finalizado", situacao: "encerrado", cStat: 132 });
    // O mesmo protocolo, com a situação "autorizado" no topo, autoriza.
    expect(decidirMdfe({ cStat: 100, motivo: "Autorizado o uso do MDF-e", ambiente: "HOMOLOGACAO", protocolo: protocolo(100) }, esperado).tipo).toBe("autorizado");
    // O CT-e não tem encerramento: lá só o cancelamento finaliza.
    expect(decidir({ cStat: 101, motivo: "Cancelamento de CT-e homologado", ambiente: "HOMOLOGACAO", protocolo: protocolo(100) }, esperado)).toMatchObject({ tipo: "finalizado", situacao: "cancelado" });
  });

  it("recepção de MDF-e que a SEFAZ já tem cancelado (218) ou encerrado (609): finalizado, não uma rejeição que se reenvia com o mesmo número", () => {
    const semProtocolo = (cStat: number, motivo: string) => ({ cStat, motivo, ambiente: "HOMOLOGACAO" as const, protocolo: null });
    expect(decidirMdfe(semProtocolo(218, "Rejeição: MDFe já está cancelado na base de dados da SEFAZ"), esperado)).toMatchObject({ tipo: "finalizado", situacao: "cancelado", cStat: 218 });
    expect(decidirMdfe(semProtocolo(609, "Rejeição: MDFe já está encerrado na base de dados da SEFAZ"), esperado)).toMatchObject({ tipo: "finalizado", situacao: "encerrado", cStat: 609 });
    // Os outros continuam como eram.
    expect(decidirMdfe(semProtocolo(204, "Rejeição: Duplicidade de MDFe"), esperado).tipo).toBe("ja-autorizado");
    expect(decidirMdfe(semProtocolo(539, "Rejeição: Duplicidade de MDFe, com diferença na Chave de Acesso"), esperado).tipo).toBe("numero-usado");
    expect(decidirMdfe(semProtocolo(108, "Serviço Paralisado Momentaneamente"), esperado).tipo).toBe("parado");
    expect(decidirMdfe(semProtocolo(109, "Serviço Paralisado sem Previsão"), esperado).tipo).toBe("parado");
    for (const cStat of [462, 611, 662, 686, 698]) expect(decidirMdfe(semProtocolo(cStat, "Rejeição"), esperado), String(cStat)).toMatchObject({ tipo: "rejeitado", cStat });
  });

  it("evento: 135 registra; 134 e 136 são evento guardado com ressalva, não recusa nem registro pleno", () => {
    const resposta = (cStat: number, nProt: string | null = "935260000000009"): RespostaDoEvento => ({ cStat, motivo: "x", chave: CHAVE, tipo: "110112", protocolo: nProt, registradoEm: new Date(), xml: "" });
    const alvo = { chave: CHAVE, tipo: "110112" };
    expect(eventoRegistrado(resposta(135), alvo)).toBe(true);
    for (const cStat of [134, 136]) {
      expect(eventoRegistrado(resposta(cStat), alvo), String(cStat)).toBe(false);
      expect(eventoGuardadoComRessalva(resposta(cStat), alvo), String(cStat)).toBe(true);
      // Sem protocolo, para outra chave ou outro tipo, não é nada.
      expect(eventoGuardadoComRessalva(resposta(cStat, null), alvo)).toBe(false);
      expect(eventoGuardadoComRessalva(resposta(cStat), { ...alvo, tipo: "110111" })).toBe(false);
      expect(eventoGuardadoComRessalva({ ...resposta(cStat), chave: chaveDeExemplo("58", 8) }, alvo)).toBe(false);
    }
    expect(eventoGuardadoComRessalva(resposta(135), alvo)).toBe(false);
    expect(eventoGuardadoComRessalva(resposta(609), alvo)).toBe(false);
    expect(fraseDoEventoComRessalva("o encerramento", { cStat: 136, motivo: "Evento registrado, mas não vinculado a MDF-e", protocolo: "935260000000009" })).toBe(
      "A SEFAZ guardou o encerramento com ressalva (136 - Evento registrado, mas não vinculado a MDF-e; protocolo 935260000000009), sem confirmar que valeu para o documento: ele continua como estava neste sistema. Confira a situação na SEFAZ antes de tentar de novo.",
    );
  });
});

describe("código de segurança do responsável técnico (idCSRT e hashCSRT)", () => {
  // Valores calculados fora deste código (Python, hashlib.sha1 + base64): Base64(SHA-1(CSRT + chave de acesso)).
  const CSRT = "G8063VRTNDMO886SFNK5LDUDEI24XJ22YIPO";
  const CHAVE_DO_MDFE = "35261099000108000141580010000000071482159371";
  const variaveis = { RESPTEC_CNPJ: "99.888.777/0001-00", RESPTEC_CONTATO: "Suporte de Teste", RESPTEC_EMAIL: "suporte@desenvolvedora.example", RESPTEC_FONE: "(17) 3000-1000" };

  it("a conta do MOC: Base64 do SHA-1 de CSRT + chave de acesso, com 28 letras", () => {
    expect(hashDoCsrt(CSRT, CHAVE_DO_MDFE)).toBe("JB2UrIfg/B0t5CtWa3mf2cfX2tw=");
    expect(hashDoCsrt(CSRT, CHAVE_DO_MDFE)).toHaveLength(28);
  });

  it("as duas variáveis valem juntas; o identificador sai com 3 dígitos; sem elas o grupo fica como era", () => {
    expect(codigoDeSeguranca({})).toBeUndefined();
    expect(codigoDeSeguranca({ RESPTEC_CSRT_ID: "1" })).toBeUndefined();
    expect(codigoDeSeguranca({ RESPTEC_CSRT: CSRT })).toBeUndefined();
    expect(codigoDeSeguranca({ RESPTEC_CSRT_ID: "1234", RESPTEC_CSRT: CSRT })).toBeUndefined();
    expect(codigoDeSeguranca({ RESPTEC_CSRT_ID: "A1", RESPTEC_CSRT: CSRT })).toBeUndefined();
    expect(codigoDeSeguranca({ RESPTEC_CSRT_ID: " 7 ", RESPTEC_CSRT: ` ${CSRT} ` })?.id).toBe("007");
    expect(codigoDeSeguranca({ RESPTEC_CSRT_ID: "7", RESPTEC_CSRT: CSRT })?.hash(CHAVE_DO_MDFE)).toBe("JB2UrIfg/B0t5CtWa3mf2cfX2tw=");

    // Sem as variáveis do CSRT o responsável técnico é exatamente o de antes.
    expect(responsavelTecnico(variaveis)).toEqual(RESPONSAVEL_TECNICO);
    expect(responsavelTecnico({ ...variaveis, RESPTEC_CSRT_ID: "7" })).toEqual(RESPONSAVEL_TECNICO);
    expect(responsavelTecnicoDoXml(RESPONSAVEL_TECNICO, CHAVE_DO_MDFE)).not.toContain("CSRT");
    // Sem os dados do responsável técnico não há grupo, com ou sem CSRT.
    expect(responsavelTecnico({ RESPTEC_CSRT_ID: "7", RESPTEC_CSRT: CSRT })).toBeNull();
  });

  it("o segredo não sai: nem no XML, nem quando o responsável técnico vira JSON ou texto", () => {
    const comCsrt = responsavelTecnico({ ...variaveis, RESPTEC_CSRT_ID: "7", RESPTEC_CSRT: CSRT })!;
    expect(comCsrt.csrt?.id).toBe("007");
    expect(JSON.stringify(comCsrt)).not.toContain(CSRT);
    expect(JSON.stringify(comCsrt)).toBe(JSON.stringify({ ...RESPONSAVEL_TECNICO, csrt: { id: "007" } }));
    expect(String(comCsrt.csrt?.hash)).not.toContain(CSRT);
    const grupo = responsavelTecnicoDoXml(comCsrt, CHAVE_DO_MDFE);
    expect(grupo).toBe(
      "<infRespTec><CNPJ>99888777000100</CNPJ><xContato>Suporte de Teste</xContato><email>suporte@desenvolvedora.example</email><fone>1730001000</fone><idCSRT>007</idCSRT><hashCSRT>JB2UrIfg/B0t5CtWa3mf2cfX2tw=</hashCSRT></infRespTec>",
    );
    expect(grupo).not.toContain(CSRT);
  });

  it("MDF-e com o código de segurança: o hash é o da chave do próprio documento, e o XML passa no esquema", async () => {
    const comCsrt = responsavelTecnico({ ...variaveis, RESPTEC_CSRT_ID: "7", RESPTEC_CSRT: CSRT })!;
    const dados = mdfeDeExemplo({ responsavelTecnico: comCsrt });
    const { xml, chave } = assinado(dados);
    expect(chave).toBe(CHAVE_DO_MDFE);
    expect(await erros(dados)).toEqual([]);
    expect(xml).toContain("<fone>1730001000</fone><idCSRT>007</idCSRT><hashCSRT>JB2UrIfg/B0t5CtWa3mf2cfX2tw=</hashCSRT></infRespTec></infMDFe>");
    expect(xml).not.toContain(CSRT);
    // Outro número, outra chave, outro hash.
    const outro = assinado(mdfeDeExemplo({ responsavelTecnico: comCsrt, numero: 8 }));
    expect(outro.xml).toContain(`<hashCSRT>${createHash("sha1").update(`${CSRT}${outro.chave}`).digest("base64")}</hashCSRT>`);
    expect(outro.xml).not.toContain("JB2UrIfg/B0t5CtWa3mf2cfX2tw=");
  });

  it("CT-e com o código de segurança: mesmo grupo, hash da chave do CT-e, e o XML passa no esquema", async () => {
    const comCsrt = responsavelTecnico({ ...variaveis, RESPTEC_CSRT_ID: "12", RESPTEC_CSRT: CSRT })!;
    const montado = montarCte(dadosDeExemplo({ responsavelTecnico: comCsrt }));
    const xml = assinarXml(montado.xml, ALVO_DO_CTE, chaveDeAssinatura());
    expect(await errosNoEsquema(xml, "cte_v4.00.xsd")).toEqual([]);
    expect(xml).toContain(`<idCSRT>012</idCSRT><hashCSRT>${createHash("sha1").update(`${CSRT}${montado.chave}`).digest("base64")}</hashCSRT></infRespTec></infCte>`);
    expect(xml).not.toContain(CSRT);
    // Sem o código, o CT-e continua sem os dois campos.
    expect(montarCte(dadosDeExemplo({ responsavelTecnico: RESPONSAVEL_TECNICO })).xml).not.toContain("CSRT");
  });
});

describe("contingência off-line do MDF-e (MOC 3.00b, Visão Geral, itens 9.2.2 e 11)", () => {
  const emContingencia = (trocas: Parameters<typeof mdfeDeExemplo>[0] = {}) => mdfeDeExemplo({ ...trocas, contingencia: { assinar: (chave) => assinarTexto(chave, lido.chavePem) } });

  it("a chave leva o tipo de emissão 2 na posição 35, com o mesmo cMDF e o dígito refeito", () => {
    const partes = { uf: "SP", emissao: new Date("2026-10-10T14:30:00.000Z"), cnpj: "99000108000141", serie: 1, numero: 7, codigo: "48215937" };
    // As duas chaves foram calculadas fora deste código (módulo 11, em Python).
    expect(chaveDoMdfe(partes)).toBe("35261099000108000141580010000000071482159371");
    const chave = chaveDoMdfe({ ...partes, tipoDeEmissao: "2" });
    expect(chave).toBe("35261099000108000141580010000000072482159370");
    expect(chaveValida(chave)).toBe(true);
    expect(chave.slice(35, 43)).toBe("48215937");
    expect(chaveDeContingencia(chave)).toBe(true);
    expect(chaveDeContingencia(chaveDoMdfe(partes))).toBe(false);
    expect(chaveDeContingencia("")).toBe(false);
  });

  it("o XML: tpEmis 2, Id e cDV da chave de contingência, QR Code com o sign, e passa no esquema", async () => {
    const dados = emContingencia();
    expect(await erros(dados)).toEqual([]);
    const { xml, chave } = assinado(dados);
    expect(chave).toBe("35261099000108000141580010000000072482159370");
    expect(xml).toContain(`Id="MDFe${chave}"`);
    expect(xml).toContain("<cMDF>48215937</cMDF><cDV>0</cDV>");
    expect(xml).toContain("<tpEmis>2</tpEmis><procEmi>0</procEmi>");
    expect(assinaturaConfere(xml, lido.titularPem)).toBe(true);

    // 9.2.2: URL + chMDFe e tpAmb + sign, a assinatura RSA-SHA1 (Base64) da chave, com o certificado que assina o MDF-e.
    const qrCode = /<qrCodMDFe>([^<]+)<\/qrCodMDFe>/.exec(xml)![1].replace(/&amp;/g, "&");
    const [endereco, parametros] = qrCode.split("?");
    expect(endereco).toBe("https://dfe-portal.svrs.rs.gov.br/mdfe/qrCode");
    const sign = /^chMDFe=(\d{44})&tpAmb=2&sign=(.+)$/.exec(parametros)!;
    expect(sign[1]).toBe(chave);
    expect(sign[2]).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(assinaturaDoTextoConfere(chave, sign[2], lido.titularPem)).toBe(true);
    // Regra F119: a assinatura é da chave deste documento, e de mais nenhuma.
    expect(assinaturaDoTextoConfere(chaveDeExemplo("58", 7), sign[2], lido.titularPem)).toBe(false);
    expect(assinaturaDoTextoConfere(chave, sign[2], certificadoDeTeste({ cnpj: "99000303000171" }).certificadoPem)).toBe(false);
  });

  it("emissão normal continua com tpEmis 1 e sem o sign (regra F118, rejeição 488)", () => {
    const { xml, chave } = assinado(mdfeDeExemplo());
    expect(chave[34]).toBe("1");
    expect(xml).toContain("<tpEmis>1</tpEmis>");
    expect(xml).not.toContain("sign=");
    expect(urlDoQrCode(ENDERECO_DO_QR_CODE, chave, "PRODUCAO")).toBe(`https://dfe-portal.svrs.rs.gov.br/mdfe/qrCode?chMDFe=${chave}&tpAmb=1`);
    expect(urlDoQrCode(ENDERECO_DO_QR_CODE, chave, "PRODUCAO", "QUJD")).toBe(`https://dfe-portal.svrs.rs.gov.br/mdfe/qrCode?chMDFe=${chave}&tpAmb=1&sign=QUJD`);
  });

  it("o prazo de 168 horas, o selo e o aviso", () => {
    expect(PRAZO_DA_CONTINGENCIA_HORAS).toBe(168);
    const emitido = "2026-10-10T14:30:00.000Z";
    expect(prazoDaContingencia(emitido).toISOString()).toBe("2026-10-17T14:30:00.000Z");
    expect(avisoDoPrazoDaContingencia(prazoDaContingencia(emitido), new Date("2026-10-12T00:00:00Z"))).toMatch(/^Transmita à SEFAZ até 17\/10\/2026,? 11:30 \(168 horas da emissão\)\.$/);
    expect(avisoDoPrazoDaContingencia(prazoDaContingencia(emitido), new Date("2026-10-18T00:00:00Z"))).toMatch(/^O prazo de 168 horas para transmitir terminou em 17\/10\/2026,? 11:30: transmita agora e consulte o contador\.$/);
    expect(seloDoMdfe({ situacao: "CONTINGENCY", ambiente: "PRODUCAO", numero: 9, semResposta: false })).toBe("Contingência nº 9, a transmitir");
    expect(seloDoMdfe({ situacao: "CONTINGENCY", ambiente: "HOMOLOGACAO", numero: 9, semResposta: true })).toBe("Contingência nº 9, a transmitir (homologação)");
    expect(emitirSchema.parse({ manifestId: "v1", ufDeDescarga: "MG", contingencia: true }).contingencia).toBe(true);
    expect(emitirSchema.parse({ manifestId: "v1", ufDeDescarga: "MG" }).contingencia).toBeUndefined();
    expect(emitirSchema.safeParse({ manifestId: "v1", ufDeDescarga: "MG", contingencia: "sim" }).success).toBe(false);
  });

  it("para sair, o MDF-e em contingência cobre a UF dele como o autorizado (a conta é a mesma)", () => {
    const cargas = [{ id: "c1", codigo: "TRK1", ufDeOrigem: "SP", ufDeDestino: "MG", mesmoMunicipio: false, cteAutorizado: true }];
    expect(faltasParaSair(cargas, "1", ["MG"], ["MG"]).mdfe).toBeNull();
    expect(faltasParaSair(cargas, "1", ["MG"], []).mdfe).toEqual({ exigencia: "interestadual", ufs: ["MG"] });
  });
});

describe("eventos de pagamento do MDF-e (110116 e 110118), validados no esquema oficial", () => {
  const chave = chaveDeExemplo("58", 7);
  const base = { chave, cnpj: "99000108000141", ambiente: "HOMOLOGACAO" as const, quando: new Date("2026-10-11T12:00:00.000Z") };
  const protocolo = "935260000000001";
  const aVista = { nome: "Transportadora de Teste Ltda", documento: "99000108000141", valor: 1850.75, aPrazo: false, conta: { pix: "52998224725" } };
  const aPrazo = {
    documento: "99000108000141",
    valor: 3000,
    aPrazo: true,
    adiantamento: 1000,
    parcelas: [
      { vencimento: "2026-11-10", valor: 1000 },
      { vencimento: "2026-12-10", valor: 1000 },
    ],
    conta: { banco: "001", agencia: "1234" },
  };

  const validar = async (evento: { xml: string }, esquemaDoDetalhe: string) => {
    const xml = assinarXml(evento.xml, ALVO_DO_EVENTO_DO_MDFE, chaveDeAssinatura());
    expect(assinaturaConfere(xml, lido.titularPem)).toBe(true);
    return { xml, erros: [...(await errosNoEsquemaDoMdfe(xml, "eventoMDFe_v3.00.xsd")), ...(await errosNoEsquemaDoMdfe(detalheDoEvento(xml), esquemaDoDetalhe))] };
  };

  it("pagamento da operação (110116): protocolo, as viagens com 5 dígitos e o infPag, com sequência 1", async () => {
    const evento = montarPagamentoDaOperacao({ ...base, protocolo, viagens: { quantidade: 12, numero: 3 }, pagamentos: [aVista] });
    const { xml, erros: falhas } = await validar(evento, "evPagtoOperMDFe_v3.00.xsd");
    expect(falhas).toEqual([]);
    expect(evento).toMatchObject({ id: `ID110116${chave}01`, tipo: "110116", sequencia: 1 });
    expect(xml).toContain("<tpEvento>110116</tpEvento><nSeqEvento>1</nSeqEvento>");
    expect(xml).toContain(
      '<detEvento versaoEvento="3.00"><evPagtoOperMDFe><descEvento>Pagamento Operacao MDF-e</descEvento><nProt>935260000000001</nProt><infViagens><qtdViagens>00012</qtdViagens><nroViagem>00003</nroViagem></infViagens>' +
        "<infPag><xNome>Transportadora de Teste Ltda</xNome><CNPJ>99000108000141</CNPJ><Comp><tpComp>04</tpComp><vComp>1850.75</vComp></Comp><vContrato>1850.75</vContrato><indPag>0</indPag><infBanc><PIX>52998224725</PIX></infBanc></infPag></evPagtoOperMDFe></detEvento>",
    );
  });

  it("pagamento a prazo, com adiantamento e parcelas, e mais de um infPag", async () => {
    const evento = montarPagamentoDaOperacao({ ...base, protocolo, viagens: { quantidade: 1, numero: 1 }, pagamentos: [aPrazo, { ...aVista, documento: "52998224725", conta: { cnpjDaIpef: "99000502000180" } }] });
    const { xml, erros: falhas } = await validar(evento, "evPagtoOperMDFe_v3.00.xsd");
    expect(falhas).toEqual([]);
    expect(xml).toContain("<indPag>1</indPag><vAdiant>1000.00</vAdiant><infPrazo><nParcela>001</nParcela><dVenc>2026-11-10</dVenc><vParcela>1000.00</vParcela></infPrazo><infPrazo><nParcela>002</nParcela>");
    expect(xml).toContain("<infBanc><codBanco>001</codBanco><codAgencia>1234</codAgencia></infBanc>");
    expect(xml).toContain("<CPF>52998224725</CPF>");
    expect(xml.match(/<infPag>/g)).toHaveLength(2);
  });

  it("alteração do pagamento (110118): protocolo e o novo infPag, com a sequência no Id", async () => {
    const evento = montarAlteracaoDoPagamento({ ...base, sequencia: 2, protocolo, pagamento: aPrazo });
    const { xml, erros: falhas } = await validar(evento, "evAlteracaoPagtoServMDFe_v3.00.xsd");
    expect(falhas).toEqual([]);
    expect(evento).toMatchObject({ id: `ID110118${chave}02`, tipo: "110118", sequencia: 2 });
    expect(xml).toContain("<evAlteracaoPagtoServMDFe><descEvento>Alteracao Pagamento Servico MDFe</descEvento><nProt>935260000000001</nProt><infPag><CNPJ>99000108000141</CNPJ>");
  });

  it("o esquema do evento recusa o que a montagem não deixa passar (prova de que a validação morde)", async () => {
    const evento = montarPagamentoDaOperacao({ ...base, protocolo, viagens: { quantidade: 1, numero: 1 }, pagamentos: [aVista] });
    const semViagens = evento.xml.replace(/<infViagens>.*<\/infViagens>/, "");
    expect((await validar({ xml: semViagens }, "evPagtoOperMDFe_v3.00.xsd")).erros.length).toBeGreaterThan(0);
  });

  it("o que a pessoa informa: viagens de 1 a 99999, a viagem dentro do total, e o pagamento com as regras do MDF-e", () => {
    const pagamento = { documento: "99.000.108/0001-41", valor: "1850,75", aPrazo: false, conta: { pix: "52998224725" } };
    const lido110116 = pagamentoDaOperacaoSchema.parse({ viagens: { quantidade: "12", numero: "3" }, pagamento });
    expect(lido110116).toMatchObject({ viagens: { quantidade: 12, numero: 3 }, pagamento: { documento: "99000108000141", valor: 1850.75 } });
    const frase = (dados: unknown) => pagamentoDaOperacaoSchema.safeParse(dados).error?.issues[0]?.message;
    expect(frase({ viagens: { quantidade: "2", numero: "3" }, pagamento })).toBe("O número da viagem não pode ser maior que a quantidade de viagens.");
    expect(frase({ viagens: { quantidade: "0", numero: "1" }, pagamento })).toBe("Informe um número de 1 a 99999.");
    expect(frase({ viagens: { quantidade: "100000", numero: "1" }, pagamento })).toBe("Informe um número de 1 a 99999.");
    expect(frase({ viagens: { quantidade: "1", numero: "1" }, pagamento: { ...pagamento, documento: "123" } })).toBe("Informe o CPF ou CNPJ de quem paga o frete.");
    expect(frase({ viagens: { quantidade: "1", numero: "1" }, pagamento: { ...pagamento, aPrazo: true } })).toBe("Pagamento a prazo precisa das parcelas.");
    expect(frase({ viagens: { quantidade: "1", numero: "1" } })).toBeDefined();
    expect(alteracaoDoPagamentoSchema.parse({ pagamento }).pagamento.valor).toBe(1850.75);
    expect(alteracaoDoPagamentoSchema.safeParse({}).success).toBe(false);
    // A linha da tela diz quando cada evento se aplica.
    expect(QUANDO_INFORMAR_O_PAGAMENTO).toMatch(/TAC agregado/);
    expect(QUANDO_INFORMAR_O_PAGAMENTO).toMatch(/item 6\.5/);
    expect(QUANDO_ALTERAR_O_PAGAMENTO).toMatch(/item 6\.7/);
  });
});
