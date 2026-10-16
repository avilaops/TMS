import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getServerSession } from "next-auth";
import { randomInt } from "node:crypto";
import { EMPRESA_OUTRA, EMPRESA_PADRAO } from "./empresas-de-teste";
import {
  DIAS_PARA_COBRAR,
  csvDeCotacoes,
  diasParada,
  divergenciaDeFrete,
  filtrosDaLista,
  linhasDoCsv,
  ondeDaLista,
  resumoDoFunil,
  type LeadDaLista,
} from "../src/lib/crm";

/**
 * Funil de cotações (CRM) e conversão da cotação em coleta, contra um
 * Postgres de verdade.
 */
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

// O sorteio do código de rastreio é o de verdade; um caso força a repetição.
vi.mock("node:crypto", async (original) => {
  const real = await original<typeof import("node:crypto")>();
  return { ...real, randomInt: vi.fn(real.randomInt) };
});

const temBanco = Boolean(process.env.DATABASE_URL);

if (!temBanco) {
  console.warn("\n[crm.test] DATABASE_URL ausente: testes de integração PULADOS.\n");
}

const suite = temBanco ? describe : describe.skip;

/** Sem banco: quando a tela avisa que o frete da coleta não é o valor da cotação. */
describe("divergência entre o valor estimado do lead e o frete da coleta", () => {
  it("avisa quando os valores diferem ou a coleta nasceu a cotar; cala quando batem ou não há o que comparar", () => {
    expect(divergenciaDeFrete(150, 50)).toEqual({ estimado: 150, frete: 50 });
    expect(divergenciaDeFrete(0, 50)).toEqual({ estimado: 0, frete: 50 });
    expect(divergenciaDeFrete(150, null)).toEqual({ estimado: 150, frete: null });
    expect(divergenciaDeFrete(150, 0)).toEqual({ estimado: 150, frete: 0 });

    expect(divergenciaDeFrete(150, 150)).toBeNull();
    // Diferença menor que um centavo é a mesma conta com outro arredondamento.
    expect(divergenciaDeFrete(0.1 + 0.2, 0.3)).toBeNull();
    // Lead sem valor estimado: não há preço combinado para divergir.
    expect(divergenciaDeFrete(null, 50)).toBeNull();
    expect(divergenciaDeFrete(null, null)).toBeNull();
    // Resposta sem o frete (rota antiga): a tela não inventa um aviso.
    expect(divergenciaDeFrete(150, undefined)).toBeNull();
  });
});

const AGORA = new Date("2026-10-16T12:00:00.000Z");
const haDias = (dias: number) => new Date(AGORA.getTime() - dias * 24 * 60 * 60 * 1000);

/** Uma cotação como a lista devolve, para os testes sem banco. */
const daLista = (extra: Partial<LeadDaLista> = {}): LeadDaLista => ({
  id: "lead-1",
  number: 12,
  companyName: "Indústria Interessada",
  email: "compras@industria.br",
  phone: "17999990000",
  origin: "São José do Rio Preto",
  destination: "Mirassol",
  volumes: 3,
  weight: 120.5,
  estimatedValue: 150,
  invoiceValue: 2000,
  status: "NEW",
  channel: "SITE",
  lostReason: null,
  lastActivityAt: AGORA,
  createdAt: AGORA,
  assignee: null,
  collection: null,
  ...extra,
});

/** Sem banco: o que é cotação parada, os filtros da lista, o resumo e o CSV. */
describe("regras das cotações (sem banco)", () => {
  it("parada é a cotação em aberto sem atividade há DIAS_PARA_COBRAR ou mais; fechada nunca está parada", () => {
    expect(DIAS_PARA_COBRAR).toBe(2);
    expect(diasParada({ status: "NEW", lastActivityAt: haDias(1) }, AGORA)).toBeNull();
    expect(diasParada({ status: "NEW", lastActivityAt: haDias(2) }, AGORA)).toBe(2);
    expect(diasParada({ status: "CONTACTED", lastActivityAt: haDias(5).toISOString() }, AGORA)).toBe(5);
    expect(diasParada({ status: "CONVERTED", lastActivityAt: haDias(30) }, AGORA)).toBeNull();
    expect(diasParada({ status: "LOST", lastActivityAt: haDias(30) }, AGORA)).toBeNull();
  });

  it("filtros: só o que é válido entra, e cada um vira a sua condição", () => {
    expect(filtrosDaLista(new URLSearchParams(""))).toEqual({});
    expect(filtrosDaLista(new URLSearchParams("status=QUALQUER&dias=abc&dias=-1&assigneeId=%20&busca=%20"))).toEqual({});
    expect(filtrosDaLista(new URLSearchParams("status=parada&dias=30&assigneeId=ninguem&busca=%20Mirassol%20"))).toEqual({
      status: "parada",
      dias: 30,
      assigneeId: "ninguem",
      busca: "Mirassol",
    });
    expect(filtrosDaLista(new URLSearchParams("status=LOST&dias=7&assigneeId=u1"))).toEqual({ status: "LOST", dias: 7, assigneeId: "u1" });

    expect(ondeDaLista({}, AGORA)).toEqual({});
    expect(ondeDaLista({ status: "LOST" }, AGORA)).toEqual({ status: "LOST" });
    expect(ondeDaLista({ status: "parada" }, AGORA)).toEqual({ status: { in: ["NEW", "CONTACTED"] }, lastActivityAt: { lt: haDias(2) } });
    expect(ondeDaLista({ dias: 7 }, AGORA)).toEqual({ createdAt: { gte: haDias(7) } });
    expect(ondeDaLista({ assigneeId: "ninguem" }, AGORA)).toEqual({ assigneeId: null });
    expect(ondeDaLista({ assigneeId: "u1" }, AGORA)).toEqual({ assigneeId: "u1" });

    const porTexto = ondeDaLista({ busca: "Mira" }, AGORA) as { OR: Record<string, unknown>[] };
    expect(porTexto.OR.map((c) => Object.keys(c)[0])).toEqual(["companyName", "email", "phone", "origin", "destination"]);
    expect(porTexto.OR[0]).toEqual({ companyName: { contains: "Mira", mode: "insensitive" } });
    // Só dígitos: também é o número da cotação.
    const porNumero = ondeDaLista({ busca: "12" }, AGORA) as { OR: Record<string, unknown>[] };
    expect(porNumero.OR.at(-1)).toEqual({ number: 12 });
    expect((ondeDaLista({ busca: "99999999999" }, AGORA) as { OR: unknown[] }).OR).toHaveLength(5);
  });

  it("resumo: conversão sobre as decididas, cotado e fechado pelo valor estimado, paradas pela atividade", () => {
    const leads = [
      daLista({ status: "NEW", estimatedValue: 100, lastActivityAt: haDias(3) }),
      daLista({ status: "CONTACTED", estimatedValue: null, lastActivityAt: haDias(1) }),
      daLista({ status: "CONVERTED", estimatedValue: 250.5 }),
      daLista({ status: "CONVERTED", estimatedValue: 49.5, lastActivityAt: haDias(40) }),
      daLista({ status: "LOST", estimatedValue: 80 }),
    ];
    expect(resumoDoFunil(leads, AGORA)).toEqual({
      total: 5,
      abertas: 2,
      ganhas: 2,
      perdidas: 1,
      conversao: 2 / 3,
      cotado: 480,
      fechado: 300,
      paradas: 1,
    });
    expect(resumoDoFunil([], AGORA)).toEqual({ total: 0, abertas: 0, ganhas: 0, perdidas: 0, conversao: null, cotado: 0, fechado: 0, paradas: 0 });
  });

  it("CSV: cabeçalho, uma linha por cotação com rótulos em português, vírgula decimal e aspas só quando preciso", () => {
    const linhas = linhasDoCsv(
      [
        daLista({ companyName: 'Loja "Centro"; filial', channel: "WHATSAPP", status: "LOST", lostReason: "PRECO", assignee: { id: "u1", name: "Ana" }, lastActivityAt: haDias(3) }),
        daLista({ id: "lead-2", number: null, estimatedValue: null, weight: 80, status: "CONVERTED", collection: { id: "c1", trackingCode: "9184726350", status: "CONFIRMED" } }),
      ],
      AGORA,
    );
    expect(linhas).toHaveLength(3);
    expect(linhas[0].slice(0, 3)).toEqual(["Nº", "Criada em", "Empresa"]);
    expect(linhas[1]).toMatchObject({ 0: "12", 2: 'Loja "Centro"; filial', 8: "120,5", 9: "2000", 10: "150", 11: "WhatsApp", 12: "Perdidos", 13: "Preço acima do concorrente", 14: "Ana", 16: "" });
    expect(linhas[2]).toMatchObject({ 0: "", 8: "80", 10: "", 12: "Convertidos", 13: "", 14: "", 17: "9184726350" });

    const csv = csvDeCotacoes(linhas);
    expect(csv.startsWith("\uFEFFNº;Criada em;Empresa;")).toBe(true);
    expect(csv.split("\r\n")).toHaveLength(3);
    expect(csv).toContain('"Loja ""Centro""; filial"');
    expect(csv).toContain(";120,5;2000;150;WhatsApp;Perdidos;Preço acima do concorrente;Ana;");
  });
});

// Tudo o que esta suite cria usa estes marcadores, e só isso é apagado.
const PREFIXO = "teste-crm-";
const CNPJ = "99777444000133";
const CNPJ_INATIVO = "99777444000214";
const HASH_FALSO = "$2b$10$hashfalsoparateste000000000000000000000000000000000";
const SEM_ID = "00000000-0000-4000-8000-000000000000";
const NAO_ENCONTRADA = { error: "Cotação não encontrada." };

suite("CRM e cotações", () => {
  let banco: typeof import("../src/lib/prisma");
  let crm: typeof import("../src/app/api/dashboard/crm/route");
  let crmLead: typeof import("../src/app/api/dashboard/crm/[id]/route");
  let converter: typeof import("../src/app/api/dashboard/crm/[id]/converter/route");
  let leads: typeof import("../src/app/api/leads/route");
  let cotacoes: typeof import("../src/app/api/cotacoes/route");
  let crmEquipe: typeof import("../src/app/api/dashboard/crm/equipe/route");

  const sessao = vi.mocked(getServerSession);
  const sorteio = vi.mocked(randomInt);
  const ids = { ADMIN: "", OPERATION: "", CLIENT: "", DRIVER: "", COMMERCIAL: "", FINANCE: "", daOutra: "" };
  const clientes = { ativo: "", inativo: "", daOutra: "" };

  const entrarComo = (perfil: Exclude<keyof typeof ids, "daOutra"> | null) =>
    sessao.mockResolvedValue(perfil ? { user: { id: ids[perfil], role: perfil, clientId: null } } : null);

  const req = (method = "GET", body?: unknown) =>
    new Request("http://localhost/api/teste", {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

  const dadosDoLead = (extra: Record<string, unknown> = {}) => ({
    companyName: "Indústria Interessada",
    email: `${PREFIXO}lead@exemplo.br`,
    phone: "17999990000",
    origin: "São José do Rio Preto",
    destination: "Mirassol",
    volumes: 3,
    weight: 120.5,
    estimatedValue: 150 as number | null,
    invoiceValue: 2000 as number | null,
    status: "NEW",
    ...extra,
  });

  const criarLead = (extra: Record<string, unknown> = {}) =>
    banco.default.quoteLead.create({ data: dadosDoLead(extra) });
  const leadDaOutra = () =>
    banco.paraEmpresa(EMPRESA_OUTRA.id).db.quoteLead.create({ data: dadosDoLead() });
  const noBanco = (id: string) => banco.sistema.quoteLead.findUniqueOrThrow({ where: { id } });
  const coletasDaSuite = () =>
    banco.sistema.collection.findMany({ where: { client: { cnpj: { in: [CNPJ, CNPJ_INATIVO] } } } });

  const conversao = (extra: Record<string, unknown> = {}) => ({
    clientId: clientes.ativo,
    sender: "Remetente Ltda",
    receiver: "Destinatário SA",
    ...extra,
  });
  const alterar = (id: string, body: unknown) => crmLead.PATCH(req("PATCH", body), ctx(id));
  const converterLead = (id: string, body: unknown = conversao()) => converter.POST(req("POST", body), ctx(id));

  async function limparCargas() {
    const { sistema } = banco;
    await sistema.quoteLead.deleteMany({ where: { email: { startsWith: PREFIXO } } });
    await sistema.collection.deleteMany({ where: { client: { cnpj: { in: [CNPJ, CNPJ_INATIVO] } } } });
  }

  async function limpar() {
    const { sistema } = banco;
    await limparCargas();
    await sistema.client.updateMany({ where: { cnpj: { in: [CNPJ, CNPJ_INATIVO] } }, data: { freightTableId: null } });
    await sistema.freightTable.deleteMany({ where: { name: { startsWith: PREFIXO } } });
    await sistema.client.deleteMany({ where: { cnpj: { in: [CNPJ, CNPJ_INATIVO] } } });
    await sistema.auditLog.deleteMany({ where: { entity: "cotacao", userName: { in: ["ADMIN", "OPERATION", "COMMERCIAL"] } } });
    await sistema.user.deleteMany({ where: { email: { startsWith: PREFIXO } } });
  }

  beforeAll(async () => {
    banco = await import("../src/lib/prisma");
    crm = await import("../src/app/api/dashboard/crm/route");
    crmLead = await import("../src/app/api/dashboard/crm/[id]/route");
    converter = await import("../src/app/api/dashboard/crm/[id]/converter/route");
    leads = await import("../src/app/api/leads/route");
    cotacoes = await import("../src/app/api/cotacoes/route");
    crmEquipe = await import("../src/app/api/dashboard/crm/equipe/route");
    await limpar();

    for (const perfil of ["ADMIN", "OPERATION", "CLIENT", "DRIVER", "COMMERCIAL", "FINANCE"] as const) {
      ids[perfil] = (
        await banco.default.user.create({
          data: { name: perfil, email: `${PREFIXO}${perfil.toLowerCase()}@exemplo.br`, password: HASH_FALSO, role: perfil },
        })
      ).id;
    }
    clientes.ativo = (await banco.default.client.create({ data: { cnpj: CNPJ, companyName: `${PREFIXO}cliente` } })).id;
    clientes.inativo = (
      await banco.default.client.create({ data: { cnpj: CNPJ_INATIVO, companyName: `${PREFIXO}inativo`, active: false } })
    ).id;
    ids.daOutra = (
      await banco.paraEmpresa(EMPRESA_OUTRA.id).db.user.create({
        data: { name: "Comercial da outra", email: `${PREFIXO}outra-comercial@exemplo.br`, password: HASH_FALSO, role: "COMMERCIAL" },
      })
    ).id;
    clientes.daOutra = (
      await banco.paraEmpresa(EMPRESA_OUTRA.id).db.client.create({ data: { cnpj: CNPJ, companyName: `${PREFIXO}da outra` } })
    ).id;
  });

  beforeEach(async () => {
    sessao.mockReset();
    await limparCargas();
    entrarComo("OPERATION");
  });

  afterAll(async () => {
    if (banco) await limpar();
  });

  describe("pedido de cotação", () => {
    const pedido = (extra: Record<string, unknown> = {}) => ({
      empresa: EMPRESA_PADRAO.slug,
      companyName: "Interessado",
      email: `${PREFIXO}site@exemplo.br`,
      origin: "São José do Rio Preto",
      destination: "Mirassol",
      volumes: 2,
      weight: "100",
      ...extra,
    });

    it("guarda o valor da nota informado, nas duas rotas, e nulo quando não vem", async () => {
      sessao.mockResolvedValue(null);

      const comNota = await leads.POST(req("POST", pedido({ invoiceValue: "1500,50" })));
      expect(comNota.status).toBe(200);
      const { lead } = (await comNota.json()) as { lead: { id: string } };
      expect((await noBanco(lead.id)).invoiceValue).toBe(1500.5);

      const cotacao = await cotacoes.POST(req("POST", pedido({ invoiceValue: 800 })));
      expect(cotacao.status).toBe(201);
      const { id } = (await cotacao.json()) as { id: string };
      expect((await noBanco(id)).invoiceValue).toBe(800);

      const semNota = await leads.POST(req("POST", pedido()));
      const semNotaId = ((await semNota.json()) as { lead: { id: string } }).lead.id;
      expect(await noBanco(semNotaId)).toMatchObject({ invoiceValue: null, collectionId: null, status: "NEW" });
    });

    it("a resposta pública tem o formato de antes: sem valor da nota e sem a coleta da conversão", async () => {
      sessao.mockResolvedValue(null);
      const CHAVES = [
        "companyName",
        "createdAt",
        "destination",
        "email",
        "estimatedValue",
        "id",
        "origin",
        "phone",
        "status",
        "tenantId",
        "updatedAt",
        "volumes",
        "weight",
      ];

      const doSite = await leads.POST(req("POST", pedido({ invoiceValue: "1500,50", phone: "17999990000" })));
      expect(doSite.status).toBe(200);
      const corpo = (await doSite.json()) as { lead: Record<string, unknown> };
      expect(Object.keys(corpo).sort()).toEqual(["estimatedValue", "lead", "message", "prazoHoras"]);
      expect(Object.keys(corpo.lead).sort()).toEqual(CHAVES);
      expect(corpo.lead).toMatchObject({ companyName: "Interessado", phone: "17999990000", volumes: 2, weight: 100, status: "NEW" });

      const cotacao = await cotacoes.POST(req("POST", pedido({ invoiceValue: 800 })));
      expect(cotacao.status).toBe(201);
      const lead = (await cotacao.json()) as Record<string, unknown>;
      expect(Object.keys(lead).sort()).toEqual(CHAVES);

      // O valor da nota foi gravado; só não volta na resposta.
      expect((await noBanco(String(lead.id))).invoiceValue).toBe(800);
    });
  });

  describe("permissões", () => {
    it("sem sessão 401; cliente e motorista 403; nada muda", async () => {
      const lead = await criarLead();

      entrarComo(null);
      expect((await crm.GET()).status).toBe(401);
      expect((await alterar(lead.id, { status: "LOST" })).status).toBe(401);
      expect((await converterLead(lead.id)).status).toBe(401);

      for (const perfil of ["CLIENT", "DRIVER"] as const) {
        entrarComo(perfil);
        expect((await crm.GET()).status, perfil).toBe(403);
        expect((await alterar(lead.id, { status: "LOST" })).status, perfil).toBe(403);
        expect((await converterLead(lead.id)).status, perfil).toBe(403);
      }

      expect(await noBanco(lead.id)).toMatchObject({ status: "NEW", collectionId: null });
      expect(await coletasDaSuite()).toHaveLength(0);
    });

    it("administrador e operação alteram e convertem", async () => {
      for (const perfil of ["ADMIN", "OPERATION"] as const) {
        entrarComo(perfil);
        const lead = await criarLead();
        expect((await alterar(lead.id, { status: "CONTACTED" })).status, perfil).toBe(200);
        expect((await converterLead(lead.id)).status, perfil).toBe(201);
      }
    });
  });

  describe("PATCH /api/dashboard/crm/[id]", () => {
    it.each([
      ["corpo que não é JSON", "{isto não é json", "Dados inválidos."],
      ["CONVERTED escolhido à mão", { status: "CONVERTED" }, "Status inválido."],
      ["status que não existe", { status: "QUALQUER" }, "Status inválido."],
      ["valor que não é número", { estimatedValue: "abc" }, "O valor precisa ser um número maior ou igual a zero."],
      ["valor negativo", { estimatedValue: -1 }, "O valor precisa ser um número maior ou igual a zero."],
      ["valor acima do teto", { estimatedValue: 1_000_000_001 }, "O valor precisa ser um número maior ou igual a zero."],
      ["valor inválido junto de status válido", { status: "LOST", estimatedValue: "1e3" }, "O valor precisa ser um número maior ou igual a zero."],
      ["corpo vazio", {}, "Informe ao menos um campo para alterar."],
      ["só chave desconhecida", { companyName: "Outro nome" }, "Informe ao menos um campo para alterar."],
    ])("%s → 400 e nada é gravado", async (_caso, body, mensagem) => {
      const lead = await criarLead();

      const res = await alterar(lead.id, body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: mensagem });
      expect(await noBanco(lead.id)).toMatchObject({ status: "NEW", estimatedValue: 150, companyName: "Indústria Interessada" });
    });

    it("lead inexistente e lead de outra empresa respondem o mesmo 404", async () => {
      const alheio = await leadDaOutra();

      for (const id of [SEM_ID, "id-que-nem-uuid-e", alheio.id]) {
        const res = await alterar(id, { status: "LOST", estimatedValue: 1 });
        expect(res.status, id).toBe(404);
        expect(await res.json(), id).toEqual(NAO_ENCONTRADA);
      }
      expect(await noBanco(alheio.id)).toMatchObject({ status: "NEW", estimatedValue: 150, tenantId: EMPRESA_OUTRA.id });
    });

    it("lead convertido não muda mais: 409, status e valor como estavam", async () => {
      const lead = await criarLead({ status: "CONVERTED" });

      for (const body of [{ status: "NEW" }, { estimatedValue: 999 }, { status: "LOST", estimatedValue: null }]) {
        const res = await alterar(lead.id, body);
        expect(res.status).toBe(409);
        expect(await res.json()).toEqual({ error: "Cotação já convertida em coleta: não pode mais ser alterada." });
      }
      expect(await noBanco(lead.id)).toMatchObject({ status: "CONVERTED", estimatedValue: 150 });
    });

    it("só status não mexe no valor, só valor não mexe no status, e vazio ou null apaga o valor", async () => {
      const lead = await criarLead();

      const soStatus = await alterar(lead.id, { status: "CONTACTED" });
      expect(soStatus.status).toBe(200);
      expect(await soStatus.json()).toMatchObject({ id: lead.id, status: "CONTACTED", estimatedValue: 150, collection: null });

      const soValor = await alterar(lead.id, { estimatedValue: "1234,5" });
      expect(soValor.status).toBe(200);
      expect(await soValor.json()).toMatchObject({ status: "CONTACTED", estimatedValue: 1234.5 });

      expect(await (await alterar(lead.id, { estimatedValue: 0 })).json()).toMatchObject({ estimatedValue: 0 });
      expect(await (await alterar(lead.id, { estimatedValue: "" })).json()).toMatchObject({ estimatedValue: null });

      await alterar(lead.id, { estimatedValue: 80 });
      expect(await (await alterar(lead.id, { estimatedValue: null })).json()).toMatchObject({ estimatedValue: null });

      // Perdido volta para Em contato; os dois campos juntos também valem.
      expect((await alterar(lead.id, { status: "LOST" })).status).toBe(200);
      const juntos = await alterar(lead.id, { status: "CONTACTED", estimatedValue: "99,90" });
      expect(await juntos.json()).toMatchObject({ status: "CONTACTED", estimatedValue: 99.9 });
      expect(await noBanco(lead.id)).toMatchObject({ status: "CONTACTED", estimatedValue: 99.9, invoiceValue: 2000 });
    });
  });

  describe("POST /api/dashboard/crm/[id]/converter", () => {
    it.each([
      ["corpo que não é JSON", "{isto não é json", "Dados inválidos."],
      ["sem cliente", { sender: "A", receiver: "B" }, "Informe o cliente."],
      ["cliente em branco", conversaoSem({ clientId: "  " }), "Informe o cliente."],
      ["sem remetente", conversaoSem({ sender: undefined }), "Informe o remetente."],
      ["remetente em branco", conversaoSem({ sender: " " }), "Informe o remetente."],
      ["sem destinatário", conversaoSem({ receiver: "" }), "Informe o destinatário."],
      ["destinatário longo demais", conversaoSem({ receiver: "x".repeat(201) }), "Destinatário muito longo."],
      ["chave da NF fora do tamanho", conversaoSem({ invoiceKey: "123" }), "A chave da NF precisa ter 44 dígitos."],
      ["valor da NF que não é número", conversaoSem({ invoiceValue: "abc" }), "O valor da NF precisa ser um número maior ou igual a zero."],
      ["valor da NF negativo", conversaoSem({ invoiceValue: -5 }), "O valor da NF precisa ser um número maior ou igual a zero."],
    ])("%s → 400, o lead não muda e nenhuma coleta nasce", async (_caso, body, mensagem) => {
      const lead = await criarLead();
      // O id do cliente só existe depois do beforeAll: entra aqui, não na tabela de casos.
      const comCliente =
        typeof body === "object" && "clientId" in body && body.clientId === "CLIENTE"
          ? { ...body, clientId: clientes.ativo }
          : body;

      const res = await converterLead(lead.id, comCliente);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: mensagem });
      expect(await noBanco(lead.id)).toMatchObject({ status: "NEW", collectionId: null });
      expect(await coletasDaSuite()).toHaveLength(0);
    });

    it("lead inexistente e lead de outra empresa respondem o mesmo 404", async () => {
      const alheio = await leadDaOutra();

      for (const id of [SEM_ID, alheio.id]) {
        const res = await converterLead(id);
        expect(res.status, id).toBe(404);
        expect(await res.json(), id).toEqual(NAO_ENCONTRADA);
      }
      expect(await noBanco(alheio.id)).toMatchObject({ status: "NEW", collectionId: null });
      expect(await coletasDaSuite()).toHaveLength(0);
    });

    it.each([
      ["CONVERTED", "Cotação já convertida em coleta."],
      ["LOST", "Cotação marcada como perdida: volte para Em contato antes de converter."],
    ])("lead %s → 409 sem criar coleta", async (status, mensagem) => {
      const lead = await criarLead({ status });

      const res = await converterLead(lead.id);
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: mensagem });
      expect(await noBanco(lead.id)).toMatchObject({ status, collectionId: null });
      expect(await coletasDaSuite()).toHaveLength(0);
    });

    it("perdido que volta para Em contato converte", async () => {
      const lead = await criarLead({ status: "LOST" });
      expect((await alterar(lead.id, { status: "CONTACTED" })).status).toBe(200);
      expect((await converterLead(lead.id)).status).toBe(201);
    });

    it("cliente inexistente, inativo ou de outra empresa → 400, e o lead volta ao status em que estava", async () => {
      const lead = await criarLead({ status: "CONTACTED" });

      for (const clientId of [SEM_ID, clientes.inativo, clientes.daOutra]) {
        const res = await converterLead(lead.id, conversao({ clientId }));
        expect(res.status, clientId).toBe(400);
        expect(await res.json(), clientId).toEqual({ error: "Cliente não encontrado ou inativo." });
      }

      // A conversão marca o lead antes de conferir o cliente: o rollback desfaz.
      expect(await noBanco(lead.id)).toMatchObject({ status: "CONTACTED", collectionId: null });
      expect(await banco.sistema.collection.count({ where: { clientId: { in: Object.values(clientes) } } })).toBe(0);
    });

    it("cria a coleta confirmada com a carga do lead, o histórico e a ligação, e responde só o necessário", async () => {
      entrarComo("OPERATION");
      const lead = await criarLead();

      const res = await converterLead(
        lead.id,
        conversao({
          invoiceKey: "3526 1012 3456 7800 0190 5500 1000 0000 0110 0000 0018",
          // O corpo não sobrescreve a carga do pedido, nem escolhe status ou código.
          origin: "Outra origem",
          destination: "Outro destino",
          volumes: 99,
          weight: 9999,
          status: "DELIVERED",
          trackingCode: "1111111111",
        }),
      );
      expect(res.status).toBe(201);
      const corpo = (await res.json()) as {
        lead: Record<string, unknown>;
        collection: Record<string, unknown> & { id: string; trackingCode: string };
      };

      expect(Object.keys(corpo).sort()).toEqual(["collection", "lead"]);
      expect(Object.keys(corpo.collection).sort()).toEqual(
        ["clientId", "destination", "freightValue", "id", "invoiceValue", "origin", "receiver", "sender", "status", "trackingCode", "volumes", "weight"],
      );
      expect(corpo.collection).toMatchObject({
        clientId: clientes.ativo,
        sender: "Remetente Ltda",
        receiver: "Destinatário SA",
        origin: "São José do Rio Preto",
        destination: "Mirassol",
        volumes: 3,
        weight: 120.5,
        invoiceValue: 2000,
        status: "CONFIRMED",
      });
      expect(corpo.collection.trackingCode).toMatch(/^\d{10}$/);
      expect(corpo.collection.trackingCode).not.toBe("1111111111");
      expect(corpo.lead).toMatchObject({
        id: lead.id,
        status: "CONVERTED",
        collectionId: corpo.collection.id,
        collection: { id: corpo.collection.id, trackingCode: corpo.collection.trackingCode, status: "CONFIRMED" },
      });
      expect(JSON.stringify(corpo)).not.toContain("password");
      expect(JSON.stringify(corpo)).not.toContain(CNPJ);

      const coleta = await banco.sistema.collection.findUniqueOrThrow({
        where: { id: corpo.collection.id },
        include: { statusHistory: true },
      });
      expect(coleta).toMatchObject({
        tenantId: EMPRESA_PADRAO.id,
        clientId: clientes.ativo,
        sender: "Remetente Ltda",
        receiver: "Destinatário SA",
        origin: "São José do Rio Preto",
        destination: "Mirassol",
        volumes: 3,
        weight: 120.5,
        invoiceKey: "35261012345678000190550010000000011000000018",
        invoiceValue: 2000,
        status: "CONFIRMED",
        trackingCode: corpo.collection.trackingCode,
      });
      expect(coleta.statusHistory).toHaveLength(1);
      expect(coleta.statusHistory[0]).toMatchObject({ fromStatus: null, toStatus: "CONFIRMED", userId: ids.OPERATION });
      expect(await noBanco(lead.id)).toMatchObject({ status: "CONVERTED", collectionId: coleta.id, estimatedValue: 150 });
    });

    it("valor da nota: o do corpo vale; ausente herda o do lead; apagado grava sem valor", async () => {
      const convertida = async (lead: { id: string }, extra: Record<string, unknown>) => {
        const res = await converterLead(lead.id, conversao(extra));
        expect(res.status).toBe(201);
        return ((await res.json()) as { collection: { invoiceValue: number | null } }).collection.invoiceValue;
      };

      expect(await convertida(await criarLead(), { invoiceValue: "3500,75" })).toBe(3500.75);
      expect(await convertida(await criarLead(), { invoiceValue: 0 })).toBe(0);
      // Ausente: a chave não veio, vale o valor informado no pedido de cotação.
      expect(await convertida(await criarLead(), {})).toBe(2000);
      expect(await convertida(await criarLead({ invoiceValue: null }), {})).toBeNull();
      // Apagado: o operador limpou o campo (a tela manda "") ou mandou `null`.
      // A coleta nasce sem valor de nota, e o lead guarda o que o cliente informou.
      const apagado = await criarLead();
      expect(await convertida(apagado, { invoiceValue: "" })).toBeNull();
      expect(await convertida(await criarLead(), { invoiceValue: "   " })).toBeNull();
      expect(await convertida(await criarLead(), { invoiceValue: null })).toBeNull();
      expect((await noBanco(apagado.id)).invoiceValue).toBe(2000);
      const coleta = await banco.sistema.collection.findFirstOrThrow({ where: { quoteLead: { id: apagado.id } } });
      expect(coleta.invoiceValue).toBeNull();
    });

    it("o frete da coleta é o da tabela mesmo com outro valor estimado no lead, e a resposta leva o frete", async () => {
      const tabela = await banco.default.freightTable.create({
        data: {
          name: `${PREFIXO}tabela do valor estimado`,
          includedWeightKg: 200,
          cities: { create: [{ city: "Mirassol", cityKey: "mirassol", minimum: 50, deadlineHours: 24 }] },
        },
      });
      await banco.default.client.update({ where: { id: clientes.ativo }, data: { freightTableId: tabela.id } });
      try {
        // O comercial fechou 150 no funil; a tabela do cliente dá 50.
        const lead = await criarLead({ estimatedValue: 150 });
        const res = await converterLead(lead.id);
        expect(res.status).toBe(201);
        const corpo = (await res.json()) as {
          lead: { estimatedValue: number | null };
          collection: { id: string; freightValue: number | null };
        };

        // Os dois valores saem na resposta: é com eles que a tela avisa a diferença.
        expect(corpo.lead.estimatedValue).toBe(150);
        expect(corpo.collection.freightValue).toBe(50);
        // O valor do lead não vira frete: a coleta segue na tabela, sem frete manual.
        expect(await banco.sistema.collection.findUniqueOrThrow({ where: { id: corpo.collection.id } })).toMatchObject({
          freightValue: 50,
          freightManual: false,
          freightTableId: tabela.id,
        });
        expect((await noBanco(lead.id)).estimatedValue).toBe(150);
      } finally {
        await banco.default.client.update({ where: { id: clientes.ativo }, data: { freightTableId: null } });
        await banco.default.freightTable.delete({ where: { id: tabela.id } });
      }

      // Sem tabela para o destino a coleta nasce a cotar, e a resposta diz isso com `null`.
      const semTabela = await converterLead((await criarLead()).id);
      expect(((await semTabela.json()) as { collection: { freightValue: number | null } }).collection.freightValue).toBeNull();
    });

    it("a coleta convertida nasce com o frete da tabela do cliente, como toda coleta", async () => {
      const tabela = await banco.default.freightTable.create({
        data: {
          name: `${PREFIXO}tabela`,
          includedWeightKg: 200,
          cities: { create: [{ city: "Mirassol", cityKey: "mirassol", minimum: 50, deadlineHours: 24 }] },
        },
      });
      await banco.default.client.update({ where: { id: clientes.ativo }, data: { freightTableId: tabela.id } });
      try {
        const res = await converterLead((await criarLead()).id);
        expect(res.status).toBe(201);
        const { collection } = (await res.json()) as { collection: { id: string } };
        expect(await banco.sistema.collection.findUniqueOrThrow({ where: { id: collection.id } })).toMatchObject({
          freightValue: 50,
          freightDeadlineHours: 24,
          freightTableId: tabela.id,
          freightManual: false,
        });
      } finally {
        await banco.default.client.update({ where: { id: clientes.ativo }, data: { freightTableId: null } });
      }
    });

    it("duas conversões do mesmo lead ao mesmo tempo: uma passa, a outra leva 409, e existe uma coleta", async () => {
      const lead = await criarLead();

      const respostas = await Promise.all([converterLead(lead.id), converterLead(lead.id), converterLead(lead.id)]);
      expect(respostas.map((r) => r.status).sort()).toEqual([201, 409, 409]);
      for (const res of respostas.filter((r) => r.status === 409)) {
        expect(await res.json()).toEqual({ error: "Cotação já convertida em coleta." });
      }

      const coletas = await coletasDaSuite();
      expect(coletas).toHaveLength(1);
      expect(await noBanco(lead.id)).toMatchObject({ status: "CONVERTED", collectionId: coletas[0].id });
      expect(await banco.sistema.collectionStatusHistory.count({ where: { collectionId: coletas[0].id } })).toBe(1);
    });

    it("código de rastreio repetido: a transação inteira é refeita com outro código", async () => {
      const ocupado = await banco.default.collection.create({
        data: {
          clientId: clientes.ativo,
          sender: "A",
          receiver: "B",
          origin: "C",
          destination: "D",
          volumes: 1,
          weight: 1,
          trackingCode: "0000000123",
        },
      });
      const lead = await criarLead();

      sorteio.mockReturnValueOnce(123 as never);
      const res = await converterLead(lead.id);
      expect(res.status).toBe(201);
      const { collection } = (await res.json()) as { collection: { id: string; trackingCode: string } };
      expect(collection.trackingCode).toMatch(/^\d{10}$/);
      expect(collection.trackingCode).not.toBe("0000000123");

      // A tentativa que colidiu foi desfeita: sobram a coleta que já existia e a convertida.
      expect((await coletasDaSuite()).map((c) => c.id).sort()).toEqual([ocupado.id, collection.id].sort());
      expect(await noBanco(lead.id)).toMatchObject({ status: "CONVERTED", collectionId: collection.id });
    });
  });

  describe("GET /api/dashboard/crm", () => {
    it("traz valor da nota e a coleta resumida, do mais novo para o mais antigo, só da empresa", async () => {
      const antigo = await criarLead({ createdAt: new Date("2026-01-01T10:00:00Z"), invoiceValue: null });
      const novo = await criarLead({ createdAt: new Date("2026-02-01T10:00:00Z") });
      const alheio = await leadDaOutra();
      const convertido = (await (await converterLead(novo.id)).json()) as {
        collection: { id: string; trackingCode: string };
      };

      const res = await crm.GET();
      expect(res.status).toBe(200);
      const lista = ((await res.json()) as { id: string; email: string }[]).filter((l) => l.email.startsWith(PREFIXO));

      expect(lista.map((l) => l.id)).toEqual([novo.id, antigo.id]);
      expect(lista.map((l) => l.id)).not.toContain(alheio.id);
      expect(lista[0]).toMatchObject({ status: "CONVERTED", invoiceValue: 2000 });
      expect((lista[0] as unknown as { collection: unknown }).collection).toEqual({
        id: convertido.collection.id,
        trackingCode: convertido.collection.trackingCode,
        status: "CONFIRMED",
      });
      expect(lista[1]).toMatchObject({ status: "NEW", invoiceValue: null, collection: null });
    });
  });

  describe("número, canal e a lista com filtros", () => {
    const registrar = (body: unknown) => crm.POST(req("POST", body));
    const listar = (query = "") => crm.GET(new Request(`http://localhost/api/dashboard/crm${query}`));
    const idsDaSuite = async (query = "") => {
      const res = await listar(query);
      expect(res.status).toBe(200);
      return ((await res.json()) as { id: string; email: string }[]).filter((l) => l.email.startsWith(PREFIXO)).map((l) => l.id);
    };
    const pedidoDoPainel = (extra: Record<string, unknown> = {}) => ({
      companyName: "Autopeças Rota 376",
      phone: "44999990000",
      email: `${PREFIXO}painel@exemplo.br`,
      channel: "WHATSAPP",
      origin: "Maringá",
      destination: "Mirassol",
      volumes: "4",
      weight: "88",
      invoiceValue: "6.250,00".replace(".", ""),
      ...extra,
    });

    it("site e painel entram na mesma numeração, sequencial por empresa, e cada empresa conta a sua", async () => {
      // A numeração desta empresa pode já ter cotações de outras suites: o que vale é a sequência.
      sessao.mockResolvedValue(null);
      const doSite = (await (await leads.POST(req("POST", { empresa: EMPRESA_PADRAO.slug, companyName: "Interessado", email: `${PREFIXO}site@exemplo.br`, origin: "A", destination: "B", weight: "10" }))).json()) as { lead: { id: string } };
      entrarComo("COMMERCIAL");
      const doPainel = await registrar(pedidoDoPainel());
      expect(doPainel.status).toBe(201);
      const painel = (await doPainel.json()) as { id: string; number: number; channel: string; status: string; assignee: { id: string; name: string } | null };

      const primeiro = await noBanco(doSite.lead.id);
      expect(primeiro.number).toEqual(expect.any(Number));
      expect(primeiro.channel).toBe("SITE");
      expect(painel.number).toBe(primeiro.number! + 1);
      expect(painel).toMatchObject({ channel: "WHATSAPP", status: "NEW", assignee: { id: ids.COMMERCIAL, name: "COMMERCIAL" } });
      expect(await noBanco(painel.id)).toMatchObject({ tenantId: EMPRESA_PADRAO.id, volumes: 4, weight: 88, invoiceValue: 6250, estimatedValue: null, assigneeId: ids.COMMERCIAL });

      // A outra empresa começa a contar do zero dela, não do número desta.
      sessao.mockResolvedValue(null);
      const alheio = (await (await cotacoes.POST(req("POST", { empresa: EMPRESA_OUTRA.slug, companyName: "Outro", email: `${PREFIXO}outra@exemplo.br`, origin: "A", destination: "B", volumes: 1, weight: 5 }))).json()) as { id: string };
      const daOutra = await noBanco(alheio.id);
      expect(daOutra.tenantId).toBe(EMPRESA_OUTRA.id);
      const maiorDaOutra = await banco.sistema.quoteLead.aggregate({ where: { tenantId: EMPRESA_OUTRA.id }, _max: { number: true } });
      expect(daOutra.number).toBe(maiorDaOutra._max.number);
      expect(daOutra.number).toBeLessThanOrEqual(painel.number);
    });

    it("duas cotações registradas ao mesmo tempo não repetem número", async () => {
      entrarComo("ADMIN");
      const respostas = await Promise.all([registrar(pedidoDoPainel({ companyName: "A" })), registrar(pedidoDoPainel({ companyName: "B" })), registrar(pedidoDoPainel({ companyName: "C" }))]);
      expect(respostas.map((r) => r.status)).toEqual([201, 201, 201]);
      const numeros = (await Promise.all(respostas.map((r) => r.json()))).map((l) => (l as { number: number }).number).sort((a, b) => a - b);
      expect(new Set(numeros).size).toBe(3);
      expect(numeros[2] - numeros[0]).toBe(2);
    });

    it.each([
      ["corpo que não é JSON", "{isto não é json", "Dados inválidos."],
      ["sem empresa", { phone: "44999990000", channel: "WHATSAPP", origin: "A", destination: "B", weight: 1 }, "Informe a empresa ou o nome do cliente."],
      ["sem telefone nem e-mail", { companyName: "X", channel: "WHATSAPP", origin: "A", destination: "B", weight: 1 }, "Informe o telefone ou o e-mail do cliente."],
      ["e-mail inválido", { companyName: "X", email: "nao-e-email", channel: "WHATSAPP", origin: "A", destination: "B", weight: 1 }, "E-mail inválido."],
      ["canal do site pela equipe", { companyName: "X", phone: "1", channel: "SITE", origin: "A", destination: "B", weight: 1 }, "Informe por onde o pedido chegou."],
      ["sem destino", { companyName: "X", phone: "1", channel: "EMAIL", origin: "A", weight: 1 }, "Informe a cidade de destino."],
      ["peso zero", { companyName: "X", phone: "1", channel: "EMAIL", origin: "A", destination: "B", weight: "0" }, "O peso precisa ser maior que zero."],
      ["volumes quebrados", { companyName: "X", phone: "1", channel: "EMAIL", origin: "A", destination: "B", weight: 1, volumes: "1,5" }, "A quantidade de volumes precisa ser um número inteiro."],
      ["nota negativa", { companyName: "X", phone: "1", channel: "EMAIL", origin: "A", destination: "B", weight: 1, invoiceValue: -1 }, "O valor da nota precisa ser um número maior ou igual a zero."],
    ])("registrar: %s → 400 e nada é gravado", async (_caso, body, mensagem) => {
      entrarComo("OPERATION");
      const antes = await banco.sistema.quoteLead.count();
      const res = await registrar(body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: mensagem });
      expect(await banco.sistema.quoteLead.count()).toBe(antes);
    });

    it("registrar: responsável que não é da equipe comercial, de outra empresa ou inexistente → 400; `null` grava sem responsável", async () => {
      entrarComo("OPERATION");
      for (const assigneeId of [ids.FINANCE, ids.CLIENT, ids.daOutra, SEM_ID]) {
        const res = await registrar(pedidoDoPainel({ assigneeId }));
        expect(res.status, assigneeId).toBe(400);
        expect(await res.json(), assigneeId).toEqual({ error: "O responsável precisa ser um usuário da equipe comercial." });
      }
      const semNinguem = await registrar(pedidoDoPainel({ assigneeId: null }));
      expect(semNinguem.status).toBe(201);
      expect(await semNinguem.json()).toMatchObject({ assignee: null });
      const outro = await registrar(pedidoDoPainel({ assigneeId: ids.COMMERCIAL }));
      expect(await outro.json()).toMatchObject({ assignee: { id: ids.COMMERCIAL } });
    });

    it("registrar fica na auditoria, com o número e o canal", async () => {
      entrarComo("OPERATION");
      const criada = (await (await registrar(pedidoDoPainel())).json()) as { id: string; number: number };
      const linhas = await banco.sistema.auditLog.findMany({ where: { action: "cotacao.registrar", entityId: criada.id } });
      expect(linhas).toHaveLength(1);
      expect(linhas[0]).toMatchObject({ tenantId: EMPRESA_PADRAO.id, userId: ids.OPERATION, entity: "cotacao", summary: `Cotação nº ${criada.number} registrada para Autopeças Rota 376` });
      expect(linhas[0].after).toMatchObject({ number: criada.number, channel: "WHATSAPP", assigneeId: ids.OPERATION });
    });

    it("a lista filtra por etapa, parada, período, responsável e busca; sem filtro vem tudo, do mais novo para o mais antigo", async () => {
      const haDias = (dias: number) => new Date(Date.now() - dias * 24 * 60 * 60 * 1000);
      const parada = await criarLead({ companyName: "Metalúrgica Parada", status: "CONTACTED", lastActivityAt: haDias(3), createdAt: haDias(40), assigneeId: ids.COMMERCIAL });
      const recente = await criarLead({ companyName: "Papelaria Recente", status: "NEW", phone: "4433221100" });
      const perdida = await criarLead({ companyName: "Vidraçaria Perdida", status: "LOST", lostReason: "PRECO", lastActivityAt: haDias(10), createdAt: haDias(10) });
      const convertidaAntiga = await criarLead({ companyName: "Antiga Convertida", status: "CONVERTED", lastActivityAt: haDias(90), createdAt: haDias(90) });
      await leadDaOutra();

      expect(await idsDaSuite()).toEqual([recente.id, perdida.id, parada.id, convertidaAntiga.id]);
      expect(await idsDaSuite("?status=parada")).toEqual([parada.id]);
      expect(await idsDaSuite("?status=LOST")).toEqual([perdida.id]);
      expect(await idsDaSuite("?dias=30")).toEqual([recente.id, perdida.id]);
      expect(await idsDaSuite(`?assigneeId=${ids.COMMERCIAL}`)).toEqual([parada.id]);
      expect(await idsDaSuite("?assigneeId=ninguem")).toEqual([recente.id, perdida.id, convertidaAntiga.id]);
      expect(await idsDaSuite("?busca=papelaria")).toEqual([recente.id]);
      expect(await idsDaSuite("?busca=4433221100")).toEqual([recente.id]);
      expect(await idsDaSuite("?busca=Mirassol&status=NEW")).toEqual([recente.id]);
      // Filtro inválido é ignorado, não é erro.
      expect(await idsDaSuite("?status=QUALQUER&dias=x")).toHaveLength(4);

      const [primeira] = (await (await listar("?status=parada")).json()) as Record<string, unknown>[];
      expect(primeira).toMatchObject({ number: null, channel: "SITE", lostReason: null, assignee: { id: ids.COMMERCIAL, name: "COMMERCIAL" }, collection: null });
      expect(primeira).not.toHaveProperty("password");
    });

    it("busca pelo número acha a cotação registrada", async () => {
      entrarComo("OPERATION");
      const criada = (await (await registrar(pedidoDoPainel({ companyName: "Busca Por Número" }))).json()) as { id: string; number: number };
      const achados = (await (await listar(`?busca=${criada.number}`)).json()) as { id: string }[];
      expect(achados.map((l) => l.id)).toContain(criada.id);
    });

    it("a equipe comercial são os usuários desta empresa com a capacidade crm, por nome", async () => {
      const res = await crmEquipe.GET();
      expect(res.status).toBe(200);
      const equipe = (await res.json()) as { id: string; name: string }[];
      const daSuite = equipe.filter((u) => Object.values(ids).includes(u.id));
      expect(daSuite.map((u) => u.name).sort()).toEqual(["ADMIN", "COMMERCIAL", "OPERATION"]);
      expect(equipe.map((u) => u.id)).not.toContain(ids.daOutra);
      expect(Object.keys(equipe[0]).sort()).toEqual(["id", "name"]);
    });
  });

  describe("PATCH: responsável, motivo da perda e contato", () => {
    it("responsável: aceita quem é da equipe comercial desta empresa; vazio ou null tira; os outros → 400", async () => {
      const lead = await criarLead();
      const com = await alterar(lead.id, { assigneeId: ids.COMMERCIAL });
      expect(com.status).toBe(200);
      expect(await com.json()).toMatchObject({ assignee: { id: ids.COMMERCIAL, name: "COMMERCIAL" } });

      for (const assigneeId of [ids.FINANCE, ids.CLIENT, ids.DRIVER, ids.daOutra, SEM_ID]) {
        const res = await alterar(lead.id, { assigneeId });
        expect(res.status, assigneeId).toBe(400);
        expect(await res.json(), assigneeId).toEqual({ error: "O responsável precisa ser um usuário da equipe comercial." });
      }
      expect((await noBanco(lead.id)).assigneeId).toBe(ids.COMMERCIAL);

      expect(await (await alterar(lead.id, { assigneeId: "" })).json()).toMatchObject({ assignee: null });
      await alterar(lead.id, { assigneeId: ids.ADMIN });
      expect(await (await alterar(lead.id, { assigneeId: null })).json()).toMatchObject({ assignee: null });
    });

    it("motivo da perda: só fica com status Perdida, e sair de Perdidos apaga", async () => {
      const lead = await criarLead();
      expect((await alterar(lead.id, { lostReason: "QUALQUER" })).status).toBe(400);

      // Em cotação aberta o motivo não gruda.
      expect(await (await alterar(lead.id, { lostReason: "PRECO" })).json()).toMatchObject({ status: "NEW", lostReason: null });

      const perdida = await alterar(lead.id, { status: "LOST", lostReason: "PRAZO" });
      expect(await perdida.json()).toMatchObject({ status: "LOST", lostReason: "PRAZO" });
      // Só o motivo, já perdida.
      expect(await (await alterar(lead.id, { lostReason: "SEM_RETORNO" })).json()).toMatchObject({ status: "LOST", lostReason: "SEM_RETORNO" });
      expect(await (await alterar(lead.id, { lostReason: null })).json()).toMatchObject({ status: "LOST", lostReason: null });
      await alterar(lead.id, { lostReason: "OUTRO" });

      expect(await (await alterar(lead.id, { status: "CONTACTED" })).json()).toMatchObject({ status: "CONTACTED", lostReason: null });
      expect((await noBanco(lead.id)).lostReason).toBeNull();
    });

    it("contato e troca de status renovam a última atividade; valor e responsável, não", async () => {
      const haDias = (dias: number) => new Date(Date.now() - dias * 24 * 60 * 60 * 1000);
      const lead = await criarLead({ lastActivityAt: haDias(5) });
      const atividade = async () => (await noBanco(lead.id)).lastActivityAt.getTime();
      const antiga = await atividade();

      expect((await alterar(lead.id, { estimatedValue: 99 })).status).toBe(200);
      expect((await alterar(lead.id, { assigneeId: ids.ADMIN })).status).toBe(200);
      expect(await atividade()).toBe(antiga);

      const contato = await alterar(lead.id, { contato: true });
      expect(contato.status).toBe(200);
      const depoisDoContato = await atividade();
      expect(depoisDoContato).toBeGreaterThan(Date.now() - 5000);
      expect(await contato.json()).toMatchObject({ status: "NEW", estimatedValue: 99, assignee: { id: ids.ADMIN } });

      const linhas = await banco.sistema.auditLog.findMany({ where: { entityId: lead.id }, orderBy: { createdAt: "asc" } });
      expect(linhas.map((l) => l.action)).toEqual(["cotacao.alterar", "cotacao.alterar", "cotacao.contato"]);
      expect(linhas[2]).toMatchObject({ userId: ids.OPERATION, summary: "Contato com Indústria Interessada registrado" });

      await banco.sistema.quoteLead.update({ where: { id: lead.id }, data: { lastActivityAt: haDias(5) } });
      // Mesmo status de novo não é troca: a atividade fica.
      expect((await alterar(lead.id, { status: "NEW" })).status).toBe(200);
      expect(await atividade()).toBe(haDias(5).getTime() - (haDias(5).getTime() % 1000) + ((await atividade()) % 1000));
      expect((await alterar(lead.id, { status: "CONTACTED" })).status).toBe(200);
      expect(await atividade()).toBeGreaterThan(Date.now() - 5000);

      // `contato` só aceita `true`.
      expect((await alterar(lead.id, { contato: false })).status).toBe(400);
      expect((await alterar(lead.id, { contato: "sim" })).status).toBe(400);
    });

    it("contato em cotação convertida → 409, e nada muda", async () => {
      const lead = await criarLead({ status: "CONVERTED" });
      for (const body of [{ contato: true }, { assigneeId: ids.ADMIN }, { lostReason: "PRECO" }]) {
        const res = await alterar(lead.id, body);
        expect(res.status).toBe(409);
      }
      expect(await noBanco(lead.id)).toMatchObject({ status: "CONVERTED", assigneeId: null, lostReason: null });
    });
  });
});

/** Corpo de conversão completo menos o que o caso troca; o cliente entra no teste. */
function conversaoSem(extra: Record<string, unknown>) {
  return { clientId: "CLIENTE", sender: "Remetente Ltda", receiver: "Destinatário SA", ...extra };
}
