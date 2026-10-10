// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { ate, clicar, desmontarTudo, montar, porTexto } from "./tela";
import type { Manifesto } from "../src/app/dashboard/manifestos/carregar";
import type { LinhaDaTela, RespostaDaConciliacao, TituloDaTela } from "../src/lib/conciliacao";
import type { RespostaDoRoteiro } from "../src/lib/roteiro";

/**
 * As duas telas novas: a sugestão de ordem na aba Rota da viagem e a
 * conciliação bancária. As contas e as rotas são testadas em
 * `tests/roteiro.test.ts` e `tests/conciliacao.test.ts`; aqui se confere o que
 * cada tela mostra e o que ela manda para o servidor.
 */

vi.mock("next/link", () => ({
  default: ({ href, children, className, ...resto }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className} {...resto}>
      {children}
    </a>
  ),
}));

import { TelaDaViagem } from "../src/app/dashboard/manifestos/viagem";
import ConciliacaoPage from "../src/app/dashboard/financeiro/conciliacao/page";

type Pedido = { url: string; method: string; body: unknown };

/** Troca o `fetch` por respostas montadas pelo teste e guarda cada pedido feito. */
function api(responder: (pedido: Pedido) => { status?: number; body: unknown } | undefined) {
  const pedidos: Pedido[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const pedido: Pedido = { url: String(url), method: init?.method ?? "GET", body: typeof init?.body === "string" ? JSON.parse(init.body) : (init?.body ?? null) };
      pedidos.push(pedido);
      const resposta = responder(pedido);
      if (!resposta) throw new Error(`Chamada inesperada: ${pedido.method} ${pedido.url}`);
      return new Response(JSON.stringify(resposta.body), { status: resposta.status ?? 200 });
    }),
  );
  return pedidos;
}

afterEach(async () => {
  await desmontarTudo();
  vi.unstubAllGlobals();
});

describe("aba Rota: sugerir ordem", () => {
  const carga = (id: string, destino: string) => ({
    id,
    sender: "Remetente",
    receiver: `Destinatário ${id}`,
    origin: "São José do Rio Preto - SP",
    destination: destino,
    volumes: 1,
    weight: 10,
    client: { tradeName: "Aurora", companyName: "Comercial Aurora Ltda" },
    status: "ROUTE",
    manifestId: "viagem-1",
  });
  const manifesto = (status = "ASSEMBLING"): Manifesto => ({
    id: "viagem-1",
    status,
    createdAt: "2026-10-01T12:00:00.000Z",
    driver: { id: "m1", user: { name: "Ana" }, cpf: "1", active: true },
    vehicle: { id: "v1", plate: "ABC1D23", model: "Caminhão", type: "TRUCK", status: "AVAILABLE" },
    collections: [carga("a", "Votuporanga - SP"), carga("b", "Catanduva - SP"), carga("c", "Lugar Nenhum - SP")],
  });
  const SUGESTAO: RespostaDoRoteiro = {
    ordem: ["b", "a", "c"],
    distanciaAntesKm: 412.3,
    distanciaDepoisKm: 350.1,
    naoLocalizadas: ["c"],
    mudou: true,
    origem: "São José do Rio Preto/SP",
    voltar: true,
    cidades: { a: "Votuporanga/SP", b: "Catanduva/SP", c: null },
  };

  const abrirRota = async (viagem: Manifesto, alteraViagem = true, onChange = () => {}) => {
    const tela = await montar(<TelaDaViagem manifesto={viagem} veAcerto={false} aprovaDespesa={false} alteraViagem={alteraViagem} onClose={() => {}} onChange={onChange} />);
    await clicar(tela.querySelector('[data-aba="Rota"]')!);
    return tela;
  };
  const paradas = (tela: HTMLElement, atributo: string) => [...tela.querySelectorAll(`[${atributo}]`)].map((no) => no.getAttribute(atributo));

  it("mostra a ordem proposta, a distância antes e depois e o aviso de linha reta; Aplicar grava pela rota de ordem", async () => {
    const pedidos = api(({ url, method }) => {
      if (url === "/api/equipe/ajudantes") return { body: [] };
      if (url === "/api/manifestos/viagem-1/roteiro" && method === "POST") return { body: SUGESTAO };
      if (url === "/api/manifestos/viagem-1/ordem" && method === "PUT") return { body: { success: true } };
      return undefined;
    });
    const onChange = vi.fn();
    const tela = await abrirRota(manifesto(), true, onChange);
    expect(paradas(tela, "data-parada")).toEqual(["a", "b", "c"]);

    await clicar(tela.querySelector("[data-sugerir-ordem]")!);
    await ate(() => expect(tela.querySelector("[data-sugestao-de-ordem]")).not.toBeNull());
    expect(pedidos.find((p) => p.url.endsWith("/roteiro"))?.body).toEqual({ voltar: true });

    const texto = tela.querySelector("[data-sugestao-de-ordem]")!.textContent ?? "";
    expect(tela.querySelector("[data-distancias]")!.textContent).toBe("412,3 km hoje → 350,1 km na ordem sugerida");
    expect(texto).toContain("em linha reta, entre centros das cidades");
    expect(texto).toContain("Saindo de São José do Rio Preto/SP.");
    expect(tela.querySelector("[data-sem-localizacao]")!.textContent).toContain("1 entrega sem localização ficou no fim");
    expect(paradas(tela, "data-parada-sugerida")).toEqual(["b", "a", "c"]);
    expect(tela.querySelector('[data-parada-sugerida="c"]')!.textContent).toContain("Lugar Nenhum - SP · sem localização");
    expect(tela.querySelector('[data-parada-sugerida="b"]')!.textContent).toContain("Catanduva/SP");
    // Nada foi gravado até aqui.
    expect(pedidos.some((p) => p.method === "PUT")).toBe(false);

    await clicar(porTexto(tela, "button", "Aplicar")[0]);
    await ate(() => expect(tela.querySelector("[data-sugestao-de-ordem]")).toBeNull());
    expect(pedidos.find((p) => p.method === "PUT")).toMatchObject({ url: "/api/manifestos/viagem-1/ordem", body: { collectionIds: ["b", "a", "c"] } });
    expect(paradas(tela, "data-parada")).toEqual(["b", "a", "c"]);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("Cancelar fecha sem gravar; ordem que já é a melhor não tem o que aplicar", async () => {
    const pedidos = api(({ url }) => {
      if (url === "/api/equipe/ajudantes") return { body: [] };
      if (url.endsWith("/roteiro")) return { body: { ...SUGESTAO, ordem: ["a", "b", "c"], mudou: false, distanciaDepoisKm: 412.3, origem: null } };
      return undefined;
    });
    const tela = await abrirRota(manifesto("ROUTE"));
    await clicar(tela.querySelector("[data-sugerir-ordem]")!);
    await ate(() => expect(tela.querySelector("[data-sugestao-de-ordem]")).not.toBeNull());

    expect(tela.querySelector("[data-distancias]")!.textContent).toContain("A ordem atual já é a mais curta que a conta achou: 412,3 km");
    expect(tela.querySelector("[data-sugestao-de-ordem]")!.textContent).toContain("A origem não foi localizada");
    expect(porTexto(tela, "button", "Aplicar")[0].hasAttribute("disabled")).toBe(true);

    await clicar(porTexto(tela, "button", "Cancelar")[0]);
    expect(tela.querySelector("[data-sugestao-de-ordem]")).toBeNull();
    expect(paradas(tela, "data-parada")).toEqual(["a", "b", "c"]);
    expect(pedidos.some((p) => p.method === "PUT")).toBe(false);
  });

  it("o botão só existe para quem altera a viagem, com ela em montagem ou em rota e mais de uma carga", async () => {
    api(({ url }) => (url === "/api/equipe/ajudantes" ? { body: [] } : undefined));
    expect((await abrirRota(manifesto())).querySelector("[data-sugerir-ordem]")).not.toBeNull();
    expect((await abrirRota(manifesto(), false)).querySelector("[data-sugerir-ordem]")).toBeNull();
    expect((await abrirRota(manifesto("FINISHED"))).querySelector("[data-sugerir-ordem]")).toBeNull();
    const umaCarga = { ...manifesto(), collections: [carga("a", "Mirassol - SP")] };
    expect((await abrirRota(umaCarga)).querySelector("[data-sugerir-ordem]")).toBeNull();
  });

  it("erro do servidor aparece na tela e a lista continua como estava", async () => {
    api(({ url }) => {
      if (url === "/api/equipe/ajudantes") return { body: [] };
      if (url.endsWith("/roteiro")) return { status: 409, body: { error: "Só dá para ordenar as entregas de viagem em montagem ou em rota." } };
      return undefined;
    });
    const tela = await abrirRota(manifesto());
    await clicar(tela.querySelector("[data-sugerir-ordem]")!);
    await ate(() => expect(tela.querySelector('[role="alert"]')?.textContent).toContain("em montagem ou em rota"));
    expect(tela.querySelector("[data-sugestao-de-ordem]")).toBeNull();
  });
});

describe("tela da conciliação bancária", () => {
  const titulo = (extra: Partial<TituloDaTela> = {}): TituloDaTela => ({
    id: "t1",
    type: "INCOME",
    amount: 1500,
    description: "Fatura nº 123 (2 cargas)",
    dueDate: "2026-10-06T00:00:00.000Z",
    status: "PENDING",
    paidAt: null,
    paidAmount: null,
    counterparty: null,
    client: { companyName: "Comercial Aurora Ltda", tradeName: "Aurora" },
    invoiceId: "f1",
    invoice: { id: "f1", number: 123 },
    ...extra,
  });
  const linha = (extra: Partial<LinhaDaTela> = {}): LinhaDaTela => ({
    id: "l1",
    bankId: "0341",
    account: "••••45-6",
    postedAt: "2026-10-05T00:00:00.000Z",
    amount: 1500,
    kind: "CREDIT",
    description: "PIX RECEBIDO FAT000123 AURORA",
    status: "PENDING",
    settled: false,
    transaction: null,
    candidatos: [{ id: "t1", pontos: 120, forte: true, diferenca: 0, motivos: ["valor igual", "vence a 1 dia", "txid do Pix (FAT000123)"], titulo: titulo() }],
    certeiro: "t1",
    ...extra,
  });
  const resposta = (linhas: LinhaDaTela[], contagem = { pendentes: linhas.length, conciliadas: 0, ignoradas: 0 }): RespostaDaConciliacao => ({
    linhas,
    contagem,
    certeiros: linhas.filter((l) => l.certeiro).length,
  });
  const LISTA = "/api/financeiro/conciliacao?situacao=";

  it("mostra cada linha pendente com o lançamento sugerido e o motivo; Conciliar manda a ação e recarrega", async () => {
    const tarifa = linha({ id: "l2", amount: -45.9, description: "TARIFA PACOTE", candidatos: [], certeiro: null });
    let conciliou = false;
    const pedidos = api(({ url, method }) => {
      if (url === `${LISTA}pendentes`) return { body: conciliou ? resposta([tarifa], { pendentes: 1, conciliadas: 1, ignoradas: 0 }) : resposta([linha(), tarifa]) };
      if (url === "/api/financeiro/conciliacao/l1" && method === "PATCH") {
        conciliou = true;
        return { body: { id: "l1", action: "conciliar", baixou: true } };
      }
      return undefined;
    });

    const tela = await montar(<ConciliacaoPage />);
    await ate(() => expect(tela.querySelectorAll("[data-linha]")).toHaveLength(2));

    const primeira = tela.querySelector('[data-linha="l1"]')!;
    expect(primeira.textContent).toContain("PIX RECEBIDO FAT000123 AURORA");
    expect(primeira.textContent).toContain("05/10/2026 · conta ••••45-6");
    expect(primeira.textContent).toMatch(/\+ R\$\s1\.500,00/);
    const sugestao = primeira.querySelector('[data-sugestao="t1"]')!;
    expect(sugestao.textContent).toContain("Certeiro ·");
    expect(sugestao.textContent).toContain("Fatura nº 123 (2 cargas)");
    expect(sugestao.textContent).toContain("Aurora");
    expect(sugestao.textContent).toContain("vence 06/10/2026");
    expect(sugestao.textContent).toContain("valor igual, vence a 1 dia, txid do Pix (FAT000123)");

    // Débito sem par: sem sugestão, e o Conciliar fica desligado.
    const segunda = tela.querySelector('[data-linha="l2"]')!;
    expect(segunda.textContent).toMatch(/− R\$\s45,90/);
    expect(segunda.textContent).toContain("Nenhum lançamento parecido");
    expect(segunda.querySelector('[data-acao="conciliar"]')!.hasAttribute("disabled")).toBe(true);
    expect(segunda.querySelector('[data-acao="criar"]')!.hasAttribute("disabled")).toBe(false);

    expect(tela.querySelector("[data-conciliar-certeiros]")!.textContent).toContain("Certeiros (1)");
    expect(tela.querySelector('[data-filtro="pendentes"]')!.textContent).toBe("Pendentes (2)");

    await clicar(primeira.querySelector('[data-acao="conciliar"]')!);
    await ate(() => expect(tela.querySelectorAll("[data-linha]")).toHaveLength(1));
    expect(pedidos.find((p) => p.method === "PATCH")).toMatchObject({ url: "/api/financeiro/conciliacao/l1", body: { action: "conciliar", transactionId: "t1" } });
    expect(tela.querySelector('[role="status"]')!.textContent).toBe("Linha conciliada.");
    expect(tela.querySelector("[data-conciliar-certeiros]")).toBeNull();
    expect(tela.querySelector('[data-filtro="conciliadas"]')!.textContent).toBe("Conciliadas (1)");
  });

  it("valor diferente avisa que a diferença entra como juros; Ignorar, Criar e o lote mandam o que devem", async () => {
    const comJuros = linha({
      amount: 1523,
      certeiro: null,
      candidatos: [{ id: "t1", pontos: 40, forte: false, diferenca: 23, motivos: ["txid do Pix (FAT000123)", "valor difere em R$ 23,00 (a mais)"], titulo: titulo() }],
    });
    const tarifa = linha({ id: "l2", amount: -45.9, description: "TARIFA PACOTE", candidatos: [], certeiro: null });
    const pedidos = api(({ url, method }) => {
      if (url === `${LISTA}pendentes`) return { body: resposta([comJuros, tarifa, linha({ id: "l3" })]) };
      if (method === "PATCH") return { body: {} };
      if (url === "/api/financeiro/conciliacao/certeiros") return { body: { conciliadas: 1, falhas: [] } };
      return undefined;
    });
    const tela = await montar(<ConciliacaoPage />);
    await ate(() => expect(tela.querySelectorAll("[data-linha]")).toHaveLength(3));

    expect(tela.querySelector('[data-linha="l1"]')!.textContent).toContain("Ao conciliar, a diferença entra na baixa como juros.");
    expect(tela.querySelector('[data-linha="l1"]')!.textContent).not.toContain("Certeiro ·");

    await clicar(tela.querySelector('[data-linha="l2"] [data-acao="ignorar"]')!);
    await ate(() => expect(pedidos.filter((p) => p.method === "PATCH")).toHaveLength(1));
    expect(pedidos.find((p) => p.method === "PATCH")).toMatchObject({ url: "/api/financeiro/conciliacao/l2", body: { action: "ignorar" } });

    // Criar abre a tela do lançamento com a descrição do extrato e manda a categoria digitada.
    await clicar(tela.querySelector('[data-linha="l2"] [data-acao="criar"]')!);
    const janela = tela.querySelector('[role="dialog"]')!;
    expect(janela.getAttribute("aria-label")).toBe("Criar lançamento");
    expect((janela.querySelector('input[name="description"]') as HTMLInputElement).value).toBe("TARIFA PACOTE");
    expect(janela.textContent).toContain("Nasce como despesa paga em 05/10/2026");
    await clicar(porTexto(janela, "button", "Criar e conciliar")[0]);
    await ate(() => expect(tela.querySelector('[role="dialog"]')).toBeNull());
    expect(pedidos.filter((p) => p.method === "PATCH")[1]).toMatchObject({ url: "/api/financeiro/conciliacao/l2", body: { action: "criar", description: "TARIFA PACOTE", category: "" } });

    await clicar(tela.querySelector("[data-conciliar-certeiros]")!);
    await ate(() => expect(tela.querySelector('[role="status"]')?.textContent).toBe("1 linha conciliada."));
    expect(pedidos.some((p) => p.url === "/api/financeiro/conciliacao/certeiros" && p.method === "POST")).toBe(true);
  });

  it("Escolher outro lista os lançamentos do mesmo lado, com busca, e concilia com o escolhido", async () => {
    const semPar = linha({ candidatos: [], certeiro: null });
    const pedidos = api(({ url, method }) => {
      if (url === `${LISTA}pendentes`) return { body: resposta([semPar]) };
      if (url === "/api/financeiro?tipo=INCOME") {
        return { body: [titulo({ id: "t9", description: "Frete avulso Boreal", amount: 900, client: null, counterparty: "Boreal", invoice: null, invoiceId: null }), titulo()] };
      }
      if (method === "PATCH") return { body: {} };
      return undefined;
    });
    const tela = await montar(<ConciliacaoPage />);
    await ate(() => expect(tela.querySelectorAll("[data-linha]")).toHaveLength(1));

    await clicar(tela.querySelector('[data-acao="outro"]')!);
    await ate(() => expect(tela.querySelectorAll("[data-outro]")).toHaveLength(2));
    // O de valor mais perto do extrato vem primeiro.
    expect([...tela.querySelectorAll("[data-outro]")].map((no) => no.getAttribute("data-outro"))).toEqual(["t1", "t9"]);

    await clicar(tela.querySelector('[data-outro="t9"]')!);
    await ate(() => expect(tela.querySelector('[role="dialog"]')).toBeNull());
    expect(pedidos.find((p) => p.method === "PATCH")).toMatchObject({ url: "/api/financeiro/conciliacao/l1", body: { action: "conciliar", transactionId: "t9" } });
  });

  it("conciliada mostra o lançamento e o Desfazer; a aba troca o filtro pedido", async () => {
    const conciliada = linha({ status: "RECONCILED", settled: true, transaction: titulo({ status: "PAID" }), candidatos: [], certeiro: null });
    const pedidos = api(({ url, method }) => {
      if (url === `${LISTA}pendentes`) return { body: resposta([], { pendentes: 0, conciliadas: 1, ignoradas: 0 }) };
      if (url === `${LISTA}conciliadas`) return { body: resposta([conciliada], { pendentes: 0, conciliadas: 1, ignoradas: 0 }) };
      if (method === "PATCH") return { body: { reabriu: true } };
      return undefined;
    });
    const tela = await montar(<ConciliacaoPage />);
    await ate(() => expect(tela.querySelector("[data-lista-vazia]")?.textContent).toContain("Nada pendente"));

    await clicar(tela.querySelector('[data-filtro="conciliadas"]')!);
    await ate(() => expect(tela.querySelectorAll("[data-linha]")).toHaveLength(1));
    const cartao = tela.querySelector('[data-linha="l1"]')!;
    expect(cartao.textContent).toContain("Fatura nº 123 (2 cargas)");
    expect(cartao.textContent).toContain("baixa pela conciliação");
    expect(cartao.querySelector('[data-acao="conciliar"]')).toBeNull();

    await clicar(cartao.querySelector('[data-acao="desfazer"]')!);
    await ate(() => expect(pedidos.some((p) => p.method === "PATCH")).toBe(true));
    expect(pedidos.find((p) => p.method === "PATCH")).toMatchObject({ url: "/api/financeiro/conciliacao/l1", body: { action: "desfazer" } });
  });

  it("sem extrato nenhum explica como exportar; erro do servidor aparece; 401 e 403 têm aviso próprio", async () => {
    api(({ url }) => (url === `${LISTA}pendentes` ? { body: resposta([]) } : undefined));
    const vazia = await montar(<ConciliacaoPage />);
    await ate(() => expect(vazia.querySelector("[data-lista-vazia]")?.textContent).toContain("exporte o extrato em OFX"));
    expect(porTexto(vazia, "button", "Enviar OFX")).toHaveLength(1);
    expect(vazia.querySelector('a[href="/dashboard/financeiro"]')).not.toBeNull();
    await desmontarTudo();

    api(() => ({ status: 403, body: { error: "Acesso negado" } }));
    const negada = await montar(<ConciliacaoPage />);
    await ate(() => expect(negada.textContent).toContain("Acesso negado"));
    expect(negada.querySelector("[data-arquivo-ofx]")).toBeNull();
    await desmontarTudo();

    api(() => ({ status: 401, body: { error: "Não autorizado" } }));
    const expirada = await montar(<ConciliacaoPage />);
    await ate(() => expect(expirada.textContent).toContain("Sessão expirada"));
    expect(expirada.querySelector('a[href="/login"]')).not.toBeNull();
  });
});
