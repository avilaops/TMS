import { z } from "zod";
import { diaDoVencimento, diaNoBrasil } from "@/lib/financeiro";
import { limitesDoPeriodo } from "@/lib/relatorios";

/**
 * Frota: abastecimentos, documentos com vencimento, pneus, checklists e custos
 * por veículo. Regras e contas comuns às rotas e às telas.
 *
 * As contas (`consumoDosAbastecimentos`, `custosDoVeiculo`,
 * `situacaoDoVencimento`, `alertasDeVencimento`) são puras: recebem as linhas
 * já lidas do banco e a data de referência.
 *
 * Datas: o dia do abastecimento, da manutenção, da instalação do pneu e o
 * vencimento do documento são dias do calendário, gravados à meia-noite UTC e
 * lidos em UTC, como o vencimento do financeiro. "Hoje" é o dia no relógio do
 * Brasil. O checklist guarda o instante em que foi feito.
 */

const centavos = (valor: number) => Math.round((valor + Number.EPSILON) * 100) / 100;
const DIA = 86_400_000;

/* ------------------------------- Abastecimento ------------------------------- */

export type Abastecimento = {
  date: Date | string;
  odometer: number;
  liters: number;
  totalCost: number;
};

/** O que se mede entre um abastecimento e o anterior. `null` = sem medição. */
export type Trecho = {
  /** Km rodados desde o abastecimento anterior. */
  km: number | null;
  kmPorLitro: number | null;
  /** Valor deste abastecimento dividido pelos km do trecho. */
  custoPorKm: number | null;
};

const instante = (valor: Date | string) => new Date(valor).getTime();

/**
 * Consumo e custo por km de cada abastecimento, na ordem em que aconteceram
 * (data e, no mesmo dia, hodômetro). A conta é a do tanque cheio: os litros
 * postos agora repõem o que foi gasto desde o abastecimento anterior.
 *
 * Fica sem medição, em vez de sair com número errado:
 * - o primeiro abastecimento (não há hodômetro anterior);
 * - hodômetro igual ou menor que o do anterior (erro de digitação ou lançamento
 *   fora de ordem): km negativo não vira consumo negativo;
 * - litros zerados ou inválidos: sem consumo, mas o custo por km continua valendo.
 */
export function consumoDosAbastecimentos<T extends Abastecimento>(abastecimentos: readonly T[]): (T & Trecho)[] {
  const emOrdem = [...abastecimentos].sort((a, b) => instante(a.date) - instante(b.date) || a.odometer - b.odometer);

  return emOrdem.map((atual, i) => {
    const anterior = i === 0 ? null : emOrdem[i - 1];
    const km = anterior ? atual.odometer - anterior.odometer : null;
    if (km === null || !(km > 0)) return { ...atual, km: null, kmPorLitro: null, custoPorKm: null };
    return {
      ...atual,
      km,
      kmPorLitro: atual.liters > 0 ? centavos(km / atual.liters) : null,
      custoPorKm: atual.totalCost >= 0 ? centavos(atual.totalCost / km) : null,
    };
  });
}

/* ----------------------------------- Custos ---------------------------------- */

export type ManutencaoDoPeriodo = { cost: number; status: string };

export type CustosDoVeiculo = {
  /** Só manutenção concluída: agendada e em andamento ainda não são custo. */
  manutencao: number;
  abastecimento: number;
  total: number;
  litros: number;
  /** Km rodados no período, pelos hodômetros dos abastecimentos. `null` sem dois hodômetros coerentes. */
  kmRodados: number | null;
  /** Total do período dividido pelos km rodados. */
  custoPorKm: number | null;
  /** Km por litro, só nos trechos em que há km e litros. */
  consumoMedio: number | null;
};

/** Soma de manutenção concluída e de abastecimento. */
export function totaisDeCusto(
  manutencoes: readonly ManutencaoDoPeriodo[],
  abastecimentos: readonly Pick<Abastecimento, "totalCost">[],
): { manutencao: number; abastecimento: number; total: number } {
  const manutencao = manutencoes.filter((m) => m.status === "COMPLETED").reduce((soma, m) => soma + m.cost, 0);
  const abastecimento = abastecimentos.reduce((soma, a) => soma + a.totalCost, 0);
  return { manutencao: centavos(manutencao), abastecimento: centavos(abastecimento), total: centavos(manutencao + abastecimento) };
}

/**
 * Custos de um veículo num período. `abastecimentos` são os do período;
 * `anterior` é o último abastecimento antes dele, que dá o hodômetro de onde o
 * período parte (sem ele, o primeiro abastecimento do período é a base e não
 * conta km).
 */
export function custosDoVeiculo(dados: {
  manutencoes: readonly ManutencaoDoPeriodo[];
  abastecimentos: readonly Abastecimento[];
  anterior?: Abastecimento | null;
}): CustosDoVeiculo {
  const { manutencoes, abastecimentos, anterior = null } = dados;
  const totais = totaisDeCusto(manutencoes, abastecimentos);

  const trechos = consumoDosAbastecimentos(anterior ? [anterior, ...abastecimentos] : abastecimentos).slice(anterior ? 1 : 0);
  let km = 0;
  let kmComLitros = 0;
  let litrosMedidos = 0;
  for (const trecho of trechos) {
    if (trecho.km === null) continue;
    km += trecho.km;
    if (trecho.kmPorLitro === null) continue;
    kmComLitros += trecho.km;
    litrosMedidos += trecho.liters;
  }

  return {
    ...totais,
    litros: centavos(abastecimentos.reduce((soma, a) => soma + (a.liters > 0 ? a.liters : 0), 0)),
    kmRodados: km > 0 ? km : null,
    custoPorKm: km > 0 ? centavos(totais.total / km) : null,
    consumoMedio: litrosMedidos > 0 ? centavos(kmComLitros / litrosMedidos) : null,
  };
}

/**
 * Limites de um período em meses para campos que são dia do calendário
 * (gravados à meia-noite UTC): do dia 1º de `de` ao dia 1º do mês seguinte a
 * `ate`, fim exclusivo. Mesma validação de `limitesDoPeriodo`.
 */
export function limitesDeCalendario(de: string, ate: string): { inicio: Date; fim: Date } | null {
  const limites = limitesDoPeriodo(de, ate);
  if (!limites) return null;
  const meiaNoiteUtc = (valor: Date) => new Date(`${diaNoBrasil(valor)}T00:00:00.000Z`);
  return { inicio: meiaNoiteUtc(limites.inicio), fim: meiaNoiteUtc(limites.fim) };
}

/* -------------------------------- Vencimentos -------------------------------- */

export const DOCUMENT_TYPES = ["LICENSING", "INSURANCE", "ANTT", "TACHOGRAPH", "OTHER"] as const;
export type TipoDeDocumento = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_TYPE_LABEL: Record<TipoDeDocumento, string> = {
  LICENSING: "Licenciamento (CRLV)",
  INSURANCE: "Seguro",
  ANTT: "ANTT",
  TACHOGRAPH: "Tacógrafo",
  OTHER: "Outro",
};

/** Com quantos dias de antecedência o vencimento vira aviso. */
export const DIAS_DE_AVISO = 30;

export type SituacaoDoVencimento = "em_dia" | "a_vencer" | "vencido";

export const SITUACAO_DO_VENCIMENTO_LABEL: Record<SituacaoDoVencimento, string> = {
  em_dia: "Em dia",
  a_vencer: "A vencer",
  vencido: "Vencido",
};

/** Dias de calendário de hoje (relógio do Brasil) até o vencimento. Zero = vence hoje; negativo = vencido. */
export function diasAteVencer(vencimento: Date | string, hoje: Date = new Date()): number {
  const dia = (texto: string) => Date.parse(`${texto}T00:00:00.000Z`);
  return Math.round((dia(diaDoVencimento(vencimento)) - dia(diaNoBrasil(hoje))) / DIA);
}

/** Vencido (passou do dia), a vencer (hoje ou nos próximos 30 dias) ou em dia. Vence no fim do dia, como no financeiro. */
export function situacaoDoVencimento(vencimento: Date | string, hoje: Date = new Date()): SituacaoDoVencimento {
  const dias = diasAteVencer(vencimento, hoje);
  if (dias < 0) return "vencido";
  return dias <= DIAS_DE_AVISO ? "a_vencer" : "em_dia";
}

/** O prazo como a tela mostra: "Venceu há 3 dias", "Vence hoje", "Vence em 1 dia". */
export function prazoPorExtenso(dias: number): string {
  if (dias === 0) return "Vence hoje";
  const quantos = `${Math.abs(dias)} ${Math.abs(dias) === 1 ? "dia" : "dias"}`;
  return dias < 0 ? `Venceu há ${quantos}` : `Vence em ${quantos}`;
}

export type DocumentoParaAlerta = {
  id: string;
  type: string;
  number: string | null;
  expiresAt: Date | string;
  vehicle: { id: string; plate: string };
};

export type MotoristaParaAlerta = { id: string; nome: string; cnh: string; cnhExpiry: Date | string };

export type AlertaDeVencimento = {
  chave: string;
  origem: "DOCUMENTO" | "CNH";
  /** O que vence: "Seguro", "CNH"… */
  rotulo: string;
  /** De quem: a placa do veículo ou o nome do motorista. */
  de: string;
  /** Veículo do documento, para o link; `null` na CNH. */
  vehicleId: string | null;
  numero: string | null;
  /** `AAAA-MM-DD`. */
  vencimento: string;
  dias: number;
  situacao: Exclude<SituacaoDoVencimento, "em_dia">;
};

/**
 * Documentos de veículo e CNHs vencidos ou a vencer em até 30 dias, numa lista
 * só, do vencimento mais antigo para o mais novo. O que está em dia não entra.
 * A CNH vem do cadastro do motorista: não há segunda cópia da validade.
 */
export function alertasDeVencimento(
  dados: { documentos: readonly DocumentoParaAlerta[]; motoristas: readonly MotoristaParaAlerta[] },
  hoje: Date = new Date(),
): AlertaDeVencimento[] {
  const alertas: AlertaDeVencimento[] = [];
  const acrescentar = (alerta: Omit<AlertaDeVencimento, "vencimento" | "dias" | "situacao">, vencimento: Date | string) => {
    const situacao = situacaoDoVencimento(vencimento, hoje);
    if (situacao === "em_dia") return;
    alertas.push({ ...alerta, vencimento: diaDoVencimento(vencimento), dias: diasAteVencer(vencimento, hoje), situacao });
  };

  for (const documento of dados.documentos) {
    acrescentar(
      {
        chave: `documento-${documento.id}`,
        origem: "DOCUMENTO",
        rotulo: DOCUMENT_TYPE_LABEL[documento.type as TipoDeDocumento] ?? documento.type,
        de: documento.vehicle.plate,
        vehicleId: documento.vehicle.id,
        numero: documento.number,
      },
      documento.expiresAt,
    );
  }
  for (const motorista of dados.motoristas) {
    acrescentar(
      { chave: `cnh-${motorista.id}`, origem: "CNH", rotulo: "CNH", de: motorista.nome, vehicleId: null, numero: motorista.cnh },
      motorista.cnhExpiry,
    );
  }

  return alertas.sort((a, b) => a.vencimento.localeCompare(b.vencimento) || a.de.localeCompare(b.de, "pt-BR"));
}

/* ------------------------------------ Pneus ---------------------------------- */

/** Km que o pneu rodou no veículo; `null` enquanto não foi retirado. */
export function kmRodadosDoPneu(pneu: { installedKm: number; removedKm: number | null }): number | null {
  return pneu.removedKm === null ? null : Math.max(0, pneu.removedKm - pneu.installedKm);
}

/* ---------------------------------- Checklist -------------------------------- */

/** Os itens do checklist, fixos e nesta ordem. No banco, um booleano por chave: true = OK. */
export const CHECKLIST_ITENS = [
  { chave: "pneus", rotulo: "Pneus" },
  { chave: "freios", rotulo: "Freios" },
  { chave: "luzes", rotulo: "Luzes" },
  { chave: "oleo", rotulo: "Óleo" },
  { chave: "agua", rotulo: "Água" },
  { chave: "documentos", rotulo: "Documentos" },
  { chave: "limpeza", rotulo: "Limpeza" },
  { chave: "extintor", rotulo: "Extintor" },
] as const;

export type ChaveDoChecklist = (typeof CHECKLIST_ITENS)[number]["chave"];
export type ItensDoChecklist = Record<ChaveDoChecklist, boolean>;

/** Checklist novo: tudo OK, e quem preenche marca o que tem problema. */
export const CHECKLIST_TUDO_OK = Object.fromEntries(CHECKLIST_ITENS.map((item) => [item.chave, true])) as ItensDoChecklist;

/** Rótulos dos itens marcados com problema, na ordem do checklist. */
export function problemasDoChecklist(itens: unknown): string[] {
  const marcados = (itens ?? {}) as Record<string, unknown>;
  return CHECKLIST_ITENS.filter((item) => marcados[item.chave] === false).map((item) => item.rotulo);
}

/* ---------------------------------- Manutenção ------------------------------- */

export const MAINTENANCE_STATUSES = ["SCHEDULED", "IN_PROGRESS", "COMPLETED"] as const;
export const MAINTENANCE_KINDS = ["PREVENTIVE", "CORRECTIVE"] as const;

export const MAINTENANCE_KIND_LABEL: Record<(typeof MAINTENANCE_KINDS)[number], string> = {
  PREVENTIVE: "Preventiva",
  CORRECTIVE: "Corretiva",
};

/* ---------------------------------- Validação -------------------------------- */

const INVALID_BODY = "Dados inválidos.";
const NOTHING_TO_CHANGE = "Informe ao menos um campo para alterar.";
const KM_MAXIMO = 9_999_999;

// O formulário manda número como texto ("45,5", "" quando em branco).
const fromFormNumber = (value: unknown) => {
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (text === "") return undefined;
  return /^(\d+([.,]\d*)?|[.,]\d+)$/.test(text) ? Number(text.replace(",", ".")) : NaN;
};

// Campo opcional do formulário: vazio vira `null` (apaga); ausente não mexe.
const vazioComoNulo = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);

const optionalText = (max: number, tooLong: string) =>
  z
    .string(INVALID_BODY)
    .trim()
    .max(max, tooLong)
    .transform((value) => (value === "" ? null : value))
    .nullish();

const texto = (message: string, max: number, tooLong: string) => z.string(message).trim().min(1, message).max(max, tooLong);

// Dia do calendário: o "AAAA-MM-DD" do campo de data (ou o começo de uma data ISO), gravado à meia-noite UTC.
const diaDoCalendario = (message: string) =>
  z
    .string(message)
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}/, message)
    .transform((value) => new Date(`${value.slice(0, 10)}T00:00:00.000Z`))
    .pipe(z.date(message));

const km = (message: string) => z.preprocess(fromFormNumber, z.number(message).int(message).min(0, message).max(KM_MAXIMO, message));
// Km opcional: em branco apaga (`null`); ausente não mexe.
const kmOpcional = (message: string) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : fromFormNumber(value)),
    z.number(message).int(message).min(0, message).max(KM_MAXIMO, message).nullish(),
  );

const LITERS_MESSAGE = "Os litros precisam ser um número maior que zero.";
const FUEL_COST_MESSAGE = "O valor total precisa ser um número maior ou igual a zero.";
const ODOMETER_MESSAGE = "O hodômetro precisa ser um número inteiro de km, maior ou igual a zero.";

export const createFuelingSchema = z.object(
  {
    date: diaDoCalendario("Informe a data do abastecimento."),
    liters: z.preprocess(fromFormNumber, z.number(LITERS_MESSAGE).gt(0, LITERS_MESSAGE).max(100_000, LITERS_MESSAGE)),
    totalCost: z.preprocess(fromFormNumber, z.number(FUEL_COST_MESSAGE).min(0, FUEL_COST_MESSAGE).max(1_000_000_000, FUEL_COST_MESSAGE)),
    odometer: km(ODOMETER_MESSAGE),
    station: optionalText(120, "Nome do posto muito longo."),
    driverId: optionalText(64, "Motorista inválido."),
  },
  INVALID_BODY,
);

const documentFields = {
  type: z.enum(DOCUMENT_TYPES, "Tipo de documento inválido."),
  number: optionalText(60, "Número muito longo."),
  expiresAt: diaDoCalendario("Informe o vencimento."),
  notes: optionalText(500, "Observação muito longa."),
};

export const createDocumentSchema = z.object(documentFields, INVALID_BODY);

/** Alteração do documento. Renovar é trocar o vencimento. */
export const updateDocumentSchema = z
  .object(
    {
      type: documentFields.type.optional(),
      number: documentFields.number,
      expiresAt: documentFields.expiresAt.optional(),
      notes: documentFields.notes,
    },
    INVALID_BODY,
  )
  .refine((data) => Object.values(data).some((value) => value !== undefined), { message: NOTHING_TO_CHANGE });

const TIRE_KM_MESSAGE = "O km precisa ser um número inteiro maior ou igual a zero.";
export const REMOVED_KM_MESSAGE = "O km de retirada não pode ser menor que o de instalação.";

const tireFields = {
  position: texto("Informe a posição do pneu.", 60, "Posição muito longa."),
  brandModel: texto("Informe a marca e o modelo do pneu.", 120, "Marca e modelo muito longos."),
  removedKm: kmOpcional(TIRE_KM_MESSAGE),
  notes: optionalText(500, "Observação muito longa."),
};

export const createTireSchema = z
  .object(
    {
      ...tireFields,
      installedAt: diaDoCalendario("Informe a data de instalação."),
      installedKm: km(TIRE_KM_MESSAGE),
    },
    INVALID_BODY,
  )
  .refine((data) => data.removedKm == null || data.removedKm >= data.installedKm, { message: REMOVED_KM_MESSAGE, path: ["removedKm"] });

/** Alteração do pneu: posição (rodízio), marca, observação e a retirada. A instalação não muda. */
export const updateTireSchema = z
  .object(
    {
      position: tireFields.position.optional(),
      brandModel: tireFields.brandModel.optional(),
      removedKm: tireFields.removedKm,
      notes: tireFields.notes,
    },
    INVALID_BODY,
  )
  .refine((data) => Object.values(data).some((value) => value !== undefined), { message: NOTHING_TO_CHANGE });

const CHECKLIST_ITEM_MESSAGE = "Marque cada item do checklist como OK ou com problema.";

export const createChecklistSchema = z.object(
  {
    items: z.object(
      Object.fromEntries(CHECKLIST_ITENS.map((item) => [item.chave, z.boolean(CHECKLIST_ITEM_MESSAGE)])) as Record<
        ChaveDoChecklist,
        z.ZodBoolean
      >,
      CHECKLIST_ITEM_MESSAGE,
    ),
    odometer: kmOpcional(ODOMETER_MESSAGE),
    notes: optionalText(1000, "Observação muito longa."),
  },
  INVALID_BODY,
);

/** Checklist feito pelo motorista: o veículo é o da viagem dele. */
export const createDriverChecklistSchema = createChecklistSchema.extend({
  manifestId: texto("Informe a viagem.", 64, "Viagem inválida."),
});

const MAINTENANCE_COST_MESSAGE = "O custo precisa ser um número maior que zero.";

export const createMaintenanceSchema = z.object(
  {
    description: texto("Informe a descrição do serviço.", 200, "Descrição muito longa."),
    cost: z.preprocess(fromFormNumber, z.number(MAINTENANCE_COST_MESSAGE).gt(0, MAINTENANCE_COST_MESSAGE).max(1_000_000_000, MAINTENANCE_COST_MESSAGE)),
    date: diaDoCalendario("Informe a data da manutenção."),
    status: z.preprocess(vazioComoNulo, z.enum(MAINTENANCE_STATUSES, "Situação inválida.").nullish()),
    kind: z.preprocess(vazioComoNulo, z.enum(MAINTENANCE_KINDS, "Tipo de manutenção inválido.").nullish()),
    odometer: kmOpcional(ODOMETER_MESSAGE),
  },
  INVALID_BODY,
);

/* ------------------------------ O que as rotas devolvem ----------------------- */

export const FUELING_SELECT = {
  id: true,
  date: true,
  liters: true,
  totalCost: true,
  odometer: true,
  station: true,
  driverId: true,
  // Do motorista, só o nome.
  driver: { select: { id: true, user: { select: { name: true } } } },
} as const;

export const DOCUMENT_SELECT = { id: true, type: true, number: true, expiresAt: true, notes: true } as const;

export const TIRE_SELECT = {
  id: true,
  position: true,
  brandModel: true,
  installedAt: true,
  installedKm: true,
  removedKm: true,
  notes: true,
} as const;

export const CHECKLIST_SELECT = {
  id: true,
  date: true,
  odometer: true,
  items: true,
  notes: true,
  user: { select: { name: true } },
} as const;

export const VEHICLE_NOT_FOUND = "Veículo não encontrado.";
