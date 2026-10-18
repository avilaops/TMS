import { NextResponse } from "next/server";
import { autenticarLojas, CredencialLojasInvalida } from "@/lib/lojas-logistica-auth";
import { consultarPedido, ContratoLojasInvalido } from "@/lib/lojas-logistica-db";

export async function GET(request: Request, contexto: { params: Promise<{ empresa: string; externalId: string }> }) {
  try {
    const { empresa, externalId } = await contexto.params;
    const { tenantId } = await autenticarLojas(request, empresa);
    return NextResponse.json(await consultarPedido(tenantId, externalId));
  } catch (erro) {
    if (erro instanceof CredencialLojasInvalida) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
    if (erro instanceof ContratoLojasInvalido) return NextResponse.json({ error: erro.message }, { status: erro.status });
    return NextResponse.json({ error: "Integração temporariamente indisponível." }, { status: 503 });
  }
}
