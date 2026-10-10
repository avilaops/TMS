import { diaDoVencimento, diaNoBrasil, mesesDoPeriodo, valorRealizado } from "@/lib/financeiro";

/**
 * Relatórios básicos: operação, comercial e financeiro de um período em meses.
 *
 * `montarRelatorio` é pura: recebe as linhas já lidas do banco e a data de
 * referência. Quem lê o banco é a rota (`/api/relatorios`), com os limites que
 * `limitesDoPeriodo` devolve.
 *
 * O que cada bloco conta:
 * - **Cargas** e **frete por cliente**: as cargas criadas no período.
 * - **Entregas**, prazo e motoristas: as cargas entregues no período, pela data
 *   em que viraram "Entregue" no histórico. O prazo da tabela de frete corre
 *   da coleta ("Coletado") até a entrega; sem as duas datas ou sem prazo, a
 *   entrega fica como "sem medição" em vez de entrar na conta como no prazo.
 * - **Cotações**: os pedidos recebidos no período.
 * - **Realizado**: o que foi recebido e pago no período, pela data do pagamento
 *   e pelo valor que entrou de fato (com juros, multa e desconto da baixa).
 * - **Centro de custo**: as despesas pagas no período, pelo centro do lançamento.
 * - **Inadimplência**: a posição de hoje, não a do período — conta vencida há
 *   um ano continua vencida.
 */

const centavos = (valor: number) => Math.round((valor + Number.EPSILON) * 100) / 100;
const umaCasa = (valor: number) => Math.round(valor * 10) / 10;

/** Parte sobre o todo, em % com uma casa. Sem todo, `null`: não há do que tirar a taxa. */
const taxa = (parte: number, todo: number): number | null => (todo === 0 ? null : umaCasa((parte / todo) * 100));

const HORA = 3_600_000;

// Carga que não gerou transporte: fica na contagem por status, fora do frete.
const SEM_TRANSPORTE = ["CANCELLED", "REJECTED"];

export const SEM_CATEGORIA = "Sem categoria";
export const SEM_MOTORISTA = "Sem motorista";
export const SEM_CENTRO_DE_CUSTO = "Sem centro de custo";

/* ---------------------------------- Período ---------------------------------- */

const proximoMes = (mes: string) => {
  const [ano, numero] = mes.split("-").map(Number);
  return numero === 12 ? `${ano + 1}-01` : `${ano}-${String(numero + 1).padStart(2, "0")}`;
};

/**
 * Os instantes em que o período começa e acaba (fim exclusivo), no relógio do
 * Brasil. Período invertido, malformado ou com mais de 36 meses devolve `null`.
 */
export function limitesDoPeriodo(de: string, ate: string): { inicio: Date; fim: Date } | null {
  if (mesesDoPeriodo(de, ate).length === 0) return null;
  return { inicio: new Date(`${de}-01T00:00:00-03:00`), fim: new Date(`${proximoMes(ate)}-01T00:00:00-03:00`) };
}

/** Período padrão do relatório: o mês corrente e os dois anteriores. */
export function periodoDoRelatorio(hoje: Date = new Date()): { de: string; ate: string } {
  const [ano, mes] = diaNoBrasil(hoje).split("-").map(Number);
  const total = ano * 12 + (mes - 1) - 2;
  return {
    de: `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`,
    ate: `${ano}-${String(mes).padStart(2, "0")}`,
  };
}

const DIA = 86_400_000;

/**
 * A semana corrente no relógio do Brasil, de segunda a domingo: os instantes
 * em que começa e acaba (fim exclusivo) e os sete dias, como `AAAA-MM-DD`.
 */
export function semanaCorrente(hoje: Date = new Date()): { inicio: Date; fim: Date; dias: string[] } {
  // Meio-dia do dia de hoje no Brasil: somar dias inteiros a ele não muda de dia em fuso nenhum.
  const meioDia = new Date(`${diaNoBrasil(hoje)}T12:00:00-03:00`);
  const desdeSegunda = (meioDia.getUTCDay() + 6) % 7;
  const dias = Array.from({ length: 7 }, (_, i) => diaNoBrasil(new Date(meioDia.getTime() + (i - desdeSegunda) * DIA)));
  const inicio = new Date(`${dias[0]}T00:00:00-03:00`);
  return { inicio, fim: new Date(inicio.getTime() + 7 * DIA), dias };
}

/** Quantas entregas houve em cada dia da semana corrente, de segunda a domingo. */
export function entregasPorDia(entregues: readonly (Date | string)[], hoje: Date = new Date()): number[] {
  const { dias } = semanaCorrente(hoje);
  const contagem = dias.map(() => 0);
  for (const instante of entregues) {
    const posicao = dias.indexOf(diaNoBrasil(instante));
    if (posicao >= 0) contagem[posicao] += 1;
  }
  return contagem;
}

/* ---------------------------------- Entradas --------------------------------- */

type ClienteDaCarga = { id: string; companyName: string; tradeName: string | null };

/** Carga criada no período. */
export type CargaDoPeriodo = {
  status: string;
  weight: number;
  freightValue: number | null;
  client: ClienteDaCarga;
};

/** Carga entregue no período. `coletadaEm` é nulo quando o histórico não tem a coleta. */
export type EntregaDoPeriodo = {
  entregueEm: Date | string;
  coletadaEm: Date | string | null;
  freightDeadlineHours: number | null;
  motorista: { id: string; nome: string } | null;
};

export type CotacaoDoPeriodo = { status: string };

/** Lançamento pago ou recebido no período. */
export type LancamentoPago = {
  type: string;
  amount: number;
  category: string | null;
  /** O que entrou de fato, quando a baixa teve juros, multa ou desconto. */
  paidAmount?: number | null;
  costCenter?: string | null;
};

/** Título a receber ainda em aberto, de qualquer data. */
export type TituloAReceber = { amount: number; dueDate: Date | string | null };

export type DadosDoRelatorio = {
  cargas: readonly CargaDoPeriodo[];
  entregas: readonly EntregaDoPeriodo[];
  cotacoes: readonly CotacaoDoPeriodo[];
  pagos: readonly LancamentoPago[];
  aReceber: readonly TituloAReceber[];
};

/* ----------------------------------- Saída ----------------------------------- */

export type MedicaoDePrazo = {
  entregas: number;
  noPrazo: number;
  foraDoPrazo: number;
  /** Entregas sem prazo na carga ou sem as duas datas no histórico. */
  semMedicao: number;
  /** % das entregas medidas que chegaram no prazo; `null` sem entrega medida. */
  taxaNoPrazo: number | null;
  /** Horas da coleta à entrega, em média; `null` sem entrega com as duas datas. */
  tempoMedioHoras: number | null;
};

export type DesempenhoDoMotorista = MedicaoDePrazo & { chave: string; nome: string };

export type FreteDoCliente = {
  clientId: string;
  nome: string;
  cargas: number;
  peso: number;
  frete: number;
  /** Cargas ainda sem valor de frete (a cotar). */
  aCotar: number;
};

export type Relatorio = {
  operacional: {
    cargas: number;
    porStatus: Record<string, number>;
    prazo: MedicaoDePrazo;
    motoristas: DesempenhoDoMotorista[];
  };
  comercial: {
    cotacoes: number;
    porStatus: Record<string, number>;
    /** % das cotações do período que viraram coleta. */
    conversao: number | null;
    frete: number;
    clientes: FreteDoCliente[];
  };
  financeiro: {
    recebido: number;
    pago: number;
    resultado: number;
    despesasPorCategoria: { categoria: string; total: number }[];
    /** Despesas pagas no período, pelo centro de custo do lançamento. */
    despesasPorCentroDeCusto: { centro: string; total: number }[];
    aReceberEmAberto: number;
    vencido: number;
    /** % do que há a receber em aberto que já venceu. */
    inadimplencia: number | null;
  };
};

/* ----------------------------------- Contas ---------------------------------- */

const contarPor = <T,>(linhas: readonly T[], chave: (linha: T) => string): Record<string, number> => {
  const contagem: Record<string, number> = {};
  for (const linha of linhas) contagem[chave(linha)] = (contagem[chave(linha)] ?? 0) + 1;
  return contagem;
};

function medirPrazo(entregas: readonly EntregaDoPeriodo[]): MedicaoDePrazo {
  let noPrazo = 0;
  let foraDoPrazo = 0;
  let horas = 0;
  let comTempo = 0;

  for (const entrega of entregas) {
    if (!entrega.coletadaEm) continue;
    const duracao = (new Date(entrega.entregueEm).getTime() - new Date(entrega.coletadaEm).getTime()) / HORA;
    // Histórico fora de ordem (entrega antes da coleta) não mede nada.
    if (!(duracao >= 0)) continue;
    horas += duracao;
    comTempo += 1;
    if (entrega.freightDeadlineHours === null) continue;
    if (duracao <= entrega.freightDeadlineHours) noPrazo += 1;
    else foraDoPrazo += 1;
  }

  const medidas = noPrazo + foraDoPrazo;
  return {
    entregas: entregas.length,
    noPrazo,
    foraDoPrazo,
    semMedicao: entregas.length - medidas,
    taxaNoPrazo: taxa(noPrazo, medidas),
    tempoMedioHoras: comTempo === 0 ? null : umaCasa(horas / comTempo),
  };
}

/** A medição de prazo por motorista. Entrega sem motorista na carga fica na linha de chave vazia. */
export function desempenhoPorMotorista(entregas: readonly EntregaDoPeriodo[]): DesempenhoDoMotorista[] {
  const grupos = new Map<string, { nome: string; entregas: EntregaDoPeriodo[] }>();
  for (const entrega of entregas) {
    const chave = entrega.motorista?.id ?? "";
    const grupo = grupos.get(chave) ?? { nome: entrega.motorista?.nome ?? SEM_MOTORISTA, entregas: [] };
    grupo.entregas.push(entrega);
    grupos.set(chave, grupo);
  }
  return [...grupos.entries()]
    .map(([chave, grupo]) => ({ chave, nome: grupo.nome, ...medirPrazo(grupo.entregas) }))
    .sort((a, b) => b.entregas - a.entregas || a.nome.localeCompare(b.nome, "pt-BR"));
}

function fretePorCliente(cargas: readonly CargaDoPeriodo[]): FreteDoCliente[] {
  const clientes = new Map<string, FreteDoCliente>();
  for (const carga of cargas) {
    if (SEM_TRANSPORTE.includes(carga.status)) continue;
    const linha = clientes.get(carga.client.id) ?? {
      clientId: carga.client.id,
      nome: carga.client.tradeName || carga.client.companyName,
      cargas: 0,
      peso: 0,
      frete: 0,
      aCotar: 0,
    };
    linha.cargas += 1;
    linha.peso += carga.weight;
    if (carga.freightValue === null) linha.aCotar += 1;
    else linha.frete += carga.freightValue;
    clientes.set(carga.client.id, linha);
  }
  return [...clientes.values()]
    .map((linha) => ({ ...linha, peso: centavos(linha.peso), frete: centavos(linha.frete) }))
    .sort((a, b) => b.frete - a.frete || b.cargas - a.cargas || a.nome.localeCompare(b.nome, "pt-BR"));
}

export function montarRelatorio(dados: DadosDoRelatorio, hoje: Date = new Date()): Relatorio {
  const { cargas, entregas, cotacoes, pagos, aReceber } = dados;

  const clientes = fretePorCliente(cargas);
  const cotacoesPorStatus = contarPor(cotacoes, (cotacao) => cotacao.status);

  let recebido = 0;
  let pago = 0;
  const categorias = new Map<string, number>();
  const centros = new Map<string, number>();
  for (const lancamento of pagos) {
    const valor = valorRealizado(lancamento);
    if (lancamento.type === "INCOME") {
      recebido += valor;
      continue;
    }
    pago += valor;
    const categoria = lancamento.category?.trim() || SEM_CATEGORIA;
    categorias.set(categoria, (categorias.get(categoria) ?? 0) + valor);
    const centro = lancamento.costCenter?.trim() || SEM_CENTRO_DE_CUSTO;
    centros.set(centro, (centros.get(centro) ?? 0) + valor);
  }

  const diaDeHoje = diaNoBrasil(hoje);
  let aReceberEmAberto = 0;
  let vencido = 0;
  for (const titulo of aReceber) {
    aReceberEmAberto += titulo.amount;
    if (titulo.dueDate && diaDoVencimento(titulo.dueDate) < diaDeHoje) vencido += titulo.amount;
  }

  return {
    operacional: {
      cargas: cargas.length,
      porStatus: contarPor(cargas, (carga) => carga.status),
      prazo: medirPrazo(entregas),
      motoristas: desempenhoPorMotorista(entregas),
    },
    comercial: {
      cotacoes: cotacoes.length,
      porStatus: cotacoesPorStatus,
      conversao: taxa(cotacoesPorStatus.CONVERTED ?? 0, cotacoes.length),
      frete: centavos(clientes.reduce((soma, cliente) => soma + cliente.frete, 0)),
      clientes,
    },
    financeiro: {
      recebido: centavos(recebido),
      pago: centavos(pago),
      resultado: centavos(recebido - pago),
      despesasPorCategoria: [...categorias.entries()]
        .map(([categoria, total]) => ({ categoria, total: centavos(total) }))
        .sort((a, b) => b.total - a.total || a.categoria.localeCompare(b.categoria, "pt-BR")),
      despesasPorCentroDeCusto: [...centros.entries()]
        .map(([centro, total]) => ({ centro, total: centavos(total) }))
        .sort((a, b) => b.total - a.total || a.centro.localeCompare(b.centro, "pt-BR")),
      aReceberEmAberto: centavos(aReceberEmAberto),
      vencido: centavos(vencido),
      inadimplencia: taxa(vencido, aReceberEmAberto),
    },
  };
}
