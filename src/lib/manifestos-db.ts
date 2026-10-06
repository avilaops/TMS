import type { Prisma } from "@prisma/client";
import { LOADABLE_COLLECTION_STATUS } from "@/lib/manifestos";

// O que as rotas de manifesto fazem no banco. Tudo aqui roda dentro de uma
// transação aberta pela rota; por isso só o servidor importa este arquivo.

type Tx = Prisma.TransactionClient;

export const MANIFEST_NOT_FOUND = "Manifesto não encontrado.";
export const DRIVER_UNAVAILABLE = "Motorista não encontrado ou inativo.";
export const VEHICLE_NOT_FOUND = "Veículo não encontrado.";
export const VEHICLE_IN_MAINTENANCE = "Este veículo está em manutenção.";
export const COLLECTIONS_UNAVAILABLE =
  "Uma ou mais cargas não estão mais disponíveis: só entra em viagem carga coletada e fora de outro manifesto. Atualize a página e confira.";
export const COLLECTIONS_NOT_IN_MANIFEST = "Uma ou mais cargas não estão neste manifesto. Atualize a página e confira.";

/** Recusa de regra de negócio: a rota devolve `status` com `message`. */
export class ManifestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ManifestError";
  }
}

/**
 * Lê o manifesto segurando a linha até o fim da transação. Montar, liberar a
 * saída, encerrar e cancelar passam todos por aqui, então duas chamadas ao
 * mesmo manifesto correm uma depois da outra e a segunda já enxerga o status
 * que a primeira gravou.
 */
export async function lockManifest(tx: Tx, manifestId: string) {
  await tx.$queryRaw`SELECT id FROM "Manifest" WHERE id = ${manifestId} FOR UPDATE`;
  const manifest = await tx.manifest.findUnique({
    where: { id: manifestId },
    select: { id: true, status: true, driverId: true, vehicleId: true },
  });
  if (!manifest) throw new ManifestError(404, MANIFEST_NOT_FOUND);
  return manifest;
}

export async function requireActiveDriver(tx: Tx, driverId: string) {
  const driver = await tx.driver.findUnique({ where: { id: driverId }, select: { active: true } });
  if (!driver?.active) throw new ManifestError(400, DRIVER_UNAVAILABLE);
}

export async function requireUsableVehicle(tx: Tx, vehicleId: string) {
  const vehicle = await tx.vehicle.findUnique({ where: { id: vehicleId }, select: { status: true } });
  if (!vehicle) throw new ManifestError(400, VEHICLE_NOT_FOUND);
  if (vehicle.status === "MAINTENANCE") throw new ManifestError(409, VEHICLE_IN_MAINTENANCE);
}

/**
 * Põe as cargas no manifesto. A condição vai no próprio UPDATE: se uma delas
 * foi cancelada ou entrou em outra viagem depois de a tela carregar, a contagem
 * não fecha e a transação inteira é desfeita.
 */
export async function loadCollections(tx: Tx, manifestId: string, collectionIds: string[]) {
  if (collectionIds.length === 0) return;
  const { count } = await tx.collection.updateMany({
    where: { id: { in: collectionIds }, status: LOADABLE_COLLECTION_STATUS, manifestId: null },
    data: { manifestId },
  });
  if (count !== collectionIds.length) throw new ManifestError(409, COLLECTIONS_UNAVAILABLE);
}

/** Devolve as cargas ao depósito: continuam coletadas, sem manifesto. */
export async function unloadCollections(tx: Tx, manifestId: string, collectionIds: string[]) {
  if (collectionIds.length === 0) return;
  const { count } = await tx.collection.updateMany({
    where: { id: { in: collectionIds }, manifestId },
    data: { manifestId: null },
  });
  if (count !== collectionIds.length) throw new ManifestError(409, COLLECTIONS_NOT_IN_MANIFEST);
}
