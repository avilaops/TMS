import { z } from "zod";
import { distanciaKm, type Ponto } from "@/lib/roteiro";

/**
 * Comprovante de entrega no padrão das grandes transportadoras: fotos por tipo,
 * quem recebeu, ressalva, o que cada perfil de empresa exige, distância do
 * endereço, devolução ao motorista e tentativa de entrega sem sucesso.
 *
 * Regras e formatos comuns às rotas e às telas (aplicativo do motorista, painel
 * e portal). Este arquivo também é importado pela tela, então não pode puxar
 * nada que só exista no servidor: o que grava está em src/lib/comprovantes-db.ts.
 */

/* ----------------------------------- Fotos ----------------------------------- */

export const TIPOS_DE_FOTO = ["ENTREGA", "CANHOTO", "AVARIA", "FACHADA"] as const;
export type TipoDeFoto = (typeof TIPOS_DE_FOTO)[number];

export const ROTULO_DA_FOTO: Record<TipoDeFoto, string> = {
  ENTREGA: "Foto da entrega",
  CANHOTO: "Foto do canhoto",
  AVARIA: "Foto da avaria",
  FACHADA: "Foto da fachada",
};

/** Quantas fotos de cada tipo cabem num comprovante, e quantas no total. */
export const MAXIMO_POR_TIPO: Record<TipoDeFoto, number> = { ENTREGA: 2, CANHOTO: 2, AVARIA: 3, FACHADA: 2 };
export const MAXIMO_DE_FOTOS = 6;

/**
 * Tamanho do texto da foto nova (data URL), não do arquivo. O aparelho reduz a
 * foto antes de enviar (src/lib/foto.ts): 1600 px em JPEG fica bem abaixo disto.
 */
export const MAX_NEW_PHOTO_CHARS = 1_500_000;

export const PHOTO_MESSAGE =
  "Formato de foto não aceito. Envie uma foto JPEG, PNG ou WebP. No iPhone, troque em Ajustes > Câmera > Formatos para \"Mais compatível\" e tire outra.";
export const PHOTO_TOO_BIG = "A foto ficou grande demais. Tire outra com menos resolução.";
export const TIPO_DE_FOTO_MESSAGE = "Tipo de foto inválido.";
export const FOTOS_DEMAIS = `Um comprovante leva no máximo ${MAXIMO_DE_FOTOS} fotos.`;

// Só imagem embutida: o que chega aqui é exibido depois num <img> do painel,
// e um `data:text/html` ou um endereço externo não podem entrar por esta porta.
export const IMAGE_DATA_URL = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/**
 * Confere a quantidade de fotos: devolve a mensagem do primeiro limite
 * estourado, ou `null` quando cabe.
 */
export function problemaNasFotos(tipos: readonly string[]): string | null {
  if (tipos.length > MAXIMO_DE_FOTOS) return FOTOS_DEMAIS;
  for (const tipo of TIPOS_DE_FOTO) {
    const quantas = tipos.filter((t) => t === tipo).length;
    if (quantas > MAXIMO_POR_TIPO[tipo]) {
      return `${ROTULO_DA_FOTO[tipo]}: no máximo ${plural(MAXIMO_POR_TIPO[tipo], "foto", "fotos")}.`;
    }
  }
  return null;
}

/** Ainda cabe mais uma foto deste tipo? */
export function cabeMaisUma(tipos: readonly string[], tipo: TipoDeFoto): boolean {
  return problemaNasFotos([...tipos, tipo]) === null;
}

const INVALID_BODY = "Dados inválidos.";

export const fotoSchema = z.object(
  {
    kind: z.enum(TIPOS_DE_FOTO, TIPO_DE_FOTO_MESSAGE),
    dataUrl: z.string(PHOTO_MESSAGE).max(MAX_NEW_PHOTO_CHARS, PHOTO_TOO_BIG).regex(IMAGE_DATA_URL, PHOTO_MESSAGE),
  },
  INVALID_BODY,
);
export type FotoEnviada = z.infer<typeof fotoSchema>;

/** Lista de fotos de um envio, já dentro dos limites por tipo e do total. */
export const fotosSchema = z
  .array(fotoSchema, INVALID_BODY)
  // O total é conferido antes de olhar cada foto: sete fotos de 1,5 MB não precisam ser validadas uma a uma.
  .max(MAXIMO_DE_FOTOS, FOTOS_DEMAIS)
  .superRefine((fotos, ctx) => {
    const problema = problemaNasFotos(fotos.map((foto) => foto.kind));
    if (problema) ctx.addIssue({ code: "custom", message: problema });
  });

/** A foto como o painel e o portal mostram. `sha256` nulo = foto antiga, de antes das fotos por tipo. */
export type FotoDoComprovante = {
  id: string;
  kind: TipoDeFoto;
  dataUrl: string;
  sha256: string | null;
  createdAt: Date | string;
  replacedAt: Date | string | null;
};

/** A baixa antiga gravava a imagem como data URL ou só o base64; a tela aceita os dois. */
export const comoDataUrl = (valor: string) => (valor.startsWith("data:") ? valor : `data:image/jpeg;base64,${valor}`);

const ehTipoDeFoto = (valor: string): valor is TipoDeFoto => (TIPOS_DE_FOTO as readonly string[]).includes(valor);

/**
 * Todas as fotos de um comprovante, na ordem em que foram tiradas. O
 * comprovante antigo tem uma foto só, na coluna `photoBase64`: ela aparece como
 * uma foto da entrega. Foto de tipo desconhecido (linha gravada por fora) fica de fora.
 */
export function fotosDoComprovante(comprovante: {
  photoBase64?: string | null;
  createdAt: Date | string;
  photos?: readonly { id: string; kind: string; dataUrl: string; sha256: string | null; createdAt: Date | string; replacedAt: Date | string | null }[];
}): FotoDoComprovante[] {
  const antiga: FotoDoComprovante[] = comprovante.photoBase64
    ? [{ id: "antiga", kind: "ENTREGA", dataUrl: comoDataUrl(comprovante.photoBase64), sha256: null, createdAt: comprovante.createdAt, replacedAt: null }]
    : [];
  const novas = (comprovante.photos ?? []).flatMap((foto) => (ehTipoDeFoto(foto.kind) ? [{ ...foto, kind: foto.kind }] : []));
  return [...antiga, ...novas];
}

/** As fotos que valem hoje: as substituídas num reenvio ficam só no histórico. */
export const fotosAtuais = <T extends { replacedAt: Date | string | null }>(fotos: readonly T[]): T[] => fotos.filter((foto) => foto.replacedAt === null);

/** Agrupa as fotos por tipo, na ordem de `TIPOS_DE_FOTO`, sem os tipos vazios. */
export function fotosPorTipo<T extends { kind: TipoDeFoto }>(fotos: readonly T[]): { tipo: TipoDeFoto; fotos: T[] }[] {
  return TIPOS_DE_FOTO.map((tipo) => ({ tipo, fotos: fotos.filter((foto) => foto.kind === tipo) })).filter((grupo) => grupo.fotos.length > 0);
}

/* -------------------------------- Quem recebeu -------------------------------- */

export const RELACOES = ["DESTINATARIO", "FUNCIONARIO", "PORTARIA", "FAMILIAR", "VIZINHO", "OUTRO"] as const;
export type Relacao = (typeof RELACOES)[number];

export const ROTULO_DA_RELACAO: Record<Relacao, string> = {
  DESTINATARIO: "Destinatário",
  FUNCIONARIO: "Funcionário",
  PORTARIA: "Portaria",
  FAMILIAR: "Familiar",
  VIZINHO: "Vizinho",
  OUTRO: "Outro",
};

export const RELACAO_MESSAGE = "Informe quem recebeu: destinatário, funcionário, portaria, familiar, vizinho ou outro.";

/** O rótulo da relação, ou `null` no comprovante antigo (sem relação) e em valor desconhecido. */
export const rotuloDaRelacao = (relacao: string | null | undefined): string | null =>
  relacao && Object.hasOwn(ROTULO_DA_RELACAO, relacao) ? ROTULO_DA_RELACAO[relacao as Relacao] : null;

/* ---------------------------------- Ressalva ---------------------------------- */

export const RESSALVAS = ["AVARIA", "FALTA", "VIOLADA", "OUTRA"] as const;
export type Ressalva = (typeof RESSALVAS)[number];

export const ROTULO_DA_RESSALVA: Record<Ressalva, string> = {
  AVARIA: "Avaria",
  FALTA: "Falta de volume",
  VIOLADA: "Embalagem violada",
  OUTRA: "Outra",
};

export const rotuloDaRessalva = (tipo: string | null | undefined): string | null =>
  tipo && Object.hasOwn(ROTULO_DA_RESSALVA, tipo) ? ROTULO_DA_RESSALVA[tipo as Ressalva] : null;

/** Avaria e embalagem violada pedem a foto do que se vê; falta de volume não tem o que fotografar. */
export const ressalvaPedeFoto = (tipo: string | null | undefined): boolean => tipo === "AVARIA" || tipo === "VIOLADA";

export const RESSALVA_NOTE_MIN = 5;
export const RESSALVA_NOTE_MAX = 500;
export const RESSALVA_TIPO_MESSAGE = "Escolha o tipo da ressalva.";
export const RESSALVA_NOTE_MESSAGE = `Descreva a ressalva (${RESSALVA_NOTE_MIN} a ${RESSALVA_NOTE_MAX} caracteres).`;

export const ressalvaSchema = z.object(
  {
    type: z.enum(RESSALVAS, RESSALVA_TIPO_MESSAGE),
    note: z.string(RESSALVA_NOTE_MESSAGE).trim().min(RESSALVA_NOTE_MIN, RESSALVA_NOTE_MESSAGE).max(RESSALVA_NOTE_MAX, RESSALVA_NOTE_MESSAGE),
  },
  INVALID_BODY,
);

/* ----------------------------- Perfil da empresa ----------------------------- */

export const PERFIS_DE_COMPROVANTE = ["LIVRE", "ECOMMERCE", "B2B"] as const;
export type PerfilDeComprovante = (typeof PERFIS_DE_COMPROVANTE)[number];
export const PERFIL_PADRAO: PerfilDeComprovante = "LIVRE";

export const ROTULO_DO_PERFIL_DE_COMPROVANTE: Record<PerfilDeComprovante, string> = {
  LIVRE: "Livre",
  ECOMMERCE: "E-commerce",
  B2B: "Carga B2B",
};

export const DESCRICAO_DO_PERFIL_DE_COMPROVANTE: Record<PerfilDeComprovante, string> = {
  LIVRE: "Foto e assinatura opcionais.",
  ECOMMERCE: "Exige a foto da carga no local da entrega.",
  B2B: "Exige a foto do canhoto assinado.",
};

export const PERFIL_MESSAGE = "Escolha o perfil: LIVRE, ECOMMERCE ou B2B.";

/** O perfil gravado na empresa; valor desconhecido (linha gravada por fora) vale o padrão. */
export const lerPerfil = (valor: string | null | undefined): PerfilDeComprovante =>
  (PERFIS_DE_COMPROVANTE as readonly string[]).includes(valor ?? "") ? (valor as PerfilDeComprovante) : PERFIL_PADRAO;

export const perfilDeComprovanteSchema = z.object({ perfil: z.enum(PERFIS_DE_COMPROVANTE, PERFIL_MESSAGE) }, INVALID_BODY);

/** A foto que o perfil exige na entrega, ou `null` quando não exige nenhuma. */
export const fotoExigida = (perfil: PerfilDeComprovante): TipoDeFoto | null => (perfil === "ECOMMERCE" ? "ENTREGA" : perfil === "B2B" ? "CANHOTO" : null);

export const FALTA_FOTO_DA_ENTREGA = "a foto da entrega";
export const FALTA_FOTO_DO_CANHOTO = "a foto do canhoto assinado";
export const FALTA_FOTO_DA_AVARIA = "a foto da avaria";

/**
 * O que falta nas fotos de uma entrega, pelo perfil da empresa e pela ressalva.
 * Lista vazia = nada falta. É a mesma conta no servidor (que recusa a baixa) e
 * na tela (que diz ao motorista o que tirar).
 */
export function oQueFaltaNasFotos(perfil: PerfilDeComprovante, tipos: readonly string[], ressalva: string | null | undefined): string[] {
  const falta: string[] = [];
  const exigida = fotoExigida(perfil);
  if (exigida === "ENTREGA" && !tipos.includes("ENTREGA")) falta.push(FALTA_FOTO_DA_ENTREGA);
  if (exigida === "CANHOTO" && !tipos.includes("CANHOTO")) falta.push(FALTA_FOTO_DO_CANHOTO);
  if (ressalvaPedeFoto(ressalva) && !tipos.includes("AVARIA")) falta.push(FALTA_FOTO_DA_AVARIA);
  return falta;
}

/** "a", "a e b", "a, b e c". */
export function enumerar(itens: readonly string[]): string {
  if (itens.length <= 1) return itens.join("");
  return `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`;
}

/** A frase da recusa (e do botão da tela): "Falta a foto do canhoto assinado." */
export const mensagemDoQueFalta = (falta: readonly string[]): string | null => (falta.length === 0 ? null : `Falta ${enumerar(falta)}.`);

/* ------------------------------ Corpo dos envios ------------------------------ */

const RECEIVER_NAME_MESSAGE = "Informe o nome de quem recebeu (2 a 120 caracteres).";
const RECEIVER_DOC_MESSAGE = "Informe o documento de quem recebeu (5 a 20 caracteres).";
const LOCATION_MESSAGE = "Localização inválida.";

export const nomeDeQuemRecebeu = z.string(RECEIVER_NAME_MESSAGE).trim().min(2, RECEIVER_NAME_MESSAGE).max(120, RECEIVER_NAME_MESSAGE);
export const documentoDeQuemRecebeu = z.string(RECEIVER_DOC_MESSAGE).trim().min(5, RECEIVER_DOC_MESSAGE).max(20, RECEIVER_DOC_MESSAGE);
export const latitudeSchema = z.number(LOCATION_MESSAGE).min(-90, LOCATION_MESSAGE).max(90, LOCATION_MESSAGE).nullish();
export const longitudeSchema = z.number(LOCATION_MESSAGE).min(-180, LOCATION_MESSAGE).max(180, LOCATION_MESSAGE).nullish();

const ID = z.string(INVALID_BODY).trim().min(1, INVALID_BODY).max(64, INVALID_BODY);
// Campo opcional do formulário: vazio vira ausente.
const vazioComoAusente = (valor: unknown) => (typeof valor === "string" && valor.trim() === "" ? undefined : valor);

export const SEM_FOTO_NOVA = "Envie pelo menos uma foto nova.";

/**
 * Reenvio de um comprovante devolvido: fotos novas e, se o motorista quiser
 * corrigir, o nome e o documento de quem recebeu. `rejectionId` diz a qual
 * devolução o envio responde: é o que deixa a repetição do mesmo envio
 * responder 200 sem gravar de novo.
 */
export const reenvioSchema = z.object(
  {
    rejectionId: ID,
    photos: fotosSchema.refine((fotos) => fotos.length > 0, SEM_FOTO_NOVA),
    receiverName: z.preprocess(vazioComoAusente, nomeDeQuemRecebeu.optional()),
    receiverDoc: z.preprocess(vazioComoAusente, documentoDeQuemRecebeu.optional()),
  },
  INVALID_BODY,
);

/* ------------------------- Tentativa de entrega sem sucesso ------------------------- */

export const MOTIVOS_DE_INSUCESSO = ["AUSENTE", "ENDERECO_NAO_LOCALIZADO", "RECUSADO", "FECHADO", "MUDOU_SE", "AREA_DE_RISCO", "OUTRO"] as const;
export type MotivoDeInsucesso = (typeof MOTIVOS_DE_INSUCESSO)[number];

export const ROTULO_DO_INSUCESSO: Record<MotivoDeInsucesso, string> = {
  AUSENTE: "Ausente",
  ENDERECO_NAO_LOCALIZADO: "Endereço não localizado",
  RECUSADO: "Recusou receber",
  FECHADO: "Estabelecimento fechado",
  MUDOU_SE: "Mudou-se",
  AREA_DE_RISCO: "Área de risco",
  OUTRO: "Outro",
};

export const rotuloDoInsucesso = (motivo: string): string => (Object.hasOwn(ROTULO_DO_INSUCESSO, motivo) ? ROTULO_DO_INSUCESSO[motivo as MotivoDeInsucesso] : motivo);

export const INSUCESSO_NOTE_MAX = 500;
export const INSUCESSO_MOTIVO_MESSAGE = "Escolha o motivo de não ter entregue.";
export const INSUCESSO_NOTE_MESSAGE = `Descreva o que aconteceu (5 a ${INSUCESSO_NOTE_MAX} caracteres).`;
export const INSUCESSO_SO_FACHADA = "Na entrega não realizada, a foto é a da fachada.";
export const INSUCESSO_SEM_FACHADA = "Falta a foto da fachada.";

/** Com perfil de e-commerce ou de carga B2B, a tentativa sem sucesso só vale com a foto da fachada. */
export const insucessoPedeFachada = (perfil: PerfilDeComprovante): boolean => perfil !== "LIVRE";

/** O que impede registrar a tentativa, ou `null`. Mesma conta no servidor e na tela. */
export function problemaNoInsucesso(perfil: PerfilDeComprovante, tipos: readonly string[]): string | null {
  return insucessoPedeFachada(perfil) && !tipos.includes("FACHADA") ? INSUCESSO_SEM_FACHADA : null;
}

/**
 * Tentativa de entrega sem sucesso, registrada pelo motorista. A descrição é
 * obrigatória só no motivo "Outro". `key` é a chave que o aparelho gera para a
 * tentativa: repetir o envio com a mesma chave não cria outra.
 */
export const insucessoSchema = z
  .object(
    {
      reason: z.enum(MOTIVOS_DE_INSUCESSO, INSUCESSO_MOTIVO_MESSAGE),
      note: z.preprocess(vazioComoAusente, z.string(INSUCESSO_NOTE_MESSAGE).trim().max(INSUCESSO_NOTE_MAX, INSUCESSO_NOTE_MESSAGE).nullish()),
      photos: fotosSchema.optional(),
      latitude: latitudeSchema,
      longitude: longitudeSchema,
      key: z.preprocess(vazioComoAusente, ID.nullish()),
    },
    INVALID_BODY,
  )
  .superRefine((dados, ctx) => {
    if (dados.reason === "OUTRO" && (dados.note ?? "").length < 5) {
      ctx.addIssue({ code: "custom", message: INSUCESSO_NOTE_MESSAGE, path: ["note"] });
    }
    if ((dados.photos ?? []).some((foto) => foto.kind !== "FACHADA")) {
      ctx.addIssue({ code: "custom", message: INSUCESSO_SO_FACHADA, path: ["photos"] });
    }
  });

/** O corpo é de uma tentativa sem sucesso (traz `reason`) e não de uma ocorrência comum (traz `type`). */
export const ehInsucesso = (corpo: unknown): boolean => typeof corpo === "object" && corpo !== null && !Array.isArray(corpo) && "reason" in corpo;

/** "1 tentativa sem sucesso", "2 tentativas sem sucesso". */
export const textoDasTentativas = (quantas: number): string => `${plural(quantas, "tentativa", "tentativas")} sem sucesso`;

/** Título do chamado que a tentativa abre para a equipe. */
export const tituloDoInsucesso = (motivo: MotivoDeInsucesso, destinatario: string): string =>
  `Entrega não realizada (${ROTULO_DO_INSUCESSO[motivo]}): ${destinatario}`.slice(0, 120);

/* --------------------------------- Distância --------------------------------- */

/** A partir de quantos metros do endereço o painel avisa. */
export const LONGE_DO_ENDERECO_M = 500;

type Coordenada = { latitude?: number | null; longitude?: number | null };

/**
 * Distância em linha reta, em metros inteiros, entre a posição do registro e a
 * coordenada do endereço de entrega. `null` quando falta uma das duas.
 */
export function distanciaEmMetros(posicao: Coordenada, destino: { deliveryLat?: number | null; deliveryLon?: number | null }): number | null {
  const { latitude, longitude } = posicao;
  const { deliveryLat, deliveryLon } = destino;
  if (typeof latitude !== "number" || typeof longitude !== "number" || typeof deliveryLat !== "number" || typeof deliveryLon !== "number") return null;
  const aqui: Ponto = { lat: latitude, lon: longitude };
  return Math.round(distanciaKm(aqui, { lat: deliveryLat, lon: deliveryLon }) * 1000);
}

/** "620 m", "1,2 km", "12 km". */
export function textoDaDistancia(metros: number): string {
  if (metros < 1000) return `${metros} m`;
  const km = metros / 1000;
  return `${km < 10 ? km.toLocaleString("pt-BR", { maximumFractionDigits: 1 }) : Math.round(km).toLocaleString("pt-BR")} km`;
}

/** O aviso do painel para o registro feito longe do endereço, ou `null` (perto, sem posição ou sem coordenada). */
export const avisoDeDistancia = (metros: number | null | undefined): string | null =>
  typeof metros === "number" && metros > LONGE_DO_ENDERECO_M ? `a ${textoDaDistancia(metros)} do endereço` : null;

/* ------------------------- Situação da parada na viagem ------------------------ */

export const SITUACOES_DA_PARADA = ["PENDENTE", "INSUCESSO", "ENTREGUE", "RESSALVA", "REFAZER"] as const;
export type SituacaoDaParada = (typeof SITUACOES_DA_PARADA)[number];

/** O que o aplicativo do motorista sabe de cada carga da viagem. */
export type ResumoDaParada = { status: string; proofStatus?: string | null; withException?: boolean; attempts?: number };

/**
 * Como a parada aparece de relance na viagem do motorista. O comprovante
 * devolvido vem primeiro (é o que pede ação); depois a ressalva; a tentativa
 * sem sucesso só vale enquanto a carga não foi entregue.
 */
export function situacaoDaParada(parada: ResumoDaParada): SituacaoDaParada {
  if (parada.status === "DELIVERED") {
    if (parada.proofStatus === "REJECTED") return "REFAZER";
    return parada.withException ? "RESSALVA" : "ENTREGUE";
  }
  return (parada.attempts ?? 0) > 0 ? "INSUCESSO" : "PENDENTE";
}

export function rotuloDaSituacao(parada: ResumoDaParada): string {
  const situacao = situacaoDaParada(parada);
  if (situacao === "REFAZER") return "Comprovante para refazer";
  if (situacao === "RESSALVA") return "Entregue com ressalva";
  if (situacao === "ENTREGUE") return "Entregue";
  if (situacao === "INSUCESSO") return textoDasTentativas(parada.attempts ?? 0);
  return "Pendente";
}

/* ------------------------- Devolução e reenvio: mensagens ------------------------- */

export const NAO_FOI_DEVOLVIDO = "Este comprovante não está devolvido para refazer.";
export const DEVOLUCAO_NAO_ENCONTRADA = "Devolução não encontrada neste comprovante.";
export const COMPROVANTE_DO_MOTORISTA_NAO_ENCONTRADO = "Comprovante não encontrado nas suas viagens.";

/** O que a lista "Comprovantes para refazer" do motorista traz de cada um. */
export type ComprovanteParaRefazer = {
  collectionId: string;
  receiver: string;
  destination: string;
  receiverName: string;
  receiverDoc: string;
  exceptionType: string | null;
  rejectionId: string;
  reason: string;
  rejectedAt: string;
};

/** Resposta de `GET /api/driver/comprovantes`. */
export type ComprovantesDoMotorista = { perfil: PerfilDeComprovante; refazer: ComprovanteParaRefazer[] };
