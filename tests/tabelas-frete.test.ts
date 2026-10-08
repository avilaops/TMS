import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getServerSession } from "next-auth";
import { EMPRESA_OUTRA, EMPRESA_PADRAO } from "./empresas-de-teste";

/**
 * Tabelas de frete pelo painel, simulador e cotação pública, contra um
 * Postgres de verdade.
 */
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

const temBanco = Boolean(process.env.DATABASE_URL);

if (!temBanco) {
  console.warn("\n[tabelas-frete.test] DATABASE_URL ausente: testes de integração PULADOS.\n");
}

const suite = temBanco ? describe : describe.skip;

// Tudo o que esta suite cria usa estes marcadores, e só isso é apagado.
const PREFIXO = "teste-frete-";
const CNPJ = "99666555000144";
const HASH_FALSO = "$2b$10$hashfalsoparateste000000000000000000000000000000000";

suite("tabelas de frete", () => {
  let banco: typeof import("../src/lib/prisma");
  let tabelas: typeof import("../src/app/api/tabelas-frete/route");
  let tabelaPorId: typeof import("../src/app/api/tabelas-frete/[id]/route");
  let cidades: typeof import("../src/app/api/tabelas-frete/[id]/cidades/route");
  let calcular: typeof import("../src/app/api/tabelas-frete/calcular/route");
  let clientes: typeof import("../src/app/api/clientes/route");
  let clientePorId: typeof import("../src/app/api/clientes/[id]/route");
  let leads: typeof import("../src/app/api/leads/route");
  let cotacoes: typeof import("../src/app/api/cotacoes/route");

  const sessao = vi.mocked(getServerSession);
  const ids = { ADMIN: "", OPERATION: "", CLIENT: "" };

  const entrarComo = (perfil: keyof typeof ids | null) =>
    sessao.mockResolvedValue(perfil ? { user: { id: ids[perfil], role: perfil, clientId: null } } : null);

  const req = (method = "GET", body?: unknown) =>
    new Request("http://localhost/api/teste", {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

  const nome = (n: string) => `${PREFIXO}${n}`;
  const regras = (extra: Record<string, unknown> = {}) => ({
    name: nome("geral"),
    includedWeightKg: "30",
    excessPerKg: "0,50",
    ...extra,
  });

  async function limpar() {
    const { sistema } = banco;
    await sistema.quoteLead.deleteMany({ where: { email: { startsWith: PREFIXO } } });
    await sistema.client.deleteMany({ where: { cnpj: CNPJ } });
    await sistema.freightTable.deleteMany({ where: { name: { startsWith: PREFIXO } } });
    await sistema.user.deleteMany({ where: { email: { startsWith: PREFIXO } } });
  }

  async function criarTabela(extra: Record<string, unknown> = {}, linhas?: unknown[]) {
    entrarComo("ADMIN");
    const res = await tabelas.POST(req("POST", regras(extra)));
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(201);
    const tabela = (await res.json()) as { id: string; isDefault: boolean };
    if (linhas) {
      const posto = await cidades.PUT(req("PUT", { cities: linhas }), ctx(tabela.id));
      expect(posto.status).toBe(200);
    }
    return tabela;
  }

  const CIDADES = [
    { city: "Mirassol", minimum: "50", deadlineHours: "24" },
    { city: "São José do Rio Preto", minimum: "60,00", deadlineHours: 48 },
  ];

  beforeAll(async () => {
    banco = await import("../src/lib/prisma");
    tabelas = await import("../src/app/api/tabelas-frete/route");
    tabelaPorId = await import("../src/app/api/tabelas-frete/[id]/route");
    cidades = await import("../src/app/api/tabelas-frete/[id]/cidades/route");
    calcular = await import("../src/app/api/tabelas-frete/calcular/route");
    clientes = await import("../src/app/api/clientes/route");
    clientePorId = await import("../src/app/api/clientes/[id]/route");
    leads = await import("../src/app/api/leads/route");
    cotacoes = await import("../src/app/api/cotacoes/route");
    await limpar();

    for (const perfil of ["ADMIN", "OPERATION", "CLIENT"] as const) {
      ids[perfil] = (
        await banco.default.user.create({
          data: { name: perfil, email: `${PREFIXO}${perfil.toLowerCase()}@exemplo.br`, password: HASH_FALSO, role: perfil },
        })
      ).id;
    }
  });

  beforeEach(async () => {
    sessao.mockReset();
    const { sistema } = banco;
    await sistema.quoteLead.deleteMany({ where: { email: { startsWith: PREFIXO } } });
    await sistema.client.deleteMany({ where: { cnpj: CNPJ } });
    await sistema.freightTable.deleteMany({ where: { name: { startsWith: PREFIXO } } });
    // A suíte parte de uma empresa sem tabela padrão, seja qual for a ordem dos arquivos.
    await sistema.freightTable.updateMany({ where: { tenantId: EMPRESA_PADRAO.id, isDefault: true }, data: { isDefault: false } });
  });

  afterAll(async () => {
    if (banco) await limpar();
  });

  describe("permissões", () => {
    it("sem sessão 401; cliente e motorista não entram", async () => {
      entrarComo(null);
      expect((await tabelas.GET()).status).toBe(401);
      expect((await tabelas.POST(req("POST", regras()))).status).toBe(401);

      entrarComo("CLIENT");
      expect((await tabelas.GET()).status).toBe(403);
      expect((await calcular.POST(req("POST", { city: "Mirassol", weight: 1 }))).status).toBe(403);
    });

    it("OPERATION lê e simula, mas não cria, não altera e não troca cidades", async () => {
      const tabela = await criarTabela({ isDefault: true }, CIDADES);

      entrarComo("OPERATION");
      expect((await tabelas.GET()).status).toBe(200);
      expect((await tabelaPorId.GET(req(), ctx(tabela.id))).status).toBe(200);
      expect((await calcular.POST(req("POST", { city: "Mirassol", weight: 10 }))).status).toBe(200);

      expect((await tabelas.POST(req("POST", regras({ name: nome("outra") })))).status).toBe(403);
      expect((await tabelaPorId.PATCH(req("PATCH", { excessPerKg: 9 }), ctx(tabela.id))).status).toBe(403);
      expect((await cidades.PUT(req("PUT", { cities: [] }), ctx(tabela.id))).status).toBe(403);

      const intacta = await banco.default.freightTable.findUniqueOrThrow({ where: { id: tabela.id }, include: { cities: true } });
      expect(intacta.excessPerKg).toBe(0.5);
      expect(intacta.cities).toHaveLength(2);
    });
  });

  describe("cadastro", () => {
    it("cria com número em texto e vírgula, e devolve a contagem de cidades", async () => {
      const tabela = await criarTabela({ cubageFactor: "300", invoiceLimit: "1.500,00".replace(".", ""), maxVolumes: "3" }, CIDADES);
      entrarComo("ADMIN");
      const lida = (await (await tabelaPorId.GET(req(), ctx(tabela.id))).json()) as Record<string, unknown> & {
        cities: { city: string; minimum: number; deadlineHours: number }[];
      };
      expect(lida).toMatchObject({ includedWeightKg: 30, excessPerKg: 0.5, cubageFactor: 300, invoiceLimit: 1500, maxVolumes: 3 });
      expect(lida._count).toEqual({ cities: 2, clients: 0 });
      expect(lida.cities.map((c) => [c.city, c.minimum, c.deadlineHours])).toEqual([
        ["Mirassol", 50, 24],
        ["São José do Rio Preto", 60, 48],
      ]);
    });

    it("nome repetido 409; dados inválidos 400", async () => {
      await criarTabela();
      entrarComo("ADMIN");
      expect((await tabelas.POST(req("POST", regras()))).status).toBe(409);

      for (const [caso, corpo] of [
        ["sem nome", regras({ name: "" })],
        ["kg negativo", regras({ name: nome("x"), excessPerKg: -1 })],
        ["percentual acima de 100", regras({ name: nome("x"), adValoremPct: 101 })],
        ["volumes fracionados", regras({ name: nome("x"), maxVolumes: 2.5 })],
        ["validade invertida", regras({ name: nome("x"), validFrom: "2026-12-01", validTo: "2026-01-01" })],
      ] as const) {
        expect((await tabelas.POST(req("POST", corpo))).status, caso).toBe(400);
      }
      expect(await banco.default.freightTable.count({ where: { name: nome("x") } })).toBe(0);
    });

    it("só uma tabela padrão por empresa: a nova toma o lugar da anterior", async () => {
      const primeira = await criarTabela({ isDefault: true });
      const segunda = await criarTabela({ name: nome("segunda"), isDefault: true });

      const padroes = await banco.default.freightTable.findMany({ where: { isDefault: true }, select: { id: true } });
      expect(padroes.map((t) => t.id)).toEqual([segunda.id]);

      // Pelo PATCH também.
      entrarComo("ADMIN");
      expect((await tabelaPorId.PATCH(req("PATCH", { isDefault: true }), ctx(primeira.id))).status).toBe(200);
      const depois = await banco.default.freightTable.findMany({ where: { isDefault: true }, select: { id: true } });
      expect(depois.map((t) => t.id)).toEqual([primeira.id]);
    });

    it("PATCH confere a validade contra a ponta que já estava gravada", async () => {
      const tabela = await criarTabela({ validFrom: "2026-05-01" });
      entrarComo("ADMIN");
      expect((await tabelaPorId.PATCH(req("PATCH", { validTo: "2026-04-30" }), ctx(tabela.id))).status).toBe(400);
      expect((await tabelaPorId.PATCH(req("PATCH", { validTo: "2027-04-30" }), ctx(tabela.id))).status).toBe(200);
      expect((await tabelaPorId.PATCH(req("PATCH", {}), ctx(tabela.id))).status).toBe(400);
      expect((await tabelaPorId.PATCH(req("PATCH", { notes: "x" }), ctx("00000000-0000-4000-8000-000000000000"))).status).toBe(404);
    });
  });

  describe("cidades", () => {
    it("a lista enviada substitui a anterior por inteiro", async () => {
      const tabela = await criarTabela({}, CIDADES);
      entrarComo("ADMIN");
      const res = await cidades.PUT(req("PUT", { cities: [{ city: "Catanduva", minimum: 70, deadlineHours: 24, dedicated: true }] }), ctx(tabela.id));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([expect.objectContaining({ city: "Catanduva", minimum: 70, dedicated: true })]);
      expect(await banco.default.freightTableCity.count({ where: { tableId: tabela.id } })).toBe(1);
    });

    it("lista com erro ou cidade repetida é recusada e a anterior continua valendo", async () => {
      const tabela = await criarTabela({}, CIDADES);
      entrarComo("ADMIN");

      const repetida = await cidades.PUT(
        req("PUT", { cities: [{ city: "Mirassol", minimum: 1, deadlineHours: 24 }, { city: "MIRASSOL/SP", minimum: 2, deadlineHours: 24 }] }),
        ctx(tabela.id),
      );
      expect(repetida.status).toBe(400);
      expect((await repetida.json()).error).toMatch(/repetida/);

      expect((await cidades.PUT(req("PUT", { cities: [{ city: "Mirassol", minimum: -1, deadlineHours: 24 }] }), ctx(tabela.id))).status).toBe(400);
      expect((await cidades.PUT(req("PUT", { cities: [{ city: "Mirassol", minimum: 1, deadlineHours: 0 }] }), ctx(tabela.id))).status).toBe(400);
      expect((await cidades.PUT(req("PUT", {}), ctx(tabela.id))).status).toBe(400);
      expect((await cidades.PUT(req("PUT", { cities: [] }), ctx("00000000-0000-4000-8000-000000000000"))).status).toBe(404);

      const linhas = await banco.default.freightTableCity.findMany({ where: { tableId: tabela.id }, orderBy: { city: "asc" } });
      expect(linhas.map((l) => [l.city, l.minimum])).toEqual([["Mirassol", 50], ["São José do Rio Preto", 60]]);
    });
  });

  describe("qual tabela vale", () => {
    const simular = async (corpo: Record<string, unknown>) => {
      entrarComo("OPERATION");
      const res = await calcular.POST(req("POST", corpo));
      return { status: res.status, corpo: (await res.json()) as { tabela?: { name: string }; frete?: { atendida: boolean; valor?: number }; error?: string } };
    };

    it("sem tabela padrão o simulador diz que falta cadastrar", async () => {
      await criarTabela({}, CIDADES); // existe, mas não é padrão
      const { status, corpo } = await simular({ city: "Mirassol", weight: 10 });
      expect(status).toBe(404);
      expect(corpo.error).toMatch(/tabela de frete padrão/);
    });

    it("usa a padrão; a do cliente, quando ele tem, vence", async () => {
      await criarTabela({ isDefault: true }, CIDADES);
      const negociada = await criarTabela({ name: nome("negociada"), includedWeightKg: 51, excessPerKg: 0.85 }, [
        { city: "Mirassol", minimum: 40, deadlineHours: 24 },
      ]);

      entrarComo("ADMIN");
      const criado = await clientes.POST(req("POST", { cnpj: CNPJ, companyName: `${PREFIXO}cliente`, freightTableId: negociada.id }));
      expect(criado.status).toBe(201);
      const cliente = (await criado.json()) as { id: string; freightTableId: string };
      expect(cliente.freightTableId).toBe(negociada.id);

      expect((await simular({ city: "Mirassol", weight: 100 })).corpo).toMatchObject({ tabela: { name: nome("geral") }, frete: { valor: 85 } });
      // 100 kg na negociada: 49 excedentes x 0,85 = 41,65 + 40.
      expect((await simular({ city: "Mirassol", weight: 100, clientId: cliente.id })).corpo).toMatchObject({
        tabela: { name: nome("negociada") },
        frete: { valor: 81.65 },
      });

      // Cliente volta para a padrão quando o vínculo é apagado.
      entrarComo("ADMIN");
      expect((await clientePorId.PATCH(req("PATCH", { freightTableId: "" }), ctx(cliente.id))).status).toBe(200);
      expect((await simular({ city: "Mirassol", weight: 100, clientId: cliente.id })).corpo.tabela?.name).toBe(nome("geral"));

      // Tabela que não existe não é aceita no cadastro do cliente.
      entrarComo("ADMIN");
      expect((await clientePorId.PATCH(req("PATCH", { freightTableId: "00000000-0000-4000-8000-000000000000" }), ctx(cliente.id))).status).toBe(400);
    });

    it("tabela inativa ou fora da validade não é usada; escolhida à mão no simulador, sim", async () => {
      const padrao = await criarTabela({ isDefault: true, validTo: "2020-12-31" }, CIDADES);
      expect((await simular({ city: "Mirassol", weight: 10 })).status).toBe(404);
      expect((await simular({ city: "Mirassol", weight: 10, tableId: padrao.id })).corpo.frete).toMatchObject({ atendida: true, valor: 50 });

      entrarComo("ADMIN");
      await tabelaPorId.PATCH(req("PATCH", { validTo: null, active: false }), ctx(padrao.id));
      expect((await simular({ city: "Mirassol", weight: 10 })).status).toBe(404);

      entrarComo("ADMIN");
      await tabelaPorId.PATCH(req("PATCH", { active: true }), ctx(padrao.id));
      expect((await simular({ city: "Mirassol", weight: 10 })).corpo.frete).toMatchObject({ atendida: true, valor: 50 });
      expect((await simular({ city: "Campinas", weight: 10 })).corpo.frete).toEqual({ atendida: false });
    });
  });

  describe("cotação pública", () => {
    const pedido = (extra: Record<string, unknown> = {}) => ({
      empresa: EMPRESA_PADRAO.slug,
      companyName: "Interessado",
      email: `${PREFIXO}lead@exemplo.br`,
      origin: "São José do Rio Preto",
      destination: "mirassol/sp",
      weight: "100",
      ...extra,
    });

    it("com tabela padrão o valor sai dela, com o prazo, nas duas rotas", async () => {
      await criarTabela({ isDefault: true }, CIDADES);
      sessao.mockResolvedValue(null);

      const lead = await leads.POST(req("POST", pedido()));
      expect(lead.status).toBe(200);
      expect(await lead.json()).toMatchObject({ estimatedValue: 85, prazoHoras: 24, lead: { estimatedValue: 85, volumes: 1, status: "NEW" } });

      const cotacao = await cotacoes.POST(req("POST", pedido({ volumes: 2, weight: 10 })));
      expect(cotacao.status).toBe(201);
      expect(await cotacao.json()).toMatchObject({ estimatedValue: 50, volumes: 2 });
    });

    it("sem tabela, ou com a cidade fora dela, o pedido é gravado sem valor", async () => {
      sessao.mockResolvedValue(null);
      const semTabela = await leads.POST(req("POST", pedido()));
      expect(semTabela.status).toBe(200);
      expect((await semTabela.json()).estimatedValue).toBeNull();

      await criarTabela({ isDefault: true }, CIDADES);
      sessao.mockResolvedValue(null);
      const foraDaTabela = await leads.POST(req("POST", pedido({ destination: "Campinas" })));
      expect((await foraDaTabela.json()).estimatedValue).toBeNull();

      expect(await banco.sistema.quoteLead.count({ where: { email: `${PREFIXO}lead@exemplo.br` } })).toBe(2);
    });

    it("pedido inválido não é gravado", async () => {
      sessao.mockResolvedValue(null);
      for (const [caso, corpo] of [
        ["sem peso", pedido({ weight: "" })],
        ["peso zero", pedido({ weight: 0 })],
        ["e-mail inválido", pedido({ email: "nao-e-email" })],
        ["sem destino", pedido({ destination: " " })],
        ["corpo vazio", null],
      ] as const) {
        expect((await leads.POST(req("POST", corpo))).status, caso).toBe(400);
      }
      // `/api/cotacoes` exige volumes; `/api/leads` assume 1.
      expect((await cotacoes.POST(req("POST", pedido()))).status).toBe(400);
      expect(await banco.sistema.quoteLead.count({ where: { email: { startsWith: PREFIXO } } })).toBe(0);
    });

    it("a cotação usa a tabela da empresa informada, não a de outra", async () => {
      await criarTabela({ isDefault: true }, CIDADES);
      sessao.mockResolvedValue(null);

      // A outra empresa não tem tabela: mesmo pedido, sem valor.
      const naOutra = await leads.POST(req("POST", pedido({ empresa: EMPRESA_OUTRA.slug })));
      expect(naOutra.status).toBe(200);
      const corpo = await naOutra.json();
      expect(corpo.estimatedValue).toBeNull();
      expect((await banco.sistema.quoteLead.findUniqueOrThrow({ where: { id: corpo.lead.id } })).tenantId).toBe(EMPRESA_OUTRA.id);
    });
  });
});
