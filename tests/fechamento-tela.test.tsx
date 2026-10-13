// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { ate, clicar, desmontarTudo, montar, porTexto } from "./tela";
import { formatCurrency } from "../src/lib/format";
import { type AdiantamentoDoMes, type LinhaDeViagem, type PessoaDoFechamento, type ReciboDoFechamento, type RemuneracaoDoMotorista, contaDoMes, mesAtual, mesVizinho } from "../src/lib/remuneracao";

/**
 * O fechamento mensal da remuneração variável nas telas: o painel da pessoa com
 * a dívida de meses anteriores e o aviso do adiantamento sem acerto, a aba
 * Adiantamentos com o item descontado no fechamento, o recibo, a nota da
 * comissão na Produtividade e os ganhos no aplicativo do motorista. As contas
 * e as rotas são testadas em `tests/remuneracao.test.ts`; aqui se confere o que
 * cada tela mostra e o que manda para a API.
 */

vi.mock("next/link", () => ({
  default: ({ href, children, className, ...resto }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className} {...resto}>
      {children}
    </a>
  ),
}));

import { Adiantamentos } from "../src/app/dashboard/equipe/adiantamentos";
import { Fechamento } from "../src/app/dashboard/equipe/fechamento";
import { FolhaDoDemonstrativo } from "../src/app/dashboard/equipe/fechamento/[id]/recibo/folha";
import { NOTA_DA_COMISSAO, Produtividade } from "../src/app/dashboard/equipe/produtividade";
import RemuneracaoDoMotoristaPage from "../src/app/driver/remuneracao/page";

type Resposta = { status?: number; body: unknown };
type Pedido = { url: string; method: string; body: unknown };

/** Respostas pelo começo do endereço ("MÉTODO /api/…" ou só o endereço, para GET). Sem resposta, lista vazia. */
function api(respostas: Record<string, Resposta>) {
  const pedidos: Pedido[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      pedidos.push({ url: String(url), method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const chave = Object.keys(respostas).find((inicio) => `${method} ${url}`.startsWith(inicio) || (method === "GET" && String(url).startsWith(inicio)));
      const resposta = chave ? respostas[chave] : { body: [] };
      return new Response(JSON.stringify(resposta.body), { status: resposta.status ?? 200, headers: { "Content-Type": "application/json" } });
    }),
  );
  return pedidos;
}

const MES = mesAtual();
const ANTERIOR = mesVizinho(MES, -1);
const porExtenso = (mes: string) => mes.split("-").reverse().join("/");

const viagem = (manifestId: string, dia: string, total: number): LinhaDeViagem => ({
  manifestId,
  codigo: manifestId.toUpperCase(),
  saida: `${MES}-${dia}`,
  finalizada: `${MES}-${dia}`,
  placa: "TST1A23",
  dias: 1,
  km: 120,
  entregas: 2,
  frete: 1000,
  parcelas: { comissao: 50, diarias: total - 50, porKm: null, porEntrega: null, fixo: null },
  total,
  semKm: false,
  fora: null,
});

const VALE_DO_MES: AdiantamentoDoMes = { id: "vale-do-mes", date: `${MES}-05`, amount: 150, reason: "VOUCHER", origem: "VALE", anterior: false };
const VALE_ANTIGO: AdiantamentoDoMes = { id: "vale-antigo", date: `${ANTERIOR}-12`, amount: 200, reason: "VOUCHER", origem: "VALE", anterior: true };
const SOBRA_ANTIGA: AdiantamentoDoMes = { id: "sobra-antiga", date: `${ANTERIOR}-20`, amount: 40, reason: "TRIP", origem: "SOBRA", anterior: true };
const SEM_ACERTO: AdiantamentoDoMes = { id: "sem-acerto", date: `${MES}-08`, amount: 300, reason: "TRIP", anterior: false };

/** Variável 900; descontos 150 do mês + 240 de meses anteriores + 60 de saldo devedor = 450; saldo 450. */
const CONTA = contaDoMes([viagem("v1", "06", 500), viagem("v2", "09", 400)], [VALE_DO_MES, VALE_ANTIGO, SOBRA_ANTIGA], { semAcerto: [SEM_ACERTO], saldoAnterior: { mes: ANTERIOR, valor: 60 } });

const PESSOA: PessoaDoFechamento = {
  chave: "motorista:m1",
  tipo: "motorista",
  nome: "Ana Motorista de TESTE",
  cpf: "55566677701",
  ativo: true,
  formas: { commissionPct: 5, dailyRate: 100 },
  atual: CONTA,
  fechamento: null,
  diferenca: null,
};

afterEach(async () => {
  await desmontarTudo();
  vi.unstubAllGlobals();
});

describe("fechamento mensal: telas", () => {
  it("painel da pessoa: a dívida de meses anteriores sai numa linha à parte, o adiantamento sem acerto vira aviso, e fechar manda a pessoa e o mês", async () => {
    expect(CONTA).toMatchObject({ variavel: 900, adiantado: 450, anteriores: 300, saldo: 450 });
    const pedidos = api({
      "/api/equipe/fechamento": { body: { mes: MES, pessoas: [PESSOA], total: { variavel: 900, adiantado: 450, saldo: 450 } } },
      "POST /api/equipe/fechamento": { status: 201, body: { id: "f1" } },
    });
    const tela = await montar(<Fechamento podeFechar alteraValores />);
    await ate(() => expect(tela.querySelector('[data-pessoa="motorista:m1"]')).not.toBeNull());
    expect(tela.querySelector('[data-pessoa="motorista:m1"] [data-rotulo="Descontos"]')?.textContent).toBe(formatCurrency(450));

    await clicar(tela.querySelector('[data-abrir-pessoa="motorista:m1"]')!);
    const painel = tela.querySelector("[data-painel-do-fechamento]")!;
    expect(painel.querySelector('[data-numero="Descontos"]')?.textContent).toContain(formatCurrency(450));
    expect(painel.querySelector('[data-numero="Saldo a pagar"]')?.textContent).toContain(formatCurrency(450));
    expect(painel.querySelector("[data-anteriores]")?.textContent).toContain("De meses anteriores");
    expect(painel.querySelector("[data-anteriores]")?.textContent).toContain(formatCurrency(300));
    expect(painel.querySelector("[data-sem-acerto]")?.textContent).toContain(`1 adiantamento sem acerto (${formatCurrency(300)}) ficou fora da conta`);

    // A parte dos descontos: o do mês em cima; os de meses anteriores (com o saldo devedor trazido) à parte.
    expect(painel.querySelector('[data-parte="descontos"]')?.textContent).toBe("Descontos (4)");
    await clicar(painel.querySelector('[data-parte="descontos"]')!);
    const linhas = [...painel.querySelectorAll("[data-adiantamento]")].map((li) => li.getAttribute("data-adiantamento"));
    expect(linhas).toEqual(["vale-do-mes", "vale-antigo", "sobra-antiga"]);
    const anteriores = painel.querySelector('[data-descontos="anteriores"]')!;
    expect(anteriores.querySelector('[data-adiantamento="vale-do-mes"]')).toBeNull();
    expect([...anteriores.querySelectorAll("[data-adiantamento]")]).toHaveLength(2);
    expect(anteriores.textContent).toContain(`Saldo devedor do fechamento de ${porExtenso(ANTERIOR)}`);
    expect(anteriores.textContent).toContain("Sobra do adiantamento de viagem");
    expect(anteriores.textContent).toContain(porExtenso(`${ANTERIOR}-12`));
    // O adiantamento sem acerto não entra na lista dos descontos.
    expect(painel.querySelector('[data-adiantamento="sem-acerto"]')).toBeNull();

    await clicar(painel.querySelector("[data-fechar-o-mes]")!);
    const confirmacao = painel.querySelector("[data-confirmar-fechamento]")!;
    expect(confirmacao.textContent).toContain(formatCurrency(450));
    expect(confirmacao.textContent).toContain('Os 3 adiantamentos descontados saem do "em aberto" na aba Adiantamentos.');
    await clicar(confirmacao.querySelector("[data-confirmar]")!);
    await ate(() => expect(pedidos.some((p) => p.method === "POST")).toBe(true));
    expect(pedidos.find((p) => p.method === "POST")).toEqual({ url: "/api/equipe/fechamento", method: "POST", body: { pessoa: "motorista:m1", mes: MES } });
  });

  it("painel sem dívida anterior nem adiantamento sem acerto não mostra nenhuma das duas linhas; sem nada a descontar, o botão de fechar depende só das viagens", async () => {
    const limpa = contaDoMes([viagem("v1", "06", 500)], []);
    api({ "/api/equipe/fechamento": { body: { mes: MES, pessoas: [{ ...PESSOA, atual: limpa }], total: { variavel: 500, adiantado: 0, saldo: 500 } } } });
    const tela = await montar(<Fechamento podeFechar alteraValores />);
    await ate(() => expect(tela.querySelector('[data-abrir-pessoa="motorista:m1"]')).not.toBeNull());
    await clicar(tela.querySelector('[data-abrir-pessoa="motorista:m1"]')!);
    const painel = tela.querySelector("[data-painel-do-fechamento]")!;
    expect(painel.querySelector("[data-anteriores]")).toBeNull();
    expect(painel.querySelector("[data-sem-acerto]")).toBeNull();
    expect(painel.querySelector<HTMLButtonElement>("[data-fechar-o-mes]")?.disabled).toBe(false);
    await clicar(painel.querySelector('[data-parte="descontos"]')!);
    expect(painel.textContent).toContain("Nenhum vale ou sobra de acerto a descontar.");
  });

  it("aba Adiantamentos: o descontado no fechamento diz de que mês, sai do total em aberto e não tem ação", async () => {
    const base = { spentAmount: null, settledAt: null, notes: null, manifest: null, driver: { id: "m1", user: { name: "Ana Motorista de TESTE" } }, helper: null, acerto: null };
    api({
      "/api/equipe/adiantamentos": {
        body: [
          { ...base, id: "aberto", date: `${MES}-08T00:00:00.000Z`, amount: 300, reason: "TRIP", status: "OPEN", closing: null },
          { ...base, id: "descontado", date: `${ANTERIOR}-12T00:00:00.000Z`, amount: 200, reason: "VOUCHER", status: "OPEN", closing: { id: "f1", month: ANTERIOR } },
          { ...base, id: "sobra", date: `${ANTERIOR}-20T00:00:00.000Z`, amount: 500, reason: "TRIP", status: "SETTLED", spentAmount: 460, acerto: { diferenca: 40, sentido: "devolver" }, closing: { id: "f1", month: ANTERIOR } },
        ],
      },
    });
    const tela = await montar(<Adiantamentos pessoas={[]} />);
    await ate(() => expect(tela.querySelectorAll("[data-adiantamento]")).toHaveLength(3));

    // Só o que ninguém descontou ainda é dívida em aberto.
    expect(tela.querySelector('[data-resumo="em-aberto"]')?.textContent).toContain(formatCurrency(300));
    const descontado = tela.querySelector('[data-adiantamento="descontado"]')!;
    expect(descontado.querySelector("[data-descontado]")?.textContent).toBe(`Descontado no fechamento de ${porExtenso(ANTERIOR)}`);
    expect(descontado.textContent).not.toContain("Em aberto");
    expect(descontado.querySelectorAll("button")).toHaveLength(0);
    // O acertado com sobra continua mostrando o acerto, e também fica sem ação.
    const sobra = tela.querySelector('[data-adiantamento="sobra"]')!;
    expect(sobra.querySelector("[data-acerto]")?.textContent).toContain(`Devolve ${formatCurrency(40)}`);
    expect(sobra.querySelectorAll("button")).toHaveLength(0);
    // O que continua em aberto segue com o botão de acertar.
    expect(porTexto(tela.querySelector('[data-adiantamento="aberto"]')!, "button", "Acertar")).toHaveLength(1);
    expect(porTexto(tela, "button", "Reabrir")).toHaveLength(0);
  });

  it("recibo: os descontos do mês, a linha de meses anteriores com o saldo devedor trazido, e o aviso do adiantamento sem acerto", async () => {
    const recibo: ReciboDoFechamento = {
      empresa: { name: "Transportadora de TESTE", logo: null },
      emitidoEm: new Date().toISOString(),
      pessoa: { tipo: "motorista", nome: "Ana Motorista de TESTE", cpf: "55566677701" },
      mes: MES,
      fechadoEm: new Date().toISOString(),
      fechadoPor: "Fulano de TESTE",
      formas: { commissionPct: 5, dailyRate: 100 },
      conta: CONTA,
    };
    const tela = await montar(<FolhaDoDemonstrativo recibo={recibo} />);
    const secao = tela.querySelector('[data-secao="adiantamentos"]')!;
    const anteriores = secao.querySelector('[data-descontos="anteriores"]')!;
    expect(anteriores.querySelector('[data-conta="De meses anteriores"]')?.textContent).toContain(formatCurrency(300));
    expect(anteriores.querySelector("[data-saldo-anterior]")?.textContent).toContain(`Saldo devedor do fechamento de ${porExtenso(ANTERIOR)}`);
    expect([...anteriores.querySelectorAll("[data-adiantamento]")].map((li) => li.getAttribute("data-adiantamento"))).toEqual(["vale-antigo", "sobra-antiga"]);
    expect(secao.querySelector('[data-adiantamento="vale-do-mes"]')?.closest('[data-descontos="anteriores"]')).toBeNull();
    expect(secao.querySelector('[data-conta="Total descontado"]')?.textContent).toContain(formatCurrency(450));
    expect(secao.querySelector('[data-conta="Saldo a pagar"]')?.textContent).toContain(formatCurrency(450));
    expect(secao.querySelector("[data-sem-acerto]")?.textContent).toMatch(/^1 adiantamento sem acerto .* ficou fora da conta: a sobra a devolver/);

    // Fechamento gravado antes de existir a dívida anterior: sem a linha e sem o aviso.
    await desmontarTudo();
    const antigo = await montar(<FolhaDoDemonstrativo recibo={{ ...recibo, conta: contaDoMes([viagem("v1", "06", 500)], [{ id: "x", date: `${MES}-05`, amount: 100, reason: "VOUCHER" }]) }} />);
    expect(antigo.querySelector('[data-descontos="anteriores"]')).toBeNull();
    expect(antigo.querySelector("[data-sem-acerto]")).toBeNull();
    expect(antigo.querySelector('[data-adiantamento="x"]')?.textContent).toContain("Vale");
  });

  it("Produtividade: com comissão, uma linha diz que o valor a pagar é o do Fechamento e por que os dois diferem; sem comissão, não", async () => {
    const contagens = { driverId: "m1", nome: "Ana Motorista de TESTE", viagens: 2, entregas: 3, noPrazo: 1, foraDoPrazo: 1, semMedicao: 1, taxaNoPrazo: 50, peso: 35.5 };
    const abrir = async (corpo: unknown) => {
      api({ "/api/equipe/produtividade": { body: corpo } });
      const tela = await montar(<Produtividade />);
      await ate(() => expect(tela.querySelector('[data-motorista="m1"]')).not.toBeNull());
      return tela;
    };

    const comComissao = await abrir({ periodo: { de: MES, ate: MES }, comValores: true, motoristas: [{ ...contagens, frete: 300.4, comissaoPct: 5, comissao: 15.02 }] });
    expect(comComissao.querySelector('[data-nota="comissao-a-pagar"]')?.textContent).toBe(NOTA_DA_COMISSAO);
    expect(NOTA_DA_COMISSAO).toBe("O valor a pagar é o do Fechamento, e pode diferir: aqui conta a data da entrega; lá, a viagem finalizada no mês.");
    // Os números da aba não mudam.
    expect(comComissao.querySelector('[data-resumo="comissao"]')?.textContent).toContain(formatCurrency(15.02));
    await desmontarTudo();

    const semComissao = await abrir({ periodo: { de: MES, ate: MES }, comValores: true, motoristas: [{ ...contagens, frete: 300.4, comissaoPct: null, comissao: null }] });
    expect(semComissao.querySelector('[data-nota="comissao-a-pagar"]')).toBeNull();
    await desmontarTudo();

    const operacao = await abrir({ periodo: { de: MES, ate: MES }, comValores: false, motoristas: [contagens] });
    expect(operacao.querySelector('[data-nota="comissao-a-pagar"]')).toBeNull();
  });

  it("aplicativo do motorista: o total e uma linha por viagem; tocar abre o detalhe de uma por vez", async () => {
    const linha = ({ manifestId, codigo, finalizada, placa, dias, km, entregas, parcelas, total, semKm, fora }: LinhaDeViagem) => ({ manifestId, codigo, finalizada, placa, dias, km, entregas, parcelas, total, semKm, fora });
    const ganhos: RemuneracaoDoMotorista = { visivel: true, mes: MES, fechado: false, total: 1200, viagens: [linha(viagem("v1", "06", 500)), linha(viagem("v2", "09", 400)), linha({ ...viagem("v3", "11", 300), km: null, semKm: true })] };
    api({ "/api/driver/remuneracao": { body: ganhos } });
    const tela = await montar(<RemuneracaoDoMotoristaPage />);
    await ate(() => expect(tela.querySelectorAll("[data-viagem]")).toHaveLength(3));

    expect(tela.querySelector('[data-ganhos="total"]')?.textContent).toContain(formatCurrency(1200));
    expect(tela.querySelector('[data-ganhos="total"]')?.textContent).toContain("3 viagens finalizadas");
    // Fechada, cada viagem é uma linha: código, dia e valor; o detalhe não está na tela.
    expect(tela.querySelectorAll("[data-detalhe-da-viagem]")).toHaveLength(0);
    const primeira = tela.querySelector('[data-abrir-viagem="v1"]')!;
    expect(primeira.textContent).toContain("Viagem #V1 · 06/");
    expect(primeira.textContent).toContain(formatCurrency(500));
    expect(primeira.getAttribute("aria-expanded")).toBe("false");
    expect(tela.textContent).not.toContain("TST1A23");

    await clicar(primeira);
    expect(primeira.getAttribute("aria-expanded")).toBe("true");
    const detalhe = tela.querySelector('[data-viagem="v1"] [data-detalhe-da-viagem]')!;
    expect(detalhe.textContent).toContain("TST1A23 · 1 dia · 120 km · 2 entregas");
    expect(detalhe.textContent).toContain(`Comissão ${formatCurrency(50)}`);

    // Abrir outra fecha a primeira; tocar de novo fecha.
    await clicar(tela.querySelector('[data-abrir-viagem="v3"]')!);
    expect(tela.querySelectorAll("[data-detalhe-da-viagem]")).toHaveLength(1);
    expect(tela.querySelector('[data-viagem="v3"] [data-detalhe-da-viagem]')?.textContent).toContain("Sem o hodômetro");
    await clicar(tela.querySelector('[data-abrir-viagem="v3"]')!);
    expect(tela.querySelectorAll("[data-detalhe-da-viagem]")).toHaveLength(0);
  });
});
