import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { getServerSession } from "next-auth";
import { EMPRESA_OUTRA, EMPRESA_PADRAO } from "./empresas-de-teste";

/**
 * Em que empresa a conta do login único entra, e o cadastro de empresas da
 * plataforma, contra um Postgres de verdade.
 */
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

const temBanco = Boolean(process.env.DATABASE_URL);

if (!temBanco) {
  console.warn("\n[entrada-e-plataforma.test] DATABASE_URL ausente: testes de integração PULADOS.\n");
}

const suite = temBanco ? describe : describe.skip;

const PREFIXO = "teste-entrada-";
const SLUG = "teste-entrada-nova";
const HASH_FALSO = "$2b$10$hashfalsoparateste000000000000000000000000000000000";

suite("entrada pelo login único e plataforma", () => {
  let banco: typeof import("../src/lib/prisma");
  let auth: typeof import("../src/lib/auth");
  let minhas: typeof import("../src/app/api/empresas/route");
  let plataforma: typeof import("../src/app/api/plataforma/empresas/route");
  let plataformaPorId: typeof import("../src/app/api/plataforma/empresas/[id]/route");

  const sessao = vi.mocked(getServerSession);
  const email = (nome: string) => `${PREFIXO}${nome}@exemplo.br`;
  const conta = (nome: string, papel = "CLIENTE") => ({ email: email(nome), nome: "Pessoa", papel });

  const criar = (tenantId: string, nome: string, role: "ADMIN" | "OPERATION" = "OPERATION") =>
    banco.sistema.user.create({ data: { tenantId, name: nome, email: email(nome), password: HASH_FALSO, role } });

  function logado(nome: string | null, equipe = false) {
    sessao.mockResolvedValue(
      nome
        ? { user: { id: "", role: "", clientId: null, tenantId: null, equipe, situacao: "escolher", name: "Pessoa", email: email(nome) } }
        : null,
    );
  }

  const req = (method: string, body?: unknown) =>
    new Request("http://localhost/api/teste", {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

  async function limpar() {
    const { sistema } = banco;
    await sistema.user.deleteMany({ where: { OR: [{ email: { startsWith: PREFIXO } }, { tenant: { slug: SLUG } }] } });
    await sistema.tenant.deleteMany({ where: { slug: SLUG } });
  }

  beforeAll(async () => {
    banco = await import("../src/lib/prisma");
    auth = await import("../src/lib/auth");
    minhas = await import("../src/app/api/empresas/route");
    plataforma = await import("../src/app/api/plataforma/empresas/route");
    plataformaPorId = await import("../src/app/api/plataforma/empresas/[id]/route");
    await limpar();
  });

  afterEach(async () => {
    sessao.mockReset();
    await limpar();
  });

  afterAll(async () => {
    if (banco) await limpar();
  });

  describe("em que empresa a conta entra", () => {
    it("um cadastro só: entra direto, sem diferenciar maiúsculas no e-mail", async () => {
      const usuario = await criar(EMPRESA_OUTRA.id, "ana");
      const entrada = await auth.resolverEntrada({ ...conta("ana"), email: email("ana").toUpperCase() });
      expect(entrada).toMatchObject({ situacao: "dentro", user: { id: usuario.id, tenantId: EMPRESA_OUTRA.id } });
    });

    it("cadastro em duas empresas: escolhe, e entra na escolhida", async () => {
      await criar(EMPRESA_PADRAO.id, "bia");
      const naOutra = await criar(EMPRESA_OUTRA.id, "bia");

      expect(await auth.resolverEntrada(conta("bia"))).toEqual({ situacao: "escolher" });
      expect((await auth.empresasDaConta(conta("bia"))).map((e) => e.slug).sort()).toEqual(
        [EMPRESA_PADRAO.slug, EMPRESA_OUTRA.slug].sort(),
      );
      expect(await auth.resolverEntrada(conta("bia"), EMPRESA_OUTRA.slug)).toMatchObject({
        situacao: "dentro",
        user: { id: naOutra.id },
      });
    });

    it("sem cadastro: não entra, não escolhe empresa alheia e nada é criado", async () => {
      await criar(EMPRESA_PADRAO.id, "caio");

      expect(await auth.resolverEntrada(conta("davi"))).toEqual({ situacao: "sem-cadastro" });
      expect(await auth.empresasDaConta(conta("davi"))).toEqual([]);
      expect(await auth.resolverEntrada(conta("davi"), EMPRESA_PADRAO.slug)).toEqual({ situacao: "recusada" });
      expect(await auth.resolverEntrada(conta("caio"), EMPRESA_OUTRA.slug)).toEqual({ situacao: "recusada" });
      expect(await auth.resolverEntrada(conta("caio"), "' OR 1=1 --")).toEqual({ situacao: "recusada" });
      expect(await banco.sistema.user.count({ where: { email: email("davi") } })).toBe(0);
    });

    it("equipe: sempre escolhe, vê todas as empresas ativas e ganha cadastro de suporte ao entrar", async () => {
      const equipe = conta("eva", "ADMIN");
      const silencio = vi.spyOn(console, "info").mockImplementation(() => undefined);
      try {
        expect(await auth.resolverEntrada(equipe)).toEqual({ situacao: "escolher" });

        const slugs = (await auth.empresasDaConta(equipe)).map((e) => e.slug);
        expect(slugs).toEqual(expect.arrayContaining([EMPRESA_PADRAO.slug, EMPRESA_OUTRA.slug]));

        const primeira = await auth.resolverEntrada(equipe, EMPRESA_OUTRA.slug);
        expect(primeira).toMatchObject({ situacao: "dentro", user: { role: "ADMIN", tenantId: EMPRESA_OUTRA.id, name: "Pessoa (Ávila Ops)" } });

        // Segunda entrada usa o mesmo cadastro.
        const segunda = await auth.resolverEntrada(equipe, EMPRESA_OUTRA.slug);
        expect(segunda.situacao === "dentro" && primeira.situacao === "dentro" && segunda.user.id === primeira.user.id).toBe(true);
        expect(await banco.sistema.user.count({ where: { email: email("eva") } })).toBe(1);

        expect(await auth.resolverEntrada(equipe, "nao-existe")).toEqual({ situacao: "recusada" });
      } finally {
        silencio.mockRestore();
      }
    });

    it("GET /api/empresas: sem sessão 401; com sessão, só as empresas da conta", async () => {
      logado(null);
      expect((await minhas.GET()).status).toBe(401);

      await criar(EMPRESA_OUTRA.id, "fabio");
      logado("fabio");
      const corpo = (await (await minhas.GET()).json()) as { equipe: boolean; empresas: { slug: string }[] };
      expect(corpo.equipe).toBe(false);
      expect(corpo.empresas.map((e) => e.slug)).toEqual([EMPRESA_OUTRA.slug]);
    });
  });

  describe("cadastro de empresas da plataforma", () => {
    const nova = { slug: SLUG, name: "Transportes Nova", cnpj: "", adminName: "Dona", adminEmail: `${PREFIXO}Dona@Exemplo.BR` };

    it("só a equipe: sem sessão 401, administrador de empresa 403", async () => {
      logado(null);
      expect((await plataforma.GET()).status).toBe(401);
      expect((await plataforma.POST(req("POST", nova))).status).toBe(401);

      logado("gabi", false);
      expect((await plataforma.GET()).status).toBe(403);
      expect((await plataforma.POST(req("POST", nova))).status).toBe(403);
      expect((await plataformaPorId.PATCH(req("PATCH", { active: false }), ctx(EMPRESA_OUTRA.id))).status).toBe(403);

      expect(await banco.sistema.tenant.count({ where: { slug: SLUG } })).toBe(0);
      expect((await banco.sistema.tenant.findUniqueOrThrow({ where: { id: EMPRESA_OUTRA.id } })).active).toBe(true);
    });

    it("cria a empresa com o primeiro administrador, que entra direto nela", async () => {
      logado("hugo", true);
      const silencio = vi.spyOn(console, "info").mockImplementation(() => undefined);
      let res: Response;
      try {
        res = await plataforma.POST(req("POST", nova));
      } finally {
        silencio.mockRestore();
      }
      expect(res.status).toBe(201);

      const corpo = (await res.json()) as { id: string; slug: string; _count: { users: number } };
      expect(corpo.slug).toBe(SLUG);
      expect(corpo._count.users).toBe(1);

      const entrada = await auth.resolverEntrada({ email: email("dona"), nome: "Dona", papel: "CLIENTE" });
      expect(entrada).toMatchObject({ situacao: "dentro", user: { role: "ADMIN", tenantId: corpo.id } });

      const lista = (await (await plataforma.GET()).json()) as { slug: string }[];
      expect(lista.map((e) => e.slug)).toContain(SLUG);
    });

    it("identificador repetido 409; dados inválidos 400; nada fica pela metade", async () => {
      logado("hugo", true);

      expect((await plataforma.POST(req("POST", { ...nova, slug: EMPRESA_PADRAO.slug }))).status).toBe(409);
      expect((await plataforma.POST(req("POST", { ...nova, slug: "Com Espaço" }))).status).toBe(400);
      expect((await plataforma.POST(req("POST", { ...nova, adminEmail: "não é e-mail" }))).status).toBe(400);
      expect((await plataforma.POST(req("POST", { ...nova, cnpj: "123" }))).status).toBe(400);

      expect(await banco.sistema.tenant.count({ where: { slug: SLUG } })).toBe(0);
      expect(await banco.sistema.user.count({ where: { email: email("dona") } })).toBe(0);
    });

    it("desativar impede a entrada sem apagar nada; reativar devolve", async () => {
      await criar(EMPRESA_OUTRA.id, "ines");
      logado("hugo", true);
      const silencio = vi.spyOn(console, "info").mockImplementation(() => undefined);
      try {
        expect((await plataformaPorId.PATCH(req("PATCH", { active: false }), ctx(EMPRESA_OUTRA.id))).status).toBe(200);
        expect(await auth.resolverEntrada(conta("ines"))).toEqual({ situacao: "sem-cadastro" });
        expect(await banco.sistema.user.count({ where: { email: email("ines") } })).toBe(1);

        expect((await plataformaPorId.PATCH(req("PATCH", { active: true }), ctx(EMPRESA_OUTRA.id))).status).toBe(200);
        expect((await auth.resolverEntrada(conta("ines"))).situacao).toBe("dentro");

        expect((await plataformaPorId.PATCH(req("PATCH", {}), ctx(EMPRESA_OUTRA.id))).status).toBe(400);
        expect((await plataformaPorId.PATCH(req("PATCH", { active: false }), ctx("00000000-0000-4000-8000-000000000000"))).status).toBe(404);
      } finally {
        silencio.mockRestore();
        await banco.sistema.tenant.update({ where: { id: EMPRESA_OUTRA.id }, data: { active: true } });
      }
    });
  });
});

/**
 * Ponte com a API de provisionamento do login único (src/lib/acessos.ts). O
 * auth é simulado trocando o `fetch`: o que se prova é o que o TMS pede e o que
 * faz com cada resposta.
 */
describe("liberação de acesso no login único", () => {
  const SEGREDO = "segredo-de-teste";
  let acessos: typeof import("../src/lib/acessos");

  beforeAll(async () => {
    acessos = await import("../src/lib/acessos");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  function authResponde(status: number, corpo: unknown) {
    const chamadas: { url: string; method: string; authorization: string | null; body: unknown }[] = [];
    vi.stubEnv("AVILAOPS_CLIENT_SECRET", SEGREDO);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        chamadas.push({
          url: String(url),
          method: init?.method ?? "GET",
          authorization: new Headers(init?.headers).get("authorization"),
          body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
        });
        return new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
      }),
    );
    return chamadas;
  }

  it("sem segredo configurado não chama ninguém e avisa", async () => {
    vi.stubEnv("AVILAOPS_CLIENT_SECRET", "");
    const fetchFalso = vi.fn();
    vi.stubGlobal("fetch", fetchFalso);

    expect(await acessos.liberarAcesso({ email: "a@exemplo.br", nome: "A" })).toEqual({ ok: false, erro: expect.any(String) });
    expect(await acessos.revogarAcesso("a@exemplo.br")).toBe(false);
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it("conta nova: pede o convite por e-mail como o cliente OIDC; enviado, o endereço da senha não volta", async () => {
    vi.stubEnv("NEXTAUTH_URL", "https://tms.avilaops.com/");
    const chamadas = authResponde(201, { email: "novo@exemplo.br", criada: true, convite: null, envio: "enviado" });

    const acesso = await acessos.liberarAcesso(
      { email: "novo@exemplo.br", nome: "Novo", cpf: "12345678901", telefone: null },
      { empresa: "Mello Transportes", convidadoPor: "Rogério" },
    );
    expect(acesso).toEqual({ ok: true, contaNova: true, enviado: true, convite: null });

    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].url).toBe("https://auth.avilaops.com/api/provisionamento/acessos");
    expect(chamadas[0].method).toBe("POST");
    expect(chamadas[0].authorization).toBe(`Basic ${Buffer.from(`tms:${SEGREDO}`).toString("base64")}`);
    expect(chamadas[0].body).toEqual({
      email: "novo@exemplo.br",
      nome: "Novo",
      cpf: "12345678901",
      enviarConvite: true,
      empresa: "Mello Transportes",
      convidadoPor: "Rogério",
      destino: "https://tms.avilaops.com/login",
    });
  });

  it("e-mail do convite não saiu: o endereço da senha volta para alguém entregar à mão", async () => {
    authResponde(201, { email: "novo@exemplo.br", criada: true, convite: "https://auth.avilaops.com/recuperar/abc", envio: "sem_email" });
    expect(await acessos.liberarAcesso({ email: "novo@exemplo.br", nome: "Novo" })).toEqual({
      ok: true,
      contaNova: true,
      enviado: false,
      convite: "https://auth.avilaops.com/recuperar/abc",
    });
  });

  it("conta que já existia: liberada, sem endereço de senha", async () => {
    authResponde(200, { email: "velho@exemplo.br", criada: false, convite: null, envio: "enviado" });
    expect(await acessos.liberarAcesso({ email: "velho@exemplo.br", nome: "Velho" })).toEqual({
      ok: true,
      contaNova: false,
      enviado: true,
      convite: null,
    });
  });

  it("recusa do auth: 409 leva a mensagem ao operador; os demais erros, não", async () => {
    const silencio = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      authResponde(409, { error: "Esta conta está desligada no login único." });
      expect(await acessos.liberarAcesso({ email: "x@exemplo.br", nome: "X" })).toEqual({
        ok: false,
        erro: "Esta conta está desligada no login único.",
      });

      authResponde(401, { error: "Cliente ou segredo inválidos." });
      const recusado = await acessos.liberarAcesso({ email: "x@exemplo.br", nome: "X" });
      expect(recusado.ok).toBe(false);
      expect(JSON.stringify(recusado)).not.toContain("segredo");

      vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("sem rede"))));
      expect((await acessos.liberarAcesso({ email: "x@exemplo.br", nome: "X" })).ok).toBe(false);
    } finally {
      silencio.mockRestore();
    }
  });

  it("revogar chama DELETE com o e-mail", async () => {
    const chamadas = authResponde(200, { revogada: true });
    expect(await acessos.revogarAcesso("sai+daqui@exemplo.br")).toBe(true);
    expect(chamadas[0].method).toBe("DELETE");
    expect(chamadas[0].url).toBe("https://auth.avilaops.com/api/provisionamento/acessos?email=sai%2Bdaqui%40exemplo.br");
  });

  it("o valor da coluna de senha não é hash e nunca se repete", () => {
    const a = acessos.senhaSemUso();
    expect(a).toMatch(/^sem-senha:/);
    expect(a).not.toBe(acessos.senhaSemUso());
  });
});
