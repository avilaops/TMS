import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getServerSession } from "next-auth";
import webpush from "web-push";
import {
  AVISOS_POR_PAGINA,
  SERVICO_DESCONHECIDO,
  TEXTO_MAXIMO,
  TITULO_MAXIMO,
  aparelhoSchema,
  avisoDeCargaRetirada,
  avisoDeChamadoNovo,
  avisoDeComprovante,
  avisoDeDespesa,
  avisoDeFatura,
  avisoDePedidoDeColeta,
  avisoDeRespostaAoCliente,
  avisoDeStatus,
  avisoDeViagemLiberada,
  avisarDepois,
  contadorDoSininho,
  cortar,
  ehCaminhoInterno,
  ehServicoDePush,
  haQuantoTempo,
  lidasSchema,
  linhasDoAviso,
} from "../src/lib/notificacoes";
import { chaveEmBytes, ehIphone, situacaoDoPush, type AmbienteDoPush } from "../src/lib/push-cliente";
import { configuracaoDoPush, corpoDoPush } from "../src/lib/notificacoes-push";
import { perfisQuePodem } from "../src/lib/permissoes";
import { EMPRESA_OUTRA, EMPRESA_PADRAO } from "./empresas-de-teste";

/**
 * Notificações: os avisos de cada pessoa (sininho) e o envio por push.
 *
 * Primeiro as regras puras e o service worker (public/sw.js, avaliado com um
 * `self` de mentira). Depois as rotas contra um Postgres de verdade: a sessão
 * é simulada trocando `getServerSession`, e o `web-push` é simulado — nenhum
 * teste chama serviço de push de verdade.
 */
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("web-push", () => ({ default: { sendNotification: vi.fn() } }));

const CHAVE_PUBLICA = Buffer.alloc(65, 4).toString("base64url");
const CHAVE_PRIVADA = Buffer.alloc(32, 7).toString("base64url");
const VAPID = { VAPID_PUBLIC_KEY: CHAVE_PUBLICA, VAPID_PRIVATE_KEY: CHAVE_PRIVADA, VAPID_SUBJECT: "mailto:suporte@exemplo.br" };

describe("regras das notificações", () => {
  it("corta título e texto no limite e junta os espaços", () => {
    expect(cortar("  Viagem   liberada \n hoje ", 80)).toBe("Viagem liberada hoje");
    expect(cortar("x".repeat(300), TEXTO_MAXIMO)).toHaveLength(TEXTO_MAXIMO);
    expect(cortar("x".repeat(300), TEXTO_MAXIMO).endsWith("…")).toBe(true);
    expect(cortar("x".repeat(TITULO_MAXIMO), TITULO_MAXIMO)).toBe("x".repeat(TITULO_MAXIMO));
  });

  it("endereço do aviso é sempre caminho interno", () => {
    for (const url of ["/dashboard", "/portal/coletas/abc", "/driver/viagem/1?x=1"]) expect(ehCaminhoInterno(url), url).toBe(true);
    for (const url of ["https://exemplo.com", "//exemplo.com", "dashboard", "", "/\\exemplo.com", "javascript:alert(1)", null, undefined, 3]) {
      expect(ehCaminhoInterno(url), String(url)).toBe(false);
    }
  });

  it("uma linha por destinatário, sem repetir, sem o autor e sem vazio", () => {
    const base = { tipo: "chamado.novo", titulo: "Título", texto: "Texto", url: "/dashboard/ocorrencias/1" } as const;
    expect(linhasDoAviso({ ...base, para: ["a", "b", "a", null, undefined, "", "autor"], autor: "autor" })).toEqual([
      { userId: "a", type: "chamado.novo", title: "Título", body: "Texto", url: "/dashboard/ocorrencias/1" },
      { userId: "b", type: "chamado.novo", title: "Título", body: "Texto", url: "/dashboard/ocorrencias/1" },
    ]);
    expect(linhasDoAviso({ ...base, para: "a" })).toHaveLength(1);
    // Quem fez a ação nunca recebe o próprio aviso.
    expect(linhasDoAviso({ ...base, para: "a", autor: "a" })).toEqual([]);
    expect(linhasDoAviso({ ...base, para: null })).toEqual([]);
    expect(linhasDoAviso({ ...base, para: "a", titulo: "t".repeat(200), texto: "x".repeat(900) })[0]).toMatchObject({
      title: expect.stringMatching(/…$/),
      body: expect.stringMatching(/…$/),
    });
    expect(() => linhasDoAviso({ ...base, para: "a", url: "https://fora.exemplo.com" })).toThrow(/não é interno/);
  });

  it("status que o cliente fica sabendo: confirmada (só de pedido), recusada, em rota e entregue", () => {
    const carga = { id: "c1", trackingCode: "1234567890", receiver: "Mercado Bom Preço", destination: "Mirassol/SP" };
    expect(avisoDeStatus({ fromStatus: "PENDING", toStatus: "CONFIRMED" }, carga)).toEqual({
      tipo: "coleta.confirmada",
      titulo: "Coleta confirmada",
      texto: "Seu pedido de coleta foi confirmado: Mercado Bom Preço, Mirassol/SP (1234567890).",
      url: "/portal/coletas/c1",
    });
    expect(avisoDeStatus({ fromStatus: "PENDING", toStatus: "REJECTED" }, carga)?.tipo).toBe("coleta.recusada");
    expect(avisoDeStatus({ fromStatus: "COLLECTED", toStatus: "ROUTE" }, carga)?.titulo).toBe("Saiu para entrega");
    expect(avisoDeStatus({ fromStatus: "ROUTE", toStatus: "DELIVERED" }, { ...carga, trackingCode: null })?.texto).toBe(
      "Sua carga foi entregue: Mercado Bom Preço, Mirassol/SP.",
    );
    // O que não interessa ao cliente: coletado, cancelado, carga que voltou da rota, criação.
    for (const [de, para] of [["CONFIRMED", "COLLECTED"], ["PENDING", "CANCELLED"], ["ROUTE", "COLLECTED"], [null, "CONFIRMED"], [null, "PENDING"]] as const) {
      expect(avisoDeStatus({ fromStatus: de, toStatus: para }, carga), `${de} → ${para}`).toBeNull();
    }
    expect(avisoDeStatus({ fromStatus: "PENDING", toStatus: "INVENTADO" }, carga)).toBeNull();
  });

  it("cada aviso abre a tela certa de quem o recebe", () => {
    expect(avisoDeViagemLiberada("m1", 1)).toMatchObject({ tipo: "viagem.liberada", url: "/driver/viagem/m1", texto: expect.stringContaining("1 entrega.") });
    expect(avisoDeViagemLiberada("m1", 3).texto).toContain("3 entregas.");
    expect(avisoDeCargaRetirada("m1", { receiver: "Mercado", destination: "Mirassol/SP" })).toMatchObject({
      url: "/driver/viagem/m1",
      texto: "A entrega para Mercado (Mirassol/SP) saiu da sua viagem.",
    });
    expect(avisoDeFatura({ number: 12, dueDate: new Date("2026-11-05T00:00:00.000Z"), cargas: 2 })).toEqual({
      tipo: "fatura.emitida",
      titulo: "Fatura nº 12 emitida",
      texto: "2 cargas, vencimento em 05/11/2026.",
      url: "/portal/faturas",
    });
    const chamado = { id: "o1", number: 7, title: "Carga atrasada" };
    expect(avisoDeRespostaAoCliente(chamado)).toMatchObject({ url: "/portal/atendimento/o1", titulo: "Resposta no atendimento nº 7", texto: "Carga atrasada" });
    expect(avisoDeChamadoNovo(chamado, "motorista")).toMatchObject({ url: "/dashboard/ocorrencias/o1", titulo: "Chamado nº 7 aberto pelo motorista" });
    expect(avisoDePedidoDeColeta({ cliente: "Serilon", origin: "Rio Preto/SP", destination: "Mirassol/SP" })).toMatchObject({
      url: "/dashboard/coletas/pendentes",
      texto: "Serilon: Rio Preto/SP → Mirassol/SP.",
    });
    expect(avisoDeComprovante({ id: "c1", receiver: "Mercado", destination: "Mirassol/SP" }, "Maria")).toMatchObject({
      url: "/dashboard/entregas/c1/comprovante",
      texto: "Mercado, Mirassol/SP. Recebido por Maria.",
    });
    const despesa = avisoDeDespesa({ type: "TOLL", amount: 35.5 }, "João");
    expect(despesa.url).toBe("/dashboard/manifestos");
    expect(despesa.texto).toMatch(/^João lançou pedágio de R\$\s35,50\.$/);
  });

  it("há quanto tempo e o contador do sininho", () => {
    const agora = new Date("2026-10-10T15:00:00.000Z");
    const antes = (ms: number) => new Date(agora.getTime() - ms);
    expect(haQuantoTempo(antes(20_000), agora)).toBe("agora");
    expect(haQuantoTempo(antes(5 * 60_000), agora)).toBe("há 5 min");
    expect(haQuantoTempo(antes(3 * 3_600_000).toISOString(), agora)).toBe("há 3 h");
    expect(haQuantoTempo(antes(2 * 86_400_000), agora)).toBe("há 2 d");
    expect(haQuantoTempo(antes(10 * 86_400_000), agora)).toBe("30/09");
    expect(haQuantoTempo("não é data", agora)).toBe("");

    expect(contadorDoSininho(0)).toBe("");
    expect(contadorDoSininho(-1)).toBe("");
    expect(contadorDoSininho(7)).toBe("7");
    expect(contadorDoSininho(99)).toBe("99");
    expect(contadorDoSininho(100)).toBe("99+");
  });

  it("marcar como lido: uma, várias ou todas, e nada além disso", () => {
    expect(lidasSchema.safeParse({ todas: true }).success).toBe(true);
    expect(lidasSchema.parse({ ids: ["a", " b "] })).toEqual({ ids: ["a", "b"] });
    for (const corpo of [null, {}, { todas: false }, { ids: [] }, { ids: "a" }, { ids: [3] }, { ids: [""] }, { ids: Array(101).fill("a") }, { todas: true, ids: ["a"] }]) {
      expect(lidasSchema.safeParse(corpo).success, JSON.stringify(corpo)).toBe(false);
    }
  });

  it("inscrição do aparelho: só serviço de push de navegador, por https", () => {
    for (const endereco of [
      "https://fcm.googleapis.com/fcm/send/abc",
      "https://updates.push.services.mozilla.com/wpush/v2/abc",
      "https://web.push.apple.com/abc",
      "https://wns2-by3p.notify.windows.com/w/?token=abc",
    ]) {
      expect(ehServicoDePush(endereco), endereco).toBe(true);
    }
    for (const endereco of [
      "http://fcm.googleapis.com/fcm/send/abc",
      "https://127.0.0.1/interno",
      "https://tms-db:5432/",
      "https://fcm.googleapis.com.invasor.exemplo.com/x",
      "https://invasor.exemplo.com/fcm.googleapis.com",
      "https://usuario:senha@fcm.googleapis.com/x",
      "fcm.googleapis.com",
      "",
    ]) {
      expect(ehServicoDePush(endereco), endereco).toBe(false);
    }

    const chaves = { p256dh: "BPubKey_-123", auth: "authKey_-" };
    expect(aparelhoSchema.parse({ endpoint: "https://fcm.googleapis.com/fcm/send/abc", expirationTime: null, keys: chaves })).toEqual({
      endpoint: "https://fcm.googleapis.com/fcm/send/abc",
      keys: chaves,
    });
    const erro = (valor: unknown) => {
      const lido = aparelhoSchema.safeParse(valor);
      return lido.success ? null : lido.error.issues[0].message;
    };
    expect(erro({ endpoint: "https://invasor.exemplo.com/x", keys: chaves })).toBe(SERVICO_DESCONHECIDO);
    expect(erro({ endpoint: "https://fcm.googleapis.com/x" })).toBe("Dados inválidos.");
    expect(erro({ endpoint: "https://fcm.googleapis.com/x", keys: { p256dh: "com espaço", auth: "a" } })).toBe("Dados inválidos.");
    expect(erro(null)).toBe("Dados inválidos.");
  });

  it("push ligado só com as três variáveis VAPID no formato certo", () => {
    expect(configuracaoDoPush(VAPID)).toEqual({ publicKey: CHAVE_PUBLICA, privateKey: CHAVE_PRIVADA, subject: "mailto:suporte@exemplo.br" });
    expect(configuracaoDoPush({ ...VAPID, VAPID_SUBJECT: "https://tms.exemplo.br" })).not.toBeNull();
    expect(configuracaoDoPush({})).toBeNull();
    for (const falta of Object.keys(VAPID)) expect(configuracaoDoPush({ ...VAPID, [falta]: "" }), falta).toBeNull();
    expect(configuracaoDoPush({ ...VAPID, VAPID_PUBLIC_KEY: "curta" })).toBeNull();
    expect(configuracaoDoPush({ ...VAPID, VAPID_PRIVATE_KEY: `${CHAVE_PRIVADA}=` })).toBeNull();
    expect(configuracaoDoPush({ ...VAPID, VAPID_SUBJECT: "suporte@exemplo.br" })).toBeNull();
    // As chaves trocadas de lugar não passam: os tamanhos são diferentes.
    expect(configuracaoDoPush({ ...VAPID, VAPID_PUBLIC_KEY: CHAVE_PRIVADA, VAPID_PRIVATE_KEY: CHAVE_PUBLICA })).toBeNull();

    expect(JSON.parse(corpoDoPush({ id: "n1", title: "Título", body: "Texto", url: "/portal" }))).toEqual({ id: "n1", titulo: "Título", texto: "Texto", url: "/portal" });
  });

  it("o que o sininho mostra sobre o push neste aparelho", () => {
    const ambiente: AmbienteDoPush = { suporte: true, iphone: false, instalado: false, permissao: "default" };
    expect(situacaoDoPush(ambiente, null, false)).toBe("desligado");
    expect(situacaoDoPush(ambiente, CHAVE_PUBLICA, false)).toBe("inativo");
    expect(situacaoDoPush({ ...ambiente, permissao: "granted" }, CHAVE_PUBLICA, true)).toBe("ativo");
    // Inscrito, mas a permissão foi tirada depois: volta a oferecer o botão.
    expect(situacaoDoPush(ambiente, CHAVE_PUBLICA, true)).toBe("inativo");
    expect(situacaoDoPush({ ...ambiente, permissao: "denied" }, CHAVE_PUBLICA, false)).toBe("bloqueado");
    expect(situacaoDoPush({ ...ambiente, suporte: false }, CHAVE_PUBLICA, false)).toBe("sem-suporte");
    // iPhone no Safari: precisa ir para a Tela de Início. Já instalado, segue o caminho normal.
    expect(situacaoDoPush({ ...ambiente, suporte: false, iphone: true }, CHAVE_PUBLICA, false)).toBe("iphone-sem-instalar");
    expect(situacaoDoPush({ ...ambiente, iphone: true, instalado: true }, CHAVE_PUBLICA, false)).toBe("inativo");

    expect(ehIphone("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1")).toBe(true);
    expect(ehIphone("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15", 5)).toBe(true);
    expect(ehIphone("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15", 0)).toBe(false);
    expect(ehIphone("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36", 5)).toBe(false);

    expect([...chaveEmBytes("AQID_-8")]).toEqual([1, 2, 3, 255, 239]);
    expect(chaveEmBytes(CHAVE_PUBLICA)).toHaveLength(65);
  });

  it("aviso fora de transação nunca derruba a ação", async () => {
    const erros = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(avisarDepois("teste", async () => Promise.reject(new Error("banco fora")))).resolves.toBeUndefined();
    expect(erros).toHaveBeenCalledTimes(1);
    erros.mockRestore();
  });
});

/* ------------------------------- Service worker ------------------------------ */

type Ouvinte = (evento: Record<string, unknown>) => void;

/** Avalia public/sw.js com um `self` de mentira, registrado no escopo informado. */
function carregarSw(escopo: string, abas: { url: string; focus: () => unknown }[] = []) {
  const ouvintes: Record<string, Ouvinte> = {};
  const mostradas: { titulo: string; opcoes: Record<string, unknown> }[] = [];
  const abertas: string[] = [];
  const pedidos: { url: string; init: RequestInit }[] = [];
  const self = {
    location: { origin: "https://tms.exemplo.br" },
    registration: {
      scope: `https://tms.exemplo.br${escopo}`,
      showNotification: async (titulo: string, opcoes: Record<string, unknown>) => {
        mostradas.push({ titulo, opcoes });
      },
    },
    clients: {
      claim: async () => undefined,
      matchAll: async () => abas,
      openWindow: async (url: string) => {
        abertas.push(url);
      },
    },
    skipWaiting: async () => undefined,
    addEventListener: (tipo: string, ouvinte: Ouvinte) => {
      ouvintes[tipo] = ouvinte;
    },
  };
  const caches = { open: async () => ({ addAll: async () => undefined, put: async () => undefined }), keys: async () => [], match: async () => undefined, delete: async () => true };
  const fetch = async (url: string, init: RequestInit) => {
    pedidos.push({ url, init });
    return new Response("{}");
  };
  const fonte = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
  new Function("self", "caches", "fetch", fonte)(self, caches, fetch);

  /** Dispara o evento e espera o que o ouvinte passou para `waitUntil`. */
  const disparar = async (tipo: string, evento: Record<string, unknown> = {}) => {
    const esperas: Promise<unknown>[] = [];
    ouvintes[tipo]({ ...evento, waitUntil: (promessa: Promise<unknown>) => esperas.push(promessa) });
    await Promise.all(esperas);
  };
  return { ouvintes, mostradas, abertas, pedidos, disparar };
}

describe("service worker (public/sw.js)", () => {
  it("o registro da raiz (app do motorista) segue atendendo offline; os do painel e do portal não interceptam nada", () => {
    expect(Object.keys(carregarSw("/").ouvintes).sort()).toEqual(["activate", "fetch", "install", "notificationclick", "push"]);
    for (const escopo of ["/dashboard", "/portal"]) {
      expect(Object.keys(carregarSw(escopo).ouvintes).sort(), escopo).toEqual(["activate", "install", "notificationclick", "push"]);
    }
  });

  it("offline do motorista: a navegação em /driver é respondida, o painel passa direto", () => {
    const { ouvintes } = carregarSw("/");
    const navegar = (url: string) => {
      let respondeu = false;
      ouvintes.fetch({ request: { method: "GET", mode: "navigate", url, clone: () => ({}) }, respondWith: (resposta: Promise<unknown>) => { respondeu = true; resposta.catch(() => undefined); } });
      return respondeu;
    };
    expect(navegar("https://tms.exemplo.br/driver/viagem/1")).toBe(true);
    expect(navegar("https://tms.exemplo.br/dashboard")).toBe(false);
    expect(navegar("https://tms.exemplo.br/portal/coletas")).toBe(false);
  });

  it("push: mostra a notificação com título, texto, ícone e o endereço", async () => {
    const sw = carregarSw("/dashboard");
    await sw.disparar("push", { data: { json: () => ({ id: "n1", titulo: "Chamado nº 7", texto: "Carga atrasada", url: "/dashboard/ocorrencias/o1" }) } });
    expect(sw.mostradas).toEqual([
      {
        titulo: "Chamado nº 7",
        opcoes: { body: "Carga atrasada", icon: "/web-app-manifest-192x192.png", badge: "/favicon-96x96.png", tag: "n1", data: { id: "n1", url: "/dashboard/ocorrencias/o1" } },
      },
    ]);
  });

  it("push sem corpo, com corpo quebrado ou com endereço de fora: título padrão e o início da área", async () => {
    const sw = carregarSw("/portal");
    await sw.disparar("push", { data: null });
    await sw.disparar("push", { data: { json: () => { throw new Error("não é JSON"); } } });
    await sw.disparar("push", { data: { json: () => ({ titulo: "Aviso", url: "https://invasor.exemplo.com/x" }) } });
    await sw.disparar("push", { data: { json: () => ({ titulo: "Aviso", url: "//invasor.exemplo.com/x" }) } });
    expect(sw.mostradas.map((n) => n.titulo)).toEqual(["Novo aviso", "Novo aviso", "Aviso", "Aviso"]);
    for (const { opcoes } of sw.mostradas) expect((opcoes.data as { url: string }).url).toBe("/portal");

    // No app do motorista o início é /driver, não a raiz do site.
    const doMotorista = carregarSw("/");
    await doMotorista.disparar("push", { data: null });
    expect((doMotorista.mostradas[0].opcoes.data as { url: string }).url).toBe("/driver");
  });

  it("toque na notificação: foca a aba que já está no endereço, ou abre uma; e marca o aviso como lido", async () => {
    const focar = vi.fn();
    const comAba = carregarSw("/dashboard", [
      { url: "https://tms.exemplo.br/dashboard", focus: vi.fn() },
      { url: "https://tms.exemplo.br/dashboard/ocorrencias/o1", focus: focar },
    ]);
    const fechar = vi.fn();
    await comAba.disparar("notificationclick", { notification: { close: fechar, data: { id: "n1", url: "/dashboard/ocorrencias/o1" } } });
    expect(fechar).toHaveBeenCalledTimes(1);
    expect(focar).toHaveBeenCalledTimes(1);
    expect(comAba.abertas).toEqual([]);
    expect(comAba.pedidos).toHaveLength(1);
    expect(comAba.pedidos[0].url).toBe("/api/notificacoes/lidas");
    expect(comAba.pedidos[0].init).toMatchObject({ method: "POST", body: JSON.stringify({ ids: ["n1"] }) });

    const semAba = carregarSw("/dashboard", [{ url: "https://tms.exemplo.br/dashboard", focus: vi.fn() }]);
    await semAba.disparar("notificationclick", { notification: { close: vi.fn(), data: { id: null, url: "/dashboard/ocorrencias/o1" } } });
    expect(semAba.abertas).toEqual(["https://tms.exemplo.br/dashboard/ocorrencias/o1"]);
    // Sem id não há o que marcar.
    expect(semAba.pedidos).toEqual([]);

    // Endereço de fora nunca é aberto: cai no início da área.
    const invasor = carregarSw("/portal");
    await invasor.disparar("notificationclick", { notification: { close: vi.fn(), data: { url: "https://invasor.exemplo.com/x" } } });
    expect(invasor.abertas).toEqual(["https://tms.exemplo.br/portal"]);
  });
});

/* ------------------------------------ Rotas ---------------------------------- */

const temBanco = Boolean(process.env.DATABASE_URL);

if (!temBanco) {
  console.warn("\n[notificacoes.test] DATABASE_URL ausente: testes de integração PULADOS.\nRode com um Postgres real para exercitá-los.\n");
}

const suite = temBanco ? describe : describe.skip;

// Tudo o que esta suite cria usa estes marcadores, e só isso é apagado.
const PREFIXO = "teste-avisos-";
const CNPJ_A = "99321654000101";
const CNPJ_B = "99321654000102";
const CNPJ_DA_OUTRA = "99321654000103";
const CNPJS = [CNPJ_A, CNPJ_B, CNPJ_DA_OUTRA];
const CPF = "99321654001";
const CPF_OUTRO = "99321654002";
const PLACA = "AVS1A11";
const HASH_FALSO = "$2b$10$hashfalsoparateste000000000000000000000000000000000";
const FOTO = `data:image/jpeg;base64,${"A".repeat(2000)}`;
const APARELHO = (nome: string) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${PREFIXO}${nome}`, expirationTime: null, keys: { p256dh: "BChave_-publica", auth: "segredo_-" } });

type Corpo = Record<string, unknown> & { error?: string };
type Lista = { avisos: { id: string; type: string; title: string; body: string; url: string; readAt: string | null }[]; naoLidos: number; proximo: string | null };

suite("notificações: sininho, gatilhos e push", () => {
  let banco: typeof import("../src/lib/prisma");
  let push: typeof import("../src/lib/notificacoes-push");
  let lista: typeof import("../src/app/api/notificacoes/route");
  let lidas: typeof import("../src/app/api/notificacoes/lidas/route");
  let aparelho: typeof import("../src/app/api/notificacoes/aparelho/route");
  let chave: typeof import("../src/app/api/notificacoes/chave/route");
  let liberar: typeof import("../src/app/api/manifestos/[id]/liberar/route");
  let cargaDaViagem: typeof import("../src/app/api/manifestos/[id]/coletas/[coletaId]/route");
  let baixa: typeof import("../src/app/api/driver/entregas/[id]/baixa/route");
  let status: typeof import("../src/app/api/dashboard/coletas/[id]/status/route");
  let faturas: typeof import("../src/app/api/faturas/route");
  let mensagens: typeof import("../src/app/api/ocorrencias/[id]/mensagens/route");
  let chamados: typeof import("../src/app/api/ocorrencias/route");
  let portalChamados: typeof import("../src/app/api/portal/atendimento/route");
  let portalMensagens: typeof import("../src/app/api/portal/atendimento/[id]/mensagens/route");
  let chamadoDoMotorista: typeof import("../src/app/api/driver/entregas/[id]/ocorrencia/route");
  let despesas: typeof import("../src/app/api/driver/manifestos/[id]/despesas/route");
  let portalColetas: typeof import("../src/app/api/portal/coletas/route");

  const sessao = vi.mocked(getServerSession);
  const enviar = vi.mocked(webpush.sendNotification);

  // Usuários da empresa padrão, por papel no teste. Dois OPERATION: mesmo perfil, mesma empresa.
  const PERFIL = {
    ADMIN: "ADMIN",
    OPERATION: "OPERATION",
    OPERATION_2: "OPERATION",
    FINANCE: "FINANCE",
    EXPEDITION: "EXPEDITION",
    CLIENTE_A: "CLIENT",
    CLIENTE_A2: "CLIENT",
    CLIENTE_B: "CLIENT",
    DRIVER: "DRIVER",
    OUTRO_DRIVER: "DRIVER",
  } as const;
  type Quem = keyof typeof PERFIL;
  const ids = Object.fromEntries(Object.keys(PERFIL).map((quem) => [quem, ""])) as Record<Quem, string>;
  const daOutra = { ADMIN: "", CLIENTE: "" };

  let clienteA: string;
  let clienteB: string;
  let clienteDaOutra: string;
  let motorista: string;
  let veiculo: string;

  const entrarComo = (quem: Quem | null) => sessao.mockResolvedValue(quem ? { user: { id: ids[quem], role: PERFIL[quem], clientId: null } } : null);
  const entrarNaOutra = (quem: keyof typeof daOutra) =>
    sessao.mockResolvedValue({ user: { id: daOutra[quem], role: quem === "ADMIN" ? "ADMIN" : "CLIENT", clientId: null, tenantId: EMPRESA_OUTRA.id } });

  const req = (method = "GET", body?: unknown, query = "") =>
    new Request(`http://localhost/api/teste${query ? `?${query}` : ""}`, {
      method,
      headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const responder = async <T = Corpo>(res: Response) => ({ status: res.status, corpo: (await res.json()) as T & { error?: string } });

  /** Os avisos gravados para a pessoa, do mais antigo para o mais novo. */
  const avisosDe = (userId: string) => banco.sistema.notification.findMany({ where: { userId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const tiposDe = async (quem: Quem) => (await avisosDe(ids[quem])).map((aviso) => aviso.type);
  const inscricoes = () => banco.sistema.pushSubscription.findMany({ where: { endpoint: { contains: PREFIXO } }, orderBy: { endpoint: "asc" } });

  /** Grava um aviso direto no banco, na empresa do destinatário. */
  const gravar = (userId: string, dados: { titulo?: string; tenantId?: string; createdAt?: Date; readAt?: Date | null } = {}) =>
    banco.sistema.notification.create({
      data: {
        tenantId: dados.tenantId ?? EMPRESA_PADRAO.id,
        userId,
        type: "chamado.novo",
        title: dados.titulo ?? `${PREFIXO}aviso`,
        body: "Texto do aviso",
        url: "/dashboard/ocorrencias/1",
        ...(dados.createdAt ? { createdAt: dados.createdAt } : {}),
        readAt: dados.readAt ?? null,
      },
    });

  const ligarPush = () => Object.assign(process.env, VAPID);
  const desligarPush = () => {
    for (const nome of Object.keys(VAPID)) delete process.env[nome];
  };

  async function limparMovimento() {
    const { sistema } = banco;
    const meus = { email: { startsWith: PREFIXO } };
    await sistema.pushSubscription.deleteMany({ where: { OR: [{ user: meus }, { endpoint: { contains: PREFIXO } }] } });
    await sistema.notification.deleteMany({ where: { user: meus } });
    await sistema.occurrence.deleteMany({
      where: { OR: [{ openedBy: meus }, { client: { cnpj: { in: CNPJS } } }, { collection: { client: { cnpj: { in: CNPJS } } } }] },
    });
    await sistema.financialTransaction.deleteMany({ where: { client: { cnpj: { in: CNPJS } } } });
    await sistema.collection.deleteMany({ where: { client: { cnpj: { in: CNPJS } } } });
    await sistema.invoice.deleteMany({ where: { client: { cnpj: { in: CNPJS } } } });
    // As despesas somem com a viagem (ON DELETE CASCADE).
    await sistema.manifest.deleteMany({ where: { vehicle: { plate: PLACA } } });
    await sistema.auditLog.deleteMany({ where: { userName: { startsWith: PREFIXO } } });
    // Aviso de outra suite que ficou sem enviar não entra no lote destes testes.
    await sistema.notification.updateMany({ where: { pushedAt: null }, data: { pushedAt: new Date() } });
  }

  async function limpar() {
    const { sistema } = banco;
    await limparMovimento();
    await sistema.vehicle.deleteMany({ where: { plate: PLACA } });
    await sistema.driver.deleteMany({ where: { cpf: { in: [CPF, CPF_OUTRO] } } });
    await sistema.user.deleteMany({ where: { email: { startsWith: PREFIXO } } });
    await sistema.client.deleteMany({ where: { cnpj: { in: CNPJS } } });
  }

  let rastreio = 0;
  /** Uma carga do cliente, gravada direto no banco. */
  const carga = (clientId: string, extra: Record<string, unknown> = {}) =>
    banco.default.collection.create({
      data: {
        clientId,
        sender: "Remetente",
        receiver: clientId === clienteA ? "Mercado do Cliente A" : "Padaria do Cliente B",
        origin: "Rio Preto/SP",
        destination: clientId === clienteA ? "Mirassol/SP" : "Bady Bassitt/SP",
        volumes: 2,
        weight: 30,
        freightValue: 987.65,
        status: "COLLECTED",
        trackingCode: `99321${String((rastreio += 1)).padStart(5, "0")}`,
        ...extra,
      },
    });

  /** Uma viagem do motorista do teste, com uma carga de cada cliente. */
  async function viagem(statusDaViagem: "ASSEMBLING" | "ROUTE") {
    const criada = await banco.default.manifest.create({ data: { driverId: motorista, vehicleId: veiculo, status: statusDaViagem } });
    const statusDaCarga = statusDaViagem === "ROUTE" ? "ROUTE" : "COLLECTED";
    const cargaA = await carga(clienteA, { manifestId: criada.id, status: statusDaCarga });
    const cargaB = await carga(clienteB, { manifestId: criada.id, status: statusDaCarga });
    return { id: criada.id, cargaA: cargaA.id, cargaB: cargaB.id };
  }

  beforeAll(async () => {
    banco = await import("../src/lib/prisma");
    push = await import("../src/lib/notificacoes-push");
    lista = await import("../src/app/api/notificacoes/route");
    lidas = await import("../src/app/api/notificacoes/lidas/route");
    aparelho = await import("../src/app/api/notificacoes/aparelho/route");
    chave = await import("../src/app/api/notificacoes/chave/route");
    liberar = await import("../src/app/api/manifestos/[id]/liberar/route");
    cargaDaViagem = await import("../src/app/api/manifestos/[id]/coletas/[coletaId]/route");
    baixa = await import("../src/app/api/driver/entregas/[id]/baixa/route");
    status = await import("../src/app/api/dashboard/coletas/[id]/status/route");
    faturas = await import("../src/app/api/faturas/route");
    mensagens = await import("../src/app/api/ocorrencias/[id]/mensagens/route");
    chamados = await import("../src/app/api/ocorrencias/route");
    portalChamados = await import("../src/app/api/portal/atendimento/route");
    portalMensagens = await import("../src/app/api/portal/atendimento/[id]/mensagens/route");
    chamadoDoMotorista = await import("../src/app/api/driver/entregas/[id]/ocorrencia/route");
    despesas = await import("../src/app/api/driver/manifestos/[id]/despesas/route");
    portalColetas = await import("../src/app/api/portal/coletas/route");
    await limpar();

    const db = banco.default;
    clienteA = (await db.client.create({ data: { companyName: `${PREFIXO}cliente A ltda`, tradeName: `${PREFIXO}A`, cnpj: CNPJ_A } })).id;
    clienteB = (await db.client.create({ data: { companyName: `${PREFIXO}cliente B ltda`, cnpj: CNPJ_B } })).id;

    const vinculo: Partial<Record<Quem, string>> = { CLIENTE_A: clienteA, CLIENTE_A2: clienteA, CLIENTE_B: clienteB };
    for (const quem of Object.keys(PERFIL) as Quem[]) {
      ids[quem] = (
        await db.user.create({
          data: { name: `${PREFIXO}${quem}`, email: `${PREFIXO}${quem.toLowerCase()}@exemplo.br`, password: HASH_FALSO, role: PERFIL[quem], clientId: vinculo[quem] },
        })
      ).id;
    }

    const validade = new Date("2031-01-01T00:00:00.000Z");
    motorista = (await db.driver.create({ data: { userId: ids.DRIVER, cpf: CPF, cnh: CPF, cnhExpiry: validade, category: "C" } })).id;
    await db.driver.create({ data: { userId: ids.OUTRO_DRIVER, cpf: CPF_OUTRO, cnh: CPF_OUTRO, cnhExpiry: validade, category: "C" } });
    veiculo = (await db.vehicle.create({ data: { plate: PLACA, model: `${PREFIXO}caminhão`, type: "TRUCK" } })).id;

    const outra = banco.paraEmpresa(EMPRESA_OUTRA.id).db;
    clienteDaOutra = (await outra.client.create({ data: { companyName: `${PREFIXO}cliente da outra`, cnpj: CNPJ_DA_OUTRA } })).id;
    daOutra.ADMIN = (await outra.user.create({ data: { name: `${PREFIXO}admin da outra`, email: `${PREFIXO}admin-outra@exemplo.br`, password: HASH_FALSO, role: "ADMIN" } })).id;
    daOutra.CLIENTE = (
      await outra.user.create({ data: { name: `${PREFIXO}cliente da outra`, email: `${PREFIXO}cliente-outra@exemplo.br`, password: HASH_FALSO, role: "CLIENT", clientId: clienteDaOutra } })
    ).id;
  });

  beforeEach(async () => {
    sessao.mockReset();
    enviar.mockReset();
    enviar.mockResolvedValue({ statusCode: 201, body: "", headers: {} });
    desligarPush();
    await limparMovimento();
  });

  afterAll(async () => {
    desligarPush();
    if (banco) await limpar();
  });

  /* --------------------------------- Sininho -------------------------------- */

  describe("permissão", () => {
    const rotas = (): [string, () => Promise<Response>][] => [
      ["GET /api/notificacoes", () => lista.GET(req())],
      ["POST /api/notificacoes/lidas", () => lidas.POST(req("POST", { todas: true }))],
      ["GET /api/notificacoes/chave", () => chave.GET()],
      ["POST /api/notificacoes/aparelho", () => aparelho.POST(req("POST", APARELHO("sem-sessao")))],
      ["DELETE /api/notificacoes/aparelho", () => aparelho.DELETE(req("DELETE", { endpoint: APARELHO("sem-sessao").endpoint }))],
    ];

    it("sem sessão é 401 e nada é gravado", async () => {
      ligarPush();
      const aviso = await gravar(ids.ADMIN);
      entrarComo(null);
      for (const [rota, chamar] of rotas()) expect((await chamar()).status, rota).toBe(401);
      expect((await avisosDe(ids.ADMIN))[0]).toMatchObject({ id: aviso.id, readAt: null });
      expect(await inscricoes()).toEqual([]);
    });

    it("sessão de usuário que não existe mais, ou de outra empresa com o id daqui, é 401", async () => {
      ligarPush();
      sessao.mockResolvedValue({ user: { id: "00000000-0000-0000-0000-000000000000", role: "ADMIN", clientId: null } });
      for (const [rota, chamar] of rotas()) expect((await chamar()).status, rota).toBe(401);
      // O id é de um usuário da empresa padrão, mas a sessão diz outra empresa: lá ele não existe.
      sessao.mockResolvedValue({ user: { id: ids.ADMIN, role: "ADMIN", clientId: null, tenantId: EMPRESA_OUTRA.id } });
      for (const [rota, chamar] of rotas()) expect((await chamar()).status, rota).toBe(401);
    });

    it("qualquer perfil lê os próprios avisos: equipe, motorista e cliente", async () => {
      for (const quem of ["ADMIN", "OPERATION", "FINANCE", "EXPEDITION", "DRIVER", "CLIENTE_A"] as const) {
        await gravar(ids[quem], { titulo: `${PREFIXO}para ${quem}` });
        entrarComo(quem);
        const { status: codigo, corpo } = await responder<Lista>(await lista.GET(req()));
        expect(codigo, quem).toBe(200);
        expect(corpo.avisos.map((aviso) => aviso.title), quem).toEqual([`${PREFIXO}para ${quem}`]);
        expect(corpo.naoLidos, quem).toBe(1);
      }
    });
  });

  describe("lista e leitura", () => {
    it("vem do mais novo para o mais antigo, em páginas, com o total de não lidos", async () => {
      const base = Date.now() - 60_000;
      for (let i = 0; i < AVISOS_POR_PAGINA + 5; i += 1) {
        await gravar(ids.OPERATION, { titulo: `${PREFIXO}${String(i).padStart(2, "0")}`, createdAt: new Date(base + i * 1000), readAt: i < 3 ? new Date() : null });
      }
      entrarComo("OPERATION");

      const primeira = await responder<Lista>(await lista.GET(req()));
      expect(primeira.status).toBe(200);
      expect(primeira.corpo.avisos).toHaveLength(AVISOS_POR_PAGINA);
      expect(primeira.corpo.avisos[0].title).toBe(`${PREFIXO}${AVISOS_POR_PAGINA + 4}`);
      expect(primeira.corpo.naoLidos).toBe(AVISOS_POR_PAGINA + 2);
      expect(primeira.corpo.proximo).toBe(primeira.corpo.avisos[AVISOS_POR_PAGINA - 1].id);
      // Só o que a tela usa: nada de empresa, destinatário nem controle do push.
      expect(Object.keys(primeira.corpo.avisos[0]).sort()).toEqual(["body", "createdAt", "id", "readAt", "title", "type", "url"]);

      const segunda = await responder<Lista>(await lista.GET(req("GET", undefined, `cursor=${primeira.corpo.proximo}`)));
      expect(segunda.corpo.avisos.map((aviso) => aviso.title)).toEqual(["04", "03", "02", "01", "00"].map((n) => `${PREFIXO}${n}`));
      expect(segunda.corpo.proximo).toBeNull();
    });

    it("cursor de aviso de outra pessoa é recusado", async () => {
      const alheio = await gravar(ids.OPERATION_2);
      await gravar(ids.OPERATION);
      entrarComo("OPERATION");
      const { status: codigo, corpo } = await responder(await lista.GET(req("GET", undefined, `cursor=${alheio.id}`)));
      expect(codigo).toBe(400);
      expect(corpo.error).toBe("Dados inválidos.");
    });

    it("marcar como lido: validação", async () => {
      entrarComo("OPERATION");
      for (const corpo of [undefined, {}, { ids: [] }, { todas: false }, { todas: true, ids: ["x"] }]) {
        expect((await lidas.POST(req("POST", corpo))).status, JSON.stringify(corpo)).toBe(400);
      }
    });

    it("marca um, vários e todos; repetir não muda nada", async () => {
      const [a, b, c, d] = [await gravar(ids.OPERATION), await gravar(ids.OPERATION), await gravar(ids.OPERATION), await gravar(ids.OPERATION)];
      entrarComo("OPERATION");

      const um = await responder<{ marcados: number; naoLidos: number }>(await lidas.POST(req("POST", { ids: [a.id] })));
      expect(um.corpo).toEqual({ marcados: 1, naoLidos: 3 });
      const repetido = await responder<{ marcados: number; naoLidos: number }>(await lidas.POST(req("POST", { ids: [a.id] })));
      expect(repetido.corpo).toEqual({ marcados: 0, naoLidos: 3 });
      const varios = await responder<{ marcados: number; naoLidos: number }>(await lidas.POST(req("POST", { ids: [b.id, c.id, "nao-existe"] })));
      expect(varios.corpo).toEqual({ marcados: 2, naoLidos: 1 });
      const todos = await responder<{ marcados: number; naoLidos: number }>(await lidas.POST(req("POST", { todas: true })));
      expect(todos.corpo).toEqual({ marcados: 1, naoLidos: 0 });

      const gravados = await avisosDe(ids.OPERATION);
      expect(gravados.map((aviso) => aviso.id).sort()).toEqual([a.id, b.id, c.id, d.id].sort());
      for (const aviso of gravados) expect(aviso.readAt).toBeInstanceOf(Date);
    });
  });

  describe("um usuário nunca lê nem marca aviso de outro", () => {
    // Mesmo perfil na mesma empresa, outro cliente, e outra transportadora.
    const pares: [string, Quem, Quem][] = [
      ["mesmo perfil, mesma empresa", "OPERATION", "OPERATION_2"],
      ["dois usuários do mesmo cliente", "CLIENTE_A", "CLIENTE_A2"],
      ["outro cliente", "CLIENTE_A", "CLIENTE_B"],
      ["outro motorista", "DRIVER", "OUTRO_DRIVER"],
      ["administrador não lê o do operador", "ADMIN", "OPERATION"],
    ];

    for (const [caso, curioso, dono] of pares) {
      it(caso, async () => {
        const aviso = await gravar(ids[dono], { titulo: `${PREFIXO}só do dono` });
        entrarComo(curioso);

        const lido = await responder<Lista>(await lista.GET(req()));
        expect(lido.corpo).toEqual({ avisos: [], naoLidos: 0, proximo: null });

        expect((await responder(await lidas.POST(req("POST", { ids: [aviso.id] })))).corpo).toEqual({ marcados: 0, naoLidos: 0 });
        expect((await responder(await lidas.POST(req("POST", { todas: true })))).corpo).toEqual({ marcados: 0, naoLidos: 0 });
        expect((await avisosDe(ids[dono]))[0].readAt).toBeNull();

        entrarComo(dono);
        expect((await responder<Lista>(await lista.GET(req()))).corpo.naoLidos).toBe(1);
      });
    }

    it("outra transportadora: não lê, não marca, e o aviso de lá não aparece aqui", async () => {
      const daqui = await gravar(ids.ADMIN, { titulo: `${PREFIXO}da padrão` });
      const deLa = await gravar(daOutra.ADMIN, { titulo: `${PREFIXO}da outra`, tenantId: EMPRESA_OUTRA.id });

      entrarNaOutra("ADMIN");
      const naOutra = await responder<Lista>(await lista.GET(req()));
      expect(naOutra.corpo.avisos.map((aviso) => aviso.id)).toEqual([deLa.id]);
      expect((await responder(await lidas.POST(req("POST", { ids: [daqui.id] })))).corpo).toEqual({ marcados: 0, naoLidos: 1 });
      expect((await responder(await lista.GET(req("GET", undefined, `cursor=${daqui.id}`)))).status).toBe(400);

      entrarComo("ADMIN");
      const naPadrao = await responder<Lista>(await lista.GET(req()));
      expect(naPadrao.corpo.avisos.map((aviso) => aviso.id)).toEqual([daqui.id]);
      expect((await responder(await lidas.POST(req("POST", { todas: true })))).corpo).toEqual({ marcados: 1, naoLidos: 0 });
      expect((await avisosDe(daOutra.ADMIN))[0].readAt).toBeNull();
    });

    it("o banco recusa aviso apontando para usuário de outra empresa", async () => {
      await expect(
        banco.default.notification.create({ data: { userId: daOutra.ADMIN, type: "chamado.novo", title: "x", body: "x", url: "/dashboard" } }),
      ).rejects.toThrow();
      expect(await avisosDe(daOutra.ADMIN)).toEqual([]);
    });
  });

  /* --------------------------------- Gatilhos ------------------------------- */

  describe("quem é avisado de quê", () => {
    it("liberar a viagem avisa o motorista e o cliente de cada carga, cada um só da sua", async () => {
      const v = await viagem("ASSEMBLING");
      entrarComo("OPERATION");
      const res = await liberar.POST(req("POST"), ctx(v.id));
      expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);

      const doMotorista = await avisosDe(ids.DRIVER);
      expect(doMotorista).toHaveLength(1);
      expect(doMotorista[0]).toMatchObject({ type: "viagem.liberada", title: "Viagem liberada", url: `/driver/viagem/${v.id}`, readAt: null, pushedAt: null, tenantId: EMPRESA_PADRAO.id });
      expect(doMotorista[0].body).toContain("2 entregas");

      // Os dois usuários do cliente A recebem o aviso da carga A, e só dela.
      for (const quem of ["CLIENTE_A", "CLIENTE_A2"] as const) {
        const avisos = await avisosDe(ids[quem]);
        expect(avisos, quem).toHaveLength(1);
        expect(avisos[0]).toMatchObject({ type: "coleta.em-rota", title: "Saiu para entrega", url: `/portal/coletas/${v.cargaA}` });
        expect(avisos[0].body).toContain("Mercado do Cliente A, Mirassol/SP");
        expect(avisos[0].body).not.toMatch(/Cliente B|Bady|987|R\$/);
      }
      const doB = await avisosDe(ids.CLIENTE_B);
      expect(doB).toHaveLength(1);
      expect(doB[0]).toMatchObject({ type: "coleta.em-rota", url: `/portal/coletas/${v.cargaB}` });
      expect(doB[0].body).not.toMatch(/Cliente A|Mirassol|987|R\$/);

      // Quem liberou não é avisado; o outro motorista e a outra transportadora também não.
      for (const quem of ["OPERATION", "OPERATION_2", "ADMIN", "OUTRO_DRIVER"] as const) expect(await tiposDe(quem), quem).toEqual([]);
      expect(await avisosDe(daOutra.CLIENTE)).toEqual([]);
      expect(await avisosDe(daOutra.ADMIN)).toEqual([]);
    });

    it("liberação recusada não avisa ninguém", async () => {
      const v = await viagem("ROUTE");
      entrarComo("OPERATION");
      expect((await liberar.POST(req("POST"), ctx(v.id))).status).toBe(409);
      for (const quem of ["DRIVER", "CLIENTE_A", "CLIENTE_B"] as const) expect(await tiposDe(quem), quem).toEqual([]);
    });

    it("carga retirada da viagem em rota avisa o motorista; da viagem em montagem, não", async () => {
      const emRota = await viagem("ROUTE");
      entrarComo("OPERATION");
      const res = await cargaDaViagem.DELETE(req("DELETE"), { params: Promise.resolve({ id: emRota.id, coletaId: emRota.cargaB }) });
      expect(res.status).toBe(200);

      const doMotorista = await avisosDe(ids.DRIVER);
      expect(doMotorista).toHaveLength(1);
      expect(doMotorista[0]).toMatchObject({
        type: "viagem.carga-retirada",
        url: `/driver/viagem/${emRota.id}`,
        body: "A entrega para Padaria do Cliente B (Bady Bassitt/SP) saiu da sua viagem.",
      });
      // Voltar a "Coletado" não é notícia para o cliente.
      expect(await tiposDe("CLIENTE_B")).toEqual([]);

      await limparMovimento();
      const emMontagem = await viagem("ASSEMBLING");
      entrarComo("OPERATION");
      expect((await cargaDaViagem.DELETE(req("DELETE"), { params: Promise.resolve({ id: emMontagem.id, coletaId: emMontagem.cargaB }) })).status).toBe(200);
      expect(await tiposDe("DRIVER")).toEqual([]);
    });

    it("baixa do motorista avisa o cliente da carga e quem confere comprovante", async () => {
      const v = await viagem("ROUTE");
      entrarComo("DRIVER");
      const res = await baixa.POST(req("POST", { receiverName: "Maria Recebedora", receiverDoc: "123.456.789-00", photoBase64: FOTO }), ctx(v.cargaA));
      expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);

      for (const quem of ["CLIENTE_A", "CLIENTE_A2"] as const) {
        const avisos = await avisosDe(ids[quem]);
        expect(avisos.map((aviso) => aviso.type), quem).toEqual(["coleta.entregue"]);
        expect(avisos[0]).toMatchObject({ title: "Carga entregue", url: `/portal/coletas/${v.cargaA}` });
      }
      expect(await tiposDe("CLIENTE_B")).toEqual([]);

      // `comprovantes`: administrador, operação e expedição. O financeiro e o motorista (autor), não.
      expect(perfisQuePodem("comprovantes")).toEqual(expect.arrayContaining(["ADMIN", "OPERATION", "EXPEDITION"]));
      for (const quem of ["ADMIN", "OPERATION", "OPERATION_2", "EXPEDITION"] as const) {
        const avisos = await avisosDe(ids[quem]);
        expect(avisos.map((aviso) => aviso.type), quem).toEqual(["comprovante.enviado"]);
        expect(avisos[0]).toMatchObject({ url: `/dashboard/entregas/${v.cargaA}/comprovante`, body: "Mercado do Cliente A, Mirassol/SP. Recebido por Maria Recebedora." });
      }
      for (const quem of ["FINANCE", "DRIVER", "OUTRO_DRIVER"] as const) expect(await tiposDe(quem), quem).toEqual([]);

      // O reenvio da mesma baixa (fila offline do aparelho) não avisa de novo.
      entrarComo("DRIVER");
      expect((await baixa.POST(req("POST", { receiverName: "Maria Recebedora", receiverDoc: "123.456.789-00", photoBase64: FOTO }), ctx(v.cargaA))).status).toBe(200);
      expect(await tiposDe("CLIENTE_A")).toEqual(["coleta.entregue"]);
      expect(await tiposDe("ADMIN")).toEqual(["comprovante.enviado"]);
    });

    it("pedido de coleta confirmado ou recusado avisa o cliente; coletado, não", async () => {
      const confirmada = await carga(clienteA, { status: "PENDING" });
      const recusada = await carga(clienteA, { status: "PENDING" });
      entrarComo("OPERATION");
      expect((await status.POST(req("POST", { status: "CONFIRMED" }), ctx(confirmada.id))).status).toBe(200);
      expect((await status.POST(req("POST", { status: "REJECTED" }), ctx(recusada.id))).status).toBe(200);
      expect((await status.POST(req("POST", { status: "COLLECTED" }), ctx(confirmada.id))).status).toBe(200);

      const avisos = await avisosDe(ids.CLIENTE_A);
      expect(avisos.map((aviso) => [aviso.type, aviso.url])).toEqual([
        ["coleta.confirmada", `/portal/coletas/${confirmada.id}`],
        ["coleta.recusada", `/portal/coletas/${recusada.id}`],
      ]);
      expect(await tiposDe("CLIENTE_A2")).toEqual(["coleta.confirmada", "coleta.recusada"]);
      expect(await tiposDe("CLIENTE_B")).toEqual([]);
      expect(await tiposDe("OPERATION")).toEqual([]);
    });

    it("fatura emitida avisa os usuários do cliente, sem o valor", async () => {
      const entregue = await carga(clienteA, { status: "DELIVERED" });
      entrarComo("ADMIN");
      const res = await faturas.POST(req("POST", { clientId: clienteA, collectionIds: [entregue.id], dueDate: "2026-11-05" }));
      expect(res.status, JSON.stringify(await res.clone().json())).toBe(201);
      const fatura = (await res.json()) as { number: number };

      for (const quem of ["CLIENTE_A", "CLIENTE_A2"] as const) {
        const avisos = await avisosDe(ids[quem]);
        expect(avisos, quem).toHaveLength(1);
        expect(avisos[0]).toMatchObject({ type: "fatura.emitida", title: `Fatura nº ${fatura.number} emitida`, body: "1 carga, vencimento em 05/11/2026.", url: "/portal/faturas" });
        expect(`${avisos[0].title} ${avisos[0].body}`).not.toMatch(/987|R\$/);
      }
      expect(await tiposDe("CLIENTE_B")).toEqual([]);
      expect(await tiposDe("ADMIN")).toEqual([]);
      expect(await tiposDe("FINANCE")).toEqual([]);
    });

    it("chamado aberto no portal avisa quem atende chamados; a resposta da equipe avisa o cliente; nota interna, não", async () => {
      entrarComo("CLIENTE_A");
      const aberto = await responder<{ id: string; number: number }>(
        await portalChamados.POST(req("POST", { type: "DELAY", title: `${PREFIXO}carga atrasada`, description: "Era para ter chegado ontem." })),
      );
      expect(aberto.status, JSON.stringify(aberto.corpo)).toBe(201);
      const { id, number } = aberto.corpo;

      // `ocorrencias`: administrador, operação e expedição têm; o financeiro não.
      for (const quem of ["ADMIN", "OPERATION", "OPERATION_2", "EXPEDITION"] as const) {
        const avisos = await avisosDe(ids[quem]);
        expect(avisos.map((aviso) => aviso.type), quem).toEqual(["chamado.novo"]);
        expect(avisos[0]).toMatchObject({ title: `Chamado nº ${number} aberto pelo cliente`, body: `${PREFIXO}carga atrasada`, url: `/dashboard/ocorrencias/${id}` });
      }
      for (const quem of ["FINANCE", "CLIENTE_A", "CLIENTE_A2", "CLIENTE_B", "DRIVER"] as const) expect(await tiposDe(quem), quem).toEqual([]);

      // Nota interna: o cliente não fica sabendo de nada.
      entrarComo("OPERATION");
      expect((await mensagens.POST(req("POST", { body: "O cliente está devendo, cuidado.", internal: true }), ctx(id))).status).toBe(201);
      expect(await tiposDe("CLIENTE_A")).toEqual([]);

      // Resposta: os usuários do cliente dono do chamado, e só eles. O texto é o título do chamado, não a mensagem.
      expect((await mensagens.POST(req("POST", { body: "Já estamos vendo com o motorista." }), ctx(id))).status).toBe(201);
      for (const quem of ["CLIENTE_A", "CLIENTE_A2"] as const) {
        const avisos = await avisosDe(ids[quem]);
        expect(avisos.map((aviso) => aviso.type), quem).toEqual(["chamado.resposta"]);
        expect(avisos[0]).toMatchObject({ title: `Resposta no atendimento nº ${number}`, body: `${PREFIXO}carga atrasada`, url: `/portal/atendimento/${id}` });
      }
      expect(await tiposDe("CLIENTE_B")).toEqual([]);
      // A resposta não gera aviso para a equipe.
      expect(await tiposDe("OPERATION_2")).toEqual(["chamado.novo"]);
    });

    it("chamado só da equipe (sem cliente) não avisa cliente nenhum", async () => {
      entrarComo("OPERATION");
      const aberto = await responder<{ id: string }>(await chamados.POST(req("POST", { type: "OTHER", title: `${PREFIXO}interno`, description: "Assunto da equipe." })));
      expect(aberto.status, JSON.stringify(aberto.corpo)).toBe(201);
      expect((await mensagens.POST(req("POST", { body: "Resposta num chamado interno." }), ctx(aberto.corpo.id))).status).toBe(201);
      for (const quem of ["CLIENTE_A", "CLIENTE_A2", "CLIENTE_B", "ADMIN", "OPERATION_2"] as const) expect(await tiposDe(quem), quem).toEqual([]);
    });

    it("resposta do cliente avisa o responsável do chamado; sem responsável, quem atende chamados", async () => {
      entrarComo("CLIENTE_A");
      const { corpo } = await responder<{ id: string; number: number }>(
        await portalChamados.POST(req("POST", { type: "DELAY", title: `${PREFIXO}sem responsável`, description: "Cadê a carga?" })),
      );
      await banco.sistema.notification.deleteMany({ where: { user: { email: { startsWith: PREFIXO } } } });

      entrarComo("CLIENTE_A");
      expect((await portalMensagens.POST(req("POST", { body: "Alguma novidade?" }), ctx(corpo.id))).status).toBe(201);
      for (const quem of ["ADMIN", "OPERATION", "OPERATION_2", "EXPEDITION"] as const) {
        const avisos = await avisosDe(ids[quem]);
        expect(avisos.map((aviso) => aviso.type), quem).toEqual(["chamado.resposta-do-cliente"]);
        expect(avisos[0]).toMatchObject({ title: `Cliente respondeu no chamado nº ${corpo.number}`, url: `/dashboard/ocorrencias/${corpo.id}` });
      }
      for (const quem of ["FINANCE", "CLIENTE_A", "CLIENTE_A2"] as const) expect(await tiposDe(quem), quem).toEqual([]);

      // Com responsável: só ele.
      await banco.sistema.notification.deleteMany({ where: { user: { email: { startsWith: PREFIXO } } } });
      await banco.default.occurrence.update({ where: { id: corpo.id }, data: { assigneeId: ids.OPERATION_2 } });
      entrarComo("CLIENTE_A");
      expect((await portalMensagens.POST(req("POST", { body: "E agora?" }), ctx(corpo.id))).status).toBe(201);
      expect(await tiposDe("OPERATION_2")).toEqual(["chamado.resposta-do-cliente"]);
      for (const quem of ["ADMIN", "OPERATION", "EXPEDITION", "FINANCE"] as const) expect(await tiposDe(quem), quem).toEqual([]);

      // Cliente B não responde no chamado do A, e ninguém é avisado.
      await banco.sistema.notification.deleteMany({ where: { user: { email: { startsWith: PREFIXO } } } });
      entrarComo("CLIENTE_B");
      expect((await portalMensagens.POST(req("POST", { body: "Invasão" }), ctx(corpo.id))).status).toBe(404);
      expect(await tiposDe("OPERATION_2")).toEqual([]);
    });

    it("ocorrência e despesa do motorista avisam a equipe certa", async () => {
      const v = await viagem("ROUTE");
      entrarComo("DRIVER");
      const ocorrencia = await responder<{ id: string; number: number }>(await chamadoDoMotorista.POST(req("POST", { type: "DAMAGE", description: "Caixa amassada." }), ctx(v.cargaA)));
      expect(ocorrencia.status, JSON.stringify(ocorrencia.corpo)).toBe(201);
      const despesa = await despesas.POST(req("POST", { type: "TOLL", amount: 35.5, date: "2026-10-10" }), ctx(v.id));
      expect(despesa.status, JSON.stringify(await despesa.clone().json())).toBe(201);

      // Chamado: quem tem `ocorrencias`. Despesa: quem tem `financeiro` (administrador e financeiro).
      expect(await tiposDe("OPERATION")).toEqual(["chamado.novo"]);
      expect(await tiposDe("EXPEDITION")).toEqual(["chamado.novo"]);
      expect(await tiposDe("FINANCE")).toEqual(["despesa.lancada"]);
      expect((await tiposDe("ADMIN")).sort()).toEqual(["chamado.novo", "despesa.lancada"]);

      const doAdmin = await avisosDe(ids.ADMIN);
      expect(doAdmin.find((aviso) => aviso.type === "chamado.novo")).toMatchObject({
        title: `Chamado nº ${ocorrencia.corpo.number} aberto pelo motorista`,
        url: `/dashboard/ocorrencias/${ocorrencia.corpo.id}`,
      });
      const daDespesa = doAdmin.find((aviso) => aviso.type === "despesa.lancada");
      expect(daDespesa).toMatchObject({ title: "Despesa de viagem para aprovar", url: "/dashboard/manifestos" });
      expect(daDespesa?.body).toMatch(new RegExp(`^${PREFIXO}DRIVER lançou pedágio de R\\$\\s35,50\\.$`));

      // O motorista (autor) e os clientes não recebem nada: chamado do motorista é só da equipe.
      for (const quem of ["DRIVER", "OUTRO_DRIVER", "CLIENTE_A", "CLIENTE_B"] as const) expect(await tiposDe(quem), quem).toEqual([]);
    });

    it("pedido de coleta pelo portal avisa quem confirma coleta", async () => {
      entrarComo("CLIENTE_A");
      const res = await portalColetas.POST(req("POST", { sender: "Remetente", receiver: "Mercado", origin: "Rio Preto/SP", destination: "Mirassol/SP", volumes: 2, weight: 30 }));
      expect(res.status, JSON.stringify(await res.clone().json())).toBe(201);

      // `coletas`: administrador e operação. Expedição e financeiro não confirmam coleta.
      for (const quem of ["ADMIN", "OPERATION", "OPERATION_2"] as const) {
        const avisos = await avisosDe(ids[quem]);
        expect(avisos.map((aviso) => aviso.type), quem).toEqual(["coleta.pedida"]);
        expect(avisos[0]).toMatchObject({ title: "Novo pedido de coleta", body: `${PREFIXO}A: Rio Preto/SP → Mirassol/SP.`, url: "/dashboard/coletas/pendentes" });
      }
      for (const quem of ["EXPEDITION", "FINANCE", "CLIENTE_A", "CLIENTE_A2", "CLIENTE_B"] as const) expect(await tiposDe(quem), quem).toEqual([]);
    });

    it("o que acontece na outra transportadora avisa só quem é de lá", async () => {
      const outra = banco.paraEmpresa(EMPRESA_OUTRA.id).db;
      const cargaDeLa = await outra.collection.create({
        data: { clientId: clienteDaOutra, sender: "Remetente", receiver: "Loja de lá", origin: "Campinas/SP", destination: "Jundiaí/SP", volumes: 1, weight: 5, status: "PENDING", trackingCode: "9932199999" },
      });
      entrarNaOutra("ADMIN");
      expect((await status.POST(req("POST", { status: "CONFIRMED" }), ctx(cargaDeLa.id))).status).toBe(200);

      const deLa = await avisosDe(daOutra.CLIENTE);
      expect(deLa).toHaveLength(1);
      expect(deLa[0]).toMatchObject({ type: "coleta.confirmada", tenantId: EMPRESA_OUTRA.id, url: `/portal/coletas/${cargaDeLa.id}` });
      for (const quem of Object.keys(PERFIL) as Quem[]) expect(await tiposDe(quem), quem).toEqual([]);

      // E a carga de lá não muda de status por um operador daqui.
      const pendente = await outra.collection.create({
        data: { clientId: clienteDaOutra, sender: "Remetente", receiver: "Loja de lá", origin: "Campinas/SP", destination: "Jundiaí/SP", volumes: 1, weight: 5, status: "PENDING", trackingCode: "9932199998" },
      });
      entrarComo("OPERATION");
      expect((await status.POST(req("POST", { status: "CONFIRMED" }), ctx(pendente.id))).status).toBe(404);
      expect(await avisosDe(daOutra.CLIENTE)).toHaveLength(1);
    });
  });

  /* ---------------------------------- Push ---------------------------------- */

  describe("push: chave e aparelhos", () => {
    it("sem as variáveis VAPID o push está desligado: a chave vem nula e o aparelho não é inscrito", async () => {
      entrarComo("OPERATION");
      expect((await responder(await chave.GET())).corpo).toEqual({ ativo: false, chave: null });
      const { status: codigo, corpo } = await responder(await aparelho.POST(req("POST", APARELHO("desligado"))));
      expect(codigo).toBe(409);
      expect(corpo.error).toContain("não estão ligadas");
      expect(await inscricoes()).toEqual([]);
    });

    it("com as variáveis, qualquer perfil recebe a chave pública (nunca a privada)", async () => {
      ligarPush();
      for (const quem of ["ADMIN", "CLIENTE_A", "DRIVER"] as const) {
        entrarComo(quem);
        const res = await chave.GET();
        const texto = await res.clone().text();
        expect(await res.json(), quem).toEqual({ ativo: true, chave: CHAVE_PUBLICA });
        expect(texto).not.toContain(CHAVE_PRIVADA);
      }
    });

    it("inscrição: validação", async () => {
      ligarPush();
      entrarComo("OPERATION");
      const casos: [unknown, string][] = [
        [undefined, "Dados inválidos."],
        [{}, "Dados inválidos."],
        [{ ...APARELHO("x"), endpoint: "https://127.0.0.1:5432/interno" }, SERVICO_DESCONHECIDO],
        [{ ...APARELHO("x"), endpoint: "http://fcm.googleapis.com/fcm/send/x" }, SERVICO_DESCONHECIDO],
        [{ endpoint: APARELHO("x").endpoint }, "Dados inválidos."],
        [{ ...APARELHO("x"), keys: { p256dh: "", auth: "a" } }, "Dados inválidos."],
      ];
      for (const [corpo, mensagem] of casos) {
        const lido = await responder(await aparelho.POST(req("POST", corpo)));
        expect(lido.status, JSON.stringify(corpo)).toBe(400);
        expect(lido.corpo.error, JSON.stringify(corpo)).toBe(mensagem);
      }
      expect((await aparelho.DELETE(req("DELETE", {}))).status).toBe(400);
      expect(await inscricoes()).toEqual([]);
    });

    it("inscreve o aparelho de quem está logado; repetir só atualiza as chaves", async () => {
      ligarPush();
      entrarComo("OPERATION");
      const primeira = await responder(await aparelho.POST(req("POST", APARELHO("celular"))));
      expect(primeira.status, JSON.stringify(primeira.corpo)).toBe(201);
      expect(primeira.corpo).toEqual({ ativo: true });

      const troca = { ...APARELHO("celular"), keys: { p256dh: "BOutraChave", auth: "outroSegredo" } };
      expect((await aparelho.POST(req("POST", troca))).status).toBe(201);

      const gravadas = await inscricoes();
      expect(gravadas).toHaveLength(1);
      expect(gravadas[0]).toMatchObject({
        tenantId: EMPRESA_PADRAO.id,
        userId: ids.OPERATION,
        endpoint: APARELHO("celular").endpoint,
        p256dh: "BOutraChave",
        auth: "outroSegredo",
        userAgent: "Safari no iPhone",
      });
    });

    it("um aparelho é de uma pessoa só: quem entra nele depois leva a inscrição, na mesma empresa ou em outra", async () => {
      ligarPush();
      entrarComo("OPERATION");
      expect((await aparelho.POST(req("POST", APARELHO("compartilhado")))).status).toBe(201);

      entrarComo("OPERATION_2");
      expect((await aparelho.POST(req("POST", APARELHO("compartilhado")))).status).toBe(201);
      let gravadas = await inscricoes();
      expect(gravadas.map((i) => [i.tenantId, i.userId])).toEqual([[EMPRESA_PADRAO.id, ids.OPERATION_2]]);

      entrarNaOutra("CLIENTE");
      expect((await aparelho.POST(req("POST", APARELHO("compartilhado")))).status).toBe(201);
      gravadas = await inscricoes();
      expect(gravadas.map((i) => [i.tenantId, i.userId])).toEqual([[EMPRESA_OUTRA.id, daOutra.CLIENTE]]);
    });

    it("desligar: só a própria inscrição sai", async () => {
      ligarPush();
      entrarComo("OPERATION");
      expect((await aparelho.POST(req("POST", APARELHO("do-operador")))).status).toBe(201);
      const endpoint = APARELHO("do-operador").endpoint;

      // Outra pessoa da mesma empresa, um cliente e alguém de outra transportadora: nada sai.
      for (const entrar of [() => entrarComo("OPERATION_2"), () => entrarComo("CLIENTE_A"), () => entrarNaOutra("ADMIN")]) {
        entrar();
        expect((await responder(await aparelho.DELETE(req("DELETE", { endpoint })))).corpo).toEqual({ ativo: false });
        expect(await inscricoes()).toHaveLength(1);
      }

      entrarComo("OPERATION");
      expect((await aparelho.DELETE(req("DELETE", { endpoint }))).status).toBe(200);
      expect(await inscricoes()).toEqual([]);
    });

    it("apagar o usuário leva junto os avisos e os aparelhos dele", async () => {
      ligarPush();
      const temporario = await banco.default.user.create({ data: { name: `${PREFIXO}temporário`, email: `${PREFIXO}temporario@exemplo.br`, password: HASH_FALSO, role: "OPERATION" } });
      await gravar(temporario.id);
      sessao.mockResolvedValue({ user: { id: temporario.id, role: "OPERATION", clientId: null } });
      expect((await aparelho.POST(req("POST", APARELHO("temporario")))).status).toBe(201);

      await banco.sistema.user.delete({ where: { id: temporario.id } });
      expect(await avisosDe(temporario.id)).toEqual([]);
      expect(await inscricoes()).toEqual([]);
    });
  });

  describe("push: envio pelo despachante", () => {
    /** Inscreve um aparelho pela rota, como a pessoa informada. */
    async function inscrever(entrar: () => unknown, nome: string) {
      entrar();
      const res = await aparelho.POST(req("POST", APARELHO(nome)));
      expect(res.status).toBe(201);
      return APARELHO(nome).endpoint;
    }
    const enviadosPara = () => enviar.mock.calls.map(([inscricao, corpo]) => [inscricao.endpoint, (JSON.parse(String(corpo)) as { id: string }).id]);
    const pendentes = async (userId: string) => (await avisosDe(userId)).filter((aviso) => aviso.pushedAt === null).length;

    it("com o push desligado nada é enviado e o aviso continua pendente", async () => {
      await gravar(ids.OPERATION);
      expect(await push.enviarPushPendentes()).toEqual({ enviados: 0, falhas: 0, apagadas: 0 });
      expect(enviar).not.toHaveBeenCalled();
      expect(await pendentes(ids.OPERATION)).toBe(1);
    });

    it("cada aviso vai para os aparelhos do destinatário, e só para eles; não repete", async () => {
      ligarPush();
      const celular = await inscrever(() => entrarComo("OPERATION"), "op-celular");
      const computador = await inscrever(() => entrarComo("OPERATION"), "op-computador");
      const doColega = await inscrever(() => entrarComo("OPERATION_2"), "colega");
      const doCliente = await inscrever(() => entrarComo("CLIENTE_B"), "cliente-b");
      const daOutraEmpresa = await inscrever(() => entrarNaOutra("ADMIN"), "outra-empresa");

      const paraOperador = await gravar(ids.OPERATION, { titulo: `${PREFIXO}do operador` });
      const paraColega = await gravar(ids.OPERATION_2, { titulo: `${PREFIXO}do colega` });
      const paraOutra = await gravar(daOutra.ADMIN, { titulo: `${PREFIXO}da outra`, tenantId: EMPRESA_OUTRA.id });
      // Sem aparelho: fica só no sininho.
      await gravar(ids.CLIENTE_A);

      expect(await push.enviarPushPendentes()).toEqual({ enviados: 4, falhas: 0, apagadas: 0 });
      expect(enviadosPara().sort()).toEqual(
        [
          [celular, paraOperador.id],
          [computador, paraOperador.id],
          [doColega, paraColega.id],
          [daOutraEmpresa, paraOutra.id],
        ].sort(),
      );
      // O aparelho do cliente B não recebeu nada: nenhum aviso era dele.
      expect(enviadosPara().some(([endpoint]) => endpoint === doCliente)).toBe(false);

      const [inscricao, corpo, opcoes] = enviar.mock.calls.find(([i]) => i.endpoint === celular)!;
      expect(inscricao).toEqual({ endpoint: celular, keys: APARELHO("op-celular").keys });
      expect(JSON.parse(String(corpo))).toEqual({ id: paraOperador.id, titulo: `${PREFIXO}do operador`, texto: "Texto do aviso", url: "/dashboard/ocorrencias/1" });
      expect(opcoes).toMatchObject({ vapidDetails: { publicKey: CHAVE_PUBLICA, privateKey: CHAVE_PRIVADA, subject: "mailto:suporte@exemplo.br" }, TTL: 86_400 });

      for (const userId of [ids.OPERATION, ids.OPERATION_2, ids.CLIENTE_A, daOutra.ADMIN]) expect(await pendentes(userId)).toBe(0);

      // Segunda volta: nada pendente, nada enviado.
      enviar.mockClear();
      expect(await push.enviarPushPendentes()).toEqual({ enviados: 0, falhas: 0, apagadas: 0 });
      expect(enviar).not.toHaveBeenCalled();
    });

    it("o aviso gerado por uma ação de verdade sai por push para o aparelho de quem o recebe", async () => {
      ligarPush();
      const doMotorista = await inscrever(() => entrarComo("DRIVER"), "motorista");
      const doClienteA = await inscrever(() => entrarComo("CLIENTE_A"), "cliente-a");
      const doOutroMotorista = await inscrever(() => entrarComo("OUTRO_DRIVER"), "outro-motorista");

      const v = await viagem("ASSEMBLING");
      entrarComo("OPERATION");
      expect((await liberar.POST(req("POST"), ctx(v.id))).status).toBe(200);

      expect(await push.enviarPushPendentes()).toMatchObject({ enviados: 2, falhas: 0 });
      const recebido = Object.fromEntries(enviar.mock.calls.map(([inscricao, corpo]) => [inscricao.endpoint, JSON.parse(String(corpo)) as { titulo: string; url: string }]));
      expect(Object.keys(recebido).sort()).toEqual([doClienteA, doMotorista].sort());
      expect(recebido[doMotorista]).toMatchObject({ titulo: "Viagem liberada", url: `/driver/viagem/${v.id}` });
      expect(recebido[doClienteA]).toMatchObject({ titulo: "Saiu para entrega", url: `/portal/coletas/${v.cargaA}` });
      expect(recebido[doOutroMotorista]).toBeUndefined();
    });

    it("inscrição morta (404 ou 410) é apagada; outra falha fica, e nenhuma é tentada de novo", async () => {
      ligarPush();
      const vivo = await inscrever(() => entrarComo("OPERATION"), "vivo");
      const sumiu = await inscrever(() => entrarComo("OPERATION"), "sumiu-410");
      const naoExiste = await inscrever(() => entrarComo("OPERATION"), "sumiu-404");
      const instavel = await inscrever(() => entrarComo("OPERATION"), "instavel-500");
      await gravar(ids.OPERATION);

      const recusa = (statusCode: number) => Object.assign(new Error("Received unexpected response code"), { statusCode });
      enviar.mockImplementation(async (inscricao) => {
        if (inscricao.endpoint === sumiu) throw recusa(410);
        if (inscricao.endpoint === naoExiste) throw recusa(404);
        if (inscricao.endpoint === instavel) throw recusa(500);
        return { statusCode: 201, body: "", headers: {} };
      });

      expect(await push.enviarPushPendentes()).toEqual({ enviados: 1, falhas: 1, apagadas: 2 });
      expect((await inscricoes()).map((i) => i.endpoint).sort()).toEqual([instavel, vivo].sort());

      // Uma tentativa por aviso e por aparelho: a falha não volta para a fila.
      enviar.mockClear();
      expect(await push.enviarPushPendentes()).toEqual({ enviados: 0, falhas: 0, apagadas: 0 });
      expect(enviar).not.toHaveBeenCalled();
      expect(await pendentes(ids.OPERATION)).toBe(0);
    });

    it("erro sem resposta (rede) conta como falha e não derruba o lote", async () => {
      ligarPush();
      const primeiro = await inscrever(() => entrarComo("OPERATION"), "rede-fora");
      const segundo = await inscrever(() => entrarComo("OPERATION_2"), "rede-ok");
      await gravar(ids.OPERATION, { createdAt: new Date(Date.now() - 5000) });
      await gravar(ids.OPERATION_2);
      enviar.mockImplementation(async (inscricao) => {
        if (inscricao.endpoint === primeiro) throw new Error("socket hang up");
        return { statusCode: 201, body: "", headers: {} };
      });

      expect(await push.enviarPushPendentes()).toEqual({ enviados: 1, falhas: 1, apagadas: 0 });
      expect((await inscricoes()).map((i) => i.endpoint).sort()).toEqual([segundo, primeiro].sort());
    });

    it("aviso já lido ou velho demais não toca o celular, mas sai da fila", async () => {
      ligarPush();
      await inscrever(() => entrarComo("OPERATION"), "leitor");
      await gravar(ids.OPERATION, { titulo: `${PREFIXO}lido`, readAt: new Date() });
      await gravar(ids.OPERATION, { titulo: `${PREFIXO}velho`, createdAt: new Date(Date.now() - 2 * 3_600_000) });
      const novo = await gravar(ids.OPERATION, { titulo: `${PREFIXO}novo` });

      expect(await push.enviarPushPendentes()).toEqual({ enviados: 1, falhas: 0, apagadas: 0 });
      expect(enviadosPara().map(([, id]) => id)).toEqual([novo.id]);
      expect(await pendentes(ids.OPERATION)).toBe(0);
    });

    it("dois despachantes ao mesmo tempo não mandam o mesmo aviso duas vezes", async () => {
      ligarPush();
      await inscrever(() => entrarComo("OPERATION"), "concorrente");
      for (let i = 0; i < 6; i += 1) await gravar(ids.OPERATION, { titulo: `${PREFIXO}${i}` });

      const voltas = await Promise.all([push.enviarPushPendentes(), push.enviarPushPendentes(), push.enviarPushPendentes()]);
      expect(voltas.reduce((soma, volta) => soma + volta.enviados, 0)).toBe(6);
      const idsEnviados = enviadosPara().map(([, id]) => id);
      expect(new Set(idsEnviados).size).toBe(6);
      expect(idsEnviados).toHaveLength(6);
    });
  });
});
