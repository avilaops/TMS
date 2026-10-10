import { centavos } from "@/lib/faturas";
import { diaDoVencimento, diaNoBrasil } from "@/lib/financeiro";

/**
 * Cobrança: a posição do que há a receber, por devedor e por faixa de atraso,
 * e o texto do aviso que o operador copia e manda.
 *
 * Tudo aqui é conta pura: recebe os títulos em aberto e a data de referência,
 * sem tocar no banco. Este arquivo também é importado pela tela, então não
 * pode puxar nada que só exista no servidor.
 *
 * O sistema não emite boleto nem tem chave de pagamento: o aviso lista o que
 * está em aberto e não inventa dado de pagamento.
 */

export const FAIXAS = ["a_vencer", "ate_30", "de_31_a_60", "de_61_a_90", "acima_de_90"] as const;
export type Faixa = (typeof FAIXAS)[number];

export const FAIXA_LABEL: Record<Faixa, string> = {
  a_vencer: "A vencer",
  ate_30: "1 a 30 dias",
  de_31_a_60: "31 a 60 dias",
  de_61_a_90: "61 a 90 dias",
  acima_de_90: "Mais de 90 dias",
};

export const SEM_CLIENTE = "Sem cliente informado";

/** Lançamento a receber em aberto, como as rotas o leem do banco. */
export type TituloEmAberto = {
  id: string;
  description: string;
  amount: number;
  dueDate: Date | string | null;
  clientId: string | null;
  counterparty: string | null;
  client: {
    id: string;
    companyName: string;
    tradeName: string | null;
    contactName: string | null;
    email: string | null;
    phone: string | null;
  } | null;
  invoice: { id: string; number: number } | null;
};

export type TituloDaCobranca = {
  id: string;
  description: string;
  amount: number;
  dueDate: Date | string | null;
  diasDeAtraso: number;
  faixa: Faixa;
  invoice: { id: string; number: number } | null;
};

export type Devedor = {
  /** Identifica o grupo na lista: o cliente, o pagador digitado ou "sem cliente". */
  chave: string;
  clientId: string | null;
  nome: string;
  contato: { nome: string | null; email: string | null; telefone: string | null };
  total: number;
  vencido: number;
  /** Dias de atraso do título mais antigo; 0 quando nada venceu. */
  maiorAtraso: number;
  porFaixa: Record<Faixa, number>;
  titulos: TituloDaCobranca[];
};

export type TotaisDaCobranca = {
  emAberto: number;
  vencido: number;
  aVencer: number;
  porFaixa: Record<Faixa, number>;
  devedoresEmAtraso: number;
};

export type PosicaoDeCobranca = { totais: TotaisDaCobranca; devedores: Devedor[] };

/** O que as rotas leem de cada título para montar a posição. */
export const TITULO_SELECT = {
  id: true,
  description: true,
  amount: true,
  dueDate: true,
  clientId: true,
  counterparty: true,
  client: { select: { id: true, companyName: true, tradeName: true, contactName: true, email: true, phone: true } },
  invoice: { select: { id: true, number: true } },
} as const;

const DIA_EM_MS = 1000 * 60 * 60 * 24;

/**
 * Dias inteiros de atraso: do dia do vencimento (lido em UTC) ao dia de hoje no
 * Brasil. Sem vencimento, ou vencendo hoje ou depois, é zero: maior que zero
 * exatamente quando `situacaoDoLancamento` diz "vencido".
 */
export function diasDeAtraso(dueDate: Date | string | null | undefined, hoje: Date = new Date()): number {
  if (!dueDate) return 0;
  const vencimento = diaDoVencimento(dueDate);
  const dia = diaNoBrasil(hoje);
  if (vencimento >= dia) return 0;
  // Os dois são dias de calendário (`AAAA-MM-DD`): a diferença é feita em UTC, sem hora no meio.
  return Math.round((Date.parse(dia) - Date.parse(vencimento)) / DIA_EM_MS);
}

/** Multa e juros sugeridos enquanto a empresa não informa os seus: 2% e 1% ao mês. */
export const MULTA_PADRAO_PCT = 2;
export const JUROS_PADRAO_PCT = 1;

export type ParametrosDeCobranca = {
  /** Multa por atraso, em % do valor, cobrada uma vez. */
  multaPct: number;
  /** Juros de mora, em % ao mês, proporcionais aos dias de atraso. */
  jurosPct: number;
};

/**
 * Multa e juros sugeridos na baixa de um título vencido. A multa é o
 * percentual sobre o valor, uma vez; os juros são simples e pro rata: o
 * percentual do mês dividido por 30, vezes os dias de atraso. Título em dia
 * (zero dias) não tem encargo. É só sugestão: o operador altera ou zera.
 */
export function encargosSugeridos(valor: number, dias: number, parametros: ParametrosDeCobranca): { multa: number; juros: number } {
  if (!(dias > 0) || !(valor > 0)) return { multa: 0, juros: 0 };
  return {
    multa: centavos((valor * parametros.multaPct) / 100),
    juros: centavos((valor * parametros.jurosPct * dias) / (100 * 30)),
  };
}

export function faixaDoAtraso(dias: number): Faixa {
  if (dias <= 0) return "a_vencer";
  if (dias <= 30) return "ate_30";
  if (dias <= 60) return "de_31_a_60";
  if (dias <= 90) return "de_61_a_90";
  return "acima_de_90";
}

// As somas andam em centavos inteiros: três títulos de 0,10 dão 0,30, e a soma
// das faixas fecha com o total sem sobra de ponto flutuante.
const emCentavos = (valor: number) => Math.round(centavos(valor) * 100);
const emReais = (valorEmCentavos: number) => valorEmCentavos / 100;

const faixasZeradas = (): Record<Faixa, number> => ({ a_vencer: 0, ate_30: 0, de_31_a_60: 0, de_61_a_90: 0, acima_de_90: 0 });

function grupoDoTitulo(titulo: TituloEmAberto): Pick<Devedor, "chave" | "clientId" | "nome" | "contato"> {
  if (titulo.clientId) {
    const cliente = titulo.client;
    return {
      chave: `cliente:${titulo.clientId}`,
      clientId: titulo.clientId,
      nome: cliente?.tradeName || cliente?.companyName || titulo.counterparty?.trim() || SEM_CLIENTE,
      contato: { nome: cliente?.contactName || null, email: cliente?.email || null, telefone: cliente?.phone || null },
    };
  }

  const semContato = { nome: null, email: null, telefone: null };
  const pagador = titulo.counterparty?.trim();
  if (pagador) {
    return { chave: `pagador:${pagador.toLocaleLowerCase("pt-BR")}`, clientId: null, nome: pagador, contato: semContato };
  }
  return { chave: "sem-cliente", clientId: null, nome: SEM_CLIENTE, contato: semContato };
}

// Vencimento crescente; sem vencimento por último.
function porVencimento(a: TituloDaCobranca, b: TituloDaCobranca): number {
  if (!a.dueDate || !b.dueDate) return a.dueDate ? -1 : b.dueDate ? 1 : a.description.localeCompare(b.description, "pt-BR");
  return diaDoVencimento(a.dueDate).localeCompare(diaDoVencimento(b.dueDate)) || a.description.localeCompare(b.description, "pt-BR");
}

/** Quem deve, quanto e há quanto tempo. `titulos` são os lançamentos a receber em aberto. */
export function posicaoDeCobranca(titulos: readonly TituloEmAberto[], hoje: Date = new Date()): PosicaoDeCobranca {
  const grupos = new Map<string, Devedor>();
  const geral = faixasZeradas();

  for (const titulo of titulos) {
    const grupo = grupoDoTitulo(titulo);
    let devedor = grupos.get(grupo.chave);
    if (!devedor) {
      devedor = { ...grupo, total: 0, vencido: 0, maiorAtraso: 0, porFaixa: faixasZeradas(), titulos: [] };
      grupos.set(grupo.chave, devedor);
    }

    const dias = diasDeAtraso(titulo.dueDate, hoje);
    const faixa = faixaDoAtraso(dias);
    const valor = emCentavos(titulo.amount);

    devedor.titulos.push({
      id: titulo.id,
      description: titulo.description,
      amount: emReais(valor),
      dueDate: titulo.dueDate,
      diasDeAtraso: dias,
      faixa,
      invoice: titulo.invoice ? { id: titulo.invoice.id, number: titulo.invoice.number } : null,
    });
    // Até o fim do laço, `total`, `vencido` e as faixas estão em centavos.
    devedor.total += valor;
    if (dias > 0) devedor.vencido += valor;
    devedor.porFaixa[faixa] += valor;
    devedor.maiorAtraso = Math.max(devedor.maiorAtraso, dias);
    geral[faixa] += valor;
  }

  const devedores = [...grupos.values()].map((devedor) => {
    for (const faixa of FAIXAS) devedor.porFaixa[faixa] = emReais(devedor.porFaixa[faixa]);
    devedor.total = emReais(devedor.total);
    devedor.vencido = emReais(devedor.vencido);
    devedor.titulos.sort(porVencimento);
    return devedor;
  });
  devedores.sort((a, b) => b.vencido - a.vencido || b.total - a.total || a.nome.localeCompare(b.nome, "pt-BR"));

  const vencido = geral.ate_30 + geral.de_31_a_60 + geral.de_61_a_90 + geral.acima_de_90;
  const porFaixa = faixasZeradas();
  for (const faixa of FAIXAS) porFaixa[faixa] = emReais(geral[faixa]);

  return {
    totais: {
      emAberto: emReais(vencido + geral.a_vencer),
      vencido: emReais(vencido),
      aVencer: emReais(geral.a_vencer),
      porFaixa,
      devedoresEmAtraso: devedores.filter((d) => d.vencido > 0).length,
    },
    devedores,
  };
}

/** `AAAA-MM-DD` como `DD/MM/AAAA`, sem passar por fuso nenhum. */
export function dataPorExtenso(dia: string): string {
  const [ano, mes, diaDoMes] = dia.slice(0, 10).split("-");
  return `${diaDoMes}/${mes}/${ano}`;
}

const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

// O `Intl` separa "R$" do número com espaço que não quebra; no texto que vai
// para e-mail ou WhatsApp entra o espaço comum.
const reais = (valor: number) => moeda.format(valor).replace(/\s/g, " ");

/**
 * Aviso de cobrança de um devedor, em texto puro, para o operador copiar. Com
 * algum título vencido fala em atraso; só com títulos a vencer, é um lembrete.
 * Devedor sem título em aberto não tem aviso: devolve vazio.
 */
export function textoDoAviso({
  empresa,
  devedor,
  hoje = new Date(),
}: {
  empresa: { name: string };
  devedor: Pick<Devedor, "nome" | "contato" | "titulos">;
  hoje?: Date;
}): string {
  if (devedor.titulos.length === 0) return "";

  const linhas = devedor.titulos.map((titulo) => {
    const dias = diasDeAtraso(titulo.dueDate, hoje);
    const partes = [
      titulo.description,
      titulo.dueDate ? `vencimento ${dataPorExtenso(diaDoVencimento(titulo.dueDate))}` : "sem vencimento definido",
      reais(titulo.amount),
    ];
    if (dias > 0) partes.push(`vencido há ${dias} ${dias === 1 ? "dia" : "dias"}`);
    return { dias, valor: emCentavos(titulo.amount), texto: `- ${partes.join(" | ")}` };
  });

  const emAtraso = linhas.some((linha) => linha.dias > 0);
  const total = emReais(linhas.reduce((soma, linha) => soma + linha.valor, 0));
  const plural = linhas.length > 1;
  const titulos = plural ? "os títulos abaixo" : "o título abaixo";

  const abertura = emAtraso
    ? `Identificamos pagamento em atraso em nome de ${devedor.nome}. ${plural ? "Constam" : "Consta"} em aberto ${titulos}. ` +
      "Pedimos a regularização ou, se o pagamento já foi feito, o envio do comprovante."
    : `Este é um lembrete de vencimento: em nome de ${devedor.nome}, ${plural ? "constam" : "consta"} em aberto ${titulos}.`;

  return [
    `Olá, ${devedor.contato.nome || devedor.nome}.`,
    "",
    abertura,
    "",
    ...linhas.map((linha) => linha.texto),
    "",
    `Total em aberto: ${reais(total)}`,
    "",
    "Atenciosamente,",
    empresa.name,
  ].join("\n");
}
