import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Troca do código de autorização pelo access token (login pelo auth).
 *
 * Em 08/10/2026 nenhum login funcionava: a resposta do auth traz um `id_token`
 * e a biblioteca recusava a resposta inteira. Este teste segura a regra: o
 * `id_token` é descartado e só o access token segue.
 */
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

describe("trocarCodigoPorToken", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const authResponde = (status: number, corpo: unknown) => {
    const chamadas: { url: string; corpo: URLSearchParams }[] = [];
    vi.stubEnv("AVILAOPS_CLIENT_SECRET", "segredo-de-teste");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        chamadas.push({ url: String(url), corpo: new URLSearchParams(String(init?.body)) });
        return new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
      }),
    );
    return chamadas;
  };

  it("resposta com id_token é aceita, e só o access token segue adiante", async () => {
    const { trocarCodigoPorToken } = await import("../src/lib/auth");
    const chamadas = authResponde(200, { access_token: "acesso", token_type: "Bearer", expires_in: 28800, id_token: "a.b.c" });

    const tokens = await trocarCodigoPorToken("codigo", "https://tms.avilaops.com/api/auth/callback/avilaops", "verificador");
    expect(tokens).toEqual({ access_token: "acesso", token_type: "Bearer" });

    expect(chamadas[0].url).toBe("https://auth.avilaops.com/oauth/token");
    expect(Object.fromEntries(chamadas[0].corpo)).toEqual({
      grant_type: "authorization_code",
      code: "codigo",
      redirect_uri: "https://tms.avilaops.com/api/auth/callback/avilaops",
      client_id: "tms",
      client_secret: "segredo-de-teste",
      code_verifier: "verificador",
    });
  });

  it("recusa do auth, resposta sem access token ou falta de código viram erro, sem expor o segredo", async () => {
    const { trocarCodigoPorToken } = await import("../src/lib/auth");

    authResponde(400, { error: "invalid_grant", error_description: "Código inválido ou expirado." });
    await expect(trocarCodigoPorToken("codigo", "https://x/cb", "v")).rejects.toThrow(/400: invalid_grant/);

    authResponde(200, { token_type: "Bearer" });
    const semToken = trocarCodigoPorToken("codigo", "https://x/cb", "v");
    await expect(semToken).rejects.toThrow(/recusou a troca/);
    await expect(semToken).rejects.not.toThrow(/segredo-de-teste/);

    await expect(trocarCodigoPorToken(undefined, "https://x/cb", "v")).rejects.toThrow(/sem código/);
  });
});
