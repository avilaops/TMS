import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/staff";
import { Refusal } from "@/lib/cadastros";
import { empresaDaSessao } from "@/lib/cobranca-gateway-db";
import { xmlDaSubcontratada } from "@/lib/subcontratacao-fiscal-db";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string; documentoId: string }> }) {
  const { error } = await requireStaff({ pode: "fiscalVer" });
  if (error) return error;
  try {
    const { id, documentoId } = await params;
    const { chave, xml } = await xmlDaSubcontratada(await empresaDaSessao(), id, documentoId);
    return new Response(xml, { headers: {
      "Content-Type": "application/xml; charset=utf-8", "Content-Disposition": `attachment; filename="${chave}.xml"`,
      "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store",
    } });
  } catch (erro) {
    if (erro instanceof Refusal) return NextResponse.json({ error: erro.message }, { status: erro.status });
    console.error("Falha no download da subcontratada", erro instanceof Error ? erro.name : "erro");
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
