import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Cliente HTTP do Mercado Pago: só `fetch`, sem dependência. Cada chamada leva
 * o Access Token da empresa dona da cobrança (cada transportadora liga a
 * própria conta), tem tempo limite e devolve erro já em português.
 *
 * `MERCADO_PAGO_API` troca o endereço da API (padrão
 * `https://api.mercadopago.com`): é por ela que os testes apontam para um
 * servidor local que imita a API. Nenhum teste chama o Mercado Pago de verdade.
 *
 * O token nunca entra em mensagem de erro nem em log: `MercadoPagoError` só
 * carrega o status e um texto montado aqui.
 *
 * Só o servidor importa este arquivo.
 */

const API_PADRAO = "https://api.mercadopago.com";
const TEMPO_LIMITE_MS = 10_000;

const enderecoDaApi = () => (process.env.MERCADO_PAGO_API || API_PADRAO).replace(/\/+$/, "");

export class MercadoPagoError extends Error {
  /** Status HTTP da resposta; `null` quando não houve resposta. */
  readonly status: number | null;
  /**
   * Não dá para saber se o pedido foi aplicado (sem resposta, tempo esgotado,
   * erro 5xx). Numa criação, o pagamento pode ter nascido: quem chama repete
   * com a mesma chave de idempotência em vez de criar outro.
   */
  readonly incerto: boolean;

  constructor(mensagem: string, status: number | null, incerto: boolean) {
    super(mensagem);
    this.name = "MercadoPagoError";
    this.status = status;
    this.incerto = incerto;
  }
}

export const SEM_RESPOSTA = "O Mercado Pago não respondeu a tempo. Tente de novo em instantes.";
export const TOKEN_RECUSADO = "O Mercado Pago recusou o Access Token. Confira a credencial em Empresa > Cobrança.";

const texto = (valor: unknown): string | null => (typeof valor === "string" && valor.trim() !== "" ? valor.trim() : null);
const numero = (valor: unknown): number | null => (typeof valor === "number" && Number.isFinite(valor) ? valor : null);
const objeto = (valor: unknown): Record<string, unknown> => (valor && typeof valor === "object" && !Array.isArray(valor) ? (valor as Record<string, unknown>) : {});

/** O motivo que o Mercado Pago deu, para a pessoa: a mensagem e as causas, cortadas. */
function motivo(corpo: unknown): string {
  const dados = objeto(corpo);
  const causas = Array.isArray(dados.cause) ? dados.cause.map((causa) => texto(objeto(causa).description)).filter(Boolean) : [];
  const partes = [texto(dados.message), ...causas].filter((parte): parte is string => Boolean(parte));
  return [...new Set(partes)].join("; ").slice(0, 300);
}

type Chamada = { metodo?: "GET" | "POST"; corpo?: unknown; idempotencia?: string };

async function chamar(token: string, caminho: string, { metodo = "GET", corpo, idempotencia }: Chamada = {}): Promise<{ status: number; corpo: unknown }> {
  let res: Response;
  try {
    res = await fetch(`${enderecoDaApi()}${caminho}`, {
      method: metodo,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        ...(corpo !== undefined && { "Content-Type": "application/json" }),
        ...(idempotencia && { "X-Idempotency-Key": idempotencia }),
      },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      // A API não redireciona; seguir um redirecionamento levaria o token para outro endereço.
      redirect: "error",
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
    });
  } catch {
    throw new MercadoPagoError(SEM_RESPOSTA, null, true);
  }

  const lido = await res.json().catch(() => null);
  if (res.status >= 200 && res.status < 300) return { status: res.status, corpo: lido };
  if (res.status === 404) return { status: 404, corpo: lido };
  if (res.status === 401 || res.status === 403) throw new MercadoPagoError(TOKEN_RECUSADO, res.status, false);
  if (res.status === 429) throw new MercadoPagoError("O Mercado Pago pediu para esperar: muitas chamadas em pouco tempo. Tente de novo em instantes.", 429, false);
  if (res.status >= 500) throw new MercadoPagoError("O Mercado Pago está com erro no momento. Tente de novo em instantes.", res.status, true);
  const porque = motivo(lido);
  throw new MercadoPagoError(`O Mercado Pago recusou o pedido${porque ? `: ${porque}` : "."}`, res.status, false);
}

/* ----------------------------------- Conta ----------------------------------- */

export type ContaDoMercadoPago = { id: string; nome: string };

/** A conta dona do token (`GET /users/me`): é o "Testar conexão". */
export async function contaDoMercadoPago(token: string): Promise<ContaDoMercadoPago> {
  const { status, corpo } = await chamar(token, "/users/me");
  const dados = objeto(corpo);
  const id = texto(dados.id) ?? (numero(dados.id) !== null ? String(dados.id) : null);
  if (status === 404 || !id) throw new MercadoPagoError("O Mercado Pago não devolveu a conta deste Access Token.", status, false);
  const nome = texto(dados.nickname) ?? [texto(dados.first_name), texto(dados.last_name)].filter(Boolean).join(" ");
  return { id, nome: nome || `Conta ${id}` };
}

/* --------------------------------- Pagamento --------------------------------- */

/** O pagamento como o resto do sistema lê: só o que interessa, já conferido de tipo. */
export type Pagamento = {
  id: string;
  /** pending, approved, authorized, in_process, in_mediation, rejected, cancelled, refunded, charged_back */
  status: string;
  statusDetail: string | null;
  externalReference: string | null;
  /** `transaction_amount`: o valor da cobrança. */
  valor: number | null;
  /** `transaction_details.total_paid_amount`: quanto o pagador pagou. */
  valorPago: number | null;
  moeda: string | null;
  /** `payment_method_id`: `pix`, `bolbradesco`... */
  metodo: string | null;
  aprovadoEm: Date | null;
  expiraEm: Date | null;
  pixCopiaECola: string | null;
  qrCodeBase64: string | null;
  /** Página do Pix (`ticket_url`) ou do boleto (`external_resource_url`). */
  link: string | null;
  linhaDigitavel: string | null;
};

const data = (valor: unknown): Date | null => {
  const lido = texto(valor);
  if (!lido) return null;
  const instante = new Date(lido);
  return Number.isNaN(instante.getTime()) ? null : instante;
};

const linkSeguro = (valor: unknown): string | null => {
  const lido = texto(valor);
  return lido && /^https:\/\//i.test(lido) ? lido : null;
};

/** Lê a resposta de `/v1/payments`. Sem `id` ou sem `status` não é um pagamento: `null`. */
export function lerPagamento(corpo: unknown): Pagamento | null {
  const dados = objeto(corpo);
  const id = texto(dados.id) ?? (numero(dados.id) !== null ? String(dados.id) : null);
  const status = texto(dados.status);
  if (!id || !ID_DE_PAGAMENTO.test(id) || !status) return null;
  const detalhes = objeto(dados.transaction_details);
  const transacao = objeto(objeto(dados.point_of_interaction).transaction_data);
  return {
    id,
    status,
    statusDetail: texto(dados.status_detail),
    externalReference: texto(dados.external_reference),
    valor: numero(dados.transaction_amount),
    valorPago: numero(detalhes.total_paid_amount),
    moeda: texto(dados.currency_id),
    metodo: texto(dados.payment_method_id),
    aprovadoEm: data(dados.date_approved),
    expiraEm: data(dados.date_of_expiration),
    pixCopiaECola: texto(transacao.qr_code),
    qrCodeBase64: texto(transacao.qr_code_base64),
    link: linkSeguro(transacao.ticket_url) ?? linkSeguro(detalhes.external_resource_url),
    linhaDigitavel: texto(detalhes.digitable_line),
  };
}

/** O id de pagamento do Mercado Pago é numérico. Qualquer outra coisa não vai para a URL. */
export const ID_DE_PAGAMENTO = /^\d{1,30}$/;

/**
 * Cria o pagamento (`POST /v1/payments`). A chave de idempotência é obrigatória:
 * repetir o pedido com a mesma chave devolve o mesmo pagamento.
 */
export async function criarPagamento(token: string, corpo: Record<string, unknown>, idempotencia: string): Promise<Pagamento> {
  const resposta = await chamar(token, "/v1/payments", { metodo: "POST", corpo, idempotencia });
  const pagamento = resposta.status === 404 ? null : lerPagamento(resposta.corpo);
  // Resposta 2xx que não é um pagamento: não dá para saber o que nasceu lá.
  if (!pagamento) throw new MercadoPagoError("O Mercado Pago respondeu sem os dados do pagamento.", resposta.status, true);
  return pagamento;
}

/** Consulta o pagamento (`GET /v1/payments/{id}`). `null` quando ele não existe na conta deste token. */
export async function buscarPagamento(token: string, id: string): Promise<Pagamento | null> {
  if (!ID_DE_PAGAMENTO.test(id)) return null;
  const resposta = await chamar(token, `/v1/payments/${id}`);
  if (resposta.status === 404) return null;
  const pagamento = lerPagamento(resposta.corpo);
  // Um pagamento com outro id não é o que foi pedido.
  if (!pagamento || pagamento.id !== id) throw new MercadoPagoError("O Mercado Pago respondeu sem os dados do pagamento.", resposta.status, true);
  return pagamento;
}

/* ---------------------------- Assinatura do webhook --------------------------- */

export type DadosDaAssinatura = {
  /** Cabeçalho `x-signature`: `ts=...,v1=...`. */
  assinatura: string | null | undefined;
  /** Cabeçalho `x-request-id`. */
  requestId: string | null | undefined;
  /** Parâmetro `data.id` da URL do aviso. */
  dataId: string | null | undefined;
};

/** Separa `ts` e `v1` do cabeçalho `x-signature`. */
export function partesDaAssinatura(assinatura: string | null | undefined): { ts: string | null; v1: string | null } {
  let ts: string | null = null;
  let v1: string | null = null;
  for (const parte of (assinatura ?? "").split(",")) {
    const igual = parte.indexOf("=");
    if (igual === -1) continue;
    const chave = parte.slice(0, igual).trim();
    const valor = parte.slice(igual + 1).trim();
    if (chave === "ts") ts = valor;
    if (chave === "v1") v1 = valor;
  }
  return { ts, v1 };
}

/**
 * O texto que o Mercado Pago assina: `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`.
 * Como a documentação manda, o `data.id` vai em minúsculas e o par cujo valor
 * não veio no aviso fica de fora.
 */
export function manifestoDaAssinatura({ dataId, requestId, ts }: { dataId?: string | null; requestId?: string | null; ts: string }): string {
  const partes: string[] = [];
  if (dataId) partes.push(`id:${dataId.toLowerCase()}`);
  if (requestId) partes.push(`request-id:${requestId}`);
  partes.push(`ts:${ts}`);
  return `${partes.join(";")};`;
}

/** A assinatura (`v1`) de um aviso: HMAC-SHA256 do manifesto com o segredo, em hexadecimal. */
export const assinarManifesto = (segredo: string, manifesto: string) => createHmac("sha256", segredo).update(manifesto).digest("hex");

/** O aviso veio do Mercado Pago? Confere o `v1` do cabeçalho com o segredo da empresa, em tempo constante. */
export function assinaturaValida(dados: DadosDaAssinatura, segredo: string): boolean {
  const { ts, v1 } = partesDaAssinatura(dados.assinatura);
  if (!segredo || !ts || !v1 || !/^[0-9a-f]{64}$/i.test(v1)) return false;
  const esperado = Buffer.from(assinarManifesto(segredo, manifestoDaAssinatura({ dataId: dados.dataId, requestId: dados.requestId, ts })), "hex");
  const recebido = Buffer.from(v1, "hex");
  return esperado.length === recebido.length && timingSafeEqual(esperado, recebido);
}
