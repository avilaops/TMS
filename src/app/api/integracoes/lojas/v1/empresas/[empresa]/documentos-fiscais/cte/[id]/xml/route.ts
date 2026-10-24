import { NextResponse } from "next/server";
import { Refusal } from "@/lib/cadastros";
import { empresaPorId } from "@/lib/cobranca-gateway-db";
import { nomeDoArquivoDoCte } from "@/lib/cte";
import { xmlDoCte } from "@/lib/cte-db";
import { autenticarLojas, CredencialLojasInvalida } from "@/lib/lojas-logistica-auth";

export async function GET(request: Request, contexto: { params: Promise<{ empresa: string; id: string }> }) {
  const { empresa, id } = await contexto.params;
  try {
    const { tenantId } = await autenticarLojas(request, empresa);
    const { chave, xml } = await xmlDoCte(empresaPorId(tenantId), id);
    return new Response(xml, { headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nomeDoArquivoDoCte(chave)}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    } });
  } catch (erro) {
    if (erro instanceof CredencialLojasInvalida) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
    if (erro instanceof Refusal) return NextResponse.json({ error: erro.message }, { status: erro.status });
    console.error("Integração fiscal Lojas/TMS (XML):", erro instanceof Error ? erro.message : erro);
    return NextResponse.json({ error: "Integração fiscal temporariamente indisponível." }, { status: 503 });
  }
}
