import { z } from "zod";
import { LIMITE_DA_CIDADE, LIMITE_DO_NOME, TIPOS_DE_CHAVE, normalizarChave, textoDoCodigo, type TipoDeChave } from "@/lib/pix";

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

const PERCENTUAL_MESSAGE = "O percentual precisa ser um número entre 0 e 100.";

// O formulário manda número como texto ("2", "1,5").
const percentual = z.preprocess((valor) => {
  if (typeof valor !== "string") return valor;
  const texto = valor.trim();
  return /^(\d+([.,]\d*)?|[.,]\d+)$/.test(texto) ? Number(texto.replace(",", ".")) : NaN;
}, z.number(PERCENTUAL_MESSAGE).min(0, PERCENTUAL_MESSAGE).max(100, PERCENTUAL_MESSAGE));

/** Recebimento por Pix da empresa, como a tela mostra e manda. */
export type PixDaEmpresa = { tipo: TipoDeChave; chave: string; nome: string; cidade: string };

const NOME_PIX_MESSAGE = `Informe o nome do recebedor (até ${LIMITE_DO_NOME} letras, como está na conta).`;
const CIDADE_PIX_MESSAGE = `Informe a cidade do recebedor (até ${LIMITE_DA_CIDADE} letras).`;
export const CHAVE_PIX_INVALIDA = "A chave Pix não confere com o tipo escolhido.";

// A chave é guardada já no formato que o banco espera (`normalizarChave`). Nome
// e cidade ficam como foram digitados, dentro do limite do padrão; o acento sai
// só na hora de montar o código. O que sobra sem acento não pode ficar vazio.
const pix = z
  .object(
    {
      tipo: z.enum(TIPOS_DE_CHAVE, "Escolha o tipo da chave Pix."),
      chave: z.string("Informe a chave Pix.").trim().min(1, "Informe a chave Pix.").max(120, CHAVE_PIX_INVALIDA),
      nome: z
        .string(NOME_PIX_MESSAGE)
        .trim()
        .min(1, NOME_PIX_MESSAGE)
        .max(LIMITE_DO_NOME, NOME_PIX_MESSAGE)
        .refine((nome) => textoDoCodigo(nome, LIMITE_DO_NOME) !== "", NOME_PIX_MESSAGE),
      cidade: z
        .string(CIDADE_PIX_MESSAGE)
        .trim()
        .min(1, CIDADE_PIX_MESSAGE)
        .max(LIMITE_DA_CIDADE, CIDADE_PIX_MESSAGE)
        .refine((cidade) => textoDoCodigo(cidade, LIMITE_DA_CIDADE) !== "", CIDADE_PIX_MESSAGE),
    },
    INVALID_BODY,
  )
  .transform((dados, contexto) => {
    const chave = normalizarChave(dados.tipo, dados.chave);
    if (chave === null) {
      contexto.addIssue({ code: "custom", message: CHAVE_PIX_INVALIDA, path: ["chave"] });
      return z.NEVER;
    }
    return { ...dados, chave };
  });

/**
 * Parâmetros de cobrança da empresa: a multa (% do valor) e os juros (% ao
 * mês) que a baixa de um título vencido sugere (a conta está em
 * `encargosSugeridos`, src/lib/cobranca.ts), e o recebimento por Pix.
 *
 * `pix`: objeto cadastra ou troca a chave; `null` remove; ausente não mexe.
 */
export const parametrosDeCobrancaSchema = z.object({ multaPct: percentual, jurosPct: percentual, pix: pix.nullable().optional() }, INVALID_BODY);

/** Evento que a tela dispara depois de salvar, para o cabeçalho ler de novo. */
export const IDENTIDADE_ALTERADA = "tms:identidade-alterada";
