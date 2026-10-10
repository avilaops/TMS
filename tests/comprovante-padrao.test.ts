import { createHash } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getServerSession } from "next-auth";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DEVOLUCAO_NAO_ENCONTRADA,
  COMPROVANTE_DO_MOTORISTA_NAO_ENCONTRADO,
  FOTOS_DEMAIS,
  INSUCESSO_MOTIVO_MESSAGE,
  INSUCESSO_NOTE_MESSAGE,
  INSUCESSO_SEM_FACHADA,
  INSUCESSO_SO_FACHADA,
  LONGE_DO_ENDERECO_M,
  MAXIMO_DE_FOTOS,
  MAX_NEW_PHOTO_CHARS,
  PERFIL_MESSAGE,
  PHOTO_MESSAGE,
  PHOTO_TOO_BIG,
  RELACAO_MESSAGE,
  RESSALVA_NOTE_MESSAGE,
  RESSALVA_TIPO_MESSAGE,
  SEM_FOTO_NOVA,
  TIPO_DE_FOTO_MESSAGE,
  avisoDeDistancia,
  cabeMaisUma,
  distanciaEmMetros,
  ehInsucesso,
  enumerar,
  fotoExigida,
  fotosAtuais,
  fotosDoComprovante,
  fotosPorTipo,
  fotosSchema,
  insucessoPedeFachada,
  insucessoSchema,
  lerPerfil,
  mensagemDoQueFalta,
  oQueFaltaNasFotos,
  perfilDeComprovanteSchema,
  problemaNasFotos,
  problemaNoInsucesso,
  reenvioSchema,
  rotuloDaRelacao,
  rotuloDaSituacao,
  situacaoDaParada,
  textoDaDistancia,
  textoDasTentativas,
  tituloDoInsucesso,
} from "../src/lib/comprovantes";
import { DELIVERY_NOT_FOUND_MESSAGE, MAX_PHOTO_CHARS, NOT_IN_ROUTE_MESSAGE, baixaSchema, fotosDaBaixa } from "../src/lib/entregas";
import { FotoRecusada, LADO_MAXIMO, QUALIDADE, QUALIDADE_MENOR, dimensoesReduzidas, reduzirFoto, type Navegador } from "../src/lib/foto";
import {
  APARELHO_SEM_ESPACO,
  BAIXA_GRANDE_DEMAIS,
  BaixaNaoGuardada,
  FILA_INDISPONIVEL,
  TAMANHO_MAXIMO_DA_BAIXA,
  buildPending,
  ehFaltaDeEspaco,
  enqueue,
  flushQueue,
  tamanhoDaBaixa,
  type PendingBaixa,
} from "../src/lib/offline-queue";
import { EMPRESA_OUTRA, EMPRESA_PADRAO } from "./empresas-de-teste";

/**
 * Comprovante de entrega no padrão das grandes transportadoras: fotos por
 * tipo, quem recebeu, ressalva, perfil da empresa, distância do endereço,
 * devolução ao motorista com reenvio e tentativa de entrega sem sucesso.
 *
 * Primeiro as regras puras (sem banco); depois as rotas e as páginas, contra
 * um Postgres de verdade, no padrão de `driver.test.ts` (sessão simulada,
 * handlers reais). Sem DATABASE_URL a parte de integração é pulada com aviso.
 */
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));

const temBanco = Boolean(process.env.DATABASE_URL);

if (!temBanco) {
  console.warn(
    "\n[comprovante-padrao.test] DATABASE_URL ausente: testes de integração PULADOS.\n" +
      "Rode com um Postgres real para exercitá-los.\n",
  );
}

const suite = temBanco ? describe : describe.skip;

// Imagens mínimas: os primeiros bytes de um JPEG e de um PNG. Cada uma com um
// conteúdo, para o hash de uma não se confundir com o de outra.
const jpeg = (marca: string) => `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Buffer.from(marca)]).toString("base64")}`;
const FOTO_ENTREGA = jpeg("entrega");
const FOTO_CANHOTO = jpeg("canhoto");
const FOTO_AVARIA = jpeg("avaria");
const FOTO_FACHADA = jpeg("fachada");
const FOTO_NOVA = jpeg("canhoto-novo");
const ASSINATURA = "data:image/png;base64,iVBORw0KGgo=";

const sha256DosBytes = (dataUrl: string) => createHash("sha256").update(Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64")).digest("hex");
const sha256DoTexto = (dataUrl: string) => createHash("sha256").update(dataUrl.slice(dataUrl.indexOf(",") + 1)).digest("hex");

describe("fotos do comprovante: limites", () => {
  it("até 6 no total; 2 de entrega, 2 de canhoto, 2 de fachada e 3 de avaria", () => {
    expect(MAXIMO_DE_FOTOS).toBe(6);
    expect(problemaNasFotos([])).toBeNull();
    expect(problemaNasFotos(["ENTREGA", "ENTREGA", "CANHOTO", "CANHOTO", "AVARIA", "AVARIA"])).toBeNull();
    expect(problemaNasFotos(["AVARIA", "AVARIA", "AVARIA", "FACHADA", "FACHADA", "ENTREGA"])).toBeNull();

    expect(problemaNasFotos(["ENTREGA", "ENTREGA", "ENTREGA"])).toBe("Foto da entrega: no máximo 2 fotos.");
    expect(problemaNasFotos(["CANHOTO", "CANHOTO", "CANHOTO"])).toBe("Foto do canhoto: no máximo 2 fotos.");
    expect(problemaNasFotos(["FACHADA", "FACHADA", "FACHADA"])).toBe("Foto da fachada: no máximo 2 fotos.");
    expect(problemaNasFotos(["AVARIA", "AVARIA", "AVARIA", "AVARIA"])).toBe("Foto da avaria: no máximo 3 fotos.");
    expect(problemaNasFotos(["ENTREGA", "ENTREGA", "CANHOTO", "CANHOTO", "AVARIA", "AVARIA", "AVARIA"])).toBe(FOTOS_DEMAIS);
  });

  it("cabe mais uma: respeita o limite do tipo e o total", () => {
    expect(cabeMaisUma([], "ENTREGA")).toBe(true);
    expect(cabeMaisUma(["ENTREGA"], "ENTREGA")).toBe(true);
    expect(cabeMaisUma(["ENTREGA", "ENTREGA"], "ENTREGA")).toBe(false);
    expect(cabeMaisUma(["ENTREGA", "ENTREGA"], "CANHOTO")).toBe(true);
    expect(cabeMaisUma(["ENTREGA", "ENTREGA", "CANHOTO", "CANHOTO", "AVARIA", "AVARIA"], "AVARIA")).toBe(false);
  });

  it("lista de fotos: tipo conhecido, imagem embutida JPEG/PNG/WebP e teto de 1,5 milhão de caracteres por foto", () => {
    const erro = (fotos: unknown) => fotosSchema.safeParse(fotos).error?.issues[0].message;
    const noLimite = `data:image/jpeg;base64,${"A".repeat(MAX_NEW_PHOTO_CHARS - "data:image/jpeg;base64,".length)}`;

    expect(MAX_NEW_PHOTO_CHARS).toBe(1_500_000);
    expect(MAX_NEW_PHOTO_CHARS).toBeLessThan(MAX_PHOTO_CHARS);
    expect(fotosSchema.safeParse([]).success).toBe(true);
    expect(fotosSchema.safeParse([{ kind: "ENTREGA", dataUrl: noLimite }]).success).toBe(true);
    expect(fotosSchema.safeParse([{ kind: "CANHOTO", dataUrl: "data:image/webp;base64,AAAA" }]).success).toBe(true);

    expect(erro([{ kind: "ENTREGA", dataUrl: `${noLimite}A` }])).toBe(PHOTO_TOO_BIG);
    expect(erro([{ kind: "SELFIE", dataUrl: FOTO_ENTREGA }])).toBe(TIPO_DE_FOTO_MESSAGE);
    expect(erro([{ kind: "ENTREGA", dataUrl: "https://exemplo.br/foto.jpg" }])).toBe(PHOTO_MESSAGE);
    expect(erro([{ kind: "ENTREGA", dataUrl: "data:text/html;base64,PHNjcmlwdD4=" }])).toBe(PHOTO_MESSAGE);
    expect(erro([{ kind: "ENTREGA", dataUrl: "data:image/svg+xml;base64,PHN2Zz4=" }])).toBe(PHOTO_MESSAGE);
    expect(erro([{ kind: "ENTREGA", dataUrl: "data:image/heic;base64,AAAA" }])).toBe(PHOTO_MESSAGE);
    expect(erro(Array.from({ length: 7 }, () => ({ kind: "AVARIA", dataUrl: FOTO_AVARIA })))).toBe(FOTOS_DEMAIS);
    expect(erro(Array.from({ length: 3 }, () => ({ kind: "ENTREGA", dataUrl: FOTO_ENTREGA })))).toBe("Foto da entrega: no máximo 2 fotos.");
  });
});

describe("perfil da empresa: o que cada um exige", () => {
  it("LIVRE não exige foto; ECOMMERCE exige a da entrega; B2B exige a do canhoto", () => {
    expect(fotoExigida("LIVRE")).toBeNull();
    expect(fotoExigida("ECOMMERCE")).toBe("ENTREGA");
    expect(fotoExigida("B2B")).toBe("CANHOTO");

    expect(oQueFaltaNasFotos("LIVRE", [], null)).toEqual([]);
    expect(oQueFaltaNasFotos("ECOMMERCE", [], null)).toEqual(["a foto da entrega"]);
    expect(oQueFaltaNasFotos("ECOMMERCE", ["CANHOTO"], null)).toEqual(["a foto da entrega"]);
    expect(oQueFaltaNasFotos("ECOMMERCE", ["ENTREGA"], null)).toEqual([]);
    expect(oQueFaltaNasFotos("B2B", ["ENTREGA"], null)).toEqual(["a foto do canhoto assinado"]);
    expect(oQueFaltaNasFotos("B2B", ["CANHOTO"], null)).toEqual([]);
  });

  it("ressalva de avaria ou de embalagem violada pede a foto da avaria, em qualquer perfil; falta e outra, não", () => {
    for (const perfil of ["LIVRE", "ECOMMERCE", "B2B"] as const) {
      const doPerfil = oQueFaltaNasFotos(perfil, ["ENTREGA", "CANHOTO"], null);
      expect(doPerfil, perfil).toEqual([]);
      expect(oQueFaltaNasFotos(perfil, ["ENTREGA", "CANHOTO"], "AVARIA"), perfil).toEqual(["a foto da avaria"]);
      expect(oQueFaltaNasFotos(perfil, ["ENTREGA", "CANHOTO"], "VIOLADA"), perfil).toEqual(["a foto da avaria"]);
      expect(oQueFaltaNasFotos(perfil, ["ENTREGA", "CANHOTO", "AVARIA"], "AVARIA"), perfil).toEqual([]);
      expect(oQueFaltaNasFotos(perfil, ["ENTREGA", "CANHOTO"], "FALTA"), perfil).toEqual([]);
      expect(oQueFaltaNasFotos(perfil, ["ENTREGA", "CANHOTO"], "OUTRA"), perfil).toEqual([]);
    }
    expect(oQueFaltaNasFotos("B2B", [], "AVARIA")).toEqual(["a foto do canhoto assinado", "a foto da avaria"]);
  });

  it("a mensagem diz o que falta; sem nada faltando, não há mensagem", () => {
    expect(mensagemDoQueFalta([])).toBeNull();
    expect(mensagemDoQueFalta(["a foto do canhoto assinado"])).toBe("Falta a foto do canhoto assinado.");
    expect(mensagemDoQueFalta(["a foto do canhoto assinado", "a foto da avaria"])).toBe("Falta a foto do canhoto assinado e a foto da avaria.");
    expect(enumerar(["a", "b", "c"])).toBe("a, b e c");
  });

  it("perfil desconhecido ou ausente vale LIVRE; a rota só aceita os três", () => {
    expect(lerPerfil("B2B")).toBe("B2B");
    expect(lerPerfil("ECOMMERCE")).toBe("ECOMMERCE");
    for (const valor of [null, undefined, "", "b2b", "QUALQUER"]) expect(lerPerfil(valor), String(valor)).toBe("LIVRE");

    expect(perfilDeComprovanteSchema.parse({ perfil: "B2B" })).toEqual({ perfil: "B2B" });
    for (const corpo of [{}, { perfil: "b2b" }, { perfil: "" }, { perfil: 1 }, null]) {
      expect(perfilDeComprovanteSchema.safeParse(corpo).success, JSON.stringify(corpo)).toBe(false);
    }
    expect(perfilDeComprovanteSchema.safeParse({ perfil: "X" }).error?.issues[0].message).toBe(PERFIL_MESSAGE);
  });
});

describe("corpo da baixa: formato atual e formato antigo", () => {
  const base = { receiverName: "Maria Recebedora", receiverDoc: "123.456.789-00" };
  const erro = (corpo: unknown) => baixaSchema.safeParse(corpo).error?.issues[0].message;

  it("formato atual (com `photos`): quem recebeu é obrigatório", () => {
    expect(erro({ ...base, photos: [] })).toBe(RELACAO_MESSAGE);
    expect(erro({ ...base, photos: [], receiverRelation: "CUNHADO" })).toBe(RELACAO_MESSAGE);
    for (const relacao of ["DESTINATARIO", "FUNCIONARIO", "PORTARIA", "FAMILIAR", "VIZINHO", "OUTRO"]) {
      expect(baixaSchema.safeParse({ ...base, photos: [], receiverRelation: relacao }).success, relacao).toBe(true);
    }
  });

  it("formato antigo (sem `photos`, de baixa guardada na fila por versão anterior): vale sem a relação, e a foto conta como foto da entrega", () => {
    const antiga = baixaSchema.parse({ ...base, photoBase64: FOTO_ENTREGA });
    expect(antiga.receiverRelation ?? null).toBeNull();
    expect(fotosDaBaixa(antiga)).toEqual([{ kind: "ENTREGA", dataUrl: FOTO_ENTREGA }]);
    expect(fotosDaBaixa(baixaSchema.parse(base))).toEqual([]);
    expect(fotosDaBaixa(baixaSchema.parse({ ...base, photoBase64: "" }))).toEqual([]);
  });

  it("ressalva: tipo da lista e descrição de 5 a 500 caracteres; `null` é entrega sem ressalva", () => {
    const com = (exception: unknown) => ({ ...base, receiverRelation: "PORTARIA", photos: [], exception });
    expect(baixaSchema.parse(com(null)).exception).toBeNull();
    expect(baixaSchema.parse(com({ type: "FALTA", note: "  Faltou 1 volume  " })).exception).toEqual({ type: "FALTA", note: "Faltou 1 volume" });
    expect(erro(com({ type: "SUMIU", note: "Faltou 1 volume" }))).toBe(RESSALVA_TIPO_MESSAGE);
    expect(erro(com({ type: "AVARIA", note: "abc" }))).toBe(RESSALVA_NOTE_MESSAGE);
    expect(erro(com({ type: "AVARIA", note: "x".repeat(501) }))).toBe(RESSALVA_NOTE_MESSAGE);
    expect(erro(com({ type: "AVARIA" }))).toBe(RESSALVA_NOTE_MESSAGE);
  });

  it("o limite de fotos soma a do formato antigo com as novas", () => {
    const duas = [
      { kind: "ENTREGA", dataUrl: FOTO_ENTREGA },
      { kind: "ENTREGA", dataUrl: FOTO_ENTREGA },
    ];
    expect(baixaSchema.safeParse({ ...base, receiverRelation: "OUTRO", photos: duas }).success).toBe(true);
    expect(erro({ ...base, receiverRelation: "OUTRO", photos: duas, photoBase64: FOTO_ENTREGA })).toBe("Foto da entrega: no máximo 2 fotos.");
  });
});

describe("redução da foto no aparelho", () => {
  it("o maior lado cai para 1600 px mantendo a proporção; foto que já cabe não é ampliada", () => {
    expect(LADO_MAXIMO).toBe(1600);
    expect(dimensoesReduzidas(4000, 3000)).toEqual({ largura: 1600, altura: 1200 });
    expect(dimensoesReduzidas(3000, 4000)).toEqual({ largura: 1200, altura: 1600 });
    expect(dimensoesReduzidas(4032, 3024)).toEqual({ largura: 1600, altura: 1200 });
    expect(dimensoesReduzidas(1600, 1600)).toEqual({ largura: 1600, altura: 1600 });
    expect(dimensoesReduzidas(1600, 900)).toEqual({ largura: 1600, altura: 900 });
    expect(dimensoesReduzidas(800, 600)).toEqual({ largura: 800, altura: 600 });
    expect(dimensoesReduzidas(1601, 1)).toEqual({ largura: 1600, altura: 1 });
  });

  it("panorâmica muito estreita não fica com lado zero; medida inválida vira 1 × 1", () => {
    expect(dimensoesReduzidas(16000, 2)).toEqual({ largura: 1600, altura: 1 });
    expect(dimensoesReduzidas(0, 0)).toEqual({ largura: 1, altura: 1 });
    expect(dimensoesReduzidas(Number.NaN, 100)).toEqual({ largura: 1, altura: 1 });
    expect(dimensoesReduzidas(-5, 100)).toEqual({ largura: 1, altura: 1 });
  });

  it("outro teto de lado pode ser pedido", () => {
    expect(dimensoesReduzidas(1000, 500, 100)).toEqual({ largura: 100, altura: 50 });
  });

  // O navegador de mentira: diz o tamanho da imagem e o que o `canvas` devolveria.
  function navegador(desenhos: (string | null)[], abrir: () => Promise<{ largura: number; altura: number }> = async () => ({ largura: 4000, altura: 3000 })) {
    const pedidos: { largura: number; altura: number; qualidade: number }[] = [];
    let fechadas = 0;
    const falso: Navegador = {
      abrir: async () => ({ ...(await abrir()), fonte: {} as CanvasImageSource, fechar: () => void (fechadas += 1) }),
      desenhar: (_imagem, dimensoes, qualidade) => {
        pedidos.push({ ...dimensoes, qualidade });
        return desenhos.shift() ?? null;
      },
    };
    return { falso, pedidos, fechadas: () => fechadas };
  }
  const arquivo = new Blob([new Uint8Array([1, 2, 3])]);
  const grande = `data:image/jpeg;base64,${"A".repeat(MAX_NEW_PHOTO_CHARS)}`;

  it("devolve o JPEG reduzido, desenhado em 1600 px com qualidade 0,7, e solta a imagem", async () => {
    const { falso, pedidos, fechadas } = navegador([FOTO_ENTREGA]);
    expect(await reduzirFoto(arquivo, falso)).toBe(FOTO_ENTREGA);
    expect(pedidos).toEqual([{ largura: 1600, altura: 1200, qualidade: QUALIDADE }]);
    expect(QUALIDADE).toBe(0.7);
    expect(fechadas()).toBe(1);
  });

  it("foto que o navegador não consegue abrir (HEIC sem suporte) → a mensagem do formato", async () => {
    const { falso, pedidos } = navegador([], async () => {
      throw new Error("imagem ilegível");
    });
    await expect(reduzirFoto(arquivo, falso)).rejects.toThrow(PHOTO_MESSAGE);
    await expect(reduzirFoto(arquivo, falso)).rejects.toBeInstanceOf(FotoRecusada);
    expect(pedidos).toEqual([]);
  });

  it("ainda grande demais com qualidade 0,7 → tenta de novo com 0,5; se continuar, a mensagem do tamanho", async () => {
    const segunda = navegador([grande, FOTO_ENTREGA]);
    expect(await reduzirFoto(arquivo, segunda.falso)).toBe(FOTO_ENTREGA);
    expect(segunda.pedidos.map((p) => p.qualidade)).toEqual([QUALIDADE, QUALIDADE_MENOR]);

    const nenhuma = navegador([grande, grande]);
    await expect(reduzirFoto(arquivo, nenhuma.falso)).rejects.toThrow(PHOTO_TOO_BIG);
    expect(nenhuma.fechadas()).toBe(1);
  });

  it("navegador que não desenha, ou que devolve outra coisa que não JPEG → a mensagem do formato", async () => {
    await expect(reduzirFoto(arquivo, navegador([null]).falso)).rejects.toThrow(PHOTO_MESSAGE);
    await expect(reduzirFoto(arquivo, navegador(["data:,"]).falso)).rejects.toThrow(PHOTO_MESSAGE);
    await expect(reduzirFoto(arquivo, navegador(["data:image/png;base64,AAAA"]).falso)).rejects.toThrow(PHOTO_MESSAGE);
  });
});

describe("fila offline com várias fotos", () => {
  const seisFotos = (tamanho: number) => ({
    receiverName: "Maria",
    receiverDoc: "12345",
    receiverRelation: "PORTARIA",
    photos: Array.from({ length: 6 }, () => ({ kind: "AVARIA", dataUrl: `data:image/jpeg;base64,${"A".repeat(tamanho)}` })),
    signatureBase64: ASSINATURA,
  });

  it("o tamanho da baixa é o do corpo que vai para o servidor", () => {
    const payload = { receiverName: "Maria", photos: [{ kind: "ENTREGA", dataUrl: FOTO_ENTREGA }] };
    expect(tamanhoDaBaixa(payload)).toBe(JSON.stringify(payload).length);
  });

  it("seis fotos no teto de cada uma, com assinatura, cabem na fila", async () => {
    const payload = seisFotos(MAX_NEW_PHOTO_CHARS - 30);
    expect(tamanhoDaBaixa(payload)).toBeLessThanOrEqual(TAMANHO_MAXIMO_DA_BAIXA);

    const guardados: PendingBaixa[] = [];
    const item = await enqueue("coleta-1", payload, "user-ana", async (pendente) => void guardados.push(pendente));
    expect(guardados).toEqual([item]);
    expect(item).toMatchObject({ id: "user-ana:coleta-1", collectionId: "coleta-1", userId: "user-ana" });
    expect(item.payload).toBe(payload);
  });

  it("baixa maior que o teto não entra na fila: erro com a mensagem para o motorista, sem gravar", async () => {
    const guardar = vi.fn(async () => undefined);
    const payload = seisFotos(Math.ceil(TAMANHO_MAXIMO_DA_BAIXA / 6));
    const tentativa = enqueue("coleta-1", payload, "user-ana", guardar);
    await expect(tentativa).rejects.toBeInstanceOf(BaixaNaoGuardada);
    await expect(tentativa).rejects.toThrow(BAIXA_GRANDE_DEMAIS);
    expect(guardar).not.toHaveBeenCalled();
  });

  it("aparelho sem espaço: a gravação falha com aviso claro, em vez de dizer que guardou", async () => {
    const semEspaco = Object.assign(new Error("quota"), { name: "QuotaExceededError" });
    const tentativa = enqueue("coleta-1", seisFotos(10), "user-ana", async () => {
      throw semEspaco;
    });
    await expect(tentativa).rejects.toBeInstanceOf(BaixaNaoGuardada);
    await expect(tentativa).rejects.toThrow(APARELHO_SEM_ESPACO);
    expect(APARELHO_SEM_ESPACO).toContain("NÃO foi salva");

    expect(ehFaltaDeEspaco(semEspaco)).toBe(true);
    expect(ehFaltaDeEspaco({ name: "NS_ERROR_DOM_QUOTA_REACHED" })).toBe(true);
    for (const outro of [new Error("x"), null, undefined, "QuotaExceededError"]) expect(ehFaltaDeEspaco(outro)).toBe(false);
  });

  it("outra falha do armazenamento (navegação privada, banco bloqueado) também avisa", async () => {
    const tentativa = enqueue("coleta-1", seisFotos(10), null, async () => {
      throw new Error("InvalidStateError");
    });
    await expect(tentativa).rejects.toThrow(FILA_INDISPONIVEL);
  });

  it("o reenvio manda a baixa com todas as fotos, como foi guardada, e a tira da fila", async () => {
    const payload = seisFotos(100);
    const item = buildPending("coleta-1", payload, "user-ana", 1);
    const enviados: unknown[] = [];
    const removidos: string[] = [];
    const resultado = await flushQueue("user-ana", {
      list: async () => [item],
      send: async (pendente) => {
        enviados.push(pendente.payload);
        return { status: 200, json: async () => ({}) };
      },
      remove: async (id) => void removidos.push(id),
    });
    expect(resultado).toMatchObject({ sent: 1, stillPending: 0, rejected: [] });
    expect(enviados).toEqual([payload]);
    expect(removidos).toEqual([item.id]);
  });
});

describe("distância do endereço", () => {
  // Um grau de latitude tem cerca de 111,2 km.
  const destino = { deliveryLat: -20.8, deliveryLon: -49.38 };

  it("em metros inteiros, pela linha reta; nula sem posição ou sem coordenada", () => {
    expect(distanciaEmMetros({ latitude: -20.8, longitude: -49.38 }, destino)).toBe(0);
    const umCentesimo = distanciaEmMetros({ latitude: -20.81, longitude: -49.38 }, destino);
    expect(umCentesimo).toBeGreaterThan(1100);
    expect(umCentesimo).toBeLessThan(1125);
    expect(Number.isInteger(umCentesimo)).toBe(true);

    expect(distanciaEmMetros({ latitude: null, longitude: null }, destino)).toBeNull();
    expect(distanciaEmMetros({ latitude: -20.8, longitude: undefined }, destino)).toBeNull();
    expect(distanciaEmMetros({ latitude: -20.8, longitude: -49.38 }, { deliveryLat: null, deliveryLon: null })).toBeNull();
    expect(distanciaEmMetros({ latitude: -20.8, longitude: -49.38 }, {})).toBeNull();
  });

  it("o painel só avisa acima de 500 m, em metros ou em quilômetros", () => {
    expect(LONGE_DO_ENDERECO_M).toBe(500);
    for (const perto of [null, undefined, 0, 120, 500]) expect(avisoDeDistancia(perto), String(perto)).toBeNull();
    expect(avisoDeDistancia(501)).toBe("a 501 m do endereço");
    expect(avisoDeDistancia(999)).toBe("a 999 m do endereço");
    expect(avisoDeDistancia(1000)).toBe("a 1 km do endereço");
    expect(avisoDeDistancia(1249)).toBe("a 1,2 km do endereço");
    expect(avisoDeDistancia(12_600)).toBe("a 13 km do endereço");
    expect(textoDaDistancia(9_949)).toBe("9,9 km");
  });
});

describe("tentativa de entrega sem sucesso: regras", () => {
  const erro = (corpo: unknown) => insucessoSchema.safeParse(corpo).error?.issues[0].message;

  it("motivo padronizado; a descrição só é obrigatória em OUTRO", () => {
    for (const reason of ["AUSENTE", "ENDERECO_NAO_LOCALIZADO", "RECUSADO", "FECHADO", "MUDOU_SE", "AREA_DE_RISCO"]) {
      expect(insucessoSchema.safeParse({ reason }).success, reason).toBe(true);
    }
    expect(erro({ reason: "PREGUICA" })).toBe(INSUCESSO_MOTIVO_MESSAGE);
    expect(erro({ reason: "" })).toBe(INSUCESSO_MOTIVO_MESSAGE);
    expect(erro({ reason: "OUTRO" })).toBe(INSUCESSO_NOTE_MESSAGE);
    expect(erro({ reason: "OUTRO", note: "  ab  " })).toBe(INSUCESSO_NOTE_MESSAGE);
    expect(insucessoSchema.parse({ reason: "OUTRO", note: "  Rua interditada  " })).toMatchObject({ reason: "OUTRO", note: "Rua interditada" });
    expect(erro({ reason: "AUSENTE", note: "x".repeat(501) })).toBe(INSUCESSO_NOTE_MESSAGE);
    // Observação em branco é ausência de observação.
    expect(insucessoSchema.parse({ reason: "AUSENTE", note: "   " }).note ?? null).toBeNull();
  });

  it("a foto é só a da fachada, validada como as do comprovante", () => {
    expect(insucessoSchema.safeParse({ reason: "AUSENTE", photos: [{ kind: "FACHADA", dataUrl: FOTO_FACHADA }] }).success).toBe(true);
    expect(erro({ reason: "AUSENTE", photos: [{ kind: "ENTREGA", dataUrl: FOTO_ENTREGA }] })).toBe(INSUCESSO_SO_FACHADA);
    expect(erro({ reason: "AUSENTE", photos: [{ kind: "FACHADA", dataUrl: "https://exemplo.br/f.jpg" }] })).toBe(PHOTO_MESSAGE);
    expect(erro({ reason: "AUSENTE", photos: Array.from({ length: 3 }, () => ({ kind: "FACHADA", dataUrl: FOTO_FACHADA })) })).toBe("Foto da fachada: no máximo 2 fotos.");
  });

  it("a fachada é obrigatória com perfil ECOMMERCE ou B2B, e opcional no LIVRE", () => {
    expect(insucessoPedeFachada("LIVRE")).toBe(false);
    expect(insucessoPedeFachada("ECOMMERCE")).toBe(true);
    expect(insucessoPedeFachada("B2B")).toBe(true);
    expect(problemaNoInsucesso("LIVRE", [])).toBeNull();
    expect(problemaNoInsucesso("ECOMMERCE", [])).toBe(INSUCESSO_SEM_FACHADA);
    expect(problemaNoInsucesso("B2B", [])).toBe(INSUCESSO_SEM_FACHADA);
    expect(problemaNoInsucesso("B2B", ["FACHADA"])).toBeNull();
  });

  it("o corpo com `reason` é tentativa sem sucesso; o da ocorrência comum, não", () => {
    expect(ehInsucesso({ reason: "AUSENTE" })).toBe(true);
    expect(ehInsucesso({ reason: null })).toBe(true);
    for (const corpo of [{ type: "DAMAGE", description: "x" }, {}, null, [], "reason", 7]) expect(ehInsucesso(corpo), JSON.stringify(corpo)).toBe(false);
  });

  it("título do chamado e texto do contador", () => {
    expect(tituloDoInsucesso("AUSENTE", "Loja Centro")).toBe("Entrega não realizada (Ausente): Loja Centro");
    expect(tituloDoInsucesso("ENDERECO_NAO_LOCALIZADO", "x".repeat(200)).length).toBe(120);
    expect(textoDasTentativas(1)).toBe("1 tentativa sem sucesso");
    expect(textoDasTentativas(3)).toBe("3 tentativas sem sucesso");
  });
});

describe("situação da parada na viagem do motorista", () => {
  it("pendente, tentativa sem sucesso (com o número), entregue, entregue com ressalva e comprovante para refazer", () => {
    expect(situacaoDaParada({ status: "ROUTE" })).toBe("PENDENTE");
    expect(situacaoDaParada({ status: "ROUTE", attempts: 0 })).toBe("PENDENTE");
    expect(situacaoDaParada({ status: "ROUTE", attempts: 2 })).toBe("INSUCESSO");
    expect(situacaoDaParada({ status: "DELIVERED", proofStatus: "SUBMITTED" })).toBe("ENTREGUE");
    expect(situacaoDaParada({ status: "DELIVERED", proofStatus: "APPROVED", withException: true })).toBe("RESSALVA");
    expect(situacaoDaParada({ status: "DELIVERED", proofStatus: "REJECTED", withException: true })).toBe("REFAZER");
    // Entregue depois de tentativas: vale a entrega. Baixa pelo painel (sem comprovante): entregue.
    expect(situacaoDaParada({ status: "DELIVERED", proofStatus: "SUBMITTED", attempts: 2 })).toBe("ENTREGUE");
    expect(situacaoDaParada({ status: "DELIVERED", proofStatus: null })).toBe("ENTREGUE");

    expect(rotuloDaSituacao({ status: "ROUTE" })).toBe("Pendente");
    expect(rotuloDaSituacao({ status: "ROUTE", attempts: 1 })).toBe("1 tentativa sem sucesso");
    expect(rotuloDaSituacao({ status: "ROUTE", attempts: 3 })).toBe("3 tentativas sem sucesso");
    expect(rotuloDaSituacao({ status: "DELIVERED", proofStatus: "SUBMITTED" })).toBe("Entregue");
    expect(rotuloDaSituacao({ status: "DELIVERED", withException: true })).toBe("Entregue com ressalva");
    expect(rotuloDaSituacao({ status: "DELIVERED", proofStatus: "REJECTED" })).toBe("Comprovante para refazer");
  });
});

describe("fotos na tela: comprovante antigo e fotos substituídas", () => {
  const criadoEm = new Date("2026-05-01T12:00:00Z");

  it("comprovante antigo (uma foto em `photoBase64`, sem tipo) aparece como uma foto da entrega, sem hash", () => {
    expect(fotosDoComprovante({ photoBase64: FOTO_ENTREGA, createdAt: criadoEm })).toEqual([
      { id: "antiga", kind: "ENTREGA", dataUrl: FOTO_ENTREGA, sha256: null, createdAt: criadoEm, replacedAt: null },
    ]);
    // Só o base64, como gravavam as primeiras baixas.
    expect(fotosDoComprovante({ photoBase64: "QUJD", createdAt: criadoEm })[0].dataUrl).toBe("data:image/jpeg;base64,QUJD");
    expect(fotosDoComprovante({ photoBase64: null, createdAt: criadoEm })).toEqual([]);
  });

  it("junta a antiga com as novas, separa as substituídas e agrupa por tipo", () => {
    const nova = (id: string, kind: string, replacedAt: Date | null = null) => ({ id, kind, dataUrl: FOTO_CANHOTO, sha256: "abc", createdAt: criadoEm, replacedAt });
    const todas = fotosDoComprovante({
      photoBase64: FOTO_ENTREGA,
      createdAt: criadoEm,
      photos: [nova("1", "CANHOTO", criadoEm), nova("2", "CANHOTO"), nova("3", "AVARIA"), nova("4", "DESCONHECIDO")],
    });
    expect(todas.map((foto) => foto.id)).toEqual(["antiga", "1", "2", "3"]);
    expect(fotosAtuais(todas).map((foto) => foto.id)).toEqual(["antiga", "2", "3"]);
    expect(fotosPorTipo(fotosAtuais(todas)).map((grupo) => [grupo.tipo, grupo.fotos.length])).toEqual([
      ["ENTREGA", 1],
      ["CANHOTO", 1],
      ["AVARIA", 1],
    ]);
  });

  it("relação de quem recebeu: rótulo em português; nula no comprovante antigo", () => {
    expect(rotuloDaRelacao("PORTARIA")).toBe("Portaria");
    expect(rotuloDaRelacao("DESTINATARIO")).toBe("Destinatário");
    for (const sem of [null, undefined, "", "CUNHADO"]) expect(rotuloDaRelacao(sem)).toBeNull();
  });
});

describe("reenvio de comprovante devolvido: corpo", () => {
  it("exige a devolução respondida e pelo menos uma foto; nome e documento são opcionais", () => {
    const erro = (corpo: unknown) => reenvioSchema.safeParse(corpo).error?.issues[0].message;
    const fotos = [{ kind: "CANHOTO", dataUrl: FOTO_NOVA }];
    expect(reenvioSchema.parse({ rejectionId: "r1", photos: fotos })).toEqual({ rejectionId: "r1", photos: fotos });
    expect(reenvioSchema.parse({ rejectionId: "r1", photos: fotos, receiverName: "", receiverDoc: "  " })).toEqual({ rejectionId: "r1", photos: fotos });
    expect(reenvioSchema.parse({ rejectionId: "r1", photos: fotos, receiverName: " João Lima " }).receiverName).toBe("João Lima");
    expect(erro({ rejectionId: "r1", photos: [] })).toBe(SEM_FOTO_NOVA);
    expect(erro({ photos: fotos })).toBe("Dados inválidos.");
    expect(erro({ rejectionId: "r1", photos: fotos, receiverName: "J" })).toBe("Informe o nome de quem recebeu (2 a 120 caracteres).");
    expect(erro({ rejectionId: "r1", photos: fotos, receiverDoc: "123" })).toBe("Informe o documento de quem recebeu (5 a 20 caracteres).");
  });
});

/* ============================ Rotas, com o banco ============================ */

const PREFIXO = "teste-pod-";
const CNPJ_TESTE = "99123987000155";
const CPF_PREFIXO = "99911122";
const PLACA_PREFIXO = "TPD";
const HASH_FALSO = "$2b$10$hashfalsoparateste000000000000000000000000000000000";
const SEM_ID = "00000000-0000-0000-0000-000000000000";
const MOTIVO = "Canhoto ilegível: tire outra foto, de perto.";

suite("comprovante no padrão das grandes transportadoras", () => {
  let banco: typeof import("../src/lib/prisma");
  let prisma: typeof import("../src/lib/prisma").default;
  let baixaRota: typeof import("../src/app/api/driver/entregas/[id]/baixa/route");
  let ocorrenciaRota: typeof import("../src/app/api/driver/entregas/[id]/ocorrencia/route");
  let refazerRota: typeof import("../src/app/api/driver/entregas/[id]/refazer/route");
  let doMotorista: typeof import("../src/app/api/driver/comprovantes/route");
  let viagensDoMotorista: typeof import("../src/app/api/driver/manifestos/route");
  let fila: typeof import("../src/app/api/comprovantes/route");
  let conferirRota: typeof import("../src/app/api/comprovantes/[id]/conferir/route");
  let empresaRota: typeof import("../src/app/api/empresa/comprovantes/route");
  let portalRota: typeof import("../src/app/api/portal/coletas/[id]/route");
  let manifestos: typeof import("../src/app/api/manifestos/route");
  let liberar: typeof import("../src/app/api/manifestos/[id]/liberar/route");
  let finalizar: typeof import("../src/app/api/manifestos/[id]/finalizar/route");
  let coletasRota: typeof import("../src/app/api/coletas/route");
  let comprovantePagina: typeof import("../src/app/dashboard/entregas/[id]/comprovante/page");
  let tentativasPagina: typeof import("../src/app/dashboard/entregas/[id]/tentativas/page");
  let sha256DaImagem: typeof import("../src/lib/comprovantes-db").sha256DaImagem;

  let operadorId: string;
  let adminId: string;
  let comercialId: string;
  let usuarioClienteId: string;
  let clienteId: string;

  const sessao = vi.mocked(getServerSession);
  const entrar = (id: string, role: string, clientId: string | null = null) => sessao.mockResolvedValue({ user: { id, role, clientId } });
  const comoOperador = () => entrar(operadorId, "OPERATION");
  const comoAdmin = () => entrar(adminId, "ADMIN");
  const comoMotorista = (userId: string) => entrar(userId, "DRIVER");

  const req = (method = "GET", body?: unknown) =>
    new Request("http://localhost/api/teste", {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const email = (nome: string) => `${PREFIXO}${nome}@exemplo.br`;

  const foto = (kind: string, dataUrl: string) => ({ kind, dataUrl });
  /** Corpo da baixa no formato atual. */
  const corpo = (extra: Record<string, unknown> = {}) => ({
    receiverName: "Maria Recebedora",
    receiverDoc: "123.456.789-00",
    receiverRelation: "PORTARIA",
    photos: [foto("ENTREGA", FOTO_ENTREGA), foto("CANHOTO", FOTO_CANHOTO)],
    signatureBase64: ASSINATURA,
    exception: null,
    latitude: -20.8113,
    longitude: -49.3758,
    ...extra,
  });

  const montar = (extra: Record<string, unknown> = {}) =>
    prisma.collection.create({
      data: { clientId: clienteId, sender: "Remetente Teste", receiver: "Destinatário Teste", origin: "Origem - SP", destination: "Destino - SP", volumes: 1, weight: 1, status: "COLLECTED", ...extra },
    });

  let serie = 0;
  async function criarMotorista() {
    serie += 1;
    const n = String(serie).padStart(3, "0");
    const user = await prisma.user.create({ data: { name: `Motorista POD ${n}`, email: email(`motorista-${n}`), password: HASH_FALSO, role: "DRIVER" } });
    const driver = await prisma.driver.create({ data: { userId: user.id, cpf: `${CPF_PREFIXO}${n}`, cnh: "12345678900", cnhExpiry: new Date("2031-06-30"), category: "D" } });
    const veiculo = await prisma.vehicle.create({ data: { plate: `${PLACA_PREFIXO}9${n}`, model: "Teste", type: "VAN" } });
    return { driverId: driver.id, userId: user.id, name: user.name, vehicleId: veiculo.id };
  }

  /** Viagem em rota, com as cargas, pela rota de verdade. */
  async function viagem(quantas = 1, extraDaCarga: Record<string, unknown> = {}) {
    const cargas = [];
    for (let i = 0; i < quantas; i += 1) cargas.push(await montar(extraDaCarga));
    const motorista = await criarMotorista();
    comoOperador();
    const criada = await manifestos.POST(req("POST", { driverId: motorista.driverId, vehicleId: motorista.vehicleId, collectionIds: cargas.map((c) => c.id) }));
    expect(criada.status).toBe(201);
    const id = (await criada.json()).id as string;
    expect((await liberar.POST(req("POST"), ctx(id))).status).toBe(200);
    return { id, cargas, ...motorista };
  }

  async function baixarComo(userId: string, collectionId: string, body: unknown = corpo()) {
    comoMotorista(userId);
    return baixaRota.POST(req("POST", body), ctx(collectionId));
  }

  /** Carga entregue, com o comprovante que a baixa de verdade gravou. */
  async function entregue(body: unknown = corpo(), extraDaCarga: Record<string, unknown> = {}) {
    const v = await viagem(1, extraDaCarga);
    const res = await baixarComo(v.userId, v.cargas[0].id, body);
    expect(res.status).toBe(200);
    const { proofId } = (await res.json()) as { proofId: string };
    return { ...v, collectionId: v.cargas[0].id, proofId };
  }

  async function devolver(collectionId: string, reason = MOTIVO) {
    comoOperador();
    const res = await conferirRota.POST(req("POST", { decision: "REJECTED", reason }), ctx(collectionId));
    expect(res.status).toBe(200);
    const devolucao = await prisma.proofRejection.findFirstOrThrow({ where: { proof: { collectionId }, resubmittedAt: null } });
    return devolucao.id;
  }

  async function refazerComo(userId: string, collectionId: string, body: unknown) {
    comoMotorista(userId);
    return refazerRota.POST(req("POST", body), ctx(collectionId));
  }

  async function registrarComo(userId: string, collectionId: string, body: unknown) {
    comoMotorista(userId);
    return ocorrenciaRota.POST(req("POST", body), ctx(collectionId));
  }

  const comprovante = (collectionId: string) => prisma.proofOfDelivery.findUniqueOrThrow({ where: { collectionId } });
  const fotosDe = (proofId: string) => prisma.proofPhoto.findMany({ where: { proofId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const tentativasDe = (collectionId: string) => prisma.deliveryAttempt.findMany({ where: { collectionId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const avisosDe = async (userId: string) => (await prisma.notification.findMany({ where: { userId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] })).map((aviso) => aviso.type);
  const auditoria = (action: string, entityId: string) => prisma.auditLog.findMany({ where: { action, entityId } });

  const definirPerfil = (perfil: string, empresa = EMPRESA_PADRAO.id) => banco.sistema.tenant.update({ where: { id: empresa }, data: { podProfile: perfil } });

  async function limpar() {
    const daSuite = { email: { startsWith: PREFIXO, mode: "insensitive" as const } };
    // Chamados abertos pelas tentativas: a carga some por baixo deles (SetNull).
    await prisma.occurrence.deleteMany({ where: { OR: [{ openedBy: daSuite }, { collection: { client: { cnpj: CNPJ_TESTE } } }] } });
    await prisma.collection.deleteMany({ where: { client: { cnpj: CNPJ_TESTE } } });
    await prisma.manifest.deleteMany({ where: { vehicle: { plate: { startsWith: PLACA_PREFIXO } } } });
    await prisma.vehicle.deleteMany({ where: { plate: { startsWith: PLACA_PREFIXO } } });
    await prisma.driver.deleteMany({ where: { OR: [{ cpf: { startsWith: CPF_PREFIXO } }, { user: daSuite }] } });
    await banco.sistema.auditLog.deleteMany({ where: { user: daSuite } });
    await prisma.user.deleteMany({ where: daSuite });
    await prisma.client.deleteMany({ where: { cnpj: CNPJ_TESTE } });
  }

  beforeAll(async () => {
    banco = await import("../src/lib/prisma");
    prisma = banco.default;
    baixaRota = await import("../src/app/api/driver/entregas/[id]/baixa/route");
    ocorrenciaRota = await import("../src/app/api/driver/entregas/[id]/ocorrencia/route");
    refazerRota = await import("../src/app/api/driver/entregas/[id]/refazer/route");
    doMotorista = await import("../src/app/api/driver/comprovantes/route");
    viagensDoMotorista = await import("../src/app/api/driver/manifestos/route");
    fila = await import("../src/app/api/comprovantes/route");
    conferirRota = await import("../src/app/api/comprovantes/[id]/conferir/route");
    empresaRota = await import("../src/app/api/empresa/comprovantes/route");
    portalRota = await import("../src/app/api/portal/coletas/[id]/route");
    manifestos = await import("../src/app/api/manifestos/route");
    liberar = await import("../src/app/api/manifestos/[id]/liberar/route");
    finalizar = await import("../src/app/api/manifestos/[id]/finalizar/route");
    coletasRota = await import("../src/app/api/coletas/route");
    comprovantePagina = await import("../src/app/dashboard/entregas/[id]/comprovante/page");
    tentativasPagina = await import("../src/app/dashboard/entregas/[id]/tentativas/page");
    sha256DaImagem = (await import("../src/lib/comprovantes-db")).sha256DaImagem;

    await limpar();
    await definirPerfil("LIVRE");
    await definirPerfil("LIVRE", EMPRESA_OUTRA.id);

    clienteId = (await prisma.client.create({ data: { companyName: "Empresa Teste POD LTDA", tradeName: "Teste POD", cnpj: CNPJ_TESTE, email: email("contato") } })).id;
    const usuario = (nome: string, role: "ADMIN" | "OPERATION" | "COMMERCIAL" | "CLIENT", extra: { clientId?: string } = {}) =>
      prisma.user.create({ data: { name: nome, email: email(nome), password: HASH_FALSO, role, ...extra } });
    operadorId = (await usuario("operacao", "OPERATION")).id;
    adminId = (await usuario("admin", "ADMIN")).id;
    // Atende chamados, mas não confere comprovante: é quem só recebe o aviso da ressalva.
    comercialId = (await usuario("comercial", "COMMERCIAL")).id;
    usuarioClienteId = (await usuario("cliente", "CLIENT", { clientId: clienteId })).id;
  }, 120_000);

  beforeEach(() => {
    sessao.mockReset();
    comoOperador();
  });

  // O perfil é da empresa inteira: cada caso que o troca volta ao padrão.
  afterEach(async () => {
    await definirPerfil("LIVRE");
  });

  afterAll(async () => {
    if (!prisma) return;
    await definirPerfil("LIVRE");
    await definirPerfil("LIVRE", EMPRESA_OUTRA.id);
    await limpar();
  });

  describe("baixa com fotos por tipo", () => {
    it("o hash é o dos bytes da imagem, não o do texto base64", () => {
      expect(sha256DaImagem(FOTO_ENTREGA)).toBe(sha256DosBytes(FOTO_ENTREGA));
      expect(sha256DaImagem(FOTO_ENTREGA)).not.toBe(sha256DoTexto(FOTO_ENTREGA));
      expect(sha256DaImagem(FOTO_ENTREGA)).toMatch(/^[0-9a-f]{64}$/);
    });

    it("grava cada foto com o tipo e o SHA-256 calculado no servidor, a relação de quem recebeu, e nada na coluna antiga", async () => {
      const { collectionId, proofId, userId } = await entregue();

      const proof = await comprovante(collectionId);
      expect(proof).toMatchObject({ id: proofId, status: "SUBMITTED", receiverRelation: "PORTARIA", photoBase64: null, signatureBase64: ASSINATURA, exceptionType: null, exceptionNote: null });
      const fotos = await fotosDe(proofId);
      expect(fotos.map((f) => [f.kind, f.dataUrl, f.sha256, f.replacedAt])).toEqual([
        ["ENTREGA", FOTO_ENTREGA, sha256DosBytes(FOTO_ENTREGA), null],
        ["CANHOTO", FOTO_CANHOTO, sha256DosBytes(FOTO_CANHOTO), null],
      ]);
      expect((await prisma.collection.findUniqueOrThrow({ where: { id: collectionId } })).status).toBe("DELIVERED");

      // Auditoria: só o nome de quem recebeu. Nem foto, nem documento, nem posição, nem hash.
      const [linha] = await auditoria("entrega.baixar", collectionId);
      expect(linha.userId).toBe(userId);
      expect(linha.after).toEqual({ status: "DELIVERED", receiverName: "Maria Recebedora" });
      expect(JSON.stringify(linha)).not.toMatch(/data:image|123\.456|-20\.81|-49\.37/);
      expect(JSON.stringify(linha)).not.toContain(sha256DosBytes(FOTO_ENTREGA));
    });

    it("o cliente da resposta não manda o hash: um `sha256` no corpo é ignorado", async () => {
      const { proofId } = await entregue(corpo({ photos: [{ kind: "ENTREGA", dataUrl: FOTO_ENTREGA, sha256: "f".repeat(64) }] }));
      expect((await fotosDe(proofId)).map((f) => f.sha256)).toEqual([sha256DosBytes(FOTO_ENTREGA)]);
    });

    it("formato atual sem dizer quem recebeu → 400; nada é gravado", async () => {
      const { cargas, userId } = await viagem();
      const res = await baixarComo(userId, cargas[0].id, corpo({ receiverRelation: undefined }));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: RELACAO_MESSAGE });
      expect(await prisma.proofOfDelivery.count({ where: { collectionId: cargas[0].id } })).toBe(0);
      expect((await prisma.collection.findUniqueOrThrow({ where: { id: cargas[0].id } })).status).toBe("ROUTE");
    });

    it("formato antigo (baixa que estava na fila offline de antes): vale sem a relação, e a foto vai para a tabela de fotos como foto da entrega", async () => {
      const { collectionId, proofId } = await entregue({ receiverName: "João Antigo", receiverDoc: "12345", photoBase64: FOTO_ENTREGA, signatureBase64: "" });
      expect(await comprovante(collectionId)).toMatchObject({ receiverRelation: null, photoBase64: null, signatureBase64: null });
      expect((await fotosDe(proofId)).map((f) => [f.kind, f.dataUrl, f.sha256])).toEqual([["ENTREGA", FOTO_ENTREGA, sha256DosBytes(FOTO_ENTREGA)]]);
    });

    it.each([
      ["três fotos da entrega", { photos: Array.from({ length: 3 }, () => ({ kind: "ENTREGA", dataUrl: FOTO_ENTREGA })) }, "Foto da entrega: no máximo 2 fotos."],
      ["sete fotos", { photos: Array.from({ length: 7 }, () => ({ kind: "AVARIA", dataUrl: FOTO_AVARIA })) }, FOTOS_DEMAIS],
      ["tipo de foto desconhecido", { photos: [{ kind: "SELFIE", dataUrl: FOTO_ENTREGA }] }, TIPO_DE_FOTO_MESSAGE],
      ["foto em endereço externo", { photos: [{ kind: "ENTREGA", dataUrl: "https://exemplo.br/foto.jpg" }] }, PHOTO_MESSAGE],
      ["foto em data:text/html", { photos: [{ kind: "ENTREGA", dataUrl: "data:text/html;base64,PHNjcmlwdD4=" }] }, PHOTO_MESSAGE],
      ["foto nova acima de 1,5 milhão de caracteres", { photos: [{ kind: "ENTREGA", dataUrl: `data:image/jpeg;base64,${"A".repeat(MAX_NEW_PHOTO_CHARS)}` }] }, PHOTO_TOO_BIG],
      ["ressalva sem descrição", { exception: { type: "FALTA", note: "" } }, RESSALVA_NOTE_MESSAGE],
      ["ressalva de tipo desconhecido", { exception: { type: "SUMIU", note: "Sumiu a carga" } }, RESSALVA_TIPO_MESSAGE],
    ])("corpo inválido (%s) → 400 com a mensagem, sem gravar", async (_caso, extra, mensagem) => {
      const { cargas, userId } = await viagem();
      const res = await baixarComo(userId, cargas[0].id, corpo(extra));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: mensagem });
      expect(await prisma.proofOfDelivery.count({ where: { collectionId: cargas[0].id } })).toBe(0);
      expect(await prisma.proofPhoto.count({ where: { proof: { collectionId: cargas[0].id } } })).toBe(0);
    });

    it("repetir a baixa com fotos → 200 alreadyDelivered, sem duplicar comprovante nem foto; vale mesmo se o perfil mudou depois", async () => {
      const { collectionId, proofId, userId } = await entregue(corpo({ photos: [foto("ENTREGA", FOTO_ENTREGA)] }));
      await definirPerfil("B2B");

      for (let i = 0; i < 2; i += 1) {
        const repetida = await baixarComo(userId, collectionId, corpo({ photos: [foto("ENTREGA", FOTO_ENTREGA)] }));
        expect(repetida.status).toBe(200);
        expect(await repetida.json()).toEqual({ success: true, alreadyDelivered: true, collectionId, proofId });
      }
      expect(await prisma.proofOfDelivery.count({ where: { collectionId } })).toBe(1);
      expect(await fotosDe(proofId)).toHaveLength(1);
      expect(await auditoria("entrega.baixar", collectionId)).toHaveLength(1);
    });

    it("duas baixas simultâneas com fotos: as duas 200, um comprovante e as fotos de uma só", async () => {
      const { cargas, userId } = await viagem();
      comoMotorista(userId);
      const respostas = await Promise.all([baixaRota.POST(req("POST", corpo()), ctx(cargas[0].id)), baixaRota.POST(req("POST", corpo()), ctx(cargas[0].id))]);
      expect(respostas.map((res) => res.status)).toEqual([200, 200]);
      const proof = await comprovante(cargas[0].id);
      expect(await fotosDe(proof.id)).toHaveLength(2);
    });

    it("motorista de outra viagem não dá baixa nem com as fotos certas", async () => {
      const minha = await viagem();
      const alheia = await viagem();
      const res = await baixarComo(minha.userId, alheia.cargas[0].id);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: DELIVERY_NOT_FOUND_MESSAGE });
      expect(await prisma.proofPhoto.count({ where: { proof: { collectionId: alheia.cargas[0].id } } })).toBe(0);
    });
  });

  describe("perfil da empresa na baixa", () => {
    it("LIVRE (padrão): sem foto nenhuma passa, como sempre", async () => {
      const { proofId } = await entregue(corpo({ photos: [], signatureBase64: "" }));
      expect(await fotosDe(proofId)).toHaveLength(0);
    });

    it("B2B: sem a foto do canhoto → 400 dizendo o que falta; com ela → 200", async () => {
      await definirPerfil("B2B");
      const { cargas, userId } = await viagem();
      const alvo = cargas[0].id;

      for (const photos of [[], [foto("ENTREGA", FOTO_ENTREGA)]]) {
        const res = await baixarComo(userId, alvo, corpo({ photos }));
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: "Falta a foto do canhoto assinado." });
      }
      expect((await prisma.collection.findUniqueOrThrow({ where: { id: alvo } })).status).toBe("ROUTE");
      expect(await prisma.proofOfDelivery.count({ where: { collectionId: alvo } })).toBe(0);

      expect((await baixarComo(userId, alvo, corpo({ photos: [foto("CANHOTO", FOTO_CANHOTO)] }))).status).toBe(200);
    });

    it("ECOMMERCE: sem a foto da entrega → 400; com ela → 200. Formato antigo com a foto também passa; sem foto, não", async () => {
      await definirPerfil("ECOMMERCE");
      const { cargas, userId } = await viagem(3);

      const sem = await baixarComo(userId, cargas[0].id, corpo({ photos: [foto("CANHOTO", FOTO_CANHOTO)] }));
      expect(sem.status).toBe(400);
      expect(await sem.json()).toEqual({ error: "Falta a foto da entrega." });
      expect((await baixarComo(userId, cargas[0].id, corpo({ photos: [foto("ENTREGA", FOTO_ENTREGA)] }))).status).toBe(200);

      const antiga = { receiverName: "João Antigo", receiverDoc: "12345" };
      expect((await baixarComo(userId, cargas[1].id, { ...antiga, photoBase64: FOTO_ENTREGA })).status).toBe(200);
      const antigaSemFoto = await baixarComo(userId, cargas[2].id, antiga);
      expect(antigaSemFoto.status).toBe(400);
      expect(await antigaSemFoto.json()).toEqual({ error: "Falta a foto da entrega." });
    });

    it("o perfil é de cada empresa: B2B na outra empresa não muda a regra desta", async () => {
      await definirPerfil("B2B", EMPRESA_OUTRA.id);
      try {
        const { proofId } = await entregue(corpo({ photos: [] }));
        expect(await fotosDe(proofId)).toHaveLength(0);
      } finally {
        await definirPerfil("LIVRE", EMPRESA_OUTRA.id);
      }
    });
  });

  describe("entrega com ressalva", () => {
    it("avaria sem a foto da avaria → 400; embalagem violada também", async () => {
      const { cargas, userId } = await viagem();
      for (const type of ["AVARIA", "VIOLADA"]) {
        const res = await baixarComo(userId, cargas[0].id, corpo({ exception: { type, note: "Caixa amassada no canto." } }));
        expect(res.status, type).toBe(400);
        expect(await res.json(), type).toEqual({ error: "Falta a foto da avaria." });
      }
      expect((await prisma.collection.findUniqueOrThrow({ where: { id: cargas[0].id } })).status).toBe("ROUTE");
    });

    it("com a foto: a entrega é concluída do mesmo jeito, o comprovante fica marcado e quem atende chamados é avisado", async () => {
      const antesDoComercial = (await avisosDe(comercialId)).length;
      const antesDoOperador = (await avisosDe(operadorId)).length;
      const { collectionId, proofId } = await entregue(
        corpo({ photos: [foto("CANHOTO", FOTO_CANHOTO), foto("AVARIA", FOTO_AVARIA)], exception: { type: "AVARIA", note: "  Caixa amassada no canto.  " } }),
      );

      expect((await prisma.collection.findUniqueOrThrow({ where: { id: collectionId } })).status).toBe("DELIVERED");
      expect(await comprovante(collectionId)).toMatchObject({ status: "SUBMITTED", exceptionType: "AVARIA", exceptionNote: "Caixa amassada no canto." });
      expect((await fotosDe(proofId)).map((f) => f.kind)).toEqual(["CANHOTO", "AVARIA"]);

      // COMMERCIAL atende chamados e não confere comprovante: recebe só o aviso da ressalva.
      expect((await avisosDe(comercialId)).slice(antesDoComercial)).toEqual(["comprovante.ressalva"]);
      // OPERATION faz as duas coisas: recebe os dois.
      expect((await avisosDe(operadorId)).slice(antesDoOperador).sort()).toEqual(["comprovante.enviado", "comprovante.ressalva"]);
      const aviso = await prisma.notification.findFirstOrThrow({ where: { userId: comercialId, type: "comprovante.ressalva" }, orderBy: { createdAt: "desc" } });
      expect(aviso.title).toBe("Entrega com ressalva: Avaria");
      expect(aviso.url).toBe(`/dashboard/entregas/${collectionId}/comprovante`);
      expect(`${aviso.title} ${aviso.body}`).not.toContain("amassada");

      // Auditoria: o tipo da ressalva, sem a descrição.
      const [linha] = await auditoria("entrega.baixar", collectionId);
      expect(linha.after).toEqual({ status: "DELIVERED", receiverName: "Maria Recebedora", ressalva: "AVARIA" });
      expect(linha.summary).toContain("com ressalva (Avaria)");
      expect(JSON.stringify(linha)).not.toContain("amassada");
    });

    it("falta de volume não pede foto; entrega sem ressalva não avisa quem atende chamados", async () => {
      const antes = (await avisosDe(comercialId)).length;
      const semRessalva = await entregue();
      expect((await avisosDe(comercialId)).length).toBe(antes);
      expect(await comprovante(semRessalva.collectionId)).toMatchObject({ exceptionType: null });

      const comFalta = await entregue(corpo({ photos: [], exception: { type: "FALTA", note: "Faltou 1 volume." } }));
      expect(await comprovante(comFalta.collectionId)).toMatchObject({ exceptionType: "FALTA", exceptionNote: "Faltou 1 volume." });
      expect((await avisosDe(comercialId)).length).toBe(antes + 1);
    });
  });

  describe("distância do endereço", () => {
    const ENDERECO = { deliveryLat: -20.8, deliveryLon: -49.38 };

    it("com posição e coordenada do destino: grava a distância, e a baixa longe do endereço não é bloqueada", async () => {
      const longe = await entregue(corpo({ latitude: -20.81, longitude: -49.38 }), ENDERECO);
      const gravada = (await comprovante(longe.collectionId)).distanceMeters;
      expect(gravada).toBeGreaterThan(1100);
      expect(gravada).toBeLessThan(1125);

      const perto = await entregue(corpo({ latitude: -20.8, longitude: -49.38 }), ENDERECO);
      expect((await comprovante(perto.collectionId)).distanceMeters).toBe(0);
    });

    it("sem posição na baixa, ou sem coordenada na carga: fica nula", async () => {
      const semPosicao = await entregue(corpo({ latitude: null, longitude: null }), ENDERECO);
      expect((await comprovante(semPosicao.collectionId)).distanceMeters).toBeNull();
      const semCoordenada = await entregue(corpo());
      expect((await comprovante(semCoordenada.collectionId)).distanceMeters).toBeNull();
    });

    it("no painel: aviso só acima de 500 m; a fila traz a distância, nunca a posição", async () => {
      const longe = await entregue(corpo({ latitude: -20.81, longitude: -49.38 }), ENDERECO);
      const perto = await entregue(corpo({ latitude: -20.8001, longitude: -49.38 }), ENDERECO);
      const semPosicao = await entregue(corpo({ latitude: null, longitude: null }), ENDERECO);

      comoOperador();
      const abrir = async (id: string) => renderToStaticMarkup(await comprovantePagina.default({ params: Promise.resolve({ id }) }));
      expect(await abrir(longe.collectionId)).toMatch(/a 1,1 km do endereço/);
      for (const id of [perto.collectionId, semPosicao.collectionId]) expect(await abrir(id)).not.toContain("do endereço");

      const texto = await (await fila.GET(new Request("http://localhost/api/comprovantes"))).text();
      const itens = JSON.parse(texto) as { id: string; distanceMeters: number | null }[];
      expect(itens.find((item) => item.id === longe.proofId)?.distanceMeters).toBeGreaterThan(1100);
      expect(itens.find((item) => item.id === semPosicao.proofId)?.distanceMeters).toBeNull();
      expect(texto).not.toMatch(/latitude|longitude|-20\.81/);
    });
  });

  describe("fila do painel: filtros", () => {
    type Item = { id: string; status: string; exceptionType: string | null; receiverRelation: string | null };
    const listar = async (query = "") => {
      comoOperador();
      const res = await fila.GET(new Request(`http://localhost/api/comprovantes${query}`));
      expect(res.status).toBe(200);
      const texto = await res.text();
      return { texto, itens: (JSON.parse(texto) as Item[]).filter((item) => daSuite.has(item.id)) };
    };
    const daSuite = new Set<string>();

    it("`?ressalva=1` traz só as entregas com ressalva, em qualquer situação; `?status=REJECTED` são os devolvidos ao motorista", async () => {
      const comRessalva = await entregue(corpo({ photos: [], exception: { type: "FALTA", note: "Faltou 1 volume." } }));
      const semRessalva = await entregue();
      const devolvidoComRessalva = await entregue(corpo({ photos: [], exception: { type: "OUTRA", note: "Cliente reclamou do horário." } }));
      await devolver(devolvidoComRessalva.collectionId);
      for (const item of [comRessalva, semRessalva, devolvidoComRessalva]) daSuite.add(item.proofId);

      const ressalvas = await listar("?ressalva=1");
      // A mais nova primeiro: aqui não é fila.
      expect(ressalvas.itens.map((item) => item.id)).toEqual([devolvidoComRessalva.proofId, comRessalva.proofId]);
      expect(ressalvas.itens.map((item) => item.exceptionType)).toEqual(["OUTRA", "FALTA"]);
      expect(ressalvas.itens[0]).toMatchObject({ status: "REJECTED", receiverRelation: "PORTARIA" });

      expect((await listar("?ressalva=1&status=SUBMITTED")).itens.map((item) => item.id)).toEqual([comRessalva.proofId]);
      expect((await listar("?status=REJECTED")).itens.map((item) => item.id)).toEqual([devolvidoComRessalva.proofId]);
      // Sem parâmetro continua sendo a fila dos que aguardam conferência.
      expect((await listar()).itens.map((item) => item.id).sort()).toEqual([comRessalva.proofId, semRessalva.proofId].sort());

      // A descrição da ressalva, as fotos e os hashes ficam na página do comprovante.
      for (const proibido of ["Faltou 1 volume", "exceptionNote", "dataUrl", "sha256", "data:image"]) expect(ressalvas.texto).not.toContain(proibido);

      comoMotorista(comRessalva.userId);
      expect((await fila.GET(new Request("http://localhost/api/comprovantes?ressalva=1"))).status).toBe(403);
    });
  });

  describe("devolução ao motorista e reenvio", () => {
    const novas = [foto("CANHOTO", FOTO_NOVA)];
    const listarComo = async (userId: string) => {
      comoMotorista(userId);
      const res = await doMotorista.GET();
      expect(res.status).toBe(200);
      return res;
    };

    it("devolver registra quem, quando e o motivo, e avisa o motorista da viagem pelo sininho", async () => {
      const { collectionId, proofId, userId } = await entregue();
      const outro = await criarMotorista();

      comoOperador();
      const res = await conferirRota.POST(req("POST", { decision: "REJECTED", reason: `  ${MOTIVO}  ` }), ctx(collectionId));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true, collectionId, proofId, status: "REJECTED" });

      expect(await comprovante(collectionId)).toMatchObject({ status: "REJECTED", rejectionReason: MOTIVO, reviewedById: operadorId });
      const devolucoes = await prisma.proofRejection.findMany({ where: { proofId } });
      expect(devolucoes).toHaveLength(1);
      expect(devolucoes[0]).toMatchObject({ reason: MOTIVO, rejectedById: operadorId, resubmittedAt: null });

      expect(await avisosDe(userId)).toContain("comprovante.devolvido");
      const aviso = await prisma.notification.findFirstOrThrow({ where: { userId, type: "comprovante.devolvido" } });
      expect(aviso.url).toBe(`/driver/entregas/${collectionId}/refazer`);
      expect(aviso.body).toContain(MOTIVO);
      expect(await avisosDe(outro.userId)).not.toContain("comprovante.devolvido");

      // A carga não muda, e a devolução de novo (já devolvido) é 409.
      expect((await prisma.collection.findUniqueOrThrow({ where: { id: collectionId } })).status).toBe("DELIVERED");
      expect((await conferirRota.POST(req("POST", { decision: "APPROVED" }), ctx(collectionId))).status).toBe(409);
      expect(await prisma.proofRejection.count({ where: { proofId } })).toBe(1);
    });

    it("aprovar não registra devolução nem avisa o motorista, e continua final", async () => {
      const { collectionId, proofId, userId } = await entregue();
      comoOperador();
      expect((await conferirRota.POST(req("POST", { decision: "APPROVED" }), ctx(collectionId))).status).toBe(200);
      expect(await prisma.proofRejection.count({ where: { proofId } })).toBe(0);
      expect(await avisosDe(userId)).not.toContain("comprovante.devolvido");
      expect((await conferirRota.POST(req("POST", { decision: "REJECTED", reason: MOTIVO }), ctx(collectionId))).status).toBe(409);
      expect(await comprovante(collectionId)).toMatchObject({ status: "APPROVED" });
    });

    it("GET /api/driver/comprovantes: o perfil da empresa e os devolvidos deste motorista, com o motivo; sem foto, assinatura nem posição", async () => {
      const meu = await entregue();
      const alheio = await entregue();
      const rejectionId = await devolver(meu.collectionId);
      await devolver(alheio.collectionId);
      await definirPerfil("B2B");

      const res = await listarComo(meu.userId);
      const texto = await res.text();
      const lista = JSON.parse(texto) as { perfil: string; refazer: Record<string, unknown>[] };
      expect(lista.perfil).toBe("B2B");
      expect(lista.refazer).toEqual([
        {
          collectionId: meu.collectionId,
          receiver: "Destinatário Teste",
          destination: "Destino - SP",
          receiverName: "Maria Recebedora",
          receiverDoc: "123.456.789-00",
          exceptionType: null,
          rejectionId,
          reason: MOTIVO,
          rejectedAt: expect.any(String),
        },
      ]);
      for (const proibido of ["data:image", "latitude", "longitude", "sha256", "signatureBase64", alheio.collectionId]) expect(texto).not.toContain(proibido);
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");

      // Quem não tem devolução vê a lista vazia, com o perfil.
      const semNada = await criarMotorista();
      expect(await (await listarComo(semNada.userId)).json()).toEqual({ perfil: "B2B", refazer: [] });
    });

    it("GET /api/driver/comprovantes: só motorista (sem sessão, equipe e cliente → 401)", async () => {
      sessao.mockResolvedValue(null);
      expect((await doMotorista.GET()).status).toBe(401);
      comoAdmin();
      expect((await doMotorista.GET()).status).toBe(401);
      comoOperador();
      expect((await doMotorista.GET()).status).toBe(401);
      entrar(usuarioClienteId, "CLIENT", clienteId);
      expect((await doMotorista.GET()).status).toBe(401);
    });

    it("refazer: sem sessão e equipe → 401; motorista de outra viagem → 404; nada muda", async () => {
      const { collectionId, proofId } = await entregue();
      const rejectionId = await devolver(collectionId);
      const outro = await viagem();
      const body = { rejectionId, photos: novas };

      sessao.mockResolvedValue(null);
      expect((await refazerRota.POST(req("POST", body), ctx(collectionId))).status).toBe(401);
      comoAdmin();
      expect((await refazerRota.POST(req("POST", body), ctx(collectionId))).status).toBe(401);

      const res = await refazerComo(outro.userId, collectionId, body);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: COMPROVANTE_DO_MOTORISTA_NAO_ENCONTRADO });

      expect(await comprovante(collectionId)).toMatchObject({ status: "REJECTED", rejectionReason: MOTIVO });
      expect((await fotosDe(proofId)).every((f) => f.replacedAt === null)).toBe(true);
      expect(await fotosDe(proofId)).toHaveLength(2);
    });

    it("refazer: corpo inválido → 400; devolução que não é deste comprovante → 404; carga inexistente → 404", async () => {
      const { collectionId, userId } = await entregue();
      const rejectionId = await devolver(collectionId);
      const outra = await entregue();
      const deOutra = await devolver(outra.collectionId);

      for (const [body, mensagem] of [
        [{ rejectionId, photos: [] }, SEM_FOTO_NOVA],
        [{ photos: novas }, "Dados inválidos."],
        [{ rejectionId, photos: [foto("CANHOTO", "https://exemplo.br/c.jpg")] }, PHOTO_MESSAGE],
        [{ rejectionId, photos: novas, receiverName: "J" }, "Informe o nome de quem recebeu (2 a 120 caracteres)."],
        [null, "Dados inválidos."],
      ] as const) {
        const res = await refazerComo(userId, collectionId, body);
        expect(res.status, JSON.stringify(body)).toBe(400);
        expect(await res.json()).toEqual({ error: mensagem });
      }

      const trocada = await refazerComo(userId, collectionId, { rejectionId: deOutra, photos: novas });
      expect(trocada.status).toBe(404);
      expect(await trocada.json()).toEqual({ error: DEVOLUCAO_NAO_ENCONTRADA });
      expect((await refazerComo(userId, SEM_ID, { rejectionId, photos: novas })).status).toBe(404);
      expect(await comprovante(collectionId)).toMatchObject({ status: "REJECTED" });
    });

    it("refazer com fotos novas → 200: volta para a fila, guarda as fotos devolvidas como substituídas, registra a resposta e avisa a equipe", async () => {
      const { id: viagemId, collectionId, proofId, userId } = await entregue();
      const rejectionId = await devolver(collectionId);
      const historicoAntes = await prisma.collectionStatusHistory.count({ where: { collectionId } });
      const avisosAntes = (await avisosDe(operadorId)).length;

      // A devolução costuma chegar depois do retorno: vale com a viagem finalizada.
      comoOperador();
      expect((await finalizar.POST(req("POST"), ctx(viagemId))).status).toBe(200);

      const res = await refazerComo(userId, collectionId, { rejectionId, photos: novas, receiverName: "  João Porteiro  ", receiverDoc: "98765" });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true, collectionId, proofId });

      expect(await comprovante(collectionId)).toMatchObject({
        status: "SUBMITTED",
        reviewedAt: null,
        reviewedById: null,
        rejectionReason: null,
        receiverName: "João Porteiro",
        receiverDoc: "98765",
        receiverRelation: "PORTARIA",
      });
      const fotos = await fotosDe(proofId);
      expect(fotos.map((f) => [f.kind, f.dataUrl, f.replacedAt !== null])).toEqual([
        ["ENTREGA", FOTO_ENTREGA, true],
        ["CANHOTO", FOTO_CANHOTO, true],
        ["CANHOTO", FOTO_NOVA, false],
      ]);
      expect(fotos[2].sha256).toBe(sha256DosBytes(FOTO_NOVA));

      // Histórico preservado: a devolução continua lá, agora com a hora da resposta.
      const [devolucao] = await prisma.proofRejection.findMany({ where: { proofId } });
      expect(devolucao).toMatchObject({ id: rejectionId, reason: MOTIVO, rejectedById: operadorId });
      expect(devolucao.resubmittedAt).not.toBeNull();

      // A carga continua entregue, sem linha nova no histórico; o nome corrigido vale nela também.
      const carga = await prisma.collection.findUniqueOrThrow({ where: { id: collectionId } });
      expect(carga).toMatchObject({ status: "DELIVERED", receiverName: "João Porteiro" });
      expect(await prisma.collectionStatusHistory.count({ where: { collectionId } })).toBe(historicoAntes);

      expect((await avisosDe(operadorId)).slice(avisosAntes)).toEqual(["comprovante.refeito"]);
      comoOperador();
      const naFila = (await (await fila.GET(new Request("http://localhost/api/comprovantes"))).json()) as { id: string }[];
      expect(naFila.map((item) => item.id)).toContain(proofId);
      // Saiu da lista do motorista.
      expect((await (await listarComo(userId)).json()).refazer).toEqual([]);

      // Auditoria: só o nome; nem documento, nem foto.
      const [linha] = await auditoria("comprovante.reenviar", proofId);
      expect(linha).toMatchObject({ userId, entity: "comprovante", before: { status: "REJECTED", receiverName: "Maria Recebedora" }, after: { status: "SUBMITTED", receiverName: "João Porteiro", cargaId: collectionId } });
      expect(JSON.stringify(linha)).not.toMatch(/data:image|98765|123\.456/);
    });

    it("repetir o mesmo reenvio → 200 alreadyResubmitted, sem duplicar foto nem aviso; vale também depois de aprovado", async () => {
      const { collectionId, proofId, userId } = await entregue();
      const rejectionId = await devolver(collectionId);
      const body = { rejectionId, photos: novas };
      expect((await refazerComo(userId, collectionId, body)).status).toBe(200);
      const fotosAntes = await fotosDe(proofId);
      const avisosAntes = (await avisosDe(operadorId)).length;

      const repetida = await refazerComo(userId, collectionId, { ...body, receiverName: "Outro Nome" });
      expect(repetida.status).toBe(200);
      expect(await repetida.json()).toEqual({ success: true, collectionId, proofId, alreadyResubmitted: true });

      comoOperador();
      expect((await conferirRota.POST(req("POST", { decision: "APPROVED" }), ctx(collectionId))).status).toBe(200);
      const depoisDeAprovado = await refazerComo(userId, collectionId, body);
      expect(depoisDeAprovado.status).toBe(200);
      expect((await depoisDeAprovado.json()).alreadyResubmitted).toBe(true);

      expect(await fotosDe(proofId)).toEqual(fotosAntes);
      expect((await avisosDe(operadorId)).length).toBe(avisosAntes);
      expect(await comprovante(collectionId)).toMatchObject({ status: "APPROVED", receiverName: "Maria Recebedora" });
      expect(await auditoria("comprovante.reenviar", proofId)).toHaveLength(1);
    });

    it("dois reenvios simultâneos: os dois 200, as fotos novas gravadas uma vez", async () => {
      const { collectionId, proofId, userId } = await entregue();
      const rejectionId = await devolver(collectionId);
      comoMotorista(userId);
      const body = { rejectionId, photos: novas };
      const respostas = await Promise.all([refazerRota.POST(req("POST", body), ctx(collectionId)), refazerRota.POST(req("POST", body), ctx(collectionId))]);
      expect(respostas.map((res) => res.status)).toEqual([200, 200]);
      expect((await fotosDe(proofId)).filter((f) => f.replacedAt === null).map((f) => f.dataUrl)).toEqual([FOTO_NOVA]);
    });

    it("segunda devolução: histórico com as duas, cada uma respondida com o seu `rejectionId`", async () => {
      const { collectionId, proofId, userId } = await entregue();
      const primeira = await devolver(collectionId, "Primeiro motivo: foto cortada.");
      expect((await refazerComo(userId, collectionId, { rejectionId: primeira, photos: novas })).status).toBe(200);
      const segunda = await devolver(collectionId, "Segundo motivo: falta a assinatura.");
      expect(segunda).not.toBe(primeira);

      // A resposta da primeira devolução chegando de novo não responde a segunda.
      const atrasada = await refazerComo(userId, collectionId, { rejectionId: primeira, photos: [foto("CANHOTO", FOTO_CANHOTO)] });
      expect(await atrasada.json()).toMatchObject({ alreadyResubmitted: true });
      expect(await comprovante(collectionId)).toMatchObject({ status: "REJECTED", rejectionReason: "Segundo motivo: falta a assinatura." });

      const devolucoes = await prisma.proofRejection.findMany({ where: { proofId }, orderBy: { rejectedAt: "asc" } });
      expect(devolucoes.map((d) => [d.reason, d.resubmittedAt !== null])).toEqual([
        ["Primeiro motivo: foto cortada.", true],
        ["Segundo motivo: falta a assinatura.", false],
      ]);

      comoOperador();
      const html = renderToStaticMarkup(await comprovantePagina.default({ params: Promise.resolve({ id: collectionId }) }));
      expect(html).toContain("Histórico de devoluções");
      expect(html).toContain("1ª devolução");
      expect(html).toContain("2ª devolução");
      expect(html).toContain("Primeiro motivo: foto cortada.");
      expect(html).toContain("Fotos substituídas");
      expect(html).toContain("Aguardando as fotos novas do motorista");
      // As fotos devolvidas continuam na página, com o hash de cada uma.
      expect(html).toContain(sha256DosBytes(FOTO_ENTREGA));
      expect(html).toContain(sha256DosBytes(FOTO_NOVA));
    });

    it("comprovante que não foi devolvido → não há devolução a responder (404); o da devolução em aberto com perfil B2B precisa do canhoto", async () => {
      const semDevolucao = await entregue();
      expect((await refazerComo(semDevolucao.userId, semDevolucao.collectionId, { rejectionId: SEM_ID, photos: novas })).status).toBe(404);

      const { collectionId, userId } = await entregue();
      const rejectionId = await devolver(collectionId);
      await definirPerfil("B2B");
      const semCanhoto = await refazerComo(userId, collectionId, { rejectionId, photos: [foto("ENTREGA", FOTO_ENTREGA)] });
      expect(semCanhoto.status).toBe(400);
      expect(await semCanhoto.json()).toEqual({ error: "Falta a foto do canhoto assinado." });
      expect(await comprovante(collectionId)).toMatchObject({ status: "REJECTED" });
      expect((await refazerComo(userId, collectionId, { rejectionId, photos: novas })).status).toBe(200);
    });

    it("comprovante com ressalva de avaria: as fotos novas precisam trazer a da avaria", async () => {
      const { collectionId, userId } = await entregue(corpo({ photos: [foto("AVARIA", FOTO_AVARIA)], exception: { type: "AVARIA", note: "Caixa amassada." } }));
      const rejectionId = await devolver(collectionId);
      const sem = await refazerComo(userId, collectionId, { rejectionId, photos: novas });
      expect(sem.status).toBe(400);
      expect(await sem.json()).toEqual({ error: "Falta a foto da avaria." });
      expect((await refazerComo(userId, collectionId, { rejectionId, photos: [...novas, foto("AVARIA", FOTO_AVARIA)] })).status).toBe(200);
    });

    it("comprovante antigo recusado (foto em `photoBase64`): o reenvio guarda a foto antiga como substituída", async () => {
      const v = await viagem();
      const collectionId = v.cargas[0].id;
      // Como ficou o dado de antes deste módulo, depois do SQL 028: recusado, com a devolução em aberto.
      await prisma.collection.update({ where: { id: collectionId }, data: { status: "DELIVERED", receiverName: "Maria Antiga" } });
      const proof = await prisma.proofOfDelivery.create({
        data: { collectionId, receiverName: "Maria Antiga", receiverDoc: "12345", photoBase64: FOTO_ENTREGA, status: "REJECTED", rejectionReason: "Foto escura.", reviewedById: operadorId, reviewedAt: new Date() },
      });
      const devolucao = await prisma.proofRejection.create({ data: { proofId: proof.id, reason: "Foto escura.", rejectedById: operadorId } });

      expect((await (await listarComo(v.userId)).json()).refazer).toMatchObject([{ collectionId, reason: "Foto escura.", rejectionId: devolucao.id }]);
      expect((await refazerComo(v.userId, collectionId, { rejectionId: devolucao.id, photos: [foto("ENTREGA", FOTO_NOVA)] })).status).toBe(200);

      expect(await comprovante(collectionId)).toMatchObject({ status: "SUBMITTED", photoBase64: null });
      expect((await fotosDe(proof.id)).map((f) => [f.kind, f.dataUrl, f.replacedAt !== null])).toEqual([
        ["ENTREGA", FOTO_ENTREGA, true],
        ["ENTREGA", FOTO_NOVA, false],
      ]);
    });
  });

  describe("tentativa de entrega sem sucesso", () => {
    const tentativa = (extra: Record<string, unknown> = {}) => ({ reason: "AUSENTE", note: "Vizinho disse que volta às 18h.", latitude: -20.81, longitude: -49.38, ...extra });

    it("só o motorista da viagem: sem sessão e equipe → 401; carga de outro motorista ou inexistente → 404", async () => {
      const minha = await viagem();
      const alheia = await viagem();

      sessao.mockResolvedValue(null);
      expect((await ocorrenciaRota.POST(req("POST", tentativa()), ctx(minha.cargas[0].id))).status).toBe(401);
      comoOperador();
      expect((await ocorrenciaRota.POST(req("POST", tentativa()), ctx(minha.cargas[0].id))).status).toBe(401);

      for (const id of [alheia.cargas[0].id, SEM_ID]) {
        const res = await registrarComo(minha.userId, id, tentativa());
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({ error: DELIVERY_NOT_FOUND_MESSAGE });
      }
      expect(await tentativasDe(alheia.cargas[0].id)).toHaveLength(0);
      expect(await tentativasDe(minha.cargas[0].id)).toHaveLength(0);
    });

    it.each([
      ["motivo fora da lista", { reason: "PREGUICA" }, INSUCESSO_MOTIVO_MESSAGE],
      ["OUTRO sem descrição", { reason: "OUTRO", note: "" }, INSUCESSO_NOTE_MESSAGE],
      ["foto que não é da fachada", { photos: [{ kind: "ENTREGA", dataUrl: FOTO_ENTREGA }] }, INSUCESSO_SO_FACHADA],
      ["foto em endereço externo", { photos: [{ kind: "FACHADA", dataUrl: "https://exemplo.br/f.jpg" }] }, PHOTO_MESSAGE],
      ["latitude fora da faixa", { latitude: 95 }, "Localização inválida."],
    ])("corpo inválido (%s) → 400, sem gravar tentativa nem chamado", async (_caso, extra, mensagem) => {
      const { cargas, userId } = await viagem();
      const chamadosAntes = await prisma.occurrence.count();
      const res = await registrarComo(userId, cargas[0].id, tentativa(extra));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: mensagem });
      expect(await tentativasDe(cargas[0].id)).toHaveLength(0);
      expect(await prisma.occurrence.count()).toBe(chamadosAntes);
    });

    it("registra a tentativa com motivo, posição e distância; abre o chamado de reentrega; a carga continua em rota na mesma viagem", async () => {
      const { id: viagemId, cargas, userId } = await viagem(1, { deliveryLat: -20.8, deliveryLon: -49.38 });
      const alvo = cargas[0].id;
      const historicoAntes = await prisma.collectionStatusHistory.count({ where: { collectionId: alvo } });
      const avisosAntes = (await avisosDe(comercialId)).length;

      const res = await registrarComo(userId, alvo, tentativa());
      expect(res.status).toBe(201);
      const json = (await res.json()) as { success: boolean; attemptId: string; id: string; number: number; attempts: number };
      expect(json).toMatchObject({ success: true, attempts: 1 });

      const [gravada] = await tentativasDe(alvo);
      expect(gravada).toMatchObject({ id: json.attemptId, reason: "AUSENTE", note: "Vizinho disse que volta às 18h.", manifestId: viagemId, occurrenceId: json.id, latitude: -20.81, longitude: -49.38 });
      expect(gravada.distanceMeters).toBeGreaterThan(1100);
      expect(gravada.distanceMeters).toBeLessThan(1125);

      // O status da carga não muda: continua em rota, na viagem, sem linha no histórico.
      expect(await prisma.collection.findUniqueOrThrow({ where: { id: alvo } })).toMatchObject({ status: "ROUTE", manifestId: viagemId, receiverName: null });
      expect(await prisma.collectionStatusHistory.count({ where: { collectionId: alvo } })).toBe(historicoAntes);
      expect(await prisma.proofOfDelivery.count({ where: { collectionId: alvo } })).toBe(0);

      // O chamado é o de toda ocorrência do motorista: interno, ligado à carga, de reentrega.
      const chamado = await prisma.occurrence.findUniqueOrThrow({ where: { id: json.id } });
      expect(chamado).toMatchObject({ number: json.number, type: "REDELIVERY", collectionId: alvo, clientId: null, openedById: userId, origin: "STAFF", title: "Entrega não realizada (Ausente): Destinatário Teste" });
      expect(chamado.description).toContain("1ª tentativa de entrega sem sucesso");
      expect(chamado.description).toContain("Vizinho disse que volta às 18h.");
      expect((await avisosDe(comercialId)).slice(avisosAntes)).toEqual(["chamado.novo"]);

      // Auditoria: motivo e número da tentativa; nem posição, nem foto.
      const [linha] = await auditoria("entrega.insucesso", alvo);
      expect(linha).toMatchObject({ userId, entity: "coleta", after: { motivo: "AUSENTE", tentativa: 1, chamado: json.number } });
      expect(JSON.stringify(linha)).not.toMatch(/-20\.81|-49\.38|data:image/);
    });

    it("uma carga pode ter várias tentativas, contadas; e depois é entregue normalmente", async () => {
      const { cargas, userId } = await viagem(2);
      const alvo = cargas[0].id;

      expect((await (await registrarComo(userId, alvo, tentativa())).json()).attempts).toBe(1);
      const segunda = await registrarComo(userId, alvo, tentativa({ reason: "FECHADO", note: "" }));
      expect(segunda.status).toBe(201);
      expect((await segunda.json()).attempts).toBe(2);
      expect((await tentativasDe(alvo)).map((t) => [t.reason, t.note])).toEqual([
        ["AUSENTE", "Vizinho disse que volta às 18h."],
        ["FECHADO", null],
      ]);

      // A viagem do motorista mostra a situação de cada parada.
      comoMotorista(userId);
      const [daViagem] = (await (await viagensDoMotorista.GET()).json()) as { collections: Record<string, unknown>[] }[];
      const parada = (id: string) => daViagem.collections.find((c) => c.id === id);
      expect(parada(alvo)).toMatchObject({ status: "ROUTE", attempts: 2, proofStatus: null, withException: false });
      expect(parada(cargas[1].id)).toMatchObject({ status: "ROUTE", attempts: 0, proofStatus: null, withException: false });
      expect(situacaoDaParada(parada(alvo) as { status: string })).toBe("INSUCESSO");
      expect(JSON.stringify(daViagem)).not.toMatch(/"proof"|_count|data:image/);

      // O painel mostra o contador na carga.
      comoOperador();
      const lista = (await (await coletasRota.GET()).json()) as { id: string; _count: { deliveryAttempts: number } }[];
      expect(lista.find((c) => c.id === alvo)?._count).toEqual({ deliveryAttempts: 2 });
      const viagensDoPainel = (await (await manifestos.GET()).json()) as { collections: { id: string; _count: { deliveryAttempts: number }; proof: unknown }[] }[];
      const noPainel = viagensDoPainel.flatMap((m) => m.collections).find((c) => c.id === alvo);
      expect(noPainel).toMatchObject({ _count: { deliveryAttempts: 2 }, proof: null });

      // Nova tentativa, agora com sucesso.
      expect((await baixarComo(userId, alvo, corpo({ photos: [], exception: { type: "OUTRA", note: "Entregue na 3ª ida." } }))).status).toBe(200);
      comoMotorista(userId);
      const [depois] = (await (await viagensDoMotorista.GET()).json()) as { collections: Record<string, unknown>[] }[];
      expect(depois.collections.find((c) => c.id === alvo)).toMatchObject({ status: "DELIVERED", attempts: 2, proofStatus: "SUBMITTED", withException: true });
      // Carga já entregue não recebe tentativa sem sucesso.
      const tarde = await registrarComo(userId, alvo, tentativa());
      expect(tarde.status).toBe(409);
      expect(await tarde.json()).toEqual({ error: NOT_IN_ROUTE_MESSAGE });
      expect(await tentativasDe(alvo)).toHaveLength(2);
    });

    it("perfil LIVRE: a foto da fachada é opcional. ECOMMERCE e B2B: obrigatória, e fica gravada com o hash", async () => {
      const { cargas, userId } = await viagem();
      const alvo = cargas[0].id;
      expect((await registrarComo(userId, alvo, tentativa({ photos: [] }))).status).toBe(201);

      for (const perfil of ["ECOMMERCE", "B2B"]) {
        await definirPerfil(perfil);
        const sem = await registrarComo(userId, alvo, tentativa());
        expect(sem.status, perfil).toBe(400);
        expect(await sem.json(), perfil).toEqual({ error: INSUCESSO_SEM_FACHADA });
      }
      expect(await tentativasDe(alvo)).toHaveLength(1);

      const com = await registrarComo(userId, alvo, tentativa({ photos: [foto("FACHADA", FOTO_FACHADA)] }));
      expect(com.status).toBe(201);
      const { attemptId } = (await com.json()) as { attemptId: string };
      const fotos = await prisma.proofPhoto.findMany({ where: { attemptId } });
      expect(fotos.map((f) => [f.kind, f.dataUrl, f.sha256, f.proofId])).toEqual([["FACHADA", FOTO_FACHADA, sha256DosBytes(FOTO_FACHADA), null]]);
    });

    it("repetir o envio com a mesma chave → 200 com a tentativa já gravada, sem outra tentativa nem outro chamado", async () => {
      const { cargas, userId } = await viagem();
      const alvo = cargas[0].id;
      const body = tentativa({ key: "chave-do-aparelho-1" });

      const primeira = await registrarComo(userId, alvo, body);
      expect(primeira.status).toBe(201);
      const gravada = (await primeira.json()) as { attemptId: string; id: string; number: number };
      const chamadosAntes = await prisma.occurrence.count({ where: { collectionId: alvo } });

      const repetida = await registrarComo(userId, alvo, body);
      expect(repetida.status).toBe(200);
      expect(await repetida.json()).toEqual({ success: true, attemptId: gravada.attemptId, id: gravada.id, number: gravada.number, attempts: 1, alreadyRegistered: true });
      expect(await tentativasDe(alvo)).toHaveLength(1);
      expect(await prisma.occurrence.count({ where: { collectionId: alvo } })).toBe(chamadosAntes);

      // Sem chave, ou com outra chave, é outra tentativa.
      expect((await registrarComo(userId, alvo, tentativa({ key: "chave-do-aparelho-2" }))).status).toBe(201);
      expect(await tentativasDe(alvo)).toHaveLength(2);
    });

    it("a ocorrência comum do motorista continua como era: chamado sem registro de tentativa", async () => {
      const { cargas, userId } = await viagem();
      const res = await registrarComo(userId, cargas[0].id, { type: "DAMAGE", description: "Caixa chegou amassada." });
      expect(res.status).toBe(201);
      expect(Object.keys(await res.json()).sort()).toEqual(["id", "number", "success"]);
      expect(await tentativasDe(cargas[0].id)).toHaveLength(0);
    });

    it("página das tentativas no painel: motivo, observação, foto da fachada com o hash e o chamado; só para quem confere comprovante", async () => {
      const { cargas, userId } = await viagem(1, { deliveryLat: -20.8, deliveryLon: -49.38 });
      const alvo = cargas[0].id;
      const abrir = (id: string) => tentativasPagina.default({ params: Promise.resolve({ id }) });
      expect((await registrarComo(userId, alvo, tentativa({ photos: [foto("FACHADA", FOTO_FACHADA)] }))).status).toBe(201);
      expect((await registrarComo(userId, alvo, tentativa({ reason: "MUDOU_SE", note: "", latitude: null, longitude: null }))).status).toBe(201);

      comoOperador();
      const html = renderToStaticMarkup(await abrir(alvo));
      expect(html).toContain("2 tentativas sem sucesso");
      expect(html).toContain("1ª tentativa: Ausente");
      expect(html).toContain("2ª tentativa: Mudou-se");
      expect(html).toContain("Vizinho disse que volta às 18h.");
      expect(html).toContain(`src="${FOTO_FACHADA}"`);
      expect(html).toContain(sha256DosBytes(FOTO_FACHADA));
      expect(html).toContain("a 1,1 km do endereço");
      expect(html).toMatch(/Chamado nº \d+/);
      expect(html).toContain("Sem foto da fachada");

      comoMotorista(userId);
      await expect(abrir(alvo)).rejects.toThrow("NOT_FOUND");
      entrar(usuarioClienteId, "CLIENT", clienteId);
      await expect(abrir(alvo)).rejects.toThrow("NOT_FOUND");
      entrar(comercialId, "COMMERCIAL");
      await expect(abrir(alvo)).rejects.toThrow("NOT_FOUND");
      sessao.mockResolvedValue(null);
      await expect(abrir(alvo)).rejects.toThrow("REDIRECT /login");
      comoOperador();
      await expect(abrir(SEM_ID)).rejects.toThrow("NOT_FOUND");
    });
  });

  describe("página do comprovante no painel", () => {
    const abrir = async (id: string) => renderToStaticMarkup(await comprovantePagina.default({ params: Promise.resolve({ id }) }));

    it("fotos agrupadas por tipo com o SHA-256 de cada uma, quem recebeu com a relação, a ressalva e 'Devolver ao motorista'", async () => {
      const { collectionId } = await entregue(
        corpo({
          receiverRelation: "VIZINHO",
          photos: [foto("ENTREGA", FOTO_ENTREGA), foto("CANHOTO", FOTO_CANHOTO), foto("AVARIA", FOTO_AVARIA)],
          exception: { type: "VIOLADA", note: "Lacre rompido na lateral." },
        }),
      );

      comoOperador();
      const html = await abrir(collectionId);
      for (const dataUrl of [FOTO_ENTREGA, FOTO_CANHOTO, FOTO_AVARIA]) {
        expect(html).toContain(`src="${dataUrl}"`);
        expect(html).toContain(sha256DosBytes(dataUrl));
      }
      expect(html).toContain('data-fotos="ENTREGA"');
      expect(html).toContain('data-fotos="CANHOTO"');
      expect(html).toContain('data-fotos="AVARIA"');
      expect(html).toContain("Vizinho");
      expect(html).toContain("Entrega com ressalva: Embalagem violada");
      expect(html).toContain("Lacre rompido na lateral.");
      expect(html).toContain("Devolver ao motorista");
      expect(html).not.toContain(">Recusar<");
      expect(html).not.toContain("Histórico de devoluções");
    });

    it("comprovante antigo (uma foto em `photoBase64`, sem relação, sem tipo) continua aparecendo certo", async () => {
      const carga = await montar({ status: "DELIVERED", receiverName: "Maria Antiga" });
      await prisma.proofOfDelivery.create({ data: { collectionId: carga.id, receiverName: "Maria Antiga", receiverDoc: "111.222.333-44", photoBase64: FOTO_ENTREGA, signatureBase64: ASSINATURA } });

      comoAdmin();
      const html = await abrir(carga.id);
      expect(html).toContain("Maria Antiga");
      expect(html).toContain("111.222.333-44");
      expect(html).toContain(`src="${FOTO_ENTREGA}"`);
      expect(html).toContain('data-fotos="ENTREGA"');
      expect(html).toContain("Foto da entrega");
      expect(html).toContain(`src="${ASSINATURA}"`);
      expect(html).toContain("Foto anterior ao registro do SHA-256");
      expect(html).not.toContain("data-relacao");
      expect(html).not.toContain("data-ressalva");
    });
  });

  describe("portal do cliente", () => {
    const ver = async (id: string) => {
      entrar(usuarioClienteId, "CLIENT", clienteId);
      const res = await portalRota.GET(req(), ctx(id));
      expect(res.status).toBe(200);
      const texto = await res.text();
      return { texto, corpo: JSON.parse(texto) as { proof: Record<string, unknown> | null; exception: unknown } };
    };

    it("a regra de quando o comprovante aparece não mudou (só aprovado); a ressalva aparece desde o registro, só tipo e descrição", async () => {
      const { collectionId } = await entregue(
        corpo({ photos: [foto("ENTREGA", FOTO_ENTREGA), foto("CANHOTO", FOTO_CANHOTO), foto("AVARIA", FOTO_AVARIA)], exception: { type: "AVARIA", note: "Caixa amassada no canto." } }),
      );

      const emConferencia = await ver(collectionId);
      expect(emConferencia.corpo.proof).toBeNull();
      expect(emConferencia.corpo.exception).toEqual({ type: "AVARIA", note: "Caixa amassada no canto." });
      expect(emConferencia.texto).not.toContain("data:image");

      await devolver(collectionId);
      const devolvido = await ver(collectionId);
      expect(devolvido.corpo.proof).toBeNull();
      expect(devolvido.texto).not.toContain(MOTIVO);
    });

    it("aprovado: fotos da entrega e do canhoto que valem hoje, quem recebeu com a relação; nada de avaria, fachada, substituídas, posição, distância ou hash", async () => {
      const { collectionId, userId } = await entregue(
        corpo({ photos: [foto("ENTREGA", FOTO_ENTREGA), foto("CANHOTO", FOTO_CANHOTO), foto("AVARIA", FOTO_AVARIA), foto("FACHADA", FOTO_FACHADA)], exception: { type: "AVARIA", note: "Caixa amassada." } }),
        { deliveryLat: -20.8, deliveryLon: -49.38 },
      );
      const rejectionId = await devolver(collectionId);
      expect((await refazerComo(userId, collectionId, { rejectionId, photos: [foto("CANHOTO", FOTO_NOVA), foto("AVARIA", FOTO_AVARIA)] })).status).toBe(200);
      comoOperador();
      expect((await conferirRota.POST(req("POST", { decision: "APPROVED" }), ctx(collectionId))).status).toBe(200);

      const { texto, corpo: resposta } = await ver(collectionId);
      expect(resposta.proof).toMatchObject({ receiverName: "Maria Recebedora", receiverRelation: "PORTARIA", photoBase64: null });
      expect((resposta.proof?.photos as { kind: string; dataUrl: string }[]).map((f) => [f.kind, f.dataUrl])).toEqual([["CANHOTO", FOTO_NOVA]]);
      expect(resposta.exception).toEqual({ type: "AVARIA", note: "Caixa amassada." });
      for (const proibido of [FOTO_AVARIA, FOTO_FACHADA, FOTO_CANHOTO, FOTO_ENTREGA, "latitude", "longitude", "distanceMeters", "sha256", "replacedAt", "rejections", MOTIVO, "exceptionNote", "tenantId", "-20.81"]) {
        expect(texto, proibido).not.toContain(proibido);
      }
    });

    it("comprovante antigo aprovado continua como era: a foto em `photoBase64`, sem relação e sem ressalva", async () => {
      const carga = await montar({ status: "DELIVERED", receiverName: "Maria Antiga" });
      await prisma.proofOfDelivery.create({ data: { collectionId: carga.id, receiverName: "Maria Antiga", receiverDoc: "11122233344", photoBase64: FOTO_ENTREGA, status: "APPROVED" } });
      const { corpo: resposta } = await ver(carga.id);
      expect(resposta.proof).toMatchObject({ receiverName: "Maria Antiga", photoBase64: FOTO_ENTREGA, receiverRelation: null, photos: [] });
      expect(resposta.exception).toBeNull();
    });

    it("a tentativa sem sucesso (foto da fachada, motivo, posição) não vai para o portal", async () => {
      const { cargas, userId } = await viagem();
      expect((await registrarComo(userId, cargas[0].id, { reason: "AUSENTE", note: "Ninguém atendeu.", photos: [foto("FACHADA", FOTO_FACHADA)], latitude: -20.81, longitude: -49.38 })).status).toBe(201);
      const { texto } = await ver(cargas[0].id);
      for (const proibido of [FOTO_FACHADA, "AUSENTE", "Ninguém atendeu", "deliveryAttempts", "-20.81"]) expect(texto, proibido).not.toContain(proibido);
    });
  });

  describe("perfil do comprovante na empresa", () => {
    const ler = () => empresaRota.GET();
    const alterar = (body: unknown) => empresaRota.PATCH(req("PATCH", body));
    const gravado = async (id: string) => (await banco.sistema.tenant.findUniqueOrThrow({ where: { id }, select: { podProfile: true } })).podProfile;

    it("só o administrador lê e altera: sem sessão 401; operação, cliente e motorista 403", async () => {
      sessao.mockResolvedValue(null);
      expect((await ler()).status).toBe(401);
      expect((await alterar({ perfil: "B2B" })).status).toBe(401);
      const motorista = await criarMotorista();
      for (const entrarComo of [comoOperador, () => entrar(usuarioClienteId, "CLIENT", clienteId), () => comoMotorista(motorista.userId)]) {
        entrarComo();
        expect((await ler()).status).toBe(403);
        expect((await alterar({ perfil: "B2B" })).status).toBe(403);
      }
      expect(await gravado(EMPRESA_PADRAO.id)).toBe("LIVRE");
    });

    it("o padrão é LIVRE; alterar grava, a leitura seguinte traz, a auditoria registra, e a outra empresa não muda", async () => {
      comoAdmin();
      expect(await (await ler()).json()).toEqual({ perfil: "LIVRE" });

      const res = await alterar({ perfil: "B2B" });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ perfil: "B2B" });
      expect(await (await ler()).json()).toEqual({ perfil: "B2B" });
      expect(await gravado(EMPRESA_PADRAO.id)).toBe("B2B");
      expect(await gravado(EMPRESA_OUTRA.id)).toBe("LIVRE");

      const linhas = await auditoria("empresa.comprovante", EMPRESA_PADRAO.id);
      expect(linhas.filter((linha) => linha.userId === adminId)).toMatchObject([{ entity: "empresa", before: { perfil: "LIVRE" }, after: { perfil: "B2B" } }]);

      // Gravar o mesmo valor não gera linha nova.
      expect((await alterar({ perfil: "B2B" })).status).toBe(200);
      expect((await auditoria("empresa.comprovante", EMPRESA_PADRAO.id)).filter((linha) => linha.userId === adminId)).toHaveLength(1);

      // O motorista lê o perfil pela rota dele.
      const motorista = await criarMotorista();
      comoMotorista(motorista.userId);
      expect((await (await doMotorista.GET()).json()).perfil).toBe("B2B");
    });

    it("valor fora da lista → 400, sem gravar", async () => {
      comoAdmin();
      for (const body of [{}, { perfil: "b2b" }, { perfil: "QUALQUER" }, null]) {
        const res = await alterar(body);
        expect(res.status, JSON.stringify(body)).toBe(400);
      }
      expect(await (await alterar({ perfil: "X" })).json()).toEqual({ error: PERFIL_MESSAGE });
      expect(await gravado(EMPRESA_PADRAO.id)).toBe("LIVRE");
    });
  });

  describe("isolamento entre empresas", () => {
    it("fotos, devoluções e tentativas de uma empresa não aparecem para a outra", async () => {
      const { collectionId, proofId, userId } = await entregue();
      await devolver(collectionId);
      const pendente = await viagem();
      expect((await registrarComo(pendente.userId, pendente.cargas[0].id, { reason: "AUSENTE", photos: [foto("FACHADA", FOTO_FACHADA)] })).status).toBe(201);

      expect(await prisma.proofPhoto.count({ where: { proofId } })).toBe(2);
      expect(await prisma.proofRejection.count({ where: { proofId } })).toBe(1);
      expect(await prisma.deliveryAttempt.count({ where: { collectionId: pendente.cargas[0].id } })).toBe(1);

      const outra = banco.paraEmpresa(EMPRESA_OUTRA.id).db;
      expect(await outra.proofPhoto.count({ where: { proofId } })).toBe(0);
      expect(await outra.proofPhoto.count({ where: { attempt: { collectionId: pendente.cargas[0].id } } })).toBe(0);
      expect(await outra.proofRejection.count({ where: { proofId } })).toBe(0);
      expect(await outra.deliveryAttempt.count({ where: { collectionId: pendente.cargas[0].id } })).toBe(0);
      expect(await outra.proofOfDelivery.count({ where: { id: proofId } })).toBe(0);
      // A outra empresa também não altera nem apaga.
      expect((await outra.proofPhoto.updateMany({ where: { proofId }, data: { replacedAt: new Date() } })).count).toBe(0);
      expect((await outra.proofRejection.deleteMany({ where: { proofId } })).count).toBe(0);
      expect((await fotosDe(proofId)).every((f) => f.replacedAt === null)).toBe(true);
      expect(userId).toBeTruthy();
    });

    it("a outra empresa não pendura foto, devolução nem tentativa em registro desta", async () => {
      const { collectionId, proofId } = await entregue();
      const outra = banco.paraEmpresa(EMPRESA_OUTRA.id).db;
      const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
      try {
        await expect(outra.proofPhoto.create({ data: { proofId, kind: "ENTREGA", dataUrl: FOTO_ENTREGA, sha256: "x" } })).rejects.toThrow();
        await expect(outra.proofRejection.create({ data: { proofId, reason: "Invasão" } })).rejects.toThrow();
        await expect(outra.deliveryAttempt.create({ data: { collectionId, reason: "AUSENTE" } })).rejects.toThrow();
      } finally {
        erro.mockRestore();
      }
      expect(await banco.sistema.proofPhoto.count({ where: { proofId } })).toBe(2);
      expect(await banco.sistema.proofRejection.count({ where: { proofId } })).toBe(0);
      expect(await banco.sistema.deliveryAttempt.count({ where: { collectionId } })).toBe(0);
    });

    it("a mesma chave de tentativa pode existir em duas empresas", async () => {
      const { cargas, userId } = await viagem();
      expect((await registrarComo(userId, cargas[0].id, { reason: "AUSENTE", key: "chave-repetida-entre-empresas" })).status).toBe(201);
      const [gravada] = await tentativasDe(cargas[0].id);
      expect(gravada.tenantId).toBe(EMPRESA_PADRAO.id);
      expect(await banco.paraEmpresa(EMPRESA_OUTRA.id).db.deliveryAttempt.count({ where: { clientKey: "chave-repetida-entre-empresas" } })).toBe(0);
    });
  });
});
