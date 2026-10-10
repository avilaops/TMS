import { z } from "zod";
import {
  IMAGE_DATA_URL,
  PHOTO_MESSAGE,
  PHOTO_TOO_BIG,
  RELACAO_MESSAGE,
  RELACOES,
  documentoDeQuemRecebeu,
  fotosSchema,
  latitudeSchema,
  longitudeSchema,
  nomeDeQuemRecebeu,
  problemaNasFotos,
  ressalvaSchema,
  type FotoEnviada,
} from "@/lib/comprovantes";

// Regras da baixa de entrega feita pelo motorista: o que o comprovante aceita.
// Este arquivo também é importado pela tela, então não pode puxar nada que só
// exista no servidor.

export const PROOF_STATUSES = ["SUBMITTED", "APPROVED", "REJECTED"] as const;

export const PROOF_STATUS: Record<string, { label: string; className: string }> = {
  SUBMITTED: { label: "Aguardando conferência", className: "bg-amber-50 text-amber-700 border-amber-200" },
  APPROVED: { label: "Aprovado", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  // Devolvido: o motorista manda fotos novas e o comprovante volta para a fila.
  REJECTED: { label: "Devolvido ao motorista", className: "bg-red-50 text-red-700 border-red-200" },
};

// Tamanho do texto base64, não do arquivo. Este é o teto da foto no formato
// antigo da baixa (`photoBase64`, sem redução no aparelho), que ainda chega de
// baixas guardadas na fila offline por uma versão anterior do aplicativo. A
// foto nova (`photos`) tem teto próprio, bem menor: `MAX_NEW_PHOTO_CHARS`.
// A assinatura é um PNG do traço, bem menor.
export const MAX_PHOTO_CHARS = 8_000_000;
export const MAX_SIGNATURE_CHARS = 500_000;

const INVALID_BODY = "Dados inválidos.";
export { PHOTO_MESSAGE, PHOTO_TOO_BIG };
const SIGNATURE_MESSAGE = "A assinatura precisa ser uma imagem.";
const SIGNATURE_TOO_BIG = "A assinatura ficou grande demais. Limpe e assine de novo.";

// Só imagem embutida (`IMAGE_DATA_URL`, src/lib/comprovantes.ts): o que chega
// aqui é exibido depois num <img> do painel.

// A tela manda "" quando o motorista não tirou foto ou não colheu assinatura.
const image = (invalid: string, tooBig: string, max: number) =>
  z
    .string(invalid)
    .max(max, tooBig)
    .transform((value) => (value === "" ? null : value))
    .pipe(z.string().regex(IMAGE_DATA_URL, invalid).nullable())
    .nullish();

/**
 * Corpo da baixa. Dois formatos chegam aqui:
 *
 * - o atual, que traz `photos` (lista de fotos por tipo, vazia quando o
 *   motorista não tirou nenhuma): exige `receiverRelation`;
 * - o antigo, sem `photos`, com no máximo uma foto em `photoBase64`: é o que
 *   está guardado na fila offline de quem colheu a baixa antes da atualização
 *   do aplicativo. Continua valendo, sem a relação de quem recebeu, para o
 *   comprovante colhido não se perder; a foto entra como foto da entrega.
 *
 * O que o perfil da empresa exige é conferido depois, na rota
 * (`oQueFaltaNasFotos`), nos dois formatos.
 */
export const baixaSchema = z
  .object(
    {
      receiverName: nomeDeQuemRecebeu,
      receiverDoc: documentoDeQuemRecebeu,
      photoBase64: image(PHOTO_MESSAGE, PHOTO_TOO_BIG, MAX_PHOTO_CHARS),
      signatureBase64: image(SIGNATURE_MESSAGE, SIGNATURE_TOO_BIG, MAX_SIGNATURE_CHARS),
      latitude: latitudeSchema,
      longitude: longitudeSchema,
      receiverRelation: z.enum(RELACOES, RELACAO_MESSAGE).nullish(),
      photos: fotosSchema.optional(),
      // Ressalva no ato da entrega; `null` ou ausente = sem ressalva.
      exception: ressalvaSchema.nullish(),
    },
    INVALID_BODY,
  )
  .superRefine((dados, ctx) => {
    if (dados.photos !== undefined && !dados.receiverRelation) {
      ctx.addIssue({ code: "custom", message: RELACAO_MESSAGE, path: ["receiverRelation"] });
    }
    const problema = problemaNasFotos(fotosDaBaixa(dados).map((foto) => foto.kind));
    if (problema) ctx.addIssue({ code: "custom", message: problema, path: ["photos"] });
  });

/** As fotos de uma baixa nos dois formatos: a de `photoBase64` (formato antigo) conta como foto da entrega. */
export function fotosDaBaixa(dados: { photoBase64?: string | null; photos?: FotoEnviada[] }): FotoEnviada[] {
  const antiga: FotoEnviada[] = dados.photoBase64 ? [{ kind: "ENTREGA", dataUrl: dados.photoBase64 }] : [];
  return [...antiga, ...(dados.photos ?? [])];
}

export const DELIVERY_NOT_FOUND_MESSAGE = "Entrega não encontrada na sua viagem.";
export const DELIVERED_BY_PANEL_MESSAGE = "Esta entrega já recebeu baixa pelo painel, sem comprovante do motorista.";
export const NOT_IN_ROUTE_MESSAGE = "Só carga em rota recebe baixa de entrega.";

// Conferência do comprovante no painel: o operador aprova (decisão final) ou
// devolve ao motorista com o motivo (`REJECTED`). O devolvido volta para a
// fila quando o motorista manda fotos novas.

export const REVIEW_DECISIONS = ["APPROVED", "REJECTED"] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

export const REJECTION_REASON_MIN = 5;
export const REJECTION_REASON_MAX = 500;

export const DECISION_MESSAGE = "Informe a decisão: aprovar ou devolver ao motorista.";
export const REJECTION_REASON_MESSAGE = "Informe o motivo da devolução (5 a 500 caracteres).";
export const PROOF_NOT_FOUND_MESSAGE = "Comprovante não encontrado.";
export const ALREADY_REVIEWED_MESSAGE = "Este comprovante já foi conferido.";
export const PROOF_STATUS_FILTER_MESSAGE = "Status inválido. Use SUBMITTED, APPROVED ou REJECTED.";

// O motivo só existe na devolução: o que vier junto de uma aprovação é ignorado,
// seja o que for.
export const conferenciaSchema = z
  .object(
    {
      decision: z.enum(REVIEW_DECISIONS, DECISION_MESSAGE),
      reason: z.unknown().optional(),
    },
    INVALID_BODY,
  )
  .transform(({ decision, reason }, ctx) => {
    if (decision === "APPROVED") return { decision, reason: null };

    const motivo = typeof reason === "string" ? reason.trim() : "";
    if (motivo.length < REJECTION_REASON_MIN || motivo.length > REJECTION_REASON_MAX) {
      ctx.addIssue({ code: "custom", message: REJECTION_REASON_MESSAGE, path: ["reason"] });
      return z.NEVER;
    }
    return { decision, reason: motivo };
  });

export const PROOF_LIST_LIMIT = 200;

// O que a fila de comprovantes devolve. Sem foto nem assinatura (pesam e são
// dado pessoal: ficam só na página do comprovante), sem a posição (só a
// distância do endereço, já calculada) e sem nada do cadastro do cliente ou do
// conferente além do nome.
export const PROOF_LIST_SELECT = {
  id: true,
  status: true,
  receiverName: true,
  receiverDoc: true,
  receiverRelation: true,
  exceptionType: true,
  distanceMeters: true,
  createdAt: true,
  reviewedAt: true,
  rejectionReason: true,
  reviewedBy: { select: { id: true, name: true } },
  collection: {
    select: {
      id: true,
      trackingCode: true,
      receiver: true,
      destination: true,
      client: { select: { tradeName: true, companyName: true } },
    },
  },
} as const;
