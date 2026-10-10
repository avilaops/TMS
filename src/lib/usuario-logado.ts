import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma, { SemEmpresaError } from "@/lib/prisma";

/**
 * Qualquer usuário logado da empresa, de qualquer perfil (equipe, motorista ou
 * cliente): é a guarda das rotas que são da própria pessoa, como as do sininho
 * (/api/notificacoes). A rota precisa filtrar tudo pelo `userId` devolvido.
 *
 * O usuário é conferido no banco, na empresa da sessão, como em
 * `requireStaff()`: quem foi apagado não segue com a sessão antiga, e sessão
 * sem empresa não chega ao banco.
 */
export async function requireUsuario(): Promise<{ userId: string; error: null } | { userId: null; error: NextResponse }> {
  const session = await getServerSession(authOptions);
  const usuario = session?.user?.id
    ? await prisma.user.findUnique({ where: { id: session.user.id }, select: { id: true } }).catch((erro: unknown) => {
        if (erro instanceof SemEmpresaError) return null;
        throw erro;
      })
    : null;

  if (!usuario) return { userId: null, error: NextResponse.json({ error: "Não autorizado" }, { status: 401 }) };
  return { userId: usuario.id, error: null };
}
