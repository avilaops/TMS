// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ate, clicar, desmontarTudo, montar, porTexto } from "./tela";
import type { NotaImportada, SugestaoDeCarga } from "../src/lib/nfe";

/**
 * Tela das notas fiscais (importar, consultar, criar a carga). A tela do CT-e
 * tem o seu arquivo (tests/cte-tela.test.tsx). As regras e as rotas são testadas em `tests/fiscal.test.ts`; aqui se
 * confere o que cada tela mostra e o que ela manda para a API.
 */

vi.mock("next/link", () => ({
  default: ({ href, children, className, ...resto }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className} {...resto}>
      {children}
    </a>
  ),
}));

import NotasFiscaisPage from "../src/app/dashboard/fiscal/page";

type Resposta = { status?: number; body: unknown };
type Pedido = { url: string; method: string; body: Record<string, unknown> | undefined };

/** Respostas por "MÉTODO endereço" (o GET dispensa o método): fixas, ou calculadas a partir do corpo do pedido. */
function api(respostas: Record<string, Resposta | ((body: Record<string, unknown> | undefined) => Resposta)>) {
  const pedidos: Pedido[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
      pedidos.push({ url: String(url), method, body });
      const resposta = respostas[method === "GET" ? String(url) : `${method} ${String(url)}`];
      if (!resposta) throw new Error(`Chamada inesperada: ${method} ${String(url)}`);
      const { status, body: corpo } = typeof resposta === "function" ? resposta(body) : resposta;
      return new Response(JSON.stringify(corpo), { status: status ?? 200 });
    }),
  );
  return pedidos;
}

async function enviar(form: HTMLFormElement) {
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

/** Escolhe arquivos no campo de envio, como o seletor do navegador faria. */
async function escolher(campo: HTMLInputElement, arquivos: File[]) {
  Object.defineProperty(campo, "files", { configurable: true, value: arquivos });
  await act(async () => {
    campo.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

afterEach(async () => {
  await desmontarTudo();
  vi.unstubAllGlobals();
});

const CHAVE = "35261099444333000181550010000012341123456780";

const nota = (extra: Partial<NotaImportada> = {}): NotaImportada => ({
  id: "n1",
  accessKey: CHAVE,
  number: 1234,
  series: 1,
  issuedAt: "2026-10-08T17:30:00.000Z",
  operationNature: "Venda de mercadoria",
  freightMode: 0,
  issuerTaxId: "99444333000181",
  issuerName: "Fábrica de Tintas",
  issuerCity: "São José do Rio Preto",
  issuerState: "SP",
  issuerAddress: null,
  recipientTaxId: "99444333000262",
  recipientName: "Mercado Bom Preço",
  recipientCity: "Mirassol",
  recipientState: "SP",
  recipientAddress: null,
  totalValue: 1534.56,
  grossWeight: 42.5,
  volumes: 3,
  createdAt: "2026-10-09T12:00:00.000Z",
  collection: null,
  ...extra,
});

const SUGESTAO: SugestaoDeCarga = {
  clientId: "cli1",
  pagador: "EMITENTE",
  sender: "Fábrica de Tintas",
  receiver: "Mercado Bom Preço",
  origin: "São José do Rio Preto - SP",
  destination: "Mirassol - SP",
  volumes: 3,
  weight: 42.5,
  invoiceKey: CHAVE,
  invoiceValue: 1534.56,
  avisos: [],
  deliveryStreet: "Av. Brasil",
  deliveryNumber: "450",
  deliveryDistrict: "Centro",
  deliveryZip: "15130000",
};

const CARGA = { id: "c1", trackingCode: "1234567890", status: "CONFIRMED", origin: "São José do Rio Preto - SP", destination: "Mirassol - SP" };
const CLIENTES = [
  { id: "cli1", companyName: "Fábrica de Tintas LTDA", tradeName: "Fábrica de Tintas", cnpj: "99444333000181", active: true },
  { id: "cli2", companyName: "Cliente inativo", tradeName: null, cnpj: "99444333000343", active: false },
];

describe("tela de notas fiscais", () => {
  it("lista as notas com a carga ligada, e a que não tem carga oferece criar", async () => {
    api({ "/api/fiscal/notas": { body: [nota({ id: "n2", number: 77, collection: CARGA }), nota()] }, "/api/clientes": { body: CLIENTES } });
    const tela = await montar(<NotasFiscaisPage />);
    await ate(() => expect(tela.querySelectorAll("tr[data-nota]")).toHaveLength(2));

    const [ligada, solta] = [...tela.querySelectorAll("tr[data-nota]")];
    expect(ligada.textContent).toContain("NF-e 77 / 1");
    expect(ligada.textContent).toContain("1234567890");
    expect(porTexto(ligada, "button", "Abrir")).toHaveLength(1);
    expect(solta.textContent).toContain("sem carga");
    expect(solta.textContent).toMatch(/R\$\s1\.534,56/);
    expect(porTexto(solta, "button", "Criar carga")).toHaveLength(1);
    expect(solta.querySelector("a[download]")!.getAttribute("href")).toBe("/api/fiscal/notas/n1/xml");
    expect(tela.querySelector('a[href="/dashboard/fiscal/cte"]')).not.toBeNull();
  });

  it("sessão expirada mostra o caminho do login; perfil sem acesso mostra acesso negado", async () => {
    api({ "/api/fiscal/notas": { status: 401, body: { error: "Não autorizado" } }, "/api/clientes": { status: 401, body: {} } });
    const expirada = await montar(<NotasFiscaisPage />);
    await ate(() => expect(expirada.textContent).toContain("Sessão expirada"));
    expect(expirada.querySelector('a[href="/login"]')).not.toBeNull();
    await desmontarTudo();

    api({ "/api/fiscal/notas": { status: 403, body: { error: "Acesso negado" } }, "/api/clientes": { status: 403, body: {} } });
    const negada = await montar(<NotasFiscaisPage />);
    await ate(() => expect(negada.textContent).toContain("Acesso negado"));
  });

  it("um XML enviado abre a carga sugerida já preenchida, e confirmar cria a carga", async () => {
    const criada = nota({ collection: CARGA });
    const pedidos = api({
      "/api/fiscal/notas": { body: [] },
      "/api/clientes": { body: CLIENTES },
      "POST /api/fiscal/notas": { status: 201, body: { nota: nota(), sugestao: SUGESTAO, cargaComAChave: null } },
      "POST /api/fiscal/notas/n1/carga": { status: 201, body: { nota: criada, coleta: { id: "c1" } } },
    });
    const tela = await montar(<NotasFiscaisPage />);
    await ate(() => expect(tela.textContent).toContain("Nenhuma nota importada ainda"));

    await escolher(tela.querySelector('input[type="file"]')!, [new File(["<nfeProc/>"], "nota.xml", { type: "text/xml" })]);
    await ate(() => expect(tela.querySelector('[role="dialog"]')).not.toBeNull());

    expect(pedidos.find((p) => p.method === "POST")).toMatchObject({ url: "/api/fiscal/notas", body: { xml: "<nfeProc/>" } });
    const painel = tela.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(painel.textContent).toContain("NF-e 1234 / 1");
    expect(painel.textContent).toContain("Fábrica de Tintas");
    expect(painel.textContent).toContain("99.444.333/0002-62");
    // Só cliente ativo entra no seletor, e o pagador já vem escolhido.
    const seletor = painel.querySelector("select")!;
    expect([...seletor.options].map((o) => o.value)).toEqual(["", "cli1"]);
    expect(seletor.value).toBe("cli1");
    const valores = [...painel.querySelectorAll<HTMLInputElement>("form input")].map((campo) => campo.value);
    expect(valores).toEqual(["Fábrica de Tintas", "Mercado Bom Preço", "São José do Rio Preto - SP", "Mirassol - SP", "3", "42.5"]);

    // O endereço de entrega lido da nota aparece numa linha e vai junto na criação da carga.
    expect(painel.querySelector("[data-endereco-da-nota]")!.textContent).toContain("Entrega: Av. Brasil, 450 - Centro, 15130-000");

    await enviar(painel.querySelector("form")!);
    await ate(() => expect(painel.textContent).toContain("Carga criada com o código 1234567890."));
    expect(pedidos.find((p) => p.url === "/api/fiscal/notas/n1/carga")?.body).toEqual({
      clientId: "cli1",
      sender: "Fábrica de Tintas",
      receiver: "Mercado Bom Preço",
      origin: "São José do Rio Preto - SP",
      destination: "Mirassol - SP",
      volumes: "3",
      weight: "42.5",
      deliveryStreet: "Av. Brasil",
      deliveryNumber: "450",
      deliveryDistrict: "Centro",
      deliveryZip: "15130000",
    });
    // Com a carga criada, o formulário sai e fica a carga.
    expect(painel.querySelector("form")).toBeNull();
    expect(painel.querySelector("[data-carga]")!.textContent).toContain("1234567890");
  });

  it("vários arquivos: mostra o resultado de cada um, com o motivo da recusa e a nota repetida", async () => {
    let chamada = 0;
    api({
      "/api/fiscal/notas": { body: [] },
      "/api/clientes": { body: CLIENTES },
      "POST /api/fiscal/notas": () => {
        chamada += 1;
        if (chamada === 1) return { status: 201, body: { nota: nota(), sugestao: SUGESTAO, cargaComAChave: null } };
        if (chamada === 2) return { status: 400, body: { error: "O arquivo é um XML, mas não é de NF-e (o elemento principal é <html>)." } };
        return { status: 409, body: { error: "Esta nota já foi importada. Ela está ligada à carga 1234567890.", nota: nota({ id: "n9", collection: CARGA }), coleta: CARGA } };
      },
    });
    const tela = await montar(<NotasFiscaisPage />);
    await ate(() => expect(tela.textContent).toContain("Nenhuma nota importada ainda"));

    const arquivo = (nome: string) => new File(["<x/>"], nome, { type: "text/xml" });
    await escolher(tela.querySelector('input[type="file"]')!, [arquivo("boa.xml"), arquivo("pagina.xml"), arquivo("repetida.xml")]);
    await ate(() => expect(tela.querySelectorAll("[data-envio]")).toHaveLength(3));

    const [boa, pagina, repetida] = [...tela.querySelectorAll<HTMLElement>("[data-envio]")];
    expect(tela.querySelector("[data-envios]")!.textContent).toContain("1 de 3 importado(s)");
    expect(boa.getAttribute("data-envio")).toBe("ok");
    expect(boa.textContent).toContain("NF-e 1234 / 1");
    expect(porTexto(boa, "button", "Criar carga")).toHaveLength(1);
    expect(pagina.getAttribute("data-envio")).toBe("erro");
    expect(pagina.textContent).toContain("pagina.xml");
    expect(pagina.textContent).toContain("não é de NF-e");
    expect(pagina.querySelector("button")).toBeNull();
    expect(repetida.textContent).toContain("Ela está ligada à carga 1234567890.");
    expect(porTexto(repetida, "button", "Abrir")).toHaveLength(1);
    // Com mais de um arquivo a tela não abre nenhuma nota sozinha.
    expect(tela.querySelector('[role="dialog"]')).toBeNull();
  });

  it("nota sem carga abre com os avisos, aponta a carga que já tem a chave e liga pelo código de rastreio", async () => {
    const pedidos = api({
      "/api/fiscal/notas": { body: [nota()] },
      "/api/clientes": { body: CLIENTES },
      "/api/fiscal/notas/n1": { body: { nota: nota(), sugestao: { ...SUGESTAO, clientId: null, avisos: ["Escolha o cliente pagador."] }, cargaComAChave: CARGA } },
      "POST /api/fiscal/notas/n1/ligar": { body: { nota: nota({ collection: CARGA }) } },
    });
    const tela = await montar(<NotasFiscaisPage />);
    await ate(() => expect(tela.querySelectorAll("tr[data-nota]")).toHaveLength(1));
    await clicar(porTexto(tela, "tr[data-nota] button", "Criar carga")[0]);
    await ate(() => expect(tela.querySelector('[role="dialog"]')).not.toBeNull());

    const painel = tela.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(painel.querySelector("[data-carga-com-a-chave]")!.textContent).toContain("A carga 1234567890 já tem a chave desta nota.");
    // Havendo carga com a chave, a tela já abre na aba de ligar, com o código preenchido.
    const codigo = painel.querySelector<HTMLInputElement>("form input")!;
    expect(codigo.value).toBe("1234567890");

    await clicar(porTexto(painel, '[role="tab"]', "Criar carga")[0]);
    expect(painel.querySelector("[data-avisos]")!.textContent).toContain("Escolha o cliente pagador.");
    expect(painel.querySelector("select")!.value).toBe("");

    await clicar(porTexto(painel, '[role="tab"]', "Ligar a uma carga")[0]);
    await enviar(painel.querySelector("form")!);
    await ate(() => expect(painel.textContent).toContain("Nota ligada à carga 1234567890."));
    expect(pedidos.find((p) => p.url === "/api/fiscal/notas/n1/ligar")?.body).toEqual({ trackingCode: "1234567890" });
  });
});
