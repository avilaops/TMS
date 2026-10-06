import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getServerSession } from "next-auth";
import {
  MANIFEST_STATUSES,
  MANIFEST_TRANSITIONS,
  canManifestTransition,
  createManifestSchema,
  isLoadable,
  isManifestEditable,
  updateManifestSchema,
} from "../src/lib/manifestos";
import { MANIFEST_STATUS } from "../src/lib/format";

/**
 * Ciclo do manifesto pelo painel — montar, alterar, liberar a saída, encerrar
 * e cancelar — contra um Postgres de verdade, no padrão de `coletas.test.ts`
 * (sessão simulada, handlers reais).
 *
 * A tabela de transições é testada à parte, sem banco. Sem DATABASE_URL a
 * parte de integração é pulada com aviso — no CI ela sempre roda.
 */
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

const temBanco = Boolean(process.env.DATABASE_URL);

if (!temBanco) {
  console.warn(
    "\n[manifestos.test] DATABASE_URL ausente: testes de integração PULADOS.\n" +
      "Rode com um Postgres real para exercitá-los.\n",
  );
}

const suite = temBanco ? describe : describe.skip;

describe("regras do manifesto", () => {
  const tabela: [string, string[]][] = [
    ["ASSEMBLING", ["ROUTE", "CANCELLED"]],
    ["ROUTE", ["FINISHED"]],
    ["FINISHED", []],
    ["CANCELLED", []],
  ];

  it.each(tabela)("%s só vai para o que a tabela permite", (de, permitidos) => {
    for (const para of MANIFEST_STATUSES) {
      expect(canManifestTransition(de, para), `${de} → ${para}`).toBe(permitidos.includes(para));
    }
  });

  it("a tabela cobre os quatro status e recusa status desconhecido", () => {
    expect(Object.keys(MANIFEST_TRANSITIONS).sort()).toEqual([...MANIFEST_STATUSES].sort());
    expect(canManifestTransition("INVENTADO", "ROUTE")).toBe(false);
    expect(canManifestTransition("ASSEMBLING", "INVENTADO")).toBe(false);
    // Nome de propriedade herdada não pode passar por status.
    expect(canManifestTransition("constructor", "ROUTE")).toBe(false);
  });

  it("só a viagem em montagem pode ser alterada", () => {
    expect(isManifestEditable({ status: "ASSEMBLING" })).toBe(true);
    for (const status of ["ROUTE", "FINISHED", "CANCELLED"]) {
      expect(isManifestEditable({ status }), status).toBe(false);
    }
  });

  it("só carga coletada e sem manifesto pode ser escolhida", () => {
    expect(isLoadable({ status: "COLLECTED", manifestId: null })).toBe(true);
    expect(isLoadable({ status: "COLLECTED" })).toBe(true);
    expect(isLoadable({ status: "COLLECTED", manifestId: "m1" })).toBe(false);
    for (const status of ["PENDING", "CONFIRMED", "ROUTE", "DELIVERED", "CANCELLED", "REJECTED"]) {
      expect(isLoadable({ status, manifestId: null }), status).toBe(false);
    }
  });

  it("a mesma carga marcada duas vezes conta uma vez, e viagem sem carga não nasce", () => {
    const lido = createManifestSchema.safeParse({ driverId: "d", vehicleId: "v", collectionIds: ["a", "a", "b"] });
    expect(lido.data?.collectionIds).toEqual(["a", "b"]);
    expect(createManifestSchema.safeParse({ driverId: "d", vehicleId: "v", collectionIds: [] }).success).toBe(false);
    expect(createManifestSchema.safeParse({ driverId: "d", vehicleId: "v" }).success).toBe(false);
    expect(createManifestSchema.safeParse({ driverId: "", vehicleId: "v", collectionIds: ["a"] }).success).toBe(false);
  });

  it("alteração vazia é recusada, e status não passa pela alteração", () => {
    expect(updateManifestSchema.safeParse({}).success).toBe(false);
    expect(updateManifestSchema.safeParse({ addCollectionIds: [] }).success).toBe(false);
    expect(updateManifestSchema.safeParse({ status: "ROUTE" }).success).toBe(false);
    expect(updateManifestSchema.safeParse({ driverId: "d", status: "ROUTE" }).data).toEqual({ driverId: "d" });
  });

  it("todo status tem rótulo em português", () => {
    for (const status of MANIFEST_STATUSES) {
      expect(MANIFEST_STATUS[status]?.label, status).toBeTruthy();
    }
  });
});

// Tudo o que esta suite cria usa estes marcadores, e só isso é apagado.
const PREFIXO = "teste-manifestos-";
const CNPJ_TESTE = "99888777000750";
const CPF_A = "99988877711";
const CPF_B = "99988877722";
const CPF_INATIVO = "99988877733";
const PLACA_A = "TMF0A01";
const PLACA_B = "TMF0A02";
const PLACA_OFICINA = "TMF0A03";
const PLACAS = [PLACA_A, PLACA_B, PLACA_OFICINA];
const HASH_FALSO = "$2b$10$hashfalsoparateste000000000000000000000000000000000";
const SEM_ID = "00000000-0000-0000-0000-000000000000";

suite("manifestos pelo painel", () => {
  let prisma: typeof import("../src/lib/prisma").default;
  let manifestos: typeof import("../src/app/api/manifestos/route");
  let manifesto: typeof import("../src/app/api/manifestos/[id]/route");
  let statusRota: typeof import("../src/app/api/manifestos/[id]/status/route");
  let viagens: typeof import("../src/app/api/driver/manifestos/route");

  let operadorId: string;
  let clienteId: string;
  let motoristaA: { id: string; userId: string };
  let motoristaB: { id: string; userId: string };
  let motoristaInativo: { id: string; userId: string };
  let veiculoA: string;
  let veiculoB: string;
  let veiculoOficina: string;

  const sessao = vi.mocked(getServerSession);

  const req = (method = "GET", body?: unknown) =>
    new Request("http://localhost/api/teste", {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const email = (nome: string) => `${PREFIXO}${nome}@exemplo.br`;

  // Carga montada direto no banco, no estado que o teste precisa.
  const carga = async (status = "COLLECTED") =>
    (
      await prisma.collection.create({
        data: {
          clientId: clienteId,
          sender: "Remetente Teste",
          receiver: "Destinatário Teste",
          origin: "Origem - SP",
          destination: "Destino - SP",
          volumes: 1,
          weight: 1,
          status,
        },
      })
    ).id;

  const lerCarga = (id: string) => prisma.collection.findUniqueOrThrow({ where: { id } });
  const lerManifesto = (id: string) => prisma.manifest.findUniqueOrThrow({ where: { id } });
  const lerVeiculo = (id: string) => prisma.vehicle.findUniqueOrThrow({ where: { id } });

  const criar = (body: unknown) => manifestos.POST(req("POST", body));
  const alterar = (id: string, body: unknown) => manifesto.PATCH(req("PATCH", body), ctx(id));
  const mudar = (id: string, status: string) => statusRota.POST(req("POST", { status }), ctx(id));

  /** Viagem em montagem com `n` cargas coletadas. */
  async function montar(n = 1, driverId = motoristaA.id, vehicleId = veiculoA) {
    const collectionIds = await Promise.all(Array.from({ length: n }, () => carga()));
    const res = await criar({ driverId, vehicleId, collectionIds });
    expect(res.status).toBe(201);
    return { id: (await res.json()).id as string, collectionIds };
  }

  // Na ordem das dependências: cargas → manifestos → veículos → motoristas → usuários → cliente.
  async function limparViagens() {
    await prisma.collection.deleteMany({ where: { client: { cnpj: CNPJ_TESTE } } });
    await prisma.manifest.deleteMany({ where: { vehicle: { plate: { in: PLACAS } } } });
    await prisma.vehicle.updateMany({ where: { plate: { in: [PLACA_A, PLACA_B] } }, data: { status: "AVAILABLE" } });
  }

  async function limpar() {
    await limparViagens();
    await prisma.vehicle.deleteMany({ where: { plate: { in: PLACAS } } });
    await prisma.driver.deleteMany({ where: { cpf: { in: [CPF_A, CPF_B, CPF_INATIVO] } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: PREFIXO, mode: "insensitive" } } });
    await prisma.client.deleteMany({ where: { cnpj: CNPJ_TESTE } });
  }

  // Procura a chave `password` em qualquer profundidade da resposta.
  function temChaveDeSenha(valor: unknown): boolean {
    if (Array.isArray(valor)) return valor.some(temChaveDeSenha);
    if (valor && typeof valor === "object") {
      return Object.entries(valor).some(([chave, filho]) => chave === "password" || temChaveDeSenha(filho));
    }
    return false;
  }

  async function criarMotorista(nome: string, cpf: string, active: boolean) {
    const user = await prisma.user.create({
      data: { name: `Motorista ${nome}`, email: email(nome), password: HASH_FALSO, role: "DRIVER" },
    });
    const driver = await prisma.driver.create({
      data: { userId: user.id, cpf, cnh: "12345678900", cnhExpiry: new Date("2031-06-30"), category: "D", active },
    });
    return { id: driver.id, userId: user.id };
  }

  const criarVeiculo = async (plate: string, status = "AVAILABLE") =>
    (await prisma.vehicle.create({ data: { plate, model: "Teste", type: "VAN", status } })).id;

  beforeAll(async () => {
    prisma = (await import("../src/lib/prisma")).default;
    manifestos = await import("../src/app/api/manifestos/route");
    manifesto = await import("../src/app/api/manifestos/[id]/route");
    statusRota = await import("../src/app/api/manifestos/[id]/status/route");
    viagens = await import("../src/app/api/driver/manifestos/route");

    await limpar();

    operadorId = (
      await prisma.user.create({
        data: { name: "operacao", email: email("operacao"), password: HASH_FALSO, role: "OPERATION" },
      })
    ).id;
    clienteId = (
      await prisma.client.create({ data: { companyName: "Empresa Teste Manifestos LTDA", cnpj: CNPJ_TESTE } })
    ).id;

    motoristaA = await criarMotorista("a", CPF_A, true);
    motoristaB = await criarMotorista("b", CPF_B, true);
    motoristaInativo = await criarMotorista("inativo", CPF_INATIVO, false);
    veiculoA = await criarVeiculo(PLACA_A);
    veiculoB = await criarVeiculo(PLACA_B);
    veiculoOficina = await criarVeiculo(PLACA_OFICINA, "MAINTENANCE");
  });

  beforeEach(async () => {
    await limparViagens();
    sessao.mockReset();
    sessao.mockResolvedValue({ user: { id: operadorId, role: "OPERATION", clientId: null } });
  });

  afterAll(async () => {
    if (prisma) await limpar();
  });

  describe("montagem", () => {
    it("válida → 201, nasce em montagem e reserva as cargas sem tirá-las do depósito", async () => {
      const [c1, c2] = [await carga(), await carga()];
      const res = await criar({ driverId: motoristaA.id, vehicleId: veiculoA, collectionIds: [c1, c2, c1] });
      expect(res.status).toBe(201);
      const criado = await res.json();

      expect(criado.status).toBe("ASSEMBLING");
      expect(criado.collections.map((c: { id: string }) => c.id).sort()).toEqual([c1, c2].sort());
      expect(criado.collections[0].client.companyName).toBe("Empresa Teste Manifestos LTDA");
      expect(criado.driver.user.name).toBe("Motorista a");
      expect(temChaveDeSenha(criado)).toBe(false);

      for (const id of [c1, c2]) {
        expect(await lerCarga(id)).toMatchObject({ status: "COLLECTED", manifestId: criado.id });
      }
      // Montar não ocupa o veículo: quem ocupa é a saída.
      expect((await lerVeiculo(veiculoA)).status).toBe("AVAILABLE");
    });

    it("recusa o que não pode viajar, sem criar manifesto nem prender carga", async () => {
      const boa = await carga();
      const antes = await prisma.manifest.count();

      const casos: [string, Record<string, unknown>, number][] = [
        ["sem motorista", { vehicleId: veiculoA, collectionIds: [boa] }, 400],
        ["sem carga", { driverId: motoristaA.id, vehicleId: veiculoA, collectionIds: [] }, 400],
        ["motorista inativo", { driverId: motoristaInativo.id, vehicleId: veiculoA, collectionIds: [boa] }, 400],
        ["motorista que não existe", { driverId: SEM_ID, vehicleId: veiculoA, collectionIds: [boa] }, 400],
        ["veículo que não existe", { driverId: motoristaA.id, vehicleId: SEM_ID, collectionIds: [boa] }, 400],
        ["veículo em manutenção", { driverId: motoristaA.id, vehicleId: veiculoOficina, collectionIds: [boa] }, 409],
        ["carga que não existe", { driverId: motoristaA.id, vehicleId: veiculoA, collectionIds: [boa, SEM_ID] }, 409],
      ];
      for (const status of ["PENDING", "CONFIRMED", "ROUTE", "DELIVERED", "CANCELLED"]) {
        const ruim = await carga(status);
        casos.push([`carga ${status}`, { driverId: motoristaA.id, vehicleId: veiculoA, collectionIds: [boa, ruim] }, 409]);
      }

      for (const [nome, body, esperado] of casos) {
        const res = await criar(body);
        expect(res.status, nome).toBe(esperado);
        expect((await res.json()).error, nome).toBeTruthy();
      }

      expect(await prisma.manifest.count()).toBe(antes);
      expect((await lerCarga(boa)).manifestId).toBeNull();
    });

    it("a mesma carga não entra em duas viagens", async () => {
      const { collectionIds } = await montar(1);
      const res = await criar({ driverId: motoristaB.id, vehicleId: veiculoB, collectionIds });
      expect(res.status).toBe(409);
    });

    it("sem sessão → 401; cliente e motorista → 403", async () => {
      const body = { driverId: motoristaA.id, vehicleId: veiculoA, collectionIds: [await carga()] };

      sessao.mockResolvedValue(null);
      expect((await criar(body)).status).toBe(401);
      expect((await manifestos.GET()).status).toBe(401);

      sessao.mockResolvedValue({ user: { id: motoristaA.userId, role: "DRIVER", clientId: null } });
      expect((await criar(body)).status).toBe(403);
      expect((await alterar(SEM_ID, { driverId: motoristaB.id })).status).toBe(403);
      expect((await mudar(SEM_ID, "ROUTE")).status).toBe(403);
    });
  });

  describe("alteração", () => {
    it("troca motorista e veículo, põe e retira carga enquanto está em montagem", async () => {
      const { id, collectionIds } = await montar(2);
      const nova = await carga();

      const res = await alterar(id, {
        driverId: motoristaB.id,
        vehicleId: veiculoB,
        addCollectionIds: [nova],
        removeCollectionIds: [collectionIds[0]],
      });
      expect(res.status).toBe(200);
      const alterado = await res.json();

      expect(alterado).toMatchObject({ driverId: motoristaB.id, vehicleId: veiculoB, status: "ASSEMBLING" });
      expect(alterado.collections.map((c: { id: string }) => c.id).sort()).toEqual([collectionIds[1], nova].sort());
      expect(await lerCarga(collectionIds[0])).toMatchObject({ status: "COLLECTED", manifestId: null });
    });

    it("recusa carga indisponível, carga de outra viagem e recursos inválidos, sem gravar pela metade", async () => {
      const { id, collectionIds } = await montar(1);
      const outra = await montar(1, motoristaB.id, veiculoB);
      const pendente = await carga("PENDING");
      const livre = await carga();

      const casos: [string, Record<string, unknown>, number][] = [
        ["nada a alterar", {}, 400],
        ["carga pendente", { addCollectionIds: [livre, pendente] }, 409],
        ["carga de outra viagem", { addCollectionIds: outra.collectionIds }, 409],
        ["retirar carga de outra viagem", { removeCollectionIds: outra.collectionIds }, 409],
        ["motorista inativo", { driverId: motoristaInativo.id, addCollectionIds: [livre] }, 400],
        ["veículo em manutenção", { vehicleId: veiculoOficina, addCollectionIds: [livre] }, 409],
      ];
      for (const [nome, body, esperado] of casos) {
        expect((await alterar(id, body)).status, nome).toBe(esperado);
      }

      expect(await lerManifesto(id)).toMatchObject({ driverId: motoristaA.id, vehicleId: veiculoA });
      expect((await lerCarga(livre)).manifestId).toBeNull();
      expect((await lerCarga(collectionIds[0])).manifestId).toBe(id);
      expect((await lerCarga(outra.collectionIds[0])).manifestId).toBe(outra.id);
    });

    it("manifesto que não existe → 404; depois da saída → 409", async () => {
      expect((await alterar(SEM_ID, { driverId: motoristaB.id })).status).toBe(404);

      const { id, collectionIds } = await montar(1);
      expect((await mudar(id, "ROUTE")).status).toBe(200);
      expect((await alterar(id, { removeCollectionIds: collectionIds })).status).toBe(409);
      expect((await lerCarga(collectionIds[0])).manifestId).toBe(id);
    });
  });

  describe("saída", () => {
    it("põe as cargas em rota e ocupa o veículo", async () => {
      const { id, collectionIds } = await montar(2);

      const res = await mudar(id, "ROUTE");
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.manifest.status).toBe("ROUTE");
      expect(temChaveDeSenha(body)).toBe(false);
      for (const c of collectionIds) {
        expect(await lerCarga(c)).toMatchObject({ status: "ROUTE", manifestId: id });
      }
      expect((await lerVeiculo(veiculoA)).status).toBe("ON_ROUTE");
    });

    it("veículo ou motorista já em rota em outra viagem → 409", async () => {
      const primeira = await montar(1);
      expect((await mudar(primeira.id, "ROUTE")).status).toBe(200);

      const mesmoVeiculo = await montar(1, motoristaB.id, veiculoA);
      const resVeiculo = await mudar(mesmoVeiculo.id, "ROUTE");
      expect(resVeiculo.status).toBe(409);
      expect((await resVeiculo.json()).error).toMatch(/veículo/i);

      const mesmoMotorista = await montar(1, motoristaA.id, veiculoB);
      const resMotorista = await mudar(mesmoMotorista.id, "ROUTE");
      expect(resMotorista.status).toBe(409);
      expect((await resMotorista.json()).error).toMatch(/motorista/i);

      for (const viagem of [mesmoVeiculo, mesmoMotorista]) {
        expect((await lerManifesto(viagem.id)).status).toBe("ASSEMBLING");
        expect((await lerCarga(viagem.collectionIds[0])).status).toBe("COLLECTED");
      }
      expect((await lerVeiculo(veiculoB)).status).toBe("AVAILABLE");
    });

    it("duas viagens disputando o mesmo veículo ao mesmo tempo: só uma sai", async () => {
      const uma = await montar(1, motoristaA.id, veiculoA);
      const outra = await montar(1, motoristaB.id, veiculoA);

      const respostas = await Promise.all([mudar(uma.id, "ROUTE"), mudar(outra.id, "ROUTE")]);
      expect(respostas.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await prisma.manifest.count({ where: { vehicleId: veiculoA, status: "ROUTE" } })).toBe(1);
    });

    it("viagem sem carga, motorista desativado ou veículo que foi para a oficina → não sai", async () => {
      const vazia = await montar(1);
      expect((await alterar(vazia.id, { removeCollectionIds: vazia.collectionIds })).status).toBe(200);
      expect((await mudar(vazia.id, "ROUTE")).status).toBe(409);
      expect((await mudar(vazia.id, "CANCELLED")).status).toBe(200);

      const { id, collectionIds } = await montar(1, motoristaB.id, veiculoB);
      await prisma.driver.update({ where: { id: motoristaB.id }, data: { active: false } });
      try {
        expect((await mudar(id, "ROUTE")).status).toBe(400);
      } finally {
        await prisma.driver.update({ where: { id: motoristaB.id }, data: { active: true } });
      }

      await prisma.vehicle.update({ where: { id: veiculoB }, data: { status: "MAINTENANCE" } });
      try {
        expect((await mudar(id, "ROUTE")).status).toBe(409);
      } finally {
        await prisma.vehicle.update({ where: { id: veiculoB }, data: { status: "AVAILABLE" } });
      }

      expect((await lerManifesto(id)).status).toBe("ASSEMBLING");
      expect((await lerCarga(collectionIds[0])).status).toBe("COLLECTED");
    });
  });

  describe("encerramento e cancelamento", () => {
    it("encerrar mantém o que foi entregue, devolve o resto ao depósito e solta o veículo", async () => {
      const { id, collectionIds } = await montar(2);
      const [entregue, naoEntregue] = collectionIds;
      expect((await mudar(id, "ROUTE")).status).toBe(200);
      await prisma.collection.update({ where: { id: entregue }, data: { status: "DELIVERED", receiverName: "Fulano" } });

      const res = await mudar(id, "FINISHED");
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.returned).toBe(1);
      expect(body.manifest.status).toBe("FINISHED");
      expect(await lerCarga(entregue)).toMatchObject({ status: "DELIVERED", manifestId: id });
      expect(await lerCarga(naoEntregue)).toMatchObject({ status: "COLLECTED", manifestId: null });
      expect((await lerVeiculo(veiculoA)).status).toBe("AVAILABLE");

      // A carga devolvida pode sair em outra viagem, com o mesmo veículo.
      const nova = await criar({ driverId: motoristaA.id, vehicleId: veiculoA, collectionIds: [naoEntregue] });
      expect(nova.status).toBe(201);
      expect((await mudar((await nova.json()).id, "ROUTE")).status).toBe(200);
    });

    it("cancelar em montagem solta as cargas, que continuam coletadas", async () => {
      const { id, collectionIds } = await montar(2);

      const res = await mudar(id, "CANCELLED");
      expect(res.status).toBe(200);
      expect((await res.json()).returned).toBe(2);

      expect((await lerManifesto(id)).status).toBe("CANCELLED");
      for (const c of collectionIds) {
        expect(await lerCarga(c)).toMatchObject({ status: "COLLECTED", manifestId: null });
      }
    });

    it("recusa troca fora da tabela, status inválido e manifesto que não existe", async () => {
      const { id, collectionIds } = await montar(1);

      expect((await mudar(id, "FINISHED")).status).toBe(409);
      expect((await mudar(id, "ASSEMBLING")).status).toBe(400);
      expect((await mudar(id, "INVENTADO")).status).toBe(400);
      expect((await mudar(SEM_ID, "ROUTE")).status).toBe(404);

      expect((await mudar(id, "ROUTE")).status).toBe(200);
      const cancelar = await mudar(id, "CANCELLED");
      expect(cancelar.status).toBe(409);
      expect((await cancelar.json()).error).toContain("Em rota");
      expect((await mudar(id, "ROUTE")).status).toBe(409);

      expect((await mudar(id, "FINISHED")).status).toBe(200);
      for (const status of ["ROUTE", "FINISHED", "CANCELLED"]) {
        expect((await mudar(id, status)).status, `FINISHED → ${status}`).toBe(409);
      }
      expect(await lerCarga(collectionIds[0])).toMatchObject({ status: "COLLECTED", manifestId: null });
    });
  });

  describe("aplicativo do motorista", () => {
    it("só enxerga a viagem depois de liberada, e deixa de ver quando encerra", async () => {
      const { id } = await montar(1);
      sessao.mockResolvedValue({ user: { id: motoristaA.userId, role: "DRIVER", clientId: null } });
      const listar = async () => ((await (await viagens.GET()).json()) as { id: string }[]).map((m) => m.id);

      expect(await listar()).not.toContain(id);

      sessao.mockResolvedValue({ user: { id: operadorId, role: "OPERATION", clientId: null } });
      expect((await mudar(id, "ROUTE")).status).toBe(200);
      sessao.mockResolvedValue({ user: { id: motoristaA.userId, role: "DRIVER", clientId: null } });
      expect(await listar()).toContain(id);

      sessao.mockResolvedValue({ user: { id: operadorId, role: "OPERATION", clientId: null } });
      expect((await mudar(id, "FINISHED")).status).toBe(200);
      sessao.mockResolvedValue({ user: { id: motoristaA.userId, role: "DRIVER", clientId: null } });
      expect(await listar()).not.toContain(id);
    });
  });
});
