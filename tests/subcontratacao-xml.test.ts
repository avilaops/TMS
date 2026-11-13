import { describe, expect, it } from "vitest";
import { lerXmlDaSubcontratada } from "../src/lib/subcontratacao-xml";
import { documentoCobreViagem } from "../src/lib/subcontratacao";
import { CHAVE_CTE_SUB, CHAVE_MDFE_SUB, xmlDaSubcontratada } from "./subcontratacao-xml-apoio";

describe("XML da transportadora subcontratada", () => {
  it.each([
    ["CTE", CHAVE_CTE_SUB, null],
    ["MDFE", CHAVE_MDFE_SUB, "MG"],
  ] as const)("lê %s com chave, emissão, ambiente e protocolo", (tipo, chave, uf) => {
    expect(lerXmlDaSubcontratada(xmlDaSubcontratada(tipo))).toEqual({
      ok: true,
      documento: { kind: tipo, accessKey: chave, issuedAt: "2026-10-03", environment: "PRODUCAO", protocol: "135260000000300", unloadState: uf },
    });
  });

  it("preserva o ambiente de homologação", () => {
    expect(lerXmlDaSubcontratada(xmlDaSubcontratada("MDFE", "2"))).toMatchObject({ ok: true, documento: { environment: "HOMOLOGACAO" } });
  });

  it("aceita prefixo de namespace, BOM e comentários", () => {
    const xml = xmlDaSubcontratada().replace(/<(\/?)([A-Za-z][\w]*)/g, "<$1cte:$2").replace('xmlns="', 'xmlns:cte="');
    expect(lerXmlDaSubcontratada(`\uFEFF${xml.replace("<cte:emit>", "<!-- importado --><cte:emit>")}`)).toMatchObject({ ok: true, documento: { accessKey: CHAVE_CTE_SUB } });
  });

  it.each([
    ["modelo", (xml: string) => xml.replace("<mod>57</mod>", "<mod>58</mod>")],
    ["emitente", (xml: string) => xml.replace("<CNPJ>99777111000176</CNPJ>", "<CNPJ>99777222000182</CNPJ>")],
    ["número", (xml: string) => xml.replace("<nCT>300</nCT>", "<nCT>301</nCT>")],
    ["série", (xml: string) => xml.replace("<serie>1</serie>", "<serie>2</serie>")],
    ["UF", (xml: string) => xml.replace("<cUF>35</cUF>", "<cUF>31</cUF>")],
    ["data", (xml: string) => xml.replace("2026-10-03T13:00:00-03:00", "2026-09-03T13:00:00-03:00")],
    ["data impossível", (xml: string) => xml.replace("2026-10-03T13:00:00-03:00", "2026-10-32T13:00:00-03:00")],
    ["data futura", (xml: string) => xml.replace("2026-10-03T13:00:00-03:00", "2099-10-03T13:00:00-03:00")],
    ["ambiente", (xml: string) => xml.replace("<tpAmb>1</tpAmb>", "<tpAmb>2</tpAmb>")],
    ["protocolo de outra chave", (xml: string) => xml.replace(`<chCTe>${CHAVE_CTE_SUB}</chCTe>`, `<chCTe>${CHAVE_MDFE_SUB}</chCTe>`) ],
    ["protocolo sem número", (xml: string) => xml.replace("<nProt>135260000000300</nProt>", "")],
    ["protocolo não autorizado", (xml: string) => xml.replace("<cStat>100</cStat>", "<cStat>101</cStat>")],
    ["ide repetido", (xml: string) => xml.replace("</ide>", "</ide><ide/>")],
    ["código numérico", (xml: string) => xml.replace("<cCT>00000300</cCT>", "<cCT>00000301</cCT>")],
    ["dígito informado", (xml: string) => xml.replace("<cDV>1</cDV>", "<cDV>2</cDV>")],
    ["atributo Id repetido", (xml: string) => xml.replace(' Id="CTe', ` Id="CTe${CHAVE_CTE_SUB}" Id="CTe`) ],
    ["campo de chave repetido", (xml: string) => xml.replace("</chCTe>", `</chCTe><chCTe>${CHAVE_CTE_SUB}</chCTe>`) ],
    ["emitente repetido", (xml: string) => xml.replace("</emit>", "</emit><emit/>")],
    ["documento repetido", (xml: string) => xml.replace("</CTe>", "</CTe><CTe/>")],
    ["protocolo repetido", (xml: string) => xml.replace("</protCTe>", "</protCTe><protCTe/>")],
    ["versão", (xml: string) => xml.replaceAll('versao="4.00"', 'versao="3.00"')],
  ])("recusa %s incoerente ou ambíguo", (_nome, alterar) => {
    expect(lerXmlDaSubcontratada(alterar(xmlDaSubcontratada()))).toMatchObject({ ok: false, erro: expect.any(String) });
  });

  it("recusa MDF-e sem UF de descarga válida", () => {
    expect(lerXmlDaSubcontratada(xmlDaSubcontratada("MDFE").replace("<UFFim>MG</UFFim>", "<UFFim>XX</UFFim>"))).toMatchObject({ ok: false });
  });

  it.each(["", "<resCTe/>", "<cteProc>", '<!DOCTYPE x [<!ENTITY x SYSTEM "file:///etc/passwd">]><cteProc/>' ])("recusa entrada incompleta ou insegura", (xml) => {
    expect(lerXmlDaSubcontratada(xml)).toMatchObject({ ok: false });
  });

  it("limita bytes UTF-8 antes de analisar o arquivo", () => {
    expect(lerXmlDaSubcontratada("ç".repeat(600_000))).toMatchObject({ ok: false, grande: true });
  });
});

describe("cobertura da viagem pela subcontratada", () => {
  it("preserva documento manual sem evidência de invalidação", () => {
    expect(documentoCobreViagem({})).toBe(true);
    expect(documentoCobreViagem({ environment: "PRODUCAO", sefazCode: 100 })).toBe(true);
  });

  it.each([101, 132, 217])("retira documento com situação %i comprovada", (sefazCode) => {
    expect(documentoCobreViagem({ environment: "PRODUCAO", sefazCode })).toBe(false);
  });

  it("homologação não cobre saída real", () => {
    expect(documentoCobreViagem({ environment: "HOMOLOGACAO", sefazCode: 100 })).toBe(false);
  });
});
