import { NextAuthOptions } from "next-auth";
import { sistema } from "@/lib/prisma";
import { normalizarSlug } from "@/lib/empresas";
import { senhaSemUso } from "@/lib/acessos";

/**
 * Acha o usuário pelo e-mail digitado no login, sem diferenciar maiúsculas nem
 * espaço nas pontas.
 *
 * O cadastro grava em minúsculas (`createUserSchema`), mas há usuário antigo
 * gravado com maiúscula: por isso a comparação é `lower() = lower()` e não uma
 * busca exata pelo e-mail normalizado. Se dois cadastros antigos diferirem só
 * pela caixa, vale o que bate exatamente com o que foi digitado; sem esse
 * desempate, ninguém entra (melhor que entrar na conta errada).
 */
export async function findUserForLogin(email: string, empresa?: string) {
  const candidatos = await findUsersForLogin(email, empresa);
  return candidatos.length === 1 ? candidatos[0] : null;
}

/**
 * Todos os cadastros que o e-mail digitado pode ser, no máximo um por empresa.
 *
 * O e-mail é único dentro da empresa, não no sistema: a mesma pessoa pode ter
 * cadastro em duas transportadoras. `empresa` (o slug) restringe a busca a uma.
 * Roda pelo caminho de sistema porque ainda não há sessão nem empresa: é aqui
 * que ela é descoberta. Empresa desativada não entra.
 */
export async function findUsersForLogin(email: string, empresa?: string) {
  const typed = email.trim();
  if (!typed) return [];

  const slug = empresa?.trim().toLowerCase() || null;

  const matches = await sistema.$queryRaw<{ id: string; email: string; tenantId: string }[]>`
    SELECT u.id, u.email, u."tenantId"
      FROM "User" u
      JOIN "Tenant" t ON t.id = u."tenantId"
     WHERE lower(u.email) = lower(${typed})
       AND t.active
       AND (${slug}::text IS NULL OR t.slug = ${slug})
  `;

  const porEmpresa = new Map<string, typeof matches>();
  for (const row of matches) {
    porEmpresa.set(row.tenantId, [...(porEmpresa.get(row.tenantId) ?? []), row]);
  }

  const ids: string[] = [];
  for (const rows of porEmpresa.values()) {
    const match = rows.length === 1 ? rows[0] : rows.find((row) => row.email === typed);
    if (match) ids.push(match.id);
  }
  if (ids.length === 0) return [];

  return sistema.user.findMany({ where: { id: { in: ids } } });
}

/** Quem o login único (auth.avilaops.com) diz que a pessoa é. */
export type ContaAvilaOps = {
  email: string;
  nome: string;
  /** `ADMIN` é a equipe da Ávila Ops; `CLIENTE`, todo o resto. */
  papel: string;
};

/** A equipe da Ávila Ops opera a plataforma: vê e cria empresas e entra em qualquer uma. */
export function ehEquipe(conta: Pick<ContaAvilaOps, "papel"> | null | undefined): boolean {
  return conta?.papel === "ADMIN";
}

export type Entrada =
  | { situacao: "dentro"; user: { id: string; name: string; email: string; role: string; clientId: string | null; tenantId: string } }
  /** A conta existe em mais de uma empresa, ou é da equipe: falta escolher. */
  | { situacao: "escolher" }
  /** Não é da equipe e não tem cadastro em nenhuma empresa ativa. */
  | { situacao: "sem-cadastro" }
  /** A empresa pedida não existe, está desativada ou a conta não tem cadastro nela. */
  | { situacao: "recusada" };

/**
 * Decide em que empresa a conta do login único entra.
 *
 * Sem `empresa`: entra direto se só há um cadastro; a equipe e quem tem mais de
 * um vão escolher. Com `empresa` (o slug): entra no cadastro daquela empresa.
 *
 * A equipe da Ávila Ops entra em qualquer empresa para dar suporte, mesmo sem
 * cadastro: ele nasce na primeira entrada, como administrador "Nome (Ávila
 * Ops)", visível na lista de usuários da empresa. O segundo fator da equipe é
 * cobrado pelo auth antes de emitir o código de autorização.
 */
export async function resolverEntrada(conta: ContaAvilaOps, empresa?: string | null): Promise<Entrada> {
  const slug = empresa ? normalizarSlug(empresa) : null;
  if (empresa && !slug) return { situacao: "recusada" };

  const candidatos = await findUsersForLogin(conta.email, slug ?? undefined);

  if (!slug) {
    if (ehEquipe(conta)) {
      // A equipe sempre escolhe: mesmo com um cadastro só, ela pode querer outra empresa.
      return { situacao: "escolher" };
    }
    if (candidatos.length === 1) return { situacao: "dentro", user: candidatos[0] };
    return { situacao: candidatos.length > 1 ? "escolher" : "sem-cadastro" };
  }

  if (candidatos.length === 1) return { situacao: "dentro", user: candidatos[0] };
  if (!ehEquipe(conta)) return { situacao: "recusada" };

  const tenant = await sistema.tenant.findUnique({ where: { slug }, select: { id: true, active: true } });
  if (!tenant?.active) return { situacao: "recusada" };

  const user = await sistema.user.create({
    data: { tenantId: tenant.id, email: conta.email, name: `${conta.nome} (Ávila Ops)`, role: "ADMIN", password: senhaSemUso() },
  });

  console.info(`Login único: cadastro de suporte criado para ${conta.email} na empresa ${slug}.`);
  return { situacao: "dentro", user };
}

/** Empresas em que a conta pode entrar: todas as ativas para a equipe, as do próprio cadastro para os demais. */
export async function empresasDaConta(conta: ContaAvilaOps) {
  if (ehEquipe(conta)) {
    return sistema.tenant.findMany({
      where: { active: true },
      select: { slug: true, name: true },
      orderBy: { name: "asc" },
    });
  }

  const candidatos = await findUsersForLogin(conta.email);
  if (candidatos.length === 0) return [];

  return sistema.tenant.findMany({
    where: { id: { in: candidatos.map((c) => c.tenantId) }, active: true },
    select: { slug: true, name: true },
    orderBy: { name: "asc" },
  });
}

const EMISSOR = (process.env.AVILAOPS_ISSUER || "https://auth.avilaops.com").replace(/\/+$/, "");

/**
 * Troca o código de autorização pelo access token, direto no auth.
 *
 * Só o access token segue adiante: é com ele que o `/oauth/userinfo` diz quem é
 * a pessoa. O `id_token` que vem junto é descartado de propósito (ver o
 * comentário no provedor). Qualquer falha vira erro, e o login não acontece.
 */
export async function trocarCodigoPorToken(code: string | undefined, redirectUri: string, codeVerifier: string | undefined) {
  if (!code) throw new Error("Resposta do login único sem código de autorização.");

  const corpo = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: process.env.AVILAOPS_CLIENT_ID || "tms",
    client_secret: process.env.AVILAOPS_CLIENT_SECRET ?? "",
  });
  if (codeVerifier) corpo.set("code_verifier", codeVerifier);

  const res = await fetch(`${EMISSOR}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: corpo,
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });

  const dados = (await res.json().catch(() => ({}))) as { access_token?: unknown; token_type?: unknown; error?: unknown };
  if (!res.ok || typeof dados.access_token !== "string" || !dados.access_token) {
    throw new Error(`Login único recusou a troca do código (${res.status}${typeof dados.error === "string" ? `: ${dados.error}` : ""}).`);
  }

  return { access_token: dados.access_token, token_type: typeof dados.token_type === "string" ? dados.token_type : "Bearer" };
}

export const authOptions: NextAuthOptions = {
  session: {
    strategy: "jwt",
    // A mesma vida da sessão do auth: saiu da equipe ou perdeu o acesso lá,
    // perde aqui no máximo em 8 horas.
    maxAge: 8 * 60 * 60,
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  providers: [
    // A única porta de entrada é o login único da Ávila Ops, por OIDC
    // (authorization code + PKCE). O TMS não tem senha própria. O auth confere
    // se a conta foi liberada para o app `tms` e cobra o segundo fator antes de
    // emitir o código; aqui chega só quem passou.
    //
    // `idToken: false`: o id_token do auth é assinado com um segredo que não é
    // o deste cliente, então a identidade vem do /oauth/userinfo, numa conexão
    // direta autenticada pelo access token.
    {
      id: "avilaops",
      name: "Ávila Ops",
      type: "oauth",
      clientId: process.env.AVILAOPS_CLIENT_ID || "tms",
      clientSecret: process.env.AVILAOPS_CLIENT_SECRET,
      authorization: { url: `${EMISSOR}/oauth/authorize`, params: { scope: "openid profile email" } },
      token: {
        url: `${EMISSOR}/oauth/token`,
        // A troca do código é feita aqui, e não pela biblioteca: a resposta do
        // auth traz um `id_token`, e com `idToken: false` a biblioteca recusa
        // qualquer resposta que tenha um ("id_token detected in the response").
        // Foi o que impediu todo login em 08/10/2026.
        async request({ params, checks, provider }) {
          return { tokens: await trocarCodigoPorToken(params.code, provider.callbackUrl, checks.code_verifier) };
        },
      },
      userinfo: `${EMISSOR}/oauth/userinfo`,
      idToken: false,
      checks: ["pkce", "state"],
      client: { token_endpoint_auth_method: "client_secret_post" },
      profile(perfil: { sub: string; email: string; name?: string; papel?: string }) {
        return {
          id: perfil.sub,
          email: perfil.email,
          name: perfil.name ?? perfil.email,
          papel: perfil.papel ?? "CLIENTE",
        };
      },
    },
  ],
  callbacks: {
    async jwt({ token, user, account, trigger, session }) {
      const aplicar = (entrada: Entrada) => {
        if (entrada.situacao === "dentro") {
          token.id = entrada.user.id;
          token.name = entrada.user.name;
          token.role = entrada.user.role;
          token.clientId = entrada.user.clientId ?? null;
          token.tenantId = entrada.user.tenantId;
        }
        token.situacao = entrada.situacao;
      };

      // Acabou de voltar do auth: guarda quem é e tenta entrar numa empresa.
      if (account?.provider === "avilaops" && user?.email) {
        token.conta = {
          email: user.email.trim().toLowerCase(),
          nome: user.name ?? user.email,
          papel: (user as { papel?: string }).papel ?? "CLIENTE",
        };
        delete token.id;
        delete token.tenantId;
        token.role = "";
        token.clientId = null;
        aplicar(await resolverEntrada(token.conta));
      }

      // Escolha (ou troca) de empresa, pedida pela tela /empresa.
      if (trigger === "update" && token.conta && typeof session?.empresa === "string") {
        const entrada = await resolverEntrada(token.conta, session.empresa);
        if (entrada.situacao === "dentro") aplicar(entrada);
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.role = (token.role as string | undefined) ?? "";
        session.user.id = (token.id as string | undefined) ?? "";
        session.user.clientId = (token.clientId as string | null) ?? null;
        // Sem empresa (ainda não escolheu, ou não tem cadastro) não há acesso ao banco.
        session.user.tenantId = (token.tenantId as string | undefined) ?? null;
        session.user.equipe = ehEquipe(token.conta);
        session.user.situacao = token.situacao ?? (token.tenantId ? "dentro" : "sem-cadastro");
      }
      return session;
    }
  }
};
