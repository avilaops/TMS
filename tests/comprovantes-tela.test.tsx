// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { ate, clicar, desmontarTudo, montar, porTexto } from "./tela";

/**
 * Tela da fila de comprovantes (`/dashboard/comprovantes`). O dado vem todo de
 * `GET /api/comprovantes`, testado com banco em `tests/comprovantes.test.ts`;
 * aqui se confere o que a tela faz com cada resposta.
 */

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

import ComprovantesPage from "../src/app/dashboard/comprovantes/page";

const comprovante = (extra: Record<string, unknown> = {}) => ({
  id: "pod-1",
  status: "SUBMITTED",
  receiverName: "Maria Souza",
  receiverDoc: "123.456.789-00",
  createdAt: "2026-10-08T15:30:00.000Z",
  reviewedAt: null,
  rejectionReason: null,
  reviewedBy: null,
  collection: {
    id: "coleta-1",
    trackingCode: "MEL-0001",
    receiver: "Loja Centro",
    destination: "Ribeirão Preto/SP",
    client: { tradeName: "Serilon", companyName: "Serilon Brasil Ltda" },
  },
  ...extra,
});

type Resposta = { status?: number; body: unknown } | Error;

/** Cada filtro da tela recebe a resposta que o teste mandar. */
function api(respostas: Record<string, Resposta>) {
  const pedidos: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL) => {
      const caminho = String(url);
      pedidos.push(caminho);
      const resposta = respostas[caminho.replace("/api/comprovantes?status=", "")];
      if (!resposta) throw new Error(`Chamada inesperada: ${caminho}`);
      if (resposta instanceof Error) throw resposta;
      return new Response(typeof resposta.body === "string" ? resposta.body : JSON.stringify(resposta.body), {
        status: resposta.status ?? 200,
      });
    }),
  );
  return pedidos;
}

const filtro = (tela: HTMLElement, rotulo: string) => porTexto(tela, "button", rotulo)[0];

afterEach(async () => {
  await desmontarTudo();
  vi.unstubAllGlobals();
});

describe("tela da fila de comprovantes", () => {
  it("abre nos que aguardam conferência e lista cada um com o atalho para conferir", async () => {
    const pedidos = api({
      SUBMITTED: {
        body: [
          comprovante(),
          comprovante({
            id: "pod-2",
            receiverName: "José Lima",
            collection: {
              id: "coleta-2",
              trackingCode: null,
              receiver: "Depósito",
              destination: "Franca/SP",
              client: { tradeName: null, companyName: "Transportes Lima Ltda" },
            },
          }),
        ],
      },
    });

    const tela = await montar(<ComprovantesPage />);

    await ate(() => expect(tela.querySelectorAll("tbody tr")).toHaveLength(2));
    expect(pedidos).toEqual(["/api/comprovantes?status=SUBMITTED"]);
    expect(filtro(tela, "Aguardando conferência").getAttribute("aria-pressed")).toBe("true");
    expect(filtro(tela, "Aprovado").getAttribute("aria-pressed")).toBe("false");

    const [primeira, segunda] = [...tela.querySelectorAll("tbody tr")];
    expect(primeira.textContent).toContain("Serilon");
    expect(primeira.textContent).not.toContain("Serilon Brasil Ltda");
    expect(primeira.textContent).toContain("Loja Centro · Ribeirão Preto/SP");
    expect(primeira.textContent).toContain("MEL-0001");
    expect(primeira.textContent).toContain("Maria Souza");
    expect(primeira.textContent).toContain("123.456.789-00");
    // Data no horário de Brasília, seja qual for o fuso de quem roda.
    expect(primeira.textContent).toContain("08/10/2026, 12:30:00");
    expect(primeira.textContent).toContain("Aguardando conferência");
    const link = primeira.querySelector("a")!;
    expect(link.textContent).toBe("Conferir");
    expect(link.getAttribute("href")).toBe("/dashboard/entregas/coleta-1/comprovante");

    // Sem nome fantasia, vale a razão social; sem código de rastreio, a linha não inventa um.
    expect(segunda.textContent).toContain("Transportes Lima Ltda");
    expect(segunda.querySelector(".font-mono")).toBeNull();
    expect(segunda.querySelector("a")!.getAttribute("href")).toBe("/dashboard/entregas/coleta-2/comprovante");
  });

  it("enquanto a resposta não chega mostra que está carregando, e não uma fila vazia", async () => {
    let responder: (resposta: Response) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((resolve) => (responder = resolve))),
    );

    const tela = await montar(<ComprovantesPage />);
    expect(tela.textContent).toContain("Carregando comprovantes...");
    expect(tela.textContent).not.toContain("Nenhum comprovante");

    responder(new Response(JSON.stringify([comprovante()])));
    await ate(() => expect(tela.querySelectorAll("tbody tr")).toHaveLength(1));
    expect(tela.textContent).not.toContain("Carregando comprovantes...");
  });

  it("trocar o filtro busca de novo e mostra quem conferiu, quando e o motivo da recusa", async () => {
    const pedidos = api({
      SUBMITTED: { body: [comprovante()] },
      APPROVED: {
        body: [
          comprovante({
            status: "APPROVED",
            reviewedAt: "2026-10-08T18:00:00.000Z",
            reviewedBy: { id: "user-1", name: "Carla Operação" },
          }),
        ],
      },
      REJECTED: {
        body: [
          comprovante({
            status: "REJECTED",
            reviewedAt: "2026-10-08T18:05:00.000Z",
            reviewedBy: null,
            rejectionReason: "Foto ilegível, não dá para ver a mercadoria.",
          }),
        ],
      },
    });
    const tela = await montar(<ComprovantesPage />);
    await ate(() => expect(tela.querySelectorAll("tbody tr")).toHaveLength(1));

    await clicar(filtro(tela, "Aprovado"));
    await ate(() => expect(tela.querySelector("tbody")?.textContent).toContain("Carla Operação · 08/10/2026, 15:00:00"));
    expect(filtro(tela, "Aprovado").getAttribute("aria-pressed")).toBe("true");
    expect(tela.querySelector("tbody a")!.textContent).toBe("Ver comprovante");
    expect(tela.querySelector("tbody")!.textContent).not.toContain("Motivo:");

    await clicar(filtro(tela, "Recusado"));
    await ate(() =>
      expect(tela.querySelector("tbody")?.textContent).toContain("Motivo: Foto ilegível, não dá para ver a mercadoria."),
    );
    // Conferente apagado do cadastro não some com a linha.
    expect(tela.querySelector("tbody")!.textContent).toContain("Usuário removido · 08/10/2026, 15:05:00");
    expect(tela.querySelector("tbody a")!.textContent).toBe("Ver comprovante");

    expect(pedidos).toEqual([
      "/api/comprovantes?status=SUBMITTED",
      "/api/comprovantes?status=APPROVED",
      "/api/comprovantes?status=REJECTED",
    ]);
  });

  it("fila vazia tem a mensagem do filtro escolhido, sem tabela", async () => {
    api({ SUBMITTED: { body: [] }, APPROVED: { body: [] }, REJECTED: { body: [] } });
    const tela = await montar(<ComprovantesPage />);

    await ate(() => expect(tela.textContent).toContain("Nenhum comprovante aguardando conferência."));
    expect(tela.querySelector("table")).toBeNull();

    await clicar(filtro(tela, "Aprovado"));
    await ate(() => expect(tela.textContent).toContain("Nenhum comprovante aprovado."));

    await clicar(filtro(tela, "Recusado"));
    await ate(() => expect(tela.textContent).toContain("Nenhum comprovante recusado."));
  });

  it.each([
    ["recusa do servidor com motivo", { status: 403, body: { error: "Acesso negado." } } as Resposta, "Acesso negado."],
    ["erro do servidor sem motivo", { status: 500, body: {} } as Resposta, "Não foi possível carregar os comprovantes."],
    ["página no lugar do JSON", { status: 502, body: "<html>" } as Resposta, "Não foi possível carregar os comprovantes."],
    ["resposta 200 que não é lista", { body: { itens: [] } } as Resposta, "Não foi possível carregar os comprovantes."],
    ["falha de rede", new TypeError("Failed to fetch") as Resposta, "Não foi possível carregar os comprovantes."],
  ])("%s: mostra o erro, e não uma fila vazia", async (_caso, resposta, mensagem) => {
    api({ SUBMITTED: resposta });
    const tela = await montar(<ComprovantesPage />);

    await ate(() => expect(tela.textContent).toContain(mensagem));
    expect(tela.textContent).not.toContain("Nenhum comprovante");
    expect(tela.querySelector("table")).toBeNull();
  });

  it("depois de um erro, o filtro seguinte carrega normalmente", async () => {
    api({ SUBMITTED: { status: 500, body: {} }, APPROVED: { body: [comprovante({ status: "APPROVED" })] } });
    const tela = await montar(<ComprovantesPage />);
    await ate(() => expect(tela.textContent).toContain("Não foi possível carregar os comprovantes."));

    await clicar(filtro(tela, "Aprovado"));

    await ate(() => expect(tela.querySelectorAll("tbody tr")).toHaveLength(1));
    expect(tela.textContent).not.toContain("Não foi possível carregar os comprovantes.");
  });

  it("situação que a tela não conhece aparece como veio, sem quebrar a linha", async () => {
    api({ SUBMITTED: { body: [comprovante({ status: "EM_ANALISE" })] } });
    const tela = await montar(<ComprovantesPage />);

    await ate(() => expect(tela.querySelector("tbody")?.textContent).toContain("EM_ANALISE"));
    expect(tela.querySelector("tbody a")!.textContent).toBe("Ver comprovante");
  });
});
