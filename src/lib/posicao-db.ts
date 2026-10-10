import type { Prisma } from "@prisma/client";
import { MAXIMO_DE_PONTOS, entraNoHistorico, type PosicaoEnviada } from "@/lib/posicao";

// Gravação da posição do motorista. Só o servidor importa este arquivo.

/**
 * Grava a posição na viagem: a última fica no manifesto e, se o caminhão andou
 * (ou faz tempo), um ponto entra no histórico, que é podado para `maximo`.
 *
 * Só grava se a viagem é deste motorista e está em rota: a de outro, a em
 * montagem e a finalizada devolvem `null`, como a que não existe. A troca no
 * manifesto segura a linha, então dois envios da mesma viagem correm um depois
 * do outro.
 *
 * Não registra auditoria de propósito: posição não é alteração de cadastro, e
 * a trilha encheria de pontos.
 */
export async function registrarPosicao(
  tx: Prisma.TransactionClient,
  { manifestId, driverId, posicao, agora = new Date(), maximo = MAXIMO_DE_PONTOS }: { manifestId: string; driverId: string; posicao: PosicaoEnviada; agora?: Date; maximo?: number },
): Promise<{ em: Date; guardada: boolean } | null> {
  const { count } = await tx.manifest.updateMany({
    where: { id: manifestId, driverId, status: "ROUTE" },
    data: { lastLat: posicao.lat, lastLon: posicao.lon, lastAccuracy: posicao.precisao ?? null, lastPositionAt: agora },
  });
  if (count === 0) return null;

  const ultimo = await tx.tripPosition.findFirst({
    where: { manifestId },
    orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
    select: { lat: true, lon: true, recordedAt: true },
  });
  if (!entraNoHistorico(ultimo, posicao, agora)) return { em: agora, guardada: false };

  await tx.tripPosition.create({ data: { manifestId, lat: posicao.lat, lon: posicao.lon, accuracy: posicao.precisao ?? null, recordedAt: agora } });

  // Poda: do ponto `maximo + 1` em diante, do mais novo para o mais antigo, sai.
  const sobra = await tx.tripPosition.findMany({
    where: { manifestId },
    orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
    skip: maximo,
    select: { id: true },
  });
  if (sobra.length > 0) await tx.tripPosition.deleteMany({ where: { id: { in: sobra.map((ponto) => ponto.id) } } });

  return { em: agora, guardada: true };
}
