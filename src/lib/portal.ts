import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

/**
 * Resolve a empresa do usuário logado no portal do cliente.
 *
 * Toda consulta do portal precisa passar por aqui e filtrar pelo `clientId`
 * devolvido — é o que impede um cliente de enxergar dados de outro. O `userId`
 * vai junto para quem precisa registrar quem fez (histórico de status).
 *
 * Perfil e empresa vêm do banco, não do token, como em `requireStaff()`: quem
 * foi apagado, mudou de perfil ou de empresa não segue com o acesso antigo.
 */
export async function requirePortalClient(): Promise<
  | { clientId: string; userId: string; error: null }
  | { clientId: null; userId: null; error: NextResponse }
> {
  const session = await getServerSession(authOptions);

  const naoAutorizado = {
    clientId: null,
    userId: null,
    error: NextResponse.json({ error: "Não autorizado" }, { status: 401 }),
  };

  if (!session?.user?.id) return naoAutorizado;

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, role: true, clientId: true },
  });

  // Sessão de um usuário que não existe mais: trata como não autenticado.
  if (!user || user.role !== "CLIENT") return naoAutorizado;

  if (!user.clientId) {
    return {
      clientId: null,
      userId: null,
      error: NextResponse.json(
        { error: "Usuário não está vinculado a uma empresa. Fale com a Mello." },
        { status: 403 }
      ),
    };
  }

  return { clientId: user.clientId, userId: user.id, error: null };
}
