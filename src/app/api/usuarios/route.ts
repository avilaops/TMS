import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireStaff } from "@/lib/staff";
import {
  DRIVER_ROLE_MESSAGE,
  USER_PUBLIC_SELECT,
  createUserSchema,
  firstIssue,
} from "@/lib/usuarios";
import { dadosDoConvite, liberarAcesso, senhaSemUso } from "@/lib/acessos";

export async function GET() {
  const { error } = await requireStaff(["ADMIN"]);
  if (error) return error;

  try {
    const usuarios = await prisma.user.findMany({
      select: USER_PUBLIC_SELECT,
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(usuarios);
  } catch (err) {
    console.error("Erro ao listar usuários:", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const { user, error } = await requireStaff(["ADMIN"]);
  if (error) return error;

  try {
    const parsed = createUserSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const data = parsed.data;

    if (data.role === "DRIVER") {
      return NextResponse.json({ error: DRIVER_ROLE_MESSAGE }, { status: 400 });
    }

    let clientId: string | null = null;
    if (data.role === "CLIENT") {
      const client = data.clientId
        ? await prisma.client.findUnique({ where: { id: data.clientId }, select: { id: true } })
        : null;
      if (!client) {
        return NextResponse.json(
          { error: "Usuário de cliente precisa estar vinculado a uma empresa cadastrada." },
          { status: 400 }
        );
      }
      clientId = client.id;
    }

    // E-mails antigos podem ter maiúsculas; a comparação ignora a caixa.
    const existing = await prisma.user.findFirst({
      where: { email: { equals: data.email, mode: "insensitive" } },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json({ error: "Já existe um usuário com este e-mail." }, { status: 409 });
    }

    try {
      const usuario = await prisma.user.create({
        data: {
          name: data.name,
          email: data.email,
          role: data.role,
          clientId,
          password: senhaSemUso(),
        },
        select: USER_PUBLIC_SELECT,
      });

      // O cadastro só vale para quem tem conta liberada no login único.
      const acesso = await liberarAcesso({ email: usuario.email, nome: usuario.name }, { convidadoPor: user.name });
      // O resultado do convite fica no cadastro, para a lista mostrar depois.
      const salvo = await prisma.user.update({ where: { id: usuario.id }, data: dadosDoConvite(acesso), select: USER_PUBLIC_SELECT });
      return NextResponse.json({ ...salvo, acesso }, { status: 201 });
    } catch (err) {
      // Duas criações simultâneas com o mesmo e-mail: a segunda bate no índice único.
      if ((err as { code?: string }).code === "P2002") {
        return NextResponse.json({ error: "Já existe um usuário com este e-mail." }, { status: 409 });
      }
      throw err;
    }
  } catch (err) {
    console.error("Erro ao criar usuário:", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
