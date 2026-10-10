import { z } from "zod";
import { canTransition, fromFormNumber } from "@/lib/coletas";

/**
 * Recebimento, conferência e depósito. Regras e formatos comuns às rotas e às
 * telas; este arquivo também é importado pela tela, então não pode puxar nada
 * que só exista no servidor.
 *
 * A carga diz quantos volumes tem. Cada volume tem um código, o de rastreio da
 * carga mais a sequência ("1234567890-02"), que é o que a etiqueta imprime e o
 * leitor lê. O volume só ganha linha no banco quando é conferido: recebido,
 * avariado ou faltando. Sem linha, ele está "a conferir".
 *
 * Concluir a conferência grava quem, quando e as divergências, marca como
 * faltando o que não foi lido e, se a carga estava confirmada, passa para
 * coletada pela mesma regra do painel de minutas. Enquanto a carga estiver no
 * depósito (confirmada ou coletada) os volumes podem ser corrigidos, e a
 * conferência gravada acompanha.
 */

export const VOLUME_STATUSES = ["RECEIVED", "DAMAGED", "MISSING"] as const;
export type VolumeStatus = (typeof VOLUME_STATUSES)[number];

/** Na tela existe mais uma situação, a do volume que ainda não tem linha. */
export type SituacaoDoVolume = VolumeStatus | "PENDING";

export const SITUACAO_DO_VOLUME: Record<SituacaoDoVolume, string> = {
  PENDING: "A conferir",
  RECEIVED: "Recebido",
  DAMAGED: "Avariado",
  MISSING: "Faltando",
};

/** Mercadoria parada há mais do que isto, em dias, entra nos alertas do depósito. */
export const DIAS_PARADO_ALERTA = 3;

/** Diferença entre o peso conferido e o declarado, em %, a partir da qual há divergência de peso. */
export const TOLERANCIA_DE_PESO_PCT = 2;

/**
 * Teto de volumes para conferir e etiquetar um a um. A coluna aceita bilhões;
 * acima disto a lista não caberia na tela nem a etiqueta no papel.
 */
export const MAX_VOLUMES_CONFERIVEIS = 999;

// O código de rastreio tem 10 dígitos (src/lib/tracking.ts, que não pode ser
// importado aqui porque usa o `crypto` do servidor).
const DIGITOS_DO_RASTREIO = 10;

const CODIGO_DA_CARGA = new RegExp(`^\\d{${DIGITOS_DO_RASTREIO}}$`);
const CODIGO_DO_VOLUME = new RegExp(`^(\\d{${DIGITOS_DO_RASTREIO}})-(\\d{1,4})$`);

const POSICAO_MAX = 20;
// Letras, números e hífen entre os trechos, com ao menos uma letra: assim o
// código de uma posição nunca se confunde com o de uma carga, que é só dígito.
const CODIGO_DA_POSICAO = /^(?=.*[A-Z])[A-Z0-9]+(-[A-Z0-9]+)*$/;

/* --------------------------------- Códigos --------------------------------- */

/** "1234567890" e 2 → "1234567890-02". A sequência tem ao menos dois dígitos. */
export function codigoDoVolume(trackingCode: string, sequence: number): string {
  return `${trackingCode}-${String(sequence).padStart(2, "0")}`;
}

/** Como a posição é gravada e comparada: sem espaço e em maiúsculas. */
export const normalizarPosicao = (texto: string): string => texto.replace(/\s+/g, "").toUpperCase();

export const ehCodigoDePosicao = (codigo: string): boolean => codigo.length <= POSICAO_MAX && CODIGO_DA_POSICAO.test(codigo);

export type Leitura =
  | { tipo: "CARGA"; trackingCode: string }
  | { tipo: "VOLUME"; trackingCode: string; sequence: number }
  | { tipo: "POSICAO"; code: string }
  | { tipo: "INVALIDO" };

/**
 * O que o operador digitou ou o leitor leu: o código de rastreio de uma carga,
 * a etiqueta de um volume ou o código de uma posição. O leitor de código de
 * barras é um teclado, então tudo chega pelo mesmo campo.
 */
export function interpretarLeitura(texto: string): Leitura {
  const lido = normalizarPosicao(texto);
  if (CODIGO_DA_CARGA.test(lido)) return { tipo: "CARGA", trackingCode: lido };

  const volume = CODIGO_DO_VOLUME.exec(lido);
  if (volume) {
    const sequence = Number(volume[2]);
    return sequence >= 1 ? { tipo: "VOLUME", trackingCode: volume[1], sequence } : { tipo: "INVALIDO" };
  }

  return ehCodigoDePosicao(lido) ? { tipo: "POSICAO", code: lido } : { tipo: "INVALIDO" };
}

/* ------------------------------- Conferência ------------------------------- */

/** A carga pode ser conferida se já está coletada ou se o painel pode passá-la para coletada. */
export const podeConferir = (status: string): boolean => status === "COLLECTED" || canTransition(status, "COLLECTED");

const RECUSA_POR_STATUS: Record<string, string> = {
  PENDING: "Esta carga ainda aguarda confirmação. Confirme a coleta antes de receber no depósito.",
  ROUTE: "Esta carga já saiu para entrega.",
  DELIVERED: "Esta carga já foi entregue.",
  CANCELLED: "Esta carga foi cancelada.",
  REJECTED: "Esta carga foi recusada.",
};

/** Por que a carga não pode ser conferida; `null` se pode. */
export function recusaDeConferencia(carga: { status: string; trackingCode: string | null; volumes: number }): string | null {
  if (!podeConferir(carga.status)) return RECUSA_POR_STATUS[carga.status] ?? "Esta carga não pode ser conferida.";
  if (!carga.trackingCode) return "Esta carga não tem código de rastreio: os volumes não têm como ser identificados.";
  if (carga.volumes > MAX_VOLUMES_CONFERIVEIS) {
    return `Esta carga tem mais de ${MAX_VOLUMES_CONFERIVEIS} volumes: não é conferida volume a volume.`;
  }
  return null;
}

/** O que a conferência guarda de um volume. */
export type DadosDoVolume = { status: VolumeStatus; weight: number | null; damageNote: string | null };

export type PedidoDeVolume = { status?: VolumeStatus; weight?: number | null; damageNote?: string | null };

/**
 * O que gravar quando chega um registro de volume.
 *
 * Sem `status` é uma leitura (o leitor bipou a etiqueta ou o operador tocou em
 * "Conferir"): volume novo fica recebido; volume já conferido não muda e a
 * leitura volta como repetida, para não contar duas vezes; o que estava
 * faltando e apareceu passa a recebido.
 *
 * Com `status` é uma correção: vale o que veio. Peso ausente mantém o que
 * havia; faltando não tem peso nem avaria; recebido não tem avaria.
 */
export function registroDoVolume(atual: DadosDoVolume | null, pedido: PedidoDeVolume): { repetido: boolean; dados: DadosDoVolume } {
  if (pedido.status === undefined) {
    if (atual && atual.status !== "MISSING") return { repetido: true, dados: atual };
    return { repetido: false, dados: { status: "RECEIVED", weight: null, damageNote: null } };
  }

  if (pedido.status === "MISSING") return { repetido: false, dados: { status: "MISSING", weight: null, damageNote: null } };

  return {
    repetido: false,
    dados: {
      status: pedido.status,
      weight: pedido.weight === undefined ? (atual?.weight ?? null) : pedido.weight,
      damageNote: pedido.status === "DAMAGED" ? (pedido.damageNote ?? atual?.damageNote ?? null) : null,
    },
  };
}

export type Resumo = {
  /** Volumes declarados na carga. */
  esperados: number;
  /** Presentes e sem avaria. */
  recebidos: number;
  /** Presentes, com avaria. */
  avariados: number;
  faltando: number;
  /** Ainda sem conferência. */
  pendentes: number;
  /** Soma dos pesos conferidos; `null` enquanto algum volume presente não foi pesado. */
  pesoConferido: number | null;
  divergenciaDeQuantidade: boolean;
  divergenciaDePeso: boolean;
};

const gramas = (kg: number) => Math.round(kg * 1000) / 1000;

/**
 * As contas da conferência. Linha de sequência acima do declarado (a carga
 * teve os volumes reduzidos depois) não entra.
 *
 * Divergência de quantidade: chegou um número de volumes diferente do
 * declarado. Divergência de peso: só se compara quando todos os volumes
 * chegaram e todos foram pesados; com volume faltando, o peso a menos já está
 * explicado pela quantidade.
 */
export function resumoDaConferencia(
  esperados: number,
  pesoDeclarado: number,
  linhas: readonly { sequence: number; status: string; weight: number | null }[],
): Resumo {
  const validas = linhas.filter((linha) => linha.sequence >= 1 && linha.sequence <= esperados);
  const presentes = validas.filter((linha) => linha.status !== "MISSING");
  const avariados = presentes.filter((linha) => linha.status === "DAMAGED").length;
  const faltando = validas.length - presentes.length;

  const todosPesados = presentes.length > 0 && presentes.every((linha) => linha.weight !== null);
  const pesoConferido = todosPesados ? gramas(presentes.reduce((soma, linha) => soma + (linha.weight ?? 0), 0)) : null;

  // Arredondados ao grama: sem isso 30,6 − 30 dá 0,6000000000000014 e passa de uma tolerância de 0,6.
  const tolerancia = gramas((pesoDeclarado * TOLERANCIA_DE_PESO_PCT) / 100);
  const diferenca = pesoConferido === null ? 0 : gramas(Math.abs(pesoConferido - pesoDeclarado));
  const chegouTudo = presentes.length === esperados;

  return {
    esperados,
    recebidos: presentes.length - avariados,
    avariados,
    faltando,
    pendentes: esperados - validas.length,
    pesoConferido,
    divergenciaDeQuantidade: !chegouTudo,
    divergenciaDePeso: chegouTudo && diferenca > tolerancia,
  };
}

/** Sequências que ainda não têm linha: é o que concluir a conferência marca como faltando. */
export function sequenciasPendentes(esperados: number, linhas: readonly { sequence: number }[]): number[] {
  const conferidas = new Set(linhas.map((linha) => linha.sequence));
  const pendentes: number[] = [];
  for (let sequence = 1; sequence <= esperados; sequence += 1) {
    if (!conferidas.has(sequence)) pendentes.push(sequence);
  }
  return pendentes;
}

/* ------------------------- O que as rotas devolvem ------------------------- */

const VOLUME_SELECT = {
  sequence: true,
  code: true,
  status: true,
  weight: true,
  damageNote: true,
  checkedAt: true,
  checkedBy: { select: { id: true, name: true } },
  location: { select: { id: true, code: true } },
} as const;

const CONFERENCIA_SELECT = {
  concludedAt: true,
  expectedVolumes: true,
  receivedVolumes: true,
  damagedVolumes: true,
  missingVolumes: true,
  declaredWeight: true,
  checkedWeight: true,
  quantityDivergence: true,
  weightDivergence: true,
  user: { select: { id: true, name: true } },
} as const;

/**
 * A carga como o depósito a lê. Sem valor de nota nem frete: o depósito não
 * mostra dado financeiro.
 */
export const CARGA_SELECT = {
  id: true,
  trackingCode: true,
  status: true,
  manifestId: true,
  sender: true,
  receiver: true,
  origin: true,
  destination: true,
  volumes: true,
  weight: true,
  client: { select: { id: true, companyName: true, tradeName: true } },
  warehouseReceipt: { select: CONFERENCIA_SELECT },
  volumeItems: { select: VOLUME_SELECT, orderBy: { sequence: "asc" } },
} as const;

/** A posição na lista do cadastro, com quantos volumes há nela. */
export const POSICAO_SELECT = {
  id: true,
  code: true,
  description: true,
  active: true,
  // Volume presente de carga que ainda está no depósito (confirmada ou
  // coletada). O que já saiu para entrega continua com a posição gravada, mas
  // não ocupa mais o lugar.
  _count: {
    select: {
      volumes: { where: { status: { not: "MISSING" }, collection: { status: { in: ["CONFIRMED", "COLLECTED"] as string[] } } } },
    },
  },
} as const;

type Instante = Date | string;
type Pessoa = { id: string; name: string };

type LinhaDeVolume = {
  sequence: number;
  code: string;
  status: string;
  weight: number | null;
  damageNote: string | null;
  checkedAt: Instante;
  checkedBy: Pessoa | null;
  location: { id: string; code: string } | null;
};

export type Conferencia = {
  concludedAt: Instante;
  expectedVolumes: number;
  receivedVolumes: number;
  damagedVolumes: number;
  missingVolumes: number;
  declaredWeight: number;
  checkedWeight: number | null;
  quantityDivergence: boolean;
  weightDivergence: boolean;
  user: Pessoa | null;
};

/** A linha lida do banco com `CARGA_SELECT`. */
export type CargaLida = {
  id: string;
  trackingCode: string | null;
  status: string;
  manifestId: string | null;
  sender: string;
  receiver: string;
  origin: string;
  destination: string;
  volumes: number;
  weight: number;
  client: { id: string; companyName: string; tradeName: string | null };
  warehouseReceipt: Conferencia | null;
  volumeItems: LinhaDeVolume[];
};

export type VolumeDaCarga = {
  sequence: number;
  code: string;
  status: SituacaoDoVolume;
  weight: number | null;
  damageNote: string | null;
  checkedAt: Instante | null;
  checkedBy: Pessoa | null;
  location: { id: string; code: string } | null;
};

export type CargaConferida = {
  carga: {
    id: string;
    trackingCode: string | null;
    status: string;
    emManifesto: boolean;
    cliente: string;
    sender: string;
    receiver: string;
    origin: string;
    destination: string;
    volumes: number;
    weight: number;
  };
  /** Um por volume declarado, na ordem; vazio se a carga não pode ser etiquetada. */
  volumes: VolumeDaCarga[];
  resumo: Resumo;
  conferencia: Conferencia | null;
  /** Por que a carga não pode ser conferida agora; `null` se pode. */
  recusa: string | null;
};

const ehSituacao = (valor: string): valor is VolumeStatus => (VOLUME_STATUSES as readonly string[]).includes(valor);

export const nomeDoCliente = (cliente: { companyName: string; tradeName: string | null }): string => cliente.tradeName || cliente.companyName;

/**
 * Os volumes da carga, um por sequência de 1 até o declarado: os conferidos
 * com o que foi gravado, os outros "a conferir" com o código que a etiqueta
 * leva. Carga sem código de rastreio ou acima do teto não tem lista.
 */
export function volumesDaCarga(carga: Pick<CargaLida, "trackingCode" | "volumes" | "volumeItems">): VolumeDaCarga[] {
  if (!carga.trackingCode || carga.volumes > MAX_VOLUMES_CONFERIVEIS) return [];

  const porSequencia = new Map(carga.volumeItems.map((linha) => [linha.sequence, linha]));
  const volumes: VolumeDaCarga[] = [];
  for (let sequence = 1; sequence <= carga.volumes; sequence += 1) {
    const linha = porSequencia.get(sequence);
    volumes.push(
      linha
        ? { ...linha, status: ehSituacao(linha.status) ? linha.status : "RECEIVED" }
        : {
            sequence,
            code: codigoDoVolume(carga.trackingCode, sequence),
            status: "PENDING",
            weight: null,
            damageNote: null,
            checkedAt: null,
            checkedBy: null,
            location: null,
          },
    );
  }
  return volumes;
}

/** A resposta das rotas de conferência e de etiqueta. */
export function cargaConferida(linha: CargaLida): CargaConferida {
  return {
    carga: {
      id: linha.id,
      trackingCode: linha.trackingCode,
      status: linha.status,
      emManifesto: linha.manifestId !== null,
      cliente: nomeDoCliente(linha.client),
      sender: linha.sender,
      receiver: linha.receiver,
      origin: linha.origin,
      destination: linha.destination,
      volumes: linha.volumes,
      weight: linha.weight,
    },
    volumes: volumesDaCarga(linha),
    resumo: resumoDaConferencia(linha.volumes, linha.weight, linha.volumeItems),
    conferencia: linha.warehouseReceipt,
    recusa: recusaDeConferencia(linha),
  };
}

/* ---------------------------- Visão do depósito ---------------------------- */

export const ALERTAS_DO_DEPOSITO = ["PARADA", "DIVERGENCIA", "AVARIA", "SEM_POSICAO"] as const;
export type AlertaDoDeposito = (typeof ALERTAS_DO_DEPOSITO)[number];

export const ROTULO_DO_ALERTA: Record<AlertaDoDeposito, string> = {
  PARADA: `Parada há mais de ${DIAS_PARADO_ALERTA} dias`,
  DIVERGENCIA: "Divergência de quantidade",
  AVARIA: "Volume avariado",
  SEM_POSICAO: "Sem posição",
};

const DIA_EM_MS = 86_400_000;

/** Dias inteiros desde a entrada no depósito. Menos de 24 horas é zero. */
export function diasParado(entrouEm: Instante, agora: Date = new Date()): number {
  return Math.max(0, Math.floor((agora.getTime() - new Date(entrouEm).getTime()) / DIA_EM_MS));
}

/**
 * Quando a carga entrou no depósito: o instante em que passou para coletada.
 * Carga anterior ao histórico de status fica com a data da conferência e, sem
 * conferência, com a da última alteração.
 */
export function dataDeEntrada(carga: { coletadaEm: Instante | null; conferidaEm: Instante | null; updatedAt: Instante }): Instante {
  return carga.coletadaEm ?? carga.conferidaEm ?? carga.updatedAt;
}

export type CargaNoDeposito = {
  id: string;
  trackingCode: string | null;
  cliente: string;
  receiver: string;
  destination: string;
  /** Volumes declarados. */
  volumes: number;
  weight: number;
  entrouEm: Instante;
  dias: number;
  /** `null` se a carga foi dada como coletada sem passar pela conferência. */
  conferencia: Pick<Conferencia, "concludedAt" | "receivedVolumes" | "damagedVolumes" | "missingVolumes" | "quantityDivergence" | "weightDivergence"> | null;
  /** Posições em que há volume desta carga, em ordem. */
  posicoes: string[];
  alertas: AlertaDoDeposito[];
};

type VolumeNoDeposito = { status: string; location: { code: string } | null };

/**
 * Os alertas de uma carga que está no depósito.
 *
 * Sem posição: carga que não passou pela conferência (não tem volume em lugar
 * nenhum) ou que tem volume presente ainda não alocado.
 */
export function alertasDaCarga(
  carga: { dias: number; conferencia: { quantityDivergence: boolean } | null; volumeItems: readonly VolumeNoDeposito[] },
): AlertaDoDeposito[] {
  const presentes = carga.volumeItems.filter((volume) => volume.status !== "MISSING");
  const alertas: AlertaDoDeposito[] = [];
  if (carga.dias > DIAS_PARADO_ALERTA) alertas.push("PARADA");
  if (carga.conferencia?.quantityDivergence) alertas.push("DIVERGENCIA");
  if (presentes.some((volume) => volume.status === "DAMAGED")) alertas.push("AVARIA");
  if (carga.volumeItems.length === 0 || presentes.some((volume) => volume.location === null)) alertas.push("SEM_POSICAO");
  return alertas;
}

/** As posições em que há volume presente, sem repetir, em ordem. */
export function posicoesDaCarga(volumes: readonly VolumeNoDeposito[]): string[] {
  const codigos = volumes.filter((volume) => volume.status !== "MISSING" && volume.location).map((volume) => volume.location!.code);
  return [...new Set(codigos)].sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }));
}

export type ContadoresDoDeposito = { cargas: number; volumes: number } & Record<AlertaDoDeposito, number>;

/** Os cartões do topo: quantas cargas e volumes estão no depósito e quantas cargas há em cada alerta. */
export function contadoresDoDeposito(cargas: readonly Pick<CargaNoDeposito, "volumes" | "alertas">[]): ContadoresDoDeposito {
  const contadores: ContadoresDoDeposito = { cargas: cargas.length, volumes: 0, PARADA: 0, DIVERGENCIA: 0, AVARIA: 0, SEM_POSICAO: 0 };
  for (const carga of cargas) {
    contadores.volumes += carga.volumes;
    for (const alerta of carga.alertas) contadores[alerta] += 1;
  }
  return contadores;
}

const semAcento = (texto: string) => texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Busca da visão do depósito: por código de rastreio (ou a etiqueta de um
 * volume), cliente ou posição. Em branco devolve tudo.
 */
export function buscarNoDeposito<T extends Pick<CargaNoDeposito, "trackingCode" | "cliente" | "posicoes">>(cargas: readonly T[], termo: string): T[] {
  const procurado = semAcento(termo.trim());
  if (procurado === "") return [...cargas];

  // A etiqueta do volume começa pelo código da carga: lê-la acha a carga.
  const leitura = interpretarLeitura(termo);
  const codigo = leitura.tipo === "VOLUME" ? leitura.trackingCode : procurado;

  return cargas.filter(
    (carga) =>
      (carga.trackingCode ?? "").includes(codigo) ||
      semAcento(carga.cliente).includes(procurado) ||
      carga.posicoes.some((posicao) => semAcento(posicao).includes(procurado)),
  );
}

/* -------------------------------- Validação -------------------------------- */

const INVALID_BODY = "Dados inválidos.";
const NOTHING_TO_CHANGE = "Informe ao menos um campo para alterar.";
const SEQUENCIA_MESSAGE = "Número do volume inválido.";
const PESO_MESSAGE = "O peso conferido precisa ser um número maior que zero.";
const AVARIA_MESSAGE = "Descreva a avaria.";
const POSICAO_MESSAGE = "Código de posição inválido: use letras, números e hífen, com ao menos uma letra (ex.: A-01-03).";
const NOTA_MAX = 500;
const DESCRICAO_MAX = 120;

// Campo opcional do formulário: vazio vira `null`; ausente não mexe.
const vazioComoNulo = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);

const sequencia = z.number(SEQUENCIA_MESSAGE).int(SEQUENCIA_MESSAGE).min(1, SEQUENCIA_MESSAGE).max(MAX_VOLUMES_CONFERIVEIS, SEQUENCIA_MESSAGE);

const codigoDePosicao = z
  .string(POSICAO_MESSAGE)
  .transform(normalizarPosicao)
  .refine(ehCodigoDePosicao, POSICAO_MESSAGE);

/**
 * Registro de um volume. Só `codigo` (a etiqueta lida) ou só `sequence` (o
 * toque em "Conferir") é uma leitura; com `status` é uma correção.
 */
export const registrarVolumeSchema = z
  .object(
    {
      codigo: z.string("Código do volume inválido.").trim().min(1, "Código do volume inválido.").max(40, "Código do volume inválido.").optional(),
      sequence: sequencia.optional(),
      status: z.enum(VOLUME_STATUSES, "Situação inválida.").optional(),
      weight: z.preprocess(fromFormNumber, z.number(PESO_MESSAGE).gt(0, PESO_MESSAGE).nullish()),
      damageNote: z.preprocess(vazioComoNulo, z.string(AVARIA_MESSAGE).trim().max(NOTA_MAX, "Descrição da avaria muito longa.").nullish()),
    },
    INVALID_BODY,
  )
  .refine((data) => (data.codigo === undefined) !== (data.sequence === undefined), { message: "Informe o código ou o número do volume." })
  .refine((data) => data.status !== undefined || (data.weight === undefined && data.damageNote === undefined), {
    message: "Informe a situação do volume.",
  })
  .refine((data) => data.status !== "DAMAGED" || Boolean(data.damageNote), { message: AVARIA_MESSAGE });

/**
 * Alocação de volumes a uma posição. Posição em branco tira os volumes de onde
 * estão. Sem `sequences`, vale para todos os volumes presentes da carga.
 */
export const alocarPosicaoSchema = z.object(
  {
    locationCode: z.preprocess(vazioComoNulo, codigoDePosicao.nullable()),
    sequences: z.array(sequencia, SEQUENCIA_MESSAGE).min(1, SEQUENCIA_MESSAGE).max(MAX_VOLUMES_CONFERIVEIS, SEQUENCIA_MESSAGE).optional(),
  },
  INVALID_BODY,
);

const descricaoDaPosicao = z.preprocess(vazioComoNulo, z.string(INVALID_BODY).trim().max(DESCRICAO_MAX, "Descrição muito longa.").nullish());

export const createLocationSchema = z.object({ code: codigoDePosicao, description: descricaoDaPosicao }, INVALID_BODY);

export const updateLocationSchema = z
  .object(
    {
      code: codigoDePosicao.optional(),
      description: descricaoDaPosicao,
      active: z.boolean(INVALID_BODY).optional(),
    },
    INVALID_BODY,
  )
  .refine((data) => Object.values(data).some((value) => value !== undefined), { message: NOTHING_TO_CHANGE });

export const POSICAO_REPETIDA = "Já existe uma posição com este código.";
export const POSICAO_NAO_ENCONTRADA = "Posição não encontrada ou inativa.";
export const CARGA_NAO_ENCONTRADA = "Carga não encontrada.";
