import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getServerSession } from "next-auth";
import { SEM_EMITENTE_CADASTRADO } from "../src/lib/cte";
import { assinaturaConfere } from "../src/lib/cte/assinar";
import { montarCte } from "../src/lib/cte/montar";
import {
  AVISO_DE_VIAGEM_SEM_MDFE,
  CONFIRME_QUE_NAO_SAIU,
  DATA_DE_ENCERRAMENTO_INVALIDA,
  DIAS_PARA_AVISAR_ENCERRAMENTO,
  EMISSAO_EM_ANDAMENTO,
  FORA_DO_PRAZO,
  JA_AUTORIZADO,
  MDFE_NAO_ENCONTRADO,
  SO_AUTORIZADO_CANCELA,
  SO_AUTORIZADO_ENCERRA,
  SO_AUTORIZADO_TEM_DAMDFE,
  SO_AUTORIZADO_TEM_XML,
  TRANSPORTE_JA_INICIADO,
  VIAGEM_NAO_ENCONTRADA,
  fraseDoBloqueioDaSaida,
  type ConferenciaDoMdfe,
  type FaltasParaSair,
  type ConfiguracaoDoMdfe,
  type MdfeEmitido,
  type MdfesDaViagem,
  type RespostaDeNaoEncerrados,
  type ResultadoDaEmissao,
  type SituacaoDaEmissao,
  type StatusDoServico,
} from "../src/lib/mdfe";
import { usarSefazDeTesteDoMdfe } from "../src/lib/mdfe/sefaz";
import { chaveValida } from "../src/lib/nfe";
import { EMPRESA_OUTRA, EMPRESA_PADRAO } from "./empresas-de-teste";
import { REMETENTE, certificadoDeTeste, dadosDeExemplo, impressaoDigital, type CertificadoDeTeste } from "./cte-apoio";
import { chaveDeExemplo, errosNoEsquemaDoMdfe, modalDoXml, subirSefazDoMdfe, type SefazDoMdfe } from "./mdfe-apoio";

/**
 * Emissão de MDF-e, com banco: a configuração, a numeração e o caminho inteiro
 * de cada MDF-e (conferir, emitir, encerrar, cancelar, incluir condutor, baixar
 * o XML e o DAMDFE), pelas rotas.
 *
 * NENHUM teste fala com a SEFAZ: as rotas conversam com o servidor HTTPS local
 * de tests/mdfe-apoio.ts (`usarSefazDeTesteDoMdfe`), e o certificado é
 * autoassinado.
 */
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

const temBanco = Boolean(process.env.DATABASE_URL);
if (!temBanco) {
  console.warn("\n[mdfe-rotas.test] DATABASE_URL ausente: testes de integração PULADOS.\n");
}
const suite = temBanco ? describe : describe.skip;

const PREFIXO = "teste-mdfe-";
const HASH_FALSO = "$2b$10$hashfalsoparateste000000000000000000000000000000000";
const SEM_ID = "00000000-0000-0000-0000-000000000000";
const CNPJ_DA_PADRAO = "11222333000181";
const SENHA = "senha-secreta-do-certificado-ZXCVBN";
const CPF_DO_MOTORISTA = "52998224725";

type Perfil = "ADMIN" | "OPERATION" | "FINANCE" | "EXPEDITION" | "COMMERCIAL" | "ADMIN_DA_OUTRA";
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

const SEGURO = { responsavel: "1", seguradora: "Seguradora de Teste S/A", cnpjDaSeguradora: "61.198.164/0001-60", apolice: "AP-2026-0001", averbacoes: ["AV-0001"] };
/** O que a transportadora informa na tela para um MDF-e com mais de um documento. */
const ENTRADAS = { ciots: [{ codigo: "123456789012", documento: CNPJ_DA_PADRAO }], seguro: SEGURO };

const DESTINOS = {
  MG: { texto: "Belo Horizonte - MG", codigoMunicipio: "3106200", municipio: "Belo Horizonte", uf: "MG" },
  UDI: { texto: "Uberlândia - MG", codigoMunicipio: "3170206", municipio: "Uberlândia", uf: "MG" },
  RJ: { texto: "Rio de Janeiro - RJ", codigoMunicipio: "3304557", municipio: "Rio de Janeiro", uf: "RJ" },
  GO: { texto: "Goiânia - GO", codigoMunicipio: "5208707", municipio: "Goiânia", uf: "GO" },
} as const;

suite("rotas da emissão de MDF-e", () => {
  let banco: typeof import("../src/lib/prisma");
  let mdfeDb: typeof import("../src/lib/mdfe-db");
  let fiscalRota: typeof import("../src/app/api/empresa/fiscal/route");
  let certificadoRota: typeof import("../src/app/api/empresa/fiscal/certificado/route");
  let listaRota: typeof import("../src/app/api/fiscal/mdfe/route");
  let situacaoRota: typeof import("../src/app/api/fiscal/mdfe/situacao/route");
  let statusRota: typeof import("../src/app/api/fiscal/mdfe/status-servico/route");
  let abertosRota: typeof import("../src/app/api/fiscal/mdfe/nao-encerrados/route");
  let configuracaoRota: typeof import("../src/app/api/fiscal/mdfe/configuracao/route");
  let conferenciaRota: typeof import("../src/app/api/fiscal/mdfe/conferencia/route");
  let emissaoRota: typeof import("../src/app/api/fiscal/mdfe/emissao/route");
  let xmlRota: typeof import("../src/app/api/fiscal/mdfe/emissao/[id]/xml/route");
  let damdfeRota: typeof import("../src/app/api/fiscal/mdfe/emissao/[id]/damdfe/route");
  let encerrarRota: typeof import("../src/app/api/fiscal/mdfe/emissao/[id]/encerrar/route");
  let cancelarRota: typeof import("../src/app/api/fiscal/mdfe/emissao/[id]/cancelar/route");
  let condutorRota: typeof import("../src/app/api/fiscal/mdfe/emissao/[id]/condutor/route");
  let liberarRota: typeof import("../src/app/api/manifestos/[id]/liberar/route");
  let eventos: typeof import("../src/lib/eventos");

  const sessao = vi.mocked(getServerSession);
  const ids = {} as Record<Perfil, string>;
  let clienteId: string;
  let motoristaId: string;
  let sefaz: SefazDoMdfe;
  let certificado: CertificadoDeTeste;
  let n8n: Server;
  let enderecoDoN8n: string;
  let enderecoDoFiscal: string;
  let fiscalDizAutorizado = true;
  let recebidosNoN8n: { tipo: string; dados: Record<string, Record<string, unknown> | null> }[] = [];
  const avisosDeMdfeNoN8n = () => recebidosNoN8n.filter((recebido) => recebido.tipo.startsWith("mdfe."));
  const pedidosAoFiscal: { ferramenta: string; xml: string }[] = [];
  let sequencia = 0;

  // Tudo o que as rotas responderam e o que foi para o log: é aqui que se procura vazamento.
  const respostas: string[] = [];
  const logs: string[] = [];

  const DAS_EMPRESAS = { tenantId: { in: [EMPRESA_PADRAO.id, EMPRESA_OUTRA.id] } };

  const entrarComo = (perfil: Perfil | null) =>
    sessao.mockResolvedValue(perfil ? { user: { id: ids[perfil], role: perfil === "ADMIN_DA_OUTRA" ? "ADMIN" : perfil, clientId: null, ...(perfil === "ADMIN_DA_OUTRA" && { tenantId: EMPRESA_OUTRA.id }) } } : null);

  const req = (method = "GET", body?: unknown, url = "http://localhost/api/teste") =>
    new Request(url, { method, headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.9" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

  async function lida<T = Corpo>(res: Response): Promise<{ status: number; corpo: T }> {
    const texto = await res.text();
    respostas.push(texto);
    return { status: res.status, corpo: JSON.parse(texto) as T };
  }

  /** A empresa padrão pronta para emitir: dados fiscais (pela rota do CT-e, que é o mesmo cadastro) e certificado. */
  const prepararEmpresa = async (trocas: Record<string, unknown> = {}) => {
    entrarComo("ADMIN");
    expect((await fiscalRota.PUT(req("PUT", { ...FORMULARIO, ...trocas }))).status).toBe(200);
    expect((await certificadoRota.PUT(req("PUT", { arquivo: certificado.pfx.toString("base64"), senha: SENHA }))).status).toBe(200);
  };
  const configurar = async (trocas: Record<string, unknown> = {}, perfil: Perfil = "ADMIN") => {
    entrarComo(perfil);
    return lida<ConfiguracaoDoMdfe & Corpo>(await configuracaoRota.PUT(req("PUT", { serie: "1", proximoNumero: "1", tipoDeEmitente: "1", ...trocas })));
  };

  const daViagem = async (manifestId: string, perfil: Perfil = "OPERATION") => {
    entrarComo(perfil);
    return lida<MdfesDaViagem & Corpo>(await emissaoRota.GET(req("GET", undefined, `http://localhost/api/fiscal/mdfe/emissao?manifestId=${manifestId}`)));
  };
  const conferir = async (manifestId: string, ufDeDescarga: string, entradas: unknown = ENTRADAS, perfil: Perfil = "OPERATION") => {
    entrarComo(perfil);
    return lida<ConferenciaDoMdfe & Corpo>(await conferenciaRota.POST(req("POST", { manifestId, ufDeDescarga, entradas })));
  };
  const emitir = async (manifestId: string, ufDeDescarga = "MG", entradas: unknown = ENTRADAS, perfil: Perfil = "OPERATION") => {
    entrarComo(perfil);
    return lida<ResultadoDaEmissao & Corpo>(await emissaoRota.POST(req("POST", { manifestId, ufDeDescarga, entradas })));
  };
  const encerrar = async (mdfeId: string, trocas: Record<string, unknown> = {}, perfil: Perfil = "OPERATION") => {
    entrarComo(perfil);
    return lida<MdfeEmitido & Corpo>(await encerrarRota.POST(req("POST", { dia: hoje(), cidade: "belo horizonte", uf: "MG", ...trocas }), ctx(mdfeId)));
  };
  const cancelar = async (mdfeId: string, trocas: Record<string, unknown> = {}, perfil: Perfil = "OPERATION") => {
    entrarComo(perfil);
    return lida<MdfeEmitido & Corpo>(await cancelarRota.POST(req("POST", { justificativa: "Viagem cancelada pelo cliente antes da saída", transporteNaoIniciado: true, ...trocas }), ctx(mdfeId)));
  };
  const incluirCondutor = async (mdfeId: string, condutor: Record<string, unknown> = { nome: "Maria de Souza", cpf: "111.444.777-35" }, perfil: Perfil = "OPERATION") => {
    entrarComo(perfil);
    return lida<MdfeEmitido & Corpo>(await condutorRota.POST(req("POST", condutor), ctx(mdfeId)));
  };
  const listar = async (perfil: Perfil = "OPERATION", manifestId: string | null = null) => {
    entrarComo(perfil);
    return lida<MdfeEmitido[]>(await listaRota.GET(req("GET", undefined, `http://localhost/api/fiscal/mdfe${manifestId ? `?manifestId=${manifestId}` : ""}`)));
  };

  const hoje = () => new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);

  /** Um veículo com tudo o que o MDF-e pede. Cada chamada cria uma placa nova. */
  async function novoVeiculo(trocas: Record<string, unknown> = {}) {
    const numero = (sequencia += 1);
    return banco.default.vehicle.create({
      data: { plate: `MDF${numero % 10}T${String(numero).padStart(2, "0").slice(-2)}`, model: "Truck de teste", type: "TRUCK", capacity: 14000, renavam: "12345678901", tareKg: 8500, wheelType: "01", bodyType: "02", licenseState: "SP", ...trocas },
      select: { id: true, plate: true },
    });
  }

  /**
   * Uma viagem em rota, com uma carga por destino pedido. Cada carga ganha o
   * CT-e autorizado em homologação (gravado direto: a emissão do CT-e tem os
   * próprios testes), com o XML que diz o município de início e o de fim.
   */
  async function novaViagem(destinos: (keyof typeof DESTINOS)[] = ["MG", "UDI"], trocas: { veiculoId?: string; semCte?: boolean; ambienteDoCte?: string; status?: string; comNfe?: boolean } = {}) {
    const veiculoId = trocas.veiculoId ?? (await novoVeiculo()).id;
    // Em montagem a viagem ainda não saiu: as cargas estão coletadas, alocadas nela.
    const emMontagem = trocas.status === "ASSEMBLING";
    const viagem = await banco.default.manifest.create({ data: { driverId: motoristaId, vehicleId: veiculoId, status: trocas.status ?? "ROUTE", departedAt: emMontagem ? null : new Date() }, select: { id: true } });
    const cargas: { id: string; chave: string | null }[] = [];
    for (const destino of destinos) {
      const numero = 7000 + (sequencia += 1);
      const local = DESTINOS[destino];
      const carga = await banco.default.collection.create({
        data: {
          clientId: clienteId,
          manifestId: viagem.id,
          sender: "Indústria Remetente S/A",
          receiver: "Comércio Destinatário Ltda",
          origin: "São José do Rio Preto - SP",
          destination: local.texto,
          volumes: 10,
          weight: 500,
          invoiceValue: 10000,
          invoiceKey: trocas.comNfe ? chaveDeExemplo("55", numero, "35", CNPJ_DA_PADRAO) : null,
          freightValue: 800,
          status: emMontagem ? "COLLECTED" : "ROUTE",
          trackingCode: `96${String(Date.now() % 1_000_000).padStart(6, "0")}${String(numero % 100).padStart(2, "0")}`,
        },
        select: { id: true },
      });
      let chave: string | null = null;
      if (!trocas.semCte) {
        const montado = montarCte(dadosDeExemplo({ numero, fim: { codigoMunicipio: local.codigoMunicipio, municipio: local.municipio, uf: local.uf }, valorDaCarga: 10000, pesoKg: 500, produto: "Peças automotivas" }));
        chave = montado.chave;
        await banco.default.cte.create({
          data: { collectionId: carga.id, environment: trocas.ambienteDoCte ?? "HOMOLOGACAO", series: 1, number: numero, accessKey: montado.chave, status: "AUTHORIZED", xmlSent: montado.xml, issuedAt: new Date(), authorizedAt: new Date(), protocol: "135260000000001" },
          select: { id: true },
        });
      }
      cargas.push({ id: carga.id, chave });
    }
    return { id: viagem.id, veiculoId, cargas };
  }

  const mdfesDe = (manifestId: string) => banco.sistema.mdfe.findMany({ where: { manifestId }, orderBy: { createdAt: "asc" }, include: { events: { orderBy: { registeredAt: "asc" } } } });
  const trilha = (acao: string) => banco.sistema.auditLog.findMany({ where: { ...DAS_EMPRESAS, action: acao, userName: { startsWith: PREFIXO } }, orderBy: { createdAt: "asc" } });
  const avisosDe = (perfil: Perfil, tipo: string) => banco.sistema.notification.findMany({ where: { userId: ids[perfil], type: tipo } });
  const numeracao = async (ambiente = "HOMOLOGACAO", serie = 1) =>
    (await banco.sistema.mdfeNumbering.findFirst({ where: { tenantId: EMPRESA_PADRAO.id, environment: ambiente, series: serie }, select: { nextNumber: true } }))?.nextNumber ?? null;
  const servicosChamados = () => sefaz.chamadas.map((chamada) => chamada.servico);

  async function limparMovimento() {
    const { sistema } = banco;
    await sistema.outboxEvent.deleteMany({ where: DAS_EMPRESAS });
    await sistema.webhook.deleteMany({ where: DAS_EMPRESAS });
    await sistema.mdfeEvent.deleteMany({ where: DAS_EMPRESAS });
    await sistema.mdfe.deleteMany({ where: DAS_EMPRESAS });
    await sistema.mdfeNumbering.deleteMany({ where: DAS_EMPRESAS });
    await sistema.cte.deleteMany({ where: DAS_EMPRESAS });
    await sistema.cteNumbering.deleteMany({ where: DAS_EMPRESAS });
    await sistema.fiscalIssuer.deleteMany({ where: DAS_EMPRESAS });
    await sistema.collection.deleteMany({ where: { client: { companyName: { startsWith: PREFIXO } } } });
    await sistema.manifest.deleteMany({ where: { driver: { user: { email: { startsWith: PREFIXO } } } } });
    await sistema.vehicle.deleteMany({ where: { ...DAS_EMPRESAS, plate: { startsWith: "MDF" } } });
    await sistema.notification.deleteMany({ where: { user: { email: { startsWith: PREFIXO } } } });
    await sistema.auditLog.deleteMany({ where: { ...DAS_EMPRESAS, userName: { startsWith: PREFIXO } } });
  }

  async function limpar() {
    await limparMovimento();
    await banco.sistema.driver.deleteMany({ where: { user: { email: { startsWith: PREFIXO } } } });
    await banco.sistema.user.deleteMany({ where: { email: { startsWith: PREFIXO } } });
    await banco.sistema.client.deleteMany({ where: { companyName: { startsWith: PREFIXO } } });
  }

  const anteriores = { chave: process.env.TMS_CHAVE_DE_DADOS, url: process.env.NEXTAUTH_URL, local: process.env.TMS_WEBHOOK_PERMITE_LOCAL, fiscal: process.env.FISCAL_MCP_URL };
  const restaurar = (nome: string, valor: string | undefined) => {
    if (valor === undefined) delete process.env[nome];
    else process.env[nome] = valor;
  };

  beforeAll(async () => {
    sefaz = await subirSefazDoMdfe();
    usarSefazDeTesteDoMdfe({ url: sefaz.url, autoridades: sefaz.autoridades, tempoLimiteMs: 1500 });
    certificado = certificadoDeTeste({ cnpj: CNPJ_DA_PADRAO, senha: SENHA });

    // O mesmo servidor local faz de n8n (/n8n) e de serviço fiscal (/mcp, só o bastante para `gerar_damdfe`).
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
        const estruturado = { pdf_base64: Buffer.from("%PDF-1.4 damdfe de mentira").toString("base64"), autorizado: fiscalDizAutorizado };
        resposta.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: { structuredContent: estruturado, content: [] } }));
      });
    });
    await new Promise<void>((resolve) => n8n.listen(0, "127.0.0.1", resolve));
    enderecoDoN8n = `http://127.0.0.1:${(n8n.address() as AddressInfo).port}/n8n`;
    enderecoDoFiscal = `http://127.0.0.1:${(n8n.address() as AddressInfo).port}/mcp`;
    delete process.env.FISCAL_MCP_URL;

    process.env.TMS_CHAVE_DE_DADOS = "chave-de-dados-dos-testes-do-mdfe-0123456789-abcdef";
    process.env.NEXTAUTH_URL = "https://tms.exemplo.br";
    process.env.TMS_WEBHOOK_PERMITE_LOCAL = "1";
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => void logs.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : typeof a === "string" ? a : JSON.stringify(a))).join(" ")));

    banco = await import("../src/lib/prisma");
    mdfeDb = await import("../src/lib/mdfe-db");
    fiscalRota = await import("../src/app/api/empresa/fiscal/route");
    certificadoRota = await import("../src/app/api/empresa/fiscal/certificado/route");
    listaRota = await import("../src/app/api/fiscal/mdfe/route");
    situacaoRota = await import("../src/app/api/fiscal/mdfe/situacao/route");
    statusRota = await import("../src/app/api/fiscal/mdfe/status-servico/route");
    abertosRota = await import("../src/app/api/fiscal/mdfe/nao-encerrados/route");
    configuracaoRota = await import("../src/app/api/fiscal/mdfe/configuracao/route");
    conferenciaRota = await import("../src/app/api/fiscal/mdfe/conferencia/route");
    emissaoRota = await import("../src/app/api/fiscal/mdfe/emissao/route");
    xmlRota = await import("../src/app/api/fiscal/mdfe/emissao/[id]/xml/route");
    damdfeRota = await import("../src/app/api/fiscal/mdfe/emissao/[id]/damdfe/route");
    encerrarRota = await import("../src/app/api/fiscal/mdfe/emissao/[id]/encerrar/route");
    cancelarRota = await import("../src/app/api/fiscal/mdfe/emissao/[id]/cancelar/route");
    condutorRota = await import("../src/app/api/fiscal/mdfe/emissao/[id]/condutor/route");
    liberarRota = await import("../src/app/api/manifestos/[id]/liberar/route");
    eventos = await import("../src/lib/eventos");
    await limpar();

    const outra = banco.paraEmpresa(EMPRESA_OUTRA.id).db;
    clienteId = (await banco.default.client.create({ data: { companyName: `${PREFIXO}Indústria Remetente S/A`, cnpj: REMETENTE.documento, ie: "110042490114" } })).id;
    for (const perfil of ["ADMIN", "OPERATION", "FINANCE", "EXPEDITION", "COMMERCIAL"] as const) {
      ids[perfil] = (await banco.default.user.create({ data: { name: `${PREFIXO}${perfil}`, email: `${PREFIXO}${perfil.toLowerCase()}@exemplo.br`, password: HASH_FALSO, role: perfil } })).id;
    }
    ids.ADMIN_DA_OUTRA = (await outra.user.create({ data: { name: `${PREFIXO}admin-da-outra`, email: `${PREFIXO}admin-da-outra@exemplo.br`, password: HASH_FALSO, role: "ADMIN" } })).id;
    const doMotorista = await banco.default.user.create({ data: { name: `${PREFIXO}João Motorista`, email: `${PREFIXO}motorista@exemplo.br`, password: HASH_FALSO, role: "DRIVER" } });
    motoristaId = (await banco.default.driver.create({ data: { userId: doMotorista.id, cpf: CPF_DO_MOTORISTA, cnh: "12345678900", cnhExpiry: new Date("2030-01-01"), category: "E" } })).id;
  }, 180_000);

  beforeEach(async () => {
    sessao.mockReset();
    sefaz.modo = "autorizar";
    sefaz.modoDe = {};
    sefaz.atrasoMs = 0;
    sefaz.consultasCegas = 0;
    sefaz.chamadas.length = 0;
    sefaz.autorizados.clear();
    sefaz.encerrados.clear();
    sefaz.cancelados.clear();
    sefaz.abertosDeFora = [];
    sefaz.eventos.length = 0;
    recebidosNoN8n = [];
    pedidosAoFiscal.length = 0;
    fiscalDizAutorizado = true;
    delete process.env.FISCAL_MCP_URL;
    await limparMovimento();
  });

  afterAll(async () => {
    usarSefazDeTesteDoMdfe(null);
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

  describe("permissão e validação", () => {
    it("sem sessão é 401; quem não lê o fiscal não lê MDF-e; quem só lê não emite nem envia evento; configuração é do administrador", async () => {
      const leitura: [string, () => Promise<Response>][] = [
        ["GET lista", () => listaRota.GET(req())],
        ["GET situação", () => situacaoRota.GET()],
        ["GET status", () => statusRota.GET()],
        ["GET não encerrados", () => abertosRota.GET()],
        ["GET emissão", () => emissaoRota.GET(req("GET", undefined, `http://localhost/x?manifestId=${SEM_ID}`))],
        ["POST conferência", () => conferenciaRota.POST(req("POST", { manifestId: SEM_ID, ufDeDescarga: "MG" }))],
        ["GET xml", () => xmlRota.GET(req(), ctx(SEM_ID))],
        ["GET damdfe", () => damdfeRota.GET(req(), ctx(SEM_ID))],
      ];
      const escrita: [string, () => Promise<Response>][] = [
        ["POST emissão", () => emissaoRota.POST(req("POST", { manifestId: SEM_ID, ufDeDescarga: "MG" }))],
        ["POST encerrar", () => encerrarRota.POST(req("POST", { dia: hoje(), cidade: "Belo Horizonte", uf: "MG" }), ctx(SEM_ID))],
        ["POST cancelar", () => cancelarRota.POST(req("POST", { justificativa: "Tentativa de quem não pode", transporteNaoIniciado: true }), ctx(SEM_ID))],
        ["POST condutor", () => condutorRota.POST(req("POST", { nome: "Maria", cpf: "11144477735" }), ctx(SEM_ID))],
      ];
      const daEmpresa: [string, () => Promise<Response>][] = [
        ["GET configuração", () => configuracaoRota.GET()],
        ["PUT configuração", () => configuracaoRota.PUT(req("PUT", { serie: "1", proximoNumero: "1", tipoDeEmitente: "1" }))],
      ];
      for (const [nome, chamar] of [...leitura, ...escrita, ...daEmpresa]) {
        entrarComo(null);
        expect((await chamar()).status, `${nome} sem sessão`).toBe(401);
      }
      for (const [nome, chamar] of [...leitura, ...escrita]) {
        entrarComo("COMMERCIAL");
        expect((await chamar()).status, `${nome} COMMERCIAL`).toBe(403);
      }
      for (const [nome, chamar] of escrita) {
        for (const perfil of ["FINANCE", "EXPEDITION"] as const) {
          entrarComo(perfil);
          expect((await chamar()).status, `${nome} ${perfil}`).toBe(403);
        }
      }
      for (const [nome, chamar] of daEmpresa) {
        for (const perfil of ["OPERATION", "FINANCE", "EXPEDITION", "COMMERCIAL"] as const) {
          entrarComo(perfil);
          expect((await chamar()).status, `${nome} ${perfil}`).toBe(403);
        }
      }
      // Quem só lê o fiscal lê a lista.
      expect((await listar("EXPEDITION")).status).toBe(200);
      expect(sefaz.chamadas).toHaveLength(0);
    });

    it("corpo fora do formato é 400, com a frase do campo", async () => {
      entrarComo("OPERATION");
      expect((await lida(await emissaoRota.GET(req()))).status).toBe(400);
      expect((await lida(await emissaoRota.POST(req("POST", { manifestId: SEM_ID })))).corpo.error).toBe("Informe a UF de descarregamento do MDF-e.");
      expect((await lida(await emissaoRota.POST(req("POST", { manifestId: SEM_ID, ufDeDescarga: "MG", entradas: { ciots: [{ codigo: "12", documento: CNPJ_DA_PADRAO }] } })))).corpo.error).toBe("O CIOT tem 12 dígitos.");
      expect((await encerrar(SEM_ID, { dia: "11/10/2026" })).status).toBe(400);
      expect((await cancelar(SEM_ID, { transporteNaoIniciado: false })).corpo.error).toBe(CONFIRME_QUE_NAO_SAIU);
      expect((await cancelar(SEM_ID, { justificativa: "curta" })).status).toBe(400);
      expect((await incluirCondutor(SEM_ID, { nome: "Maria", cpf: "11144477736" })).corpo.error).toBe("Informe um CPF válido para o condutor.");
      expect((await configurar({ serie: "950" })).status).toBe(400);
      // Com o corpo certo, o que não existe é 404.
      await prepararEmpresa();
      expect((await encerrar(SEM_ID)).corpo.error).toBe(MDFE_NAO_ENCONTRADO);
      expect((await emitir(SEM_ID)).corpo.error).toBe(VIAGEM_NAO_ENCONTRADA);
      expect((await daViagem(SEM_ID)).status).toBe(404);
    });
  });

  /* ------------------------------- Configuração ------------------------------ */

  describe("configuração", () => {
    it("sem os dados fiscais não há o que configurar; depois, grava série, tipo de emitente e seguro, com auditoria", async () => {
      entrarComo("ADMIN");
      expect((await lida<ConfiguracaoDoMdfe>(await configuracaoRota.GET())).corpo).toMatchObject({ disponivel: false, ambiente: null });
      expect((await configurar()).corpo.error).toBe(SEM_EMITENTE_CADASTRADO);

      await prepararEmpresa();
      const salvo = await configurar({ serie: "3", proximoNumero: "120", tipoDeEmitente: "2", seguradora: "Seguradora X", cnpjDaSeguradora: "61.198.164/0001-60", apolice: "AP-9" });
      expect(salvo.status).toBe(200);
      expect(salvo.corpo).toMatchObject({ disponivel: true, ambiente: "HOMOLOGACAO", serie: 3, proximoNumero: 120, tipoDeEmitente: "2", seguradora: "Seguradora X", cnpjDaSeguradora: "61198164000160", apolice: "AP-9" });
      expect(await numeracao("HOMOLOGACAO", 3)).toBe(120);
      const registro = await trilha("mdfe.configurar");
      expect(registro).toHaveLength(1);
      expect(registro[0].after).toMatchObject({ mdfeSeries: 3, mdfeEmitterType: "2", proximoNumero: 120 });

      entrarComo("OPERATION");
      expect((await lida<SituacaoDaEmissao>(await situacaoRota.GET())).corpo).toMatchObject({ pronta: true, ambiente: "HOMOLOGACAO", tipoDeEmitente: "2", damdfe: false, faltas: [] });
    });

    it("o próximo número não fica abaixo de um MDF-e já autorizado", async () => {
      await prepararEmpresa();
      const viagem = await novaViagem();
      expect((await emitir(viagem.id)).corpo.autorizado).toBe(true);
      const recusa = await configurar({ proximoNumero: "1" });
      expect(recusa.status).toBe(409);
      expect(recusa.corpo.error).toMatch(/Já existe o MDF-e nº 1 autorizado.*precisa ser 2 ou maior/);
      expect((await configurar({ proximoNumero: "50" })).status).toBe(200);
      expect(await numeracao()).toBe(50);
    });
  });

  /* -------------------------------- Conferência ------------------------------ */

  describe("conferir", () => {
    it("empresa sem dados fiscais e sem certificado: a aba diz o que falta e nada é emitido", async () => {
      const viagem = await novaViagem();
      const semNada = await daViagem(viagem.id);
      expect(semNada.status).toBe(200);
      expect(semNada.corpo.pronta).toBe(false);
      expect(semNada.corpo.faltas[0]).toBe(SEM_EMITENTE_CADASTRADO);
      expect(semNada.corpo.documentos[0].resumo).toBeNull();
      expect((await emitir(viagem.id)).status).toBe(409);
      expect(sefaz.chamadas).toHaveLength(0);
      expect(await mdfesDe(viagem.id)).toHaveLength(0);
    });

    it("um documento por UF de descarregamento, com os municípios, o que falta e o que o cadastro sugere", async () => {
      await prepararEmpresa();
      await configurar({ seguradora: "Seguradora de Teste S/A", cnpjDaSeguradora: "61198164000160", apolice: "AP-2026-0001" });
      const viagem = await novaViagem(["MG", "UDI", "MG", "RJ"]);
      const { corpo } = await daViagem(viagem.id, "EXPEDITION");
      expect(corpo.pronta).toBe(true);
      expect(corpo.documentos.map((documento) => documento.ufDeDescarga)).toEqual(["MG", "RJ"]);

      const [mg, rj] = corpo.documentos;
      expect(mg.resumo).toMatchObject({ ambiente: "HOMOLOGACAO", serie: 1, numeroPrevisto: 1, tipoDeEmitente: "1", ufDeInicio: "SP", ufDeFim: "MG", documentos: 3, percurso: [], lotacao: false, valorDaCarga: 30000, pesoKg: 1500 });
      expect(mg.resumo?.descargas).toEqual([
        { municipio: "Belo Horizonte", documentos: 2 },
        { municipio: "Uberlândia", documentos: 1 },
      ]);
      // Sem nada informado: falta o CIOT e a averbação; o seguro padrão e o produto dos CT-e vêm sugeridos.
      expect(mg.pendencias.join(" ")).toMatch(/Informe o CIOT/);
      expect(mg.pendencias.join(" ")).toMatch(/averbação/);
      expect(mg.entradas.seguro).toMatchObject({ seguradora: "Seguradora de Teste S/A", apolice: "AP-2026-0001", averbacoes: [] });
      expect(mg.entradas.produto).toMatchObject({ tipoDeCarga: "05", descricao: "Peças automotivas" });
      expect(mg.mdfe).toBeNull();
      // O do RJ tem um documento só: carga lotação.
      expect(rj.resumo).toMatchObject({ ufDeFim: "RJ", documentos: 1, lotacao: true });
      expect(rj.pendencias.join(" ")).toMatch(/NCM/);

      // Com o que a pessoa informou, a conferência fica limpa. Nada foi gravado nem enviado.
      const conferido = await conferir(viagem.id, "MG");
      expect(conferido.status).toBe(200);
      expect(conferido.corpo.pendencias).toEqual([]);
      expect(sefaz.chamadas).toHaveLength(0);
      expect(await mdfesDe(viagem.id)).toHaveLength(0);
    });

    it("percurso com mais de um caminho fica pendente até a pessoa informar; carga sem CT-e e veículo incompleto também", async () => {
      await prepararEmpresa();
      const paraGoias = await novaViagem(["GO", "GO"]);
      const semPercurso = await conferir(paraGoias.id, "GO");
      expect(semPercurso.corpo.pendencias[0]).toMatch(/Informe as UFs do percurso entre SP e GO/);
      expect(semPercurso.corpo.resumo).toMatchObject({ percurso: null, opcoesDePercurso: [["MG"], ["MS"]] });
      expect((await emitir(paraGoias.id, "GO")).status).toBe(409);
      expect((await conferir(paraGoias.id, "GO", { ...ENTRADAS, percurso: ["MS"] })).corpo.pendencias).toEqual([]);
      expect((await conferir(paraGoias.id, "GO", { ...ENTRADAS, percurso: ["PR"] })).corpo.pendencias[0]).toMatch(/não fazem divisa/);

      const incompleto = await novoVeiculo({ tareKg: null, wheelType: null, bodyType: null });
      const semCte = await novaViagem(["MG", "UDI"], { veiculoId: incompleto.id, semCte: true });
      const faltas = (await conferir(semCte.id, "MG")).corpo.pendencias.join("\n");
      expect(faltas).toMatch(new RegExp(`Falta no cadastro do veículo ${incompleto.plate} \\(Frota\\): tara \\(kg\\), tipo de rodado, tipo de carroceria`));
      expect(faltas).toMatch(/não tem CT-e autorizado neste ambiente/);
      const recusa = await emitir(semCte.id);
      expect(recusa.status).toBe(409);
      expect(sefaz.chamadas).toHaveLength(0);
      expect(await numeracao()).toBeNull();
    });

    it("CT-e de produção não vale para MDF-e de homologação", async () => {
      await prepararEmpresa();
      const viagem = await novaViagem(["MG", "UDI"], { ambienteDoCte: "PRODUCAO" });
      expect((await conferir(viagem.id, "MG")).corpo.pendencias.join(" ")).toMatch(/não tem CT-e autorizado neste ambiente/);
    });
  });

  /* ---------------------------------- Emissão -------------------------------- */

  describe("emitir", () => {
    it("consulta os não encerrados, envia e só então grava autorizado, com protocolo, XML válido, auditoria, aviso e evento para o n8n", async () => {
      await prepararEmpresa();
      entrarComo("ADMIN");
      await banco.default.webhook.create({ data: { url: enderecoDoN8n, secret: "segredo-do-teste-de-mdfe-0123456789" } });
      const viagem = await novaViagem(["MG", "UDI", "MG"]);

      const { status, corpo } = await emitir(viagem.id);
      expect(status).toBe(200);
      expect(corpo.autorizado).toBe(true);
      expect(corpo.mensagem).toMatch(/^MDF-e nº 1 autorizado em homologação \(sem valor fiscal\)\. Protocolo \d{15}\.$/);
      expect(corpo.mdfe).toMatchObject({ situacao: "AUTHORIZED", ambiente: "HOMOLOGACAO", serie: 1, numero: 1, tipoDeEmitente: "1", ufDeInicio: "SP", ufDeFim: "MG", semResposta: false, cStat: 100 });
      expect(chaveValida(corpo.mdfe.chave)).toBe(true);
      expect(corpo.mdfe.chave.slice(20, 22)).toBe("58");
      expect(JSON.stringify(corpo)).not.toContain("<MDFe");

      // A ordem das conversas: primeiro a consulta de não encerrados, depois a recepção.
      expect(servicosChamados()).toEqual(["MDFeConsNaoEnc", "MDFeRecepcaoSinc"]);
      expect(sefaz.chamadas.every((chamada) => chamada.certificadoDoCliente === impressaoDigital(certificado.certificadoPem))).toBe(true);

      const [gravado] = await mdfesDe(viagem.id);
      expect(gravado).toMatchObject({ status: "AUTHORIZED", number: 1, unloadState: "MG", loadState: "SP", emitterType: "1", sendingAt: null, unanswered: false });
      expect(gravado.protocol).toBe(sefaz.autorizados.get(gravado.accessKey)?.protocolo);
      // O que foi para a SEFAZ é o que está guardado, assinado pelo certificado da empresa e válido no esquema oficial.
      expect(sefaz.chamadas[1].dados).toBe(gravado.xmlSent);
      expect(assinaturaConfere(gravado.xmlSent, certificado.certificadoPem)).toBe(true);
      expect(await errosNoEsquemaDoMdfe(gravado.xmlSent, "mdfe_v3.00.xsd")).toEqual([]);
      expect(await errosNoEsquemaDoMdfe(modalDoXml(gravado.xmlSent), "mdfeModalRodoviario_v3.00.xsd")).toEqual([]);
      expect(await errosNoEsquemaDoMdfe(gravado.xmlReturn ?? "", "procMDFe_v3.00.xsd")).toEqual([]);
      // O documento: os três CT-e em dois municípios, o veículo e o motorista da viagem, o seguro e o CIOT informados.
      for (const carga of viagem.cargas) expect(gravado.xmlSent).toContain(`<chCTe>${carga.chave}</chCTe>`);
      expect(gravado.xmlSent).toContain("<qCTe>3</qCTe>");
      expect(gravado.xmlSent.match(/<infMunDescarga>/g)).toHaveLength(2);
      expect(gravado.xmlSent).toContain(`<placa>${gravado.plate}</placa><RENAVAM>12345678901</RENAVAM><tara>8500</tara><capKG>14000</capKG>`);
      expect(gravado.xmlSent).toContain(`<condutor><xNome>${PREFIXO}João Motorista</xNome><CPF>${CPF_DO_MOTORISTA}</CPF></condutor>`);
      expect(gravado.xmlSent).toContain("<nAver>AV-0001</nAver>");
      expect(gravado.xmlSent).toContain(`<infContratante><xNome>${PREFIXO}Indústria Remetente S/A</xNome><CNPJ>${REMETENTE.documento}</CNPJ></infContratante>`);
      expect(gravado.xmlSent).toContain("<tpAmb>2</tpAmb>");

      expect(await numeracao()).toBe(2);
      const registro = await trilha("mdfe.emitir");
      expect(registro).toHaveLength(1);
      expect(registro[0].summary).toMatch(/MDF-e nº 1 autorizado em homologação \(sem valor fiscal\) para a viagem #.{6} \(descarga em MG\)/);
      // O aviso vai para quem lê o fiscal, menos para quem emitiu.
      expect((await avisosDe("ADMIN", "mdfe.autorizado")).map((aviso) => aviso.title)).toEqual(["MDF-e nº 1 autorizado (homologação)"]);
      expect(await avisosDe("EXPEDITION", "mdfe.autorizado")).toHaveLength(1);
      expect(await avisosDe("OPERATION", "mdfe.autorizado")).toHaveLength(0);
      expect(await avisosDe("COMMERCIAL", "mdfe.autorizado")).toHaveLength(0);

      await eventos.despacharPendentes();
      expect(avisosDeMdfeNoN8n().map((recebido) => recebido.tipo)).toEqual(["mdfe.autorizado"]);
      expect(avisosDeMdfeNoN8n()[0].dados.mdfe).toMatchObject({ numero: 1, ambiente: "HOMOLOGACAO", situacao: "AUTHORIZED", chave: gravado.accessKey, ufDeDescarregamento: "MG", placa: gravado.plate });
      expect(JSON.stringify(recebidosNoN8n)).not.toContain("<MDFe");

      // Emitir de novo não cria outro.
      expect((await emitir(viagem.id)).corpo.error).toBe(JA_AUTORIZADO);
      expect(await mdfesDe(viagem.id)).toHaveLength(1);
      expect((await listar("EXPEDITION", viagem.id)).corpo.map((mdfe) => mdfe.numero)).toEqual([1]);
    });

    it("viagem com duas UFs de descarregamento: um MDF-e para cada, numerados em sequência", async () => {
      await prepararEmpresa();
      const viagem = await novaViagem(["MG", "UDI", "RJ", "RJ"]);
      expect((await emitir(viagem.id, "MG")).corpo.mdfe).toMatchObject({ numero: 1, ufDeFim: "MG" });
      expect((await emitir(viagem.id, "RJ")).corpo.mdfe).toMatchObject({ numero: 2, ufDeFim: "RJ" });
      const gravados = await mdfesDe(viagem.id);
      expect(gravados.map((mdfe) => [mdfe.unloadState, mdfe.status])).toEqual([
        ["MG", "AUTHORIZED"],
        ["RJ", "AUTHORIZED"],
      ]);
      expect(gravados[1].xmlSent).toContain("<UFIni>SP</UFIni><UFFim>RJ</UFFim>");
      expect(gravados[1].xmlSent).toContain("<qCTe>2</qCTe>");
      expect((await emitir(viagem.id, "GO")).status).toBe(409);
    });

    it("carga lotação (um documento): exige NCM, CEPs e pagamento; com eles, autoriza", async () => {
      await prepararEmpresa();
      const viagem = await novaViagem(["MG"]);
      expect((await emitir(viagem.id)).corpo.error).toMatch(/carga lotação/);
      const entradas = {
        ...ENTRADAS,
        produto: { tipoDeCarga: "05", descricao: "Rolamentos", ncm: "84821010" },
        lotacao: { cepDeCarregamento: "15035-000", cepDeDescarregamento: "30160-011" },
        pagamento: { documento: REMETENTE.documento, valor: "800", aPrazo: false, conta: { pix: "financeiro@exemplo.br" } },
      };
      const { corpo } = await emitir(viagem.id, "MG", entradas);
      expect(corpo.autorizado).toBe(true);
      const [gravado] = await mdfesDe(viagem.id);
      expect(gravado.xmlSent).toContain("<NCM>84821010</NCM><infLotacao>");
      expect(gravado.xmlSent).toContain("<vContrato>800.00</vContrato><indPag>0</indPag><infBanc><PIX>financeiro@exemplo.br</PIX></infBanc>");
      expect(await errosNoEsquemaDoMdfe(modalDoXml(gravado.xmlSent), "mdfeModalRodoviario_v3.00.xsd")).toEqual([]);
    });

    it("carga própria: relaciona as NF-e das cargas (tpEmit 2), sem seguro nem CIOT", async () => {
      await prepararEmpresa();
      await configurar({ tipoDeEmitente: "2" });
      const viagem = await novaViagem(["MG", "UDI"], { semCte: true, comNfe: true });
      const { corpo } = await emitir(viagem.id, "MG", {});
      expect(corpo.autorizado).toBe(true);
      expect(corpo.mdfe.tipoDeEmitente).toBe("2");
      const [gravado] = await mdfesDe(viagem.id);
      expect(gravado.xmlSent).toContain("<tpEmit>2</tpEmit>");
      expect(gravado.xmlSent).toContain("<qNFe>2</qNFe>");
      expect(gravado.xmlSent).not.toContain("<infCTe>");
      expect(await errosNoEsquemaDoMdfe(gravado.xmlSent, "mdfe_v3.00.xsd")).toEqual([]);
    });

    it("rejeição: fica rejeitado com o código e o motivo, não consome o número, e a correção reenvia com o mesmo", async () => {
      await prepararEmpresa();
      const viagem = await novaViagem();
      sefaz.modoDe = { MDFeRecepcaoSinc: "rejeitar" };
      const rejeitado = await emitir(viagem.id);
      expect(rejeitado.status).toBe(200);
      expect(rejeitado.corpo.autorizado).toBe(false);
      expect(rejeitado.corpo.mensagem).toMatch(/^A SEFAZ rejeitou o MDF-e: 698 - Rejeição: Seguro da carga/);
      expect(rejeitado.corpo.mdfe).toMatchObject({ situacao: "REJECTED", numero: 1, cStat: 698, protocolo: null, autorizadoEm: null });
      expect(await trilha("mdfe.rejeitar")).toHaveLength(1);
      expect(await trilha("mdfe.emitir")).toHaveLength(0);
      expect(await avisosDe("ADMIN", "mdfe.autorizado")).toHaveLength(0);
      const chaveRejeitada = rejeitado.corpo.mdfe.chave;

      // Rejeitado não tem XML para baixar nem DAMDFE, não encerra e não cancela.
      entrarComo("OPERATION");
      expect((await lida(await xmlRota.GET(req(), ctx(rejeitado.corpo.mdfe.id)))).corpo.error).toBe(SO_AUTORIZADO_TEM_XML);
      expect((await lida(await damdfeRota.GET(req(), ctx(rejeitado.corpo.mdfe.id)))).corpo.error).toBe(SO_AUTORIZADO_TEM_DAMDFE);
      expect((await encerrar(rejeitado.corpo.mdfe.id)).corpo.error).toBe(SO_AUTORIZADO_ENCERRA);
      expect((await cancelar(rejeitado.corpo.mdfe.id)).corpo.error).toBe(SO_AUTORIZADO_CANCELA);

      sefaz.modoDe = {};
      const autorizado = await emitir(viagem.id);
      expect(autorizado.corpo.autorizado).toBe(true);
      expect(autorizado.corpo.mdfe.numero).toBe(1);
      // Documento novo: a chave muda (o código aleatório é outro), a linha é a mesma.
      expect(autorizado.corpo.mdfe.chave).not.toBe(chaveRejeitada);
      expect(autorizado.corpo.mdfe.id).toBe(rejeitado.corpo.mdfe.id);
      expect(await mdfesDe(viagem.id)).toHaveLength(1);
      expect(await numeracao()).toBe(2);
    });

    it("MDF-e daqui em aberto para a mesma placa e UF: a emissão para antes de enviar e diz qual encerrar", async () => {
      await prepararEmpresa();
      const veiculo = await novoVeiculo();
      const primeira = await novaViagem(["MG", "UDI"], { veiculoId: veiculo.id });
      expect((await emitir(primeira.id)).corpo.autorizado).toBe(true);

      const segunda = await novaViagem(["MG", "MG"], { veiculoId: veiculo.id });
      sefaz.chamadas.length = 0;
      const barrada = await emitir(segunda.id);
      expect(barrada.status).toBe(409);
      expect(barrada.corpo.error).toMatch(new RegExp(`O MDF-e nº 1 \\(viagem #.{6}\\) está autorizado e não encerrado para a placa ${veiculo.plate} com descarga em MG.*rejeição 611.*Encerre-o antes de emitir`));
      // Só a consulta foi feita: nada foi enviado, nenhum número foi reservado.
      expect(servicosChamados()).toEqual(["MDFeConsNaoEnc"]);
      expect(await mdfesDe(segunda.id)).toHaveLength(0);
      expect(await numeracao()).toBe(2);

      // A mesma placa para OUTRA UF não é barrada (a regra é por UF de descarregamento).
      const paraORio = await novaViagem(["RJ", "RJ"], { veiculoId: veiculo.id });
      expect((await emitir(paraORio.id, "RJ")).corpo.autorizado).toBe(true);

      // Encerrado o primeiro, a segunda emite.
      const [doPrimeiro] = await mdfesDe(primeira.id);
      expect((await encerrar(doPrimeiro.id)).status).toBe(200);
      expect((await emitir(segunda.id)).corpo.autorizado).toBe(true);
    });

    it("MDF-e em aberto emitido fora deste sistema: a tela mostra, e a rejeição 611 da SEFAZ volta com a orientação", async () => {
      await prepararEmpresa();
      const deFora = { chave: chaveDeExemplo("58", 99, "35", CNPJ_DA_PADRAO), protocolo: "935260000000099" };
      sefaz.abertosDeFora = [deFora];
      const viagem = await novaViagem();
      await emitir(viagem.id);
      sefaz.encerrados.clear();

      entrarComo("EXPEDITION");
      const abertos = await lida<RespostaDeNaoEncerrados>(await abertosRota.GET());
      expect(abertos.status).toBe(200);
      expect(abertos.corpo).toMatchObject({ ambiente: "HOMOLOGACAO", cStat: 111 });
      expect(abertos.corpo.mdfes).toHaveLength(2);
      expect(abertos.corpo.mdfes.find((aberto) => aberto.chave === deFora.chave)).toEqual({ ...deFora, mdfe: null });
      expect(abertos.corpo.mdfes.find((aberto) => aberto.chave !== deFora.chave)?.mdfe).toMatchObject({ numero: 1, ufDeFim: "MG" });

      // O de fora o sistema não sabe de que placa é: envia, e é a SEFAZ que rejeita.
      const outra = await novaViagem();
      sefaz.modoDe = { MDFeRecepcaoSinc: "nao-encerrado" };
      const rejeitado = await emitir(outra.id);
      expect(rejeitado.corpo.autorizado).toBe(false);
      expect(rejeitado.corpo.mdfe).toMatchObject({ situacao: "REJECTED", cStat: 611 });
      expect(rejeitado.corpo.mensagem).toMatch(/611 - Rejeição: Existe MDFe não encerrado para esta placa.*Há MDF-e anterior em aberto na SEFAZ: encerre-o/);
    });

    it("consulta de não encerrados fora do ar ou recusada: nada é enviado nem reservado", async () => {
      await prepararEmpresa();
      const viagem = await novaViagem();
      sefaz.modoDe = { MDFeConsNaoEnc: "mudo" };
      const semConsulta = await emitir(viagem.id);
      expect(semConsulta.status).toBe(504);
      expect(semConsulta.corpo.error).toMatch(/A consulta de MDF-e não encerrados é feita antes de emitir: nada foi enviado/);
      sefaz.modoDe = { MDFeConsNaoEnc: "rejeitar" };
      const recusada = await emitir(viagem.id);
      expect(recusada.status).toBe(409);
      expect(recusada.corpo.error).toMatch(/A SEFAZ recusou a consulta de MDF-e não encerrados: 203/);
      expect(servicosChamados()).not.toContain("MDFeRecepcaoSinc");
      expect(await mdfesDe(viagem.id)).toHaveLength(0);
      expect(await numeracao()).toBeNull();
    });

    it("envio sem resposta: fica 'sem resposta' com o mesmo XML; emitir de novo consulta pela chave e grava a autorização sem reenviar", async () => {
      await prepararEmpresa();
      const viagem = await novaViagem();
      sefaz.modoDe = { MDFeRecepcaoSinc: "mudo-processando" };
      const perdido = await emitir(viagem.id);
      expect(perdido.status).toBe(504);
      expect(perdido.corpo.error).toMatch(/A SEFAZ não respondeu no tempo limite\. O MDF-e ficou sem resposta/);
      const [rascunho] = await mdfesDe(viagem.id);
      expect(rascunho).toMatchObject({ status: "DRAFT", unanswered: true, number: 1, protocol: null, authorizedAt: null, sendingAt: null });
      // A SEFAZ processou, mas o sistema NÃO sabe: não diz autorizado.
      expect(sefaz.autorizados.has(rascunho.accessKey)).toBe(true);
      expect((await daViagem(viagem.id)).corpo.documentos[0].mdfe).toMatchObject({ situacao: "DRAFT", semResposta: true });

      sefaz.modoDe = {};
      sefaz.chamadas.length = 0;
      const retomado = await emitir(viagem.id);
      expect(retomado.corpo.autorizado).toBe(true);
      expect(retomado.corpo.mdfe).toMatchObject({ numero: 1, chave: rascunho.accessKey, situacao: "AUTHORIZED" });
      // Consultou os não encerrados (o próprio não barra), consultou pela chave e NÃO reenviou.
      expect(servicosChamados()).toEqual(["MDFeConsNaoEnc", "MDFeConsulta"]);
      const [gravado] = await mdfesDe(viagem.id);
      expect(gravado.xmlSent).toBe(rascunho.xmlSent);
      expect(await numeracao()).toBe(2);
    });

    it("envio sem resposta que NÃO chegou lá: a consulta diz 'não consta' e o MESMO XML é reenviado", async () => {
      await prepararEmpresa();
      const viagem = await novaViagem();
      sefaz.modoDe = { MDFeRecepcaoSinc: "mudo" };
      expect((await emitir(viagem.id)).status).toBe(504);
      const [rascunho] = await mdfesDe(viagem.id);
      expect(sefaz.autorizados.has(rascunho.accessKey)).toBe(false);

      sefaz.modoDe = {};
      sefaz.chamadas.length = 0;
      const retomado = await emitir(viagem.id);
      expect(retomado.corpo.autorizado).toBe(true);
      expect(servicosChamados()).toEqual(["MDFeConsNaoEnc", "MDFeConsulta", "MDFeRecepcaoSinc"]);
      expect(sefaz.chamadas[2].dados).toBe(rascunho.xmlSent);
      expect(retomado.corpo.mdfe.chave).toBe(rascunho.accessKey);
      expect(await mdfesDe(viagem.id)).toHaveLength(1);
    });

    it("'autorizado' sem protocolo ou para outra chave não autoriza; número já usado (539) queima o número; serviço parado não muda nada", async () => {
      await prepararEmpresa();
      const viagem = await novaViagem();
      for (const modo of ["sem-protocolo", "outra-chave"] as const) {
        sefaz.modoDe = { MDFeRecepcaoSinc: modo };
        const resposta = await emitir(viagem.id);
        expect(resposta.status, modo).toBe(502);
        expect((await mdfesDe(viagem.id))[0]).toMatchObject({ status: "DRAFT", unanswered: true, protocol: null });
        // Solta a marca de "sem resposta" para o próximo modo montar de novo.
        await banco.sistema.mdfe.updateMany({ where: { manifestId: viagem.id }, data: { unanswered: false } });
      }
      expect(await trilha("mdfe.emitir")).toHaveLength(0);

      sefaz.modoDe = { MDFeRecepcaoSinc: "parado" };
      const parado = await emitir(viagem.id);
      expect(parado.corpo).toMatchObject({ autorizado: false });
      expect(parado.corpo.mensagem).toMatch(/A SEFAZ não processou o MDF-e: 108/);
      expect(parado.corpo.mdfe.situacao).toBe("DRAFT");

      sefaz.modoDe = { MDFeRecepcaoSinc: "numero-usado" };
      const usado = await emitir(viagem.id);
      expect(usado.corpo.mensagem).toMatch(/539.*a próxima tentativa usa o número seguinte/);
      expect(usado.corpo.mdfe).toMatchObject({ situacao: "REJECTED", numero: 1 });
      sefaz.modoDe = {};
      const autorizado = await emitir(viagem.id);
      expect(autorizado.corpo.mdfe).toMatchObject({ situacao: "AUTHORIZED", numero: 2 });
      expect(await numeracao()).toBe(3);
    });

    it("duplicidade (204): o protocolo vem da consulta pela chave", async () => {
      await prepararEmpresa();
      const viagem = await novaViagem();
      sefaz.modoDe = { MDFeRecepcaoSinc: "mudo-processando" };
      await emitir(viagem.id);
      const [antes] = await mdfesDe(viagem.id);
      sefaz.modoDe = {};
      sefaz.consultasCegas = 1;
      sefaz.chamadas.length = 0;
      const resposta = await emitir(viagem.id);
      // A primeira consulta ainda não via o MDF-e (217): reenviou, a SEFAZ disse 204, e a segunda consulta trouxe o protocolo.
      expect(servicosChamados()).toEqual(["MDFeConsNaoEnc", "MDFeConsulta", "MDFeRecepcaoSinc", "MDFeConsulta"]);
      expect(resposta.corpo.autorizado).toBe(true);
      expect(resposta.corpo.mdfe.chave).toBe(antes.accessKey);
    });

    it("uma emissão por vez por MDF-e, e a numeração em concorrência não repete nem pula", async () => {
      await prepararEmpresa();
      const viagem = await novaViagem();
      sefaz.atrasoMs = 300;
      const [primeira, segunda] = await Promise.all([emitir(viagem.id), new Promise<Awaited<ReturnType<typeof emitir>>>((resolve) => setTimeout(() => resolve(emitir(viagem.id)), 150))]);
      expect([primeira.status, segunda.status].sort()).toEqual([200, 409]);
      expect([primeira, segunda].find((resposta) => resposta.status === 409)?.corpo.error).toBe(EMISSAO_EM_ANDAMENTO);
      expect(await mdfesDe(viagem.id)).toHaveLength(1);

      // Seis viagens, cada uma com o seu veículo, emitindo ao mesmo tempo.
      sefaz.atrasoMs = 50;
      const viagens = [];
      for (let i = 0; i < 6; i += 1) viagens.push(await novaViagem());
      entrarComo("OPERATION");
      const respostas6 = await Promise.all(viagens.map((cada) => emissaoRota.POST(req("POST", { manifestId: cada.id, ufDeDescarga: "MG", entradas: ENTRADAS })).then((res) => lida<ResultadoDaEmissao & Corpo>(res))));
      expect(respostas6.map((resposta) => resposta.status)).toEqual([200, 200, 200, 200, 200, 200]);
      expect(respostas6.every((resposta) => resposta.corpo.autorizado)).toBe(true);
      expect(respostas6.map((resposta) => resposta.corpo.mdfe.numero).sort((a, b) => a - b)).toEqual([2, 3, 4, 5, 6, 7]);
      expect(await numeracao()).toBe(8);
      expect(new Set(respostas6.map((resposta) => resposta.corpo.mdfe.chave)).size).toBe(6);
    }, 60_000);
  });

  /* ---------------------------------- Eventos -------------------------------- */

  describe("encerrar, cancelar e incluir condutor", () => {
    async function autorizado() {
      await prepararEmpresa();
      const viagem = await novaViagem();
      const { corpo } = await emitir(viagem.id);
      expect(corpo.autorizado).toBe(true);
      sefaz.chamadas.length = 0;
      return { viagem, mdfe: corpo.mdfe };
    }

    it("encerramento: só fica encerrado com o evento registrado; guarda o XML e o protocolo, audita, avisa e manda ao n8n", async () => {
      const { viagem, mdfe } = await autorizado();
      await banco.default.webhook.create({ data: { url: enderecoDoN8n, secret: "segredo-do-teste-de-mdfe-0123456789" } });

      expect((await encerrar(mdfe.id, { cidade: "Cidade Que Não Existe" })).status).toBe(400);
      const amanha = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
      expect((await encerrar(mdfe.id, { dia: amanha })).corpo.error).toBe(DATA_DE_ENCERRAMENTO_INVALIDA);
      expect((await encerrar(mdfe.id, { dia: "2020-01-01" })).corpo.error).toBe(DATA_DE_ENCERRAMENTO_INVALIDA);
      expect(sefaz.chamadas).toHaveLength(0);

      // A SEFAZ recusa: o MDF-e continua autorizado.
      sefaz.modoDe = { MDFeRecepcaoEvento: "rejeitar" };
      const recusado = await encerrar(mdfe.id);
      expect(recusado.status).toBe(409);
      expect(recusado.corpo.error).toMatch(/A SEFAZ recusou o encerramento: 615/);
      expect((await mdfesDe(viagem.id))[0]).toMatchObject({ status: "AUTHORIZED", closedAt: null });
      sefaz.modoDe = {};

      const { status, corpo } = await encerrar(mdfe.id);
      expect(status).toBe(200);
      expect(corpo).toMatchObject({ situacao: "CLOSED", numero: 1 });
      expect(corpo.encerradoEm).not.toBeNull();
      expect(corpo.eventos).toHaveLength(1);
      expect(corpo.eventos[0]).toMatchObject({ tipo: "110112", sequencia: 1 });
      expect(corpo.eventos[0].descricao).toMatch(/^Encerrado em Belo Horizonte\/MG, em \d{2}\/\d{2}\/\d{4}$/);
      expect(corpo.eventos[0].protocolo).toMatch(/^\d{15}$/);

      const [gravado] = await mdfesDe(viagem.id);
      expect(gravado).toMatchObject({ status: "CLOSED", closeProtocol: corpo.eventos[0].protocolo });
      const evento = gravado.events[0];
      expect(assinaturaConfere(evento.xmlSent, certificado.certificadoPem)).toBe(true);
      expect(evento.xmlSent).toContain(`<chMDFe>${mdfe.chave}</chMDFe>`);
      expect(evento.xmlSent).toContain(`<nProt>${mdfe.protocolo}</nProt><dtEnc>${hoje()}</dtEnc><cUF>31</cUF><cMun>3106200</cMun>`);
      expect(await errosNoEsquemaDoMdfe(evento.xmlSent, "eventoMDFe_v3.00.xsd")).toEqual([]);
      expect(await errosNoEsquemaDoMdfe(evento.xmlReturn, "procEventoMDFe_v3.00.xsd")).toEqual([]);
      expect(sefaz.encerrados.has(mdfe.chave)).toBe(true);

      expect((await trilha("mdfe.encerrar"))[0].summary).toMatch(/MDF-e nº 1 da viagem #.{6} encerrado em Belo Horizonte\/MG/);
      expect((await avisosDe("ADMIN", "mdfe.encerrado")).map((aviso) => aviso.title)).toEqual(["MDF-e nº 1 encerrado (homologação)"]);
      await eventos.despacharPendentes();
      expect(avisosDeMdfeNoN8n().map((recebido) => recebido.tipo)).toEqual(["mdfe.encerrado"]);
      expect(avisosDeMdfeNoN8n()[0].dados.mdfe).toMatchObject({ situacao: "CLOSED", protocoloDoEncerramento: corpo.eventos[0].protocolo });

      // Encerrado não se encerra, não se cancela e não recebe condutor; o XML continua disponível.
      expect((await encerrar(mdfe.id)).corpo.error).toBe(SO_AUTORIZADO_ENCERRA);
      expect((await cancelar(mdfe.id)).corpo.error).toBe(SO_AUTORIZADO_CANCELA);
      expect((await incluirCondutor(mdfe.id)).status).toBe(409);
      entrarComo("EXPEDITION");
      expect((await xmlRota.GET(req(), ctx(mdfe.id))).status).toBe(200);
    });

    it("encerramento cuja resposta se perdeu: a SEFAZ diz 'já encerrado' (609), a consulta confirma (132) e o MDF-e fica encerrado", async () => {
      const { viagem, mdfe } = await autorizado();
      sefaz.modoDe = { MDFeRecepcaoEvento: "mudo-processando" };
      const perdido = await encerrar(mdfe.id);
      expect(perdido.status).toBe(504);
      expect(perdido.corpo.error).toMatch(/O MDF-e continua como estava: tente de novo/);
      expect((await mdfesDe(viagem.id))[0].status).toBe("AUTHORIZED");

      sefaz.modoDe = {};
      const { status, corpo } = await encerrar(mdfe.id);
      expect(status).toBe(200);
      expect(corpo.situacao).toBe("CLOSED");
      expect(corpo.eventos[0]).toMatchObject({ tipo: "110112", protocolo: null });
      expect(servicosChamados().slice(-2)).toEqual(["MDFeRecepcaoEvento", "MDFeConsulta"]);
    });

    it("cancelamento: dentro de 24 horas, sem transporte iniciado, com a confirmação; só fica cancelado com o evento registrado", async () => {
      const { viagem, mdfe } = await autorizado();
      await banco.default.webhook.create({ data: { url: enderecoDoN8n, secret: "segredo-do-teste-de-mdfe-0123456789" } });

      // Carga já entregue: o transporte começou.
      await banco.sistema.collection.update({ where: { id: viagem.cargas[0].id }, data: { status: "DELIVERED" } });
      expect((await cancelar(mdfe.id)).corpo.error).toBe(TRANSPORTE_JA_INICIADO);
      await banco.sistema.collection.update({ where: { id: viagem.cargas[0].id }, data: { status: "ROUTE" } });

      // Autorizado há mais de 24 horas.
      await banco.sistema.mdfe.update({ where: { id: mdfe.id }, data: { authorizedAt: new Date(Date.now() - 25 * 3_600_000) } });
      expect((await cancelar(mdfe.id)).corpo.error).toBe(FORA_DO_PRAZO);
      await banco.sistema.mdfe.update({ where: { id: mdfe.id }, data: { authorizedAt: new Date() } });
      expect(sefaz.chamadas).toHaveLength(0);

      sefaz.modoDe = { MDFeRecepcaoEvento: "rejeitar" };
      expect((await cancelar(mdfe.id)).corpo.error).toMatch(/A SEFAZ recusou o cancelamento: 220/);
      expect((await mdfesDe(viagem.id))[0].status).toBe("AUTHORIZED");
      sefaz.modoDe = {};

      const { status, corpo } = await cancelar(mdfe.id);
      expect(status).toBe(200);
      expect(corpo).toMatchObject({ situacao: "CANCELLED" });
      expect(corpo.canceladoEm).not.toBeNull();
      const [gravado] = await mdfesDe(viagem.id);
      expect(gravado).toMatchObject({ status: "CANCELLED", cancelReason: "Viagem cancelada pelo cliente antes da saída" });
      expect(gravado.cancelProtocol).toMatch(/^\d{15}$/);
      expect(gravado.events[0].xmlSent).toContain("<xJust>Viagem cancelada pelo cliente antes da saída</xJust>");
      expect(await errosNoEsquemaDoMdfe(gravado.events[0].xmlSent, "eventoMDFe_v3.00.xsd")).toEqual([]);
      expect(await trilha("mdfe.cancelar")).toHaveLength(1);
      expect(await avisosDe("EXPEDITION", "mdfe.cancelado")).toHaveLength(1);
      await eventos.despacharPendentes();
      expect(avisosDeMdfeNoN8n().map((recebido) => recebido.tipo)).toEqual(["mdfe.cancelado"]);

      // Cancelado libera a viagem para um MDF-e novo, com o número seguinte.
      const novo = await emitir(viagem.id);
      expect(novo.corpo.mdfe).toMatchObject({ situacao: "AUTHORIZED", numero: 2 });
      expect(await mdfesDe(viagem.id)).toHaveLength(2);
    });

    it("inclusão de condutor: um evento por condutor, com a sequência seguindo", async () => {
      const { viagem, mdfe } = await autorizado();
      const primeiro = await incluirCondutor(mdfe.id);
      expect(primeiro.status).toBe(200);
      expect(primeiro.corpo.situacao).toBe("AUTHORIZED");
      expect(primeiro.corpo.eventos.map((evento) => [evento.tipo, evento.sequencia, evento.descricao])).toEqual([["110114", 1, "Condutor incluído: Maria de Souza"]]);
      const segundo = await incluirCondutor(mdfe.id, { nome: "Pedro Alves", cpf: "529.982.247-25" });
      expect(segundo.corpo.eventos.map((evento) => evento.sequencia)).toEqual([1, 2]);

      const [gravado] = await mdfesDe(viagem.id);
      expect(gravado.events[1].xmlSent).toContain(`Id="ID110114${mdfe.chave}02"`);
      expect(gravado.events[1].xmlSent).toContain("<condutor><xNome>Pedro Alves</xNome><CPF>52998224725</CPF></condutor>");
      expect(await errosNoEsquemaDoMdfe(gravado.events[1].xmlSent, "eventoMDFe_v3.00.xsd")).toEqual([]);
      expect(sefaz.eventos.map((evento) => [evento.tipo, evento.sequencia])).toEqual([
        ["110114", "1"],
        ["110114", "2"],
      ]);
      expect(await trilha("mdfe.condutor")).toHaveLength(2);

      sefaz.modoDe = { MDFeRecepcaoEvento: "fault" };
      const falhou = await incluirCondutor(mdfe.id, { nome: "Ana Lima", cpf: "111.444.777-35" });
      expect(falhou.status).toBe(502);
      expect((await mdfesDe(viagem.id))[0].events).toHaveLength(2);
    });
  });

  /* ------------------------------ XML, DAMDFE, status ------------------------- */

  describe("XML, DAMDFE e status do serviço", () => {
    it("baixa o mdfeProc como anexo; o DAMDFE vem do serviço fiscal (gerar_damdfe) só quando ele confirma o protocolo", async () => {
      await prepararEmpresa();
      const viagem = await novaViagem();
      const { corpo } = await emitir(viagem.id);

      entrarComo("EXPEDITION");
      const xml = await xmlRota.GET(req(), ctx(corpo.mdfe.id));
      expect(xml.status).toBe(200);
      expect(xml.headers.get("Content-Disposition")).toBe(`attachment; filename="${corpo.mdfe.chave}-procMDFe.xml"`);
      expect(xml.headers.get("Cache-Control")).toBe("private, no-store");
      const conteudo = await xml.text();
      expect(conteudo.startsWith('<?xml version="1.0" encoding="UTF-8"?><mdfeProc')).toBe(true);
      expect(conteudo).toContain(`<nProt>${corpo.mdfe.protocolo}</nProt>`);

      // Sem o serviço fiscal configurado: 503, e a situação diz que não há DAMDFE.
      const desligado = await lida(await damdfeRota.GET(req(), ctx(corpo.mdfe.id)));
      expect(desligado.status).toBe(503);
      expect(desligado.corpo.error).toBe("A geração de DAMDFE não está ligada neste sistema.");

      process.env.FISCAL_MCP_URL = enderecoDoFiscal;
      expect((await lida<SituacaoDaEmissao>(await situacaoRota.GET())).corpo.damdfe).toBe(true);
      const pdf = await damdfeRota.GET(req(), ctx(corpo.mdfe.id));
      expect(pdf.status).toBe(200);
      expect(pdf.headers.get("Content-Type")).toBe("application/pdf");
      expect(pdf.headers.get("Content-Disposition")).toBe(`attachment; filename="${corpo.mdfe.chave}-damdfe-HOMOLOGACAO-SEM-VALOR-FISCAL.pdf"`);
      expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString()).toBe("%PDF-");
      expect(pedidosAoFiscal).toHaveLength(1);
      expect(pedidosAoFiscal[0].ferramenta).toBe("gerar_damdfe");
      expect(pedidosAoFiscal[0].xml).toBe(conteudo);

      // O serviço não reconheceu o protocolo: o PDF não é entregue.
      fiscalDizAutorizado = false;
      const semProtocolo = await lida(await damdfeRota.GET(req(), ctx(corpo.mdfe.id)));
      expect(semProtocolo.status).toBe(502);
      expect(semProtocolo.corpo.error).toMatch(/não reconheceu o protocolo de autorização deste MDF-e/);
    });

    it("status do serviço: em operação, parado e fora do ar", async () => {
      await prepararEmpresa();
      entrarComo("EXPEDITION");
      expect((await lida<StatusDoServico>(await statusRota.GET())).corpo).toEqual({ ambiente: "HOMOLOGACAO", autorizador: "SVRS", emOperacao: true, cStat: 107, motivo: "Serviço em Operação" });
      sefaz.modo = "parado";
      expect((await lida<StatusDoServico>(await statusRota.GET())).corpo).toMatchObject({ emOperacao: false, cStat: 108 });
      sefaz.modo = "mudo";
      expect((await lida<StatusDoServico>(await statusRota.GET())).corpo).toMatchObject({ emOperacao: false, cStat: null });
    });
  });

  /* ------------------- Documentos fiscais antes da saída --------------------- */

  describe("liberar a saída: CT-e e MDF-e autorizados antes (Ajustes SINIEF 09/07 e 21/10)", () => {
    type Bloqueio = Corpo & { success?: boolean; aviso?: string | null; faltas?: FaltasParaSair };
    const sair = async (manifestId: string, perfil: Perfil = "OPERATION") => {
      entrarComo(perfil);
      return lida<Bloqueio>(await liberarRota.POST(req("POST"), ctx(manifestId)));
    };
    const situacao = async (manifestId: string) => {
      const viagem = await banco.sistema.manifest.findUniqueOrThrow({ where: { id: manifestId }, select: { status: true, collections: { select: { status: true } } } });
      return { viagem: viagem.status, cargas: [...new Set(viagem.collections.map((carga) => carga.status))] };
    };
    const EM_MONTAGEM = { viagem: "ASSEMBLING", cargas: ["COLLECTED"] };
    const EM_ROTA = { viagem: "ROUTE", cargas: ["ROUTE"] };
    const emProducao = () => prepararEmpresa({ ambiente: "PRODUCAO", confirmacaoDoCnpj: CNPJ_DA_PADRAO });
    /** O CT-e de produção das cargas, gravado como a emissão o deixa: autorizado, com o XML, e a carga com a chave. */
    const autorizarCtes = async (viagem: { cargas: { id: string }[] }) => {
      for (const carga of viagem.cargas) {
        const cte = await banco.sistema.cte.findFirstOrThrow({ where: { collectionId: carga.id }, select: { accessKey: true, number: true } });
        await banco.sistema.collection.update({ where: { id: carga.id }, data: { cteKey: cte.accessKey, cteNumber: cte.number, cteStatus: "ISSUED" } });
      }
    };

    it("produção sem CT-e: 409 com a lista das cargas e do MDF-e, e nada muda", async () => {
      await emProducao();
      const viagem = await novaViagem(["MG", "UDI"], { status: "ASSEMBLING", semCte: true });
      const resposta = await sair(viagem.id);
      expect(resposta.status).toBe(409);
      const codigos = (await banco.sistema.collection.findMany({ where: { manifestId: viagem.id }, orderBy: { createdAt: "asc" }, select: { id: true, trackingCode: true } })).map((carga) => ({ id: carga.id, codigo: carga.trackingCode }));
      expect(resposta.corpo.faltas).toEqual({ ctes: codigos, mdfe: "interestadual" });
      expect(resposta.corpo.error).toBe(fraseDoBloqueioDaSaida(resposta.corpo.faltas!));
      expect(resposta.corpo.error).toContain("CT-e autorizado de 2 cargas");
      expect(await situacao(viagem.id)).toEqual(EM_MONTAGEM);
      expect(await trilha("manifesto.liberar")).toHaveLength(0);
      // O veículo continua livre.
      expect((await banco.sistema.vehicle.findUniqueOrThrow({ where: { id: viagem.veiculoId }, select: { status: true } })).status).not.toBe("ON_ROUTE");
    });

    it("produção com CT-e e sem MDF-e: 409 só com o MDF-e; CT-e de homologação não conta", async () => {
      await emProducao();
      // CT-e autorizado só em homologação: a carga continua sem CT-e com valor fiscal.
      const deTeste = await novaViagem(["MG"], { status: "ASSEMBLING" });
      expect((await sair(deTeste.id)).corpo.faltas).toMatchObject({ ctes: [{ id: deTeste.cargas[0].id }], mdfe: "interestadual" });

      const viagem = await novaViagem(["MG", "UDI"], { status: "ASSEMBLING", ambienteDoCte: "PRODUCAO" });
      await autorizarCtes(viagem);
      const resposta = await sair(viagem.id);
      expect(resposta.status).toBe(409);
      expect(resposta.corpo.faltas).toEqual({ ctes: [], mdfe: "interestadual" });
      expect(resposta.corpo.error).toContain("Falta: MDF-e autorizado da viagem.");
      expect(await situacao(viagem.id)).toEqual(EM_MONTAGEM);

      // O CT-e registrado à mão (emitido em outro sistema) também vale como CT-e da carga.
      const deFora = await novaViagem(["MG"], { status: "ASSEMBLING", semCte: true });
      await banco.sistema.collection.update({ where: { id: deFora.cargas[0].id }, data: { cteKey: chaveDeExemplo("57", 4321), cteNumber: 4321, cteStatus: "ISSUED" } });
      expect((await sair(deFora.id)).corpo.faltas).toEqual({ ctes: [], mdfe: "interestadual" });
    });

    it("produção com o CT-e de cada carga e o MDF-e autorizados: libera, sem aviso", async () => {
      await emProducao();
      const viagem = await novaViagem(["MG", "UDI"], { status: "ASSEMBLING", ambienteDoCte: "PRODUCAO" });
      await autorizarCtes(viagem);
      // O MDF-e é emitido com a viagem ainda em montagem: é a ordem nova.
      const emitido = await emitir(viagem.id);
      expect(emitido.corpo).toMatchObject({ autorizado: true, mdfe: { ambiente: "PRODUCAO", situacao: "AUTHORIZED" } });
      const resposta = await sair(viagem.id);
      expect(resposta.status).toBe(200);
      expect(resposta.corpo).toMatchObject({ success: true, aviso: null });
      expect(await situacao(viagem.id)).toEqual(EM_ROTA);
      expect(await trilha("manifesto.liberar")).toHaveLength(1);
    });

    it("carga própria (tipo de emitente 2) em produção: não exige CT-e, só o MDF-e", async () => {
      await emProducao();
      await configurar({ tipoDeEmitente: "2" });
      const viagem = await novaViagem(["MG"], { status: "ASSEMBLING", semCte: true, comNfe: true });
      expect((await sair(viagem.id)).corpo.faltas).toEqual({ ctes: [], mdfe: "interestadual" });
    });

    it("homologação: só o aviso, como antes; a saída é liberada sem CT-e e sem MDF-e", async () => {
      await prepararEmpresa();
      const viagem = await novaViagem(["MG", "UDI"], { status: "ASSEMBLING", semCte: true });
      const resposta = await sair(viagem.id);
      expect(resposta.status).toBe(200);
      expect(resposta.corpo).toMatchObject({ success: true, aviso: AVISO_DE_VIAGEM_SEM_MDFE.interestadual });
      expect(resposta.corpo.faltas).toBeUndefined();
      expect(await situacao(viagem.id)).toEqual(EM_ROTA);
      expect(await mdfeDb.documentosDaSaida(banco.default, viagem.id)).toEqual({ faltas: { ctes: [], mdfe: null }, bloqueia: false });
    });

    it("empresa sem emitente fiscal (emite em outro sistema): libera, só com o aviso", async () => {
      const viagem = await novaViagem(["MG"], { status: "ASSEMBLING", semCte: true });
      expect(await banco.sistema.fiscalIssuer.count({ where: DAS_EMPRESAS })).toBe(0);
      const resposta = await sair(viagem.id);
      expect(resposta.status).toBe(200);
      expect(resposta.corpo).toMatchObject({ success: true, aviso: AVISO_DE_VIAGEM_SEM_MDFE.interestadual });
      expect(await situacao(viagem.id)).toEqual(EM_ROTA);
    });

    it("isolamento: o emitente em produção de uma empresa não bloqueia a outra, e uma não libera a viagem da outra", async () => {
      await emProducao();
      const daPadrao = await novaViagem(["MG"], { status: "ASSEMBLING", semCte: true });

      // A outra empresa não tem emitente: a viagem dela sai, com o aviso.
      const outra = banco.paraEmpresa(EMPRESA_OUTRA.id).db;
      const usuario = await outra.user.create({ data: { name: `${PREFIXO}motorista-da-outra`, email: `${PREFIXO}motorista-da-outra@exemplo.br`, password: HASH_FALSO, role: "DRIVER" } });
      const motorista = await outra.driver.create({ data: { userId: usuario.id, cpf: "11144477735", cnh: "98765432100", cnhExpiry: new Date("2030-01-01"), category: "E" } });
      const veiculo = await outra.vehicle.create({ data: { plate: "MDF9Z99", model: "Truck da outra", type: "TRUCK", capacity: 14000 } });
      const cliente = await outra.client.create({ data: { companyName: `${PREFIXO}Cliente da Outra Ltda`, cnpj: "07526557000100" } });
      const daOutra = await outra.manifest.create({ data: { driverId: motorista.id, vehicleId: veiculo.id, status: "ASSEMBLING" }, select: { id: true } });
      await outra.collection.create({
        data: { clientId: cliente.id, manifestId: daOutra.id, sender: "Remetente", receiver: "Destinatário", origin: "São José do Rio Preto - SP", destination: "Belo Horizonte - MG", volumes: 1, weight: 10, status: "COLLECTED", trackingCode: `97${String(Date.now() % 100_000_000).padStart(8, "0")}` },
      });
      try {
        // Cada uma só enxerga a própria viagem.
        expect((await sair(daPadrao.id, "ADMIN_DA_OUTRA")).status).toBe(404);
        expect((await sair(daOutra.id, "OPERATION")).status).toBe(404);

        const liberada = await sair(daOutra.id, "ADMIN_DA_OUTRA");
        expect(liberada.status).toBe(200);
        expect(liberada.corpo).toMatchObject({ success: true, aviso: AVISO_DE_VIAGEM_SEM_MDFE.interestadual });
        expect(await situacao(daOutra.id)).toEqual(EM_ROTA);

        // E a da empresa em produção continua bloqueada.
        expect((await sair(daPadrao.id)).status).toBe(409);
        expect(await situacao(daPadrao.id)).toEqual(EM_MONTAGEM);
      } finally {
        await banco.sistema.collection.deleteMany({ where: { manifestId: daOutra.id } });
        await banco.sistema.manifest.deleteMany({ where: { id: daOutra.id } });
        await banco.sistema.vehicle.deleteMany({ where: { id: veiculo.id } });
        await banco.sistema.driver.deleteMany({ where: { id: motorista.id } });
        await banco.sistema.user.deleteMany({ where: { id: usuario.id } });
        await banco.sistema.client.deleteMany({ where: { id: cliente.id } });
      }
    });
  });

  /* ------------------------------ Viagem e avisos ----------------------------- */

  describe("viagem, motorista e aviso de MDF-e em aberto", () => {
    it("a viagem que sai do estado sem MDF-e de produção gera o aviso (sem bloquear); o de homologação não a cobre", async () => {
      await prepararEmpresa();
      const interestadual = await novaViagem();
      expect(await mdfeDb.exigenciaSemMdfe(banco.default, interestadual.id)).toBe("interestadual");
      expect(AVISO_DE_VIAGEM_SEM_MDFE.interestadual).toMatch(/o MDF-e é obrigatório/);
      await emitir(interestadual.id);
      // Autorizado em homologação: continua sem MDF-e com valor fiscal.
      expect(await mdfeDb.exigenciaSemMdfe(banco.default, interestadual.id)).toBe("interestadual");
      await banco.sistema.mdfe.updateMany({ where: { manifestId: interestadual.id }, data: { environment: "PRODUCAO" } });
      expect(await mdfeDb.exigenciaSemMdfe(banco.default, interestadual.id)).toBeNull();
      expect(await mdfeDb.exigenciaSemMdfe(banco.default, SEM_ID)).toBeNull();

      // Ao finalizar a viagem, o que se oferece encerrar.
      expect(await mdfeDb.mdfesAbertosDaViagem(banco.default, interestadual.id)).toEqual([{ id: expect.any(String), numero: 1, ambiente: "PRODUCAO" }]);
    });

    it("o motorista vê a chave e a situação do MDF-e da viagem dele, sem XML", async () => {
      await prepararEmpresa();
      const viagem = await novaViagem();
      const { corpo } = await emitir(viagem.id);
      const motorista = await banco.sistema.driver.findUniqueOrThrow({ where: { id: motoristaId }, select: { userId: true } });
      sessao.mockResolvedValue({ user: { id: motorista.userId, role: "DRIVER", clientId: null } });
      const rota = await import("../src/app/api/driver/manifestos/route");
      const resposta = await rota.GET();
      const texto = await resposta.text();
      respostas.push(texto);
      const viagens = JSON.parse(texto) as { id: string; mdfes: Record<string, unknown>[] }[];
      expect(viagens.find((cada) => cada.id === viagem.id)?.mdfes).toEqual([{ id: corpo.mdfe.id, number: 1, accessKey: corpo.mdfe.chave, status: "AUTHORIZED", environment: "HOMOLOGACAO", unloadState: "MG" }]);
      expect(texto).not.toContain("<MDFe");
    });

    it("MDF-e autorizado há mais de N dias sem encerrar: um aviso por MDF-e, para quem lê o fiscal", async () => {
      await prepararEmpresa();
      const viagem = await novaViagem();
      const { corpo } = await emitir(viagem.id);
      await banco.sistema.notification.deleteMany({ where: { user: { email: { startsWith: PREFIXO } } } });

      expect(await mdfeDb.avisarMdfesEmAberto()).toBe(0);
      await banco.sistema.mdfe.update({ where: { id: corpo.mdfe.id }, data: { authorizedAt: new Date(Date.now() - (DIAS_PARA_AVISAR_ENCERRAMENTO + 1) * 86_400_000) } });
      expect(await mdfeDb.avisarMdfesEmAberto()).toBe(1);
      const avisos = await avisosDe("EXPEDITION", "mdfe.encerrar");
      expect(avisos.map((aviso) => aviso.title)).toEqual([`MDF-e nº 1 sem encerrar há ${DIAS_PARA_AVISAR_ENCERRAMENTO + 1} dias`]);
      expect(avisos[0].url).toBe("/dashboard/fiscal/mdfe");
      expect(await avisosDe("COMMERCIAL", "mdfe.encerrar")).toHaveLength(0);
      // Uma vez só.
      expect(await mdfeDb.avisarMdfesEmAberto()).toBe(0);
      expect(await avisosDe("EXPEDITION", "mdfe.encerrar")).toHaveLength(1);
      // Encerrado não gera aviso.
      await banco.sistema.mdfe.update({ where: { id: corpo.mdfe.id }, data: { closeReminderAt: null, status: "CLOSED" } });
      expect(await mdfeDb.avisarMdfesEmAberto()).toBe(0);
    });
  });

  /* --------------------------- Isolamento e segredo --------------------------- */

  describe("isolamento entre empresas e segredo do certificado", () => {
    it("a outra empresa não vê nem toca o MDF-e desta", async () => {
      await prepararEmpresa();
      const viagem = await novaViagem();
      const { corpo } = await emitir(viagem.id);

      expect((await listar("ADMIN_DA_OUTRA")).corpo).toEqual([]);
      expect((await daViagem(viagem.id, "ADMIN_DA_OUTRA")).corpo.error).toBe(VIAGEM_NAO_ENCONTRADA);
      expect((await conferir(viagem.id, "MG", ENTRADAS, "ADMIN_DA_OUTRA")).status).toBe(404);
      sefaz.chamadas.length = 0;
      expect((await emitir(viagem.id, "MG", ENTRADAS, "ADMIN_DA_OUTRA")).status).toBe(409);
      expect(sefaz.chamadas).toHaveLength(0);
      for (const chamar of [() => encerrar(corpo.mdfe.id, {}, "ADMIN_DA_OUTRA"), () => cancelar(corpo.mdfe.id, {}, "ADMIN_DA_OUTRA"), () => incluirCondutor(corpo.mdfe.id, undefined, "ADMIN_DA_OUTRA")]) {
        expect((await chamar()).corpo.error).toBe(MDFE_NAO_ENCONTRADO);
      }
      entrarComo("ADMIN_DA_OUTRA");
      expect((await lida(await xmlRota.GET(req(), ctx(corpo.mdfe.id)))).status).toBe(404);
      expect((await lida(await damdfeRota.GET(req(), ctx(corpo.mdfe.id)))).status).toBe(404);
      expect((await lida<ConfiguracaoDoMdfe>(await configuracaoRota.GET())).corpo.disponivel).toBe(false);
      expect((await lida<SituacaoDaEmissao>(await situacaoRota.GET())).corpo.pronta).toBe(false);

      // Nada mudou no MDF-e desta empresa, e a outra não ganhou linha nenhuma.
      expect((await mdfesDe(viagem.id))[0]).toMatchObject({ status: "AUTHORIZED", tenantId: EMPRESA_PADRAO.id });
      expect(await banco.sistema.mdfe.count({ where: { tenantId: EMPRESA_OUTRA.id } })).toBe(0);
      expect(await banco.sistema.mdfeNumbering.count({ where: { tenantId: EMPRESA_OUTRA.id } })).toBe(0);
    });

    it("o certificado nunca aparece: nem a senha, nem o arquivo, nem a chave privada, em resposta nenhuma e em log nenhum", async () => {
      await prepararEmpresa();
      const viagem = await novaViagem();
      const { corpo } = await emitir(viagem.id);
      await incluirCondutor(corpo.mdfe.id);
      sefaz.modoDe = { MDFeRecepcaoEvento: "fault" };
      await encerrar(corpo.mdfe.id);
      sefaz.modoDe = {};
      await encerrar(corpo.mdfe.id);
      await listar("ADMIN");
      await daViagem(viagem.id, "ADMIN");

      const tudo = [...respostas, ...logs].join("\n");
      expect(respostas.length).toBeGreaterThan(20);
      expect(tudo).not.toContain(SENHA);
      expect(tudo).not.toContain(certificado.pfx.toString("base64").slice(0, 60));
      expect(tudo).not.toContain("PRIVATE KEY");
      expect(tudo).not.toContain(certificado.chavePem.split("\n")[1]);
      // No banco, o certificado continua cifrado.
      const guardado = await banco.sistema.fiscalIssuer.findUniqueOrThrow({ where: { tenantId: EMPRESA_PADRAO.id }, select: { certPfxEnc: true, certPasswordEnc: true } });
      expect(guardado.certPfxEnc).not.toContain(certificado.pfx.toString("base64").slice(0, 60));
      expect(guardado.certPasswordEnc).not.toContain(SENHA);
    });
  });
});
