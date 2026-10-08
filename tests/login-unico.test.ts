import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { EMPRESA_OUTRA, EMPRESA_PADRAO } from "./empresas-de-teste";

/**
 * Entrada pelo login único da Ávila Ops, contra um Postgres de verdade.
 *
 * O auth é simulado trocando o `fetch`: o que se prova aqui é o que o TMS faz
 * com cada resposta dele.
 */
const temBanco = Boolean(process.env.DATABASE_URL);

if (!temBanco) {
  console.warn("\n[login-unico.test] DATABASE_URL ausente: testes de integração PULADOS.\n");
}

const suite = temBanco ? describe : describe.skip;

const PREFIXO = "teste-loginunico-";
const HASH_FALSO = "$2b$10$hashfalsoparateste000000000000000000000000000000000";

suite("login único", () => {
  let banco: typeof import("../src/lib/prisma");
  let auth: typeof import("../src/lib/auth");

  const email = (nome: string) => `${PREFIXO}${nome}@exemplo.br`;

  // Resposta do auth para o cookie apresentado; `null` = sem sessão.
  function authResponde(corpo: Record<string, unknown> | null) {
    const chamadas: { url: string; cookie: string | null }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        chamadas.push({ url: String(url), cookie: new Headers(init?.headers).get("cookie") });
        return corpo
          ? new Response(JSON.stringify(corpo), { status: 200, headers: { "content-type": "application/json" } })
          : new Response(JSON.stringify({ autenticado: false }), { status: 401 });
      }),
    );
    return chamadas;
  }

  const conta = (nome: string, extra: Record<string, unknown> = {}) => ({
    autenticado: true,
    permitido: true,
    sessao: { sub: "1", email: email(nome), nome: "Pessoa", papel: "CLIENTE", mfa: false, ...extra },
  });

  const entrar = (credenciais: Record<string, string> = {}, cookie: string | undefined = "outro=1; avila_sso=token.do.auth") => {
    const provider = auth.authOptions.providers[0] as unknown as {
      options: {
        authorize: (c: Record<string, string>, r: unknown) => Promise<{ id: string; tenantId: string; role: string } | null>;
      };
    };
    return provider.options.authorize(credenciais, { headers: { cookie } });
  };

  async function limpar() {
    await banco.sistema.user.deleteMany({ where: { email: { startsWith: PREFIXO } } });
  }

  const criar = (tenantId: string, nome: string, role: "ADMIN" | "OPERATION" = "OPERATION") =>
    banco.sistema.user.create({ data: { tenantId, name: nome, email: email(nome), password: HASH_FALSO, role } });

  beforeAll(async () => {
    banco = await import("../src/lib/prisma");
    auth = await import("../src/lib/auth");
    await limpar();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await limpar();
  });

  afterAll(async () => {
    if (banco) await limpar();
  });

  it("conta com cadastro numa empresa entra nela, e o auth é consultado com o cookie e o app", async () => {
    const usuario = await criar(EMPRESA_OUTRA.id, "ana");
    const chamadas = authResponde(conta("ana"));

    const logado = await entrar();
    expect(logado?.id).toBe(usuario.id);
    expect(logado?.tenantId).toBe(EMPRESA_OUTRA.id);

    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].url).toBe("https://auth.avilaops.com/api/session?app=tms");
    expect(chamadas[0].cookie).toBe("avila_sso=token.do.auth");
  });

  it("o e-mail do auth casa sem diferenciar maiúsculas", async () => {
    const usuario = await criar(EMPRESA_PADRAO.id, "bia");
    authResponde(conta("bia", { email: email("bia").toUpperCase() }));
    expect((await entrar())?.id).toBe(usuario.id);
  });

  it("sem cookie do login único nem chega a consultar o auth", async () => {
    const chamadas = authResponde(conta("ana"));
    await expect(entrar({}, "outro=1")).rejects.toThrow(/Não há sessão do login único/);
    expect(chamadas).toHaveLength(0);
  });

  it("sessão inválida no auth, ou conta não liberada para o TMS, não entra", async () => {
    await criar(EMPRESA_PADRAO.id, "caio");

    authResponde(null);
    await expect(entrar()).rejects.toThrow(/Não há sessão do login único/);

    authResponde({ ...conta("caio"), permitido: false });
    await expect(entrar()).rejects.toThrow(/Não há sessão do login único/);
  });

  it("auth fora do ar: ninguém entra por este caminho", async () => {
    await criar(EMPRESA_PADRAO.id, "davi");
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("sem rede"))));
    const silencio = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(entrar()).rejects.toThrow(/Não há sessão do login único/);
    } finally {
      silencio.mockRestore();
    }
  });

  it("cadastro em duas empresas: pede a empresa e entra na informada", async () => {
    await criar(EMPRESA_PADRAO.id, "eva");
    const naOutra = await criar(EMPRESA_OUTRA.id, "eva");
    authResponde(conta("eva"));

    await expect(entrar()).rejects.toThrow(/Informe a empresa/);
    expect((await entrar({ empresa: EMPRESA_OUTRA.slug }))?.id).toBe(naOutra.id);
  });

  it("cliente sem cadastro em nenhuma empresa não entra e nada é criado", async () => {
    authResponde(conta("fabio"));
    await expect(entrar({ empresa: EMPRESA_PADRAO.slug })).rejects.toThrow(/não tem cadastro em nenhuma empresa/);
    expect(await banco.sistema.user.count({ where: { email: email("fabio") } })).toBe(0);
  });

  describe("equipe da Ávila Ops sem cadastro na empresa", () => {
    const equipe = (extra: Record<string, unknown> = {}) => conta("gabi", { papel: "ADMIN", mfa: true, nome: "Gabi", ...extra });

    it("com segundo fator e empresa informada, entra como administrador e o cadastro fica na empresa", async () => {
      authResponde(equipe());
      const silencio = vi.spyOn(console, "info").mockImplementation(() => undefined);
      let logado: Awaited<ReturnType<typeof entrar>>;
      try {
        logado = await entrar({ empresa: EMPRESA_OUTRA.slug });
      } finally {
        silencio.mockRestore();
      }

      expect(logado?.role).toBe("ADMIN");
      expect(logado?.tenantId).toBe(EMPRESA_OUTRA.id);

      const gravado = await banco.sistema.user.findUniqueOrThrow({ where: { id: logado!.id } });
      expect(gravado.name).toBe("Gabi (Ávila Ops)");
      expect(gravado.tenantId).toBe(EMPRESA_OUTRA.id);

      // Segunda entrada usa o mesmo cadastro, sem criar outro.
      expect((await entrar({ empresa: EMPRESA_OUTRA.slug }))?.id).toBe(logado!.id);
      expect(await banco.sistema.user.count({ where: { email: email("gabi") } })).toBe(1);
    });

    it("o login único é a única forma de entrar: não existe provedor de senha", () => {
      const ids = auth.authOptions.providers.map((p) => (p as unknown as { options?: { id?: string } }).options?.id ?? p.id);
      expect(ids).toEqual(["sso"]);
    });

    it("sem segundo fator, sem empresa ou com empresa inexistente: não entra e nada é criado", async () => {
      authResponde(equipe({ mfa: false }));
      await expect(entrar({ empresa: EMPRESA_PADRAO.slug })).rejects.toThrow(/duas etapas/);

      authResponde(equipe());
      await expect(entrar()).rejects.toThrow(/informe a empresa/);
      await expect(entrar({ empresa: "nao-existe" })).rejects.toThrow(/Empresa não encontrada/);

      expect(await banco.sistema.user.count({ where: { email: email("gabi") } })).toBe(0);
    });
  });
});
