import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireStaff } from "@/lib/staff";
import { dadosDoConvite, liberarAcesso } from "@/lib/acessos";
import { USER_PUBLIC_SELECT } from "@/lib/usuarios";

/**
 * Libera (de novo) o acesso da pessoa no login único. Serve para quem foi
 * cadastrado quando o auth estava fora do ar e para quem perdeu a liberação.
 * É também o "enviar convite de novo": o login único escreve outra vez para a
 * pessoa, com o endereço de criar a senha enquanto ela não tiver criado uma (o
 * login único limita a cinco mensagens por hora para a mesma caixa).
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireStaff(["ADMIN"]);
  if (error) return error;

  const { id } = await params;
  const usuario = await prisma.user.findUnique({
    where: { id },
    select: { name: true, email: true, driver: { select: { cpf: true, phone: true } } },
  });
  if (!usuario) return NextResponse.json({ error: "Usuário não encontrado." }, { status: 404 });

  const acesso = await liberarAcesso({
    email: usuario.email,
    nome: usuario.name,
    cpf: usuario.driver?.cpf,
    telefone: usuario.driver?.phone,
  }, { convidadoPor: user.name });

  const usuarioAtualizado = await prisma.user.update({ where: { id }, data: dadosDoConvite(acesso), select: USER_PUBLIC_SELECT });

  return NextResponse.json({ acesso, usuario: usuarioAtualizado }, { status: acesso.ok ? 200 : 502 });
}
