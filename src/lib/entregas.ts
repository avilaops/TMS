import { z } from "zod";

// Regras da baixa de entrega feita pelo motorista: o que o comprovante aceita.
// Este arquivo também é importado pela tela, então não pode puxar nada que só
// exista no servidor.

export const PROOF_STATUSES = ["SUBMITTED", "APPROVED", "REJECTED"] as const;

export const PROOF_STATUS: Record<string, { label: string; className: string }> = {
  SUBMITTED: { label: "Aguardando conferência", className: "bg-amber-50 text-amber-700 border-amber-200" },
  APPROVED: { label: "Aprovado", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  REJECTED: { label: "Recusado", className: "bg-red-50 text-red-700 border-red-200" },
};

// Tamanho do texto base64, não do arquivo. Foto de celular passa fácil de 3 MB;
// a assinatura é um PNG do traço, bem menor.
export const MAX_PHOTO_CHARS = 8_000_000;
export const MAX_SIGNATURE_CHARS = 500_000;

const INVALID_BODY = "Dados inválidos.";
const RECEIVER_NAME_MESSAGE = "Informe o nome de quem recebeu (2 a 120 caracteres).";
const RECEIVER_DOC_MESSAGE = "Informe o documento de quem recebeu (5 a 20 caracteres).";
export const PHOTO_MESSAGE =
  "Formato de foto não aceito. Envie uma foto JPEG, PNG ou WebP. No iPhone, troque em Ajustes > Câmera > Formatos para \"Mais compatível\" e tire outra.";
export const PHOTO_TOO_BIG = "A foto ficou grande demais. Tire outra com menos resolução.";
const SIGNATURE_MESSAGE = "A assinatura precisa ser uma imagem.";
const SIGNATURE_TOO_BIG = "A assinatura ficou grande demais. Limpe e assine de novo.";
const LOCATION_MESSAGE = "Localização inválida.";

// Só imagem embutida: o que chega aqui é exibido depois num <img> do painel,
// e um `data:text/html` ou um endereço externo não podem entrar por esta porta.
const IMAGE_DATA_URL = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

// A tela manda "" quando o motorista não tirou foto ou não colheu assinatura.
const image = (invalid: string, tooBig: string, max: number) =>
  z
    .string(invalid)
    .max(max, tooBig)
    .transform((value) => (value === "" ? null : value))
    .pipe(z.string().regex(IMAGE_DATA_URL, invalid).nullable())
    .nullish();

export const PHOTO_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0) =>
  signature.every((byte, index) => bytes[offset + index] === byte);

/**
 * Tipo da foto pelos primeiros bytes do arquivo, ou `null` quando não é um dos
 * formatos aceitos. Bastam os 12 primeiros bytes.
 */
export function sniffPhotoType(header: Uint8Array): string | null {
  if (startsWith(header, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(header, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  // "RIFF" <tamanho> "WEBP"
  if (startsWith(header, [0x52, 0x49, 0x46, 0x46]) && startsWith(header, [0x57, 0x45, 0x42, 0x50], 8)) {
    return "image/webp";
  }
  return null;
}

/**
 * Tipo com que a foto será enviada. Alguns navegadores entregam a foto da
 * câmera sem tipo: nesse caso vale o que os bytes dizem, em vez de recusar uma
 * foto boa. Tipo declarado continua valendo como veio (HEIC segue recusado).
 */
export function resolvePhotoType(declared: string, header: Uint8Array): string {
  return declared === "" ? (sniffPhotoType(header) ?? "") : declared;
}

// O arquivo vira texto base64 (4 caracteres a cada 3 bytes) atrás do prefixo
// `data:<tipo>;base64,`.
const dataUrlLength = (file: { type: string; size: number }) =>
  `data:${file.type};base64,`.length + Math.ceil(file.size / 3) * 4;

/**
 * Confere a foto ainda no aparelho, antes de enviar: devolve a mensagem para o
 * motorista ou `null` quando a foto serve. A câmera de alguns celulares grava
 * HEIC, que o servidor recusa; avisar aqui evita ele preencher tudo e só
 * descobrir no envio (ou, sem sinal, só quando a fila for recusada).
 */
export function photoProblem(file: { type: string; size: number }): string | null {
  if (!PHOTO_MIME_TYPES.includes(file.type.toLowerCase())) return PHOTO_MESSAGE;
  if (dataUrlLength(file) > MAX_PHOTO_CHARS) return PHOTO_TOO_BIG;
  return null;
}

export const baixaSchema = z.object(
  {
    receiverName: z.string(RECEIVER_NAME_MESSAGE).trim().min(2, RECEIVER_NAME_MESSAGE).max(120, RECEIVER_NAME_MESSAGE),
    receiverDoc: z.string(RECEIVER_DOC_MESSAGE).trim().min(5, RECEIVER_DOC_MESSAGE).max(20, RECEIVER_DOC_MESSAGE),
    photoBase64: image(PHOTO_MESSAGE, PHOTO_TOO_BIG, MAX_PHOTO_CHARS),
    signatureBase64: image(SIGNATURE_MESSAGE, SIGNATURE_TOO_BIG, MAX_SIGNATURE_CHARS),
    latitude: z.number(LOCATION_MESSAGE).min(-90, LOCATION_MESSAGE).max(90, LOCATION_MESSAGE).nullish(),
    longitude: z.number(LOCATION_MESSAGE).min(-180, LOCATION_MESSAGE).max(180, LOCATION_MESSAGE).nullish(),
  },
  INVALID_BODY,
);

export const DELIVERY_NOT_FOUND_MESSAGE = "Entrega não encontrada na sua viagem.";
export const DELIVERED_BY_PANEL_MESSAGE = "Esta entrega já recebeu baixa pelo painel, sem comprovante do motorista.";
export const NOT_IN_ROUTE_MESSAGE = "Só carga em rota recebe baixa de entrega.";

// Conferência do comprovante no painel: o operador aprova ou recusa, e a
// decisão é final.

export const REVIEW_DECISIONS = ["APPROVED", "REJECTED"] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

export const REJECTION_REASON_MIN = 5;
export const REJECTION_REASON_MAX = 500;

export const DECISION_MESSAGE = "Informe a decisão: aprovar ou recusar.";
export const REJECTION_REASON_MESSAGE = "Informe o motivo da recusa (5 a 500 caracteres).";
export const PROOF_NOT_FOUND_MESSAGE = "Comprovante não encontrado.";
export const ALREADY_REVIEWED_MESSAGE = "Este comprovante já foi conferido.";
export const PROOF_STATUS_FILTER_MESSAGE = "Status inválido. Use SUBMITTED, APPROVED ou REJECTED.";

// O motivo só existe na recusa: o que vier junto de uma aprovação é ignorado,
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
// dado pessoal: ficam só na página do comprovante) e sem nada do cadastro do
// cliente ou do conferente além do nome.
export const PROOF_LIST_SELECT = {
  id: true,
  status: true,
  receiverName: true,
  receiverDoc: true,
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
