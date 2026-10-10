import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getServerSession } from "next-auth";
import {
  CERTIFICADO_ILEGIVEL,
  CNPJ_COM_OUTRO_CERTIFICADO,
  EMISSAO_EM_ANDAMENTO,
  EMITIDO_PELO_SISTEMA,
  FISCAL_INDISPONIVEL,
  FORA_DO_PRAZO,
  JA_AUTORIZADO,
  JA_REGISTRADO_DE_FORA,
  MUNICIPIO_DESCONHECIDO,
  PRODUCAO_PEDE_CONFIRMACAO,
  SEM_DADOS_FISCAIS,
  SEM_EMITENTE_CADASTRADO,
  SO_AUTORIZADO_CANCELA,
  SO_AUTORIZADO_TEM_XML,
  SO_CARGA_QUE_SAIU,
  type ConferenciaDoCte,
  type CteEmitido,
  type FiscalDaEmpresa,
  type ResultadoDaEmissao,
  type SituacaoDaEmissao,
  type StatusDoServico,
} from "../src/lib/cte";
import { assinaturaConfere } from "../src/lib/cte/assinar";
import { DE_OUTRO_CNPJ, SENHA_ERRADA, VENCIDO } from "../src/lib/cte/certificado";
import { lerChaveDoCte } from "../src/lib/cte/chave";
import { usarSefazDeTeste } from "../src/lib/cte/sefaz";
import { BLOQUEIO_DA_REDUCAO_NA_INTERESTADUAL } from "../src/lib/cte/montar";
import { chaveDeExemplo } from "./mdfe-apoio";
import { chaveValida, type CargaParaCte } from "../src/lib/nfe";
import { EMPRESA_OUTRA, EMPRESA_PADRAO } from "./empresas-de-teste";
import { REMETENTE, certificadoDeTeste, chaveDeNfe, errosNoEsquema, impressaoDigital, nfeDeExemplo, subirSefazDeMentira, type CertificadoDeTeste, type SefazDeMentira } from "./cte-apoio";

/**
 * Emissão de CT-e, com banco: os dados fiscais e o certificado da empresa, a
 * numeração, e o caminho inteiro de cada CT-e (conferir, emitir, cancelar,
 * baixar o XML), pelas rotas.
 *
 * NENHUM teste fala com a SEFAZ: as rotas conversam com o servidor HTTPS local
 * de tests/cte-apoio.ts (`usarSefazDeTeste`), e o certificado é autoassinado.
 */
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

const temBanco = Boolean(process.env.DATABASE_URL);
if (!temBanco) {
  console.warn("\n[cte-rotas.test] DATABASE_URL ausente: testes de integração PULADOS.\n");
}
const suite = temBanco ? describe : describe.skip;

const PREFIXO = "teste-cte-";
const HASH_FALSO = "$2b$10$hashfalsoparateste000000000000000000000000000000000";
const SEM_ID = "00000000-0000-0000-0000-000000000000";
const CNPJ_DA_PADRAO = "11222333000181";
const CNPJ_DA_OUTRA = "99888777000100";
// O cliente pagador é o emitente das NF-e de exemplo: vira o tomador remetente.
const CNPJ_DO_CLIENTE = REMETENTE.documento;
const SENHA = "senha-secreta-do-certificado-QWERTY";

type Perfil = "ADMIN" | "DIRECTOR" | "OPERATION" | "FINANCE" | "EXPEDITION" | "COMMERCIAL" | "CLIENTE" | "ADMIN_DA_OUTRA";
type Corpo = Record<string, unknown> & { error?: string };

const FORMULARIO = {
  cnpj: "11.222.333/0001-81",
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

suite("rotas da emissão de CT-e", () => {
  let banco: typeof import("../src/lib/prisma");
  let fiscalRota: typeof import("../src/app/api/empresa/fiscal/route");
  let certificadoRota: typeof import("../src/app/api/empresa/fiscal/certificado/route");
  let listaRota: typeof import("../src/app/api/fiscal/cte/route");
  let emissaoRota: typeof import("../src/app/api/fiscal/cte/emissao/route");
  let xmlRota: typeof import("../src/app/api/fiscal/cte/emissao/[id]/xml/route");
  let cancelarRota: typeof import("../src/app/api/fiscal/cte/emissao/[id]/cancelar/route");
  let statusRota: typeof import("../src/app/api/fiscal/cte/status-servico/route");
  let situacaoRota: typeof import("../src/app/api/fiscal/cte/situacao/route");
  let dacteRota: typeof import("../src/app/api/fiscal/cte/emissao/[id]/dacte/route");
  let eventos: typeof import("../src/lib/eventos");

  const sessao = vi.mocked(getServerSession);
  const ids = {} as Record<Perfil, string>;
  let clienteId: string;
  let clienteDaOutra: string;
  let sefaz: SefazDeMentira;
  let certificado: CertificadoDeTeste;
  let n8n: Server;
  let enderecoDoN8n: string;
  let recebidosNoN8n: { tipo: string; dados: Record<string, Record<string, unknown> | null> }[] = [];
  /** Só os avisos de CT-e: outros gatilhos do banco (troca de status de carga) também escrevem na fila. */
  const avisosDeCteNoN8n = () => recebidosNoN8n.filter((recebido) => recebido.tipo.startsWith("cte."));
  let sequencia = 0;
  let enderecoDoFiscal: string;
  let fiscalDizAutorizado = true;
  const pedidosAoFiscal: { ferramenta: string; xml: string }[] = [];

  // Tudo o que as rotas responderam e o que foi para o log: é aqui que se procura vazamento.
  const respostas: string[] = [];
  const logs: string[] = [];

  const DAS_EMPRESAS = { tenantId: { in: [EMPRESA_PADRAO.id, EMPRESA_OUTRA.id] } };

  const entrarComo = (perfil: Perfil | null) =>
    sessao.mockResolvedValue(
      perfil
        ? { user: { id: ids[perfil], role: perfil === "CLIENTE" ? "CLIENT" : perfil === "ADMIN_DA_OUTRA" ? "ADMIN" : perfil, clientId: null, ...(perfil === "ADMIN_DA_OUTRA" && { tenantId: EMPRESA_OUTRA.id }) } }
        : null,
    );

  const req = (method = "GET", body?: unknown, url = "http://localhost/api/teste") =>
    new Request(url, { method, headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.9" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

  async function lida<T = Corpo>(res: Response): Promise<{ status: number; corpo: T }> {
    const texto = await res.text();
    respostas.push(texto);
    return { status: res.status, corpo: JSON.parse(texto) as T };
  }

  const salvarDados = async (trocas: Record<string, unknown> = {}, perfil: Perfil = "ADMIN") => {
    entrarComo(perfil);
    return lida<FiscalDaEmpresa & Corpo>(await fiscalRota.PUT(req("PUT", { ...FORMULARIO, ...trocas })));
  };
  const enviarCertificado = async (cert: CertificadoDeTeste = certificado, perfil: Perfil = "ADMIN", senha = cert.senha) => {
    entrarComo(perfil);
    return lida<FiscalDaEmpresa & Corpo>(await certificadoRota.PUT(req("PUT", { arquivo: cert.pfx.toString("base64"), senha })));
  };
  /** A empresa padrão pronta para emitir: dados fiscais e certificado. */
  const prepararEmpresa = async (trocas: Record<string, unknown> = {}) => {
    expect((await salvarDados(trocas)).status).toBe(200);
    expect((await enviarCertificado()).status).toBe(200);
  };

  const conferir = async (collectionId: string, perfil: Perfil = "OPERATION") => {
    entrarComo(perfil);
    return lida<ConferenciaDoCte & Corpo>(await emissaoRota.GET(req("GET", undefined, `http://localhost/api/fiscal/cte/emissao?collectionId=${collectionId}`)));
  };
  const emitir = async (collectionId: string, perfil: Perfil = "OPERATION") => {
    entrarComo(perfil);
    return lida<ResultadoDaEmissao & Corpo>(await emissaoRota.POST(req("POST", { collectionId })));
  };
  const cancelar = async (cteId: string, justificativa = "Carga recusada pelo destinatário na entrega", perfil: Perfil = "OPERATION") => {
    entrarComo(perfil);
    return lida<CteEmitido & Corpo>(await cancelarRota.POST(req("POST", { justificativa }), ctx(cteId)));
  };

  /** Uma carga em rota, com a NF-e dela importada e ligada. Cada uma tem a sua nota. */
  async function novaCarga(trocas: { status?: string; semNota?: boolean; freightValue?: number | null; outra?: boolean } = {}) {
    const numero = 5000 + (sequencia += 1);
    const db = trocas.outra ? banco.paraEmpresa(EMPRESA_OUTRA.id).db : banco.default;
    const carga = await db.collection.create({
      data: {
        clientId: trocas.outra ? clienteDaOutra : clienteId,
        sender: "Indústria Remetente S/A",
        receiver: "Comércio Destinatário Ltda",
        origin: "São José do Rio Preto - SP",
        destination: "Belo Horizonte - MG",
        volumes: 12,
        weight: 1250.5,
        invoiceKey: trocas.semNota ? null : chaveDeNfe(numero),
        invoiceValue: 32500.9,
        freightValue: trocas.freightValue === undefined ? 850.5 : trocas.freightValue,
        status: trocas.status ?? "ROUTE",
        trackingCode: `97${String(Date.now() % 1_000_000).padStart(6, "0")}${String(numero % 100).padStart(2, "0")}`,
      },
      select: { id: true, trackingCode: true },
    });
    if (!trocas.semNota) {
      await db.fiscalDocument.create({
        data: { accessKey: chaveDeNfe(numero), number: numero, series: 1, issuerTaxId: REMETENTE.documento, issuerName: "Indústria Remetente S/A", totalValue: 32500.9, xml: nfeDeExemplo({ numero }), collectionId: carga.id },
        select: { id: true },
      });
    }
    return carga;
  }

  const cteDe = (collectionId: string) => banco.sistema.cte.findMany({ where: { collectionId }, orderBy: { createdAt: "asc" } });
  const cargaDoBanco = (id: string) => banco.sistema.collection.findUniqueOrThrow({ where: { id }, select: { cteKey: true, cteNumber: true, cteStatus: true } });
  const trilha = (acao: string) => banco.sistema.auditLog.findMany({ where: { ...DAS_EMPRESAS, action: acao, userName: { startsWith: PREFIXO } }, orderBy: { createdAt: "asc" } });
  const avisosDe = (perfil: Perfil, tipo: string) => banco.sistema.notification.findMany({ where: { userId: ids[perfil], type: tipo } });
  const numeracao = async (ambiente = "HOMOLOGACAO", serie = 1) =>
    (await banco.sistema.cteNumbering.findFirst({ where: { tenantId: EMPRESA_PADRAO.id, environment: ambiente, series: serie }, select: { nextNumber: true } }))?.nextNumber ?? null;

  async function limparMovimento() {
    const { sistema } = banco;
    await sistema.outboxEvent.deleteMany({ where: DAS_EMPRESAS });
    await sistema.webhook.deleteMany({ where: DAS_EMPRESAS });
    await sistema.cte.deleteMany({ where: DAS_EMPRESAS });
    await sistema.cteNumbering.deleteMany({ where: DAS_EMPRESAS });
    await sistema.fiscalIssuer.deleteMany({ where: DAS_EMPRESAS });
    await sistema.fiscalDocument.deleteMany({ where: { ...DAS_EMPRESAS, issuerTaxId: REMETENTE.documento, issuerName: "Indústria Remetente S/A" } });
    await sistema.collection.deleteMany({ where: { client: { companyName: { startsWith: PREFIXO } } } });
    await sistema.notification.deleteMany({ where: { user: { email: { startsWith: PREFIXO } } } });
    await sistema.auditLog.deleteMany({ where: { ...DAS_EMPRESAS, userName: { startsWith: PREFIXO } } });
  }

  async function limpar() {
    await limparMovimento();
    await banco.sistema.user.deleteMany({ where: { email: { startsWith: PREFIXO } } });
    await banco.sistema.client.deleteMany({ where: { companyName: { startsWith: PREFIXO } } });
  }

  const anteriores = { chave: process.env.TMS_CHAVE_DE_DADOS, url: process.env.NEXTAUTH_URL, local: process.env.TMS_WEBHOOK_PERMITE_LOCAL, fiscal: process.env.FISCAL_MCP_URL };
  const restaurar = (nome: string, valor: string | undefined) => {
    if (valor === undefined) delete process.env[nome];
    else process.env[nome] = valor;
  };

  beforeAll(async () => {
    sefaz = await subirSefazDeMentira();
    usarSefazDeTeste({ url: sefaz.url, autoridades: sefaz.autoridades, tempoLimiteMs: 1500 });
    certificado = certificadoDeTeste({ cnpj: CNPJ_DA_PADRAO, senha: SENHA });

    // O mesmo servidor local faz de n8n (/n8n) e de serviço fiscal (/mcp, só o bastante para `gerar_dacte`).
    n8n = createServer((pedido, resposta) => {
      let corpo = "";
      pedido.on("data", (pedaco) => (corpo += pedaco));
      pedido.on("end", () => {
        if (pedido.url === "/n8n") {
          recebidosNoN8n.push(JSON.parse(corpo));
          resposta.writeHead(200, { "Content-Type": "application/json" }).end("{}");
          return;
        }
        if (pedido.method === "DELETE") return void resposta.writeHead(204).end();
        const rpc = JSON.parse(corpo) as { id?: number; method: string; params?: { name?: string; arguments?: { xml_content?: string } } };
        if (rpc.method === "initialize") return void resposta.writeHead(200, { "Content-Type": "application/json", "mcp-session-id": "sessao-de-teste" }).end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: {} }));
        if (rpc.method !== "tools/call") return void resposta.writeHead(202).end();
        pedidosAoFiscal.push({ ferramenta: rpc.params?.name ?? "", xml: rpc.params?.arguments?.xml_content ?? "" });
        const estruturado = { pdf_base64: Buffer.from("%PDF-1.4 dacte de mentira").toString("base64"), autorizado: fiscalDizAutorizado };
        resposta.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: { structuredContent: estruturado, content: [] } }));
      });
    });
    await new Promise<void>((resolve) => n8n.listen(0, "127.0.0.1", resolve));
    enderecoDoN8n = `http://127.0.0.1:${(n8n.address() as AddressInfo).port}/n8n`;
    enderecoDoFiscal = `http://127.0.0.1:${(n8n.address() as AddressInfo).port}/mcp`;
    delete process.env.FISCAL_MCP_URL;

    process.env.TMS_CHAVE_DE_DADOS = "chave-de-dados-dos-testes-do-cte-0123456789-abcdef";
    process.env.NEXTAUTH_URL = "https://tms.exemplo.br";
    process.env.TMS_WEBHOOK_PERMITE_LOCAL = "1";
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => void logs.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : typeof a === "string" ? a : JSON.stringify(a))).join(" ")));

    banco = await import("../src/lib/prisma");
    fiscalRota = await import("../src/app/api/empresa/fiscal/route");
    certificadoRota = await import("../src/app/api/empresa/fiscal/certificado/route");
    listaRota = await import("../src/app/api/fiscal/cte/route");
    emissaoRota = await import("../src/app/api/fiscal/cte/emissao/route");
    xmlRota = await import("../src/app/api/fiscal/cte/emissao/[id]/xml/route");
    cancelarRota = await import("../src/app/api/fiscal/cte/emissao/[id]/cancelar/route");
    statusRota = await import("../src/app/api/fiscal/cte/status-servico/route");
    situacaoRota = await import("../src/app/api/fiscal/cte/situacao/route");
    dacteRota = await import("../src/app/api/fiscal/cte/emissao/[id]/dacte/route");
    eventos = await import("../src/lib/eventos");
    await limpar();

    const outra = banco.paraEmpresa(EMPRESA_OUTRA.id).db;
    clienteId = (await banco.default.client.create({ data: { companyName: `${PREFIXO}Indústria Remetente S/A`, cnpj: CNPJ_DO_CLIENTE, ie: "110042490114" } })).id;
    clienteDaOutra = (await outra.client.create({ data: { companyName: `${PREFIXO}Cliente da outra`, cnpj: CNPJ_DO_CLIENTE, ie: "110042490114" } })).id;
    for (const perfil of ["ADMIN", "DIRECTOR", "OPERATION", "FINANCE", "EXPEDITION", "COMMERCIAL"] as const) {
      ids[perfil] = (await banco.default.user.create({ data: { name: `${PREFIXO}${perfil}`, email: `${PREFIXO}${perfil.toLowerCase()}@exemplo.br`, password: HASH_FALSO, role: perfil } })).id;
    }
    ids.CLIENTE = (await banco.default.user.create({ data: { name: `${PREFIXO}cliente`, email: `${PREFIXO}cliente@exemplo.br`, password: HASH_FALSO, role: "CLIENT", clientId: clienteId } })).id;
    ids.ADMIN_DA_OUTRA = (await outra.user.create({ data: { name: `${PREFIXO}admin-da-outra`, email: `${PREFIXO}admin-da-outra@exemplo.br`, password: HASH_FALSO, role: "ADMIN" } })).id;
  }, 180_000);

  beforeEach(async () => {
    sessao.mockReset();
    sefaz.modo = "autorizar";
    sefaz.atrasoMs = 0;
    sefaz.consultasCegas = 0;
    sefaz.chamadas.length = 0;
    recebidosNoN8n = [];
    await limparMovimento();
  });

  afterAll(async () => {
    usarSefazDeTeste(null);
    if (banco) await limpar();
    restaurar("TMS_CHAVE_DE_DADOS", anteriores.chave);
    restaurar("NEXTAUTH_URL", anteriores.url);
    restaurar("TMS_WEBHOOK_PERMITE_LOCAL", anteriores.local);
    restaurar("FISCAL_MCP_URL", anteriores.fiscal);
    vi.restoreAllMocks();
    await sefaz.fechar();
    await new Promise<void>((resolve) => n8n.close(() => resolve()));
  });

  /* -------------------------------- Permissão -------------------------------- */

  describe("permissão", () => {
    it("dados fiscais e certificado são só do administrador: sem sessão 401; os outros perfis, 403", async () => {
      const chamadas: [string, () => Promise<Response>][] = [
        ["GET fiscal", () => fiscalRota.GET()],
        ["PUT fiscal", () => fiscalRota.PUT(req("PUT", FORMULARIO))],
        ["PUT certificado", () => certificadoRota.PUT(req("PUT", { arquivo: certificado.pfx.toString("base64"), senha: SENHA }))],
        ["DELETE certificado", () => certificadoRota.DELETE(req("DELETE"))],
      ];
      for (const [nome, chamar] of chamadas) {
        entrarComo(null);
        expect((await chamar()).status, `${nome} sem sessão`).toBe(401);
        for (const perfil of ["DIRECTOR", "OPERATION", "FINANCE", "EXPEDITION", "COMMERCIAL", "CLIENTE"] as const) {
          entrarComo(perfil);
          expect((await chamar()).status, `${nome} ${perfil}`).toBe(403);
        }
      }
      expect(await banco.sistema.fiscalIssuer.count({ where: DAS_EMPRESAS })).toBe(0);
    });

    it("ler é de quem lê o fiscal; emitir e cancelar, de quem escreve no fiscal", async () => {
      await prepararEmpresa();
      const carga = await novaCarga();
      const leitura: [string, () => Promise<Response>][] = [
        ["conferir", () => emissaoRota.GET(req("GET", undefined, `http://localhost/x?collectionId=${carga.id}`))],
        ["xml", () => xmlRota.GET(req(), ctx(SEM_ID))],
        ["status", () => statusRota.GET()],
        ["situação", () => situacaoRota.GET()],
      ];
      const escrita: [string, () => Promise<Response>][] = [
        ["emitir", () => emissaoRota.POST(req("POST", { collectionId: carga.id }))],
        ["cancelar", () => cancelarRota.POST(req("POST", { justificativa: "Carga recusada pelo destinatário" }), ctx(SEM_ID))],
      ];
      for (const [nome, chamar] of [...leitura, ...escrita]) {
        entrarComo(null);
        expect((await chamar()).status, `${nome} sem sessão`).toBe(401);
        for (const perfil of ["COMMERCIAL", "CLIENTE"] as const) {
          entrarComo(perfil);
          expect((await chamar()).status, `${nome} ${perfil}`).toBe(403);
        }
      }
      // Financeiro e expedição leem, mas não emitem nem cancelam.
      for (const perfil of ["FINANCE", "EXPEDITION"] as const) {
        entrarComo(perfil);
        for (const [nome, chamar] of leitura) expect([200, 404], `${nome} ${perfil}`).toContain((await chamar()).status);
        for (const [nome, chamar] of escrita) expect((await chamar()).status, `${nome} ${perfil}`).toBe(403);
      }
      expect(await cteDe(carga.id)).toHaveLength(0);
      expect(sefaz.chamadas.filter((c) => c.servico !== "CTeStatusServicoV4")).toHaveLength(0);
    });
  });

  /* ------------------------------ Dados fiscais ------------------------------ */

  describe("dados fiscais do emitente", () => {
    it("valida o formulário, acha o código IBGE e guarda; a leitura devolve o que foi salvo", async () => {
      expect((await salvarDados({ cnpj: "11.222.333/0001-82" })).corpo.error).toContain("CNPJ válido");
      expect((await salvarDados({ cidade: "Cidade Que Não Existe" })).corpo.error).toBe(MUNICIPIO_DESCONHECIDO);
      // Mirassol existe em SP, não em MG.
      expect((await salvarDados({ uf: "MG" })).corpo.error).toBe(MUNICIPIO_DESCONHECIDO);
      expect(await banco.sistema.fiscalIssuer.count({ where: DAS_EMPRESAS })).toBe(0);

      const { status, corpo } = await salvarDados({ proximoNumero: "37" });
      expect(status).toBe(200);
      expect(corpo.certificado).toBeNull();
      expect(corpo.dados).toMatchObject({ cnpj: CNPJ_DA_PADRAO, ie: "123456789012", codigoMunicipio: "3530300", cidade: "Mirassol", uf: "SP", cep: "15130000", telefone: "1732421000", serie: 1, proximoNumero: 37, ambiente: "HOMOLOGACAO", icms: "00", aliquota: 12, complemento: null });
      expect(await numeracao()).toBe(37);

      entrarComo("ADMIN");
      const relida = await lida<FiscalDaEmpresa>(await fiscalRota.GET());
      expect(relida.corpo).toEqual(corpo);

      const auditoria = await trilha("empresa.fiscal");
      expect(auditoria).toHaveLength(1);
      expect(auditoria[0].summary).toBe("Dados fiscais do emitente cadastrados");
      expect(auditoria[0].after).toMatchObject({ cnpj: CNPJ_DA_PADRAO, proximoNumero: 37, environment: "HOMOLOGACAO" });
    });

    it("produção só com o CNPJ digitado de novo; voltar a homologação não pede nada", async () => {
      await salvarDados();
      expect((await salvarDados({ ambiente: "PRODUCAO" })).corpo.error).toBe(PRODUCAO_PEDE_CONFIRMACAO);
      expect((await salvarDados({ ambiente: "PRODUCAO", confirmacaoDoCnpj: "99.888.777/0001-00" })).corpo.error).toBe(PRODUCAO_PEDE_CONFIRMACAO);
      const emProducao = await salvarDados({ ambiente: "PRODUCAO", confirmacaoDoCnpj: "11.222.333/0001-81", proximoNumero: "900" });
      expect(emProducao.status).toBe(200);
      expect(emProducao.corpo.dados).toMatchObject({ ambiente: "PRODUCAO", proximoNumero: 900 });
      // Já está em produção: salvar de novo não pede a confirmação outra vez.
      expect((await salvarDados({ ambiente: "PRODUCAO", proximoNumero: "900" })).status).toBe(200);
      // Cada ambiente tem a sua numeração.
      expect(await numeracao("PRODUCAO")).toBe(900);
      expect(await numeracao("HOMOLOGACAO")).toBe(1);
      expect((await salvarDados()).corpo.dados).toMatchObject({ ambiente: "HOMOLOGACAO", proximoNumero: 1 });
    });
  });

  describe("redução da base (situação 20) na prestação interestadual", () => {
    it("o campo nasce desligado e é gravado com auditoria; desligado, a carga interestadual não emite; ligado, emite com a redução", async () => {
      await prepararEmpresa({ icms: "20", reducaoDaBase: "20" });
      entrarComo("ADMIN");
      expect((await lida<FiscalDaEmpresa>(await fiscalRota.GET())).corpo.dados).toMatchObject({ icms: "20", reducaoDaBase: 20, reducaoNaInterestadual: false });
      const carga = await novaCarga();
      const desligado = await conferir(carga.id);
      expect(desligado.corpo.pendencias).toEqual([BLOQUEIO_DA_REDUCAO_NA_INTERESTADUAL]);
      expect(await emitir(carga.id)).toMatchObject({ status: 409, corpo: { error: BLOQUEIO_DA_REDUCAO_NA_INTERESTADUAL } });
      expect(await banco.sistema.cte.count({ where: DAS_EMPRESAS })).toBe(0);
      expect(sefaz.chamadas).toHaveLength(0);

      const salvo = await salvarDados({ icms: "20", reducaoDaBase: "20", reducaoNaInterestadual: true });
      expect(salvo.corpo.dados).toMatchObject({ reducaoNaInterestadual: true });
      expect((await trilha("empresa.fiscal")).at(-1)?.after).toEqual({ icmsReductionInterstate: true });
      const ligado = await conferir(carga.id);
      expect(ligado.corpo.pendencias).toEqual([]);
      expect(ligado.corpo.resumo?.icms).toMatchObject({ situacao: "20", grupo: "ICMS20", base: 680.4, aliquota: 12, valor: 81.65 });
      const emitido = await emitir(carga.id);
      expect(emitido.corpo).toMatchObject({ autorizado: true });
      expect((await cteDe(carga.id))[0].xmlSent).toContain("<ICMS20><CST>20</CST><pRedBC>20.00</pRedBC><vBC>680.40</vBC><pICMS>12.00</pICMS><vICMS>81.65</vICMS></ICMS20>");

      // Fora da situação 20 o campo não fica ligado, mesmo que o formulário o mande.
      expect((await salvarDados({ icms: "00", reducaoNaInterestadual: true, proximoNumero: "2" })).corpo.dados).toMatchObject({ icms: "00", reducaoDaBase: null, reducaoNaInterestadual: false });
    });
  });

  /* -------------------------------- Certificado ------------------------------- */

  describe("certificado A1", () => {
    it("só entra depois dos dados fiscais, e só com a chave de dados do servidor", async () => {
      expect(await enviarCertificado()).toMatchObject({ status: 409, corpo: { error: SEM_DADOS_FISCAIS } });
      await salvarDados();
      const chave = process.env.TMS_CHAVE_DE_DADOS;
      delete process.env.TMS_CHAVE_DE_DADOS;
      try {
        expect(await enviarCertificado()).toMatchObject({ status: 503, corpo: { error: FISCAL_INDISPONIVEL } });
        entrarComo("ADMIN");
        expect((await lida<FiscalDaEmpresa>(await fiscalRota.GET())).corpo.disponivel).toBe(false);
      } finally {
        process.env.TMS_CHAVE_DE_DADOS = chave;
      }
    });

    it("recusa senha errada, arquivo que não é certificado, outro CNPJ, vencido, sem CNPJ e A3", async () => {
      await salvarDados();
      expect(await enviarCertificado(certificado, "ADMIN", "senha-errada")).toMatchObject({ status: 400, corpo: { error: SENHA_ERRADA } });
      entrarComo("ADMIN");
      expect((await lida(await certificadoRota.PUT(req("PUT", { arquivo: Buffer.from("não é pfx").toString("base64"), senha: "x" })))).corpo.error).toBe(SENHA_ERRADA);
      expect((await lida(await certificadoRota.PUT(req("PUT", { arquivo: "", senha: "x" })))).status).toBe(400);
      expect((await lida(await certificadoRota.PUT(req("PUT", { senha: "x" })))).status).toBe(400);

      expect((await enviarCertificado(certificadoDeTeste({ cnpj: CNPJ_DA_OUTRA }))).corpo.error).toBe(DE_OUTRO_CNPJ);
      expect((await enviarCertificado(certificadoDeTeste({ cnpj: CNPJ_DA_PADRAO, validoDe: new Date(Date.now() - 400 * 86_400_000), validoAte: new Date(Date.now() - 86_400_000) }))).corpo.error).toBe(VENCIDO);
      expect((await enviarCertificado(certificadoDeTeste({ comCnpj: false }))).corpo.error).toContain("não é um e-CNPJ");
      expect((await enviarCertificado(certificadoDeTeste({ cnpj: CNPJ_DA_PADRAO, tipo: 3 }))).corpo.error).toContain("não é do tipo A1");

      const linha = await banco.sistema.fiscalIssuer.findUniqueOrThrow({ where: { tenantId: EMPRESA_PADRAO.id } });
      expect(linha.certPfxEnc).toBeNull();
      expect(await trilha("empresa.certificado")).toHaveLength(0);
    });

    it("fica cifrado no banco e nunca volta: nem o arquivo nem a senha aparecem em resposta, auditoria ou log", async () => {
      await salvarDados();
      const arquivo = certificado.pfx.toString("base64");
      respostas.length = 0;
      logs.length = 0;
      const { status, corpo } = await enviarCertificado();
      expect(status).toBe(200);
      expect(corpo.disponivel).toBe(true);
      expect(corpo.certificado).toMatchObject({ titular: "TRANSPORTADORA DE TESTE LTDA", cnpj: CNPJ_DA_PADRAO, vencido: false, confere: "MESMO_CNPJ" });
      expect(Object.keys(corpo.certificado!).sort()).toEqual(["cnpj", "confere", "enviadoEm", "titular", "validoAte", "validoDe", "vencido"]);

      // No banco: cifrado (AES-256-GCM, com a empresa e o campo como contexto), nada em claro.
      const linha = await banco.sistema.fiscalIssuer.findUniqueOrThrow({ where: { tenantId: EMPRESA_PADRAO.id } });
      expect(linha.certPfxEnc).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
      expect(linha.certPasswordEnc).toMatch(/^v1\./);
      expect(JSON.stringify(linha)).not.toContain(arquivo.slice(0, 60));
      expect(JSON.stringify(linha)).not.toContain(SENHA);

      // Usa o certificado de verdade (emite um CT-e) e relê tudo.
      const carga = await novaCarga();
      expect((await emitir(carga.id)).corpo.autorizado).toBe(true);
      entrarComo("ADMIN");
      await lida(await fiscalRota.GET());
      entrarComo("OPERATION");
      await lida(await listaRota.GET());
      await conferir(carga.id);

      const auditoria = await banco.sistema.auditLog.findMany({ where: { ...DAS_EMPRESAS, userName: { startsWith: PREFIXO } } });
      expect(auditoria.find((a) => a.action === "empresa.certificado")).toMatchObject({ summary: "Certificado digital A1 enviado" });
      expect(JSON.stringify(auditoria.find((a) => a.action === "empresa.certificado")?.after)).toContain("TRANSPORTADORA DE TESTE LTDA (CNPJ 11222333000181), válido até");
      const cte = (await cteDe(carga.id))[0];
      const eventosDaFila = await banco.sistema.outboxEvent.findMany({ where: DAS_EMPRESAS });

      for (const [onde, texto] of [
        ["respostas", respostas.join("\n")],
        ["auditoria", JSON.stringify(auditoria)],
        ["log", logs.join("\n")],
        ["XML enviado e retorno", `${cte.xmlSent}${cte.xmlReturn}`],
        ["fila de eventos", JSON.stringify(eventosDaFila)],
      ] as const) {
        expect(texto, onde).not.toContain(SENHA);
        expect(texto, onde).not.toContain(arquivo.slice(0, 60));
        expect(texto, onde).not.toContain("PRIVATE KEY");
        expect(texto, onde).not.toContain(linha.certPfxEnc!.slice(0, 40));
      }
      // O que vai no XML é só o certificado público do emitente.
      expect(cte.xmlSent).toContain("<X509Certificate>");
    });

    it("trocar o CNPJ do emitente com certificado de outra empresa guardado é recusado; remover apaga tudo", async () => {
      await prepararEmpresa();
      expect(await salvarDados({ cnpj: CNPJ_DA_OUTRA })).toMatchObject({ status: 409, corpo: { error: CNPJ_COM_OUTRO_CERTIFICADO } });
      // Filial da mesma empresa: aceita, e a tela é avisada de que o certificado é de outro estabelecimento.
      expect((await salvarDados({ cnpj: "11.222.333/0002-62" })).corpo.certificado).toMatchObject({ confere: "MESMA_EMPRESA" });

      entrarComo("ADMIN");
      const removido = await lida<FiscalDaEmpresa>(await certificadoRota.DELETE(req("DELETE")));
      expect(removido.corpo.certificado).toBeNull();
      const linha = await banco.sistema.fiscalIssuer.findUniqueOrThrow({ where: { tenantId: EMPRESA_PADRAO.id } });
      expect([linha.certPfxEnc, linha.certPasswordEnc, linha.certSubject, linha.certTaxId, linha.certNotAfter]).toEqual([null, null, null, null, null]);
      expect((await trilha("empresa.certificado")).map((a) => a.summary)).toEqual(["Certificado digital A1 enviado", "Certificado digital A1 removido"]);
      // Sem certificado, o CNPJ pode mudar.
      expect((await salvarDados({ cnpj: CNPJ_DA_OUTRA })).status).toBe(200);
    });
  });

  /* --------------------------------- Conferir --------------------------------- */

  describe("conferir antes de emitir", () => {
    it("sem dados fiscais ou sem certificado, diz o que falta e aponta para Empresa → Fiscal", async () => {
      const carga = await novaCarga();
      const semNada = await conferir(carga.id);
      expect(semNada.status).toBe(200);
      expect(semNada.corpo).toMatchObject({ pronta: false, resumo: null, cte: null });
      expect(semNada.corpo.pendencias[0]).toBe(SEM_EMITENTE_CADASTRADO);
      expect(semNada.corpo.pendencias.join(" ")).toContain("Empresa → Fiscal");
      entrarComo("EXPEDITION");
      expect((await lida<SituacaoDaEmissao>(await situacaoRota.GET())).corpo).toEqual({ pronta: false, ambiente: null, faltas: [SEM_EMITENTE_CADASTRADO, "A empresa não tem certificado digital A1. Envie em Empresa → Fiscal."], dacte: false });
      expect(await emitir(carga.id)).toMatchObject({ status: 409 });

      await salvarDados();
      const semCertificado = await conferir(carga.id);
      expect(semCertificado.corpo.pronta).toBe(false);
      expect(semCertificado.corpo.pendencias).toEqual(["A empresa não tem certificado digital A1. Envie em Empresa → Fiscal."]);
      // O resumo já aparece: o documento está pronto, falta só o certificado.
      expect(semCertificado.corpo.resumo).toMatchObject({ numeroPrevisto: 1, cfop: "6353", valorDaPrestacao: 850.5 });
      expect(await emitir(carga.id)).toMatchObject({ status: 409, corpo: { error: "A empresa não tem certificado digital A1. Envie em Empresa → Fiscal." } });
      expect(sefaz.chamadas).toHaveLength(0);

      await enviarCertificado();
      entrarComo("EXPEDITION");
      expect((await lida<SituacaoDaEmissao>(await situacaoRota.GET())).corpo).toEqual({ pronta: true, ambiente: "HOMOLOGACAO", faltas: [], dacte: false });
    });

    it("mostra o que vai no documento, com os avisos; carga que não saiu e carga incompleta não emitem", async () => {
      await prepararEmpresa({ proximoNumero: "12" });
      const carga = await novaCarga();
      const { corpo } = await conferir(carga.id, "FINANCE");
      expect(corpo.pronta).toBe(true);
      expect(corpo.pendencias).toEqual([]);
      expect(corpo.resumo).toMatchObject({
        ambiente: "HOMOLOGACAO",
        serie: 1,
        numeroPrevisto: 12,
        cfop: "6353",
        origem: "São José do Rio Preto - SP",
        destino: "Belo Horizonte - MG",
        valorDaPrestacao: 850.5,
        valorDaCarga: 32500.9,
        icms: { situacao: "00", aliquota: 12, valor: 102.06 },
        tomador: { papel: "REMETENTE", documento: "45.543.915/0001-81", contribuinte: "1" },
        remetente: { nome: "Indústria Remetente S/A", ie: "110042490114" },
        destinatario: { nome: "Comércio Destinatário Ltda", documento: "07.526.557/0001-00" },
      });
      expect(corpo.resumo?.chavesDeNfe).toHaveLength(1);
      expect(corpo.avisos.join(" ")).toContain("Em homologação");

      const pendente = await novaCarga({ status: "PENDING" });
      expect((await conferir(pendente.id)).corpo.pendencias).toEqual([SO_CARGA_QUE_SAIU]);
      expect(await emitir(pendente.id)).toMatchObject({ status: 409, corpo: { error: SO_CARGA_QUE_SAIU } });

      // Coletada e fora de viagem: ainda não. A mensagem diz o caminho.
      const coletada = await novaCarga({ status: "COLLECTED" });
      expect((await conferir(coletada.id)).corpo.pendencias).toEqual([SO_CARGA_QUE_SAIU]);
      expect(SO_CARGA_QUE_SAIU).toContain("antes de liberar a saída");

      const semFrete = await novaCarga({ freightValue: null });
      expect((await conferir(semFrete.id)).corpo.pendencias).toEqual(["A carga está sem valor de frete: é o valor da prestação do CT-e."]);
      const semNota = await novaCarga({ semNota: true });
      expect((await conferir(semNota.id)).corpo.pendencias[0]).toContain("Sem NF-e ligada à carga");
      expect(await emitir(semNota.id)).toMatchObject({ status: 409 });

      expect((await conferir(SEM_ID)).status).toBe(404);
      entrarComo("OPERATION");
      expect((await emissaoRota.GET(req("GET", undefined, "http://localhost/x"))).status).toBe(400);
      expect((await emissaoRota.POST(req("POST", {}))).status).toBe(400);
      expect(await banco.sistema.cte.count({ where: DAS_EMPRESAS })).toBe(0);
      expect(sefaz.chamadas).toHaveLength(0);
    });
  });

  /* ---------------------------------- Emissão --------------------------------- */

  describe("emissão", () => {
    it("carga alocada numa viagem em montagem recebe CT-e ANTES da saída (Ajuste SINIEF 09/07); viagem cancelada não", async () => {
      await prepararEmpresa({ ambiente: "PRODUCAO", confirmacaoDoCnpj: CNPJ_DA_PADRAO, proximoNumero: "60" });
      const usuario = await banco.default.user.create({ data: { name: `${PREFIXO}motorista`, email: `${PREFIXO}motorista@exemplo.br`, password: HASH_FALSO, role: "DRIVER" } });
      const motorista = await banco.default.driver.create({ data: { userId: usuario.id, cpf: "52998224725", cnh: "12345678900", cnhExpiry: new Date("2030-01-01"), category: "E" } });
      const veiculo = await banco.default.vehicle.create({ data: { plate: "CTE1A23", model: "Truck de teste", type: "TRUCK", capacity: 14000 } });
      const viagem = await banco.default.manifest.create({ data: { driverId: motorista.id, vehicleId: veiculo.id, status: "ASSEMBLING" }, select: { id: true } });
      try {
        const carga = await novaCarga({ status: "COLLECTED" });
        const fora = await novaCarga({ status: "COLLECTED" });
        await banco.sistema.collection.update({ where: { id: carga.id }, data: { manifestId: viagem.id } });

        // A lista da tela de CT-e traz a carga alocada, e não a que está fora de viagem.
        entrarComo("OPERATION");
        const lista = (await lida<CargaParaCte[]>(await listaRota.GET())).corpo.map((cada) => cada.id);
        expect(lista).toContain(carga.id);
        expect(lista).not.toContain(fora.id);

        const conferida = await conferir(carga.id);
        expect(conferida.corpo.pendencias).toEqual([]);
        // O veículo e o motorista da viagem vão na observação do documento.
        const emitido = await emitir(carga.id);
        expect(emitido.status).toBe(200);
        expect(emitido.corpo).toMatchObject({ autorizado: true, cte: { ambiente: "PRODUCAO", numero: 60, situacao: "AUTHORIZED" } });
        const [gravado] = await cteDe(carga.id);
        expect(gravado.xmlSent).toContain(`<xObs>Veiculo placa CTE1A23. Motorista ${PREFIXO}motorista.</xObs>`);
        // Em produção a carga fica com o CT-e: é o que a liberação da saída confere.
        expect(await cargaDoBanco(carga.id)).toEqual({ cteKey: gravado.accessKey, cteNumber: 60, cteStatus: "ISSUED" });
        expect((await banco.sistema.collection.findUniqueOrThrow({ where: { id: carga.id }, select: { status: true } })).status).toBe("COLLECTED");

        // O registro manual (CT-e de outro sistema) segue a mesma regra.
        const deFora = { cteNumber: 777, cteKey: chaveDeExemplo("57", 777, "35", "99888777000100") };
        entrarComo("OPERATION");
        expect((await lida(await listaRota.POST(req("POST", { collectionId: fora.id, ...deFora })))).status).toBe(409);
        await banco.sistema.collection.update({ where: { id: fora.id }, data: { manifestId: viagem.id } });
        expect((await lida(await listaRota.POST(req("POST", { collectionId: fora.id, ...deFora })))).status).toBe(200);
        expect(await cargaDoBanco(fora.id)).toMatchObject({ cteNumber: 777, cteStatus: "ISSUED" });

        // Viagem cancelada não é viagem em montagem.
        const terceira = await novaCarga({ status: "COLLECTED" });
        await banco.sistema.collection.update({ where: { id: terceira.id }, data: { manifestId: viagem.id } });
        await banco.sistema.manifest.update({ where: { id: viagem.id }, data: { status: "CANCELLED" } });
        expect((await conferir(terceira.id)).corpo.pendencias).toEqual([SO_CARGA_QUE_SAIU]);
        expect(await emitir(terceira.id)).toMatchObject({ status: 409, corpo: { error: SO_CARGA_QUE_SAIU } });
      } finally {
        await banco.sistema.collection.updateMany({ where: { manifestId: viagem.id }, data: { manifestId: null } });
        await banco.sistema.manifest.deleteMany({ where: { id: viagem.id } });
        await banco.sistema.vehicle.deleteMany({ where: { id: veiculo.id } });
        await banco.sistema.driver.deleteMany({ where: { id: motorista.id } });
        await banco.sistema.user.deleteMany({ where: { id: usuario.id } });
      }
    });

    it("autorizada em homologação: grava o protocolo e o cteProc, avisa a equipe e o n8n, e NÃO mexe no CT-e da carga", async () => {
      await prepararEmpresa({ proximoNumero: "40" });
      await banco.default.webhook.create({ data: { url: enderecoDoN8n, secret: "segredo-do-teste" } });
      const carga = await novaCarga();

      const { status, corpo } = await emitir(carga.id);
      expect(status).toBe(200);
      expect(corpo.autorizado).toBe(true);
      expect(corpo.mensagem).toMatch(/^CT-e nº 40 autorizado em homologação \(sem valor fiscal\)\. Protocolo \d{15}\.$/);
      expect(corpo.cte).toMatchObject({ ambiente: "HOMOLOGACAO", serie: 1, numero: 40, situacao: "AUTHORIZED", cStat: 100, semResposta: false });
      expect(corpo.cte.protocolo).toMatch(/^\d{15}$/);
      expect(chaveValida(corpo.cte.chave)).toBe(true);
      expect(lerChaveDoCte(corpo.cte.chave)).toMatchObject({ codigoDaUf: "35", cnpj: CNPJ_DA_PADRAO, modelo: "57", serie: 1, numero: 40, tipoDeEmissao: "1" });

      // A SEFAZ de mentira recebeu, com o certificado do emitente na conexão, um XML válido no esquema e assinado por ele.
      const envio = sefaz.chamadas.find((c) => c.servico === "CTeRecepcaoSincV4")!;
      expect(envio.certificadoDoCliente).toBe(impressaoDigital(certificado.certificadoPem));
      expect(await errosNoEsquema(envio.dados, "cte_v4.00.xsd")).toEqual([]);
      expect(assinaturaConfere(envio.dados, certificado.certificadoPem)).toBe(true);
      expect(envio.dados).toContain("<tpAmb>2</tpAmb>");

      const [cte] = await cteDe(carga.id);
      expect(cte).toMatchObject({ status: "AUTHORIZED", number: 40, environment: "HOMOLOGACAO", protocol: corpo.cte.protocolo, statusCode: 100, unanswered: false, sendingAt: null, issuedById: ids.OPERATION });
      expect(cte.xmlSent).toBe(envio.dados);
      expect(cte.authorizedAt).not.toBeNull();
      expect(await errosNoEsquema(cte.xmlReturn!, "procCTe_v4.00.xsd")).toEqual([]);
      expect(cte.xmlReturn).toContain(`<nProt>${cte.protocol}</nProt>`);
      expect(await numeracao()).toBe(41);

      // Homologação não tem valor fiscal: a carga continua sem CT-e.
      expect(await cargaDoBanco(carga.id)).toEqual({ cteKey: null, cteNumber: null, cteStatus: "PENDING" });

      // Auditoria, sininho (para quem lê o fiscal, menos quem emitiu) e o evento para o n8n.
      const auditoria = await trilha("cte.emitir");
      expect(auditoria).toHaveLength(1);
      expect(auditoria[0]).toMatchObject({ entity: "cte", entityId: cte.id, userId: ids.OPERATION, summary: `CT-e nº 40 autorizado em homologação (sem valor fiscal) para a carga ${carga.trackingCode}` });
      expect((await avisosDe("ADMIN", "cte.autorizado")).map((a) => a.title)).toEqual(["CT-e nº 40 autorizado (homologação)"]);
      expect(await avisosDe("EXPEDITION", "cte.autorizado")).toHaveLength(1);
      expect(await avisosDe("OPERATION", "cte.autorizado")).toHaveLength(0);
      expect(await avisosDe("COMMERCIAL", "cte.autorizado")).toHaveLength(0);

      await eventos.despacharPendentes();
      expect(avisosDeCteNoN8n().map((r) => r.tipo)).toEqual(["cte.autorizado"]);
      expect(avisosDeCteNoN8n()[0].dados.cte).toMatchObject({ id: cte.id, numero: 40, serie: 1, chave: cte.accessKey, ambiente: "HOMOLOGACAO", situacao: "AUTHORIZED", protocolo: cte.protocol, carga: { id: carga.id, rastreio: carga.trackingCode } });
      expect(JSON.stringify(recebidosNoN8n)).not.toContain("<CTe");

      // Emitir de novo a mesma carga: já está autorizada.
      expect(await emitir(carga.id)).toMatchObject({ status: 409, corpo: { error: JA_AUTORIZADO } });
      expect(await cteDe(carga.id)).toHaveLength(1);

      // A lista traz o CT-e, e o XML autorizado baixa como anexo.
      entrarComo("FINANCE");
      const lista = await lida<CargaParaCte[]>(await listaRota.GET());
      expect(lista.corpo.find((c) => c.id === carga.id)?.emitido).toMatchObject({ id: cte.id, situacao: "AUTHORIZED", numero: 40 });
      const xml = await xmlRota.GET(req(), ctx(cte.id));
      expect(xml.status).toBe(200);
      expect(xml.headers.get("Content-Type")).toBe("application/xml; charset=utf-8");
      expect(xml.headers.get("Content-Disposition")).toBe(`attachment; filename="${cte.accessKey}-procCTe.xml"`);
      expect(xml.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(await xml.text()).toBe(cte.xmlReturn);
    });

    it("em produção: o CT-e autorizado passa a ser o CT-e da carga, e o registro manual não o altera", async () => {
      await prepararEmpresa({ ambiente: "PRODUCAO", confirmacaoDoCnpj: CNPJ_DA_PADRAO, proximoNumero: "700" });
      const carga = await novaCarga();
      const { corpo } = await emitir(carga.id, "ADMIN");
      expect(corpo.autorizado).toBe(true);
      expect(corpo.mensagem).toMatch(/^CT-e nº 700 autorizado\. Protocolo \d{15}\.$/);
      const envio = sefaz.chamadas.find((c) => c.servico === "CTeRecepcaoSincV4")!;
      expect(envio.dados).toContain("<tpAmb>1</tpAmb>");
      // Em produção vai o nome de verdade, não a frase da homologação.
      expect(envio.dados).toContain("<xNome>Indústria Remetente S/A</xNome>");
      expect(await cargaDoBanco(carga.id)).toEqual({ cteKey: corpo.cte.chave, cteNumber: 700, cteStatus: "ISSUED" });
      expect((await avisosDe("OPERATION", "cte.autorizado")).map((a) => a.title)).toEqual(["CT-e nº 700 autorizado"]);

      entrarComo("OPERATION");
      const manual = await lida(await listaRota.POST(req("POST", { collectionId: carga.id, cteNumber: null, cteKey: null })));
      expect(manual).toMatchObject({ status: 409, corpo: { error: EMITIDO_PELO_SISTEMA } });
      expect((await cargaDoBanco(carga.id)).cteStatus).toBe("ISSUED");
    });

    it("carga com CT-e de outro sistema registrado à mão não emite em produção", async () => {
      await prepararEmpresa({ ambiente: "PRODUCAO", confirmacaoDoCnpj: CNPJ_DA_PADRAO });
      const carga = await novaCarga();
      await banco.sistema.collection.update({ where: { id: carga.id }, data: { cteKey: "35261099444333000343570010000005011123456783", cteNumber: 501, cteStatus: "ISSUED" } });
      expect((await conferir(carga.id)).corpo.pendencias).toEqual([JA_REGISTRADO_DE_FORA]);
      expect(await emitir(carga.id)).toMatchObject({ status: 409, corpo: { error: JA_REGISTRADO_DE_FORA } });
      expect(sefaz.chamadas).toHaveLength(0);
    });

    it("rejeitada: guarda o código e o motivo da SEFAZ, não autoriza nada, e o reenvio usa o MESMO número", async () => {
      await prepararEmpresa({ proximoNumero: "50" });
      const carga = await novaCarga();
      sefaz.modo = "rejeitar";
      const rejeitada = await emitir(carga.id);
      expect(rejeitada.status).toBe(200);
      expect(rejeitada.corpo.autorizado).toBe(false);
      expect(rejeitada.corpo.mensagem).toBe("A SEFAZ rejeitou o CT-e: 481 - Rejeição: IE deve ser informada para tomador Contribuinte.");
      expect(rejeitada.corpo.cte).toMatchObject({ situacao: "REJECTED", numero: 50, cStat: 481, protocolo: null, autorizadoEm: null });
      const [linha] = await cteDe(carga.id);
      expect(linha).toMatchObject({ status: "REJECTED", protocol: null, xmlReturn: null, authorizedAt: null, sendingAt: null });
      expect(await cargaDoBanco(carga.id)).toEqual({ cteKey: null, cteNumber: null, cteStatus: "PENDING" });
      expect(await trilha("cte.emitir")).toHaveLength(0);
      expect((await trilha("cte.rejeitar")).map((a) => a.summary)).toEqual([`CT-e nº 50 da carga ${carga.trackingCode} rejeitado pela SEFAZ: 481 - Rejeição: IE deve ser informada para tomador Contribuinte`]);
      expect(await avisosDe("ADMIN", "cte.autorizado")).toHaveLength(0);
      // XML de rejeitado não se baixa.
      entrarComo("OPERATION");
      expect(await lida(await xmlRota.GET(req(), ctx(linha.id)))).toMatchObject({ status: 409, corpo: { error: SO_AUTORIZADO_TEM_XML } });
      expect(await cancelar(linha.id)).toMatchObject({ status: 409, corpo: { error: SO_AUTORIZADO_CANCELA } });

      // A conferência mostra a rejeição e o número que o reenvio vai manter.
      const conferencia = await conferir(carga.id);
      expect(conferencia.corpo.cte).toMatchObject({ situacao: "REJECTED", cStat: 481 });
      expect(conferencia.corpo.resumo?.numeroPrevisto).toBe(50);

      // Outra carga, nesse meio tempo, pega o número seguinte.
      sefaz.modo = "autorizar";
      const outra = await novaCarga();
      expect((await emitir(outra.id)).corpo.cte.numero).toBe(51);

      const reenvio = await emitir(carga.id);
      expect(reenvio.corpo.autorizado).toBe(true);
      expect(reenvio.corpo.cte).toMatchObject({ id: rejeitada.corpo.cte.id, numero: 50, situacao: "AUTHORIZED" });
      // Documento refeito: código aleatório novo, chave nova.
      expect(reenvio.corpo.cte.chave).not.toBe(rejeitada.corpo.cte.chave);
      expect(await cteDe(carga.id)).toHaveLength(1);
      expect(await numeracao()).toBe(52);
    });

    it("número já usado por outro documento (539): rejeita e a próxima tentativa pega número novo", async () => {
      await prepararEmpresa({ proximoNumero: "60" });
      const carga = await novaCarga();
      sefaz.modo = "numero-usado";
      const usada = await emitir(carga.id);
      expect(usada.corpo.autorizado).toBe(false);
      expect(usada.corpo.mensagem).toContain("539 - Rejeição: Duplicidade de CTe, com diferença na Chave de Acesso");
      expect(usada.corpo.mensagem).toContain("a próxima tentativa usa o número seguinte");
      expect((await cteDe(carga.id))[0]).toMatchObject({ status: "REJECTED", number: 60, numberBurned: true });
      expect((await conferir(carga.id)).corpo.resumo?.numeroPrevisto).toBe(61);

      sefaz.modo = "autorizar";
      const nova = await emitir(carga.id);
      expect(nova.corpo.cte).toMatchObject({ situacao: "AUTHORIZED", numero: 61 });
      expect(await numeracao()).toBe(62);
    });

    it("serviço paralisado: nada é processado, o rascunho mantém o número e nada fica autorizado", async () => {
      await prepararEmpresa({ proximoNumero: "70" });
      const carga = await novaCarga();
      sefaz.modo = "parado";
      const parada = await emitir(carga.id);
      expect(parada.status).toBe(200);
      expect(parada.corpo).toMatchObject({ autorizado: false, mensagem: "A SEFAZ não processou o CT-e: 108 - Serviço Paralisado Momentaneamente. Tente de novo mais tarde.", cte: { situacao: "DRAFT", numero: 70, cStat: 108, semResposta: false } });
      sefaz.modo = "autorizar";
      expect((await emitir(carga.id)).corpo.cte).toMatchObject({ situacao: "AUTHORIZED", numero: 70 });
      expect(await numeracao()).toBe(71);
    });

    it("sem resposta: fica como está, e a nova tentativa CONSULTA a SEFAZ antes de reenviar o mesmo XML", async () => {
      await prepararEmpresa({ proximoNumero: "80" });
      const carga = await novaCarga();
      sefaz.modo = "mudo";
      const semResposta = await emitir(carga.id);
      expect(semResposta.status).toBe(504);
      expect(semResposta.corpo.error).toContain("A SEFAZ não respondeu no tempo limite.");
      expect(semResposta.corpo.error).toContain("emitir de novo começa consultando a SEFAZ pela chave");
      const [antes] = await cteDe(carga.id);
      expect(antes).toMatchObject({ status: "DRAFT", number: 80, unanswered: true, sendingAt: null, protocol: null });
      expect((await conferir(carga.id)).corpo.cte).toMatchObject({ situacao: "DRAFT", semResposta: true });

      // A SEFAZ não recebeu nada (217 na consulta): reenvia o MESMO XML, com a mesma chave.
      sefaz.modo = "autorizar";
      sefaz.chamadas.length = 0;
      const retomada = await emitir(carga.id);
      expect(retomada.corpo.autorizado).toBe(true);
      expect(retomada.corpo.cte).toMatchObject({ id: antes.id, numero: 80, chave: antes.accessKey, situacao: "AUTHORIZED" });
      expect(sefaz.chamadas.map((c) => c.servico)).toEqual(["CTeConsultaV4", "CTeRecepcaoSincV4"]);
      expect(sefaz.chamadas[1].dados).toBe(antes.xmlSent);
      expect(await numeracao()).toBe(81);
    });

    it("sem resposta, mas a SEFAZ autorizou: a nova tentativa acha o protocolo pela consulta e NÃO envia de novo", async () => {
      await prepararEmpresa({ proximoNumero: "90" });
      const carga = await novaCarga();
      sefaz.modo = "mudo-processando";
      expect((await emitir(carga.id)).status).toBe(504);
      const [antes] = await cteDe(carga.id);
      expect(antes).toMatchObject({ status: "DRAFT", unanswered: true });
      expect(sefaz.autorizados.has(antes.accessKey)).toBe(true);

      sefaz.modo = "autorizar";
      sefaz.chamadas.length = 0;
      const retomada = await emitir(carga.id);
      expect(retomada.corpo.autorizado).toBe(true);
      expect(retomada.corpo.cte).toMatchObject({ id: antes.id, numero: 90, chave: antes.accessKey, protocolo: sefaz.autorizados.get(antes.accessKey)!.protocolo });
      expect(sefaz.chamadas.map((c) => c.servico)).toEqual(["CTeConsultaV4"]);
      expect(await cteDe(carga.id)).toHaveLength(1);
      expect(await numeracao()).toBe(91);
    });

    it("sem resposta e a consulta também falha: continua sem resposta, sem montar documento novo", async () => {
      await prepararEmpresa({ proximoNumero: "95" });
      const carga = await novaCarga();
      sefaz.modo = "mudo";
      expect((await emitir(carga.id)).status).toBe(504);
      const [antes] = await cteDe(carga.id);
      // Na segunda tentativa a SEFAZ continua muda (a consulta não responde).
      const segunda = await emitir(carga.id);
      expect(segunda.status).toBe(504);
      const [depois] = await cteDe(carga.id);
      expect(depois).toMatchObject({ status: "DRAFT", unanswered: true, accessKey: antes.accessKey, xmlSent: antes.xmlSent, number: 95 });
      expect(await numeracao()).toBe(96);
    });

    it('"autorizado" sem protocolo, ou com protocolo de outra chave, não autoriza nada', async () => {
      await prepararEmpresa({ proximoNumero: "100" });
      for (const modo of ["sem-protocolo", "outra-chave"] as const) {
        const carga = await novaCarga();
        sefaz.modo = modo;
        const resposta = await emitir(carga.id);
        expect(resposta.status, modo).toBe(502);
        expect(resposta.corpo.error, modo).toContain(modo === "sem-protocolo" ? 'respondeu "autorizado" sem número de protocolo' : "é de outra chave de acesso");
        const [linha] = await cteDe(carga.id);
        expect(linha, modo).toMatchObject({ status: "DRAFT", unanswered: true, protocol: null, xmlReturn: null, authorizedAt: null });
      }
      expect(await banco.sistema.cte.count({ where: { ...DAS_EMPRESAS, status: "AUTHORIZED" } })).toBe(0);
      expect(await trilha("cte.emitir")).toHaveLength(0);
      expect(await banco.sistema.notification.count({ where: { type: "cte.autorizado", user: { email: { startsWith: PREFIXO } } } })).toBe(0);
    });

    it("duplicidade (204) no reenvio: o CT-e já estava autorizado lá, e o protocolo vem pela consulta", async () => {
      await prepararEmpresa({ proximoNumero: "110" });
      const carga = await novaCarga();
      // A SEFAZ autoriza e a resposta se perde.
      sefaz.modo = "mudo-processando";
      expect((await emitir(carga.id)).status).toBe(504);
      const [antes] = await cteDe(carga.id);

      // Na retomada, a primeira consulta ainda não enxerga a autorização (217): o mesmo XML é reenviado,
      // a SEFAZ responde 204, e a segunda consulta traz o protocolo.
      sefaz.modo = "autorizar";
      sefaz.consultasCegas = 1;
      sefaz.chamadas.length = 0;
      const retomada = await emitir(carga.id);
      expect(sefaz.chamadas.map((c) => c.servico)).toEqual(["CTeConsultaV4", "CTeRecepcaoSincV4", "CTeConsultaV4"]);
      expect(retomada.corpo.autorizado).toBe(true);
      expect(retomada.corpo.cte).toMatchObject({ id: antes.id, numero: 110, chave: antes.accessKey, situacao: "AUTHORIZED", protocolo: sefaz.autorizados.get(antes.accessKey)!.protocolo });
      expect(await cteDe(carga.id)).toHaveLength(1);
    });

    it("duplicidade (204) que a consulta não confirma: nada é autorizado por conta própria", async () => {
      await prepararEmpresa({ proximoNumero: "120" });
      const carga = await novaCarga();
      sefaz.modo = "duplicidade";
      const resposta = await emitir(carga.id);
      expect(resposta.status).toBe(502);
      expect(resposta.corpo.error).toContain("204 - Rejeição: Duplicidade de CTe");
      expect(resposta.corpo.error).toContain("A consulta pela chave não devolveu o protocolo.");
      expect((await cteDe(carga.id))[0]).toMatchObject({ status: "DRAFT", unanswered: true, protocol: null, xmlReturn: null });
      expect(await trilha("cte.emitir")).toHaveLength(0);
    });
  });

  /* --------------------------------- Numeração -------------------------------- */

  describe("numeração", () => {
    it("emissões simultâneas de cargas diferentes levam números seguidos, sem repetir nem pular", async () => {
      await prepararEmpresa({ proximoNumero: "200" });
      const cargas = [];
      for (let i = 0; i < 6; i += 1) cargas.push(await novaCarga());
      sefaz.atrasoMs = 150;
      entrarComo("OPERATION");
      const resultados = await Promise.all(cargas.map(async (carga) => lida<ResultadoDaEmissao>(await emissaoRota.POST(req("POST", { collectionId: carga.id })))));
      expect(resultados.map((r) => r.status)).toEqual([200, 200, 200, 200, 200, 200]);
      expect(resultados.every((r) => r.corpo.autorizado)).toBe(true);
      expect(resultados.map((r) => r.corpo.cte.numero).sort((a, b) => a - b)).toEqual([200, 201, 202, 203, 204, 205]);
      expect(new Set(resultados.map((r) => r.corpo.cte.chave)).size).toBe(6);
      expect(await numeracao()).toBe(206);
    }, 60_000);

    it("duas emissões simultâneas da MESMA carga: uma segue, a outra é recusada, e nasce um CT-e só", async () => {
      await prepararEmpresa({ proximoNumero: "300" });
      const carga = await novaCarga();
      sefaz.atrasoMs = 400;
      entrarComo("OPERATION");
      const resultados = await Promise.all([1, 2].map(async () => lida<ResultadoDaEmissao & Corpo>(await emissaoRota.POST(req("POST", { collectionId: carga.id })))));
      expect(resultados.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(resultados.find((r) => r.status === 409)?.corpo.error).toBe(EMISSAO_EM_ANDAMENTO);
      expect(await cteDe(carga.id)).toHaveLength(1);
      expect(sefaz.chamadas.filter((c) => c.servico === "CTeRecepcaoSincV4")).toHaveLength(1);
      expect(await numeracao()).toBe(301);
    }, 60_000);

    it("o próximo número não pode ficar abaixo de um CT-e já autorizado; trocar de série começa numeração nova", async () => {
      await prepararEmpresa({ proximoNumero: "400" });
      const carga = await novaCarga();
      expect((await emitir(carga.id)).corpo.cte.numero).toBe(400);
      expect(await salvarDados({ proximoNumero: "400" })).toMatchObject({ status: 409, corpo: { error: "Já existe o CT-e nº 400 autorizado nesta série e ambiente: o próximo número precisa ser 401 ou maior." } });
      expect((await salvarDados({ proximoNumero: "401" })).status).toBe(200);

      expect((await salvarDados({ serie: "2", proximoNumero: "1" })).corpo.dados).toMatchObject({ serie: 2, proximoNumero: 1 });
      const outra = await novaCarga();
      const naSerie2 = await emitir(outra.id);
      expect(naSerie2.corpo.cte).toMatchObject({ serie: 2, numero: 1, situacao: "AUTHORIZED" });
      expect(await numeracao("HOMOLOGACAO", 1)).toBe(401);
      expect(await numeracao("HOMOLOGACAO", 2)).toBe(2);
    });
  });

  /* -------------------------------- Cancelamento ------------------------------ */

  describe("cancelamento", () => {
    it("registrado pela SEFAZ: o CT-e fica cancelado, a carga também, com auditoria, aviso e evento; depois dá para emitir outro", async () => {
      await prepararEmpresa({ ambiente: "PRODUCAO", confirmacaoDoCnpj: CNPJ_DA_PADRAO, proximoNumero: "500" });
      await banco.default.webhook.create({ data: { url: enderecoDoN8n, secret: "segredo-do-teste" } });
      const carga = await novaCarga();
      const emitido = (await emitir(carga.id)).corpo.cte;

      expect((await cancelar(emitido.id, "curta")).status).toBe(400);
      expect((await cancelar(SEM_ID)).status).toBe(404);
      expect((await cargaDoBanco(carga.id)).cteStatus).toBe("ISSUED");

      sefaz.chamadas.length = 0;
      const { status, corpo } = await cancelar(emitido.id, "Carga recusada pelo destinatário na entrega", "ADMIN");
      expect(status).toBe(200);
      expect(corpo).toMatchObject({ id: emitido.id, situacao: "CANCELLED", numero: 500 });
      expect(corpo.canceladoEm).not.toBeNull();

      // O evento que chegou à SEFAZ é válido no esquema, assinado pelo emitente e com o protocolo da autorização.
      const evento = sefaz.chamadas.find((c) => c.servico === "CTeRecepcaoEventoV4")!;
      expect(await errosNoEsquema(evento.dados, "eventoCTe_v4.00.xsd")).toEqual([]);
      expect(assinaturaConfere(evento.dados, certificado.certificadoPem)).toBe(true);
      expect(evento.dados).toContain(`<nProt>${emitido.protocolo}</nProt><xJust>Carga recusada pelo destinatário na entrega</xJust>`);
      expect(evento.dados).toContain("<tpAmb>1</tpAmb>");

      const [linha] = await cteDe(carga.id);
      expect(linha).toMatchObject({ status: "CANCELLED", cancelReason: "Carga recusada pelo destinatário na entrega" });
      expect(linha.cancelProtocol).toMatch(/^\d{15}$/);
      expect(linha.cancelXml).toContain("<retEventoCTe");
      expect(await cargaDoBanco(carga.id)).toEqual({ cteKey: emitido.chave, cteNumber: 500, cteStatus: "CANCELLED" });
      expect((await trilha("cte.cancelar")).map((a) => a.summary)).toEqual([`CT-e nº 500 da carga ${carga.trackingCode} cancelado`]);
      expect((await avisosDe("OPERATION", "cte.cancelado")).map((a) => a.title)).toEqual(["CT-e nº 500 cancelado"]);

      await eventos.despacharPendentes();
      expect(avisosDeCteNoN8n().map((r) => r.tipo)).toEqual(["cte.autorizado", "cte.cancelado"]);
      expect(avisosDeCteNoN8n()[1].dados.cte).toMatchObject({ id: emitido.id, situacao: "CANCELLED", protocoloDoCancelamento: linha.cancelProtocol });

      // Cancelar de novo: já não está autorizado.
      expect(await cancelar(emitido.id)).toMatchObject({ status: 409, corpo: { error: SO_AUTORIZADO_CANCELA } });
      // O XML do cancelado continua disponível.
      entrarComo("OPERATION");
      expect((await xmlRota.GET(req(), ctx(emitido.id))).status).toBe(200);

      // A carga pode receber outro CT-e: número novo, e ele passa a ser o CT-e da carga.
      const novo = await emitir(carga.id);
      expect(novo.corpo.cte).toMatchObject({ situacao: "AUTHORIZED", numero: 501 });
      expect(novo.corpo.cte.id).not.toBe(emitido.id);
      expect(await cargaDoBanco(carga.id)).toEqual({ cteKey: novo.corpo.cte.chave, cteNumber: 501, cteStatus: "ISSUED" });
      expect((await cteDe(carga.id)).map((c) => c.status)).toEqual(["CANCELLED", "AUTHORIZED"]);
    });

    it("fora do prazo de 7 dias nem chega à SEFAZ; recusa da SEFAZ aparece com o código e o CT-e continua autorizado", async () => {
      await prepararEmpresa({ proximoNumero: "600" });
      const carga = await novaCarga();
      const emitido = (await emitir(carga.id)).corpo.cte;

      sefaz.modo = "rejeitar";
      sefaz.chamadas.length = 0;
      expect(await cancelar(emitido.id)).toMatchObject({ status: 409, corpo: { error: "A SEFAZ recusou o cancelamento: 220 - Rejeição: CTe autorizado há mais de 7 dias (168 horas)." } });
      expect((await cteDe(carga.id))[0]).toMatchObject({ status: "AUTHORIZED", cancelledAt: null, cancelProtocol: null });

      await banco.sistema.cte.update({ where: { id: emitido.id }, data: { authorizedAt: new Date(Date.now() - 169 * 3_600_000) } });
      sefaz.chamadas.length = 0;
      expect(await cancelar(emitido.id)).toMatchObject({ status: 409, corpo: { error: FORA_DO_PRAZO } });
      expect(sefaz.chamadas).toHaveLength(0);
      expect(await trilha("cte.cancelar")).toHaveLength(0);
    });

    it("pedido que chegou à SEFAZ sem resposta: o CT-e continua autorizado aqui; a nova tentativa confirma pela consulta", async () => {
      await prepararEmpresa({ proximoNumero: "650" });
      const carga = await novaCarga();
      const emitido = (await emitir(carga.id)).corpo.cte;

      sefaz.modo = "mudo-processando";
      const semResposta = await cancelar(emitido.id);
      expect(semResposta.status).toBe(504);
      expect(semResposta.corpo.error).toContain("O CT-e continua autorizado: tente cancelar de novo.");
      expect((await cteDe(carga.id))[0].status).toBe("AUTHORIZED");

      // A SEFAZ responde 218 (já cancelado) e a consulta confirma 101: aí sim fica cancelado, sem protocolo próprio.
      sefaz.modo = "autorizar";
      const segunda = await cancelar(emitido.id);
      expect(segunda.status).toBe(200);
      expect(segunda.corpo.situacao).toBe("CANCELLED");
      expect((await cteDe(carga.id))[0]).toMatchObject({ status: "CANCELLED", cancelProtocol: null });
    });
  });

  /* ----------------------------------- DACTE ---------------------------------- */

  describe("DACTE", () => {
    it("só de CT-e autorizado, gerado pelo serviço fiscal a partir do cteProc; em homologação o arquivo diz que não tem valor fiscal", async () => {
      await prepararEmpresa({ proximoNumero: "900" });
      const carga = await novaCarga();
      const emitido = (await emitir(carga.id)).corpo.cte;
      const [linha] = await cteDe(carga.id);
      const baixar = (id: string) => dacteRota.GET(req(), ctx(id));

      // Serviço desligado: 503, e a tela é avisada para não mostrar o botão.
      entrarComo("FINANCE");
      expect(await lida(await baixar(emitido.id))).toMatchObject({ status: 503, corpo: { error: "A geração de DACTE não está ligada neste sistema." } });

      process.env.FISCAL_MCP_URL = enderecoDoFiscal;
      try {
        expect((await lida<SituacaoDaEmissao>(await situacaoRota.GET())).corpo.dacte).toBe(true);
        pedidosAoFiscal.length = 0;
        fiscalDizAutorizado = true;
        const pdf = await baixar(emitido.id);
        expect(pdf.status).toBe(200);
        expect(pdf.headers.get("Content-Type")).toBe("application/pdf");
        expect(pdf.headers.get("Content-Disposition")).toBe(`attachment; filename="${emitido.chave}-dacte-HOMOLOGACAO-SEM-VALOR-FISCAL.pdf"`);
        expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString()).toBe("%PDF-");
        // O que foi para o serviço é o cteProc guardado, com o protocolo.
        expect(pedidosAoFiscal).toEqual([{ ferramenta: "gerar_dacte", xml: linha.xmlReturn }]);

        // O serviço não reconhece o protocolo: não há DACTE.
        fiscalDizAutorizado = false;
        expect(await lida(await baixar(emitido.id))).toMatchObject({ status: 502, corpo: { error: "O serviço fiscal não reconheceu o protocolo de autorização deste CT-e: o DACTE não foi gerado." } });
        fiscalDizAutorizado = true;

        // Rejeitado e cancelado não têm DACTE, e nem chegam ao serviço.
        const outra = await novaCarga();
        sefaz.modo = "rejeitar";
        const rejeitado = (await emitir(outra.id)).corpo.cte;
        sefaz.modo = "autorizar";
        expect((await cancelar(emitido.id)).status).toBe(200);
        pedidosAoFiscal.length = 0;
        entrarComo("FINANCE");
        expect(await lida(await baixar(rejeitado.id))).toMatchObject({ status: 409, corpo: { error: "Só CT-e autorizado (e não cancelado) tem DACTE." } });
        expect((await lida(await baixar(emitido.id))).status).toBe(409);
        expect((await lida(await baixar(SEM_ID))).status).toBe(404);
        entrarComo("ADMIN_DA_OUTRA");
        expect((await lida(await baixar(rejeitado.id))).status).toBe(404);
        entrarComo("COMMERCIAL");
        expect((await baixar(emitido.id)).status).toBe(403);
        expect(pedidosAoFiscal).toHaveLength(0);
      } finally {
        delete process.env.FISCAL_MCP_URL;
      }
    });
  });

  /* ------------------------------ Status do serviço --------------------------- */

  describe("status do serviço", () => {
    it("pergunta à SEFAZ com o certificado da empresa; sem ele, diz o que falta", async () => {
      entrarComo("FINANCE");
      expect(await lida(await statusRota.GET())).toMatchObject({ status: 409, corpo: { error: SEM_EMITENTE_CADASTRADO } });
      await salvarDados();
      entrarComo("FINANCE");
      expect((await lida(await statusRota.GET())).corpo.error).toBe("A empresa não tem certificado digital A1. Envie em Empresa → Fiscal.");
      expect(sefaz.chamadas).toHaveLength(0);

      await enviarCertificado();
      entrarComo("FINANCE");
      expect((await lida<StatusDoServico>(await statusRota.GET())).corpo).toEqual({ ambiente: "HOMOLOGACAO", autorizador: "SP", emOperacao: true, cStat: 107, motivo: "Serviço em Operação" });
      expect(sefaz.chamadas[0]).toMatchObject({ servico: "CTeStatusServicoV4", certificadoDoCliente: impressaoDigital(certificado.certificadoPem) });

      sefaz.modo = "parado";
      expect((await lida<StatusDoServico>(await statusRota.GET())).corpo).toMatchObject({ emOperacao: false, cStat: 108, motivo: "Serviço Paralisado Momentaneamente" });
      sefaz.modo = "mudo";
      expect((await lida<StatusDoServico>(await statusRota.GET())).corpo).toMatchObject({ emOperacao: false, cStat: null, motivo: "A SEFAZ não respondeu no tempo limite." });
    });
  });

  /* --------------------------------- Isolamento ------------------------------- */

  describe("isolamento entre empresas", () => {
    it("uma empresa não vê os dados fiscais, o certificado, as cargas nem os CT-e da outra", async () => {
      await prepararEmpresa({ proximoNumero: "800" });
      const carga = await novaCarga();
      const emitido = (await emitir(carga.id)).corpo.cte;

      entrarComo("ADMIN_DA_OUTRA");
      expect((await lida<FiscalDaEmpresa>(await fiscalRota.GET())).corpo).toEqual({ disponivel: true, dados: null, certificado: null });
      expect((await lida<SituacaoDaEmissao>(await situacaoRota.GET())).corpo.pronta).toBe(false);
      expect((await lida(await emissaoRota.GET(req("GET", undefined, `http://localhost/x?collectionId=${carga.id}`)))).status).toBe(404);
      expect((await lida(await emissaoRota.POST(req("POST", { collectionId: carga.id })))).status).toBe(409);
      expect((await lida(await xmlRota.GET(req(), ctx(emitido.id)))).status).toBe(404);
      expect((await lida(await cancelarRota.POST(req("POST", { justificativa: "Tentativa de outra empresa" }), ctx(emitido.id)))).status).toBe(404);
      expect((await lida<CargaParaCte[]>(await listaRota.GET())).corpo.some((c) => c.id === carga.id)).toBe(false);
      expect((await cteDe(carga.id))[0].status).toBe("AUTHORIZED");
      expect(await banco.sistema.cte.count({ where: { tenantId: EMPRESA_OUTRA.id } })).toBe(0);

      // A outra empresa cadastra os dados dela, com a numeração dela, sem tocar na primeira.
      const dela = await lida<FiscalDaEmpresa>(await fiscalRota.PUT(req("PUT", { ...FORMULARIO, cnpj: CNPJ_DA_OUTRA, proximoNumero: "5" })));
      expect(dela.corpo.dados).toMatchObject({ cnpj: CNPJ_DA_OUTRA, proximoNumero: 5 });
      // O certificado da primeira empresa é de outro CNPJ: a outra não consegue usá-lo.
      expect((await lida(await certificadoRota.PUT(req("PUT", { arquivo: certificado.pfx.toString("base64"), senha: SENHA })))).corpo.error).toBe(DE_OUTRO_CNPJ);
      expect(await numeracao()).toBe(801);
      entrarComo("ADMIN");
      expect((await lida<FiscalDaEmpresa>(await fiscalRota.GET())).corpo.dados).toMatchObject({ cnpj: CNPJ_DA_PADRAO, proximoNumero: 801 });
    });

    it("o certificado cifrado de uma empresa, copiado para a linha de outra, não abre", async () => {
      await prepararEmpresa();
      const daPadrao = await banco.sistema.fiscalIssuer.findUniqueOrThrow({ where: { tenantId: EMPRESA_PADRAO.id } });
      entrarComo("ADMIN_DA_OUTRA");
      await lida(await fiscalRota.PUT(req("PUT", { ...FORMULARIO, cnpj: CNPJ_DA_PADRAO })));
      // Copia direto no banco o que está cifrado para a outra empresa.
      await banco.sistema.fiscalIssuer.update({
        where: { tenantId: EMPRESA_OUTRA.id },
        data: { certPfxEnc: daPadrao.certPfxEnc, certPasswordEnc: daPadrao.certPasswordEnc, certSubject: daPadrao.certSubject, certTaxId: daPadrao.certTaxId, certNotBefore: daPadrao.certNotBefore, certNotAfter: daPadrao.certNotAfter, certUploadedAt: daPadrao.certUploadedAt },
      });
      const carga = await novaCarga({ outra: true });
      entrarComo("ADMIN_DA_OUTRA");
      const resposta = await lida(await emissaoRota.POST(req("POST", { collectionId: carga.id })));
      expect(resposta).toMatchObject({ status: 503, corpo: { error: CERTIFICADO_ILEGIVEL } });
      expect(sefaz.chamadas).toHaveLength(0);
      expect(await banco.sistema.cte.count({ where: { tenantId: EMPRESA_OUTRA.id } })).toBe(0);
    });

    it("trocar a chave de dados do servidor torna o certificado ilegível: a emissão avisa e nada é enviado", async () => {
      await prepararEmpresa();
      const carga = await novaCarga();
      const chave = process.env.TMS_CHAVE_DE_DADOS;
      process.env.TMS_CHAVE_DE_DADOS = "outra-chave-de-dados-dos-testes-do-cte-9876543210";
      try {
        expect(await emitir(carga.id)).toMatchObject({ status: 503, corpo: { error: CERTIFICADO_ILEGIVEL } });
      } finally {
        process.env.TMS_CHAVE_DE_DADOS = chave;
      }
      expect(sefaz.chamadas).toHaveLength(0);
    });
  });
});
