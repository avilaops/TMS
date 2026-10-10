// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ate, clicar, desmontarTudo, montar, porTexto } from "./tela";
import { AVISO_PIX_ESTATICO } from "../src/lib/pix";

/**
 * Telas novas do portal do cliente (menu, cotação, pedido de coleta, faturas
 * com Pix) e a fatura do painel com o Pix Copia e Cola. As contas e as rotas
 * são testadas em `tests/portal-cliente.test.ts` e `tests/pix.test.ts`; aqui se
 * confere o que cada tela mostra e manda.
 */

const estado = { caminho: "/portal", consulta: "", trocas: [] as string[] };

vi.mock("next/link", () => ({
  default: ({ href, children, ...resto }: { href: string; children: React.ReactNode } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...resto}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => estado.caminho,
  useSearchParams: () => new URLSearchParams(estado.consulta),
  useRouter: () => ({ replace: (destino: string) => estado.trocas.push(destino), push: vi.fn() }),
}));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { name: "Ana", email: "ana@cliente.br" } } }) }));
vi.mock("@/lib/sair", () => ({ sair: vi.fn() }));
vi.mock("@/components/empresa/identidade", () => ({
  SimboloDaEmpresa: () => <span data-simbolo />,
  useIdentidade: () => ({ name: "Mello Transportes", logo: null }),
}));

import PortalLayout from "../src/app/portal/layout";
import PortalCotacaoPage from "../src/app/portal/cotacao/page";
import PortalColetasPage from "../src/app/portal/coletas/page";
import PortalFaturasPage from "../src/app/portal/faturas/page";
import FaturaPage from "../src/app/dashboard/faturamento/[id]/page";

type Resposta = { status?: number; body: unknown };

/** Cada caminho (método + endereço) tem a sua resposta; o corpo enviado fica guardado. */
function api(respostas: Record<string, Resposta>) {
  const pedidos: { metodo: string; caminho: string; corpo: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const metodo = init?.method ?? "GET";
      const caminho = String(url);
      pedidos.push({ metodo, caminho, corpo: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
      const resposta = respostas[`${metodo} ${caminho}`];
      if (!resposta) throw new Error(`Chamada inesperada: ${metodo} ${caminho}`);
      return new Response(JSON.stringify(resposta.body), { status: resposta.status ?? 200 });
    }),
  );
  return pedidos;
}

async function digitar(campo: HTMLInputElement | HTMLSelectElement, valor: string) {
  const prototipo = campo instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototipo, "value")!.set!.call(campo, valor);
    campo.dispatchEvent(new Event(campo instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}

async function enviar(formulario: Element) {
  await act(async () => {
    formulario.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

/** O campo de dentro do rótulo com este texto. */
function campo(tela: ParentNode, rotulo: string | RegExp) {
  const achado = porTexto(tela, "label", rotulo)[0]?.querySelector("input, select");
  if (!achado) throw new Error(`Campo "${rotulo}" não encontrado`);
  return achado as HTMLInputElement | HTMLSelectElement;
}

afterEach(async () => {
  await desmontarTudo();
  vi.unstubAllGlobals();
  estado.caminho = "/portal";
  estado.consulta = "";
  estado.trocas = [];
  Reflect.deleteProperty(navigator, "clipboard");
});

describe("menu do portal", () => {
  it("traz os itens novos e marca a página atual, inclusive nas telas de dentro", async () => {
    estado.caminho = "/portal/coletas/abc";
    const tela = await montar(
      <PortalLayout>
        <p>conteúdo</p>
      </PortalLayout>,
    );

    const links = [...tela.querySelectorAll("nav a")].map((link) => [link.textContent, link.getAttribute("href")]);
    expect(links).toEqual([
      ["Visão geral", "/portal"],
      ["Minhas coletas", "/portal/coletas"],
      ["Cotação", "/portal/cotacao"],
      ["Destinatários", "/portal/destinatarios"],
      ["Tabela de frete", "/portal/tabela-frete"],
      ["Faturas", "/portal/faturas"],
      ["Atendimento", "/portal/atendimento"],
    ]);
    expect([...tela.querySelectorAll('nav a[aria-current="page"]')].map((link) => link.textContent)).toEqual(["Minhas coletas"]);
    // Cada link tem altura de toque (44 px) mesmo com sete itens no celular.
    for (const link of tela.querySelectorAll("nav a")) expect(link.className).toContain("min-h-11");
  });
});

describe("cotação pelo portal", () => {
  const COTACAO = "POST /api/portal/cotacao";

  async function cotar(resposta: Resposta) {
    const pedidos = api({ [COTACAO]: resposta });
    const tela = await montar(<PortalCotacaoPage />);
    await digitar(campo(tela, "Cidade de destino"), "Mirassol - SP");
    await digitar(campo(tela, "Peso (kg)"), "12,5");
    await digitar(campo(tela, "Volumes"), "3");
    await digitar(campo(tela, "Valor da nota"), "1500");
    await enviar(tela.querySelector("form")!);
    return { tela, pedidos };
  }

  it("mostra o valor, o prazo e os avisos, e leva ao pedido de coleta com os dados cotados", async () => {
    const { tela, pedidos } = await cotar({ body: { atendida: true, cidade: "Mirassol", valor: 180.5, prazoHoras: 48, avisos: ["Mirassol é atendida só com veículo dedicado."] } });

    await ate(() => expect(tela.querySelector("[data-resultado]")).not.toBeNull());
    expect(pedidos[0].corpo).toEqual({ destination: "Mirassol - SP", weight: "12,5", volumes: "3", invoiceValue: "1500", cubicMeters: "" });
    expect(tela.querySelector("[data-valor]")?.textContent).toMatch(/180,50/);
    expect(tela.querySelector("[data-prazo]")?.textContent).toBe("2 dias");
    expect(tela.textContent).toContain("só com veículo dedicado");

    const pedir = porTexto(tela, "a", "Pedir coleta com estes dados")[0];
    const destino = new URL(pedir.getAttribute("href")!, "http://x");
    expect(destino.pathname).toBe("/portal/coletas");
    // Só o que foi preenchido vai no endereço.
    expect(Object.fromEntries(destino.searchParams)).toEqual({ destination: "Mirassol - SP", weight: "12,5", volumes: "3", invoiceValue: "1500" });
  });

  it("cidade fora da tabela: explica e ainda deixa pedir a coleta; erro da rota aparece na tela", async () => {
    const fora = await cotar({ body: { atendida: false, motivo: "fora_da_tabela" } });
    await ate(() => expect(fora.tela.querySelector("[data-sem-valor]")).not.toBeNull());
    expect(fora.tela.querySelector("[data-sem-valor]")?.textContent).toContain("não está na sua tabela");
    expect(porTexto(fora.tela, "a", "Pedir coleta com estes dados")).toHaveLength(1);
    await desmontarTudo();

    const erro = await cotar({ status: 400, body: { error: "O peso precisa ser um número maior que zero." } });
    await ate(() => expect(erro.tela.querySelector('[role="alert"]')?.textContent).toContain("maior que zero"));
    expect(erro.tela.querySelector("[data-resultado]")).toBeNull();
  });
});

describe("pedido de coleta no portal", () => {
  const LISTA = "GET /api/portal/coletas";
  const DESTINATARIOS = "GET /api/portal/destinatarios";
  const DESTINATARIO = { id: "d1", name: "Loja do Zé", document: null, city: "Jaci - SP", address: "Rua das Flores, 120 - Centro, CEP 15155-000", contactName: null, phone: null };
  const COLETA = {
    id: "c1",
    sender: "Fábrica",
    receiver: "Loja",
    origin: "Rio Preto",
    destination: "Mirassol",
    volumes: 2,
    weight: 50,
    invoiceValue: null,
    status: "PENDING",
    createdAt: "2026-10-05T15:00:00.000Z",
    trackingCode: "1234567890",
    freightValue: 80,
    pickupDate: "2026-10-12T00:00:00.000Z",
    pickupFrom: "08:00",
    pickupTo: "12:00",
    priority: "URGENT",
    cubicMeters: null,
    pickupNotes: null,
  };

  it("a lista mostra o frete, a urgência e a janela pedida", async () => {
    api({ [LISTA]: { body: [COLETA] }, [DESTINATARIOS]: { body: [] } });
    const tela = await montar(<PortalColetasPage />);
    await ate(() => expect(tela.querySelector('[data-coleta="c1"]')).not.toBeNull());

    const linha = tela.querySelector('[data-coleta="c1"]')!.textContent!;
    expect(linha).toContain("Urgente");
    expect(linha).toContain("Coletar 12/10 das 08:00 às 12:00");
    expect(linha).toMatch(/80,00/);
    // Sem vir da cotação, o pedido começa fechado.
    expect(tela.querySelector('form[aria-label="Pedido de coleta"]')).toBeNull();
  });

  it("vindo da cotação abre preenchido; o destinatário frequente preenche nome, cidade e endereço de entrega; envia os campos do pedido", async () => {
    estado.consulta = "destination=Mirassol+-+SP&weight=12%2C5&volumes=3";
    const pedidos = api({
      [LISTA]: { body: [] },
      [DESTINATARIOS]: { body: [DESTINATARIO] },
      "POST /api/portal/coletas": { status: 201, body: { success: true } },
    });
    const tela = await montar(<PortalColetasPage />);
    await ate(() => expect(tela.querySelector('select[aria-label="Destinatário frequente"]')).not.toBeNull());

    const formulario = tela.querySelector('form[aria-label="Pedido de coleta"]')!;
    expect((campo(formulario, "Cidade de destino") as HTMLInputElement).value).toBe("Mirassol - SP");
    // A vírgula decimal da cotação vira ponto: o campo numérico e a rota do pedido esperam ponto.
    expect((campo(formulario, "Peso (kg)") as HTMLInputElement).value).toBe("12.5");

    await digitar(tela.querySelector('select[aria-label="Destinatário frequente"]') as HTMLSelectElement, "d1");
    // Rótulo exato: "Destinatário frequente" é a lista de cima.
    expect((campo(formulario, /^Destinatário$/) as HTMLInputElement).value).toBe("Loja do Zé");
    expect((campo(formulario, "Cidade de destino") as HTMLInputElement).value).toBe("Jaci - SP");
    // O endereço do destinatário (um texto só) abre a seção e preenche as partes do endereço de entrega, para conferir.
    expect((campo(formulario, "Logradouro") as HTMLInputElement).value).toBe("Rua das Flores");
    expect((campo(formulario, "Número") as HTMLInputElement).value).toBe("120");
    expect((campo(formulario, "Bairro") as HTMLInputElement).value).toBe("Centro");
    expect((campo(formulario, "CEP") as HTMLInputElement).value).toBe("15155-000");
    await digitar(campo(formulario, "Número"), "122");

    await digitar(campo(formulario, "Remetente"), "Fábrica");
    await digitar(campo(formulario, "Cidade de origem"), "Rio Preto - SP");

    // Janela, prioridade e observação ficam recolhidas até o cliente abrir.
    expect(porTexto(formulario, "label", "Prioridade")).toHaveLength(0);
    await clicar(formulario.querySelector('[data-secao="pedido"]')!);
    await digitar(campo(formulario, "Data da coleta"), "2026-10-12");
    await digitar(campo(formulario, "Prioridade"), "URGENT");
    await digitar(campo(formulario, "Coletar das"), "08:00");
    await digitar(campo(formulario, "Observação para a coleta"), "Doca 2");

    await enviar(formulario);
    await ate(() => expect(tela.querySelector('[role="status"]')?.textContent).toContain("Solicitação enviada"));

    expect(pedidos.find((pedido) => pedido.metodo === "POST")?.corpo).toEqual({
      sender: "Fábrica",
      receiver: "Loja do Zé",
      origin: "Rio Preto - SP",
      destination: "Jaci - SP",
      volumes: "3",
      weight: "12.5",
      invoiceValue: "",
      cubicMeters: "",
      pickupDate: "2026-10-12",
      pickupFrom: "08:00",
      pickupTo: "",
      priority: "URGENT",
      pickupNotes: "Doca 2",
      deliveryStreet: "Rua das Flores",
      deliveryNumber: "122",
      deliveryDistrict: "Centro",
      deliveryZip: "15155-000",
    });
    // Os dados da cotação saem do endereço: recarregar não reabre o pedido enviado.
    expect(estado.trocas).toEqual(["/portal/coletas"]);
  });
});

describe("Pix Copia e Cola nas faturas", () => {
  const CODIGO = "00020126360014br.gov.bcb.pix0114112223330001815204000053039865406480.505802BR5917Mello Transportes6008Mirassol62130509FAT0000126304ABCD";

  it("portal: o título em aberto com chave abre o código, copia e avisa que a baixa é manual; o resto não tem botão", async () => {
    const copiados: string[] = [];
    // O jsdom não tem `navigator.clipboard`: entra um de mentira.
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async (texto: string) => void copiados.push(texto) }, configurable: true });
    api({
      "GET /api/portal/faturas": {
        body: [
          { id: "t1", amount: 480.5, description: "Fatura nº 12 (1 carga)", dueDate: "2026-11-10T00:00:00.000Z", status: "PENDING", createdAt: "2026-10-01T12:00:00.000Z", pix: CODIGO },
          { id: "t2", amount: 99, description: "Frete pago", dueDate: null, status: "PAID", createdAt: "2026-09-01T12:00:00.000Z", pix: null },
        ],
      },
    });
    const tela = await montar(<PortalFaturasPage />);
    await ate(() => expect(tela.querySelector('[data-fatura="t1"]')).not.toBeNull());

    expect(porTexto(tela, "button", "Pagar com Pix")).toHaveLength(1);
    expect(tela.querySelector("[data-pix]")).toBeNull();

    await clicar(porTexto(tela.querySelector('[data-fatura="t1"]')!, "button", "Pagar com Pix")[0]);
    const quadro = tela.querySelector('[data-pix-de="t1"] [data-pix]')!;
    expect((quadro.querySelector("textarea") as HTMLTextAreaElement).value).toBe(CODIGO);
    expect(quadro.textContent).toContain(AVISO_PIX_ESTATICO);

    await clicar(porTexto(quadro, "button", "Copiar código")[0]);
    await ate(() => expect(quadro.querySelector('[role="status"]')?.textContent).toContain("Código copiado"));
    expect(copiados).toEqual([CODIGO]);

    await clicar(porTexto(tela, "button", "Fechar Pix")[0]);
    expect(tela.querySelector("[data-pix]")).toBeNull();
  });

  const FATURA = {
    number: 12,
    status: "OPEN",
    total: 480.5,
    dueDate: "2026-11-10T00:00:00.000Z",
    issuedAt: "2026-10-01T12:00:00.000Z",
    paidAt: null,
    notes: null,
    client: { companyName: "Cliente Ltda", tradeName: null, cnpj: "11222333000181" },
    transaction: { id: "t1" },
    collections: [],
  };

  async function abrirFatura(fatura: Record<string, unknown>) {
    api({ "GET /api/faturas/f1": { body: fatura } });
    const tela = await montar(<FaturaPage params={Promise.resolve({ id: "f1" })} />);
    await ate(() => expect(tela.textContent).toContain("Fatura nº 12"));
    return tela;
  }

  it("painel: a fatura em aberto mostra o código; sem chave cadastrada, diz onde cadastrar; paga não mostra nada", async () => {
    const comPix = await abrirFatura({ ...FATURA, pix: CODIGO });
    expect((comPix.querySelector("[data-pix] textarea") as HTMLTextAreaElement).value).toBe(CODIGO);
    expect(comPix.querySelector("[data-pix]")?.textContent).toContain("não dá baixa sozinho");
    expect(comPix.querySelector("[data-sem-pix]")).toBeNull();
    await desmontarTudo();

    const semChave = await abrirFatura({ ...FATURA, pix: null });
    expect(semChave.querySelector("[data-pix]")).toBeNull();
    expect(semChave.querySelector("[data-sem-pix]")?.textContent).toContain("Empresa > Cobrança");
    await desmontarTudo();

    const paga = await abrirFatura({ ...FATURA, status: "PAID", paidAt: "2026-10-02T12:00:00.000Z", pix: null });
    expect(paga.querySelector("[data-pix]")).toBeNull();
    expect(paga.querySelector("[data-sem-pix]")).toBeNull();
  });
});
