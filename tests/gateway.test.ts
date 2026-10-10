import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getServerSession } from "next-auth";
import { CifraError, cifraLigada, cifrar, decifrar } from "../src/lib/cifra";
import { assinarManifesto, assinaturaValida, lerPagamento, manifestoDaAssinatura, partesDaAssinatura, type Pagamento } from "../src/lib/mercado-pago";
import {
  FORMATO_DO_ENDERECO,
  cobrancasEmAberto,
  corpoDoPagamento,
  credenciaisDoGatewaySchema,
  criarCobrancaSchema,
  dataParaOGateway,
  decisaoDoPagamento,
  enderecoDoPagador,
  enderecoDoWebhook,
  pagadorDaCobranca,
  vencimentoDaCobranca,
  webhookParaOGateway,
  type CobrancaDaTela,
  type GatewayDaEmpresa,
} from "../src/lib/cobranca-gateway";
import { CAPACIDADES } from "../src/lib/permissoes";
import { EMPRESA_OUTRA, EMPRESA_PADRAO } from "./empresas-de-teste";

/**
 * Cobrança pelo Mercado Pago: a cifra das credenciais, a assinatura do webhook,
 * as regras (pagador, vencimento, o que fazer com um pagamento) e as rotas.
 *
 * Nenhum teste chama o Mercado Pago de verdade: `MERCADO_PAGO_API` aponta para
 * um servidor HTTP local, criado aqui, que imita `/users/me` e `/v1/payments`.
 */
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

/* ---------------------------------- A cifra ---------------------------------- */

describe("cifra dos dados guardados (AES-256-GCM)", () => {
  const anterior = process.env.TMS_CHAVE_DE_DADOS;
  const CHAVE = "chave-de-teste-com-mais-de-trinta-e-dois-caracteres";
  afterAll(() => {
    if (anterior === undefined) delete process.env.TMS_CHAVE_DE_DADOS;
    else process.env.TMS_CHAVE_DE_DADOS = anterior;
  });

  it("ida e volta, e o mesmo texto nunca cifra igual duas vezes", () => {
    process.env.TMS_CHAVE_DE_DADOS = CHAVE;
    expect(cifraLigada()).toBe(true);
    const cifrado = cifrar("APP_USR-segredo-de-verdade", "empresa:campo");
    expect(cifrado).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(cifrado).not.toContain("APP_USR");
    expect(decifrar(cifrado, "empresa:campo")).toBe("APP_USR-segredo-de-verdade");
    expect(cifrar("APP_USR-segredo-de-verdade", "empresa:campo")).not.toBe(cifrado);
    expect(decifrar(cifrar("", "x"), "x")).toBe("");
    expect(decifrar(cifrar("ação çãõ 💳", "x"), "x")).toBe("ação çãõ 💳");
  });

  it("chave errada, contexto errado e conteúdo adulterado não abrem", () => {
    process.env.TMS_CHAVE_DE_DADOS = CHAVE;
    const cifrado = cifrar("segredo", "empresa-a:token");
    // Outro campo, ou outra empresa: o texto cifrado copiado não serve.
    expect(() => decifrar(cifrado, "empresa-b:token")).toThrow(CifraError);
    const [versao, iv, etiqueta, dados] = cifrado.split(".");
    const trocado = dados.startsWith("A") ? `B${dados.slice(1)}` : `A${dados.slice(1)}`;
    expect(() => decifrar([versao, iv, etiqueta, trocado].join("."), "empresa-a:token")).toThrow(CifraError);
    expect(() => decifrar("v2.a.b.c", "empresa-a:token")).toThrow(CifraError);
    expect(() => decifrar("texto em claro", "empresa-a:token")).toThrow(CifraError);

    process.env.TMS_CHAVE_DE_DADOS = "outra-chave-de-teste-com-mais-de-trinta-e-dois-caracteres";
    expect(() => decifrar(cifrado, "empresa-a:token")).toThrow(CifraError);
    // A mensagem não leva o conteúdo.
    try {
      decifrar(cifrado, "empresa-a:token");
    } catch (erro) {
      expect((erro as Error).message).not.toContain("segredo");
    }
  });

  it("sem a variável (ou com valor curto demais) não há cifra", () => {
    delete process.env.TMS_CHAVE_DE_DADOS;
    expect(cifraLigada()).toBe(false);
    expect(() => cifrar("x", "y")).toThrow(CifraError);
    expect(() => decifrar("v1.a.b.c", "y")).toThrow(CifraError);
    process.env.TMS_CHAVE_DE_DADOS = "curta";
    expect(cifraLigada()).toBe(false);
    process.env.TMS_CHAVE_DE_DADOS = "   ";
    expect(cifraLigada()).toBe(false);
  });
});

/* ------------------------------ Assinatura do aviso ---------------------------- */

describe("assinatura do webhook do Mercado Pago", () => {
  // Montado como a documentação descreve: manifesto `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`,
  // HMAC-SHA256 com a assinatura secreta, em hexadecimal, no cabeçalho `x-signature: ts=...,v1=...`.
  const SEGREDO = "assinatura-secreta-do-painel";
  const REQUEST_ID = "bb56a2f1-6aae-46ac-982e-9dcd3581d08e";
  const TS = "1742505638683";
  const v1 = assinarManifesto(SEGREDO, `id:123456;request-id:${REQUEST_ID};ts:${TS};`);
  const cabecalho = `ts=${TS},v1=${v1}`;

  it("monta o manifesto da documentação e confere a assinatura", () => {
    expect(manifestoDaAssinatura({ dataId: "123456", requestId: REQUEST_ID, ts: TS })).toBe(`id:123456;request-id:${REQUEST_ID};ts:${TS};`);
    expect(partesDaAssinatura(` ts=${TS} , v1=${v1} `)).toEqual({ ts: TS, v1 });
    expect(v1).toMatch(/^[0-9a-f]{64}$/);
    expect(assinaturaValida({ assinatura: cabecalho, requestId: REQUEST_ID, dataId: "123456" }, SEGREDO)).toBe(true);
  });

  it("o data.id vai em minúsculas, e o par que não veio fica fora do manifesto", () => {
    expect(manifestoDaAssinatura({ dataId: "ABC123", requestId: REQUEST_ID, ts: TS })).toBe(`id:abc123;request-id:${REQUEST_ID};ts:${TS};`);
    expect(manifestoDaAssinatura({ dataId: "", requestId: REQUEST_ID, ts: TS })).toBe(`request-id:${REQUEST_ID};ts:${TS};`);
    expect(manifestoDaAssinatura({ dataId: "9", requestId: null, ts: TS })).toBe(`id:9;ts:${TS};`);
    const semRequestId = assinarManifesto(SEGREDO, `id:9;ts:${TS};`);
    expect(assinaturaValida({ assinatura: `ts=${TS},v1=${semRequestId}`, requestId: null, dataId: "9" }, SEGREDO)).toBe(true);
  });

  it("recusa segredo errado, id trocado, request-id trocado, ts trocado e cabeçalho malformado", () => {
    const dados = { assinatura: cabecalho, requestId: REQUEST_ID, dataId: "123456" };
    expect(assinaturaValida(dados, "outro-segredo")).toBe(false);
    expect(assinaturaValida(dados, "")).toBe(false);
    expect(assinaturaValida({ ...dados, dataId: "123457" }, SEGREDO)).toBe(false);
    expect(assinaturaValida({ ...dados, requestId: "outro" }, SEGREDO)).toBe(false);
    expect(assinaturaValida({ ...dados, assinatura: `ts=1,v1=${v1}` }, SEGREDO)).toBe(false);
    for (const assinatura of [null, undefined, "", "v1=abc", `ts=${TS}`, `ts=${TS},v1=xyz`, `ts=${TS},v1=${v1.slice(0, 20)}`, `ts=${TS},v1=${v1}00`]) {
      expect(assinaturaValida({ ...dados, assinatura }, SEGREDO), String(assinatura)).toBe(false);
    }
  });
});

/* ------------------------------------ Regras ---------------------------------- */

describe("regras da cobrança pelo gateway", () => {
  it("valida as credenciais e o tipo de cobrança", () => {
    expect(credenciaisDoGatewaySchema.safeParse({ accessToken: " APP_USR-1234567890123456-abc ", webhookSecret: " segredo-do-painel " })).toMatchObject({
      success: true,
      data: { accessToken: "APP_USR-1234567890123456-abc", webhookSecret: "segredo-do-painel" },
    });
    for (const corpo of [null, {}, { accessToken: "curto", webhookSecret: "segredo-do-painel" }, { accessToken: "APP_USR-1234567890123456-abc" }, { accessToken: "APP_USR 1234567890123456 abc", webhookSecret: "segredo-do-painel" }, { accessToken: "APP_USR-1234567890123456-abc", webhookSecret: "curto" }]) {
      expect(credenciaisDoGatewaySchema.safeParse(corpo).success, JSON.stringify(corpo)).toBe(false);
    }
    expect(criarCobrancaSchema.safeParse({ tipo: "PIX" }).success).toBe(true);
    expect(criarCobrancaSchema.safeParse({ tipo: "BOLETO" }).success).toBe(true);
    for (const corpo of [null, {}, { tipo: "CARTAO" }, { tipo: "pix" }]) expect(criarCobrancaSchema.safeParse(corpo).success).toBe(false);
  });

  it("o endereço de webhook leva o slug da empresa, e só endereço https público vai para o Mercado Pago", () => {
    expect(enderecoDoWebhook("https://tms.exemplo.br/", "mello")).toBe("https://tms.exemplo.br/api/pagamentos/mercado-pago/mello");
    expect(webhookParaOGateway("https://tms.exemplo.br/api/pagamentos/mercado-pago/mello")).toBe("https://tms.exemplo.br/api/pagamentos/mercado-pago/mello");
    for (const endereco of ["http://tms.exemplo.br/x", "https://localhost/x", "/api/pagamentos/mercado-pago/mello", ""]) expect(webhookParaOGateway(endereco), endereco).toBeNull();
  });

  it("lê o endereço do cadastro no formato da busca por CNPJ, com o CEP em qualquer lugar", () => {
    const esperado = { zip_code: "15130000", street_name: "Rua das Flores", street_number: "123", neighborhood: "Centro", city: "Mirassol", federal_unit: "SP" };
    for (const endereco of [
      "Rua das Flores, 123 - Centro, Mirassol - SP, CEP 15130-000",
      "Rua das Flores, 123 - Centro, Mirassol - SP 15130000",
      "Rua das Flores, 123 - Centro, Mirassol/SP - CEP: 15130-000",
      "CEP 15130-000 Rua das Flores, 123 - Centro, Mirassol - sp",
    ]) {
      expect(enderecoDoPagador(endereco), endereco).toEqual({ endereco: esperado, faltam: [] });
    }
    expect(enderecoDoPagador("Av. Brasil, S/N - Distrito Industrial, São José do Rio Preto - SP, 15035-000").endereco).toMatchObject({ street_number: "S/N", city: "São José do Rio Preto", neighborhood: "Distrito Industrial" });
  });

  it("endereço incompleto diz o que falta, sem inventar", () => {
    expect(enderecoDoPagador(null)).toMatchObject({ endereco: null });
    expect(enderecoDoPagador("").faltam).toEqual(expect.arrayContaining(["CEP", "UF", "rua", "número", "bairro", "cidade"]));
    expect(enderecoDoPagador("Rua das Flores, 123 - Centro, Mirassol - SP").faltam).toEqual(["CEP"]);
    expect(enderecoDoPagador("Rua das Flores, 123 - Centro, Mirassol, CEP 15130-000").faltam).toContain("UF");
    expect(enderecoDoPagador("Rua das Flores - Centro, Mirassol - SP, CEP 15130-000").faltam).toEqual(["número"]);
    expect(enderecoDoPagador("Rua das Flores, 123, Mirassol - SP, CEP 15130-000").faltam).toContain("bairro");
  });

  it("monta o pagador do cadastro do cliente: Pix pede e-mail e documento; boleto pede também o endereço", () => {
    const cliente = { companyName: "Comercial Aurora Ltda", cnpj: "12.345.678/0001-95", email: " financeiro@aurora.exemplo.br ", address: "Rua das Flores, 123 - Centro, Mirassol - SP, CEP 15130-000" };
    expect(pagadorDaCobranca("PIX", cliente)).toEqual({
      erro: null,
      pagador: { email: "financeiro@aurora.exemplo.br", first_name: "Comercial", last_name: "Aurora Ltda", identification: { type: "CNPJ", number: "12345678000195" } },
    });
    expect(pagadorDaCobranca("BOLETO", cliente).pagador).toMatchObject({ address: { zip_code: "15130000", federal_unit: "SP" }, identification: { type: "CNPJ" } });
    expect(pagadorDaCobranca("PIX", { ...cliente, cnpj: "12345678909", companyName: "Fulano" }).pagador).toMatchObject({ identification: { type: "CPF", number: "12345678909" }, first_name: "Fulano", last_name: "Fulano" });

    expect(pagadorDaCobranca("PIX", { ...cliente, email: null })).toEqual({ pagador: null, erro: "Para gerar a cobrança, falta no cadastro do cliente: e-mail." });
    expect(pagadorDaCobranca("PIX", { ...cliente, cnpj: "123", email: "" }).erro).toBe("Para gerar a cobrança, falta no cadastro do cliente: CNPJ ou CPF válido, e-mail.");
    // O Pix não precisa de endereço; o boleto sim, e o erro diz o que falta.
    expect(pagadorDaCobranca("PIX", { ...cliente, address: null }).erro).toBeNull();
    const semEndereco = pagadorDaCobranca("BOLETO", { ...cliente, address: "Rua das Flores, 123 - Centro, Mirassol - SP" });
    expect(semEndereco.pagador).toBeNull();
    expect(semEndereco.erro).toBe(`Para gerar boleto, falta no endereço do cadastro do cliente: CEP. Escreva o endereço como "${FORMATO_DO_ENDERECO}".`);
  });

  it("o vencimento da cobrança é o fim do dia do vencimento da fatura, dentro dos limites do Mercado Pago", () => {
    const agora = new Date("2026-10-10T15:00:00.000Z");
    const dia = (d: string) => new Date(`${d}T00:00:00.000Z`);
    // Vence em 5 dias: 23:59:59 de Brasília do dia 15.
    expect(vencimentoDaCobranca("PIX", dia("2026-10-15"), agora).toISOString()).toBe("2026-10-16T02:59:59.000Z");
    expect(dataParaOGateway(vencimentoDaCobranca("BOLETO", dia("2026-10-15"), agora))).toBe("2026-10-15T23:59:59.000-03:00");
    // Fatura vencida, ou que vence hoje: prazo mínimo (1 dia no Pix, 3 no boleto).
    expect(vencimentoDaCobranca("PIX", dia("2026-09-01"), agora).toISOString()).toBe("2026-10-11T15:00:00.000Z");
    expect(vencimentoDaCobranca("BOLETO", dia("2026-10-10"), agora).toISOString()).toBe("2026-10-13T15:00:00.000Z");
    // Vencimento distante: o máximo que o Mercado Pago aceita com folga (29 dias).
    expect(vencimentoDaCobranca("PIX", dia("2027-01-10"), agora).toISOString()).toBe("2026-11-08T15:00:00.000Z");
    expect(dataParaOGateway(new Date("2026-10-11T01:30:00.123Z"))).toBe("2026-10-10T22:30:00.123-03:00");
  });

  it("o pedido leva a fatura como referência, o valor em centavos certos e o endereço de aviso", () => {
    const pagador = pagadorDaCobranca("PIX", { companyName: "Comercial Aurora Ltda", cnpj: "12345678000195", email: "a@b.co", address: null }).pagador!;
    const corpo = corpoDoPagamento({ tipo: "PIX", fatura: { id: "fatura-1", number: 42, total: 150.129 }, pagador, venceEm: new Date("2026-10-16T02:59:59.000Z"), webhook: "https://tms.exemplo.br/api/pagamentos/mercado-pago/mello" });
    expect(corpo).toEqual({
      transaction_amount: 150.13,
      description: "Fatura nº 42",
      payment_method_id: "pix",
      external_reference: "fatura-1",
      date_of_expiration: "2026-10-15T23:59:59.000-03:00",
      payer: pagador,
      notification_url: "https://tms.exemplo.br/api/pagamentos/mercado-pago/mello",
    });
    const boleto = corpoDoPagamento({ tipo: "BOLETO", fatura: { id: "fatura-1", number: 42, total: 150 }, pagador, venceEm: new Date("2026-10-16T02:59:59.000Z"), webhook: null });
    expect(boleto.payment_method_id).toBe("bolbradesco");
    expect("notification_url" in boleto).toBe(false);
  });

  it("lê a resposta de /v1/payments sem confiar na forma", () => {
    expect(lerPagamento(null)).toBeNull();
    expect(lerPagamento({ status: "approved" })).toBeNull();
    expect(lerPagamento({ id: "abc; DROP", status: "approved" })).toBeNull();
    expect(
      lerPagamento({
        id: 5466310457,
        status: "pending",
        status_detail: "pending_waiting_transfer",
        external_reference: "fatura-1",
        transaction_amount: 100,
        currency_id: "BRL",
        payment_method_id: "pix",
        date_of_expiration: "2026-10-15T23:59:59.000-03:00",
        transaction_details: { total_paid_amount: 100, external_resource_url: null },
        point_of_interaction: { transaction_data: { qr_code: "00020126...", qr_code_base64: "iVBORw0KGgo=", ticket_url: "https://www.mercadopago.com.br/payments/5466310457/ticket" } },
      }),
    ).toEqual({
      id: "5466310457",
      status: "pending",
      statusDetail: "pending_waiting_transfer",
      externalReference: "fatura-1",
      valor: 100,
      valorPago: 100,
      moeda: "BRL",
      metodo: "pix",
      aprovadoEm: null,
      expiraEm: new Date("2026-10-16T02:59:59.000Z"),
      pixCopiaECola: "00020126...",
      qrCodeBase64: "iVBORw0KGgo=",
      link: "https://www.mercadopago.com.br/payments/5466310457/ticket",
      linhaDigitavel: null,
    });
    // Link que não é https não vira link na tela.
    expect(lerPagamento({ id: "1", status: "pending", transaction_details: { external_resource_url: "javascript:alert(1)" } })?.link).toBeNull();
  });

  describe("o que fazer com um pagamento", () => {
    const agora = new Date("2026-10-10T15:00:00.000Z");
    const cobranca = { status: "PENDING", invoiceId: "fatura-1", amount: 150 };
    const fatura = { status: "OPEN", total: 150, number: 42 };
    const pagamento = (dados: Partial<Pagamento>): Pagamento => ({
      id: "900",
      status: "approved",
      statusDetail: "accredited",
      externalReference: "fatura-1",
      valor: 150,
      valorPago: 150,
      moeda: "BRL",
      metodo: "pix",
      aprovadoEm: new Date("2026-10-09T18:30:00.000Z"),
      expiraEm: null,
      pixCopiaECola: null,
      qrCodeBase64: null,
      link: null,
      linhaDigitavel: null,
      ...dados,
    });

    it("aprovado, do valor certo, em fatura aberta: paga com a data do gateway", () => {
      expect(decisaoDoPagamento(cobranca, fatura, pagamento({}), agora)).toEqual({ acao: "pagar", encargos: {}, pagaEm: new Date("2026-10-09T18:30:00.000Z"), valorPago: 150 });
      // Sem data, ou com data no futuro: agora.
      expect(decisaoDoPagamento(cobranca, fatura, pagamento({ aprovadoEm: null }), agora)).toMatchObject({ acao: "pagar", pagaEm: agora });
      expect(decisaoDoPagamento(cobranca, fatura, pagamento({ aprovadoEm: new Date("2027-01-01T00:00:00.000Z") }), agora)).toMatchObject({ acao: "pagar", pagaEm: agora });
    });

    it("pagou a mais vira juros; a menos, desconto (como na conciliação)", () => {
      expect(decisaoDoPagamento(cobranca, fatura, pagamento({ valorPago: 153.5 }), agora)).toMatchObject({ acao: "pagar", encargos: { juros: 3.5 }, valorPago: 153.5 });
      expect(decisaoDoPagamento(cobranca, fatura, pagamento({ valorPago: 149 }), agora)).toMatchObject({ acao: "pagar", encargos: { desconto: 1 }, valorPago: 149 });
      // Sem o valor pago, vale o valor da cobrança.
      expect(decisaoDoPagamento(cobranca, fatura, pagamento({ valorPago: null }), agora)).toMatchObject({ acao: "pagar", encargos: {}, valorPago: 150 });
    });

    it("na dúvida não paga: fica a conferir", () => {
      const casos: [string, Partial<Pagamento>, typeof fatura][] = [
        ["referência de outra fatura", { externalReference: "fatura-2" }, fatura],
        ["sem referência", { externalReference: null }, fatura],
        ["outra moeda", { moeda: "ARS" }, fatura],
        ["cobrança de outro valor no gateway", { valor: 15 }, fatura],
        ["sem valor", { valor: null, valorPago: null }, fatura],
        ["valor pago zerado", { valorPago: 0 }, fatura],
        ["fatura já paga por fora", {}, { ...fatura, status: "PAID" }],
        ["fatura cancelada", {}, { ...fatura, status: "CANCELLED" }],
      ];
      for (const [nome, dados, daFatura] of casos) {
        const decisao = decisaoDoPagamento(cobranca, daFatura, pagamento(dados), agora);
        expect(decisao.acao, nome).toBe("conferir");
        if (decisao.acao === "conferir") expect(decisao.nota.length, nome).toBeGreaterThan(20);
      }
      expect(decisaoDoPagamento(cobranca, { ...fatura, status: "PAID" }, pagamento({}), agora)).toMatchObject({ nota: expect.stringContaining("recebimento em dobro") });
    });

    it("aviso repetido de cobrança já paga não faz nada; pendente espera", () => {
      expect(decisaoDoPagamento({ ...cobranca, status: "PAID" }, { ...fatura, status: "PAID" }, pagamento({}), agora)).toEqual({ acao: "nada" });
      for (const status of ["pending", "in_process", "authorized", "in_mediation", "novidade"]) {
        expect(decisaoDoPagamento(cobranca, fatura, pagamento({ status }), agora), status).toEqual({ acao: "nada" });
      }
    });

    it("cancelado, vencido, recusado e estornado", () => {
      expect(decisaoDoPagamento(cobranca, fatura, pagamento({ status: "cancelled", statusDetail: "expired" }), agora)).toEqual({ acao: "encerrar", situacao: "EXPIRED" });
      expect(decisaoDoPagamento(cobranca, fatura, pagamento({ status: "cancelled", statusDetail: "by_collector" }), agora)).toEqual({ acao: "encerrar", situacao: "CANCELLED" });
      expect(decisaoDoPagamento(cobranca, fatura, pagamento({ status: "rejected" }), agora)).toEqual({ acao: "encerrar", situacao: "CANCELLED" });
      // Cobrança já paga não volta a "cancelada" por um aviso atrasado.
      expect(decisaoDoPagamento({ ...cobranca, status: "PAID" }, fatura, pagamento({ status: "cancelled" }), agora)).toEqual({ acao: "nada" });
      // Estorno depois da baixa: o sistema não desfaz sozinho.
      expect(decisaoDoPagamento({ ...cobranca, status: "PAID" }, { ...fatura, status: "PAID" }, pagamento({ status: "refunded" }), agora)).toMatchObject({ acao: "conferir" });
      expect(decisaoDoPagamento(cobranca, fatura, pagamento({ status: "charged_back" }), agora)).toEqual({ acao: "encerrar", situacao: "CANCELLED" });
    });
  });

  it("escolhe a cobrança em aberto mais nova de cada tipo", () => {
    const c = (kind: string, status: string, dia: number) => ({ kind, status, createdAt: new Date(Date.UTC(2026, 9, dia)), dia });
    const { pix, boleto } = cobrancasEmAberto([c("PIX", "EXPIRED", 5), c("PIX", "PENDING", 2), c("PIX", "PENDING", 3), c("BOLETO", "PAID", 4)]);
    expect(pix?.dia).toBe(3);
    expect(boleto).toBeNull();
  });

  it("as rotas novas usam capacidades que já existiam: empresa (só administrador) e faturamento", () => {
    expect([...CAPACIDADES.empresa]).toEqual(["ADMIN"]);
    expect([...CAPACIDADES.faturamento]).toEqual(["ADMIN", "FINANCE"]);
  });
});

/* ------------------------------------ Rotas ----------------------------------- */

const temBanco = Boolean(process.env.DATABASE_URL);
if (!temBanco) {
  console.warn("\n[gateway.test] DATABASE_URL ausente: testes de integração PULADOS.\n");
}
const suite = temBanco ? describe : describe.skip;

const PREFIXO = "teste-gateway-";
const CNPJ = "99555444000171";
const CNPJ_SEM_DADOS = "99555444000252";
const CNPJ_DA_OUTRA = "99555444000333";
const HASH_FALSO = "$2b$10$hashfalsoparateste000000000000000000000000000000000";
const SEM_ID = "00000000-0000-0000-0000-000000000000";
const ENDERECO = "Rua das Flores, 123 - Centro, Mirassol - SP, CEP 15130-000";

// Credenciais inventadas: é por estes textos que os testes procuram vazamento.
const TOKEN_A = "APP_USR-1111111111111111-gateway-teste-empresa-a-QWERTY";
const SEGREDO_A = "assinatura-secreta-da-empresa-a-ZXCVBN";
const TOKEN_B = "APP_USR-2222222222222222-gateway-teste-empresa-b-ASDFGH";
const SEGREDO_B = "assinatura-secreta-da-empresa-b-POIUYT";

type Perfil = "ADMIN" | "FINANCE" | "DIRECTOR" | "OPERATION" | "CLIENTE" | "ADMIN_DA_OUTRA";
type Corpo = Record<string, unknown> & { error?: string };

/** Um pagamento guardado no Mercado Pago de mentira. O teste muda os campos para simular o que acontece lá. */
type PagamentoFalso = {
  id: string;
  conta: string;
  chave: string;
  pedido: Record<string, unknown>;
  status: string;
  status_detail: string;
  transaction_amount: number;
  total_paid_amount: number;
  external_reference: unknown;
  date_approved: string | null;
  currency_id: string;
};

suite("rotas da cobrança pelo Mercado Pago", () => {
  let banco: typeof import("../src/lib/prisma");
  let gatewayRota: typeof import("../src/app/api/empresa/gateway/route");
  let gatewayTeste: typeof import("../src/app/api/empresa/gateway/teste/route");
  let cobrancasRota: typeof import("../src/app/api/faturas/[id]/cobrancas/route");
  let cobrancaRota: typeof import("../src/app/api/faturas/[id]/cobrancas/[cobrancaId]/route");
  let webhookRota: typeof import("../src/app/api/pagamentos/mercado-pago/[empresa]/route");
  let faturas: typeof import("../src/app/api/faturas/route");
  let faturaPorId: typeof import("../src/app/api/faturas/[id]/route");
  let faturasDoPortal: typeof import("../src/app/api/portal/faturas/route");
  let webhookDaEmpresa: typeof import("../src/app/api/empresa/webhook/route");
  let eventos: typeof import("../src/lib/eventos");
  let gatewayDb: typeof import("../src/lib/cobranca-gateway-db");
  let limite: typeof import("../src/lib/rate-limit");

  const sessao = vi.mocked(getServerSession);
  const ids = {} as Record<Perfil, string>;
  let clienteId: string;
  let clienteSemDados: string;

  /* ------------------------- O Mercado Pago de mentira ------------------------ */

  let servidor: Server;
  let api: string;
  const CONTAS: Record<string, { id: string; nickname: string }> = {
    [TOKEN_A]: { id: "1001", nickname: "TRANSPORTADORA_A" },
    [TOKEN_B]: { id: "2002", nickname: "TRANSPORTADORA_B" },
  };
  const pagamentos = new Map<string, PagamentoFalso>();
  let pedidos: { metodo: string; caminho: string; chave: string | null; corpo: Record<string, unknown> | null }[] = [];
  let recebidosNoN8n: { tipo: string; dados: Record<string, Record<string, unknown> | null> }[] = [];
  /** Como o próximo `POST /v1/payments` se comporta; volta a "normal" depois de uma chamada. */
  let modo: "normal" | "recusa" | "queda" = "normal";
  let sequencia = 880_000;

  const ler = (req: IncomingMessage) =>
    new Promise<string>((resolve) => {
      let corpo = "";
      req.on("data", (pedaco) => (corpo += pedaco));
      req.on("end", () => resolve(corpo));
    });

  const comoAApiResponde = (p: PagamentoFalso) => ({
    id: Number(p.id),
    status: p.status,
    status_detail: p.status_detail,
    external_reference: p.external_reference,
    transaction_amount: p.transaction_amount,
    currency_id: p.currency_id,
    payment_method_id: p.pedido.payment_method_id,
    date_approved: p.date_approved,
    date_of_expiration: p.pedido.date_of_expiration,
    transaction_details: {
      total_paid_amount: p.total_paid_amount,
      external_resource_url: p.pedido.payment_method_id === "pix" ? null : `https://www.mercadopago.com.br/payments/${p.id}/ticket?boleto=1`,
      ...(p.pedido.payment_method_id !== "pix" && { digitable_line: "23793380296060054351030006333303799140000015000" }),
    },
    ...(p.pedido.payment_method_id === "pix" && {
      point_of_interaction: { transaction_data: { qr_code: `00020126580014br.gov.bcb.pix-FALSO-${p.id}`, qr_code_base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk", ticket_url: `https://www.mercadopago.com.br/payments/${p.id}/ticket` } },
    }),
  });

  /** Põe um pagamento direto na conta (como se tivesse nascido fora do TMS). */
  const pagamentoAvulso = (conta: string, dados: Partial<PagamentoFalso>): PagamentoFalso => {
    const id = String(++sequencia);
    const p: PagamentoFalso = { id, conta, chave: randomUUID(), pedido: { payment_method_id: "pix" }, status: "approved", status_detail: "accredited", transaction_amount: 150, total_paid_amount: 150, external_reference: null, date_approved: "2024-03-05T14:30:00.000-04:00", currency_id: "BRL", ...dados };
    pagamentos.set(id, p);
    return p;
  };

  async function atender(req: IncomingMessage): Promise<{ status: number; corpo: unknown }> {
    const caminho = req.url ?? "";
    const texto = await ler(req);
    if (caminho === "/n8n") {
      recebidosNoN8n.push(JSON.parse(texto));
      return { status: 200, corpo: {} };
    }
    const corpo = texto ? (JSON.parse(texto) as Record<string, unknown>) : null;
    const chave = (req.headers["x-idempotency-key"] as string | undefined) ?? null;
    pedidos.push({ metodo: req.method ?? "", caminho, chave, corpo });

    const conta = CONTAS[(req.headers.authorization ?? "").replace(/^Bearer /, "")];
    if (!conta) return { status: 401, corpo: { message: "invalid access token", status: 401 } };
    if (req.method === "GET" && caminho === "/users/me") return { status: 200, corpo: { id: Number(conta.id), nickname: conta.nickname, email: "dono@exemplo.br" } };

    if (req.method === "POST" && caminho === "/v1/payments") {
      const comportamento = modo;
      modo = "normal";
      if (!chave || !corpo) return { status: 400, corpo: { message: "Header X-Idempotency-Key can't be null" } };
      if (comportamento === "recusa") return { status: 400, corpo: { message: "Invalid payer data", cause: [{ code: 2067, description: "Invalid user identification number" }] } };
      // A mesma chave devolve o mesmo pagamento: é a idempotência do Mercado Pago.
      let p = [...pagamentos.values()].find((existente) => existente.chave === chave && existente.conta === conta.id);
      if (!p) {
        p = { id: String(++sequencia), conta: conta.id, chave, pedido: corpo, status: "pending", status_detail: "pending_waiting_transfer", transaction_amount: Number(corpo.transaction_amount), total_paid_amount: 0, external_reference: corpo.external_reference, date_approved: null, currency_id: "BRL" };
        pagamentos.set(p.id, p);
      }
      // "queda": o pagamento nasce, mas a resposta não chega inteira a quem pediu.
      if (comportamento === "queda") return { status: 500, corpo: { message: "internal error" } };
      return { status: 201, corpo: comoAApiResponde(p) };
    }

    const consulta = caminho.match(/^\/v1\/payments\/(\d+)$/);
    if (req.method === "GET" && consulta) {
      const p = pagamentos.get(consulta[1]);
      // Pagamento de outra conta não existe para este token.
      return p && p.conta === conta.id ? { status: 200, corpo: comoAApiResponde(p) } : { status: 404, corpo: { message: "Payment not found", status: 404 } };
    }
    return { status: 404, corpo: { message: "not found" } };
  }

  /* --------------------------------- Apoio ---------------------------------- */

  // Tudo o que as rotas respondem e o que vai para o log de erro: no fim, nada disso pode ter credencial.
  const respostas: string[] = [];
  const logs: string[] = [];

  const entrarComo = (perfil: Perfil | null) =>
    sessao.mockResolvedValue(
      perfil
        ? { user: { id: ids[perfil], role: perfil === "CLIENTE" ? "CLIENT" : perfil === "ADMIN_DA_OUTRA" ? "ADMIN" : perfil, clientId: null, ...(perfil === "ADMIN_DA_OUTRA" && { tenantId: EMPRESA_OUTRA.id }) } }
        : null,
    );

  const req = (method = "GET", body?: unknown) =>
    new Request("http://localhost/api/teste", {
      method,
      headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.9" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

  async function lida<T = Corpo>(res: Response): Promise<{ status: number; corpo: T }> {
    const texto = await res.text();
    respostas.push(texto);
    return { status: res.status, corpo: JSON.parse(texto) as T };
  }

  const ligarConta = async (perfil: Perfil = "ADMIN", token = TOKEN_A, segredo = SEGREDO_A) => {
    entrarComo(perfil);
    return lida<GatewayDaEmpresa & Corpo>(await gatewayRota.PUT(req("PUT", { accessToken: token, webhookSecret: segredo })));
  };

  const gerar = async (faturaId: string, tipo: "PIX" | "BOLETO", perfil: Perfil = "ADMIN") => {
    entrarComo(perfil);
    return lida<CobrancaDaTela & Corpo>(await cobrancasRota.POST(req("POST", { tipo }), ctx(faturaId)));
  };

  const atualizar = async (faturaId: string, cobrancaId: string, perfil: Perfil = "ADMIN") => {
    entrarComo(perfil);
    return lida<CobrancaDaTela & Corpo>(await cobrancaRota.POST(req("POST"), { params: Promise.resolve({ id: faturaId, cobrancaId }) }));
  };

  /** Manda um aviso como o Mercado Pago manda: `data.id` na URL, assinatura no cabeçalho, sem sessão. */
  const avisar = async (slug: string, pagamentoId: string, segredo: string, opcoes: { assinatura?: string; corpo?: unknown; tipo?: string } = {}) => {
    sessao.mockResolvedValue(null);
    const requestId = randomUUID();
    const ts = String(Date.now());
    const assinatura = opcoes.assinatura ?? `ts=${ts},v1=${assinarManifesto(segredo, manifestoDaAssinatura({ dataId: pagamentoId, requestId, ts }))}`;
    const pedido = new Request(`http://localhost/api/pagamentos/mercado-pago/${slug}?data.id=${pagamentoId}&type=${opcoes.tipo ?? "payment"}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-signature": assinatura, "x-request-id": requestId },
      body: JSON.stringify(opcoes.corpo ?? { action: "payment.updated", api_version: "v1", data: { id: pagamentoId }, type: "payment", live_mode: true }),
    });
    return lida<Corpo & { resultado?: string }>(await webhookRota.POST(pedido, { params: Promise.resolve({ empresa: slug }) }));
  };

  async function emitirFatura(valor: number, { cliente = clienteId, vencimento = "2013-10-20" } = {}) {
    // Antes de tocar no banco: a consulta sem empresa explícita vai na empresa da sessão simulada.
    entrarComo("ADMIN");
    const carga = await banco.default.collection.create({
      data: { clientId: cliente, sender: "Remetente", receiver: "Destinatário", origin: "Mirassol - SP", destination: "Votuporanga - SP", volumes: 1, weight: 10, status: "DELIVERED", freightValue: valor },
    });
    entrarComo("ADMIN");
    const res = await faturas.POST(req("POST", { clientId: cliente, collectionIds: [carga.id], dueDate: vencimento }));
    expect(res.status).toBe(201);
    return (await res.json()) as { id: string; number: number };
  }

  const fatura = (id: string) => banco.sistema.invoice.findUniqueOrThrow({ where: { id }, select: { status: true, paidAt: true, transaction: { select: { status: true, paidAt: true, paymentMethod: true, interest: true, discount: true, paidAmount: true } } } });
  const cobrancasDe = (invoiceId: string) => banco.sistema.paymentCharge.findMany({ where: { invoiceId }, orderBy: { createdAt: "asc" } });
  const pagamentoDe = (cobranca: { id: string }) =>
    banco.sistema.paymentCharge.findUniqueOrThrow({ where: { id: cobranca.id }, select: { gatewayId: true } }).then(({ gatewayId }) => pagamentos.get(gatewayId ?? "")!);
  const aprovar = (p: PagamentoFalso, pago = p.transaction_amount) => Object.assign(p, { status: "approved", status_detail: "accredited", total_paid_amount: pago, date_approved: "2024-03-05T14:30:00.000-04:00" });
  const trilha = async (entityId: string) => banco.sistema.auditLog.findMany({ where: { entityId }, orderBy: { createdAt: "asc" }, select: { action: true, userName: true, userRole: true, userId: true, summary: true } });
  const avisosDe = (perfil: Perfil, tipo: string) => banco.sistema.notification.findMany({ where: { userId: ids[perfil], type: tipo } });

  const DOS_CLIENTES = { client: { cnpj: { in: [CNPJ, CNPJ_SEM_DADOS, CNPJ_DA_OUTRA] } } };
  const DAS_EMPRESAS = { tenantId: { in: [EMPRESA_PADRAO.id, EMPRESA_OUTRA.id] } };

  async function limparMovimento() {
    const { sistema } = banco;
    await sistema.paymentCharge.deleteMany({ where: { invoice: DOS_CLIENTES } });
    await sistema.paymentGateway.deleteMany({ where: DAS_EMPRESAS });
    await sistema.outboxEvent.deleteMany({ where: DAS_EMPRESAS });
    await sistema.webhook.deleteMany({ where: DAS_EMPRESAS });
    await sistema.notification.deleteMany({ where: { user: { email: { startsWith: PREFIXO } } } });
    await sistema.financialTransaction.deleteMany({ where: DOS_CLIENTES });
    await sistema.collection.deleteMany({ where: DOS_CLIENTES });
    await sistema.invoice.deleteMany({ where: DOS_CLIENTES });
    await sistema.auditLog.deleteMany({ where: { ...DAS_EMPRESAS, OR: [{ userName: { startsWith: PREFIXO } }, { userName: "Mercado Pago" }] } });
  }

  async function limpar() {
    await limparMovimento();
    await banco.sistema.user.deleteMany({ where: { email: { startsWith: PREFIXO } } });
    await banco.sistema.client.deleteMany({ where: { cnpj: { in: [CNPJ, CNPJ_SEM_DADOS, CNPJ_DA_OUTRA] } } });
  }

  const anteriores = { chave: process.env.TMS_CHAVE_DE_DADOS, api: process.env.MERCADO_PAGO_API, url: process.env.NEXTAUTH_URL, local: process.env.TMS_WEBHOOK_PERMITE_LOCAL };
  const restaurar = (nome: string, valor: string | undefined) => {
    if (valor === undefined) delete process.env[nome];
    else process.env[nome] = valor;
  };

  beforeAll(async () => {
    servidor = createServer((pedido, resposta) => {
      void atender(pedido).then(({ status, corpo }) => {
        resposta.writeHead(status, { "Content-Type": "application/json" });
        resposta.end(JSON.stringify(corpo));
      });
    });
    await new Promise<void>((resolve) => servidor.listen(0, "127.0.0.1", resolve));
    api = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;

    process.env.TMS_CHAVE_DE_DADOS = "chave-de-dados-dos-testes-do-gateway-0123456789";
    process.env.MERCADO_PAGO_API = api;
    process.env.NEXTAUTH_URL = "https://tms.exemplo.br";
    process.env.TMS_WEBHOOK_PERMITE_LOCAL = "1";
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => void logs.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : typeof a === "string" ? a : JSON.stringify(a))).join(" ")));

    banco = await import("../src/lib/prisma");
    gatewayRota = await import("../src/app/api/empresa/gateway/route");
    gatewayTeste = await import("../src/app/api/empresa/gateway/teste/route");
    cobrancasRota = await import("../src/app/api/faturas/[id]/cobrancas/route");
    cobrancaRota = await import("../src/app/api/faturas/[id]/cobrancas/[cobrancaId]/route");
    webhookRota = await import("../src/app/api/pagamentos/mercado-pago/[empresa]/route");
    faturas = await import("../src/app/api/faturas/route");
    faturaPorId = await import("../src/app/api/faturas/[id]/route");
    faturasDoPortal = await import("../src/app/api/portal/faturas/route");
    webhookDaEmpresa = await import("../src/app/api/empresa/webhook/route");
    eventos = await import("../src/lib/eventos");
    gatewayDb = await import("../src/lib/cobranca-gateway-db");
    limite = await import("../src/lib/rate-limit");
    await limpar();

    clienteId = (await banco.default.client.create({ data: { companyName: `${PREFIXO}Comercial Aurora Ltda`, cnpj: CNPJ, email: "financeiro@aurora.exemplo.br", address: ENDERECO } })).id;
    clienteSemDados = (await banco.default.client.create({ data: { companyName: `${PREFIXO}Sem Dados Ltda`, cnpj: CNPJ_SEM_DADOS } })).id;
    const outra = banco.paraEmpresa(EMPRESA_OUTRA.id).db;

    for (const perfil of ["ADMIN", "FINANCE", "DIRECTOR", "OPERATION"] as const) {
      ids[perfil] = (await banco.default.user.create({ data: { name: `${PREFIXO}${perfil}`, email: `${PREFIXO}${perfil.toLowerCase()}@exemplo.br`, password: HASH_FALSO, role: perfil } })).id;
    }
    ids.CLIENTE = (await banco.default.user.create({ data: { name: `${PREFIXO}cliente`, email: `${PREFIXO}cliente@exemplo.br`, password: HASH_FALSO, role: "CLIENT", clientId: clienteId } })).id;
    ids.ADMIN_DA_OUTRA = (await outra.user.create({ data: { name: `${PREFIXO}admin-da-outra`, email: `${PREFIXO}admin-da-outra@exemplo.br`, password: HASH_FALSO, role: "ADMIN" } })).id;
  }, 180_000);

  beforeEach(async () => {
    sessao.mockReset();
    limite.resetRateLimit();
    modo = "normal";
    pedidos = [];
    recebidosNoN8n = [];
    pagamentos.clear();
    await limparMovimento();
  });

  afterAll(async () => {
    if (banco) await limpar();
    restaurar("TMS_CHAVE_DE_DADOS", anteriores.chave);
    restaurar("MERCADO_PAGO_API", anteriores.api);
    restaurar("NEXTAUTH_URL", anteriores.url);
    restaurar("TMS_WEBHOOK_PERMITE_LOCAL", anteriores.local);
    vi.restoreAllMocks();
    await new Promise<void>((resolve) => servidor.close(() => resolve()));
  });

  /* -------------------------------- Permissão -------------------------------- */

  describe("permissão", () => {
    it("a conta do Mercado Pago é só do administrador: sem sessão 401; os outros perfis, 403", async () => {
      const chamadas: [string, () => Promise<Response>][] = [
        ["GET", () => gatewayRota.GET()],
        ["PUT", () => gatewayRota.PUT(req("PUT", { accessToken: TOKEN_A, webhookSecret: SEGREDO_A }))],
        ["DELETE", () => gatewayRota.DELETE(req("DELETE"))],
        ["POST teste", () => gatewayTeste.POST()],
      ];
      for (const [nome, chamar] of chamadas) {
        entrarComo(null);
        expect((await chamar()).status, `${nome} sem sessão`).toBe(401);
        for (const perfil of ["FINANCE", "DIRECTOR", "OPERATION", "CLIENTE"] as const) {
          entrarComo(perfil);
          expect((await chamar()).status, `${nome} ${perfil}`).toBe(403);
        }
      }
      expect(await banco.sistema.paymentGateway.count({ where: DAS_EMPRESAS })).toBe(0);
    });

    it("gerar e atualizar cobrança é de quem fatura: administrador e financeiro; diretoria (só lê), operação e cliente não", async () => {
      await ligarConta();
      const nova = await emitirFatura(150);
      const chamadas: [string, () => Promise<Response>][] = [
        ["gerar", () => cobrancasRota.POST(req("POST", { tipo: "PIX" }), ctx(nova.id))],
        ["atualizar", () => cobrancaRota.POST(req("POST"), { params: Promise.resolve({ id: nova.id, cobrancaId: SEM_ID }) })],
      ];
      for (const [nome, chamar] of chamadas) {
        entrarComo(null);
        expect((await chamar()).status, `${nome} sem sessão`).toBe(401);
        for (const perfil of ["DIRECTOR", "OPERATION", "CLIENTE"] as const) {
          entrarComo(perfil);
          expect((await chamar()).status, `${nome} ${perfil}`).toBe(403);
        }
      }
      expect(await cobrancasDe(nova.id)).toHaveLength(0);
      expect(pedidos).toHaveLength(0);

      expect((await gerar(nova.id, "PIX", "FINANCE")).status).toBe(201);
      const [cobranca] = await cobrancasDe(nova.id);
      expect((await atualizar(nova.id, cobranca.id, "FINANCE")).status).toBe(200);
    });
  });

  /* ------------------------------- Credenciais ------------------------------- */

  describe("credenciais da empresa", () => {
    it("guarda cifrado, devolve só 'configurado' e os 4 últimos caracteres, e mostra o endereço de webhook", async () => {
      entrarComo("ADMIN");
      const antes = await lida<GatewayDaEmpresa>(await gatewayRota.GET());
      expect(antes).toEqual({ status: 200, corpo: { disponivel: true, configurado: false, accessTokenFinal: null, webhookSecretFinal: null, webhook: `https://tms.exemplo.br/api/pagamentos/mercado-pago/${EMPRESA_PADRAO.slug}` } });

      for (const corpo of [null, {}, { accessToken: TOKEN_A }, { accessToken: "curto", webhookSecret: SEGREDO_A }, { accessToken: TOKEN_A, webhookSecret: "" }]) {
        entrarComo("ADMIN");
        expect((await gatewayRota.PUT(req("PUT", corpo))).status, JSON.stringify(corpo)).toBe(400);
      }

      const ligada = await ligarConta();
      expect(ligada.status).toBe(200);
      expect(ligada.corpo).toEqual({ disponivel: true, configurado: true, accessTokenFinal: "ERTY", webhookSecretFinal: "CVBN", webhook: antes.corpo.webhook });

      const gravado = await banco.sistema.paymentGateway.findUniqueOrThrow({ where: { tenantId: EMPRESA_PADRAO.id } });
      expect(gravado.accessTokenEnc).toMatch(/^v1\./);
      expect(JSON.stringify(gravado)).not.toContain(TOKEN_A);
      expect(JSON.stringify(gravado)).not.toContain(SEGREDO_A);
      // O que foi gravado abre com a chave do servidor, e só no contexto desta empresa.
      expect(decifrar(gravado.accessTokenEnc, `PaymentGateway:${EMPRESA_PADRAO.id}:accessToken`)).toBe(TOKEN_A);
      expect(() => decifrar(gravado.accessTokenEnc, `PaymentGateway:${EMPRESA_OUTRA.id}:accessToken`)).toThrow(CifraError);
      expect(() => decifrar(gravado.accessTokenEnc, `PaymentGateway:${EMPRESA_PADRAO.id}:webhookSecret`)).toThrow(CifraError);

      const auditoria = await trilha(EMPRESA_PADRAO.id);
      expect(auditoria.filter((linha) => linha.action === "empresa.gateway")).toEqual([expect.objectContaining({ summary: "Conta do Mercado Pago ligada", userName: `${PREFIXO}ADMIN` })]);
    });

    it("Testar conexão mostra o nome da conta; token recusado vira erro claro, sem o token", async () => {
      entrarComo("ADMIN");
      expect((await gatewayTeste.POST()).status).toBe(409);

      await ligarConta();
      entrarComo("ADMIN");
      expect(await lida(await gatewayTeste.POST())).toEqual({ status: 200, corpo: { conta: "TRANSPORTADORA_A" } });
      expect(pedidos.at(-1)).toMatchObject({ metodo: "GET", caminho: "/users/me" });

      await ligarConta("ADMIN", "APP_USR-token-que-o-mercado-pago-nao-conhece", SEGREDO_A);
      entrarComo("ADMIN");
      const recusado = await lida(await gatewayTeste.POST());
      expect(recusado.status).toBe(502);
      expect(recusado.corpo.error).toContain("recusou o Access Token");
      expect(recusado.corpo.error).not.toContain("APP_USR");
    });

    it("trocar e desligar; sem a variável TMS_CHAVE_DE_DADOS o recurso fica desligado e a tela é avisada", async () => {
      await ligarConta();
      const trocada = await ligarConta("ADMIN", TOKEN_B, SEGREDO_B);
      expect(trocada.corpo).toMatchObject({ configurado: true, accessTokenFinal: "DFGH", webhookSecretFinal: "IUYT" });
      expect(await banco.sistema.paymentGateway.count({ where: { tenantId: EMPRESA_PADRAO.id } })).toBe(1);

      const chave = process.env.TMS_CHAVE_DE_DADOS;
      delete process.env.TMS_CHAVE_DE_DADOS;
      try {
        entrarComo("ADMIN");
        expect((await lida<GatewayDaEmpresa>(await gatewayRota.GET())).corpo).toMatchObject({ disponivel: false });
        const semChave = await ligarConta();
        expect(semChave.status).toBe(503);
        expect(semChave.corpo.error).toContain("TMS_CHAVE_DE_DADOS");
        entrarComo("ADMIN");
        expect((await gatewayTeste.POST()).status).toBe(503);
        const nova = await emitirFatura(150);
        expect((await gerar(nova.id, "PIX")).status).toBe(503);
        // E o webhook não atende: sem chave não há segredo para conferir a assinatura.
        expect((await avisar(EMPRESA_PADRAO.slug, "1", SEGREDO_B)).status).toBe(404);
      } finally {
        process.env.TMS_CHAVE_DE_DADOS = chave;
      }

      entrarComo("ADMIN");
      expect((await lida<GatewayDaEmpresa>(await gatewayRota.DELETE(req("DELETE")))).corpo).toMatchObject({ configurado: false, accessTokenFinal: null });
      expect(await banco.sistema.paymentGateway.count({ where: { tenantId: EMPRESA_PADRAO.id } })).toBe(0);
      const resumos = (await trilha(EMPRESA_PADRAO.id)).filter((linha) => linha.action === "empresa.gateway").map((linha) => linha.summary);
      expect(resumos).toEqual(["Conta do Mercado Pago ligada", "Credenciais do Mercado Pago trocadas", "Conta do Mercado Pago desligada"]);
    });

    it("cada empresa tem a própria conta: a outra não vê nem usa a desta", async () => {
      await ligarConta();
      entrarComo("ADMIN_DA_OUTRA");
      expect((await lida<GatewayDaEmpresa>(await gatewayRota.GET())).corpo).toEqual({
        disponivel: true,
        configurado: false,
        accessTokenFinal: null,
        webhookSecretFinal: null,
        webhook: `https://tms.exemplo.br/api/pagamentos/mercado-pago/${EMPRESA_OUTRA.slug}`,
      });
      entrarComo("ADMIN_DA_OUTRA");
      expect((await gatewayTeste.POST()).status).toBe(409);
      // Desligar na outra não mexe na desta.
      entrarComo("ADMIN_DA_OUTRA");
      await gatewayRota.DELETE(req("DELETE"));
      expect(await banco.sistema.paymentGateway.count({ where: { tenantId: EMPRESA_PADRAO.id } })).toBe(1);
      // E pela política do banco a outra empresa nem enxerga a linha.
      expect(await banco.paraEmpresa(EMPRESA_OUTRA.id).db.paymentGateway.count()).toBe(0);
    });
  });

  /* --------------------------------- Criação --------------------------------- */

  describe("gerar Pix e boleto", () => {
    it("Pix: cria no Mercado Pago com a fatura como referência, chave de idempotência e o endereço de aviso; guarda copia-e-cola e QR", async () => {
      await ligarConta();
      const nova = await emitirFatura(150.5);
      const gerada = await gerar(nova.id, "PIX");
      expect(gerada.status).toBe(201);
      expect(gerada.corpo).toMatchObject({ tipo: "PIX", situacao: "PENDING", valor: 150.5, valorPago: null, pagaEm: null, nota: null, linhaDigitavel: null });
      expect(gerada.corpo.copiaECola).toMatch(/^00020126580014br\.gov\.bcb\.pix-FALSO-\d+$/);
      expect(gerada.corpo.qrCodeBase64).toMatch(/^iVBOR/);
      expect(gerada.corpo.link).toMatch(/^https:\/\/www\.mercadopago\.com\.br\/payments\/\d+\/ticket$/);
      expect("idempotencyKey" in gerada.corpo || "gatewayId" in gerada.corpo).toBe(false);

      const pedido = pedidos.find((p) => p.caminho === "/v1/payments")!;
      expect(pedido.chave).toMatch(/^[0-9a-f-]{36}$/);
      expect(pedido.corpo).toMatchObject({
        transaction_amount: 150.5,
        description: `Fatura nº ${nova.number}`,
        payment_method_id: "pix",
        external_reference: nova.id,
        notification_url: `https://tms.exemplo.br/api/pagamentos/mercado-pago/${EMPRESA_PADRAO.slug}`,
        payer: { email: "financeiro@aurora.exemplo.br", identification: { type: "CNPJ", number: CNPJ } },
      });
      expect(String(pedido.corpo?.date_of_expiration)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}-03:00$/);

      const [cobranca] = await cobrancasDe(nova.id);
      expect(cobranca).toMatchObject({ tenantId: EMPRESA_PADRAO.id, kind: "PIX", status: "PENDING", amount: 150.5, idempotencyKey: pedido.chave });
      expect(pagamentos.get(cobranca.gatewayId!)).toBeDefined();
      expect((await trilha(cobranca.id)).map((linha) => linha.action)).toEqual(["cobranca.gerar"]);

      // A fatura do painel traz a cobrança, e o Pix dinâmico entra no lugar do estático.
      entrarComo("DIRECTOR");
      const naTela = await lida<{ pix: string | null; gateway: boolean; cobrancas: CobrancaDaTela[] }>(await faturaPorId.GET(req(), ctx(nova.id)));
      expect(naTela.corpo).toMatchObject({ gateway: true, pix: null, cobrancas: [{ id: cobranca.id, situacao: "PENDING", copiaECola: gerada.corpo.copiaECola }] });
    });

    it("só uma em aberto por tipo: o segundo Pix é recusado, e o boleto da mesma fatura sai", async () => {
      await ligarConta();
      const nova = await emitirFatura(150);
      expect((await gerar(nova.id, "PIX")).status).toBe(201);
      const repetido = await gerar(nova.id, "PIX");
      expect(repetido.status).toBe(409);
      expect(repetido.corpo.error).toContain("já tem um Pix em aberto");

      const boleto = await gerar(nova.id, "BOLETO");
      expect(boleto.status).toBe(201);
      expect(boleto.corpo).toMatchObject({ tipo: "BOLETO", situacao: "PENDING", copiaECola: null, qrCodeBase64: null, linhaDigitavel: "23793380296060054351030006333303799140000015000" });
      expect(boleto.corpo.link).toContain("boleto=1");
      expect(pedidos.filter((p) => p.caminho === "/v1/payments").at(-1)?.corpo).toMatchObject({
        payment_method_id: "bolbradesco",
        payer: { first_name: `${PREFIXO}Comercial`, last_name: "Aurora Ltda", address: { zip_code: "15130000", street_name: "Rua das Flores", street_number: "123", neighborhood: "Centro", city: "Mirassol", federal_unit: "SP" } },
      });
      expect((await gerar(nova.id, "BOLETO")).status).toBe(409);
      expect(await cobrancasDe(nova.id)).toHaveLength(2);
      expect(pagamentos.size).toBe(2);

      // Depois de vencer no Mercado Pago, dá para gerar outro: a fatura fica com mais de uma cobrança.
      const [pix] = await cobrancasDe(nova.id);
      Object.assign(await pagamentoDe(pix), { status: "cancelled", status_detail: "expired" });
      expect((await atualizar(nova.id, pix.id)).corpo).toMatchObject({ situacao: "EXPIRED", copiaECola: null, qrCodeBase64: null, link: null });
      expect((await gerar(nova.id, "PIX")).status).toBe(201);
      expect((await cobrancasDe(nova.id)).map((c) => `${c.kind}:${c.status}`).sort()).toEqual(["BOLETO:PENDING", "PIX:EXPIRED", "PIX:PENDING"]);
    });

    it("dado do pagador faltando: erro dizendo o que completar, e nada vai ao Mercado Pago", async () => {
      await ligarConta();
      const semDados = await emitirFatura(80, { cliente: clienteSemDados });
      const pix = await gerar(semDados.id, "PIX");
      expect(pix).toMatchObject({ status: 400, corpo: { error: "Para gerar a cobrança, falta no cadastro do cliente: e-mail." } });

      await banco.default.client.update({ where: { id: clienteSemDados }, data: { email: "a@semdados.exemplo.br", address: "Rua Sem Cep, 10 - Centro, Mirassol - SP" } });
      const boleto = await gerar(semDados.id, "BOLETO");
      expect(boleto.status).toBe(400);
      expect(boleto.corpo.error).toContain("falta no endereço do cadastro do cliente: CEP");
      expect(pedidos.filter((p) => p.caminho === "/v1/payments")).toHaveLength(0);
      expect(await cobrancasDe(semDados.id)).toHaveLength(0);
      // Com o e-mail no cadastro, o Pix (que não pede endereço) sai.
      expect((await gerar(semDados.id, "PIX")).status).toBe(201);
      await banco.default.client.update({ where: { id: clienteSemDados }, data: { email: null, address: null } });
    });

    it("validação e estado: tipo inválido 400; fatura inexistente 404; paga ou cancelada 409; sem conta ligada 409", async () => {
      const nova = await emitirFatura(150);
      const semConta = await gerar(nova.id, "PIX");
      expect(semConta).toMatchObject({ status: 409, corpo: { error: expect.stringContaining("Ligue a conta do Mercado Pago") } });

      await ligarConta();
      entrarComo("ADMIN");
      expect((await cobrancasRota.POST(req("POST", { tipo: "CARTAO" }), ctx(nova.id))).status).toBe(400);
      expect((await gerar(SEM_ID, "PIX")).status).toBe(404);

      entrarComo("ADMIN");
      expect((await faturaPorId.PATCH(req("PATCH", { action: "pagar" }), ctx(nova.id))).status).toBe(200);
      expect((await gerar(nova.id, "PIX")).status).toBe(409);
      const cancelada = await emitirFatura(60);
      entrarComo("ADMIN");
      expect((await faturaPorId.PATCH(req("PATCH", { action: "cancelar" }), ctx(cancelada.id))).status).toBe(200);
      expect((await gerar(cancelada.id, "BOLETO")).status).toBe(409);
      expect(pedidos.filter((p) => p.caminho === "/v1/payments")).toHaveLength(0);
    });

    it("o Mercado Pago recusa: a cobrança fica 'não criada' com o motivo, e a tentativa seguinte usa chave nova", async () => {
      await ligarConta();
      const nova = await emitirFatura(150);
      modo = "recusa";
      const recusada = await gerar(nova.id, "PIX");
      expect(recusada.status).toBe(502);
      expect(recusada.corpo.error).toBe("O Mercado Pago recusou o pedido: Invalid payer data; Invalid user identification number");
      const [falha] = await cobrancasDe(nova.id);
      expect(falha).toMatchObject({ status: "FAILED", gatewayId: null, note: recusada.corpo.error });

      expect((await gerar(nova.id, "PIX")).status).toBe(201);
      const todas = await cobrancasDe(nova.id);
      expect(todas.map((c) => c.status)).toEqual(["FAILED", "PENDING"]);
      expect(todas[1].idempotencyKey).not.toBe(falha.idempotencyKey);
      expect(pagamentos.size).toBe(1);
    });

    it("idempotência: se o Mercado Pago cria e a resposta não chega, gerar de novo repete a mesma chave e não nasce pagamento em dobro", async () => {
      await ligarConta();
      const nova = await emitirFatura(150);
      modo = "queda";
      const caiu = await gerar(nova.id, "PIX");
      expect(caiu.status).toBe(502);
      expect(caiu.corpo.error).toContain("em criação");
      const [emCriacao] = await cobrancasDe(nova.id);
      expect(emCriacao).toMatchObject({ status: "CREATING", gatewayId: null });
      // O pagamento nasceu lá, mesmo sem a resposta.
      expect(pagamentos.size).toBe(1);

      const deNovo = await gerar(nova.id, "PIX");
      expect(deNovo.status).toBe(201);
      expect(deNovo.corpo.id).toBe(emCriacao.id);
      const chaves = pedidos.filter((p) => p.caminho === "/v1/payments").map((p) => p.chave);
      expect(chaves).toEqual([emCriacao.idempotencyKey, emCriacao.idempotencyKey]);
      // O vencimento pedido é o mesmo nas duas vezes: o corpo repetido é idêntico.
      const corpos = pedidos.filter((p) => p.caminho === "/v1/payments").map((p) => JSON.stringify(p.corpo));
      expect(corpos[0]).toBe(corpos[1]);
      expect(pagamentos.size).toBe(1);
      expect(await cobrancasDe(nova.id)).toHaveLength(1);
      expect((await cobrancasDe(nova.id))[0]).toMatchObject({ status: "PENDING", gatewayId: [...pagamentos.keys()][0] });
    });

    it("isolamento: a outra empresa não gera cobrança nem enxerga a fatura desta", async () => {
      await ligarConta();
      await ligarConta("ADMIN_DA_OUTRA", TOKEN_B, SEGREDO_B);
      const nova = await emitirFatura(150);
      expect((await gerar(nova.id, "PIX")).status).toBe(201);
      const [cobranca] = await cobrancasDe(nova.id);

      expect((await gerar(nova.id, "BOLETO", "ADMIN_DA_OUTRA")).status).toBe(404);
      expect((await atualizar(nova.id, cobranca.id, "ADMIN_DA_OUTRA")).status).toBe(404);
      expect(await banco.paraEmpresa(EMPRESA_OUTRA.id).db.paymentCharge.count()).toBe(0);
      expect(await cobrancasDe(nova.id)).toHaveLength(1);
      // Nenhum pedido saiu com o token da outra empresa para esta fatura.
      expect(pagamentos.size).toBe(1);
      expect([...pagamentos.values()][0].conta).toBe("1001");
    });
  });

  /* --------------------------------- Webhook --------------------------------- */

  describe("webhook do Mercado Pago", () => {
    async function comPix(valor = 150) {
      await ligarConta();
      const nova = await emitirFatura(valor);
      expect((await gerar(nova.id, "PIX")).status).toBe(201);
      const [cobranca] = await cobrancasDe(nova.id);
      return { nova, cobranca, pagamento: pagamentos.get(cobranca.gatewayId!)! };
    }

    it("assinatura inválida 401; empresa desconhecida, inativa ou sem conta ligada 404: nada muda", async () => {
      const { nova, pagamento } = await comPix();
      aprovar(pagamento);

      for (const assinatura of ["", "ts=1,v1=00", `ts=${Date.now()},v1=${"a".repeat(64)}`]) {
        expect((await avisar(EMPRESA_PADRAO.slug, pagamento.id, SEGREDO_A, { assinatura })).status, assinatura).toBe(401);
      }
      // Assinado com outro segredo.
      expect((await avisar(EMPRESA_PADRAO.slug, pagamento.id, "outro-segredo")).status).toBe(401);
      // Assinatura certa para OUTRO pagamento não vale para este.
      const ts = String(Date.now());
      const deOutro = `ts=${ts},v1=${assinarManifesto(SEGREDO_A, manifestoDaAssinatura({ dataId: "1", requestId: "x", ts }))}`;
      expect((await avisar(EMPRESA_PADRAO.slug, pagamento.id, SEGREDO_A, { assinatura: deOutro })).status).toBe(401);

      expect((await avisar("empresa-que-nao-existe", pagamento.id, SEGREDO_A)).status).toBe(404);
      // A outra empresa não ligou a conta.
      expect((await avisar(EMPRESA_OUTRA.slug, pagamento.id, SEGREDO_A)).status).toBe(404);

      expect(await fatura(nova.id)).toMatchObject({ status: "OPEN", paidAt: null });
      expect(pedidos.filter((p) => p.metodo === "GET" && p.caminho.startsWith("/v1/payments/"))).toHaveLength(0);
    });

    it("empresa errada: aviso de um pagamento desta empresa no endereço da outra não paga nada, com o segredo de qualquer uma", async () => {
      const { nova, pagamento } = await comPix();
      await ligarConta("ADMIN_DA_OUTRA", TOKEN_B, SEGREDO_B);
      aprovar(pagamento);

      // Com o segredo desta empresa, no endereço da outra: assinatura não confere.
      expect((await avisar(EMPRESA_OUTRA.slug, pagamento.id, SEGREDO_A)).status).toBe(401);
      // Com o segredo da outra: a consulta sai com o token DELA, e o pagamento não existe na conta dela.
      const naOutra = await avisar(EMPRESA_OUTRA.slug, pagamento.id, SEGREDO_B);
      expect(naOutra).toMatchObject({ status: 200, corpo: { ok: true, resultado: "desconhecido" } });
      expect(await fatura(nova.id)).toMatchObject({ status: "OPEN" });
      expect((await cobrancasDe(nova.id))[0].status).toBe("PENDING");
    });

    it("pagamento de outra empresa: aprovado na conta da outra, com a referência de uma fatura desta, não paga a fatura", async () => {
      const { nova } = await comPix();
      await ligarConta("ADMIN_DA_OUTRA", TOKEN_B, SEGREDO_B);
      // Alguém cria, na conta B, um pagamento aprovado apontando para a fatura da empresa A.
      const intruso = pagamentoAvulso("2002", { external_reference: nova.id });

      expect(await avisar(EMPRESA_OUTRA.slug, intruso.id, SEGREDO_B)).toMatchObject({ status: 200, corpo: { resultado: "desconhecido" } });
      // E no endereço desta empresa o pagamento nem existe (é de outra conta).
      expect(await avisar(EMPRESA_PADRAO.slug, intruso.id, SEGREDO_A)).toMatchObject({ status: 200, corpo: { resultado: "desconhecido" } });
      expect(await fatura(nova.id)).toMatchObject({ status: "OPEN", paidAt: null });
      expect(await banco.sistema.notification.count({ where: { type: "cobranca.a-conferir", user: { email: { startsWith: PREFIXO } } } })).toBe(0);
    });

    it("não confia no corpo: o aviso diz 'aprovado', mas a API diz pendente, e a fatura segue em aberto", async () => {
      const { nova, pagamento } = await comPix();
      const mentira = { action: "payment.updated", type: "payment", data: { id: pagamento.id, status: "approved", transaction_amount: 150, external_reference: nova.id }, status: "approved" };
      expect(await avisar(EMPRESA_PADRAO.slug, pagamento.id, SEGREDO_A, { corpo: mentira })).toMatchObject({ status: 200, corpo: { resultado: "nada" } });
      expect(await fatura(nova.id)).toMatchObject({ status: "OPEN" });
      expect(pedidos.at(-1)).toMatchObject({ metodo: "GET", caminho: `/v1/payments/${pagamento.id}` });
      // Aviso de outro assunto é aceito e ignorado, sem consulta.
      const antes = pedidos.length;
      expect(await avisar(EMPRESA_PADRAO.slug, pagamento.id, SEGREDO_A, { tipo: "merchant_order" })).toMatchObject({ status: 200, corpo: { resultado: "ignorado" } });
      expect(pedidos.length).toBe(antes);
    });

    it("aprovado paga a fatura pelo caminho do Faturamento, uma vez só: data do gateway, forma Pix, auditoria com ator Mercado Pago e aviso ao financeiro", async () => {
      const { nova, cobranca, pagamento } = await comPix();
      aprovar(pagamento);

      expect(await avisar(EMPRESA_PADRAO.slug, pagamento.id, SEGREDO_A)).toMatchObject({ status: 200, corpo: { ok: true, resultado: "paga" } });
      const paga = await fatura(nova.id);
      const quando = new Date("2024-03-05T18:30:00.000Z");
      expect(paga).toMatchObject({ status: "PAID", paidAt: quando, transaction: { status: "PAID", paidAt: quando, paymentMethod: "PIX", interest: null, discount: null, paidAmount: null } });
      expect((await cobrancasDe(nova.id))[0]).toMatchObject({ status: "PAID", paidAt: quando, paidAmount: 150, note: null });

      const daFatura = (await trilha(nova.id)).filter((linha) => linha.action === "fatura.pagar");
      expect(daFatura).toEqual([{ action: "fatura.pagar", userName: "Mercado Pago", userRole: "INTEGRACAO", userId: null, summary: `Fatura nº ${nova.number} paga` }]);
      for (const perfil of ["ADMIN", "FINANCE"] as const) {
        expect((await avisosDe(perfil, "fatura.paga-pelo-gateway")).map((a) => ({ title: a.title, url: a.url }))).toEqual([{ title: `Fatura nº ${nova.number} paga por Pix`, url: `/dashboard/faturamento/${nova.id}` }]);
      }
      // Quem não tem `financeiro` não recebe.
      expect(await avisosDe("DIRECTOR", "fatura.paga-pelo-gateway")).toHaveLength(0);
      expect(await avisosDe("OPERATION", "fatura.paga-pelo-gateway")).toHaveLength(0);

      // Repetido (o Mercado Pago reenvia): não paga de novo, não audita de novo, não avisa de novo.
      for (let i = 0; i < 2; i += 1) expect(await avisar(EMPRESA_PADRAO.slug, pagamento.id, SEGREDO_A)).toMatchObject({ status: 200, corpo: { resultado: "nada" } });
      expect((await trilha(nova.id)).filter((linha) => linha.action === "fatura.pagar")).toHaveLength(1);
      expect(await avisosDe("FINANCE", "fatura.paga-pelo-gateway")).toHaveLength(1);
      expect(await fatura(nova.id)).toMatchObject({ status: "PAID", paidAt: quando });

      // Depois de paga, a tela não mostra mais o que servia para pagar.
      entrarComo("ADMIN");
      const naTela = await lida<{ cobrancas: CobrancaDaTela[] }>(await faturaPorId.GET(req(), ctx(nova.id)));
      expect(naTela.corpo.cobrancas).toMatchObject([{ id: cobranca.id, situacao: "PAID", copiaECola: null, qrCodeBase64: null, link: null, valorPago: 150 }]);
    });

    it("dois avisos ao mesmo tempo pagam uma vez só", async () => {
      const { nova, pagamento } = await comPix();
      aprovar(pagamento);
      const resultados = await Promise.all([avisar(EMPRESA_PADRAO.slug, pagamento.id, SEGREDO_A), avisar(EMPRESA_PADRAO.slug, pagamento.id, SEGREDO_A), avisar(EMPRESA_PADRAO.slug, pagamento.id, SEGREDO_A)]);
      expect(resultados.map((r) => r.status)).toEqual([200, 200, 200]);
      expect(resultados.map((r) => r.corpo.resultado).sort()).toEqual(["nada", "nada", "paga"]);
      expect((await trilha(nova.id)).filter((linha) => linha.action === "fatura.pagar")).toHaveLength(1);
      expect(await avisosDe("ADMIN", "fatura.paga-pelo-gateway")).toHaveLength(1);
    });

    it("valor diferente: pagou a mais vira juros, a menos vira desconto, e o total da fatura não muda", async () => {
      const { nova, pagamento } = await comPix(150);
      aprovar(pagamento, 153.75);
      expect((await avisar(EMPRESA_PADRAO.slug, pagamento.id, SEGREDO_A)).corpo.resultado).toBe("paga");
      expect(await fatura(nova.id)).toMatchObject({ status: "PAID", transaction: { status: "PAID", interest: 3.75, discount: 0, paidAmount: 153.75 } });
      expect((await cobrancasDe(nova.id))[0]).toMatchObject({ status: "PAID", amount: 150, paidAmount: 153.75 });

      const outra = await emitirFatura(200);
      expect((await gerar(outra.id, "BOLETO")).status).toBe(201);
      const [boleto] = await cobrancasDe(outra.id);
      aprovar(await pagamentoDe(boleto), 198);
      expect((await avisar(EMPRESA_PADRAO.slug, boleto.gatewayId!, SEGREDO_A)).corpo.resultado).toBe("paga");
      expect(await fatura(outra.id)).toMatchObject({ status: "PAID", transaction: { paymentMethod: "BOLETO", interest: 0, discount: 2, paidAmount: 198 } });
      expect((await avisosDe("FINANCE", "fatura.paga-pelo-gateway")).map((a) => a.title)).toContain(`Fatura nº ${outra.number} paga por boleto`);
    });

    it("na dúvida não paga: cobrança de outro valor no gateway fica 'a conferir', com aviso ao financeiro uma vez", async () => {
      const { nova, pagamento } = await comPix(150);
      // O pagamento aprovado lá é de R$ 15, não dos R$ 150 desta cobrança.
      Object.assign(aprovar(pagamento, 15), { transaction_amount: 15 });

      expect((await avisar(EMPRESA_PADRAO.slug, pagamento.id, SEGREDO_A)).corpo.resultado).toBe("a-conferir");
      expect(await fatura(nova.id)).toMatchObject({ status: "OPEN", paidAt: null, transaction: { status: "PENDING" } });
      const [cobranca] = await cobrancasDe(nova.id);
      expect(cobranca).toMatchObject({ status: "REVIEW", paidAmount: 15 });
      expect(cobranca.note).toContain("não é o desta cobrança");
      expect((await trilha(cobranca.id)).map((linha) => `${linha.action}:${linha.userName}`)).toEqual([`cobranca.gerar:${PREFIXO}ADMIN`, "cobranca.conferir:Mercado Pago"]);
      expect((await avisosDe("FINANCE", "cobranca.a-conferir")).map((a) => a.title)).toEqual([`Fatura nº ${nova.number}: cobrança a conferir`]);

      // Repetido: continua a conferir, sem aviso novo.
      expect((await avisar(EMPRESA_PADRAO.slug, pagamento.id, SEGREDO_A)).corpo.resultado).toBe("a-conferir");
      expect(await avisosDe("FINANCE", "cobranca.a-conferir")).toHaveLength(1);
      expect((await trilha(cobranca.id)).filter((linha) => linha.action === "cobranca.conferir")).toHaveLength(1);
    });

    it("fatura já paga por fora só atualiza a cobrança (a conferir: possível recebimento em dobro); fatura cancelada também não é mexida", async () => {
      const { nova, pagamento } = await comPix();
      entrarComo("ADMIN");
      expect((await faturaPorId.PATCH(req("PATCH", { action: "pagar" }), ctx(nova.id))).status).toBe(200);
      const pagaAMao = await fatura(nova.id);
      aprovar(pagamento);
      expect((await avisar(EMPRESA_PADRAO.slug, pagamento.id, SEGREDO_A)).corpo.resultado).toBe("a-conferir");
      // A baixa manual fica como estava: data, forma e valores.
      expect(await fatura(nova.id)).toEqual(pagaAMao);
      expect((await cobrancasDe(nova.id))[0]).toMatchObject({ status: "REVIEW", paidAmount: 150, note: expect.stringContaining("recebimento em dobro") });
      expect((await trilha(nova.id)).filter((linha) => linha.action === "fatura.pagar")).toHaveLength(1);

      const cancelada = await emitirFatura(90);
      expect((await gerar(cancelada.id, "PIX")).status).toBe(201);
      const [cobranca] = await cobrancasDe(cancelada.id);
      entrarComo("ADMIN");
      expect((await faturaPorId.PATCH(req("PATCH", { action: "cancelar" }), ctx(cancelada.id))).status).toBe(200);
      aprovar(await pagamentoDe(cobranca));
      expect((await avisar(EMPRESA_PADRAO.slug, cobranca.gatewayId!, SEGREDO_A)).corpo.resultado).toBe("a-conferir");
      expect(await fatura(cancelada.id)).toMatchObject({ status: "CANCELLED", paidAt: null });
      expect((await cobrancasDe(cancelada.id))[0].note).toContain("fatura cancelada");
    });

    it("pagamento aprovado com a referência de uma fatura, mas sem cobrança do sistema: não paga e avisa o financeiro uma vez", async () => {
      await ligarConta();
      const nova = await emitirFatura(150);
      const solto = pagamentoAvulso("1001", { external_reference: nova.id });
      expect((await avisar(EMPRESA_PADRAO.slug, solto.id, SEGREDO_A)).corpo.resultado).toBe("sem-cobranca");
      expect((await avisar(EMPRESA_PADRAO.slug, solto.id, SEGREDO_A)).corpo.resultado).toBe("sem-cobranca");
      expect(await fatura(nova.id)).toMatchObject({ status: "OPEN" });
      expect(await avisosDe("FINANCE", "cobranca.a-conferir")).toHaveLength(1);
      expect((await trilha(nova.id)).filter((linha) => linha.action === "cobranca.conferir")).toHaveLength(1);
      // Pagamento da própria conta que não tem nada a ver com o TMS é ignorado em silêncio.
      const alheio = pagamentoAvulso("1001", { external_reference: "pedido-da-loja-123" });
      expect((await avisar(EMPRESA_PADRAO.slug, alheio.id, SEGREDO_A)).corpo.resultado).toBe("desconhecido");
      expect(await avisosDe("FINANCE", "cobranca.a-conferir")).toHaveLength(1);
    });

    it("cancelado e vencido atualizam a cobrança; a fatura segue em aberto", async () => {
      const { nova, cobranca, pagamento } = await comPix();
      Object.assign(pagamento, { status: "cancelled", status_detail: "expired" });
      expect((await avisar(EMPRESA_PADRAO.slug, pagamento.id, SEGREDO_A)).corpo.resultado).toBe("encerrada");
      expect((await cobrancasDe(nova.id))[0]).toMatchObject({ status: "EXPIRED" });
      expect(await fatura(nova.id)).toMatchObject({ status: "OPEN" });
      expect((await trilha(cobranca.id)).at(-1)).toMatchObject({ action: "cobranca.encerrar", userName: "Mercado Pago", summary: `Pix da fatura nº ${nova.number} venceu no Mercado Pago` });
      // Repetido: nada.
      expect((await avisar(EMPRESA_PADRAO.slug, pagamento.id, SEGREDO_A)).corpo.resultado).toBe("nada");

      expect((await gerar(nova.id, "BOLETO")).status).toBe(201);
      const boleto = (await cobrancasDe(nova.id)).find((c) => c.kind === "BOLETO")!;
      Object.assign(await pagamentoDe(boleto), { status: "cancelled", status_detail: "by_collector" });
      expect((await avisar(EMPRESA_PADRAO.slug, boleto.gatewayId!, SEGREDO_A)).corpo.resultado).toBe("encerrada");
      expect((await cobrancasDe(nova.id)).find((c) => c.kind === "BOLETO")).toMatchObject({ status: "CANCELLED" });
    });

    it("Mercado Pago fora do ar: responde 503 para ele reenviar, e nada muda; limite de avisos por empresa responde 429", async () => {
      const { nova, pagamento } = await comPix();
      aprovar(pagamento);
      process.env.MERCADO_PAGO_API = "http://127.0.0.1:1";
      try {
        expect((await avisar(EMPRESA_PADRAO.slug, pagamento.id, SEGREDO_A)).status).toBe(503);
      } finally {
        process.env.MERCADO_PAGO_API = api;
      }
      expect(await fatura(nova.id)).toMatchObject({ status: "OPEN" });

      for (let i = 0; i < 120; i += 1) limite.consumeRateLimit(`mercado-pago:${EMPRESA_PADRAO.slug}`, 120, 60_000);
      expect((await avisar(EMPRESA_PADRAO.slug, pagamento.id, SEGREDO_A)).status).toBe(429);
      // O limite é por empresa: a outra continua atendendo (404 porque não ligou a conta).
      expect((await avisar(EMPRESA_OUTRA.slug, pagamento.id, SEGREDO_A)).status).toBe(404);
      expect(await fatura(nova.id)).toMatchObject({ status: "OPEN" });
    });

    it("fatura paga pelo Mercado Pago não é reaberta: nem pelo Faturamento, nem depois", async () => {
      const { nova, pagamento } = await comPix();
      aprovar(pagamento);
      expect((await avisar(EMPRESA_PADRAO.slug, pagamento.id, SEGREDO_A)).corpo.resultado).toBe("paga");

      entrarComo("ADMIN");
      const reabrir = await lida(await faturaPorId.PATCH(req("PATCH", { action: "reabrir" }), ctx(nova.id)));
      expect(reabrir.status).toBe(409);
      expect(reabrir.corpo.error).toContain("paga pelo Mercado Pago");
      expect(await fatura(nova.id)).toMatchObject({ status: "PAID", transaction: { status: "PAID" } });
      // A fatura paga à mão continua podendo ser reaberta.
      const outra = await emitirFatura(70);
      entrarComo("ADMIN");
      expect((await faturaPorId.PATCH(req("PATCH", { action: "pagar" }), ctx(outra.id))).status).toBe(200);
      entrarComo("ADMIN");
      expect((await faturaPorId.PATCH(req("PATCH", { action: "reabrir" }), ctx(outra.id))).status).toBe(200);
    });
  });

  /* ------------------------ Consulta manual e periódica ----------------------- */

  describe("quando o aviso não chega", () => {
    it("Atualizar situação consulta o Mercado Pago e paga a fatura; cobrança que não nasceu não tem o que consultar", async () => {
      await ligarConta();
      const nova = await emitirFatura(150);
      expect((await gerar(nova.id, "PIX")).status).toBe(201);
      const [cobranca] = await cobrancasDe(nova.id);

      expect((await atualizar(nova.id, cobranca.id)).corpo).toMatchObject({ situacao: "PENDING" });
      expect(await fatura(nova.id)).toMatchObject({ status: "OPEN" });

      aprovar(await pagamentoDe(cobranca));
      const atualizada = await atualizar(nova.id, cobranca.id, "FINANCE");
      expect(atualizada).toMatchObject({ status: 200, corpo: { id: cobranca.id, situacao: "PAID", valorPago: 150 } });
      expect(await fatura(nova.id)).toMatchObject({ status: "PAID", transaction: { paymentMethod: "PIX" } });
      // Quem paga é o Mercado Pago também aqui: a pessoa só pediu a consulta.
      expect((await trilha(nova.id)).filter((linha) => linha.action === "fatura.pagar")).toEqual([expect.objectContaining({ userName: "Mercado Pago" })]);
      // De novo: nada.
      expect((await atualizar(nova.id, cobranca.id)).corpo).toMatchObject({ situacao: "PAID" });
      expect((await trilha(nova.id)).filter((linha) => linha.action === "fatura.pagar")).toHaveLength(1);

      // Cobrança inexistente, de outra fatura, ou que não chegou a ser criada.
      expect((await atualizar(nova.id, SEM_ID)).status).toBe(404);
      const outra = await emitirFatura(60);
      expect((await atualizar(outra.id, cobranca.id)).status).toBe(404);
      modo = "recusa";
      await gerar(outra.id, "PIX");
      const [falha] = await cobrancasDe(outra.id);
      expect(await atualizar(outra.id, falha.id)).toMatchObject({ status: 409, corpo: { error: expect.stringContaining("não chegou a ser criada") } });
    });

    it("a conferência periódica paga o que foi aprovado e só olha cobranças das últimas 72 horas", async () => {
      await ligarConta();
      const recente = await emitirFatura(150);
      const antiga = await emitirFatura(90);
      const pendente = await emitirFatura(40);
      for (const f of [recente, antiga, pendente]) expect((await gerar(f.id, "PIX")).status).toBe(201);
      const [daRecente] = await cobrancasDe(recente.id);
      const [daAntiga] = await cobrancasDe(antiga.id);
      aprovar(await pagamentoDe(daRecente));
      aprovar(await pagamentoDe(daAntiga));
      await banco.sistema.paymentCharge.update({ where: { id: daAntiga.id }, data: { createdAt: new Date(Date.now() - 73 * 3_600_000) } });

      sessao.mockResolvedValue(null);
      expect(await gatewayDb.conferirCobrancasEmAberto()).toBe(1);
      expect(await fatura(recente.id)).toMatchObject({ status: "PAID" });
      expect(await fatura(antiga.id)).toMatchObject({ status: "OPEN" });
      expect(await fatura(pendente.id)).toMatchObject({ status: "OPEN" });
      expect((await cobrancasDe(pendente.id))[0].checkedAt).not.toBeNull();
      // Rodar de novo não repete nada.
      expect(await gatewayDb.conferirCobrancasEmAberto()).toBe(0);
      expect((await trilha(recente.id)).filter((linha) => linha.action === "fatura.pagar")).toHaveLength(1);

      // Sem a chave de dados não consulta ninguém.
      const chave = process.env.TMS_CHAVE_DE_DADOS;
      delete process.env.TMS_CHAVE_DE_DADOS;
      const antes = pedidos.length;
      try {
        expect(await gatewayDb.conferirCobrancasEmAberto()).toBe(0);
      } finally {
        process.env.TMS_CHAVE_DE_DADOS = chave;
      }
      expect(pedidos.length).toBe(antes);
    });
  });

  /* ---------------------------- Portal e avisos de fora ---------------------- */

  describe("onde a cobrança aparece", () => {
    it("portal do cliente: o Pix dinâmico (com QR) entra no lugar do estático, e o boleto vem com o link; só o dele", async () => {
      await ligarConta();
      await banco.sistema.tenant.update({ where: { id: EMPRESA_PADRAO.id }, data: { pixKeyType: "CNPJ", pixKey: "12345678000195", pixName: "Transportadora Teste", pixCity: "MIRASSOL" } });
      try {
        const comCobranca = await emitirFatura(150);
        const semCobranca = await emitirFatura(60);
        const doOutroCliente = await emitirFatura(75, { cliente: clienteSemDados });
        await banco.default.client.update({ where: { id: clienteSemDados }, data: { email: "a@semdados.exemplo.br" } });
        expect((await gerar(comCobranca.id, "PIX")).status).toBe(201);
        expect((await gerar(comCobranca.id, "BOLETO")).status).toBe(201);
        expect((await gerar(doOutroCliente.id, "PIX")).status).toBe(201);
        await banco.default.client.update({ where: { id: clienteSemDados }, data: { email: null } });

        entrarComo("CLIENTE");
        type Titulo = { description: string; pix: string | null; cobranca: { pix: Record<string, unknown> | null; boleto: Record<string, unknown> | null } | null };
        const lista = (await lida<Titulo[]>(await faturasDoPortal.GET())).corpo;
        expect(lista).toHaveLength(2);
        const com = lista.find((t) => t.description.includes(`nº ${comCobranca.number} `))!;
        const sem = lista.find((t) => t.description.includes(`nº ${semCobranca.number} `))!;
        expect(com.pix).toBeNull();
        expect(com.cobranca?.pix).toMatchObject({ copiaECola: expect.stringContaining("br.gov.bcb.pix-FALSO"), qrCodeBase64: expect.stringMatching(/^iVBOR/) });
        expect(com.cobranca?.boleto).toMatchObject({ link: expect.stringContaining("boleto=1"), linhaDigitavel: expect.stringMatching(/^\d{47}$/) });
        expect(Object.keys(com.cobranca!.pix!).sort()).toEqual(["copiaECola", "linhaDigitavel", "link", "qrCodeBase64", "venceEm"]);
        // Sem cobrança gerada, continua o Pix estático da chave da empresa.
        expect(sem.cobranca).toBeNull();
        expect(sem.pix).toMatch(/^000201/);
      } finally {
        await banco.sistema.tenant.update({ where: { id: EMPRESA_PADRAO.id }, data: { pixKeyType: null, pixKey: null, pixName: null, pixCity: null } });
      }
    });

    it("aviso fatura.emitida para o n8n leva o copia-e-cola e o link da cobrança em aberto; sem cobrança, não leva", async () => {
      await ligarConta();
      entrarComo("ADMIN");
      expect((await webhookDaEmpresa.PUT(req("PUT", { url: `${api}/n8n` }))).status).toBe(201);
      const comCobranca = await emitirFatura(150);
      const semCobranca = await emitirFatura(60);
      const pix = await gerar(comCobranca.id, "PIX");
      const boleto = await gerar(comCobranca.id, "BOLETO");

      await eventos.despacharPendentes();
      const emitidas = recebidosNoN8n.filter((r) => r.tipo === "fatura.emitida").map((r) => r.dados.fatura as Record<string, unknown>);
      const com = emitidas.find((f) => f.id === comCobranca.id)!;
      expect(com.pixCopiaECola).toBe(pix.corpo.copiaECola);
      expect(com.cobranca).toEqual({
        pix: { copiaECola: pix.corpo.copiaECola, link: pix.corpo.link, venceEm: pix.corpo.venceEm },
        boleto: { link: boleto.corpo.link, linhaDigitavel: boleto.corpo.linhaDigitavel, venceEm: boleto.corpo.venceEm },
      });
      const sem = emitidas.find((f) => f.id === semCobranca.id)!;
      expect("cobranca" in sem).toBe(false);
      expect("pixCopiaECola" in sem).toBe(false);
    });
  });

  /* ------------------------------ Nada de segredo ---------------------------- */

  it("token e segredo nunca aparecem em resposta, auditoria, aviso, evento nem log", async () => {
    // Um percurso inteiro, com erro no meio, para encher os lugares onde algo poderia vazar.
    await ligarConta();
    await ligarConta("ADMIN_DA_OUTRA", TOKEN_B, SEGREDO_B);
    entrarComo("ADMIN");
    await lida(await gatewayRota.GET());
    entrarComo("ADMIN");
    await lida(await gatewayTeste.POST());
    entrarComo("ADMIN");
    expect((await webhookDaEmpresa.PUT(req("PUT", { url: `${api}/n8n` }))).status).toBe(201);
    const nova = await emitirFatura(150);
    modo = "recusa";
    await gerar(nova.id, "PIX");
    modo = "queda";
    await gerar(nova.id, "PIX");
    await gerar(nova.id, "PIX");
    const cobranca = (await cobrancasDe(nova.id)).find((c) => c.status === "PENDING")!;
    await avisar(EMPRESA_PADRAO.slug, cobranca.gatewayId!, "segredo-errado");
    process.env.MERCADO_PAGO_API = "http://127.0.0.1:1";
    await avisar(EMPRESA_PADRAO.slug, cobranca.gatewayId!, SEGREDO_A);
    await atualizar(nova.id, cobranca.id);
    process.env.MERCADO_PAGO_API = api;
    aprovar(await pagamentoDe(cobranca), 151);
    expect((await avisar(EMPRESA_PADRAO.slug, cobranca.gatewayId!, SEGREDO_A)).corpo.resultado).toBe("paga");
    entrarComo("ADMIN");
    await lida(await faturaPorId.GET(req(), ctx(nova.id)));
    await eventos.despacharPendentes();
    entrarComo("ADMIN");
    await lida(await gatewayRota.DELETE(req("DELETE")));

    const { sistema } = banco;
    const lugares: Record<string, string> = {
      respostas: respostas.join("\n"),
      logs: logs.join("\n"),
      auditoria: JSON.stringify(await sistema.auditLog.findMany({ where: DAS_EMPRESAS })),
      avisos: JSON.stringify(await sistema.notification.findMany({ where: DAS_EMPRESAS })),
      eventos: JSON.stringify(await sistema.outboxEvent.findMany({ where: DAS_EMPRESAS })),
      entreguesAoN8n: JSON.stringify(recebidosNoN8n),
      cobrancas: JSON.stringify(await sistema.paymentCharge.findMany({ where: DAS_EMPRESAS })),
      contas: JSON.stringify(await sistema.paymentGateway.findMany({ where: DAS_EMPRESAS })),
    };
    expect(lugares.respostas.length).toBeGreaterThan(500);
    expect(lugares.auditoria).toContain("empresa.gateway");
    expect(recebidosNoN8n.length).toBeGreaterThan(0);
    for (const [lugar, texto] of Object.entries(lugares)) {
      for (const segredo of [TOKEN_A, SEGREDO_A, TOKEN_B, SEGREDO_B]) expect(texto.includes(segredo), `${lugar} contém uma credencial`).toBe(false);
      // Nem um pedaço reconhecível delas (o final de 4 caracteres é o único que pode aparecer).
      for (const pedaco of ["gateway-teste-empresa", "assinatura-secreta-da-empresa", "APP_USR-1111", "APP_USR-2222"]) expect(texto.includes(pedaco), `${lugar} contém "${pedaco}"`).toBe(false);
    }
  });
});
