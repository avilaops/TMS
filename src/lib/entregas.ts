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
const PHOTO_MESSAGE = "A foto precisa ser uma imagem JPEG, PNG ou WebP.";
const PHOTO_TOO_BIG = "A foto ficou grande demais. Tire outra com menos resolução.";
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
