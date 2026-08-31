import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

// Cada área do sistema só aceita os perfis listados aqui.
// Perfis são estritos de propósito: um ADMIN não tem registro de Driver nem
// empresa vinculada, então entrar em /driver ou /portal só quebraria as telas.
const AREA_ROLES: Record<string, string[]> = {
  "/dashboard": ["ADMIN", "OPERATION"],
  "/driver": ["DRIVER"],
  "/portal": ["CLIENT"],
};

// Para onde mandar um usuário autenticado que bateu na área errada.
const HOME_BY_ROLE: Record<string, string> = {
  ADMIN: "/dashboard",
  OPERATION: "/dashboard",
  DRIVER: "/driver",
  CLIENT: "/portal",
};

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const area = Object.keys(AREA_ROLES).find(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );

  if (!area) return NextResponse.next();

  const token = await getToken({ req: request });

  if (!token) {
    const login = new URL("/login", request.url);
    login.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(login);
  }

  const role = typeof token.role === "string" ? token.role : "";

  if (AREA_ROLES[area].includes(role)) {
    return NextResponse.next();
  }

  // Autenticado, mas sem permissão nesta área: devolve para a área dele.
  return NextResponse.redirect(new URL(HOME_BY_ROLE[role] ?? "/login", request.url));
}

export const config = {
  matcher: ["/dashboard/:path*", "/driver/:path*", "/portal/:path*"],
};
