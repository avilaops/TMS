import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/staff";
import { Refusal } from "@/lib/cadastros";
import { ManifestError } from "@/lib/manifestos-db";
import { empresaDaSessao } from "@/lib/cobranca-gateway-db";
import { origemDaRequisicao } from "@/lib/auditoria";
import { consultarSubcontratada } from "@/lib/subcontratacao-fiscal-db";

export async function POST(req: Request, { params }: { params: Promise<{ id: string; documentoId: string }> }) {
  const { user, error } = await requireStaff({ pode: "fiscal" });
  if (error) return error;
  try {
    const { id, documentoId } = await params;
    const documento = await consultarSubcontratada(await empresaDaSessao(), id, documentoId, { ator: user, origem: origemDaRequisicao(req) });
    return NextResponse.json(documento);
  } catch (erro) {
    if (erro instanceof Refusal || erro instanceof ManifestError) return NextResponse.json({ error: erro.message }, { status: erro.status });
    console.error("Falha na consulta da subcontratada", erro instanceof Error ? erro.name : "erro");
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
