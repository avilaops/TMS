import { describe, expect, it } from "vitest";
import { conferirConsultaDaSubcontratada } from "../src/lib/subcontratacao-consulta";
import { lerConsulta as lerCte } from "../src/lib/cte/sefaz";
import { lerConsulta as lerMdfe } from "../src/lib/mdfe/sefaz";
import { lerXml } from "../src/lib/nfe";
import { CHAVE_CTE_SUB, CHAVE_MDFE_SUB } from "./subcontratacao-xml-apoio";
import { certificadoDeTeste, subirSefazDeMentira } from "./cte-apoio";
import { subirSefazDoMdfe } from "./mdfe-apoio";

const esperado = { kind: "CTE" as const, accessKey: CHAVE_CTE_SUB, environment: "PRODUCAO" as const };
const resposta = (cStat = 100) => ({
  cStat, motivo: "Situação consultada", ambiente: "PRODUCAO" as const,
  protocolo: cStat === 217 ? null : { cStat: 100, motivo: "Autorizado", ambiente: "PRODUCAO" as const, chave: CHAVE_CTE_SUB, numero: "135260000000300", recebidoEm: null, resumo: null, xml: "<protCTe/>" },
});

describe("situação consultada da subcontratada", () => {
  it("só confirma autorizado com código superior 100 e protocolo coerente", () => {
    expect(conferirConsultaDaSubcontratada(resposta(), esperado)).toEqual({ sefazCode: 100, sefazReason: "Situação consultada", sefazProtocol: "135260000000300" });
  });

  it.each([101, 217])("respeita o código superior %i em vez do protocolo antigo de autorização", (cStat) => {
    expect(conferirConsultaDaSubcontratada(resposta(cStat), esperado).sefazCode).toBe(cStat);
  });

  it("MDF-e encerrado é conclusivo, CT-e com esse retorno é incoerente", () => {
    const retorno = resposta(132);
    expect(() => conferirConsultaDaSubcontratada(retorno, esperado)).toThrow();
    expect(conferirConsultaDaSubcontratada({ ...retorno, protocolo: { ...retorno.protocolo!, chave: CHAVE_MDFE_SUB } }, { ...esperado, kind: "MDFE", accessKey: CHAVE_MDFE_SUB }).sefazCode).toBe(132);
  });

  it.each([["CTE", 101], ["MDFE", 132]] as const)("%s com situação final %i dispensa protocolo antigo ausente", (kind, cStat) => {
    const accessKey = kind === "CTE" ? CHAVE_CTE_SUB : CHAVE_MDFE_SUB;
    expect(conferirConsultaDaSubcontratada({ ...resposta(cStat), protocolo: null }, { ...esperado, kind, accessKey }).sefazCode).toBe(cStat);
  });

  it.each([
    { cStat: 108 }, { ambiente: "HOMOLOGACAO" as const }, { ambiente: null }, { protocolo: null },
    { protocolo: { ...resposta().protocolo!, chave: CHAVE_MDFE_SUB } },
    { protocolo: { ...resposta().protocolo!, ambiente: "HOMOLOGACAO" as const } },
    { protocolo: { ...resposta().protocolo!, numero: null } },
    { protocolo: { ...resposta().protocolo!, cStat: 101 } },
  ])("recusa resposta não vinculada ou inconclusiva sem apagar estado anterior", (troca) => {
    expect(() => conferirConsultaDaSubcontratada({ ...resposta(), ...troca }, esperado)).toThrow();
  });

  it("não consta exige ambiente correto, sem protocolo contraditório", () => {
    expect(() => conferirConsultaDaSubcontratada({ ...resposta(217), ambiente: null }, esperado)).toThrow();
    expect(() => conferirConsultaDaSubcontratada({ ...resposta(217), protocolo: resposta().protocolo }, esperado)).toThrow();
  });

  it.each(["CTE", "MDFE"] as const)("o leitor de %s aceita o retorno oficial sem chave no topo", (tipo) => {
    const cte = tipo === "CTE";
    const xml = `<retConsSit${cte ? "CTe" : "MDFe"}><tpAmb>1</tpAmb><verAplic>teste</verAplic><cStat>217</cStat><xMotivo>Não consta</xMotivo><cUF>35</cUF></retConsSit${cte ? "CTe" : "MDFe"}>`;
    const lida = (cte ? lerCte : lerMdfe)(lerXml(xml), xml);
    expect(lida).toMatchObject({ protocolo: null, cStat: 217 });
  });

  it.each(["CTE", "MDFE"] as const)("%s vincula a resposta 217 à chave enviada por HTTPS autenticado", async (tipo) => {
    const cte = tipo === "CTE";
    const chave = cte ? CHAVE_CTE_SUB : CHAVE_MDFE_SUB;
    const certificado = certificadoDeTeste();
    const servidor = cte ? await subirSefazDeMentira() : await subirSefazDoMdfe();
    const cteCliente = await import("../src/lib/cte/sefaz");
    const mdfeCliente = await import("../src/lib/mdfe/sefaz");
    const usar = cte ? cteCliente.usarSefazDeTeste : mdfeCliente.usarSefazDeTesteDoMdfe;
    usar({ url: servidor.url, autoridades: servidor.autoridades });
    try {
      const destino = { uf: "SP", ambiente: "PRODUCAO" as const, credencial: { chavePem: certificado.chavePem, certificadoPem: certificado.certificadoPem } };
      const lida = await (cte ? cteCliente.consultarCte(destino, chave) : mdfeCliente.consultarMdfe(destino, chave));
      expect(conferirConsultaDaSubcontratada(lida, { ...esperado, kind: tipo, accessKey: chave })).toMatchObject({ sefazCode: 217 });
    } finally { usar(null); await servidor.fechar(); }
  });
});
