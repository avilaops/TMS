/**
 * Ocupação do veículo numa viagem: a soma do peso e da cubagem das cargas
 * contra a capacidade cadastrada do veículo. Regras e contas comuns às rotas e
 * às telas; este arquivo não toca no banco.
 *
 * - **Peso**: `Collection.weight` (kg) contra `Vehicle.capacity` (kg).
 * - **Cubagem**: `Collection.cubicMeters` (m³) contra `Vehicle.cubicCapacity`
 *   (m³). Carga sem cubagem informada não soma, e a conta diz quantas são.
 * - Capacidade em branco ou zero é "não cadastrada": sem ela não há
 *   percentual nem aviso de excesso naquela medida.
 * - **Excesso** é passar de 100% em qualquer das duas medidas. É AVISO, não
 *   trava: excesso de peso é infração e risco, mas o cadastro pode estar
 *   desatualizado. A liberação da saída pede a confirmação explícita
 *   (`sairComExcesso`), que fica na auditoria.
 *
 * Arredondamento: o peso é comparado com uma casa (0,1 kg) e a cubagem com
 * três (0,001 m³), para a soma de frações não acusar excesso que não existe.
 * O percentual da tela é inteiro; acima da capacidade ele arredonda para cima,
 * para nunca aparecer "100%" ao lado de um aviso de excesso.
 */

const casas = (valor: number, n: number) => Math.round((valor + Number.EPSILON) * 10 ** n) / 10 ** n;

export type CargaDaOcupacao = { weight?: number | null; cubicMeters?: number | null };
export type VeiculoDaOcupacao = { capacity?: number | null; cubicCapacity?: number | null };

export type Medida = {
  total: number;
  /** `null` = capacidade não cadastrada. */
  capacidade: number | null;
  /** Percentual inteiro da capacidade; `null` sem capacidade. */
  percentual: number | null;
  excesso: boolean;
  /** Quanto passou da capacidade; zero sem excesso. */
  acima: number;
  /** Cargas sem a medida informada: ficaram fora da soma. */
  semMedida: number;
};

export type Ocupacao = {
  peso: Medida;
  cubagem: Medida;
  /** Passou de 100% no peso ou na cubagem. */
  excesso: boolean;
  /** O veículo não tem nenhuma das duas capacidades cadastradas. */
  semCapacidade: boolean;
};

const positivo = (valor: number | null | undefined): number | null => (typeof valor === "number" && Number.isFinite(valor) && valor > 0 ? valor : null);

function medir(valores: readonly (number | null | undefined)[], capacidade: number | null | undefined, n: number): Medida {
  let soma = 0;
  let semMedida = 0;
  for (const valor of valores) {
    const medido = positivo(valor);
    if (medido === null) semMedida += 1;
    else soma += medido;
  }
  const total = casas(soma, n);
  const cabe = positivo(capacidade);
  if (cabe === null) return { total, capacidade: null, percentual: null, excesso: false, acima: 0, semMedida };

  const limite = casas(cabe, n);
  const excesso = total > limite;
  // Multiplica antes de dividir e corta o ruído do ponto flutuante: 22 de 20 é 110%, não 110,00000000000001%.
  const razao = casas((total * 100) / limite, 6);
  return {
    total,
    capacidade: limite,
    percentual: excesso ? Math.ceil(razao) : Math.round(razao),
    excesso,
    acima: excesso ? casas(total - limite, n) : 0,
    semMedida,
  };
}

/** A ocupação do veículo com as cargas dadas. */
export function ocupacaoDaViagem(cargas: readonly CargaDaOcupacao[], veiculo: VeiculoDaOcupacao | null | undefined): Ocupacao {
  const peso = medir(cargas.map((carga) => carga.weight), veiculo?.capacity, 1);
  const cubagem = medir(cargas.map((carga) => carga.cubicMeters), veiculo?.cubicCapacity, 3);
  return { peso, cubagem, excesso: peso.excesso || cubagem.excesso, semCapacidade: peso.capacidade === null && cubagem.capacidade === null };
}

export type OcupacaoDoRoteiro = {
  inicial: Ocupacao;
  /** Saldo após a descarga completa; cargas já entregues não têm projeção. */
  aposEntrega: Record<string, Ocupacao>;
};

/** Projeção somente de entregas: não inventa coletas intermediárias ou medidas. */
export function ocupacaoDoRoteiro(
  cargas: readonly (CargaDaOcupacao & { id: string; status: string })[],
  ordem: readonly string[],
  veiculo: VeiculoDaOcupacao | null | undefined,
): OcupacaoDoRoteiro {
  const pendentes = new Map(cargas.filter(carga => carga.status !== "DELIVERED").map(carga => [carga.id, carga]));
  const inicial = ocupacaoDaViagem([...pendentes.values()], veiculo);
  const aposEntrega: Record<string, Ocupacao> = {};
  for (const id of ordem) {
    if (!pendentes.delete(id)) continue;
    // Recalcular com os valores originais evita subtrair totais arredondados.
    aposEntrega[id] = ocupacaoDaViagem([...pendentes.values()], veiculo);
  }
  return { inicial, aposEntrega };
}

const numero = (valor: number, maximo = 1) => valor.toLocaleString("pt-BR", { maximumFractionDigits: maximo });

function textoDaMedida(rotulo: string, unidade: string, medida: Medida): string | null {
  if (medida.capacidade === null) return null;
  return `${rotulo} ${numero(medida.total)} de ${numero(medida.capacidade)} ${unidade} (${medida.percentual}%)`;
}

export const SEM_CAPACIDADE = "capacidade não cadastrada";

/**
 * A linha da ocupação, como o cartão da viagem mostra:
 * "Peso 1.250 de 3.000 kg (42%) · Cubagem 8,2 de 20 m³ (41%)". A medida sem
 * capacidade cadastrada fica de fora; sem nenhuma, "capacidade não cadastrada".
 */
export function linhaDaOcupacao(ocupacao: Ocupacao): string {
  const partes = [textoDaMedida("Peso", "kg", ocupacao.peso), textoDaMedida("Cubagem", "m³", ocupacao.cubagem)].filter((parte): parte is string => parte !== null);
  return partes.length > 0 ? partes.join(" · ") : SEM_CAPACIDADE;
}

/** A capacidade do veículo ao lado da placa, na lista do formulário: "3.000 kg · 20 m³". Vazio sem nenhuma. */
export function capacidadeDoVeiculo(veiculo: VeiculoDaOcupacao): string {
  const partes = [positivo(veiculo.capacity) === null ? null : `${numero(veiculo.capacity as number)} kg`, positivo(veiculo.cubicCapacity) === null ? null : `${numero(veiculo.cubicCapacity as number)} m³`];
  return partes.filter((parte): parte is string => parte !== null).join(" · ");
}

/**
 * O aviso de excesso, com os números: "Excesso de peso: 3.600 de 3.000 kg
 * (120%), 600 kg acima." `null` quando a carga cabe (ou não há capacidade
 * cadastrada para conferir).
 */
export function avisoDeExcesso(ocupacao: Ocupacao): string | null {
  const frases: string[] = [];
  const { peso, cubagem } = ocupacao;
  if (peso.excesso) frases.push(`Excesso de peso: ${numero(peso.total)} de ${numero(peso.capacidade as number)} kg (${peso.percentual}%), ${numero(peso.acima)} kg acima.`);
  if (cubagem.excesso) frases.push(`Excesso de cubagem: ${numero(cubagem.total, 3)} de ${numero(cubagem.capacidade as number, 3)} m³ (${cubagem.percentual}%), ${numero(cubagem.acima, 3)} m³ acima.`);
  return frases.length > 0 ? frases.join(" ") : null;
}

/** O campo que o corpo da liberação manda como `true` para sair mesmo com excesso. */
export const CONFIRMACAO_DE_EXCESSO = "sairComExcesso";

/** A recusa (409) da liberação da saída com excesso e sem a confirmação. */
export const confirmarSaidaComExcesso = (ocupacao: Ocupacao) => `${avisoDeExcesso(ocupacao) ?? ""} Excesso de peso é infração de trânsito e risco na estrada. Confira o cadastro do veículo ou confirme para sair com excesso de peso.`.trim();

/** O que as rotas leem do veículo e das cargas para a conta. */
export const VEICULO_DA_OCUPACAO_SELECT = { capacity: true, cubicCapacity: true } as const;
export const CARGA_DA_OCUPACAO_SELECT = { weight: true, cubicMeters: true } as const;
