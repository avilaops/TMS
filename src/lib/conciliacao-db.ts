import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { Refusal } from "@/lib/cadastros";
import { CAMPOS_DO_LANCAMENTO, escolher, registrarAuditoria, type Ator, type Origem } from "@/lib/auditoria";
import { TRANSACTION_SELECT, type Encargos } from "@/lib/financeiro";
import { pagarLancamento, reabrirLancamento } from "@/lib/financeiro-db";
import { alterarFatura } from "@/lib/faturas-db";
import type { ContaDoExtrato } from "@/lib/ofx";
import {
  JANELA_PADRAO,
  LINHA_JA_TRATADA,
  LINHA_NAO_ENCONTRADA,
  LINHA_SELECT,
  LINHA_SEM_O_QUE_DESFAZER,
  PAGO_NAO_RECEBE_ENCARGO,
  SINAL_TROCADO,
  TITULO_JA_CONCILIADO,
  TITULO_NAO_ENCONTRADO,
  TITULO_SELECT,
  diaDaLinha,
  encargosDaConciliacao,
  formaDePagamentoDoExtrato,
  instanteDoDia,
  situacaoDaLinha,
  sugerirConciliacao,
  type FiltroDaLista,
  type RespostaDaConciliacao,
} from "@/lib/conciliacao";

// O que a conciliação bancária grava e lê, dentro de transação. As regras
// (quem é candidato, encargos, forma de pagamento) estão em
// src/lib/conciliacao.ts. Só o servidor importa este arquivo.

type Tx = Prisma.TransactionClient;
type Quem = { ator: Ator; origem: Origem };

/**
 * A chave que separa uma conta da outra na unicidade das linhas: um resumo
 * criptográfico de banco + agência + número. O número inteiro da conta não é
 * gravado em lugar nenhum.
 */
export function chaveDaConta(conta: Pick<ContaDoExtrato, "banco" | "agencia" | "numero">): string {
  return createHash("sha256").update([conta.banco ?? "", conta.agencia ?? "", conta.numero].join("|")).digest("hex").slice(0, 32);
}

const DIA_EM_MS = 86_400_000;
const emReais = (valor: number) => valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** A linha como aparece no resumo da auditoria: `05/10/2026, R$ 150,00, "PIX RECEBIDO..."`. */
function rotuloDaLinha(linha: { postedAt: Date; amount: number; description: string }): string {
  const [ano, mes, dia] = diaDaLinha(linha).split("-");
  return `${dia}/${mes}/${ano}, ${emReais(linha.amount)}, "${linha.description.slice(0, 80)}"`;
}

/** Lê a linha segurando-a até o fim da transação: duas ações na mesma linha correm uma depois da outra. */
async function travarLinha(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM "BankStatementLine" WHERE id = ${id} FOR UPDATE`;
  const linha = await tx.bankStatementLine.findUnique({
    where: { id },
    select: { id: true, postedAt: true, amount: true, kind: true, description: true, status: true, settled: true, transactionId: true },
  });
  if (!linha) throw new Refusal(LINHA_NAO_ENCONTRADA, 404);
  return linha;
}

async function travarLinhaPendente(tx: Tx, id: string) {
  const linha = await travarLinha(tx, id);
  if (situacaoDaLinha(linha) !== "PENDING") throw new Refusal(LINHA_JA_TRATADA, 409);
  return linha;
}

/**
 * Concilia a linha com um lançamento.
 *
 * - Lançamento **em aberto**: recebe a baixa pela mesma regra do Financeiro
 *   (`pagarLancamento`), com a data do extrato e a forma de pagamento que a
 *   descrição deixa inferir; valor diferente em título a receber vira juros ou
 *   desconto (`encargosDaConciliacao`). Se o lançamento é de uma **fatura**, é
 *   a fatura que é paga (`alterarFatura`), e o lançamento a acompanha.
 * - Lançamento **já pago**: só liga a linha a ele.
 */
export async function conciliarLinha(tx: Tx, linhaId: string, transactionId: string, informados: Encargos, quem: Quem) {
  const linha = await travarLinhaPendente(tx, linhaId);

  await tx.$queryRaw`SELECT id FROM "FinancialTransaction" WHERE id = ${transactionId} FOR UPDATE`;
  const titulo = await tx.financialTransaction.findUnique({
    where: { id: transactionId },
    select: { id: true, type: true, amount: true, status: true, description: true, invoiceId: true, statementLine: { select: { id: true } } },
  });
  if (!titulo) throw new Refusal(TITULO_NAO_ENCONTRADO, 404);
  if (titulo.statementLine) throw new Refusal(TITULO_JA_CONCILIADO, 409);
  if (linha.amount > 0 !== (titulo.type === "INCOME")) throw new Refusal(SINAL_TROCADO, 400);

  const informou = informados.juros !== undefined || informados.multa !== undefined || informados.desconto !== undefined;
  const emAberto = titulo.status !== "PAID";

  if (emAberto) {
    const { encargos, erro } = encargosDaConciliacao(titulo, Math.abs(linha.amount), informados);
    if (erro !== null) throw new Refusal(erro, 400);
    const quando = instanteDoDia(diaDaLinha(linha));
    const forma = formaDePagamentoDoExtrato(linha);
    if (titulo.invoiceId) {
      await alterarFatura(tx, titulo.invoiceId, "pagar", { ...quem, encargos, pagaEm: quando, formaDePagamento: forma, daConciliacao: true });
    } else {
      await pagarLancamento(tx, titulo.id, { ...quem, encargos, quando, forma });
    }
  } else if (informou) {
    throw new Refusal(PAGO_NAO_RECEBE_ENCARGO, 400);
  }

  await tx.bankStatementLine.update({
    where: { id: linha.id },
    data: { status: "RECONCILED", transactionId: titulo.id, settled: emAberto, reconciledAt: new Date() },
    select: { id: true },
  });
  await registrarAuditoria(tx, {
    ...quem,
    acao: "conciliacao.conciliar",
    entidade: "extrato",
    entidadeId: linha.id,
    resumo: `Extrato (${rotuloDaLinha(linha)}) conciliado com "${titulo.description}"${emAberto ? ", com baixa" : ""}`,
    antes: { status: situacaoDaLinha(linha), transactionId: null },
    depois: { status: "RECONCILED", transactionId: titulo.id, settled: emAberto },
  });
  return { transactionId: titulo.id, baixou: emAberto };
}

export type DadosDoLancamentoNovo = {
  description?: string;
  category?: string | null;
  costCenter?: string | null;
  counterparty?: string | null;
  clientId?: string | null;
};

/**
 * Cria um lançamento já pago a partir da linha (tarifa bancária, por exemplo)
 * e concilia os dois: receita se a linha é crédito, despesa se é débito, pelo
 * valor do extrato, pago no dia do extrato. Sem descrição informada vale a do
 * extrato.
 */
export async function criarLancamentoDaLinha(tx: Tx, linhaId: string, dados: DadosDoLancamentoNovo, quem: Quem) {
  const linha = await travarLinhaPendente(tx, linhaId);

  if (dados.clientId) {
    const cliente = await tx.client.findUnique({ where: { id: dados.clientId }, select: { id: true } });
    if (!cliente) throw new Refusal("Cliente não encontrado.", 400);
  }
  const descricao = (dados.description?.trim() || linha.description).slice(0, 200);
  if (descricao.length < 2) throw new Refusal("Informe a descrição.", 400);

  const criado = await tx.financialTransaction.create({
    data: {
      type: linha.amount > 0 ? "INCOME" : "EXPENSE",
      amount: Math.abs(linha.amount),
      description: descricao,
      status: "PAID",
      paidAt: instanteDoDia(diaDaLinha(linha)),
      paymentMethod: formaDePagamentoDoExtrato(linha),
      category: dados.category ?? null,
      costCenter: dados.costCenter ?? null,
      counterparty: dados.counterparty ?? null,
      clientId: dados.clientId ?? null,
    },
    select: TRANSACTION_SELECT,
  });
  await registrarAuditoria(tx, {
    ...quem,
    acao: "lancamento.criar",
    entidade: "lancamento",
    entidadeId: criado.id,
    resumo: `Lançamento "${criado.description}" criado (${criado.type === "INCOME" ? "a receber" : "a pagar"}) a partir do extrato`,
    depois: escolher(criado, CAMPOS_DO_LANCAMENTO),
  });

  // Nasceu pago: desfazer a conciliação só desliga, não há baixa a reabrir.
  await tx.bankStatementLine.update({
    where: { id: linha.id },
    data: { status: "RECONCILED", transactionId: criado.id, settled: false, reconciledAt: new Date() },
    select: { id: true },
  });
  await registrarAuditoria(tx, {
    ...quem,
    acao: "conciliacao.criar",
    entidade: "extrato",
    entidadeId: linha.id,
    resumo: `Extrato (${rotuloDaLinha(linha)}) virou o lançamento "${criado.description}"`,
    antes: { status: situacaoDaLinha(linha), transactionId: null },
    depois: { status: "RECONCILED", transactionId: criado.id, settled: false },
  });
  return criado;
}

/** Marca a linha pendente como ignorada: sai da fila, sem lançamento. */
export async function ignorarLinha(tx: Tx, linhaId: string, quem: Quem) {
  const linha = await travarLinhaPendente(tx, linhaId);
  await tx.bankStatementLine.update({ where: { id: linha.id }, data: { status: "IGNORED", transactionId: null, settled: false, reconciledAt: null }, select: { id: true } });
  await registrarAuditoria(tx, {
    ...quem,
    acao: "conciliacao.ignorar",
    entidade: "extrato",
    entidadeId: linha.id,
    resumo: `Extrato (${rotuloDaLinha(linha)}) ignorado`,
    antes: { status: situacaoDaLinha(linha) },
    depois: { status: "IGNORED" },
  });
}

/**
 * Desfaz a conciliação (ou o "ignorar"): a linha volta a pendente. Se a baixa
 * do lançamento veio da conciliação, o título é reaberto — pela fatura, quando
 * é de fatura. Lançamento que já estava pago, ou que nasceu da linha, fica como
 * está (pago) e só perde a ligação.
 */
export async function desfazerLinha(tx: Tx, linhaId: string, quem: Quem) {
  const linha = await travarLinha(tx, linhaId);
  if (linha.status !== "RECONCILED" && linha.status !== "IGNORED") throw new Refusal(LINHA_SEM_O_QUE_DESFAZER, 409);

  // Primeiro solta a linha: reabrir um título conciliado é recusado, e este deixa de ser.
  await tx.bankStatementLine.update({ where: { id: linha.id }, data: { status: "PENDING", transactionId: null, settled: false, reconciledAt: null }, select: { id: true } });

  let reabriu = false;
  if (linha.status === "RECONCILED" && linha.settled && linha.transactionId) {
    const titulo = await tx.financialTransaction.findUnique({ where: { id: linha.transactionId }, select: { id: true, status: true, invoiceId: true } });
    if (titulo?.status === "PAID") {
      if (titulo.invoiceId) await alterarFatura(tx, titulo.invoiceId, "reabrir", { ...quem, daConciliacao: true });
      else await reabrirLancamento(tx, titulo.id, quem);
      reabriu = true;
    }
  }

  await registrarAuditoria(tx, {
    ...quem,
    acao: "conciliacao.desfazer",
    entidade: "extrato",
    entidadeId: linha.id,
    resumo: `Extrato (${rotuloDaLinha(linha)}): ${linha.status === "IGNORED" ? "voltou a pendente" : `conciliação desfeita${reabriu ? ", título reaberto" : ""}`}`,
    antes: { status: linha.status, transactionId: linha.transactionId, settled: linha.settled },
    depois: { status: "PENDING", transactionId: null, settled: false },
  });
  return { reabriu };
}

/* ----------------------------------- Leitura ---------------------------------- */

/** O cliente Prisma da empresa ou o de uma transação. */
type Db = Pick<Tx, "bankStatementLine" | "financialTransaction">;

const PENDENTE = { OR: [{ status: "PENDING" }, { status: "RECONCILED", transactionId: null }] };
const FILTRO: Record<FiltroDaLista, Prisma.BankStatementLineWhereInput> = {
  pendentes: PENDENTE,
  conciliadas: { status: "RECONCILED", transactionId: { not: null } },
  ignoradas: { status: "IGNORED" },
};

/** Quantas linhas a lista traz de uma vez. As pendentes mais antigas vêm primeiro: são as que estão esperando há mais tempo. */
export const LIMITE_DA_LISTA = 300;

/**
 * As linhas do extrato na situação pedida, com a contagem de cada situação. Nas
 * pendentes, cada linha vem com até três lançamentos sugeridos e com o
 * certeiro, se houver.
 */
export async function carregarConciliacao(db: Db, filtro: FiltroDaLista, { janela = JANELA_PADRAO }: { janela?: number } = {}): Promise<RespostaDaConciliacao> {
  // Uma consulta por vez: cada uma abre a própria transação (src/lib/prisma.ts).
  const linhas = await db.bankStatementLine.findMany({
    where: FILTRO[filtro],
    orderBy: filtro === "pendentes" ? [{ postedAt: "asc" }, { createdAt: "asc" }, { id: "asc" }] : [{ postedAt: "desc" }, { createdAt: "desc" }, { id: "asc" }],
    take: LIMITE_DA_LISTA,
    select: LINHA_SELECT,
  });
  const contagem = {
    pendentes: await db.bankStatementLine.count({ where: FILTRO.pendentes }),
    conciliadas: await db.bankStatementLine.count({ where: FILTRO.conciliadas }),
    ignoradas: await db.bankStatementLine.count({ where: FILTRO.ignoradas }),
  };

  let sugestoes: ReturnType<typeof sugerirConciliacao> = new Map();
  let titulos = new Map<string, Prisma.FinancialTransactionGetPayload<{ select: typeof TITULO_SELECT }>>();
  if (filtro === "pendentes" && linhas.length > 0) {
    // Candidatos: tudo o que está em aberto e o que foi pago perto do período do extrato, ainda sem linha ligada.
    const tempos = linhas.map((linha) => linha.postedAt.getTime());
    const folga = (janela + 2) * DIA_EM_MS;
    const candidatos = await db.financialTransaction.findMany({
      where: {
        statementLine: { is: null },
        OR: [{ status: "PENDING" }, { status: "PAID", paidAt: { gte: new Date(Math.min(...tempos) - folga), lte: new Date(Math.max(...tempos) + folga) } }],
      },
      select: TITULO_SELECT,
    });
    titulos = new Map(candidatos.map((titulo) => [titulo.id, titulo]));
    sugestoes = sugerirConciliacao(linhas, candidatos, { janela });
  }

  const paraTela = <T extends { dueDate: Date | null; paidAt: Date | null }>(titulo: T) => ({
    ...titulo,
    dueDate: titulo.dueDate?.toISOString() ?? null,
    paidAt: titulo.paidAt?.toISOString() ?? null,
  });

  let certeiros = 0;
  const resposta = linhas.map((linha) => {
    const sugestao = sugestoes.get(linha.id);
    if (sugestao?.certeiro) certeiros += 1;
    return {
      id: linha.id,
      bankId: linha.bankId,
      account: linha.account,
      postedAt: linha.postedAt.toISOString(),
      amount: linha.amount,
      kind: linha.kind,
      description: linha.description,
      status: situacaoDaLinha(linha),
      settled: linha.settled,
      transaction: linha.transaction ? paraTela(linha.transaction) : null,
      candidatos: (sugestao?.candidatos ?? []).slice(0, 3).flatMap((candidato) => {
        const titulo = titulos.get(candidato.id);
        return titulo ? [{ ...candidato, titulo: paraTela(titulo) }] : [];
      }),
      certeiro: sugestao?.certeiro ?? null,
    };
  });

  return { linhas: resposta, contagem, certeiros };
}
