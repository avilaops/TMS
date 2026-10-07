import { z } from "zod";

// Regras do manifesto de viagem: quais status existem, que carga pode embarcar
// e o que a rota de criação aceita. Este arquivo também é importado pela tela,
// então não pode puxar nada que só exista no servidor.

// Em montagem → Em rota → Finalizada. Cancelar só antes da saída: depois dela
// a carga já está na rua e a viagem se finaliza, não se cancela.
export const MANIFEST_STATUSES = ["ASSEMBLING", "ROUTE", "FINISHED", "CANCELLED"] as const;

export type ManifestStatus = (typeof MANIFEST_STATUSES)[number];

/** Motorista, veículo e cargas só mudam enquanto a viagem está em montagem. */
export function isManifestEditable(manifest: { status: string }): boolean {
  return manifest.status === "ASSEMBLING";
}

/** Status em que a carga pode entrar numa viagem: só depois de coletada. */
export const EMBARKABLE_STATUSES = ["COLLECTED"] as const;

/** Carga coletada e fora de qualquer manifesto. */
export function canEmbark(collection: { status: string; manifestId: string | null }): boolean {
  return (EMBARKABLE_STATUSES as readonly string[]).includes(collection.status) && collection.manifestId === null;
}

export const MAX_MANIFEST_COLLECTIONS = 200;

const INVALID_BODY = "Dados inválidos.";
const DRIVER_MESSAGE = "Informe o motorista.";
const VEHICLE_MESSAGE = "Informe o veículo.";
const COLLECTIONS_MESSAGE = "Selecione pelo menos uma carga para a viagem.";
const TOO_MANY_MESSAGE = `Uma viagem leva no máximo ${MAX_MANIFEST_COLLECTIONS} cargas.`;
const COLLECTION_ID_MESSAGE = "Carga inválida.";
const REPEATED_MESSAGE = "A mesma carga foi informada mais de uma vez.";

const id = (required: string, invalid: string) => z.string(required).trim().min(1, required).max(64, invalid);

export const createManifestSchema = z.object(
  {
    driverId: id(DRIVER_MESSAGE, "Motorista inválido."),
    vehicleId: id(VEHICLE_MESSAGE, "Veículo inválido."),
    collectionIds: z
      .array(id(COLLECTION_ID_MESSAGE, COLLECTION_ID_MESSAGE), COLLECTIONS_MESSAGE)
      .min(1, COLLECTIONS_MESSAGE)
      .max(MAX_MANIFEST_COLLECTIONS, TOO_MANY_MESSAGE)
      .refine((ids) => new Set(ids).size === ids.length, REPEATED_MESSAGE),
  },
  INVALID_BODY,
);

// Status não entra aqui: quem troca o status são as rotas próprias (liberar,
// finalizar, cancelar). O schema descarta qualquer chave fora desta lista.
// Retirar carga é o DELETE de /api/manifestos/[id]/coletas/[coletaId].
export const updateManifestSchema = z
  .object(
    {
      driverId: id(DRIVER_MESSAGE, "Motorista inválido.").optional(),
      vehicleId: id(VEHICLE_MESSAGE, "Veículo inválido.").optional(),
      addCollectionIds: z
        .array(id(COLLECTION_ID_MESSAGE, COLLECTION_ID_MESSAGE), COLLECTION_ID_MESSAGE)
        .max(MAX_MANIFEST_COLLECTIONS, TOO_MANY_MESSAGE)
        .refine((ids) => new Set(ids).size === ids.length, REPEATED_MESSAGE)
        .optional(),
    },
    INVALID_BODY,
  )
  .refine(
    (data) => data.driverId !== undefined || data.vehicleId !== undefined || (data.addCollectionIds?.length ?? 0) > 0,
    { message: "Informe motorista, veículo ou carga para alterar." },
  );

export const MANIFEST_NOT_FOUND_MESSAGE = "Manifesto não encontrado.";
export const NOT_ASSEMBLING_MESSAGE = "Só viagem em montagem pode ser alterada.";
export const EMPTY_MANIFEST_MESSAGE = "Não dá para liberar uma viagem sem carga.";
export const VEHICLE_BUSY_MESSAGE = "Este veículo já está em rota em outra viagem: finalize a anterior antes de liberar esta.";
export const DRIVER_BUSY_MESSAGE = "Este motorista já está em rota em outra viagem: finalize a anterior antes de liberar esta.";

export const VEHICLE_NOT_FOUND_MESSAGE = "Veículo não encontrado.";
export const VEHICLE_IN_MAINTENANCE_MESSAGE = "Este veículo está em manutenção e não pode sair em viagem.";

/** Resposta do 409 quando alguma carga pedida não pode embarcar. */
export function cannotEmbarkMessage(count: number): string {
  const cargas =
    count === 1 ? "1 das cargas selecionadas não pode embarcar" : `${count} das cargas selecionadas não podem embarcar`;
  return `${cargas}: só carga coletada e fora de outro manifesto entra na viagem. Atualize a página e monte de novo.`;
}

/** Resposta do 409 ao encerrar viagem com carga ainda em rota. */
export function pendingDeliveriesMessage(count: number): string {
  const cargas = count === 1 ? "1 carga ainda em rota" : `${count} cargas ainda em rota`;
  return `Esta viagem tem ${cargas}: dê baixa na entrega ou retire a carga antes de finalizar.`;
}

/** Linha de cargas no cartão da viagem. A cancelada soltou as suas: não há quantidade a mostrar. */
export function manifestLoadsLabel(status: string, total: number): string {
  if (status === "CANCELLED") return "Cargas liberadas";
  if (status === "ASSEMBLING") return `${total} ${total === 1 ? "carga reservada" : "cargas reservadas"}`;
  return total === 1 ? "1 Entrega na Rota" : `${total} Entregas na Rota`;
}
