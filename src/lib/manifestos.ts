import { z } from "zod";
import { DRIVER_USER_SELECT } from "@/lib/usuarios";

// Regras do manifesto (a viagem): quais status existem, quais trocas o operador
// pode fazer e o que as rotas aceitam gravar. Este arquivo também é importado
// pela tela, então não pode puxar nada que só exista no servidor.

export const MANIFEST_STATUSES = ["ASSEMBLING", "ROUTE", "FINISHED", "CANCELLED"] as const;

export type ManifestStatus = (typeof MANIFEST_STATUSES)[number];

// Em montagem → Em rota → Encerrado. Cancelar só antes da saída: depois dela a
// carga já está na rua e a viagem se encerra, não se cancela.
export const MANIFEST_TRANSITIONS: Record<ManifestStatus, readonly ManifestStatus[]> = {
  ASSEMBLING: ["ROUTE", "CANCELLED"],
  ROUTE: ["FINISHED"],
  FINISHED: [],
  CANCELLED: [],
};

/** Status que o operador pode pedir pela rota de status. */
export const MANIFEST_TARGET_STATUSES = ["ROUTE", "FINISHED", "CANCELLED"] as const;

/** Só carga já coletada, e fora de outro manifesto, entra em uma viagem. */
export const LOADABLE_COLLECTION_STATUS = "COLLECTED";

export function allowedManifestTransitions(from: string): readonly ManifestStatus[] {
  return Object.hasOwn(MANIFEST_TRANSITIONS, from) ? MANIFEST_TRANSITIONS[from as ManifestStatus] : [];
}

export function canManifestTransition(from: string, to: string): boolean {
  return (allowedManifestTransitions(from) as readonly string[]).includes(to);
}

/** Motorista, veículo e cargas só mudam enquanto a viagem está em montagem. */
export function isManifestEditable(manifest: { status: string }): boolean {
  return manifest.status === "ASSEMBLING";
}

/** Carga que pode ser escolhida na montagem de uma viagem. */
export function isLoadable(collection: { status: string; manifestId?: string | null }): boolean {
  return collection.status === LOADABLE_COLLECTION_STATUS && !collection.manifestId;
}

// O que as rotas devolvem junto do manifesto. O usuário do motorista sai só com
// id, nome e e-mail: `user: true` mandaria o hash da senha junto.
export const MANIFEST_INCLUDE = {
  driver: { include: { user: { select: DRIVER_USER_SELECT } } },
  vehicle: true,
  collections: {
    include: { client: { select: { id: true, companyName: true, tradeName: true } } },
    orderBy: { createdAt: "asc" },
  },
} as const;

const INVALID_BODY = "Dados inválidos.";
const DRIVER_MESSAGE = "Informe o motorista.";
const VEHICLE_MESSAGE = "Informe o veículo.";
const COLLECTIONS_MESSAGE = "Selecione ao menos uma carga.";
const COLLECTION_ID_MESSAGE = "Carga inválida.";
const TOO_MANY_MESSAGE = "Uma viagem aceita no máximo 200 cargas por vez.";
const NOTHING_TO_CHANGE = "Informe ao menos um campo para alterar.";

const MAX_COLLECTIONS = 200;

const id = (message: string) => z.string(message).trim().min(1, message).max(64, message);

// A mesma carga marcada duas vezes conta uma vez só.
const collectionIds = z
  .array(id(COLLECTION_ID_MESSAGE), COLLECTIONS_MESSAGE)
  .max(MAX_COLLECTIONS, TOO_MANY_MESSAGE)
  .transform((ids) => [...new Set(ids)]);

export const createManifestSchema = z.object(
  {
    driverId: id(DRIVER_MESSAGE),
    vehicleId: id(VEHICLE_MESSAGE),
    collectionIds: collectionIds.refine((ids) => ids.length > 0, COLLECTIONS_MESSAGE),
  },
  INVALID_BODY,
);

// Status não entra aqui: quem troca o status é a rota própria, que confere a
// transição. O schema descarta qualquer chave fora desta lista.
export const updateManifestSchema = z
  .object(
    {
      driverId: id(DRIVER_MESSAGE).optional(),
      vehicleId: id(VEHICLE_MESSAGE).optional(),
      addCollectionIds: collectionIds.optional(),
      removeCollectionIds: collectionIds.optional(),
    },
    INVALID_BODY,
  )
  .refine(
    (data) =>
      data.driverId !== undefined ||
      data.vehicleId !== undefined ||
      (data.addCollectionIds?.length ?? 0) > 0 ||
      (data.removeCollectionIds?.length ?? 0) > 0,
    { message: NOTHING_TO_CHANGE },
  );

export const manifestStatusSchema = z.object(
  { status: z.enum(MANIFEST_TARGET_STATUSES, "Status inválido.") },
  INVALID_BODY,
);
