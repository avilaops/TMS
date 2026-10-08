import { NextResponse } from "next/server";
import { paraEmpresa } from "@/lib/prisma";
import { empresaPublica } from "@/lib/empresas";

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

    // Rota pública: a empresa vem do corpo (`empresa`, o slug) ou do padrão do ambiente.
    const tenantId = await empresaPublica(data.empresa);
    if (!tenantId) {
      return NextResponse.json({ error: "Empresa não encontrada." }, { status: 404 });
    }

    const lead = await paraEmpresa(tenantId).db.quoteLead.create({
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
