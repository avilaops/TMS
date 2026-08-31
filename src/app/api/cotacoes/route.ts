import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function POST(req: Request) {
  try {
    const data = await req.json();

    const {
      companyName,
      email,
      phone,
      origin,
      destination,
      volumes,
      weight,
    } = data;

    if (!companyName || !email || !origin || !destination || !volumes || !weight) {
      return NextResponse.json({ error: "Preencha todos os campos obrigatórios." }, { status: 400 });
    }

    const lead = await prisma.quoteLead.create({
      data: {
        companyName,
        email,
        phone: phone || "",
        origin,
        destination,
        volumes: Number(volumes),
        weight: Number(weight),
        status: "NEW",
      },
    });

    return NextResponse.json(lead, { status: 201 });
  } catch (error) {
    console.error("Erro ao criar cotação:", error);
    return NextResponse.json({ error: "Erro interno ao solicitar cotação." }, { status: 500 });
  }
}
