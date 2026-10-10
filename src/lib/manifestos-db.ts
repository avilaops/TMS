import type { Prisma } from "@prisma/client";
import { MANIFEST_NOT_FOUND_MESSAGE } from "@/lib/manifestos";
import { HELPER_NOT_FOUND_OR_INACTIVE } from "@/lib/viagem";

// Apoio das rotas que mudam uma viagem dentro de transação (alterar, liberar,
// finalizar, cancelar). Só o servidor importa este arquivo.

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
 * Lê o manifesto segurando a linha até o fim da transação. Alterar, liberar,
 * finalizar e cancelar passam por aqui, então duas chamadas à mesma viagem correm uma
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

/** Recusa (400) o ajudante que não existe nesta empresa ou está desativado. `null` passa: a viagem fica sem ajudante. */
export async function conferirAjudante(tx: Pick<Tx, "helper">, helperId: string | null | undefined): Promise<void> {
  if (!helperId) return;
  const ajudante = await tx.helper.findFirst({ where: { id: helperId, active: true }, select: { id: true } });
  if (!ajudante) throw new ManifestError(400, HELPER_NOT_FOUND_OR_INACTIVE);
}

/**
 * A ordem das cargas de uma viagem em toda leitura: a sequência definida na
 * tela e, para as sem sequência, a data de criação (como era antes dela).
 */
export const ORDEM_DAS_CARGAS = [{ manifestSequence: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }] satisfies Prisma.CollectionOrderByWithRelationInput[];
