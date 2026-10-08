import { normalizeText } from "@/lib/normalization";

/**
 * Cálculo de frete a partir de uma tabela (FreightTable + FreightTableCity).
 *
 * É uma função pura: recebe a tabela já carregada e devolve o valor com a
 * composição, sem tocar no banco. A cotação pública, o simulador do painel e,
 * mais adiante, o frete da coleta usam esta mesma conta.
 *
 * O que foge da regra da tabela (volumes demais, nota acima do limite sem
 * percentual combinado, cidade só com veículo dedicado) não impede o cálculo:
 * sai como aviso, para o comercial decidir.
 */

export type RegrasDaTabela = {
  includedWeightKg: number;
  excessPerKg: number;
  cubageFactor: number | null;
  invoiceLimit: number | null;
  adValoremPct: number | null;
  maxVolumes: number | null;
};

export type CidadeDaTabela = {
  city: string;
  cityKey: string;
  minimum: number;
  deadlineHours: number;
  dedicated: boolean;
};

export type TabelaDeFrete = RegrasDaTabela & { id: string; name: string; cities: CidadeDaTabela[] };

export type Carga = {
  /** Peso real, em kg. */
  peso: number;
  volumes?: number | null;
  /** Valor da nota (mercadoria), em R$. */
  valorNota?: number | null;
  /** Volume total da carga, em m³, para a cubagem. */
  metrosCubicos?: number | null;
};

export type Frete =
  | { atendida: false }
  | {
      atendida: true;
      cidade: string;
      valor: number;
      prazoHoras: number;
      pesoTaxavel: number;
      composicao: { rotulo: string; valor: number }[];
      avisos: string[];
    };

const centavos = (valor: number) => Math.round((valor + Number.EPSILON) * 100) / 100;

/**
 * Chave de comparação do nome da cidade: sem acento, sem caixa e sem o que
 * varia de uma planilha para outra (apóstrofo reto, curvo ou acento agudo
 * solto em "d'Oeste", hífen, UF no fim, espaço dobrado).
 */
export function chaveDaCidade(nome: string): string {
  return normalizeText(nome)
    .replace(/\s*[/(-]\s*[a-z]{2}\)?$/u, "") // "Mirassol/SP", "Mirassol - SP", "Mirassol (SP)"
    .replace(/['’`´]/gu, "")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}

export function calcularFrete(tabela: TabelaDeFrete, cidade: string, carga: Carga): Frete {
  const chave = chaveDaCidade(cidade);
  const linha = chave ? tabela.cities.find((c) => c.cityKey === chave) : undefined;
  if (!linha) return { atendida: false };

  const avisos: string[] = [];
  const composicao: { rotulo: string; valor: number }[] = [
    { rotulo: `Frete mínimo para ${linha.city}`, valor: centavos(linha.minimum) },
  ];

  const pesoReal = Math.max(0, carga.peso);
  const pesoCubado =
    tabela.cubageFactor && carga.metrosCubicos && carga.metrosCubicos > 0
      ? carga.metrosCubicos * tabela.cubageFactor
      : 0;
  const pesoTaxavel = Math.max(pesoReal, pesoCubado);

  const excedente = Math.max(0, pesoTaxavel - tabela.includedWeightKg);
  if (excedente > 0 && tabela.excessPerKg > 0) {
    composicao.push({
      rotulo: `${formatarKg(excedente)} acima de ${formatarKg(tabela.includedWeightKg)}${pesoCubado > pesoReal ? " (peso cubado)" : ""}`,
      valor: centavos(excedente * tabela.excessPerKg),
    });
  }

  const nota = carga.valorNota ?? 0;
  if (tabela.invoiceLimit !== null && nota > tabela.invoiceLimit) {
    if (tabela.adValoremPct !== null) {
      composicao.push({
        rotulo: `${formatarPct(tabela.adValoremPct)} sobre o valor da nota acima de ${formatarReais(tabela.invoiceLimit)}`,
        valor: centavos(((nota - tabela.invoiceLimit) * tabela.adValoremPct) / 100),
      });
    } else {
      avisos.push(`Nota acima de ${formatarReais(tabela.invoiceLimit)}: consultar o comercial para o valor final.`);
    }
  }

  if (tabela.maxVolumes !== null && carga.volumes && carga.volumes > tabela.maxVolumes) {
    avisos.push(`A tabela cobre até ${tabela.maxVolumes} volumes; esta carga tem ${carga.volumes}.`);
  }

  if (linha.dedicated) {
    avisos.push(`${linha.city} é atendida só com veículo dedicado.`);
  }

  return {
    atendida: true,
    cidade: linha.city,
    valor: centavos(composicao.reduce((soma, item) => soma + item.valor, 0)),
    prazoHoras: linha.deadlineHours,
    pesoTaxavel: centavos(pesoTaxavel),
    composicao,
    avisos,
  };
}

const formatarKg = (kg: number) => `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(kg)} kg`;
const formatarPct = (pct: number) => `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(pct)}%`;
const formatarReais = (valor: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(valor);

/** Campos que a conta precisa, para o `select` de quem carrega a tabela. */
export const TABELA_PARA_CALCULO = {
  id: true,
  name: true,
  includedWeightKg: true,
  excessPerKg: true,
  cubageFactor: true,
  invoiceLimit: true,
  adValoremPct: true,
  maxVolumes: true,
  cities: { select: { city: true, cityKey: true, minimum: true, deadlineHours: true, dedicated: true } },
} as const;

type Buscador = {
  client: { findUnique(args: { where: { id: string }; select: { freightTableId: true } }): PromiseLike<{ freightTableId: string | null } | null> };
  freightTable: {
    findFirst(args: {
      where: Record<string, unknown>;
      select: typeof TABELA_PARA_CALCULO;
      orderBy?: Record<string, "asc" | "desc">;
    }): PromiseLike<TabelaDeFrete | null>;
  };
};

/**
 * A tabela que vale para um cliente hoje: a negociada com ele, se estiver
 * ativa e dentro da validade; senão a padrão da transportadora; senão nenhuma.
 * `db` é o cliente do banco da empresa (sessão ou `paraEmpresa`).
 */
export async function tabelaVigente(db: unknown, clientId?: string | null, hoje = new Date()): Promise<TabelaDeFrete | null> {
  const banco = db as Buscador;
  const vigente = {
    active: true,
    AND: [
      { OR: [{ validFrom: null }, { validFrom: { lte: hoje } }] },
      { OR: [{ validTo: null }, { validTo: { gte: hoje } }] },
    ],
  };

  if (clientId) {
    const cliente = await banco.client.findUnique({ where: { id: clientId }, select: { freightTableId: true } });
    if (cliente?.freightTableId) {
      const negociada = await banco.freightTable.findFirst({
        where: { id: cliente.freightTableId, ...vigente },
        select: TABELA_PARA_CALCULO,
      });
      if (negociada) return negociada;
    }
  }

  return banco.freightTable.findFirst({
    where: { isDefault: true, ...vigente },
    select: TABELA_PARA_CALCULO,
    orderBy: { updatedAt: "desc" },
  });
}
