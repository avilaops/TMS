import type { Prisma } from "@prisma/client";
import { Refusal } from "@/lib/cadastros";
import { CARGA_NAO_ENCONTRADA, CARGA_SELECT, recusaDeConferencia, resumoDaConferencia, type CargaLida } from "@/lib/deposito";

// Apoio das rotas de conferência do depósito. Só o servidor importa este
// arquivo. Tudo aqui roda dentro da transação de quem chama.

type Tx = Prisma.TransactionClient;

/** A carga como o depósito a lê, ou `null`. */
export async function lerCarga(db: Pick<Tx, "collection">, onde: { id: string } | { trackingCode: string }): Promise<CargaLida | null> {
  return db.collection.findFirst({ where: onde, select: CARGA_SELECT });
}

/**
 * Lê a carga segurando a linha até o fim da transação, e recusa se ela não
 * pode ser conferida. Ler volume, alocar posição e concluir passam por aqui:
 * duas leituras do mesmo volume correm uma depois da outra, e a segunda já
 * enxerga o que a primeira gravou.
 */
export async function travarCargaParaConferir(tx: Tx, collectionId: string): Promise<CargaLida & { trackingCode: string }> {
  await tx.$queryRaw`SELECT id FROM "Collection" WHERE id = ${collectionId} FOR UPDATE`;
  const carga = await lerCarga(tx, { id: collectionId });
  if (!carga) throw new Refusal(CARGA_NAO_ENCONTRADA, 404);

  const recusa = recusaDeConferencia(carga);
  if (recusa || !carga.trackingCode) throw new Refusal(recusa ?? CARGA_NAO_ENCONTRADA, 409);
  return { ...carga, trackingCode: carga.trackingCode };
}

/**
 * Grava a conferência da carga com as contas dos volumes como estão agora.
 *
 * Com `concluidaPor`, é o operador concluindo: cria a conferência ou, se já
 * havia, registra quem concluiu de novo e quando. Sem, é um volume corrigido
 * depois: só refaz os números de uma conferência que já existe.
 */
export async function gravarConferencia(tx: Tx, collectionId: string, concluidaPor: string | null): Promise<void> {
  const carga = await tx.collection.findUniqueOrThrow({
    where: { id: collectionId },
    select: { volumes: true, weight: true, volumeItems: { select: { sequence: true, status: true, weight: true } } },
  });
  const resumo = resumoDaConferencia(carga.volumes, carga.weight, carga.volumeItems);
  const numeros = {
    expectedVolumes: resumo.esperados,
    receivedVolumes: resumo.recebidos,
    damagedVolumes: resumo.avariados,
    missingVolumes: resumo.faltando,
    declaredWeight: carga.weight,
    checkedWeight: resumo.pesoConferido,
    quantityDivergence: resumo.divergenciaDeQuantidade,
    weightDivergence: resumo.divergenciaDePeso,
  };

  if (concluidaPor === null) {
    await tx.warehouseReceipt.updateMany({ where: { collectionId }, data: numeros });
    return;
  }

  await tx.warehouseReceipt.upsert({
    where: { collectionId },
    create: { collectionId, userId: concluidaPor, ...numeros },
    update: { userId: concluidaPor, concludedAt: new Date(), ...numeros },
    select: { id: true },
  });
}
