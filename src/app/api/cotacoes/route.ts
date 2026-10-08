import { NextResponse } from "next/server";
import { registrarCotacao } from "@/lib/cotacao";

// Pedido de cotação do site. Mesma regra de `/api/leads` (src/lib/cotacao.ts).
export async function POST(req: Request) {
  try {
    const resultado = await registrarCotacao(await req.json().catch(() => null));
    if (!resultado.ok) {
      return NextResponse.json({ error: resultado.erro }, { status: resultado.status });
    }
    return NextResponse.json(resultado.lead, { status: 201 });
  } catch (error) {
    console.error("Erro ao criar cotação:", error);
    return NextResponse.json({ error: "Erro interno ao solicitar cotação." }, { status: 500 });
  }
}
