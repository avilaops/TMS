import { z } from "zod";
import { diaDoVencimento, diaNoBrasil } from "@/lib/financeiro";
import { acertoDoAdiantamento, comissaoDoFrete, pessoaDaChave, rotuloDoMotivo, type Pessoa } from "@/lib/equipe";
import { type ViagemNoTempo, codigoDaViagem, finalizadaEm, janelaDaViagem, kmRodados } from "@/lib/viagem";

/**
 * Remuneração variável da equipe de estrada: o que cada viagem finalizada rende
 * ao motorista e ao ajudante, e o fechamento do mês. Regras e contas comuns às
 * rotas e às telas; este arquivo não toca no banco.
 *
 * As formas convivem: cada uma que tem valor no cadastro entra na conta.
 * - **Comissão**: percentual do frete das cargas ENTREGUES na viagem.
 * - **Diária**: valor por dia de viagem, do dia da saída ao da finalização, os
 *   dois contando, no relógio do Brasil (`janelaDaViagem`).
 * - **Por km**: valor por km rodado (hodômetro de retorno menos o de saída).
 *   Sem os dois hodômetros não há valor por km, e a apuração diz (`semKm`).
 * - **Por entrega**: valor por carga entregue na viagem.
 * - **Fixo**: valor por viagem finalizada.
 * O ajudante tem só diária e fixo.
 *
 * Motorista de parceiro (`Driver.carrierId`) em viagem com contrato de frete:
 * NÃO há remuneração por aqui. O pagamento é o do contrato com o parceiro
 * (src/lib/frete-contratado.ts), e somar os dois pagaria a viagem duas vezes.
 *
 * O fechamento do mês junta as viagens finalizadas nele, soma o variável e
 * desconta o que a pessoa DEVE à empresa e ainda não foi descontado em
 * fechamento nenhum (`descontoDoAdiantamento`):
 * - o **vale** em aberto, inteiro;
 * - a **sobra a devolver** de um adiantamento já acertado (recebeu mais do que
 *   gastou com comprovante);
 * - o **saldo devedor** do último fechamento anterior da pessoa, quando ele
 *   fechou negativo (`saldoDevedor`).
 * Entram os do mês e os de meses anteriores que ficaram para trás; estes saem
 * numa linha à parte ("de meses anteriores"). O adiantamento de viagem (e o de
 * motivo "outro") ainda SEM ACERTO não é dívida: é dinheiro da empresa na mão
 * da pessoa para pagar despesa, e só o acerto diz quanto sobrou. Fica de fora,
 * com um aviso. Não há outro desconto: o sistema não calcula encargo, falta nem
 * imposto.
 * **Saldo** = variável − descontos. Fechar congela esses números, lança o
 * saldo a pagar no Financeiro e marca os adiantamentos descontados
 * (`CrewAdvance.closingId`), para nenhum entrar em dois fechamentos. O
 * adiantamento já virou despesa quando foi entregue: lançar o variável inteiro
 * contaria esse dinheiro duas vezes.
 *
 * É um demonstrativo gerencial. Não é folha de pagamento: não há encargos,
 * INSS, IRRF, FGTS, hora extra, jornada, banco de horas, DSR nem férias.
 */

const centavos = (valor: number) => Math.round((valor + Number.EPSILON) * 100) / 100;
const reais = (valor: number) => valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const numero = (valor: number) => valor.toLocaleString("pt-BR");
const DIA = 86_400_000;

/* ----------------------------------- Formas ----------------------------------- */

/** As formas de remuneração do cadastro do motorista. `null` = não usa a forma. */
export type FormasDoMotorista = {
  commissionPct: number | null;
  dailyRate: number | null;
  perKmRate: number | null;
  perDeliveryRate: number | null;
  perTripRate: number | null;
};

/** As formas do ajudante: diária e fixo por viagem. */
export type FormasDoAjudante = { dailyRate: number | null; perTripRate: number | null };

export const CAMPOS_DAS_FORMAS = ["commissionPct", "dailyRate", "perKmRate", "perDeliveryRate", "perTripRate"] as const;
export const CAMPOS_DAS_FORMAS_DO_AJUDANTE = ["dailyRate", "perTripRate"] as const;

/** Os campos de remuneração que nasceram depois da comissão: é o que as leituras do motorista escondem junto com ela. */
export const CAMPOS_DE_VALOR_DO_MOTORISTA = ["dailyRate", "perKmRate", "perDeliveryRate", "perTripRate"] as const;

export const SEM_FORMAS: FormasDoMotorista = { commissionPct: null, dailyRate: null, perKmRate: null, perDeliveryRate: null, perTripRate: null };

/** As parcelas da apuração, uma por forma. `null` = a forma não se aplica (sem valor no cadastro, ou por km sem os hodômetros). */
export type Parcelas = {
  comissao: number | null;
  diarias: number | null;
  porKm: number | null;
  porEntrega: number | null;
  fixo: number | null;
};

export const PARCELAS = ["comissao", "diarias", "porKm", "porEntrega", "fixo"] as const;
export type Parcela = (typeof PARCELAS)[number];

export const ROTULO_DA_PARCELA: Record<Parcela, string> = {
  comissao: "Comissão",
  diarias: "Diárias",
  porKm: "Por km",
  porEntrega: "Por entrega",
  fixo: "Fixo por viagem",
};

/** Alguma forma tem valor no cadastro? */
export const temForma = (formas: Partial<FormasDoMotorista>) => CAMPOS_DAS_FORMAS.some((campo) => typeof formas[campo] === "number");

/* ----------------------------- Apuração por viagem ---------------------------- */

/** O que a apuração lê da viagem. */
export type ViagemDaApuracao = ViagemNoTempo & {
  departureOdometer?: number | null;
  returnOdometer?: number | null;
  collections: readonly { status: string; freightValue: number | null }[];
  /** O contrato de frete com o parceiro, quando a viagem tem (só a situação). */
  freightContract?: { status: string } | null;
};

export type BasesDaViagem = {
  /** Dias de calendário do Brasil, da saída à finalização, os dois contando. */
  dias: number;
  /** `null` sem os dois hodômetros (ou com o retorno menor que a saída). */
  km: number | null;
  /** Cargas entregues na viagem. */
  entregas: number;
  /** A soma do frete das cargas entregues (carga a cotar não soma). */
  frete: number;
};

/** Por que a viagem não gera remuneração: `PARCEIRO` = motorista de parceiro em viagem com contrato de frete. */
export type ForaDaApuracao = "PARCEIRO";

export type Apuracao = BasesDaViagem & {
  parcelas: Parcelas;
  total: number;
  /** O cadastro tem valor por km, mas a viagem não tem os dois hodômetros: a parcela ficou de fora. */
  semKm: boolean;
  fora: ForaDaApuracao | null;
};

export const EXPLICACAO_SEM_KM = "Sem o hodômetro de saída e o de retorno não há km rodado: o valor por km ficou de fora desta viagem.";
export const EXPLICACAO_DO_PARCEIRO = "Motorista de parceiro em viagem com frete contratado: o pagamento é o do contrato, na aba Frete.";
/** A mesma explicação, para o motorista ler no aplicativo. */
export const EXPLICACAO_DO_PARCEIRO_NO_APP = "Viagem com frete contratado: o pagamento é o do contrato com o parceiro.";

/** Quantos dias de calendário a viagem durou, no relógio do Brasil. O dia da saída e o da finalização contam. */
export function diasDeViagem(viagem: ViagemNoTempo, hoje: Date = new Date()): number {
  const { inicio, fim } = janelaDaViagem(viagem, hoje);
  return Math.round((Date.parse(`${fim}T00:00:00.000Z`) - Date.parse(`${inicio}T00:00:00.000Z`)) / DIA) + 1;
}

/** As bases da conta: dias, km, entregas feitas e o frete delas. */
export function basesDaViagem(viagem: ViagemDaApuracao, hoje: Date = new Date()): BasesDaViagem {
  const entregues = viagem.collections.filter((carga) => carga.status === "DELIVERED");
  return {
    dias: diasDeViagem(viagem, hoje),
    km: kmRodados(viagem.departureOdometer, viagem.returnOdometer),
    entregas: entregues.length,
    frete: centavos(entregues.reduce((soma, carga) => soma + (carga.freightValue ?? 0), 0)),
  };
}

/** O contrato de frete da viagem vale (existe e não foi cancelado)? */
export const temContratoDeFrete = (viagem: Pick<ViagemDaApuracao, "freightContract">) => Boolean(viagem.freightContract && viagem.freightContract.status !== "CANCELADO");

const vezes = (quantidade: number, valor: number | null | undefined) => (typeof valor === "number" ? centavos(quantidade * valor) : null);

/**
 * O que a viagem rende ao motorista, forma por forma, e o total. A viagem
 * precisa estar finalizada: as outras não rendem nada ainda (`total` zero).
 * `motoristaDeParceiro` com contrato de frete na viagem deixa tudo de fora
 * (`fora: "PARCEIRO"`).
 */
export function apurarViagem(viagem: ViagemDaApuracao, formas: Partial<FormasDoMotorista>, opcoes: { motoristaDeParceiro?: boolean; hoje?: Date } = {}): Apuracao {
  const bases = basesDaViagem(viagem, opcoes.hoje);
  const nada: Parcelas = { comissao: null, diarias: null, porKm: null, porEntrega: null, fixo: null };
  if (opcoes.motoristaDeParceiro && temContratoDeFrete(viagem)) return { ...bases, parcelas: nada, total: 0, semKm: false, fora: "PARCEIRO" };
  if (viagem.status !== "FINISHED") return { ...bases, parcelas: nada, total: 0, semKm: false, fora: null };

  const porKm = typeof formas.perKmRate === "number";
  const parcelas: Parcelas = {
    comissao: comissaoDoFrete(bases.frete, formas.commissionPct),
    diarias: vezes(bases.dias, formas.dailyRate),
    porKm: porKm && bases.km !== null ? vezes(bases.km, formas.perKmRate) : null,
    porEntrega: vezes(bases.entregas, formas.perDeliveryRate),
    fixo: vezes(1, formas.perTripRate),
  };
  return {
    ...bases,
    parcelas,
    total: centavos(PARCELAS.reduce((soma, parcela) => soma + (parcelas[parcela] ?? 0), 0)),
    semKm: porKm && bases.km === null,
    fora: null,
  };
}

/** O que a viagem rende ao ajudante: diária e fixo. O ajudante é da empresa: o contrato com o parceiro não o tira da conta. */
export function apurarAjudante(viagem: ViagemDaApuracao, formas: Partial<FormasDoAjudante>, hoje?: Date): Apuracao {
  return apurarViagem(viagem, { dailyRate: formas.dailyRate ?? null, perTripRate: formas.perTripRate ?? null }, { hoje });
}

/* ------------------------------ Fechamento do mês ------------------------------ */

export const MES_MESSAGE = "Informe o mês como AAAA-MM.";
const MES = /^\d{4}-(0[1-9]|1[0-2])$/;

export const mesValido = (mes: string) => MES.test(mes);

/** O mês corrente no relógio do Brasil (`AAAA-MM`). */
export const mesAtual = (hoje: Date = new Date()) => diaNoBrasil(hoje).slice(0, 7);

/** O mês vizinho: `passo` +1 é o seguinte, −1 o anterior. */
export function mesVizinho(mes: string, passo: number): string {
  const [ano, numero] = mes.split("-").map(Number);
  const total = ano * 12 + (numero - 1) + passo;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

/** O mês por extenso, como o recibo mostra: "10/2026". */
export const mesPorExtenso = (mes: string) => mes.split("-").reverse().join("/");

/**
 * Os limites do mês nos dois sentidos de data do sistema: `instantes` para o
 * que é instante (a finalização da viagem, no relógio do Brasil) e `dias` para
 * o que é dia do calendário gravado à meia-noite UTC (a data do adiantamento).
 * O fim é exclusivo nos dois.
 */
export function limitesDoMes(mes: string): { instantes: { gte: Date; lt: Date }; dias: { gte: Date; lt: Date } } {
  const seguinte = mesVizinho(mes, 1);
  return {
    instantes: { gte: new Date(`${mes}-01T00:00:00-03:00`), lt: new Date(`${seguinte}-01T00:00:00-03:00`) },
    dias: { gte: new Date(`${mes}-01T00:00:00.000Z`), lt: new Date(`${seguinte}-01T00:00:00.000Z`) },
  };
}

/** O mês (`AAAA-MM`, relógio do Brasil) em que a viagem foi finalizada; `null` se não foi. */
export function mesDaViagem(viagem: ViagemNoTempo): string | null {
  const quando = finalizadaEm(viagem);
  return quando ? diaNoBrasil(quando).slice(0, 7) : null;
}

/** Uma viagem no fechamento: as bases, as parcelas e o total, com o que a identifica. */
export type LinhaDeViagem = Apuracao & {
  manifestId: string;
  codigo: string;
  /** O dia da saída e o da finalização (`AAAA-MM-DD`, relógio do Brasil). */
  saida: string;
  finalizada: string;
  placa: string;
};

/** A linha da viagem, a partir da apuração dela. */
export function linhaDaViagem(viagem: ViagemDaApuracao & { id: string; vehicle: { plate: string } }, apuracao: Apuracao, hoje: Date = new Date()): LinhaDeViagem {
  const janela = janelaDaViagem(viagem, hoje);
  return { ...apuracao, manifestId: viagem.id, codigo: codigoDaViagem(viagem.id), saida: janela.inicio, finalizada: janela.fim, placa: viagem.vehicle.plate };
}

/**
 * De onde vem o desconto: `VALE` é o vale em aberto, inteiro; `SOBRA` é o que a
 * pessoa tem a devolver de um adiantamento já acertado.
 */
export type OrigemDoDesconto = "VALE" | "SOBRA";

/**
 * Um adiantamento no fechamento. `date` é o dia do calendário (`AAAA-MM-DD`) e
 * `amount`, o que entra na conta: o vale inteiro ou a sobra a devolver (no
 * adiantamento sem acerto, que fica de fora, é o valor adiantado). Fechamento
 * gravado antes de `origem` e `anterior` existirem vem sem os dois.
 */
export type AdiantamentoDoMes = {
  id: string;
  date: string;
  amount: number;
  reason: string;
  origem?: OrigemDoDesconto;
  /** Com data anterior ao mês do fechamento: dívida de meses anteriores. */
  anterior?: boolean;
};

/** O que a conta lê de um adiantamento (`CrewAdvance`). */
export type AdiantamentoDaEquipe = { id: string; date: Date | string; amount: number; reason: string; status: string; spentAmount: number | null };

/**
 * Quanto de um adiantamento é dívida da pessoa com a empresa, a descontar no
 * fechamento:
 * - acertado com sobra: a sobra a devolver (qualquer motivo);
 * - acertado sem sobra (quitado, ou a empresa é que completa): nada (`null`);
 * - vale em aberto: o vale inteiro;
 * - adiantamento de viagem ou de motivo "outro" em aberto: `"SEM_ACERTO"`. Não
 *   se sabe ainda quanto foi gasto: fica de fora até o acerto.
 */
export function descontoDoAdiantamento(adiantamento: Pick<AdiantamentoDaEquipe, "amount" | "reason" | "status" | "spentAmount">): { valor: number; origem: OrigemDoDesconto } | "SEM_ACERTO" | null {
  if (adiantamento.status === "SETTLED") {
    const acerto = acertoDoAdiantamento(adiantamento.amount, adiantamento.spentAmount ?? adiantamento.amount);
    return acerto.sentido === "devolver" ? { valor: acerto.diferenca, origem: "SOBRA" } : null;
  }
  return adiantamento.reason === "VOUCHER" ? { valor: centavos(adiantamento.amount), origem: "VALE" } : "SEM_ACERTO";
}

/**
 * Separa os adiantamentos de uma pessoa para o fechamento de `mes`: os que
 * entram na conta (`descontos`, com `anterior` nos de data anterior ao mês) e
 * os que ficam de fora por falta de acerto (`semAcerto`). Acertado sem sobra
 * não aparece em nenhuma das duas listas. Quem chama já escolheu os
 * adiantamentos com data até o fim do mês e ainda não descontados.
 */
export function adiantamentosDoFechamento(adiantamentos: readonly AdiantamentoDaEquipe[], mes: string): { descontos: AdiantamentoDoMes[]; semAcerto: AdiantamentoDoMes[] } {
  const descontos: AdiantamentoDoMes[] = [];
  const semAcerto: AdiantamentoDoMes[] = [];
  for (const adiantamento of adiantamentos) {
    const desconto = descontoDoAdiantamento(adiantamento);
    if (desconto === null) continue;
    const date = diaDoVencimento(adiantamento.date);
    const comum = { id: adiantamento.id, date, reason: adiantamento.reason, anterior: date < `${mes}-01` };
    if (desconto === "SEM_ACERTO") semAcerto.push({ ...comum, amount: adiantamento.amount });
    else descontos.push({ ...comum, amount: desconto.valor, origem: desconto.origem });
  }
  return { descontos, semAcerto };
}

/** O saldo devedor que um fechamento anterior deixou, trazido para a conta deste mês. */
export type SaldoAnterior = { mes: string; valor: number };

/**
 * O que o último fechamento anterior da pessoa deixou de dívida: o saldo dele,
 * quando fechou negativo. Só o último importa: o saldo dele já carrega o que
 * veio dos anteriores.
 */
export function saldoDevedor(anterior: { month: string; balance: number } | null | undefined): SaldoAnterior | null {
  return anterior && anterior.balance < 0 ? { mes: anterior.month, valor: centavos(-anterior.balance) } : null;
}

/** A conta do mês de uma pessoa. */
export type ContaDoMes = {
  viagens: LinhaDeViagem[];
  /** A soma de cada parcela nas viagens do mês. */
  parcelas: Record<Parcela, number>;
  variavel: number;
  /** Os adiantamentos descontados: os do mês e os de meses anteriores (`anterior`). */
  adiantamentos: AdiantamentoDoMes[];
  /** O saldo devedor do último fechamento anterior, quando há. */
  saldoAnterior: SaldoAnterior | null;
  /** Tudo o que foi descontado: os adiantamentos e o saldo devedor anterior. */
  adiantado: number;
  /** A parte de `adiantado` que é de meses anteriores. */
  anteriores: number;
  /** Adiantamentos ainda sem acerto: ficam fora da conta, e a tela avisa. */
  semAcerto: AdiantamentoDoMes[];
  /** Variável − descontos. Negativo: a pessoa deve à empresa, e o próximo fechamento traz a dívida. */
  saldo: number;
};

const somar = (lista: readonly { amount: number }[]) => centavos(lista.reduce((soma, item) => soma + item.amount, 0));
const porData = (a: AdiantamentoDoMes, b: AdiantamentoDoMes) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id);

/**
 * A conta do mês: as viagens da mais antiga para a mais nova, o variável, os
 * descontos (adiantamentos e saldo devedor anterior) e o saldo. Viagem fora da
 * apuração (motorista de parceiro com contrato) continua na lista, com total
 * zero e o motivo.
 */
export function contaDoMes(
  viagens: readonly LinhaDeViagem[],
  adiantamentos: readonly AdiantamentoDoMes[],
  outros: { semAcerto?: readonly AdiantamentoDoMes[]; saldoAnterior?: SaldoAnterior | null } = {},
): ContaDoMes {
  const linhas = [...viagens].sort((a, b) => a.finalizada.localeCompare(b.finalizada) || a.codigo.localeCompare(b.codigo));
  const descontados = [...adiantamentos].sort(porData);
  const saldoAnterior = outros.saldoAnterior ?? null;
  const parcelas = Object.fromEntries(PARCELAS.map((parcela) => [parcela, centavos(linhas.reduce((soma, linha) => soma + (linha.parcelas[parcela] ?? 0), 0))])) as Record<Parcela, number>;
  const variavel = centavos(linhas.reduce((soma, linha) => soma + linha.total, 0));
  const anteriores = centavos(somar(descontados.filter((adiantamento) => adiantamento.anterior)) + (saldoAnterior?.valor ?? 0));
  const adiantado = centavos(somar(descontados) + (saldoAnterior?.valor ?? 0));
  return {
    viagens: linhas,
    parcelas,
    variavel,
    adiantamentos: descontados,
    saldoAnterior,
    adiantado,
    anteriores,
    semAcerto: [...(outros.semAcerto ?? [])].sort(porData),
    saldo: centavos(variavel - adiantado),
  };
}

/** Há o que fechar? Viagem finalizada no mês ou adiantamento a descontar. Só saldo devedor anterior não fecha mês: ele segue para o próximo. */
export const temOQueFechar = (conta: Pick<ContaDoMes, "viagens" | "adiantamentos">) => conta.viagens.length > 0 || conta.adiantamentos.length > 0;

/**
 * O aviso dos adiantamentos sem acerto, ou `null` sem nenhum: "1 adiantamento
 * sem acerto (R$ 300,00) ficou fora da conta: …". No recibo (`noPapel`) sai sem
 * a instrução de tela, que é para quem fecha o mês.
 */
export function avisoDeSemAcerto(semAcerto: readonly AdiantamentoDoMes[], noPapel = false): string | null {
  if (semAcerto.length === 0) return null;
  const um = semAcerto.length === 1;
  const fato = `${semAcerto.length} ${um ? "adiantamento" : "adiantamentos"} sem acerto (${reais(somar(semAcerto))}) ${um ? "ficou" : "ficaram"} fora da conta`;
  return noPapel ? `${fato}: a sobra a devolver, se houver, entra num próximo fechamento, depois do acerto.` : `${fato}: acerte na aba Adiantamentos e a sobra a devolver entra no fechamento.`;
}

/** O desconto por extenso, para a tela e o recibo: "Vale", "Sobra do adiantamento de viagem". */
export function descontoPorExtenso(adiantamento: Pick<AdiantamentoDoMes, "reason" | "origem">): string {
  const motivo = rotuloDoMotivo(adiantamento.reason);
  return adiantamento.origem === "SOBRA" ? `Sobra do ${motivo.charAt(0).toLowerCase()}${motivo.slice(1)}` : motivo;
}

export const ROTULO_DE_MESES_ANTERIORES = "De meses anteriores";

/** A linha do saldo devedor trazido: "Saldo devedor do fechamento de 09/2026". */
export const saldoAnteriorPorExtenso = (saldo: SaldoAnterior) => `Saldo devedor do fechamento de ${mesPorExtenso(saldo.mes)}`;

/** O que o fechamento lança no Financeiro: o saldo a pagar. Saldo zero ou negativo não lança nada. */
export const valorALancar = (conta: Pick<ContaDoMes, "saldo">) => (conta.saldo > 0 ? conta.saldo : 0);

/** Os três números que o fechamento congela. */
export type ValoresCongelados = { variableTotal: number; advancesTotal: number; balance: number };

export type Diferenca = { variavel: number; adiantado: number; saldo: number };

/**
 * O quanto a conta de hoje se afastou do que foi fechado (hoje − fechado), ou
 * `null` quando continua igual. Acontece quando uma viagem do mês é alterada,
 * finalizada ou um adiantamento é lançado depois do fechamento: o fechado não
 * muda sozinho, a tela mostra a diferença e oferece reabrir.
 */
export function diferencaDoFechamento(fechado: ValoresCongelados, atual: Pick<ContaDoMes, "variavel" | "adiantado" | "saldo">): Diferenca | null {
  const diferenca = {
    variavel: centavos(atual.variavel - fechado.variableTotal),
    adiantado: centavos(atual.adiantado - fechado.advancesTotal),
    saldo: centavos(atual.saldo - fechado.balance),
  };
  return diferenca.variavel === 0 && diferenca.adiantado === 0 && diferenca.saldo === 0 ? null : diferenca;
}

/**
 * O que o fechamento guarda em `details`: as formas do cadastro, as viagens, os
 * adiantamentos descontados, os que ficaram sem acerto e o saldo devedor
 * trazido, como estavam.
 */
export type DetalhesDoFechamento = {
  formas: Partial<FormasDoMotorista>;
  viagens: LinhaDeViagem[];
  adiantamentos: AdiantamentoDoMes[];
  semAcerto: AdiantamentoDoMes[];
  saldoAnterior: SaldoAnterior | null;
};

/** Lê o `details` gravado. Formato estranho (linha antiga ou mexida à mão) vira listas vazias, sem derrubar a tela. */
export function lerDetalhes(valor: unknown): DetalhesDoFechamento {
  const objeto = (valor && typeof valor === "object" ? valor : {}) as Partial<DetalhesDoFechamento>;
  const saldo = objeto.saldoAnterior;
  return {
    formas: objeto.formas && typeof objeto.formas === "object" ? objeto.formas : {},
    viagens: Array.isArray(objeto.viagens) ? objeto.viagens : [],
    adiantamentos: Array.isArray(objeto.adiantamentos) ? objeto.adiantamentos : [],
    semAcerto: Array.isArray(objeto.semAcerto) ? objeto.semAcerto : [],
    saldoAnterior: saldo && typeof saldo === "object" && typeof saldo.mes === "string" && typeof saldo.valor === "number" ? { mes: saldo.mes, valor: saldo.valor } : null,
  };
}

/** A conta congelada, remontada do que o fechamento guardou. */
export function contaCongelada(fechamento: ValoresCongelados & { details: unknown }): ContaDoMes {
  const { viagens, adiantamentos, semAcerto, saldoAnterior } = lerDetalhes(fechamento.details);
  return { ...contaDoMes(viagens, adiantamentos, { semAcerto, saldoAnterior }), variavel: fechamento.variableTotal, adiantado: fechamento.advancesTotal, saldo: fechamento.balance };
}

/** Categoria da despesa que o fechamento lança no Financeiro. */
export const CATEGORIA_DA_REMUNERACAO = "Remuneração variável";

/** Descrição do lançamento do fechamento no Financeiro. */
export const descricaoDoFechamento = (mes: string, nome: string) => `Remuneração variável de ${mesPorExtenso(mes)}: ${nome}`;

/* --------------------------------- Por extenso -------------------------------- */

/** As formas do cadastro numa linha: "Comissão 5% · Diária R$ 80,00 · Por km R$ 0,30". */
export function formasPorExtenso(formas: Partial<FormasDoMotorista>): string {
  const partes = [
    typeof formas.commissionPct === "number" ? `Comissão ${numero(formas.commissionPct)}%` : null,
    typeof formas.dailyRate === "number" ? `Diária ${reais(formas.dailyRate)}` : null,
    typeof formas.perKmRate === "number" ? `Por km ${reais(formas.perKmRate)}` : null,
    typeof formas.perDeliveryRate === "number" ? `Por entrega ${reais(formas.perDeliveryRate)}` : null,
    typeof formas.perTripRate === "number" ? `Fixo ${reais(formas.perTripRate)}` : null,
  ].filter((parte): parte is string => parte !== null);
  return partes.length > 0 ? partes.join(" · ") : "Sem forma de remuneração no cadastro";
}

/** As parcelas de uma viagem numa linha, só as que têm valor: "Comissão R$ 50,00 · Diárias R$ 240,00". Vazio sem nenhuma. */
export function parcelasPorExtenso(linha: Pick<Apuracao, "parcelas">): string {
  return PARCELAS.flatMap((parcela) => {
    const valor = linha.parcelas[parcela];
    return valor === null ? [] : `${ROTULO_DA_PARCELA[parcela]} ${reais(valor)}`;
  }).join(" · ");
}

/** As bases de uma viagem numa linha: "3 dias · 420 km · 5 entregas". */
export function basesPorExtenso(linha: Pick<Apuracao, "dias" | "km" | "entregas">): string {
  return [`${linha.dias} ${linha.dias === 1 ? "dia" : "dias"}`, linha.km === null ? "sem km" : `${numero(linha.km)} km`, `${linha.entregas} ${linha.entregas === 1 ? "entrega" : "entregas"}`].join(" · ");
}

/* ------------------------------------ Recibo ---------------------------------- */

export const TITULO_DO_DEMONSTRATIVO = "DEMONSTRATIVO DE REMUNERAÇÃO VARIÁVEL";
export const AVISO_DO_DEMONSTRATIVO = "Demonstrativo de remuneração variável. Não é holerite nem recibo de salário: os encargos e a folha são do contador.";

/** O que a página do recibo recebe (`GET /api/equipe/fechamento/[id]`). */
export type ReciboDoFechamento = {
  empresa: { name: string; logo: string | null };
  emitidoEm: string;
  pessoa: { tipo: "motorista" | "ajudante"; nome: string; cpf: string };
  mes: string;
  fechadoEm: string;
  fechadoPor: string;
  formas: Partial<FormasDoMotorista>;
  conta: ContaDoMes;
};

/* --------------------------- O que as rotas devolvem --------------------------- */

/** Uma pessoa no fechamento do mês (`GET /api/equipe/fechamento`). */
export type PessoaDoFechamento = {
  /** `motorista:<id>` ou `ajudante:<id>` (src/lib/equipe.ts). */
  chave: string;
  tipo: "motorista" | "ajudante";
  nome: string;
  cpf: string;
  ativo: boolean;
  formas: Partial<FormasDoMotorista>;
  /** A conta de hoje, com o cadastro e as viagens como estão. */
  atual: ContaDoMes;
  /** O fechamento gravado, quando o mês está fechado. */
  fechamento: {
    id: string;
    fechadoEm: string;
    fechadoPor: string;
    conta: ContaDoMes;
    /** O lançamento do Financeiro: `null` quando não havia saldo a pagar (ou foi apagado por lá). */
    lancamento: { id: string; status: string; amount: number } | null;
  } | null;
  diferenca: Diferenca | null;
};

export type FechamentoDoMes = { mes: string; pessoas: PessoaDoFechamento[]; total: { variavel: number; adiantado: number; saldo: number } };

/** O que o aplicativo do motorista recebe (`GET /api/driver/remuneracao`). Só o que as viagens dele renderam. */
export type RemuneracaoDoMotorista =
  | { visivel: false }
  | { visivel: true; mes: string; fechado: boolean; total: number; viagens: Pick<LinhaDeViagem, "manifestId" | "codigo" | "finalizada" | "placa" | "dias" | "km" | "entregas" | "parcelas" | "total" | "semKm" | "fora">[] };

/* ---------------------------------- Validação --------------------------------- */

const INVALID_BODY = "Dados inválidos.";

// O formulário manda número como texto ("120,50"; "" quando em branco). Em branco ou `null` tira a forma.
const fromFormNumber = (value: unknown) => {
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (text === "") return null;
  return /^(\d+([.,]\d*)?|[.,]\d+)$/.test(text) ? Number(text.replace(",", ".")) : NaN;
};

/** Um valor em reais de uma forma de remuneração: maior ou igual a zero; em branco ou `null` tira a forma; ausente não mexe. */
export const valorDaForma = (message: string) => z.preprocess(fromFormNumber, z.number(message).min(0, message).max(1_000_000, message).nullish());

/** As formas do motorista além da comissão, como o cadastro manda (`PATCH /api/motoristas/[id]`). */
export const formasDoMotorista = {
  dailyRate: valorDaForma("A diária precisa ser um valor maior ou igual a zero."),
  perKmRate: valorDaForma("O valor por km precisa ser um número maior ou igual a zero."),
  perDeliveryRate: valorDaForma("O valor por entrega precisa ser um número maior ou igual a zero."),
  perTripRate: valorDaForma("O fixo por viagem precisa ser um valor maior ou igual a zero."),
};

export const REMUNERACAO_SO_DE_QUEM_PAGA = "Só quem altera os valores da equipe muda a remuneração.";

/** A remuneração do ajudante (`PATCH /api/equipe/ajudantes/[id]/remuneracao`). */
export const remuneracaoDoAjudanteSchema = z
  .object({ dailyRate: formasDoMotorista.dailyRate, perTripRate: formasDoMotorista.perTripRate }, INVALID_BODY)
  .refine((dados) => Object.values(dados).some((valor) => valor !== undefined), { message: "Informe a diária ou o fixo por viagem." });

const PESSOA_MESSAGE = "Escolha um motorista ou um ajudante.";
const mes = z.string(MES_MESSAGE).trim().regex(MES, MES_MESSAGE);

/** Fechar o mês de uma pessoa (`POST /api/equipe/fechamento`). */
export const fecharMesSchema = z.object(
  {
    pessoa: z
      .string(PESSOA_MESSAGE)
      .trim()
      .max(80, PESSOA_MESSAGE)
      .transform((chave): Pessoa => pessoaDaChave(chave))
      .refine((pessoa) => Boolean(pessoa.driverId) !== Boolean(pessoa.helperId), PESSOA_MESSAGE),
    mes,
  },
  INVALID_BODY,
);

/** O interruptor da empresa (`PATCH /api/empresa/remuneracao`). */
export const visibilidadeSchema = z.object({ visivelAoMotorista: z.boolean("Informe se o motorista vê a remuneração no aplicativo.") }, INVALID_BODY);

export const CLOSING_NOT_FOUND = "Fechamento não encontrado.";
export const ALREADY_CLOSED = "Este mês já está fechado para esta pessoa. Reabra antes de fechar de novo.";
export const NOTHING_TO_CLOSE = "Não há viagem finalizada no mês nem vale ou sobra de acerto a descontar: não há o que fechar.";
export const ADVANCES_CHANGED = "Um adiantamento desta pessoa mudou enquanto o mês era fechado. Confira a conta e feche de novo.";
export const FUTURE_MONTH ="Não dá para fechar um mês que ainda não começou.";
export const CLOSING_ALREADY_PAID = "O lançamento deste fechamento já está pago no Financeiro. Reabra o lançamento lá antes de reabrir o mês.";
