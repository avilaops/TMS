import { z } from "zod";
import { diaDoVencimento } from "@/lib/financeiro";
import { desempenhoPorMotorista, type EntregaDoPeriodo } from "@/lib/relatorios";

/**
 * Equipe (recursos humanos operacional): ajudantes, ausências, adiantamentos
 * com acerto, e produtividade e comissão dos motoristas. Regras e contas comuns
 * às rotas e à tela; este arquivo não toca no banco.
 *
 * Ausência e adiantamento são de um motorista OU de um ajudante: uma das duas
 * colunas (`driverId`, `helperId`) vem preenchida, nunca as duas.
 *
 * Datas: o primeiro e o último dia da ausência e o dia do adiantamento são dias
 * do calendário, gravados à meia-noite UTC e lidos em UTC, como o vencimento do
 * financeiro. "Hoje" é o dia no relógio do Brasil (`diaNoBrasil`).
 *
 * Dinheiro (adiantamento, frete, comissão) é só do administrador: as rotas
 * decidem o que cada perfil recebe; as contas daqui não sabem de perfil.
 */

const centavos = (valor: number) => Math.round((valor + Number.EPSILON) * 100) / 100;

/* ---------------------------------- Pessoas ---------------------------------- */

export type Pessoa = { driverId: string | null; helperId: string | null };

/** Identifica a pessoa numa lista que mistura motoristas e ajudantes: `motorista:<id>` ou `ajudante:<id>`. */
export function chaveDaPessoa(pessoa: Pessoa): string {
  return pessoa.driverId ? `motorista:${pessoa.driverId}` : `ajudante:${pessoa.helperId ?? ""}`;
}

/** O caminho de volta: a chave escolhida no formulário vira as duas colunas. Chave inválida devolve as duas nulas. */
export function pessoaDaChave(chave: string): Pessoa {
  const [tipo, id] = chave.split(":");
  if (!id) return { driverId: null, helperId: null };
  if (tipo === "motorista") return { driverId: id, helperId: null };
  if (tipo === "ajudante") return { driverId: null, helperId: id };
  return { driverId: null, helperId: null };
}

type ComNome = { driver: { user: { name: string } } | null; helper: { name: string } | null };

/** O nome de quem a ausência ou o adiantamento é. */
export const nomeDaPessoa = (registro: ComNome) => registro.driver?.user.name ?? registro.helper?.name ?? "Pessoa removida";

/* --------------------------------- Ausências --------------------------------- */

export const ABSENCE_TYPES = ["VACATION", "DAY_OFF", "SICK_NOTE", "MISSED", "OTHER"] as const;
export type AbsenceType = (typeof ABSENCE_TYPES)[number];

export const ABSENCE_TYPE_LABEL: Record<AbsenceType, string> = {
  VACATION: "Férias",
  DAY_OFF: "Folga",
  SICK_NOTE: "Atestado",
  MISSED: "Falta",
  OTHER: "Outro",
};

export const rotuloDaAusencia = (tipo: string) => (ABSENCE_TYPE_LABEL as Record<string, string>)[tipo] ?? tipo;

export type PeriodoDeAusencia = { startDate: Date | string; endDate: Date | string };

/** `true` quando a ausência cobre o dia (`AAAA-MM-DD`). O primeiro e o último dia contam. */
export function cobreODia(ausencia: PeriodoDeAusencia, dia: string): boolean {
  return diaDoVencimento(ausencia.startDate) <= dia && dia <= diaDoVencimento(ausencia.endDate);
}

/**
 * A ausência que tira a pessoa do dia, ou `null` se ela está disponível.
 * `ausencias` são as da própria pessoa; com mais de uma no dia, vale a que
 * começou primeiro.
 */
export function ausenciaNoDia<T extends PeriodoDeAusencia>(ausencias: readonly T[], dia: string): T | null {
  const noDia = ausencias.filter((ausencia) => cobreODia(ausencia, dia));
  if (noDia.length === 0) return null;
  return noDia.reduce((primeira, outra) => (diaDoVencimento(outra.startDate) < diaDoVencimento(primeira.startDate) ? outra : primeira));
}

/** Está ausente no dia X? */
export function estaAusente(ausencias: readonly PeriodoDeAusencia[], dia: string): boolean {
  return ausenciaNoDia(ausencias, dia) !== null;
}

/** Quem está ausente no dia, pela chave da pessoa (`chaveDaPessoa`), com a ausência que vale. */
export function ausentesNoDia<T extends PeriodoDeAusencia & Pessoa>(ausencias: readonly T[], dia: string): Map<string, T> {
  const porPessoa = new Map<string, T[]>();
  for (const ausencia of ausencias) {
    const chave = chaveDaPessoa(ausencia);
    porPessoa.set(chave, [...(porPessoa.get(chave) ?? []), ausencia]);
  }
  const ausentes = new Map<string, T>();
  for (const [chave, lista] of porPessoa) {
    const vale = ausenciaNoDia(lista, dia);
    if (vale) ausentes.set(chave, vale);
  }
  return ausentes;
}

/** Quantos dias a ausência dura, contando o primeiro e o último. */
export function diasDaAusencia(ausencia: PeriodoDeAusencia): number {
  const dia = (valor: Date | string) => Date.parse(`${diaDoVencimento(valor)}T00:00:00.000Z`);
  return Math.round((dia(ausencia.endDate) - dia(ausencia.startDate)) / 86_400_000) + 1;
}

/* ------------------------------- Adiantamentos ------------------------------- */

export const ADVANCE_REASONS = ["TRIP", "VOUCHER", "OTHER"] as const;
export type AdvanceReason = (typeof ADVANCE_REASONS)[number];

export const ADVANCE_REASON_LABEL: Record<AdvanceReason, string> = {
  TRIP: "Adiantamento de viagem",
  VOUCHER: "Vale",
  OTHER: "Outro",
};

export const rotuloDoMotivo = (motivo: string) => (ADVANCE_REASON_LABEL as Record<string, string>)[motivo] ?? motivo;

export const ADVANCE_STATUS_LABEL: Record<string, string> = { OPEN: "Em aberto", SETTLED: "Acertado" };

/** Categoria da despesa que o adiantamento lança no Financeiro. */
export const CATEGORIA_DO_ADIANTAMENTO = "Adiantamento";

export type Acerto = {
  /** Sempre positivo: quanto muda de mão no acerto. */
  diferenca: number;
  /**
   * `devolver`: gastou menos do que recebeu, a pessoa devolve a sobra.
   * `receber`: gastou mais, a empresa completa. `quitado`: gastou exatamente o que recebeu.
   */
  sentido: "devolver" | "receber" | "quitado";
};

/** A diferença do acerto: o adiantado menos o gasto comprovado. */
export function acertoDoAdiantamento(adiantado: number, gasto: number): Acerto {
  const sobra = centavos(adiantado - gasto);
  if (sobra > 0) return { diferenca: sobra, sentido: "devolver" };
  if (sobra < 0) return { diferenca: -sobra, sentido: "receber" };
  return { diferenca: 0, sentido: "quitado" };
}

/** O adiantamento como as rotas o devolvem: com a diferença do acerto, quando já foi acertado. */
export const comAcerto = <T extends { amount: number; spentAmount: number | null }>(adiantamento: T) => ({
  ...adiantamento,
  acerto: adiantamento.spentAmount === null ? null : acertoDoAdiantamento(adiantamento.amount, adiantamento.spentAmount),
});

/** O acerto por extenso, para a lista: "Devolve R$ 20,00", "Recebe R$ 15,50", "Quitado". */
export function acertoPorExtenso(acerto: Acerto, formatar: (valor: number) => string): string {
  if (acerto.sentido === "quitado") return "Quitado";
  return `${acerto.sentido === "devolver" ? "Devolve" : "Recebe"} ${formatar(acerto.diferenca)}`;
}

/** Descrição da despesa lançada no Financeiro. */
export function descricaoDaDespesa(motivo: string, nome: string): string {
  return `${rotuloDoMotivo(motivo)}: ${nome}`;
}

/* -------------------------- Produtividade e comissão ------------------------- */

/** Comissão = percentual do frete entregue. Sem percentual não há comissão (`null`), que é diferente de comissão zero. */
export function comissaoDoFrete(frete: number, percentual: number | null | undefined): number | null {
  if (percentual === null || percentual === undefined) return null;
  return centavos((frete * percentual) / 100);
}

export type MotoristaDaEquipe = { id: string; nome: string; commissionPct: number | null };

/** Entrega feita no período, com o que a produtividade soma além do prazo. */
export type EntregaDaEquipe = EntregaDoPeriodo & { weight: number; freightValue: number | null };

export type ProdutividadeDoMotorista = {
  /** Vazio para as entregas sem motorista na carga. */
  driverId: string;
  nome: string;
  viagens: number;
  entregas: number;
  noPrazo: number;
  foraDoPrazo: number;
  semMedicao: number;
  taxaNoPrazo: number | null;
  peso: number;
  /** Os três abaixo são dinheiro: só o administrador recebe (`semValores` tira). */
  frete: number;
  comissaoPct: number | null;
  comissao: number | null;
};

/**
 * Produtividade por motorista num período. `viagens` são os manifestos
 * finalizados no período; `entregas`, as cargas entregues nele. O prazo é o
 * mesmo dos relatórios (`desempenhoPorMotorista`): não há segunda conta.
 * Entra todo motorista de `motoristas`, mesmo sem movimento; entrega sem
 * motorista na carga aparece numa linha à parte, sem comissão.
 */
export function produtividadeDaEquipe(dados: {
  motoristas: readonly MotoristaDaEquipe[];
  viagens: readonly { driverId: string }[];
  entregas: readonly EntregaDaEquipe[];
}): ProdutividadeDoMotorista[] {
  const { motoristas, viagens, entregas } = dados;
  const prazos = new Map(desempenhoPorMotorista(entregas).map((linha) => [linha.chave, linha]));

  const viagensPor = new Map<string, number>();
  for (const viagem of viagens) viagensPor.set(viagem.driverId, (viagensPor.get(viagem.driverId) ?? 0) + 1);

  const somas = new Map<string, { peso: number; frete: number }>();
  for (const entrega of entregas) {
    const chave = entrega.motorista?.id ?? "";
    const soma = somas.get(chave) ?? { peso: 0, frete: 0 };
    soma.peso += entrega.weight;
    soma.frete += entrega.freightValue ?? 0;
    somas.set(chave, soma);
  }

  const linha = (driverId: string, nome: string, commissionPct: number | null): ProdutividadeDoMotorista => {
    const prazo = prazos.get(driverId);
    const frete = centavos(somas.get(driverId)?.frete ?? 0);
    return {
      driverId,
      nome,
      viagens: viagensPor.get(driverId) ?? 0,
      entregas: prazo?.entregas ?? 0,
      noPrazo: prazo?.noPrazo ?? 0,
      foraDoPrazo: prazo?.foraDoPrazo ?? 0,
      semMedicao: prazo?.semMedicao ?? 0,
      taxaNoPrazo: prazo?.taxaNoPrazo ?? null,
      peso: centavos(somas.get(driverId)?.peso ?? 0),
      frete,
      comissaoPct: commissionPct,
      comissao: comissaoDoFrete(frete, commissionPct),
    };
  };

  const conhecidos = new Set(motoristas.map((motorista) => motorista.id));
  const linhas = motoristas.map((motorista) => linha(motorista.id, motorista.nome, motorista.commissionPct));
  // Entrega de quem não está na lista (carga sem motorista, ou motorista que a rota não mandou): não some da conta.
  for (const [chave, prazo] of prazos) {
    if (!conhecidos.has(chave)) linhas.push(linha(chave, prazo.nome, null));
  }

  return linhas.sort((a, b) => b.entregas - a.entregas || b.viagens - a.viagens || a.nome.localeCompare(b.nome, "pt-BR"));
}

/** A linha sem frete nem comissão: é o que a operação recebe. */
export function semValores(linha: ProdutividadeDoMotorista) {
  const { driverId, nome, viagens, entregas, noPrazo, foraDoPrazo, semMedicao, taxaNoPrazo, peso } = linha;
  return { driverId, nome, viagens, entregas, noPrazo, foraDoPrazo, semMedicao, taxaNoPrazo, peso };
}

/* --------------------------------- Validação --------------------------------- */

const INVALID_BODY = "Dados inválidos.";
const NOTHING_TO_CHANGE = "Informe ao menos um campo para alterar.";
const CPF_MESSAGE = "Informe um CPF com 11 dígitos.";
const PESSOA_MESSAGE = "Escolha um motorista ou um ajudante.";
const PERIODO_INVERTIDO = "O último dia não pode ser antes do primeiro.";

// Texto opcional: vazio vira `null` (apaga o campo); ausente não mexe.
const optionalText = (max: number, tooLong: string) =>
  z
    .string(INVALID_BODY)
    .trim()
    .max(max, tooLong)
    .transform((value) => (value === "" ? null : value))
    .nullish();

// O formulário manda número como texto ("1234,56" ou "1234.56").
const fromFormNumber = (value: unknown) => {
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (text === "") return undefined;
  return /^(\d+([.,]\d*)?|[.,]\d+)$/.test(text) ? Number(text.replace(",", ".")) : NaN;
};

// Dia do calendário: aceita "AAAA-MM-DD" (campo de data) ou ISO, e grava a meia-noite UTC do dia.
const diaDoCalendario = (message: string) =>
  z
    .string(message)
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}/, message)
    .transform((value) => new Date(`${value.slice(0, 10)}T00:00:00.000Z`))
    .pipe(z.date(message));

const idOpcional = z
  .string(INVALID_BODY)
  .trim()
  .max(64, INVALID_BODY)
  .transform((value) => (value === "" ? null : value))
  .nullish();

const umaPessoa = (dados: { driverId?: string | null; helperId?: string | null }) => Boolean(dados.driverId) !== Boolean(dados.helperId);

const helperName = z.string("Informe o nome.").trim().min(2, "Informe o nome.").max(120, "Nome muito longo.");
const helperPhone = optionalText(30, "Telefone muito longo.");

export const createHelperSchema = z.object(
  {
    name: helperName,
    cpf: z
      .string(CPF_MESSAGE)
      .transform((value) => value.replace(/\D/g, ""))
      .pipe(z.string().length(11, CPF_MESSAGE)),
    phone: helperPhone,
  },
  INVALID_BODY,
);

// CPF é a chave do registro e não entra aqui, como no motorista.
export const updateHelperSchema = z
  .object(
    {
      name: helperName.optional(),
      phone: helperPhone,
      active: z.boolean("Informe se o cadastro está ativo.").optional(),
    },
    INVALID_BODY,
  )
  .refine((data) => Object.values(data).some((value) => value !== undefined), { message: NOTHING_TO_CHANGE });

const absenceFields = {
  type: z.enum(ABSENCE_TYPES, "Tipo de ausência inválido."),
  startDate: diaDoCalendario("Informe o primeiro dia."),
  endDate: diaDoCalendario("Informe o último dia."),
  notes: optionalText(500, "Observação muito longa."),
};

const periodoCoerente = (dados: { startDate: Date; endDate: Date }) => dados.startDate <= dados.endDate;

export const createAbsenceSchema = z
  .object({ driverId: idOpcional, helperId: idOpcional, ...absenceFields }, INVALID_BODY)
  .refine(umaPessoa, { message: PESSOA_MESSAGE, path: ["driverId"] })
  .refine(periodoCoerente, { message: PERIODO_INVERTIDO, path: ["endDate"] });

/** Alteração da ausência: tipo, período e observação. De quem ela é não muda. */
export const updateAbsenceSchema = z
  .object(absenceFields, INVALID_BODY)
  .refine(periodoCoerente, { message: PERIODO_INVERTIDO, path: ["endDate"] });

const ADVANCE_AMOUNT_MESSAGE = "O valor precisa ser um número maior que zero.";
const SPENT_MESSAGE = "O valor gasto precisa ser um número maior ou igual a zero.";

export const createAdvanceSchema = z
  .object(
    {
      driverId: idOpcional,
      helperId: idOpcional,
      date: diaDoCalendario("Informe a data do adiantamento."),
      amount: z.preprocess(fromFormNumber, z.number(ADVANCE_AMOUNT_MESSAGE).gt(0, ADVANCE_AMOUNT_MESSAGE).max(1_000_000_000, ADVANCE_AMOUNT_MESSAGE)),
      reason: z.enum(ADVANCE_REASONS, "Motivo inválido."),
      manifestId: idOpcional,
      notes: optionalText(500, "Observação muito longa."),
    },
    INVALID_BODY,
  )
  .refine(umaPessoa, { message: PESSOA_MESSAGE, path: ["driverId"] });

/**
 * O que se faz com um adiantamento já registrado: `acertar` (com o valor gasto
 * comprovado) ou `reabrir` (desfaz um acerto digitado errado).
 */
export const advanceActionSchema = z.discriminatedUnion(
  "action",
  [
    z.object({
      action: z.literal("acertar"),
      spentAmount: z.preprocess(fromFormNumber, z.number(SPENT_MESSAGE).min(0, SPENT_MESSAGE).max(1_000_000_000, SPENT_MESSAGE)),
      notes: optionalText(500, "Observação muito longa."),
    }),
    z.object({ action: z.literal("reabrir") }),
  ],
  "Ação inválida.",
);

/* ------------------------------ O que as rotas leem ---------------------------- */

export const HELPER_SELECT = { id: true, name: true, cpf: true, phone: true, active: true, createdAt: true } as const;

const DE_QUEM = {
  driverId: true,
  helperId: true,
  driver: { select: { id: true, user: { select: { name: true } } } },
  helper: { select: { id: true, name: true } },
} as const;

export const ABSENCE_SELECT = {
  id: true,
  type: true,
  startDate: true,
  endDate: true,
  notes: true,
  createdAt: true,
  ...DE_QUEM,
} as const;

export const ADVANCE_SELECT = {
  id: true,
  date: true,
  amount: true,
  reason: true,
  status: true,
  spentAmount: true,
  settledAt: true,
  notes: true,
  createdAt: true,
  manifestId: true,
  manifest: { select: { id: true, status: true, createdAt: true } },
  ...DE_QUEM,
} as const;

/** O que entra em `antes`/`depois` da auditoria de cada registro da equipe. */
export const CAMPOS_DO_AJUDANTE = ["name", "cpf", "phone", "active"] as const;
export const CAMPOS_DA_AUSENCIA = ["driverId", "helperId", "type", "startDate", "endDate", "notes"] as const;
export const CAMPOS_DO_ADIANTAMENTO = ["driverId", "helperId", "date", "amount", "reason", "manifestId", "status", "spentAmount", "settledAt", "notes"] as const;

export const HELPER_NOT_FOUND = "Ajudante não encontrado.";
export const ABSENCE_NOT_FOUND = "Ausência não encontrada.";
export const ADVANCE_NOT_FOUND = "Adiantamento não encontrado.";
export const PERSON_NOT_FOUND = "Motorista ou ajudante não encontrado.";
