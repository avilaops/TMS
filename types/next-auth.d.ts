import { DefaultSession } from "next-auth";

type Situacao = "dentro" | "escolher" | "sem-cadastro" | "recusada";

declare module "next-auth" {
  interface Session {
    user: {
      /** Cadastro da pessoa na empresa em que entrou. Vazio enquanto não há empresa. */
      id: string;
      role: string;
      clientId: string | null;
      /** Empresa (tenant) em que a pessoa entrou. Nulo enquanto não escolheu ou não tem cadastro. */
      tenantId: string | null;
      /** Equipe da Ávila Ops: opera a plataforma e entra em qualquer empresa. */
      equipe: boolean;
      situacao: Situacao;
    } & DefaultSession["user"]
  }

  interface User {
    papel?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: string;
    clientId?: string | null;
    tenantId?: string;
    /** Identidade vinda do login único. É dela que sai a escolha de empresa. */
    conta?: { email: string; nome: string; papel: string };
    situacao?: Situacao;
  }
}
