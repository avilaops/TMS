import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { autenticarLojas, CredencialLojasInvalida } from "@/lib/lojas-logistica-auth";
import { armazenamentoPrisma, ConflitoDeIdempotencia, ContratoLojasInvalido, criarReversa, executarIdempotente } from "@/lib/lojas-logistica-db";
import { reversaLojasSchema } from "@/lib/lojas-logistica";

export async function POST(request: Request, contexto: { params: Promise<{ empresa: string }> }) {
  try {
    const autenticado = await autenticarLojas(request, (await contexto.params).empresa);
    const corpo = reversaLojasSchema.parse(await request.json());
    const resultado = await executarIdempotente(armazenamentoPrisma(autenticado.tenantId, autenticado.credentialId), request.headers.get("idempotency-key") ?? "", corpo, async () => ({ status: 201, body: await criarReversa(autenticado.tenantId, corpo) }));
    return NextResponse.json(resultado.body, { status: resultado.status });
  } catch (erro) {
    if (erro instanceof CredencialLojasInvalida) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
    if (erro instanceof ZodError) return NextResponse.json({ error: "Contrato inválido.", issues: erro.issues }, { status: 400 });
    if (erro instanceof ConflitoDeIdempotencia) return NextResponse.json({ error: erro.message }, { status: 409 });
    if (erro instanceof ContratoLojasInvalido) return NextResponse.json({ error: erro.message }, { status: erro.status });
    return NextResponse.json({ error: "Integração temporariamente indisponível." }, { status: 503 });
  }
}
