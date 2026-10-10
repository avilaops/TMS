import { z } from "zod";
import { normalizeText } from "@/lib/normalization";
import { PAYMENT_METHODS, diaDoVencimento, diaNoBrasil, encargosDaBaixa, valorRecebido, type Encargos } from "@/lib/financeiro";
import { txidDaFatura, txidDoTitulo } from "@/lib/pix";

/**
 * Conciliação bancária por extrato importado (OFX): regras e contas comuns às
 * rotas e à tela. Este arquivo não toca no banco.
 *
 * Não há API de banco: o administrador exporta o extrato, o sistema guarda cada
 * movimentação (`BankStatementLine`) e sugere com qual lançamento do Financeiro
 * ela casa. Quem decide é a pessoa; o sistema só concilia sozinho, em lote, o
 * que é "certeiro".
 *
 * Como um lançamento vira candidato de uma linha do extrato:
 * - **Mesmo sinal**: crédito casa com lançamento a receber; débito, com a pagar.
 * - **Valor igual**: o valor da linha é o do título em aberto, ou o que entrou
 *   de fato (com juros, multa e desconto) no título já pago.
 * - **Data na janela**: o vencimento (título em aberto) ou o pagamento (título
 *   pago) a no máximo `janela` dias da data do extrato (padrão: 5).
 * - **Identificação** na descrição do extrato: o txid do Pix (`FAT000123`), o
 *   número da fatura ("fatura 123") ou parte do nome do cliente.
 *
 * Candidato **forte** tem valor igual e, além disso, data na janela ou
 * identificação por txid ou número de fatura. Título em aberto de valor igual e
 * vencimento fora da janela (cliente que pagou atrasado) e título com o txid na
 * descrição mas valor diferente (pagou com juros ou desconto) aparecem como
 * sugestão **fraca**: a pessoa confere e concilia à mão.
 *
 * A linha é **certeira** quando tem exatamente um candidato forte — entre os
 * identificados, se houver algum; senão entre os de data na janela — e esse
 * lançamento não é o candidato certeiro de outra linha.
 */

export const SITUACOES_DA_LINHA = ["PENDING", "RECONCILED", "IGNORED"] as const;
export type SituacaoDaLinha = (typeof SITUACOES_DA_LINHA)[number];

export const SITUACAO_DA_LINHA: Record<SituacaoDaLinha, { label: string; className: string }> = {
  PENDING: { label: "Pendente", className: "bg-amber-50 text-amber-700 border-amber-200" },
  RECONCILED: { label: "Conciliada", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  IGNORED: { label: "Ignorada", className: "bg-gray-100 text-gray-600 border-gray-200" },
};

/** Dias de tolerância entre a data do extrato e o vencimento ou o pagamento do título. */
export const JANELA_PADRAO = 5;

const centavos = (valor: number) => Math.round((valor + Number.EPSILON) * 100) / 100;
const emReais = (valor: number) => valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/**
 * A situação que vale para a linha. Conciliada sem lançamento (ele foi apagado
 * por fora, e o banco soltou a ligação) volta a ser pendente.
 */
export function situacaoDaLinha(linha: { status: string; transactionId: string | null }): SituacaoDaLinha {
  if (linha.status === "IGNORED") return "IGNORED";
  if (linha.status === "RECONCILED" && linha.transactionId) return "RECONCILED";
  return "PENDING";
}

/** `AAAA-MM-DD` do dia do extrato (gravado à meia-noite UTC, lido em UTC). */
export const diaDaLinha = (linha: { postedAt: Date | string }) => diaDoVencimento(linha.postedAt);

/**
 * O instante que representa o dia do extrato na baixa: meio-dia no relógio do
 * Brasil. `paidAt` é um instante lido no fuso do Brasil; a meia-noite UTC do
 * dia do extrato cairia no dia anterior.
 */
export const instanteDoDia = (dia: string) => new Date(`${dia}T12:00:00-03:00`);

/** Dias entre dois dias `AAAA-MM-DD` (positivo quando `b` é depois de `a`). */
export function diasEntre(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/* ----------------------------- Forma de pagamento ----------------------------- */

type FormaDePagamento = (typeof PAYMENT_METHODS)[number];

/**
 * A forma de pagamento que a linha do extrato deixa inferir, pela descrição e
 * pelo tipo da movimentação (`TRNTYPE`). `null` quando o extrato não diz.
 */
export function formaDePagamentoDoExtrato(linha: { description: string; kind?: string | null }): FormaDePagamento | null {
  const texto = ` ${normalizeText(linha.description).replace(/[^a-z0-9]+/g, " ")} `;
  const tipo = (linha.kind ?? "").toUpperCase();
  const tem = (...palavras: string[]) => palavras.some((palavra) => texto.includes(` ${palavra} `));

  if (tem("pix")) return "PIX";
  if (tem("boleto", "boletos", "cobranca", "titulo", "titulos", "liquidacao")) return "BOLETO";
  if (tem("ted", "doc", "tev", "transferencia", "transf") || tipo === "XFER") return "TRANSFERENCIA";
  if (tem("cartao", "maquininha") || tipo === "POS") return "CARTAO";
  if (tem("saque", "dinheiro", "especie") || tipo === "ATM" || tipo === "CASH") return "DINHEIRO";
  return null;
}

/* ----------------------------------- Sugestão --------------------------------- */

export type LinhaDoExtrato = {
  id: string;
  /** Dia do calendário, à meia-noite UTC. */
  postedAt: Date | string;
  /** Com sinal: positivo entrou, negativo saiu. */
  amount: number;
  description: string;
};

export type TituloCandidato = {
  id: string;
  type: string;
  amount: number;
  status: string;
  dueDate: Date | string | null;
  paidAt: Date | string | null;
  paidAmount?: number | null;
  counterparty?: string | null;
  client?: { companyName: string; tradeName: string | null } | null;
  invoice?: { number: number } | null;
};

export type Candidato = {
  /** O id do lançamento. */
  id: string;
  /** Quanto maior, melhor: é a ordem da lista. */
  pontos: number;
  forte: boolean;
  /** Valor do extrato menos o valor do título, em reais. Zero quando é igual. */
  diferenca: number;
  /** Por que casou, em português, para a tela. */
  motivos: string[];
};

export type Sugestao = { candidatos: Candidato[]; certeiro: string | null };

// Palavras de razão social que não identificam ninguém.
const PALAVRAS_COMUNS = new Set([
  "ltda", "eireli", "epp", "cia", "companhia", "comercio", "comercial", "industria", "industrial", "servicos", "servico",
  "transportes", "transporte", "transportadora", "logistica", "distribuidora", "distribuicao", "representacoes", "empresa",
  "grupo", "brasil", "para", "com", "dos", "das",
]);

const palavrasDe = (texto: string) => normalizeText(texto).split(/[^a-z0-9]+/).filter(Boolean);

function nomeNaDescricao(titulo: TituloCandidato, palavrasDaDescricao: ReadonlySet<string>): boolean {
  const nomes = [titulo.client?.tradeName, titulo.client?.companyName, titulo.counterparty];
  return nomes.some((nome) => palavrasDe(nome ?? "").some((palavra) => palavra.length >= 4 && !PALAVRAS_COMUNS.has(palavra) && palavrasDaDescricao.has(palavra)));
}

/** O txid do Pix do título (o da fatura ou o do próprio título) aparece na descrição, sem ser pedaço de outro número. */
function txidNaDescricao(titulo: TituloCandidato, descricao: string): string | null {
  const txid = titulo.invoice ? txidDaFatura(titulo.invoice.number) : txidDoTitulo(titulo.id);
  // Só letras e números, separados por espaço: " PIX RECEBIDO FAT000123 FULANO ".
  const limpa = ` ${descricao.toUpperCase().replace(/[^A-Z0-9]+/g, " ")} `;
  return limpa.includes(` ${txid} `) ? txid : null;
}

/** "fatura 123", "fat. nº 0123", "FATURA N 123": o número da fatura escrito na descrição. */
function faturaNaDescricao(titulo: TituloCandidato, descricao: string): boolean {
  if (!titulo.invoice) return false;
  const texto = normalizeText(descricao);
  for (const m of texto.matchAll(/\bfat(?:ura)?\.?\s*(?:n[o.]?\s*|n[º°]\s*|#\s*)?0*(\d+)\b/g)) {
    if (Number(m[1]) === titulo.invoice.number) return true;
  }
  return false;
}

/** O dia que vale para comparar com o extrato: o do pagamento no título pago, o do vencimento no aberto. */
function diaDoTitulo(titulo: TituloCandidato): string | null {
  if (titulo.status === "PAID") return titulo.paidAt ? diaNoBrasil(titulo.paidAt) : null;
  return titulo.dueDate ? diaDoVencimento(titulo.dueDate) : null;
}

const quantosDias = (dias: number) => (dias === 0 ? "no mesmo dia" : dias === 1 ? "a 1 dia" : `a ${dias} dias`);

/**
 * Os candidatos de uma linha, do melhor para o pior. `titulos` são os
 * lançamentos ainda não ligados a nenhuma linha do extrato.
 */
export function candidatosDaLinha(linha: LinhaDoExtrato, titulos: readonly TituloCandidato[], { janela = JANELA_PADRAO }: { janela?: number } = {}): Candidato[] {
  const entrada = linha.amount > 0;
  const valor = centavos(Math.abs(linha.amount));
  const dia = diaDaLinha(linha);
  const palavras = new Set(palavrasDe(linha.description));
  const candidatos: Candidato[] = [];

  for (const titulo of titulos) {
    if ((titulo.type === "INCOME") !== entrada) continue;

    const pago = titulo.status === "PAID";
    // No título pago, o que passou pelo banco é o valor recebido de fato.
    const valorDoTitulo = centavos(pago ? (titulo.paidAmount ?? titulo.amount) : titulo.amount);
    const valorIgual = valorDoTitulo === valor;

    const diaRef = diaDoTitulo(titulo);
    const dias = diaRef === null ? null : Math.abs(diasEntre(diaRef, dia));
    const naJanela = dias !== null && dias <= janela;

    const txid = txidNaDescricao(titulo, linha.description);
    const fatura = faturaNaDescricao(titulo, linha.description);
    const identificado = txid !== null || fatura;

    // Sem valor igual, só o txid sustenta a sugestão, e só em título a receber em aberto (pagou com juros ou desconto).
    if (!valorIgual && !(txid !== null && !pago && entrada)) continue;
    // Título já pago fora da janela e sem identificação é outro pagamento, de outro dia.
    if (valorIgual && pago && !naJanela && !identificado) continue;

    const motivos: string[] = [];
    let pontos = 0;
    if (valorIgual) {
      pontos += 50;
      motivos.push("valor igual");
    }
    if (dias !== null) {
      if (naJanela) pontos += 30 - 2 * Math.min(dias, 5);
      motivos.push(`${pago ? "pago" : "vence"} ${quantosDias(dias)}${naJanela ? "" : " (fora da janela)"}`);
    } else if (!pago) {
      motivos.push("sem vencimento");
    }
    if (txid !== null) {
      pontos += 40;
      motivos.push(`txid do Pix (${txid})`);
    }
    if (fatura) {
      pontos += 25;
      motivos.push(`fatura nº ${titulo.invoice?.number} na descrição`);
    }
    if (nomeNaDescricao(titulo, palavras)) {
      pontos += 15;
      motivos.push("nome na descrição");
    }
    const diferenca = centavos(valor - valorDoTitulo);
    if (!valorIgual) motivos.push(`valor difere em ${emReais(Math.abs(diferenca))} (${diferenca > 0 ? "a mais" : "a menos"})`);

    candidatos.push({ id: titulo.id, pontos, forte: valorIgual && (naJanela || identificado), diferenca, motivos });
  }

  return candidatos.sort((a, b) => b.pontos - a.pontos || a.id.localeCompare(b.id));
}

/** O único candidato forte da linha, ou `null`. Identificado (txid ou fatura) passa na frente de data na janela. */
function unicoForte(candidatos: readonly Candidato[]): string | null {
  const fortes = candidatos.filter((candidato) => candidato.forte);
  const identificados = fortes.filter((candidato) => candidato.motivos.some((motivo) => motivo.startsWith("txid do Pix") || motivo.startsWith("fatura nº")));
  const grupo = identificados.length > 0 ? identificados : fortes;
  return grupo.length === 1 ? grupo[0].id : null;
}

/**
 * A sugestão de cada linha pendente. Um lançamento que seria o certeiro de duas
 * linhas (dois créditos iguais para um título só) não é certeiro de nenhuma:
 * alguém precisa olhar.
 */
export function sugerirConciliacao(linhas: readonly LinhaDoExtrato[], titulos: readonly TituloCandidato[], opcoes: { janela?: number } = {}): Map<string, Sugestao> {
  const sugestoes = new Map<string, Sugestao>();
  const disputas = new Map<string, number>();

  for (const linha of linhas) {
    const candidatos = candidatosDaLinha(linha, titulos, opcoes);
    const certeiro = unicoForte(candidatos);
    if (certeiro) disputas.set(certeiro, (disputas.get(certeiro) ?? 0) + 1);
    sugestoes.set(linha.id, { candidatos, certeiro });
  }
  for (const sugestao of sugestoes.values()) {
    if (sugestao.certeiro && (disputas.get(sugestao.certeiro) ?? 0) > 1) sugestao.certeiro = null;
  }
  return sugestoes;
}

/* --------------------------- Encargos da conciliação -------------------------- */

export const ENCARGOS_NAO_FECHAM = "Juros, multa e desconto informados não fecham com o valor do extrato.";
export const VALOR_DIFERENTE_A_PAGAR =
  "O valor do extrato é diferente do valor do lançamento a pagar. Corrija o valor do lançamento no Financeiro e concilie de novo.";

/**
 * Os encargos da baixa de um título em aberto conciliado com uma linha de
 * `valorDoExtrato` (sem sinal).
 *
 * - Valor igual: sem encargo.
 * - Título a receber com valor diferente: quem concilia pode informar juros,
 *   multa e desconto, e a soma tem de fechar com o extrato. Sem informar, a
 *   diferença a mais entra como **juros** e a diferença a menos como
 *   **desconto** (o extrato não diz o que é multa e o que é juros).
 * - Título a pagar com valor diferente: recusado. Despesa é paga pelo valor;
 *   corrige-se o lançamento antes.
 */
export function encargosDaConciliacao(
  titulo: { type: string; amount: number },
  valorDoExtrato: number,
  informados: Encargos = {},
): { encargos: Encargos; erro: null } | { encargos: null; erro: string } {
  const valor = centavos(valorDoExtrato);
  const diferenca = centavos(valor - titulo.amount);
  const informou = informados.juros !== undefined || informados.multa !== undefined || informados.desconto !== undefined;

  if (titulo.type !== "INCOME") {
    return diferenca === 0 && !informou ? { encargos: {}, erro: null } : { encargos: null, erro: VALOR_DIFERENTE_A_PAGAR };
  }
  if (informou) {
    return valorRecebido(titulo.amount, informados) === valor ? { encargos: informados, erro: null } : { encargos: null, erro: ENCARGOS_NAO_FECHAM };
  }
  if (diferenca > 0) return { encargos: { juros: diferenca }, erro: null };
  if (diferenca < 0) return { encargos: { desconto: -diferenca }, erro: null };
  return { encargos: {}, erro: null };
}

/* ---------------------------------- Validação --------------------------------- */

const INVALID_BODY = "Dados inválidos.";

const textoOpcional = (max: number, longo: string) =>
  z
    .string(INVALID_BODY)
    .trim()
    .max(max, longo)
    .transform((valor) => (valor === "" ? null : valor))
    .nullish();

/**
 * O que se faz com uma linha do extrato (`PATCH /api/financeiro/conciliacao/[id]`):
 * - `conciliar` com um lançamento (`transactionId`); em título a receber de
 *   valor diferente, aceita `juros`, `multa` e `desconto`;
 * - `criar` um lançamento já pago a partir da linha (tarifa, por exemplo);
 * - `ignorar` a linha (não é movimento da transportadora, ou já está no sistema);
 * - `desfazer` a conciliação ou o "ignorar".
 */
export const acaoDaLinhaSchema = z.discriminatedUnion(
  "action",
  [
    z.object({
      action: z.literal("conciliar"),
      transactionId: z.string("Escolha o lançamento.").trim().min(1, "Escolha o lançamento.").max(64, "Lançamento inválido."),
      ...encargosDaBaixa,
    }),
    z.object({
      action: z.literal("criar"),
      description: z.string(INVALID_BODY).trim().max(200, "Descrição muito longa.").optional(),
      category: textoOpcional(80, "Categoria muito longa."),
      costCenter: textoOpcional(80, "Centro de custo muito longo."),
      counterparty: textoOpcional(160, "Nome do fornecedor ou pagador muito longo."),
      clientId: textoOpcional(64, INVALID_BODY),
    }),
    z.object({ action: z.literal("ignorar") }),
    z.object({ action: z.literal("desfazer") }),
  ],
  "Ação inválida.",
);

/** Filtro da lista (`?situacao=`). Sem filtro, as pendentes. */
export const FILTROS_DA_LISTA = ["pendentes", "conciliadas", "ignoradas"] as const;
export type FiltroDaLista = (typeof FILTROS_DA_LISTA)[number];

/* ------------------------------ O que as rotas leem ---------------------------- */

/** O que a conciliação lê de cada lançamento candidato ou conciliado. */
export const TITULO_SELECT = {
  id: true,
  type: true,
  amount: true,
  description: true,
  dueDate: true,
  status: true,
  paidAt: true,
  paidAmount: true,
  counterparty: true,
  client: { select: { companyName: true, tradeName: true } },
  invoiceId: true,
  invoice: { select: { id: true, number: true } },
} as const;

export const LINHA_SELECT = {
  id: true,
  bankId: true,
  account: true,
  fitId: true,
  postedAt: true,
  amount: true,
  kind: true,
  description: true,
  status: true,
  settled: true,
  reconciledAt: true,
  transactionId: true,
  transaction: { select: TITULO_SELECT },
} as const;

/** Um lançamento como a tela da conciliação o recebe. */
export type TituloDaTela = {
  id: string;
  type: string;
  amount: number;
  description: string;
  dueDate: string | null;
  status: string;
  paidAt: string | null;
  paidAmount: number | null;
  counterparty: string | null;
  client: { companyName: string; tradeName: string | null } | null;
  invoiceId: string | null;
  invoice: { id: string; number: number } | null;
};

/** Uma linha do extrato como a tela a recebe. */
export type LinhaDaTela = {
  id: string;
  bankId: string | null;
  account: string;
  postedAt: string;
  amount: number;
  kind: string | null;
  description: string;
  status: SituacaoDaLinha;
  /** A baixa do lançamento veio da conciliação: desfazer reabre o título. */
  settled: boolean;
  transaction: TituloDaTela | null;
  /** Só nas pendentes: até três sugestões, da melhor para a pior. */
  candidatos: (Candidato & { titulo: TituloDaTela })[];
  certeiro: string | null;
};

export type RespostaDaConciliacao = {
  linhas: LinhaDaTela[];
  contagem: { pendentes: number; conciliadas: number; ignoradas: number };
  /** Quantas pendentes da lista têm candidato certeiro. */
  certeiros: number;
};

/** O que a importação devolve. */
export type RespostaDaImportacao = {
  importadas: number;
  /** Movimentações do arquivo que já estavam no sistema (extrato reenviado ou períodos sobrepostos). */
  repetidas: number;
  contas: { conta: string; banco: string | null; inicio: string | null; fim: string | null; movimentacoes: number }[];
};

export const LINHA_NAO_ENCONTRADA = "Linha do extrato não encontrada.";
export const LINHA_JA_TRATADA = "Esta linha do extrato já foi conciliada ou ignorada. Atualize a página.";
export const LINHA_SEM_O_QUE_DESFAZER = "Esta linha não está conciliada nem ignorada.";
export const TITULO_NAO_ENCONTRADO = "Lançamento não encontrado.";
export const TITULO_JA_CONCILIADO = "Este lançamento já está conciliado com outra linha do extrato.";
export const SINAL_TROCADO = "Crédito do extrato só concilia com lançamento a receber, e débito com lançamento a pagar.";
export const PAGO_NAO_RECEBE_ENCARGO = "Este lançamento já está pago: a conciliação só liga a linha a ele, sem juros, multa ou desconto.";
export const CONCILIADO_NAO_MEXE = "Este lançamento está conciliado com o extrato bancário. Desfaça a conciliação antes de reabrir ou excluir.";
