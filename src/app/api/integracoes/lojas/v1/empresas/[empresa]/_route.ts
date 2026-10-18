import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { autenticarLojas, CredencialLojasInvalida } from "@/lib/lojas-logistica-auth";
import { armazenamentoPrisma, ConflitoDeIdempotencia, ContratoLojasInvalido, executarIdempotente, RequisicaoEmAndamento } from "@/lib/lojas-logistica-db";
import { cotacaoLojasSchema } from "@/lib/lojas-logistica";

export async function mutacaoLojas(
  request: Request,
  empresa: string,
  executar: (tenantId: string, corpo: ReturnType<typeof cotacaoLojasSchema.parse>) => Promise<unknown>,
) {
  try {
    const autenticado = await autenticarLojas(request, empresa);
    const corpo = cotacaoLojasSchema.parse(await request.json());
    const chave = request.headers.get("idempotency-key") ?? "";
    const resultado = await executarIdempotente(armazenamentoPrisma(autenticado.tenantId, autenticado.credentialId), chave, corpo, async () => ({
      status: 201,
      body: await executar(autenticado.tenantId, corpo),
    }));
    return NextResponse.json(resultado.body, { status: resultado.status, headers: { "Idempotency-Replayed": String(resultado.replay) } });
  } catch (erro) {
    if (erro instanceof CredencialLojasInvalida) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
    if (erro instanceof ZodError) return NextResponse.json({ error: "Contrato inválido.", issues: erro.issues }, { status: 400 });
    if (erro instanceof ConflitoDeIdempotencia) return NextResponse.json({ error: erro.message }, { status: 409 });
    if (erro instanceof RequisicaoEmAndamento) return NextResponse.json({ error: erro.message }, { status: 425 });
    if (erro instanceof ContratoLojasInvalido) return NextResponse.json({ error: erro.message }, { status: erro.status });
    console.error("Integração Lojas:", erro);
    return NextResponse.json({ error: "Integração temporariamente indisponível." }, { status: 503 });
  }
}
