import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import prisma from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { Adapter } from "next-auth/adapters";

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
export async function findUserForLogin(email: string) {
  const typed = email.trim();
  if (!typed) return null;

  const matches = await prisma.$queryRaw<{ id: string; email: string }[]>`
    SELECT id, email FROM "User" WHERE lower(email) = lower(${typed})
  `;

  const match = matches.length === 1 ? matches[0] : matches.find((row) => row.email === typed);
  if (!match) return null;

  return prisma.user.findUnique({ where: { id: match.id } });
}

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma) as Adapter,
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
        password: { label: "Senha", type: "password" }
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error("E-mail e senha são obrigatórios.");
        }

        const user = await findUserForLogin(credentials.email);

        // Mensagem única para não permitir descobrir quais e-mails existem.
        const invalid = new Error("E-mail ou senha inválidos.");

        if (!user) {
          throw invalid;
        }

        const isValid = await bcrypt.compare(credentials.password, user.password);

        if (!isValid) {
          throw invalid;
        }

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          clientId: user.clientId,
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
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.role = token.role as string;
        session.user.id = token.id as string;
        session.user.clientId = (token.clientId as string | null) ?? null;
      }
      return session;
    }
  }
};
