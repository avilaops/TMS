// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { ate, clicar, desmontarTudo, montar, porTexto } from "./tela";
import type { LinhaDeAuditoria } from "../src/lib/auditoria";
import { TENTATIVAS, type Aviso } from "../src/lib/mensageria";

/**
 * Telas de Auditoria (`/dashboard/auditoria`) e de Mensageria
 * (`/dashboard/mensagens`). As regras e as rotas são testadas em
 * `tests/auditoria.test.ts` e `tests/mensageria.test.ts`; aqui se confere o que
 * cada tela mostra com cada resposta e o que ela pede ao servidor.
 */

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

import AuditoriaPage from "../src/app/dashboard/auditoria/page";
import MensagensPage from "../src/app/dashboard/mensagens/page";

type Resposta = { status?: number; body: unknown };
type Pedido = { url: string; method: string };

/** Troca o `fetch` por respostas combinadas; devolve os pedidos feitos, na ordem. */
function api(responder: (pedido: Pedido) => Resposta | undefined) {
  const pedidos: Pedido[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const pedido = { url: String(url), method: init?.method ?? "GET" };
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

const linha = (parcial: Partial<LinhaDeAuditoria>): LinhaDeAuditoria => ({
  id: "l1",
  createdAt: "2026-10-09T18:30:00.000Z",
  userId: "u1",
  userName: "Ana Admin",
  userRole: "ADMIN",
  action: "fatura.pagar",
  entity: "fatura",
  entityId: "f-123",
  summary: "Fatura nº 12 paga",
  before: { status: "OPEN", paidAt: null },
  after: { status: "PAID", paidAt: "2026-10-09T18:30:00.000Z" },
  ip: "203.0.113.7",
  device: "Safari no iPhone",
  ...parcial,
});

describe("tela de auditoria", () => {
  const usuarios = { body: [{ id: "u1", name: "Ana Admin" }] };

  it("lista quem, quando, ação e resumo; abrir a linha mostra o antes e o depois lado a lado, o IP e o dispositivo", async () => {
    api(({ url }) => (url === "/api/usuarios" ? usuarios : url === "/api/auditoria?" ? { body: { registros: [linha({})], proximo: null } } : undefined));
    const tela = await montar(<AuditoriaPage />);
    await ate(() => expect(tela.querySelector('[data-linha="l1"]')).not.toBeNull());

    const texto = tela.querySelector('[data-linha="l1"]')?.textContent ?? "";
    expect(texto).toContain("Ana Admin");
    expect(texto).toContain("Fatura paga");
    expect(texto).toContain("Fatura nº 12 paga");
    expect(texto).toMatch(/09\/10\/2026.*15:30/);
    expect(tela.querySelector("[data-detalhe]")).toBeNull();

    await clicar(tela.querySelector('[data-linha="l1"]')!);
    const detalhe = tela.querySelector('[data-detalhe="l1"]');
    expect(detalhe?.textContent).toContain("203.0.113.7");
    expect(detalhe?.textContent).toContain("Safari no iPhone");
    expect(detalhe?.textContent).toContain("f-123");
    const status = [...(detalhe?.querySelectorAll('[data-campo="status"] td') ?? [])].map((td) => td.textContent);
    expect(status).toEqual(["Status", "OPEN", "PAID"]);
    const pagoEm = [...(detalhe?.querySelectorAll('[data-campo="paidAt"] td') ?? [])].map((td) => td.textContent);
    expect(pagoEm[0]).toBe("Pago em");
    expect(pagoEm[1]).toBe("(vazio)");

    // Clicar de novo fecha.
    await clicar(tela.querySelector('[data-linha="l1"]')!);
    expect(tela.querySelector("[data-detalhe]")).toBeNull();
  });

  it("carrega a página seguinte pelo cursor e junta na lista, sem pedir tudo de uma vez", async () => {
    const pedidos = api(({ url }) => {
      if (url === "/api/usuarios") return usuarios;
      if (url === "/api/auditoria?") return { body: { registros: [linha({ id: "l1" })], proximo: "l1" } };
      if (url === "/api/auditoria?cursor=l1") return { body: { registros: [linha({ id: "l2", summary: "Mais antiga" })], proximo: null } };
      return undefined;
    });
    const tela = await montar(<AuditoriaPage />);
    await ate(() => expect(porTexto(tela, "button", "Carregar mais").length).toBe(1));

    await clicar(porTexto(tela, "button", "Carregar mais")[0]);
    await ate(() => expect(tela.querySelectorAll("[data-linha]").length).toBe(2));
    expect(porTexto(tela, "button", "Carregar mais")).toEqual([]);
    expect(pedidos.filter((p) => p.url.startsWith("/api/auditoria")).map((p) => p.url)).toEqual(["/api/auditoria?", "/api/auditoria?cursor=l1"]);
  });

  it("sem linha nenhuma diz isso; erro do servidor aparece como alerta", async () => {
    api(({ url }) => (url === "/api/usuarios" ? usuarios : { body: { registros: [], proximo: null } }));
    const vazia = await montar(<AuditoriaPage />);
    await ate(() => expect(vazia.textContent).toContain("Nenhuma ação registrada ainda."));
    await desmontarTudo();

    api(({ url }) => (url === "/api/usuarios" ? usuarios : { status: 400, body: { error: "Data inválida. Use AAAA-MM-DD." } }));
    const comErro = await montar(<AuditoriaPage />);
    await ate(() => expect(comErro.querySelector('[role="alert"]')?.textContent).toContain("Data inválida"));
  });

  it("403 mostra acesso negado; 401 manda entrar de novo", async () => {
    api(({ url }) => (url === "/api/usuarios" ? { status: 403, body: {} } : { status: 403, body: { error: "Acesso negado" } }));
    const negada = await montar(<AuditoriaPage />);
    await ate(() => expect(negada.textContent).toContain("Acesso negado"));
    expect(negada.textContent).toContain("Seu perfil não tem acesso a esta área.");
    expect(negada.querySelector("table")).toBeNull();
    await desmontarTudo();

    api(() => ({ status: 401, body: { error: "Não autorizado" } }));
    const semSessao = await montar(<AuditoriaPage />);
    await ate(() => expect(semSessao.textContent).toContain("Sessão expirada"));
    expect(semSessao.querySelector('a[href="/login"]')).not.toBeNull();
  });
});

const aviso = (parcial: Partial<Aviso>): Aviso => ({
  id: "a1",
  type: "coleta.status",
  createdAt: "2026-10-09T18:30:00.000Z",
  deliveredAt: null,
  attempts: 0,
  lastError: null,
  nextAttemptAt: "2026-10-09T18:30:00.000Z",
  ...parcial,
});

describe("tela de mensageria", () => {
  const AVISOS = [
    aviso({ id: "entregue", type: "fatura.emitida", deliveredAt: "2026-10-09T18:31:00.000Z", attempts: 1 }),
    aviso({ id: "fila", type: "coleta.status" }),
    aviso({ id: "falhou", type: "ocorrencia.aberta", attempts: 2, lastError: "Resposta 500", nextAttemptAt: "2026-10-09T18:40:00.000Z" }),
    aviso({ id: "desistiu", type: "cobranca.vencida", attempts: TENTATIVAS, lastError: "Sem resposta no tempo limite." }),
  ];

  it("mostra cada aviso com o rótulo do tipo e a situação de verdade, sem nada fictício", async () => {
    api(() => ({ body: { integracao: { url: "https://n8n.exemplo.com/webhook/tms" }, eventos: AVISOS, proximo: null } }));
    const tela = await montar(<MensagensPage />);
    await ate(() => expect(tela.querySelectorAll("[data-aviso]").length).toBe(4));

    const linhaDe = (id: string) => tela.querySelector(`[data-aviso="${id}"]`)!;
    expect(linhaDe("entregue").textContent).toContain("Fatura emitida");
    expect(linhaDe("entregue").textContent).toMatch(/Entregue em 09\/10\/2026.*15:31/);
    expect(linhaDe("fila").textContent).toContain("Carga mudou de status");
    expect(linhaDe("fila").textContent).toContain("Na fila");
    expect(linhaDe("falhou").textContent).toContain("Chamado aberto");
    expect(linhaDe("falhou").textContent).toContain(`Falhou (tentativa 2 de ${TENTATIVAS}): Resposta 500`);
    expect(linhaDe("falhou").textContent).toContain("Próxima tentativa");
    expect(linhaDe("desistiu").textContent).toContain("Título vencido");
    expect(linhaDe("desistiu").textContent).toContain(`Desistiu depois de ${TENTATIVAS} tentativas: Sem resposta no tempo limite.`);

    // "Tentar de novo" só no que falhou e no que desistiu.
    expect([...tela.querySelectorAll("[data-aviso]")].filter((tr) => porTexto(tr, "button", "Tentar de novo").length > 0).map((tr) => tr.getAttribute("data-aviso"))).toEqual(["falhou", "desistiu"]);
    // Com endereço cadastrado não há aviso de falta dele.
    expect(tela.querySelector("[data-sem-endereco]")).toBeNull();
    // A tela antiga mostrava mensagens inventadas: nada disso sobrou.
    expect(tela.textContent).not.toMatch(/João Motorista|Tech Corp|Indústrias Acme|Lida|SMS/);
  });

  it("sem endereço de integração a tela explica e aponta para Empresa → Integração", async () => {
    api(() => ({ body: { integracao: { url: null }, eventos: [], proximo: null } }));
    const tela = await montar(<MensagensPage />);
    await ate(() => expect(tela.querySelector("[data-sem-endereco]")).not.toBeNull());

    const caixa = tela.querySelector("[data-sem-endereco]")!;
    expect(caixa.textContent).toContain("Nenhum endereço de integração cadastrado");
    expect(caixa.querySelector('a[href="/dashboard/empresa"]')?.textContent).toContain("Empresa → Integração");
    expect(tela.textContent).toContain("Nenhum aviso gerado ainda.");
  });

  it("tentar de novo chama a rota do aviso e a linha volta para a fila no lugar", async () => {
    const pedidos = api(({ url, method }) => {
      if (method === "POST" && url === "/api/eventos/falhou/reenviar") return { body: aviso({ id: "falhou", type: "ocorrencia.aberta" }) };
      if (method === "GET") return { body: { integracao: { url: "https://n8n.exemplo.com/x" }, eventos: AVISOS, proximo: null } };
      return undefined;
    });
    const tela = await montar(<MensagensPage />);
    await ate(() => expect(tela.querySelectorAll("[data-aviso]").length).toBe(4));

    await clicar(porTexto(tela.querySelector('[data-aviso="falhou"]')!, "button", "Tentar de novo")[0]);
    await ate(() => expect(tela.querySelector('[data-aviso="falhou"]')?.getAttribute("data-situacao")).toBe("fila"));
    expect(pedidos.filter((p) => p.method === "POST")).toEqual([{ url: "/api/eventos/falhou/reenviar", method: "POST" }]);
    expect(tela.querySelector('[role="status"]')?.textContent).toContain("devolvido à fila");
    expect(porTexto(tela.querySelector('[data-aviso="falhou"]')!, "button", "Tentar de novo")).toEqual([]);
  });

  it("recusa do servidor ao tentar de novo aparece como alerta, e a linha fica como estava", async () => {
    api(({ method }) =>
      method === "POST"
        ? { status: 409, body: { error: "Só aviso que falhou pode ser tentado de novo." } }
        : { body: { integracao: { url: "https://n8n.exemplo.com/x" }, eventos: AVISOS, proximo: null } },
    );
    const tela = await montar(<MensagensPage />);
    await ate(() => expect(tela.querySelectorAll("[data-aviso]").length).toBe(4));

    await clicar(porTexto(tela.querySelector('[data-aviso="desistiu"]')!, "button", "Tentar de novo")[0]);
    await ate(() => expect(tela.querySelector('[role="alert"]')?.textContent).toContain("Só aviso que falhou"));
    expect(tela.querySelector('[data-aviso="desistiu"]')?.getAttribute("data-situacao")).toBe("desistiu");
  });

  it("filtrar pede a lista de novo com o tipo e a situação; 403 mostra acesso negado", async () => {
    const pedidos = api(() => ({ body: { integracao: { url: "https://n8n.exemplo.com/x" }, eventos: AVISOS, proximo: null } }));
    const tela = await montar(<MensagensPage />);
    await ate(() => expect(tela.querySelectorAll("[data-aviso]").length).toBe(4));

    const [tipo, situacao] = [...tela.querySelectorAll("select")];
    // Todo tipo que o sistema gera está no filtro.
    expect([...tipo.querySelectorAll("option")].map((o) => o.getAttribute("value"))).toEqual(
      ["", "coleta.status", "fatura.emitida", "fatura.paga", "fatura.reaberta", "fatura.cancelada", "cobranca.vencida", "ocorrencia.aberta", "ocorrencia.status", "cte.autorizado", "cte.cancelado", "mdfe.autorizado", "mdfe.encerrado", "mdfe.cancelado", "teste"],
    );
    const escolher = async (campo: HTMLSelectElement, valor: string) => {
      const { act } = await import("react");
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(campo, valor);
        campo.dispatchEvent(new Event("change", { bubbles: true }));
      });
    };
    await escolher(tipo, "ocorrencia.aberta");
    await escolher(situacao, "falhou");
    await ate(() => expect(pedidos.map((p) => p.url)).toContain("/api/eventos?tipo=ocorrencia.aberta&situacao=falhou"));
    await desmontarTudo();

    api(() => ({ status: 403, body: { error: "Acesso negado" } }));
    const negada = await montar(<MensagensPage />);
    await ate(() => expect(negada.textContent).toContain("Seu perfil não tem acesso a esta área."));
  });
});
