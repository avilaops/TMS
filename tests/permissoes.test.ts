import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getServerSession } from "next-auth";

/**
 * Permissão por perfil nas rotas internas e gestão de usuários, contra um
 * Postgres de verdade.
 *
 * A sessão é simulada trocando `getServerSession`; todo o resto é o handler
 * que o Next executa em produção. Os usuários existem de verdade no banco
 * porque `requireStaff` confere o perfil lá, não no token.
 *
 * Sem DATABASE_URL a suite é pulada com aviso — no CI ela sempre roda, contra
 * o serviço `postgres` do workflow.
 */
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

const temBanco = Boolean(process.env.DATABASE_URL);

if (!temBanco) {
  console.warn(
    "\n[permissoes.test] DATABASE_URL ausente: testes de integração PULADOS.\n" +
      "Rode com um Postgres real para exercitá-los.\n",
  );
}

const suite = temBanco ? describe : describe.skip;

// Tudo o que esta suite cria usa estes marcadores, e só isso é apagado.
const PREFIXO = "teste-permissoes-";
const CNPJ_TESTE = "99888777000166";
const HASH_FALSO = "$2b$10$hashfalsoparateste000000000000000000000000000000000";

type Perfil = "ADMIN" | "OPERATION" | "DRIVER" | "CLIENT";
type Handler = (req: Request) => Promise<Response>;

suite("permissões das rotas internas", () => {
  let prisma: typeof import("../src/lib/prisma").default;
  let clientes: typeof import("../src/app/api/clientes/route");
  let clientePorId: typeof import("../src/app/api/clientes/[id]/route");
  let coletas: typeof import("../src/app/api/coletas/route");
  let coletaPorId: typeof import("../src/app/api/coletas/[id]/route");
  let coletaHistorico: typeof import("../src/app/api/coletas/[id]/historico/route");
  let dashboard: typeof import("../src/app/api/dashboard/route");
  let financeiro: typeof import("../src/app/api/financeiro/route");
  let financeiroPorId: typeof import("../src/app/api/financeiro/[id]/route");
  let financeiroFluxo: typeof import("../src/app/api/financeiro/fluxo/route");
  let financeiroCobranca: typeof import("../src/app/api/financeiro/cobranca/route");
  let financeiroRecibo: typeof import("../src/app/api/financeiro/[id]/recibo/route");
  let fiscal: typeof import("../src/app/api/fiscal/route");
  let fiscalCte: typeof import("../src/app/api/fiscal/cte/route");
  let manifestos: typeof import("../src/app/api/manifestos/route");
  let manifestoPorId: typeof import("../src/app/api/manifestos/[id]/route");
  let manifestoLiberar: typeof import("../src/app/api/manifestos/[id]/liberar/route");
  let manifestoCancelar: typeof import("../src/app/api/manifestos/[id]/cancelar/route");
  let manifestoFinalizar: typeof import("../src/app/api/manifestos/[id]/finalizar/route");
  let manifestoCarga: typeof import("../src/app/api/manifestos/[id]/coletas/[coletaId]/route");
  let motoristas: typeof import("../src/app/api/motoristas/route");
  let motoristaPorId: typeof import("../src/app/api/motoristas/[id]/route");
  let veiculos: typeof import("../src/app/api/veiculos/route");
  let veiculoPorId: typeof import("../src/app/api/veiculos/[id]/route");
  let manutencao: typeof import("../src/app/api/veiculos/[id]/manutencao/route");
  let pendentes: typeof import("../src/app/api/dashboard/coletas/pendentes/route");
  let coletaStatus: typeof import("../src/app/api/dashboard/coletas/[id]/status/route");
  let crm: typeof import("../src/app/api/dashboard/crm/route");
  let crmLead: typeof import("../src/app/api/dashboard/crm/[id]/route");
  let crmConverter: typeof import("../src/app/api/dashboard/crm/[id]/converter/route");
  let usuarios: typeof import("../src/app/api/usuarios/route");
  let usuario: typeof import("../src/app/api/usuarios/[id]/route");

  const ids = {} as Record<Perfil, string>;
  let clienteId: string;

  const sessao = vi.mocked(getServerSession);

  function entrarComo(perfil: Perfil | null) {
    sessao.mockResolvedValue(
      perfil
        ? { user: { id: ids[perfil], role: perfil, clientId: null, name: perfil, email: `${perfil}@teste` } }
        : null,
    );
  }

  const req = (method = "GET", body?: unknown) =>
    new Request("http://localhost/api/teste", {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

  async function limpar() {
    await prisma.user.deleteMany({ where: { email: { startsWith: PREFIXO } } });
    await prisma.client.deleteMany({ where: { cnpj: CNPJ_TESTE } });
  }

  async function criarUsuario(nome: string, role: Perfil, extra: { clientId?: string } = {}) {
    return prisma.user.create({
      data: { name: nome, email: `${PREFIXO}${nome}@exemplo.br`, password: HASH_FALSO, role, ...extra },
    });
  }

  // Toda rota interna, com um corpo que seria aceito se a permissão deixasse
  // passar: nenhuma delas pode chegar ao banco com o perfil errado.
  let rotasStaff: [string, Handler][];
  let rotasAdmin: [string, Handler][];

  beforeAll(async () => {
    prisma = (await import("../src/lib/prisma")).default;
    clientes = await import("../src/app/api/clientes/route");
    clientePorId = await import("../src/app/api/clientes/[id]/route");
    coletas = await import("../src/app/api/coletas/route");
    coletaPorId = await import("../src/app/api/coletas/[id]/route");
    coletaHistorico = await import("../src/app/api/coletas/[id]/historico/route");
    dashboard = await import("../src/app/api/dashboard/route");
    financeiro = await import("../src/app/api/financeiro/route");
    financeiroPorId = await import("../src/app/api/financeiro/[id]/route");
    financeiroFluxo = await import("../src/app/api/financeiro/fluxo/route");
    financeiroCobranca = await import("../src/app/api/financeiro/cobranca/route");
    financeiroRecibo = await import("../src/app/api/financeiro/[id]/recibo/route");
    fiscal = await import("../src/app/api/fiscal/route");
    fiscalCte = await import("../src/app/api/fiscal/cte/route");
    manifestos = await import("../src/app/api/manifestos/route");
    manifestoPorId = await import("../src/app/api/manifestos/[id]/route");
    manifestoLiberar = await import("../src/app/api/manifestos/[id]/liberar/route");
    manifestoCancelar = await import("../src/app/api/manifestos/[id]/cancelar/route");
    manifestoFinalizar = await import("../src/app/api/manifestos/[id]/finalizar/route");
    manifestoCarga = await import("../src/app/api/manifestos/[id]/coletas/[coletaId]/route");
    motoristas = await import("../src/app/api/motoristas/route");
    motoristaPorId = await import("../src/app/api/motoristas/[id]/route");
    veiculos = await import("../src/app/api/veiculos/route");
    veiculoPorId = await import("../src/app/api/veiculos/[id]/route");
    manutencao = await import("../src/app/api/veiculos/[id]/manutencao/route");
    pendentes = await import("../src/app/api/dashboard/coletas/pendentes/route");
    coletaStatus = await import("../src/app/api/dashboard/coletas/[id]/status/route");
    crm = await import("../src/app/api/dashboard/crm/route");
    crmLead = await import("../src/app/api/dashboard/crm/[id]/route");
    crmConverter = await import("../src/app/api/dashboard/crm/[id]/converter/route");
    usuarios = await import("../src/app/api/usuarios/route");
    usuario = await import("../src/app/api/usuarios/[id]/route");

    await limpar();

    const cliente = await prisma.client.create({
      data: { companyName: "Empresa Teste Permissoes LTDA", cnpj: CNPJ_TESTE },
    });
    clienteId = cliente.id;

    ids.ADMIN = (await criarUsuario("admin", "ADMIN")).id;
    ids.OPERATION = (await criarUsuario("operacao", "OPERATION")).id;
    ids.DRIVER = (await criarUsuario("motorista", "DRIVER")).id;
    ids.CLIENT = (await criarUsuario("cliente", "CLIENT", { clientId: clienteId })).id;

    const semId = "00000000-0000-0000-0000-000000000000";

    rotasStaff = [
      ["GET /api/clientes", () => clientes.GET()],
      ["POST /api/clientes", () => clientes.POST(req("POST", { cnpj: "1", companyName: "x" }))],
      ["PATCH /api/clientes/[id]", () => clientePorId.PATCH(req("PATCH", { companyName: "Invasor LTDA" }), ctx(clienteId))],
      ["GET /api/coletas", () => coletas.GET()],
      ["POST /api/coletas", () => coletas.POST(req("POST", {}))],
      ["GET /api/coletas/[id]", () => coletaPorId.GET(req(), ctx(semId))],
      ["PATCH /api/coletas/[id]", () => coletaPorId.PATCH(req("PATCH", { volumes: 1 }), ctx(semId))],
      ["GET /api/coletas/[id]/historico", () => coletaHistorico.GET(req(), ctx(semId))],
      ["GET /api/dashboard", () => dashboard.GET()],
      ["POST /api/fiscal", () => fiscal.POST(req("POST", {}))],
      ["POST /api/fiscal/cte", () => fiscalCte.POST(req("POST", {}))],
      ["GET /api/manifestos", () => manifestos.GET()],
      ["POST /api/manifestos", () => manifestos.POST(req("POST", {}))],
      ["PATCH /api/manifestos/[id]", () => manifestoPorId.PATCH(req("PATCH", { driverId: semId }), ctx(semId))],
      ["POST /api/manifestos/[id]/liberar", () => manifestoLiberar.POST(req("POST"), ctx(semId))],
      ["POST /api/manifestos/[id]/cancelar", () => manifestoCancelar.POST(req("POST"), ctx(semId))],
      ["POST /api/manifestos/[id]/finalizar", () => manifestoFinalizar.POST(req("POST"), ctx(semId))],
      [
        "DELETE /api/manifestos/[id]/coletas/[coletaId]",
        () => manifestoCarga.DELETE(req("DELETE"), { params: Promise.resolve({ id: semId, coletaId: semId }) }),
      ],
      ["GET /api/motoristas", () => motoristas.GET()],
      ["POST /api/motoristas", () => motoristas.POST(req("POST", { cpf: "1", name: "x" }))],
      ["PATCH /api/motoristas/[id]", () => motoristaPorId.PATCH(req("PATCH", { active: false }), ctx(semId))],
      ["GET /api/veiculos", () => veiculos.GET()],
      ["POST /api/veiculos", () => veiculos.POST(req("POST", { plate: "X", model: "x", type: "VAN" }))],
      ["PATCH /api/veiculos/[id]", () => veiculoPorId.PATCH(req("PATCH", { status: "MAINTENANCE" }), ctx(semId))],
      ["GET /api/veiculos/[id]/manutencao", () => manutencao.GET(req(), ctx(semId))],
      ["POST /api/veiculos/[id]/manutencao", () => manutencao.POST(req("POST", {}), ctx(semId))],
      ["GET /api/dashboard/coletas/pendentes", () => pendentes.GET(req())],
      ["POST /api/dashboard/coletas/[id]/status", () => coletaStatus.POST(req("POST", {}), ctx(semId))],
      ["GET /api/dashboard/crm", () => crm.GET()],
      ["PATCH /api/dashboard/crm/[id]", () => crmLead.PATCH(req("PATCH", {}), ctx(semId))],
      ["POST /api/dashboard/crm/[id]/converter", () => crmConverter.POST(req("POST", {}), ctx(semId))],
    ];

    rotasAdmin = [
      ["GET /api/financeiro", () => financeiro.GET()],
      ["POST /api/financeiro", () => financeiro.POST(req("POST", {}))],
      ["PATCH /api/financeiro/[id]", () => financeiroPorId.PATCH(req("PATCH", { action: "pagar" }), ctx(semId))],
      ["DELETE /api/financeiro/[id]", () => financeiroPorId.DELETE(req("DELETE"), ctx(semId))],
      ["GET /api/financeiro/fluxo", () => financeiroFluxo.GET()],
      ["GET /api/financeiro/cobranca", () => financeiroCobranca.GET()],
      ["GET /api/financeiro/[id]/recibo", () => financeiroRecibo.GET(req(), ctx(semId))],
      ["GET /api/usuarios", () => usuarios.GET()],
      ["POST /api/usuarios", () => usuarios.POST(req("POST", {}))],
      ["PATCH /api/usuarios/[id]", () => usuario.PATCH(req("PATCH", { name: "Invasor" }), ctx(ids.OPERATION))],
    ];
  });

  beforeEach(() => {
    sessao.mockReset();
  });

  afterAll(async () => {
    if (prisma) await limpar();
  });

  describe("sem sessão → 401", () => {
    it("em todas as rotas internas", async () => {
      entrarComo(null);
      for (const [nome, chamar] of [...rotasStaff, ...rotasAdmin]) {
        const res = await chamar(req());
        expect(res.status, nome).toBe(401);
      }
    });

    it("sessão de usuário que não existe mais também é 401", async () => {
      sessao.mockResolvedValue({
        user: { id: "00000000-0000-0000-0000-000000000000", role: "ADMIN", clientId: null },
      });
      expect((await clientes.GET()).status).toBe(401);
      expect((await usuarios.GET()).status).toBe(401);
    });
  });

  describe.each(["CLIENT", "DRIVER"] as const)("%s → 403", (perfil) => {
    it("em todas as rotas internas, sem gravar nada", async () => {
      entrarComo(perfil);
      const antes = await Promise.all([
        prisma.client.count(),
        prisma.driver.count(),
        prisma.vehicle.count(),
        prisma.user.count(),
      ]);

      for (const [nome, chamar] of [...rotasStaff, ...rotasAdmin]) {
        const res = await chamar(req());
        expect(res.status, nome).toBe(403);
      }

      const depois = await Promise.all([
        prisma.client.count(),
        prisma.driver.count(),
        prisma.vehicle.count(),
        prisma.user.count(),
      ]);
      expect(depois).toEqual(antes);
    });
  });

  describe("OPERATION", () => {
    it("lê as rotas operacionais → 200", async () => {
      entrarComo("OPERATION");
      expect((await clientes.GET()).status).toBe(200);
      expect((await coletas.GET()).status).toBe(200);
      expect((await dashboard.GET()).status).toBe(200);
      expect((await manifestos.GET()).status).toBe(200);
      expect((await motoristas.GET()).status).toBe(200);
      expect((await veiculos.GET()).status).toBe(200);
      expect((await pendentes.GET(req())).status).toBe(200);
      expect((await crm.GET()).status).toBe(200);
    });

    it("passa da permissão nas rotas de escrita (para na validação, 400)", async () => {
      entrarComo("OPERATION");
      expect((await clientes.POST(req("POST", {}))).status).toBe(400);
      expect((await fiscal.POST(req("POST", {}))).status).toBe(400);
      expect((await fiscalCte.POST(req("POST", {}))).status).toBe(400);
    });

    it("não entra em financeiro nem em usuários → 403", async () => {
      entrarComo("OPERATION");
      for (const [nome, chamar] of rotasAdmin) {
        const res = await chamar(req());
        expect(res.status, nome).toBe(403);
      }
      const alvo = await prisma.user.findUniqueOrThrow({ where: { id: ids.OPERATION } });
      expect(alvo.name).toBe("operacao");
    });
  });

  describe("ADMIN", () => {
    it("lê financeiro e as rotas operacionais → 200", async () => {
      entrarComo("ADMIN");
      expect((await financeiro.GET()).status).toBe(200);
      expect((await clientes.GET()).status).toBe(200);
      expect((await veiculos.GET()).status).toBe(200);
    });

    it("lista usuários sem devolver a senha", async () => {
      entrarComo("ADMIN");
      const res = await usuarios.GET();
      expect(res.status).toBe(200);
      const lista = (await res.json()) as Record<string, unknown>[];

      expect(lista.length).toBeGreaterThanOrEqual(4);
      for (const item of lista) {
        expect(item).not.toHaveProperty("password");
        expect(Object.keys(item).sort()).toEqual(["clientId", "createdAt", "email", "id", "name", "role"]);
      }
      expect(JSON.stringify(lista)).not.toContain(HASH_FALSO);
    });

    it("cria usuário sem senha, pede a liberação no login único, e e-mail repetido → 409", async () => {
      entrarComo("ADMIN");
      const email = `${PREFIXO}novo@exemplo.br`;
      const senha = "senha-de-teste-123";

      const res = await usuarios.POST(
        req("POST", { name: "Novo Operador", email: ` ${email.toUpperCase()} `, role: "OPERATION", password: senha }),
      );
      expect(res.status).toBe(201);
      const corpo = await res.json();
      expect(corpo).not.toHaveProperty("password");
      expect(corpo).toMatchObject({ name: "Novo Operador", email, role: "OPERATION", clientId: null });

      const gravado = await prisma.user.findFirstOrThrow({ where: { email } });
      // Senha no corpo é ignorada; a coluna guarda um valor que não é hash de nada.
      expect(gravado.password).toMatch(/^sem-senha:/);
      expect(corpo.acesso).toEqual({ ok: false, erro: expect.any(String) });

      const repetido = await usuarios.POST(
        req("POST", { name: "Outro", email, role: "OPERATION", password: senha }),
      );
      expect(repetido.status).toBe(409);
      expect(await prisma.user.count({ where: { email } })).toBe(1);
    });

    it("recusa dados inválidos → 400", async () => {
      entrarComo("ADMIN");
      const base = { name: "Fulano", email: `${PREFIXO}invalido@exemplo.br`, role: "OPERATION", password: "12345678" };

      const casos: [string, Record<string, unknown>][] = [
        ["e-mail inválido", { ...base, email: "nao-e-email" }],
        ["perfil inexistente", { ...base, role: "ROOT" }],
        ["CLIENT sem empresa", { ...base, role: "CLIENT" }],
        ["CLIENT com empresa inexistente", { ...base, role: "CLIENT", clientId: "nao-existe" }],
        ["DRIVER", { ...base, role: "DRIVER" }],
      ];
      for (const [nome, corpo] of casos) {
        const res = await usuarios.POST(req("POST", corpo));
        expect(res.status, nome).toBe(400);
      }
      expect(await prisma.user.count({ where: { email: base.email } })).toBe(0);

      const motorista = await usuarios.POST(req("POST", { ...base, role: "DRIVER" }));
      expect((await motorista.json()).error).toMatch(/cadastro de motoristas/);
    });

    it("cria CLIENT vinculado a uma empresa existente", async () => {
      entrarComo("ADMIN");
      const res = await usuarios.POST(
        req("POST", {
          name: "Contato Cliente",
          email: `${PREFIXO}contato@exemplo.br`,
          role: "CLIENT",
          password: "12345678",
          clientId: clienteId,
        }),
      );
      expect(res.status).toBe(201);
      expect((await res.json()).clientId).toBe(clienteId);
    });

    it("altera o nome; senha no corpo é ignorada", async () => {
      entrarComo("ADMIN");
      const alvo = await criarUsuario("alterar", "OPERATION");

      const res = await usuario.PATCH(
        req("PATCH", { name: "Nome Novo", password: "outra-senha-456" }),
        ctx(alvo.id),
      );
      expect(res.status).toBe(200);
      const corpo = await res.json();
      expect(corpo).not.toHaveProperty("password");
      expect(corpo.name).toBe("Nome Novo");

      const gravado = await prisma.user.findUniqueOrThrow({ where: { id: alvo.id } });
      expect(gravado.password).toBe(alvo.password);

      expect((await usuario.PATCH(req("PATCH", { password: "curta" }), ctx(alvo.id))).status).toBe(400);
      expect((await usuario.PATCH(req("PATCH", {}), ctx(alvo.id))).status).toBe(400);
      expect(
        (await usuario.PATCH(req("PATCH", { name: "X Y" }), ctx("00000000-0000-0000-0000-000000000000"))).status,
      ).toBe(404);
    });

    it("troca perfil; CLIENT exige empresa e DRIVER não entra nem sai por aqui", async () => {
      entrarComo("ADMIN");
      const alvo = await criarUsuario("trocar", "OPERATION");

      expect((await usuario.PATCH(req("PATCH", { role: "CLIENT" }), ctx(alvo.id))).status).toBe(400);
      expect((await usuario.PATCH(req("PATCH", { role: "DRIVER" }), ctx(alvo.id))).status).toBe(400);
      expect((await usuario.PATCH(req("PATCH", { role: "OPERATION" }), ctx(ids.DRIVER))).status).toBe(400);

      const paraCliente = await usuario.PATCH(req("PATCH", { role: "CLIENT", clientId: clienteId }), ctx(alvo.id));
      expect(paraCliente.status).toBe(200);
      expect(await paraCliente.json()).toMatchObject({ role: "CLIENT", clientId: clienteId });

      // Ao sair de CLIENT o vínculo com a empresa é desfeito.
      const paraOperacao = await usuario.PATCH(req("PATCH", { role: "OPERATION" }), ctx(alvo.id));
      expect(await paraOperacao.json()).toMatchObject({ role: "OPERATION", clientId: null });
    });

    it("rebaixar o último ADMIN (ele mesmo) → 409 e o perfil fica como estava", async () => {
      entrarComo("ADMIN");
      const res = await usuario.PATCH(req("PATCH", { role: "OPERATION" }), ctx(ids.ADMIN));
      expect(res.status).toBe(409);

      const admin = await prisma.user.findUniqueOrThrow({ where: { id: ids.ADMIN } });
      expect(admin.role).toBe("ADMIN");
      expect(await prisma.user.count({ where: { role: "ADMIN" } })).toBeGreaterThanOrEqual(1);
    });

    it("com outro ADMIN no sistema, rebaixar um deles é permitido e vale na hora", async () => {
      entrarComo("ADMIN");
      const segundo = await criarUsuario("segundo-admin", "ADMIN");

      const res = await usuario.PATCH(req("PATCH", { role: "OPERATION" }), ctx(segundo.id));
      expect(res.status).toBe(200);
      expect((await res.json()).role).toBe("OPERATION");

      // O token do rebaixado ainda diz ADMIN; o banco é que decide.
      sessao.mockResolvedValue({ user: { id: segundo.id, role: "ADMIN", clientId: null } });
      expect((await usuarios.GET()).status).toBe(403);
      expect((await financeiro.GET()).status).toBe(403);
      expect((await clientes.GET()).status).toBe(200);
    });
  });
});
