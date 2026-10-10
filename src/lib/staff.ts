import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma, { SemEmpresaError } from "@/lib/prisma";
import { pode, type Capacidade, type PerfilInterno } from "@/lib/permissoes";

export type StaffRole = PerfilInterno;

export type StaffUser = {
  id: string;
  name: string;
  email: string;
  role: StaffRole;
};

/** O que a rota exige: uma capacidade da matriz (o normal) ou, na forma antiga, uma lista de perfis. */
export type RegraDeAcesso = readonly StaffRole[] | { pode: Capacidade };

/**
 * Confere o perfil do usuário logado nas rotas internas de /api.
 *
 * `src/proxy.ts` só separa as páginas; quem chama a API direto cai aqui. Toda
 * rota interna precisa passar por este helper antes de tocar no banco — é o
 * que impede um CLIENT ou DRIVER autenticado de ler clientes, financeiro etc.
 *
 * A rota diz a capacidade que exige (`requireStaff({ pode: "financeiro" })`) e
 * a matriz de `src/lib/permissoes.ts` diz quais perfis a têm. A lista de perfis
 * (`requireStaff(["ADMIN"])`) e a chamada sem argumento (ADMIN e OPERATION)
 * continuam valendo, mas nenhuma rota deve usá-las: `tests/perfis.test.ts`
 * recusa rota sem capacidade.
 *
 * O perfil vem do banco, não do token: o JWT guarda o perfil do momento do
 * login, e um usuário rebaixado continuaria entrando até a sessão expirar.
 *
 * Sem sessão → 401. Sessão com perfil que não atende à regra → 403.
 */
export async function requireStaff(
  regra: RegraDeAcesso = ["ADMIN", "OPERATION"]
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

  const liberado = "pode" in regra ? pode(user.role, regra.pode) : (regra as readonly string[]).includes(user.role);

  if (!liberado) {
    return {
      user: null,
      error: NextResponse.json({ error: "Acesso negado" }, { status: 403 }),
    };
  }

  return { user: { ...user, role: user.role as StaffRole }, error: null };
}
