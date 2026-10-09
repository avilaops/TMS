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
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

import DashboardPage from "../src/app/dashboard/page";

const CHAVE = "tms:receita-oculta";
const OCULTO = "R$ ••••";
const STATS = { coletas: 7, manifestos: 2, clientes: 5, veiculos: 3, receita: 1234.5, entregasDaSemana: [0, 2, 4, 1, 0, 0, 0] };

function api(resposta: { status?: number; body: unknown }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(resposta.body), { status: resposta.status ?? 200 })),
  );
}

const cartao = (tela: HTMLElement, titulo: string) => tela.querySelector<HTMLElement>(`[data-cartao="${titulo}"]`);
const botaoDaReceita = (tela: HTMLElement) => cartao(tela, "Receita")!.querySelector("button")!;
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
    expect(cartao(tela, "Coletas")!.textContent).toContain("7");
    expect(tela.textContent).not.toContain("+15%");
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
    // Só a receita some: os outros números continuam.
    expect(cartao(tela, "Coletas")!.textContent).toContain("7");

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
});
