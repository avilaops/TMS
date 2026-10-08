import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { sistema } from "@/lib/prisma";
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
