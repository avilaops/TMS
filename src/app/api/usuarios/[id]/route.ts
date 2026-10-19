import { NextResponse } from "next/server";
import prisma, { transacao } from "@/lib/prisma";
import { requireStaff } from "@/lib/staff";
import { dadosDoConvite, liberarAcesso, revogarAcesso } from "@/lib/acessos";
import { pode } from "@/lib/permissoes";
import {
  DRIVER_ROLE_MESSAGE,
  USER_PUBLIC_SELECT,
  firstIssue,
  updateUserSchema,
} from "@/lib/usuarios";
import { escolher, nadaMudou, origemDaRequisicao, registrarAuditoria } from "@/lib/auditoria";

// O que entra no "antes" e no "depois" da auditoria.
const CAMPOS_AUDITADOS = ["name", "email", "role", "clientId"] as const;

class Refusal extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user: admin, error } = await requireStaff({ pode: "usuarios" });
  if (error) return error;

  try {
    const { id } = await params;

    const parsed = updateUserSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const data = parsed.data;
    const origem = origemDaRequisicao(req);

    let emailAnterior: string | null = null;
    const usuario = await transacao(async (tx) => {
      // Trava as linhas de ADMIN: sem isto, dois administradores rebaixando um
      // ao outro ao mesmo tempo passariam os dois pela contagem abaixo.
      //
      // Vale também para a troca só de nome. Sem a trava, a releitura do autor
      // logo abaixo seria um retrato solto: um administrador rebaixado entre
      // ela e o `update` ainda trocaria um nome. É a mesma consulta nos dois
      // casos, e não só a linha do autor, para que toda alteração de usuário
      // pegue as travas na mesma ordem (ADMIN primeiro, alvo depois) e uma não
      // fique esperando a outra em círculo.
      await tx.$queryRaw`SELECT id FROM "User" WHERE role = 'ADMIN' FOR UPDATE`;

      // `requireStaff` conferiu o perfil antes da transação. Quem ficou parado
      // na trava acima pode ter sido rebaixado nesse meio-tempo: aqui a
      // conferência vale de novo, já com as linhas de ADMIN seguras.
      const autor = await tx.user.findUnique({ where: { id: admin.id }, select: { role: true } });
      if (!pode(autor?.role, "usuarios")) throw new Refusal("Acesso negado", 403);

      const target = await tx.user.findUnique({
        where: { id },
        select: { id: true, name: true, email: true, role: true, clientId: true },
      });
      if (!target) throw new Refusal("Usuário não encontrado.", 404);

      if (data.email && data.email !== target.email.toLowerCase()) {
        if (target.role === "DRIVER") throw new Refusal(DRIVER_ROLE_MESSAGE, 400);
        const duplicado = await tx.user.findFirst({ where: { email: { equals: data.email, mode: "insensitive" }, id: { not: id } }, select: { id: true } });
        if (duplicado) throw new Refusal("Já existe um usuário com este e-mail.", 409);
      }

      if (data.email && data.email !== target.email) emailAnterior = target.email;

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

      const atualizado = await tx.user.update({
        where: { id },
        data: {
          ...(data.name !== undefined && { name: data.name }),
          ...(data.email !== undefined && { email: data.email }),
          ...(roleChange && { role: roleChange }),
          ...(clientId !== undefined && { clientId }),
        },
        select: USER_PUBLIC_SELECT,
      });

      // Na mesma transação da troca: perfil que mudou sem linha na auditoria não existe.
      const antes = escolher(target, CAMPOS_AUDITADOS);
      const depois = escolher(atualizado, CAMPOS_AUDITADOS);
      if (!nadaMudou(antes, depois)) {
        await registrarAuditoria(tx, {
          ator: admin,
          origem,
          acao: roleChange ? "usuario.perfil" : "usuario.alterar",
          entidade: "usuario",
          entidadeId: id,
          resumo: roleChange
            ? `Perfil de ${atualizado.name} trocado de ${target.role} para ${roleChange}`
            : `Usuário ${atualizado.name} alterado`,
          antes,
          depois,
        });
      }

      return atualizado;
    });

    if (emailAnterior) {
      const antigoRevogado = await revogarAcesso(emailAnterior);
      const acesso = await liberarAcesso({ email: usuario.email, nome: usuario.name }, { convidadoPor: admin.name });
      const convite = dadosDoConvite(acesso);
      const salvo = await prisma.user.update({ where: { id: usuario.id }, data: convite, select: USER_PUBLIC_SELECT });
      return NextResponse.json({ ...salvo, acesso, aviso: antigoRevogado ? null : "O e-mail anterior não pôde ser revogado no login único. Verifique o Auth." });
    }
    return NextResponse.json(usuario);
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") return NextResponse.json({ error: "Já existe um usuário com este e-mail." }, { status: 409 });
    if (err instanceof Refusal) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("Erro ao atualizar usuário:", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

/** Exclui apenas cadastros sem vínculos operacionais; preserva trilha de auditoria. */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user: admin, error } = await requireStaff({ pode: "usuarios" });
  if (error) return error;
  try {
    const { id } = await params;
    const origem = origemDaRequisicao(req);
    const removido = await transacao(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE role = 'ADMIN' FOR UPDATE`;
      const autor = await tx.user.findUnique({ where: { id: admin.id }, select: { role: true } });
      if (!pode(autor?.role, "usuarios")) throw new Refusal("Acesso negado.", 403);
      const alvo = await tx.user.findUnique({ where: { id }, select: USER_PUBLIC_SELECT });
      if (!alvo) throw new Refusal("Usuário não encontrado.", 404);
      if (alvo.id === admin.id) throw new Refusal("Você não pode excluir seu próprio usuário.", 409);
      if (alvo.role === "DRIVER") throw new Refusal("Exclua ou desative motoristas em Motoristas.", 409);
      if (alvo.role === "ADMIN" && await tx.user.count({ where: { role: "ADMIN" } }) <= 1)
        throw new Refusal("Não é possível excluir o último administrador.", 409);
      // Chaves estrangeiras impedem perda de atividades, ocorrências e histórico.
      await tx.user.delete({ where: { id } });
      await registrarAuditoria(tx, {
        ator: admin, origem, acao: "usuario.excluir", entidade: "usuario",
        entidadeId: id, resumo: `Usuário ${alvo.name} excluído`,
        antes: escolher(alvo, ["name", "email", "role", "clientId"]),
      });
      return alvo;
    });
    const revogado = await revogarAcesso(removido.email);
    return NextResponse.json({ ok: true, aviso: revogado ? null : "Cadastro removido do TMS, mas não foi possível revogar o acesso no Auth. Revogue manualmente." });
  } catch (err) {
    if (err instanceof Refusal) return NextResponse.json({ error: err.message }, { status: err.status });
    if ((err as { code?: string }).code === "P2003" || (err as { code?: string }).code === "P2014") {
      return NextResponse.json({ error: "Usuário possui registros vinculados e não pode ser excluído sem perder o histórico. Mantenha o cadastro e altere seus dados." }, { status: 409 });
    }
    console.error("Erro ao excluir usuário:", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
