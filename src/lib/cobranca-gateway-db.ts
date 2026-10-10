import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { Refusal } from "@/lib/cadastros";
import { ATOR_MERCADO_PAGO, registrarAuditoria, registrarAuditoriaDepois, type Origem, type QualquerAtor } from "@/lib/auditoria";
import { CifraError, cifraLigada, cifrar, decifrar } from "@/lib/cifra";
import { alterarFatura, INVOICE_NOT_FOUND } from "@/lib/faturas-db";
import { MercadoPagoError, buscarPagamento, criarPagamento, type Pagamento } from "@/lib/mercado-pago";
import { avisarEquipe, avisoDeCobrancaAConferir, avisoDeFaturaPagaPeloGateway } from "@/lib/notificacoes";
import prisma, { empresaAtual, paraEmpresa, sistema, transacao } from "@/lib/prisma";
import {
  COBRANCA_NAO_ENCONTRADA,
  COBRANCA_SEM_PAGAMENTO,
  CREDENCIAIS_ILEGIVEIS,
  EM_ABERTO,
  GATEWAY_INDISPONIVEL,
  GATEWAY_NAO_LIGADO,
  ROTULO_DO_TIPO,
  SO_FATURA_EM_ABERTO,
  cobrancasEmAberto,
  corpoDoPagamento,
  decisaoDoPagamento,
  enderecoDoWebhook,
  finalDaCredencial,
  jaExisteEmAberto,
  pagadorDaCobranca,
  vencimentoDaCobranca,
  webhookParaOGateway,
  type CobrancaDaTela,
  type GatewayDaEmpresa,
  type SituacaoDaCobranca,
  type TipoDeCobranca,
} from "@/lib/cobranca-gateway";

/**
 * O que a cobrança pelo Mercado Pago grava e lê. As regras (quem é o pagador,
 * o vencimento, o que fazer com um pagamento) estão em
 * src/lib/cobranca-gateway.ts. Só o servidor importa este arquivo.
 *
 * As funções recebem a empresa (`Empresa`: o cliente do banco e a transação
 * dela) porque são chamadas de dois lugares: das rotas do painel, na empresa da
 * sessão, e do webhook e da conferência periódica, que não têm sessão e dizem a
 * empresa pelo id (`paraEmpresa`).
 */

type Tx = Prisma.TransactionClient;
type Db = Omit<PrismaClient, "$transaction" | "$on" | "$extends">;

export type Empresa = {
  id: string;
  db: Db;
  transacao: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;
};

/** A empresa da sessão de quem fez a requisição (rotas do painel e do portal). */
export async function empresaDaSessao(): Promise<Empresa> {
  return { id: await empresaAtual(), db: prisma, transacao };
}

/** A empresa pelo id, para quem não tem sessão (webhook e conferência periódica). */
export function empresaPorId(tenantId: string): Empresa {
  const { db, transacao } = paraEmpresa(tenantId);
  return { id: tenantId, db, transacao };
}

/* --------------------------------- Credenciais -------------------------------- */

// O contexto entra na cifra: o texto cifrado de uma empresa (ou de um campo) não abre em outra.
const contexto = (tenantId: string, campo: "accessToken" | "webhookSecret") => `PaymentGateway:${tenantId}:${campo}`;

const enderecoPublico = () => (process.env.NEXTAUTH_URL || "").replace(/\/+$/, "");

async function webhookDaEmpresa(empresa: Empresa): Promise<string> {
  // A empresa só lê o próprio cadastro (prisma/sql/010-rls.sql).
  const tenant = await empresa.db.tenant.findUnique({ where: { id: empresa.id }, select: { slug: true } });
  return enderecoDoWebhook(enderecoPublico(), tenant?.slug ?? "");
}

/** O que a tela de Empresa > Cobrança mostra: nunca o token nem o segredo. */
export async function gatewayDaEmpresa(empresa: Empresa): Promise<GatewayDaEmpresa> {
  const gateway = await empresa.db.paymentGateway.findUnique({ where: { tenantId: empresa.id }, select: { accessTokenEnd: true, webhookSecretEnd: true } });
  return {
    disponivel: cifraLigada(),
    configurado: Boolean(gateway),
    accessTokenFinal: gateway?.accessTokenEnd ?? null,
    webhookSecretFinal: gateway?.webhookSecretEnd ?? null,
    webhook: await webhookDaEmpresa(empresa),
  };
}

type Quem = { ator: QualquerAtor; origem: Origem };

/** Guarda (cifradas) as credenciais da conta do Mercado Pago da empresa. Na auditoria vai só que mudou, e o final de cada uma. */
export async function salvarGateway(empresa: Empresa, credenciais: { accessToken: string; webhookSecret: string }, quem: Quem): Promise<GatewayDaEmpresa> {
  if (!cifraLigada()) throw new Refusal(GATEWAY_INDISPONIVEL, 503);
  const dados = {
    accessTokenEnc: cifrar(credenciais.accessToken, contexto(empresa.id, "accessToken")),
    accessTokenEnd: finalDaCredencial(credenciais.accessToken),
    webhookSecretEnc: cifrar(credenciais.webhookSecret, contexto(empresa.id, "webhookSecret")),
    webhookSecretEnd: finalDaCredencial(credenciais.webhookSecret),
  };
  const antes = await empresa.db.paymentGateway.findUnique({ where: { tenantId: empresa.id }, select: { accessTokenEnd: true, webhookSecretEnd: true } });
  await empresa.db.paymentGateway.upsert({ where: { tenantId: empresa.id }, create: dados, update: dados, select: { id: true } });
  await registrarAuditoriaDepois(empresa.db, {
    ...quem,
    acao: "empresa.gateway",
    entidade: "integracao",
    entidadeId: empresa.id,
    resumo: antes ? "Credenciais do Mercado Pago trocadas" : "Conta do Mercado Pago ligada",
    // Só o final, que a tela também mostra. Os nomes dos campos não levam "token" nem "segredo": a auditoria os descartaria.
    antes: { mercadoPago: antes ? `ligado (credencial final ${antes.accessTokenEnd})` : "desligado" },
    depois: { mercadoPago: `ligado (credencial final ${dados.accessTokenEnd})` },
  });
  return gatewayDaEmpresa(empresa);
}

/** Desliga a conta: apaga as credenciais. As cobranças já criadas ficam como estão. */
export async function removerGateway(empresa: Empresa, quem: Quem): Promise<GatewayDaEmpresa> {
  const { count } = await empresa.db.paymentGateway.deleteMany({ where: { tenantId: empresa.id } });
  if (count > 0) {
    await registrarAuditoriaDepois(empresa.db, {
      ...quem,
      acao: "empresa.gateway",
      entidade: "integracao",
      entidadeId: empresa.id,
      resumo: "Conta do Mercado Pago desligada",
      antes: { mercadoPago: "ligado" },
      depois: { mercadoPago: "desligado" },
    });
  }
  return gatewayDaEmpresa(empresa);
}

export type Credenciais = { accessToken: string; webhookSecret: string };

/**
 * As credenciais em claro, para chamar o Mercado Pago. `null` quando a empresa
 * não ligou a conta ou o servidor está sem a chave de dados. Texto que não abre
 * (a chave de dados mudou) é recusa 503, não "desligado": a empresa precisa
 * saber que tem de cadastrar de novo.
 */
export async function credenciaisDaEmpresa(empresa: Empresa): Promise<Credenciais | null> {
  if (!cifraLigada()) return null;
  const gateway = await empresa.db.paymentGateway.findUnique({ where: { tenantId: empresa.id }, select: { accessTokenEnc: true, webhookSecretEnc: true } });
  if (!gateway) return null;
  try {
    return {
      accessToken: decifrar(gateway.accessTokenEnc, contexto(empresa.id, "accessToken")),
      webhookSecret: decifrar(gateway.webhookSecretEnc, contexto(empresa.id, "webhookSecret")),
    };
  } catch (erro) {
    if (erro instanceof CifraError) throw new Refusal(CREDENCIAIS_ILEGIVEIS, 503);
    throw erro;
  }
}

/** A empresa tem conta ligada e utilizável? É o que troca o Pix estático pelo dinâmico. */
export async function gatewayLigado(empresa: Empresa): Promise<boolean> {
  if (!cifraLigada()) return false;
  return (await empresa.db.paymentGateway.count({ where: { tenantId: empresa.id } })) > 0;
}

async function credenciaisOuRecusa(empresa: Empresa): Promise<Credenciais> {
  if (!cifraLigada()) throw new Refusal(GATEWAY_INDISPONIVEL, 503);
  const credenciais = await credenciaisDaEmpresa(empresa);
  if (!credenciais) throw new Refusal(GATEWAY_NAO_LIGADO, 409);
  return credenciais;
}

/* ----------------------------------- Leitura ---------------------------------- */

export const COBRANCA_SELECT = {
  id: true,
  invoiceId: true,
  kind: true,
  status: true,
  gatewayId: true,
  amount: true,
  paidAmount: true,
  pixCode: true,
  qrCodeBase64: true,
  ticketUrl: true,
  digitableLine: true,
  expiresAt: true,
  paidAt: true,
  note: true,
  createdAt: true,
} as const;

type Cobranca = Prisma.PaymentChargeGetPayload<{ select: typeof COBRANCA_SELECT }>;

/** A cobrança para a tela. O que serve para pagar (código, QR, link) só vai enquanto ela está em aberto. */
export function paraATela(cobranca: Cobranca): CobrancaDaTela {
  const pagavel = cobranca.status === "PENDING";
  return {
    id: cobranca.id,
    tipo: cobranca.kind as TipoDeCobranca,
    situacao: cobranca.status as SituacaoDaCobranca,
    valor: cobranca.amount,
    valorPago: cobranca.paidAmount,
    copiaECola: pagavel ? cobranca.pixCode : null,
    qrCodeBase64: pagavel ? cobranca.qrCodeBase64 : null,
    link: pagavel ? cobranca.ticketUrl : null,
    linhaDigitavel: pagavel ? cobranca.digitableLine : null,
    venceEm: cobranca.expiresAt.toISOString(),
    criadaEm: cobranca.createdAt.toISOString(),
    pagaEm: cobranca.paidAt?.toISOString() ?? null,
    nota: cobranca.note,
  };
}

/** As cobranças da fatura, da mais nova para a mais antiga. */
export async function cobrancasDaFatura(db: Pick<Db, "paymentCharge">, invoiceId: string): Promise<CobrancaDaTela[]> {
  const cobrancas = await db.paymentCharge.findMany({ where: { invoiceId }, orderBy: { createdAt: "desc" }, take: 20, select: COBRANCA_SELECT });
  return cobrancas.map(paraATela);
}

/** O Pix e o boleto em aberto de cada fatura informada (o portal e os avisos usam): fatura → `{ pix, boleto }`. */
export async function emAbertoPorFatura(db: Pick<Db, "paymentCharge">, invoiceIds: readonly string[]): Promise<Map<string, { pix: CobrancaDaTela | null; boleto: CobrancaDaTela | null }>> {
  const porFatura = new Map<string, { pix: CobrancaDaTela | null; boleto: CobrancaDaTela | null }>();
  const ids = [...new Set(invoiceIds)];
  if (ids.length === 0) return porFatura;
  const cobrancas = await db.paymentCharge.findMany({ where: { invoiceId: { in: ids }, status: "PENDING" }, select: COBRANCA_SELECT });
  for (const id of ids) {
    const { pix, boleto } = cobrancasEmAberto(cobrancas.filter((cobranca) => cobranca.invoiceId === id));
    if (pix || boleto) porFatura.set(id, { pix: pix && paraATela(pix), boleto: boleto && paraATela(boleto) });
  }
  return porFatura;
}

/* ----------------------------------- Criação ---------------------------------- */

const SITUACAO_QUE_NAO_NASCE = ["rejected", "cancelled"];

/**
 * Cria no Mercado Pago a cobrança (Pix ou boleto) de uma fatura em aberto.
 *
 * Em três passos, para a chamada de rede ficar fora de transação e, mesmo
 * assim, não nascer cobrança em dobro:
 * 1. com a fatura travada, confere que ela está em aberto e que não há outra
 *    cobrança em aberto do mesmo tipo, e grava a cobrança "em criação" com uma
 *    chave de idempotência;
 * 2. pede o pagamento ao Mercado Pago com essa chave;
 * 3. grava o que voltou.
 *
 * Se o Mercado Pago não responder no passo 2, a cobrança fica "em criação":
 * gerar de novo repete o pedido com a MESMA chave (e o mesmo vencimento), e o
 * Mercado Pago devolve o pagamento que já existe em vez de criar outro. Se ele
 * recusar, a cobrança fica "não criada" com o motivo, e a próxima tentativa usa
 * chave nova.
 */
export async function criarCobranca(empresa: Empresa, invoiceId: string, tipo: TipoDeCobranca, quem: Quem): Promise<CobrancaDaTela> {
  const credenciais = await credenciaisOuRecusa(empresa);
  const webhook = webhookParaOGateway(await webhookDaEmpresa(empresa));

  const preparado = await empresa.transacao(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${invoiceId} FOR UPDATE`;
    const fatura = await tx.invoice.findUnique({
      where: { id: invoiceId },
      select: { id: true, number: true, status: true, total: true, dueDate: true, client: { select: { companyName: true, cnpj: true, email: true, address: true } } },
    });
    if (!fatura) throw new Refusal(INVOICE_NOT_FOUND, 404);
    if (fatura.status !== "OPEN" || !(fatura.total > 0)) throw new Refusal(SO_FATURA_EM_ABERTO, 409);

    const { pagador, erro } = pagadorDaCobranca(tipo, fatura.client);
    if (erro !== null) throw new Refusal(erro, 400);

    const existente = await tx.paymentCharge.findFirst({
      where: { invoiceId, kind: tipo, status: { in: [...EM_ABERTO] } },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true, idempotencyKey: true, expiresAt: true },
    });
    if (existente?.status === "PENDING") throw new Refusal(jaExisteEmAberto(tipo), 409);

    // "Em criação" que sobrou de uma tentativa sem resposta: repete com a mesma chave.
    const cobranca =
      existente ??
      (await tx.paymentCharge.create({
        data: { invoiceId, kind: tipo, status: "CREATING", idempotencyKey: randomUUID(), amount: fatura.total, expiresAt: vencimentoDaCobranca(tipo, fatura.dueDate) },
        select: { id: true, status: true, idempotencyKey: true, expiresAt: true },
      }));
    return { fatura, pagador, cobranca };
  });

  const { fatura, pagador, cobranca } = preparado;
  let pagamento: Pagamento;
  try {
    pagamento = await criarPagamento(credenciais.accessToken, corpoDoPagamento({ tipo, fatura, pagador, venceEm: cobranca.expiresAt, webhook }), cobranca.idempotencyKey);
  } catch (erro) {
    if (!(erro instanceof MercadoPagoError)) throw erro;
    if (erro.incerto) {
      throw new Refusal(`${erro.message} A cobrança ficou "em criação": gerar de novo repete o mesmo pedido, sem duplicar.`, 502);
    }
    await empresa.db.paymentCharge.update({ where: { id: cobranca.id }, data: { status: "FAILED", note: erro.message.slice(0, 300) }, select: { id: true } });
    throw new Refusal(erro.message, 502);
  }

  if (SITUACAO_QUE_NAO_NASCE.includes(pagamento.status)) {
    const nota = "O Mercado Pago recusou a cobrança na criação.";
    await empresa.db.paymentCharge.update({ where: { id: cobranca.id }, data: { status: "FAILED", gatewayId: pagamento.id, note: nota }, select: { id: true } });
    throw new Refusal(nota, 502);
  }

  const gravada = await empresa.db.paymentCharge.update({
    where: { id: cobranca.id },
    data: {
      status: "PENDING",
      gatewayId: pagamento.id,
      pixCode: pagamento.pixCopiaECola,
      qrCodeBase64: pagamento.qrCodeBase64,
      ticketUrl: pagamento.link,
      digitableLine: pagamento.linhaDigitavel,
      // O vencimento que o gateway confirmou, quando ele diz.
      ...(pagamento.expiraEm && { expiresAt: pagamento.expiraEm }),
      note: null,
      checkedAt: new Date(),
    },
    select: COBRANCA_SELECT,
  });

  await registrarAuditoriaDepois(empresa.db, {
    ...quem,
    acao: "cobranca.gerar",
    entidade: "cobranca",
    entidadeId: gravada.id,
    resumo: `${ROTULO_DO_TIPO[tipo]} da fatura nº ${fatura.number} gerado no Mercado Pago`,
    depois: { kind: tipo, amount: gravada.amount, expiresAt: gravada.expiresAt, gatewayId: gravada.gatewayId, invoiceId },
  });

  // Raro, mas possível: o pagamento já volta aprovado. Aplica pelo mesmo caminho do aviso.
  if (pagamento.status === "approved") {
    await aplicarPagamento(empresa, pagamento, quem.origem);
    return paraATela(await empresa.db.paymentCharge.findUniqueOrThrow({ where: { id: gravada.id }, select: COBRANCA_SELECT }));
  }
  return paraATela(gravada);
}

/* ------------------------------ Aviso de pagamento ----------------------------- */

export type Resultado =
  /** O pagamento não é de cobrança nenhuma desta empresa. */
  | "desconhecido"
  /** Pagamento aprovado com a referência de uma fatura da empresa, mas sem cobrança do sistema: o financeiro foi avisado. */
  | "sem-cobranca"
  | "nada"
  | "paga"
  | "a-conferir"
  | "encerrada";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Pagamento aprovado na conta da empresa, com a referência de uma fatura dela,
 * que não corresponde a nenhuma cobrança do sistema (a criação ficou sem
 * resposta e foi refeita com outra chave, por exemplo). Não há cobrança para
 * conferir valor e tipo, então a fatura não é paga: o financeiro é avisado, uma
 * vez por pagamento.
 */
async function avisarPagamentoSemCobranca(tx: Tx, pagamento: Pagamento, origem: Origem): Promise<Resultado> {
  if (pagamento.status !== "approved" || !pagamento.externalReference || !UUID.test(pagamento.externalReference)) return "desconhecido";
  // Na empresa da transação: fatura de outra empresa não aparece.
  const fatura = await tx.invoice.findUnique({ where: { id: pagamento.externalReference }, select: { id: true, number: true } });
  if (!fatura) return "desconhecido";

  const resumo = `Pagamento ${pagamento.id} aprovado no Mercado Pago para a fatura nº ${fatura.number}, sem cobrança correspondente no sistema`;
  const jaAvisado = await tx.auditLog.findFirst({ where: { action: "cobranca.conferir", entityId: fatura.id, summary: resumo }, select: { id: true } });
  if (jaAvisado) return "sem-cobranca";

  await registrarAuditoria(tx, { ator: ATOR_MERCADO_PAGO, origem, acao: "cobranca.conferir", entidade: "fatura", entidadeId: fatura.id, resumo });
  await avisarEquipe(tx, "financeiro", avisoDeCobrancaAConferir(fatura, "O Mercado Pago recebeu um pagamento desta fatura sem cobrança correspondente no sistema. A baixa não foi dada."), null);
  return "sem-cobranca";
}

/**
 * Aplica o que o Mercado Pago respondeu sobre um pagamento. O pagamento vem
 * SEMPRE da API (`buscarPagamento`), nunca do corpo de um aviso.
 *
 * Tudo numa transação, com a cobrança e a fatura travadas: dois avisos do mesmo
 * pagamento correm um depois do outro, e o segundo encontra a cobrança já paga.
 * A baixa da fatura é a do Faturamento (`alterarFatura`), com o Mercado Pago
 * como ator na auditoria.
 */
export async function aplicarPagamento(empresa: Empresa, pagamento: Pagamento, origem: Origem): Promise<Resultado> {
  return empresa.transacao(async (tx) => {
    const achada = await tx.paymentCharge.findFirst({ where: { gatewayId: pagamento.id }, select: { id: true } });
    if (!achada) return avisarPagamentoSemCobranca(tx, pagamento, origem);

    await tx.$queryRaw`SELECT id FROM "PaymentCharge" WHERE id = ${achada.id} FOR UPDATE`;
    const cobranca = await tx.paymentCharge.findUniqueOrThrow({ where: { id: achada.id }, select: { id: true, invoiceId: true, kind: true, status: true, amount: true, note: true } });
    await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${cobranca.invoiceId} FOR UPDATE`;
    const fatura = await tx.invoice.findUniqueOrThrow({ where: { id: cobranca.invoiceId }, select: { id: true, number: true, status: true, total: true } });

    const agora = new Date();
    const decisao = decisaoDoPagamento(cobranca, fatura, pagamento, agora);
    const tipo = cobranca.kind as TipoDeCobranca;

    if (decisao.acao === "nada") {
      await tx.paymentCharge.update({ where: { id: cobranca.id }, data: { checkedAt: agora }, select: { id: true } });
      return "nada";
    }

    if (decisao.acao === "pagar") {
      await alterarFatura(tx, fatura.id, "pagar", { ator: ATOR_MERCADO_PAGO, origem, encargos: decisao.encargos, pagaEm: decisao.pagaEm, formaDePagamento: tipo });
      await tx.paymentCharge.update({
        where: { id: cobranca.id },
        data: { status: "PAID", paidAt: decisao.pagaEm, paidAmount: decisao.valorPago, note: null, checkedAt: agora },
        select: { id: true },
      });
      await avisarEquipe(tx, "financeiro", avisoDeFaturaPagaPeloGateway(fatura, tipo), null);
      return "paga";
    }

    if (decisao.acao === "conferir") {
      // Aviso repetido do mesmo problema: não grava de novo nem avisa de novo.
      if (cobranca.status === "REVIEW" && cobranca.note === decisao.nota) {
        await tx.paymentCharge.update({ where: { id: cobranca.id }, data: { checkedAt: agora }, select: { id: true } });
        return "a-conferir";
      }
      await tx.paymentCharge.update({
        where: { id: cobranca.id },
        data: { status: "REVIEW", note: decisao.nota, checkedAt: agora, ...(decisao.valorPago !== null && { paidAmount: decisao.valorPago }), ...(decisao.pagaEm && { paidAt: decisao.pagaEm }) },
        select: { id: true },
      });
      await registrarAuditoria(tx, {
        ator: ATOR_MERCADO_PAGO,
        origem,
        acao: "cobranca.conferir",
        entidade: "cobranca",
        entidadeId: cobranca.id,
        resumo: `${ROTULO_DO_TIPO[tipo]} da fatura nº ${fatura.number} a conferir: ${decisao.nota}`,
        antes: { status: cobranca.status },
        depois: { status: "REVIEW" },
      });
      await avisarEquipe(tx, "financeiro", avisoDeCobrancaAConferir(fatura, decisao.nota), null);
      return "a-conferir";
    }

    await tx.paymentCharge.update({ where: { id: cobranca.id }, data: { status: decisao.situacao, checkedAt: agora }, select: { id: true } });
    await registrarAuditoria(tx, {
      ator: ATOR_MERCADO_PAGO,
      origem,
      acao: "cobranca.encerrar",
      entidade: "cobranca",
      entidadeId: cobranca.id,
      resumo: `${ROTULO_DO_TIPO[tipo]} da fatura nº ${fatura.number} ${decisao.situacao === "EXPIRED" ? "venceu" : "foi cancelado"} no Mercado Pago`,
      antes: { status: cobranca.status },
      depois: { status: decisao.situacao },
    });
    return "encerrada";
  });
}

/**
 * Consulta o pagamento no Mercado Pago, com o token da empresa, e aplica o que
 * ele responder. Pagamento que não existe na conta da empresa é "desconhecido".
 */
export async function sincronizarPagamento(empresa: Empresa, credenciais: Credenciais, pagamentoId: string, origem: Origem): Promise<Resultado> {
  const pagamento = await buscarPagamento(credenciais.accessToken, pagamentoId);
  if (!pagamento) return "desconhecido";
  return aplicarPagamento(empresa, pagamento, origem);
}

/** "Atualizar situação": consulta o Mercado Pago sobre a cobrança, para quando o aviso não chega. */
export async function atualizarCobranca(empresa: Empresa, invoiceId: string, cobrancaId: string, origem: Origem): Promise<CobrancaDaTela> {
  const cobranca = await empresa.db.paymentCharge.findFirst({ where: { id: cobrancaId, invoiceId }, select: { id: true, gatewayId: true } });
  if (!cobranca) throw new Refusal(COBRANCA_NAO_ENCONTRADA, 404);
  if (!cobranca.gatewayId) throw new Refusal(COBRANCA_SEM_PAGAMENTO, 409);
  const credenciais = await credenciaisOuRecusa(empresa);
  try {
    await sincronizarPagamento(empresa, credenciais, cobranca.gatewayId, origem);
  } catch (erro) {
    if (erro instanceof MercadoPagoError) throw new Refusal(erro.message, 502);
    throw erro;
  }
  return paraATela(await empresa.db.paymentCharge.findUniqueOrThrow({ where: { id: cobranca.id }, select: COBRANCA_SELECT }));
}

/* ---------------------------- Conferência periódica ---------------------------- */

const JANELA_DA_CONFERENCIA_MS = 72 * 3_600_000;
const LOTE_DA_CONFERENCIA = 50;
const ORIGEM_DO_SERVIDOR: Origem = { ip: null, dispositivo: "Conferência periódica" };

/**
 * Confere no Mercado Pago as cobranças em aberto criadas nas últimas 72 horas,
 * para o caso de um aviso não ter chegado. Roda no despachante do servidor
 * (src/lib/eventos.ts), para todas as empresas; as conferidas há mais tempo vão
 * primeiro. Uma cobrança que falha não segura as outras. Devolve quantas mudaram.
 */
export async function conferirCobrancasEmAberto(agora: Date = new Date()): Promise<number> {
  if (!cifraLigada()) return 0;
  const pendentes = await sistema.paymentCharge.findMany({
    where: { status: "PENDING", gatewayId: { not: null }, createdAt: { gte: new Date(agora.getTime() - JANELA_DA_CONFERENCIA_MS) } },
    orderBy: [{ checkedAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
    take: LOTE_DA_CONFERENCIA,
    select: { id: true, tenantId: true, gatewayId: true },
  });

  let mudaram = 0;
  const credenciaisPorEmpresa = new Map<string, Credenciais | null>();
  for (const pendente of pendentes) {
    if (!pendente.gatewayId) continue;
    const empresa = empresaPorId(pendente.tenantId);
    try {
      if (!credenciaisPorEmpresa.has(pendente.tenantId)) credenciaisPorEmpresa.set(pendente.tenantId, await credenciaisDaEmpresa(empresa));
      const credenciais = credenciaisPorEmpresa.get(pendente.tenantId);
      // A empresa desligou a conta: não há com que consultar.
      if (!credenciais) continue;
      const resultado = await sincronizarPagamento(empresa, credenciais, pendente.gatewayId, ORIGEM_DO_SERVIDOR);
      if (resultado === "desconhecido") await empresa.db.paymentCharge.update({ where: { id: pendente.id }, data: { checkedAt: new Date() }, select: { id: true } });
      else if (resultado !== "nada") mudaram += 1;
    } catch (erro) {
      // Só a mensagem: ela é montada aqui e nunca leva credencial.
      console.error(`Cobrança ${pendente.id} não conferida no Mercado Pago:`, erro instanceof Error ? erro.message : "erro desconhecido");
      if (erro instanceof Refusal) credenciaisPorEmpresa.set(pendente.tenantId, null);
    }
  }
  return mudaram;
}
