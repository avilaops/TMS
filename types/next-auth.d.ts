import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: string;
      clientId: string | null;
      /** Empresa (tenant) em que a pessoa entrou. Nulo só em sessão anterior ao multi-tenant. */
      tenantId: string | null;
    } & DefaultSession["user"]
  }

  interface User {
    role: string;
    clientId?: string | null;
    tenantId: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: string;
    clientId: string | null;
    tenantId?: string;
  }
}
