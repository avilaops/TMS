import type { Prisma } from "@prisma/client";
import { MANIFEST_NOT_FOUND_MESSAGE } from "@/lib/manifestos";

// Apoio das rotas que mudam uma viagem dentro de transação (alterar, liberar,
// cancelar). Só o servidor importa este arquivo.

type Tx = Prisma.TransactionClient;

/** Recusa de regra de negócio dentro da transação: a rota devolve `status` com `message`. */
export class ManifestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Lê o manifesto segurando a linha até o fim da transação. Alterar, liberar e
 * cancelar passam por aqui, então duas chamadas à mesma viagem correm uma
 * depois da outra e a segunda já enxerga o status que a primeira gravou.
 */
export async function lockManifest(tx: Tx, manifestId: string) {
  await tx.$queryRaw`SELECT id FROM "Manifest" WHERE id = ${manifestId} FOR UPDATE`;
  const manifest = await tx.manifest.findUnique({
    where: { id: manifestId },
    select: { id: true, status: true, driverId: true, vehicleId: true },
  });
  if (!manifest) throw new ManifestError(404, MANIFEST_NOT_FOUND_MESSAGE);
  return manifest;
}
