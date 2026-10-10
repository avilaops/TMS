import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getServerSession } from "next-auth";
import {
  DANFE_DESLIGADO,
  DANFE_FORA_DO_AR,
  DANFE_RECUSADO,
  DANFE_TEMPO_ESGOTADO,
  FiscalMcpError,
  TEMPO_LIMITE_MS,
  danfeLigado,
  enderecoDoFiscal,
  gerarDanfe,
  nomeDoArquivoDanfe,
  pdfDoResultado,
  respostaRpc,
  tempoLimite,
} from "../src/lib/fiscal-mcp";
import { EMPRESA_OUTRA } from "./empresas-de-teste";

/**
 * DANFE em PDF das notas importadas: o cliente do serviço fiscal (MCP) e as
 * rotas do painel e do portal.
 *
 * O serviço de verdade nunca é chamado aqui: um servidor HTTP local imita a
 * conversa (initialize → notifications/initialized → tools/call) e responde
 * como o de verdade responde, em `text/event-stream`.
 */
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n", "latin1");
const SESSAO_MCP = "sessao-de-teste-123";

type Modo = "ok" | "so-texto" | "json" | "erro-da-ferramenta" | "sem-pdf" | "nao-e-pdf" | "lento" | "status-500" | "erro-rpc" | "lixo";
type Pedido = { metodo: string; sessao: string | undefined; autorizacao: string | undefined; aceita: string | undefined; xml: unknown };

/** O servidor que imita o MCP fiscal. `modo` decide o que `tools/call` responde. */
function servidorFalso() {
  const estado = { modo: "ok" as Modo, pedidos: [] as Pedido[], encerradas: [] as (string | undefined)[] };
  const pendurados = new Set<http.ServerResponse>();

  const evento = (corpo: unknown) => `event: message\ndata: ${JSON.stringify(corpo)}\n\n`;

  const servidor = http.createServer((req, res) => {
    // Encerramento da sessão, no fim da conversa: sem corpo.
    if (req.method === "DELETE") {
      estado.encerradas.push(req.headers["mcp-session-id"] as string | undefined);
      res.writeHead(200).end();
      return;
    }

    let texto = "";
    req.on("data", (pedaco) => (texto += pedaco));
    req.on("end", () => {
      const corpo = JSON.parse(texto) as { id?: number; method: string; params?: { arguments?: { xml_content?: unknown } } };
      estado.pedidos.push({
        metodo: corpo.method,
        sessao: req.headers["mcp-session-id"] as string | undefined,
        autorizacao: req.headers.authorization,
        aceita: req.headers.accept,
        xml: corpo.params?.arguments?.xml_content,
      });

      if (corpo.method === "initialize") {
        res.writeHead(200, { "Content-Type": "text/event-stream", "mcp-session-id": SESSAO_MCP });
        res.end(evento({ jsonrpc: "2.0", id: corpo.id, result: { protocolVersion: "2025-03-26", serverInfo: { name: "MCP Fiscal de teste" } } }));
        return;
      }
      if (corpo.method === "notifications/initialized") {
        res.writeHead(202).end();
        return;
      }

      const dados = { pdf_base64: PDF.toString("base64"), modelo: 55, nome_arquivo: "DANFE.pdf", chave_acesso: "0".repeat(44) };
      const resultado = (result: unknown) => ({ jsonrpc: "2.0", id: corpo.id, result });
      const texto200 = (conteudo: string) => {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.end(conteudo);
      };

      switch (estado.modo) {
        case "ok":
          // Como o serviço de verdade: um aviso antes, e o resultado nos dois formatos.
          return texto200(
            evento({ jsonrpc: "2.0", method: "notifications/message", params: { level: "info" } }) +
              evento(resultado({ content: [{ type: "text", text: JSON.stringify(dados) }], structuredContent: dados, isError: false })),
          );
        case "so-texto":
          return texto200(evento(resultado({ content: [{ type: "text", text: JSON.stringify(dados) }], isError: false })));
        case "json":
          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end(JSON.stringify(resultado({ content: [], structuredContent: dados })));
        case "erro-da-ferramenta":
          return texto200(evento(resultado({ content: [{ type: "text", text: "XML inválido: elemento infNFe ausente" }], isError: true })));
        case "sem-pdf":
          return texto200(evento(resultado({ content: [{ type: "text", text: JSON.stringify({ aviso: "nada" }) }], isError: false })));
        case "nao-e-pdf":
          return texto200(evento(resultado({ content: [], structuredContent: { pdf_base64: Buffer.from("<html>oi</html>").toString("base64") } })));
        case "erro-rpc":
          return texto200(evento({ jsonrpc: "2.0", id: corpo.id, error: { code: -32602, message: "Unknown tool" } }));
        case "lixo":
          return texto200("isto não é um evento");
        case "status-500":
          res.writeHead(500, { "Content-Type": "text/plain" });
          return res.end("erro interno");
        case "lento":
          // Nunca responde: quem chama desiste pelo tempo limite.
          pendurados.add(res);
          return;
      }
    });
  });

  return {
    estado,
    async ligar() {
      await new Promise<void>((pronto) => servidor.listen(0, "127.0.0.1", pronto));
      return `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/mcp`;
    },
    soltar() {
      for (const res of pendurados) res.destroy();
      pendurados.clear();
    },
    async desligar() {
      this.soltar();
      servidor.closeAllConnections();
      await new Promise<void>((pronto) => servidor.close(() => pronto()));
    },
  };
}

const XML = '<?xml version="1.0" encoding="UTF-8"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe1"/></NFe></nfeProc>';

const falha = async (promessa: Promise<unknown>): Promise<FiscalMcpError> => {
  try {
    await promessa;
  } catch (erro) {
    if (erro instanceof FiscalMcpError) return erro;
    throw erro;
  }
  throw new Error("deveria ter falhado");
};

const VARIAVEIS = ["FISCAL_MCP_URL", "FISCAL_MCP_TOKEN", "FISCAL_MCP_TIMEOUT_MS"] as const;
const limparVariaveis = () => {
  for (const nome of VARIAVEIS) delete process.env[nome];
};

/* ---------------------------------- Puro ------------------------------------- */

describe("serviço fiscal: leitura da resposta", () => {
  afterEach(limparVariaveis);

  it("acha a resposta com o id pedido num fluxo de eventos, mesmo com avisos antes, e num JSON só", () => {
    const fluxo = `event: message\r\ndata: {"jsonrpc":"2.0","method":"notifications/message"}\r\n\r\nevent: message\r\ndata: {"jsonrpc":"2.0","id":2,"result":{"ok":true}}\r\n\r\n`;
    expect(respostaRpc(fluxo, "text/event-stream; charset=utf-8", 2)).toEqual({ jsonrpc: "2.0", id: 2, result: { ok: true } });
    expect(respostaRpc(fluxo, "text/event-stream", 7)).toBeNull();
    expect(respostaRpc('{"jsonrpc":"2.0","id":1,"result":{}}', "application/json", 1)).toMatchObject({ id: 1 });
    for (const lixo of ["", "<html>", "data: {quebrado", "[]", "null"]) {
      expect(respostaRpc(lixo, "text/event-stream", 1), lixo).toBeNull();
      expect(respostaRpc(lixo, null, 1), lixo).toBeNull();
    }
  });

  it("tira o PDF de structuredContent ou do texto JSON, e recusa o que não é PDF", () => {
    const base64 = PDF.toString("base64");
    expect(pdfDoResultado({ structuredContent: { pdf_base64: base64 }, content: [] }).equals(PDF)).toBe(true);
    expect(pdfDoResultado({ content: [{ type: "text", text: JSON.stringify({ pdf_base64: base64 }) }], isError: false }).equals(PDF)).toBe(true);

    const recusas: [unknown, string][] = [
      [{ isError: true, content: [{ type: "text", text: "XML inválido" }] }, "ferramenta"],
      // Erro da ferramenta vale mesmo que venha um PDF junto.
      [{ isError: true, structuredContent: { pdf_base64: base64 }, content: [] }, "ferramenta"],
      [{ content: [{ type: "text", text: "texto solto" }] }, "ferramenta"],
      [{ content: [] }, "ferramenta"],
      [{ structuredContent: { pdf_base64: 123 } }, "ferramenta"],
      [{ structuredContent: { pdf_base64: Buffer.from("<script>alert(1)</script>").toString("base64") } }, "ferramenta"],
      [null, "servico"],
      ["texto", "servico"],
    ];
    for (const [resultado, motivo] of recusas) {
      let erro: unknown;
      try {
        pdfDoResultado(resultado);
      } catch (e) {
        erro = e;
      }
      expect(erro, JSON.stringify(resultado)).toBeInstanceOf(FiscalMcpError);
      expect((erro as FiscalMcpError).motivo, JSON.stringify(resultado)).toBe(motivo);
    }
  });

  it("a mensagem para a tela não leva o texto que o serviço devolveu; o detalhe fica à parte", () => {
    let erro: FiscalMcpError | null = null;
    try {
      pdfDoResultado({ isError: true, content: [{ type: "text", text: `segredo interno ${"x".repeat(1000)}` }] });
    } catch (e) {
      erro = e as FiscalMcpError;
    }
    expect(erro?.message).toBe(DANFE_RECUSADO);
    expect(erro?.detalhe).toContain("segredo interno");
    expect(erro?.detalhe?.length).toBeLessThanOrEqual(300);
  });

  it("sem endereço, ou com endereço que não é http(s), o recurso está desligado", () => {
    for (const valor of [undefined, "", "   ", "fiscal.avilaops.com/mcp", "ftp://fiscal.avilaops.com/mcp", "file:///etc/passwd", "javascript:alert(1)"]) {
      if (valor === undefined) delete process.env.FISCAL_MCP_URL;
      else process.env.FISCAL_MCP_URL = valor;
      expect(enderecoDoFiscal(), String(valor)).toBeNull();
      expect(danfeLigado(), String(valor)).toBe(false);
    }
    process.env.FISCAL_MCP_URL = " https://fiscal.avilaops.com/mcp ";
    expect(enderecoDoFiscal()).toBe("https://fiscal.avilaops.com/mcp");
    expect(danfeLigado()).toBe(true);
  });

  it("o tempo limite vem da variável de ambiente só quando é um número razoável", () => {
    expect(tempoLimite()).toBe(TEMPO_LIMITE_MS);
    for (const valor of ["abc", "0", "50", "-1", "999999999", ""]) {
      process.env.FISCAL_MCP_TIMEOUT_MS = valor;
      expect(tempoLimite(), valor).toBe(TEMPO_LIMITE_MS);
    }
    process.env.FISCAL_MCP_TIMEOUT_MS = "1500";
    expect(tempoLimite()).toBe(1500);
  });

  it("o arquivo baixado leva a chave no nome", () => {
    expect(nomeDoArquivoDanfe("3526 1011.2223")).toBe("352610112223-danfe.pdf");
  });
});

/* ------------------------- Cliente contra o servidor local -------------------- */

describe("serviço fiscal: a conversa com o servidor", () => {
  const falso = servidorFalso();
  let endereco: string;

  beforeAll(async () => {
    endereco = await falso.ligar();
  });

  beforeEach(() => {
    limparVariaveis();
    process.env.FISCAL_MCP_URL = endereco;
    falso.estado.modo = "ok";
    falso.estado.pedidos.length = 0;
    falso.estado.encerradas.length = 0;
  });

  afterEach(() => falso.soltar());

  afterAll(async () => {
    limparVariaveis();
    await falso.desligar();
  });

  it("sucesso: três passos, com a sessão do initialize nos seguintes, e o PDF de volta", async () => {
    const pdf = await gerarDanfe(XML);
    expect(pdf.equals(PDF)).toBe(true);

    expect(falso.estado.pedidos.map((pedido) => pedido.metodo)).toEqual(["initialize", "notifications/initialized", "tools/call"]);
    expect(falso.estado.pedidos.map((pedido) => pedido.sessao)).toEqual([undefined, SESSAO_MCP, SESSAO_MCP]);
    expect(falso.estado.pedidos[2].xml).toBe(XML);
    for (const pedido of falso.estado.pedidos) {
      expect(pedido.aceita).toBe("application/json, text/event-stream");
      // Sem token configurado, nenhum cabeçalho de autorização sai.
      expect(pedido.autorizacao).toBeUndefined();
    }

    // No fim a sessão é encerrada, sem ninguém esperar por isso.
    await vi.waitFor(() => expect(falso.estado.encerradas).toEqual([SESSAO_MCP]));
  });

  it("com FISCAL_MCP_TOKEN, os três passos levam Authorization: Bearer", async () => {
    process.env.FISCAL_MCP_TOKEN = " token-de-teste ";
    await gerarDanfe(XML);
    expect(falso.estado.pedidos.map((pedido) => pedido.autorizacao)).toEqual(Array(3).fill("Bearer token-de-teste"));
  });

  it("aceita o resultado só como texto JSON e a resposta em application/json", async () => {
    for (const modo of ["so-texto", "json"] as const) {
      falso.estado.modo = modo;
      expect((await gerarDanfe(XML)).equals(PDF), modo).toBe(true);
    }
  });

  it("erro da ferramenta, resultado sem PDF e conteúdo que não é PDF: motivo `ferramenta`", async () => {
    for (const modo of ["erro-da-ferramenta", "sem-pdf", "nao-e-pdf"] as const) {
      falso.estado.modo = modo;
      const erro = await falha(gerarDanfe(XML));
      expect(erro.motivo, modo).toBe("ferramenta");
      expect(erro.message, modo).toBe(DANFE_RECUSADO);
    }
    falso.estado.modo = "erro-da-ferramenta";
    expect((await falha(gerarDanfe(XML))).detalhe).toContain("infNFe ausente");
  });

  it("tempo esgotado: desiste no limite, sem ficar pendurado", async () => {
    falso.estado.modo = "lento";
    const inicio = Date.now();
    const erro = await falha(gerarDanfe(XML, { tempoLimiteMs: 200 }));
    expect(erro.motivo).toBe("tempo");
    expect(erro.message).toBe(DANFE_TEMPO_ESGOTADO);
    expect(Date.now() - inicio).toBeLessThan(3000);
  });

  it("status de erro, erro do protocolo, resposta ilegível e servidor fora do ar: motivo `servico`", async () => {
    for (const modo of ["status-500", "erro-rpc", "lixo"] as const) {
      falso.estado.modo = modo;
      const erro = await falha(gerarDanfe(XML));
      expect(erro.motivo, modo).toBe("servico");
      expect(erro.message, modo).toBe(DANFE_FORA_DO_AR);
    }

    // Porta em que ninguém escuta.
    process.env.FISCAL_MCP_URL = "http://127.0.0.1:9/mcp";
    expect((await falha(gerarDanfe(XML))).motivo).toBe("servico");
  });

  it("serviço desligado: falha sem tentar falar com ninguém", async () => {
    delete process.env.FISCAL_MCP_URL;
    const erro = await falha(gerarDanfe(XML));
    expect(erro.motivo).toBe("desligado");
    expect(erro.message).toBe(DANFE_DESLIGADO);
    expect(falso.estado.pedidos).toEqual([]);
  });
});

/* ------------------------------- Rotas, com banco ------------------------------ */

const temBanco = Boolean(process.env.DATABASE_URL);

if (!temBanco) {
  console.warn("\n[danfe.test] DATABASE_URL ausente: testes de integração PULADOS.\nRode com um Postgres real para exercitá-los.\n");
}

const suite = temBanco ? describe : describe.skip;

// Tudo o que esta suite cria usa estes documentos e este prefixo, e só isso é apagado.
const PREFIXO = "teste-danfe-";
const CNPJ_CLIENTE = "99555111000109";
const CNPJ_OUTRO_CLIENTE = "99555111000280";
const CNPJ_DA_OUTRA = "99555111000361";
const HASH_FALSO = "$2b$10$hashfalsoparateste000000000000000000000000000000000";
const SEM_ID = "00000000-0000-0000-0000-000000000000";
const CHAVE = "35261099555111000109550010000077011000077015";
const CHAVE_SOLTA = "35261099555111000109550010000077021000077020";
const CHAVE_DA_OUTRA = "35261099555111000361550010000077031000077036";

suite("DANFE: rotas do painel e do portal", () => {
  const falso = servidorFalso();
  let endereco: string;
  let banco: typeof import("../src/lib/prisma");
  let danfeDaNota: typeof import("../src/app/api/fiscal/notas/[id]/danfe/route");
  let notaPorId: typeof import("../src/app/api/fiscal/notas/[id]/route");
  let portalDanfe: typeof import("../src/app/api/portal/coletas/[id]/notas/[notaId]/danfe/route");
  let portalColeta: typeof import("../src/app/api/portal/coletas/[id]/route");

  const sessao = vi.mocked(getServerSession);
  const PERFIS = ["ADMIN", "OPERATION", "DIRECTOR", "FINANCE", "EXPEDITION", "COMMERCIAL", "WAREHOUSE", "DRIVER", "CLIENT"] as const;
  const ids = {} as Record<(typeof PERFIS)[number], string>;
  let clienteDeOutraEmpresa: string;
  let adminDaOutra: string;
  const notas = { DA_CARGA: "", SOLTA: "", DA_OUTRA: "" };
  const cargas = { DO_CLIENTE: "", SEM_NOTA: "", DE_OUTRO_CLIENTE: "", DA_OUTRA: "" };

  const xmlDe = (chave: string) => XML.replace("NFe1", `NFe${chave}`);

  const entrarComo = (quem: (typeof PERFIS)[number] | null) => sessao.mockResolvedValue(quem ? { user: { id: ids[quem], role: quem, clientId: null } } : null);
  const entrarCom = (id: string, role: string) => sessao.mockResolvedValue({ user: { id, role, clientId: null } });
  const entrarNaOutra = () => sessao.mockResolvedValue({ user: { id: adminDaOutra, role: "ADMIN", clientId: null, tenantId: EMPRESA_OUTRA.id } });

  const req = () => new Request("http://localhost/api/teste");
  const doPainel = (id: string) => danfeDaNota.GET(req(), { params: Promise.resolve({ id }) });
  const doPortal = (id: string, notaId: string) => portalDanfe.GET(req(), { params: Promise.resolve({ id, notaId }) });
  const chamadas = () => falso.estado.pedidos.filter((pedido) => pedido.metodo === "tools/call");

  async function limpar() {
    const { sistema } = banco;
    const documentos = [CNPJ_CLIENTE, CNPJ_OUTRO_CLIENTE, CNPJ_DA_OUTRA];
    await sistema.fiscalDocument.deleteMany({ where: { accessKey: { in: [CHAVE, CHAVE_SOLTA, CHAVE_DA_OUTRA] } } });
    await sistema.collection.deleteMany({ where: { client: { cnpj: { in: documentos } } } });
    await sistema.user.deleteMany({ where: { email: { startsWith: PREFIXO } } });
    await sistema.client.deleteMany({ where: { cnpj: { in: documentos } } });
  }

  const carga = (clientId: string, trackingCode: string) => ({
    clientId,
    sender: "Remetente",
    receiver: "Destinatário",
    origin: "São José do Rio Preto - SP",
    destination: "Mirassol - SP",
    volumes: 1,
    weight: 10,
    status: "CONFIRMED",
    trackingCode,
  });

  const nota = (chave: string, numero: number, collectionId: string | null) => ({
    accessKey: chave,
    number: numero,
    series: 1,
    issuerTaxId: chave.slice(6, 20),
    issuerName: `${PREFIXO}emitente`,
    totalValue: 100,
    xml: xmlDe(chave),
    collectionId,
  });

  beforeAll(async () => {
    endereco = await falso.ligar();
    banco = await import("../src/lib/prisma");
    danfeDaNota = await import("../src/app/api/fiscal/notas/[id]/danfe/route");
    notaPorId = await import("../src/app/api/fiscal/notas/[id]/route");
    portalDanfe = await import("../src/app/api/portal/coletas/[id]/notas/[notaId]/danfe/route");
    portalColeta = await import("../src/app/api/portal/coletas/[id]/route");
    await limpar();

    const db = banco.default;
    const cliente = await db.client.create({ data: { companyName: `${PREFIXO}cliente`, cnpj: CNPJ_CLIENTE } });
    const outroCliente = await db.client.create({ data: { companyName: `${PREFIXO}outro cliente`, cnpj: CNPJ_OUTRO_CLIENTE } });
    for (const perfil of PERFIS) {
      ids[perfil] = (
        await db.user.create({
          data: { name: `${PREFIXO}${perfil}`, email: `${PREFIXO}${perfil.toLowerCase()}@exemplo.br`, password: HASH_FALSO, role: perfil, clientId: perfil === "CLIENT" ? cliente.id : undefined },
        })
      ).id;
    }
    clienteDeOutraEmpresa = (
      await db.user.create({ data: { name: `${PREFIXO}outro`, email: `${PREFIXO}outro-cliente@exemplo.br`, password: HASH_FALSO, role: "CLIENT", clientId: outroCliente.id } })
    ).id;

    cargas.DO_CLIENTE = (await db.collection.create({ data: carga(cliente.id, "DNF001") })).id;
    cargas.SEM_NOTA = (await db.collection.create({ data: carga(cliente.id, "DNF002") })).id;
    cargas.DE_OUTRO_CLIENTE = (await db.collection.create({ data: carga(outroCliente.id, "DNF003") })).id;
    notas.DA_CARGA = (await db.fiscalDocument.create({ data: nota(CHAVE, 7701, cargas.DO_CLIENTE) })).id;
    notas.SOLTA = (await db.fiscalDocument.create({ data: nota(CHAVE_SOLTA, 7702, null) })).id;

    const outra = banco.paraEmpresa(EMPRESA_OUTRA.id).db;
    const clienteDaOutra = await outra.client.create({ data: { companyName: `${PREFIXO}cliente da outra`, cnpj: CNPJ_DA_OUTRA } });
    adminDaOutra = (await outra.user.create({ data: { name: `${PREFIXO}admin da outra`, email: `${PREFIXO}admin-outra@exemplo.br`, password: HASH_FALSO, role: "ADMIN" } })).id;
    cargas.DA_OUTRA = (await outra.collection.create({ data: carga(clienteDaOutra.id, "DNF004") })).id;
    notas.DA_OUTRA = (await outra.fiscalDocument.create({ data: nota(CHAVE_DA_OUTRA, 7703, cargas.DA_OUTRA) })).id;
  }, 60_000);

  beforeEach(() => {
    sessao.mockReset();
    limparVariaveis();
    process.env.FISCAL_MCP_URL = endereco;
    falso.estado.modo = "ok";
    falso.estado.pedidos.length = 0;
    falso.estado.encerradas.length = 0;
  });

  afterEach(() => falso.soltar());

  afterAll(async () => {
    limparVariaveis();
    await falso.desligar();
    if (banco) await limpar();
  });

  describe("painel", () => {
    it("sem sessão é 401; quem não lê o fiscal é 403; e o serviço fiscal nem é chamado", async () => {
      entrarComo(null);
      expect((await doPainel(notas.DA_CARGA)).status).toBe(401);
      for (const perfil of ["COMMERCIAL", "WAREHOUSE", "DRIVER", "CLIENT"] as const) {
        entrarComo(perfil);
        expect((await doPainel(notas.DA_CARGA)).status, perfil).toBe(403);
      }
      expect(falso.estado.pedidos).toEqual([]);
    });

    it("quem baixa o XML baixa o DANFE: PDF como anexo, com a chave no nome, gerado do XML guardado", async () => {
      for (const perfil of ["ADMIN", "DIRECTOR", "OPERATION", "FINANCE", "EXPEDITION"] as const) {
        entrarComo(perfil);
        const res = await doPainel(notas.DA_CARGA);
        expect(res.status, perfil).toBe(200);
        expect(res.headers.get("Content-Type")).toBe("application/pdf");
        expect(res.headers.get("Content-Disposition")).toBe(`attachment; filename="${CHAVE}-danfe.pdf"`);
        expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
        expect(res.headers.get("Cache-Control")).toBe("private, no-store");
        expect(Buffer.from(await res.arrayBuffer()).equals(PDF), perfil).toBe(true);
      }
      expect(chamadas()).toHaveLength(5);
      expect(chamadas()[0].xml).toBe(xmlDe(CHAVE));

      // Nota sem carga também tem DANFE no painel.
      entrarComo("ADMIN");
      expect((await doPainel(notas.SOLTA)).status).toBe(200);
      expect(chamadas().at(-1)?.xml).toBe(xmlDe(CHAVE_SOLTA));
    });

    it("nota que não existe é 404, sem chamar o serviço", async () => {
      entrarComo("ADMIN");
      const res = await doPainel(SEM_ID);
      expect(res.status).toBe(404);
      expect(falso.estado.pedidos).toEqual([]);
    });

    it("erro da ferramenta é 502 e tempo esgotado é 504, com mensagem em português e sem o texto do serviço", async () => {
      entrarComo("ADMIN");
      const silencio = vi.spyOn(console, "error").mockImplementation(() => undefined);
      try {
        falso.estado.modo = "erro-da-ferramenta";
        const recusado = await doPainel(notas.DA_CARGA);
        expect(recusado.status).toBe(502);
        expect(recusado.headers.get("Content-Type")).toContain("application/json");
        expect(await recusado.json()).toEqual({ error: DANFE_RECUSADO });

        falso.estado.modo = "status-500";
        const foraDoAr = await doPainel(notas.DA_CARGA);
        expect(foraDoAr.status).toBe(502);
        expect(await foraDoAr.json()).toEqual({ error: DANFE_FORA_DO_AR });

        falso.estado.modo = "lento";
        process.env.FISCAL_MCP_TIMEOUT_MS = "200";
        const demorado = await doPainel(notas.DA_CARGA);
        expect(demorado.status).toBe(504);
        expect(await demorado.json()).toEqual({ error: DANFE_TEMPO_ESGOTADO });

        // O motivo fica no log do servidor.
        expect(silencio).toHaveBeenCalledTimes(3);
      } finally {
        silencio.mockRestore();
      }
    });

    it("serviço desligado: a rota responde 503 e a nota aberta diz à tela que não há botão", async () => {
      entrarComo("ADMIN");
      const ligada = (await (await notaPorId.GET(req(), { params: Promise.resolve({ id: notas.DA_CARGA }) })).json()) as { danfe: boolean };
      expect(ligada.danfe).toBe(true);

      delete process.env.FISCAL_MCP_URL;
      const res = await doPainel(notas.DA_CARGA);
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: DANFE_DESLIGADO });
      expect(falso.estado.pedidos).toEqual([]);

      const desligada = (await (await notaPorId.GET(req(), { params: Promise.resolve({ id: notas.DA_CARGA }) })).json()) as { danfe: boolean };
      expect(desligada.danfe).toBe(false);
    });
  });

  describe("portal do cliente", () => {
    it("o cliente baixa o DANFE da nota da carga dele, e a carga diz à tela se há botão", async () => {
      entrarComo("CLIENT");
      const res = await doPortal(cargas.DO_CLIENTE, notas.DA_CARGA);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("application/pdf");
      expect(res.headers.get("Content-Disposition")).toBe(`attachment; filename="${CHAVE}-danfe.pdf"`);
      expect(Buffer.from(await res.arrayBuffer()).equals(PDF)).toBe(true);
      expect(chamadas().map((pedido) => pedido.xml)).toEqual([xmlDe(CHAVE)]);

      const detalhe = async () => (await (await portalColeta.GET(req(), { params: Promise.resolve({ id: cargas.DO_CLIENTE }) })).json()) as { danfe: boolean };
      expect((await detalhe()).danfe).toBe(true);
      delete process.env.FISCAL_MCP_URL;
      expect((await detalhe()).danfe).toBe(false);
      expect((await doPortal(cargas.DO_CLIENTE, notas.DA_CARGA)).status).toBe(503);
    });

    it("outro cliente, nota por outra carga, nota sem carga e id que não existe: 404, sem chamar o serviço", async () => {
      entrarComo("CLIENT");
      expect((await doPortal(cargas.SEM_NOTA, notas.DA_CARGA)).status).toBe(404);
      expect((await doPortal(cargas.DO_CLIENTE, notas.SOLTA)).status).toBe(404);
      expect((await doPortal(cargas.DO_CLIENTE, SEM_ID)).status).toBe(404);
      // A nota de outra transportadora, mesmo com os ids certos.
      expect((await doPortal(cargas.DA_OUTRA, notas.DA_OUTRA)).status).toBe(404);

      entrarCom(clienteDeOutraEmpresa, "CLIENT");
      expect((await doPortal(cargas.DO_CLIENTE, notas.DA_CARGA)).status).toBe(404);
      expect((await doPortal(cargas.DE_OUTRO_CLIENTE, notas.DA_CARGA)).status).toBe(404);

      expect(falso.estado.pedidos).toEqual([]);
    });

    it("a equipe, o motorista e quem não entrou não passam pela rota do portal", async () => {
      for (const quem of ["ADMIN", "OPERATION", "DRIVER", null] as const) {
        entrarComo(quem);
        expect((await doPortal(cargas.DO_CLIENTE, notas.DA_CARGA)).status, String(quem)).toBe(401);
      }
      expect(falso.estado.pedidos).toEqual([]);
    });
  });

  describe("isolamento entre empresas", () => {
    it("uma transportadora não gera o DANFE da nota da outra, e o XML dela não sai daqui", async () => {
      entrarNaOutra();
      expect((await doPainel(notas.DA_CARGA)).status).toBe(404);
      expect((await doPainel(notas.SOLTA)).status).toBe(404);
      expect(falso.estado.pedidos).toEqual([]);

      const propria = await doPainel(notas.DA_OUTRA);
      expect(propria.status).toBe(200);
      expect(propria.headers.get("Content-Disposition")).toBe(`attachment; filename="${CHAVE_DA_OUTRA}-danfe.pdf"`);
      expect(chamadas().map((pedido) => pedido.xml)).toEqual([xmlDe(CHAVE_DA_OUTRA)]);

      falso.estado.pedidos.length = 0;
      entrarComo("ADMIN");
      expect((await doPainel(notas.DA_OUTRA)).status).toBe(404);
      expect(falso.estado.pedidos).toEqual([]);
    });
  });
});
