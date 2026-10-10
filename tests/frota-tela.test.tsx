// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ate, clicar, desmontarTudo, montar, porTexto } from "./tela";
import { formatCurrency } from "../src/lib/format";
import { CHECKLIST_TUDO_OK } from "../src/lib/frota";

/**
 * Telas da frota: os alertas (`/dashboard/frota`) e a frota de um veículo
 * (`/dashboard/veiculos/[id]`). As contas e as rotas são testadas em
 * `tests/frota.test.ts`; aqui se confere o que cada tela mostra e o que ela
 * manda para a API.
 */

const estado = vi.hoisted(() => ({ perfil: "ADMIN" }));

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({ useParams: () => ({ id: "v1" }) }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { id: "u1", role: estado.perfil } } }) }));

import FrotaPage from "../src/app/dashboard/frota/page";
import FrotaDoVeiculoPage from "../src/app/dashboard/veiculos/[id]/page";

type Resposta = { status?: number; body: unknown };
type Pedido = { url: string; method: string; body: unknown };

/** Respostas por "MÉTODO endereço"; o GET dispensa o método. */
function api(respostas: Record<string, Resposta>) {
  const pedidos: Pedido[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      pedidos.push({ url: String(url), method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const resposta = respostas[method === "GET" ? String(url) : `${method} ${String(url)}`];
      if (!resposta) throw new Error(`Chamada inesperada: ${method} ${String(url)}`);
      return new Response(JSON.stringify(resposta.body), { status: resposta.status ?? 200 });
    }),
  );
  return pedidos;
}

const carregando = (tela: HTMLElement) => tela.querySelector('[aria-label="Carregando"]');
const cartao = (tela: HTMLElement, rotulo: string) => tela.querySelector(`[data-cartao="${rotulo}"]`);

async function digitar(campo: HTMLInputElement | HTMLSelectElement, valor: string) {
  const prototipo = campo instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const gravar = Object.getOwnPropertyDescriptor(prototipo, "value")!.set!;
  await act(async () => {
    gravar.call(campo, valor);
    campo.dispatchEvent(new Event(campo instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}

async function enviar(tela: HTMLElement) {
  await act(async () => {
    tela.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

afterEach(async () => {
  await desmontarTudo();
  vi.unstubAllGlobals();
  estado.perfil = "ADMIN";
  window.location.hash = "";
});

describe("tela de alertas da frota", () => {
  const VAZIA = { resumo: { vencidos: 0, aVencer: 0, emManutencao: 0 }, alertas: [], emManutencao: [] };
  const CHEIA = {
    resumo: { vencidos: 1, aVencer: 2, emManutencao: 1 },
    alertas: [
      { chave: "documento-d1", origem: "DOCUMENTO", rotulo: "Seguro", de: "ABC1D23", vehicleId: "v1", numero: "APO-1", vencimento: "2026-10-01", dias: -8, situacao: "vencido" },
      { chave: "cnh-m1", origem: "CNH", rotulo: "CNH", de: "Ana Motorista", vehicleId: null, numero: "123", vencimento: "2026-10-09", dias: 0, situacao: "a_vencer" },
      { chave: "documento-d2", origem: "DOCUMENTO", rotulo: "ANTT", de: "ABC1D23", vehicleId: "v1", numero: null, vencimento: "2026-10-19", dias: 10, situacao: "a_vencer" },
    ],
    emManutencao: [{ id: "v2", plate: "XYZ9Z99", model: "Van", servico: "Retífica do motor" }],
    custoDoMes: { mes: "2026-10", manutencao: 800, abastecimento: 1234.5, total: 2034.5 },
  };

  async function abrir(resposta: Resposta) {
    api({ "/api/frota": resposta });
    const tela = await montar(<FrotaPage />);
    await ate(() => expect(carregando(tela)).toBeNull());
    return tela;
  }

  it("403 e 401 mostram o aviso certo, sem cartão nenhum", async () => {
    const negado = await abrir({ status: 403, body: { error: "Acesso negado" } });
    expect(negado.textContent).toContain("Acesso negado");
    expect(negado.querySelectorAll("[data-cartao]")).toHaveLength(0);
    await desmontarTudo();

    const semSessao = await abrir({ status: 401, body: { error: "Não autorizado" } });
    expect(semSessao.textContent).toContain("Sessão expirada");
    expect(semSessao.querySelector('a[href="/login"]')).not.toBeNull();
  });

  it("erro da API aparece como alerta", async () => {
    const tela = await abrir({ status: 500, body: { error: "Internal Server Error" } });
    expect(tela.querySelector('[role="alert"]')?.textContent).toContain("Internal Server Error");
  });

  it("sem alerta: zeros, as duas listas dizem que estão vazias, e sem custo para quem não é administrador", async () => {
    const tela = await abrir({ body: VAZIA });
    expect(cartao(tela, "Vencidos")?.textContent).toContain("0");
    expect(cartao(tela, "Vencidos")?.querySelector(".text-red-600.font-bold")).toBeNull();
    expect(cartao(tela, "Custo do mês")).toBeNull();
    expect(tela.textContent).toContain("Nenhum documento ou CNH vencido ou a vencer.");
    expect(tela.textContent).toContain("Nenhum veículo em manutenção.");
    expect(tela.textContent).not.toContain("R$");
  });

  it("mostra os vencimentos com o prazo e o caminho certo, os veículos parados e o custo do mês", async () => {
    const tela = await abrir({ body: CHEIA });

    expect(cartao(tela, "Vencidos")?.textContent).toContain("1");
    expect(cartao(tela, "Vencidos")?.querySelector(".text-red-600.font-bold")).not.toBeNull();
    expect(cartao(tela, "Vencem em 30 dias")?.textContent).toContain("2");
    expect(cartao(tela, "Em manutenção")?.textContent).toContain("1");
    expect(cartao(tela, "Custo do mês")?.textContent).toContain(formatCurrency(2034.5));

    const seguro = tela.querySelector('[data-alerta="documento-d1"]')!;
    expect(seguro.textContent).toContain("Seguro · ABC1D23");
    expect(seguro.textContent).toContain("01/10/2026");
    expect(seguro.textContent).toContain("nº APO-1");
    expect(seguro.querySelector('[data-situacao="vencido"]')?.textContent).toBe("Venceu há 8 dias");
    expect(seguro.querySelector('a[href="/dashboard/veiculos/v1#documentos"]')).not.toBeNull();

    const cnh = tela.querySelector('[data-alerta="cnh-m1"]')!;
    expect(cnh.textContent).toContain("CNH · Ana Motorista");
    expect(cnh.querySelector('[data-situacao="a_vencer"]')?.textContent).toBe("Vence hoje");
    expect(cnh.querySelector('a[href="/dashboard/motoristas"]')).not.toBeNull();
    expect(tela.querySelector('[data-alerta="documento-d2"] [data-situacao]')?.textContent).toBe("Vence em 10 dias");

    const parado = tela.querySelector('[data-veiculo="v2"]')!;
    expect(parado.textContent).toContain("XYZ9Z99 · Van");
    expect(parado.textContent).toContain("Retífica do motor");
    expect(parado.querySelector('a[href="/dashboard/veiculos/v2"]')).not.toBeNull();
  });

  it("no celular as duas seções são abas: uma aparece de cada vez", async () => {
    const tela = await abrir({ body: CHEIA });
    const secao = (titulo: string) => tela.querySelector(`section[aria-label="${titulo}"]`)!;
    expect(secao("Vencimentos").className).not.toContain("hidden md:block");
    expect(secao("Em manutenção").className).toContain("hidden md:block");

    await clicar(tela.querySelector('[data-aba="Em manutenção"]')!);
    expect(secao("Vencimentos").className).toContain("hidden md:block");
    expect(secao("Em manutenção").className).not.toContain("hidden md:block");
  });
});

describe("tela de frota do veículo", () => {
  const VEICULO = { id: "v1", plate: "ABC1D23", model: "Caminhão 3/4" };
  const MANUTENCAO = { id: "m1", description: "Troca de óleo", cost: 350.5, date: "2026-10-01T00:00:00.000Z", status: "COMPLETED", kind: "PREVENTIVE", odometer: 88000 };
  const ABASTECIMENTOS = [
    { id: "a2", date: "2026-10-05T00:00:00.000Z", liters: 50, totalCost: 300, odometer: 10500, station: "Posto Central", driver: { id: "d1", user: { name: "Ana" } }, km: 500, kmPorLitro: 10, custoPorKm: 0.6 },
    { id: "a1", date: "2026-10-01T00:00:00.000Z", liters: 40, totalCost: 240, odometer: 10000, station: null, driver: null, km: null, kmPorLitro: null, custoPorKm: null },
  ];
  const BASE = {
    "/api/veiculos/v1": { body: VEICULO },
    "/api/veiculos/v1/manutencao": { body: [MANUTENCAO] },
    "/api/veiculos/v1/abastecimentos": { body: ABASTECIMENTOS },
    "/api/motoristas": { body: [{ id: "d1", user: { name: "Ana" } }] },
  };

  const abas = (tela: HTMLElement) => [...tela.querySelectorAll("[data-aba]")].map((aba) => aba.textContent);
  const celulas = (tela: HTMLElement, id: string) => [...tela.querySelectorAll(`[data-registro="${id}"] td[data-rotulo]`)].map((td) => td.textContent);

  async function abrir(respostas: Record<string, Resposta> = BASE) {
    const pedidos = api(respostas);
    const tela = await montar(<FrotaDoVeiculoPage />);
    await ate(() => expect(carregando(tela)).toBeNull());
    return { tela, pedidos };
  }

  const irPara = async (tela: HTMLElement, aba: string) => {
    await clicar(tela.querySelector(`[data-aba="${aba}"]`)!);
    await ate(() => expect(carregando(tela)).toBeNull());
  };

  it("veículo que não existe, sessão expirada e acesso negado têm cada um o seu aviso", async () => {
    const semVeiculo = await abrir({ "/api/veiculos/v1": { status: 404, body: { error: "Veículo não encontrado." } } });
    expect(semVeiculo.tela.textContent).toContain("Veículo não encontrado");
    expect(semVeiculo.tela.querySelector('a[href="/dashboard/veiculos"]')).not.toBeNull();
    await desmontarTudo();

    const semSessao = await abrir({ "/api/veiculos/v1": { status: 401, body: {} } });
    expect(semSessao.tela.textContent).toContain("Sessão expirada");
    await desmontarTudo();

    const negado = await abrir({ "/api/veiculos/v1": { status: 403, body: {} } });
    expect(negado.tela.textContent).toContain("Acesso negado");
    expect(negado.tela.querySelectorAll("[data-aba]")).toHaveLength(0);
  });

  it("abre na manutenção, com a placa no título; a aba de custos é só do administrador", async () => {
    const { tela, pedidos } = await abrir();
    expect(tela.querySelector("[data-placa]")?.textContent).toBe("ABC1D23");
    expect(abas(tela)).toEqual(["Manutenção", "Abastecimento", "Documentos", "Pneus", "Checklist", "Custos"]);
    expect(tela.querySelector('[data-aba="manutencao"]')?.getAttribute("aria-selected")).toBe("true");
    expect(pedidos.map((p) => p.url)).toEqual(["/api/veiculos/v1", "/api/veiculos/v1/manutencao"]);
    expect(celulas(tela, "m1")).toEqual(["Troca de óleo", "01/10/2026", "Preventiva", "88.000 km", formatCurrency(350.5), "Concluída"]);
    await desmontarTudo();

    estado.perfil = "OPERATION";
    const operacao = await abrir();
    expect(abas(operacao.tela)).toEqual(["Manutenção", "Abastecimento", "Documentos", "Pneus", "Checklist"]);
  });

  it("o endereço com a aba (#documentos) já abre nela; a de custos, para quem não é administrador, cai na manutenção", async () => {
    window.location.hash = "#documentos";
    const { tela } = await abrir({ ...BASE, "/api/veiculos/v1/documentos": { body: [] } });
    expect(tela.querySelector('[data-aba="documentos"]')?.getAttribute("aria-selected")).toBe("true");
    expect(tela.textContent).toContain("Nenhum documento registrado.");
    await desmontarTudo();

    estado.perfil = "OPERATION";
    window.location.hash = "#custos";
    const operacao = await abrir();
    expect(operacao.tela.querySelector('[data-aba="manutencao"]')?.getAttribute("aria-selected")).toBe("true");
    expect(operacao.pedidos.some((p) => p.url.includes("/custos"))).toBe(false);
  });

  it("manutenção: o formulário manda tipo e hodômetro, e o serviço como concluído", async () => {
    const { tela, pedidos } = await abrir({ ...BASE, "POST /api/veiculos/v1/manutencao": { status: 201, body: MANUTENCAO } });
    await clicar(porTexto(tela, "button", "Registrar manutenção")[0]);

    // Com o formulário aberto, título e abas saem do celular.
    expect(tela.querySelector("[data-placa]")?.closest("div.items-center")?.className).toContain("hidden md:flex");
    expect(tela.querySelector('[role="tablist"]')?.className).toContain("hidden md:grid");

    await digitar(tela.querySelector<HTMLInputElement>('input[name="description"]')!, "Freios");
    await digitar(tela.querySelector<HTMLInputElement>('input[name="cost"]')!, "800,00");
    await digitar(tela.querySelector<HTMLInputElement>('input[name="date"]')!, "2026-10-08");
    await digitar(tela.querySelector<HTMLSelectElement>('select[name="kind"]')!, "CORRECTIVE");
    await digitar(tela.querySelector<HTMLInputElement>('input[name="odometer"]')!, "90000");
    await enviar(tela);

    await ate(() => expect(tela.querySelector("form")).toBeNull());
    const gravacao = pedidos.find((p) => p.method === "POST")!;
    expect(gravacao.url).toBe("/api/veiculos/v1/manutencao");
    expect(gravacao.body).toEqual({ description: "Freios", cost: "800,00", date: "2026-10-08", kind: "CORRECTIVE", odometer: "90000", status: "COMPLETED" });
    expect(tela.querySelector('[role="status"]')?.textContent).toBe("Manutenção registrada.");
    // A lista é lida de novo depois de gravar.
    expect(pedidos.filter((p) => p.url === "/api/veiculos/v1/manutencao" && p.method === "GET")).toHaveLength(2);
  });

  it("abastecimento: mostra o consumo de cada trecho e traço onde não há medição; erro da API fica no formulário", async () => {
    const { tela, pedidos } = await abrir({
      ...BASE,
      "POST /api/veiculos/v1/abastecimentos": { status: 400, body: { error: "Os litros precisam ser um número maior que zero." } },
      "DELETE /api/veiculos/v1/abastecimentos/a1": { body: { ok: true } },
    });
    await irPara(tela, "abastecimento");

    expect(celulas(tela, "a2")).toEqual(["05/10/2026", "10.500 km", "50 l", formatCurrency(300), "10 km/l", formatCurrency(0.6), "Posto Central", "Ana"]);
    expect(celulas(tela, "a1")).toEqual(["01/10/2026", "10.000 km", "40 l", formatCurrency(240), "-", "-", "-", "-"]);

    await clicar(porTexto(tela, "button", "Novo abastecimento")[0]);
    await ate(() => expect(tela.querySelectorAll('select[name="driverId"] option')).toHaveLength(2));
    await digitar(tela.querySelector<HTMLInputElement>('input[name="liters"]')!, "0");
    await enviar(tela);
    await ate(() => expect(tela.querySelector('form [role="alert"]')?.textContent).toContain("litros"));
    expect(tela.querySelector("form")).not.toBeNull();
    expect(pedidos.find((p) => p.method === "POST")?.body).toMatchObject({ liters: "0", odometer: "", driverId: "" });

    await clicar(porTexto(tela, "button", "Cancelar")[0]);
    window.confirm = () => true;
    await clicar(porTexto(tela.querySelector('[data-registro="a1"]')!, "button", "Excluir")[0]);
    await ate(() => expect(pedidos.some((p) => p.method === "DELETE" && p.url === "/api/veiculos/v1/abastecimentos/a1")).toBe(true));
  });

  it("documentos: a situação vem com o prazo, e editar manda só os campos do documento por PATCH", async () => {
    const DOCUMENTOS = [
      { id: "d1", type: "LICENSING", number: null, expiresAt: "2026-10-01T00:00:00.000Z", notes: null, situacao: "vencido", dias: -8 },
      { id: "d2", type: "INSURANCE", number: "APO-1", expiresAt: "2027-10-01T00:00:00.000Z", notes: "Corretora X", situacao: "em_dia", dias: 357 },
    ];
    const { tela, pedidos } = await abrir({
      ...BASE,
      "/api/veiculos/v1/documentos": { body: DOCUMENTOS },
      "PATCH /api/veiculos/v1/documentos/d1": { body: DOCUMENTOS[0] },
    });
    await irPara(tela, "documentos");

    expect(celulas(tela, "d1")).toEqual(["Licenciamento (CRLV)", "01/10/2026", "Venceu há 8 dias", "-", "-"]);
    expect(celulas(tela, "d2")).toEqual(["Seguro", "01/10/2027", "Em dia", "APO-1", "Corretora X"]);
    expect(tela.querySelector('[data-registro="d1"] [data-situacao="vencido"]')).not.toBeNull();

    await clicar(porTexto(tela.querySelector('[data-registro="d1"]')!, "button", "Editar")[0]);
    const vencimento = tela.querySelector<HTMLInputElement>('input[name="expiresAt"]')!;
    expect(vencimento.value).toBe("2026-10-01");
    await digitar(vencimento, "2027-10-01");
    await enviar(tela);

    await ate(() => expect(tela.querySelector("form")).toBeNull());
    const gravacao = pedidos.find((p) => p.method === "PATCH")!;
    expect(gravacao.url).toBe("/api/veiculos/v1/documentos/d1");
    expect(gravacao.body).toEqual({ type: "LICENSING", expiresAt: "2027-10-01", number: "", notes: "" });
  });

  it("pneus: em uso ou com os km rodados; a alteração não manda a instalação", async () => {
    const PNEUS = [
      { id: "p1", position: "Dianteiro esquerdo", brandModel: "Marca X", installedAt: "2026-01-10T00:00:00.000Z", installedKm: 50000, removedKm: null, notes: null },
      { id: "p2", position: "Estepe", brandModel: "Marca Y", installedAt: "2025-01-10T00:00:00.000Z", installedKm: 10000, removedKm: 65000, notes: "Recapado" },
    ];
    const { tela, pedidos } = await abrir({ ...BASE, "/api/veiculos/v1/pneus": { body: PNEUS }, "PATCH /api/veiculos/v1/pneus/p1": { body: PNEUS[0] } });
    await irPara(tela, "pneus");

    expect(celulas(tela, "p1")).toEqual(["Dianteiro esquerdo", "Marca X", "10/01/2026 · 50.000 km", "Em uso", "-"]);
    expect(celulas(tela, "p2")).toEqual(["Estepe", "Marca Y", "10/01/2025 · 10.000 km", "65.000 km (rodou 55.000 km)", "Recapado"]);

    await clicar(porTexto(tela.querySelector('[data-registro="p1"]')!, "button", "Editar")[0]);
    expect(tela.querySelector('input[name="installedKm"]')).toBeNull();
    await digitar(tela.querySelector<HTMLInputElement>('input[name="removedKm"]')!, "120000");
    await enviar(tela);

    await ate(() => expect(tela.querySelector("form")).toBeNull());
    expect(pedidos.find((p) => p.method === "PATCH")?.body).toEqual({ position: "Dianteiro esquerdo", brandModel: "Marca X", removedKm: "120000", notes: "" });
  });

  it("checklist: tudo começa OK, tocar no item marca problema, e o corpo leva um booleano por item", async () => {
    const CHECKLISTS = [
      { id: "c1", date: "2026-10-08T12:00:00.000Z", odometer: 10600, items: { ...CHECKLIST_TUDO_OK, freios: false, luzes: false }, notes: "Farol queimado", user: { name: "Ana" } },
      { id: "c2", date: "2026-10-07T12:00:00.000Z", odometer: null, items: CHECKLIST_TUDO_OK, notes: null, user: null },
    ];
    const { tela, pedidos } = await abrir({
      ...BASE,
      "/api/veiculos/v1/checklists": { body: CHECKLISTS },
      "POST /api/veiculos/v1/checklists": { status: 201, body: CHECKLISTS[0] },
    });
    await irPara(tela, "checklist");

    expect(tela.querySelector('[data-registro="c1"] [data-problemas="2"]')?.textContent).toBe("Problema: Freios, Luzes");
    expect(tela.querySelector('[data-registro="c1"]')?.textContent).toContain("Ana");
    expect(tela.querySelector('[data-registro="c2"]')?.textContent).toContain("Tudo OK");
    // Checklist é registro: não se altera nem se apaga.
    expect(porTexto(tela, "button", "Excluir")).toHaveLength(0);
    expect(porTexto(tela, "button", "Editar")).toHaveLength(0);

    await clicar(porTexto(tela, "button", "Novo checklist")[0]);
    const itens = [...tela.querySelectorAll<HTMLButtonElement>("[data-item]")];
    expect(itens).toHaveLength(8);
    expect(itens.every((item) => item.getAttribute("aria-pressed") === "false")).toBe(true);

    await clicar(tela.querySelector('[data-item="extintor"]')!);
    await clicar(tela.querySelector('[data-item="pneus"]')!);
    await clicar(tela.querySelector('[data-item="pneus"]')!);
    expect(tela.querySelector('[data-item="extintor"]')?.textContent).toContain("Problema");
    expect(tela.querySelector('[data-item="pneus"]')?.textContent).toContain("OK");
    await digitar(tela.querySelector<HTMLInputElement>('input[name="odometer"]')!, "10700");
    await enviar(tela);

    await ate(() => expect(tela.querySelector("form")).toBeNull());
    expect(pedidos.find((p) => p.method === "POST")?.body).toEqual({ items: { ...CHECKLIST_TUDO_OK, extintor: false }, odometer: "10700", notes: "" });
  });

  it("custos: os números do período, traço onde não há medição, e o período novo é pedido ao mudar o mês", async () => {
    const CUSTOS = { manutencao: 600.5, abastecimento: 660, total: 1260.5, litros: 110, kmRodados: 1100, custoPorKm: 1.15, consumoMedio: 10 };
    const SEM_KM = { manutencao: 0, abastecimento: 300, total: 300, litros: 50, kmRodados: null, custoPorKm: null, consumoMedio: null };
    const linha = (tela: HTMLElement, rotulo: string) => tela.querySelector(`[data-linha="${rotulo}"] dd`)?.textContent;

    const pedidos = api({ "/api/veiculos/v1": { body: VEICULO } });
    vi.mocked(fetch).mockImplementation(async (url) => {
      const endereco = String(url);
      pedidos.push({ url: endereco, method: "GET", body: undefined });
      if (endereco === "/api/veiculos/v1") return new Response(JSON.stringify(VEICULO));
      if (endereco.includes("/custos") && endereco.includes("de=2025-01")) return new Response(JSON.stringify({ periodo: {}, ...SEM_KM }));
      if (endereco.includes("/custos")) return new Response(JSON.stringify({ periodo: {}, ...CUSTOS }));
      return new Response("[]");
    });
    window.location.hash = "#custos";
    const tela = await montar(<FrotaDoVeiculoPage />);
    await ate(() => expect(linha(tela, "Total")).toBe(formatCurrency(1260.5)));

    expect(linha(tela, "Manutenção concluída")).toBe(formatCurrency(600.5));
    expect(linha(tela, "Abastecimento")).toBe(formatCurrency(660));
    expect(linha(tela, "Custo por km")).toBe(formatCurrency(1.15));
    expect(linha(tela, "Km rodados")).toBe("1.100 km");
    expect(linha(tela, "Consumo médio")).toBe("10 km/l");
    expect(linha(tela, "Litros abastecidos")).toBe("110 l");
    // Custos é só leitura: sem botão de registro.
    expect(porTexto(tela, "button", /Novo|Registrar/)).toHaveLength(0);

    const [de] = tela.querySelectorAll<HTMLInputElement>('input[type="month"]');
    await digitar(de, "2025-01");
    await ate(() => expect(linha(tela, "Total")).toBe(formatCurrency(300)));
    expect(linha(tela, "Custo por km")).toBe("-");
    expect(linha(tela, "Km rodados")).toBe("-");
    expect(linha(tela, "Consumo médio")).toBe("-");
    expect(pedidos.filter((p) => p.url.includes("/custos")).map((p) => p.url.includes("de=2025-01"))).toEqual([false, true]);
  });
});
