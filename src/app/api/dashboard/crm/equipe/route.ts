import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireStaff } from "@/lib/staff";
import { DA_EQUIPE_COMERCIAL, EQUIPE_SELECT } from "@/lib/crm-db";

/**
 * Quem pode ser responsável por uma cotação: os usuários da empresa com a
 * capacidade `crm`, por nome. A lista vem daqui porque `/api/usuarios` é só
 * do administrador, e o comercial também atribui.
 */
export async function GET() {
  const { error } = await requireStaff({ pode: "crm" });
  if (error) return error;

  try {
    const equipe = await prisma.user.findMany({ where: DA_EQUIPE_COMERCIAL, orderBy: { name: "asc" }, select: EQUIPE_SELECT });
    return NextResponse.json(equipe);
  } catch (err) {
    console.error("Erro ao listar a equipe comercial:", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
