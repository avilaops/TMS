import { z } from "zod";
import { encargosDaConciliacao } from "@/lib/conciliacao";
import type { Encargos } from "@/lib/financeiro";
import type { Pagamento } from "@/lib/mercado-pago";

/**
 * Cobrança pelo Mercado Pago (Pix dinâmico e boleto): as regras, sem banco e
 * sem rede. O que grava está em src/lib/cobranca-gateway-db.ts; o cliente HTTP,
 * em src/lib/mercado-pago.ts.
 *
 * A regra que atravessa o arquivo: mexe com dinheiro, então **na dúvida não
 * paga**. O que o Mercado Pago disser que o sistema não sabe aplicar com
 * certeza deixa a cobrança "a conferir", com o motivo, e avisa o financeiro.
 *
 * A tela importa este arquivo: nada daqui pode puxar o que só existe no servidor.
 */

/* ----------------------------------- Tipos ----------------------------------- */

export const TIPOS_DE_COBRANCA = ["PIX", "BOLETO"] as const;
export type TipoDeCobranca = (typeof TIPOS_DE_COBRANCA)[number];

export const ROTULO_DO_TIPO: Record<TipoDeCobranca, string> = { PIX: "Pix", BOLETO: "Boleto" };

/** Como o tipo vai no Mercado Pago (`payment_method_id`). */
export const METODO_NO_GATEWAY: Record<TipoDeCobranca, string> = { PIX: "pix", BOLETO: "bolbradesco" };

export const SITUACOES_DA_COBRANCA = ["CREATING", "PENDING", "PAID", "CANCELLED", "EXPIRED", "FAILED", "REVIEW"] as const;
export type SituacaoDaCobranca = (typeof SITUACOES_DA_COBRANCA)[number];

export const ROTULO_DA_SITUACAO: Record<SituacaoDaCobranca, string> = {
  CREATING: "Em criação",
  PENDING: "Em aberto",
  PAID: "Paga",
  CANCELLED: "Cancelada",
  EXPIRED: "Vencida",
  FAILED: "Não criada",
  REVIEW: "A conferir",
};

export const rotuloDaSituacao = (situacao: string) => (ROTULO_DA_SITUACAO as Record<string, string>)[situacao] ?? situacao;

/** Situações em que a cobrança ainda ocupa a vez do tipo dela na fatura: só uma em aberto por tipo. */
export const EM_ABERTO: readonly string[] = ["CREATING", "PENDING"];

/** A cobrança como a tela (painel e portal) recebe. Nunca traz chave de idempotência nem dado da conta. */
export type CobrancaDaTela = {
  id: string;
  tipo: TipoDeCobranca;
  situacao: SituacaoDaCobranca;
  valor: number;
  valorPago: number | null;
  copiaECola: string | null;
  qrCodeBase64: string | null;
  link: string | null;
  linhaDigitavel: string | null;
  venceEm: string;
  criadaEm: string;
  pagaEm: string | null;
  nota: string | null;
};

/** O que `GET /api/empresa/gateway` devolve. O token e o segredo nunca voltam: só "configurado" e os 4 últimos caracteres. */
export type GatewayDaEmpresa = {
  /** `false` sem `TMS_CHAVE_DE_DADOS` no servidor: não há onde guardar credencial. */
  disponivel: boolean;
  configurado: boolean;
  accessTokenFinal: string | null;
  webhookSecretFinal: string | null;
  /** O endereço que a empresa cadastra no painel do Mercado Pago. */
  webhook: string;
};

/* ---------------------------------- Mensagens --------------------------------- */

export const GATEWAY_INDISPONIVEL =
  "A cobrança pelo Mercado Pago está desligada neste servidor: falta a variável TMS_CHAVE_DE_DADOS, que protege as credenciais.";
export const GATEWAY_NAO_LIGADO = "Ligue a conta do Mercado Pago em Empresa > Cobrança antes de gerar a cobrança.";
export const CREDENCIAIS_ILEGIVEIS = "As credenciais do Mercado Pago não puderam ser lidas (a chave de dados do servidor mudou). Cadastre-as de novo em Empresa > Cobrança.";
export const SO_FATURA_EM_ABERTO = "Só fatura em aberto recebe cobrança.";
export const COBRANCA_NAO_ENCONTRADA = "Cobrança não encontrada.";
export const COBRANCA_SEM_PAGAMENTO = "Esta cobrança não chegou a ser criada no Mercado Pago. Gere de novo.";
export const PAGA_PELO_GATEWAY =
  "Esta fatura foi paga pelo Mercado Pago: o dinheiro entrou na conta, e ela não é reaberta por aqui. Estorno pelo sistema ainda não existe.";
export const jaExisteEmAberto = (tipo: TipoDeCobranca) =>
  `Esta fatura já tem ${tipo === "PIX" ? "um Pix" : "um boleto"} em aberto. Se já venceu, use "Atualizar situação" antes de gerar outro.`;

/* ---------------------------------- Validação --------------------------------- */

const INVALID_BODY = "Dados inválidos.";
const TOKEN_MESSAGE = "Informe o Access Token de produção do Mercado Pago (começa com APP_USR-).";
const SEGREDO_MESSAGE = "Informe a assinatura secreta do webhook, como aparece no painel do Mercado Pago.";

/**
 * Credenciais da conta do Mercado Pago da empresa. Os dois campos vêm juntos:
 * sem o segredo do webhook não há baixa automática confiável, então não se
 * guarda token sozinho.
 */
export const credenciaisDoGatewaySchema = z.object(
  {
    accessToken: z.string(TOKEN_MESSAGE).trim().min(20, TOKEN_MESSAGE).max(500, TOKEN_MESSAGE).regex(/^\S+$/, TOKEN_MESSAGE),
    webhookSecret: z.string(SEGREDO_MESSAGE).trim().min(8, SEGREDO_MESSAGE).max(500, SEGREDO_MESSAGE).regex(/^\S+$/, SEGREDO_MESSAGE),
  },
  INVALID_BODY,
);

export const criarCobrancaSchema = z.object({ tipo: z.enum(TIPOS_DE_COBRANCA, "Escolha Pix ou boleto.") }, INVALID_BODY);

/** Os 4 últimos caracteres: o que a tela mostra para a pessoa reconhecer a credencial. */
export const finalDaCredencial = (valor: string) => valor.slice(-4);

/** O endereço de webhook da empresa: é ele que vai no painel do Mercado Pago e no `notification_url` de cada cobrança. */
export const enderecoDoWebhook = (base: string, slug: string) => `${base.replace(/\/+$/, "")}/api/pagamentos/mercado-pago/${slug}`;

/* ----------------------------------- Pagador ---------------------------------- */

const UFS = "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ");

export type EnderecoDoPagador = { zip_code: string; street_name: string; street_number: string; neighborhood: string; city: string; federal_unit: string };

export const FORMATO_DO_ENDERECO = "Rua, número - Bairro, Cidade - UF, CEP 00000-000";

/**
 * O endereço do cadastro do cliente, que é um texto só, nas partes que o boleto
 * exige. Lê o formato que a busca por CNPJ preenche (`Rua, número - Bairro,
 * Cidade - UF`), com o CEP em qualquer lugar do texto. O que não der para
 * achar volta em `faltam`: não se inventa parte de endereço num boleto.
 */
export function enderecoDoPagador(endereco: string | null | undefined): { endereco: EnderecoDoPagador; faltam: [] } | { endereco: null; faltam: string[] } {
  let resto = (endereco ?? "").replace(/\s+/g, " ").trim();
  const faltam: string[] = [];

  const cep = resto.match(/(?<!\d)(\d{5})-?(\d{3})(?!\d)/);
  if (cep) resto = resto.replace(cep[0], " ").replace(/\bCEP\b:?/i, " ");
  else faltam.push("CEP");
  resto = resto.replace(/\s+/g, " ").replace(/[\s,;./-]+$/, "").replace(/[,;]\s*(?=[-,;])/g, " ").trim();

  const uf = resto.match(/[\s,/-]([A-Za-z]{2})$/);
  const sigla = uf?.[1].toUpperCase();
  if (sigla && UFS.includes(sigla)) resto = resto.slice(0, uf!.index).replace(/[\s,/-]+$/, "");
  else faltam.push("UF");

  // "Rua, número - Bairro, Cidade": a cidade depois da última vírgula, o bairro depois do último " - ".
  const virgula = resto.lastIndexOf(",");
  const cidade = virgula === -1 ? "" : resto.slice(virgula + 1).trim();
  const antesDaCidade = virgula === -1 ? resto : resto.slice(0, virgula);
  const traco = antesDaCidade.lastIndexOf(" - ");
  const bairro = traco === -1 ? "" : antesDaCidade.slice(traco + 3).trim();
  const ruaENumero = traco === -1 ? antesDaCidade : antesDaCidade.slice(0, traco);
  const separador = ruaENumero.lastIndexOf(",");
  const rua = (separador === -1 ? ruaENumero : ruaENumero.slice(0, separador)).trim();
  const numero = separador === -1 ? "" : ruaENumero.slice(separador + 1).trim();

  if (rua.length < 2) faltam.push("rua");
  // "S/N" é o que o Mercado Pago pede para endereço sem número.
  if (!/^(\d{1,6}[A-Za-z]?|S\/?N)$/i.test(numero)) faltam.push("número");
  if (bairro.length < 2) faltam.push("bairro");
  if (cidade.length < 2) faltam.push("cidade");

  if (faltam.length > 0 || !cep || !sigla) return { endereco: null, faltam };
  return {
    endereco: { zip_code: `${cep[1]}${cep[2]}`, street_name: rua, street_number: numero.toUpperCase().replace("SN", "S/N"), neighborhood: bairro, city: cidade, federal_unit: sigla },
    faltam: [],
  };
}

export type ClienteDaCobranca = { companyName: string; cnpj: string; email: string | null; address: string | null };

export type PagadorDaCobranca = {
  email: string;
  first_name: string;
  last_name: string;
  identification: { type: "CPF" | "CNPJ"; number: string };
  address?: EnderecoDoPagador;
};

/**
 * O pagador, tirado do cadastro do cliente. O Mercado Pago exige e-mail e
 * documento em toda cobrança; o boleto exige também o endereço inteiro. Dado
 * que falta vira erro dizendo o que completar no cadastro.
 */
export function pagadorDaCobranca(tipo: TipoDeCobranca, cliente: ClienteDaCobranca): { pagador: PagadorDaCobranca; erro: null } | { pagador: null; erro: string } {
  const faltam: string[] = [];
  const documento = cliente.cnpj.replace(/\D/g, "");
  const tipoDoDocumento = documento.length === 14 ? "CNPJ" : documento.length === 11 ? "CPF" : null;
  if (!tipoDoDocumento) faltam.push("CNPJ ou CPF válido");
  const email = cliente.email?.trim() ?? "";
  if (!/^\S+@\S+\.\S+$/.test(email)) faltam.push("e-mail");
  const nome = cliente.companyName.replace(/\s+/g, " ").trim();
  if (nome.length < 2) faltam.push("razão social");

  if (faltam.length > 0 || !tipoDoDocumento) {
    return { pagador: null, erro: `Para gerar a cobrança, falta no cadastro do cliente: ${faltam.join(", ")}.` };
  }

  let endereco: EnderecoDoPagador | undefined;
  if (tipo === "BOLETO") {
    const lido = enderecoDoPagador(cliente.address);
    if (!lido.endereco) {
      return { pagador: null, erro: `Para gerar boleto, falta no endereço do cadastro do cliente: ${lido.faltam.join(", ")}. Escreva o endereço como "${FORMATO_DO_ENDERECO}".` };
    }
    endereco = lido.endereco;
  }

  // O Mercado Pago pede nome e sobrenome; de uma razão social, a primeira palavra e o resto.
  const espaco = nome.indexOf(" ");
  const primeiro = espaco === -1 ? nome : nome.slice(0, espaco);
  const restante = espaco === -1 ? nome : nome.slice(espaco + 1);
  return {
    pagador: {
      email,
      first_name: primeiro.slice(0, 100),
      last_name: restante.slice(0, 100),
      identification: { type: tipoDoDocumento, number: documento },
      ...(endereco && { address: endereco }),
    },
    erro: null,
  };
}

/* ---------------------------------- Vencimento -------------------------------- */

const HORA_MS = 3_600_000;
const DIA_MS = 24 * HORA_MS;

// O Mercado Pago aceita vencimento de Pix entre 30 minutos e 30 dias depois da
// criação, e de boleto entre 1 e 30 dias (a documentação recomenda ao menos 3
// para o boleto compensar). Fatura vencida, ou que vence hoje, ganha esse prazo
// mínimo; fatura com vencimento distante fica no máximo.
const PRAZO_MINIMO_MS: Record<TipoDeCobranca, number> = { PIX: DIA_MS, BOLETO: 3 * DIA_MS };
const PRAZO_MAXIMO_MS = 29 * DIA_MS;

/**
 * Até quando a cobrança pode ser paga no gateway: o fim do dia do vencimento da
 * fatura (23:59:59 no Brasil), dentro dos limites do Mercado Pago.
 */
export function vencimentoDaCobranca(tipo: TipoDeCobranca, vencimentoDaFatura: Date, agora: Date = new Date()): Date {
  // O vencimento é um dia do calendário, gravado à meia-noite UTC: 23:59:59 de Brasília é 02:59:59 UTC do dia seguinte.
  const fimDoDia = vencimentoDaFatura.getTime() + DIA_MS + 3 * HORA_MS - 1000;
  const minimo = agora.getTime() + PRAZO_MINIMO_MS[tipo];
  const maximo = agora.getTime() + PRAZO_MAXIMO_MS;
  return new Date(Math.min(Math.max(fimDoDia, minimo), maximo));
}

/** A data como o Mercado Pago pede: `2026-10-20T23:59:59.000-03:00`. */
export function dataParaOGateway(instante: Date): string {
  return `${new Date(instante.getTime() - 3 * HORA_MS).toISOString().slice(0, 23)}-03:00`;
}

/* ------------------------------ Pedido de criação ----------------------------- */

const centavos = (valor: number) => Math.round((valor + Number.EPSILON) * 100) / 100;

export type PedidoDeCobranca = {
  tipo: TipoDeCobranca;
  fatura: { id: string; number: number; total: number };
  pagador: PagadorDaCobranca;
  venceEm: Date;
  /** Endereço público do webhook da empresa; `null` quando o sistema não está num endereço https. */
  webhook: string | null;
};

/** O corpo de `POST /v1/payments`. O `external_reference` é o id da fatura: é por ele que o aviso de pagamento é conferido. */
export function corpoDoPagamento({ tipo, fatura, pagador, venceEm, webhook }: PedidoDeCobranca): Record<string, unknown> {
  return {
    transaction_amount: centavos(fatura.total),
    description: `Fatura nº ${fatura.number}`,
    payment_method_id: METODO_NO_GATEWAY[tipo],
    external_reference: fatura.id,
    date_of_expiration: dataParaOGateway(venceEm),
    payer: pagador,
    ...(webhook && { notification_url: webhook }),
  };
}

/** O Mercado Pago só aceita `notification_url` https e público. */
export const webhookParaOGateway = (endereco: string): string | null => (/^https:\/\/[^/]+\.[^/]+/i.test(endereco) && !/^https:\/\/localhost\b/i.test(endereco) ? endereco : null);

/* ------------------------- O que fazer com um pagamento ------------------------ */

export type CobrancaAvaliada = { status: string; invoiceId: string; amount: number };
export type FaturaAvaliada = { status: string; total: number; number: number };

export type Decisao =
  /** Nada muda: pagamento ainda pendente, ou aviso repetido de algo já aplicado. */
  | { acao: "nada" }
  /** Paga a fatura (pelo mesmo caminho do Faturamento) e marca a cobrança como paga. */
  | { acao: "pagar"; encargos: Encargos; pagaEm: Date; valorPago: number }
  /** Não mexe na fatura; a cobrança fica "a conferir" com o motivo, e o financeiro é avisado. */
  | { acao: "conferir"; nota: string; valorPago: number | null; pagaEm: Date | null }
  /** A cobrança deixou de valer no gateway. */
  | { acao: "encerrar"; situacao: "CANCELLED" | "EXPIRED" };

const emReais = (valor: number) => valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/**
 * Decide o que fazer com o que o Mercado Pago respondeu sobre o pagamento de
 * uma cobrança. Função pura: o webhook, o "Atualizar situação" e a conferência
 * periódica passam todos por aqui.
 *
 * Só paga quando tudo fecha: pagamento aprovado, em reais, com a referência
 * desta fatura, do valor desta cobrança, e a fatura em aberto. A diferença
 * entre o valor da cobrança e o que o pagador pagou vira juros (a mais) ou
 * desconto (a menos), como na conciliação bancária. Qualquer outra coisa que
 * envolva dinheiro recebido fica "a conferir".
 */
export function decisaoDoPagamento(cobranca: CobrancaAvaliada, fatura: FaturaAvaliada, pagamento: Pagamento, agora: Date = new Date()): Decisao {
  const aberta = EM_ABERTO.includes(cobranca.status);

  if (pagamento.status === "approved") {
    // Aviso repetido: a baixa já foi dada por esta cobrança.
    if (cobranca.status === "PAID") return { acao: "nada" };

    const pago = pagamento.valorPago ?? pagamento.valor;
    // A data do gateway; se vier ausente ou no futuro, vale agora.
    const pagaEm = pagamento.aprovadoEm && pagamento.aprovadoEm.getTime() <= agora.getTime() + HORA_MS ? pagamento.aprovadoEm : agora;
    const conferir = (nota: string): Decisao => ({ acao: "conferir", nota, valorPago: pago, pagaEm });

    if (pagamento.externalReference !== cobranca.invoiceId) return conferir("O pagamento aprovado no Mercado Pago não traz a referência desta fatura.");
    if (pagamento.moeda !== null && pagamento.moeda !== "BRL") return conferir(`O pagamento aprovado no Mercado Pago está em ${pagamento.moeda}, não em reais.`);
    if (pagamento.valor === null || centavos(pagamento.valor) !== centavos(cobranca.amount)) {
      return conferir(`O valor da cobrança no Mercado Pago (${pagamento.valor === null ? "não informado" : emReais(pagamento.valor)}) não é o desta cobrança (${emReais(cobranca.amount)}).`);
    }
    if (pago === null || !(pago > 0)) return conferir("O Mercado Pago aprovou o pagamento sem dizer o valor pago.");
    if (fatura.status === "PAID") return conferir(`O Mercado Pago recebeu ${emReais(pago)}, mas a fatura já estava paga: confira se houve recebimento em dobro.`);
    if (fatura.status !== "OPEN") return conferir(`O Mercado Pago recebeu ${emReais(pago)} de uma fatura cancelada.`);

    const { encargos, erro } = encargosDaConciliacao({ type: "INCOME", amount: fatura.total }, pago);
    if (erro !== null) return conferir(erro);
    return { acao: "pagar", encargos, pagaEm, valorPago: centavos(pago) };
  }

  if (pagamento.status === "refunded" || pagamento.status === "charged_back") {
    if (cobranca.status === "PAID") {
      return { acao: "conferir", nota: "O pagamento foi estornado no Mercado Pago depois da baixa. A fatura continua paga no sistema: confira e acerte à mão.", valorPago: null, pagaEm: null };
    }
    return aberta ? { acao: "encerrar", situacao: "CANCELLED" } : { acao: "nada" };
  }

  if (pagamento.status === "cancelled" || pagamento.status === "rejected") {
    if (!aberta) return { acao: "nada" };
    return { acao: "encerrar", situacao: pagamento.status === "cancelled" && pagamento.statusDetail === "expired" ? "EXPIRED" : "CANCELLED" };
  }

  // pending, in_process, authorized, in_mediation e o que vier de novo: espera.
  return { acao: "nada" };
}

/** Pix ou boleto em aberto de uma fatura, para os avisos e para o portal: o mais novo de cada tipo. */
export function cobrancasEmAberto<T extends { kind: string; status: string; createdAt: Date }>(cobrancas: readonly T[]): { pix: T | null; boleto: T | null } {
  const maisNova = (tipo: TipoDeCobranca) =>
    cobrancas.filter((cobranca) => cobranca.kind === tipo && cobranca.status === "PENDING").sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
  return { pix: maisNova("PIX"), boleto: maisNova("BOLETO") };
}
