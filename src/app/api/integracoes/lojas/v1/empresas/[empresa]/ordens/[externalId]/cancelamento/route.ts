import { NextResponse } from "next/server";
import { autenticarLojas, CredencialLojasInvalida } from "@/lib/lojas-logistica-auth";
import { armazenamentoPrisma, cancelarPedido, ConflitoDeIdempotencia, ContratoLojasInvalido, executarIdempotente } from "@/lib/lojas-logistica-db";

export async function POST(request: Request, contexto: { params: Promise<{ empresa: string; externalId: string }> }) {
  try {
    const { empresa, externalId } = await contexto.params;
    const autenticado = await autenticarLojas(request, empresa);
    const resultado = await executarIdempotente(armazenamentoPrisma(autenticado.tenantId, autenticado.credentialId), request.headers.get("idempotency-key") ?? "", { externalId, action: "cancel" }, async () => ({ status: 200, body: await cancelarPedido(autenticado.tenantId, externalId) }));
    return NextResponse.json(resultado.body, { status: resultado.status });
  } catch (erro) {
    if (erro instanceof CredencialLojasInvalida) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
    if (erro instanceof ConflitoDeIdempotencia) return NextResponse.json({ error: erro.message }, { status: 409 });
    if (erro instanceof ContratoLojasInvalido) return NextResponse.json({ error: erro.message }, { status: erro.status });
    return NextResponse.json({ error: "Integração temporariamente indisponível." }, { status: 503 });
  }
}
