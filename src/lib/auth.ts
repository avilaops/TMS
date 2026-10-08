import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { randomBytes } from "node:crypto";
import { sistema } from "@/lib/prisma";
import { normalizarSlug } from "@/lib/empresas";
import { sessaoDoLoginUnico } from "@/lib/sso";
import bcrypt from "bcryptjs";

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

/**
 * Equipe da Ávila Ops (papel ADMIN no login único) entra em qualquer empresa
 * para dar suporte, mesmo sem cadastro nela: o cadastro de administrador é
 * criado na primeira entrada e fica visível na lista de usuários da empresa.
 *
 * Exige o segundo fator conferido no auth e a empresa informada. A senha
 * gravada é aleatória e ninguém a conhece: esse cadastro só entra pelo login
 * único. Quem não é da equipe e não tem cadastro não entra em lugar nenhum.
 */
async function entrarComoEquipe(conta: { email: string; nome: string; papel: string; mfa: boolean }, empresa?: string) {
  if (conta.papel !== "ADMIN") {
    throw new Error("Sua conta não tem cadastro em nenhuma empresa do TMS. Peça o acesso a quem administra a empresa.");
  }

  if (!conta.mfa) {
    throw new Error("Confirme a verificação em duas etapas em auth.avilaops.com e tente de novo.");
  }

  const slug = normalizarSlug(empresa);
  if (!slug) {
    throw new Error("Equipe Ávila Ops: informe a empresa para entrar.");
  }

  const tenant = await sistema.tenant.findUnique({ where: { slug }, select: { id: true, active: true } });
  if (!tenant?.active) {
    throw new Error("Empresa não encontrada.");
  }

  const password = await bcrypt.hash(randomBytes(32).toString("base64"), 12);

  const user = await sistema.user.create({
    data: { tenantId: tenant.id, email: conta.email, name: `${conta.nome} (Ávila Ops)`, role: "ADMIN", password },
  });

  console.info(`Login único: cadastro de suporte criado para ${conta.email} na empresa ${slug}.`);
  return user;
}

export const authOptions: NextAuthOptions = {
  session: {
    strategy: "jwt",
  },
  pages: {
    signIn: "/login",
  },
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email", placeholder: "seu@email.com" },
        password: { label: "Senha", type: "password" },
        // Slug da empresa. Só é preciso quando o mesmo e-mail e a mesma senha existem em mais de uma.
        empresa: { label: "Empresa", type: "text" }
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error("E-mail e senha são obrigatórios.");
        }

        // Mensagem única para não permitir descobrir quais e-mails existem.
        const invalid = new Error("E-mail ou senha inválidos.");

        const candidatos = await findUsersForLogin(credentials.email, credentials.empresa);

        // Confere a senha em todos, mesmo depois de achar: o tempo de resposta
        // não deve contar em quantas empresas o e-mail existe.
        const conferidos = await Promise.all(
          candidatos.map(async (candidato) => ((await bcrypt.compare(credentials.password, candidato.password)) ? candidato : null))
        );
        const validos = conferidos.filter((candidato) => candidato !== null);

        if (validos.length === 0) {
          throw invalid;
        }

        if (validos.length > 1) {
          throw new Error("Este acesso existe em mais de uma empresa. Informe a empresa para entrar.");
        }

        const user = validos[0];

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          clientId: user.clientId,
          tenantId: user.tenantId,
        };
      }
    }),
    // Login único da Ávila Ops: quem já entrou em auth.avilaops.com não digita
    // senha aqui. Ver src/lib/sso.ts.
    CredentialsProvider({
      id: "sso",
      name: "Ávila Ops",
      credentials: {
        empresa: { label: "Empresa", type: "text" }
      },
      async authorize(credentials, req) {
        const cabecalhos = (req?.headers ?? {}) as Record<string, string | string[] | undefined>;
        const cookie = Array.isArray(cabecalhos.cookie) ? cabecalhos.cookie.join("; ") : cabecalhos.cookie;

        const conta = await sessaoDoLoginUnico(cookie);
        if (!conta) {
          throw new Error("Não há sessão do login único com acesso ao TMS. Entre em auth.avilaops.com e tente de novo.");
        }

        const candidatos = await findUsersForLogin(conta.email, credentials?.empresa);

        if (candidatos.length > 1) {
          throw new Error("Este acesso existe em mais de uma empresa. Informe a empresa para entrar.");
        }

        let user = candidatos[0] ?? null;

        if (!user) {
          user = await entrarComoEquipe(conta, credentials?.empresa);
        }

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          clientId: user.clientId,
          tenantId: user.tenantId,
        };
      }
    })
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = user.role;
        token.id = user.id;
        token.clientId = user.clientId ?? null;
        token.tenantId = user.tenantId;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.role = token.role as string;
        session.user.id = token.id as string;
        session.user.clientId = (token.clientId as string | null) ?? null;
        // Sessão emitida antes do multi-tenant não tem empresa: fica sem acesso ao banco até entrar de novo.
        session.user.tenantId = (token.tenantId as string | undefined) ?? null;
      }
      return session;
    }
  }
};
