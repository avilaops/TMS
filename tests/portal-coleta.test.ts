import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getServerSession } from "next-auth";

/**
 * Detalhe da coleta no portal do cliente (GET /api/portal/coletas/[id]),
 * contra um Postgres de verdade: o que o cliente vê, o que não vê e de quem.
 */
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

const temBanco = Boolean(process.env.DATABASE_URL);

if (!temBanco) {
  console.warn("\n[portal-coleta.test] DATABASE_URL ausente: testes de integração PULADOS.\n");
}

const suite = temBanco ? describe : describe.skip;

const PREFIXO = "teste-portalcoleta-";
const CNPJ_A = "99777666000155";
const CNPJ_B = "99777666000236";
// Ids dos passos da coleta de empate: iguais até o último dígito, para a ordem ser conhecida.
const ID_EMPATE = "99777666-0000-4000-8000-00000000000";
const HASH_FALSO = "$2b$10$hashfalsoparateste000000000000000000000000000000000";

suite("detalhe da coleta no portal do cliente", () => {
  let prisma: typeof import("../src/lib/prisma").default;
  let rota: typeof import("../src/app/api/portal/coletas/[id]/route");

  const sessao = vi.mocked(getServerSession);
  let clienteA: string;
  let usuarioA: string;
  let operador: string;
  let admin: string;
  let motorista: string;
  let semEmpresa: string;
  let coletaA: string;
  let coletaB: string;
  let coletaSemHistorico: string;
  let coletaEmpate: string;

  const entrar = (id: string | null, role = "CLIENT") =>
    sessao.mockResolvedValue(id ? { user: { id, role, clientId: null, name: "x", email: "x@teste" } } : null);

  const ver = (id: string) => rota.GET(new Request("http://localhost/api/teste"), { params: Promise.resolve({ id }) });

  async function limpar() {
    await prisma.collection.deleteMany({ where: { client: { cnpj: { in: [CNPJ_A, CNPJ_B] } } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: PREFIXO } } });
    await prisma.client.deleteMany({ where: { cnpj: { in: [CNPJ_A, CNPJ_B] } } });
  }

  const coleta = (clientId: string, status: string) => ({
    clientId,
    sender: "Remetente",
    receiver: "Destinatário",
    origin: "Rio Preto/SP",
    destination: "Mirassol/SP",
    volumes: 3,
    weight: 42,
    invoiceValue: 1234.5,
    invoiceKey: "35260612345678000199550010000012341000099999",
    status,
  });

  beforeAll(async () => {
    prisma = (await import("../src/lib/prisma")).default;
    rota = await import("../src/app/api/portal/coletas/[id]/route");
    await limpar();

    clienteA = (await prisma.client.create({ data: { companyName: "Cliente A", cnpj: CNPJ_A } })).id;
    const clienteB = (await prisma.client.create({ data: { companyName: "Cliente B", cnpj: CNPJ_B } })).id;

    usuarioA = (
      await prisma.user.create({
        data: { name: "Do cliente A", email: `${PREFIXO}a@exemplo.br`, password: HASH_FALSO, role: "CLIENT", clientId: clienteA },
      })
    ).id;
    operador = (
      await prisma.user.create({
        data: { name: "Operador", email: `${PREFIXO}op@exemplo.br`, password: HASH_FALSO, role: "OPERATION" },
      })
    ).id;
    admin = (
      await prisma.user.create({
        data: { name: "Admin", email: `${PREFIXO}admin@exemplo.br`, password: HASH_FALSO, role: "ADMIN" },
      })
    ).id;
    motorista = (
      await prisma.user.create({
        data: { name: "Motorista", email: `${PREFIXO}motorista@exemplo.br`, password: HASH_FALSO, role: "DRIVER" },
      })
    ).id;

    semEmpresa = (
      await prisma.user.create({
        data: { name: "Sem empresa", email: `${PREFIXO}solto@exemplo.br`, password: HASH_FALSO, role: "CLIENT" },
      })
    ).id;

    coletaA = (
      await prisma.collection.create({
        data: {
          ...coleta(clienteA, "DELIVERED"),
          trackingCode: "9977766601",
          statusHistory: {
            create: [
              // Horas distintas: gravadas juntas, as duas linhas sairiam com o mesmo `createdAt`.
              { fromStatus: null, toStatus: "PENDING", userId: usuarioA, createdAt: new Date("2026-06-01T12:00:00Z") },
              { fromStatus: "PENDING", toStatus: "DELIVERED", userId: operador, createdAt: new Date("2026-06-02T12:00:00Z") },
            ],
          },
          proof: {
            create: {
              receiverName: "Fulano Recebedor",
              receiverDoc: "12345678901",
              photoBase64: "data:image/jpeg;base64,FOTO",
              signatureBase64: "data:image/png;base64,ASSINATURA",
              latitude: -20.81,
              longitude: -49.37,
              status: "SUBMITTED",
            },
          },
        },
      })
    ).id;
    coletaB = (await prisma.collection.create({ data: coleta(clienteB, "PENDING") })).id;
    coletaSemHistorico = (await prisma.collection.create({ data: coleta(clienteA, "PENDING") })).id;

    // Quatro passos na mesma hora, gravados fora da ordem dos ids: só o desempate por id põe em ordem.
    coletaEmpate = (await prisma.collection.create({ data: coleta(clienteA, "DELIVERED") })).id;
    const mesmaHora = new Date("2026-06-03T12:00:00Z");
    for (const [fim, toStatus] of [
      ["3", "COLLECTED"],
      ["1", "PENDING"],
      ["4", "DELIVERED"],
      ["2", "CONFIRMED"],
    ]) {
      await prisma.collectionStatusHistory.create({
        data: { id: `${ID_EMPATE}${fim}`, collectionId: coletaEmpate, toStatus, userId: operador, createdAt: mesmaHora },
      });
    }
  });

  beforeEach(() => sessao.mockReset());

  afterAll(async () => {
    if (prisma) await limpar();
  });

  it("o cliente vê a própria coleta, com a linha do tempo e o documento para o link público", async () => {
    entrar(usuarioA);
    const res = await ver(coletaA);
    expect(res.status).toBe(200);

    const corpo = await res.json();
    expect(corpo).toMatchObject({ id: coletaA, status: "DELIVERED", trackingCode: "9977766601", client: { cnpj: CNPJ_A } });
    expect(corpo.statusHistory.map((p: { toStatus: string }) => p.toStatus)).toEqual(["PENDING", "DELIVERED"]);
    // Cada passo leva só a situação e a hora: quem trocou o status é dado interno.
    for (const passo of corpo.statusHistory) expect(Object.keys(passo).sort()).toEqual(["createdAt", "toStatus"]);
    // A resposta pode levar foto e assinatura: não fica em cache.
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("coleta sem histórico gravado devolve a linha do tempo vazia, sem erro", async () => {
    entrar(usuarioA);
    const res = await ver(coletaSemHistorico);
    expect(res.status).toBe(200);
    expect((await res.json()).statusHistory).toEqual([]);
  });

  it("passos gravados na mesma hora saem na ordem do id", async () => {
    entrar(usuarioA);
    const corpo = await (await ver(coletaEmpate)).json();
    expect(new Set(corpo.statusHistory.map((p: { createdAt: string }) => p.createdAt)).size).toBe(1);
    expect(corpo.statusHistory.map((p: { toStatus: string }) => p.toStatus)).toEqual([
      "PENDING",
      "CONFIRMED",
      "COLLECTED",
      "DELIVERED",
    ]);
  });

  it("comprovante em conferência ou recusado não aparece; aprovado aparece", async () => {
    entrar(usuarioA);
    expect((await (await ver(coletaA)).json()).proof).toBeNull();

    await prisma.proofOfDelivery.update({
      where: { collectionId: coletaA },
      data: { status: "REJECTED", rejectionReason: "Foto ilegível", reviewedById: operador, reviewedAt: new Date() },
    });
    const recusado = await (await ver(coletaA)).json();
    expect(recusado.proof).toBeNull();
    expect(JSON.stringify(recusado)).not.toContain("Foto ilegível");

    await prisma.proofOfDelivery.update({ where: { collectionId: coletaA }, data: { status: "APPROVED" } });
    const aprovado = await (await ver(coletaA)).json();
    expect(aprovado.proof).toMatchObject({
      receiverName: "Fulano Recebedor",
      receiverDoc: "12345678901",
      photoBase64: "data:image/jpeg;base64,FOTO",
      signatureBase64: "data:image/png;base64,ASSINATURA",
    });
  });

  it("a resposta não carrega dado interno, nem com o comprovante aprovado", async () => {
    entrar(usuarioA);
    const corpo = await (await ver(coletaA)).json();
    // Com histórico e comprovante de verdade: sem eles, a lista abaixo não provaria nada.
    expect(corpo.statusHistory).toHaveLength(2);
    expect(corpo.proof).not.toBeNull();
    const texto = JSON.stringify(corpo);
    for (const proibido of [
      "latitude",
      "longitude",
      "reviewedById",
      "rejectionReason",
      "Foto ilegível",
      "userId",
      "invoiceKey",
      "3526061234567800019955",
      "tenantId",
      "password",
      "$2b$",
      "-20.81",
      operador,
    ]) {
      expect(texto, `"${proibido}" presente na resposta`).not.toContain(proibido);
    }
  });

  it("coleta de outro cliente da mesma transportadora responde 404, igual a id que não existe", async () => {
    entrar(usuarioA);
    const deOutro = await ver(coletaB);
    const inexistente = await ver("00000000-0000-4000-8000-000000000000");

    expect(deOutro.status).toBe(404);
    expect(inexistente.status).toBe(404);
    expect(await deOutro.json()).toEqual(await inexistente.json());
  });

  it("sem sessão, ou com perfil que não é de cliente, não entra", async () => {
    entrar(null);
    expect((await ver(coletaA)).status).toBe(401);

    for (const [id, role] of [
      [operador, "OPERATION"],
      [admin, "ADMIN"],
      [motorista, "DRIVER"],
    ]) {
      entrar(id, role);
      expect((await ver(coletaA)).status, `perfil ${role}`).toBe(401);
    }
  });

  it("cliente sem empresa vinculada recebe 403", async () => {
    entrar(semEmpresa);
    expect((await ver(coletaA)).status).toBe(403);
  });
});
