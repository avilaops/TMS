// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ate, clicar, desmontarTudo, montar, porTexto } from "./tela";
import { formatCurrency } from "../src/lib/format";
import { diaNoBrasil } from "../src/lib/financeiro";

/**
 * A tela da Equipe (`/dashboard/equipe`) e a baixa de título com juros, multa e
 * desconto (usada no Financeiro e no Faturamento). As contas e as rotas são
 * testadas em `tests/equipe.test.ts` e `tests/baixa.test.ts`; aqui se confere
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

import EquipePage from "../src/app/dashboard/equipe/page";
import { Baixa } from "../src/components/financeiro/Baixa";

type Resposta = { status?: number; body: unknown };
type Pedido = { url: string; method: string; body: unknown };

/** Respostas por "MÉTODO endereço"; o GET dispensa o método. Endereço sem resposta devolve lista vazia. */
function api(respostas: Record<string, Resposta>) {
  const pedidos: Pedido[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      pedidos.push({ url: String(url), method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const resposta = respostas[`${method} ${url}`] ?? respostas[String(url)] ?? { body: [] };
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

const HOJE = diaNoBrasil(new Date());
const daquiA = (n: number) => new Date(Date.parse(`${HOJE}T00:00:00.000Z`) + n * 86_400_000).toISOString();

const PESSOAS = {
  hoje: HOJE,
  pessoas: [
    { chave: "ajudante:a1", tipo: "ajudante", id: "a1", nome: "Carlos Ajudante", cpf: "55566677711", telefone: "1733330000", ativo: true, ausencia: null },
    {
      chave: "motorista:m1",
      tipo: "motorista",
      id: "m1",
      nome: "Ana Motorista",
      cpf: "55566677701",
      telefone: null,
      ativo: true,
      ausencia: { id: "au1", type: "VACATION", startDate: daquiA(-2), endDate: daquiA(3) },
    },
    { chave: "ajudante:a2", tipo: "ajudante", id: "a2", nome: "Zeca Inativo", cpf: "55566677712", telefone: null, ativo: false, ausencia: null },
  ],
};

afterEach(async () => {
  await desmontarTudo();
  vi.unstubAllGlobals();
  estado.perfil = "ADMIN";
});

describe("tela da equipe", () => {
  const abas = (tela: HTMLElement) => [...tela.querySelectorAll("[data-aba]")].map((aba) => aba.textContent);

  it("administrador vê as quatro abas; a operação não vê Adiantamentos", async () => {
    api({ "/api/equipe": { body: PESSOAS } });
    const admin = await montar(<EquipePage />);
    await ate(() => expect(abas(admin)).toEqual(["Pessoas", "Ausências", "Adiantamentos", "Produtividade"]));
    await desmontarTudo();

    estado.perfil = "OPERATION";
    const operacao = await montar(<EquipePage />);
    await ate(() => expect(abas(operacao)).toEqual(["Pessoas", "Ausências", "Produtividade"]));
  });

  it("Pessoas: motoristas e ajudantes juntos, com quem está ausente hoje e quem está inativo", async () => {
    api({ "/api/equipe": { body: PESSOAS } });
    const tela = await montar(<EquipePage />);
    await ate(() => expect(tela.querySelectorAll("[data-pessoa]")).toHaveLength(3));

    expect(tela.querySelector('[data-resumo="ausentes"]')?.textContent).toBe("1 pessoa ausente hoje.");
    const motorista = tela.querySelector('[data-pessoa="motorista:m1"]')!;
    expect(motorista.querySelector('[data-situacao="ausente"]')?.textContent).toContain("Férias até");
    // O motorista é cadastrado na tela de Motoristas; o ajudante, aqui.
    expect(motorista.querySelector('a[href="/dashboard/motoristas"]')).not.toBeNull();
    expect(porTexto(motorista, "button", "Editar")).toHaveLength(0);

    const ajudante = tela.querySelector('[data-pessoa="ajudante:a1"]')!;
    expect(ajudante.querySelector('[data-situacao="disponivel"]')).not.toBeNull();
    expect(porTexto(ajudante, "button", "Editar")).toHaveLength(1);
    expect(tela.querySelector('[data-pessoa="ajudante:a2"]')?.textContent).toContain("Inativo");
  });

  it("novo ajudante: manda nome, CPF e telefone, e relê a lista", async () => {
    const pedidos = api({
      "/api/equipe": { body: PESSOAS },
      "POST /api/equipe/ajudantes": { status: 201, body: { id: "a3" } },
    });
    const tela = await montar(<EquipePage />);
    await ate(() => expect(porTexto(tela, "button", "Novo ajudante")).toHaveLength(1));

    await clicar(porTexto(tela, "button", "Novo ajudante")[0]);
    const formulario = tela.querySelector('form[aria-label="Ajudante"]')!;
    const [nomeDoAjudante, cpf, telefone] = formulario.querySelectorAll<HTMLInputElement>("input");
    await digitar(nomeDoAjudante, "Novo Ajudante");
    await digitar(cpf, "555.666.777-13");
    await digitar(telefone, "17999990000");
    await enviarFormulario(formulario);

    await ate(() => expect(tela.querySelector('[role="status"]')?.textContent).toBe("Ajudante cadastrado."));
    expect(pedidos.find((p) => p.method === "POST")).toEqual({
      url: "/api/equipe/ajudantes",
      method: "POST",
      body: { name: "Novo Ajudante", cpf: "555.666.777-13", phone: "17999990000" },
    });
    expect(pedidos.filter((p) => p.url === "/api/equipe")).toHaveLength(2);
    expect(tela.querySelector('form[aria-label="Ajudante"]')).toBeNull();
  });

  it("Ausências: a lista com o período e os dias; registrar manda a pessoa escolhida como motorista ou ajudante", async () => {
    const pedidos = api({
      "/api/equipe": { body: PESSOAS },
      "/api/equipe/ausencias": {
        body: [
          {
            id: "au1",
            type: "VACATION",
            startDate: "2026-03-10T00:00:00.000Z",
            endDate: "2026-03-20T00:00:00.000Z",
            notes: null,
            driver: { id: "m1", user: { name: "Ana Motorista" } },
            helper: null,
          },
        ],
      },
      "POST /api/equipe/ausencias": { status: 201, body: { id: "au2" } },
    });
    const tela = await montar(<EquipePage />);
    await ate(() => expect(tela.querySelector('[data-aba="Ausências"]')).not.toBeNull());
    await clicar(tela.querySelector('[data-aba="Ausências"]')!);

    await ate(() => expect(tela.querySelectorAll("[data-ausencia]")).toHaveLength(1));
    const linha = [...tela.querySelectorAll('[data-ausencia="au1"] td')].map((td) => td.textContent);
    expect(linha.slice(0, 4)).toEqual(["Ana Motorista", "Férias", "10/03/2026 a 20/03/2026", "11"]);

    await clicar(porTexto(tela, "button", "Nova ausência")[0]);
    const formulario = tela.querySelector('form[aria-label="Ausência"]')!;
    // Só gente ativa pode ser escolhida.
    const pessoa = formulario.querySelector<HTMLSelectElement>('[data-campo="pessoa"]')!;
    expect([...pessoa.options].map((o) => o.value)).toEqual(["", "ajudante:a1", "motorista:m1"]);
    await digitar(pessoa, "ajudante:a1");
    const [de, ate_] = formulario.querySelectorAll<HTMLInputElement>('input[type="date"]');
    await digitar(de, "2026-04-02");
    // Ausência de um dia só: o "até" acompanha o "de".
    expect(ate_.value).toBe("2026-04-02");
    await enviarFormulario(formulario);

    await ate(() => expect(pedidos.some((p) => p.method === "POST")).toBe(true));
    expect(pedidos.find((p) => p.method === "POST")?.body).toEqual({
      driverId: null,
      helperId: "a1",
      type: "DAY_OFF",
      startDate: "2026-04-02",
      endDate: "2026-04-02",
      notes: "",
    });
  });

  it("Adiantamentos: o acerto mostra a diferença antes de confirmar e manda o gasto", async () => {
    const adiantamento = {
      id: "ad1",
      date: "2026-03-10T00:00:00.000Z",
      amount: 500,
      reason: "TRIP",
      status: "OPEN",
      spentAmount: null,
      settledAt: null,
      notes: null,
      manifest: null,
      driver: { id: "m1", user: { name: "Ana Motorista" } },
      helper: null,
      acerto: null,
    };
    const pedidos = api({
      "/api/equipe": { body: PESSOAS },
      "/api/equipe/adiantamentos": { body: [adiantamento] },
      "PATCH /api/equipe/adiantamentos/ad1": { body: { ...adiantamento, status: "SETTLED" } },
    });
    const tela = await montar(<EquipePage />);
    await ate(() => expect(tela.querySelector('[data-aba="Adiantamentos"]')).not.toBeNull());
    await clicar(tela.querySelector('[data-aba="Adiantamentos"]')!);

    await ate(() => expect(tela.querySelectorAll("[data-adiantamento]")).toHaveLength(1));
    expect(tela.querySelector('[data-resumo="em-aberto"]')?.textContent).toContain(formatCurrency(500));

    await clicar(porTexto(tela, "button", "Acertar")[0]);
    const formulario = tela.querySelector('form[aria-label="Acerto"]')!;
    expect(formulario.querySelector('[data-campo="diferenca"]')?.textContent).toContain("-");
    await digitar(formulario.querySelector<HTMLInputElement>('[data-campo="gasto"]')!, "420,50");
    expect(formulario.querySelector('[data-campo="diferenca"]')?.textContent).toContain(`Devolve ${formatCurrency(79.5)}`);
    await enviarFormulario(formulario);

    await ate(() => expect(pedidos.some((p) => p.method === "PATCH")).toBe(true));
    expect(pedidos.find((p) => p.method === "PATCH")).toEqual({
      url: "/api/equipe/adiantamentos/ad1",
      method: "PATCH",
      body: { action: "acertar", spentAmount: "420,50" },
    });
  });

  it("Produtividade: a operação não vê coluna de frete nem de comissão; o administrador vê, com o total", async () => {
    const contagens = { driverId: "m1", nome: "Ana Motorista", viagens: 2, entregas: 3, noPrazo: 1, foraDoPrazo: 1, semMedicao: 1, taxaNoPrazo: 50, peso: 35.5 };
    const abrir = async (perfil: string, corpo: unknown) => {
      estado.perfil = perfil;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: RequestInfo | URL) =>
          new Response(JSON.stringify(String(url).startsWith("/api/equipe/produtividade") ? corpo : PESSOAS), { status: 200, headers: { "Content-Type": "application/json" } }),
        ),
      );
      const tela = await montar(<EquipePage />);
      await ate(() => expect(tela.querySelector('[data-aba="Produtividade"]')).not.toBeNull());
      await clicar(tela.querySelector('[data-aba="Produtividade"]')!);
      await ate(() => expect(tela.querySelector('[data-motorista="m1"]')).not.toBeNull());
      return tela;
    };

    const operacao = await abrir("OPERATION", { periodo: { de: "2026-01", ate: "2026-03" }, comValores: false, motoristas: [contagens] });
    expect([...operacao.querySelectorAll("th")].map((th) => th.textContent)).toEqual(["Motorista", "Viagens", "Entregas", "No prazo", "Peso"]);
    expect(operacao.textContent).not.toMatch(/Comissão|Frete/);
    await desmontarTudo();

    const admin = await abrir("ADMIN", {
      periodo: { de: "2026-01", ate: "2026-03" },
      comValores: true,
      motoristas: [{ ...contagens, frete: 300.4, comissaoPct: 5, comissao: 15.02 }],
    });
    const linha = [...admin.querySelectorAll('[data-motorista="m1"] td')].map((td) => td.textContent);
    expect(linha).toEqual(["Ana Motorista", "2", "3", "1 (50%)", "35,5 kg", formatCurrency(300.4), `${formatCurrency(15.02)} (5%)`]);
    expect(admin.querySelector('[data-resumo="comissao"]')?.textContent).toContain(formatCurrency(15.02));
  });

  it("sessão expirada pede o login; perfil sem acesso vê o aviso, sem abas", async () => {
    api({ "/api/equipe": { status: 401, body: { error: "Não autorizado" } } });
    const expirada = await montar(<EquipePage />);
    await ate(() => expect(expirada.querySelector('a[href="/login"]')).not.toBeNull());
    await desmontarTudo();

    api({ "/api/equipe": { status: 403, body: { error: "Acesso negado" } } });
    const negada = await montar(<EquipePage />);
    await ate(() => expect(negada.textContent).toContain("Acesso negado"));
    expect(negada.querySelectorAll("[data-aba]")).toHaveLength(0);
  });
});

describe("baixa de título a receber", () => {
  const PADRAO = { multaPct: 2, jurosPct: 1 };
  const campo = (tela: HTMLElement, nome: string) => tela.querySelector<HTMLInputElement>(`[data-encargo="${nome}"]`)!;
  const recebido = (tela: HTMLElement) => tela.querySelector('[data-campo="recebido"]')?.textContent ?? "";

  it("título vencido abre com a multa e os juros sugeridos, que o operador altera ou apaga", async () => {
    const confirmar = vi.fn();
    const tela = await montar(
      <Baixa titulo={{ descricao: "Frete de março", valor: 1000, vencimento: daquiA(-30) }} parametros={PADRAO} ocupado={false} onConfirmar={confirmar} onCancelar={() => undefined} />,
    );

    expect(tela.textContent).toContain("30 dias de atraso");
    expect([campo(tela, "multa").value, campo(tela, "juros").value, campo(tela, "desconto").value]).toEqual(["20,00", "10,00", ""]);
    expect(recebido(tela)).toContain(formatCurrency(1030));

    await digitar(campo(tela, "juros"), "");
    await digitar(campo(tela, "desconto"), "5,50");
    expect(recebido(tela)).toContain(formatCurrency(1014.5));

    await enviarFormulario(tela.querySelector("form")!);
    expect(confirmar).toHaveBeenCalledWith({ multa: "20,00", juros: "", desconto: "5,50" });
  });

  it("título em dia abre sem sugestão; desconto maior que o valor ou texto que não é número trava a confirmação", async () => {
    const confirmar = vi.fn();
    const tela = await montar(
      <Baixa titulo={{ descricao: "Frete", valor: 100, vencimento: daquiA(5) }} parametros={PADRAO} ocupado={false} onConfirmar={confirmar} onCancelar={() => undefined} />,
    );

    expect([campo(tela, "multa").value, campo(tela, "juros").value]).toEqual(["", ""]);
    expect(recebido(tela)).toContain(formatCurrency(100));
    expect(tela.textContent).toContain("Título em dia");

    const botao = porTexto(tela, "button", "Confirmar recebimento")[0] as HTMLButtonElement;
    await digitar(campo(tela, "desconto"), "100,01");
    expect(tela.querySelector('[role="alert"]')?.textContent).toMatch(/desconto não pode passar/);
    expect(botao.disabled).toBe(true);

    await digitar(campo(tela, "desconto"), "dez");
    expect(tela.querySelector('[role="alert"]')?.textContent).toMatch(/só números/);
    await enviarFormulario(tela.querySelector("form")!);
    expect(confirmar).not.toHaveBeenCalled();

    await digitar(campo(tela, "desconto"), "100");
    expect(recebido(tela)).toContain(formatCurrency(0));
    expect(botao.disabled).toBe(false);
  });
});
