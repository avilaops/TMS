// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SESSION_EXPIRED_MESSAGE,
  UNKNOWN_OWNER_REASON,
  buildPending,
  countPending,
  enqueue,
  listPending,
  rememberOwner,
  rememberedOwner,
  resolveSyncOwner,
  summarizeKeys,
  summarizePending,
} from "../src/lib/offline-queue";
import { assentar, ate, clicar, desmontarTudo, montar, porTexto } from "./tela";

/**
 * A casca do aplicativo do motorista montada de verdade: fila no IndexedDB
 * (em memória), dono lembrado no `localStorage`, sessão e rede trocadas.
 * Sem banco: o que se confere aqui é o que o aparelho faz com a fila.
 */

type Sessao = { data: { user: { id: string } } | null; status: "authenticated" | "unauthenticated" | "loading" };

const estado = vi.hoisted(() => ({
  sessao: { data: null, status: "unauthenticated" } as Sessao,
  sair: vi.fn(),
}));

vi.mock("next-auth/react", () => ({ useSession: () => estado.sessao }));
vi.mock("next/navigation", () => ({ usePathname: () => "/driver" }));
vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/sair", () => ({ sair: estado.sair }));

import DriverShell from "../src/components/driver/DriverShell";

const ANA = "user-ana";
const FOTO = `data:image/jpeg;base64,${"A".repeat(2000)}`;
const baixa = (recebedor: string) => ({ receiverName: recebedor, receiverDoc: "12345", photoBase64: FOTO });

type Resposta = { status: number; body?: unknown } | Error;

/** Rede do teste: a consulta de sessão e o envio de cada baixa respondem o que o teste mandar. */
function rede(config: { sessao: Resposta | (() => Promise<Response>); baixas?: Record<string, Resposta> }) {
  const enviadas: string[] = [];
  let consultas = 0;
  const responder = (resposta: Resposta) => {
    if (resposta instanceof Error) throw resposta;
    return new Response(JSON.stringify(resposta.body ?? {}), { status: resposta.status });
  };
  const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const caminho = String(url);
    if (caminho === "/api/auth/session") {
      consultas += 1;
      return typeof config.sessao === "function" ? config.sessao() : responder(config.sessao);
    }
    const coleta = /^\/api\/driver\/entregas\/([^/]+)\/baixa$/.exec(caminho)?.[1];
    if (coleta && init?.method === "POST") {
      enviadas.push(coleta);
      return responder(config.baixas?.[coleta] ?? { status: 200 });
    }
    throw new Error(`Chamada inesperada: ${caminho}`);
  });
  vi.stubGlobal("fetch", fetcher);
  return { enviadas, consultas: () => consultas };
}

function conexao(ligada: boolean) {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => ligada });
}

const abrir = () => montar(<DriverShell>conteúdo</DriverShell>);
const naFila = async () => (await listPending()).map((item) => item.id).sort();

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  localStorage.clear();
  estado.sessao = { data: null, status: "unauthenticated" };
  estado.sair.mockReset();
  conexao(true);
});

afterEach(async () => {
  await desmontarTudo();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("casca do motorista: reenvio com o provedor da sessão sem usuário", () => {
  it("o servidor confirma a sessão: a baixa sobe ao abrir, sem toque", async () => {
    await enqueue("coleta-1", baixa("Maria"), ANA);
    rememberOwner(ANA);
    const { enviadas } = rede({ sessao: { status: 200, body: { user: { id: ANA } } } });

    const tela = await abrir();

    await ate(() => expect(tela.textContent).toContain("1 baixa enviada."));
    expect(enviadas).toEqual(["coleta-1"]);
    expect(await naFila()).toEqual([]);
    expect(tela.textContent).not.toContain(SESSION_EXPIRED_MESSAGE);
  });

  it("a conexão volta: a baixa sobe pelo evento, com o provedor ainda sem usuário", async () => {
    await enqueue("coleta-1", baixa("Maria"), ANA);
    rememberOwner(ANA);
    conexao(false);
    const { enviadas, consultas } = rede({ sessao: { status: 200, body: { user: { id: ANA } } } });

    const tela = await abrir();
    await assentar();
    // Sem conexão nada é consultado nem enviado.
    expect(consultas()).toBe(0);
    expect(tela.textContent).toContain("Sem conexão.");

    conexao(true);
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });

    await ate(() => expect(enviadas).toEqual(["coleta-1"]));
    await ate(() => expect(tela.textContent).not.toContain("baixa pendente"));
    expect(await naFila()).toEqual([]);
  });

  it("o toque na faixa azul reenvia em nome de quem o servidor confirmou", async () => {
    await enqueue("coleta-1", baixa("Maria"), ANA);
    rememberOwner(ANA);
    // Ao abrir, a consulta fica sem resposta; no toque, o servidor responde.
    let comSinal = false;
    const { enviadas } = rede({
      sessao: async () => {
        if (!comSinal) throw new TypeError("Failed to fetch");
        return new Response(JSON.stringify({ user: { id: ANA } }), { status: 200 });
      },
    });

    const tela = await abrir();
    await ate(() => expect(porTexto(tela, "button", "1 baixa pendente")).toHaveLength(1));
    await assentar();
    expect(enviadas).toEqual([]);

    comSinal = true;
    await clicar(porTexto(tela, "button", "1 baixa pendente")[0]);

    await ate(() => expect(enviadas).toEqual(["coleta-1"]));
    await ate(() => expect(tela.textContent).toContain("1 baixa enviada."));
  });

  it("o servidor diz que não há sessão: a faixa âmbar aparece ao abrir e a baixa fica no aparelho", async () => {
    await enqueue("coleta-1", baixa("Maria"), ANA);
    rememberOwner(ANA);
    const { enviadas } = rede({ sessao: { status: 200, body: {} } });

    const tela = await abrir();

    await ate(() => expect(tela.textContent).toContain(SESSION_EXPIRED_MESSAGE));
    expect(enviadas).toEqual([]);
    expect(await naFila()).toEqual([`${ANA}:coleta-1`]);

    // A faixa âmbar leva ao login.
    await clicar(porTexto(tela, "button", SESSION_EXPIRED_MESSAGE)[0]);
    expect(estado.sair).toHaveBeenCalledTimes(1);
  });

  it("sem baixa guardada, abrir o aplicativo não consulta a sessão", async () => {
    const { consultas } = rede({ sessao: { status: 200, body: {} } });

    const tela = await abrir();
    await assentar(50);

    expect(consultas()).toBe(0);
    expect(tela.textContent).not.toContain(SESSION_EXPIRED_MESSAGE);
  });
});

describe("casca do motorista: o dono lembrado no aparelho nunca autoriza reenvio", () => {
  it("a decisão do reenvio ignora o dono lembrado quando o servidor não responde", async () => {
    rememberOwner(ANA);
    expect(rememberedOwner()).toBe(ANA);

    expect(await resolveSyncOwner(null, async () => ({ state: "unknown" }))).toEqual({
      owner: null,
      sessionExpired: false,
    });
    expect(await resolveSyncOwner(null, async () => ({ state: "none" }))).toEqual({
      owner: null,
      sessionExpired: true,
    });
  });

  it.each([
    ["falha de rede", new TypeError("Failed to fetch") as Resposta],
    ["erro do servidor", { status: 503, body: {} } as Resposta],
    ["resposta sem o id do usuário", { status: 200, body: { user: { name: "Ana" } } } as Resposta],
  ])("%s na consulta de sessão: nada é enviado, ao abrir nem no toque", async (_caso, resposta) => {
    await enqueue("coleta-1", baixa("Maria"), ANA);
    rememberOwner(ANA);
    const { enviadas, consultas } = rede({ sessao: resposta });

    const tela = await abrir();
    // O dono lembrado serve para contar a baixa na tela.
    await ate(() => expect(porTexto(tela, "button", "1 baixa pendente")).toHaveLength(1));
    await ate(() => expect(consultas()).toBe(1));
    await assentar();

    await clicar(porTexto(tela, "button", "1 baixa pendente")[0]);
    await ate(() => expect(consultas()).toBe(2));
    await assentar();

    expect(enviadas).toEqual([]);
    expect(await naFila()).toEqual([`${ANA}:coleta-1`]);
    // Sem resposta do servidor não se diz que a sessão expirou.
    expect(tela.textContent).not.toContain(SESSION_EXPIRED_MESSAGE);
    expect(rememberedOwner()).toBe(ANA);
  });
});

describe("casca do motorista: um reenvio por vez", () => {
  it("a conexão volta e o motorista toca no mesmo instante: cada baixa é enviada uma vez", async () => {
    await enqueue("coleta-1", baixa("Maria"), ANA);
    await enqueue("coleta-2", baixa("José"), ANA);
    conexao(false);
    estado.sessao = { data: { user: { id: ANA } }, status: "authenticated" };
    const { enviadas } = rede({ sessao: { status: 200, body: { user: { id: ANA } } } });

    const tela = await abrir();
    await ate(() => expect(tela.textContent).toContain("Sem conexão."));
    conexao(true);
    // Só o aviso de conexão: a faixa azul aparece sem disparar o reenvio.
    await act(async () => {
      window.dispatchEvent(new Event("offline"));
    });
    await ate(() => expect(porTexto(tela, "button", "2 baixas pendentes")).toHaveLength(1));
    expect(enviadas).toEqual([]);

    const faixa = porTexto(tela, "button", "2 baixas pendentes")[0];
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      faixa.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      window.dispatchEvent(new Event("online"));
    });

    await ate(() => expect(tela.textContent).toContain("2 baixas enviadas."));
    expect([...enviadas].sort()).toEqual(["coleta-1", "coleta-2"]);
    expect(await naFila()).toEqual([]);

    // A trava solta ao fim: a próxima baixa sobe normalmente.
    await enqueue("coleta-3", baixa("Rita"), ANA);
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await ate(() => expect(enviadas).toHaveLength(3));
  });
});

describe("casca do motorista: baixas presas", () => {
  const MOTIVO_CADASTRO = "Motorista inativo.";

  async function comDuasPresas() {
    await enqueue("coleta-cadastro", baixa("Maria"), ANA);
    await enqueue("coleta-antiga", baixa("José"), null);
    estado.sessao = { data: { user: { id: ANA } }, status: "authenticated" };
    const io = rede({
      sessao: { status: 200, body: { user: { id: ANA } } },
      baixas: {
        "coleta-cadastro": { status: 403, body: { error: MOTIVO_CADASTRO } },
        "coleta-antiga": { status: 404, body: { error: "Entrega não encontrada na sua viagem." } },
      },
    });
    const tela = await abrir();
    await ate(() => expect(tela.querySelectorAll('[role="alert"] li')).toHaveLength(2));
    return { tela, ...io };
  }

  const linha = (tela: HTMLElement, recebedor: string) =>
    porTexto(tela, '[role="alert"] li', `Recebedor: ${recebedor}`)[0];

  it("aparecem ao abrir, cada uma com o seu motivo e o seu botão", async () => {
    const { tela } = await comDuasPresas();

    const cadastro = linha(tela, "Maria");
    const antiga = linha(tela, "José");
    expect(cadastro.textContent).toContain(MOTIVO_CADASTRO);
    expect(cadastro.textContent).not.toContain(UNKNOWN_OWNER_REASON);
    expect(antiga.textContent).toContain(UNKNOWN_OWNER_REASON);
    expect(antiga.textContent).not.toContain(MOTIVO_CADASTRO);
    expect(porTexto(cadastro, "button", "Descartar esta baixa")).toHaveLength(1);
    expect(porTexto(antiga, "button", "Descartar esta baixa")).toHaveLength(1);
    // Nada foi apagado sem o motorista mandar.
    expect(await naFila()).toEqual(["coleta-antiga", `${ANA}:coleta-cadastro`]);
  });

  it("descartar apaga só a baixa escolhida", async () => {
    const { tela } = await comDuasPresas();
    const confirmar = vi.spyOn(window, "confirm").mockReturnValue(true);

    await clicar(porTexto(linha(tela, "José"), "button", "Descartar esta baixa")[0]);

    await ate(() => expect(tela.querySelectorAll('[role="alert"] li')).toHaveLength(1));
    expect(confirmar).toHaveBeenCalledTimes(1);
    expect(confirmar.mock.calls[0][0]).toContain("recebedor: José");
    expect(await naFila()).toEqual([`${ANA}:coleta-cadastro`]);
    // A do cadastro parado continua presa, com o motivo dela.
    expect(linha(tela, "Maria").textContent).toContain(MOTIVO_CADASTRO);
    expect(linha(tela, "José")).toBeUndefined();
  });

  it("sem confirmação nada é apagado", async () => {
    const { tela } = await comDuasPresas();
    vi.spyOn(window, "confirm").mockReturnValue(false);

    await clicar(porTexto(linha(tela, "Maria"), "button", "Descartar esta baixa")[0]);
    await assentar();

    expect(tela.querySelectorAll('[role="alert"] li')).toHaveLength(2);
    expect(await naFila()).toEqual(["coleta-antiga", `${ANA}:coleta-cadastro`]);
  });
});

describe("fila offline: contagem sem ler as fotos", () => {
  it("conta pelas chaves e bate com a leitura completa da fila", async () => {
    await enqueue("coleta-1", baixa("Maria"), ANA);
    await enqueue("coleta-2", baixa("José"), "user-beto");
    await enqueue("coleta-3", baixa("Rita"), null);
    const itens = await listPending();

    // Nenhuma leitura de item (com foto) durante a contagem.
    const loja = Object.getPrototypeOf(await lojaDaFila()) as IDBObjectStore;
    const leituras = (["getAll", "get", "openCursor"] as const).map((metodo) => vi.spyOn(loja, metodo));

    for (const usuario of [ANA, "user-beto", "user-caio", null]) {
      expect(await countPending(usuario)).toEqual(summarizePending(itens, usuario));
    }
    expect(await countPending(ANA)).toEqual({ mine: 2, others: 1 });
    expect(await countPending(null)).toEqual({ mine: 3, others: 0 });
    for (const leitura of leituras) expect(leitura).not.toHaveBeenCalled();
  });

  it("a chave diz o dono: de outro motorista conta à parte, sem dono conta para quem está logado", () => {
    const chaves = [
      buildPending("coleta-1", {}, ANA).id,
      buildPending("coleta-2", {}, "user-beto").id,
      buildPending("coleta-3", {}, null).id,
      // Chave que a fila nunca grava não é contada.
      "",
      7,
    ];

    expect(summarizeKeys(chaves, ANA)).toEqual({ mine: 2, others: 1 });
    expect(summarizeKeys(chaves, "user-caio")).toEqual({ mine: 1, others: 2 });
    expect(summarizeKeys(chaves, null)).toEqual({ mine: 3, others: 0 });
    // Usuário cujo id é começo do id de outro não leva a baixa do outro.
    expect(summarizeKeys(["user-ana-2:coleta-1"], ANA)).toEqual({ mine: 0, others: 1 });
    expect(summarizeKeys([], ANA)).toEqual({ mine: 0, others: 0 });
  });
});

/** A loja da fila, só para o teste alcançar os métodos de leitura do IndexedDB. */
function lojaDaFila(): Promise<IDBObjectStore> {
  return new Promise((resolve, reject) => {
    const pedido = indexedDB.open("mello-driver");
    pedido.onerror = () => reject(pedido.error);
    pedido.onsuccess = () => {
      const db = pedido.result;
      const loja = db.transaction("pending-baixas", "readonly").objectStore("pending-baixas");
      db.close();
      resolve(loja);
    };
  });
}
