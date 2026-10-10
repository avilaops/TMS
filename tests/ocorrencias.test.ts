import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getServerSession } from "next-auth";
import {
  aceitaMensagem,
  contadoresPorStatus,
  createOccurrenceSchema,
  datasDaMudanca,
  driverOccurrenceSchema,
  filtrosDaLista,
  podeMudarStatus,
  portalMessageSchema,
  portalOccurrenceSchema,
  proximosStatus,
  recusaDeStatus,
  staffMessageSchema,
  tituloDoMotorista,
  updateOccurrenceSchema,
} from "../src/lib/ocorrencias";
import { EMPRESA_OUTRA, EMPRESA_PADRAO } from "./empresas-de-teste";

/**
 * Atendimento e ocorrências: as regras do fluxo (puras) e as rotas do painel,
 * do portal do cliente e do motorista contra um Postgres de verdade.
 */
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

describe("regras das ocorrências", () => {
  it("o chamado só anda para a frente, pode pular etapa, e o Resolvido pode ser reaberto", () => {
    expect(proximosStatus("OPEN")).toEqual(["ANALYSIS", "IN_PROGRESS", "RESOLVED", "CLOSED"]);
    expect(proximosStatus("ANALYSIS")).toEqual(["IN_PROGRESS", "RESOLVED", "CLOSED"]);
    expect(proximosStatus("IN_PROGRESS")).toEqual(["RESOLVED", "CLOSED"]);
    expect(proximosStatus("RESOLVED")).toEqual(["IN_PROGRESS", "CLOSED"]);
    expect(proximosStatus("CLOSED")).toEqual([]);
    expect(proximosStatus("INVENTADO")).toEqual([]);

    expect(podeMudarStatus("OPEN", "RESOLVED")).toBe(true);
    expect(podeMudarStatus("RESOLVED", "IN_PROGRESS")).toBe(true);
    for (const [de, para] of [["OPEN", "OPEN"], ["ANALYSIS", "OPEN"], ["IN_PROGRESS", "ANALYSIS"], ["RESOLVED", "OPEN"], ["RESOLVED", "ANALYSIS"], ["CLOSED", "RESOLVED"], ["CLOSED", "OPEN"]]) {
      expect(podeMudarStatus(de, para), `${de} → ${para}`).toBe(false);
    }
  });

  it("resolver marca a data, reabrir apaga, encerrar marca o encerramento sem inventar resolução", () => {
    const agora = new Date("2026-10-09T15:00:00.000Z");
    expect(datasDaMudanca("RESOLVED", agora)).toEqual({ resolvedAt: agora });
    expect(datasDaMudanca("IN_PROGRESS", agora)).toEqual({ resolvedAt: null });
    expect(datasDaMudanca("ANALYSIS", agora)).toEqual({ resolvedAt: null });
    expect(datasDaMudanca("CLOSED", agora)).toEqual({ closedAt: agora });
  });

  it("a recusa de status diz o motivo em português", () => {
    expect(recusaDeStatus("CLOSED", "OPEN")).toBe("Chamado encerrado não muda mais de status.");
    expect(recusaDeStatus("ANALYSIS", "ANALYSIS")).toBe('O chamado já está em "Em análise".');
    expect(recusaDeStatus("IN_PROGRESS", "OPEN")).toBe('O chamado não pode voltar de "Em tratamento" para "Aberto".');
  });

  it("só o Encerrado deixa de receber mensagem", () => {
    for (const status of ["OPEN", "ANALYSIS", "IN_PROGRESS", "RESOLVED"]) expect(aceitaMensagem(status), status).toBe(true);
    expect(aceitaMensagem("CLOSED")).toBe(false);
  });

  it("contadores trazem todos os status, com zero onde não há chamado, e ignoram status desconhecido", () => {
    expect(contadoresPorStatus([])).toEqual({ OPEN: 0, ANALYSIS: 0, IN_PROGRESS: 0, RESOLVED: 0, CLOSED: 0 });
    expect(contadoresPorStatus([{ status: "OPEN", total: 3 }, { status: "CLOSED", total: 7 }, { status: "INVENTADO", total: 9 }])).toEqual({
      OPEN: 3,
      ANALYSIS: 0,
      IN_PROGRESS: 0,
      RESOLVED: 0,
      CLOSED: 7,
    });
  });

  it("o título do chamado do motorista sai do tipo e do destinatário, sem passar do limite", () => {
    expect(tituloDoMotorista("DAMAGE", "Mercado Bom Preço")).toBe("Avaria na entrega para Mercado Bom Preço");
    expect(tituloDoMotorista("OTHER", "x".repeat(300))).toHaveLength(120);
  });

  it("filtros da lista: só status e tipo conhecidos entram", () => {
    expect(filtrosDaLista(new URLSearchParams("status=OPEN&type=DELAY"))).toEqual({ status: "OPEN", type: "DELAY" });
    expect(filtrosDaLista(new URLSearchParams("status=TODOS&type="))).toEqual({});
    expect(filtrosDaLista(new URLSearchParams(""))).toEqual({});
  });

  describe("validação", () => {
    const erroDe = (schema: { safeParse: (v: unknown) => { success: boolean; error?: { issues: { message: string }[] } } }, valor: unknown) => {
      const lido = schema.safeParse(valor);
      return lido.success ? null : lido.error!.issues[0].message;
    };
    const base = { type: "DELAY", title: "Carga atrasada", description: "Era para ter chegado ontem." };

    it("chamado da equipe: tipo, título e descrição são obrigatórios; o resto, em branco, vira nulo", () => {
      expect(createOccurrenceSchema.parse({ ...base, title: "  Carga atrasada ", priority: "", trackingCode: " ", clientId: "" })).toEqual({
        ...base,
        priority: null,
        trackingCode: null,
        clientId: null,
      });
      expect(createOccurrenceSchema.parse({ ...base, priority: "HIGH", trackingCode: " 1234567890 " })).toMatchObject({ priority: "HIGH", trackingCode: "1234567890" });

      expect(erroDe(createOccurrenceSchema, null)).toBe("Dados inválidos.");
      expect(erroDe(createOccurrenceSchema, { ...base, type: "ROUBO" })).toBe("Escolha o tipo do chamado.");
      expect(erroDe(createOccurrenceSchema, { ...base, title: "  " })).toBe("Informe o título.");
      expect(erroDe(createOccurrenceSchema, { ...base, title: "x".repeat(121) })).toBe("Título muito longo.");
      expect(erroDe(createOccurrenceSchema, { ...base, description: "" })).toBe("Descreva o que aconteceu.");
      expect(erroDe(createOccurrenceSchema, { ...base, description: "x".repeat(4001) })).toBe("Descrição muito longa.");
      expect(erroDe(createOccurrenceSchema, { ...base, priority: "URGENTE" })).toBe("Prioridade inválida.");
      expect(erroDe(createOccurrenceSchema, { ...base, trackingCode: "abc" })).toBe("Código de rastreio inválido.");
    });

    it("alteração: ao menos um campo; responsável em branco ou nulo tira o responsável", () => {
      expect(erroDe(updateOccurrenceSchema, {})).toBe("Informe ao menos um campo para alterar.");
      expect(erroDe(updateOccurrenceSchema, { status: "ARQUIVADO" })).toBe("Status inválido.");
      expect(erroDe(updateOccurrenceSchema, { priority: "URGENTE" })).toBe("Prioridade inválida.");
      expect(updateOccurrenceSchema.parse({ assigneeId: "" })).toEqual({ assigneeId: null });
      expect(updateOccurrenceSchema.parse({ assigneeId: null })).toEqual({ assigneeId: null });
      expect(updateOccurrenceSchema.parse({ status: "RESOLVED", priority: "LOW" })).toEqual({ status: "RESOLVED", priority: "LOW" });
    });

    it("mensagem: a da equipe é resposta por padrão; a do cliente não tem como virar nota interna", () => {
      expect(staffMessageSchema.parse({ body: " Já estamos vendo. " })).toEqual({ body: "Já estamos vendo.", internal: false });
      expect(staffMessageSchema.parse({ body: "x", internal: true })).toEqual({ body: "x", internal: true });
      expect(erroDe(staffMessageSchema, { body: " " })).toBe("Escreva a mensagem.");
      expect(erroDe(staffMessageSchema, { body: "x", internal: "sim" })).toBe("Dados inválidos.");
      expect(portalMessageSchema.parse({ body: "Obrigado", internal: true })).toEqual({ body: "Obrigado" });
      expect(erroDe(portalMessageSchema, { body: "x".repeat(4001) })).toBe("Mensagem muito longa.");
    });

    it("portal e motorista: só os campos de cada um", () => {
      expect(portalOccurrenceSchema.parse({ ...base, collectionId: "", priority: "HIGH", clientId: "outro" })).toEqual({ ...base, collectionId: null });
      expect(erroDe(portalOccurrenceSchema, { ...base, type: "" })).toBe("Escolha o tipo do chamado.");
      expect(driverOccurrenceSchema.parse({ type: "DAMAGE", description: " Caixa amassada ", title: "ignorado" })).toEqual({ type: "DAMAGE", description: "Caixa amassada" });
      expect(erroDe(driverOccurrenceSchema, { type: "DAMAGE" })).toBe("Descreva o que aconteceu.");
    });
  });
});

const temBanco = Boolean(process.env.DATABASE_URL);

if (!temBanco) {
  console.warn("\n[ocorrencias.test] DATABASE_URL ausente: testes de integração PULADOS.\n");
}

const suite = temBanco ? describe : describe.skip;

const PREFIXO = "teste-ocorrencias-";
const CNPJ_A = "99444111000155";
const CNPJ_B = "99444111000236";
const CNPJ_DA_OUTRA = "99444111000317";
const CPF = "99444111001";
const CPF_OUTRO = "99444111002";
const PLACA = "OCR1A11";
const RASTREIO_A = "9944411101";
const RASTREIO_B = "9944411102";
const RASTREIO_SOLTA = "9944411103";
const RASTREIO_DO_OUTRO_MOTORISTA = "9944411104";
const RASTREIO_DA_OUTRA = "9944411105";
const SEM_ID = "00000000-0000-0000-0000-000000000000";
const HASH_FALSO = "$2b$10$hashfalsoparateste000000000000000000000000000000000";

type Corpo = Record<string, unknown> & { id: string; error?: string };
type Recebido = { cabecalhos: Record<string, string | string[] | undefined>; json: Record<string, unknown> };

suite("ocorrências: painel, portal, motorista e avisos", () => {
  let banco: typeof import("../src/lib/prisma");
  let eventos: typeof import("../src/lib/eventos");
  let lista: typeof import("../src/app/api/ocorrencias/route");
  let chamado: typeof import("../src/app/api/ocorrencias/[id]/route");
  let mensagens: typeof import("../src/app/api/ocorrencias/[id]/mensagens/route");
  let portal: typeof import("../src/app/api/portal/atendimento/route");
  let portalChamado: typeof import("../src/app/api/portal/atendimento/[id]/route");
  let portalMensagens: typeof import("../src/app/api/portal/atendimento/[id]/mensagens/route");
  let doMotorista: typeof import("../src/app/api/driver/entregas/[id]/ocorrencia/route");

  const sessao = vi.mocked(getServerSession);
  // Usuários da empresa padrão, por papel no teste.
  const ids = { ADMIN: "", OPERATION: "", CLIENTE_A: "", CLIENTE_B: "", CLIENTE_SOLTO: "", DRIVER: "", OUTRO_DRIVER: "" };
  // Usuários da outra transportadora.
  const daOutra = { ADMIN: "", CLIENTE: "" };
  const PERFIL = { ADMIN: "ADMIN", OPERATION: "OPERATION", CLIENTE_A: "CLIENT", CLIENTE_B: "CLIENT", CLIENTE_SOLTO: "CLIENT", DRIVER: "DRIVER", OUTRO_DRIVER: "DRIVER" } as const;

  let clienteA: string;
  let clienteB: string;
  let cargaA: string;
  let cargaB: string;
  let cargaSolta: string;
  let cargaDoOutroMotorista: string;
  let cargaDaOutra: string;

  const entrarComo = (quem: keyof typeof ids | null) =>
    sessao.mockResolvedValue(quem ? { user: { id: ids[quem], role: PERFIL[quem], clientId: null } } : null);
  const entrarNaOutra = (quem: keyof typeof daOutra) =>
    sessao.mockResolvedValue({ user: { id: daOutra[quem], role: quem === "ADMIN" ? "ADMIN" : "CLIENT", clientId: null, tenantId: EMPRESA_OUTRA.id } });

  const req = (method = "GET", body?: unknown, query = "") =>
    new Request(`http://localhost/api/teste${query ? `?${query}` : ""}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

  const responder = async <T = Corpo>(res: Response) => ({ status: res.status, corpo: (await res.json()) as T & { error?: string } });

  const NOVO = { type: "DELAY", title: `${PREFIXO}carga atrasada`, description: "Era para ter chegado ontem." };

  /** Abre um chamado pela equipe e devolve o corpo. */
  async function abrir(dados: Record<string, unknown> = {}, quem: "ADMIN" | "OPERATION" = "OPERATION") {
    entrarComo(quem);
    const { status, corpo } = await responder(await lista.POST(req("POST", { ...NOVO, ...dados })));
    expect(status, JSON.stringify(corpo)).toBe(201);
    return corpo as Corpo & { number: number; status: string };
  }

  /** Abre um chamado pelo portal, como o cliente informado. */
  async function abrirNoPortal(quem: "CLIENTE_A" | "CLIENTE_B", dados: Record<string, unknown> = {}) {
    entrarComo(quem);
    const { status, corpo } = await responder(await portal.POST(req("POST", { ...NOVO, ...dados })));
    expect(status, JSON.stringify(corpo)).toBe(201);
    return corpo as Corpo & { number: number };
  }

  const mudar = async (id: string, dados: Record<string, unknown>) => responder(await chamado.PATCH(req("PATCH", dados), ctx(id)));

  const eventosDe = (tenantId: string) => banco.sistema.outboxEvent.findMany({ where: { tenantId }, orderBy: { createdAt: "asc" } });

  async function limparChamados() {
    const empresas = { tenantId: { in: [EMPRESA_PADRAO.id, EMPRESA_OUTRA.id] } };
    await banco.sistema.outboxEvent.deleteMany({ where: empresas });
    await banco.sistema.webhook.deleteMany({ where: empresas });
    // As mensagens vão junto com o chamado.
    await banco.sistema.occurrence.deleteMany({
      where: {
        OR: [
          { title: { startsWith: PREFIXO } },
          { openedBy: { email: { startsWith: PREFIXO } } },
          { client: { cnpj: { in: [CNPJ_A, CNPJ_B, CNPJ_DA_OUTRA] } } },
          { collection: { client: { cnpj: { in: [CNPJ_A, CNPJ_B, CNPJ_DA_OUTRA] } } } },
        ],
      },
    });
  }

  async function limpar() {
    const { sistema } = banco;
    await limparChamados();
    await sistema.collection.deleteMany({ where: { client: { cnpj: { in: [CNPJ_A, CNPJ_B, CNPJ_DA_OUTRA] } } } });
    await sistema.manifest.deleteMany({ where: { vehicle: { plate: PLACA } } });
    await sistema.vehicle.deleteMany({ where: { plate: PLACA } });
    await sistema.driver.deleteMany({ where: { cpf: { in: [CPF, CPF_OUTRO] } } });
    await sistema.user.deleteMany({ where: { email: { startsWith: PREFIXO } } });
    await sistema.client.deleteMany({ where: { cnpj: { in: [CNPJ_A, CNPJ_B, CNPJ_DA_OUTRA] } } });
  }

  const carga = (clientId: string, trackingCode: string, extra: Record<string, unknown> = {}) => ({
    clientId,
    sender: "Remetente",
    receiver: "Mercado Bom Preço",
    origin: "Rio Preto/SP",
    destination: "Mirassol/SP",
    volumes: 2,
    weight: 30,
    status: "ROUTE",
    trackingCode,
    ...extra,
  });

  let servidor: Server;
  let endereco: string;
  let recebidos: Recebido[] = [];

  beforeAll(async () => {
    process.env.TMS_WEBHOOK_PERMITE_LOCAL = "1";
    banco = await import("../src/lib/prisma");
    eventos = await import("../src/lib/eventos");
    lista = await import("../src/app/api/ocorrencias/route");
    chamado = await import("../src/app/api/ocorrencias/[id]/route");
    mensagens = await import("../src/app/api/ocorrencias/[id]/mensagens/route");
    portal = await import("../src/app/api/portal/atendimento/route");
    portalChamado = await import("../src/app/api/portal/atendimento/[id]/route");
    portalMensagens = await import("../src/app/api/portal/atendimento/[id]/mensagens/route");
    doMotorista = await import("../src/app/api/driver/entregas/[id]/ocorrencia/route");
    await limpar();

    const db = banco.default;
    clienteA = (await db.client.create({ data: { companyName: `${PREFIXO}cliente A ltda`, tradeName: `${PREFIXO}A`, cnpj: CNPJ_A, phone: "1733331111" } })).id;
    clienteB = (await db.client.create({ data: { companyName: `${PREFIXO}cliente B ltda`, cnpj: CNPJ_B } })).id;

    const vinculo = { CLIENTE_A: clienteA, CLIENTE_B: clienteB } as Record<string, string | undefined>;
    for (const quem of Object.keys(ids) as (keyof typeof ids)[]) {
      ids[quem] = (
        await db.user.create({
          data: { name: `${PREFIXO}${quem}`, email: `${PREFIXO}${quem.toLowerCase()}@exemplo.br`, password: HASH_FALSO, role: PERFIL[quem], clientId: vinculo[quem] },
        })
      ).id;
    }

    const motorista = await db.driver.create({ data: { userId: ids.DRIVER, cpf: CPF, cnh: "99444111001", cnhExpiry: new Date("2031-01-01T00:00:00.000Z"), category: "C" } });
    const outroMotorista = await db.driver.create({ data: { userId: ids.OUTRO_DRIVER, cpf: CPF_OUTRO, cnh: "99444111002", cnhExpiry: new Date("2031-01-01T00:00:00.000Z"), category: "C" } });
    const veiculo = await db.vehicle.create({ data: { plate: PLACA, model: `${PREFIXO}caminhão`, type: "TRUCK" } });
    const viagem = await db.manifest.create({ data: { driverId: motorista.id, vehicleId: veiculo.id, status: "ROUTE" } });
    const viagemDoOutro = await db.manifest.create({ data: { driverId: outroMotorista.id, vehicleId: veiculo.id, status: "ROUTE" } });

    cargaA = (await db.collection.create({ data: carga(clienteA, RASTREIO_A, { manifestId: viagem.id, driverId: motorista.id }) })).id;
    cargaB = (await db.collection.create({ data: carga(clienteB, RASTREIO_B, { status: "CONFIRMED" }) })).id;
    // Do cliente A, mas fora de qualquer viagem.
    cargaSolta = (await db.collection.create({ data: carga(clienteA, RASTREIO_SOLTA, { status: "CONFIRMED" }) })).id;
    cargaDoOutroMotorista = (await db.collection.create({ data: carga(clienteA, RASTREIO_DO_OUTRO_MOTORISTA, { manifestId: viagemDoOutro.id, driverId: outroMotorista.id }) })).id;

    const outra = banco.paraEmpresa(EMPRESA_OUTRA.id).db;
    const clienteDaOutra = await outra.client.create({ data: { companyName: `${PREFIXO}cliente da outra`, cnpj: CNPJ_DA_OUTRA } });
    daOutra.ADMIN = (await outra.user.create({ data: { name: `${PREFIXO}admin da outra`, email: `${PREFIXO}admin-outra@exemplo.br`, password: HASH_FALSO, role: "ADMIN" } })).id;
    daOutra.CLIENTE = (
      await outra.user.create({ data: { name: `${PREFIXO}cliente da outra`, email: `${PREFIXO}cliente-outra@exemplo.br`, password: HASH_FALSO, role: "CLIENT", clientId: clienteDaOutra.id } })
    ).id;
    cargaDaOutra = (await outra.collection.create({ data: carga(clienteDaOutra.id, RASTREIO_DA_OUTRA) })).id;

    servidor = createServer((pedido, res) => {
      let corpo = "";
      pedido.on("data", (parte) => (corpo += parte));
      pedido.on("end", () => {
        recebidos.push({ cabecalhos: pedido.headers, json: JSON.parse(corpo) });
        res.writeHead(200).end();
      });
    });
    await new Promise<void>((pronto) => servidor.listen(0, "127.0.0.1", pronto));
    endereco = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/webhook/tms`;
  });

  beforeEach(async () => {
    sessao.mockReset();
    recebidos = [];
    await limparChamados();
  });

  afterAll(async () => {
    delete process.env.TMS_WEBHOOK_PERMITE_LOCAL;
    if (servidor) await new Promise((fechado) => servidor.close(fechado));
    if (banco) await limpar();
  });

  describe("permissão", () => {
    it("painel: sem sessão é 401; cliente e motorista são 403; nada é gravado", async () => {
      const rotas: [string, () => Promise<Response>][] = [
        ["GET /api/ocorrencias", () => lista.GET(req())],
        ["POST /api/ocorrencias", () => lista.POST(req("POST", NOVO))],
        ["GET /api/ocorrencias/[id]", () => chamado.GET(req(), ctx(SEM_ID))],
        ["PATCH /api/ocorrencias/[id]", () => chamado.PATCH(req("PATCH", { status: "CLOSED" }), ctx(SEM_ID))],
        ["POST /api/ocorrencias/[id]/mensagens", () => mensagens.POST(req("POST", { body: "x" }), ctx(SEM_ID))],
      ];
      for (const [quem, esperado] of [[null, 401], ["CLIENTE_A", 403], ["DRIVER", 403]] as const) {
        for (const [nome, chamar] of rotas) {
          entrarComo(quem);
          expect((await chamar()).status, `${nome} como ${quem}`).toBe(esperado);
        }
      }
      expect(await banco.default.occurrence.count({ where: { title: { startsWith: PREFIXO } } })).toBe(0);
    });

    it("portal: só o perfil cliente entra; equipe, motorista e sem sessão são 401; cliente sem empresa é 403", async () => {
      const rotas: [string, () => Promise<Response>][] = [
        ["GET /api/portal/atendimento", () => portal.GET()],
        ["POST /api/portal/atendimento", () => portal.POST(req("POST", NOVO))],
        ["GET /api/portal/atendimento/[id]", () => portalChamado.GET(req(), ctx(SEM_ID))],
        ["POST /api/portal/atendimento/[id]/mensagens", () => portalMensagens.POST(req("POST", { body: "x" }), ctx(SEM_ID))],
      ];
      for (const [quem, esperado] of [[null, 401], ["ADMIN", 401], ["OPERATION", 401], ["DRIVER", 401], ["CLIENTE_SOLTO", 403]] as const) {
        for (const [nome, chamar] of rotas) {
          entrarComo(quem);
          expect((await chamar()).status, `${nome} como ${quem}`).toBe(esperado);
        }
      }
      expect(await banco.default.occurrence.count({ where: { title: { startsWith: PREFIXO } } })).toBe(0);
    });

    it("motorista: só quem tem cadastro de motorista registra ocorrência na entrega", async () => {
      for (const quem of [null, "ADMIN", "OPERATION", "CLIENTE_A"] as const) {
        entrarComo(quem);
        const res = await doMotorista.POST(req("POST", { type: "DAMAGE", description: "Caixa amassada" }), ctx(cargaA));
        expect(res.status, String(quem)).toBe(401);
      }
      expect(await banco.default.occurrence.count({ where: { collectionId: cargaA } })).toBe(0);
    });
  });

  describe("painel", () => {
    it("recusa dados inválidos, código de rastreio que não existe, cliente que não existe e cliente que não é o dono da carga", async () => {
      entrarComo("OPERATION");
      const casos: [Record<string, unknown> | null, RegExp][] = [
        [null, /Dados inválidos/],
        [{ ...NOVO, type: "ROUBO" }, /tipo do chamado/],
        [{ ...NOVO, title: "" }, /título/],
        [{ ...NOVO, description: " " }, /Descreva/],
        [{ ...NOVO, trackingCode: "0000000001" }, /Nenhuma carga com este código/],
        [{ ...NOVO, trackingCode: RASTREIO_DA_OUTRA }, /Nenhuma carga com este código/],
        [{ ...NOVO, clientId: SEM_ID }, /Cliente não encontrado/],
        [{ ...NOVO, trackingCode: RASTREIO_A, clientId: clienteB }, /outro cliente/],
      ];
      for (const [corpo, mensagem] of casos) {
        const res = await responder(await lista.POST(req("POST", corpo)));
        expect(res.status, JSON.stringify(corpo)).toBe(400);
        expect(res.corpo.error).toMatch(mensagem);
      }
      expect(await banco.default.occurrence.count({ where: { title: { startsWith: PREFIXO } } })).toBe(0);
    });

    it("abre pelo código de rastreio (liga à carga e ao dono dela), por cliente ou só interno, com número em sequência", async () => {
      const comCarga = await abrir({ trackingCode: RASTREIO_A, priority: "HIGH" });
      expect(comCarga).toMatchObject({
        type: "DELAY",
        status: "OPEN",
        priority: "HIGH",
        origin: "STAFF",
        resolvedAt: null,
        closedAt: null,
        client: { id: clienteA, cnpj: CNPJ_A },
        collection: { id: cargaA, trackingCode: RASTREIO_A, destination: "Mirassol/SP", client: { cnpj: CNPJ_A } },
        openedBy: { id: ids.OPERATION },
        assignee: null,
      });

      const doCliente = await abrir({ clientId: clienteB, type: "BILLING" }, "ADMIN");
      expect(doCliente).toMatchObject({ number: comCarga.number + 1, priority: "NORMAL", client: { id: clienteB }, collection: null, openedBy: { id: ids.ADMIN } });

      const interno = await abrir({ type: "OTHER" });
      expect(interno).toMatchObject({ number: comCarga.number + 2, client: null, collection: null });
    });

    it("chamados abertos ao mesmo tempo não repetem nem pulam número", async () => {
      const antes = await abrir();
      entrarComo("OPERATION");
      const respostas = await Promise.all(Array.from({ length: 6 }, () => lista.POST(req("POST", NOVO))));
      expect(respostas.map((r) => r.status)).toEqual([201, 201, 201, 201, 201, 201]);
      const numeros = (await Promise.all(respostas.map((r) => r.json() as Promise<{ number: number }>))).map((c) => c.number).sort((a, b) => a - b);
      expect(numeros).toEqual([1, 2, 3, 4, 5, 6].map((n) => antes.number + n));
    });

    it("lista do mais novo para o mais antigo, filtra por status e tipo, e os contadores são sempre de todos", async () => {
      const atraso = await abrir({ trackingCode: RASTREIO_A });
      const avaria = await abrir({ type: "DAMAGE", clientId: clienteB });
      const cobranca = await abrir({ type: "BILLING" });
      entrarComo("ADMIN");
      expect((await mudar(avaria.id, { status: "ANALYSIS" })).status).toBe(200);
      expect((await mudar(cobranca.id, { status: "CLOSED" })).status).toBe(200);

      type Lista = { contadores: Record<string, number>; ocorrencias: (Corpo & { _count: { messages: number } })[] };
      const ler = async (query = "") => {
        const { status, corpo } = await responder<Lista>(await lista.GET(req("GET", undefined, query)));
        expect(status).toBe(200);
        return corpo;
      };
      const contadores = { OPEN: 1, ANALYSIS: 1, IN_PROGRESS: 0, RESOLVED: 0, CLOSED: 1 };

      const tudo = await ler();
      expect(tudo.contadores).toEqual(contadores);
      expect(tudo.ocorrencias.map((o) => o.id)).toEqual([cobranca.id, avaria.id, atraso.id]);
      expect(tudo.ocorrencias[2]).toMatchObject({ collection: { id: cargaA, trackingCode: RASTREIO_A }, _count: { messages: 0 } });

      const abertos = await ler("status=OPEN");
      expect(abertos.ocorrencias.map((o) => o.id)).toEqual([atraso.id]);
      expect(abertos.contadores).toEqual(contadores);

      expect((await ler("type=DAMAGE")).ocorrencias.map((o) => o.id)).toEqual([avaria.id]);
      expect((await ler("status=CLOSED&type=DAMAGE")).ocorrencias).toEqual([]);
      // Filtro desconhecido é ignorado, não vira lista vazia.
      expect((await ler("status=INVENTADO")).ocorrencias).toHaveLength(3);
    });

    it("fluxo de status: avança, resolve, reabre, resolve de novo e encerra; depois de encerrado nada muda", async () => {
      const { id } = await abrir({ clientId: clienteA });
      entrarComo("OPERATION");

      expect((await mudar(id, { status: "ANALYSIS" })).corpo).toMatchObject({ status: "ANALYSIS", proximosStatus: ["IN_PROGRESS", "RESOLVED", "CLOSED"] });
      expect((await mudar(id, { status: "IN_PROGRESS" })).corpo).toMatchObject({ status: "IN_PROGRESS", resolvedAt: null });

      const voltar = await mudar(id, { status: "OPEN" });
      expect(voltar.status).toBe(409);
      expect(voltar.corpo.error).toBe('O chamado não pode voltar de "Em tratamento" para "Aberto".');
      expect((await mudar(id, { status: "IN_PROGRESS" })).status).toBe(409);

      const resolvido = await mudar(id, { status: "RESOLVED" });
      expect(resolvido.corpo).toMatchObject({ status: "RESOLVED", closedAt: null, proximosStatus: ["IN_PROGRESS", "CLOSED"] });
      expect(resolvido.corpo.resolvedAt).not.toBeNull();

      // Reabrir volta para Em tratamento e apaga a data de resolução.
      expect((await mudar(id, { status: "IN_PROGRESS" })).corpo).toMatchObject({ status: "IN_PROGRESS", resolvedAt: null });
      expect((await mudar(id, { status: "RESOLVED" })).status).toBe(200);

      const encerrado = await mudar(id, { status: "CLOSED" });
      expect(encerrado.corpo).toMatchObject({ status: "CLOSED", proximosStatus: [] });
      expect(encerrado.corpo.closedAt).not.toBeNull();
      expect(encerrado.corpo.resolvedAt).not.toBeNull();

      for (const status of ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]) {
        const res = await mudar(id, { status });
        expect(res.status, status).toBe(409);
        expect(res.corpo.error).toBe("Chamado encerrado não muda mais de status.");
      }
      // Encerrado também não recebe mensagem, nem da equipe nem do cliente.
      expect((await mensagens.POST(req("POST", { body: "só mais uma coisa" }), ctx(id))).status).toBe(409);
      entrarComo("CLIENTE_A");
      const doCliente = await responder(await portalMensagens.POST(req("POST", { body: "ainda não chegou" }), ctx(id)));
      expect(doCliente.status).toBe(409);
      expect(doCliente.corpo.error).toMatch(/encerrado/);
      expect(await banco.default.occurrenceMessage.count({ where: { occurrenceId: id } })).toBe(0);

      expect((await banco.default.occurrence.findUniqueOrThrow({ where: { id } })).status).toBe("CLOSED");
    });

    it("prioridade e responsável: só alguém da equipe desta empresa assume; em branco tira o responsável", async () => {
      const { id } = await abrir();
      entrarComo("ADMIN");

      expect((await mudar(id, {})).status).toBe(400);
      expect((await mudar(id, { priority: "URGENTE" })).status).toBe(400);
      expect((await mudar(SEM_ID, { priority: "LOW" })).status).toBe(404);

      expect((await mudar(id, { priority: "LOW", assigneeId: ids.OPERATION })).corpo).toMatchObject({ priority: "LOW", status: "OPEN", assignee: { id: ids.OPERATION, name: `${PREFIXO}OPERATION` } });

      for (const invasor of [ids.CLIENTE_A, ids.DRIVER, daOutra.ADMIN, SEM_ID]) {
        const res = await mudar(id, { assigneeId: invasor });
        expect(res.status, invasor).toBe(400);
        expect(res.corpo.error).toBe("O responsável precisa ser um usuário da equipe.");
      }
      expect((await banco.default.occurrence.findUniqueOrThrow({ where: { id } })).assigneeId).toBe(ids.OPERATION);

      expect((await mudar(id, { assigneeId: "" })).corpo).toMatchObject({ assignee: null, priority: "LOW" });
    });

    it("a tela do chamado traz a conversa em ordem, com as notas internas, e a equipe que pode assumir", async () => {
      const { id } = await abrir({ clientId: clienteA });
      entrarComo("OPERATION");

      expect((await mensagens.POST(req("POST", { body: " " }), ctx(id))).status).toBe(400);
      expect((await mensagens.POST(req("POST", { body: "x" }), ctx(SEM_ID))).status).toBe(404);

      const resposta = await responder(await mensagens.POST(req("POST", { body: "Estamos verificando com o motorista." }), ctx(id)));
      expect(resposta.status).toBe(201);
      expect(resposta.corpo).toMatchObject({ internal: false, fromClient: false, author: { id: ids.OPERATION } });
      entrarComo("ADMIN");
      const nota = await responder(await mensagens.POST(req("POST", { body: "Cliente já reclamou duas vezes este mês.", internal: true }), ctx(id)));
      expect(nota.corpo).toMatchObject({ internal: true, fromClient: false, author: { id: ids.ADMIN } });

      const { status, corpo } = await responder<Corpo & { messages: Corpo[]; equipe: { id: string }[]; proximosStatus: string[] }>(await chamado.GET(req(), ctx(id)));
      expect(status).toBe(200);
      expect(corpo.messages.map((m) => [m.body, m.internal])).toEqual([
        ["Estamos verificando com o motorista.", false],
        ["Cliente já reclamou duas vezes este mês.", true],
      ]);
      expect(corpo.proximosStatus).toEqual(["ANALYSIS", "IN_PROGRESS", "RESOLVED", "CLOSED"]);
      const equipe = corpo.equipe.map((u) => u.id);
      expect(equipe).toEqual(expect.arrayContaining([ids.ADMIN, ids.OPERATION]));
      for (const fora of [ids.CLIENTE_A, ids.DRIVER, daOutra.ADMIN]) expect(equipe).not.toContain(fora);

      expect((await chamado.GET(req(), ctx(SEM_ID))).status).toBe(404);
    });
  });

  describe("portal do cliente", () => {
    it("abre com uma carga dele ou sem carga; carga de outro cliente ou de outra transportadora é recusada", async () => {
      entrarComo("CLIENTE_A");
      for (const [corpo, mensagem] of [
        [{}, /tipo do chamado/],
        [{ ...NOVO, title: " " }, /título/],
        [{ ...NOVO, collectionId: cargaB }, /Carga não encontrada/],
        [{ ...NOVO, collectionId: cargaDaOutra }, /Carga não encontrada/],
        [{ ...NOVO, collectionId: SEM_ID }, /Carga não encontrada/],
      ] as const) {
        const res = await responder(await portal.POST(req("POST", corpo)));
        expect(res.status, JSON.stringify(corpo)).toBe(400);
        expect(res.corpo.error).toMatch(mensagem);
      }
      expect(await banco.default.occurrence.count({ where: { clientId: clienteA } })).toBe(0);

      // Prioridade e cliente no corpo são ignorados: quem define é a rota.
      const comCarga = await abrirNoPortal("CLIENTE_A", { collectionId: cargaSolta, priority: "HIGH", clientId: clienteB, origin: "STAFF" });
      expect(comCarga).toMatchObject({ status: "OPEN", origin: "CLIENT", collection: { id: cargaSolta, trackingCode: RASTREIO_SOLTA } });
      expect(Object.keys(comCarga).sort()).toEqual(["closedAt", "collection", "description", "id", "number", "openedAt", "origin", "resolvedAt", "status", "title", "type"]);
      expect(await banco.default.occurrence.findUniqueOrThrow({ where: { id: comCarga.id } })).toMatchObject({
        clientId: clienteA,
        openedById: ids.CLIENTE_A,
        origin: "CLIENT",
        priority: "NORMAL",
        assigneeId: null,
      });

      const semCarga = await abrirNoPortal("CLIENTE_A", { type: "BILLING" });
      expect(semCarga).toMatchObject({ number: comCarga.number + 1, collection: null });
    });

    it("o cliente só lista os chamados da empresa dele: nem os de outro cliente, nem os internos", async () => {
      const meu = await abrirNoPortal("CLIENTE_A");
      const doB = await abrirNoPortal("CLIENTE_B");
      const abertoPelaEquipeParaA = await abrir({ trackingCode: RASTREIO_A });
      const abertoPelaEquipeParaB = await abrir({ clientId: clienteB });
      const interno = await abrir();

      const listar = async (quem: "CLIENTE_A" | "CLIENTE_B") => {
        entrarComo(quem);
        const { status, corpo } = await responder<Corpo[]>(await portal.GET());
        expect(status).toBe(200);
        return (corpo as unknown as Corpo[]).map((o) => o.id);
      };

      expect(await listar("CLIENTE_A")).toEqual([abertoPelaEquipeParaA.id, meu.id]);
      expect(await listar("CLIENTE_B")).toEqual([abertoPelaEquipeParaB.id, doB.id]);
      expect(await listar("CLIENTE_A")).not.toContain(interno.id);
    });

    it("cliente A não lê nem responde chamado do cliente B, nem chamado interno: 404 e nada gravado", async () => {
      const doB = await abrirNoPortal("CLIENTE_B");
      const interno = await abrir();
      const meu = await abrirNoPortal("CLIENTE_A");

      entrarComo("CLIENTE_A");
      for (const alheio of [doB.id, interno.id, SEM_ID]) {
        const lido = await responder(await portalChamado.GET(req(), ctx(alheio)));
        expect(lido.status, alheio).toBe(404);
        expect(lido.corpo).toEqual({ error: "Atendimento não encontrado." });

        const respondido = await responder(await portalMensagens.POST(req("POST", { body: "invasão" }), ctx(alheio)));
        expect(respondido.status, alheio).toBe(404);
      }
      expect(await banco.default.occurrenceMessage.count({ where: { occurrenceId: { in: [doB.id, interno.id] } } })).toBe(0);

      // O próprio ele lê e responde.
      expect((await portalChamado.GET(req(), ctx(meu.id))).status).toBe(200);
      expect((await portalMensagens.POST(req("POST", { body: "alguma novidade?" }), ctx(meu.id))).status).toBe(201);

      // E o B segue lendo o dele, sem a tentativa do A.
      entrarComo("CLIENTE_B");
      const { corpo } = await responder<Corpo & { messages: Corpo[] }>(await portalChamado.GET(req(), ctx(doB.id)));
      expect(corpo.messages).toEqual([]);
    });

    it("a conversa do cliente não traz nota interna, nem prioridade, responsável ou o nome de quem respondeu", async () => {
      const meu = await abrirNoPortal("CLIENTE_A", { collectionId: cargaSolta });
      entrarComo("ADMIN");
      await mudar(meu.id, { priority: "HIGH", assigneeId: ids.OPERATION, status: "ANALYSIS" });
      await mensagens.POST(req("POST", { body: "Recebemos, vamos verificar." }), ctx(meu.id));
      await mensagens.POST(req("POST", { body: "SEGREDO: cliente inadimplente, não priorizar.", internal: true }), ctx(meu.id));

      entrarComo("CLIENTE_A");
      const enviada = await responder(await portalMensagens.POST(req("POST", { body: " Obrigado, aguardo. ", internal: true }), ctx(meu.id)));
      expect(enviada.status).toBe(201);
      expect(enviada.corpo).toMatchObject({ body: "Obrigado, aguardo.", fromClient: true });
      expect(Object.keys(enviada.corpo).sort()).toEqual(["body", "createdAt", "fromClient", "id"]);
      // A mensagem do cliente nunca é nota interna, mesmo pedindo.
      expect(await banco.default.occurrenceMessage.findUniqueOrThrow({ where: { id: enviada.corpo.id } })).toMatchObject({ internal: false, fromClient: true, authorId: ids.CLIENTE_A });

      const res = await portalChamado.GET(req(), ctx(meu.id));
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
      const bruto = await res.text();
      const corpo = JSON.parse(bruto) as Corpo & { messages: Corpo[]; podeResponder: boolean };

      expect(corpo.messages.map((m) => [m.body, m.fromClient])).toEqual([
        ["Recebemos, vamos verificar.", false],
        ["Obrigado, aguardo.", true],
      ]);
      expect(corpo).toMatchObject({ status: "ANALYSIS", podeResponder: true });
      for (const proibido of ["SEGREDO", "inadimplente", "internal", "priority", "assignee", "HIGH", `${PREFIXO}ADMIN`, `${PREFIXO}OPERATION`, ids.OPERATION, ids.ADMIN, "author"]) {
        expect(bruto, proibido).not.toContain(proibido);
      }

      // A lista também não traz nada disso.
      const listaBruta = await (await portal.GET()).text();
      for (const proibido of ["SEGREDO", "priority", "assignee", "HIGH"]) expect(listaBruta, proibido).not.toContain(proibido);

      // A equipe vê as três mensagens, com a do cliente marcada.
      entrarComo("OPERATION");
      const daEquipe = await responder<Corpo & { messages: Corpo[] }>(await chamado.GET(req(), ctx(meu.id)));
      expect(daEquipe.corpo.messages.map((m) => [m.internal, m.fromClient])).toEqual([[false, false], [true, false], [false, true]]);
    });

    it("o cliente responde enquanto o chamado não estiver encerrado, inclusive depois de resolvido", async () => {
      const meu = await abrirNoPortal("CLIENTE_A");
      entrarComo("ADMIN");
      await mudar(meu.id, { status: "RESOLVED" });

      entrarComo("CLIENTE_A");
      expect((await portalMensagens.POST(req("POST", { body: "" }), ctx(meu.id))).status).toBe(400);
      expect((await portalMensagens.POST(req("POST", { body: "Ainda veio faltando uma caixa." }), ctx(meu.id))).status).toBe(201);

      entrarComo("ADMIN");
      await mudar(meu.id, { status: "CLOSED" });
      entrarComo("CLIENTE_A");
      expect((await portalMensagens.POST(req("POST", { body: "E agora?" }), ctx(meu.id))).status).toBe(409);
      const lido = await responder<Corpo & { messages: Corpo[]; podeResponder: boolean }>(await portalChamado.GET(req(), ctx(meu.id)));
      expect(lido.corpo).toMatchObject({ status: "CLOSED", podeResponder: false });
      expect(lido.corpo.messages).toHaveLength(1);
    });
  });

  describe("motorista", () => {
    const registrar = async (id: string, corpo: unknown = { type: "DAMAGE", description: " Caixa chegou amassada. " }) =>
      responder<{ id: string; number: number; success: boolean }>(await doMotorista.POST(req("POST", corpo), ctx(id)));

    it("registra numa entrega da viagem dele: nasce chamado interno ligado à carga, que o cliente não vê", async () => {
      entrarComo("DRIVER");
      expect((await registrar(cargaA, { type: "DAMAGE" })).status).toBe(400);
      expect((await registrar(cargaA, { type: "FURTO", description: "x" })).status).toBe(400);

      const { status, corpo } = await registrar(cargaA);
      expect(status).toBe(201);
      expect(corpo).toMatchObject({ success: true });

      expect(await banco.default.occurrence.findUniqueOrThrow({ where: { id: corpo.id } })).toMatchObject({
        number: corpo.number,
        type: "DAMAGE",
        title: "Avaria na entrega para Mercado Bom Preço",
        description: "Caixa chegou amassada.",
        status: "OPEN",
        priority: "NORMAL",
        origin: "STAFF",
        collectionId: cargaA,
        clientId: null,
        openedById: ids.DRIVER,
      });

      // A equipe vê, com a carga e o dono dela; o cliente dono da carga, não.
      entrarComo("OPERATION");
      const noPainel = await responder<Corpo>(await chamado.GET(req(), ctx(corpo.id)));
      expect(noPainel.corpo).toMatchObject({ client: null, collection: { trackingCode: RASTREIO_A, client: { id: clienteA } }, openedBy: { name: `${PREFIXO}DRIVER` } });

      entrarComo("CLIENTE_A");
      expect(await (await portal.GET()).json()).toEqual([]);
      expect((await portalChamado.GET(req(), ctx(corpo.id))).status).toBe(404);
    });

    it("carga de outro motorista, fora de viagem, de outra transportadora ou inexistente é 404 e nada é gravado", async () => {
      entrarComo("DRIVER");
      for (const alheia of [cargaDoOutroMotorista, cargaSolta, cargaB, cargaDaOutra, SEM_ID]) {
        const res = await registrar(alheia);
        expect(res.status, alheia).toBe(404);
        expect(res.corpo.error).toBe("Entrega não encontrada na sua viagem.");
      }
      expect(await banco.sistema.occurrence.count({ where: { openedById: ids.DRIVER } })).toBe(0);
    });
  });

  describe("isolamento entre transportadoras", () => {
    it("a outra transportadora não lista, não lê, não altera nem responde chamado desta, no painel e no portal", async () => {
      const daqui = await abrir({ trackingCode: RASTREIO_A });
      const doClienteDaqui = await abrirNoPortal("CLIENTE_A");

      entrarNaOutra("ADMIN");
      const listaDaOutra = await responder<{ contadores: Record<string, number>; ocorrencias: Corpo[] }>(await lista.GET(req()));
      expect(listaDaOutra.status).toBe(200);
      expect(listaDaOutra.corpo.ocorrencias).toEqual([]);
      expect(listaDaOutra.corpo.contadores).toEqual({ OPEN: 0, ANALYSIS: 0, IN_PROGRESS: 0, RESOLVED: 0, CLOSED: 0 });
      for (const id of [daqui.id, doClienteDaqui.id]) {
        expect((await chamado.GET(req(), ctx(id))).status).toBe(404);
        expect((await mudar(id, { status: "CLOSED" })).status).toBe(404);
        expect((await mensagens.POST(req("POST", { body: "invasão" }), ctx(id))).status).toBe(404);
      }

      entrarNaOutra("CLIENTE");
      expect(await (await portal.GET()).json()).toEqual([]);
      for (const id of [daqui.id, doClienteDaqui.id]) {
        expect((await portalChamado.GET(req(), ctx(id))).status).toBe(404);
        expect((await portalMensagens.POST(req("POST", { body: "invasão" }), ctx(id))).status).toBe(404);
      }
      // Carga desta transportadora não serve para abrir chamado na outra.
      expect((await portal.POST(req("POST", { ...NOVO, collectionId: cargaA }))).status).toBe(400);

      // Lido pelo caminho de sistema: a sessão simulada ainda é a da outra transportadora.
      const intactos = await banco.sistema.occurrence.findMany({ where: { id: { in: [daqui.id, doClienteDaqui.id] } }, select: { status: true, _count: { select: { messages: true } } } });
      expect(intactos).toEqual([{ status: "OPEN", _count: { messages: 0 } }, { status: "OPEN", _count: { messages: 0 } }]);
    });

    it("cada transportadora tem a própria numeração, e o banco recusa chamado apontando para carga ou usuário de outra", async () => {
      const daqui = await abrir();
      await abrir();

      entrarNaOutra("CLIENTE");
      const { status, corpo } = await responder<Corpo & { number: number }>(await portal.POST(req("POST", { ...NOVO, collectionId: cargaDaOutra })));
      expect(status).toBe(201);
      // A outra começa do 1, mesmo com esta já adiante.
      expect(corpo.number).toBe(1);
      expect(daqui.number).toBeGreaterThanOrEqual(1);
      expect((await banco.sistema.occurrence.findUniqueOrThrow({ where: { id: corpo.id } })).tenantId).toBe(EMPRESA_OUTRA.id);
      // Daqui, o chamado da outra não existe.
      expect(await banco.paraEmpresa(EMPRESA_PADRAO.id).db.occurrence.count({ where: { id: corpo.id } })).toBe(0);

      const outra = banco.paraEmpresa(EMPRESA_OUTRA.id).db;
      await expect(outra.occurrence.create({ data: { number: 900, type: "OTHER", title: `${PREFIXO}cruzado`, description: "x", collectionId: cargaA } })).rejects.toThrow();
      await expect(outra.occurrence.create({ data: { number: 901, type: "OTHER", title: `${PREFIXO}cruzado`, description: "x", assigneeId: ids.ADMIN } })).rejects.toThrow();
      await expect(outra.occurrenceMessage.create({ data: { occurrenceId: daqui.id, body: "invasão" } })).rejects.toThrow();
    });
  });

  describe("avisos para sistemas de fora", () => {
    const cadastrarEndereco = (tenantId = EMPRESA_PADRAO.id) =>
      banco.sistema.webhook.create({ data: { tenantId, url: endereco, secret: "segredo-de-teste-das-ocorrencias" } });

    it("empresa sem endereço cadastrado não gera aviso de chamado", async () => {
      const { id } = await abrir({ trackingCode: RASTREIO_A });
      entrarComo("ADMIN");
      await mudar(id, { status: "RESOLVED" });
      await abrirNoPortal("CLIENTE_A");
      entrarComo("DRIVER");
      await doMotorista.POST(req("POST", { type: "DAMAGE", description: "Caixa amassada" }), ctx(cargaA));

      expect(await eventosDe(EMPRESA_PADRAO.id)).toHaveLength(0);
      expect(await eventos.despacharPendentes()).toEqual({ entregues: 0, falhas: 0 });
    });

    it("abrir e trocar o status viram avisos; prioridade, responsável e mensagem não; troca recusada também não", async () => {
      await cadastrarEndereco();
      const { id, number } = await abrir({ trackingCode: RASTREIO_A, priority: "HIGH" });
      entrarComo("ADMIN");
      await mudar(id, { priority: "LOW", assigneeId: ids.OPERATION });
      await mensagens.POST(req("POST", { body: "Vamos verificar." }), ctx(id));
      await mudar(id, { status: "IN_PROGRESS" });
      expect((await mudar(id, { status: "OPEN" })).status).toBe(409);

      const fila = await eventosDe(EMPRESA_PADRAO.id);
      expect(fila.map((e) => [e.type, e.payload, e.attempts, e.deliveredAt])).toEqual([
        ["ocorrencia.aberta", { occurrenceId: id }, 0, null],
        ["ocorrencia.status", { occurrenceId: id }, 0, null],
      ]);

      expect(await eventos.despacharPendentes()).toEqual({ entregues: 2, falhas: 0 });
      expect(recebidos.map((r) => [r.json.tipo, r.cabecalhos["x-tms-evento"]])).toEqual([
        ["ocorrencia.aberta", "ocorrencia.aberta"],
        ["ocorrencia.status", "ocorrencia.status"],
      ]);
      // Os detalhes são lidos na hora da entrega: os dois trazem o chamado como está agora.
      for (const recebido of recebidos) {
        expect(recebido.json).toMatchObject({ empresa: { id: EMPRESA_PADRAO.id, slug: EMPRESA_PADRAO.slug } });
        expect(recebido.json.dados).toMatchObject({
          ocorrencia: {
            id,
            numero: number,
            tipo: "DELAY",
            titulo: NOVO.title,
            status: "IN_PROGRESS",
            prioridade: "LOW",
            abertaPor: "STAFF",
            cliente: { id: clienteA, nome: `${PREFIXO}A`, cnpj: CNPJ_A, telefone: "1733331111" },
            carga: { id: cargaA, destinatario: "Mercado Bom Preço", destino: "Mirassol/SP", rastreio: { codigo: RASTREIO_A } },
          },
        });
      }
      const dados = recebidos[0].json.dados as { ocorrencia: { painel: string; carga: { rastreio: { link: string } } } };
      expect(dados.ocorrencia.carga.rastreio.link).toContain(`/rastreio?cnpj=${CNPJ_A}&codigo=${RASTREIO_A}`);
      expect(dados.ocorrencia.painel).toMatch(new RegExp(`/dashboard/ocorrencias/${id}$`));
      // A descrição e a conversa não saem no aviso.
      expect(JSON.stringify(recebidos)).not.toContain("Vamos verificar.");
      expect(JSON.stringify(recebidos)).not.toContain(NOVO.description);

      // Entregue não sai de novo.
      expect(await eventos.despacharPendentes()).toEqual({ entregues: 0, falhas: 0 });
    });

    it("chamado do portal e do motorista também avisam; o do motorista leva o dono da carga como cliente", async () => {
      await cadastrarEndereco();
      const doCliente = await abrirNoPortal("CLIENTE_A", { type: "BILLING" });
      entrarComo("DRIVER");
      const doMotoristaCorpo = (await (await doMotorista.POST(req("POST", { type: "DAMAGE", description: "Caixa amassada" }), ctx(cargaA))).json()) as { id: string };

      expect((await eventosDe(EMPRESA_PADRAO.id)).map((e) => [e.type, e.payload])).toEqual([
        ["ocorrencia.aberta", { occurrenceId: doCliente.id }],
        ["ocorrencia.aberta", { occurrenceId: doMotoristaCorpo.id }],
      ]);
      expect(await eventos.despacharPendentes()).toEqual({ entregues: 2, falhas: 0 });

      expect(recebidos[0].json.dados).toMatchObject({ ocorrencia: { id: doCliente.id, tipo: "BILLING", abertaPor: "CLIENT", prioridade: "NORMAL", cliente: { id: clienteA }, carga: null } });
      expect(recebidos[1].json.dados).toMatchObject({
        ocorrencia: { id: doMotoristaCorpo.id, tipo: "DAMAGE", abertaPor: "STAFF", titulo: "Avaria na entrega para Mercado Bom Preço", cliente: { id: clienteA }, carga: { id: cargaA } },
      });
    });

    it("chamado sem cliente nem carga sai com os dois nulos; chamado apagado antes da entrega sai sem dados", async () => {
      await cadastrarEndereco();
      const interno = await abrir({ type: "OTHER" });
      const apagado = await abrir();
      await banco.sistema.occurrence.delete({ where: { id: apagado.id } });

      expect(await eventos.despacharPendentes()).toEqual({ entregues: 2, falhas: 0 });
      expect(recebidos[0].json.dados).toMatchObject({ ocorrencia: { id: interno.id, cliente: null, carga: null } });
      expect(recebidos[1].json.dados).toEqual({ ocorrencia: null });
    });

    it("isolamento: chamado da outra transportadora não gera aviso para o endereço desta", async () => {
      await cadastrarEndereco();
      entrarNaOutra("CLIENTE");
      expect((await portal.POST(req("POST", NOVO))).status).toBe(201);

      expect(await eventosDe(EMPRESA_OUTRA.id)).toHaveLength(0);
      expect(await eventosDe(EMPRESA_PADRAO.id)).toHaveLength(0);
      expect(await eventos.despacharPendentes()).toEqual({ entregues: 0, falhas: 0 });
      expect(recebidos).toHaveLength(0);
    });
  });
});
