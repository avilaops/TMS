import { MAX_NEW_PHOTO_CHARS, PHOTO_MESSAGE, PHOTO_TOO_BIG } from "@/lib/comprovantes";

/**
 * Redução da foto no próprio aparelho, antes de ela sair dele. Foto de celular
 * tem vários megabytes; o comprovante precisa de uma imagem legível, não da
 * foto inteira. Reduzida, ela sobe rápido com sinal fraco e várias cabem na
 * fila offline.
 *
 * A conta das dimensões é função pura, testada sem navegador. A parte que
 * depende do navegador (abrir a imagem e desenhar no `canvas`) fica nas duas
 * funções pequenas do fim, que o teste troca.
 */

/** Maior lado da foto enviada, em pixels. */
export const LADO_MAXIMO = 1600;
/** Qualidade do JPEG, e a segunda tentativa quando a primeira ainda passa do teto. */
export const QUALIDADE = 0.7;
export const QUALIDADE_MENOR = 0.5;

export type Dimensoes = { largura: number; altura: number };

/**
 * As dimensões finais de uma imagem de `largura` × `altura`: o maior lado cai
 * para `maiorLado` mantendo a proporção. Imagem que já cabe não é ampliada.
 * Nenhum lado fica com menos de 1 pixel.
 */
export function dimensoesReduzidas(largura: number, altura: number, maiorLado: number = LADO_MAXIMO): Dimensoes {
  if (!(largura > 0) || !(altura > 0)) return { largura: 1, altura: 1 };
  const escala = Math.min(1, maiorLado / Math.max(largura, altura));
  return { largura: Math.max(1, Math.round(largura * escala)), altura: Math.max(1, Math.round(altura * escala)) };
}

/** A foto não serve: a mensagem é a que o motorista lê. */
export class FotoRecusada extends Error {}

/** A imagem aberta pelo navegador, com o que é preciso para desenhá-la. */
export type ImagemAberta = { largura: number; altura: number; fonte: CanvasImageSource; fechar: () => void };

export type Navegador = {
  /** Abre o arquivo como imagem. Rejeita quando o navegador não sabe ler o formato (HEIC sem suporte, arquivo que não é foto). */
  abrir: (arquivo: Blob) => Promise<ImagemAberta>;
  /** Desenha a imagem no tamanho pedido e devolve a data URL em JPEG, ou `null` se o navegador não desenhar. */
  desenhar: (imagem: ImagemAberta, dimensoes: Dimensoes, qualidade: number) => string | null;
};

/**
 * Reduz a foto e devolve a data URL em JPEG pronta para o envio. Foto que o
 * navegador não consegue abrir sai com a mensagem do formato; a que continua
 * grande demais mesmo reduzida (não deve acontecer com foto), com a do tamanho.
 */
export async function reduzirFoto(arquivo: Blob, navegador: Navegador = NAVEGADOR): Promise<string> {
  let imagem: ImagemAberta;
  try {
    imagem = await navegador.abrir(arquivo);
  } catch {
    throw new FotoRecusada(PHOTO_MESSAGE);
  }
  try {
    const dimensoes = dimensoesReduzidas(imagem.largura, imagem.altura);
    for (const qualidade of [QUALIDADE, QUALIDADE_MENOR]) {
      const dataUrl = navegador.desenhar(imagem, dimensoes, qualidade);
      // Navegador que não gera JPEG devolve PNG ou "data:,": não é o que o servidor espera.
      if (!dataUrl || !dataUrl.startsWith("data:image/jpeg;base64,")) throw new FotoRecusada(PHOTO_MESSAGE);
      if (dataUrl.length <= MAX_NEW_PHOTO_CHARS) return dataUrl;
    }
    throw new FotoRecusada(PHOTO_TOO_BIG);
  } finally {
    imagem.fechar();
  }
}

/* ------------------------- A parte que é do navegador ------------------------- */

// Pelo elemento <img>, e não por `createImageBitmap`: é ele que aplica, em todo
// navegador atual, a rotação gravada pela câmera (EXIF) na hora de desenhar.
function abrirNoNavegador(arquivo: Blob): Promise<ImagemAberta> {
  return new Promise((resolve, reject) => {
    const endereco = URL.createObjectURL(arquivo);
    const fechar = () => URL.revokeObjectURL(endereco);
    const img = new Image();
    img.onload = () => resolve({ largura: img.naturalWidth, altura: img.naturalHeight, fonte: img, fechar });
    img.onerror = () => {
      fechar();
      reject(new Error("imagem ilegível"));
    };
    img.src = endereco;
  });
}

function desenharNoNavegador(imagem: ImagemAberta, { largura, altura }: Dimensoes, qualidade: number): string | null {
  const tela = document.createElement("canvas");
  tela.width = largura;
  tela.height = altura;
  const contexto = tela.getContext("2d");
  if (!contexto) return null;
  // Fundo branco: PNG com transparência viraria preto no JPEG.
  contexto.fillStyle = "#fff";
  contexto.fillRect(0, 0, largura, altura);
  contexto.drawImage(imagem.fonte, 0, 0, largura, altura);
  return tela.toDataURL("image/jpeg", qualidade);
}

export const NAVEGADOR: Navegador = { abrir: abrirNoNavegador, desenhar: desenharNoNavegador };
