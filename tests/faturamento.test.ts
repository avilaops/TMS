import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getServerSession } from "next-auth";

/** Faturamento pelo painel, contra um Postgres de verdade. */
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

const temBanco = Boolean(process.env.DATABASE_URL);

if (!temBanco) {
  console.warn("\n[faturamento.test] DATABASE_URL ausente: testes de integração PULADOS.\n");
}

const suite = temBanco ? describe : describe.skip;

// Tudo o que esta suite cria usa estes marcadores, e só isso é apagado.
const PREFIXO = "teste-faturamento-";
const CNPJ_A = "99555444000133";
const CNPJ_B = "99555444000214";
const HASH_FALSO = "$2b$10$hashfalsoparateste000000000000000000000000000000000";

suite("faturamento", () => {
  let banco: typeof import("../src/lib/prisma");
  let faturas: typeof import("../src/app/api/faturas/route");
  let faturaPorId: typeof import("../src/app/api/faturas/[id]/route");
  let faturaveis: typeof import("../src/app/api/faturas/faturaveis/route");
  let frete: typeof import("../src/app/api/coletas/[id]/frete/route");
  let portalFaturas: typeof import("../src/app/api/portal/faturas/route");

  const sessao = vi.mocked(getServerSession);
  const ids = { ADMIN: "", OPERATION: "", CLIENT: "" };
  let clienteA: string;
  let clienteB: string;

  const entrarComo = (perfil: keyof typeof ids | null) =>
    sessao.mockResolvedValue(perfil ? { user: { id: ids[perfil], role: perfil, clientId: null } } : null);

  const req = (method = "GET", body?: unknown, query = "") =>
    new Request(`http://localhost/api/teste${query}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

  async function limpar() {
    const { sistema } = banco;
    const cnpjs = { in: [CNPJ_A, CNPJ_B] };
    await sistema.user.updateMany({ where: { email: { startsWith: PREFIXO } }, data: { clientId: null } });
    await sistema.financialTransaction.deleteMany({ where: { client: { cnpj: cnpjs } } });
    await sistema.collection.deleteMany({ where: { client: { cnpj: cnpjs } } });
    await sistema.invoice.deleteMany({ where: { client: { cnpj: cnpjs } } });
    await sistema.client.deleteMany({ where: { cnpj: cnpjs } });
    await sistema.user.deleteMany({ where: { email: { startsWith: PREFIXO } } });
  }

  const carga = (clientId: string, extra: Record<string, unknown> = {}) =>
    banco.default.collection.create({
      data: {
        clientId,
        sender: "Remetente",
        receiver: "Destinatário",
        origin: "Rio Preto",
        destination: "Mirassol",
        volumes: 1,
        weight: 10,
        status: "DELIVERED",
        freightValue: 50,
        ...extra,
      },
    });

  const emitir = async (clientId: string, collectionIds: string[], extra: Record<string, unknown> = {}) => {
    entrarComo("ADMIN");
    return faturas.POST(req("POST", { clientId, collectionIds, dueDate: "2026-11-10", ...extra }));
  };

  beforeAll(async () => {
    banco = await import("../src/lib/prisma");
    faturas = await import("../src/app/api/faturas/route");
    faturaPorId = await import("../src/app/api/faturas/[id]/route");
    faturaveis = await import("../src/app/api/faturas/faturaveis/route");
    frete = await import("../src/app/api/coletas/[id]/frete/route");
    portalFaturas = await import("../src/app/api/portal/faturas/route");
    await limpar();

    clienteA = (await banco.default.client.create({ data: { companyName: `${PREFIXO}A`, cnpj: CNPJ_A } })).id;
    clienteB = (await banco.default.client.create({ data: { companyName: `${PREFIXO}B`, cnpj: CNPJ_B } })).id;
    for (const perfil of ["ADMIN", "OPERATION", "CLIENT"] as const) {
      ids[perfil] = (
        await banco.default.user.create({
          data: {
            name: perfil,
            email: `${PREFIXO}${perfil.toLowerCase()}@exemplo.br`,
            password: HASH_FALSO,
            role: perfil,
            ...(perfil === "CLIENT" && { clientId: clienteA }),
          },
        })
      ).id;
    }
  });

  beforeEach(async () => {
    sessao.mockReset();
    const { sistema } = banco;
    const cnpjs = { in: [CNPJ_A, CNPJ_B] };
    await sistema.financialTransaction.deleteMany({ where: { client: { cnpj: cnpjs } } });
    await sistema.collection.deleteMany({ where: { client: { cnpj: cnpjs } } });
    await sistema.invoice.deleteMany({ where: { client: { cnpj: cnpjs } } });
  });

  afterAll(async () => {
    if (banco) await limpar();
  });

  it("só o administrador: sem sessão 401, operação e cliente 403", async () => {
    const c = await carga(clienteA);

    entrarComo(null);
    expect((await faturas.GET()).status).toBe(401);

    for (const perfil of ["OPERATION", "CLIENT"] as const) {
      entrarComo(perfil);
      expect((await faturas.GET()).status, perfil).toBe(403);
      expect((await faturaveis.GET(req())).status, perfil).toBe(403);
      expect((await faturas.POST(req("POST", { clientId: clienteA, collectionIds: [c.id], dueDate: "2026-11-10" }))).status, perfil).toBe(403);
    }
    expect(await banco.default.invoice.count({ where: { clientId: clienteA } })).toBe(0);
  });

  it("faturável é carga entregue, com frete e fora de fatura; a cotar aparece à parte", async () => {
    const pronta = await carga(clienteA, { freightValue: 85.5 });
    const semValor = await carga(clienteA, { freightValue: null });
    await carga(clienteA, { status: "ROUTE" });
    await carga(clienteB);

    entrarComo("ADMIN");
    const doCliente = (await (await faturaveis.GET(req("GET", undefined, `?clientId=${clienteA}`))).json()) as {
      cargas: { id: string }[];
      aCotar: { id: string }[];
    };
    expect(doCliente.cargas.map((c) => c.id)).toEqual([pronta.id]);
    expect(doCliente.aCotar.map((c) => c.id)).toEqual([semValor.id]);

    const resumo = (await (await faturaveis.GET(req())).json()) as { clientId: string; cargas: number; total: number }[];
    expect(resumo.find((r) => r.clientId === clienteA)).toMatchObject({ cargas: 1, total: 85.5 });
    expect(resumo.find((r) => r.clientId === clienteB)).toMatchObject({ cargas: 1, total: 50 });
  });

  it("emitir soma os fretes, numera em sequência, prende as cargas e cria o lançamento a receber", async () => {
    const a = await carga(clienteA, { freightValue: 85.1 });
    const b = await carga(clienteA, { freightValue: 50.2 });

    const res = await emitir(clienteA, [a.id, b.id, a.id], { notes: "  Outubro  " });
    expect(res.status).toBe(201);
    const fatura = (await res.json()) as { id: string; number: number; total: number; status: string; _count: { collections: number } };
    expect(fatura).toMatchObject({ total: 135.3, status: "OPEN", _count: { collections: 2 } });

    const cargas = await banco.default.collection.findMany({ where: { id: { in: [a.id, b.id] } } });
    expect(cargas.every((c) => c.invoiceId === fatura.id)).toBe(true);

    const lancamento = await banco.default.financialTransaction.findUniqueOrThrow({ where: { invoiceId: fatura.id } });
    expect(lancamento).toMatchObject({
      type: "INCOME",
      amount: 135.3,
      status: "PENDING",
      clientId: clienteA,
      description: `Fatura nº ${fatura.number} (2 cargas)`,
    });

    const outra = (await (await emitir(clienteB, [(await carga(clienteB)).id])).json()) as { number: number };
    expect(outra.number).toBe(fatura.number + 1);

    // O cliente vê a própria fatura no portal, e não a do outro.
    entrarComo("CLIENT");
    const noPortal = (await (await portalFaturas.GET()).json()) as { description: string; amount: number }[];
    expect(noPortal).toEqual([expect.objectContaining({ description: `Fatura nº ${fatura.number} (2 cargas)`, amount: 135.3 })]);
  });

  it("recusa carga de outro cliente, não entregue, a cotar ou já faturada, sem faturar nada", async () => {
    const boa = await carga(clienteA);
    const casos: [string, { id: string }][] = [
      ["de outro cliente", await carga(clienteB)],
      ["não entregue", await carga(clienteA, { status: "ROUTE" })],
      ["a cotar", await carga(clienteA, { freightValue: null })],
    ];
    for (const [caso, ruim] of casos) {
      const res = await emitir(clienteA, [boa.id, ruim.id]);
      expect(res.status, caso).toBe(409);
    }
    expect((await emitir(clienteA, ["00000000-0000-4000-8000-000000000000"])).status).toBe(409);
    expect((await emitir("00000000-0000-4000-8000-000000000000", [boa.id])).status).toBe(400);
    expect((await emitir(clienteA, [])).status).toBe(400);
    expect((await emitir(clienteA, [boa.id], { dueDate: "não é data" })).status).toBe(400);

    expect(await banco.default.invoice.count({ where: { clientId: clienteA } })).toBe(0);
    expect((await banco.default.collection.findUniqueOrThrow({ where: { id: boa.id } })).invoiceId).toBeNull();

    // Já faturada: a segunda fatura com a mesma carga é recusada.
    expect((await emitir(clienteA, [boa.id])).status).toBe(201);
    expect((await emitir(clienteA, [boa.id])).status).toBe(409);
    expect(await banco.default.invoice.count({ where: { clientId: clienteA } })).toBe(1);
  });

  it("duas emissões simultâneas com a mesma carga: só uma passa, e os números não se repetem", async () => {
    const disputada = await carga(clienteA);
    const livre = await carga(clienteA);

    entrarComo("ADMIN");
    const respostas = await Promise.all([
      faturas.POST(req("POST", { clientId: clienteA, collectionIds: [disputada.id], dueDate: "2026-11-10" })),
      faturas.POST(req("POST", { clientId: clienteA, collectionIds: [disputada.id, livre.id], dueDate: "2026-11-10" })),
    ]);
    expect(respostas.map((r) => r.status).sort()).toEqual([201, 409]);

    const emitidas = await banco.default.invoice.findMany({ where: { clientId: clienteA } });
    expect(emitidas).toHaveLength(1);
    expect(await banco.default.financialTransaction.count({ where: { clientId: clienteA } })).toBe(1);
  });

  it("pagar, reabrir e cancelar levam o lançamento junto; cancelar solta as cargas", async () => {
    const c = await carga(clienteA);
    const fatura = (await (await emitir(clienteA, [c.id])).json()) as { id: string; number: number };
    const acao = async (action: string) => {
      entrarComo("ADMIN");
      return faturaPorId.PATCH(req("PATCH", { action }), ctx(fatura.id));
    };
    const lancamento = () => banco.default.financialTransaction.findUnique({ where: { invoiceId: fatura.id } });

    expect((await acao("reabrir")).status).toBe(409);
    expect((await acao("pagar")).status).toBe(200);
    expect(await banco.default.invoice.findUniqueOrThrow({ where: { id: fatura.id } })).toMatchObject({ status: "PAID", paidAt: expect.any(Date) });
    expect((await lancamento())?.status).toBe("PAID");

    expect((await acao("pagar")).status).toBe(409);
    expect((await acao("cancelar")).status).toBe(409); // paga não cancela direto

    expect((await acao("reabrir")).status).toBe(200);
    expect((await lancamento())?.status).toBe("PENDING");
    expect((await banco.default.invoice.findUniqueOrThrow({ where: { id: fatura.id } })).paidAt).toBeNull();

    expect((await acao("cancelar")).status).toBe(200);
    expect(await lancamento()).toBeNull();
    expect((await banco.default.collection.findUniqueOrThrow({ where: { id: c.id } })).invoiceId).toBeNull();
    expect((await acao("cancelar")).status).toBe(409);
    expect((await acao("explodir")).status).toBe(400);

    // A carga volta a ser faturável, e o número da cancelada não é reaproveitado.
    const nova = (await (await emitir(clienteA, [c.id])).json()) as { number: number };
    expect(nova.number).toBe(fatura.number + 1);

    entrarComo("ADMIN");
    expect((await faturaPorId.PATCH(req("PATCH", { action: "pagar" }), ctx("00000000-0000-4000-8000-000000000000"))).status).toBe(404);
  });

  it("a fatura aberta mostra as cargas cobradas, sem dado interno", async () => {
    const c = await carga(clienteA, { invoiceKey: "35260612345678000199550010000012341000077777", trackingCode: "9955544401" });
    const fatura = (await (await emitir(clienteA, [c.id])).json()) as { id: string };

    entrarComo("ADMIN");
    const res = await faturaPorId.GET(req(), ctx(fatura.id));
    expect(res.status).toBe(200);
    const corpo = await res.json();
    expect(corpo.collections).toEqual([expect.objectContaining({ id: c.id, freightValue: 50, trackingCode: "9955544401" })]);
    expect(corpo.client).toMatchObject({ cnpj: CNPJ_A });
    expect(JSON.stringify(corpo)).not.toContain("tenantId");
  });

  describe("frete informado depois da entrega", () => {
    it("a operação dá valor à carga a cotar, que passa a ser faturável", async () => {
      const c = await carga(clienteA, { freightValue: null });

      entrarComo("OPERATION");
      const res = await frete.PATCH(req("PATCH", { freightValue: "72,40" }), ctx(c.id));
      expect(res.status).toBe(200);
      expect(await banco.default.collection.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ freightValue: 72.4, freightManual: true });

      expect((await emitir(clienteA, [c.id])).status).toBe(201);
    });

    it("carga faturada não muda de frete; valor inválido e carga inexistente são recusados", async () => {
      const c = await carga(clienteA);
      await emitir(clienteA, [c.id]);

      entrarComo("OPERATION");
      expect((await frete.PATCH(req("PATCH", { freightValue: 999 }), ctx(c.id))).status).toBe(409);
      expect((await banco.default.collection.findUniqueOrThrow({ where: { id: c.id } })).freightValue).toBe(50);

      const livre = await carga(clienteA);
      for (const valor of [-1, "", "abc", null]) {
        expect((await frete.PATCH(req("PATCH", { freightValue: valor }), ctx(livre.id))).status, String(valor)).toBe(400);
      }
      expect((await frete.PATCH(req("PATCH", { freightValue: 1 }), ctx("00000000-0000-4000-8000-000000000000"))).status).toBe(404);

      entrarComo("CLIENT");
      expect((await frete.PATCH(req("PATCH", { freightValue: 1 }), ctx(livre.id))).status).toBe(403);
    });
  });
});
