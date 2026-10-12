// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ate, clicar, desmontarTudo, montar, porTexto } from "./tela";
import { AVISO_DAS_RETENCOES, AVISO_DO_RECIBO, QUITA_ANTES_DE_FINALIZAR, type ReciboDeFrete } from "../src/lib/frete-contratado";

/**
 * As telas de parceiros e do frete contratado: a aba Frete da viagem, o recibo,
 * a lista de parceiros e o seletor de parceiro no cadastro do veículo. As
 * contas e as rotas são testadas em `tests/parceiros.test.ts`; aqui se confere
 * o que a tela mostra para cada perfil e o que ela manda para a API.
 */

const estado = vi.hoisted(() => ({ perfil: "ADMIN" }));

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { id: "u1", role: estado.perfil } } }) }));

import { FreteDaViagem } from "../src/app/dashboard/manifestos/frete";
import { FolhaDoRecibo } from "../src/app/dashboard/manifestos/[id]/recibo-frete/folha";
import ParceirosPage from "../src/app/dashboard/parceiros/page";
import VeiculosPage from "../src/app/dashboard/veiculos/page";

type Resposta = { status?: number; body: unknown };
type Pedido = { url: string; method: string; body: unknown };

/** Respostas por "MÉTODO endereço"; o GET dispensa o método. Uma lista de respostas é consumida em ordem. Endereço sem resposta devolve lista vazia. */
function api(respostas: Record<string, Resposta | Resposta[]>) {
  const pedidos: Pedido[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      pedidos.push({ url: String(url), method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const achada = respostas[`${method} ${url}`] ?? respostas[String(url)] ?? { body: [] };
      const resposta = Array.isArray(achada) ? (achada.length > 1 ? achada.shift()! : achada[0]) : achada;
      return new Response(JSON.stringify(resposta.body), { status: resposta.status ?? 200, headers: { "Content-Type": "application/json" } });
    }),
  );
  return pedidos;
}

const digitar = async (campo: HTMLInputElement | HTMLSelectElement, valor: string) => {
  const prototipo = campo instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototipo, "value")!.set!.call(campo, valor);
    campo.dispatchEvent(new Event(campo instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
};

const enviarFormulario = async (formulario: Element) => {
  await act(async () => {
    formulario.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
};

const campo = <T extends HTMLInputElement | HTMLSelectElement = HTMLInputElement>(tela: ParentNode, nome: string) => tela.querySelector<T>(`[name="${nome}"]`)!;

const PARCEIROS_DO_FRETE = [
  { id: "p1", name: "Transportes Parceiros", type: "TRANSPORTADORA", active: true, defaultCalcMode: "PERCENTUAL", defaultCalcBase: 70 },
  { id: "p2", name: "José Autônomo", type: "TAC_INDEPENDENTE", active: true, defaultCalcMode: null, defaultCalcBase: null },
];

const CONTRATO = {
  id: "c1",
  carrierId: "p1",
  calcMode: "PERCENTUAL",
  calcBase: 70,
  grossAmount: 1000,
  tollAmount: 100,
  otherAdditions: 0,
  discounts: 50,
  inss: 80,
  irrf: 0,
  sestSenat: 20,
  otherWithholdings: 0,
  status: "ADIANTADO",
  notes: null,
  carrier: { id: "p1", name: "Transportes Parceiros" },
  payments: [{ id: "pg1", kind: "ADIANTAMENTO", date: "2012-05-10T00:00:00.000Z", amount: 300, method: "PIX", notes: null, transactionId: "t1", transaction: { id: "t1", status: "PENDING" } }],
  valores: { bruto: 1000, acrescimos: 100, descontos: 50, retencoes: 100, liquido: 950, custo: 1050 },
  pago: 300,
  adiantado: 300,
  saldo: 650,
  sugerido: 1050,
};

const FRETE = {
  viagem: { id: "v1", status: "ROUTE", freteDasCargas: 1500, km: null, entregas: 2 },
  parceiroDoVeiculo: { id: "p1", name: "Transportes Parceiros" },
  contrato: CONTRATO,
  parceiros: PARCEIROS_DO_FRETE,
};

afterEach(async () => {
  await desmontarTudo();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  estado.perfil = "ADMIN";
});

describe("aba Frete da viagem", () => {
  it("mostra o contrato, os pagamentos e o saldo, e avisa quando o sugerido difere do gravado", async () => {
    api({ "/api/manifestos/v1/frete": { body: FRETE } });
    const tela = await montar(<FreteDaViagem manifestId="v1" podeAlterar />);
    await ate(() => expect(tela.querySelector('[data-frete="resumo"]')).not.toBeNull());

    expect(tela.textContent).toContain("Transportes Parceiros");
    expect(tela.querySelector("[data-situacao-do-frete]")?.textContent).toBe("Adiantado");
    expect(tela.querySelector('[data-linha="Líquido"] dd')?.textContent).toMatch(/950,00/);
    expect(tela.querySelector('[data-linha="Pago"] dd')?.textContent).toMatch(/300,00/);
    expect(tela.querySelector('[data-linha="Saldo"]')?.textContent).toMatch(/Saldo a pagar.*650,00/);
    expect(tela.querySelector('[data-linha="Retenções"] dd')?.textContent).toMatch(/100,00/);
    expect(tela.querySelector("[data-sugerido-diferente]")?.textContent).toMatch(/1\.050,00 hoje.*1\.000,00/);
    expect(tela.querySelector('[data-pagamento="pg1"]')?.textContent).toMatch(/Adiantamento · 10\/05\/2012 · Pix.*A pagar no Financeiro.*300,00/);
    expect(tela.querySelector("[data-recibo-de-frete]")?.getAttribute("href")).toBe("/dashboard/manifestos/v1/recibo-frete");
    // Com pagamento registrado não há botão de cancelar o contrato.
    expect(tela.querySelector("[data-cancelar-frete]")).toBeNull();
  });

  it("quem só lê não vê botão de gravar, pagar nem excluir; sem contrato, só o aviso", async () => {
    api({ "/api/manifestos/v1/frete": { body: FRETE }, "/api/manifestos/v2/frete": { body: { ...FRETE, contrato: null } } });
    const tela = await montar(<FreteDaViagem manifestId="v1" podeAlterar={false} />);
    await ate(() => expect(tela.querySelector('[data-frete="resumo"]')).not.toBeNull());
    for (const seletor of ["[data-editar-frete]", "[data-pagar-saldo]", "[data-adiantar-frete]", "[data-cancelar-frete]", '[aria-label="Excluir pagamento"]']) {
      expect(tela.querySelector(seletor), seletor).toBeNull();
    }
    expect(tela.querySelector("[data-recibo-de-frete]")).not.toBeNull();

    const semContrato = await montar(<FreteDaViagem manifestId="v2" podeAlterar={false} />);
    await ate(() => expect(semContrato.querySelector('[data-frete="sem-contrato"]')?.textContent).toMatch(/não tem frete contratado/));
    expect(semContrato.querySelector("form")).toBeNull();
  });

  it("perfil sem acesso recebe o aviso, não uma tela vazia", async () => {
    api({ "/api/manifestos/v1/frete": { status: 403, body: { error: "Acesso negado" } } });
    const tela = await montar(<FreteDaViagem manifestId="v1" podeAlterar={false} />);
    await ate(() => expect(tela.querySelector('[role="alert"]')?.textContent).toBe("Seu perfil não tem acesso ao frete contratado."));
  });

  it("sem contrato, quem altera já vê o formulário com o parceiro do veículo e o padrão dele; o aviso das retenções está na tela", async () => {
    const pedidos = api({
      "/api/manifestos/v1/frete": { body: { ...FRETE, contrato: null } },
      "PUT /api/manifestos/v1/frete": { status: 201, body: CONTRATO },
    });
    const tela = await montar(<FreteDaViagem manifestId="v1" podeAlterar />);
    await ate(() => expect(tela.querySelector('[data-frete="valores"]')).not.toBeNull());

    expect(campo<HTMLSelectElement>(tela, "carrierId").value).toBe("p1");
    expect(campo<HTMLSelectElement>(tela, "calcMode").value).toBe("PERCENTUAL");
    expect(campo(tela, "calcBase").value).toBe("70");
    expect(tela.querySelector("[data-aviso-das-retencoes]")?.textContent).toBe(AVISO_DAS_RETENCOES);
    // 70% de 1.500 de frete das cargas, calculado na tela pela mesma função da rota.
    expect(tela.querySelector("[data-sugerido]")?.textContent).toMatch(/Sugerido pela forma: R\$\s1\.050,00/);

    await clicar(porTexto(tela, "[data-sugerido] button", "Usar")[0]);
    expect(campo(tela, "grossAmount").value).toBe("1050");
    await digitar(campo(tela, "inss"), "80,50");
    await enviarFormulario(tela.querySelector("form")!);

    await ate(() => expect(pedidos.some((pedido) => pedido.method === "PUT")).toBe(true));
    expect(pedidos.find((pedido) => pedido.method === "PUT")?.body).toMatchObject({ carrierId: "p1", calcMode: "PERCENTUAL", calcBase: "70", grossAmount: "1050", inss: "80,50", irrf: "", notes: "" });
  });

  it("pagar o saldo já vem com o que falta; a confirmação pedida pela rota é perguntada e o pedido vai de novo com ela", async () => {
    const pedidos = api({
      "/api/manifestos/v1/frete": { body: FRETE },
      "POST /api/manifestos/v1/frete/pagamentos": [
        { status: 409, body: { error: QUITA_ANTES_DE_FINALIZAR, confirmar: "pagarAntesDeFinalizar" } },
        { status: 201, body: { pagamento: {}, contrato: CONTRATO } },
      ],
    });
    const confirmar = vi.fn(() => true);
    vi.stubGlobal("confirm", confirmar);

    const tela = await montar(<FreteDaViagem manifestId="v1" podeAlterar />);
    await ate(() => expect(tela.querySelector("[data-pagar-saldo]")).not.toBeNull());
    await clicar(tela.querySelector("[data-pagar-saldo]")!);
    expect(tela.querySelector('[data-frete="pagar"]')).not.toBeNull();
    expect(campo<HTMLSelectElement>(tela, "kind").value).toBe("SALDO");
    expect(campo(tela, "amount").value).toBe("650");

    await enviarFormulario(tela.querySelector("form")!);
    await ate(() => expect(pedidos.filter((pedido) => pedido.method === "POST")).toHaveLength(2));
    expect(confirmar).toHaveBeenCalledWith(QUITA_ANTES_DE_FINALIZAR);
    const [primeiro, segundo] = pedidos.filter((pedido) => pedido.method === "POST");
    expect(primeiro.body).toMatchObject({ kind: "SALDO", amount: "650", method: "PIX", paid: false });
    expect(primeiro.body).not.toHaveProperty("pagarAntesDeFinalizar");
    expect(segundo.body).toMatchObject({ kind: "SALDO", amount: "650", pagarAntesDeFinalizar: true });
    await ate(() => expect(tela.querySelector('[data-frete="resumo"]')).not.toBeNull());
  });

  it("quem não confirma não paga: fica a frase da recusa e nenhum segundo pedido", async () => {
    const pedidos = api({
      "/api/manifestos/v1/frete": { body: FRETE },
      "POST /api/manifestos/v1/frete/pagamentos": { status: 409, body: { error: QUITA_ANTES_DE_FINALIZAR, confirmar: "pagarAntesDeFinalizar" } },
    });
    vi.stubGlobal("confirm", vi.fn(() => false));

    const tela = await montar(<FreteDaViagem manifestId="v1" podeAlterar />);
    await ate(() => expect(tela.querySelector("[data-pagar-saldo]")).not.toBeNull());
    await clicar(tela.querySelector("[data-pagar-saldo]")!);
    await enviarFormulario(tela.querySelector("form")!);
    await ate(() => expect(tela.querySelector('[role="alert"]')?.textContent).toBe(QUITA_ANTES_DE_FINALIZAR));
    expect(pedidos.filter((pedido) => pedido.method === "POST")).toHaveLength(1);
  });
});

describe("recibo de frete", () => {
  it("a folha traz o parceiro, a viagem, a conta, os pagamentos, as assinaturas e a frase de que não é documento fiscal", async () => {
    const recibo: ReciboDeFrete = {
      empresa: { name: "Transportadora de Teste", logo: null },
      emitidoEm: "2012-05-12T15:00:00.000Z",
      parceiro: { nome: "Transportes Parceiros", documento: "99333111000187", rntrc: "12345678", tipo: "TRANSPORTADORA" },
      viagem: { id: "v1", codigo: "ABCDEF", situacao: "FINISHED", saiuEm: "2012-05-02T15:00:00.000Z", finalizadaEm: "2012-05-04T15:00:00.000Z", placa: "PRC1A23", veiculo: "Truck", motorista: "João Motorista", origens: ["Rio Preto - SP"], destinos: ["Mirassol - SP", "Bady Bassitt - SP"] },
      contrato: { situacao: "QUITADO", forma: "FIXO", base: 1000, observacao: null, grossAmount: 1000, tollAmount: 100, otherAdditions: 0, discounts: 50, inss: 80, irrf: 0, sestSenat: 20, otherWithholdings: 0 },
      valores: { bruto: 1000, acrescimos: 100, descontos: 50, retencoes: 100, liquido: 950, custo: 1050 },
      pagamentos: [
        { id: "pg1", kind: "ADIANTAMENTO", date: "2012-05-02T00:00:00.000Z", amount: 300, method: "PIX", notes: null },
        { id: "pg2", kind: "SALDO", date: "2012-05-05T00:00:00.000Z", amount: 650, method: "TRANSFERENCIA", notes: "banco 001" },
      ],
      pago: 950,
      saldo: 0,
      subcontratacao: null,
    };
    const tela = await montar(<FolhaDoRecibo recibo={recibo} />);
    expect(tela.querySelector('[data-secao="subcontratacao"]')).toBeNull();

    expect(tela.querySelector("h1")?.textContent).toBe("RECIBO DE PAGAMENTO DE FRETE");
    expect(tela.querySelector("[data-empresa]")?.textContent).toBe("Transportadora de Teste");
    expect(tela.querySelector('[data-secao="parceiro"]')?.textContent).toMatch(/Transportes Parceiros.*99\.333\.111\/0001-87.*12345678.*Transportadora/);
    expect(tela.querySelector('[data-secao="viagem"]')?.textContent).toMatch(/PRC1A23 · Truck.*João Motorista.*Rio Preto - SP.*Mirassol - SP · Bady Bassitt - SP/);
    const conta = (rotulo: string) => tela.querySelector(`[data-conta="${rotulo}"]`)?.textContent ?? "";
    expect(conta("Valor bruto")).toMatch(/1\.000,00/);
    expect(conta("Pedágio pago à parte")).toMatch(/\+ R\$\s100,00/);
    expect(conta("Descontos")).toMatch(/− R\$\s50,00/);
    expect(conta("INSS retido")).toMatch(/− R\$\s80,00/);
    expect(conta("SEST/SENAT retido")).toMatch(/− R\$\s20,00/);
    expect(conta("Valor líquido")).toMatch(/950,00/);
    expect(conta("Total pago")).toMatch(/950,00/);
    expect(conta("Saldo a pagar")).toMatch(/0,00/);
    expect(tela.querySelectorAll("[data-pagamento]")).toHaveLength(2);
    expect(tela.querySelector('[data-pagamento="pg2"]')?.textContent).toMatch(/05\/05\/2012 · Saldo · Transferência · banco 001.*650,00/);
    expect([...tela.querySelectorAll("[data-assinatura]")].map((no) => no.getAttribute("data-assinatura"))).toEqual(["Parceiro (quem recebe)", "Empresa (quem paga)"]);
    expect(tela.querySelector("[data-aviso]")?.textContent).toBe(AVISO_DO_RECIBO);
    // Não há número de RPA nem de CIOT na folha: as duas siglas só aparecem na frase do rodapé.
    expect((tela.textContent ?? "").replace(AVISO_DO_RECIBO, "")).not.toMatch(/RPA|CIOT/);
  });
});

const PARCEIRO = {
  id: "p1",
  type: "TAC_AGREGADO",
  name: "José Agregado",
  taxId: "52998224725",
  rntrc: "12345678",
  ie: null,
  state: "SP",
  phone: null,
  email: null,
  pixKey: "jose@pix.br",
  bankInfo: null,
  notes: null,
  active: true,
  vehicles: [{ id: "ve1", plate: "ABC1D23", model: "Truck" }],
  drivers: [{ id: "m1", active: true, user: { name: "João Motorista" } }],
};

describe("tela de parceiros", () => {
  it("quem lê o frete contratado vê o total em aberto e o fechamento; a operação, só o cadastro", async () => {
    api({ "/api/parceiros": { body: [{ ...PARCEIRO, defaultCalcMode: "FIXO", defaultCalcBase: 1800, emAberto: 650 }] } });
    const tela = await montar(<ParceirosPage />);
    await ate(() => expect(tela.querySelector('[data-parceiro="p1"]')).not.toBeNull());

    expect(tela.querySelector("[data-total-em-aberto]")?.textContent).toMatch(/Em aberto a pagar: R\$\s650,00/);
    const linha = tela.querySelector('[data-parceiro="p1"]')!;
    expect(linha.textContent).toMatch(/José Agregado.*TAC agregado · 529\.982\.247-25/);
    expect(linha.textContent).toContain("ABC1D23");
    expect(linha.textContent).toContain("João Motorista");
    expect(linha.querySelector("[data-em-aberto]")?.textContent).toMatch(/650,00/);
    expect(linha.querySelector("[data-abrir-fechamento]")).not.toBeNull();

    await desmontarTudo();
    estado.perfil = "OPERATION";
    api({ "/api/parceiros": { body: [PARCEIRO] } });
    const daOperacao = await montar(<ParceirosPage />);
    await ate(() => expect(daOperacao.querySelector('[data-parceiro="p1"]')).not.toBeNull());
    expect(daOperacao.querySelector("[data-total-em-aberto]")).toBeNull();
    expect(daOperacao.querySelector("[data-em-aberto]")).toBeNull();
    expect(daOperacao.querySelector("[data-abrir-fechamento]")).toBeNull();
    expect(porTexto(daOperacao, "button", "Novo parceiro")).toHaveLength(1);

    // No cadastro, a contratação padrão nem aparece para a operação.
    await clicar(porTexto(daOperacao, "button", "Editar")[0]);
    expect(daOperacao.querySelector("[data-contratacao-padrao]")).toBeNull();
    expect(daOperacao.querySelector("[data-veiculos-do-parceiro]")?.textContent).toBe("ABC1D23 (Truck)");
  });

  it("o cadastro novo da operação vai sem a contratação padrão; o do administrador vai com ela", async () => {
    estado.perfil = "OPERATION";
    let pedidos = api({ "/api/parceiros": { body: [] }, "POST /api/parceiros": { status: 201, body: PARCEIRO } });
    let tela = await montar(<ParceirosPage />);
    await ate(() => expect(porTexto(tela, "button", "Novo parceiro")).toHaveLength(1));
    await clicar(porTexto(tela, "button", "Novo parceiro")[0]);
    await digitar(campo(tela, "taxId"), "529.982.247-25");
    await digitar(campo(tela, "name"), "José Agregado");
    await clicar(porTexto(tela, "button", "Salvar parceiro")[0]);
    await ate(() => expect(pedidos.some((pedido) => pedido.method === "POST")).toBe(true));
    const daOperacao = pedidos.find((pedido) => pedido.method === "POST")!.body as Record<string, unknown>;
    expect(daOperacao).toMatchObject({ type: "TAC_AGREGADO", taxId: "529.982.247-25", name: "José Agregado" });
    expect(daOperacao).not.toHaveProperty("defaultCalcMode");
    expect(daOperacao).not.toHaveProperty("defaultCalcBase");

    await desmontarTudo();
    estado.perfil = "ADMIN";
    pedidos = api({ "/api/parceiros": { body: [] }, "POST /api/parceiros": { status: 201, body: PARCEIRO } });
    tela = await montar(<ParceirosPage />);
    await ate(() => expect(porTexto(tela, "button", "Novo parceiro")).toHaveLength(1));
    await clicar(porTexto(tela, "button", "Novo parceiro")[0]);
    await digitar(campo(tela, "taxId"), "52998224725");
    await digitar(campo(tela, "name"), "José Agregado");
    await digitar(campo<HTMLSelectElement>(tela, "defaultCalcMode"), "POR_KM");
    await digitar(campo(tela, "defaultCalcBase"), "3,25");
    await clicar(porTexto(tela, "button", "Salvar parceiro")[0]);
    await ate(() => expect(pedidos.some((pedido) => pedido.method === "POST")).toBe(true));
    expect(pedidos.find((pedido) => pedido.method === "POST")!.body).toMatchObject({ taxId: "52998224725", defaultCalcMode: "POR_KM", defaultCalcBase: "3,25" });
  });

  it("na edição, o cadastro e a contratação padrão vão cada um para a sua rota, só com o que mudou", async () => {
    const pedidos = api({
      "/api/parceiros": { body: [{ ...PARCEIRO, defaultCalcMode: "FIXO", defaultCalcBase: 1800, emAberto: 0 }] },
      "PATCH /api/parceiros/p1": { body: PARCEIRO },
      "PUT /api/parceiros/p1/contratacao": { body: PARCEIRO },
    });
    const tela = await montar(<ParceirosPage />);
    await ate(() => expect(tela.querySelector('[data-parceiro="p1"]')).not.toBeNull());
    await clicar(porTexto(tela, "button", "Editar")[0]);

    // O documento é a chave do cadastro: não se edita.
    expect(campo(tela, "taxId").disabled).toBe(true);
    await digitar(campo(tela, "phone"), "17 3333-0000");
    await digitar(campo(tela, "defaultCalcBase"), "2000");
    await clicar(porTexto(tela, "button", "Salvar parceiro")[0]);

    await ate(() => expect(pedidos.some((pedido) => pedido.method === "PUT")).toBe(true));
    expect(pedidos.find((pedido) => pedido.method === "PATCH")).toMatchObject({ url: "/api/parceiros/p1", body: { phone: "17 3333-0000" } });
    expect(Object.keys(pedidos.find((pedido) => pedido.method === "PATCH")!.body as object)).toEqual(["phone"]);
    expect(pedidos.find((pedido) => pedido.method === "PUT")).toMatchObject({ url: "/api/parceiros/p1/contratacao", body: { defaultCalcMode: "FIXO", defaultCalcBase: "2000" } });
  });

  it("perfil sem acesso vê o aviso de acesso negado", async () => {
    estado.perfil = "EXPEDITION";
    api({ "/api/parceiros": { status: 403, body: { error: "Acesso negado" } } });
    const tela = await montar(<ParceirosPage />);
    await ate(() => expect(tela.textContent).toContain("Seu perfil não tem acesso a esta área."));
  });
});

describe("cadastro do veículo", () => {
  it("escolher o parceiro esconde os campos soltos de proprietário e manda o parceiro na gravação", async () => {
    const veiculo = { id: "ve1", plate: "ABC1D23", model: "Truck", type: "TRUCK", capacity: null, maxWeight: null, year: null, driverId: null, carrierId: null, status: "AVAILABLE", ownerTaxId: "11144477735", ownerName: "Dono Antigo" };
    const pedidos = api({
      "/api/veiculos": { body: [veiculo] },
      "/api/motoristas": { body: [] },
      "/api/parceiros": { body: [PARCEIRO] },
      "PATCH /api/veiculos/ve1": { body: veiculo },
    });
    const tela = await montar(<VeiculosPage />);
    await ate(() => expect(porTexto(tela, "button", "Editar")).toHaveLength(1));
    await clicar(porTexto(tela, "button", "Editar")[0]);
    await ate(() => expect(tela.querySelector("[data-parceiro-do-veiculo]")).not.toBeNull());

    // Sem parceiro, os campos soltos do proprietário estão lá.
    const mdfe = tela.querySelector("[data-dados-do-mdfe]")!;
    expect(mdfe.textContent).toContain("Dono (CPF/CNPJ), se de terceiro");
    expect(mdfe.textContent).toContain("Nome do dono");
    expect(mdfe.querySelector("[data-proprietario-do-parceiro]")).toBeNull();

    await digitar(tela.querySelector<HTMLSelectElement>("[data-parceiro-do-veiculo]")!, "p1");
    expect(mdfe.textContent).not.toContain("Dono (CPF/CNPJ), se de terceiro");
    expect(mdfe.textContent).not.toContain("Nome do dono");
    expect(mdfe.querySelector("[data-proprietario-do-parceiro]")?.textContent).toMatch(/cadastro do parceiro/);

    await clicar(porTexto(tela, "button", "Salvar Veículo")[0]);
    await ate(() => expect(pedidos.some((pedido) => pedido.method === "PATCH")).toBe(true));
    // Os campos soltos vão como estavam: escolher o parceiro não apaga o que o veículo tinha.
    expect(pedidos.find((pedido) => pedido.method === "PATCH")?.body).toMatchObject({ carrierId: "p1", ownerTaxId: "11144477735", ownerName: "Dono Antigo" });
  });
});
