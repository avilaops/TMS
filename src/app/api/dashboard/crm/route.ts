import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireStaff } from "@/lib/staff";
import { LEAD_INCLUDE } from "@/lib/crm";

export async function GET() {
  try {
    const { error } = await requireStaff({ pode: "crm" });
    if (error) return error;

    const leads = await prisma.quoteLead.findMany({
      include: LEAD_INCLUDE,
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(leads);
  } catch (error) {
    console.error("Erro ao listar cotações:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
