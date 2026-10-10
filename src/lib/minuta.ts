import { enderecoCompleto, enderecoEmLinha } from "@/lib/endereco";
import type { Identidade } from "@/lib/empresa";
import { cteRegistrado } from "@/lib/nfe";
import { pode } from "@/lib/permissoes";
import { codigoDaViagem } from "@/lib/viagem";

/**
 * Minuta de despacho: o papel que acompanha a carga, montado só com o que o
 * sistema já guarda dela. Não é documento fiscal e não pode parecer um: o
 * rodapé diz isso com todas as letras (`AVISO_SEM_VALOR_FISCAL`).
 *
 * Tudo aqui é função pura e também é importado pela tela: nada daqui pode
 * puxar o que só existe no servidor. Quem lê a carga é a rota
 * (`GET /api/coletas/[id]/minuta`), com `MINUTA_SELECT`.
 *
 * Regra geral: campo que a carga não tem sai `null` (ou a seção inteira sai
 * `null`) e a folha deixa em branco ou não mostra. Nada é inventado.
 */

export const TITULO_DA_MINUTA = "MINUTA DE DESPACHO";
export const AVISO_SEM_VALOR_FISCAL = "Documento sem valor fiscal. Não substitui o CT-e.";
export const MINUTA_NAO_ENCONTRADA = "Carga não encontrada.";

/**
 * Quem vê o frete (valor, composição e condição de pagamento) na minuta: os
 * mesmos perfis que o veem na lista de minutas. Hoje a lista (`GET /api/coletas`)
 * entrega o frete a todo perfil que lê cargas, então a regra é a capacidade
 * `coletasVer`. Se a lista passar a esconder o frete de algum perfil, a regra
 * muda aqui, e `tests/minuta.test.ts` cobra que as duas continuem iguais.
 */
export const verFreteNaMinuta = (perfil: string | null | undefined): boolean => pode(perfil, "coletasVer");

/** O que a rota lê da carga para montar a minuta. Sem XML, sem foto, sem comissão do motorista. */
export const MINUTA_SELECT = {
  id: true,
  trackingCode: true,
  sender: true,
  receiver: true,
  origin: true,
  destination: true,
  volumes: true,
  weight: true,
  cubicMeters: true,
  invoiceKey: true,
  invoiceValue: true,
  freightValue: true,
  freightManual: true,
  freightDetails: true,
  pickupNotes: true,
  deliveryStreet: true,
  deliveryNumber: true,
  deliveryDistrict: true,
  deliveryZip: true,
  cteKey: true,
  cteNumber: true,
  cteStatus: true,
  client: { select: { companyName: true, tradeName: true, cnpj: true, address: true, paymentCondition: true } },
  driver: { select: { user: { select: { name: true } } } },
  manifest: {
    select: {
      id: true,
      driver: { select: { user: { select: { name: true } } } },
      vehicle: { select: { plate: true, model: true } },
    },
  },
  fiscalDocuments: {
    select: {
      number: true,
      series: true,
      accessKey: true,
      issuerName: true,
      issuerTaxId: true,
      issuerAddress: true,
      recipientName: true,
      recipientTaxId: true,
      recipientAddress: true,
    },
    orderBy: { number: "asc" },
  },
} as const;

type NomeDoMotorista = { user: { name: string } };

export type NotaDaCarga = {
  number: number;
  series: number;
  accessKey: string;
  issuerName: string;
  issuerTaxId: string;
  issuerAddress: string | null;
  recipientName: string | null;
  recipientTaxId: string | null;
  recipientAddress: string | null;
};

/** A carga como `MINUTA_SELECT` a devolve. */
export type CargaDaMinuta = {
  id: string;
  trackingCode: string | null;
  sender: string;
  receiver: string;
  origin: string;
  destination: string;
  volumes: number;
  weight: number;
  cubicMeters: number | null;
  invoiceKey: string | null;
  invoiceValue: number | null;
  freightValue: number | null;
  freightManual: boolean;
  freightDetails: unknown;
  pickupNotes: string | null;
  deliveryStreet: string | null;
  deliveryNumber: string | null;
  deliveryDistrict: string | null;
  deliveryZip: string | null;
  cteKey: string | null;
  cteNumber: number | null;
  cteStatus: string | null;
  client: { companyName: string; tradeName: string | null; cnpj: string; address: string | null; paymentCondition: string | null };
  driver: NomeDoMotorista | null;
  manifest: { id: string; driver: NomeDoMotorista; vehicle: { plate: string; model: string } } | null;
  fiscalDocuments: NotaDaCarga[];
};

/** Uma das partes da minuta. `documento` são só os dígitos do CNPJ ou CPF. */
export type ParteDaMinuta = { nome: string; documento: string | null; endereco: string | null };

export type ParcelaDoFrete = { rotulo: string; valor: number };

export type FreteDaMinuta = {
  /** Nulo = frete a cotar. */
  valor: number | null;
  /** Informado à mão: não tem composição. */
  manual: boolean;
  /** Nome da tabela que deu o valor, quando veio de uma. */
  tabela: string | null;
  composicao: ParcelaDoFrete[];
  condicaoDePagamento: string | null;
};

/** A minuta pronta para a folha: é o corpo de `GET /api/coletas/[id]/minuta`. */
export type Minuta = {
  empresa: Identidade;
  /** Código de rastreio da carga: é o número da minuta e o que o código de barras leva. */
  codigo: string | null;
  /** Instante da emissão (ISO): quando a folha foi pedida. */
  emitidaEm: string;
  pagador: ParteDaMinuta;
  remetente: ParteDaMinuta & { cidade: string };
  destinatario: ParteDaMinuta & { cidade: string };
  carga: { volumes: number; peso: number; cubagem: number | null; valorDaMercadoria: number | null };
  /** NF-e da carga: as notas importadas ligadas a ela, ou só a chave digitada na minuta (sem número). */
  notas: { numero: string | null; chave: string }[];
  /** Nulo = o perfil não vê frete (`verFreteNaMinuta`). */
  frete: FreteDaMinuta | null;
  /** Nulo = carga fora de viagem. */
  viagem: { codigo: string; placa: string; veiculo: string } | null;
  /** O motorista da viagem; fora de viagem, o que foi alocado na carga. */
  motorista: string | null;
  /** Só CT-e com valor fiscal: o registrado à mão ou o autorizado em produção. */
  cte: { numero: number | null; chave: string } | null;
  observacoes: string | null;
};

const textoOuNulo = (valor: string | null | undefined): string | null => {
  const texto = (valor ?? "").trim();
  return texto === "" ? null : texto;
};

const mesmoNome = (a: string | null | undefined, b: string) => (a ?? "").trim().toLowerCase() === b.trim().toLowerCase();

/**
 * A composição que a tabela de frete gravou na carga (`freightDetails`,
 * src/lib/frete-coleta.ts). O campo é JSON livre no banco: o que não tiver o
 * formato esperado é ignorado, em vez de quebrar a folha.
 */
export function composicaoDoFrete(detalhes: unknown): { tabela: string | null; composicao: ParcelaDoFrete[] } {
  if (typeof detalhes !== "object" || detalhes === null) return { tabela: null, composicao: [] };
  const { tabela, composicao } = detalhes as { tabela?: unknown; composicao?: unknown };
  const parcelas = Array.isArray(composicao) ? composicao : [];
  return {
    tabela: typeof tabela === "string" ? textoOuNulo(tabela) : null,
    composicao: parcelas.flatMap((parcela: unknown): ParcelaDoFrete[] => {
      if (typeof parcela !== "object" || parcela === null) return [];
      const { rotulo, valor } = parcela as { rotulo?: unknown; valor?: unknown };
      return typeof rotulo === "string" && typeof valor === "number" && Number.isFinite(valor) ? [{ rotulo, valor }] : [];
    }),
  };
}

/**
 * As NF-e da carga. As notas importadas trazem número e série; sem nota
 * importada, vale a chave digitada na minuta, que não tem número guardado.
 */
export function notasDaMinuta(carga: Pick<CargaDaMinuta, "invoiceKey" | "fiscalDocuments">): Minuta["notas"] {
  const notas: Minuta["notas"] = carga.fiscalDocuments.map((nota) => ({ numero: `${nota.number}/${nota.series}`, chave: nota.accessKey }));
  const digitada = textoOuNulo(carga.invoiceKey);
  if (digitada && !notas.some((nota) => nota.chave === digitada)) notas.push({ numero: null, chave: digitada });
  return notas;
}

/**
 * Monta a minuta da carga.
 *
 * - O pagador é o cliente da carga, com o CNPJ e o endereço do cadastro.
 * - Remetente e destinatário são texto livre na carga: o documento e o
 *   endereço deles só existem quando há NF-e importada ligada à carga, e só
 *   valem se o nome na nota for o mesmo da carga (nota ligada a uma carga que
 *   já existia pode ser de outro emitente).
 * - O endereço do destinatário é o da entrega; sem ele, o da nota.
 * - `verFrete` desligado tira o frete inteiro, com a condição de pagamento.
 */
export function montarMinuta(carga: CargaDaMinuta, empresa: Identidade, opcoes: { verFrete: boolean; agora: Date }): Minuta {
  const notaDoRemetente = carga.fiscalDocuments.find((nota) => mesmoNome(nota.issuerName, carga.sender));
  const notaDoDestinatario = carga.fiscalDocuments.find((nota) => mesmoNome(nota.recipientName, carga.receiver));
  const { tabela, composicao } = composicaoDoFrete(carga.freightDetails);
  const motorista = carga.manifest?.driver ?? carga.driver;

  return {
    empresa: { name: empresa.name, logo: empresa.logo },
    codigo: textoOuNulo(carga.trackingCode),
    emitidaEm: opcoes.agora.toISOString(),
    pagador: {
      nome: carga.client.companyName,
      documento: textoOuNulo(carga.client.cnpj),
      endereco: textoOuNulo(carga.client.address),
    },
    remetente: {
      nome: carga.sender,
      documento: textoOuNulo(notaDoRemetente?.issuerTaxId),
      endereco: textoOuNulo(notaDoRemetente?.issuerAddress),
      cidade: carga.origin,
    },
    destinatario: {
      nome: carga.receiver,
      documento: textoOuNulo(notaDoDestinatario?.recipientTaxId),
      endereco: enderecoEmLinha(carga) ? enderecoCompleto(carga, carga.destination) : textoOuNulo(notaDoDestinatario?.recipientAddress),
      cidade: carga.destination,
    },
    carga: { volumes: carga.volumes, peso: carga.weight, cubagem: carga.cubicMeters, valorDaMercadoria: carga.invoiceValue },
    notas: notasDaMinuta(carga),
    frete: opcoes.verFrete
      ? {
          valor: carga.freightValue,
          manual: carga.freightManual,
          // Valor informado à mão não tem composição: a que ficou gravada seria de outra conta.
          tabela: carga.freightManual || carga.freightValue === null ? null : tabela,
          composicao: carga.freightManual || carga.freightValue === null ? [] : composicao,
          condicaoDePagamento: textoOuNulo(carga.client.paymentCondition),
        }
      : null,
    viagem: carga.manifest
      ? { codigo: codigoDaViagem(carga.manifest.id), placa: carga.manifest.vehicle.plate, veiculo: carga.manifest.vehicle.model }
      : null,
    motorista: textoOuNulo(motorista?.user.name),
    cte: carga.cteKey !== null && cteRegistrado(carga) ? { numero: carga.cteNumber, chave: carga.cteKey } : null,
    observacoes: textoOuNulo(carga.pickupNotes),
  };
}

/** "10/10/2026, 14:32": a emissão no relógio do Brasil, onde quer que o navegador esteja. */
export function dataDeEmissao(instante: string | Date): string {
  const data = new Date(instante);
  return Number.isNaN(data.getTime()) ? "" : data.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
}

/** Chave de 44 dígitos em blocos de quatro, como vai impressa: cabe na linha e dá para conferir no olho. */
export function chaveEmBlocos(chave: string): string {
  return chave.replace(/(.{4})(?=.)/g, "$1 ");
}
