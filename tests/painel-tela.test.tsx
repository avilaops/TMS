// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ate, clicar, desmontarTudo, montar } from "./tela";
import { formatCurrency } from "../src/lib/format";

/**
 * Tela inicial do painel (`/dashboard`): os cartões, o botão de mostrar e
 * esconder a receita e as entregas da semana. A rota é testada em
 * `tests/seguranca-usuarios.test.ts` e as contas da semana em
 * `tests/relatorios.test.ts`.
 */

const estado = vi.hoisted(() => ({ sessao: { data: { user: { role: "ADMIN" } } } as { data: { user: { role: string } } | null } }));

vi.mock("next-auth/react", () => ({ useSession: () => estado.sessao }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...resto }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...resto}>
      {children}
    </a>
  ),
}));

import DashboardPage from "../src/app/dashboard/page";

const CHAVE = "tms:receita-oculta";
const OCULTO = "R$ ••••";
const DETALHE = {
  coletasAtivas: 4,
  coletasEntregues: 3,
  viagensEmRota: 1,
  viagensEmMontagem: 1,
  viagensFinalizadas: 0,
  clientesAtivos: 5,
  clientesInativos: 0,
  motoristas: 2,
};
const STATS = { coletas: 7, manifestos: 2, clientes: 5, veiculos: 3, receita: 1234.5, receitaDoMes: 234.5, entregasDaSemana: [0, 2, 4, 1, 0, 0, 0], detalhe: DETALHE };
const NOVA = {
  coletas: 0,
  manifestos: 0,
  clientes: 0,
  veiculos: 0,
  receita: 0,
  receitaDoMes: 0,
  entregasDaSemana: [0, 0, 0, 0, 0, 0, 0],
  detalhe: { ...DETALHE, coletasAtivas: 0, coletasEntregues: 0, viagensEmRota: 0, viagensEmMontagem: 0, clientesAtivos: 0, motoristas: 0 },
};

function api(resposta: { status?: number; body: unknown }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(resposta.body), { status: resposta.status ?? 200 })),
  );
}

const cartao = (tela: HTMLElement, titulo: string) => tela.querySelector<HTMLElement>(`[data-cartao="${titulo}"]`);
const botaoDaReceita = (tela: HTMLElement) => cartao(tela, "Receita")!.querySelector("button")!;
const apoio = (tela: HTMLElement, titulo: string) => cartao(tela, titulo)!.querySelector("[data-apoio]")?.textContent;
const dias = (tela: HTMLElement) => [...tela.querySelectorAll("[data-dia]")].map((dia) => dia.textContent);

async function abrir(resposta: { status?: number; body: unknown } = { body: STATS }) {
  api(resposta);
  const tela = await montar(<DashboardPage />);
  await ate(() => expect(tela.querySelector(".animate-spin")).toBeNull());
  return tela;
}

beforeEach(() => {
  estado.sessao = { data: { user: { role: "ADMIN" } } };
  localStorage.clear();
});

afterEach(async () => {
  await desmontarTudo();
  vi.unstubAllGlobals();
});

describe("tela inicial do painel", () => {
  it("administrador vê os quatro cartões, com a receita em reais e sem variação inventada", async () => {
    const tela = await abrir();

    expect([...tela.querySelectorAll("[data-cartao]")].map((no) => no.getAttribute("data-cartao"))).toEqual([
      "Receita",
      "Coletas",
      "Viagens (MDF-e)",
      "Clientes",
    ]);
    expect(cartao(tela, "Receita")!.textContent).toContain(formatCurrency(1234.5));
    // Em destaque, o que está em andamento; embaixo, o segundo número.
    expect(cartao(tela, "Coletas")!.textContent).toContain("4");
    expect(apoio(tela, "Coletas")).toBe("3 entregues");
    expect(apoio(tela, "Viagens (MDF-e)")).toBe("1 em montagem · 0 finalizadas");
    expect(apoio(tela, "Clientes")).toBe("0 inativos");
    expect(apoio(tela, "Receita")).toBe(`${formatCurrency(234.5)} neste mês`);
    expect(tela.textContent).not.toContain("+15%");
    // Cada cartão leva à sua lista.
    expect(cartao(tela, "Coletas")!.querySelector("a")!.getAttribute("href")).toBe("/dashboard/coletas");
    expect(cartao(tela, "Receita")!.querySelector("a")!.getAttribute("href")).toBe("/dashboard/financeiro");
  });

  it("o botão esconde e mostra a receita, e a escolha fica guardada no aparelho", async () => {
    const tela = await abrir();
    const botao = botaoDaReceita(tela);
    expect(botao.getAttribute("aria-label")).toBe("Esconder a receita");
    expect(botao.getAttribute("aria-pressed")).toBe("false");

    await clicar(botao);
    expect(cartao(tela, "Receita")!.textContent).toContain(OCULTO);
    expect(tela.textContent).not.toContain(formatCurrency(1234.5));
    expect(botaoDaReceita(tela).getAttribute("aria-label")).toBe("Mostrar a receita");
    expect(botaoDaReceita(tela).getAttribute("aria-pressed")).toBe("true");
    expect(localStorage.getItem(CHAVE)).toBe("1");
    // Só a receita some (o valor do mês junto): os outros números continuam.
    expect(apoio(tela, "Receita")).toBe("Valor escondido");
    expect(cartao(tela, "Coletas")!.textContent).toContain("4");

    await clicar(botaoDaReceita(tela));
    expect(cartao(tela, "Receita")!.textContent).toContain(formatCurrency(1234.5));
    expect(localStorage.getItem(CHAVE)).toBe("0");
  });

  it("quem escondeu a receita volta a encontrá-la escondida", async () => {
    localStorage.setItem(CHAVE, "1");
    const tela = await abrir();

    await ate(() => expect(cartao(tela, "Receita")!.textContent).toContain(OCULTO));
    expect(tela.textContent).not.toContain(formatCurrency(1234.5));
  });

  it("operação não tem cartão de receita, botão de esconder nem atalho do financeiro", async () => {
    estado.sessao = { data: { user: { role: "OPERATION" } } };
    const tela = await abrir({ body: { ...STATS, receita: undefined } });

    expect(cartao(tela, "Receita")).toBeNull();
    expect(tela.querySelector('button[aria-label*="receita"]')).toBeNull();
    expect(tela.querySelector('a[href="/dashboard/financeiro"]')).toBeNull();
    expect(tela.querySelector('a[href="/dashboard/coletas"]')).not.toBeNull();
  });

  it("entregas da semana: a quantidade de cada dia, de segunda a domingo", async () => {
    const tela = await abrir();

    expect(tela.textContent).toContain("Entregas na semana");
    expect(dias(tela)).toEqual(["0Seg", "2Ter", "4Qua", "1Qui", "0Sex", "0Sáb", "0Dom"]);
  });

  it("com erro, os números viram traço: nem a receita nem as entregas aparecem zeradas", async () => {
    const tela = await abrir({ status: 500, body: { error: "Internal Server Error" } });

    expect(tela.querySelector('[role="alert"]')?.textContent).toContain("Não foi possível carregar os indicadores.");
    expect(cartao(tela, "Receita")!.textContent).toContain("—");
    expect(cartao(tela, "Receita")!.textContent).not.toContain("R$");
    expect(dias(tela)).toEqual(["—Seg", "—Ter", "—Qua", "—Qui", "—Sex", "—Sáb", "—Dom"]);
  });

  it("transportadora nova: cada cartão convida para o primeiro cadastro e os primeiros passos tomam o lugar do gráfico", async () => {
    const tela = await abrir({ body: NOVA });

    expect(apoio(tela, "Receita")).toBe("Lançar receita →");
    expect(apoio(tela, "Coletas")).toBe("Emitir minuta →");
    expect(apoio(tela, "Viagens (MDF-e)")).toBe("Montar viagem →");
    expect(apoio(tela, "Clientes")).toBe("Cadastrar cliente →");

    const passos = [...tela.querySelectorAll("[data-passo]")];
    expect(passos.map((passo) => passo.textContent?.replace("→", ""))).toEqual([
      "Cadastre o primeiro cliente",
      "Cadastre um motorista",
      "Cadastre um veículo",
      "Emita a primeira minuta",
      "Monte a primeira viagem",
    ]);
    expect(passos.every((passo) => passo.getAttribute("data-passo") === "a-fazer")).toBe(true);
    expect(passos[0].querySelector("a")!.getAttribute("href")).toBe("/dashboard/clientes");
    expect(tela.textContent).toContain("0 de 5");
    expect(tela.querySelector("[data-grafico]")).toBeNull();
  });

  it("primeiros passos: o que já foi feito aparece riscado, e a lista some quando tudo está feito", async () => {
    const tela = await abrir({ body: { ...NOVA, clientes: 2, veiculos: 1, detalhe: { ...NOVA.detalhe, clientesAtivos: 2, motoristas: 1 } } });
    expect([...tela.querySelectorAll("[data-passo]")].map((passo) => passo.getAttribute("data-passo"))).toEqual(["feito", "feito", "feito", "a-fazer", "a-fazer"]);
    expect(tela.textContent).toContain("3 de 5");
    await desmontarTudo();

    const completa = await abrir();
    expect(completa.querySelector("[data-primeiros-passos]")).toBeNull();
    expect(completa.querySelector("[data-grafico]")).not.toBeNull();
  });

  it("semana sem entrega: em vez de sete barras vazias, um aviso com o caminho para as viagens", async () => {
    const tela = await abrir({ body: { ...STATS, entregasDaSemana: [0, 0, 0, 0, 0, 0, 0] } });

    expect(tela.querySelector("[data-grafico]")).toBeNull();
    const aviso = tela.querySelector("[data-sem-entregas]")!;
    expect(aviso.textContent).toContain("Ainda não há entregas nesta semana.");
    expect(aviso.querySelector("a")!.getAttribute("href")).toBe("/dashboard/manifestos");
  });

  it("ações rápidas: minuta, viagem e NF-e para todos; lançamento só para quem vê o financeiro", async () => {
    const acoes = (tela: HTMLElement) => [...tela.querySelectorAll("[data-acao]")].map((acao) => acao.getAttribute("data-acao"));
    expect(acoes(await abrir())).toEqual(["Emitir Minuta", "Nova Viagem", "Importar NF-e", "Novo Lançamento"]);
    await desmontarTudo();

    estado.sessao = { data: { user: { role: "OPERATION" } } };
    expect(acoes(await abrir({ body: { ...STATS, receita: undefined, receitaDoMes: undefined } }))).toEqual(["Emitir Minuta", "Nova Viagem", "Importar NF-e"]);
  });
});
