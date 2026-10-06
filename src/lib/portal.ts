import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

/**
 * Resolve a empresa do usuário logado no portal do cliente.
 *
 * Toda consulta do portal precisa passar por aqui e filtrar pelo `clientId`
 * devolvido — é o que impede um cliente de enxergar dados de outro. O `userId`
 * vai junto para quem precisa registrar quem fez (histórico de status).
 */
export async function requirePortalClient(): Promise<
  | { clientId: string; userId: string; error: null }
  | { clientId: null; userId: null; error: NextResponse }
> {
  const session = await getServerSession(authOptions);

  if (!session?.user || session.user.role !== "CLIENT") {
    return {
      clientId: null,
      userId: null,
      error: NextResponse.json({ error: "Não autorizado" }, { status: 401 }),
    };
  }

  if (!session.user.clientId) {
    return {
      clientId: null,
      userId: null,
      error: NextResponse.json(
        { error: "Usuário não está vinculado a uma empresa. Fale com a Mello." },
        { status: 403 }
      ),
    };
  }

  return { clientId: session.user.clientId, userId: session.user.id, error: null };
}
