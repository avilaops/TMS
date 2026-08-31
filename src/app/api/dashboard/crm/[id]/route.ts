import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || (session.user.role !== "ADMIN" && session.user.role !== "OPERATION")) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const { id } = await params;
    const { status, estimatedValue } = await req.json();

    const updatedLead = await prisma.quoteLead.update({
      where: { id },
      data: {
        status,
        ...(estimatedValue !== undefined && { estimatedValue: Number(estimatedValue) }),
      },
    });

    return NextResponse.json(updatedLead);
  } catch (error) {
    console.error("Erro ao atualizar lead:", error);
    return NextResponse.json({ error: "Erro interno ao atualizar lead." }, { status: 500 });
  }
}
