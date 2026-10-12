import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CAMPOS_PROIBIDOS_NA_CARTA,
  GRUPOS_DE_IMPOSTO_FORA_DA_CARTA,
  MAXIMO_DE_CORRECOES_POR_CARTA,
  campoProibidoNaCarta,
  cartaDeCorrecaoSchema,
  emitirSchema,
  fraseDoCampoProibido,
  resumoDaCarta,
  seloDoCte,
  svcOferecida,
} from "../src/lib/cte";
import { ALVO_DO_CTE, ALVO_DO_EVENTO, assinarXml, assinaturaConfere, resumoDaAssinatura } from "../src/lib/cte/assinar";
import { lerCertificado } from "../src/lib/cte/certificado";
import { lerChaveDoCte, svcDaChave } from "../src/lib/cte/chave";
import { ENDERECOS, autorizadorDaUf, enderecosDaSvc, svcDaUf } from "../src/lib/cte/enderecos";
import { CONDICAO_DE_USO_DA_CARTA, hashDaEntrega, montarCancelamentoDoComprovante, montarCartaDeCorrecao, montarComprovanteDeEntrega, montarProcEventoCte } from "../src/lib/cte/eventos";
import { montarCte } from "../src/lib/cte/montar";
import { CSTAT, consultarCte, corpoDaResposta, decidir, enviarCte, enviarEvento, eventoRegistrado, lerConsulta, statusDoServico, usarSefazDeTeste, type Destino } from "../src/lib/cte/sefaz";
import { chaveValida } from "../src/lib/nfe";
import { UFS } from "../src/lib/roteiro";
import { EMITENTE, certificadoDeTeste, chaveDeNfe, dadosDeExemplo, errosNoEsquema, registrarEventoDeFora, subirSefazDeMentira, type CertificadoDeTeste, type SefazDeMentira } from "./cte-apoio";

/**
 * O que faltava no CT-e 4.00 e não depende de terceiros, na parte que não
 * precisa de banco: carta de correção (110110), comprovante de entrega (110180)
 * e o cancelamento dele (110181), a emissão pela SVC e a leitura dos eventos
 * que a consulta pela chave devolve. Os XML são validados contra os esquemas
 * oficiais do pacote (fiscal/esquemas/cte-4.00).
 *
 * NENHUM teste fala com a SEFAZ: a conversa é com o servidor HTTPS local de
 * tests/cte-apoio.ts.
 */

let certificado: CertificadoDeTeste;
let lido: ReturnType<typeof lerCertificado>;

beforeAll(() => {
  certificado = certificadoDeTeste();
  lido = lerCertificado(certificado.pfx, certificado.senha);
});

const NS = "http://www.portalfiscal.inf.br/cte";
const assinar = (xml: string, alvo = ALVO_DO_EVENTO) => assinarXml(xml, alvo, { chavePem: lido.chavePem, certificadoPem: lido.titularPem });
const cteAssinado = (dados = dadosDeExemplo()) => {
  const montado = montarCte(dados);
  return { ...montado, xml: assinar(montado.xml, ALVO_DO_CTE) };
};
/** O detalhe do evento (`detEvento/*`) com o namespace, para validar no esquema próprio dele. */
const detalheDe = (xml: string, raiz: string) => new RegExp(`<${raiz}>[\\s\\S]*</${raiz}>`).exec(xml)![0].replace(`<${raiz}>`, `<${raiz} xmlns="${NS}">`);
const BASE = { cnpj: EMITENTE.cnpj, ambiente: "HOMOLOGACAO" as const, quando: new Date("2026-10-12T15:00:00Z") };

/* ------------------------------------- SVC ------------------------------------ */

describe("emissão pela SVC (tpEmis 7 e 8)", () => {
  it("cada autorizador tem a SVC que o Portal do CT-e indica: SVC-SP para SVRS, MG, PR e RS; SVC-RS para SVSP, MT, MS e SP", () => {
    const daSvcRs = ["AP", "PE", "RR", "MT", "MS", "SP"];
    for (const uf of UFS) expect(svcDaUf(uf), uf).toBe(daSvcRs.includes(uf) ? "SVC-RS" : "SVC-SP");
    // A SVC nunca atende no mesmo lugar que o autorizador da UF: quem autoriza no RS (SVRS e RS) vai para SP, e quem autoriza em SP, para o RS.
    for (const uf of UFS) {
      const naSvrs = ["SVRS", "RS"].includes(autorizadorDaUf(uf)!);
      const naSvsp = ["SVSP", "SP"].includes(autorizadorDaUf(uf)!);
      if (naSvrs) expect(svcDaUf(uf), uf).toBe("SVC-SP");
      if (naSvsp) expect(svcDaUf(uf), uf).toBe("SVC-RS");
    }
    expect(svcDaUf("XX")).toBeNull();
  });

  it("a SVC-RS atende nos endereços da SVRS e a SVC-SP nos da SVSP, em cada ambiente", () => {
    for (const ambiente of ["HOMOLOGACAO", "PRODUCAO"] as const) {
      expect(enderecosDaSvc("SVC-RS", ambiente)).toBe(ENDERECOS.SVRS[ambiente]);
      expect(enderecosDaSvc("SVC-SP", ambiente)).toBe(ENDERECOS.SVSP[ambiente]);
    }
    expect(enderecosDaSvc("SVC-RS", "PRODUCAO").recepcao).toBe("https://cte.svrs.rs.gov.br/ws/CTeRecepcaoSincV4/CTeRecepcaoSincV4.asmx");
    expect(enderecosDaSvc("SVC-SP", "HOMOLOGACAO").status).toBe("https://homologacao.nfe.fazenda.sp.gov.br/CTeWS/WS/CTeStatusServicoV4.asmx");
  });

  it("no XML só muda o tpEmis (e com ele a chave, o cDV e o Id): sem dhCont, sem xJust, QR Code da UF e sem sign; passa no esquema", async () => {
    const normal = cteAssinado();
    for (const [svc, tpEmis] of [["SVC-RS", "7"], ["SVC-SP", "8"]] as const) {
      const pelaSvc = cteAssinado(dadosDeExemplo({ svc }));
      expect(await errosNoEsquema(pelaSvc.xml, "cte_v4.00.xsd"), svc).toEqual([]);
      expect(pelaSvc.xml).toContain(`<tpEmis>${tpEmis}</tpEmis>`);
      expect(lerChaveDoCte(pelaSvc.chave).tipoDeEmissao).toBe(tpEmis);
      expect(chaveValida(pelaSvc.chave)).toBe(true);
      expect(svcDaChave(pelaSvc.chave)).toBe(svc);
      expect(pelaSvc.xml).toContain(`<cDV>${pelaSvc.chave.slice(43)}</cDV>`);
      expect(pelaSvc.xml).toContain(`<infCte versao="4.00" Id="CTe${pelaSvc.chave}">`);
      // Regra G008 do Anexo I (rejeição 586): a data e a justificativa da contingência não vão na SVC.
      expect(pelaSvc.xml).not.toMatch(/dhCont|xJust/);
      // Regras G213 e G216: o endereço é o da UF do emitente, e o parâmetro `sign` não vai.
      expect(pelaSvc.xml).toContain(`<qrCodCTe>https://homologacao.nfe.fazenda.sp.gov.br/CTeConsulta/qrCode?chCTe=${pelaSvc.chave}&amp;tpAmb=2</qrCodCTe>`);
      expect(pelaSvc.xml).not.toContain("sign=");
      // Fora o tipo de emissão, a chave é a mesma: só a posição 35 e o dígito mudam.
      expect(pelaSvc.chave.slice(0, 34)).toBe(normal.chave.slice(0, 34));
      expect(pelaSvc.chave.slice(35, 43)).toBe(normal.chave.slice(35, 43));
      // E o resto do documento é igual ao da emissão normal.
      const semChave = (xml: string, chave: string) => xml.split(chave).join("CHAVE").replace(/<tpEmis>\d<\/tpEmis><cDV>\d<\/cDV>/, "").replace(/<Signature[\s\S]*<\/Signature>/, "");
      expect(semChave(pelaSvc.xml, pelaSvc.chave)).toBe(semChave(normal.xml, normal.chave));
    }
    expect(svcDaChave(normal.chave)).toBeNull();
    expect(normal.xml).toContain("<tpEmis>1</tpEmis>");
  });

  it("a SVC só é oferecida depois de uma emissão normal que não se resolveu: sem resposta, autorizadora parada (108, 109) ou sem conexão", () => {
    const rascunho = { situacao: "DRAFT" as const, semResposta: false, cStat: null, motivo: null, svc: null };
    expect(svcOferecida(null)).toBe(false);
    expect(svcOferecida(rascunho)).toBe(false);
    expect(svcOferecida({ ...rascunho, semResposta: true, motivo: "A SEFAZ não respondeu no tempo limite." })).toBe(true);
    expect(svcOferecida({ ...rascunho, cStat: 108, motivo: "Serviço Paralisado Momentaneamente" })).toBe(true);
    expect(svcOferecida({ ...rascunho, cStat: 109, motivo: "Serviço Paralisado sem Previsão" })).toBe(true);
    expect(svcOferecida({ ...rascunho, motivo: "Não foi possível conectar à SEFAZ." })).toBe(true);
    // Rejeição não é motivo de contingência; autorizado e cancelado também não.
    expect(svcOferecida({ ...rascunho, situacao: "REJECTED", cStat: 481, motivo: "Rejeição" })).toBe(false);
    expect(svcOferecida({ ...rascunho, situacao: "AUTHORIZED", cStat: 100, motivo: "Autorizado" })).toBe(false);
    expect(svcOferecida({ ...rascunho, cStat: 107, motivo: "Serviço em Operação" })).toBe(false);
  });

  it("o pedido de emissão pela SVC exige a justificativa de 15 a 256 letras; sem `svc` é a emissão normal", () => {
    expect(emitirSchema.safeParse({ collectionId: "c1" }).success).toBe(true);
    expect(emitirSchema.safeParse({ collectionId: "c1", svc: null }).success).toBe(true);
    expect(emitirSchema.safeParse({ collectionId: "c1", svc: { justificativa: "SEFAZ de origem fora do ar" } }).success).toBe(true);
    for (const justificativa of ["curta", " ".repeat(30), "x".repeat(257)]) {
      const recusa = emitirSchema.safeParse({ collectionId: "c1", svc: { justificativa } });
      expect(recusa.success, justificativa.slice(0, 10)).toBe(false);
      expect(recusa.error?.issues[0].message).toBe("A justificativa da contingência precisa ter de 15 a 256 letras.");
    }
    expect(emitirSchema.safeParse({ collectionId: "c1", svc: {} }).success).toBe(false);
  });

  it("o selo diz que o CT-e é da SVC", () => {
    expect(seloDoCte({ situacao: "AUTHORIZED", ambiente: "PRODUCAO", numero: 8, semResposta: false, svc: "SVC-RS" })).toBe("Autorizado nº 8, SVC-RS");
    expect(seloDoCte({ situacao: "DRAFT", ambiente: "HOMOLOGACAO", numero: 8, semResposta: true, svc: "SVC-SP" })).toBe("Sem resposta da SEFAZ, SVC-SP (homologação)");
    expect(seloDoCte({ situacao: "AUTHORIZED", ambiente: "PRODUCAO", numero: 8, semResposta: false, svc: null })).toBe("Autorizado nº 8");
  });
});

/* ------------------------------ Carta de correção ------------------------------ */

describe("carta de correção eletrônica (110110)", () => {
  it("bloqueia cada campo da tabela do MOC 4.00, item 13.1, sem olhar caixa nem acento", () => {
    let conferidos = 0;
    for (const [grupo, campos] of Object.entries(CAMPOS_PROIBIDOS_NA_CARTA)) {
      for (const campo of campos) {
        expect(campoProibidoNaCarta(grupo, campo), `${grupo}/${campo}`).toBe(true);
        expect(campoProibidoNaCarta(grupo.toUpperCase(), ` ${campo.toLowerCase()} `), `${grupo}/${campo} em outra caixa`).toBe(true);
        conferidos += 1;
      }
    }
    // As 57 linhas da tabela do manual para o CT-e de carga (modelo 57).
    expect(conferidos).toBe(57);
    // Como o manual escreve: "Versão", "Mod", "Serie", "Toma", "Chave".
    for (const [grupo, campo] of [["infCte", "Versão"], ["ide", "Mod"], ["ide", "Serie"], ["ide", "Modal"], ["toma3", "Toma"], ["infNFe", "Chave"]]) {
      expect(campoProibidoNaCarta(grupo, campo), `${grupo}/${campo}`).toBe(true);
    }
  });

  it("valor do imposto, valor da prestação, quem é quem e data de emissão ficam de fora; o resto pode", () => {
    const proibidos = [["vPrest", "vTPrest"], ["Comp", "vComp"], ["ICMS00", "vBC"], ["ICMS00", "pICMS"], ["ICMS20", "pRedBC"], ["ICMS60", "vICMSSTRet"], ["ICMSOutraUF", "pICMSOutraUF"], ["emit", "CNPJ"], ["rem", "CNPJ"], ["dest", "CPF"], ["toma4", "IE"], ["toma3", "toma"], ["ide", "dhEmi"], ["ide", "nCT"], ["ide", "tpEmis"]];
    for (const [grupo, campo] of proibidos) expect(campoProibidoNaCarta(grupo, campo), `${grupo}/${campo}`).toBe(true);
    // IBS e CBS: os grupos inteiros, pela letra do art. 58-B, I (não estão na tabela do manual).
    for (const grupo of GRUPOS_DE_IMPOSTO_FORA_DA_CARTA) expect(campoProibidoNaCarta(grupo, "qualquer"), grupo).toBe(true);
    expect(campoProibidoNaCarta("gIBSUF", "pIBSUF")).toBe(true);
    expect(campoProibidoNaCarta("IBSCBS", "cClassTrib")).toBe(true);
    expect(campoProibidoNaCarta("imp", "vTotDFe")).toBe(true);

    const permitidos = [["compl", "xObs"], ["ide", "retira"], ["ide", "xDetRetira"], ["ide", "CFOP"], ["ide", "natOp"], ["enderReme", "xLgr"], ["enderDest", "nro"], ["rem", "xNome"], ["dest", "fone"], ["infCarga", "proPred"], ["infQ", "qCarga"], ["emit", "xFant"], ["rodo", "RNTRC"], ["vPrest", "vRec"]];
    for (const [grupo, campo] of permitidos) expect(campoProibidoNaCarta(grupo, campo), `${grupo}/${campo}`).toBe(false);
  });

  it("o formulário valida grupo, campo, valor e item, e recusa o campo proibido com a frase", () => {
    const boa = cartaDeCorrecaoSchema.safeParse({ correcoes: [{ grupo: " compl ", campo: "xObs", valor: "  Entregar no depósito 2  " }, { grupo: "infQ", campo: "qCarga", valor: "1250.5000", item: "2" }] });
    expect(boa.success).toBe(true);
    expect(boa.data?.correcoes).toEqual([
      { grupo: "compl", campo: "xObs", valor: "Entregar no depósito 2", item: null },
      { grupo: "infQ", campo: "qCarga", valor: "1250.5000", item: 2 },
    ]);

    const recusa = (correcoes: unknown) => {
      const lida = cartaDeCorrecaoSchema.safeParse({ correcoes });
      return lida.success ? null : lida.error.issues[0].message;
    };
    expect(recusa([{ grupo: "vPrest", campo: "vTPrest", valor: "900.00" }])).toBe(fraseDoCampoProibido("vPrest", "vTPrest"));
    expect(recusa([{ grupo: "IDE", campo: "DHEMI", valor: "2026-10-10T10:00:00-03:00" }])).toBe(fraseDoCampoProibido("IDE", "DHEMI"));
    expect(recusa([{ grupo: "compl", campo: "xObs", valor: "ok" }, { grupo: "rem", campo: "cnpj", valor: "99000303000171" }])).toBe(fraseDoCampoProibido("rem", "cnpj"));
    expect(recusa([])).toBe(`Informe de 1 a ${MAXIMO_DE_CORRECOES_POR_CARTA} correções.`);
    expect(recusa(Array.from({ length: MAXIMO_DE_CORRECOES_POR_CARTA + 1 }, () => ({ grupo: "compl", campo: "xObs", valor: "x" })))).toBe(`Informe de 1 a ${MAXIMO_DE_CORRECOES_POR_CARTA} correções.`);
    expect(recusa([{ grupo: "com espaço", campo: "xObs", valor: "x" }])).toContain("nomes das tags do XML");
    expect(recusa([{ grupo: "compl", campo: "x".repeat(21), valor: "x" }])).toContain("nomes das tags do XML");
    expect(recusa([{ grupo: "compl", campo: "xObs", valor: "   " }])).toBe("Informe o valor novo do campo (de 1 a 500 letras).");
    expect(recusa([{ grupo: "compl", campo: "xObs", valor: "x".repeat(501) }])).toBe("Informe o valor novo do campo (de 1 a 500 letras).");
    // O que o XML não aceita (só emoji) é o mesmo que nada.
    expect(recusa([{ grupo: "compl", campo: "xObs", valor: "🚚🚚" }])).toBe("Informe o valor novo do campo (de 1 a 500 letras).");
    for (const item of ["0", "100", "1,5", "x"]) expect(recusa([{ grupo: "infQ", campo: "qCarga", valor: "1", item }]), item).toContain("O item é a posição na lista");
    expect(recusa(null)).toBe(`Informe de 1 a ${MAXIMO_DE_CORRECOES_POR_CARTA} correções.`);
    expect(cartaDeCorrecaoSchema.safeParse(null).error?.issues[0].message).toBe("Dados inválidos.");

    expect(resumoDaCarta(boa.data!.correcoes)).toBe("compl/xObs: Entregar no depósito 2; infQ/qCarga (item 2): 1250.5000");
  });

  it("o evento assinado passa no esquema do evento e o detalhe, no evCCeCTe; o xCondUso é a literal do manual", async () => {
    const { chave } = cteAssinado();
    const evento = montarCartaDeCorrecao({
      ...BASE,
      chave,
      sequencia: 3,
      correcoes: [
        { grupo: "compl", campo: "xObs", valor: "Entregar no depósito 2 — portão “B”", item: null },
        { grupo: "infQ", campo: "qCarga", valor: "1250.5000", item: 2 },
      ],
    });
    expect(evento).toMatchObject({ id: `ID110110${chave}003`, tipo: "110110", sequencia: 3 });
    const xml = assinar(evento.xml);
    expect(await errosNoEsquema(xml, "eventoCTe_v4.00.xsd")).toEqual([]);
    expect(assinaturaConfere(xml, lido.titularPem)).toBe(true);
    expect(xml).toContain(`<infEvento Id="ID110110${chave}003"><cOrgao>35</cOrgao><tpAmb>2</tpAmb><CNPJ>99000108000141</CNPJ><chCTe>${chave}</chCTe><dhEvento>2026-10-12T12:00:00-03:00</dhEvento><tpEvento>110110</tpEvento><nSeqEvento>3</nSeqEvento><detEvento versaoEvento="4.00">`);

    const detalhe = detalheDe(xml, "evCCeCTe");
    expect(await errosNoEsquema(detalhe, "evCCeCTe_v4.00.xsd")).toEqual([]);
    expect(detalhe).toContain('<descEvento>Carta de Correcao</descEvento><infCorrecao><grupoAlterado>compl</grupoAlterado><campoAlterado>xObs</campoAlterado><valorAlterado>Entregar no depósito 2 - portão "B"</valorAlterado></infCorrecao>');
    expect(detalhe).toContain("<infCorrecao><grupoAlterado>infQ</grupoAlterado><campoAlterado>qCarga</campoAlterado><valorAlterado>1250.5000</valorAlterado><nroItemAlterado>02</nroItemAlterado></infCorrecao>");
    expect(detalhe).toContain(`<xCondUso>${CONDICAO_DE_USO_DA_CARTA}</xCondUso>`);
    expect(CONDICAO_DE_USO_DA_CARTA).toMatch(/^A Carta de Correcao e disciplinada pelo Art\. 58-B do CONVENIO\/SINIEF 06\/89: .*III - a data de emissao ou de saida\.$/);

    // Texto diferente no xCondUso não passa no esquema: a SEFAZ só aceita a literal.
    expect(await errosNoEsquema(detalhe.replace("58-B", "58-C"), "evCCeCTe_v4.00.xsd")).not.toEqual([]);
  });
});

/* ----------------------------- Comprovante de entrega -------------------------- */

describe("comprovante de entrega (110180) e o cancelamento dele (110181)", () => {
  const IMAGEM = Buffer.from("imagem do canhoto assinado, de mentira").toString("base64");

  it("hashEntrega: Base64 do SHA-1 da chave do CT-e concatenada com o Base64 da imagem (28 caracteres)", () => {
    const { chave } = cteAssinado();
    const hash = hashDaEntrega(chave, IMAGEM);
    expect(hash).toBe(createHash("sha1").update(chave + IMAGEM).digest("base64"));
    expect(hash).toHaveLength(28);
    expect(Buffer.from(hash, "base64")).toHaveLength(20);
    // Outra imagem, ou outro CT-e, dá outro hash.
    expect(hashDaEntrega(chave, `${IMAGEM}A`)).not.toBe(hash);
    expect(hashDaEntrega(cteAssinado(dadosDeExemplo({ numero: 16 })).chave, IMAGEM)).not.toBe(hash);
  });

  it("o evento assinado passa nos esquemas, com as datas no fuso da UF, a posição com seis casas e cada NF-e uma vez", async () => {
    const { chave } = cteAssinado();
    const nota = chaveDeNfe(1234);
    const evento = montarComprovanteDeEntrega({
      ...BASE,
      chave,
      sequencia: 1,
      protocolo: "135260000000001",
      entregueEm: new Date("2026-10-11T18:45:10Z"),
      documento: " 12.345.678-9 ",
      nome: "Maria “Recebedora” da Silva",
      latitude: -19.9166813,
      longitude: -43.9344931,
      hash: hashDaEntrega(chave, IMAGEM),
      hashEm: new Date("2026-10-12T15:00:00Z"),
      chavesDeNfe: [nota, chaveDeNfe(1235), nota],
    });
    expect(evento).toMatchObject({ id: `ID110180${chave}001`, tipo: "110180", sequencia: 1 });
    const xml = assinar(evento.xml);
    expect(await errosNoEsquema(xml, "eventoCTe_v4.00.xsd")).toEqual([]);
    const detalhe = detalheDe(xml, "evCECTe");
    expect(await errosNoEsquema(detalhe, "evCECTe_v4.00.xsd")).toEqual([]);
    expect(detalhe).toContain(
      `<descEvento>Comprovante de Entrega do CT-e</descEvento><nProt>135260000000001</nProt><dhEntrega>2026-10-11T15:45:10-03:00</dhEntrega><nDoc>12.345.678-9</nDoc><xNome>Maria "Recebedora" da Silva</xNome><latitude>-19.916681</latitude><longitude>-43.934493</longitude><hashEntrega>${hashDaEntrega(chave, IMAGEM)}</hashEntrega><dhHashEntrega>2026-10-12T12:00:00-03:00</dhHashEntrega>`,
    );
    expect(detalhe.match(/<infEntrega>/g)).toHaveLength(2);
    expect(detalhe).toContain(`<infEntrega><chNFe>${nota}</chNFe></infEntrega><infEntrega><chNFe>${chaveDeNfe(1235)}</chNFe></infEntrega></evCECTe>`);
  });

  it("sem posição, com posição pela metade ou fora da faixa, e sem NF-e: os campos opcionais somem e o esquema aceita", async () => {
    const { chave } = cteAssinado();
    const base = { ...BASE, chave, sequencia: 2, protocolo: "135260000000001", entregueEm: new Date("2026-10-11T18:45:10Z"), documento: "RG 1", nome: "Zé", hash: hashDaEntrega(chave, IMAGEM), hashEm: BASE.quando, chavesDeNfe: [] };
    for (const posicao of [{}, { latitude: -19.9 }, { latitude: 91, longitude: 10 }, { latitude: 10, longitude: -181 }, { latitude: Number.NaN, longitude: 1 }]) {
      const xml = assinar(montarComprovanteDeEntrega({ ...base, ...posicao }).xml);
      expect(xml).not.toMatch(/latitude|longitude|infEntrega/);
      expect(await errosNoEsquema(detalheDe(xml, "evCECTe"), "evCECTe_v4.00.xsd")).toEqual([]);
    }
    const noLimite = assinar(montarComprovanteDeEntrega({ ...base, latitude: -90, longitude: 180 }).xml);
    expect(noLimite).toContain("<latitude>-90.000000</latitude><longitude>180.000000</longitude>");
    expect(await errosNoEsquema(detalheDe(noLimite, "evCECTe"), "evCECTe_v4.00.xsd")).toEqual([]);
  });

  it("o cancelamento do comprovante leva o protocolo do CT-e e o do evento de entrega, e passa nos esquemas", async () => {
    const { chave } = cteAssinado();
    const evento = montarCancelamentoDoComprovante({ ...BASE, chave, sequencia: 1, protocolo: "135260000000001", protocoloDoComprovante: "135260000000009" });
    expect(evento).toMatchObject({ id: `ID110181${chave}001`, tipo: "110181" });
    const xml = assinar(evento.xml);
    expect(await errosNoEsquema(xml, "eventoCTe_v4.00.xsd")).toEqual([]);
    const detalhe = detalheDe(xml, "evCancCECTe");
    expect(await errosNoEsquema(detalhe, "evCancCECTe_v4.00.xsd")).toEqual([]);
    expect(detalhe).toContain("<descEvento>Cancelamento do Comprovante de Entrega do CT-e</descEvento><nProt>135260000000001</nProt><nProtCE>135260000000009</nProtCE>");
  });

  it("o procEventoCTe (evento assinado + retorno) passa no esquema", async () => {
    const { chave } = cteAssinado();
    const assinado = assinar(montarCancelamentoDoComprovante({ ...BASE, chave, sequencia: 1, protocolo: "135260000000001", protocoloDoComprovante: "135260000000009" }).xml);
    const retorno = `<retEventoCTe xmlns="${NS}" versao="4.00"><infEvento><tpAmb>2</tpAmb><verAplic>TESTE-1.0</verAplic><cOrgao>35</cOrgao><cStat>135</cStat><xMotivo>Evento registrado e vinculado a CT-e</xMotivo><chCTe>${chave}</chCTe><tpEvento>110181</tpEvento><xEvento>Cancelamento do Comprovante de Entrega do CT-e</xEvento><nSeqEvento>1</nSeqEvento><dhRegEvento>2026-10-12T12:00:01-03:00</dhRegEvento><nProt>135260000000010</nProt></infEvento></retEventoCTe>`;
    expect(await errosNoEsquema(montarProcEventoCte(assinado, retorno), "procEventoCTe_v4.00.xsd")).toEqual([]);
  });
});

/* --------------------------- Eventos na consulta pela chave -------------------- */

describe("eventos que a consulta pela chave devolve (procEventoCTe)", () => {
  const CHAVE = "35261099000108000141570010000000151482159374";
  const OUTRA = "35261099000108000141570010000000161482159379";
  const proc = (chave: string, tipo: string, sequencia: number, cStat: number, detalhe: string, protocolo = "135260000000077") =>
    `<procEventoCTe versao="4.00"><eventoCTe versao="4.00"><infEvento Id="ID${tipo}${chave}${String(sequencia).padStart(3, "0")}"><cOrgao>35</cOrgao><tpAmb>2</tpAmb><CNPJ>99000108000141</CNPJ><chCTe>${chave}</chCTe><dhEvento>2026-10-12T10:00:00-03:00</dhEvento><tpEvento>${tipo}</tpEvento><nSeqEvento>${sequencia}</nSeqEvento><detEvento versaoEvento="4.00">${detalhe}</detEvento></infEvento></eventoCTe><retEventoCTe versao="4.00"><infEvento><tpAmb>2</tpAmb><verAplic>X</verAplic><cOrgao>35</cOrgao><cStat>${cStat}</cStat><xMotivo>Evento registrado e vinculado a CT-e</xMotivo><chCTe>${chave}</chCTe><tpEvento>${tipo}</tpEvento><xEvento>Evento ${tipo}</xEvento><nSeqEvento>${sequencia}</nSeqEvento><dhRegEvento>2026-10-12T10:00:05-03:00</dhRegEvento><nProt>${protocolo}</nProt></infEvento></retEventoCTe></procEventoCTe>`;
  const resposta = (eventos: string) =>
    `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><cteConsultaCTResult xmlns="${NS}/wsdl/CTeConsultaV4"><retConsSitCTe xmlns="${NS}" versao="4.00"><tpAmb>2</tpAmb><verAplic>X</verAplic><cStat>100</cStat><xMotivo>Autorizado o uso do CT-e</xMotivo><cUF>35</cUF>${eventos}</retConsSitCTe></cteConsultaCTResult></soap:Body></soap:Envelope>`;

  it("lê tipo, sequência, protocolo, data e o XML de cada evento vinculado; o 110181 diz qual comprovante cancelou", () => {
    const carta = proc(CHAVE, "110110", 2, 135, "<evCCeCTe><descEvento>Carta de Correcao</descEvento></evCCeCTe>", "135260000000071");
    const cancelamentoDoComprovante = proc(CHAVE, "110181", 1, 134, "<evCancCECTe><descEvento>Cancelamento do Comprovante de Entrega do CT-e</descEvento><nProt>135260000000001</nProt><nProtCE>135260000000055</nProtCE></evCancCECTe>", "135260000000072");
    const texto = resposta(carta + cancelamentoDoComprovante);
    const lida = lerConsulta(corpoDaResposta(texto), texto, CHAVE);
    expect(lida.cStat).toBe(100);
    expect(lida.eventos).toEqual([
      { tipo: "110110", sequencia: 2, protocolo: "135260000000071", cStat: 135, motivo: "Evento registrado e vinculado a CT-e", registradoEm: new Date("2026-10-12T13:00:05Z"), descricao: "Evento 110110", protocoloCancelado: null, xml: carta },
      { tipo: "110181", sequencia: 1, protocolo: "135260000000072", cStat: 134, motivo: "Evento registrado e vinculado a CT-e", registradoEm: new Date("2026-10-12T13:00:05Z"), descricao: "Evento 110181", protocoloCancelado: "135260000000055", xml: cancelamentoDoComprovante },
    ]);
  });

  it("ignora o evento de outra chave, o guardado sem vínculo (136) e o que não tem tipo ou sequência legíveis", () => {
    const bom = proc(CHAVE, "310610", 1, 135, "<evCTeAutorizadoMDFe><descEvento>MDF-e Autorizado</descEvento></evCTeAutorizadoMDFe>");
    const texto = resposta(proc(OUTRA, "110110", 1, 135, "<x/>") + proc(CHAVE, "110110", 1, 136, "<x/>") + proc(CHAVE, "11011", 1, 135, "<x/>") + proc(CHAVE, "110110", 0, 135, "<x/>") + bom);
    const lida = lerConsulta(corpoDaResposta(texto), texto, CHAVE);
    expect(lida.eventos.map((evento) => [evento.tipo, evento.sequencia])).toEqual([["310610", 1]]);
    // Sem a chave (as chamadas que só querem a situação), nenhum evento é lido.
    expect(lerConsulta(corpoDaResposta(texto), texto).eventos).toEqual([]);
    expect(lerConsulta(corpoDaResposta(resposta("")), resposta(""), CHAVE).eventos).toEqual([]);
  });
});

/* ----------------------- Contra o servidor que imita a SEFAZ ------------------- */

describe("SVC e eventos contra o servidor HTTPS local que imita a SEFAZ", () => {
  let sefaz: SefazDeMentira;
  let destino: Destino;
  let naSvc: Destino;

  beforeAll(async () => {
    sefaz = await subirSefazDeMentira();
    usarSefazDeTeste({ url: sefaz.url, autoridades: sefaz.autoridades });
    destino = { uf: "SP", ambiente: "HOMOLOGACAO", credencial: { chavePem: lido.chavePem, certificadoPem: lido.certificadoPem }, tempoLimiteMs: 3000 };
    naSvc = { ...destino, svc: "SVC-RS" };
  });

  afterAll(async () => {
    usarSefazDeTeste(null);
    await sefaz.fechar();
  });

  const esperado = (cte: { chave: string; xml: string }) => ({ chave: cte.chave, ambiente: "HOMOLOGACAO" as const, resumo: resumoDaAssinatura(cte.xml) });

  it("o status pedido à SVC diz se ela está ativa para a UF: 114 desabilitada, 113 em operação", async () => {
    sefaz.chamadas.length = 0;
    sefaz.svcAtiva = false;
    expect(await statusDoServico(naSvc)).toMatchObject({ cStat: CSTAT.SVC_DESABILITADA, svcAtiva: false, emOperacao: false });
    sefaz.svcAtiva = true;
    expect(await statusDoServico(naSvc)).toMatchObject({ cStat: CSTAT.SVC_EM_OPERACAO, svcAtiva: true, emOperacao: false });
    // As duas chamadas foram à SVC, com a UF do emitente na mensagem; a autorizadora da UF responde 107, que não é "SVC ativa".
    expect(sefaz.chamadas.map((chamada) => chamada.svc)).toEqual(["SVC-RS", "SVC-RS"]);
    expect(sefaz.chamadas[0].dados).toContain("<cUF>35</cUF><xServ>STATUS</xServ>");
    expect(await statusDoServico(destino)).toMatchObject({ cStat: 107, svcAtiva: false, emOperacao: true });
    expect(sefaz.chamadas[2].svc).toBeNull();
  });

  it("o CT-e da SVC só é autorizado pela SVC ativa, e só ela responde por ele na consulta", async () => {
    const cte = cteAssinado(dadosDeExemplo({ numero: 31, svc: "SVC-RS" }));
    // Na autorizadora da UF: 515. Na SVC errada: 516. Na SVC desativada: 114.
    expect(decidir(await enviarCte(destino, cte.xml), esperado(cte))).toMatchObject({ tipo: "rejeitado", cStat: 515 });
    sefaz.svcAtiva = true;
    expect(decidir(await enviarCte({ ...destino, svc: "SVC-SP" }, cte.xml), esperado(cte))).toMatchObject({ tipo: "rejeitado", cStat: 516 });
    sefaz.svcAtiva = false;
    expect(decidir(await enviarCte(naSvc, cte.xml), esperado(cte))).toMatchObject({ tipo: "rejeitado", cStat: 114 });

    sefaz.svcAtiva = true;
    sefaz.chamadas.length = 0;
    const autorizacao = decidir(await enviarCte(naSvc, cte.xml), esperado(cte));
    expect(autorizacao.tipo).toBe("autorizado");
    expect(sefaz.chamadas[0]).toMatchObject({ servico: "CTeRecepcaoSincV4", svc: "SVC-RS" });
    expect(sefaz.chamadas[0].dados).toBe(cte.xml);

    expect((await consultarCte(destino, cte.chave)).cStat).toBe(CSTAT.NAO_CONSTA);
    expect(decidir(await consultarCte(naSvc, cte.chave), esperado(cte)).tipo).toBe("autorizado");
    // A consulta vale mesmo com a SVC desativada para emissão.
    sefaz.svcAtiva = false;
    expect((await consultarCte(naSvc, cte.chave)).cStat).toBe(CSTAT.AUTORIZADO);
  });

  it("carta de correção: registrada (135); a mesma sequência de novo é duplicidade (631); a SVC não aceita (530); a consulta devolve o evento", async () => {
    const cte = cteAssinado(dadosDeExemplo({ numero: 32 }));
    expect(decidir(await enviarCte(destino, cte.xml), esperado(cte)).tipo).toBe("autorizado");
    const carta = assinar(montarCartaDeCorrecao({ ...BASE, chave: cte.chave, quando: new Date(), sequencia: 1, correcoes: [{ grupo: "compl", campo: "xObs", valor: "Entregar no depósito 2", item: null }] }).xml);

    const resposta = await enviarEvento(destino, carta);
    expect(resposta).toMatchObject({ cStat: 135, chave: cte.chave, tipo: "110110" });
    expect(eventoRegistrado(resposta, { chave: cte.chave, tipo: "110110" })).toBe(true);
    expect(await errosNoEsquema(resposta.xml, "retEventoCTe_v4.00.xsd")).toEqual([]);

    expect(await enviarEvento(destino, carta)).toMatchObject({ cStat: 631, protocolo: null });
    expect(await enviarEvento(naSvc, carta)).toMatchObject({ cStat: 530 });

    registrarEventoDeFora(sefaz, cte.chave, { tipo: "310610", sequencia: 1, detalhe: "<evCTeAutorizadoMDFe><descEvento>MDF-e Autorizado</descEvento></evCTeAutorizadoMDFe>" });
    const consulta = await consultarCte(destino, cte.chave);
    expect(consulta.cStat).toBe(CSTAT.AUTORIZADO);
    expect(consulta.eventos.map((evento) => [evento.tipo, evento.sequencia, evento.cStat])).toEqual([["110110", 1, 135], ["310610", 1, 135]]);
    expect(consulta.eventos[0].protocolo).toBe(resposta.protocolo);
    expect(consulta.eventos[0].xml).toContain(carta);
    expect(await errosNoEsquema(consulta.eventos[0].xml, "procEventoCTe_v4.00.xsd")).toEqual([]);
  });
});
