import { z } from "zod";
import { PAYMENT_METHODS, diaDoVencimento, diaNoBrasil } from "@/lib/financeiro";

/**
 * Viagem completa: dados da viagem (ajudante, hodômetro, previsões), ordem das
 * entregas, rota no mapa, despesas e o acerto com o resultado. Regras e contas
 * comuns às rotas e às telas; este arquivo não toca no banco.
 *
 * O que cada conta do acerto considera:
 * - **Frete**: a soma do frete das cargas da viagem. Carga a cotar não soma e é
 *   contada à parte.
 * - **Despesas**: só as aprovadas. Pendente e recusada ficam fora do custo; as
 *   pendentes aparecem no quadro para ninguém fechar a viagem sem vê-las.
 * - **Combustível**: os abastecimentos da frota feitos no veículo entre a saída
 *   e a finalização, MENOS os que nasceram de uma despesa da viagem: esses já
 *   estão em "despesas" e contar de novo dobraria o custo.
 * - **Resultado** = frete − despesas − combustível. Adiantamento não é custo: é
 *   dinheiro entregue por conta das despesas, e o quadro mostra quanto sobrou
 *   ou faltou dele.
 *
 * Datas: o dia da despesa é dia do calendário (meia-noite UTC, lido em UTC),
 * como o do abastecimento. Saída, finalização e previsões são instantes.
 */

const centavos = (valor: number) => Math.round((valor + Number.EPSILON) * 100) / 100;
const umaCasa = (valor: number) => Math.round(valor * 10) / 10;

/** Como a viagem é chamada nas telas e nas descrições: os seis primeiros caracteres do id. */
export const codigoDaViagem = (id: string) => id.substring(0, 6).toUpperCase();

/* ------------------------------ Ordem das entregas ---------------------------- */

export type ParadaOrdenavel = { manifestSequence: number | null; createdAt?: Date | string | null };

/**
 * As cargas na ordem da viagem: primeiro as que têm sequência, da menor para a
 * maior; depois as sem sequência, pela data de criação (a ordem de antes desta
 * coluna existir). Não altera a lista recebida.
 */
export function ordenarParadas<T extends ParadaOrdenavel>(cargas: readonly T[]): T[] {
  const criada = (carga: T) => (carga.createdAt ? new Date(carga.createdAt).getTime() : 0);
  return cargas
    .map((carga, posicao) => ({ carga, posicao }))
    .sort((a, b) => {
      const sa = a.carga.manifestSequence;
      const sb = b.carga.manifestSequence;
      if (sa !== null && sb !== null && sa !== sb) return sa - sb;
      if (sa === null && sb !== null) return 1;
      if (sa !== null && sb === null) return -1;
      return criada(a.carga) - criada(b.carga) || a.posicao - b.posicao;
    })
    .map(({ carga }) => carga);
}

/** A lista de ids com `id` uma posição acima ou abaixo. Na ponta, ou com id desconhecido, devolve a ordem como está. */
export function moverParada(ids: readonly string[], id: string, sentido: "subir" | "descer"): string[] {
  const de = ids.indexOf(id);
  const para = sentido === "subir" ? de - 1 : de + 1;
  if (de === -1 || para < 0 || para >= ids.length) return [...ids];
  const nova = [...ids];
  [nova[de], nova[para]] = [nova[para], nova[de]];
  return nova;
}

/** `true` quando a ordem pedida tem exatamente as cargas da viagem, cada uma uma vez. */
export function ordemCompleta(daViagem: readonly string[], pedida: readonly string[]): boolean {
  if (daViagem.length !== pedida.length || new Set(pedida).size !== pedida.length) return false;
  const conhecidas = new Set(daViagem);
  return pedida.every((id) => conhecidas.has(id));
}

/* -------------------------------- Rota no mapa -------------------------------- */

/**
 * Quantas paradas cabem no link: o Google Maps aceita o destino e até 9 pontos
 * intermediários num link de rota.
 */
export const MAX_PARADAS_NO_LINK = 10;

export type LinkDaRota = {
  /** `null` quando não há parada com endereço. */
  url: string | null;
  /** Paradas que entraram no link. */
  incluidas: number;
  /** Paradas que ficaram de fora por passar do limite do link. */
  deFora: number;
};

/**
 * O link do Google Maps com as paradas na ordem recebida. Sem API e sem chave:
 * é só o endereço `https://www.google.com/maps/dir/?api=1...`, que abre o
 * aplicativo no celular. A origem não vai no link: o mapa parte de onde o
 * aparelho está. A última parada é o destino; as anteriores, os pontos
 * intermediários.
 *
 * Endereço em branco é ignorado, e duas paradas seguidas no mesmo endereço
 * viram uma. Passando de `MAX_PARADAS_NO_LINK`, entram as primeiras.
 */
export function linkDaRota(enderecos: readonly string[]): LinkDaRota {
  const paradas: string[] = [];
  for (const endereco of enderecos) {
    const limpo = endereco.replace(/\s+/g, " ").trim();
    if (limpo === "") continue;
    if (paradas.length > 0 && paradas[paradas.length - 1].toLocaleLowerCase("pt-BR") === limpo.toLocaleLowerCase("pt-BR")) continue;
    paradas.push(limpo);
  }
  if (paradas.length === 0) return { url: null, incluidas: 0, deFora: 0 };

  const noLink = paradas.slice(0, MAX_PARADAS_NO_LINK);
  const destino = noLink[noLink.length - 1];
  const intermediarias = noLink.slice(0, -1);
  // encodeURIComponent cuida de acento, vírgula, "&", "#" e "/"; a barra vertical
  // que separa os pontos intermediários também vai codificada (%7C).
  const partes = ["api=1", `destination=${encodeURIComponent(destino)}`];
  if (intermediarias.length > 0) partes.push(`waypoints=${encodeURIComponent(intermediarias.join("|"))}`);
  partes.push("travelmode=driving");

  return {
    url: `https://www.google.com/maps/dir/?${partes.join("&")}`,
    incluidas: noLink.length,
    deFora: paradas.length - noLink.length,
  };
}

/* ---------------------------------- Despesas ---------------------------------- */

export const EXPENSE_TYPES = ["TOLL", "FUEL", "FOOD", "LODGING", "PARKING", "MAINTENANCE", "OTHER"] as const;
export type TipoDeDespesa = (typeof EXPENSE_TYPES)[number];

/** O rótulo do tipo. É também a categoria do lançamento que a aprovação cria no Financeiro. */
export const EXPENSE_TYPE_LABEL: Record<TipoDeDespesa, string> = {
  TOLL: "Pedágio",
  FUEL: "Combustível",
  FOOD: "Alimentação",
  LODGING: "Hospedagem",
  PARKING: "Estacionamento",
  MAINTENANCE: "Manutenção",
  OTHER: "Outro",
};

export const rotuloDaDespesa = (tipo: string) => (EXPENSE_TYPE_LABEL as Record<string, string>)[tipo] ?? tipo;

export const EXPENSE_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;

export const EXPENSE_STATUS: Record<string, { label: string; className: string }> = {
  PENDING: { label: "Pendente", className: "bg-amber-50 text-amber-700 border-amber-200" },
  APPROVED: { label: "Aprovada", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  REJECTED: { label: "Recusada", className: "bg-red-50 text-red-700 border-red-200" },
};

/** Descrição do lançamento que a despesa aprovada cria no Financeiro. */
export function descricaoDoLancamento(tipo: string, manifestId: string): string {
  return `${rotuloDaDespesa(tipo)}: viagem #${codigoDaViagem(manifestId)}`;
}

/** Centro de custo do lançamento: a viagem. É o que agrupa as despesas dela no relatório. */
export const centroDeCustoDaViagem = (manifestId: string) => `Viagem #${codigoDaViagem(manifestId)}`;

/** Combustível com litros e hodômetro vira também abastecimento da frota; sem um dos dois, fica só como despesa. */
export function geraAbastecimento(despesa: { type: string; liters?: number | null; odometer?: number | null }): boolean {
  return despesa.type === "FUEL" && typeof despesa.liters === "number" && despesa.liters > 0 && typeof despesa.odometer === "number";
}

/** A soma das despesas que não foram recusadas: é o total que o motorista vê das dele. */
export function totalLancado(despesas: readonly { amount: number; status: string }[]): number {
  return centavos(despesas.reduce((soma, despesa) => (despesa.status === "REJECTED" ? soma : soma + despesa.amount), 0));
}

/* ------------------------------------ Acerto ---------------------------------- */

/** Km rodados: hodômetro de retorno menos o de saída. Sem os dois, ou com o retorno menor, `null`. */
export function kmRodados(saida: number | null | undefined, retorno: number | null | undefined): number | null {
  if (typeof saida !== "number" || typeof retorno !== "number" || retorno < saida) return null;
  return retorno - saida;
}

export type ViagemNoTempo = {
  status: string;
  createdAt: Date | string;
  updatedAt: Date | string;
  departedAt?: Date | string | null;
  finishedAt?: Date | string | null;
};

/** Quando a viagem foi finalizada: a data própria, ou a da última alteração nas viagens anteriores a ela. `null` se não foi. */
export function finalizadaEm(viagem: ViagemNoTempo): Date | null {
  if (viagem.status !== "FINISHED") return null;
  return new Date(viagem.finishedAt ?? viagem.updatedAt);
}

/**
 * Os dias (no relógio do Brasil, `AAAA-MM-DD`) em que a viagem esteve na rua,
 * do dia da saída ao da finalização, os dois contando. Viagem ainda em rota
 * vai até hoje; sem a data da saída vale a da criação.
 */
export function janelaDaViagem(viagem: ViagemNoTempo, hoje: Date = new Date()): { inicio: string; fim: string } {
  const inicio = diaNoBrasil(viagem.departedAt ?? viagem.createdAt);
  const fim = diaNoBrasil(finalizadaEm(viagem) ?? hoje);
  return { inicio, fim: fim < inicio ? inicio : fim };
}

/** O abastecimento (dia do calendário) caiu dentro da janela da viagem? */
export function abastecidoNaViagem(abastecimento: { date: Date | string }, janela: { inicio: string; fim: string }): boolean {
  const dia = diaDoVencimento(abastecimento.date);
  return janela.inicio <= dia && dia <= janela.fim;
}

/**
 * O filtro do Prisma para "viagem finalizada no período": pela data própria
 * (`finishedAt`) e, nas viagens anteriores a ela, pela da última alteração,
 * como sempre foi.
 */
export function finalizadaNoPeriodo(noPeriodo: { gte: Date; lt: Date }) {
  return {
    status: "FINISHED",
    OR: [{ finishedAt: noPeriodo }, { finishedAt: null, updatedAt: noPeriodo }],
  };
}

export type DadosDoAcerto = {
  cargas: readonly { freightValue: number | null }[];
  despesas: readonly { type: string; amount: number; status: string }[];
  /** Abastecimentos da frota na janela da viagem que NÃO nasceram de uma despesa dela. */
  abastecimentos: readonly { totalCost: number }[];
  adiantamentos: readonly { amount: number }[];
  departureOdometer?: number | null;
  returnOdometer?: number | null;
};

export type AcertoDaViagem = {
  cargas: number;
  /** Cargas ainda sem valor de frete: o frete do quadro está incompleto enquanto houver. */
  cargasACotar: number;
  frete: number;
  /** Despesas aprovadas. */
  despesas: number;
  despesasPorTipo: { type: string; total: number }[];
  /** Despesas esperando aprovação: fora do custo, à vista no quadro. */
  pendentes: { quantidade: number; total: number };
  combustivel: number;
  custoTotal: number;
  resultado: number;
  /** % do frete que sobrou; `null` sem frete. */
  margem: number | null;
  km: number | null;
  custoPorKm: number | null;
  adiantado: number;
};

/** O quadro do acerto. As regras de cada linha estão no topo do arquivo. */
export function acertoDaViagem(dados: DadosDoAcerto): AcertoDaViagem {
  const { cargas, despesas, abastecimentos, adiantamentos } = dados;

  let frete = 0;
  let cargasACotar = 0;
  for (const carga of cargas) {
    if (carga.freightValue === null) cargasACotar += 1;
    else frete += carga.freightValue;
  }

  let aprovadas = 0;
  const pendentes = { quantidade: 0, total: 0 };
  const porTipo = new Map<string, number>();
  for (const despesa of despesas) {
    if (despesa.status === "PENDING") {
      pendentes.quantidade += 1;
      pendentes.total += despesa.amount;
    }
    if (despesa.status !== "APPROVED") continue;
    aprovadas += despesa.amount;
    porTipo.set(despesa.type, (porTipo.get(despesa.type) ?? 0) + despesa.amount);
  }

  const combustivel = abastecimentos.reduce((soma, abastecimento) => soma + abastecimento.totalCost, 0);
  const custoTotal = aprovadas + combustivel;
  const resultado = frete - custoTotal;
  const km = kmRodados(dados.departureOdometer, dados.returnOdometer);

  return {
    cargas: cargas.length,
    cargasACotar,
    frete: centavos(frete),
    despesas: centavos(aprovadas),
    despesasPorTipo: [...porTipo.entries()]
      .map(([type, total]) => ({ type, total: centavos(total) }))
      .sort((a, b) => b.total - a.total || rotuloDaDespesa(a.type).localeCompare(rotuloDaDespesa(b.type), "pt-BR")),
    pendentes: { quantidade: pendentes.quantidade, total: centavos(pendentes.total) },
    combustivel: centavos(combustivel),
    custoTotal: centavos(custoTotal),
    resultado: centavos(resultado),
    margem: frete === 0 ? null : umaCasa((resultado / frete) * 100),
    km,
    custoPorKm: km ? centavos(custoTotal / km) : null,
    adiantado: centavos(adiantamentos.reduce((soma, adiantamento) => soma + adiantamento.amount, 0)),
  };
}

/* ---------------------------------- Validação --------------------------------- */

const INVALID_BODY = "Dados inválidos.";
const KM_MAXIMO = 9_999_999;

// O formulário manda número como texto ("45,5", "" quando em branco).
const fromFormNumber = (value: unknown) => {
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (text === "") return undefined;
  return /^(\d+([.,]\d*)?|[.,]\d+)$/.test(text) ? Number(text.replace(",", ".")) : NaN;
};

// Número opcional do formulário: em branco apaga (`null`); ausente não mexe.
const emBrancoComoNulo = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : fromFormNumber(value));

const optionalText = (max: number, tooLong: string) =>
  z
    .string(INVALID_BODY)
    .trim()
    .max(max, tooLong)
    .transform((value) => (value === "" ? null : value))
    .nullish();

const idOpcional = (message: string) =>
  z
    .string(message)
    .trim()
    .max(64, message)
    .transform((value) => (value === "" ? null : value))
    .nullish();

const diaDoCalendario = (message: string) =>
  z
    .string(message)
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}/, message)
    .transform((value) => new Date(`${value.slice(0, 10)}T00:00:00.000Z`))
    .pipe(z.date(message));

/**
 * Instante opcional. O campo de data e hora do navegador manda
 * "AAAA-MM-DDTHH:MM", sem fuso: vale o relógio do Brasil. Com fuso (ISO), vale
 * o que veio. Em branco apaga (`null`); ausente não mexe.
 */
const instanteOpcional = (message: string) =>
  z.preprocess(
    (value) => {
      if (typeof value !== "string") return value;
      const text = value.trim();
      if (text === "") return null;
      const semFuso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(text);
      const data = new Date(semFuso ? `${text}${text.length === 16 ? ":00" : ""}-03:00` : text);
      return Number.isNaN(data.getTime()) ? text : data;
    },
    z.date(message).nullish(),
  );

/** O instante no formato do campo de data e hora (`AAAA-MM-DDTHH:MM`), no relógio do Brasil. Vazio sem data. */
export function paraCampoDeDataHora(instante: Date | string | null | undefined): string {
  if (!instante) return "";
  const data = new Date(instante);
  if (Number.isNaN(data.getTime())) return "";
  const hora = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(data);
  return `${diaNoBrasil(data)}T${hora}`;
}

const ODOMETER_MESSAGE = "O hodômetro precisa ser um número inteiro de km, maior ou igual a zero.";
const kmOpcional = z.preprocess(emBrancoComoNulo, z.number(ODOMETER_MESSAGE).int(ODOMETER_MESSAGE).min(0, ODOMETER_MESSAGE).max(KM_MAXIMO, ODOMETER_MESSAGE).nullish());

/** Os dados opcionais da viagem. Também entram na montagem (`createManifestSchema`). */
export const tripDataFields = {
  helperId: idOpcional("Ajudante inválido."),
  departureOdometer: kmOpcional,
  returnOdometer: kmOpcional,
  plannedDepartureAt: instanteOpcional("Previsão de saída inválida."),
  plannedReturnAt: instanteOpcional("Previsão de retorno inválida."),
  notes: optionalText(1000, "Observação muito longa."),
};

export const CAMPOS_DA_VIAGEM = ["helperId", "departureOdometer", "returnOdometer", "plannedDepartureAt", "plannedReturnAt", "notes"] as const;

export const updateTripDataSchema = z
  .object(tripDataFields, INVALID_BODY)
  .refine((data) => Object.values(data).some((value) => value !== undefined), { message: "Informe ao menos um campo para alterar." });

export const RETURN_BEFORE_DEPARTURE_KM = "O hodômetro de retorno não pode ser menor que o de saída.";
export const RETURN_BEFORE_DEPARTURE = "A previsão de retorno não pode ser antes da previsão de saída.";

/** A recusa dos dados da viagem já somados ao que estava gravado, ou `null` se estão coerentes. */
export function incoerenciaDaViagem(viagem: {
  departureOdometer: number | null;
  returnOdometer: number | null;
  plannedDepartureAt: Date | null;
  plannedReturnAt: Date | null;
}): string | null {
  if (viagem.departureOdometer !== null && viagem.returnOdometer !== null && viagem.returnOdometer < viagem.departureOdometer) {
    return RETURN_BEFORE_DEPARTURE_KM;
  }
  if (viagem.plannedDepartureAt && viagem.plannedReturnAt && viagem.plannedReturnAt < viagem.plannedDepartureAt) {
    return RETURN_BEFORE_DEPARTURE;
  }
  return null;
}

const ORDER_MESSAGE = "Informe as cargas da viagem na ordem das entregas.";

export const orderSchema = z.object(
  {
    collectionIds: z
      .array(z.string(ORDER_MESSAGE).trim().min(1, ORDER_MESSAGE).max(64, ORDER_MESSAGE), ORDER_MESSAGE)
      .min(1, ORDER_MESSAGE)
      .max(200, ORDER_MESSAGE)
      .refine((ids) => new Set(ids).size === ids.length, "A mesma carga foi informada mais de uma vez."),
  },
  INVALID_BODY,
);

export const INCOMPLETE_ORDER_MESSAGE = "A ordem precisa ter todas as cargas da viagem, cada uma uma vez. Atualize a página e ordene de novo.";

const AMOUNT_MESSAGE = "O valor precisa ser um número maior que zero.";
const LITERS_MESSAGE = "Os litros precisam ser um número maior que zero.";

export const createTripExpenseSchema = z
  .object(
    {
      type: z.enum(EXPENSE_TYPES, "Tipo de despesa inválido."),
      amount: z.preprocess(fromFormNumber, z.number(AMOUNT_MESSAGE).gt(0, AMOUNT_MESSAGE).max(1_000_000_000, AMOUNT_MESSAGE)),
      date: diaDoCalendario("Informe a data da despesa."),
      notes: optionalText(500, "Observação muito longa."),
      liters: z.preprocess(emBrancoComoNulo, z.number(LITERS_MESSAGE).gt(0, LITERS_MESSAGE).max(100_000, LITERS_MESSAGE).nullish()),
      odometer: kmOpcional,
    },
    INVALID_BODY,
  )
  // Litros e hodômetro só existem no combustível: nos outros tipos são descartados.
  .transform((data) => (data.type === "FUEL" ? data : { ...data, liters: null, odometer: null }));

/**
 * O que o administrador faz com uma despesa pendente: `aprovar` (vira lançamento
 * no Financeiro, em aberto ou já pago) ou `recusar`.
 */
export const tripExpenseActionSchema = z.discriminatedUnion(
  "action",
  [
    z.object({
      action: z.literal("aprovar"),
      paid: z.boolean("Informe se a despesa já foi paga.").optional(),
      paymentMethod: z.enum(PAYMENT_METHODS, "Forma de pagamento inválida.").nullish(),
    }),
    z.object({ action: z.literal("recusar") }),
  ],
  "Ação inválida.",
);

/* ------------------------------ O que as rotas leem ---------------------------- */

export const TRIP_EXPENSE_SELECT = {
  id: true,
  manifestId: true,
  type: true,
  amount: true,
  date: true,
  notes: true,
  status: true,
  liters: true,
  odometer: true,
  fuelingId: true,
  transactionId: true,
  reviewedAt: true,
  createdAt: true,
  createdById: true,
  // De quem lançou, só o nome e o perfil.
  createdBy: { select: { id: true, name: true, role: true } },
} as const;

/** O que o motorista recebe das despesas dele: sem lançamento do Financeiro nem quem conferiu. */
export const DRIVER_EXPENSE_SELECT = {
  id: true,
  type: true,
  amount: true,
  date: true,
  notes: true,
  status: true,
  liters: true,
  odometer: true,
  createdAt: true,
} as const;

/** O que entra em `antes`/`depois` da auditoria de uma despesa de viagem. */
export const CAMPOS_DA_DESPESA = ["manifestId", "type", "amount", "date", "notes", "status", "liters", "odometer", "fuelingId", "transactionId"] as const;

export const TRIP_NOT_FOUND = "Viagem não encontrada.";
export const EXPENSE_NOT_FOUND = "Despesa não encontrada.";
export const HELPER_NOT_FOUND_OR_INACTIVE = "Ajudante não encontrado ou desativado.";
export const TRIP_CANCELLED = "Viagem cancelada não recebe alteração.";
export const EXPENSE_NOT_PENDING = "Só despesa pendente pode ser excluída. A aprovada já está no Financeiro.";
export const EXPENSE_ALREADY_REVIEWED = "Esta despesa já foi aprovada ou recusada.";
export const ORDER_LOCKED = "Só dá para ordenar as entregas de viagem em montagem ou em rota.";
export const NOT_FINISHED_MESSAGE = "O acerto só existe para viagem finalizada.";
