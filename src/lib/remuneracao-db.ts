import type { Prisma } from "@prisma/client";
import { chaveDaPessoa, type Pessoa } from "@/lib/equipe";
import {
  CAMPOS_DAS_FORMAS,
  type ContaDoMes,
  type FormasDoMotorista,
  type LinhaDeViagem,
  type PessoaDoFechamento,
  adiantamentosDoFechamento,
  apurarAjudante,
  apurarViagem,
  contaCongelada,
  contaDoMes,
  diferencaDoFechamento,
  lerDetalhes,
  limitesDoMes,
  linhaDaViagem,
  mesDaViagem,
  saldoDevedor,
  temForma,
} from "@/lib/remuneracao";
import { finalizadaNoPeriodo } from "@/lib/viagem";

// Apoio das rotas da remuneração variável: o fechamento do mês (painel e
// aplicativo do motorista) e o custo dela no acerto e no resultado da viagem.
// Só o servidor importa este arquivo.

type Db = Pick<Prisma.TransactionClient, "manifest" | "driver" | "helper" | "crewAdvance" | "crewPayClosing">;

const FORMAS_DO_MOTORISTA_SELECT = { commissionPct: true, dailyRate: true, perKmRate: true, perDeliveryRate: true, perTripRate: true } as const;

/** O que a apuração lê de cada viagem: as bases, o contrato com o parceiro e as formas do motorista e do ajudante. */
export const VIAGEM_DA_REMUNERACAO_SELECT = {
  id: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  departedAt: true,
  finishedAt: true,
  departureOdometer: true,
  returnOdometer: true,
  driverId: true,
  helperId: true,
  vehicle: { select: { plate: true } },
  collections: { select: { status: true, freightValue: true } },
  freightContract: { select: { status: true } },
  driver: { select: { id: true, carrierId: true, ...FORMAS_DO_MOTORISTA_SELECT } },
  helper: { select: { id: true, dailyRate: true, perTripRate: true } },
} satisfies Prisma.ManifestSelect;

export type ViagemDaRemuneracao = Prisma.ManifestGetPayload<{ select: typeof VIAGEM_DA_REMUNERACAO_SELECT }>;

/** A linha da viagem para o motorista dela. */
export const linhaDoMotorista = (viagem: ViagemDaRemuneracao, hoje?: Date): LinhaDeViagem =>
  linhaDaViagem(viagem, apurarViagem(viagem, viagem.driver, { motoristaDeParceiro: Boolean(viagem.driver.carrierId), hoje }), hoje);

/** A linha da viagem para o ajudante dela; `null` em viagem sem ajudante. */
export const linhaDoAjudante = (viagem: ViagemDaRemuneracao, hoje?: Date): LinhaDeViagem | null =>
  viagem.helper ? linhaDaViagem(viagem, apurarAjudante(viagem, viagem.helper, hoje), hoje) : null;

export const CLOSING_SELECT = {
  id: true,
  driverId: true,
  helperId: true,
  month: true,
  variableTotal: true,
  advancesTotal: true,
  balance: true,
  details: true,
  closedByName: true,
  closedAt: true,
  transactionId: true,
  transaction: { select: { id: true, status: true, amount: true } },
} satisfies Prisma.CrewPayClosingSelect;

export type FechamentoGravado = Prisma.CrewPayClosingGetPayload<{ select: typeof CLOSING_SELECT }>;

/**
 * A conta do mês de UMA pessoa, com o cadastro e as viagens como estão agora:
 * as viagens finalizadas no mês em que ela foi o motorista (ou o ajudante), os
 * adiantamentos dela ainda não descontados em fechamento nenhum (do mês e de
 * meses anteriores) e o saldo devedor do último fechamento anterior. `null`
 * quando a pessoa não existe nesta empresa.
 */
export async function contaDaPessoa(
  db: Db,
  pessoa: Pessoa,
  mes: string,
): Promise<{ nome: string; cpf: string; ativo: boolean; formas: Partial<FormasDoMotorista>; conta: ContaDoMes } | null> {
  const limites = limitesDoMes(mes);
  const dela = pessoa.driverId ? { driverId: pessoa.driverId } : { helperId: pessoa.helperId };

  let cadastro: { nome: string; cpf: string; ativo: boolean; formas: Partial<FormasDoMotorista> } | null = null;
  if (pessoa.driverId) {
    const motorista = await db.driver.findUnique({ where: { id: pessoa.driverId }, select: { cpf: true, active: true, ...FORMAS_DO_MOTORISTA_SELECT, user: { select: { name: true } } } });
    if (motorista) cadastro = { nome: motorista.user.name, cpf: motorista.cpf, ativo: motorista.active, formas: formasDe(motorista) };
  } else if (pessoa.helperId) {
    const ajudante = await db.helper.findUnique({ where: { id: pessoa.helperId }, select: { name: true, cpf: true, active: true, dailyRate: true, perTripRate: true } });
    if (ajudante) cadastro = { nome: ajudante.name, cpf: ajudante.cpf, ativo: ajudante.active, formas: { dailyRate: ajudante.dailyRate, perTripRate: ajudante.perTripRate } };
  }
  if (!cadastro) return null;

  const viagens = await db.manifest.findMany({ where: { ...finalizadaNoPeriodo(limites.instantes), ...dela }, select: VIAGEM_DA_REMUNERACAO_SELECT });
  const adiantamentos = await db.crewAdvance.findMany({ where: { ...dela, ...aDescontarAte(limites.dias.lt) }, select: ADIANTAMENTO_SELECT });
  const anterior = await db.crewPayClosing.findFirst({ where: { ...dela, month: { lt: mes } }, orderBy: { month: "desc" }, select: { month: true, balance: true } });

  const linhas = viagens.flatMap((viagem) => (pessoa.driverId ? linhaDoMotorista(viagem) : (linhaDoAjudante(viagem) ?? [])));
  const { descontos, semAcerto } = adiantamentosDoFechamento(adiantamentos, mes);
  return { ...cadastro, conta: contaDoMes(linhas, descontos, { semAcerto, saldoAnterior: saldoDevedor(anterior) }) };
}

const ADIANTAMENTO_SELECT = { id: true, date: true, amount: true, reason: true, status: true, spentAmount: true, driverId: true, helperId: true } as const;

/**
 * Os adiantamentos que o fechamento de um mês olha: com data até o fim dele
 * (os do mês e os de meses anteriores que ficaram para trás) e ainda não
 * descontados em fechamento nenhum. `doFechamento` acrescenta os que estes
 * fechamentos descontaram: é como a conta de hoje de um mês JÁ fechado continua
 * igual à congelada enquanto nada muda.
 */
const aDescontarAte = (fimDoMes: Date, doFechamento: readonly string[] = []): Prisma.CrewAdvanceWhereInput => ({
  date: { lt: fimDoMes },
  OR: [{ closingId: null }, ...(doFechamento.length > 0 ? [{ closingId: { in: [...doFechamento] } }] : [])],
});

const formasDe = (motorista: FormasDoMotorista): FormasDoMotorista => Object.fromEntries(CAMPOS_DAS_FORMAS.map((campo) => [campo, motorista[campo]])) as FormasDoMotorista;

/** O fechamento gravado como a tela o recebe: a conta congelada e o lançamento do Financeiro. */
export function fechamentoParaATela(fechamento: FechamentoGravado): NonNullable<PessoaDoFechamento["fechamento"]> {
  return {
    id: fechamento.id,
    fechadoEm: fechamento.closedAt.toISOString(),
    fechadoPor: fechamento.closedByName,
    conta: contaCongelada(fechamento),
    lancamento: fechamento.transaction,
  };
}

/**
 * O fechamento do mês, pessoa por pessoa: a conta de hoje, o fechamento gravado
 * (quando há) e a diferença entre os dois.
 *
 * Entra na lista quem tem o que mostrar: viagem que rende no mês, adiantamento
 * a descontar ou sem acerto, saldo devedor de um fechamento anterior,
 * fechamento gravado, ou cadastro ativo com alguma forma de
 * remuneração. Motorista de parceiro que só fez viagem com frete contratado não
 * aparece: o pagamento dele é o do contrato.
 */
export async function fechamentoDoMes(db: Db, mes: string): Promise<PessoaDoFechamento[]> {
  const limites = limitesDoMes(mes);

  // Uma consulta por vez: cada uma abre a própria transação (src/lib/prisma.ts).
  const motoristas = await db.driver.findMany({ select: { id: true, cpf: true, active: true, ...FORMAS_DO_MOTORISTA_SELECT, user: { select: { name: true } } } });
  const ajudantes = await db.helper.findMany({ select: { id: true, name: true, cpf: true, active: true, dailyRate: true, perTripRate: true } });
  const viagens = await db.manifest.findMany({ where: finalizadaNoPeriodo(limites.instantes), select: VIAGEM_DA_REMUNERACAO_SELECT });
  const fechamentos = await db.crewPayClosing.findMany({ where: { month: mes }, select: CLOSING_SELECT });
  const adiantamentos = await db.crewAdvance.findMany({ where: aDescontarAte(limites.dias.lt, fechamentos.map((fechamento) => fechamento.id)), select: ADIANTAMENTO_SELECT });
  // O último fechamento anterior de cada pessoa (do mais novo para o mais antigo: o primeiro de cada uma é o que vale).
  const anteriores = await db.crewPayClosing.findMany({ where: { month: { lt: mes } }, orderBy: { month: "desc" }, select: { driverId: true, helperId: true, month: true, balance: true } });
  const anteriorDe = new Map<string, { month: string; balance: number }>();
  for (const anterior of anteriores) {
    const chave = chaveDaPessoa(anterior);
    if (!anteriorDe.has(chave)) anteriorDe.set(chave, anterior);
  }

  const linhas = new Map<string, LinhaDeViagem[]>();
  const juntar = (chave: string, linha: LinhaDeViagem | null) => {
    if (linha) linhas.set(chave, [...(linhas.get(chave) ?? []), linha]);
  };
  for (const viagem of viagens) {
    juntar(chaveDaPessoa({ driverId: viagem.driverId, helperId: null }), linhaDoMotorista(viagem));
    if (viagem.helperId) juntar(chaveDaPessoa({ driverId: null, helperId: viagem.helperId }), linhaDoAjudante(viagem));
  }
  const fechamentoDe = new Map(fechamentos.map((fechamento) => [chaveDaPessoa(fechamento), fechamento]));

  const montar = (tipo: "motorista" | "ajudante", pessoa: Pessoa, cadastro: { nome: string; cpf: string; ativo: boolean; formas: Partial<FormasDoMotorista> }): PessoaDoFechamento | null => {
    const chave = chaveDaPessoa(pessoa);
    const { descontos, semAcerto } = adiantamentosDoFechamento(adiantamentos.filter((adiantamento) => chaveDaPessoa(adiantamento) === chave), mes);
    const atual = contaDoMes(linhas.get(chave) ?? [], descontos, { semAcerto, saldoAnterior: saldoDevedor(anteriorDe.get(chave)) });
    const gravado = fechamentoDe.get(chave);
    const rende = atual.viagens.some((linha) => linha.fora === null);
    const deve = atual.adiantamentos.length > 0 || atual.semAcerto.length > 0 || atual.saldoAnterior !== null;
    if (!gravado && !rende && !deve && !(cadastro.ativo && temForma(cadastro.formas))) return null;
    return {
      chave,
      tipo,
      ...cadastro,
      atual,
      fechamento: gravado ? fechamentoParaATela(gravado) : null,
      diferenca: gravado ? diferencaDoFechamento(gravado, atual) : null,
    };
  };

  return [
    ...motoristas.flatMap((m) => montar("motorista", { driverId: m.id, helperId: null }, { nome: m.user.name, cpf: m.cpf, ativo: m.active, formas: formasDe(m) }) ?? []),
    ...ajudantes.flatMap((a) => montar("ajudante", { driverId: null, helperId: a.id }, { nome: a.name, cpf: a.cpf, ativo: a.active, formas: { dailyRate: a.dailyRate, perTripRate: a.perTripRate } }) ?? []),
  ].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

export type RemuneracaoDaViagem = {
  motorista: number;
  ajudante: number;
  total: number;
  /** Por que o motorista não tem remuneração nesta viagem (`PARCEIRO`), ou `null`. */
  fora: LinhaDeViagem["fora"];
  /** O valor por km do motorista ficou de fora por falta de hodômetro. */
  semKm: boolean;
};

const centavos = (valor: number) => Math.round((valor + Number.EPSILON) * 100) / 100;

/**
 * Quanto a remuneração variável pesa no custo de cada viagem (acerto e
 * "Resultado por viagem"): o que ela rende ao motorista mais o que rende ao
 * ajudante. Devolve por id da viagem; viagem não finalizada pesa zero.
 *
 * Mês já fechado: vale o valor CONGELADO da viagem no fechamento, para o
 * resultado dela não mudar quando o cadastro do motorista muda depois. Viagem
 * que entrou no mês depois do fechamento (não está na lista congelada) conta
 * pelo cadastro de hoje, e a tela do fechamento mostra a diferença.
 *
 * Não há dupla contagem: o lançamento que o fechamento faz no Financeiro não é
 * despesa de viagem (não entra em "despesas"), e a viagem de motorista de
 * parceiro com contrato pesa zero aqui: o custo dela é o do frete contratado.
 */
export async function remuneracaoDasViagens(db: Pick<Db, "crewPayClosing">, viagens: readonly ViagemDaRemuneracao[], hoje?: Date): Promise<Map<string, RemuneracaoDaViagem>> {
  const porViagem = new Map<string, RemuneracaoDaViagem>();
  const finalizadas = viagens.filter((viagem) => viagem.status === "FINISHED");
  for (const viagem of viagens) porViagem.set(viagem.id, { motorista: 0, ajudante: 0, total: 0, fora: null, semKm: false });
  if (finalizadas.length === 0) return porViagem;

  const meses = [...new Set(finalizadas.flatMap((viagem) => mesDaViagem(viagem) ?? []))];
  const motoristas = [...new Set(finalizadas.map((viagem) => viagem.driverId))];
  const ajudantes = [...new Set(finalizadas.flatMap((viagem) => viagem.helperId ?? []))];
  const fechamentos = await db.crewPayClosing.findMany({
    where: { month: { in: meses }, OR: [{ driverId: { in: motoristas } }, { helperId: { in: ajudantes } }] },
    select: { driverId: true, helperId: true, month: true, details: true },
  });
  // chave da pessoa + mês → o total congelado de cada viagem naquele fechamento.
  const congelado = new Map<string, Map<string, number>>();
  for (const fechamento of fechamentos) {
    congelado.set(`${chaveDaPessoa(fechamento)}|${fechamento.month}`, new Map(lerDetalhes(fechamento.details).viagens.map((linha) => [linha.manifestId, linha.total])));
  }
  const valorDe = (pessoa: Pessoa, mes: string | null, viagemId: string, atual: number) => congelado.get(`${chaveDaPessoa(pessoa)}|${mes}`)?.get(viagemId) ?? atual;

  for (const viagem of finalizadas) {
    const mes = mesDaViagem(viagem);
    const doMotorista = linhaDoMotorista(viagem, hoje);
    const doAjudante = linhaDoAjudante(viagem, hoje);
    const motorista = valorDe({ driverId: viagem.driverId, helperId: null }, mes, viagem.id, doMotorista.total);
    const ajudante = doAjudante && viagem.helperId ? valorDe({ driverId: null, helperId: viagem.helperId }, mes, viagem.id, doAjudante.total) : 0;
    porViagem.set(viagem.id, { motorista, ajudante, total: centavos(motorista + ajudante), fora: doMotorista.fora, semKm: doMotorista.semKm });
  }
  return porViagem;
}
