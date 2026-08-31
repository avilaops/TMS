import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || (session.user.role !== "ADMIN" && session.user.role !== "OPERATION")) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const leads = await prisma.quoteLead.findMany({
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(leads);
  } catch (error) {
    console.error("Erro ao listar cotações:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
