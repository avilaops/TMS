import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getServerSession } from "next-auth";
import { TAMANHO_MAXIMO_DO_SIMBOLO, identidadeSchema } from "../src/lib/empresa";
import { EMPRESA_OUTRA, EMPRESA_PADRAO } from "./empresas-de-teste";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

// PNG de 1x1 pixel.
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

describe("validação da identidade da empresa", () => {
  const valido = (corpo: unknown) => identidadeSchema.safeParse(corpo);

  it("aceita nome, símbolo, os dois, e símbolo nulo para remover", () => {
    expect(valido({ name: "  Mello Transportes  " })).toMatchObject({ success: true, data: { name: "Mello Transportes" } });
    expect(valido({ logo: PNG }).success).toBe(true);
    expect(valido({ name: "Mello", logo: null })).toMatchObject({ success: true, data: { name: "Mello", logo: null } });
    for (const tipo of ["png", "jpeg", "webp"]) expect(valido({ logo: `data:image/${tipo};base64,AAAA` }).success, tipo).toBe(true);
  });

  it("recusa corpo vazio, nome curto ou longo demais", () => {
    for (const corpo of [null, "texto", {}, { name: "" }, { name: " a " }, { name: "x".repeat(61) }, { name: 12 }]) {
      expect(valido(corpo).success, JSON.stringify(corpo)).toBe(false);
    }
  });

  it("recusa símbolo que não é imagem PNG, JPEG ou WebP em base64, e imagem grande demais", () => {
    for (const logo of [
      "",
      "https://exemplo.br/logo.png",
      "data:image/svg+xml;base64,PHN2Zy8+",
      "data:text/html;base64,PHNjcmlwdD4=",
      "data:image/png;base64,<script>",
      "data:image/png,AAAA",
      `data:image/png;base64,${"A".repeat(TAMANHO_MAXIMO_DO_SIMBOLO)}`,
    ]) {
      expect(valido({ logo }).success, logo.slice(0, 40)).toBe(false);
    }
  });
});

/** A rota da identidade, contra um Postgres de verdade. */
const temBanco = Boolean(process.env.DATABASE_URL);

if (!temBanco) {
  console.warn("\n[empresa.test] DATABASE_URL ausente: testes de integração PULADOS.\n");
}

const suite = temBanco ? describe : describe.skip;

const PREFIXO = "teste-empresa-";
const HASH_FALSO = "$2b$10$hashfalsoparateste000000000000000000000000000000000";

suite("rota da identidade da empresa", () => {
  let banco: typeof import("../src/lib/prisma");
  let empresa: typeof import("../src/app/api/empresa/route");

  const sessao = vi.mocked(getServerSession);
  const ids = { ADMIN: "", OPERATION: "", CLIENT: "", DRIVER: "" };

  const entrarComo = (perfil: keyof typeof ids | null) =>
    sessao.mockResolvedValue(perfil ? { user: { id: ids[perfil], role: perfil, clientId: null } } : null);

  const alterar = (corpo: unknown) =>
    empresa.PATCH(
      new Request("http://localhost/api/empresa", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: typeof corpo === "string" ? corpo : JSON.stringify(corpo),
      }),
    );

  const gravada = (id: string) => banco.sistema.tenant.findUniqueOrThrow({ where: { id }, select: { name: true, logo: true } });

  // As outras suites contam com o nome original das empresas de teste.
  const restaurar = async () => {
    for (const e of [EMPRESA_PADRAO, EMPRESA_OUTRA]) {
      await banco.sistema.tenant.update({ where: { id: e.id }, data: { name: e.name, logo: null } });
    }
  };

  beforeAll(async () => {
    banco = await import("../src/lib/prisma");
    empresa = await import("../src/app/api/empresa/route");
    await banco.sistema.user.deleteMany({ where: { email: { startsWith: PREFIXO } } });
    for (const perfil of ["ADMIN", "OPERATION", "CLIENT", "DRIVER"] as const) {
      ids[perfil] = (
        await banco.default.user.create({
          data: { name: perfil, email: `${PREFIXO}${perfil.toLowerCase()}@exemplo.br`, password: HASH_FALSO, role: perfil },
        })
      ).id;
    }
  });

  beforeEach(async () => {
    sessao.mockReset();
    await restaurar();
  });

  afterAll(async () => {
    if (!banco) return;
    await restaurar();
    await banco.sistema.user.deleteMany({ where: { email: { startsWith: PREFIXO } } });
  });

  it("ler: administrador e operação recebem o nome e o símbolo; sem sessão 401; cliente e motorista 403", async () => {
    for (const perfil of ["ADMIN", "OPERATION"] as const) {
      entrarComo(perfil);
      const res = await empresa.GET();
      expect(res.status, perfil).toBe(200);
      expect(await res.json()).toEqual({ name: EMPRESA_PADRAO.name, logo: null });
    }
    for (const [perfil, esperado] of [[null, 401], ["CLIENT", 403], ["DRIVER", 403]] as const) {
      entrarComo(perfil);
      expect((await empresa.GET()).status, String(perfil)).toBe(esperado);
    }
  });

  it("alterar: só o administrador; os demais não mudam nada", async () => {
    for (const [perfil, esperado] of [[null, 401], ["OPERATION", 403], ["CLIENT", 403], ["DRIVER", 403]] as const) {
      entrarComo(perfil);
      expect((await alterar({ name: "Invasora" })).status, String(perfil)).toBe(esperado);
    }
    expect(await gravada(EMPRESA_PADRAO.id)).toEqual({ name: EMPRESA_PADRAO.name, logo: null });
  });

  it("administrador troca o nome e o símbolo, e a leitura seguinte já traz os dois", async () => {
    entrarComo("ADMIN");
    const res = await alterar({ name: "  Mello Transportes ", logo: PNG });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: "Mello Transportes", logo: PNG });
    expect(await (await empresa.GET()).json()).toEqual({ name: "Mello Transportes", logo: PNG });

    // Só o nome: o símbolo fica. Símbolo nulo: volta ao padrão e o nome fica.
    expect((await alterar({ name: "Mello" })).status).toBe(200);
    expect(await gravada(EMPRESA_PADRAO.id)).toEqual({ name: "Mello", logo: PNG });
    expect((await alterar({ logo: null })).status).toBe(200);
    expect(await gravada(EMPRESA_PADRAO.id)).toEqual({ name: "Mello", logo: null });
  });

  it("dado inválido é 400 com a mensagem do campo, e nada é gravado", async () => {
    entrarComo("ADMIN");
    for (const [corpo, mensagem] of [
      ["{quebrado", /Dados inválidos/],
      [{}, /Nada para alterar/],
      [{ name: "a" }, /Informe o nome/],
      [{ logo: "data:image/svg+xml;base64,PHN2Zy8+" }, /PNG, JPEG ou WebP/],
      [{ logo: `data:image/png;base64,${"A".repeat(TAMANHO_MAXIMO_DO_SIMBOLO)}` }, /muito grande/],
    ] as const) {
      const res = await alterar(corpo);
      expect(res.status, JSON.stringify(corpo).slice(0, 40)).toBe(400);
      expect((await res.json()).error).toMatch(mensagem);
    }
    expect(await gravada(EMPRESA_PADRAO.id)).toEqual({ name: EMPRESA_PADRAO.name, logo: null });
  });

  it("isolamento: a alteração fica na empresa da sessão, mesmo com id ou slug de outra no corpo", async () => {
    entrarComo("ADMIN");
    const res = await alterar({ name: "Só a minha", id: EMPRESA_OUTRA.id, slug: EMPRESA_OUTRA.slug, active: false });
    expect(res.status).toBe(200);

    expect(await gravada(EMPRESA_PADRAO.id)).toEqual({ name: "Só a minha", logo: null });
    expect(await gravada(EMPRESA_OUTRA.id)).toEqual({ name: EMPRESA_OUTRA.name, logo: null });
    const padrao = await banco.sistema.tenant.findUniqueOrThrow({ where: { id: EMPRESA_PADRAO.id } });
    expect(padrao.slug).toBe(EMPRESA_PADRAO.slug);
    expect(padrao.active).toBe(true);
  });
});
