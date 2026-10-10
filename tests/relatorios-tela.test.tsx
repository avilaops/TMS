// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ate, desmontarTudo, montar } from "./tela";
import { formatCurrency } from "../src/lib/format";
import { periodoDoRelatorio, type Relatorio } from "../src/lib/relatorios";

/**
 * Tela dos relatórios (`/dashboard/relatorios`). As contas e a rota são
 * testadas em `tests/relatorios.test.ts`; aqui se confere o que a tela mostra
 * com cada resposta e o que ela pede quando o período muda.
 */

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

import RelatoriosPage from "../src/app/dashboard/relatorios/page";

type Resposta = { status?: number; body: unknown };

const PADRAO = periodoDoRelatorio();
const caminho = (de: string, ate: string) => `/api/relatorios?de=${de}&ate=${ate}`;

function api(respostas: Record<string, Resposta>) {
  const pedidos: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL) => {
      pedidos.push(String(url));
      const resposta = respostas[String(url)];
      if (!resposta) throw new Error(`Chamada inesperada: ${String(url)}`);
      return new Response(JSON.stringify(resposta.body), { status: resposta.status ?? 200 });
    }),
  );
  return pedidos;
}

const VAZIO: Relatorio = {
  operacional: {
    cargas: 0,
    porStatus: {},
    prazo: { entregas: 0, noPrazo: 0, foraDoPrazo: 0, semMedicao: 0, taxaNoPrazo: null, tempoMedioHoras: null },
    motoristas: [],
  },
  comercial: { cotacoes: 0, porStatus: {}, conversao: null, frete: 0, clientes: [] },
  financeiro: {
    recebido: 0,
    pago: 0,
    resultado: 0,
    despesasPorCategoria: [],
    despesasPorCentroDeCusto: [],
    aReceberEmAberto: 0,
    vencido: 0,
    inadimplencia: null,
  },
};

const CHEIO: Relatorio = {
  operacional: {
    cargas: 12,
    porStatus: { DELIVERED: 9, ROUTE: 2, CANCELLED: 1 },
    prazo: { entregas: 9, noPrazo: 6, foraDoPrazo: 2, semMedicao: 1, taxaNoPrazo: 75, tempoMedioHoras: 18.5 },
    motoristas: [
      { chave: "m1", nome: "Ana", entregas: 7, noPrazo: 6, foraDoPrazo: 1, semMedicao: 0, taxaNoPrazo: 85.7, tempoMedioHoras: 16 },
      { chave: "", nome: "Sem motorista", entregas: 2, noPrazo: 0, foraDoPrazo: 1, semMedicao: 1, taxaNoPrazo: 0, tempoMedioHoras: null },
    ],
  },
  comercial: {
    cotacoes: 8,
    porStatus: { NEW: 3, CONVERTED: 4, LOST: 1 },
    conversao: 50,
    frete: 4321.5,
    clientes: [{ clientId: "c1", nome: "Serilon", cargas: 11, peso: 1250.5, frete: 4321.5, aCotar: 2 }],
  },
  financeiro: {
    recebido: 5000,
    pago: 6200.4,
    resultado: -1200.4,
    despesasPorCategoria: [{ categoria: "Combustível", total: 3100.2 }],
    despesasPorCentroDeCusto: [{ centro: "Filial Rio Preto", total: 2100.2 }],
    aReceberEmAberto: 2000,
    vencido: 500,
    inadimplencia: 25,
  },
};

const carregando = (tela: HTMLElement) => tela.querySelector('[aria-label="Carregando"]');
const cartao = (tela: HTMLElement, rotulo: string) => tela.querySelector(`[data-cartao="${rotulo}"]`);
const linha = (tela: HTMLElement, rotulo: string) => tela.querySelector(`[data-linha="${rotulo}"] dd`)?.textContent;

async function abrir(resposta: Resposta, outras: Record<string, Resposta> = {}) {
  const pedidos = api({ [caminho(PADRAO.de, PADRAO.ate)]: resposta, ...outras });
  const tela = await montar(<RelatoriosPage />);
  await ate(() => expect(carregando(tela)).toBeNull());
  return { tela, pedidos };
}

afterEach(async () => {
  await desmontarTudo();
  vi.unstubAllGlobals();
});

describe("tela dos relatórios", () => {
  it("403 mostra o aviso de acesso, sem cartão nem número zerado", async () => {
    const { tela } = await abrir({ status: 403, body: { error: "Acesso negado" } });

    expect(tela.textContent).toContain("Acesso negado");
    expect(tela.textContent).toContain("Seu perfil não tem acesso a esta área.");
    expect(tela.querySelectorAll("[data-cartao]")).toHaveLength(0);
    expect(tela.textContent).not.toContain("R$");
  });

  it("401 pede novo login, sem dizer que o perfil é restrito", async () => {
    const { tela } = await abrir({ status: 401, body: { error: "Não autorizado" } });

    expect(tela.textContent).toContain("Sessão expirada");
    expect(tela.querySelector('a[href="/login"]')).not.toBeNull();
    expect(tela.textContent).not.toContain("Seu perfil");
    expect(tela.querySelectorAll("[data-cartao]")).toHaveLength(0);
  });

  it("erro da API aparece como alerta, com o período ainda na tela para corrigir", async () => {
    const { tela } = await abrir({ status: 400, body: { error: "Período inválido. Use de=AAAA-MM e ate=AAAA-MM, com no máximo 36 meses." } });

    expect(tela.querySelector('[role="alert"]')?.textContent).toContain("Período inválido");
    expect(tela.querySelectorAll('input[type="month"]')).toHaveLength(2);
    expect(tela.querySelectorAll("[data-cartao]")).toHaveLength(0);
  });

  it("período sem movimento: taxas com traço, não 0%, e as três listas dizem que estão vazias", async () => {
    const { tela } = await abrir({ body: { periodo: PADRAO, ...VAZIO } });

    expect(cartao(tela, "Cargas no período")?.textContent).toContain("0");
    expect(cartao(tela, "Entregas no prazo")?.textContent).toMatch(/-$/);
    expect(cartao(tela, "Conversão de cotações")?.textContent).toMatch(/-$/);
    expect(tela.textContent).not.toContain("%");
    expect(linha(tela, "Tempo médio")).toBe("-");
    expect(linha(tela, "Inadimplência")).toBe("-");
    for (const aviso of ["Nenhuma entrega no período.", "Nenhuma carga no período.", "Nenhuma despesa paga no período."]) {
      expect(tela.textContent).toContain(aviso);
    }
    expect(tela.querySelector("table")).toBeNull();
    expect(tela.querySelector('a[href="/dashboard/cobranca"]')).toBeNull();
  });

  it("mostra os números das três seções, o resultado negativo em alerta e o caminho para a cobrança", async () => {
    const { tela, pedidos } = await abrir({ body: { periodo: PADRAO, ...CHEIO } });

    expect(pedidos).toEqual([caminho(PADRAO.de, PADRAO.ate)]);

    expect(cartao(tela, "Cargas no período")?.textContent).toContain("12");
    expect(cartao(tela, "Entregas no prazo")?.textContent).toContain("75%");
    expect(cartao(tela, "Conversão de cotações")?.textContent).toContain("50%");
    const resultado = cartao(tela, "Resultado realizado");
    expect(resultado?.textContent).toContain(formatCurrency(-1200.4));
    expect(resultado?.querySelector(".text-red-600")).not.toBeNull();

    expect(linha(tela, "No prazo")).toBe("6");
    expect(linha(tela, "Fora do prazo")).toBe("2");
    expect(linha(tela, "Sem medição")).toBe("1");
    expect(linha(tela, "Tempo médio")).toBe("18,5 h");
    expect(tela.querySelector('[data-status="DELIVERED"]')?.textContent).toBe("Entregue: 9");
    expect(tela.querySelector('[data-status="CANCELLED"]')?.textContent).toBe("Cancelada: 1");

    const ana = [...(tela.querySelector('[data-linha-da-tabela="m1"]')?.querySelectorAll("td") ?? [])].map((td) => td.textContent);
    expect(ana).toEqual(["Ana", "7", "6", "1", "85,7%", "16 h"]);
    const semMotorista = [...(tela.querySelector('[data-linha-da-tabela="sem-motorista"]')?.querySelectorAll("td") ?? [])].map((td) => td.textContent);
    expect(semMotorista).toEqual(["Sem motorista", "2", "0", "1", "0%", "-"]);

    expect(linha(tela, "Cotações recebidas")).toBe("8");
    expect(linha(tela, "Convertidos")).toBe("4");
    // Status sem cotação no período aparece com zero, não some.
    expect(linha(tela, "Em contato")).toBe("0");
    expect(linha(tela, "Frete das cargas")).toBe(formatCurrency(4321.5));
    const cliente = [...(tela.querySelector('[data-linha-da-tabela="c1"]')?.querySelectorAll("td") ?? [])].map((td) => td.textContent);
    expect(cliente).toEqual(["Serilon", "11", "1.250,5 kg", formatCurrency(4321.5), "2"]);

    expect(linha(tela, "Recebido")).toBe(formatCurrency(5000));
    expect(linha(tela, "Pago")).toBe(formatCurrency(6200.4));
    expect(linha(tela, "Inadimplência")).toBe("25%");
    expect(tela.querySelector('[data-linha-da-tabela="Combustível"]')?.textContent).toContain(formatCurrency(3100.2));
    expect(tela.querySelector('[data-linha-da-tabela="centro:Filial Rio Preto"]')?.textContent).toContain(formatCurrency(2100.2));
    expect(tela.querySelector('a[href="/dashboard/cobranca"]')).not.toBeNull();
  });

  it("mudar o mês pede o período novo; campo apagado não pede nada", async () => {
    const novo = caminho("2025-01", PADRAO.ate);
    const { tela, pedidos } = await abrir(
      { body: { periodo: PADRAO, ...VAZIO } },
      { [novo]: { body: { periodo: { de: "2025-01", ate: PADRAO.ate }, ...CHEIO } } },
    );

    const [de] = tela.querySelectorAll<HTMLInputElement>('input[type="month"]');
    expect(de.value).toBe(PADRAO.de);

    const digitar = async (valor: string) => {
      const gravar = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      await act(async () => {
        gravar.call(de, valor);
        de.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };

    await digitar("");
    expect(pedidos).toHaveLength(1);

    await digitar("2025-01");
    await ate(() => expect(cartao(tela, "Cargas no período")?.textContent).toContain("12"));
    expect(pedidos).toEqual([caminho(PADRAO.de, PADRAO.ate), novo]);
  });
});
