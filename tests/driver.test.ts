import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getServerSession } from "next-auth";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DELIVERED_BY_PANEL_MESSAGE,
  DELIVERY_NOT_FOUND_MESSAGE,
  MAX_PHOTO_CHARS,
  MAX_SIGNATURE_CHARS,
  NOT_IN_ROUTE_MESSAGE,
  PHOTO_MESSAGE,
  PHOTO_TOO_BIG,
  baixaSchema,
  photoProblem,
  resolvePhotoType,
  sniffPhotoType,
} from "../src/lib/entregas";
import {
  type PendingBaixa,
  DRIVER_BLOCKED_FALLBACK,
  UNKNOWN_OWNER_REASON,
  blockedMessage,
  buildPending,
  checkSession,
  classifyBaixaResponse,
  flushQueue,
  isDriverBlocked,
  needsLogin,
  readPending,
  readSessionCheck,
  resolveSyncOwner,
  summarizePending,
} from "../src/lib/offline-queue";
import { createStrokeTracker } from "../src/lib/assinatura";

/**
 * Aplicativo do motorista: a baixa de entrega pela viagem e a lista de viagens,
 * contra um Postgres de verdade, no padrão de `manifestos.test.ts` (sessão
 * simulada, handlers reais).
 *
 * A regra de reenvio da fila offline é testada à parte, sem banco e sem
 * navegador. Sem DATABASE_URL a parte de integração é pulada com aviso — no CI
 * ela sempre roda.
 */
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
// Fora do Next, `notFound` e `redirect` viram erros com nome, para a página do
// comprovante poder ser chamada como função.
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));

const temBanco = Boolean(process.env.DATABASE_URL);

if (!temBanco) {
  console.warn(
    "\n[driver.test] DATABASE_URL ausente: testes de integração PULADOS.\n" +
      "Rode com um Postgres real para exercitá-los.\n",
  );
}

const suite = temBanco ? describe : describe.skip;

describe("fila offline: o que fazer com a resposta do servidor", () => {
  it.each([200, 201])("%i → sent", (status) => {
    expect(classifyBaixaResponse(status)).toBe("sent");
  });

  it.each([400, 404, 409, 413, 422])("%i → rejected", (status) => {
    expect(classifyBaixaResponse(status)).toBe("rejected");
  });

  it.each([500, 502, 503])("%i → retry", (status) => {
    expect(classifyBaixaResponse(status)).toBe("retry");
  });

  // Sessão caída ou servidor pedindo para esperar não é recusa da baixa: o
  // comprovante não pode sumir do aparelho.
  it.each([401, 403, 408, 429])("%i → retry", (status) => {
    expect(classifyBaixaResponse(status)).toBe("retry");
  });

  it("só 401 pede novo login", () => {
    expect(needsLogin(401)).toBe(true);
    expect([200, 400, 403, 404, 408, 409, 429, 500].map(needsLogin)).toEqual(Array(8).fill(false));
  });

  // 403 vem com a sessão válida (motorista inativo ou sem cadastro): mandar
  // entrar de novo não resolve.
  it("só 403 é cadastro parado", () => {
    expect(isDriverBlocked(403)).toBe(true);
    expect([200, 400, 401, 404, 408, 409, 429, 500].map(isDriverBlocked)).toEqual(Array(8).fill(false));
  });
});

describe("fila offline: reenvio", () => {
  const EU = "user-ana";
  const OUTRO = "user-beto";
  const item = (collectionId: string, userId: string | null = EU): PendingBaixa =>
    buildPending(collectionId, { receiverName: "Maria" }, userId, 1);
  const vazio = { sent: 0, rejected: [], stillPending: 0, needsLogin: false, blocked: [] };

  // Fila em memória no lugar do IndexedDB, e respostas combinadas no lugar da
  // rede. `donos` diz de quem é cada baixa; sem isso, é de quem está logado.
  function fila(
    respostas: Record<string, number | Error>,
    corpos: Record<string, unknown> = {},
    donos: Record<string, string | null> = {},
  ) {
    const itens = new Map(
      Object.keys(respostas).map((id) => [id, item(id, id in donos ? donos[id] : EU)]),
    );
    const enviados: string[] = [];
    return {
      itens,
      enviados,
      io: {
        list: async () => [...itens.values()],
        send: async (pendente: PendingBaixa) => {
          enviados.push(pendente.collectionId);
          const resposta = respostas[pendente.collectionId];
          if (resposta instanceof Error) throw resposta;
          return {
            status: resposta,
            json: async () => {
              if (!(pendente.collectionId in corpos)) throw new Error("sem corpo");
              return corpos[pendente.collectionId];
            },
          };
        },
        // O mapa do teste é indexado pela coleta; a fila remove pela chave do item.
        remove: async (id: string) => {
          for (const [coleta, pendente] of itens) if (pendente.id === id) itens.delete(coleta);
        },
      },
    };
  }

  it("401 (sessão expirada): o comprovante continua no aparelho e pede login", async () => {
    const { io, itens } = fila({ "coleta-1": 401 });

    expect(await flushQueue(EU, io)).toEqual({ ...vazio, stillPending: 1, needsLogin: true });
    expect([...itens.keys()]).toEqual(["coleta-1"]);
    expect(itens.get("coleta-1")?.payload).toEqual({ receiverName: "Maria" });
  });

  it("403 (motorista inativo): fica no aparelho, não pede login e avisa o motivo do servidor", async () => {
    const { io, itens } = fila({ "coleta-1": 403 }, { "coleta-1": { error: "Motorista inativo." } });

    const resultado = await flushQueue(EU, io);

    expect(resultado).toEqual({
      ...vazio,
      stillPending: 1,
      blocked: [
        {
          id: `${EU}:coleta-1`,
          collectionId: "coleta-1",
          reason: blockedMessage("Motorista inativo."),
          receiverName: "Maria",
        },
      ],
    });
    expect(resultado.blocked[0].reason).toContain("Motorista inativo.");
    expect(resultado.blocked[0].reason).not.toContain("entre de novo");
    expect(itens.get("coleta-1")?.payload).toEqual({ receiverName: "Maria" });
  });

  it("403 sem corpo: fica presa com um motivo padrão", async () => {
    const { io, itens } = fila({ "coleta-1": 403 });

    expect((await flushQueue(EU, io)).blocked).toEqual([
      {
        id: `${EU}:coleta-1`,
        collectionId: "coleta-1",
        reason: blockedMessage(DRIVER_BLOCKED_FALLBACK),
        receiverName: "Maria",
      },
    ]);
    expect(itens.size).toBe(1);
  });

  it("baixa presa leva o nome do recebedor, para o motorista saber qual é; sem nome, vai sem", async () => {
    const presas = async (payload: Record<string, unknown>) =>
      (
        await flushQueue(EU, {
          list: async () => [buildPending("coleta-1", payload, EU, 1), buildPending("antiga", payload, null, 2)],
          send: async (pendente) => ({ status: pendente.userId ? 403 : 404, json: async () => ({}) }),
          remove: async () => undefined,
        })
      ).blocked.map((presa) => presa.receiverName);

    expect(await presas({ receiverName: "  José Lima " })).toEqual(["José Lima", "José Lima"]);
    expect(await presas({})).toEqual([null, null]);
    expect(await presas({ receiverName: "   " })).toEqual([null, null]);
    expect(await presas({ receiverName: 7 })).toEqual([null, null]);
  });

  it("baixa de outro motorista no mesmo aparelho não é enviada nem apagada", async () => {
    // O servidor responderia 404 (a entrega não é de quem está logado) e a
    // recusa apagaria o comprovante do outro.
    const { io, itens, enviados } = fila(
      { minha: 200, "do-outro": 404 },
      {},
      { "do-outro": OUTRO },
    );

    expect(await flushQueue(EU, io)).toEqual({ ...vazio, sent: 1 });
    expect(enviados).toEqual(["minha"]);
    expect([...itens.keys()]).toEqual(["do-outro"]);
    expect(itens.get("do-outro")?.payload).toEqual({ receiverName: "Maria" });

    // Quando o dono entra, a baixa dele sobe.
    const doDono = fila({ "do-outro": 200 }, {}, { "do-outro": OUTRO });
    expect(await flushQueue(OUTRO, doDono.io)).toEqual({ ...vazio, sent: 1 });
    expect(doDono.itens.size).toBe(0);
  });

  it("baixa sem dono (versão anterior) sobe na sessão de quem está logado", async () => {
    const { io, itens } = fila({ antiga: 200 }, {}, { antiga: null });

    expect(await flushQueue(EU, io)).toEqual({ ...vazio, sent: 1 });
    expect(itens.size).toBe(0);
  });

  it("baixa sem dono com 404 pode ser de outro motorista: fica presa em vez de ser apagada", async () => {
    const { io, itens } = fila(
      { antiga: 404, minha: 404 },
      { antiga: { error: DELIVERY_NOT_FOUND_MESSAGE }, minha: { error: DELIVERY_NOT_FOUND_MESSAGE } },
      { antiga: null },
    );

    expect(await flushQueue(EU, io)).toEqual({
      ...vazio,
      stillPending: 1,
      rejected: [{ collectionId: "minha", reason: DELIVERY_NOT_FOUND_MESSAGE }],
      blocked: [{ id: "antiga", collectionId: "antiga", reason: UNKNOWN_OWNER_REASON, receiverName: "Maria" }],
    });
    expect([...itens.keys()]).toEqual(["antiga"]);
  });

  it("baixa sem dono recusada por outro motivo sai da fila, como antes", async () => {
    const { io, itens } = fila({ antiga: 409 }, { antiga: { error: NOT_IN_ROUTE_MESSAGE } }, { antiga: null });

    expect((await flushQueue(EU, io)).rejected).toEqual([{ collectionId: "antiga", reason: NOT_IN_ROUTE_MESSAGE }]);
    expect(itens.size).toBe(0);
  });

  it.each([408, 429, 500, 503])("%i: continua na fila, sem pedir login", async (status) => {
    const { io, itens } = fila({ "coleta-1": status });

    expect(await flushQueue(EU, io)).toEqual({ ...vazio, stillPending: 1 });
    expect(itens.size).toBe(1);
  });

  it("falha de rede: continua na fila", async () => {
    const { io, itens } = fila({ "coleta-1": new TypeError("Failed to fetch") });

    expect(await flushQueue(EU, io)).toEqual({ ...vazio, stillPending: 1 });
    expect(itens.size).toBe(1);
  });

  it("cada item tem o seu destino: enviado sai, recusado sai com o motivo, o resto fica", async () => {
    const { io, itens, enviados } = fila(
      { enviada: 200, recusada: 409, "sem-motivo": 404, "sem-sessao": 401, "sem-rede": new Error("rede") },
      { recusada: { error: NOT_IN_ROUTE_MESSAGE } },
    );

    expect(await flushQueue(EU, io)).toEqual({
      ...vazio,
      sent: 1,
      rejected: [
        { collectionId: "recusada", reason: NOT_IN_ROUTE_MESSAGE },
        { collectionId: "sem-motivo", reason: "Recusado pelo servidor (404)" },
      ],
      stillPending: 2,
      needsLogin: true,
    });
    expect(enviados).toEqual(["enviada", "recusada", "sem-motivo", "sem-sessao", "sem-rede"]);
    expect([...itens.keys()]).toEqual(["sem-sessao", "sem-rede"]);
  });
});

describe("fila offline: dono da baixa e contagem", () => {
  it("a chave do item junta usuário e coleta: um motorista não sobrescreve a baixa do outro", () => {
    const ana = buildPending("coleta-1", { receiverName: "Maria" }, "user-ana", 10);
    const beto = buildPending("coleta-1", { receiverName: "José" }, "user-beto", 11);

    expect(ana).toEqual({
      id: "user-ana:coleta-1",
      collectionId: "coleta-1",
      userId: "user-ana",
      payload: { receiverName: "Maria" },
      createdAt: 10,
    });
    expect(beto.id).not.toBe(ana.id);
    // A mesma baixa refeita pelo mesmo motorista substitui a anterior.
    expect(buildPending("coleta-1", {}, "user-ana").id).toBe(ana.id);
  });

  it("sem usuário conhecido, o item entra sem dono, com a chave das versões anteriores", () => {
    expect(buildPending("coleta-1", {}, null, 1)).toEqual({
      id: "coleta-1",
      collectionId: "coleta-1",
      userId: null,
      payload: {},
      createdAt: 1,
    });
  });

  it("o dono sobrevive à gravação e à leitura", () => {
    const gravado = JSON.parse(JSON.stringify(buildPending("coleta-1", { receiverDoc: "123" }, "user-ana", 5)));
    expect(readPending(gravado)).toEqual(gravado);
    expect(readPending({ ...gravado, userId: "" })?.userId).toBeNull();
    expect(readPending({ ...gravado, userId: 7 })?.userId).toBeNull();
  });

  it("conta só o que o reenvio leva: item ilegível fica fora, baixa de outro é contada à parte", () => {
    const gravados: unknown[] = [
      buildPending("coleta-1", {}, "user-ana", 1),
      buildPending("coleta-2", {}, "user-beto", 2),
      { id: "coleta-3", deliveryId: "coleta-3", payload: {}, createdAt: 3 },
      { id: "", payload: {} },
      null,
      "lixo",
    ];
    const legiveis = gravados.flatMap((bruto) => readPending(bruto) ?? []);

    expect(legiveis).toHaveLength(3);
    expect(summarizePending(legiveis, "user-ana")).toEqual({ mine: 2, others: 1 });
    expect(summarizePending(legiveis, "user-beto")).toEqual({ mine: 2, others: 1 });
    expect(summarizePending(legiveis, "user-caio")).toEqual({ mine: 1, others: 2 });
    // Sessão ainda não carregou: nada some da tela.
    expect(summarizePending(legiveis, null)).toEqual({ mine: 3, others: 0 });
    expect(summarizePending([], "user-ana")).toEqual({ mine: 0, others: 0 });
  });

  it("a contagem bate com o que o reenvio tenta enviar", async () => {
    const legiveis = [
      buildPending("coleta-1", {}, "user-ana", 1),
      buildPending("coleta-2", {}, "user-beto", 2),
      buildPending("coleta-3", {}, null, 3),
    ];
    const enviados: string[] = [];

    await flushQueue("user-ana", {
      list: async () => legiveis,
      send: async (pendente) => {
        enviados.push(pendente.collectionId);
        return { status: 503, json: async () => ({}) };
      },
      remove: async () => undefined,
    });

    expect(enviados).toHaveLength(summarizePending(legiveis, "user-ana").mine);
  });
});

describe("fila offline: em nome de quem o reenvio roda", () => {
  const resposta = (ok: boolean, corpo: unknown) =>
    (async () => ({ ok, json: async () => corpo })) as unknown as typeof fetch;

  it("com o usuário no provedor da sessão, reenvia sem consultar o servidor", async () => {
    const consulta = vi.fn();
    expect(await resolveSyncOwner("user-ana", consulta)).toEqual({ owner: "user-ana", sessionExpired: false });
    expect(consulta).not.toHaveBeenCalled();
  });

  it("provedor sem usuário por consulta feita sem sinal: o servidor confirma e a baixa sobe", async () => {
    const consulta = async () => ({ state: "user", userId: "user-ana" }) as const;
    expect(await resolveSyncOwner(null, consulta)).toEqual({ owner: "user-ana", sessionExpired: false });
  });

  it("servidor confirma que não há sessão: não reenvia e pede novo login", async () => {
    const consulta = async () => ({ state: "none" }) as const;
    expect(await resolveSyncOwner(null, consulta)).toEqual({ owner: null, sessionExpired: true });
  });

  it("sem resposta do servidor: não reenvia e não diz que a sessão expirou", async () => {
    const consulta = async () => ({ state: "unknown" }) as const;
    expect(await resolveSyncOwner(null, consulta)).toEqual({ owner: null, sessionExpired: false });
  });

  it("lê a resposta da consulta de sessão", () => {
    expect(readSessionCheck(true, { user: { id: "user-ana" }, expires: "2026-11-01" })).toEqual({
      state: "user",
      userId: "user-ana",
    });
    expect(readSessionCheck(true, {})).toEqual({ state: "none" });
  });

  it("resposta que não prova nada não vira sessão nem falta de sessão", () => {
    expect(readSessionCheck(false, {})).toEqual({ state: "unknown" });
    expect(readSessionCheck(true, null)).toEqual({ state: "unknown" });
    expect(readSessionCheck(true, "<html>")).toEqual({ state: "unknown" });
    expect(readSessionCheck(true, [])).toEqual({ state: "unknown" });
    expect(readSessionCheck(true, { error: "falha" })).toEqual({ state: "unknown" });
    expect(readSessionCheck(true, { user: { name: "Ana" } })).toEqual({ state: "unknown" });
    expect(readSessionCheck(true, { user: { id: "" } })).toEqual({ state: "unknown" });
  });

  it("consulta de sessão: falha de rede, erro do servidor e página no lugar do JSON ficam sem resposta", async () => {
    const semRede = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    const portal = (async () => ({
      ok: true,
      json: async () => {
        throw new SyntaxError("Unexpected token <");
      },
    })) as unknown as typeof fetch;

    expect(await checkSession(semRede)).toEqual({ state: "unknown" });
    expect(await checkSession(resposta(false, {}))).toEqual({ state: "unknown" });
    expect(await checkSession(portal)).toEqual({ state: "unknown" });
  });

  it("consulta de sessão: pergunta ao servidor sem usar resposta guardada", async () => {
    const fetcher = vi.fn(resposta(true, { user: { id: "user-ana" } }));
    expect(await checkSession(fetcher)).toEqual({ state: "user", userId: "user-ana" });
    expect(fetcher).toHaveBeenCalledWith("/api/auth/session", { cache: "no-store" });
    expect(await checkSession(resposta(true, {}))).toEqual({ state: "none" });
  });
});

describe("fila offline: item gravado por versão anterior do aplicativo", () => {
  it("lê o id da coleta do campo antigo `deliveryId`", () => {
    const antigo = { id: "coleta-1", deliveryId: "coleta-1", payload: { receiverName: "Maria" }, createdAt: 123 };

    expect(readPending(antigo)).toEqual({
      id: "coleta-1",
      collectionId: "coleta-1",
      userId: null,
      payload: { receiverName: "Maria" },
      createdAt: 123,
    });
  });

  it("item novo passa igual, e o nome novo vale mais que o antigo", () => {
    const novo = { id: "coleta-2", collectionId: "coleta-2", payload: { receiverDoc: "123" }, createdAt: 5 };
    expect(readPending(novo)).toEqual({ ...novo, userId: null });
    expect(readPending({ ...novo, deliveryId: "outra" })?.collectionId).toBe("coleta-2");
  });

  it("sem os dois campos, vale a chave do item; sem nada disso, o item é ignorado", () => {
    expect(readPending({ id: "coleta-3", payload: {}, createdAt: 1 })?.collectionId).toBe("coleta-3");
    for (const invalido of [null, undefined, "texto", 7, {}, { deliveryId: "" }, { collectionId: 9 }]) {
      expect(readPending(invalido), JSON.stringify(invalido)).toBeNull();
    }
  });

  it("um item antigo é reenviado para a coleta certa e sai da fila", async () => {
    const itens = new Map([["coleta-1", { id: "coleta-1", deliveryId: "coleta-1", payload: {}, createdAt: 1 }]]);
    const enviados: string[] = [];

    const resultado = await flushQueue("user-ana", {
      list: async () => [...itens.values()].flatMap((bruto) => readPending(bruto) ?? []),
      send: async (pendente) => {
        enviados.push(pendente.collectionId);
        return { status: 200, json: async () => ({}) };
      },
      remove: async (id) => itens.delete(id),
    });

    expect(resultado.sent).toBe(1);
    expect(enviados).toEqual(["coleta-1"]);
    expect(itens.size).toBe(0);
  });
});

describe("foto do comprovante: conferência no aparelho, antes do envio", () => {
  it.each(["image/jpeg", "image/png", "image/webp", "IMAGE/JPEG"])("%s serve", (type) => {
    expect(photoProblem({ type, size: 3_000_000 })).toBeNull();
  });

  it.each(["image/heic", "image/heif", "image/gif", "image/svg+xml", "application/pdf", ""])(
    "tipo %j → avisa o formato aceito",
    (type) => {
      expect(photoProblem({ type, size: 1000 })).toBe(PHOTO_MESSAGE);
    },
  );

  const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
  const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
  const WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);
  // HEIC: caixa `ftyp` com a marca `heic`.
  const HEIC = Uint8Array.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]);
  // WAV também começa com "RIFF", mas não é WebP.
  const WAV = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45]);

  it("reconhece JPEG, PNG e WebP pelos primeiros bytes", () => {
    expect(sniffPhotoType(JPEG)).toBe("image/jpeg");
    expect(sniffPhotoType(PNG)).toBe("image/png");
    expect(sniffPhotoType(WEBP)).toBe("image/webp");
    for (const outro of [HEIC, WAV, new Uint8Array(), Uint8Array.from([0xff, 0xd8])]) {
      expect(sniffPhotoType(outro)).toBeNull();
    }
  });

  it("foto que chega sem tipo vale pelo que os bytes dizem", () => {
    expect(photoProblem({ type: resolvePhotoType("", JPEG), size: 1000 })).toBeNull();
    expect(photoProblem({ type: resolvePhotoType("", PNG), size: 1000 })).toBeNull();
    expect(photoProblem({ type: resolvePhotoType("", WEBP), size: 1000 })).toBeNull();
    // O tipo descoberto é o que o servidor aceita no prefixo `data:`.
    expect(
      baixaSchema.safeParse({
        receiverName: "Maria",
        receiverDoc: "12345",
        photoBase64: `data:${resolvePhotoType("", JPEG)};base64,AAAA`,
      }).success,
    ).toBe(true);
  });

  it("sem tipo e sem ser foto aceita, continua recusada com a mensagem de formato", () => {
    expect(photoProblem({ type: resolvePhotoType("", HEIC), size: 1000 })).toBe(PHOTO_MESSAGE);
    expect(photoProblem({ type: resolvePhotoType("", new Uint8Array()), size: 1000 })).toBe(PHOTO_MESSAGE);
  });

  it("tipo declarado vale como veio: HEIC com bytes de JPEG segue recusado", () => {
    expect(resolvePhotoType("image/heic", JPEG)).toBe("image/heic");
    expect(resolvePhotoType("image/png", new Uint8Array())).toBe("image/png");
  });

  it("a mensagem diz o que enviar", () => {
    expect(PHOTO_MESSAGE).toContain("JPEG, PNG ou WebP");
  });

  it("foto que passaria do limite do servidor é barrada pelo tamanho do arquivo", () => {
    const prefixo = "data:image/jpeg;base64,".length;
    const maiorQueCabe = Math.floor((MAX_PHOTO_CHARS - prefixo) / 4) * 3;

    expect(photoProblem({ type: "image/jpeg", size: maiorQueCabe })).toBeNull();
    expect(photoProblem({ type: "image/jpeg", size: maiorQueCabe + 1 })).toBe(PHOTO_TOO_BIG);
  });
});

describe("limite de tamanho da foto no servidor", () => {
  const baixa = (photoBase64: string) =>
    baixaSchema.safeParse({ receiverName: "Maria Recebedora", receiverDoc: "123.456.789-00", photoBase64 });
  const foto = (tamanho: number) => {
    const prefixo = "data:image/jpeg;base64,";
    return prefixo + "A".repeat(tamanho - prefixo.length);
  };

  it("foto com exatamente o limite passa", () => {
    expect(baixa(foto(MAX_PHOTO_CHARS)).success).toBe(true);
  });

  it("um caractere a mais → recusada com a mensagem de tamanho", () => {
    const resultado = baixa(foto(MAX_PHOTO_CHARS + 1));
    expect(resultado.success).toBe(false);
    expect(resultado.error?.issues[0].message).toBe(PHOTO_TOO_BIG);
  });

  it("foto HEIC → recusada com a mensagem do formato", () => {
    const resultado = baixa("data:image/heic;base64,AAAA");
    expect(resultado.success).toBe(false);
    expect(resultado.error?.issues[0].message).toBe(PHOTO_MESSAGE);
  });
});

describe("quadro de assinatura: só traço vira assinatura", () => {
  it("ponteiro que sai do quadro sem ter descido não gera assinatura", () => {
    const quadro = createStrokeTracker();
    expect(quadro.move()).toBe(false);
    expect(quadro.end()).toBe(false);
  });

  it("toque sem traço não gera assinatura", () => {
    const quadro = createStrokeTracker();
    quadro.start();
    expect(quadro.end()).toBe(false);
  });

  it("traço gera assinatura uma vez; o ponteiro sair depois não repete", () => {
    const quadro = createStrokeTracker();
    quadro.start();
    expect(quadro.move()).toBe(true);
    expect(quadro.end()).toBe(true);
    expect(quadro.move()).toBe(false);
    expect(quadro.end()).toBe(false);
  });

  it("segundo traço soma ao primeiro; depois de limpar, volta a não haver assinatura", () => {
    const quadro = createStrokeTracker();
    quadro.start();
    quadro.move();
    quadro.end();
    quadro.start();
    expect(quadro.end()).toBe(true);

    quadro.clear();
    expect(quadro.end()).toBe(false);
    quadro.start();
    expect(quadro.end()).toBe(false);
  });
});

// Tudo o que esta suite cria usa estes marcadores, e só isso é apagado.
const PREFIXO = "teste-driver-";
const CNPJ_TESTE = "99888777001057";
// Todo CPF e toda placa da suite começam assim: cada viagem tem a sua dupla.
const CPF_PREFIXO = "99955544";
const PLACA_PREFIXO = "TDR";
const HASH_FALSO = "$2b$10$hashfalsoparateste000000000000000000000000000000000";
const SEM_ID = "00000000-0000-0000-0000-000000000000";

const FOTO = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
const ASSINATURA = "data:image/png;base64,iVBORw0KGgo=";

const RECEIVER_NAME_MESSAGE = "Informe o nome de quem recebeu (2 a 120 caracteres).";
const RECEIVER_DOC_MESSAGE = "Informe o documento de quem recebeu (5 a 20 caracteres).";
const SIGNATURE_MESSAGE = "A assinatura precisa ser uma imagem.";
const SIGNATURE_TOO_BIG = "A assinatura ficou grande demais. Limpe e assine de novo.";
const LOCATION_MESSAGE = "Localização inválida.";

type Linha = {
  fromStatus: string | null;
  toStatus: string;
  user: { id: string; name: string } | null;
};

suite("aplicativo do motorista", () => {
  let prisma: typeof import("../src/lib/prisma").default;
  let baixaRota: typeof import("../src/app/api/driver/entregas/[id]/baixa/route");
  let viagensDoMotorista: typeof import("../src/app/api/driver/manifestos/route");
  let manifestos: typeof import("../src/app/api/manifestos/route");
  let liberar: typeof import("../src/app/api/manifestos/[id]/liberar/route");
  let finalizar: typeof import("../src/app/api/manifestos/[id]/finalizar/route");
  let coletas: typeof import("../src/app/api/coletas/route");
  let statusRota: typeof import("../src/app/api/dashboard/coletas/[id]/status/route");
  let historico: typeof import("../src/app/api/coletas/[id]/historico/route");
  let comprovantePagina: typeof import("../src/app/dashboard/entregas/[id]/comprovante/page");

  let operadorId: string;
  let adminId: string;
  let usuarioClienteId: string;
  let semCadastroId: string;
  let clienteId: string;

  const sessao = vi.mocked(getServerSession);

  const entrar = (id: string, role: string, clientId: string | null = null) =>
    sessao.mockResolvedValue({ user: { id, role, clientId } });
  const comoOperador = () => entrar(operadorId, "OPERATION");
  const comoMotorista = (userId: string) => entrar(userId, "DRIVER");

  const req = (method = "GET", body?: unknown) =>
    new Request("http://localhost/api/teste", {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

  const email = (nome: string) => `${PREFIXO}${nome}@exemplo.br`;

  const corpo = (extra: Record<string, unknown> = {}) => ({
    receiverName: "Maria Recebedora",
    receiverDoc: "123.456.789-00",
    photoBase64: FOTO,
    signatureBase64: ASSINATURA,
    latitude: -20.8113,
    longitude: -49.3758,
    ...extra,
  });

  // Coleta montada direto no banco, no estado que o teste precisa.
  const montar = (extra: Record<string, unknown> = {}) =>
    prisma.collection.create({
      data: {
        clientId: clienteId,
        sender: "Remetente Teste",
        receiver: "Destinatário Teste",
        origin: "Origem - SP",
        destination: "Destino - SP",
        volumes: 1,
        weight: 1,
        status: "COLLECTED",
        ...extra,
      },
    });

  const ler = (id: string) => prisma.collection.findUniqueOrThrow({ where: { id } });
  const comprovantes = (collectionId: string) => prisma.proofOfDelivery.findMany({ where: { collectionId } });
  const linhas = (collectionId: string) =>
    prisma.collectionStatusHistory.findMany({
      where: { collectionId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });

  let serie = 0;
  async function criarMotorista(active = true) {
    serie += 1;
    const n = String(serie).padStart(3, "0");
    const user = await prisma.user.create({
      data: { name: `Motorista ${n}`, email: email(`motorista-${n}`), password: HASH_FALSO, role: "DRIVER" },
    });
    const driver = await prisma.driver.create({
      data: {
        userId: user.id,
        cpf: `${CPF_PREFIXO}${n}`,
        cnh: "12345678900",
        cnhExpiry: new Date("2031-06-30"),
        category: "D",
        active,
      },
    });
    const veiculo = await prisma.vehicle.create({
      data: { plate: `${PLACA_PREFIXO}9${n}`, model: "Teste", type: "VAN" },
    });
    return { driverId: driver.id, userId: user.id, name: user.name, vehicleId: veiculo.id };
  }

  type Dupla = Awaited<ReturnType<typeof criarMotorista>>;

  // Viagem em montagem, com as cargas reservadas, pela rota de verdade.
  async function montagem(quantas = 1, cargasProntas?: { id: string }[], dupla?: Dupla) {
    const cargas = cargasProntas ?? (await Promise.all(Array.from({ length: quantas }, () => montar())));
    const motorista = dupla ?? (await criarMotorista());
    comoOperador();
    const res = await manifestos.POST(
      req("POST", {
        driverId: motorista.driverId,
        vehicleId: motorista.vehicleId,
        collectionIds: cargas.map((c) => c.id),
      }),
    );
    expect(res.status).toBe(201);
    return { id: (await res.json()).id as string, cargas, ...motorista };
  }

  // Viagem em rota: montada e com a saída liberada pelo operador.
  async function viagem(quantas = 1, cargasProntas?: { id: string }[], dupla?: Dupla) {
    const montada = await montagem(quantas, cargasProntas, dupla);
    comoOperador();
    expect((await liberar.POST(req("POST"), ctx(montada.id))).status).toBe(200);
    return montada;
  }

  const baixar = (collectionId: string, body: unknown = corpo()) => baixaRota.POST(req("POST", body), ctx(collectionId));

  // Baixa feita pelo motorista dono da viagem.
  async function baixarComo(userId: string, collectionId: string, body: unknown = corpo()) {
    comoMotorista(userId);
    return baixar(collectionId, body);
  }

  // Procura uma chave em qualquer profundidade da resposta.
  function temChave(valor: unknown, proibidas: string[]): boolean {
    if (Array.isArray(valor)) return valor.some((item) => temChave(item, proibidas));
    if (valor && typeof valor === "object") {
      return Object.entries(valor).some(([chave, filho]) => proibidas.includes(chave) || temChave(filho, proibidas));
    }
    return false;
  }

  // Na ordem das dependências: coletas → manifesto → veículo → motorista →
  // usuário → cliente. Comprovante e histórico saem junto da coleta, pela chave
  // estrangeira.
  async function limpar() {
    const daSuite = { email: { startsWith: PREFIXO, mode: "insensitive" as const } };
    await prisma.collection.deleteMany({ where: { client: { cnpj: CNPJ_TESTE } } });
    await prisma.manifest.deleteMany({ where: { vehicle: { plate: { startsWith: PLACA_PREFIXO } } } });
    await prisma.vehicle.deleteMany({ where: { plate: { startsWith: PLACA_PREFIXO } } });
    await prisma.driver.deleteMany({ where: { OR: [{ cpf: { startsWith: CPF_PREFIXO } }, { user: daSuite }] } });
    await prisma.user.deleteMany({ where: daSuite });
    await prisma.client.deleteMany({ where: { cnpj: CNPJ_TESTE } });
  }

  beforeAll(async () => {
    prisma = (await import("../src/lib/prisma")).default;
    baixaRota = await import("../src/app/api/driver/entregas/[id]/baixa/route");
    viagensDoMotorista = await import("../src/app/api/driver/manifestos/route");
    manifestos = await import("../src/app/api/manifestos/route");
    liberar = await import("../src/app/api/manifestos/[id]/liberar/route");
    finalizar = await import("../src/app/api/manifestos/[id]/finalizar/route");
    coletas = await import("../src/app/api/coletas/route");
    statusRota = await import("../src/app/api/dashboard/coletas/[id]/status/route");
    historico = await import("../src/app/api/coletas/[id]/historico/route");
    comprovantePagina = await import("../src/app/dashboard/entregas/[id]/comprovante/page");

    await limpar();

    clienteId = (
      await prisma.client.create({
        data: {
          companyName: "Empresa Teste Driver LTDA",
          tradeName: "Teste Driver",
          cnpj: CNPJ_TESTE,
          email: email("contato-da-empresa"),
          creditLimit: 12345,
        },
      })
    ).id;

    const usuario = (nome: string, role: "ADMIN" | "OPERATION" | "CLIENT" | "DRIVER", extra: { clientId?: string } = {}) =>
      prisma.user.create({ data: { name: nome, email: email(nome), password: HASH_FALSO, role, ...extra } });

    operadorId = (await usuario("operacao", "OPERATION")).id;
    adminId = (await usuario("admin", "ADMIN")).id;
    usuarioClienteId = (await usuario("cliente", "CLIENT", { clientId: clienteId })).id;
    semCadastroId = (await usuario("sem-cadastro", "DRIVER")).id;
  });

  beforeEach(() => {
    sessao.mockReset();
    comoOperador();
  });

  afterAll(async () => {
    if (prisma) await limpar();
  });

  describe("POST /api/driver/entregas/[id]/baixa", () => {
    it("sem sessão, ADMIN, OPERATION e CLIENT → 401; DRIVER sem cadastro e motorista inativo → 403; a carga não muda", async () => {
      const { cargas, driverId, userId } = await viagem();
      const alvo = cargas[0].id;

      sessao.mockResolvedValue(null);
      expect((await baixar(alvo)).status).toBe(401);

      entrar(adminId, "ADMIN");
      expect((await baixar(alvo)).status, "ADMIN").toBe(401);
      entrar(operadorId, "OPERATION");
      expect((await baixar(alvo)).status, "OPERATION").toBe(401);
      entrar(usuarioClienteId, "CLIENT", clienteId);
      expect((await baixar(alvo)).status, "CLIENT").toBe(401);

      entrar(semCadastroId, "DRIVER");
      const semCadastro = await baixar(alvo);
      expect(semCadastro.status).toBe(403);
      expect(await semCadastro.json()).toEqual({ error: "Usuário não possui cadastro de motorista." });

      await prisma.driver.update({ where: { id: driverId }, data: { active: false } });
      const inativo = await baixarComo(userId, alvo);
      expect(inativo.status).toBe(403);
      expect(await inativo.json()).toEqual({ error: "Motorista inativo." });
      await prisma.driver.update({ where: { id: driverId }, data: { active: true } });

      expect(await ler(alvo)).toMatchObject({ status: "ROUTE", receiverName: null });
      expect(await comprovantes(alvo)).toHaveLength(0);
      expect(await linhas(alvo)).toHaveLength(1);
    });

    it.each([
      ["sem nome do recebedor", { receiverName: undefined }, RECEIVER_NAME_MESSAGE],
      ["nome com 1 caractere", { receiverName: " A " }, RECEIVER_NAME_MESSAGE],
      ["nome com 121 caracteres", { receiverName: "x".repeat(121) }, RECEIVER_NAME_MESSAGE],
      ["nome que não é texto", { receiverName: 7 }, RECEIVER_NAME_MESSAGE],
      ["sem documento", { receiverDoc: undefined }, RECEIVER_DOC_MESSAGE],
      ["documento com 4 caracteres", { receiverDoc: "1234" }, RECEIVER_DOC_MESSAGE],
      ["documento com 21 caracteres", { receiverDoc: "1".repeat(21) }, RECEIVER_DOC_MESSAGE],
      ["foto em data:text/html", { photoBase64: "data:text/html;base64,PHNjcmlwdD4=" }, PHOTO_MESSAGE],
      ["foto em endereço externo", { photoBase64: "https://exemplo.br/foto.jpg" }, PHOTO_MESSAGE],
      ["foto em svg", { photoBase64: "data:image/svg+xml;base64,PHN2Zz4=" }, PHOTO_MESSAGE],
      ["foto em HEIC", { photoBase64: "data:image/heic;base64,AAAAGGZ0eXBoZWlj" }, PHOTO_MESSAGE],
      [
        "foto grande demais",
        { photoBase64: `data:image/jpeg;base64,${"A".repeat(MAX_PHOTO_CHARS)}` },
        PHOTO_TOO_BIG,
      ],
      ["assinatura em data:text/html", { signatureBase64: "data:text/html;base64,PHNjcmlwdD4=" }, SIGNATURE_MESSAGE],
      ["assinatura em endereço externo", { signatureBase64: "https://exemplo.br/a.png" }, SIGNATURE_MESSAGE],
      [
        "assinatura grande demais",
        { signatureBase64: `data:image/png;base64,${"A".repeat(MAX_SIGNATURE_CHARS)}` },
        SIGNATURE_TOO_BIG,
      ],
      ["latitude fora da faixa", { latitude: 90.5 }, LOCATION_MESSAGE],
      ["longitude fora da faixa", { longitude: -180.5 }, LOCATION_MESSAGE],
      ["latitude que não é número", { latitude: "-20.8" }, LOCATION_MESSAGE],
    ])("corpo inválido (%s) → 400 com a mensagem do schema, sem gravar", async (_caso, extra, mensagem) => {
      const { cargas, userId } = await viagem();

      const res = await baixarComo(userId, cargas[0].id, corpo(extra));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: mensagem });

      expect((await ler(cargas[0].id)).status).toBe("ROUTE");
      expect(await comprovantes(cargas[0].id)).toHaveLength(0);
    });

    it("corpo que não é JSON ou não é objeto → 400, sem gravar", async () => {
      const { cargas, userId } = await viagem();
      comoMotorista(userId);

      const naoJson = await baixaRota.POST(
        new Request("http://localhost/api/teste", { method: "POST", body: "<html>" }),
        ctx(cargas[0].id),
      );
      expect(naoJson.status).toBe(400);
      expect(await naoJson.json()).toEqual({ error: "Dados inválidos." });

      for (const invalido of [null, [], "texto", 7]) {
        const res = await baixar(cargas[0].id, invalido);
        expect(res.status, JSON.stringify(invalido)).toBe(400);
        expect((await res.json()).error).toBeTruthy();
      }

      expect((await ler(cargas[0].id)).status).toBe("ROUTE");
      expect(await comprovantes(cargas[0].id)).toHaveLength(0);
    });

    it("carga em rota na viagem do motorista → 200; coleta entregue, um comprovante e uma linha no histórico com o motorista", async () => {
      const { cargas, userId } = await viagem(2);
      const alvo = cargas[0].id;

      const res = await baixarComo(userId, alvo, corpo({ receiverName: "  Maria Recebedora  " }));
      expect(res.status).toBe(200);
      const json = await res.json();
      const [comprovante] = await comprovantes(alvo);
      expect(json).toEqual({ success: true, collectionId: alvo, proofId: comprovante.id });

      expect(await ler(alvo)).toMatchObject({ status: "DELIVERED", receiverName: "Maria Recebedora" });
      expect(await comprovantes(alvo)).toHaveLength(1);
      expect(comprovante).toMatchObject({
        collectionId: alvo,
        status: "SUBMITTED",
        receiverName: "Maria Recebedora",
        receiverDoc: "123.456.789-00",
        photoBase64: FOTO,
        signatureBase64: ASSINATURA,
        latitude: -20.8113,
        longitude: -49.3758,
      });

      const entrega = (await linhas(alvo)).filter((linha) => linha.toStatus === "DELIVERED");
      expect(entrega).toHaveLength(1);
      expect(entrega[0]).toMatchObject({ fromStatus: "ROUTE", toStatus: "DELIVERED", userId });

      // A outra carga da viagem não é tocada.
      expect((await ler(cargas[1].id)).status).toBe("ROUTE");
      expect(await comprovantes(cargas[1].id)).toHaveLength(0);
    });

    it("sem foto, sem assinatura e sem localização → 200, e a string vazia vira nulo", async () => {
      const { cargas, userId } = await viagem(2);

      const vazio = await baixarComo(
        userId,
        cargas[0].id,
        corpo({ photoBase64: "", signatureBase64: "", latitude: null, longitude: null }),
      );
      expect(vazio.status).toBe(200);
      expect((await comprovantes(cargas[0].id))[0]).toMatchObject({
        photoBase64: null,
        signatureBase64: null,
        latitude: null,
        longitude: null,
      });

      const ausente = await baixarComo(userId, cargas[1].id, { receiverName: "João", receiverDoc: "12345" });
      expect(ausente.status).toBe(200);
      expect((await comprovantes(cargas[1].id))[0]).toMatchObject({ photoBase64: null, signatureBase64: null });
    });

    it("se o comprovante não grava, a coleta não muda e o histórico não ganha linha", async () => {
      const { cargas, userId } = await viagem();
      const alvo = cargas[0].id;

      // Um comprovante já gravado para a carga em rota (dado que as rotas não
      // produzem) faz a criação falhar na chave única, depois do `updateMany`.
      const plantado = await prisma.proofOfDelivery.create({
        data: { collectionId: alvo, receiverName: "Plantado", receiverDoc: "00000" },
      });
      const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
      try {
        expect((await baixarComo(userId, alvo)).status).toBe(500);
      } finally {
        erro.mockRestore();
      }

      expect(await ler(alvo)).toMatchObject({ status: "ROUTE", receiverName: null });
      expect((await linhas(alvo)).map((linha) => linha.toStatus)).toEqual(["ROUTE"]);
      expect((await comprovantes(alvo)).map((c) => c.id)).toEqual([plantado.id]);
    });

    it("carga da viagem de outro motorista, carga sem viagem e id inexistente → 404; nada muda", async () => {
      const minha = await viagem();
      const alheia = await viagem();
      const solta = await montar();

      for (const [caso, id] of [
        ["de outro motorista", alheia.cargas[0].id],
        ["sem viagem", solta.id],
        ["inexistente", SEM_ID],
        ["que não é uuid", "nao-e-uuid"],
      ] as const) {
        const res = await baixarComo(minha.userId, id);
        expect(res.status, caso).toBe(404);
        expect(await res.json(), caso).toEqual({ error: DELIVERY_NOT_FOUND_MESSAGE });
      }

      expect(await ler(alheia.cargas[0].id)).toMatchObject({ status: "ROUTE", receiverName: null });
      expect(await ler(solta.id)).toMatchObject({ status: "COLLECTED", manifestId: null });
      expect(await comprovantes(alheia.cargas[0].id)).toHaveLength(0);
      expect(await comprovantes(solta.id)).toHaveLength(0);
    });

    it("viagem ainda em montagem → 404; carga fora de rota em viagem liberada → 409; nada muda", async () => {
      const emMontagem = await montagem();
      const reservada = await baixarComo(emMontagem.userId, emMontagem.cargas[0].id);
      expect(reservada.status).toBe(404);
      expect(await reservada.json()).toEqual({ error: DELIVERY_NOT_FOUND_MESSAGE });
      expect(await ler(emMontagem.cargas[0].id)).toMatchObject({ status: "COLLECTED", manifestId: emMontagem.id });

      // Dado legado: carga que não está em rota dentro de uma viagem liberada.
      const liberada = await viagem(2);
      for (const status of ["COLLECTED", "CONFIRMED", "CANCELLED"]) {
        await prisma.collection.update({ where: { id: liberada.cargas[0].id }, data: { status } });
        const res = await baixarComo(liberada.userId, liberada.cargas[0].id);
        expect(res.status, status).toBe(409);
        expect(await res.json(), status).toEqual({ error: NOT_IN_ROUTE_MESSAGE });
        expect((await ler(liberada.cargas[0].id)).status).toBe(status);
      }

      expect(await comprovantes(emMontagem.cargas[0].id)).toHaveLength(0);
      expect(await comprovantes(liberada.cargas[0].id)).toHaveLength(0);
    });

    it("repetir a baixa → 200 alreadyDelivered com o mesmo comprovante, sem reescrever; vale com a viagem finalizada", async () => {
      const { id, cargas, userId } = await viagem();
      const alvo = cargas[0].id;

      const primeira = await (await baixarComo(userId, alvo)).json();
      const antes = (await comprovantes(alvo))[0];
      const historicoAntes = await linhas(alvo);

      const repetida = await baixarComo(userId, alvo, corpo({ receiverName: "Outro Nome", receiverDoc: "99999" }));
      expect(repetida.status).toBe(200);
      expect(await repetida.json()).toEqual({
        success: true,
        alreadyDelivered: true,
        collectionId: alvo,
        proofId: primeira.proofId,
      });

      comoOperador();
      expect((await finalizar.POST(req("POST"), ctx(id))).status).toBe(200);

      const depois = await baixarComo(userId, alvo, corpo({ receiverName: "Terceiro Nome" }));
      expect(depois.status).toBe(200);
      expect(await depois.json()).toMatchObject({ alreadyDelivered: true, proofId: primeira.proofId });

      expect(await comprovantes(alvo)).toEqual([antes]);
      expect((await ler(alvo)).receiverName).toBe("Maria Recebedora");
      expect(await linhas(alvo)).toEqual(historicoAntes);
    });

    it("carga entregue pelo painel, sem comprovante → 409, e nenhum comprovante é criado", async () => {
      const { cargas, userId } = await viagem();
      const alvo = cargas[0].id;

      comoOperador();
      expect((await statusRota.POST(req("POST", { status: "DELIVERED", receiverName: "Fulano" }), ctx(alvo))).status).toBe(200);
      const historicoAntes = await linhas(alvo);

      const res = await baixarComo(userId, alvo);
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: DELIVERED_BY_PANEL_MESSAGE });

      expect(await comprovantes(alvo)).toHaveLength(0);
      expect((await ler(alvo)).receiverName).toBe("Fulano");
      expect(await linhas(alvo)).toEqual(historicoAntes);
    });

    it("duas baixas simultâneas da mesma carga: as duas 200, um comprovante e uma linha no histórico", async () => {
      const { cargas, userId } = await viagem();
      const alvo = cargas[0].id;
      comoMotorista(userId);

      const respostas = await Promise.all([baixar(alvo), baixar(alvo)]);
      expect(respostas.map((res) => res.status)).toEqual([200, 200]);

      const corpos = await Promise.all(respostas.map((res) => res.json()));
      expect(corpos.filter((json) => json.alreadyDelivered === true)).toHaveLength(1);
      expect(corpos[0].proofId).toBe(corpos[1].proofId);

      expect(await comprovantes(alvo)).toHaveLength(1);
      expect((await linhas(alvo)).filter((linha) => linha.toStatus === "DELIVERED")).toHaveLength(1);
      expect((await ler(alvo)).status).toBe("DELIVERED");
    });

    it("a baixa do motorista vale para encerrar a viagem: com carga pendente 409, depois da última 200", async () => {
      const { id, cargas, userId, vehicleId } = await viagem(2);

      expect((await baixarComo(userId, cargas[0].id)).status).toBe(200);
      comoOperador();
      expect((await finalizar.POST(req("POST"), ctx(id))).status).toBe(409);

      expect((await baixarComo(userId, cargas[1].id)).status).toBe(200);
      comoOperador();
      const res = await finalizar.POST(req("POST"), ctx(id));
      expect(res.status).toBe(200);
      expect((await res.json()).manifest).toMatchObject({ id, status: "FINISHED" });
      expect((await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicleId } })).status).toBe("AVAILABLE");
    });
  });

  describe("GET /api/driver/manifestos", () => {
    it("cada carga sai só com o que a tela usa, em ordem de criação, sem dado do cliente nem foto", async () => {
      const primeira = await montar({ receiver: "Primeira", createdAt: new Date("2026-01-01T10:00:00.000Z") });
      const segunda = await montar({ receiver: "Segunda", createdAt: new Date("2026-01-01T11:00:00.000Z") });
      // Entregue na ordem inversa, para a ordem não sair por acaso.
      const { id, userId } = await viagem(2, [segunda, primeira]);
      expect((await baixarComo(userId, primeira.id)).status).toBe(200);

      const res = await viagensDoMotorista.GET();
      expect(res.status).toBe(200);
      const texto = await res.text();
      const lista = JSON.parse(texto) as { id: string; collections: Record<string, unknown>[] }[];

      expect(lista.map((m) => m.id)).toEqual([id]);
      const [daViagem] = lista;
      expect(Object.keys(daViagem).sort()).toEqual(["collections", "createdAt", "id", "status", "vehicle"]);
      expect("deliveries" in daViagem).toBe(false);

      expect(daViagem.collections.map((c) => c.id)).toEqual([primeira.id, segunda.id]);
      for (const coleta of daViagem.collections) {
        expect(Object.keys(coleta).sort()).toEqual(
          ["client", "destination", "id", "origin", "receiver", "receiverName", "status", "volumes", "weight"],
        );
        expect(coleta.client).toEqual({ tradeName: "Teste Driver", companyName: "Empresa Teste Driver LTDA" });
      }
      expect(daViagem.collections[0]).toMatchObject({ status: "DELIVERED", receiverName: "Maria Recebedora" });
      expect(daViagem.collections[1]).toMatchObject({ status: "ROUTE", receiverName: null });

      expect(temChave(lista, ["deliveries", "creditLimit", "cnpj", "email", "photoBase64", "signatureBase64", "proof"])).toBe(false);
      for (const proibido of ["creditLimit", "cnpj", "email", "photoBase64", CNPJ_TESTE, FOTO]) {
        expect(texto).not.toContain(proibido);
      }
    });

    it("o motorista não vê a viagem de outro", async () => {
      const minha = await viagem();
      const alheia = await viagem();

      comoMotorista(minha.userId);
      const lista = (await (await viagensDoMotorista.GET()).json()) as { id: string }[];
      expect(lista.map((m) => m.id)).toEqual([minha.id]);
      expect(lista.map((m) => m.id)).not.toContain(alheia.id);
    });
  });

  describe("histórico ponta a ponta", () => {
    it("criada no painel, coletada, embarcada e entregue pelo motorista: quatro linhas em ordem, a última com o nome dele", async () => {
      comoOperador();
      const criada = await coletas.POST(
        req("POST", {
          clientId: clienteId,
          sender: "Remetente Teste",
          receiver: "Destinatário Teste",
          origin: "São José do Rio Preto - SP",
          destination: "São Paulo - SP",
          volumes: "3",
          weight: "12,5",
        }),
      );
      expect(criada.status).toBe(201);
      const { id: coletaId } = (await criada.json()) as { id: string };

      expect((await statusRota.POST(req("POST", { status: "COLLECTED" }), ctx(coletaId))).status).toBe(200);

      const motorista = await criarMotorista();
      await viagem(1, [{ id: coletaId }], motorista);
      expect((await baixarComo(motorista.userId, coletaId)).status).toBe(200);

      comoOperador();
      const res = await historico.GET(req(), ctx(coletaId));
      expect(res.status).toBe(200);
      const lista = (await res.json()) as Linha[];

      expect(lista.map((linha) => [linha.fromStatus, linha.toStatus])).toEqual([
        [null, "CONFIRMED"],
        ["CONFIRMED", "COLLECTED"],
        ["COLLECTED", "ROUTE"],
        ["ROUTE", "DELIVERED"],
      ]);
      const operador = { id: operadorId, name: "operacao" };
      expect(lista.slice(0, 3).map((linha) => linha.user)).toEqual([operador, operador, operador]);
      expect(lista[3].user).toEqual({ id: motorista.userId, name: motorista.name });
    });
  });

  describe("página do comprovante no painel", () => {
    const abrir = (collectionId: string) => comprovantePagina.default({ params: Promise.resolve({ id: collectionId }) });

    // Carga com baixa do motorista: o que a página tem para mostrar.
    async function entregue() {
      const { cargas, userId } = await viagem();
      expect((await baixarComo(userId, cargas[0].id)).status).toBe(200);
      return { collectionId: cargas[0].id, motoristaUserId: userId };
    }

    it("ADMIN e OPERATION veem o comprovante, com recebedor, foto e assinatura", async () => {
      const { collectionId } = await entregue();

      for (const [id, role] of [[adminId, "ADMIN"], [operadorId, "OPERATION"]] as const) {
        entrar(id, role);
        const html = renderToStaticMarkup(await abrir(collectionId));

        expect(html, role).toContain("Maria Recebedora");
        expect(html, role).toContain("123.456.789-00");
        expect(html, role).toContain(`src="${FOTO}"`);
        expect(html, role).toContain(`src="${ASSINATURA}"`);
      }
    });

    it("motorista e cliente não veem, nem o motorista que deu a baixa", async () => {
      const { collectionId, motoristaUserId } = await entregue();

      entrar(motoristaUserId, "DRIVER");
      await expect(abrir(collectionId)).rejects.toThrow("NOT_FOUND");

      entrar(usuarioClienteId, "CLIENT", clienteId);
      await expect(abrir(collectionId)).rejects.toThrow("NOT_FOUND");
    });

    // O perfil vale o do banco: token antigo de quem já foi operador não abre.
    it("token que diz ADMIN, de usuário que no banco é motorista ou foi apagado → não vê", async () => {
      const { collectionId, motoristaUserId } = await entregue();

      entrar(motoristaUserId, "ADMIN");
      await expect(abrir(collectionId)).rejects.toThrow("NOT_FOUND");

      entrar(SEM_ID, "ADMIN");
      await expect(abrir(collectionId)).rejects.toThrow("NOT_FOUND");
    });

    it("sem sessão → vai para o login", async () => {
      const { collectionId } = await entregue();

      sessao.mockResolvedValue(null);
      await expect(abrir(collectionId)).rejects.toThrow("REDIRECT /login");
    });

    it("carga sem comprovante ou que não existe → não encontrada", async () => {
      const { cargas } = await viagem();

      entrar(adminId, "ADMIN");
      await expect(abrir(cargas[0].id)).rejects.toThrow("NOT_FOUND");
      await expect(abrir(SEM_ID)).rejects.toThrow("NOT_FOUND");
    });
  });
});
