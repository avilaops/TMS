import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma, { SemEmpresaError } from "@/lib/prisma";

export type StaffRole = "ADMIN" | "OPERATION";

export type StaffUser = {
  id: string;
  name: string;
  email: string;
  role: StaffRole;
};

/**
 * Confere o perfil do usuário logado nas rotas internas de /api.
 *
 * `src/proxy.ts` só separa as páginas; quem chama a API direto cai aqui. Toda
 * rota interna precisa passar por este helper antes de tocar no banco — é o
 * que impede um CLIENT ou DRIVER autenticado de ler clientes, financeiro etc.
 *
 * O perfil vem do banco, não do token: o JWT guarda o perfil do momento do
 * login, e um usuário rebaixado continuaria entrando até a sessão expirar.
 *
 * Sem sessão → 401. Sessão com perfil fora de `roles` → 403.
 */
export async function requireStaff(
  roles: readonly StaffRole[] = ["ADMIN", "OPERATION"]
): Promise<{ user: StaffUser; error: null } | { user: null; error: NextResponse }> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return {
      user: null,
      error: NextResponse.json({ error: "Não autorizado" }, { status: 401 }),
    };
  }

  // A busca roda na empresa da sessão: usuário de outra empresa não aparece,
  // e sessão sem empresa (anterior ao multi-tenant) não chega ao banco.
  const user = await prisma.user
    .findUnique({
      where: { id: session.user.id },
      select: { id: true, name: true, email: true, role: true },
    })
    .catch((error: unknown) => {
      if (error instanceof SemEmpresaError) return null;
      throw error;
    });

  // Sessão de um usuário que não existe mais: trata como não autenticado.
  if (!user) {
    return {
      user: null,
      error: NextResponse.json({ error: "Não autorizado" }, { status: 401 }),
    };
  }

  if (!(roles as readonly string[]).includes(user.role)) {
    return {
      user: null,
      error: NextResponse.json({ error: "Acesso negado" }, { status: 403 }),
    };
  }

  return { user: { ...user, role: user.role as StaffRole }, error: null };
}
