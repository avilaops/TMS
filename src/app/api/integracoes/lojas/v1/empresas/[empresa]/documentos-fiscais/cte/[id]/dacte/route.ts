import { NextResponse } from "next/server";
import { Refusal } from "@/lib/cadastros";
import { empresaPorId } from "@/lib/cobranca-gateway-db";
import { dacteDoCte } from "@/lib/cte-db";
import { respostaDoDacte } from "@/lib/fiscal-mcp";
import { autenticarLojas, CredencialLojasInvalida } from "@/lib/lojas-logistica-auth";

export async function GET(request: Request, contexto: { params: Promise<{ empresa: string; id: string }> }) {
  const { empresa, id } = await contexto.params;
  try {
    const { tenantId } = await autenticarLojas(request, empresa);
    const { chave, xml, homologacao } = await dacteDoCte(empresaPorId(tenantId), id);
    return await respostaDoDacte(chave, xml, homologacao);
  } catch (erro) {
    if (erro instanceof CredencialLojasInvalida) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
    if (erro instanceof Refusal) return NextResponse.json({ error: erro.message }, { status: erro.status });
    console.error("Integração fiscal Lojas/TMS (DACTE):", erro instanceof Error ? erro.message : erro);
    return NextResponse.json({ error: "Integração fiscal temporariamente indisponível." }, { status: 503 });
  }
}
