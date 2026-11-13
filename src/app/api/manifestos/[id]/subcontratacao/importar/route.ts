import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/lib/staff";
import { Refusal } from "@/lib/cadastros";
import { ManifestError } from "@/lib/manifestos-db";
import { empresaDaSessao } from "@/lib/cobranca-gateway-db";
import { origemDaRequisicao } from "@/lib/auditoria";
import { importarXmlDaSubcontratada } from "@/lib/subcontratacao-fiscal-db";
import { LIMITE_XML_SUBCONTRATADA, XML_SUBCONTRATADA_GRANDE } from "@/lib/subcontratacao-xml";

const schema = z.object({ xml: z.string().min(1), collectionId: z.string().trim().min(1).max(64).nullish() });
const LIMITE_CORPO = LIMITE_XML_SUBCONTRATADA * 2 + 1024;

/** Limita o corpo recebido antes de concatenar ou analisar o JSON. */
async function corpoLimitado(req: Request): Promise<unknown> {
  if (Number(req.headers.get("content-length") ?? 0) > LIMITE_CORPO) throw new Refusal(XML_SUBCONTRATADA_GRANDE, 413);
  const leitor = req.body?.getReader();
  if (!leitor) return null;
  const partes: Uint8Array[] = [];
  let tamanho = 0;
  for (;;) {
    const { value, done } = await leitor.read();
    if (done) break;
    tamanho += value.byteLength;
    if (tamanho > LIMITE_CORPO) {
      await leitor.cancel();
      throw new Refusal(XML_SUBCONTRATADA_GRANDE, 413);
    }
    partes.push(value);
  }
  try { return JSON.parse(Buffer.concat(partes).toString("utf8")); } catch { return null; }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireStaff({ pode: "fiscal" });
  if (error) return error;
  try {
    const parsed = schema.safeParse(await corpoLimitado(req));
    if (!parsed.success) return NextResponse.json({ error: "Envie o XML e escolha a carga quando o documento for CT-e." }, { status: 400 });
    const resultado = await importarXmlDaSubcontratada(await empresaDaSessao(), (await params).id, parsed.data.xml, parsed.data.collectionId ?? null, { ator: user, origem: origemDaRequisicao(req) });
    return NextResponse.json(resultado.documento, { status: resultado.novo ? 201 : 200 });
  } catch (erro) {
    if (erro instanceof Refusal || erro instanceof ManifestError) return NextResponse.json({ error: erro.message }, { status: erro.status });
    console.error("Falha na importação de documento da subcontratada", erro instanceof Error ? erro.name : "erro");
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
