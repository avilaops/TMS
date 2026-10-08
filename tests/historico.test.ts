import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getServerSession } from "next-auth";

/**
 * Histórico de status da coleta — gravado na criação (painel e portal) e nas
 * trocas da rota de status, e lido pela equipe interna — contra um Postgres de
 * verdade, no padrão de `coletas.test.ts` (sessão simulada, handlers reais).
 *
 * Sem DATABASE_URL a suite é pulada com aviso — no CI ela sempre roda.
 */
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

const temBanco = Boolean(process.env.DATABASE_URL);

if (!temBanco) {
  console.warn(
    "\n[historico.test] DATABASE_URL ausente: testes de integração PULADOS.\n" +
      "Rode com um Postgres real para exercitá-los.\n",
  );
}

const suite = temBanco ? describe : describe.skip;

// Tudo o que esta suite cria usa estes marcadores, e só isso é apagado.
const PREFIXO = "teste-historico-";
const CNPJ_TESTE = "99888777000832";
const CNPJ_OUTRA = "99888777000913";
const CPF_TESTE = "99988877600";
const PLACA_TESTE = "THS0A01";
const HASH_FALSO = "$2b$10$hashfalsoparateste000000000000000000000000000000000";
const SEM_ID = "00000000-0000-0000-0000-000000000000";

type Perfil = "OPERATION" | "DRIVER" | "CLIENT";
type Linha = {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  createdAt: string;
  user: { id: string; name: string } | null;
};

suite("histórico de status da coleta", () => {
  let prisma: typeof import("../src/lib/prisma").default;
  let lib: typeof import("../src/lib/historico");
  let coletas: typeof import("../src/app/api/coletas/route");
  let portal: typeof import("../src/app/api/portal/coletas/route");
  let statusRota: typeof import("../src/app/api/dashboard/coletas/[id]/status/route");
  let historico: typeof import("../src/app/api/coletas/[id]/historico/route");

  const ids = {} as Record<Perfil, string>;
  let clienteId: string;

  const sessao = vi.mocked(getServerSession);

  function entrarComo(perfil: Perfil | null) {
    sessao.mockResolvedValue(
      perfil
        ? { user: { id: ids[perfil], role: perfil, clientId: perfil === "CLIENT" ? clienteId : null } }
        : null,
    );
  }

  const req = (method = "GET", body?: unknown) =>
    new Request("http://localhost/api/teste", {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

  const email = (nome: string) => `${PREFIXO}${nome}@exemplo.br`;

  const corpo = (extra: Record<string, unknown> = {}) => ({
    clientId: clienteId,
    sender: "Remetente Teste",
    receiver: "Destinatário Teste",
    origin: "São José do Rio Preto - SP",
    destination: "São Paulo - SP",
    volumes: "3",
    weight: "12,5",
    ...extra,
  });

  // Coleta montada direto no banco: não passa pelas rotas, então nasce sem histórico.
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
        ...extra,
      },
    });

  // Coleta criada pelo painel: nasce CONFIRMED, com a primeira linha do histórico.
  async function criarPeloPainel() {
    const res = await coletas.POST(req("POST", corpo()));
    expect(res.status).toBe(201);
    return (await res.json()) as { id: string };
  }

  const mudar = (id: string, body: unknown) => statusRota.POST(req("POST", body), ctx(id));

  // Linhas gravadas, na ordem em que a rota de leitura as devolve.
  const linhas = (collectionId: string) =>
    prisma.collectionStatusHistory.findMany({
      where: { collectionId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });

  // Só o histórico das coletas desta suite: outras suites não interferem na conta.
  const contar = () =>
    prisma.collectionStatusHistory.count({ where: { collection: { clientId: clienteId } } });

  // Procura uma chave em qualquer profundidade da resposta.
  function temChave(valor: unknown, proibidas: string[]): boolean {
    if (Array.isArray(valor)) return valor.some((item) => temChave(item, proibidas));
    if (valor && typeof valor === "object") {
      return Object.entries(valor).some(([chave, filho]) => proibidas.includes(chave) || temChave(filho, proibidas));
    }
    return false;
  }

  // Na ordem das dependências: coletas → manifesto → veículo → motorista →
  // usuários → cliente. O histórico não aparece aqui de propósito: sai junto da
  // coleta, pela chave estrangeira.
  async function limpar() {
    await prisma.collection.deleteMany({ where: { client: { cnpj: { in: [CNPJ_TESTE, CNPJ_OUTRA] } } } });
    await prisma.manifest.deleteMany({ where: { vehicle: { plate: PLACA_TESTE } } });
    await prisma.vehicle.deleteMany({ where: { plate: PLACA_TESTE } });
    await prisma.driver.deleteMany({ where: { cpf: CPF_TESTE } });
    await prisma.user.deleteMany({ where: { email: { startsWith: PREFIXO, mode: "insensitive" } } });
    await prisma.client.deleteMany({ where: { cnpj: { in: [CNPJ_TESTE, CNPJ_OUTRA] } } });
  }

  async function criarUsuario(nome: string, role: Perfil, extra: { clientId?: string } = {}) {
    return prisma.user.create({
      data: { name: nome, email: email(nome), password: HASH_FALSO, role, ...extra },
    });
  }

  beforeAll(async () => {
    prisma = (await import("../src/lib/prisma")).default;
    lib = await import("../src/lib/historico");
    coletas = await import("../src/app/api/coletas/route");
    portal = await import("../src/app/api/portal/coletas/route");
    statusRota = await import("../src/app/api/dashboard/coletas/[id]/status/route");
    historico = await import("../src/app/api/coletas/[id]/historico/route");

    await limpar();

    clienteId = (
      await prisma.client.create({ data: { companyName: "Empresa Teste Historico LTDA", cnpj: CNPJ_TESTE } })
    ).id;

    ids.OPERATION = (await criarUsuario("operacao", "OPERATION")).id;
    ids.DRIVER = (await criarUsuario("motorista", "DRIVER")).id;
    ids.CLIENT = (await criarUsuario("cliente", "CLIENT", { clientId: clienteId })).id;
  });

  beforeEach(() => {
    sessao.mockReset();
    entrarComo("OPERATION");
  });

  afterAll(async () => {
    if (prisma) await limpar();
  });

  describe("regra compartilhada", () => {
    it("lista vazia não toca no banco", async () => {
      const antes = await prisma.collectionStatusHistory.count();

      // Um cliente que estoura se for usado: prova que nem a consulta é montada.
      const intocavel = {
        collectionStatusHistory: {
          createMany: () => {
            throw new Error("não devia chamar o banco");
          },
        },
      } as unknown as typeof prisma;
      await lib.recordStatusChanges(intocavel, []);
      await lib.recordStatusChanges(prisma, []);

      expect(await prisma.collectionStatusHistory.count()).toBe(antes);
    });

    it("grava várias trocas de uma vez, também dentro de uma transação", async () => {
      const a = await montar();
      const b = await montar();

      await (await import("../src/lib/prisma")).transacao((tx) =>
        lib.recordStatusChanges(tx, [
          { collectionId: a.id, fromStatus: "COLLECTED", toStatus: "ROUTE", userId: ids.OPERATION },
          { collectionId: b.id, fromStatus: "COLLECTED", toStatus: "ROUTE", userId: null },
        ]),
      );

      expect(await linhas(a.id)).toMatchObject([
        { fromStatus: "COLLECTED", toStatus: "ROUTE", userId: ids.OPERATION },
      ]);
      expect(await linhas(b.id)).toMatchObject([{ fromStatus: "COLLECTED", toStatus: "ROUTE", userId: null }]);
    });

    it("transação desfeita não deixa linha", async () => {
      const coleta = await montar();

      await expect(
        (await import("../src/lib/prisma")).transacao(async (tx) => {
          await lib.recordStatusChanges(tx, [
            { collectionId: coleta.id, fromStatus: "PENDING", toStatus: "CONFIRMED", userId: null },
          ]);
          throw new Error("desfaz");
        }),
      ).rejects.toThrow("desfaz");

      expect(await linhas(coleta.id)).toEqual([]);
    });

    it("o select fechado só leva id, status, data e o id e nome do usuário", () => {
      expect(lib.STATUS_HISTORY_SELECT).toEqual({
        id: true,
        fromStatus: true,
        toStatus: true,
        createdAt: true,
        user: { select: { id: true, name: true } },
      });
    });
  });

  describe("gravação na criação", () => {
    it("painel: 201 deixa uma linha só, sem status anterior, CONFIRMED, com o operador", async () => {
      const criada = await criarPeloPainel();

      const gravadas = await linhas(criada.id);
      expect(gravadas).toHaveLength(1);
      expect(gravadas[0]).toMatchObject({ fromStatus: null, toStatus: "CONFIRMED", userId: ids.OPERATION });
    });

    it("painel: 400 não cria linha", async () => {
      const antes = await contar();

      const res = await coletas.POST(req("POST", corpo({ volumes: "abc" })));
      expect(res.status).toBe(400);

      expect(await contar()).toBe(antes);
    });

    it("painel: a resposta não ganha chave de histórico", async () => {
      const res = await coletas.POST(req("POST", corpo()));
      expect(res.status).toBe(201);
      expect(temChave(await res.json(), ["statusHistory", "statusChanges"])).toBe(false);
    });

    it("portal: 201 deixa uma linha só, sem status anterior, PENDING, com o usuário do portal", async () => {
      entrarComo("CLIENT");
      const res = await portal.POST(req("POST", corpo({ volumes: 2, weight: 5 })));
      expect(res.status).toBe(201);
      const { success, collection } = await res.json();

      expect(success).toBe(true);
      expect(collection.status).toBe("PENDING");
      expect(temChave(collection, ["statusHistory", "statusChanges"])).toBe(false);

      const gravadas = await linhas(collection.id);
      expect(gravadas).toHaveLength(1);
      expect(gravadas[0]).toMatchObject({ fromStatus: null, toStatus: "PENDING", userId: ids.CLIENT });
    });

    // Sessão que sobrou de um usuário apagado: sem a conferência no banco, a
    // gravação do histórico esbarraria na chave estrangeira e a rota daria 500.
    it("portal: sessão de usuário apagado → 401, sem criar coleta nem linha", async () => {
      const apagado = await criarUsuario("apagado", "CLIENT", { clientId: clienteId });
      await prisma.user.delete({ where: { id: apagado.id } });
      sessao.mockResolvedValue({ user: { id: apagado.id, role: "CLIENT", clientId: clienteId } });
      const coletasAntes = await prisma.collection.count({ where: { clientId: clienteId } });
      const antes = await contar();

      const res = await portal.POST(req("POST", corpo({ volumes: 2, weight: 5 })));
      expect(res.status).toBe(401);
      expect((await res.json()).error).toBe("Não autorizado");
      expect((await portal.GET()).status).toBe(401);

      expect(await prisma.collection.count({ where: { clientId: clienteId } })).toBe(coletasAntes);
      expect(await contar()).toBe(antes);
    });

    // Perfil e empresa valem os do banco, não os do token.
    it("portal: quem deixou de ser cliente não entra, e a empresa é a do cadastro", async () => {
      const outra = await prisma.client.create({ data: { companyName: "Outra Empresa Historico LTDA", cnpj: CNPJ_OUTRA } });
      try {
        sessao.mockResolvedValue({ user: { id: ids.OPERATION, role: "CLIENT", clientId: clienteId } });
        expect((await portal.POST(req("POST", corpo()))).status).toBe(401);

        sessao.mockResolvedValue({ user: { id: ids.CLIENT, role: "CLIENT", clientId: outra.id } });
        const res = await portal.POST(req("POST", corpo({ volumes: 2, weight: 5 })));
        expect(res.status).toBe(201);
        const { collection } = await res.json();
        expect((await prisma.collection.findUniqueOrThrow({ where: { id: collection.id } })).clientId).toBe(clienteId);
        expect(await prisma.collection.count({ where: { clientId: outra.id } })).toBe(0);
      } finally {
        // Se o teste falhou com coleta gravada na outra empresa, ela sai antes:
        // a chave estrangeira não deixa apagar a empresa com coleta.
        await prisma.collection.deleteMany({ where: { clientId: outra.id } });
        await prisma.client.delete({ where: { id: outra.id } });
      }
    });

    it("portal: 400 não cria linha", async () => {
      entrarComo("CLIENT");
      const antes = await contar();

      const res = await portal.POST(req("POST", corpo({ volumes: 0, weight: 5 })));
      expect(res.status).toBe(400);

      expect(await contar()).toBe(antes);
    });
  });

  describe("gravação na troca de status", () => {
    it("CONFIRMED → COLLECTED acrescenta a segunda linha, na ordem, com o operador", async () => {
      const criada = await criarPeloPainel();

      const res = await mudar(criada.id, { status: "COLLECTED" });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Object.keys(body).sort()).toEqual(["collection", "success"]);
      expect(body.collection.status).toBe("COLLECTED");
      expect(temChave(body, ["statusHistory", "statusChanges"])).toBe(false);

      const gravadas = await linhas(criada.id);
      expect(gravadas).toHaveLength(2);
      expect(gravadas[0]).toMatchObject({ fromStatus: null, toStatus: "CONFIRMED" });
      expect(gravadas[1]).toMatchObject({ fromStatus: "CONFIRMED", toStatus: "COLLECTED", userId: ids.OPERATION });
    });

    it("transição proibida (409), id inexistente (404) e corpo inválido (400) não gravam", async () => {
      const criada = await criarPeloPainel();
      const antes = await contar();

      expect((await mudar(criada.id, { status: "DELIVERED", receiverName: "Fulano" })).status).toBe(409);
      expect((await mudar(SEM_ID, { status: "COLLECTED" })).status).toBe(404);
      expect((await mudar(criada.id, { status: "INVENTADO" })).status).toBe(400);
      expect((await mudar(criada.id, {})).status).toBe(400);

      expect(await contar()).toBe(antes);
      expect(await linhas(criada.id)).toHaveLength(1);
    });

    it("cancelar coleta que está em manifesto (409) não grava", async () => {
      const motorista = await prisma.driver.create({
        data: { userId: ids.DRIVER, cpf: CPF_TESTE, cnh: "12345678900", cnhExpiry: new Date("2031-06-30"), category: "D" },
      });
      const veiculo = await prisma.vehicle.create({ data: { plate: PLACA_TESTE, model: "Teste", type: "VAN" } });
      const manifesto = await prisma.manifest.create({ data: { driverId: motorista.id, vehicleId: veiculo.id } });
      const coleta = await montar({ status: "COLLECTED", manifestId: manifesto.id });

      const res = await mudar(coleta.id, { status: "CANCELLED" });
      expect(res.status).toBe(409);

      expect(await linhas(coleta.id)).toEqual([]);
    });

    it("duas chamadas simultâneas para a mesma troca: uma 200, uma 409, uma linha nova só", async () => {
      const criada = await criarPeloPainel();

      const respostas = await Promise.all([
        mudar(criada.id, { status: "COLLECTED" }),
        mudar(criada.id, { status: "COLLECTED" }),
      ]);
      expect(respostas.map((res) => res.status).sort()).toEqual([200, 409]);

      const gravadas = await linhas(criada.id);
      expect(gravadas).toHaveLength(2);
      expect(gravadas.filter((linha) => linha.toStatus === "COLLECTED")).toHaveLength(1);
    });
  });

  describe("GET /api/coletas/[id]/historico", () => {
    it("sem sessão → 401; DRIVER e CLIENT → 403", async () => {
      const criada = await criarPeloPainel();

      entrarComo(null);
      expect((await historico.GET(req(), ctx(criada.id))).status).toBe(401);

      for (const perfil of ["DRIVER", "CLIENT"] as const) {
        entrarComo(perfil);
        expect((await historico.GET(req(), ctx(criada.id))).status, perfil).toBe(403);
      }
    });

    it("coleta inexistente → 404 com mensagem", async () => {
      const res = await historico.GET(req(), ctx(SEM_ID));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "Coleta não encontrada." });
    });

    it("200 com a lista em ordem cronológica e só as chaves do select fechado", async () => {
      const criada = await criarPeloPainel();
      expect((await mudar(criada.id, { status: "COLLECTED" })).status).toBe(200);
      expect((await mudar(criada.id, { status: "CANCELLED" })).status).toBe(200);

      const res = await historico.GET(req(), ctx(criada.id));
      expect(res.status).toBe(200);
      const lista = (await res.json()) as Linha[];

      expect(lista.map((linha) => [linha.fromStatus, linha.toStatus])).toEqual([
        [null, "CONFIRMED"],
        ["CONFIRMED", "COLLECTED"],
        ["COLLECTED", "CANCELLED"],
      ]);
      for (const linha of lista) {
        expect(Object.keys(linha).sort()).toEqual(["createdAt", "fromStatus", "id", "toStatus", "user"]);
        expect(linha.user).toEqual({ id: ids.OPERATION, name: "operacao" });
      }
      const datas = lista.map((linha) => new Date(linha.createdAt).getTime());
      expect(datas).toEqual([...datas].sort((a, b) => a - b));
    });

    it("mesma data: desempata pelo id", async () => {
      const coleta = await montar();
      const createdAt = new Date("2026-01-01T12:00:00.000Z");
      const idsLinhas = [
        "cccccccc-0000-4000-8000-000000000003",
        "aaaaaaaa-0000-4000-8000-000000000001",
        "bbbbbbbb-0000-4000-8000-000000000002",
      ];
      await prisma.collectionStatusHistory.createMany({
        data: idsLinhas.map((id) => ({ id, collectionId: coleta.id, toStatus: "CONFIRMED", createdAt })),
      });

      const lista = (await (await historico.GET(req(), ctx(coleta.id))).json()) as Linha[];
      expect(lista.map((linha) => linha.id)).toEqual([...idsLinhas].sort());
      expect(lista.every((linha) => linha.user === null)).toBe(true);
    });

    it("coleta sem histórico (anterior a esta entrega) → 200 com lista vazia", async () => {
      const antiga = await montar();

      const res = await historico.GET(req(), ctx(antiga.id));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([]);
    });

    it("o JSON não leva senha nem e-mail", async () => {
      const criada = await criarPeloPainel();

      const res = await historico.GET(req(), ctx(criada.id));
      const texto = JSON.stringify(await res.json());

      expect(texto).toContain(ids.OPERATION);
      expect(texto).not.toContain('"password"');
      expect(texto).not.toContain('"email"');
      expect(texto).not.toContain(HASH_FALSO);
      expect(texto).not.toContain(email("operacao"));
      expect(temChave(JSON.parse(texto), ["password", "email"])).toBe(false);
    });
  });

  describe("chaves estrangeiras", () => {
    it("apagar a coleta leva as linhas junto", async () => {
      const criada = await criarPeloPainel();
      expect((await mudar(criada.id, { status: "COLLECTED" })).status).toBe(200);
      expect(await linhas(criada.id)).toHaveLength(2);

      await prisma.collection.delete({ where: { id: criada.id } });

      expect(await prisma.collectionStatusHistory.count({ where: { collectionId: criada.id } })).toBe(0);
    });

    it("apagar o usuário deixa a linha, com o usuário nulo", async () => {
      const temporario = await criarUsuario("temporario", "OPERATION");
      sessao.mockResolvedValue({ user: { id: temporario.id, role: "OPERATION", clientId: null } });
      const criada = await criarPeloPainel();
      expect((await linhas(criada.id))[0].userId).toBe(temporario.id);

      await prisma.user.delete({ where: { id: temporario.id } });

      const gravadas = await linhas(criada.id);
      expect(gravadas).toHaveLength(1);
      expect(gravadas[0]).toMatchObject({ toStatus: "CONFIRMED", userId: null });

      entrarComo("OPERATION");
      const lista = (await (await historico.GET(req(), ctx(criada.id))).json()) as Linha[];
      expect(lista[0].user).toBeNull();
    });
  });
});
