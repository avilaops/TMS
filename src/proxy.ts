import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { AREA_DO_PERFIL, PERFIS_INTERNOS } from "@/lib/permissoes";

// Cada área do sistema só aceita os perfis listados aqui.
// Perfis são estritos de propósito: um ADMIN não tem registro de Driver nem
// empresa vinculada, então entrar em /driver ou /portal só quebraria as telas.
// Em /dashboard entra a equipe interna inteira; o que cada perfil abre lá
// dentro é decidido pelo menu e, de verdade, pela API (src/lib/permissoes.ts).
const AREA_ROLES: Record<string, readonly string[]> = {
  "/dashboard": PERFIS_INTERNOS,
  "/driver": ["DRIVER"],
  "/portal": ["CLIENT"],
};

// Para onde mandar um usuário autenticado que bateu na área errada.
const HOME_BY_ROLE: Record<string, string> = AREA_DO_PERFIL;

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const dentroDe = (prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

  const token = await getToken({ req: request });

  const irPara = (destino: string) => NextResponse.redirect(new URL(destino, request.url));
  const login = () => {
    const url = new URL("/login", request.url);
    url.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(url);
  };

  // Sem identidade do login único não há o que mostrar em área nenhuma.
  if (!token?.conta) return login();

  // Escolha de empresa: basta ter entrado pelo login único.
  if (dentroDe("/empresa")) return NextResponse.next();

  // Plataforma (cadastro de empresas): só a equipe da Ávila Ops.
  if (dentroDe("/plataforma")) {
    return token.conta.papel === "ADMIN" ? NextResponse.next() : irPara("/");
  }

  // As áreas de uma empresa exigem ter entrado em uma.
  if (typeof token.tenantId !== "string") return irPara("/empresa");

  const area = Object.keys(AREA_ROLES).find(dentroDe);
  if (!area) return NextResponse.next();

  const role = typeof token.role === "string" ? token.role : "";

  if (AREA_ROLES[area].includes(role)) {
    return NextResponse.next();
  }

  // Autenticado, mas sem permissão nesta área: devolve para a área dele.
  return irPara(HOME_BY_ROLE[role] ?? "/empresa");
}

export const config = {
  matcher: ["/dashboard/:path*", "/driver/:path*", "/portal/:path*", "/empresa/:path*", "/plataforma/:path*"],
};
