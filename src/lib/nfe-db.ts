import type { Prisma } from "@prisma/client";
import { NOTA_SELECT, nomeDoArquivoXml, sugerirCarga, type NotaLida, type SugestaoDeCarga } from "@/lib/nfe";

// Apoio das rotas de documentos fiscais. Só o servidor importa este arquivo.

type NotasDb = Pick<Prisma.TransactionClient, "client" | "collection">;

type NotaGravada = NotaLida & { collection: { id: string } | null };

/** Carga cancelada ou recusada não conta como "a carga desta nota". */
export const STATUS_SEM_CARGA = ["CANCELLED", "REJECTED"];

const CARGA_SELECT = NOTA_SELECT.collection.select;

/** Carga da empresa que já tem a chave desta nota (digitada no painel, por exemplo), ou `null`. */
export function cargaComAChave(db: Pick<NotasDb, "collection">, chave: string) {
  return db.collection.findFirst({
    where: { invoiceKey: chave, status: { notIn: STATUS_SEM_CARGA } },
    select: CARGA_SELECT,
    orderBy: { createdAt: "desc" },
  });
}

/**
 * O que a tela precisa para decidir o que fazer com uma nota ainda sem carga:
 * a carga sugerida e, se houver, a carga que já tem a chave dela. Nota já
 * ligada não tem sugestão.
 */
export async function sugestaoDaNota(
  db: NotasDb,
  nota: NotaGravada,
): Promise<{ sugestao: SugestaoDeCarga | null; cargaComAChave: Awaited<ReturnType<typeof cargaComAChave>> }> {
  if (nota.collection) return { sugestao: null, cargaComAChave: null };

  // O cadastro guarda o CNPJ só com dígitos (src/lib/cadastros.ts), como a nota.
  const documentos = [nota.issuerTaxId, nota.recipientTaxId].filter((documento): documento is string => documento !== null);
  const clientes = await db.client.findMany({
    where: { active: true, cnpj: { in: documentos } },
    select: { id: true, cnpj: true, active: true },
  });
  const existente = await cargaComAChave(db, nota.accessKey);

  return { sugestao: sugerirCarga(nota, clientes), cargaComAChave: existente };
}

/**
 * O XML original como download. Vai como anexo, com `nosniff` e sem cache: o
 * conteúdo veio de fora e nunca deve ser aberto pelo navegador como página.
 */
export function respostaComXml(chave: string, xml: string): Response {
  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nomeDoArquivoXml(chave)}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
