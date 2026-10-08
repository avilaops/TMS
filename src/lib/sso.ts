/**
 * Login único da Ávila Ops (auth.avilaops.com).
 *
 * Quem entrou lá chega aqui com o cookie `avila_sso`, que vale em todo
 * `*.avilaops.com`. O TMS não guarda o segredo que assina esse cookie: no
 * momento do login ele pergunta ao próprio auth quem é a pessoa e se ela pode
 * entrar neste sistema (`GET /api/session?app=tms`, a mesma regra da tela de
 * login de lá). Ter o cookie não basta: ele também existe para quem só tem
 * acesso a outro sistema.
 *
 * Depois disso a sessão é a do TMS (NextAuth), com a empresa dentro. O auth só
 * é consultado de novo no próximo login.
 */

const COOKIE = "avila_sso";

export type SessaoLoginUnico = {
  email: string;
  nome: string;
  /** `ADMIN` é a equipe da Ávila Ops; `CLIENTE`, todo o resto. */
  papel: string;
  /** Segundo fator conferido nesta sessão do auth. */
  mfa: boolean;
};

export function baseDoLoginUnico(): string {
  return (process.env.SSO_BASE_URL || "https://auth.avilaops.com").replace(/\/+$/, "");
}

export function appNoLoginUnico(): string {
  return process.env.SSO_APP_ID || "tms";
}

function cookieDoLoginUnico(cabecalho: string | null | undefined): string | null {
  if (!cabecalho) return null;
  for (const parte of cabecalho.split(";")) {
    const [nome, ...resto] = parte.trim().split("=");
    if (nome === COOKIE) return resto.join("=") || null;
  }
  return null;
}

/**
 * Sessão do login único de quem fez a requisição, ou null se não há sessão, se
 * ela não vale ou se a conta não foi liberada para o TMS. Falha de rede também
 * devolve null: sem resposta do auth ninguém entra por este caminho.
 */
export async function sessaoDoLoginUnico(cabecalhoCookie: string | null | undefined): Promise<SessaoLoginUnico | null> {
  const token = cookieDoLoginUnico(cabecalhoCookie);
  if (!token) return null;

  try {
    const url = `${baseDoLoginUnico()}/api/session?app=${encodeURIComponent(appNoLoginUnico())}`;
    const res = await fetch(url, {
      headers: { cookie: `${COOKIE}=${token}`, accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;

    const corpo = (await res.json()) as {
      autenticado?: boolean;
      permitido?: boolean;
      sessao?: { email?: unknown; nome?: unknown; papel?: unknown; mfa?: unknown };
    };

    if (!corpo.autenticado || corpo.permitido !== true || !corpo.sessao) return null;

    const { email, nome, papel, mfa } = corpo.sessao;
    if (typeof email !== "string" || !email.trim() || typeof papel !== "string") return null;

    return {
      email: email.trim().toLowerCase(),
      nome: typeof nome === "string" && nome.trim() ? nome.trim() : email,
      papel,
      mfa: mfa === true,
    };
  } catch (error) {
    console.error("Login único: sem resposta do auth:", error);
    return null;
  }
}
