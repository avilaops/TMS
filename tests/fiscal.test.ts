import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getServerSession } from "next-auth";
import {
  LIMITE_DO_XML_BYTES,
  XML_GRANDE,
  chaveValida,
  cidadeUf,
  criarCargaDaNotaSchema,
  cteRegistrado,
  digitoDaChave,
  filtroDeNotas,
  lerNfe,
  nomeDoArquivoXml,
  partesDaChave,
  pendenciasParaCte,
  registrarCteSchema,
  sugerirCarga,
  type CargaDaNota,
  type CargaParaCte,
  type NotaImportada,
  type NotaLida,
  type SugestaoDeCarga,
} from "../src/lib/nfe";
import { EMPRESA_OUTRA, EMPRESA_PADRAO } from "./empresas-de-teste";

/**
 * Documentos fiscais: o leitor de XML de NF-e e as regras (puros) e as rotas
 * contra um Postgres de verdade, com duas empresas.
 */
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

// Tudo o que esta suite cria usa estes documentos e este prefixo, e só isso é apagado.
const PREFIXO = "teste-fiscal-";
const CNPJ_EMITENTE = "99444333000181";
const CNPJ_DESTINATARIO = "99444333000262";
const CNPJ_TERCEIRO = "99444333000343";
const CNPJ_DA_OUTRA = "99444333000424";

/** Dígito verificador escrito de outro jeito que o da biblioteca, para montar as chaves do teste. */
function digito(corpo: string): number {
  const pesos = [2, 3, 4, 5, 6, 7, 8, 9];
  const soma = [...corpo].reverse().reduce((total, numero, i) => total + Number(numero) * pesos[i % 8], 0);
  return soma % 11 < 2 ? 0 : 11 - (soma % 11);
}

function chaveDe(numero: number, opcoes: { cnpj?: string; modelo?: string; serie?: number } = {}): string {
  const { cnpj = CNPJ_EMITENTE, modelo = "55", serie = 1 } = opcoes;
  const corpo = `352610${cnpj.padStart(14, "0")}${modelo}${String(serie).padStart(3, "0")}${String(numero).padStart(9, "0")}112345678`;
  return `${corpo}${digito(corpo)}`;
}

type Nota = {
  numero?: number;
  serie?: number;
  chave?: string;
  chaveDoProtocolo?: string | null;
  modelo?: string;
  emitente?: string;
  nomeDoEmitente?: string;
  destinatario?: string;
  vol?: string;
  modFrete?: string;
  prefixo?: string;
  soNota?: boolean;
  extra?: string;
};

/** XML de NF-e no formato da SEFAZ (nfeProc 4.00), só com o que o leitor usa e um pouco do que ele ignora. */
function xmlNfe(nota: Nota = {}): string {
  const {
    numero = 1234,
    serie = 1,
    modelo = "55",
    emitente = `<CNPJ>${CNPJ_EMITENTE}</CNPJ>`,
    nomeDoEmitente = "Fábrica de Tintas Rio Preto LTDA",
    destinatario = `<CNPJ>${CNPJ_DESTINATARIO}</CNPJ>`,
    vol = "<vol><qVol>3</qVol><esp>CAIXA</esp><pesoL>40.000</pesoL><pesoB>42.500</pesoB></vol>",
    modFrete = "0",
    prefixo = "",
    soNota = false,
    extra = "",
  } = nota;
  const chave = nota.chave ?? chaveDe(numero, { serie });
  const chaveDoProtocolo = nota.chaveDoProtocolo === undefined ? chave : nota.chaveDoProtocolo;
  const p = prefixo ? `${prefixo}:` : "";
  const ns = prefixo ? `xmlns:${prefixo}` : "xmlns";

  const nfe = `<${p}NFe ${soNota || !prefixo ? `${ns}="http://www.portalfiscal.inf.br/nfe"` : ""}>
  <${p}infNFe versao="4.00" Id="NFe${chave}">
    <${p}ide><${p}cUF>35</${p}cUF><${p}natOp>Venda de mercadoria</${p}natOp><${p}mod>${modelo}</${p}mod><${p}serie>${serie}</${p}serie><${p}nNF>${numero}</${p}nNF><${p}dhEmi>2026-10-08T14:30:00-03:00</${p}dhEmi></${p}ide>
    <${p}emit>${emitente}<${p}xNome>${nomeDoEmitente}</${p}xNome>
      <${p}enderEmit><${p}xLgr>Rua das Tintas</${p}xLgr><${p}nro>120</${p}nro><${p}xBairro>Distrito Industrial</${p}xBairro><${p}xMun>São José do Rio Preto</${p}xMun><${p}UF>SP</${p}UF><${p}CEP>15035000</${p}CEP></${p}enderEmit>
    </${p}emit>
    <${p}dest>${destinatario}<${p}xNome>Mercado Bom Preço LTDA</${p}xNome>
      <${p}enderDest><${p}xLgr>Av. Brasil</${p}xLgr><${p}nro>S/N</${p}nro><${p}xCpl>Loja 2</${p}xCpl><${p}xBairro>Centro</${p}xBairro><${p}xMun>Mirassol</${p}xMun><${p}UF>SP</${p}UF><${p}CEP>15130000</${p}CEP></${p}enderDest>
    </${p}dest>
    <${p}det nItem="1"><${p}prod><${p}xProd>Tinta &lt;branca&gt; 18 L</${p}xProd><${p}vProd>1500.00</${p}vProd></${p}prod></${p}det>
    <${p}total><${p}ICMSTot><${p}vProd>1500.00</${p}vProd><${p}vNF>1534.56</${p}vNF></${p}ICMSTot></${p}total>
    <${p}transp><${p}modFrete>${modFrete}</${p}modFrete>${vol}</${p}transp>
    ${extra}
  </${p}infNFe>
  <Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignatureValue>QUJDREVGRw==</SignatureValue></Signature>
</${p}NFe>`;
  if (soNota) return `<?xml version="1.0" encoding="UTF-8"?>\n${nfe}`;

  const protocolo = chaveDoProtocolo === null ? "" : `<${p}protNFe versao="4.00"><${p}infProt><${p}chNFe>${chaveDoProtocolo}</${p}chNFe><${p}cStat>100</${p}cStat></${p}infProt></${p}protNFe>`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<${p}nfeProc versao="4.00" ${ns}="http://www.portalfiscal.inf.br/nfe">${nfe}${protocolo}</${p}nfeProc>`;
}

const lida = (xml: string): NotaLida => {
  const leitura = lerNfe(xml);
  if (!leitura.ok) throw new Error(leitura.erro);
  return leitura.nota;
};
const recusa = (xml: unknown): string => {
  const leitura = lerNfe(xml);
  if (leitura.ok) throw new Error("era para recusar");
  return leitura.erro;
};

describe("documentos fiscais: regras", () => {
  describe("chave de acesso", () => {
    it("o dígito verificador é o módulo 11 com pesos de 2 a 9", () => {
      // Chave de exemplo do Manual de Orientação do Contribuinte, conferida com outra implementação.
      expect(digitoDaChave("5206043300991100250655012000000780026730161")).toBe(5);
      expect(chaveValida("52060433009911002506550120000007800267301615")).toBe(true);
      for (let trocado = 0; trocado <= 9; trocado += 1) {
        if (trocado !== 5) expect(chaveValida(`5206043300991100250655012000000780026730161${trocado}`), String(trocado)).toBe(false);
      }
      // Resto 0 ou 1 dá dígito 0.
      expect(digitoDaChave("0".repeat(43))).toBe(0);
      expect(digitoDaChave(`${"0".repeat(42)}6`)).toBe(0);
      expect(digitoDaChave(`${"0".repeat(42)}5`)).toBe(1);
    });

    it("só 44 dígitos são chave", () => {
      for (const chave of ["", "123", "5206043300991100250655012000000780026730161", "5206043300991100250655012000000780026730161a", " 52060433009911002506550120000007800267301615"]) {
        expect(chaveValida(chave), chave).toBe(false);
      }
      expect(digitoDaChave("12")).toBeNull();
    });

    it("as partes da chave: emitente, modelo, série e número", () => {
      expect(partesDaChave(chaveDe(987654, { serie: 12 }))).toEqual({ documentoDoEmitente: CNPJ_EMITENTE, modelo: "55", serie: 12, numero: 987654 });
    });
  });

  describe("leitor de NF-e", () => {
    it("extrai chave, número, série, emissão, partes, valor, volumes, peso, natureza e modalidade do frete", () => {
      expect(lida(xmlNfe())).toEqual({
        accessKey: chaveDe(1234),
        number: 1234,
        series: 1,
        issuedAt: new Date("2026-10-08T17:30:00.000Z"),
        operationNature: "Venda de mercadoria",
        freightMode: 0,
        issuerTaxId: CNPJ_EMITENTE,
        issuerName: "Fábrica de Tintas Rio Preto LTDA",
        issuerCity: "São José do Rio Preto",
        issuerState: "SP",
        issuerAddress: "Rua das Tintas, 120, Distrito Industrial, CEP 15035-000",
        recipientTaxId: CNPJ_DESTINATARIO,
        recipientName: "Mercado Bom Preço LTDA",
        recipientCity: "Mirassol",
        recipientState: "SP",
        recipientAddress: "Av. Brasil, S/N, Loja 2, Centro, CEP 15130-000",
        totalValue: 1534.56,
        grossWeight: 42.5,
        volumes: 3,
      });
    });

    it("aceita prefixo de namespace, a nota sem o protocolo, BOM e comentário", () => {
      const esperado = lida(xmlNfe());
      expect(lida(xmlNfe({ prefixo: "nfe" }))).toEqual(esperado);
      expect(lida(xmlNfe({ soNota: true }))).toEqual(esperado);
      expect(lida(xmlNfe({ prefixo: "ns2", soNota: true }))).toEqual(esperado);
      expect(lida(`﻿${xmlNfe()}`)).toEqual(esperado);
      expect(lida(xmlNfe({ extra: "<!-- gerado pelo emissor <b>X</b> --><infAdic><infCpl>Pedido 77</infCpl></infAdic>" }))).toEqual(esperado);
    });

    it("sem o atributo Id, a chave vem do protocolo", () => {
      const xml = xmlNfe().replace(/ Id="NFe\d+"/, "");
      expect(lida(xml).accessKey).toBe(chaveDe(1234));
    });

    it("soma os blocos de volume; sem bloco, volumes e peso ficam sem valor", () => {
      const varios = "<vol><qVol>3</qVol><pesoB>10.100</pesoB></vol><vol><qVol>2</qVol><pesoB>0.200</pesoB></vol><vol><esp>PALETE</esp><pesoB>5.000</pesoB></vol>";
      expect(lida(xmlNfe({ vol: varios }))).toMatchObject({ volumes: 5, grossWeight: 15.3 });
      expect(lida(xmlNfe({ vol: "" }))).toMatchObject({ volumes: null, grossWeight: null });
      expect(lida(xmlNfe({ vol: "<vol><qVol>4</qVol></vol>" }))).toMatchObject({ volumes: 4, grossWeight: null });
      // Número fora do formato da nota não vira número.
      expect(lida(xmlNfe({ vol: "<vol><qVol>1e3</qVol><pesoB>-5</pesoB></vol>" }))).toMatchObject({ volumes: null, grossWeight: null });
    });

    it("destinatário pessoa física (CPF), nota antiga com dEmi e nota sem destinatário", () => {
      expect(lida(xmlNfe({ destinatario: "<CPF>12345678909</CPF>" })).recipientTaxId).toBe("12345678909");
      const antiga = xmlNfe().replace(/<dhEmi>[^<]+<\/dhEmi>/, "<dEmi>2013-05-20</dEmi>");
      expect(lida(antiga).issuedAt).toEqual(new Date("2013-05-20T00:00:00.000Z"));
      expect(lida(xmlNfe().replace(/<dhEmi>[^<]+<\/dhEmi>/, "<dhEmi>ontem</dhEmi>")).issuedAt).toBeNull();
      const semDestinatario = xmlNfe().replace(/<dest>[\s\S]*<\/dest>/, "");
      expect(lida(semDestinatario)).toMatchObject({ recipientTaxId: null, recipientName: null, recipientCity: null, recipientAddress: null });
    });

    it("entidades do XML e CDATA viram texto; o conteúdo nunca é mais que texto", () => {
      expect(lida(xmlNfe({ nomeDoEmitente: "Silva &amp; Filhos &quot;Tintas&quot; &#231;&#xE3;o &lt;b&gt;" })).issuerName).toBe('Silva & Filhos "Tintas" ção <b>');
      expect(lida(xmlNfe({ nomeDoEmitente: "<![CDATA[<script>alert(1)</script> & Cia]]>" })).issuerName).toBe("<script>alert(1)</script> & Cia");
      expect(lida(xmlNfe({ nomeDoEmitente: "  Tintas \n   do   Vale  " })).issuerName).toBe("Tintas do Vale");
      expect(lida(xmlNfe({ nomeDoEmitente: "A".repeat(500) })).issuerName).toHaveLength(200);
    });

    it("recusa DOCTYPE, entidade declarada ou desconhecida e referência a caractere inválido", () => {
      const bomba = `<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;">]>${xmlNfe({ nomeDoEmitente: "&lol2;" }).replace(/^<\?xml[^>]*>\n/, "")}`;
      expect(recusa(bomba)).toMatch(/não é um XML válido: o arquivo declara DOCTYPE/);
      const externa = `<!DOCTYPE x [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>${xmlNfe({ nomeDoEmitente: "&xxe;" })}`;
      expect(recusa(externa)).toMatch(/DOCTYPE/);
      expect(recusa(xmlNfe({ nomeDoEmitente: "&xxe;" }))).toMatch(/entidade desconhecida \(&xxe;\)/);
      expect(recusa(xmlNfe({ nomeDoEmitente: "Silva & Filhos" }))).toMatch(/& solto/);
      expect(recusa(xmlNfe({ nomeDoEmitente: "a&#0;b" }))).toMatch(/caractere inválido/);
      expect(recusa(xmlNfe({ nomeDoEmitente: "a&#xD800;b" }))).toMatch(/caractere inválido/);
    });

    it("recusa XML malformado dizendo o que há de errado", () => {
      const inteiro = xmlNfe();
      expect(recusa(inteiro.slice(0, inteiro.length - 30))).toMatch(/não é um XML válido/);
      expect(recusa(inteiro.replace("</emit>", "</emitente>"))).toMatch(/fecha o que não foi aberto/);
      expect(recusa(inteiro.replace("<ide>", "<ide"))).toMatch(/não é um XML válido/);
      expect(recusa(`${inteiro}<outro/>`)).toMatch(/mais de um elemento principal/);
      expect(recusa(`${inteiro} sobra`)).toMatch(/texto fora do elemento principal/);
      expect(recusa("<a><b></a></b>")).toMatch(/não é um XML válido/);
      expect(recusa('<a b="1" c></a>')).toMatch(/atributo malformado/);
      expect(recusa("<1a/>")).toMatch(/nome inválido/);
      expect(recusa("<!-- só comentário -->")).toMatch(/não há nenhum elemento/);
      expect(recusa("isto não é xml")).toMatch(/não é um XML válido/);
      expect(recusa("PK\u0003\u0004\u0000\u0000binário")).toMatch(/não é um XML válido/);
      expect(recusa(`<a>${"<b>".repeat(100)}${"</b>".repeat(100)}</a>`)).toMatch(/aninhados demais/);
    });

    it("recusa o que não é NF-e: vazio, outro XML, CT-e e NFC-e", () => {
      for (const vazio of [undefined, null, 12, {}, "", "   \n"]) expect(recusa(vazio)).toBe("Envie o arquivo XML da nota.");
      expect(recusa("<html><body>oi</body></html>")).toBe("O arquivo é um XML, mas não é de NF-e (o elemento principal é <html>).");
      expect(recusa('<cteProc versao="4.00"><CTe><infCte Id="CTe1"/></CTe></cteProc>')).toMatch(/não é de NF-e \(o elemento principal é <cteProc>\)/);
      expect(recusa("<nfeProc><protNFe/></nfeProc>")).toMatch(/não é de NF-e/);
      const nfce = xmlNfe({ modelo: "65", chave: chaveDe(1234, { modelo: "65" }) });
      expect(recusa(nfce)).toBe("Só NF-e (modelo 55) é aceita; este XML é do modelo 65 (NFC-e).");
    });

    it("recusa chave com tamanho errado, dígito verificador errado, diferente do protocolo ou que não é desta nota", () => {
      const boa = chaveDe(1234);
      const digitoErrado = `${boa.slice(0, 43)}${(Number(boa[43]) + 1) % 10}`;
      expect(recusa(xmlNfe({ chave: boa.slice(0, 43), chaveDoProtocolo: null }))).toBe("A chave de acesso da nota não tem 44 dígitos.");
      expect(recusa(xmlNfe({ chave: digitoErrado, chaveDoProtocolo: null }))).toMatch(/dígito verificador não confere/);
      expect(recusa(xmlNfe({ chaveDoProtocolo: chaveDe(999) }))).toBe("A chave do protocolo de autorização é diferente da chave da nota.");
      // Chave válida, mas de outro número, de outra série ou de outro emitente.
      expect(recusa(xmlNfe({ numero: 1234, chave: chaveDe(1235) }))).toMatch(/não corresponde ao emitente, à série e ao número/);
      expect(recusa(xmlNfe({ chave: chaveDe(1234, { serie: 2 }) }))).toMatch(/não corresponde/);
      expect(recusa(xmlNfe({ chave: chaveDe(1234, { cnpj: CNPJ_TERCEIRO }) }))).toMatch(/não corresponde/);
    });

    it("recusa nota sem número, sem emitente ou sem valor total", () => {
      expect(recusa(xmlNfe().replace(/<nNF>\d+<\/nNF>/, ""))).toBe("O XML não traz o número e a série da nota.");
      expect(recusa(xmlNfe({ emitente: "" }))).toBe("O XML não traz o CNPJ/CPF e a razão social do emitente.");
      expect(recusa(xmlNfe({ nomeDoEmitente: " " }))).toBe("O XML não traz o CNPJ/CPF e a razão social do emitente.");
      expect(recusa(xmlNfe().replace(/<vNF>[^<]+<\/vNF>/, "<vNF>mil</vNF>"))).toBe("O XML não traz o valor total da nota (vNF).");
    });

    it("recusa arquivo acima de 1 MB, e aceita um no limite", () => {
      const enchimento = (bytes: number) => `<infAdic><infCpl>${"x".repeat(bytes)}</infCpl></infAdic>`;
      const grande = lerNfe(xmlNfe({ extra: enchimento(LIMITE_DO_XML_BYTES) }));
      expect(grande).toEqual({ ok: false, erro: XML_GRANDE, grande: true });
      // O limite é em bytes: acento conta dois.
      expect(lerNfe("ã".repeat(LIMITE_DO_XML_BYTES / 2 + 1))).toMatchObject({ ok: false, grande: true });

      const base = xmlNfe({ extra: enchimento(0) });
      const noLimite = xmlNfe({ extra: enchimento(LIMITE_DO_XML_BYTES - new TextEncoder().encode(base).length) });
      expect(new TextEncoder().encode(noLimite).length).toBe(LIMITE_DO_XML_BYTES);
      expect(lerNfe(noLimite).ok).toBe(true);
    });
  });

  describe("carga sugerida", () => {
    const nota = lida(xmlNfe());
    const emitente = { id: "cli-emitente", cnpj: CNPJ_EMITENTE, active: true };
    const destinatario = { id: "cli-destinatario", cnpj: CNPJ_DESTINATARIO, active: true };
    const terceiro = { id: "cli-terceiro", cnpj: CNPJ_TERCEIRO, active: true };

    it("preenche remetente, destinatário, origem e destino como Cidade - UF, volumes, peso, valor e chave", () => {
      expect(sugerirCarga(nota, [terceiro, emitente])).toEqual({
        clientId: "cli-emitente",
        pagador: "EMITENTE",
        sender: "Fábrica de Tintas Rio Preto LTDA",
        receiver: "Mercado Bom Preço LTDA",
        origin: "São José do Rio Preto - SP",
        destination: "Mirassol - SP",
        volumes: 3,
        weight: 42.5,
        invoiceKey: chaveDe(1234),
        invoiceValue: 1534.56,
        avisos: [],
        // O endereço de entrega sai do endereço do destinatário da nota; o complemento ("Loja 2") fica de fora.
        deliveryStreet: "Av. Brasil",
        deliveryNumber: "S/N",
        deliveryDistrict: "Centro",
        deliveryZip: "15130000",
      });
      // Nota sem endereço do destinatário: a carga nasce só com a cidade.
      expect(sugerirCarga({ ...nota, recipientAddress: null }, [emitente])).toMatchObject({ deliveryStreet: null, deliveryNumber: null, deliveryDistrict: null, deliveryZip: null });
    });

    it("o pagador é o cliente cujo CNPJ é o do emitente ou o do destinatário, com ou sem máscara no cadastro", () => {
      expect(sugerirCarga(nota, [destinatario])).toMatchObject({ clientId: "cli-destinatario", pagador: "DESTINATARIO", avisos: [] });
      expect(sugerirCarga(nota, [{ ...emitente, cnpj: "99.444.333/0001-81" }])).toMatchObject({ clientId: "cli-emitente" });
    });

    it("os dois são clientes: decide a modalidade do frete da nota; sem ela, o operador escolhe", () => {
      const ambos = [emitente, destinatario];
      expect(sugerirCarga({ ...nota, freightMode: 0 }, ambos)).toMatchObject({ clientId: "cli-emitente", pagador: "EMITENTE" });
      expect(sugerirCarga({ ...nota, freightMode: 1 }, ambos)).toMatchObject({ clientId: "cli-destinatario", pagador: "DESTINATARIO" });
      for (const modalidade of [2, 9, null]) {
        const sugestao = sugerirCarga({ ...nota, freightMode: modalidade }, ambos);
        expect(sugestao).toMatchObject({ clientId: null, pagador: null });
        expect(sugestao.avisos.join(" ")).toMatch(/não diz quem paga o frete/);
      }
    });

    it("nenhum cliente bate, ou o que bate está inativo: o operador escolhe", () => {
      for (const clientes of [[], [terceiro], [{ ...emitente, active: false }]]) {
        const sugestao = sugerirCarga(nota, clientes);
        expect(sugestao.clientId).toBeNull();
        expect(sugestao.avisos).toEqual(["Nenhum cliente cadastrado tem o CNPJ do emitente ou do destinatário: escolha o cliente pagador."]);
      }
    });

    it("avisa o que a nota não traz: volumes, peso e destinatário", () => {
      const sugestao = sugerirCarga({ ...nota, volumes: 0, grossWeight: null, recipientName: null, recipientCity: null, recipientState: null }, [emitente]);
      expect(sugestao).toMatchObject({ volumes: null, weight: null, receiver: "", destination: "" });
      expect(sugestao.avisos).toHaveLength(3);
      expect(cidadeUf("Mirassol", null)).toBe("Mirassol");
      expect(cidadeUf(null, null)).toBe("");
    });

    it("a confirmação aceita os campos da carga e descarta chave, valor da NF e motorista vindos do formulário", () => {
      const ok = criarCargaDaNotaSchema.safeParse({
        clientId: "c1",
        sender: " Remetente ",
        receiver: "Destinatário",
        origin: "Rio Preto - SP",
        destination: "Mirassol - SP",
        volumes: "3",
        weight: "42,5",
        invoiceKey: "1".repeat(44),
        invoiceValue: 1,
        driverId: "d1",
        status: "DELIVERED",
      });
      expect(ok.success && ok.data).toEqual({ clientId: "c1", sender: "Remetente", receiver: "Destinatário", origin: "Rio Preto - SP", destination: "Mirassol - SP", volumes: 3, weight: 42.5 });
      expect(criarCargaDaNotaSchema.safeParse({ clientId: "c1", sender: "a", receiver: "b", origin: "c", destination: "d", volumes: "", weight: "1" }).success).toBe(false);
    });
  });

  describe("busca e arquivo", () => {
    it("em branco não filtra; número e pontuação buscam por chave, CNPJ e número; texto busca por razão social", () => {
      expect(filtroDeNotas("")).toEqual({});
      expect(filtroDeNotas("  ")).toEqual({});
      expect(filtroDeNotas(null)).toEqual({});
      expect(filtroDeNotas("1234")).toEqual({
        OR: [{ accessKey: { contains: "1234" } }, { issuerTaxId: { contains: "1234" } }, { recipientTaxId: { contains: "1234" } }, { number: 1234 }],
      });
      expect(filtroDeNotas("99.444.333/0001-81")).toEqual({
        OR: [{ accessKey: { contains: CNPJ_EMITENTE } }, { issuerTaxId: { contains: CNPJ_EMITENTE } }, { recipientTaxId: { contains: CNPJ_EMITENTE } }],
      });
      expect(filtroDeNotas(" Tintas ")).toEqual({
        OR: [{ issuerName: { contains: "Tintas", mode: "insensitive" } }, { recipientName: { contains: "Tintas", mode: "insensitive" } }],
      });
      // Letras e números misturados não são chave nem CNPJ.
      expect(filtroDeNotas("Loja 24")).toHaveProperty("OR.0.issuerName");
    });

    it("o arquivo baixado leva a chave no nome", () => {
      expect(nomeDoArquivoXml(chaveDe(1234))).toBe(`${chaveDe(1234)}-nfe.xml`);
      expect(nomeDoArquivoXml('12"\r\n34')).toBe("1234-nfe.xml");
    });
  });

  describe("registro manual de CT-e", () => {
    const chaveCte = chaveDe(501, { modelo: "57" });
    const ler = (dados: Record<string, unknown>) => registrarCteSchema.safeParse({ collectionId: "c1", ...dados });
    const erro = (dados: Record<string, unknown>) => {
      const resultado = ler(dados);
      return resultado.success ? null : resultado.error.issues[0].message;
    };

    it("número e chave juntos, com a chave conferida; a chave pode vir com espaço e ponto", () => {
      const ok = ler({ cteNumber: "501", cteKey: chaveCte.replace(/(\d{4})/g, "$1 ") });
      expect(ok.success && ok.data).toEqual({ collectionId: "c1", cteNumber: 501, cteKey: chaveCte });
      expect(ler({ cteNumber: 501, cteKey: chaveCte }).success).toBe(true);
    });

    it("os dois em branco desfazem o registro; só um deles é erro", () => {
      for (const vazio of [{ cteNumber: "", cteKey: "" }, { cteNumber: null, cteKey: null }, { cteNumber: " ", cteKey: null }]) {
        const ok = ler(vazio);
        expect(ok.success && ok.data).toEqual({ collectionId: "c1", cteNumber: null, cteKey: null });
      }
      expect(erro({ cteNumber: 501, cteKey: "" })).toMatch(/Informe o número e a chave/);
      expect(erro({ cteNumber: "", cteKey: chaveCte })).toMatch(/Informe o número e a chave/);
    });

    it("recusa corpo vazio, número inválido, chave curta, dígito errado, chave de NF-e e número diferente do da chave", () => {
      expect(registrarCteSchema.safeParse({}).success).toBe(false);
      expect(registrarCteSchema.safeParse(null).success).toBe(false);
      expect(erro({})).not.toBeNull();
      expect(erro({ cteNumber: "abc", cteKey: chaveCte })).toMatch(/número do CT-e/);
      expect(erro({ cteNumber: 0, cteKey: chaveCte })).toMatch(/número do CT-e/);
      expect(erro({ cteNumber: 501, cteKey: "123" })).toBe("A chave do CT-e precisa ter 44 dígitos.");
      expect(erro({ cteNumber: 501, cteKey: `${chaveCte.slice(0, 43)}${(Number(chaveCte[43]) + 1) % 10}` })).toMatch(/dígito verificador/);
      expect(erro({ cteNumber: 501, cteKey: chaveDe(501) })).toMatch(/não é de CT-e \(modelo 57\)/);
      expect(erro({ cteNumber: 502, cteKey: chaveCte })).toBe("O número informado não é o que está na chave do CT-e.");
    });

    it("só há CT-e registrado com chave e situação de emitido; e a carga diz o que falta para emitir", () => {
      expect(cteRegistrado({ cteKey: chaveCte, cteStatus: "ISSUED" })).toBe(true);
      expect(cteRegistrado({ cteKey: null, cteStatus: "ISSUED" })).toBe(false);
      expect(cteRegistrado({ cteKey: null, cteStatus: "PENDING" })).toBe(false);
      expect(cteRegistrado({ cteKey: chaveCte, cteStatus: null })).toBe(false);
      expect(pendenciasParaCte({ invoiceKey: null, invoiceValue: null, freightValue: null })).toEqual(["chave da NF-e", "valor da mercadoria", "valor do frete"]);
      expect(pendenciasParaCte({ invoiceKey: chaveDe(1), invoiceValue: 0, freightValue: 0 })).toEqual([]);
    });
  });
});

const temBanco = Boolean(process.env.DATABASE_URL);

if (!temBanco) {
  console.warn(
    "\n[fiscal.test] DATABASE_URL ausente: testes de integração PULADOS.\n" +
      "Rode com um Postgres real para exercitá-los.\n",
  );
}

const suite = temBanco ? describe : describe.skip;

const RASTREIO = {
  COM_A_CHAVE: "9944433301",
  COM_OUTRA_CHAVE: "9944433302",
  SEM_CHAVE: "9944433303",
  EM_ROTA: "9944433304",
  ENTREGUE: "9944433305",
  DE_OUTRO_CLIENTE: "9944433306",
  DA_OUTRA: "9944433307",
};
const SEM_ID = "00000000-0000-0000-0000-000000000000";
const HASH_FALSO = "$2b$10$hashfalsoparateste000000000000000000000000000000000";

// Cada cenário importa a sua nota: os números não se repetem entre os testes.
const N = {
  PRINCIPAL: 9001,
  DA_OUTRA_EMPRESA: 9002,
  PARA_LIGAR: 9003,
  DA_CARGA_COM_A_CHAVE: 9004,
  PARA_CARGA_SEM_CHAVE: 9005,
  PARA_CARGA_EM_ROTA: 9006,
  SEM_VOLUMES: 9007,
  SEM_CLIENTE: 9008,
  SOLTA: 9009,
  INVASORA: 9010,
};

type Importada = { nota: NotaImportada; sugestao: SugestaoDeCarga | null; cargaComAChave: CargaDaNota | null; coleta?: CargaDaNota | null; error?: string };
type Criada = { nota: NotaImportada; coleta: { id: string; status: string; trackingCode: string; invoiceKey: string; invoiceValue: number; freightValue: number | null; clientId: string } };

suite("documentos fiscais: importação, carga, consulta, CT-e e isolamento entre empresas", () => {
  let banco: typeof import("../src/lib/prisma");
  let notas: typeof import("../src/app/api/fiscal/notas/route");
  let notaPorId: typeof import("../src/app/api/fiscal/notas/[id]/route");
  let xmlDaNota: typeof import("../src/app/api/fiscal/notas/[id]/xml/route");
  let cargaDaNota: typeof import("../src/app/api/fiscal/notas/[id]/carga/route");
  let ligarNota: typeof import("../src/app/api/fiscal/notas/[id]/ligar/route");
  let cte: typeof import("../src/app/api/fiscal/cte/route");
  let coletas: typeof import("../src/app/api/coletas/route");
  let portalColeta: typeof import("../src/app/api/portal/coletas/[id]/route");
  let portalNota: typeof import("../src/app/api/portal/coletas/[id]/notas/[notaId]/route");

  const sessao = vi.mocked(getServerSession);
  const ids = { ADMIN: "", OPERATION: "", CLIENT: "", DRIVER: "" };
  let adminDaOutra: string;
  let clienteDeOutroCnpj: string;
  let clienteEmitente: string;
  let usuarioDeOutroCliente: string;
  const cargas = { COM_A_CHAVE: "", COM_OUTRA_CHAVE: "", SEM_CHAVE: "", EM_ROTA: "", ENTREGUE: "", DE_OUTRO_CLIENTE: "", DA_OUTRA: "" };

  const entrarComo = (quem: keyof typeof ids | null) => sessao.mockResolvedValue(quem ? { user: { id: ids[quem], role: quem, clientId: null } } : null);
  const entrarNaOutra = () => sessao.mockResolvedValue({ user: { id: adminDaOutra, role: "ADMIN", clientId: null, tenantId: EMPRESA_OUTRA.id } });

  const req = (method = "GET", body?: unknown, query = "") =>
    new Request(`http://localhost/api/teste${query ? `?${query}` : ""}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const responder = async <T>(res: Response) => ({ status: res.status, corpo: (await res.json()) as T & { error?: string } });

  const importar = async (xml: unknown) => responder<Importada>(await notas.POST(req("POST", { xml })));
  const listar = async (busca = "") => responder<NotaImportada[]>(await notas.GET(req("GET", undefined, busca ? `busca=${encodeURIComponent(busca)}` : "")));
  const abrir = async (id: string) => responder<Importada>(await notaPorId.GET(req(), ctx(id)));
  const criarCarga = async (id: string, dados: Record<string, unknown>) => responder<Criada>(await cargaDaNota.POST(req("POST", dados), ctx(id)));
  const ligar = async (id: string, trackingCode: unknown) => responder<{ nota: NotaImportada }>(await ligarNota.POST(req("POST", { trackingCode }), ctx(id)));
  const registrarCte = async (dados: Record<string, unknown>) => responder<CargaParaCte>(await cte.POST(req("POST", dados)));

  /** Importa a nota do cenário e devolve o id. */
  const nova = async (numero: number, extra: Nota = {}) => {
    const { status, corpo } = await importar(xmlNfe({ numero, ...extra }));
    expect(status, corpo.error).toBe(201);
    return corpo;
  };

  const sugerida = (sugestao: SugestaoDeCarga | null, extra: Record<string, unknown> = {}) => ({
    clientId: sugestao?.clientId,
    sender: sugestao?.sender,
    receiver: sugestao?.receiver,
    origin: sugestao?.origin,
    destination: sugestao?.destination,
    volumes: sugestao?.volumes,
    weight: sugestao?.weight,
    ...extra,
  });

  async function limpar() {
    const { sistema } = banco;
    const documentos = [CNPJ_EMITENTE, CNPJ_DESTINATARIO, CNPJ_TERCEIRO, CNPJ_DA_OUTRA];
    await sistema.fiscalDocument.deleteMany({ where: { issuerTaxId: { in: documentos } } });
    await sistema.collection.deleteMany({ where: { client: { cnpj: { in: documentos } } } });
    await sistema.user.deleteMany({ where: { email: { startsWith: PREFIXO } } });
    await sistema.client.deleteMany({ where: { cnpj: { in: documentos } } });
  }

  const carga = (clientId: string, trackingCode: string, status: string, extra: Record<string, unknown> = {}) => ({
    clientId,
    sender: "Remetente",
    receiver: "Mercado Bom Preço",
    origin: "São José do Rio Preto - SP",
    destination: "Mirassol - SP",
    volumes: 3,
    weight: 42.5,
    status,
    trackingCode,
    ...extra,
  });

  beforeAll(async () => {
    banco = await import("../src/lib/prisma");
    notas = await import("../src/app/api/fiscal/notas/route");
    notaPorId = await import("../src/app/api/fiscal/notas/[id]/route");
    xmlDaNota = await import("../src/app/api/fiscal/notas/[id]/xml/route");
    cargaDaNota = await import("../src/app/api/fiscal/notas/[id]/carga/route");
    ligarNota = await import("../src/app/api/fiscal/notas/[id]/ligar/route");
    cte = await import("../src/app/api/fiscal/cte/route");
    coletas = await import("../src/app/api/coletas/route");
    portalColeta = await import("../src/app/api/portal/coletas/[id]/route");
    portalNota = await import("../src/app/api/portal/coletas/[id]/notas/[notaId]/route");
    await limpar();

    const db = banco.default;
    clienteEmitente = (await db.client.create({ data: { companyName: `${PREFIXO}fábrica de tintas`, cnpj: CNPJ_EMITENTE } })).id;
    clienteDeOutroCnpj = (await db.client.create({ data: { companyName: `${PREFIXO}outro cliente`, cnpj: CNPJ_TERCEIRO } })).id;
    for (const quem of Object.keys(ids) as (keyof typeof ids)[]) {
      ids[quem] = (
        await db.user.create({
          data: { name: `${PREFIXO}${quem}`, email: `${PREFIXO}${quem.toLowerCase()}@exemplo.br`, password: HASH_FALSO, role: quem, clientId: quem === "CLIENT" ? clienteEmitente : undefined },
        })
      ).id;
    }
    usuarioDeOutroCliente = (
      await db.user.create({ data: { name: `${PREFIXO}de outro cliente`, email: `${PREFIXO}outro-cliente@exemplo.br`, password: HASH_FALSO, role: "CLIENT", clientId: clienteDeOutroCnpj } })
    ).id;

    cargas.COM_A_CHAVE = (await db.collection.create({ data: carga(clienteEmitente, RASTREIO.COM_A_CHAVE, "CONFIRMED", { invoiceKey: chaveDe(N.DA_CARGA_COM_A_CHAVE) }) })).id;
    cargas.COM_OUTRA_CHAVE = (await db.collection.create({ data: carga(clienteEmitente, RASTREIO.COM_OUTRA_CHAVE, "CONFIRMED", { invoiceKey: chaveDe(777) }) })).id;
    cargas.SEM_CHAVE = (await db.collection.create({ data: carga(clienteEmitente, RASTREIO.SEM_CHAVE, "COLLECTED") })).id;
    cargas.EM_ROTA = (await db.collection.create({ data: carga(clienteEmitente, RASTREIO.EM_ROTA, "ROUTE", { invoiceValue: 800, freightValue: 120 }) })).id;
    cargas.ENTREGUE = (await db.collection.create({ data: carga(clienteEmitente, RASTREIO.ENTREGUE, "DELIVERED") })).id;
    cargas.DE_OUTRO_CLIENTE = (await db.collection.create({ data: carga(clienteDeOutroCnpj, RASTREIO.DE_OUTRO_CLIENTE, "CONFIRMED") })).id;

    const outra = banco.paraEmpresa(EMPRESA_OUTRA.id).db;
    // Na outra empresa o mesmo CNPJ é cliente também: cadastro e nota são únicos por empresa.
    const clienteDaOutra = await outra.client.create({ data: { companyName: `${PREFIXO}cliente da outra`, cnpj: CNPJ_DA_OUTRA } });
    await outra.client.create({ data: { companyName: `${PREFIXO}fábrica na outra`, cnpj: CNPJ_EMITENTE } });
    adminDaOutra = (await outra.user.create({ data: { name: `${PREFIXO}admin da outra`, email: `${PREFIXO}admin-outra@exemplo.br`, password: HASH_FALSO, role: "ADMIN" } })).id;
    cargas.DA_OUTRA = (await outra.collection.create({ data: carga(clienteDaOutra.id, RASTREIO.DA_OUTRA, "ROUTE") })).id;
  });

  beforeEach(() => {
    sessao.mockReset();
  });

  afterAll(async () => {
    if (banco) await limpar();
  });

  describe("permissão", () => {
    const todas = (): [string, () => Promise<Response>][] => [
      ["GET /api/fiscal/notas", () => notas.GET(req())],
      ["POST /api/fiscal/notas", () => notas.POST(req("POST", { xml: xmlNfe({ numero: N.INVASORA }) }))],
      ["GET /api/fiscal/notas/[id]", () => notaPorId.GET(req(), ctx(SEM_ID))],
      ["GET /api/fiscal/notas/[id]/xml", () => xmlDaNota.GET(req(), ctx(SEM_ID))],
      ["POST /api/fiscal/notas/[id]/carga", () => cargaDaNota.POST(req("POST", {}), ctx(SEM_ID))],
      ["POST /api/fiscal/notas/[id]/ligar", () => ligarNota.POST(req("POST", { trackingCode: RASTREIO.SEM_CHAVE }), ctx(SEM_ID))],
      ["GET /api/fiscal/cte", () => cte.GET()],
      ["POST /api/fiscal/cte", () => cte.POST(req("POST", { collectionId: cargas.EM_ROTA, cteNumber: 501, cteKey: chaveDe(501, { modelo: "57" }) }))],
    ];

    it("sem sessão é 401; cliente e motorista são 403; e nada é gravado", async () => {
      for (const [quem, esperado] of [[null, 401], ["CLIENT", 403], ["DRIVER", 403]] as const) {
        entrarComo(quem);
        for (const [nome, chamar] of todas()) expect((await chamar()).status, `${nome} como ${quem}`).toBe(esperado);
      }
      expect(await banco.sistema.fiscalDocument.count({ where: { accessKey: chaveDe(N.INVASORA) } })).toBe(0);
      expect((await banco.sistema.collection.findUniqueOrThrow({ where: { id: cargas.EM_ROTA } })).cteKey).toBeNull();
    });

    it("administrador e operação entram", async () => {
      for (const quem of ["ADMIN", "OPERATION"] as const) {
        entrarComo(quem);
        expect((await notas.GET(req())).status, quem).toBe(200);
        expect((await cte.GET()).status, quem).toBe(200);
      }
    });
  });

  describe("importar o XML", () => {
    it("recusa corpo sem XML, o que não é NF-e, chave inválida e arquivo grande demais, sem gravar", async () => {
      entrarComo("OPERATION");
      expect((await responder(await notas.POST(req("POST", {})))).status).toBe(400);
      expect((await responder(await notas.POST(new Request("http://localhost/api/teste", { method: "POST", body: "isto não é json" })))).status).toBe(400);
      expect(await importar(12)).toMatchObject({ status: 400, corpo: { error: "Envie o arquivo XML da nota." } });
      expect(await importar("<html/>")).toMatchObject({ status: 400, corpo: { error: "O arquivo é um XML, mas não é de NF-e (o elemento principal é <html>)." } });
      expect((await importar(xmlNfe().slice(0, 300))).corpo.error).toMatch(/não é um XML válido/);

      const boa = chaveDe(N.INVASORA);
      const invalida = await importar(xmlNfe({ numero: N.INVASORA, chave: `${boa.slice(0, 43)}${(Number(boa[43]) + 1) % 10}`, chaveDoProtocolo: null }));
      expect(invalida.status).toBe(400);
      expect(invalida.corpo.error).toMatch(/dígito verificador não confere/);

      const grande = await importar(xmlNfe({ numero: N.INVASORA, extra: `<infAdic><infCpl>${"x".repeat(LIMITE_DO_XML_BYTES)}</infCpl></infAdic>` }));
      expect(grande).toMatchObject({ status: 413, corpo: { error: XML_GRANDE } });
      const enorme = await responder(await notas.POST(req("POST", { xml: "x".repeat(LIMITE_DO_XML_BYTES * 2 + 2048) })));
      expect(enorme).toMatchObject({ status: 413, corpo: { error: XML_GRANDE } });

      expect(await banco.sistema.fiscalDocument.count({ where: { issuerTaxId: CNPJ_EMITENTE } })).toBe(0);
    });

    it("guarda a nota com o XML original e devolve o que leu e a carga sugerida, com o cliente achado pelo CNPJ", async () => {
      entrarComo("OPERATION");
      const xml = xmlNfe({ numero: N.PRINCIPAL });
      const { status, corpo } = await importar(xml);

      expect(status).toBe(201);
      expect(corpo.nota).toMatchObject({
        accessKey: chaveDe(N.PRINCIPAL),
        number: N.PRINCIPAL,
        series: 1,
        issuedAt: "2026-10-08T17:30:00.000Z",
        issuerTaxId: CNPJ_EMITENTE,
        recipientTaxId: CNPJ_DESTINATARIO,
        totalValue: 1534.56,
        grossWeight: 42.5,
        volumes: 3,
        collection: null,
      });
      expect(corpo.nota).not.toHaveProperty("xml");
      expect(corpo.sugestao).toMatchObject({
        clientId: clienteEmitente,
        pagador: "EMITENTE",
        origin: "São José do Rio Preto - SP",
        destination: "Mirassol - SP",
        volumes: 3,
        weight: 42.5,
        invoiceKey: chaveDe(N.PRINCIPAL),
        invoiceValue: 1534.56,
        avisos: [],
      });
      expect(corpo.cargaComAChave).toBeNull();

      const gravada = await banco.sistema.fiscalDocument.findUniqueOrThrow({ where: { id: corpo.nota.id } });
      expect(gravada).toMatchObject({ tenantId: EMPRESA_PADRAO.id, xml, importedById: ids.OPERATION, collectionId: null });
      // Importar não cria carga: ela só nasce quando o operador confirma.
      expect(await banco.sistema.collection.count({ where: { invoiceKey: chaveDe(N.PRINCIPAL) } })).toBe(0);
    });

    it("a mesma nota não entra duas vezes na empresa: 409 com a nota que já existe", async () => {
      entrarComo("ADMIN");
      const { status, corpo } = await importar(xmlNfe({ numero: N.PRINCIPAL, prefixo: "nfe" }));
      expect(status).toBe(409);
      expect(corpo.error).toBe("Esta nota já foi importada.");
      expect(corpo.nota.accessKey).toBe(chaveDe(N.PRINCIPAL));
      expect(corpo.coleta).toBeNull();
      expect(await banco.sistema.fiscalDocument.count({ where: { accessKey: chaveDe(N.PRINCIPAL) } })).toBe(1);
    });

    it("nota sem volumes ou sem cliente cadastrado vem com os avisos, e a carga que já tem a chave é apontada", async () => {
      entrarComo("OPERATION");
      const semVolumes = await nova(N.SEM_VOLUMES, { vol: "" });
      expect(semVolumes.sugestao).toMatchObject({ clientId: clienteEmitente, volumes: null, weight: null });
      expect(semVolumes.sugestao?.avisos).toHaveLength(2);

      const semCliente = await nova(N.SEM_CLIENTE, { emitente: `<CNPJ>${CNPJ_DESTINATARIO}</CNPJ>`, destinatario: "<CPF>12345678909</CPF>", chave: chaveDe(N.SEM_CLIENTE, { cnpj: CNPJ_DESTINATARIO }) });
      expect(semCliente.sugestao).toMatchObject({ clientId: null, pagador: null });
      expect(semCliente.sugestao?.avisos.join(" ")).toMatch(/escolha o cliente pagador/);

      const comCarga = await nova(N.DA_CARGA_COM_A_CHAVE);
      expect(comCarga.cargaComAChave).toMatchObject({ id: cargas.COM_A_CHAVE, trackingCode: RASTREIO.COM_A_CHAVE });
    });
  });

  describe("criar a carga a partir da nota", () => {
    let principal: string;

    beforeAll(async () => {
      principal = (await banco.sistema.fiscalDocument.findFirstOrThrow({ where: { accessKey: chaveDe(N.PRINCIPAL), tenantId: EMPRESA_PADRAO.id } })).id;
    });

    it("valida os campos da carga, o cliente e a nota, sem criar nada", async () => {
      entrarComo("OPERATION");
      const { corpo } = await abrir(principal);
      const dados = sugerida(corpo.sugestao);

      expect((await criarCarga(principal, {})).status).toBe(400);
      expect(await criarCarga(principal, { ...dados, volumes: "" })).toMatchObject({ status: 400, corpo: { error: "Os volumes precisam ser um número inteiro maior ou igual a 1." } });
      expect(await criarCarga(principal, { ...dados, weight: 0 })).toMatchObject({ status: 400, corpo: { error: "O peso precisa ser um número maior que zero." } });
      expect(await criarCarga(principal, { ...dados, clientId: SEM_ID })).toMatchObject({ status: 400, corpo: { error: "Cliente não encontrado ou inativo." } });
      expect(await criarCarga(SEM_ID, dados)).toMatchObject({ status: 404, corpo: { error: "Nota não encontrada." } });

      expect(await banco.sistema.collection.count({ where: { invoiceKey: chaveDe(N.PRINCIPAL) } })).toBe(0);
      expect((await banco.sistema.fiscalDocument.findUniqueOrThrow({ where: { id: principal } })).collectionId).toBeNull();
    });

    it("cria a carga confirmada, com rastreio, histórico, chave e valor da nota, e liga a nota a ela", async () => {
      entrarComo("OPERATION");
      const { corpo: aberta } = await abrir(principal);
      // Chave, valor e status vindos do formulário não valem: são os da nota e os do painel.
      const { status, corpo } = await criarCarga(principal, sugerida(aberta.sugestao, { invoiceKey: chaveDe(1), invoiceValue: 1, status: "DELIVERED" }));

      expect(status).toBe(201);
      expect(corpo.coleta).toMatchObject({ status: "CONFIRMED", clientId: clienteEmitente, invoiceKey: chaveDe(N.PRINCIPAL), invoiceValue: 1534.56 });
      expect(corpo.coleta.trackingCode).toMatch(/^\d{10}$/);
      expect(corpo.nota.collection).toMatchObject({ id: corpo.coleta.id, trackingCode: corpo.coleta.trackingCode, status: "CONFIRMED", destination: "Mirassol - SP" });

      const gravada = await banco.sistema.collection.findUniqueOrThrow({ where: { id: corpo.coleta.id }, include: { statusHistory: true, fiscalDocuments: { select: { id: true } } } });
      expect(gravada).toMatchObject({ tenantId: EMPRESA_PADRAO.id, sender: "Fábrica de Tintas Rio Preto LTDA", receiver: "Mercado Bom Preço LTDA", origin: "São José do Rio Preto - SP", volumes: 3, weight: 42.5 });
      expect(gravada.statusHistory.map((h) => [h.fromStatus, h.toStatus, h.userId])).toEqual([[null, "CONFIRMED", ids.OPERATION]]);
      expect(gravada.fiscalDocuments).toEqual([{ id: principal }]);
    });

    it("é o mesmo caminho da carga criada pelo painel: mesmo frete, mesmo status e mesmo histórico", async () => {
      entrarComo("OPERATION");
      const daNota = await banco.sistema.collection.findFirstOrThrow({ where: { invoiceKey: chaveDe(N.PRINCIPAL) }, include: { statusHistory: true } });
      const res = await coletas.POST(
        req("POST", { clientId: clienteEmitente, sender: daNota.sender, receiver: daNota.receiver, origin: daNota.origin, destination: daNota.destination, volumes: 3, weight: 42.5, invoiceValue: 1534.56 }),
      );
      expect(res.status).toBe(201);
      const doPainel = await banco.sistema.collection.findUniqueOrThrow({ where: { id: ((await res.json()) as { id: string }).id }, include: { statusHistory: true } });

      for (const campo of ["status", "freightValue", "freightDeadlineHours", "freightTableId", "freightManual", "driverId", "manifestId"] as const) {
        expect(daNota[campo], campo).toEqual(doPainel[campo]);
      }
      expect(daNota.freightDetails).toEqual(doPainel.freightDetails);
      expect(daNota.statusHistory.map((h) => [h.fromStatus, h.toStatus])).toEqual(doPainel.statusHistory.map((h) => [h.fromStatus, h.toStatus]));
    });

    it("nota já ligada não cria outra carga, e a reimportação responde 409 dizendo a carga", async () => {
      entrarComo("ADMIN");
      const { corpo: aberta } = await abrir(principal);
      expect(aberta.sugestao).toBeNull();
      const antes = await banco.sistema.collection.count({ where: { invoiceKey: chaveDe(N.PRINCIPAL) } });

      const dados = { clientId: clienteEmitente, sender: "a", receiver: "b", origin: "c", destination: "d", volumes: 1, weight: 1 };
      expect(await criarCarga(principal, dados)).toMatchObject({ status: 409, corpo: { error: "Esta nota já está ligada a uma carga." } });
      expect(await banco.sistema.collection.count({ where: { invoiceKey: chaveDe(N.PRINCIPAL) } })).toBe(antes);

      const codigo = aberta.nota.collection?.trackingCode;
      const repetida = await importar(xmlNfe({ numero: N.PRINCIPAL }));
      expect(repetida.status).toBe(409);
      expect(repetida.corpo.error).toBe(`Esta nota já foi importada. Ela está ligada à carga ${codigo}.`);
      expect(repetida.corpo.coleta).toMatchObject({ id: aberta.nota.collection?.id, trackingCode: codigo });
    });

    it("se já existe carga com a chave da nota, não cria outra: manda ligar", async () => {
      entrarComo("OPERATION");
      const nota = await banco.sistema.fiscalDocument.findFirstOrThrow({ where: { accessKey: chaveDe(N.DA_CARGA_COM_A_CHAVE), tenantId: EMPRESA_PADRAO.id } });
      const dados = { clientId: clienteEmitente, sender: "a", receiver: "b", origin: "c", destination: "d", volumes: 1, weight: 1 };
      const { status, corpo } = await criarCarga(nota.id, dados);
      expect(status).toBe(409);
      expect(corpo.error).toBe(`Já existe uma carga com a chave desta nota. Ligue a nota a ela em vez de criar outra. Código de rastreio: ${RASTREIO.COM_A_CHAVE}.`);
      expect(await banco.sistema.collection.count({ where: { invoiceKey: chaveDe(N.DA_CARGA_COM_A_CHAVE) } })).toBe(1);
    });

    it("duas confirmações ao mesmo tempo criam uma carga só", async () => {
      entrarComo("OPERATION");
      const { nota, sugestao } = await nova(N.SOLTA);
      const respostas = await Promise.all([criarCarga(nota.id, sugerida(sugestao)), criarCarga(nota.id, sugerida(sugestao))]);
      expect(respostas.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await banco.sistema.collection.count({ where: { invoiceKey: chaveDe(N.SOLTA) } })).toBe(1);
    });
  });

  describe("ligar a nota a uma carga que já existe", () => {
    it("valida o código e não acha carga que não existe nem carga de outra empresa", async () => {
      entrarComo("OPERATION");
      const { nota } = await nova(N.PARA_LIGAR);

      expect((await responder(await ligarNota.POST(req("POST", {}), ctx(nota.id)))).status).toBe(400);
      expect((await ligar(nota.id, "")).status).toBe(400);
      for (const codigo of ["123", "0000000000", RASTREIO.DA_OUTRA]) {
        expect(await ligar(nota.id, codigo), codigo).toMatchObject({ status: 404, corpo: { error: "Nenhuma carga com este código de rastreio." } });
      }
      expect(await ligar(SEM_ID, RASTREIO.SEM_CHAVE)).toMatchObject({ status: 404, corpo: { error: "Nota não encontrada." } });
    });

    it("a carga que já tem chave só aceita a nota dessa chave", async () => {
      entrarComo("OPERATION");
      const paraLigar = await banco.sistema.fiscalDocument.findFirstOrThrow({ where: { accessKey: chaveDe(N.PARA_LIGAR), tenantId: EMPRESA_PADRAO.id } });
      expect(await ligar(paraLigar.id, RASTREIO.COM_OUTRA_CHAVE)).toMatchObject({ status: 409, corpo: { error: "A carga tem outra chave de NF-e: esta nota não é dela." } });
      expect(await ligar(paraLigar.id, RASTREIO.COM_A_CHAVE)).toMatchObject({ status: 409 });
      expect((await banco.sistema.fiscalDocument.findUniqueOrThrow({ where: { id: paraLigar.id } })).collectionId).toBeNull();

      const daCarga = await banco.sistema.fiscalDocument.findFirstOrThrow({ where: { accessKey: chaveDe(N.DA_CARGA_COM_A_CHAVE), tenantId: EMPRESA_PADRAO.id } });
      // O código pode vir como o operador cola: com espaço e ponto.
      const { status, corpo } = await ligar(daCarga.id, ` ${RASTREIO.COM_A_CHAVE.slice(0, 4)}.${RASTREIO.COM_A_CHAVE.slice(4)} `);
      expect(status).toBe(200);
      expect(corpo.nota.collection).toMatchObject({ id: cargas.COM_A_CHAVE, trackingCode: RASTREIO.COM_A_CHAVE });
      expect(await ligar(daCarga.id, RASTREIO.COM_A_CHAVE)).toMatchObject({ status: 409, corpo: { error: "Esta nota já está ligada a uma carga." } });
    });

    it("carga sem chave que ainda pode ser editada recebe a chave da nota; a que já embarcou recebe só o anexo", async () => {
      entrarComo("OPERATION");
      const editavel = await nova(N.PARA_CARGA_SEM_CHAVE);
      expect((await ligar(editavel.nota.id, RASTREIO.SEM_CHAVE)).status).toBe(200);
      expect(await banco.sistema.collection.findUniqueOrThrow({ where: { id: cargas.SEM_CHAVE } })).toMatchObject({ invoiceKey: chaveDe(N.PARA_CARGA_SEM_CHAVE), status: "COLLECTED", invoiceValue: null });

      const embarcada = await nova(N.PARA_CARGA_EM_ROTA);
      expect((await ligar(embarcada.nota.id, RASTREIO.EM_ROTA)).status).toBe(200);
      expect((await banco.sistema.collection.findUniqueOrThrow({ where: { id: cargas.EM_ROTA } })).invoiceKey).toBeNull();
      expect((await banco.sistema.fiscalDocument.findUniqueOrThrow({ where: { id: embarcada.nota.id } })).collectionId).toBe(cargas.EM_ROTA);

      // A carga que ganhou a chave passa a recusar outra nota.
      const outra = await banco.sistema.fiscalDocument.findFirstOrThrow({ where: { accessKey: chaveDe(N.PARA_LIGAR), tenantId: EMPRESA_PADRAO.id } });
      expect((await ligar(outra.id, RASTREIO.SEM_CHAVE)).status).toBe(409);
    });
  });

  describe("consultar", () => {
    it("lista da mais nova para a mais antiga, com a carga ligada e sem o XML", async () => {
      entrarComo("OPERATION");
      const { status, corpo } = await listar();
      expect(status).toBe(200);
      const minhas = corpo.filter((nota) => [CNPJ_EMITENTE, CNPJ_DESTINATARIO].includes(nota.issuerTaxId));
      expect(minhas.map((nota) => nota.number)).toEqual([N.PARA_CARGA_EM_ROTA, N.PARA_CARGA_SEM_CHAVE, N.PARA_LIGAR, N.SOLTA, N.DA_CARGA_COM_A_CHAVE, N.SEM_CLIENTE, N.SEM_VOLUMES, N.PRINCIPAL]);
      for (const nota of minhas) expect(nota).not.toHaveProperty("xml");
      expect(minhas.find((nota) => nota.number === N.DA_CARGA_COM_A_CHAVE)?.collection).toMatchObject({ trackingCode: RASTREIO.COM_A_CHAVE });
      expect(minhas.find((nota) => nota.number === N.PARA_LIGAR)?.collection).toBeNull();
    });

    it("busca por chave, número, CNPJ (com ou sem máscara) e razão social", async () => {
      entrarComo("ADMIN");
      const numeros = async (busca: string) => (await listar(busca)).corpo.map((nota) => nota.number).sort();

      expect(await numeros(chaveDe(N.PARA_LIGAR))).toEqual([N.PARA_LIGAR]);
      expect(await numeros(chaveDe(N.PARA_LIGAR).replace(/(\d{4})/g, "$1 "))).toEqual([N.PARA_LIGAR]);
      expect(await numeros(String(N.SOLTA))).toEqual([N.SOLTA]);
      // Só a nota emitida por este CNPJ; nas outras ele é o destinatário.
      expect((await listar("99.444.333/0002-62")).corpo.filter((nota) => nota.issuerTaxId === CNPJ_DESTINATARIO).map((nota) => nota.number)).toEqual([N.SEM_CLIENTE]);
      expect(await numeros("12345678909")).toEqual([N.SEM_CLIENTE]);
      expect((await numeros("fábrica de TINTAS rio preto")).length).toBe(8);
      expect(await numeros("não existe nota assim")).toEqual([]);
    });

    it("abre uma nota com a sugestão e baixa o XML original, como anexo", async () => {
      entrarComo("OPERATION");
      const solta = await banco.sistema.fiscalDocument.findFirstOrThrow({ where: { accessKey: chaveDe(N.PARA_LIGAR), tenantId: EMPRESA_PADRAO.id } });
      const { status, corpo } = await abrir(solta.id);
      expect(status).toBe(200);
      expect(corpo.nota).toMatchObject({ id: solta.id, number: N.PARA_LIGAR, collection: null });
      expect(corpo.sugestao).toMatchObject({ clientId: clienteEmitente, invoiceKey: chaveDe(N.PARA_LIGAR) });
      expect((await abrir(SEM_ID)).status).toBe(404);

      const res = await xmlDaNota.GET(req(), ctx(solta.id));
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("application/xml; charset=utf-8");
      expect(res.headers.get("Content-Disposition")).toBe(`attachment; filename="${chaveDe(N.PARA_LIGAR)}-nfe.xml"`);
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
      expect(await res.text()).toBe(xmlNfe({ numero: N.PARA_LIGAR }));
      expect((await xmlDaNota.GET(req(), ctx(SEM_ID))).status).toBe(404);
    });
  });

  describe("CT-e: sem emissão, só o registro manual", () => {
    const chaveCte = chaveDe(501, { modelo: "57", cnpj: CNPJ_TERCEIRO });

    it("lista só as cargas em rota ou entregues, com os dados do CT-e e todas como não emitidas", async () => {
      entrarComo("OPERATION");
      const { status, corpo } = await responder<CargaParaCte[]>(await cte.GET());
      expect(status).toBe(200);
      const minhas = corpo.filter((c) => Object.values(RASTREIO).includes(c.trackingCode ?? ""));
      expect(minhas.map((c) => c.trackingCode).sort()).toEqual([RASTREIO.EM_ROTA, RASTREIO.ENTREGUE]);
      expect(minhas.every((c) => !cteRegistrado(c))).toBe(true);
      expect(minhas.find((c) => c.id === cargas.EM_ROTA)).toMatchObject({ sender: "Remetente", destination: "Mirassol - SP", volumes: 3, weight: 42.5, invoiceValue: 800, freightValue: 120, cteKey: null, cteNumber: null, client: { cnpj: CNPJ_EMITENTE } });
    });

    it("valida o registro e recusa carga que não existe, que não saiu ou de outra empresa", async () => {
      entrarComo("OPERATION");
      expect((await registrarCte({})).status).toBe(400);
      expect(await registrarCte({ collectionId: cargas.EM_ROTA, cteNumber: 501, cteKey: chaveDe(501) })).toMatchObject({ status: 400, corpo: { error: "Esta chave não é de CT-e (modelo 57). Confira se não é a chave da NF-e." } });
      expect((await registrarCte({ collectionId: cargas.EM_ROTA, cteNumber: 501, cteKey: "" })).status).toBe(400);
      const bom = { cteNumber: 501, cteKey: chaveCte };
      expect(await registrarCte({ collectionId: SEM_ID, ...bom })).toMatchObject({ status: 404, corpo: { error: "Carga não encontrada." } });
      expect(await registrarCte({ collectionId: cargas.DA_OUTRA, ...bom })).toMatchObject({ status: 404 });
      expect(await registrarCte({ collectionId: cargas.SEM_CHAVE, ...bom })).toMatchObject({ status: 409, corpo: { error: "Só carga alocada numa viagem, em rota ou entregue recebe o registro de CT-e." } });
      expect(await banco.sistema.collection.count({ where: { cteKey: chaveCte } })).toBe(0);
    });

    it("registra o número e a chave de um CT-e emitido fora, recusa a mesma chave em outra carga e desfaz o registro", async () => {
      entrarComo("OPERATION");
      const { status, corpo } = await registrarCte({ collectionId: cargas.EM_ROTA, cteNumber: "501", cteKey: chaveCte.replace(/(\d{4})/g, "$1 ") });
      expect(status).toBe(200);
      expect(corpo).toMatchObject({ id: cargas.EM_ROTA, cteNumber: 501, cteKey: chaveCte, cteStatus: "ISSUED", status: "ROUTE" });
      expect(cteRegistrado(corpo)).toBe(true);

      expect(await registrarCte({ collectionId: cargas.ENTREGUE, cteNumber: 501, cteKey: chaveCte })).toMatchObject({ status: 409, corpo: { error: "Esta chave de CT-e já está registrada em outra carga." } });
      expect((await banco.sistema.collection.findUniqueOrThrow({ where: { id: cargas.ENTREGUE } })).cteKey).toBeNull();

      const desfeito = await registrarCte({ collectionId: cargas.EM_ROTA, cteNumber: "", cteKey: "" });
      expect(desfeito).toMatchObject({ status: 200, corpo: { cteNumber: null, cteKey: null, cteStatus: "PENDING" } });
    });
  });

  describe("portal do cliente", () => {
    const comoCliente = (id: string) => sessao.mockResolvedValue({ user: { id, role: "CLIENT", clientId: null } });
    const baixar = (coletaId: string, notaId: string) => portalNota.GET(req(), { params: Promise.resolve({ id: coletaId, notaId }) });

    it("o cliente vê as notas da carga dele e baixa o XML; outro cliente e a equipe não", async () => {
      const nota = await banco.sistema.fiscalDocument.findFirstOrThrow({ where: { accessKey: chaveDe(N.DA_CARGA_COM_A_CHAVE), tenantId: EMPRESA_PADRAO.id } });

      comoCliente(ids.CLIENT);
      const detalhe = await responder<{ fiscalDocuments: Record<string, unknown>[] }>(await portalColeta.GET(req(), ctx(cargas.COM_A_CHAVE)));
      expect(detalhe.status).toBe(200);
      expect(detalhe.corpo.fiscalDocuments).toEqual([{ id: nota.id, number: N.DA_CARGA_COM_A_CHAVE, series: 1, accessKey: chaveDe(N.DA_CARGA_COM_A_CHAVE) }]);

      const res = await baixar(cargas.COM_A_CHAVE, nota.id);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Disposition")).toBe(`attachment; filename="${chaveDe(N.DA_CARGA_COM_A_CHAVE)}-nfe.xml"`);
      expect(await res.text()).toBe(xmlNfe({ numero: N.DA_CARGA_COM_A_CHAVE }));

      // Nota de outra carga pelo caminho desta, nota sem carga e id que não existe: tudo 404.
      const solta = await banco.sistema.fiscalDocument.findFirstOrThrow({ where: { accessKey: chaveDe(N.PARA_LIGAR), tenantId: EMPRESA_PADRAO.id } });
      expect((await baixar(cargas.SEM_CHAVE, nota.id)).status).toBe(404);
      expect((await baixar(cargas.COM_A_CHAVE, solta.id)).status).toBe(404);
      expect((await baixar(cargas.COM_A_CHAVE, SEM_ID)).status).toBe(404);

      comoCliente(usuarioDeOutroCliente);
      expect((await baixar(cargas.COM_A_CHAVE, nota.id)).status).toBe(404);

      for (const quem of ["ADMIN", "OPERATION", "DRIVER", null] as const) {
        entrarComo(quem);
        expect((await baixar(cargas.COM_A_CHAVE, nota.id)).status, String(quem)).toBe(401);
      }
    });
  });

  describe("isolamento entre empresas", () => {
    it("a outra empresa não vê, não baixa e não usa as notas desta, e pode importar a mesma nota para si", async () => {
      entrarNaOutra();
      const principal = await banco.sistema.fiscalDocument.findFirstOrThrow({ where: { accessKey: chaveDe(N.PRINCIPAL), tenantId: EMPRESA_PADRAO.id } });
      const solta = await banco.sistema.fiscalDocument.findFirstOrThrow({ where: { accessKey: chaveDe(N.PARA_LIGAR), tenantId: EMPRESA_PADRAO.id } });

      expect((await listar()).corpo.filter((nota) => nota.issuerTaxId === CNPJ_EMITENTE)).toEqual([]);
      expect((await listar(chaveDe(N.PRINCIPAL))).corpo).toEqual([]);
      expect((await abrir(principal.id)).status).toBe(404);
      expect((await xmlDaNota.GET(req(), ctx(principal.id))).status).toBe(404);
      expect((await criarCarga(solta.id, { clientId: SEM_ID, sender: "a", receiver: "b", origin: "c", destination: "d", volumes: 1, weight: 1 })).status).toBe(404);
      expect((await ligar(solta.id, RASTREIO.DA_OUTRA)).status).toBe(404);
      expect((await banco.sistema.fiscalDocument.findUniqueOrThrow({ where: { id: solta.id } })).collectionId).toBeNull();

      // A chave é única por empresa, não no sistema: a outra transportadora importa a mesma nota.
      const { status, corpo } = await importar(xmlNfe({ numero: N.DA_OUTRA_EMPRESA }));
      expect(status).toBe(201);
      const gravada = await banco.sistema.fiscalDocument.findUniqueOrThrow({ where: { id: corpo.nota.id } });
      expect(gravada.tenantId).toBe(EMPRESA_OUTRA.id);
      // O cliente sugerido é o cadastro dela, não o desta empresa com o mesmo CNPJ.
      expect(corpo.sugestao?.clientId).not.toBe(clienteEmitente);
      expect(corpo.sugestao?.clientId).toEqual(expect.any(String));
      expect((await listar()).corpo.map((nota) => nota.number)).toEqual([N.DA_OUTRA_EMPRESA]);
    });

    it("esta empresa não alcança a nota nem a carga da outra", async () => {
      entrarComo("ADMIN");
      const deLa = await banco.sistema.fiscalDocument.findFirstOrThrow({ where: { accessKey: chaveDe(N.DA_OUTRA_EMPRESA), tenantId: EMPRESA_OUTRA.id } });
      expect((await listar(chaveDe(N.DA_OUTRA_EMPRESA))).corpo).toEqual([]);
      expect((await abrir(deLa.id)).status).toBe(404);
      expect((await xmlDaNota.GET(req(), ctx(deLa.id))).status).toBe(404);
      expect((await ligar(deLa.id, RASTREIO.SEM_CHAVE)).status).toBe(404);
      // Esta empresa pode importar a mesma nota: são duas linhas, uma de cada empresa.
      expect((await importar(xmlNfe({ numero: N.DA_OUTRA_EMPRESA }))).status).toBe(201);
      expect(await banco.sistema.fiscalDocument.count({ where: { accessKey: chaveDe(N.DA_OUTRA_EMPRESA) } })).toBe(2);
    });

    it("o banco recusa nota apontando para carga de outra empresa", async () => {
      const solta = await banco.sistema.fiscalDocument.findFirstOrThrow({ where: { accessKey: chaveDe(N.PARA_LIGAR), tenantId: EMPRESA_PADRAO.id } });
      const tentativa = banco.default.fiscalDocument.updateMany({ where: { id: solta.id }, data: { collectionId: cargas.DA_OUTRA } });
      await expect(tentativa).rejects.toThrow();
      expect((await banco.sistema.fiscalDocument.findUniqueOrThrow({ where: { id: solta.id } })).collectionId).toBeNull();
    });
  });
});
