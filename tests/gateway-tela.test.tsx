// @vitest-environment jsdom
import { Suspense, act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ate, clicar, desmontarTudo, montar, porTexto } from "./tela";
import { GATEWAY_INDISPONIVEL } from "../src/lib/cobranca-gateway";

/**
 * Telas da cobrança pelo Mercado Pago: a fatura do painel (gerar e atualizar),
 * as faturas do portal do cliente (Pix com QR Code e boleto) e a parte
 * "Mercado Pago" de Empresa > Cobrança. As regras e as rotas são testadas em
 * `tests/gateway.test.ts`; aqui se confere o que cada tela mostra e pede.
 */

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));
vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ src, alt, ...resto }: { src: string; alt: string; [atributo: string]: unknown }) => <img src={src} alt={alt} data-qr={resto["data-qr"] === undefined ? undefined : ""} />,
}));

import FaturaPage from "../src/app/dashboard/faturamento/[id]/page";
import PortalFaturasPage from "../src/app/portal/faturas/page";
import EmpresaPage from "../src/app/dashboard/empresa/page";

type Resposta = { status?: number; body: unknown };
type Pedido = { metodo: string; caminho: string; corpo: unknown };

/** Cada `MÉTODO caminho` recebe a próxima resposta da fila (a última se repete). Caminho sem resposta falha a chamada. */
function api(respostas: Record<string, Resposta[]>) {
  const pedidos: Pedido[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const metodo = init?.method ?? "GET";
      const caminho = String(url);
      pedidos.push({ metodo, caminho, corpo: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
      const fila = respostas[`${metodo} ${caminho}`];
      const resposta = fila?.length === 1 ? fila[0] : fila?.shift();
      if (!resposta) throw new Error(`Chamada inesperada: ${metodo} ${caminho}`);
      return new Response(JSON.stringify(resposta.body), { status: resposta.status ?? 200 });
    }),
  );
  return pedidos;
}

afterEach(async () => {
  await desmontarTudo();
  vi.unstubAllGlobals();
});

const QR = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk";

const cobranca = (extra: Record<string, unknown>) => ({
  id: "cob-1",
  tipo: "PIX",
  situacao: "PENDING",
  valor: 300,
  valorPago: null,
  copiaECola: "00020126580014br.gov.bcb.pix-DINAMICO",
  qrCodeBase64: QR,
  link: "https://www.mercadopago.com.br/payments/1/ticket",
  linhaDigitavel: null,
  venceEm: "2026-11-11T02:59:59.000Z",
  criadaEm: "2026-10-10T12:00:00.000Z",
  pagaEm: null,
  nota: null,
  ...extra,
});

describe("fatura do painel", () => {
  const fatura = (extra: Record<string, unknown>) => ({
    number: 12,
    status: "OPEN",
    total: 300,
    dueDate: "2026-11-10T00:00:00.000Z",
    issuedAt: "2026-10-01T12:00:00.000Z",
    paidAt: null,
    notes: null,
    client: { companyName: "Serilon Brasil Ltda", tradeName: "Serilon", cnpj: "12345678000190" },
    transaction: { id: "t-12" },
    pix: null,
    collections: [],
    ...extra,
  });

  async function abrir(respostas: Record<string, Resposta[]>) {
    const pedidos = api(respostas);
    const tela = await montar(
      <Suspense fallback="carregando">
        <FaturaPage params={Promise.resolve({ id: "fat-12" })} />
      </Suspense>,
    );
    await ate(() => expect(tela.querySelector("h1")?.textContent).toBe("Fatura nº 12"));
    return { tela, pedidos };
  }

  it("sem a conta ligada não há botão de gerar, e a dica continua sendo cadastrar a chave Pix", async () => {
    const { tela } = await abrir({ "GET /api/faturas/fat-12": [{ body: fatura({ gateway: false, cobrancas: [] }) }] });
    expect(tela.querySelector("[data-cobrancas]")).toBeNull();
    expect(tela.querySelector("[data-sem-pix]")).not.toBeNull();
  });

  it("com a conta ligada: Gerar Pix pede a cobrança e a tela passa a mostrar o QR Code e o copia-e-cola; o botão desse tipo some", async () => {
    const { tela, pedidos } = await abrir({
      "GET /api/faturas/fat-12": [{ body: fatura({ gateway: true, cobrancas: [] }) }, { body: fatura({ gateway: true, cobrancas: [cobranca({})] }) }],
      "POST /api/faturas/fat-12/cobrancas": [{ status: 201, body: cobranca({}) }],
    });
    expect(tela.querySelector("[data-sem-pix]")).toBeNull();
    expect([...tela.querySelectorAll("[data-gerar]")].map((b) => b.textContent)).toEqual(["Gerar Pix", "Gerar boleto"]);
    expect(tela.querySelector("[data-cobrancas]")?.closest(".print\\:hidden") ?? tela.querySelector("[data-cobrancas].print\\:hidden")).not.toBeNull();

    await clicar(tela.querySelector('[data-gerar="PIX"]')!);
    await ate(() => expect(tela.querySelector("[data-cobranca]")).not.toBeNull());
    expect(pedidos.find((p) => p.metodo === "POST")).toEqual({ metodo: "POST", caminho: "/api/faturas/fat-12/cobrancas", corpo: { tipo: "PIX" } });
    expect(tela.querySelector('[role="status"]')?.textContent).toBe("Pix gerado.");
    expect(tela.querySelector("img[data-qr]")?.getAttribute("src")).toBe(`data:image/png;base64,${QR}`);
    expect((tela.querySelector("textarea") as HTMLTextAreaElement).value).toBe("00020126580014br.gov.bcb.pix-DINAMICO");
    expect(tela.textContent).toContain("a baixa da fatura é automática");
    expect([...tela.querySelectorAll("[data-gerar]")].map((b) => b.getAttribute("data-gerar"))).toEqual(["BOLETO"]);
  });

  it("erro do Mercado Pago aparece como veio; perfil que só lê recebe o recado de que não gera", async () => {
    const { tela } = await abrir({
      "GET /api/faturas/fat-12": [{ body: fatura({ gateway: true, cobrancas: [] }) }],
      "POST /api/faturas/fat-12/cobrancas": [{ status: 400, body: { error: "Para gerar a cobrança, falta no cadastro do cliente: e-mail." } }, { status: 403, body: { error: "Acesso negado" } }],
    });
    await clicar(tela.querySelector('[data-gerar="BOLETO"]')!);
    await ate(() => expect(tela.querySelector('[role="alert"]')?.textContent).toBe("Para gerar a cobrança, falta no cadastro do cliente: e-mail."));
    await clicar(tela.querySelector('[data-gerar="PIX"]')!);
    await ate(() => expect(tela.querySelector('[role="alert"]')?.textContent).toBe("Seu perfil não gera nem atualiza cobrança."));
  });

  it("boleto em aberto mostra link e linha digitável; Atualizar situação consulta e mostra a fatura paga; a conferir mostra o motivo", async () => {
    const boleto = cobranca({ id: "cob-2", tipo: "BOLETO", copiaECola: null, qrCodeBase64: null, link: "https://www.mercadopago.com.br/payments/2/ticket", linhaDigitavel: "23793380296060054351030006333303799140000030000" });
    const conferir = cobranca({ id: "cob-3", situacao: "REVIEW", copiaECola: null, qrCodeBase64: null, link: null, nota: "O valor da cobrança no Mercado Pago (R$ 15,00) não é o desta cobrança (R$ 300,00)." });
    const { tela, pedidos } = await abrir({
      "GET /api/faturas/fat-12": [
        { body: fatura({ gateway: true, cobrancas: [boleto, conferir] }) },
        { body: fatura({ gateway: true, status: "PAID", paidAt: "2026-10-12T15:00:00.000Z", cobrancas: [{ ...boleto, situacao: "PAID", link: null, linhaDigitavel: null, pagaEm: "2026-10-12T15:00:00.000Z" }] }) },
      ],
      "POST /api/faturas/fat-12/cobrancas/cob-2": [{ body: { ...boleto, situacao: "PAID" } }],
    });
    const caixa = tela.querySelector("[data-boleto]")!;
    expect(caixa.textContent).toContain("23793380296060054351030006333303799140000030000");
    expect(caixa.querySelector("a")?.getAttribute("href")).toBe("https://www.mercadopago.com.br/payments/2/ticket");
    expect(caixa.querySelector("a")?.getAttribute("rel")).toContain("noopener");
    expect(tela.querySelector('[data-cobranca="cob-3"]')?.textContent).toContain("A conferir");
    expect(tela.querySelector('[data-cobranca="cob-3"]')?.textContent).toContain("não é o desta cobrança");

    await clicar(tela.querySelector('[data-atualizar="cob-2"]')!);
    await ate(() => expect(tela.querySelector('[data-situacao="PAID"]')).not.toBeNull());
    expect(pedidos.filter((p) => p.metodo === "POST").map((p) => p.caminho)).toEqual(["/api/faturas/fat-12/cobrancas/cob-2"]);
    expect(tela.querySelector('[role="status"]')?.textContent).toBe("Situação: paga.");
    // Fatura paga: nada mais para gerar nem para pagar.
    expect(tela.querySelector("[data-gerar]")).toBeNull();
    expect(tela.querySelector("[data-boleto]")).toBeNull();
  });
});

describe("faturas do portal do cliente", () => {
  const titulo = (extra: Record<string, unknown>) => ({ id: "t-1", amount: 300, description: "Fatura nº 12 (1 carga)", dueDate: "2026-11-10T00:00:00.000Z", status: "PENDING", createdAt: "2026-10-01T12:00:00.000Z", pix: null, cobranca: null, ...extra });

  it("com cobrança do Mercado Pago: Pix com QR Code no lugar do estático, e o boleto com link; sem cobrança, o estático", async () => {
    api({
      "GET /api/portal/faturas": [
        {
          body: [
            titulo({
              cobranca: {
                pix: { copiaECola: "00020126-DINAMICO", qrCodeBase64: QR, link: "https://www.mercadopago.com.br/payments/1/ticket", linhaDigitavel: null, venceEm: "2026-11-11T02:59:59.000Z" },
                boleto: { copiaECola: null, qrCodeBase64: null, link: "https://www.mercadopago.com.br/payments/2/ticket", linhaDigitavel: "23793380296060054351030006333303799140000030000", venceEm: "2026-11-11T02:59:59.000Z" },
              },
            }),
            titulo({ id: "t-2", description: "Fatura nº 13 (1 carga)", pix: "00020126-ESTATICO" }),
            titulo({ id: "t-3", description: "Fatura nº 14 (1 carga)", status: "PAID" }),
          ],
        },
      ],
    });
    const tela = await montar(<PortalFaturasPage />);
    await ate(() => expect(tela.querySelectorAll("[data-fatura]")).toHaveLength(3));

    const linha = (id: string) => tela.querySelector(`[data-fatura="${id}"]`)!;
    expect(porTexto(linha("t-1"), "button", "Pagar com").map((b) => b.textContent)).toEqual(["Pagar com Pix", "Pagar com boleto"]);
    expect(porTexto(linha("t-2"), "button", "Pagar com").map((b) => b.textContent)).toEqual(["Pagar com Pix"]);
    expect(porTexto(linha("t-3"), "button", "Pagar com")).toHaveLength(0);

    await clicar(porTexto(linha("t-1"), "button", "Pagar com Pix")[0]);
    const pix = tela.querySelector('[data-pix-de="t-1"]')!;
    expect(pix.querySelector("img[data-qr]")?.getAttribute("src")).toBe(`data:image/png;base64,${QR}`);
    expect((pix.querySelector("textarea") as HTMLTextAreaElement).value).toBe("00020126-DINAMICO");
    expect(pix.textContent).toContain("a baixa da fatura é automática");

    await clicar(porTexto(linha("t-1"), "button", "Pagar com boleto")[0]);
    const boleto = tela.querySelector('[data-boleto-de="t-1"]')!;
    expect(boleto.querySelector("a")?.getAttribute("href")).toBe("https://www.mercadopago.com.br/payments/2/ticket");
    expect(boleto.textContent).toContain("23793380296060054351030006333303799140000030000");

    // O estático continua como era: sem QR e com o aviso de que a baixa é manual.
    await clicar(porTexto(linha("t-2"), "button", "Pagar com Pix")[0]);
    const estatico = tela.querySelector('[data-pix-de="t-2"]')!;
    expect(estatico.querySelector("img")).toBeNull();
    expect((estatico.querySelector("textarea") as HTMLTextAreaElement).value).toBe("00020126-ESTATICO");
    expect(estatico.textContent).not.toContain("automática");
  });
});

describe("Empresa > Cobrança > Mercado Pago", () => {
  const BASE = {
    "GET /api/empresa": [{ body: { name: "Mello Transportes", logo: null } }],
    "GET /api/empresa/cobranca": [{ body: { multaPct: 2, jurosPct: 1 } }],
    "GET /api/empresa/webhook": [{ body: { url: null, entregas: [] } }],
  };
  const WEBHOOK = "https://tms.exemplo.br/api/pagamentos/mercado-pago/mello";
  const desligado = { disponivel: true, configurado: false, accessTokenFinal: null, webhookSecretFinal: null, webhook: WEBHOOK };
  const ligado = { disponivel: true, configurado: true, accessTokenFinal: "ERTY", webhookSecretFinal: "CVBN", webhook: WEBHOOK };

  async function abrir(respostas: Record<string, Resposta[]>) {
    const pedidos = api({ ...BASE, ...respostas });
    const tela = await montar(<EmpresaPage />);
    await ate(() => expect(tela.querySelector('section[aria-label="Mercado Pago"]')).not.toBeNull());
    return { tela, pedidos, secao: tela.querySelector('section[aria-label="Mercado Pago"]') as HTMLElement };
  }

  const digitar = async (campo: Element, valor: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(campo, valor);
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };

  it("sem a chave de dados no servidor a tela explica e não oferece o formulário", async () => {
    const { secao } = await abrir({ "GET /api/empresa/gateway": [{ body: { ...desligado, disponivel: false } }] });
    expect(secao.querySelector("[data-gateway-indisponivel]")?.textContent).toBe(GATEWAY_INDISPONIVEL);
    expect(secao.querySelector("form")).toBeNull();
  });

  it("mostra o endereço de webhook, liga a conta e esvazia os campos; depois só aparece o final das credenciais", async () => {
    const { tela, secao, pedidos } = await abrir({
      "GET /api/empresa/gateway": [{ body: desligado }],
      "PUT /api/empresa/gateway": [{ body: ligado }],
      "POST /api/empresa/gateway/teste": [{ body: { conta: "TRANSPORTADORA_A" } }],
      "DELETE /api/empresa/gateway": [{ body: desligado }],
    });
    expect(secao.querySelector("[data-webhook]")?.textContent).toBe(WEBHOOK);
    expect(secao.querySelector("[data-gateway-configurado]")).toBeNull();
    expect(porTexto(secao, "button", "Testar conexão")).toHaveLength(0);
    const token = secao.querySelector('[data-campo="accessToken"]') as HTMLInputElement;
    const segredo = secao.querySelector('[data-campo="webhookSecret"]') as HTMLInputElement;
    // Campo de senha: a credencial não fica legível na tela nem enquanto é digitada.
    expect([token.type, segredo.type]).toEqual(["password", "password"]);

    await digitar(token, "APP_USR-token-digitado-na-tela-QWERTY");
    await digitar(segredo, "segredo-digitado-na-tela-ZXCVBN");
    await act(async () => {
      secao.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await ate(() => expect(secao.querySelector("[data-gateway-configurado]")).not.toBeNull());
    expect(pedidos.find((p) => p.metodo === "PUT")).toEqual({ metodo: "PUT", caminho: "/api/empresa/gateway", corpo: { accessToken: "APP_USR-token-digitado-na-tela-QWERTY", webhookSecret: "segredo-digitado-na-tela-ZXCVBN" } });
    expect(secao.querySelector("[data-gateway-configurado]")?.textContent).toBe("Configurado: Access Token final ERTY, assinatura final CVBN.");
    expect([token.value, segredo.value]).toEqual(["", ""]);
    expect(tela.innerHTML).not.toContain("token-digitado-na-tela");
    expect(tela.innerHTML).not.toContain("segredo-digitado-na-tela");

    await clicar(porTexto(secao, "button", "Testar conexão")[0]);
    await ate(() => expect(secao.querySelector('[role="status"]')?.textContent).toBe("Conexão certa: conta TRANSPORTADORA_A."));
    // O teste de conexão não muda o que está configurado.
    expect(secao.querySelector("[data-gateway-configurado]")).not.toBeNull();

    await clicar(porTexto(secao, "button", "Desligar")[0]);
    await ate(() => expect(secao.querySelector("[data-gateway-configurado]")).toBeNull());
    expect(secao.querySelector('[role="status"]')?.textContent).toBe("Conta do Mercado Pago desligada.");
  });

  it("erro ao testar aparece como alerta; no celular a aba Cobrança tem as duas partes", async () => {
    const { tela, secao } = await abrir({
      "GET /api/empresa/gateway": [{ body: ligado }],
      "POST /api/empresa/gateway/teste": [{ status: 502, body: { error: "O Mercado Pago recusou o Access Token. Confira a credencial em Empresa > Cobrança." } }],
    });
    await clicar(porTexto(secao, "button", "Testar conexão")[0]);
    await ate(() => expect(secao.querySelector('[role="alert"]')?.textContent).toContain("recusou o Access Token"));

    // Fora da aba Cobrança a seção fica escondida no celular.
    expect(secao.className).toContain("hidden md:block");
    await clicar(tela.querySelector('[data-aba="cobranca"]')!);
    expect(tela.querySelector('form[aria-label="Cobrança"]')?.className).not.toContain("hidden md:block");
    expect(secao.className).toContain("hidden md:block");
    await clicar(tela.querySelector('[data-parte="mercado-pago"]')!);
    expect(secao.className).not.toContain("hidden md:block");
    expect(tela.querySelector('form[aria-label="Cobrança"]')?.className).toContain("hidden md:block");
  });
});
