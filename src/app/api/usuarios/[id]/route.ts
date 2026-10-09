import { NextResponse } from "next/server";
import { transacao } from "@/lib/prisma";
import { requireStaff } from "@/lib/staff";
import {
  DRIVER_ROLE_MESSAGE,
  USER_PUBLIC_SELECT,
  firstIssue,
  updateUserSchema,
} from "@/lib/usuarios";

class Refusal extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user: admin, error } = await requireStaff(["ADMIN"]);
  if (error) return error;

  try {
    const { id } = await params;

    const parsed = updateUserSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const data = parsed.data;

    const usuario = await transacao(async (tx) => {
      // Trava as linhas de ADMIN: sem isto, dois administradores rebaixando um
      // ao outro ao mesmo tempo passariam os dois pela contagem abaixo.
      if (data.role !== undefined) {
        await tx.$queryRaw`SELECT id FROM "User" WHERE role = 'ADMIN' FOR UPDATE`;
      }

      // `requireStaff` conferiu o perfil antes da transação. Quem ficou parado
      // na trava acima pode ter sido rebaixado nesse meio-tempo: aqui a
      // conferência vale de novo, já com as linhas de ADMIN seguras.
      const autor = await tx.user.findUnique({ where: { id: admin.id }, select: { role: true } });
      if (autor?.role !== "ADMIN") throw new Refusal("Acesso negado", 403);

      const target = await tx.user.findUnique({
        where: { id },
        select: { id: true, role: true, clientId: true },
      });
      if (!target) throw new Refusal("Usuário não encontrado.", 404);

      const roleChange = data.role !== undefined && data.role !== target.role ? data.role : undefined;
      let clientId: string | null | undefined;

      if (roleChange) {
        // Perfil DRIVER anda junto do registro Driver: entra e sai pelo cadastro de motoristas.
        if (roleChange === "DRIVER" || target.role === "DRIVER") {
          throw new Refusal(DRIVER_ROLE_MESSAGE, 400);
        }

        if (target.role === "ADMIN") {
          if (target.id === admin.id) {
            throw new Refusal("Você não pode tirar o seu próprio perfil de administrador.", 409);
          }
          const outrosAdmins = await tx.user.count({
            where: { role: "ADMIN", id: { not: target.id } },
          });
          if (outrosAdmins === 0) {
            throw new Refusal("Não é possível rebaixar o último administrador.", 409);
          }
        }

        if (roleChange === "CLIENT") {
          const wanted = data.clientId ?? target.clientId;
          const client = wanted
            ? await tx.client.findUnique({ where: { id: wanted }, select: { id: true } })
            : null;
          if (!client) {
            throw new Refusal("Usuário de cliente precisa estar vinculado a uma empresa cadastrada.", 400);
          }
          clientId = client.id;
        } else {
          clientId = null;
        }
      }

      return tx.user.update({
        where: { id },
        data: {
          ...(data.name !== undefined && { name: data.name }),
          ...(roleChange && { role: roleChange }),
          ...(clientId !== undefined && { clientId }),
        },
        select: USER_PUBLIC_SELECT,
      });
    });

    return NextResponse.json(usuario);
  } catch (err) {
    if (err instanceof Refusal) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("Erro ao atualizar usuário:", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
