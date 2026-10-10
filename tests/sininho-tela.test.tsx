// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MENSAGEM_DO_PUSH, PERMISSAO_NEGADA, esquecerAparelhoAoSair } from "../src/lib/push-cliente";
import { ate, clicar, desmontarTudo, montar, porTexto } from "./tela";

/**
 * O sininho montado de verdade, sem banco: sessão, rede e navegador trocados.
 * O que se confere aqui é o que a pessoa vê e o que a tela pede ao servidor.
 */

type Sessao = { data: { user: { id: string } } | null; status: "authenticated" | "unauthenticated" | "loading" };

const estado = vi.hoisted(() => ({ sessao: { data: null, status: "unauthenticated" } as Sessao }));

vi.mock("next-auth/react", () => ({ useSession: () => estado.sessao }));
// O link de verdade navegaria; aqui ele só avisa a tela do toque.
vi.mock("next/link", () => ({
  default: ({ href, children, onClick, ...resto }: { href: string; children: React.ReactNode; onClick?: () => void }) => (
    <a
      href={href}
      {...resto}
      onClick={(evento) => {
        evento.preventDefault();
        onClick?.();
      }}
    >
      {children}
    </a>
  ),
}));

import { Avisos, Sininho } from "../src/components/notificacoes/Sininho";

const ANA = "user-ana";
const CHAVE = Buffer.alloc(65, 4).toString("base64url");
const ENDERECO = "https://fcm.googleapis.com/fcm/send/aparelho-da-ana";

const aviso = (id: string, lido = false) => ({
  id,
  type: "chamado.novo",
  title: `Chamado ${id}`,
  body: `Texto do aviso ${id}`,
  url: `/dashboard/ocorrencias/${id}`,
  createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  readAt: lido ? new Date().toISOString() : null,
});

type Pedido = { caminho: string; metodo: string; corpo: unknown };

/** Rede do teste: a lista, a chave do push e as gravações respondem o que o teste mandar. */
function rede(config: { avisos?: ReturnType<typeof aviso>[]; naoLidos?: number; proximo?: string | null; chave?: string | null; antigos?: ReturnType<typeof aviso>[] } = {}) {
  const pedidos: Pedido[] = [];
  let naoLidos = config.naoLidos ?? (config.avisos ?? []).filter((a) => !a.readAt).length;
  const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status });
  const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const caminho = String(url);
    const metodo = init?.method ?? "GET";
    const corpo = init?.body ? JSON.parse(String(init.body)) : undefined;
    pedidos.push({ caminho, metodo, corpo });
    if (caminho === "/api/notificacoes") return json({ avisos: config.avisos ?? [], naoLidos, proximo: config.proximo ?? null });
    if (caminho.startsWith("/api/notificacoes?cursor=")) return json({ avisos: config.antigos ?? [], naoLidos, proximo: null });
    if (caminho === "/api/notificacoes/chave") return json({ ativo: Boolean(config.chave), chave: config.chave ?? null });
    if (caminho === "/api/notificacoes/lidas") {
      naoLidos = "todas" in (corpo as object) ? 0 : Math.max(0, naoLidos - (corpo as { ids: string[] }).ids.length);
      return json({ marcados: 1, naoLidos });
    }
    if (caminho === "/api/notificacoes/aparelho") return json({ ativo: metodo === "POST" }, metodo === "POST" ? 201 : 200);
    throw new Error(`Chamada inesperada: ${caminho}`);
  });
  vi.stubGlobal("fetch", fetcher);
  const de = (caminho: string, metodo = "GET") => pedidos.filter((pedido) => pedido.caminho === caminho && pedido.metodo === metodo);
  return { pedidos, de };
}

/** Um navegador que sabe receber push: service worker, PushManager e a permissão de notificação. */
function navegadorComPush(config: { permissao?: NotificationPermission; resposta?: NotificationPermission; jaInscrito?: boolean } = {}) {
  const inscricao = {
    endpoint: ENDERECO,
    toJSON: () => ({ endpoint: ENDERECO, expirationTime: null, keys: { p256dh: "BChave", auth: "segredo" } }),
    unsubscribe: vi.fn(async () => {
      atual = null;
      return true;
    }),
  };
  let atual: typeof inscricao | null = config.jaInscrito ? inscricao : null;
  const registro = {
    scope: `${window.location.origin}/dashboard`,
    active: {},
    pushManager: {
      subscribe: vi.fn(async () => {
        atual = inscricao;
        return inscricao;
      }),
      getSubscription: vi.fn(async () => atual),
    },
  };
  let registrado = Boolean(config.jaInscrito);
  const serviceWorker = {
    register: vi.fn(async () => {
      registrado = true;
      return registro;
    }),
    getRegistrations: vi.fn(async () => (registrado ? [registro] : [])),
  };
  Object.defineProperty(window.navigator, "serviceWorker", { configurable: true, value: serviceWorker });
  vi.stubGlobal("PushManager", function PushManager() {});
  const notificacao = {
    permission: config.permissao ?? "default",
    requestPermission: vi.fn(async () => {
      notificacao.permission = config.resposta ?? "granted";
      return notificacao.permission;
    }),
  };
  vi.stubGlobal("Notification", notificacao);
  return { inscricao, registro, serviceWorker, notificacao };
}

const tela = () =>
  montar(
    <Avisos area="dashboard">
      {/* Dois botões, como no painel: o do cabeçalho do celular e o do computador. */}
      <Sininho />
      <Sininho className="outro" />
    </Avisos>,
  );

const sininhos = (container: ParentNode) => [...container.querySelectorAll<HTMLButtonElement>("[data-sininho]")];
const lista = () => document.querySelector<HTMLElement>('[role="dialog"][aria-label="Avisos"]');

beforeEach(() => {
  localStorage.clear();
  estado.sessao = { data: { user: { id: ANA } }, status: "authenticated" };
});

afterEach(async () => {
  await desmontarTudo();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (window.navigator as unknown as Record<string, unknown>).serviceWorker;
});

describe("sininho", () => {
  it("mostra o número de não lidos nos dois botões com uma consulta só", async () => {
    const { de } = rede({ avisos: [aviso("1"), aviso("2"), aviso("3", true)] });
    const container = await tela();

    await ate(() => expect(sininhos(container).map((botao) => botao.textContent)).toEqual(["2", "2"]));
    expect(sininhos(container)[0].getAttribute("aria-label")).toBe("Avisos: 2 não lidos");
    expect(de("/api/notificacoes")).toHaveLength(1);
    expect(lista()).toBeNull();
    // O painel vira app na Tela de Início: é o que o iPhone exige para o push.
    expect(document.querySelector('link[rel="manifest"]')?.getAttribute("href")).toBe("/painel.webmanifest");
  });

  it("sem sessão não consulta nada e não mostra número", async () => {
    estado.sessao = { data: null, status: "unauthenticated" };
    const { pedidos } = rede();
    const container = await tela();
    expect(sininhos(container).map((botao) => botao.textContent)).toEqual(["", ""]);
    expect(sininhos(container)[0].getAttribute("aria-label")).toBe("Avisos");
    expect(pedidos).toEqual([]);
  });

  it("rede fora (app do motorista offline) não quebra a tela", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    const container = await tela();
    await clicar(sininhos(container)[0]);
    await ate(() => expect(lista()?.textContent).toContain("Nenhum aviso por enquanto."));
  });

  it("abrir consulta de novo e lista título, texto e há quanto tempo; fechar tira a lista", async () => {
    const { de } = rede({ avisos: [aviso("1"), aviso("2", true)] });
    const container = await tela();
    await ate(() => expect(sininhos(container)[0].textContent).toBe("1"));

    await clicar(sininhos(container)[0]);
    await ate(() => expect(de("/api/notificacoes")).toHaveLength(2));
    const itens = [...lista()!.querySelectorAll<HTMLAnchorElement>("[data-avisos] a")];
    expect(itens.map((item) => [item.getAttribute("href"), item.dataset.lido])).toEqual([
      ["/dashboard/ocorrencias/1", "nao"],
      ["/dashboard/ocorrencias/2", "sim"],
    ]);
    expect(itens[0].textContent).toContain("Chamado 1");
    expect(itens[0].textContent).toContain("Texto do aviso 1");
    expect(itens[0].textContent).toContain("há 5 min");
    expect(sininhos(container)[0].getAttribute("aria-expanded")).toBe("true");

    await clicar(lista()!.querySelector('[aria-label="Fechar avisos"]')!);
    expect(lista()).toBeNull();

    // O fundo também fecha.
    await clicar(sininhos(container)[1]);
    await ate(() => expect(lista()).not.toBeNull());
    await clicar(document.querySelector("[data-avisos-fundo]")!);
    expect(lista()).toBeNull();
  });

  it("tocar num aviso marca como lido, baixa o número e fecha a lista", async () => {
    const { de } = rede({ avisos: [aviso("1"), aviso("2")] });
    const container = await tela();
    await clicar(sininhos(container)[0]);
    await ate(() => expect(lista()?.querySelectorAll("[data-avisos] a")).toHaveLength(2));

    await clicar(lista()!.querySelector('a[href="/dashboard/ocorrencias/2"]')!);
    expect(lista()).toBeNull();
    await ate(() => expect(de("/api/notificacoes/lidas", "POST").map((pedido) => pedido.corpo)).toEqual([{ ids: ["2"] }]));
    await ate(() => expect(sininhos(container)[0].textContent).toBe("1"));
  });

  it("aviso já lido abre sem pedir nada ao servidor", async () => {
    const { de } = rede({ avisos: [aviso("1", true)] });
    const container = await tela();
    await clicar(sininhos(container)[0]);
    await ate(() => expect(lista()?.querySelectorAll("[data-avisos] a")).toHaveLength(1));
    await clicar(lista()!.querySelector("[data-avisos] a")!);
    expect(lista()).toBeNull();
    expect(de("/api/notificacoes/lidas", "POST")).toEqual([]);
  });

  it("marcar tudo como lido zera o número e some com o botão", async () => {
    const { de } = rede({ avisos: [aviso("1"), aviso("2")] });
    const container = await tela();
    await clicar(sininhos(container)[0]);
    await ate(() => expect(porTexto(lista()!, "button", "Marcar tudo como lido")).toHaveLength(1));

    await clicar(porTexto(lista()!, "button", "Marcar tudo como lido")[0]);
    await ate(() => expect(de("/api/notificacoes/lidas", "POST").map((pedido) => pedido.corpo)).toEqual([{ todas: true }]));
    expect(sininhos(container)[0].textContent).toBe("");
    expect(porTexto(lista()!, "button", "Marcar tudo como lido")).toEqual([]);
    expect([...lista()!.querySelectorAll<HTMLElement>("[data-avisos] a")].map((item) => item.dataset.lido)).toEqual(["sim", "sim"]);
  });

  it("ver avisos mais antigos traz a página seguinte", async () => {
    const { pedidos } = rede({ avisos: [aviso("2")], proximo: "2", antigos: [aviso("1", true)] });
    const container = await tela();
    await clicar(sininhos(container)[0]);
    await ate(() => expect(porTexto(lista()!, "button", "Ver avisos mais antigos")).toHaveLength(1));

    await clicar(porTexto(lista()!, "button", "Ver avisos mais antigos")[0]);
    await ate(() => expect(lista()!.querySelectorAll("[data-avisos] a")).toHaveLength(2));
    expect(pedidos.some((pedido) => pedido.caminho === "/api/notificacoes?cursor=2")).toBe(true);
    expect(porTexto(lista()!, "button", "Ver avisos mais antigos")).toEqual([]);
  });
});

describe("sininho: push neste aparelho", () => {
  const abrir = async () => {
    const container = await tela();
    await clicar(sininhos(container)[0]);
    await ate(() => expect(lista()).not.toBeNull());
    return container;
  };
  const ativar = () => porTexto(lista()!, "button", "Ativar notificações neste aparelho");

  it("push desligado no servidor: só o sininho, sem botão nem mensagem", async () => {
    const { de } = rede({ chave: null });
    navegadorComPush();
    await abrir();
    await ate(() => expect(de("/api/notificacoes/chave")).toHaveLength(1));
    expect(ativar()).toEqual([]);
    expect(lista()!.querySelector("footer")).toBeNull();
  });

  it("navegador sem suporte diz isso com clareza", async () => {
    rede({ chave: CHAVE });
    await abrir();
    await ate(() => expect(lista()!.textContent).toContain(MENSAGEM_DO_PUSH["sem-suporte"]));
    expect(ativar()).toEqual([]);
  });

  it("iPhone no Safari: explica que é preciso adicionar à Tela de Início", async () => {
    rede({ chave: CHAVE });
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    );
    await abrir();
    await ate(() => expect(lista()!.textContent).toContain("Adicionar à Tela de Início"));
    expect(ativar()).toEqual([]);
  });

  it("a permissão só é pedida depois do toque; ativar inscreve o aparelho no escopo do painel", async () => {
    const { de } = rede({ chave: CHAVE });
    const { notificacao, serviceWorker, registro } = navegadorComPush();
    await abrir();
    await ate(() => expect(ativar()).toHaveLength(1));
    // Abrir o sistema e abrir a lista não perguntam nada nem registram service worker.
    expect(notificacao.requestPermission).not.toHaveBeenCalled();
    expect(serviceWorker.register).not.toHaveBeenCalled();

    await clicar(ativar()[0]);
    await ate(() => expect(lista()!.textContent).toContain("Notificações ativas neste aparelho."));
    expect(notificacao.requestPermission).toHaveBeenCalledTimes(1);
    // O service worker do painel fica preso a /dashboard: não intercepta o resto do site.
    expect(serviceWorker.register).toHaveBeenCalledWith("/sw.js", { scope: "/dashboard" });
    expect(registro.pushManager.subscribe).toHaveBeenCalledTimes(1);
    const opcoes = registro.pushManager.subscribe.mock.calls[0] as unknown as [{ userVisibleOnly: boolean; applicationServerKey: Uint8Array }];
    expect(opcoes[0].userVisibleOnly).toBe(true);
    expect(opcoes[0].applicationServerKey).toHaveLength(65);
    expect(de("/api/notificacoes/aparelho", "POST").map((pedido) => pedido.corpo)).toEqual([
      { endpoint: ENDERECO, expirationTime: null, keys: { p256dh: "BChave", auth: "segredo" } },
    ]);
    expect(ativar()).toEqual([]);
  });

  it("permissão negada: mensagem clara, nada é inscrito, e o navegador passa a constar como bloqueado", async () => {
    const { de } = rede({ chave: CHAVE });
    const { serviceWorker } = navegadorComPush({ resposta: "denied" });
    await abrir();
    await ate(() => expect(ativar()).toHaveLength(1));

    await clicar(ativar()[0]);
    await ate(() => expect(lista()!.querySelector('[role="alert"]')?.textContent).toBe(PERMISSAO_NEGADA));
    expect(lista()!.textContent).toContain(MENSAGEM_DO_PUSH.bloqueado);
    expect(serviceWorker.register).not.toHaveBeenCalled();
    expect(de("/api/notificacoes/aparelho", "POST")).toEqual([]);
    expect(ativar()).toEqual([]);
  });

  it("desligar neste aparelho sai do navegador e do servidor", async () => {
    const { de } = rede({ chave: CHAVE });
    const { inscricao } = navegadorComPush();
    await abrir();
    await ate(() => expect(ativar()).toHaveLength(1));
    await clicar(ativar()[0]);
    await ate(() => expect(porTexto(lista()!, "button", "Desligar")).toHaveLength(1));

    await clicar(porTexto(lista()!, "button", "Desligar")[0]);
    await ate(() => expect(ativar()).toHaveLength(1));
    expect(de("/api/notificacoes/aparelho", "DELETE").map((pedido) => pedido.corpo)).toEqual([{ endpoint: ENDERECO }]);
    expect(inscricao.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("ao abrir o sistema, a inscrição só é reafirmada para quem a ativou neste aparelho", async () => {
    // Outra pessoa ativou aqui antes: quem entra agora vê o botão, e nada é mandado ao servidor em nome dela.
    localStorage.setItem("tms:push:dono", "user-outro");
    let { de } = rede({ chave: CHAVE });
    navegadorComPush({ permissao: "granted", jaInscrito: true });
    await abrir();
    await ate(() => expect(ativar()).toHaveLength(1));
    expect(de("/api/notificacoes/aparelho", "POST")).toEqual([]);
    await desmontarTudo();

    // A própria pessoa: reafirma sozinha e já aparece como ativa.
    localStorage.setItem("tms:push:dono", ANA);
    ({ de } = rede({ chave: CHAVE }));
    const { notificacao } = navegadorComPush({ permissao: "granted", jaInscrito: true });
    await abrir();
    await ate(() => expect(lista()!.textContent).toContain("Notificações ativas neste aparelho."));
    expect(de("/api/notificacoes/aparelho", "POST")).toHaveLength(1);
    expect(notificacao.requestPermission).not.toHaveBeenCalled();
  });

  it("ao sair do sistema, o aparelho sai do servidor mas continua inscrito no navegador", async () => {
    const { de, pedidos } = rede({ chave: CHAVE });
    const { inscricao } = navegadorComPush({ permissao: "granted", jaInscrito: true });
    await esquecerAparelhoAoSair();
    expect(de("/api/notificacoes/aparelho", "DELETE").map((pedido) => pedido.corpo)).toEqual([{ endpoint: ENDERECO }]);
    expect(pedidos).toHaveLength(1);
    expect(inscricao.unsubscribe).not.toHaveBeenCalled();
  });

  it("sair nunca falha por causa do push: sem suporte ou com a rede fora, segue", async () => {
    // Sem service worker (jsdom puro).
    await expect(esquecerAparelhoAoSair()).resolves.toBeUndefined();
    // Com inscrição e a rede fora.
    navegadorComPush({ permissao: "granted", jaInscrito: true });
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    await expect(esquecerAparelhoAoSair()).resolves.toBeUndefined();
  });
});
