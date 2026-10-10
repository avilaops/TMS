// @vitest-environment jsdom
import { Suspense } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ate, clicar, desmontarTudo, montar, porTexto } from "./tela";
import { barrasCode128B } from "../src/lib/code128";
import type { Minuta } from "../src/lib/minuta";

/**
 * Tela da minuta de despacho e o atalho dela na lista de minutas. As regras e
 * a rota são testadas em `tests/minuta.test.ts`; aqui se confere o que a folha
 * mostra, o que ela esconde e o que sai na impressão.
 */

vi.mock("next/link", () => ({
  default: ({ href, children, className, ...resto }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className} {...resto}>
      {children}
    </a>
  ),
}));

vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));

import MinutaPage from "../src/app/dashboard/coletas/[id]/minuta/page";
import ColetasPage from "../src/app/dashboard/coletas/page";

type Resposta = { status?: number; body: unknown };

function api(respostas: Record<string, Resposta>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL) => {
      const resposta = respostas[String(url)];
      if (!resposta) throw new Error(`Chamada inesperada: ${String(url)}`);
      return new Response(JSON.stringify(resposta.body), { status: resposta.status ?? 200 });
    }),
  );
}

const carregando = (tela: HTMLElement) => tela.querySelector('[aria-label="Carregando"]');
const secao = (tela: HTMLElement, nome: string) => tela.querySelector(`[data-minuta] [data-secao="${nome}"]`);

afterEach(async () => {
  await desmontarTudo();
  vi.unstubAllGlobals();
});

const RASTREIO = "1234567890";
const CHAVE_NF = "35261011222333000181550010000001231000001239";
const CHAVE_CTE = "35261011222333000181570010000000771000000775";
const SIMBOLO = "data:image/png;base64,iVBORw0KGgo=";

const completa: Minuta = {
  empresa: { name: "Transportes Avila", logo: SIMBOLO },
  codigo: RASTREIO,
  emitidaEm: "2026-10-10T17:32:00.000Z",
  pagador: { nome: "Serilon Brasil Ltda", documento: "11222333000181", endereco: "Av. Industrial, 500" },
  remetente: { nome: "Serilon Brasil", documento: "11222333000181", endereco: "Av. Industrial, 500 - Distrito", cidade: "São José do Rio Preto - SP" },
  destinatario: { nome: "Mercado Bom Preço", documento: "52998224725", endereco: "Rua das Flores, 120 - Centro, Mirassol - SP, 15130-000", cidade: "Mirassol - SP" },
  carga: { volumes: 3, peso: 120.5, cubagem: 1.25, valorDaMercadoria: 9876.5 },
  notas: [{ numero: "123/1", chave: CHAVE_NF }],
  frete: { valor: 350, manual: false, tabela: "Tabela 2026", composicao: [{ rotulo: "Frete peso", valor: 300 }, { rotulo: "Ad valorem", valor: 50 }], condicaoDePagamento: "28 dias" },
  viagem: { codigo: "AB12CD", placa: "ABC1D23", veiculo: "VW Delivery" },
  motorista: "José da Viagem",
  cte: { numero: 77, chave: CHAVE_CTE },
  observacoes: "Procurar o João na doca 2",
};

const minima: Minuta = {
  empresa: { name: "Transportes Avila", logo: null },
  codigo: null,
  emitidaEm: "2026-10-10T17:32:00.000Z",
  pagador: { nome: "Serilon Brasil Ltda", documento: "11222333000181", endereco: null },
  remetente: { nome: "Serilon Brasil", documento: null, endereco: null, cidade: "São José do Rio Preto - SP" },
  destinatario: { nome: "Mercado Bom Preço", documento: null, endereco: null, cidade: "Mirassol - SP" },
  carga: { volumes: 3, peso: 120.5, cubagem: null, valorDaMercadoria: null },
  notas: [],
  frete: null,
  viagem: null,
  motorista: null,
  cte: null,
  observacoes: null,
};

describe("tela da minuta de despacho", () => {
  async function abrir(resposta: Resposta, id = "c1") {
    api({ [`/api/coletas/${id}/minuta`]: resposta });
    const params = Promise.resolve({ id });
    const tela = await montar(
      <Suspense fallback="carregando">
        <MinutaPage params={params} />
      </Suspense>,
    );
    await ate(() => {
      expect(tela.textContent).not.toBe("carregando");
      expect(carregando(tela)).toBeNull();
    });
    return tela;
  }

  it("a folha completa: cabeçalho da empresa, número com código de barras, partes, carga, frete, viagem, CT-e, assinaturas e o aviso", async () => {
    const tela = await abrir({ body: completa });
    const folha = tela.querySelector("[data-minuta]")!;
    expect(folha).not.toBeNull();

    // Cabeçalho: símbolo e nome da empresa, o título, o número e a emissão no relógio do Brasil.
    expect(folha.querySelector("header img")!.getAttribute("src")).toBe(SIMBOLO);
    expect(folha.querySelector("[data-empresa]")!.textContent).toBe("Transportes Avila");
    expect(folha.querySelector("h1")!.textContent).toBe("MINUTA DE DESPACHO");
    expect(folha.querySelector("[data-codigo]")!.textContent).toBe(RASTREIO);
    expect(folha.querySelector("[data-emissao]")!.textContent).toMatch(/^Emissão: 10\/10\/2026,? 14:32$/);

    // O código de barras é o da etiqueta: o que a função pura calcula para o código de rastreio.
    const esperado = barrasCode128B(RASTREIO)!;
    const svg = folha.querySelector("svg[role=img]")!;
    expect(svg.getAttribute("aria-label")).toBe(`Código de barras ${RASTREIO}`);
    const barras = [...svg.querySelectorAll('rect[fill="#000"]')].map((r) => ({ x: Number(r.getAttribute("x")), largura: Number(r.getAttribute("width")) }));
    expect(barras).toEqual(esperado.barras);

    for (const texto of ["Serilon Brasil", "11.222.333/0001-81", "Av. Industrial, 500 - Distrito", "São José do Rio Preto - SP"]) expect(secao(tela, "remetente")!.textContent, texto).toContain(texto);
    for (const texto of ["Mercado Bom Preço", "529.982.247-25", "Rua das Flores, 120 - Centro, Mirassol - SP, 15130-000"]) expect(secao(tela, "destinatario")!.textContent, texto).toContain(texto);
    for (const texto of ["Cliente pagador", "Serilon Brasil Ltda", "11.222.333/0001-81", "Av. Industrial, 500"]) expect(secao(tela, "pagador")!.textContent, texto).toContain(texto);

    const carga = secao(tela, "carga")!.textContent!;
    for (const texto of ["Volumes3", "120,5 kg", "1,25 m³", "NF-e 123/1:", "3526 1011 2223 3300 0181 5500 1000 0001 2310 0000 1239"]) expect(carga, texto).toContain(texto);
    expect(carga).toMatch(/R\$\s9\.876,50/);

    const frete = secao(tela, "frete")!.textContent!;
    expect(frete).toMatch(/R\$\s350,00/);
    expect(frete).not.toContain("informado à mão");
    for (const texto of ["28 dias", "Frete peso", "Ad valorem", "Tabela: Tabela 2026"]) expect(frete, texto).toContain(texto);
    expect(secao(tela, "frete")!.querySelectorAll("[data-composicao] li")).toHaveLength(2);

    for (const texto of ["#AB12CD", "ABC1D23 · VW Delivery", "José da Viagem"]) expect(secao(tela, "viagem")!.textContent, texto).toContain(texto);
    for (const texto of ["Nº 77:", "3526 1011 2223 3300 0181 5700 1000 0000 7710 0000 0775"]) expect(secao(tela, "cte")!.textContent, texto).toContain(texto);
    expect(secao(tela, "observacoes")!.textContent).toContain("Procurar o João na doca 2");

    // Assinaturas: remetente, motorista e recebedor; o recebedor escreve nome, documento, data e hora.
    const assinaturas = [...folha.querySelectorAll("[data-assinatura]")];
    expect(assinaturas.map((a) => a.getAttribute("data-assinatura"))).toEqual(["Remetente", "Motorista", "Recebedor"]);
    for (const texto of ["Nome:", "Documento:", "Data:", "Hora:"]) expect(assinaturas[2].textContent, texto).toContain(texto);

    // Não é documento fiscal, e diz isso no rodapé.
    expect(folha.querySelector("footer[data-aviso]")!.textContent).toBe("Documento sem valor fiscal. Não substitui o CT-e.");
  });

  it("só a folha sai no papel, numa A4 em retrato; o botão de imprimir fica fora dela, no alto", async () => {
    const tela = await abrir({ body: completa });
    const estilo = tela.querySelector("style")!.textContent!;
    expect(estilo).toContain("@media print");
    expect(estilo).toContain("body * { visibility: hidden; }");
    expect(estilo).toContain("[data-minuta], [data-minuta] * { visibility: visible; }");
    expect(estilo).toContain("size: A4 portrait");

    const folha = tela.querySelector("[data-minuta]")!;
    const [imprimir] = porTexto(tela, "button", "Imprimir");
    expect(porTexto(tela, "button", "Imprimir")).toHaveLength(1);
    expect(folha.contains(imprimir)).toBe(false);
    expect(folha.querySelectorAll("button, a")).toHaveLength(0);
    // Vem antes da folha no documento: no celular aparece sem rolar.
    expect(imprimir.compareDocumentPosition(folha) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(porTexto(tela, "a", "Minutas")[0].getAttribute("href")).toBe("/dashboard/coletas");

    const print = vi.fn();
    vi.stubGlobal("print", print);
    await clicar(imprimir);
    expect(print).toHaveBeenCalledTimes(1);
  });

  it("carga mínima e perfil sem frete: seções sem dado não aparecem, campo vazio fica em branco, e nenhum valor de frete", async () => {
    const tela = await abrir({ body: minima });
    const folha = tela.querySelector("[data-minuta]")!;

    for (const nome of ["frete", "viagem", "cte", "observacoes"]) expect(secao(tela, nome), nome).toBeNull();
    for (const nome of ["remetente", "destinatario", "pagador", "carga", "assinaturas"]) expect(secao(tela, nome), nome).not.toBeNull();
    expect(folha.textContent).not.toMatch(/R\$|Frete|null|undefined|NaN/);

    // Sem código de rastreio não há número nem barras; sem símbolo, o do sistema.
    expect(folha.querySelector("[data-codigo]")).toBeNull();
    expect(folha.querySelector("svg[role=img]")).toBeNull();
    expect(folha.querySelector("header img")).toBeNull();
    expect(folha.querySelector("header [data-simbolo-padrao]")).not.toBeNull();

    // O campo sem dado continua na folha, em branco, para preencher à mão.
    expect(secao(tela, "remetente")!.textContent).toBe("RemetenteSerilon BrasilCNPJ / CPFOrigemSão José do Rio Preto - SPEndereço");
    expect(secao(tela, "carga")!.textContent).toBe("CargaVolumes3Peso120,5 kgCubagemValor da mercadoria");
    expect(folha.querySelector("footer[data-aviso]")!.textContent).toBe("Documento sem valor fiscal. Não substitui o CT-e.");
    expect(porTexto(tela, "button", "Imprimir")).toHaveLength(1);
  });

  it("frete a cotar e frete informado à mão; motorista alocado sem viagem", async () => {
    const aCotar = await abrir({ body: { ...minima, frete: { valor: null, manual: false, tabela: null, composicao: [], condicaoDePagamento: null }, motorista: "Motorista da carga" } });
    expect(secao(aCotar, "frete")!.textContent).toBe("FreteValor do freteA cotarCondição de pagamento");
    expect(secao(aCotar, "viagem")!.textContent).toBe("ViagemMotoristaMotorista da carga");
    await desmontarTudo();

    const manual = await abrir({ body: { ...minima, frete: { valor: 500, manual: true, tabela: null, composicao: [], condicaoDePagamento: "À vista" } } });
    expect(secao(manual, "frete")!.textContent).toMatch(/R\$\s500,00 \(informado à mão\)/);
    expect(secao(manual, "frete")!.textContent).toContain("À vista");
    expect(secao(manual, "frete")!.querySelector("[data-composicao]")).toBeNull();
  });

  it("carga que não existe mostra o erro; sessão expirada e perfil sem acesso têm aviso próprio", async () => {
    const inexistente = await abrir({ status: 404, body: { error: "Carga não encontrada." } }, "x");
    expect(inexistente.querySelector('[role="alert"]')!.textContent).toBe("Carga não encontrada.");
    expect(inexistente.querySelector("[data-minuta]")).toBeNull();
    expect(porTexto(inexistente, "button", "Imprimir")).toHaveLength(0);
    expect(porTexto(inexistente, "a", "Minutas")[0].getAttribute("href")).toBe("/dashboard/coletas");
    await desmontarTudo();

    const expirada = await abrir({ status: 401, body: { error: "Não autorizado" } });
    expect(expirada.textContent).toContain("Sessão expirada");
    expect(porTexto(expirada, "a", "Ir para o login")[0].getAttribute("href")).toBe("/login");
    expect(expirada.querySelector("[data-minuta]")).toBeNull();
    await desmontarTudo();

    const negado = await abrir({ status: 403, body: { error: "Acesso negado" } });
    expect(negado.textContent).toContain("Acesso negado");
    expect(negado.querySelector("[data-minuta]")).toBeNull();
    await desmontarTudo();

    const quebrada = await abrir({ status: 500, body: {} });
    expect(quebrada.querySelector('[role="alert"]')!.textContent).toBe("Não foi possível carregar a minuta.");
  });
});

describe("lista de minutas: atalho da minuta de despacho", () => {
  const cliente = { id: "cli1", tradeName: "Serilon", companyName: "Serilon Brasil Ltda", active: true };
  const coleta = (id: string, status: string) => ({
    id,
    sender: "Serilon Brasil",
    receiver: "Mercado Bom Preço",
    origin: "Rio Preto - SP",
    destination: "Mirassol - SP",
    volumes: 3,
    weight: 30,
    status,
    manifestId: null,
    invoiceKey: null,
    invoiceValue: null,
    freightValue: null,
    freightManual: false,
    trackingCode: `99000000${id}`,
    pickupDate: null,
    pickupFrom: null,
    pickupTo: null,
    priority: "NORMAL",
    cubicMeters: null,
    pickupNotes: null,
    deliveryStreet: null,
    deliveryNumber: null,
    deliveryDistrict: null,
    deliveryZip: null,
    proof: null,
    _count: { deliveryAttempts: 0 },
    client: cliente,
    driver: null,
  });

  it("toda carga da lista tem o atalho, em qualquer status, apontando para a folha dela", async () => {
    const status = ["PENDING", "CONFIRMED", "COLLECTED", "ROUTE", "DELIVERED", "CANCELLED"];
    api({
      "/api/coletas": { body: status.map((s, i) => coleta(`0${i}`, s)) },
      "/api/clientes": { body: [cliente] },
      "/api/motoristas": { body: [] },
    });
    const tela = await montar(<ColetasPage />);
    await ate(() => expect(tela.querySelectorAll("tbody tr")).toHaveLength(status.length));

    const atalhos = porTexto(tela, "tbody a", /^Minuta$/);
    expect(atalhos.map((a) => a.getAttribute("href"))).toEqual(status.map((_, i) => `/dashboard/coletas/0${i}/minuta`));
    for (const linha of tela.querySelectorAll("tbody tr")) expect(porTexto(linha, "a", /^Minuta$/)).toHaveLength(1);
  });
});
