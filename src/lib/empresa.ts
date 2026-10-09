import { z } from "zod";

/**
 * Identidade da empresa (tenant) no painel: o nome e o símbolo que aparecem no
 * cabeçalho. Este arquivo também é importado pela tela, então não pode puxar
 * nada que só exista no servidor.
 */

export type Identidade = { name: string; logo: string | null };

/** Lado, em pixels, para o qual a tela reduz a imagem antes de enviar. */
export const LADO_DO_SIMBOLO = 192;

/** Tamanho máximo do símbolo já como data URL (cerca de 150 KB de imagem). */
export const TAMANHO_MAXIMO_DO_SIMBOLO = 200_000;

const INVALID_BODY = "Dados inválidos.";
const SIMBOLO_INVALIDO = "O símbolo precisa ser uma imagem PNG, JPEG ou WebP.";

// SVG fica de fora de propósito: é um documento, pode carregar script.
const DATA_URL_DE_IMAGEM = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

export const identidadeSchema = z
  .object(
    {
      name: z.string("Informe o nome da empresa.").trim().min(2, "Informe o nome da empresa.").max(60, "Nome muito longo (máximo de 60 letras)."),
      // `null` remove o símbolo e volta ao padrão; ausente não mexe.
      logo: z
        .string(SIMBOLO_INVALIDO)
        .max(TAMANHO_MAXIMO_DO_SIMBOLO, "Imagem muito grande. Use uma imagem menor.")
        .regex(DATA_URL_DE_IMAGEM, SIMBOLO_INVALIDO)
        .nullable(),
    },
    INVALID_BODY,
  )
  .partial()
  .refine((dados) => dados.name !== undefined || dados.logo !== undefined, "Nada para alterar.");

/** Evento que a tela dispara depois de salvar, para o cabeçalho ler de novo. */
export const IDENTIDADE_ALTERADA = "tms:identidade-alterada";
