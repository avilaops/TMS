import { gunzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chaveValida } from "../src/lib/nfe";
import {
  NOME_EM_HOMOLOGACAO,
  SIMPLES_PEDE_SN,
  SN_SO_NO_SIMPLES,
  TRIBUTADO_PEDE_ALIQUOTA,
  IBSCBS_CST_FORA_DA_LISTA,
  IBSCBS_INCOMPLETO,
  IBSCBS_OBRIGATORIO,
  cancelarSchema,
  certificadoSchema,
  cnpjValido,
  dadosFiscaisSchema,
  dentroDoPrazoDeCancelamento,
  seloDoCte,
} from "../src/lib/cte";
import { ALVO_DO_CTE, ALVO_DO_EVENTO, assinarXml, assinaturaConfere, resumoDaAssinatura } from "../src/lib/cte/assinar";
import {
  AINDA_NAO_VALE,
  CertificadoError,
  DE_OUTRO_CNPJ,
  NAO_E_A1,
  NAO_E_ECNPJ,
  SEM_CHAVE,
  SENHA_ERRADA,
  VENCIDO,
  conferirCertificado,
  lerCertificado,
} from "../src/lib/cte/certificado";
import { ChaveInvalida, anoEMes, chaveDoCte, dataHoraDoXml, lerChaveDoCte } from "../src/lib/cte/chave";
import { ENDERECOS, autorizadorDaUf, enderecosDaUf, urlDoQrCode } from "../src/lib/cte/enderecos";
import { cfopDaPrestacao, ibsCbsDaPrestacao, icmsDaPrestacao, montarCancelamento, montarCte, montarModalRodoviario, montarProcCte, observacaoDaViagem } from "../src/lib/cte/montar";
import { SEM_EMITENTE, prepararCte, type CargaDoCte } from "../src/lib/cte/preparar";
import {
  CSTAT,
  compactar,
  consultarCte,
  corpoDaResposta,
  decidir,
  enviarCte,
  enviarEvento,
  eventoRegistrado,
  mensagemDeConsulta,
  mensagemDeStatus,
  statusDoServico,
  usarSefazDeTeste,
  type Destino,
} from "../src/lib/cte/sefaz";
import { SEFAZ_FORA_DO_AR, SEFAZ_TEMPO_ESGOTADO, SefazError, chamarSoap, envelope } from "../src/lib/cte/soap";
import { textoDoXml } from "../src/lib/cte/texto";
import { municipioDoTexto } from "../src/lib/municipios";
import {
  DESTINATARIO,
  EMITENTE,
  REMETENTE,
  certificadoDeTeste,
  dadosDeExemplo,
  errosNoEsquema,
  impressaoDigital,
  nfeDeExemplo,
  subirSefazDeMentira,
  type CertificadoDeTeste,
  type SefazDeMentira,
} from "./cte-apoio";

/**
 * Emissão de CT-e, na parte que não precisa de banco: a chave de acesso, a
 * montagem do XML (validada contra os esquemas oficiais do pacote 4.00), a
 * assinatura, a leitura do certificado A1 e a conversa SOAP.
 *
 * NENHUM teste fala com a SEFAZ: a conversa é com um servidor HTTPS local
 * (tests/cte-apoio.ts), e o certificado é autoassinado, gerado aqui.
 */

let certificado: CertificadoDeTeste;
let lido: ReturnType<typeof lerCertificado>;

beforeAll(() => {
  certificado = certificadoDeTeste();
  lido = lerCertificado(certificado.pfx, certificado.senha);
});

const assinado = (dados = dadosDeExemplo()) => {
  const montado = montarCte(dados);
  return { ...montado, xml: assinarXml(montado.xml, ALVO_DO_CTE, { chavePem: lido.chavePem, certificadoPem: lido.titularPem }) };
};

/* ------------------------------- Chave de acesso ------------------------------ */

describe("chave de acesso do CT-e", () => {
  it("monta os 44 dígitos com o dígito verificador (exemplo do MOC, item 9.2.1)", () => {
    // 43181203527568000153570010002211211062211212: RS, 12/2018, série 1, nº 221121, cCT 06221121.
    const chave = chaveDoCte({ uf: "RS", emissao: new Date("2018-12-10T12:00:00-03:00"), cnpj: "03527568000153", serie: 1, numero: 221121, codigo: "06221121" });
    expect(chave).toBe("43181203527568000153570010002211211062211212");
    expect(chaveValida(chave)).toBe(true);
    expect(lerChaveDoCte(chave)).toEqual({
      codigoDaUf: "43",
      anoEMes: "1812",
      cnpj: "03527568000153",
      modelo: "57",
      serie: 1,
      numero: 221121,
      tipoDeEmissao: "1",
      codigo: "06221121",
      digito: "2",
    });
  });

  it("o ano e o mês são os do relógio de Brasília, não os de UTC", () => {
    // 01/11 às 01:30 UTC ainda é 31/10 às 22:30 em Brasília.
    const virada = new Date("2026-11-01T01:30:00.000Z");
    expect(anoEMes(virada)).toBe("2610");
    expect(dataHoraDoXml(virada)).toBe("2026-10-31T22:30:00-03:00");
    expect(chaveDoCte({ uf: "SP", emissao: virada, cnpj: "11222333000181", serie: 1, numero: 1, codigo: "00000001" }).slice(2, 6)).toBe("2610");
  });

  it("dígito 0 quando o resto é 0 ou 1, e toda chave montada passa na conferência", () => {
    const digitos = new Set<string>();
    for (let numero = 1; numero <= 60; numero += 1) {
      const chave = chaveDoCte({ uf: "SP", emissao: new Date("2026-10-10T12:00:00Z"), cnpj: "11222333000181", serie: 1, numero, codigo: "12345678" });
      expect(chave).toHaveLength(44);
      expect(chaveValida(chave)).toBe(true);
      digitos.add(chave[43]);
    }
    expect(digitos.has("0")).toBe(true);
  });

  it("CNPJ alfanumérico (NT Conjunta 2025.001): letras valem o código ASCII menos 48, no CNPJ e na chave", () => {
    // O exemplo que a Receita Federal publicou: 12.ABC.345/01DE-35.
    expect(cnpjValido("12ABC34501DE35")).toBe(true);
    expect(cnpjValido("12ABC34501DE36")).toBe(false);
    expect(cnpjValido("12abc34501de35")).toBe(false); // a rota tira a pontuação e põe em maiúsculas antes
    expect(cnpjValido("11222333000181")).toBe(true);
    expect(cnpjValido("11222333000182")).toBe(false);
    expect(cnpjValido("00000000000000")).toBe(false);
    expect(cnpjValido("12ABC34501DEA5")).toBe(false); // letra só nas 12 primeiras posições

    const chave = chaveDoCte({ uf: "SP", emissao: new Date("2026-10-10T12:00:00Z"), cnpj: "12ABC34501DE35", serie: 1, numero: 15, codigo: "48215937" });
    // Conferido à mão com a conta da NT (módulo 11, ASCII - 48).
    expect(chave).toBe("35261012ABC34501DE35570010000000151482159370");
    expect(chaveValida(chave)).toBe(true);
    expect(chaveValida(`${chave.slice(0, 43)}1`)).toBe(false);
    expect(lerChaveDoCte(chave).cnpj).toBe("12ABC34501DE35");
    // Letra fora das posições do CNPJ não é chave.
    expect(chaveValida("3526101222233300018157001000000015148215937A")).toBe(false);
    expect(chaveValida("A5261011222333000181570010000000151482159370")).toBe(false);
  });

  it("recusa parte fora do formato", () => {
    const base = { uf: "SP", emissao: new Date(), cnpj: "11222333000181", serie: 1, numero: 1, codigo: "12345678" };
    expect(() => chaveDoCte({ ...base, uf: "XX" })).toThrow(ChaveInvalida);
    expect(() => chaveDoCte({ ...base, cnpj: "123" })).toThrow(ChaveInvalida);
    expect(() => chaveDoCte({ ...base, serie: 1000 })).toThrow(ChaveInvalida);
    expect(() => chaveDoCte({ ...base, numero: 0 })).toThrow(ChaveInvalida);
    expect(() => chaveDoCte({ ...base, numero: 1_000_000_000 })).toThrow(ChaveInvalida);
    expect(() => chaveDoCte({ ...base, codigo: "1234" })).toThrow(ChaveInvalida);
  });
});

/* ----------------------------------- Texto ----------------------------------- */

describe("texto do XML", () => {
  it("fica dentro do que o tipo TString aceita", () => {
    expect(textoDoXml("  Aço   &   Cia – “Matriz”  ", 60)).toBe('Aço & Cia - "Matriz"');
    expect(textoDoXml("Linha 1\nLinha 2\tfim", 60)).toBe("Linha 1 Linha 2 fim");
    expect(textoDoXml("Entrega 🚚 rápida", 60)).toBe("Entrega rápida");
    expect(textoDoXml("abcdef ghij", 7)).toBe("abcdef");
    expect(textoDoXml(null, 10)).toBe("");
    expect(textoDoXml("   ", 10)).toBe("");
  });
});

/* ---------------------------------- Montagem --------------------------------- */

describe("montagem do CT-e, validada no esquema oficial (cte_v4.00.xsd)", () => {
  const valido = async (xml: string) => expect(await errosNoEsquema(xml, "cte_v4.00.xsd")).toEqual([]);

  it("interestadual, regime normal, tomador remetente, com NF-e", async () => {
    const { xml, chave, cfop, icms } = assinado();
    await valido(xml);
    expect(chaveValida(chave)).toBe(true);
    expect(xml).toContain(`<infCte versao="4.00" Id="CTe${chave}">`);
    expect(xml).toContain(`<cDV>${chave[43]}</cDV>`);
    expect(xml).toContain("<cCT>48215937</cCT>");
    expect(xml).toContain("<mod>57</mod><serie>1</serie><nCT>15</nCT><dhEmi>2026-10-10T11:30:00-03:00</dhEmi>");
    expect(xml).toContain("<tpEmis>1</tpEmis>");
    expect(xml).toContain("<tpAmb>2</tpAmb>");
    expect(xml).toContain("<modal>01</modal>");
    // SP → MG: CFOP de fora do estado, ICMS 12% sobre a prestação.
    expect(cfop).toBe("6353");
    expect(xml).toContain("<CFOP>6353</CFOP>");
    expect(icms).toEqual({ situacao: "00", base: 850.5, aliquota: 12, valor: 102.06 });
    expect(xml).toContain("<ICMS00><CST>00</CST><vBC>850.50</vBC><pICMS>12.00</pICMS><vICMS>102.06</vICMS></ICMS00>");
    // IBS e CBS (NT 2025.001): base = prestação - ICMS; alíquotas de 2026; o total do documento repete a prestação.
    expect(xml).toContain(
      "</ICMS><IBSCBS><CST>000</CST><cClassTrib>000001</cClassTrib><gIBSCBS><vBC>748.44</vBC><gIBSUF><pIBSUF>0.10</pIBSUF><vIBSUF>0.75</vIBSUF></gIBSUF><gIBSMun><pIBSMun>0.00</pIBSMun><vIBSMun>0.00</vIBSMun></gIBSMun><vIBS>0.75</vIBS><gCBS><pCBS>0.90</pCBS><vCBS>6.74</vCBS></gCBS></gIBSCBS></IBSCBS><vTotDFe>850.50</vTotDFe></imp>",
    );
    expect(xml).toContain("<vPrest><vTPrest>850.50</vTPrest><vRec>850.50</vRec><Comp><xNome>Frete peso</xNome><vComp>700.00</vComp></Comp><Comp><xNome>Pedágio</xNome><vComp>150.50</vComp></Comp></vPrest>");
    expect(xml).toContain("<indIEToma>1</indIEToma><toma3><toma>0</toma></toma3>");
    expect(xml).toContain("<infDoc><infNFe><chave>35261045543915000181550010000012341000012341</chave></infNFe></infDoc>");
    expect(xml).toContain('<infModal versaoModal="4.00"><rodo><RNTRC>12345678</RNTRC></rodo></infModal>');
    expect(xml).toContain("<infCarga><vCarga>32500.90</vCarga><proPred>Peças automotivas</proPred><infQ><cUnid>01</cUnid><tpMed>PESO BRUTO</tpMed><qCarga>1250.5000</qCarga></infQ><infQ><cUnid>03</cUnid><tpMed>VOLUMES</tpMed><qCarga>12.0000</qCarga></infQ></infCarga>");
    expect(xml).toContain("<xObs>Veiculo placa ABC1D23. Motorista João da Silva.</xObs>");
    // O QR Code, com o & escapado dentro do XML.
    expect(xml).toContain(`<infCTeSupl><qrCodCTe>https://homologacao.nfe.fazenda.sp.gov.br/CTeConsulta/qrCode?chCTe=${chave}&amp;tpAmb=2</qrCodCTe></infCTeSupl>`);
    // Uma linha só, sem espaço entre as tags.
    expect(xml).not.toMatch(/>\s+</);
  });

  it("em homologação o nome do remetente e do destinatário é a frase da SEFAZ; em produção, o nome de verdade", async () => {
    const homologacao = assinado();
    expect(homologacao.xml.split(`<xNome>${NOME_EM_HOMOLOGACAO}</xNome>`)).toHaveLength(3);
    expect(homologacao.xml).not.toContain("Indústria Remetente");

    const producao = assinado(dadosDeExemplo({ emitente: { ...EMITENTE, ambiente: "PRODUCAO" }, enderecoDoQrCode: "https://nfe.fazenda.sp.gov.br/CTeConsulta/qrCode" }));
    await valido(producao.xml);
    expect(producao.xml).toContain("<tpAmb>1</tpAmb>");
    expect(producao.xml).toContain("<xNome>Indústria Remetente S/A</xNome><xFant>Remetente</xFant>");
    expect(producao.xml).toContain("<xNome>Comércio Destinatário Ltda</xNome>");
    expect(producao.xml).toContain(`qrCode?chCTe=${producao.chave}&amp;tpAmb=1`);
  });

  it("dentro do estado: CFOP 5xxx", async () => {
    const dados = dadosDeExemplo({
      fim: { codigoMunicipio: "3550308", municipio: "São Paulo", uf: "SP" },
      destinatario: { ...DESTINATARIO, endereco: { logradouro: "Rua Augusta", numero: "100", bairro: "Consolação", codigoMunicipio: "3550308", municipio: "São Paulo", uf: "SP", cep: "01305000" } },
    });
    const { xml, cfop } = assinado(dados);
    await valido(xml);
    expect(cfop).toBe("5353");
    expect(xml).toContain("<UFIni>SP</UFIni><cMunFim>3550308</cMunFim><xMunFim>São Paulo</xMunFim><UFFim>SP</UFFim>");
  });

  it("emitente com CNPJ alfanumérico: a chave, o Id e o QR Code levam as letras, e o XML passa no esquema", async () => {
    const { xml, chave } = assinado(dadosDeExemplo({ emitente: { ...EMITENTE, cnpj: "12ABC34501DE35" }, remetente: { ...REMETENTE, documento: "12ABC34501DE35" } }));
    await valido(xml);
    expect(chave).toBe("35261012ABC34501DE35570010000000151482159370");
    expect(xml).toContain('Id="CTe35261012ABC34501DE35570010000000151482159370"');
    expect(xml).toContain("<emit><CNPJ>12ABC34501DE35</CNPJ>");
    expect(xml).toContain("<rem><CNPJ>12ABC34501DE35</CNPJ>");
    expect(xml).toContain("qrCode?chCTe=35261012ABC34501DE35570010000000151482159370&amp;tpAmb=2");
    expect(assinaturaConfere(xml, lido.titularPem)).toBe(true);
    const evento = montarCancelamento({ chave, cnpj: "12ABC34501DE35", ambiente: "HOMOLOGACAO", protocolo: "135260000000001", justificativa: "Carga recusada pelo destinatário", quando: new Date() });
    expect(await errosNoEsquema(assinarXml(evento.xml, ALVO_DO_EVENTO, { chavePem: lido.chavePem, certificadoPem: lido.titularPem }), "eventoCTe_v4.00.xsd")).toEqual([]);
  });

  it("IBS e CBS: isenção e imunidade vão sem valores; sem a classificação, o CT-e vai sem o grupo e sem o total do documento", async () => {
    const imune = assinado(dadosDeExemplo({ emitente: { ...EMITENTE, ibsCbs: { ...EMITENTE.ibsCbs!, cst: "410", classe: "410999" } } }));
    await valido(imune.xml);
    expect(imune.xml).toContain("</ICMS><IBSCBS><CST>410</CST><cClassTrib>410999</cClassTrib></IBSCBS><vTotDFe>850.50</vTotDFe></imp>");
    expect(imune.ibsCbs).toEqual({ cst: "410", classe: "410999", valores: null });

    const sem = assinado(dadosDeExemplo({ emitente: { ...EMITENTE, ibsCbs: null } }));
    await valido(sem.xml);
    expect(sem.xml).not.toContain("IBSCBS");
    expect(sem.xml).not.toContain("vTotDFe");
    expect(sem.ibsCbs).toBeNull();
  });

  it("IBS e CBS: a base tira o ICMS, o PIS e a COFINS; os valores fecham com base x alíquota (regras 014, 022 e 029)", async () => {
    const parametros = { cst: "000", classe: "000001", ibsUf: 0.05, ibsMunicipio: 0.05, cbs: 8.8, pis: 1.65, cofins: 7.6 };
    // 1000 - ICMS 120 - PIS 16,50 - COFINS 76 = 787,50.
    expect(ibsCbsDaPrestacao({ ibsCbs: parametros }, 1000, { valor: 120 })).toEqual({
      cst: "000",
      classe: "000001",
      valores: { base: 787.5, ibsUf: 0.39, ibsMunicipio: 0.39, cbs: 69.3, aliquotaDoIbsUf: 0.05, aliquotaDoIbsMunicipio: 0.05, aliquotaDaCbs: 8.8 },
    });
    expect(ibsCbsDaPrestacao({ ibsCbs: null }, 1000, { valor: 120 })).toBeNull();
    // Alíquota com 4 casas (0,0125%) cabe no tipo do esquema.
    const { xml } = assinado(dadosDeExemplo({ valorDaPrestacao: 1000, componentes: [], emitente: { ...EMITENTE, ibsCbs: { ...parametros, ibsUf: 0.0125 } } }));
    await valido(xml);
    expect(xml).toContain("<gIBSUF><pIBSUF>0.0125</pIBSUF><vIBSUF>0.10</vIBSUF></gIBSUF><gIBSMun><pIBSMun>0.05</pIBSMun><vIBSMun>0.39</vIBSMun></gIBSMun><vIBS>0.49</vIBS><gCBS><pCBS>8.80</pCBS><vCBS>69.30</vCBS></gCBS>");
    expect(xml).toContain("<vTotDFe>1000.00</vTotDFe>");
  });

  it("Simples Nacional: grupo ICMSSN, sem destaque de imposto", async () => {
    const { xml, icms } = assinado(dadosDeExemplo({ emitente: { ...EMITENTE, regime: "1", icms: "SN", aliquota: 0, ibsCbs: null } }));
    await valido(xml);
    expect(xml).toContain("<imp><ICMS><ICMSSN><CST>90</CST><indSN>1</indSN></ICMSSN></ICMS></imp>");
    expect(xml).toContain("<CRT>1</CRT>");
    expect(icms.valor).toBe(0);
  });

  it("isenta (40), não tributada (41) e outras (90)", async () => {
    const isenta = assinado(dadosDeExemplo({ emitente: { ...EMITENTE, icms: "40", aliquota: 0 } }));
    await valido(isenta.xml);
    expect(isenta.xml).toContain("<ICMS45><CST>40</CST></ICMS45>");

    const naoTributada = assinado(dadosDeExemplo({ emitente: { ...EMITENTE, icms: "41", aliquota: 0 } }));
    await valido(naoTributada.xml);
    expect(naoTributada.xml).toContain("<ICMS45><CST>41</CST></ICMS45>");

    const outras = assinado(dadosDeExemplo({ emitente: { ...EMITENTE, icms: "90", aliquota: 7 } }));
    await valido(outras.xml);
    expect(outras.xml).toContain("<ICMS90><CST>90</CST><vBC>850.50</vBC><pICMS>7.00</pICMS><vICMS>59.54</vICMS></ICMS90>");
  });

  it("tomador destinatário, e tomador que é um terceiro (toma4, com o endereço dele)", async () => {
    const destinatario = assinado(dadosDeExemplo({ tomador: { papel: "DESTINATARIO" } }));
    await valido(destinatario.xml);
    expect(destinatario.xml).toContain("<toma3><toma>3</toma></toma3>");

    const terceiro = assinado(
      dadosDeExemplo({
        contribuinte: "9",
        tomador: {
          papel: "OUTRO",
          participante: {
            documento: "60701190000104",
            ie: null,
            nome: "Pagador do Frete Ltda",
            fantasia: "Pagador",
            telefone: "(11) 3003-4070",
            email: "fiscal@pagador.example",
            endereco: { logradouro: "Praça Alfredo Egydio", numero: "100", bairro: "Jabaquara", codigoMunicipio: "3550308", municipio: "São Paulo", uf: "SP", cep: "04344902" },
          },
        },
      }),
    );
    await valido(terceiro.xml);
    expect(terceiro.xml).toContain(
      "<indIEToma>9</indIEToma><toma4><toma>4</toma><CNPJ>60701190000104</CNPJ><xNome>Pagador do Frete Ltda</xNome><xFant>Pagador</xFant><fone>1130034070</fone><enderToma>",
    );
    expect(terceiro.xml).toContain("<email>fiscal@pagador.example</email></toma4>");
  });

  it("sem NF-e (dentro do estado): vai uma declaração com o código da carga", async () => {
    const { xml } = assinado(
      dadosDeExemplo({
        chavesDeNfe: [],
        fim: { codigoMunicipio: "3530300", municipio: "Mirassol", uf: "SP" },
        destinatario: { documento: "39053344705", nome: "Maria da Silva", endereco: { logradouro: "Rua Um", numero: "", bairro: "Vila Nova", codigoMunicipio: "3530300", municipio: "Mirassol", uf: "SP" } },
        tomador: { papel: "DESTINATARIO" },
        contribuinte: "9",
      }),
    );
    await valido(xml);
    expect(xml).toContain("<infDoc><infOutros><tpDoc>00</tpDoc><nDoc>1234567890</nDoc></infOutros></infDoc>");
    // Destinatário pessoa física, sem número de porta e sem CEP.
    expect(xml).toContain("<dest><CPF>39053344705</CPF><xNome>");
    expect(xml).toContain("<enderDest><xLgr>Rua Um</xLgr><nro>S/N</nro><xBairro>Vila Nova</xBairro><cMun>3530300</cMun><xMun>Mirassol</xMun><UF>SP</UF></enderDest>");
  });

  it("várias NF-e, IE isenta, componentes que não fecham com o total e texto fora do Latin-1", async () => {
    const { xml } = assinado(
      dadosDeExemplo({
        emitente: { ...EMITENTE, ambiente: "PRODUCAO", fantasia: null, telefone: null },
        enderecoDoQrCode: "https://nfe.fazenda.sp.gov.br/CTeConsulta/qrCode",
        chavesDeNfe: ["35261045543915000181550010000012341000012341", "35261045543915000181550010000012351000012357", "35261045543915000181550010000012341000012341"],
        remetente: { ...REMETENTE, ie: "ISENTO", nome: "Aço & Cia – “Matriz” <SP> 🚚" },
        contribuinte: "2",
        componentes: [{ nome: "Frete peso", valor: 10 }],
        produto: "",
        observacao: null,
      }),
    );
    await valido(xml);
    // A chave repetida entra uma vez só.
    expect(xml.split("<infNFe>")).toHaveLength(3);
    expect(xml).toContain('<IE>ISENTO</IE><xNome>Aço &amp; Cia - "Matriz" &lt;SP&gt;</xNome>');
    // Assinar não muda o conteúdo: o que foi montado está inteiro dentro do que foi assinado.
    const montado = montarCte(dadosDeExemplo({ remetente: { ...REMETENTE, nome: "Aço & Cia – “Matriz” <SP> 🚚" } })).xml;
    const assinadoDele = assinarXml(montado, ALVO_DO_CTE, { chavePem: lido.chavePem, certificadoPem: lido.titularPem });
    expect(assinadoDele.startsWith(montado.replace("</CTe>", ""))).toBe(true);
    // Componentes que não somam o total: vai um só, com o total.
    expect(xml).toContain("<vRec>850.50</vRec><Comp><xNome>FRETE</xNome><vComp>850.50</vComp></Comp></vPrest>");
    expect(xml).toContain("<proPred>DIVERSOS</proPred>");
    expect(xml).not.toContain("<compl>");
    expect(xml).not.toContain("<xFant></xFant>");
  });

  it("emitente de outra UF que a do início da prestação: CFOP 5932 ou 6932 (regra G051)", () => {
    const emitente = { cfopDentro: "5353", cfopFora: "6353", uf: "SP" };
    expect(cfopDaPrestacao(emitente, "SP", "SP")).toBe("5353");
    expect(cfopDaPrestacao(emitente, "SP", "MG")).toBe("6353");
    expect(cfopDaPrestacao(emitente, "MG", "MG")).toBe("5932");
    expect(cfopDaPrestacao(emitente, "MG", "RJ")).toBe("6932");
  });

  it("o ICMS sai da configuração da empresa", () => {
    expect(icmsDaPrestacao({ icms: "00", aliquota: 12 }, 100)).toEqual({ situacao: "00", base: 100, aliquota: 12, valor: 12 });
    expect(icmsDaPrestacao({ icms: "90", aliquota: 7 }, 33.33)).toEqual({ situacao: "90", base: 33.33, aliquota: 7, valor: 2.33 });
    expect(icmsDaPrestacao({ icms: "40", aliquota: 12 }, 100)).toEqual({ situacao: "40", base: 0, aliquota: 0, valor: 0 });
    expect(icmsDaPrestacao({ icms: "SN", aliquota: 0 }, 100)).toEqual({ situacao: "SN", base: 0, aliquota: 0, valor: 0 });
  });

  it("o grupo do modal rodoviário passa no esquema do modal (cteModalRodoviario_v4.00.xsd)", async () => {
    const rodo = montarModalRodoviario("12345678").replace("<rodo>", '<rodo xmlns="http://www.portalfiscal.inf.br/cte">');
    expect(await errosNoEsquema(rodo, "cteModalRodoviario_v4.00.xsd")).toEqual([]);
    // E o validador recusa mesmo o que está errado: RNTRC com 7 dígitos.
    const errado = montarModalRodoviario("1234567").replace("<rodo>", '<rodo xmlns="http://www.portalfiscal.inf.br/cte">');
    expect((await errosNoEsquema(errado, "cteModalRodoviario_v4.00.xsd")).length).toBeGreaterThan(0);
  });

  it("o validador recusa um CT-e errado: sem assinatura, e com campo fora do tipo", async () => {
    const semAssinatura = montarCte(dadosDeExemplo()).xml;
    expect((await errosNoEsquema(semAssinatura, "cte_v4.00.xsd")).join(" ")).toMatch(/Signature/);
    const foraDoTipo = assinado().xml.replace("<modal>01</modal>", "<modal>99</modal>");
    expect((await errosNoEsquema(foraDoTipo, "cte_v4.00.xsd")).join(" ")).toMatch(/modal/);
  });

  it("a observação da viagem só existe quando há o que dizer", () => {
    expect(observacaoDaViagem(null)).toBeNull();
    expect(observacaoDaViagem({ placa: null, motorista: null })).toBeNull();
    expect(observacaoDaViagem({ placa: "ABC1D23", motorista: null })).toBe("Veiculo placa ABC1D23.");
    expect(observacaoDaViagem({ placa: "ABC1D23", motorista: "João" })).toBe("Veiculo placa ABC1D23. Motorista João.");
  });
});

/* --------------------------------- Assinatura -------------------------------- */

describe("assinatura digital (XMLDSig, RSA-SHA1, C14N, enveloped)", () => {
  it("assina o infCte e a assinatura confere de volta", () => {
    const { xml, chave } = assinado();
    expect(assinaturaConfere(xml, lido.titularPem)).toBe(true);
    // Os algoritmos e a referência são os que o MOC exige.
    expect(xml).toContain('<CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>');
    expect(xml).toContain('<SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"/>');
    expect(xml).toContain(`<Reference URI="#CTe${chave}">`);
    expect(xml).toContain(
      '<Transforms><Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/><Transform Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/></Transforms>',
    );
    expect(xml).toContain('<DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"/>');
    // A assinatura é o último filho do CTe, com o certificado do emitente e nada mais no KeyInfo.
    expect(xml).toMatch(/<\/infCTeSupl><Signature xmlns="http:\/\/www\.w3\.org\/2000\/09\/xmldsig#">.*<\/Signature><\/CTe>$/);
    expect(xml).toMatch(/<KeyInfo><X509Data><X509Certificate>[A-Za-z0-9+/=]+<\/X509Certificate><\/X509Data><\/KeyInfo>/);
    expect(resumoDaAssinatura(xml)).toMatch(/^[A-Za-z0-9+/]{27}=$/);
    // A chave privada não vai junto.
    expect(xml).not.toContain("PRIVATE KEY");
  });

  it("XML alterado depois de assinado não confere", () => {
    const { xml } = assinado();
    expect(assinaturaConfere(xml.replace("<vTPrest>850.50</vTPrest>", "<vTPrest>8.50</vTPrest>"), lido.titularPem)).toBe(false);
    expect(assinaturaConfere(xml.replace("<nCT>15</nCT>", "<nCT>16</nCT>"), lido.titularPem)).toBe(false);
    // Mexer fora do infCte (no QR Code) não quebra a assinatura: só o infCte é assinado.
    expect(assinaturaConfere(xml.replace("tpAmb=2</qrCodCTe>", "tpAmb=1</qrCodCTe>"), lido.titularPem)).toBe(true);
  });

  it("não confere contra o certificado de outra empresa, nem sem assinatura", () => {
    const outro = certificadoDeTeste({ cnpj: "45543915000181" });
    expect(assinaturaConfere(assinado().xml, outro.certificadoPem)).toBe(false);
    expect(assinaturaConfere(montarCte(dadosDeExemplo()).xml, lido.titularPem)).toBe(false);
  });

  it("o evento de cancelamento assinado passa nos esquemas do evento", async () => {
    const { chave } = assinado();
    const evento = montarCancelamento({ chave, cnpj: EMITENTE.cnpj, ambiente: "HOMOLOGACAO", protocolo: "135260000000001", justificativa: "Carga recusada pelo destinatário na entrega", quando: new Date("2026-10-11T12:00:00Z") });
    expect(evento.id).toBe(`ID110111${chave}001`);
    const xml = assinarXml(evento.xml, ALVO_DO_EVENTO, { chavePem: lido.chavePem, certificadoPem: lido.titularPem });
    expect(await errosNoEsquema(xml, "eventoCTe_v4.00.xsd")).toEqual([]);
    expect(assinaturaConfere(xml, lido.titularPem)).toBe(true);
    expect(xml).toContain(`<infEvento Id="ID110111${chave}001"><cOrgao>35</cOrgao><tpAmb>2</tpAmb><CNPJ>11222333000181</CNPJ><chCTe>${chave}</chCTe><dhEvento>2026-10-11T09:00:00-03:00</dhEvento><tpEvento>110111</tpEvento><nSeqEvento>1</nSeqEvento>`);
    expect(xml).toContain(`<Reference URI="#ID110111${chave}001">`);

    // O detalhe do evento tem esquema próprio.
    const detalhe = /<evCancCTe>[\s\S]*<\/evCancCTe>/.exec(xml)![0].replace("<evCancCTe>", '<evCancCTe xmlns="http://www.portalfiscal.inf.br/cte">');
    expect(await errosNoEsquema(detalhe, "evCancCTe_v4.00.xsd")).toEqual([]);
    expect(detalhe).toContain("<descEvento>Cancelamento</descEvento><nProt>135260000000001</nProt><xJust>Carga recusada pelo destinatário na entrega</xJust>");
  });
});

/* -------------------------------- Certificado -------------------------------- */

describe("certificado A1", () => {
  it("abre o .pfx com a senha e lê titular, CNPJ, validade e tipo", () => {
    expect(lido.titular).toBe("TRANSPORTADORA DE TESTE LTDA");
    expect(lido.cnpj).toBe("11222333000181");
    expect(lido.a1).toBe(true);
    expect(lido.validoAte.getTime()).toBeGreaterThan(Date.now());
    expect(lido.chavePem).toContain("PRIVATE KEY");
    expect(lido.titularPem).toContain("BEGIN CERTIFICATE");
    expect(conferirCertificado(lido, "11222333000181")).toBe("MESMO_CNPJ");
    // Filial da mesma empresa (mesma raiz de 8 dígitos): o MOC aceita.
    expect(conferirCertificado(lido, "11222333000262")).toBe("MESMA_EMPRESA");
  });

  it("senha errada, arquivo que não é certificado e arquivo sem a chave privada", () => {
    expect(() => lerCertificado(certificado.pfx, "outra-senha")).toThrow(SENHA_ERRADA);
    expect(() => lerCertificado(Buffer.from("isto não é um pfx"), "x")).toThrow(SENHA_ERRADA);
    expect(() => lerCertificado(Buffer.alloc(0), "x")).toThrow(CertificadoError);
    const semChave = certificadoDeTeste({ comChave: false });
    expect(() => lerCertificado(semChave.pfx, semChave.senha)).toThrow(SEM_CHAVE);
    // A mensagem nunca leva a senha.
    try {
      lerCertificado(certificado.pfx, "senha-que-eu-digitei-errado");
    } catch (erro) {
      expect((erro as Error).message).not.toContain("senha-que-eu-digitei-errado");
    }
  });

  it("recusa certificado de outro CNPJ, vencido, ainda não válido, sem CNPJ e que não é A1", () => {
    expect(() => conferirCertificado(lido, "45543915000181")).toThrow(DE_OUTRO_CNPJ);

    const vencido = certificadoDeTeste({ validoDe: new Date(Date.now() - 400 * 86_400_000), validoAte: new Date(Date.now() - 86_400_000) });
    expect(() => conferirCertificado(lerCertificado(vencido.pfx, vencido.senha), vencido.cnpj)).toThrow(VENCIDO);

    const futuro = certificadoDeTeste({ validoDe: new Date(Date.now() + 86_400_000) });
    expect(() => conferirCertificado(lerCertificado(futuro.pfx, futuro.senha), futuro.cnpj)).toThrow(AINDA_NAO_VALE);

    const pessoaFisica = certificadoDeTeste({ comCnpj: false, nome: "JOAO DA SILVA:39053344705" });
    const lidoDaPessoa = lerCertificado(pessoaFisica.pfx, pessoaFisica.senha);
    expect(lidoDaPessoa.cnpj).toBeNull();
    expect(() => conferirCertificado(lidoDaPessoa, "11222333000181")).toThrow(NAO_E_ECNPJ);

    const a3 = certificadoDeTeste({ tipo: 3 });
    expect(() => conferirCertificado(lerCertificado(a3.pfx, a3.senha), a3.cnpj)).toThrow(NAO_E_A1);
    const semPolitica = certificadoDeTeste({ tipo: null });
    expect(() => conferirCertificado(lerCertificado(semPolitica.pfx, semPolitica.senha), semPolitica.cnpj)).toThrow(NAO_E_A1);
  });

  it("certificado de empresa com CNPJ alfanumérico", () => {
    const alfa = certificadoDeTeste({ cnpj: "12ABC34501DE35" });
    const lidoDele = lerCertificado(alfa.pfx, alfa.senha);
    expect(lidoDele.cnpj).toBe("12ABC34501DE35");
    expect(conferirCertificado(lidoDele, "12ABC34501DE35")).toBe("MESMO_CNPJ");
    expect(() => conferirCertificado(lidoDele, "12ABC35501DE30")).toThrow(DE_OUTRO_CNPJ);
  });

  it("sem o otherName, aceita o CNPJ escrito depois dos dois-pontos do nome comum", () => {
    const peloNome = certificadoDeTeste({ comCnpj: false, nome: "EMPRESA ANTIGA LTDA:11222333000181" });
    expect(lerCertificado(peloNome.pfx, peloNome.senha).cnpj).toBe("11222333000181");
  });

  it("o envio do certificado é validado antes de abrir o arquivo", () => {
    expect(certificadoSchema.safeParse({ arquivo: certificado.pfx.toString("base64"), senha: "x" }).success).toBe(true);
    expect(certificadoSchema.safeParse({ arquivo: "", senha: "x" }).success).toBe(false);
    expect(certificadoSchema.safeParse({ arquivo: "não é base64!", senha: "x" }).success).toBe(false);
    expect(certificadoSchema.safeParse({ arquivo: "QUJD", senha: "" }).success).toBe(false);
    expect(certificadoSchema.safeParse({ arquivo: "A".repeat(200_000), senha: "x" }).success).toBe(false);
  });
});

/* ------------------------------ Dados do emitente ----------------------------- */

describe("dados fiscais do emitente", () => {
  const formulario = {
    cnpj: "11.222.333/0001-81",
    ie: "123.456.789.012",
    razaoSocial: " Transportadora de Teste Ltda ",
    fantasia: "",
    logradouro: "Rua das Flores",
    numero: "120",
    complemento: "",
    bairro: "Centro",
    cidade: "Mirassol",
    uf: "SP",
    cep: "15130-000",
    telefone: "(17) 3242-1000",
    rntrc: "12345678",
    regime: "3",
    serie: "1",
    proximoNumero: "1",
    ambiente: "HOMOLOGACAO",
    cfopDentro: "5353",
    cfopFora: "6353",
    icms: "00",
    aliquota: "12",
    ibsCbsCst: "000",
    ibsCbsClasse: "000001",
  };

  it("IBS/CBS: obrigatório para o regime normal, CST e classificação andam juntos, e as alíquotas de 2026 são o padrão", () => {
    expect(dadosFiscaisSchema.parse(formulario)).toMatchObject({ ibsCbsCst: "000", ibsCbsClasse: "000001", ibsUf: 0.1, ibsMunicipio: 0, cbs: 0.9, pis: 0, cofins: 0 });
    expect(dadosFiscaisSchema.parse({ ...formulario, ibsUf: "0,05", ibsMunicipio: "0.05", cbs: "8,8", pis: "1,65", cofins: "7,6" })).toMatchObject({ ibsUf: 0.05, ibsMunicipio: 0.05, cbs: 8.8, pis: 1.65, cofins: 7.6 });
    expect(dadosFiscaisSchema.safeParse({ ...formulario, ibsCbsCst: "", ibsCbsClasse: "" }).error?.issues[0]?.message).toBe(IBSCBS_OBRIGATORIO);
    expect(dadosFiscaisSchema.safeParse({ ...formulario, ibsCbsClasse: "" }).error?.issues[0]?.message).toBe(IBSCBS_INCOMPLETO);
    expect(dadosFiscaisSchema.safeParse({ ...formulario, ibsCbsCst: "200" }).error?.issues[0]?.message).toBe(IBSCBS_CST_FORA_DA_LISTA);
    expect(dadosFiscaisSchema.safeParse({ ...formulario, ibsCbsCst: "00" }).success).toBe(false);
    expect(dadosFiscaisSchema.safeParse({ ...formulario, ibsCbsClasse: "1" }).success).toBe(false);
    expect(dadosFiscaisSchema.safeParse({ ...formulario, cbs: "0,90001" }).success).toBe(false);
    expect(dadosFiscaisSchema.safeParse({ ...formulario, cbs: "101" }).success).toBe(false);
    // O Simples Nacional não é obrigado a levar o grupo (NT 2026.002, regra 001).
    expect(dadosFiscaisSchema.parse({ ...formulario, regime: "1", icms: "SN", aliquota: "0", ibsCbsCst: "", ibsCbsClasse: "" })).toMatchObject({ ibsCbsCst: null, ibsCbsClasse: null });
  });

  it("CNPJ do emitente com letras é aceito, com ou sem pontuação e em minúsculas", () => {
    expect(dadosFiscaisSchema.parse({ ...formulario, cnpj: "12.abc.345/01de-35" }).cnpj).toBe("12ABC34501DE35");
    expect(dadosFiscaisSchema.safeParse({ ...formulario, cnpj: "12.ABC.345/01DE-36" }).success).toBe(false);
  });

  it("aceita o formulário, tira a máscara e converte os números", () => {
    const lidoDoFormulario = dadosFiscaisSchema.parse(formulario);
    expect(lidoDoFormulario).toMatchObject({ cnpj: "11222333000181", ie: "123456789012", razaoSocial: "Transportadora de Teste Ltda", fantasia: null, cep: "15130000", telefone: "1732421000", serie: 1, proximoNumero: 1, aliquota: 12 });
    expect(dadosFiscaisSchema.parse({ ...formulario, aliquota: "7,5", telefone: "" })).toMatchObject({ aliquota: 7.5, telefone: null });
  });

  it.each([
    [{ cnpj: "11.222.333/0001-82" }, "CNPJ válido"],
    [{ cnpj: "123" }, "CNPJ válido"],
    [{ ie: "1" }, "inscrição estadual"],
    [{ razaoSocial: "x" }, "razão social"],
    [{ uf: "XX" }, "UF"],
    [{ cep: "1513" }, "CEP"],
    [{ telefone: "123" }, "telefone"],
    [{ rntrc: "1234" }, "RNTRC"],
    [{ regime: "9" }, "regime"],
    [{ serie: "1000" }, "série"],
    [{ serie: "-1" }, "série"],
    [{ proximoNumero: "0" }, "próximo número"],
    [{ proximoNumero: "1.5" }, "próximo número"],
    [{ ambiente: "TESTE" }, "ambiente"],
    [{ cfopDentro: "6353" }, "dentro do estado"],
    [{ cfopFora: "5353" }, "fora do estado"],
    [{ cfopDentro: "5300" }, "dentro do estado"],
    [{ icms: "20" }, "situação tributária"],
    [{ aliquota: "101" }, "alíquota"],
    [{ aliquota: "abc" }, "alíquota"],
  ])("recusa %j", (troca, trecho) => {
    const resultado = dadosFiscaisSchema.safeParse({ ...formulario, ...troca });
    expect(resultado.success).toBe(false);
    expect(resultado.error?.issues[0]?.message).toContain(trecho);
  });

  it("a situação do ICMS acompanha o regime, e tributação pede alíquota", () => {
    expect(dadosFiscaisSchema.safeParse({ ...formulario, regime: "1" }).error?.issues[0]?.message).toBe(SIMPLES_PEDE_SN);
    expect(dadosFiscaisSchema.safeParse({ ...formulario, regime: "1", icms: "SN", aliquota: "0" }).success).toBe(true);
    expect(dadosFiscaisSchema.safeParse({ ...formulario, icms: "SN" }).error?.issues[0]?.message).toBe(SN_SO_NO_SIMPLES);
    expect(dadosFiscaisSchema.safeParse({ ...formulario, aliquota: "0" }).error?.issues[0]?.message).toBe(TRIBUTADO_PEDE_ALIQUOTA);
    expect(dadosFiscaisSchema.safeParse({ ...formulario, icms: "40", aliquota: "0" }).success).toBe(true);
    // Simples com excesso de sublimite (regime 2) recolhe ICMS pelo regime normal.
    expect(dadosFiscaisSchema.safeParse({ ...formulario, regime: "2" }).success).toBe(true);
  });

  it("a tabela de municípios dá o código IBGE", () => {
    expect(municipioDoTexto("Mirassol - SP")).toEqual({ codigo: "3530300", nome: "Mirassol", uf: "SP" });
    expect(municipioDoTexto("MIRASSOL/SP")).toEqual({ codigo: "3530300", nome: "Mirassol", uf: "SP" });
    expect(municipioDoTexto("sao jose do rio preto")).toEqual({ codigo: "3549805", nome: "São José do Rio Preto", uf: "SP" });
    expect(municipioDoTexto("Belo Horizonte - MG")?.codigo).toBe("3106200");
    // Nome que existe em mais de um estado: só com a UF.
    expect(municipioDoTexto("Bom Jesus")).toBeNull();
    expect(municipioDoTexto("Bom Jesus", "PI")?.uf).toBe("PI");
    expect(municipioDoTexto("Cidade Que Não Existe - SP")).toBeNull();
    expect(municipioDoTexto("")).toBeNull();
  });
});

/* -------------------------------- Cancelamento -------------------------------- */

describe("regras de cancelamento e o selo da lista", () => {
  it("a justificativa tem de 15 a 255 letras", () => {
    expect(cancelarSchema.safeParse({ justificativa: "curta demais" }).success).toBe(false);
    expect(cancelarSchema.safeParse({ justificativa: "   quinze letras  " }).success).toBe(false);
    expect(cancelarSchema.parse({ justificativa: "  Carga recusada na entrega  " })).toEqual({ justificativa: "Carga recusada na entrega" });
    expect(cancelarSchema.safeParse({ justificativa: "x".repeat(256) }).success).toBe(false);
    expect(cancelarSchema.safeParse({}).success).toBe(false);
  });

  it("o prazo é de 168 horas da autorização", () => {
    const agora = new Date("2026-10-10T12:00:00Z");
    expect(dentroDoPrazoDeCancelamento("2026-10-03T12:00:00Z", agora)).toBe(true);
    expect(dentroDoPrazoDeCancelamento("2026-10-03T11:59:59Z", agora)).toBe(false);
    expect(dentroDoPrazoDeCancelamento(null, agora)).toBe(false);
    expect(dentroDoPrazoDeCancelamento("não é data", agora)).toBe(false);
  });

  it("o selo diz a situação e marca o que é de homologação", () => {
    expect(seloDoCte({ situacao: "AUTHORIZED", ambiente: "PRODUCAO", numero: 15, semResposta: false })).toBe("Autorizado nº 15");
    expect(seloDoCte({ situacao: "AUTHORIZED", ambiente: "HOMOLOGACAO", numero: 15, semResposta: false })).toBe("Autorizado nº 15 (homologação)");
    expect(seloDoCte({ situacao: "CANCELLED", ambiente: "PRODUCAO", numero: 15, semResposta: false })).toBe("Cancelado nº 15");
    expect(seloDoCte({ situacao: "REJECTED", ambiente: "PRODUCAO", numero: 15, semResposta: false })).toBe("Rejeitado");
    expect(seloDoCte({ situacao: "DRAFT", ambiente: "PRODUCAO", numero: 15, semResposta: true })).toBe("Sem resposta da SEFAZ");
    expect(seloDoCte({ situacao: "DRAFT", ambiente: "PRODUCAO", numero: 15, semResposta: false })).toBe("Rascunho");
  });
});

/* ---------------------------------- Endereços --------------------------------- */

describe("endereços dos web services", () => {
  it("cada UF tem o seu autorizador", () => {
    expect(autorizadorDaUf("SP")).toBe("SP");
    expect(autorizadorDaUf("RS")).toBe("RS");
    expect(autorizadorDaUf("MG")).toBe("MG");
    expect(autorizadorDaUf("PE")).toBe("SVSP");
    expect(autorizadorDaUf("RJ")).toBe("SVRS");
    expect(autorizadorDaUf("SC")).toBe("SVRS");
    expect(autorizadorDaUf("XX")).toBeNull();
    // As 27 UFs estão cobertas.
    const ufs = "AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO".split(" ");
    expect(ufs.filter((uf) => enderecosDaUf(uf, "HOMOLOGACAO") === null)).toEqual([]);
  });

  it("homologação e produção nunca apontam para o mesmo serviço, e tudo é https", () => {
    for (const [autorizador, porAmbiente] of Object.entries(ENDERECOS)) {
      for (const servico of ["status", "consulta", "evento", "recepcao"] as const) {
        expect(porAmbiente.HOMOLOGACAO[servico], autorizador).not.toBe(porAmbiente.PRODUCAO[servico]);
        expect(porAmbiente.HOMOLOGACAO[servico]).toMatch(/^https:\/\/[^?]+$/);
        expect(porAmbiente.PRODUCAO[servico]).toMatch(/^https:\/\/[^?]+$/);
      }
    }
    expect(enderecosDaUf("SP", "HOMOLOGACAO")?.recepcao).toBe("https://homologacao.nfe.fazenda.sp.gov.br/CTeWS/WS/CTeRecepcaoSincV4.asmx");
    expect(enderecosDaUf("SC", "PRODUCAO")?.status).toBe("https://cte.svrs.rs.gov.br/ws/CTeStatusServicoV4/CTeStatusServicoV4.asmx");
    expect(enderecosDaUf("PE", "PRODUCAO")?.evento).toBe("https://nfe.fazenda.sp.gov.br/CTeWS/WS/CTeRecepcaoEventoV4.asmx");
  });

  it("a URL do QR Code é a do MOC: consulta + chave + ambiente", () => {
    expect(urlDoQrCode("https://dfe-portal.svrs.rs.gov.br/cte/qrCode", "43181203527568000153570010002211211062211212", "PRODUCAO")).toBe(
      "https://dfe-portal.svrs.rs.gov.br/cte/qrCode?chCTe=43181203527568000153570010002211211062211212&tpAmb=1",
    );
  });
});

/* ----------------------------------- Mensagens -------------------------------- */

describe("mensagens para a SEFAZ", () => {
  it("status e consulta passam nos esquemas oficiais", async () => {
    const status = mensagemDeStatus("SP", "HOMOLOGACAO");
    expect(status).toBe('<consStatServCTe xmlns="http://www.portalfiscal.inf.br/cte" versao="4.00"><tpAmb>2</tpAmb><cUF>35</cUF><xServ>STATUS</xServ></consStatServCTe>');
    expect(await errosNoEsquema(status, "consStatServCTe_v4.00.xsd")).toEqual([]);
    const consulta = mensagemDeConsulta("43181203527568000153570010002211211062211212", "PRODUCAO");
    expect(await errosNoEsquema(consulta, "consSitCTe_v4.00.xsd")).toEqual([]);
  });

  it("o envelope é SOAP 1.2, com a mensagem no cteDadosMsg do serviço", () => {
    expect(envelope("CTeStatusServicoV4", "<x/>")).toBe(
      '<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body><cteDadosMsg xmlns="http://www.portalfiscal.inf.br/cte/wsdl/CTeStatusServicoV4"><x/></cteDadosMsg></soap12:Body></soap12:Envelope>',
    );
  });

  it("o CT-e vai compactado em GZip e escrito em Base64", () => {
    const { xml } = assinado();
    const compactado = compactar(xml);
    expect(compactado).toMatch(/^H4sI[A-Za-z0-9+/]+=*$/);
    expect(gunzipSync(Buffer.from(compactado, "base64")).toString("utf8")).toBe(xml);
  });

  it("resposta que não é um envelope SOAP, ou que traz Fault, vira erro", () => {
    expect(() => corpoDaResposta("<html>403</html>")).toThrow(SefazError);
    expect(() => corpoDaResposta("isto não é xml")).toThrow(SefazError);
    expect(() =>
      corpoDaResposta('<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body><s:Fault><s:Reason><s:Text>Deu ruim</s:Text></s:Reason></s:Fault></s:Body></s:Envelope>'),
    ).toThrow("A SEFAZ recusou a mensagem: Deu ruim");
  });
});

/* ------------------------- Conversa com o servidor local ----------------------- */

describe("cliente SOAP contra um servidor HTTPS local que imita a SEFAZ", () => {
  let sefaz: SefazDeMentira;
  let destino: Destino;

  beforeAll(async () => {
    sefaz = await subirSefazDeMentira();
    usarSefazDeTeste({ url: sefaz.url, autoridades: sefaz.autoridades });
    destino = { uf: "SP", ambiente: "HOMOLOGACAO", credencial: { chavePem: lido.chavePem, certificadoPem: lido.certificadoPem }, tempoLimiteMs: 3000 };
  });

  afterAll(async () => {
    usarSefazDeTeste(null);
    await sefaz.fechar();
  });

  const esperado = (cte: { chave: string; xml: string }) => ({ chave: cte.chave, ambiente: "HOMOLOGACAO" as const, resumo: resumoDaAssinatura(cte.xml) });

  it("status do serviço: em operação, com o certificado do emitente apresentado na conexão", async () => {
    sefaz.modo = "autorizar";
    sefaz.chamadas.length = 0;
    expect(await statusDoServico(destino)).toEqual({ cStat: 107, motivo: "Serviço em Operação", emOperacao: true });
    expect(sefaz.chamadas).toHaveLength(1);
    expect(sefaz.chamadas[0].servico).toBe("CTeStatusServicoV4");
    // Autenticação mútua: o servidor viu o certificado do emitente.
    expect(sefaz.chamadas[0].certificadoDoCliente).toBe(impressaoDigital(certificado.certificadoPem));
    expect(sefaz.chamadas[0].acao).toBe('application/soap+xml; charset=utf-8; action="http://www.portalfiscal.inf.br/cte/wsdl/CTeStatusServicoV4/cteStatusServicoCT"');
    expect(sefaz.chamadas[0].dados).toBe(mensagemDeStatus("SP", "HOMOLOGACAO"));
  });

  it("serviço paralisado: a resposta diz que não está em operação", async () => {
    sefaz.modo = "parado";
    expect(await statusDoServico(destino)).toEqual({ cStat: 108, motivo: "Serviço Paralisado Momentaneamente", emOperacao: false });
  });

  it("sem certificado, o servidor recusa (403), como a SEFAZ", async () => {
    sefaz.modo = "autorizar";
    await expect(statusDoServico({ ...destino, credencial: null })).rejects.toMatchObject({ name: "SefazError", motivo: "http", message: "A SEFAZ respondeu com o status 403." });
  });

  it("servidor com certificado desconhecido não é aceito: a conferência do certificado do servidor fica ligada", async () => {
    const semAutoridade = chamarSoap({
      url: `${sefaz.url}/CTeStatusServicoV4`,
      servico: "CTeStatusServicoV4",
      metodo: "cteStatusServicoCT",
      dados: mensagemDeStatus("SP", "HOMOLOGACAO"),
      credencial: destino.credencial,
      tempoLimiteMs: 3000,
    });
    await expect(semAutoridade).rejects.toMatchObject({ motivo: "conexao", message: SEFAZ_FORA_DO_AR, incerto: false });
    await expect(chamarSoap({ url: "http://127.0.0.1:1/x", servico: "S", metodo: "m", dados: "", credencial: null })).rejects.toMatchObject({ motivo: "conexao" });
  });

  it("envio autorizado (100): o servidor recebeu o XML compactado e válido, e devolveu o protocolo", async () => {
    sefaz.modo = "autorizar";
    sefaz.chamadas.length = 0;
    const cte = assinado();
    const resposta = await enviarCte(destino, cte.xml);
    // O que chegou lá é exatamente o XML assinado, e ele passa no esquema.
    expect(sefaz.chamadas[0].servico).toBe("CTeRecepcaoSincV4");
    expect(sefaz.chamadas[0].dados).toBe(cte.xml);
    expect(await errosNoEsquema(sefaz.chamadas[0].dados, "cte_v4.00.xsd")).toEqual([]);

    const decisao = decidir(resposta, esperado(cte));
    expect(decisao.tipo).toBe("autorizado");
    if (decisao.tipo !== "autorizado") return;
    expect(decisao.protocolo.numero).toMatch(/^\d{15}$/);
    expect(decisao.protocolo.chave).toBe(cte.chave);
    expect(decisao.protocolo.resumo).toBe(resumoDaAssinatura(cte.xml));

    // O arquivo do CT-e autorizado (cteProc) passa no esquema oficial.
    const proc = montarProcCte(cte.xml, decisao.protocolo.xml);
    expect(await errosNoEsquema(proc, "procCTe_v4.00.xsd")).toEqual([]);
    expect(proc).toContain(`<nProt>${decisao.protocolo.numero}</nProt>`);

    // A consulta pela chave acha o mesmo protocolo.
    const consulta = decidir(await consultarCte(destino, cte.chave), esperado(cte));
    expect(consulta.tipo === "autorizado" && consulta.protocolo.numero).toBe(decisao.protocolo.numero);
  });

  it("rejeição: código e motivo da SEFAZ, sem protocolo", async () => {
    sefaz.modo = "rejeitar";
    const cte = assinado(dadosDeExemplo({ numero: 16 }));
    const decisao = decidir(await enviarCte(destino, cte.xml), esperado(cte));
    expect(decisao).toEqual({ tipo: "rejeitado", cStat: 481, motivo: "Rejeição: IE deve ser informada para tomador Contribuinte" });
  });

  it("duplicidade (204): o mesmo CT-e já está lá; número usado por outro documento (539)", async () => {
    sefaz.modo = "duplicidade";
    const cte = assinado(dadosDeExemplo({ numero: 17 }));
    expect(decidir(await enviarCte(destino, cte.xml), esperado(cte))).toMatchObject({ tipo: "ja-autorizado", cStat: CSTAT.DUPLICIDADE });
    sefaz.modo = "numero-usado";
    expect(decidir(await enviarCte(destino, cte.xml), esperado(cte))).toMatchObject({ tipo: "numero-usado", cStat: CSTAT.DUPLICIDADE_COM_OUTRA_CHAVE });
  });

  it("serviço paralisado no envio: nada foi processado", async () => {
    sefaz.modo = "parado";
    const cte = assinado(dadosDeExemplo({ numero: 18 }));
    expect(decidir(await enviarCte(destino, cte.xml), esperado(cte))).toEqual({ tipo: "parado", cStat: 108, motivo: "Serviço Paralisado Momentaneamente" });
  });

  it("tempo esgotado: erro marcado como incerto (a mensagem pode ter chegado)", async () => {
    sefaz.modo = "mudo";
    const cte = assinado(dadosDeExemplo({ numero: 19 }));
    const inicio = Date.now();
    await expect(enviarCte({ ...destino, tempoLimiteMs: 400 }, cte.xml)).rejects.toMatchObject({ name: "SefazError", motivo: "tempo", message: SEFAZ_TEMPO_ESGOTADO, incerto: true });
    expect(Date.now() - inicio).toBeLessThan(2500);
  });

  it("erro de SOAP (Fault) e servidor fora do ar", async () => {
    sefaz.modo = "fault";
    await expect(statusDoServico(destino)).rejects.toThrow("A SEFAZ recusou a mensagem: Falha no processamento da mensagem");
    usarSefazDeTeste({ url: "https://127.0.0.1:1", autoridades: sefaz.autoridades });
    await expect(statusDoServico(destino)).rejects.toMatchObject({ motivo: "conexao", incerto: false });
    usarSefazDeTeste({ url: sefaz.url, autoridades: sefaz.autoridades });
  });

  it('"autorizado" sem protocolo, ou com o protocolo de outra chave, NÃO vale como autorização', async () => {
    const cte = assinado(dadosDeExemplo({ numero: 20 }));
    sefaz.modo = "sem-protocolo";
    expect(decidir(await enviarCte(destino, cte.xml), esperado(cte))).toEqual({ tipo: "incoerente", motivo: 'A SEFAZ respondeu "autorizado" sem número de protocolo.' });
    sefaz.modo = "outra-chave";
    expect(decidir(await enviarCte(destino, cte.xml), esperado(cte))).toEqual({ tipo: "incoerente", motivo: "O protocolo devolvido é de outra chave de acesso." });

    // Protocolo de outro ambiente, e resumo diferente do XML enviado.
    sefaz.modo = "autorizar";
    const outro = assinado(dadosDeExemplo({ numero: 21 }));
    const resposta = await enviarCte(destino, outro.xml);
    expect(decidir(resposta, { ...esperado(outro), ambiente: "PRODUCAO" })).toEqual({ tipo: "incoerente", motivo: "O protocolo devolvido é de outro ambiente." });
    expect(decidir(resposta, { ...esperado(outro), resumo: "AAAAAAAAAAAAAAAAAAAAAAAAAAA=" })).toEqual({ tipo: "incoerente", motivo: "O protocolo devolvido não corresponde ao XML que foi enviado." });
    expect(decidir(resposta, esperado(outro)).tipo).toBe("autorizado");
  });

  it("consulta de um CT-e que não existe lá: 217", async () => {
    sefaz.modo = "autorizar";
    const cte = assinado(dadosDeExemplo({ numero: 22 }));
    expect(decidir(await consultarCte(destino, cte.chave), esperado(cte))).toMatchObject({ tipo: "rejeitado", cStat: CSTAT.NAO_CONSTA });
  });

  it("cancelamento: evento registrado (135) com protocolo; recusado fora do prazo (220)", async () => {
    sefaz.modo = "autorizar";
    const cte = assinado(dadosDeExemplo({ numero: 23 }));
    const autorizacao = decidir(await enviarCte(destino, cte.xml), esperado(cte));
    if (autorizacao.tipo !== "autorizado") throw new Error("o envio deveria ter sido autorizado");

    const evento = montarCancelamento({ chave: cte.chave, cnpj: EMITENTE.cnpj, ambiente: "HOMOLOGACAO", protocolo: autorizacao.protocolo.numero, justificativa: "Carga recusada pelo destinatário", quando: new Date() });
    const eventoAssinado = assinarXml(evento.xml, ALVO_DO_EVENTO, { chavePem: lido.chavePem, certificadoPem: lido.titularPem });
    sefaz.chamadas.length = 0;
    const resposta = await enviarEvento(destino, eventoAssinado);
    expect(sefaz.chamadas[0].servico).toBe("CTeRecepcaoEventoV4");
    // O evento não vai compactado.
    expect(sefaz.chamadas[0].dados).toBe(eventoAssinado);
    expect(resposta).toMatchObject({ cStat: 135, chave: cte.chave, tipo: "110111" });
    expect(resposta.protocolo).toMatch(/^\d{15}$/);
    expect(eventoRegistrado(resposta, { chave: cte.chave, tipo: "110111" })).toBe(true);
    expect(eventoRegistrado(resposta, { chave: assinado().chave, tipo: "110111" })).toBe(false);
    expect(resposta.xml).toMatch(/^<retEventoCTe[\s\S]*<\/retEventoCTe>$/);
    expect(await errosNoEsquema(resposta.xml, "retEventoCTe_v4.00.xsd")).toEqual([]);

    // Depois de cancelado, a consulta responde 101.
    expect((await consultarCte(destino, cte.chave)).cStat).toBe(CSTAT.CANCELADO);

    sefaz.modo = "rejeitar";
    const recusa = await enviarEvento(destino, eventoAssinado);
    expect(recusa).toMatchObject({ cStat: 220, motivo: "Rejeição: CTe autorizado há mais de 7 dias (168 horas)", protocolo: null });
    expect(eventoRegistrado(recusa, { chave: cte.chave, tipo: "110111" })).toBe(false);
  });
});

/* ---------------------------- Da carga ao documento ---------------------------- */

describe("da carga aos dados do CT-e", () => {
  const nfe = nfeDeExemplo;

  const carga = (trocas: Partial<CargaDoCte> = {}): CargaDoCte => ({
    trackingCode: "1234567890",
    sender: "Indústria Remetente S/A",
    receiver: "Comércio Destinatário Ltda",
    origin: "São José do Rio Preto - SP",
    destination: "Belo Horizonte - MG",
    volumes: 12,
    weight: 1250.5,
    invoiceKey: "35261045543915000181550010000012341000012341",
    invoiceValue: 32500.9,
    freightValue: 850.5,
    freightDetails: { tabela: "Padrão", composicao: [{ rotulo: "Frete peso", valor: 700 }, { rotulo: "Pedágio", valor: 150.5 }], avisos: [] },
    deliveryStreet: null,
    deliveryNumber: null,
    deliveryDistrict: null,
    deliveryZip: null,
    client: { companyName: "Indústria Remetente S/A", tradeName: "Remetente", cnpj: "45543915000181", ie: "110.042.490.114", email: null, phone: null, address: null },
    notas: [{ accessKey: "35261045543915000181550010000012341000012341", xml: nfe() }],
    destinatarios: [],
    viagem: { placa: "ABC1D23", motorista: "João da Silva" },
    ...trocas,
  });

  const QR = "https://homologacao.nfe.fazenda.sp.gov.br/CTeConsulta/qrCode";
  const preparar = (c: CargaDoCte, emitente = EMITENTE) => prepararCte(c, emitente, QR, municipioDoTexto);

  it("com NF-e: remetente e destinatário saem da nota; o cliente pagador que é o emitente da nota é o tomador remetente", async () => {
    const preparo = preparar(carga());
    expect(preparo.pendencias).toEqual([]);
    expect(preparo.dados).not.toBeNull();
    const dados = preparo.dados!;
    expect(dados.tomador).toEqual({ papel: "REMETENTE" });
    expect(dados.contribuinte).toBe("1");
    expect(dados.remetente).toMatchObject({ documento: "45543915000181", ie: "110042490114", nome: "Indústria Remetente S/A", telefone: "1733334444" });
    // O município vem da tabela (nome oficial), com o código IBGE.
    expect(dados.remetente.endereco).toMatchObject({ logradouro: "Av. Brasil", numero: "1500", bairro: "Distrito Industrial", codigoMunicipio: "3549805", municipio: "São José do Rio Preto", uf: "SP", cep: "15035000" });
    expect(dados.destinatario).toMatchObject({ documento: "07526557000100", ie: "0623079040081" });
    expect(dados.destinatario.endereco).toMatchObject({ complemento: "Loja 2", codigoMunicipio: "3106200", uf: "MG" });
    expect(dados.inicio).toEqual({ codigoMunicipio: "3549805", municipio: "São José do Rio Preto", uf: "SP" });
    expect(dados.fim).toEqual({ codigoMunicipio: "3106200", municipio: "Belo Horizonte", uf: "MG" });
    expect(dados.valorDaPrestacao).toBe(850.5);
    expect(dados.componentes).toEqual([{ nome: "Frete peso", valor: 700 }, { nome: "Pedágio", valor: 150.5 }]);
    expect(dados.valorDaCarga).toBe(32500.9);
    expect(dados.produto).toBe("Rolamento de esferas 6204");
    expect(dados.chavesDeNfe).toEqual(["35261045543915000181550010000012341000012341"]);
    expect(dados.observacao).toBe("Veiculo placa ABC1D23. Motorista João da Silva.");
    expect(preparo.resumo).toMatchObject({ cfop: "6353", origem: "São José do Rio Preto - SP", destino: "Belo Horizonte - MG", icms: { situacao: "00", aliquota: 12, valor: 102.06 } });
    expect(preparo.resumo?.tomador).toEqual({ papel: "REMETENTE", nome: "Indústria Remetente S/A", documento: "45.543.915/0001-81", contribuinte: "1" });
    expect(preparo.avisos.join(" ")).toContain("Em homologação");
    expect(preparo.resumo?.ibsCbs).toEqual({ cst: "000", classe: "000001", base: 748.44, ibs: 0.75, cbs: 6.74 });

    // Regime normal sem a classificação do IBS/CBS, e alíquotas que não são as de 2026: avisa.
    const semClassificacao = prepararCte(carga(), { ...EMITENTE, ibsCbs: null }, QR, municipioDoTexto, new Date("2026-10-10T12:00:00Z"));
    expect(semClassificacao.avisos.join(" ")).toContain("rejeição 310");
    expect(semClassificacao.resumo?.ibsCbs).toBeNull();
    const outrasAliquotas = { ...EMITENTE, ibsCbs: { ...EMITENTE.ibsCbs!, ibsUf: 0.05, ibsMunicipio: 0.05 } };
    expect(prepararCte(carga(), outrasAliquotas, QR, municipioDoTexto, new Date("2026-10-10T12:00:00Z")).avisos.join(" ")).toContain("não são as de 2026");
    expect(prepararCte(carga(), outrasAliquotas, QR, municipioDoTexto, new Date("2027-02-01T12:00:00Z")).avisos.join(" ")).not.toContain("não são as de 2026");
    expect(prepararCte(carga(), EMITENTE, QR, municipioDoTexto, new Date("2026-10-10T12:00:00Z")).avisos.join(" ")).not.toContain("não são as de 2026");

    // E o que sai daqui monta um CT-e válido no esquema.
    const montado = montarCte({ ...dados, numero: 1, codigo: "12345678", emissao: new Date() });
    const xml = assinarXml(montado.xml, ALVO_DO_CTE, { chavePem: lido.chavePem, certificadoPem: lido.titularPem });
    expect(await errosNoEsquema(xml, "cte_v4.00.xsd")).toEqual([]);
  });

  it("cliente pagador que é o destinatário da nota: tomador destinatário, sem IE vai como não contribuinte", () => {
    const preparo = preparar(carga({ client: { companyName: "Comércio Destinatário Ltda", tradeName: null, cnpj: "07526557000100", ie: null, email: null, phone: null, address: null }, notas: [{ accessKey: "35261045543915000181550010000012341000012341", xml: nfe({ destIe: "" }) }] }));
    expect(preparo.pendencias).toEqual([]);
    expect(preparo.dados?.tomador).toEqual({ papel: "DESTINATARIO" });
    expect(preparo.dados?.contribuinte).toBe("9");
    expect(preparo.avisos.join(" ")).toContain("não contribuinte");
  });

  it("cliente pagador que não é remetente nem destinatário: tomador outro, com o endereço do cadastro; sem endereço, pendência", async () => {
    const terceiro = { companyName: "Pagador do Frete Ltda", tradeName: null, cnpj: "60701190000104", ie: "ISENTO", email: "fiscal@pagador.example", phone: "(11) 3003-4070" };
    const preparo = preparar(carga({ client: { ...terceiro, address: "Praça Alfredo Egydio, 100 - Jabaquara, São Paulo - SP, CEP 04344-902" } }));
    expect(preparo.pendencias).toEqual([]);
    expect(preparo.dados?.contribuinte).toBe("2");
    expect(preparo.dados?.tomador).toMatchObject({
      papel: "OUTRO",
      participante: { documento: "60701190000104", ie: "ISENTO", nome: "Pagador do Frete Ltda", endereco: { logradouro: "Praça Alfredo Egydio", numero: "100", bairro: "Jabaquara", codigoMunicipio: "3550308", municipio: "São Paulo", uf: "SP", cep: "04344902" } },
    });
    const montado = montarCte({ ...preparo.dados!, numero: 2, codigo: "12345678", emissao: new Date() });
    expect(await errosNoEsquema(assinarXml(montado.xml, ALVO_DO_CTE, { chavePem: lido.chavePem, certificadoPem: lido.titularPem }), "cte_v4.00.xsd")).toEqual([]);

    const semEndereco = preparar(carga({ client: { ...terceiro, address: "Rua sem formato" } }));
    expect(semEndereco.dados).toBeNull();
    expect(semEndereco.pendencias.join(" ")).toContain("não é o remetente nem o destinatário");
  });

  it("sem NF-e: só emite quando o sistema sabe quem são remetente e destinatário (cadastro e destinatário frequente)", async () => {
    const cliente = { companyName: "Indústria Remetente S/A", tradeName: "Remetente", cnpj: "45543915000181", ie: "110042490114", email: null, phone: null, address: "Av. Brasil, 1500 - Distrito Industrial, São José do Rio Preto - SP, CEP 15035-000" };
    const semNota = carga({
      notas: [],
      invoiceKey: null,
      sender: "REMETENTE",
      receiver: "Maria da Silva",
      destination: "Mirassol - SP",
      deliveryStreet: "Rua Um",
      deliveryNumber: null,
      deliveryDistrict: "Vila Nova",
      deliveryZip: "15130000",
      client: cliente,
      destinatarios: [{ name: "maria da silva", document: "390.533.447-05", address: null }],
    });
    const preparo = preparar(semNota);
    expect(preparo.pendencias).toEqual([]);
    expect(preparo.dados?.chavesDeNfe).toEqual([]);
    expect(preparo.dados?.destinatario).toMatchObject({ documento: "39053344705", nome: "maria da silva", endereco: { logradouro: "Rua Um", numero: "S/N", bairro: "Vila Nova", codigoMunicipio: "3530300" } });
    expect(preparo.dados?.produto).toBe("DIVERSOS");
    expect(preparo.avisos.join(" ")).toContain("declaração no lugar da nota");
    const montado = montarCte({ ...preparo.dados!, numero: 3, codigo: "12345678", emissao: new Date() });
    expect(await errosNoEsquema(assinarXml(montado.xml, ALVO_DO_CTE, { chavePem: lido.chavePem, certificadoPem: lido.titularPem }), "cte_v4.00.xsd")).toEqual([]);

    // Remetente e destinatário que o sistema não conhece.
    const desconhecidos = preparar(carga({ notas: [], invoiceKey: null, sender: "Outro Remetente", receiver: "Alguém", destination: "Mirassol - SP", client: cliente }));
    expect(desconhecidos.dados).toBeNull();
    expect(desconhecidos.pendencias).toHaveLength(2);
    expect(desconhecidos.pendencias[0]).toContain("CNPJ/CPF nem o endereço do remetente");
    expect(desconhecidos.pendencias[1]).toContain("CNPJ/CPF do destinatário");

    // Interestadual sem NF-e: a SEFAZ rejeitaria (813).
    const interestadual = preparar({ ...semNota, destination: "Belo Horizonte - MG" });
    expect(interestadual.dados).toBeNull();
    expect(interestadual.pendencias.join(" ")).toContain("interestadual sem NF-e");
  });

  it("a chave digitada na carga vale como NF-e quando é mesmo de NF-e (modelo 55)", () => {
    const comChaveDigitada = preparar(carga({ invoiceKey: "3526 1045 5439 1500 0181 5500 1000 0012 3510 0001 2357" }));
    expect(comChaveDigitada.dados?.chavesDeNfe).toEqual(["35261045543915000181550010000012341000012341", "35261045543915000181550010000012351000012357"]);
    // Chave de CT-e (modelo 57) digitada no lugar da chave da nota não entra.
    expect(preparar(carga({ invoiceKey: "43181203527568000153570010002211211062211212" })).dados?.chavesDeNfe).toEqual(["35261045543915000181550010000012341000012341"]);
  });

  it("o que falta vira pendência com a frase de onde resolver", () => {
    expect(preparar(carga({ freightValue: null })).pendencias).toEqual(["A carga está sem valor de frete: é o valor da prestação do CT-e."]);
    expect(preparar(carga({ invoiceValue: null })).pendencias[0]).toContain("valor da mercadoria");
    expect(preparar(carga({ origin: "Lugar Nenhum" })).pendencias[0]).toContain('A origem "Lugar Nenhum" não foi encontrada');
    expect(preparar(carga({ destination: "" })).pendencias[0]).toContain("O destino");
    expect(preparar(carga({ notas: [{ accessKey: "35261045543915000181550010000012341000012341", xml: "<NFe><infNFe/></NFe>" }] })).pendencias).toHaveLength(2);
    const semEmitente = prepararCte(carga(), null, null, municipioDoTexto);
    expect(semEmitente).toEqual({ dados: null, pendencias: [SEM_EMITENTE], avisos: [], resumo: null });
  });

  it("o município da nota escrito fora do padrão ainda vale pelo código IBGE que a nota traz", () => {
    const xml = nfe().replace("<xMun>Belo Horizonte</xMun>", "<xMun>B HORIZONTE</xMun>");
    const preparo = preparar(carga({ notas: [{ accessKey: "35261045543915000181550010000012341000012341", xml }] }));
    expect(preparo.dados?.destinatario.endereco).toMatchObject({ codigoMunicipio: "3106200", municipio: "B HORIZONTE", uf: "MG" });
  });
});
