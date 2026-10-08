import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireStaff } from "@/lib/staff";
import { liberarAcesso } from "@/lib/acessos";

/**
 * Libera (de novo) o acesso da pessoa no login único. Serve para quem foi
 * cadastrado quando o auth estava fora do ar e para quem perdeu a liberação.
 * Pode ser repetido à vontade: conta que já existe não recebe convite novo.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireStaff(["ADMIN"]);
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
  });

  return NextResponse.json({ acesso }, { status: acesso.ok ? 200 : 502 });
}
