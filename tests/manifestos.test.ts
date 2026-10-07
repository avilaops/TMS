import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getServerSession } from "next-auth";
import { COLLECTION_STATUSES } from "../src/lib/coletas";
import { MANIFEST_STATUS, statusBadge } from "../src/lib/format";
import {
  EMBARKABLE_STATUSES,
  MANIFEST_STATUSES,
  MAX_MANIFEST_COLLECTIONS,
  canEmbark,
  createManifestSchema,
  isManifestEditable,
  manifestLoadsLabel,
  updateManifestSchema,
} from "../src/lib/manifestos";
import { MANIFESTOS_ENDPOINTS, loadManifestos } from "../src/app/dashboard/manifestos/carregar";

/**
 * Manifestos de viagem pelo painel — montar, alterar, liberar a saída,
 * retirar carga, encerrar e cancelar —
 * contra um Postgres de verdade, no padrão de `coletas.test.ts` (sessão
 * simulada, handlers reais).
 *
 * As regras puras e a carga da tela são testadas à parte, sem banco. Sem
 * DATABASE_URL a parte de integração é pulada com aviso — no CI ela sempre roda.
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
  it("só carga coletada e fora de manifesto embarca", () => {
    expect([...EMBARKABLE_STATUSES]).toEqual(["COLLECTED"]);
    for (const status of COLLECTION_STATUSES) {
      expect(canEmbark({ status, manifestId: null }), status).toBe(status === "COLLECTED");
      expect(canEmbark({ status, manifestId: "m1" }), `${status} em manifesto`).toBe(false);
    }
    expect(canEmbark({ status: "INVENTADO", manifestId: null })).toBe(false);
  });

  it("os quatro status do manifesto têm rótulo em português", () => {
    expect([...MANIFEST_STATUSES]).toEqual(["ASSEMBLING", "ROUTE", "FINISHED", "CANCELLED"]);
    expect(Object.keys(MANIFEST_STATUS).sort()).toEqual([...MANIFEST_STATUSES].sort());
    expect(statusBadge(MANIFEST_STATUS, "ASSEMBLING").label).toBe("Em montagem");
    expect(statusBadge(MANIFEST_STATUS, "ROUTE").label).toBe("Em rota");
    expect(statusBadge(MANIFEST_STATUS, "FINISHED").label).toBe("Finalizada");
    expect(statusBadge(MANIFEST_STATUS, "CANCELLED").label).toBe("Cancelada");
  });

  it("só a viagem em montagem pode ser alterada", () => {
    for (const status of MANIFEST_STATUSES) {
      expect(isManifestEditable({ status }), status).toBe(status === "ASSEMBLING");
    }
    expect(isManifestEditable({ status: "INVENTADO" })).toBe(false);
  });

  it("o cartão conta cargas reservadas ou entregas, e o da cancelada não mostra quantidade", () => {
    expect(manifestLoadsLabel("ASSEMBLING", 0)).toBe("0 cargas reservadas");
    expect(manifestLoadsLabel("ASSEMBLING", 1)).toBe("1 carga reservada");
    expect(manifestLoadsLabel("ASSEMBLING", 2)).toBe("2 cargas reservadas");
    expect(manifestLoadsLabel("ROUTE", 1)).toBe("1 Entrega na Rota");
    expect(manifestLoadsLabel("ROUTE", 3)).toBe("3 Entregas na Rota");
    expect(manifestLoadsLabel("FINISHED", 2)).toBe("2 Entregas na Rota");
    expect(manifestLoadsLabel("CANCELLED", 0)).toBe("Cargas liberadas");
    expect(manifestLoadsLabel("CANCELLED", 0)).not.toMatch(/\d|Rota/);
  });

  it("a alteração aceita motorista, veículo ou carga, e descarta o status", () => {
    expect(updateManifestSchema.safeParse({ driverId: "d2" }).data).toEqual({ driverId: "d2" });
    expect(updateManifestSchema.safeParse({ addCollectionIds: ["c1"] }).data).toEqual({ addCollectionIds: ["c1"] });
    expect(updateManifestSchema.safeParse({ vehicleId: "v2", status: "ROUTE" }).data).toEqual({ vehicleId: "v2" });

    for (const corpo of [null, {}, { addCollectionIds: [] }, { status: "ROUTE" }, { addCollectionIds: ["c1", "c1"] }, { driverId: " " }]) {
      const lido = updateManifestSchema.safeParse(corpo);
      expect(lido.success, JSON.stringify(corpo)).toBe(false);
      expect(lido.error?.issues[0]?.message).toBeTruthy();
    }
  });

  const valido = { driverId: "d1", vehicleId: "v1", collectionIds: ["c1", "c2"] };

  it("o schema aceita o corpo completo", () => {
    expect(createManifestSchema.safeParse(valido).data).toEqual(valido);
    const cheio = Array.from({ length: MAX_MANIFEST_COLLECTIONS }, (_, i) => `c${i}`);
    expect(createManifestSchema.safeParse({ ...valido, collectionIds: cheio }).success).toBe(true);
  });

  it.each([
    ["não é objeto", null],
    ["sem motorista", { ...valido, driverId: undefined }],
    ["motorista em branco", { ...valido, driverId: "   " }],
    ["motorista que não é texto", { ...valido, driverId: 7 }],
    ["motorista longo demais", { ...valido, driverId: "x".repeat(65) }],
    ["sem veículo", { ...valido, vehicleId: undefined }],
    ["veículo em branco", { ...valido, vehicleId: "" }],
    ["sem lista de cargas", { ...valido, collectionIds: undefined }],
    ["lista que não é lista", { ...valido, collectionIds: "c1" }],
    ["lista vazia", { ...valido, collectionIds: [] }],
    ["carga repetida", { ...valido, collectionIds: ["c1", "c2", "c1"] }],
    ["item que não é texto", { ...valido, collectionIds: ["c1", 2] }],
    ["item nulo", { ...valido, collectionIds: [null] }],
    ["item em branco", { ...valido, collectionIds: ["c1", " "] }],
    ["mais cargas que o teto", { ...valido, collectionIds: Array.from({ length: 201 }, (_, i) => `c${i}`) }],
  ])("o schema recusa: %s", (_caso, corpo) => {
    const lido = createManifestSchema.safeParse(corpo);
    expect(lido.success).toBe(false);
    expect(lido.error?.issues[0]?.message).toBeTruthy();
  });
});

describe("carga da tela de manifestos", () => {
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

  // Responde cada endereço com o status pedido; 200 para os demais.
  const responder = (falhas: Record<string, number> = {}) => async (url: string) =>
    falhas[url] ? new Response("{}", { status: falhas[url] }) : ok([{ de: url }]);

  it("tudo 200 → ready, cada lista vinda da sua chamada", async () => {
    const chamadas: string[] = [];
    const estado = await loadManifestos(async (url) => {
      chamadas.push(url);
      return ok([{ de: url }]);
    });
    expect(chamadas.sort()).toEqual([...MANIFESTOS_ENDPOINTS].sort());
    expect(estado).toEqual({
      status: "ready",
      manifestos: [{ de: "/api/manifestos" }],
      coletas: [{ de: "/api/coletas" }],
      motoristas: [{ de: "/api/motoristas" }],
      veiculos: [{ de: "/api/veiculos" }],
    });
  });

  it.each([...MANIFESTOS_ENDPOINTS])("401 em %s → expired", async (url) => {
    expect(await loadManifestos(responder({ [url]: 401 }))).toEqual({ status: "expired", cause: `${url}: HTTP 401` });
  });

  it.each([...MANIFESTOS_ENDPOINTS])("500 em %s → error, nunca lista vazia", async (url) => {
    expect(await loadManifestos(responder({ [url]: 500 }))).toEqual({ status: "error", cause: `${url}: HTTP 500` });
  });

  it("401 ganha de outro erro na mesma carga", async () => {
    const estado = await loadManifestos(responder({ "/api/manifestos": 500, "/api/veiculos": 401 }));
    expect(estado.status).toBe("expired");
  });

  it("403 e rede fora são erro, não sessão expirada", async () => {
    expect((await loadManifestos(responder({ "/api/coletas": 403 }))).status).toBe("error");

    const redeFora = new TypeError("fetch failed");
    expect(await loadManifestos(async () => { throw redeFora; })).toEqual({ status: "error", cause: redeFora });
  });

  it("resposta 200 que não é JSON → error", async () => {
    const estado = await loadManifestos(async () => new Response("<html>", { status: 200 }));
    expect(estado.status).toBe("error");
  });
});

// Tudo o que esta suite cria usa estes marcadores, e só isso é apagado.
const PREFIXO = "teste-manifestos-";
const CNPJ_TESTE = "99888777000751";
const CPF_TESTE = "99988877688";
const CPF_INATIVO = "99988877699";
const PLACA_TESTE = "TMF0A01";
const PLACA_MANUTENCAO = "TMF0A02";
// Toda placa da suite começa assim, inclusive as das duplas criadas por viagem.
const PLACA_PREFIXO = "TMF";
const HASH_FALSO = "$2b$10$hashfalsoparateste000000000000000000000000000000000";
const SEM_ID = "00000000-0000-0000-0000-000000000000";

suite("manifestos pelo painel", () => {
  let prisma: typeof import("../src/lib/prisma").default;
  let manifestos: typeof import("../src/app/api/manifestos/route");
  let manifesto: typeof import("../src/app/api/manifestos/[id]/route");
  let liberar: typeof import("../src/app/api/manifestos/[id]/liberar/route");
  let cancelar: typeof import("../src/app/api/manifestos/[id]/cancelar/route");
  let finalizar: typeof import("../src/app/api/manifestos/[id]/finalizar/route");
  let carga: typeof import("../src/app/api/manifestos/[id]/coletas/[coletaId]/route");
  let statusRota: typeof import("../src/app/api/dashboard/coletas/[id]/status/route");
  let viagensDoMotorista: typeof import("../src/app/api/driver/manifestos/route");

  let operadorId: string;
  let clienteId: string;
  let motoristaId: string;
  let motoristaUserId: string;
  let motoristaInativoId: string;
  let veiculoId: string;
  let veiculoManutencaoId: string;

  const sessao = vi.mocked(getServerSession);

  const comoOperador = () =>
    sessao.mockResolvedValue({ user: { id: operadorId, role: "OPERATION", clientId: null } });
  const comoMotorista = () =>
    sessao.mockResolvedValue({ user: { id: motoristaUserId, role: "DRIVER", clientId: null } });

  const req = (method = "GET", body?: unknown) =>
    new Request("http://localhost/api/teste", {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const ctxCarga = (id: string, coletaId: string) => ({ params: Promise.resolve({ id, coletaId }) });

  const email = (nome: string) => `${PREFIXO}${nome}@exemplo.br`;

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
  const lerManifesto = (id: string) => prisma.manifest.findUniqueOrThrow({ where: { id } });

  // Manifestos da suite: os que usam os veículos de teste.
  const contarManifestos = () => prisma.manifest.count({ where: { vehicle: { plate: { startsWith: PLACA_PREFIXO } } } });

  const criar = (collectionIds: unknown, extra: Record<string, unknown> = {}) =>
    manifestos.POST(req("POST", { driverId: motoristaId, vehicleId: veiculoId, collectionIds, ...extra }));

  // Motorista e veículo só desta viagem: um veículo ou motorista em rota não
  // sai em outra, então cada viagem liberada precisa da sua dupla.
  let serie = 0;
  async function novaDupla() {
    serie += 1;
    const n = String(serie).padStart(3, "0");
    const motorista = await criarMotorista(`dupla-${n}`, `99977766${n}`, true);
    const veiculo = await prisma.vehicle.create({
      data: { plate: `${PLACA_PREFIXO}9${n}`, model: "Teste", type: "VAN" },
    });
    return { driverId: motorista.id, vehicleId: veiculo.id };
  }

  // Viagem em montagem, com as cargas reservadas, pela rota de verdade.
  async function montagem(quantas = 1, dupla?: { driverId: string; vehicleId: string }) {
    const cargas = await Promise.all(Array.from({ length: quantas }, () => montar()));
    const comQuem = dupla ?? (await novaDupla());
    const res = await criar(cargas.map((c) => c.id), comQuem);
    expect(res.status).toBe(201);
    return { id: (await res.json()).id as string, cargas, ...comQuem };
  }

  // Viagem em rota: montada e com a saída liberada.
  async function viagem(quantas = 1, dupla?: { driverId: string; vehicleId: string }) {
    const montada = await montagem(quantas, dupla);
    expect((await sair(montada.id)).status).toBe(200);
    return montada;
  }


  const padrao = () => ({ driverId: motoristaId, vehicleId: veiculoId });

  // Resolve quando `quantas` conexões deste banco estão paradas esperando trava
  // de linha: é o sinal de que a rota chegou à trava, sem depender de tempo fixo.
  // Nunca resolve se ninguém parar: quem chama põe o limite e, quando a espera
  // perde a corrida, avisa por `parar` para o laço não seguir consultando.
  async function esperandoTrava(quantas = 1, parar?: AbortSignal): Promise<void> {
    while (!parar?.aborted) {
      const [{ parados }] = await prisma.$queryRaw<{ parados: number }[]>`
        SELECT count(*)::int AS parados FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`;
      if (parados >= quantas) return;
      await new Promise((pronto) => setTimeout(pronto, 20));
    }
  }

  // Corrida entre a ação responder e `quantas` conexões pararem em trava. Quem
  // perde é desligado: a espera pela trava não sobra rodando depois do teste.
  async function quemChegaPrimeiro(resposta: Promise<Response>, quantas = 1): Promise<"parada" | "respondeu"> {
    const parar = new AbortController();
    try {
      return await Promise.race([
        esperandoTrava(quantas, parar.signal).then(() => "parada" as const),
        resposta.then(() => "respondeu" as const),
      ]);
    } finally {
      parar.abort();
    }
  }

  /**
   * Deixa aberta, numa transação à parte, a troca que tira o veículo ou o
   * motorista de circulação, dispara `acao` e só grava a troca depois que a
   * ação estiver parada na trava. Se a ação responder sem ter esperado, ela
   * não passou pela trava e o teste falha. No fim devolve a dupla ao estado inicial.
   */
  async function comTrocaAberta(
    qual: "veiculo" | "motorista",
    dupla: { driverId: string; vehicleId: string },
    acao: () => Promise<Response>,
  ): Promise<Response> {
    let resposta: Promise<Response> | undefined;
    try {
      await prisma.$transaction(async (tx) => {
        if (qual === "veiculo") {
          await tx.vehicle.update({ where: { id: dupla.vehicleId }, data: { status: "MAINTENANCE" } });
        } else {
          await tx.driver.update({ where: { id: dupla.driverId }, data: { active: false } });
        }

        resposta = acao();
        const primeiro = await quemChegaPrimeiro(resposta);
        expect(primeiro, "a ação respondeu sem esperar a troca aberta").toBe("parada");
      });
      return await resposta!;
    } finally {
      await resposta?.catch(() => undefined);
      await prisma.vehicle.update({ where: { id: dupla.vehicleId }, data: { status: "AVAILABLE" } });
      await prisma.driver.update({ where: { id: dupla.driverId }, data: { active: true } });
    }
  }

  const sair = (manifestId: string) => liberar.POST(req("POST"), ctx(manifestId));
  const desistir = (manifestId: string) => cancelar.POST(req("POST"), ctx(manifestId));
  const alterar = (manifestId: string, body: unknown) => manifesto.PATCH(req("PATCH", body), ctx(manifestId));
  const lerVeiculo = (id: string) => prisma.vehicle.findUniqueOrThrow({ where: { id } });

  const retirar = (manifestId: string, coletaId: string) =>
    carga.DELETE(req("DELETE"), ctxCarga(manifestId, coletaId));
  const encerrar = (manifestId: string) => finalizar.POST(req("POST"), ctx(manifestId));
  const mudar = (id: string, body: unknown) => statusRota.POST(req("POST", body), ctx(id));

  // Na ordem das dependências: coletas → manifesto → veículo → motorista → usuário → cliente.
  async function limpar() {
    const cpfs = [CPF_TESTE, CPF_INATIVO];
    const daSuite = { email: { startsWith: PREFIXO, mode: "insensitive" as const } };
    await prisma.collection.deleteMany({ where: { client: { cnpj: CNPJ_TESTE } } });
    await prisma.manifest.deleteMany({ where: { vehicle: { plate: { startsWith: PLACA_PREFIXO } } } });
    await prisma.vehicle.deleteMany({ where: { plate: { startsWith: PLACA_PREFIXO } } });
    await prisma.driver.deleteMany({ where: { OR: [{ cpf: { in: cpfs } }, { user: daSuite }] } });
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

  beforeAll(async () => {
    prisma = (await import("../src/lib/prisma")).default;
    manifestos = await import("../src/app/api/manifestos/route");
    manifesto = await import("../src/app/api/manifestos/[id]/route");
    liberar = await import("../src/app/api/manifestos/[id]/liberar/route");
    cancelar = await import("../src/app/api/manifestos/[id]/cancelar/route");
    finalizar = await import("../src/app/api/manifestos/[id]/finalizar/route");
    carga = await import("../src/app/api/manifestos/[id]/coletas/[coletaId]/route");
    statusRota = await import("../src/app/api/dashboard/coletas/[id]/status/route");
    viagensDoMotorista = await import("../src/app/api/driver/manifestos/route");

    await limpar();

    const operador = await prisma.user.create({
      data: { name: "operacao", email: email("operacao"), password: HASH_FALSO, role: "OPERATION" },
    });
    operadorId = operador.id;

    clienteId = (
      await prisma.client.create({
        data: { companyName: "Empresa Teste Manifestos LTDA", tradeName: "Teste Manifestos", cnpj: CNPJ_TESTE },
      })
    ).id;

    const ativo = await criarMotorista("ativo", CPF_TESTE, true);
    motoristaId = ativo.id;
    motoristaUserId = ativo.userId;
    motoristaInativoId = (await criarMotorista("inativo", CPF_INATIVO, false)).id;

    veiculoId = (await prisma.vehicle.create({ data: { plate: PLACA_TESTE, model: "Teste", type: "VAN" } })).id;
    veiculoManutencaoId = (
      await prisma.vehicle.create({
        data: { plate: PLACA_MANUTENCAO, model: "Teste", type: "VAN", status: "MAINTENANCE" },
      })
    ).id;
  });

  beforeEach(() => {
    sessao.mockReset();
    comoOperador();
  });

  afterAll(async () => {
    if (prisma) await limpar();
  });

  describe("montar viagem", () => {
    it("válida → 201, manifesto nasce em montagem e as cargas ficam reservadas, ainda coletadas", async () => {
      const [a, b] = await Promise.all([montar(), montar()]);
      const antes = await contarManifestos();

      const res = await criar([a.id, b.id]);
      expect(res.status).toBe(201);
      const criado = await res.json();
      expect(criado).toMatchObject({ status: "ASSEMBLING", driverId: motoristaId, vehicleId: veiculoId });

      expect(await contarManifestos()).toBe(antes + 1);
      for (const alvo of [a, b]) {
        expect(await ler(alvo.id)).toMatchObject({ status: "COLLECTED", manifestId: criado.id });
      }
      // Montar não ocupa o veículo: quem ocupa é a saída.
      expect((await lerVeiculo(veiculoId)).status).toBe("AVAILABLE");
    });

    it("veículo ON_ROUTE não bloqueia", async () => {
      await prisma.vehicle.update({ where: { id: veiculoId }, data: { status: "ON_ROUTE" } });
      try {
        const alvo = await montar();
        expect((await criar([alvo.id])).status).toBe(201);
      } finally {
        await prisma.vehicle.update({ where: { id: veiculoId }, data: { status: "AVAILABLE" } });
      }
    });

    it("corpo inválido → 400 com a mensagem do schema, sem gravar", async () => {
      const alvo = await montar();
      const antes = await contarManifestos();

      const naoJson = await manifestos.POST(
        new Request("http://localhost/api/teste", { method: "POST", body: "{isto não é json" }),
      );
      expect(naoJson.status).toBe(400);

      const casos: [string, Promise<Response>, RegExp][] = [
        ["sem motorista", criar([alvo.id], { driverId: undefined }), /motorista/i],
        ["sem veículo", criar([alvo.id], { vehicleId: "" }), /veículo/i],
        ["sem cargas", criar(undefined), /carga/i],
        ["lista vazia", criar([]), /pelo menos uma carga/i],
        ["repetida", criar([alvo.id, alvo.id]), /mais de uma vez/i],
        ["item não texto", criar([alvo.id, 7]), /carga inválida/i],
        ["lista que é texto", criar(alvo.id), /carga/i],
      ];
      for (const [nome, chamada, mensagem] of casos) {
        const res = await chamada;
        expect(res.status, nome).toBe(400);
        expect((await res.json()).error, nome).toMatch(mensagem);
      }

      expect(await contarManifestos()).toBe(antes);
      expect(await ler(alvo.id)).toMatchObject({ status: "COLLECTED", manifestId: null });
    });

    it("motorista inexistente ou inativo → 400; veículo inexistente → 400; em manutenção → 409; nunca 500", async () => {
      const alvo = await montar();
      const antes = await contarManifestos();

      for (const driverId of [SEM_ID, "nao-e-uuid", motoristaInativoId]) {
        const res = await criar([alvo.id], { driverId });
        expect(res.status, driverId).toBe(400);
        expect((await res.json()).error).toBe("Motorista não encontrado ou inativo.");
      }

      for (const vehicleId of [SEM_ID, "nao-e-uuid"]) {
        const res = await criar([alvo.id], { vehicleId });
        expect(res.status, vehicleId).toBe(400);
        expect((await res.json()).error).toMatch(/veículo não encontrado/i);
      }

      const manutencao = await criar([alvo.id], { vehicleId: veiculoManutencaoId });
      expect(manutencao.status).toBe(409);
      expect((await manutencao.json()).error).toMatch(/manutenção/);

      expect(await contarManifestos()).toBe(antes);
      expect(await ler(alvo.id)).toMatchObject({ status: "COLLECTED", manifestId: null });
    });

    // A troca fica aberta numa transação à parte enquanto a montagem corre: a
    // primeira conferência ainda lê o valor antigo, e só a conferência de dentro
    // da transação da montagem, que espera a troca gravar, pode recusar.
    it.each([
      ["veículo posto em manutenção", 409, /manutenção/],
      ["motorista desativado", 400, /Motorista não encontrado ou inativo/],
    ] as const)("%s durante a montagem → recusa sem gravar", async (caso, status, mensagem) => {
      const alvo = await montar();
      const antes = await contarManifestos();

      const res = await comTrocaAberta(caso.startsWith("veículo") ? "veiculo" : "motorista", padrao(), () =>
        criar([alvo.id]),
      );
      expect(res.status).toBe(status);
      expect((await res.json()).error).toMatch(mensagem);
      expect(await contarManifestos()).toBe(antes);
      expect(await ler(alvo.id)).toMatchObject({ status: "COLLECTED", manifestId: null });
    });

    it("motorista e veículo que continuam servindo não travam duas montagens simultâneas", async () => {
      const [a, b] = await Promise.all([montar(), montar()]);
      const respostas = await Promise.all([criar([a.id]), criar([b.id])]);
      expect(respostas.map((res) => res.status)).toEqual([201, 201]);
    });

    // Outra transação segura a dupla em modo compartilhado, como faz uma
    // montagem que ainda não terminou. Se a rota pedisse a trava exclusiva
    // (FOR UPDATE), ficaria parada até essa transação fechar.
    it("a montagem não espera outra que segura a mesma dupla", async () => {
      const alvo = await montar();
      let resposta: Promise<Response> | undefined;

      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id = ${veiculoId} FOR SHARE`;
        await tx.$queryRaw`SELECT id FROM "Driver" WHERE id = ${motoristaId} FOR SHARE`;

        resposta = criar([alvo.id]);
        const primeiro = await quemChegaPrimeiro(resposta);
        expect(primeiro, "a montagem ficou esperando a trava compartilhada de outra transação").toBe("respondeu");
        expect((await resposta).status).toBe(201);
      }).finally(() => resposta?.catch(() => undefined));

      expect((await ler(alvo.id)).manifestId).not.toBeNull();
    });

    it.each(["PENDING", "CONFIRMED", "ROUTE", "DELIVERED", "CANCELLED", "REJECTED"])(
      "carga %s não embarca → 409, sem gravar",
      async (status) => {
        const alvo = await montar({ status });
        const antes = await contarManifestos();

        const res = await criar([alvo.id]);
        expect(res.status).toBe(409);
        expect((await res.json()).error).toMatch(/^1 das cargas selecionadas não pode embarcar/);

        expect(await contarManifestos()).toBe(antes);
        expect(await ler(alvo.id)).toMatchObject({ status, manifestId: null });
      },
    );

    it("caso misto (uma apta, uma entregue, uma que não existe) → 409 com a quantidade, e a apta não é gravada", async () => {
      const apta = await montar();
      const entregue = await montar({ status: "DELIVERED" });
      const antes = await contarManifestos();

      const res = await criar([apta.id, entregue.id, SEM_ID]);
      expect(res.status).toBe(409);
      expect((await res.json()).error).toMatch(/^2 das cargas selecionadas não podem embarcar/);

      expect(await contarManifestos()).toBe(antes);
      expect(await ler(apta.id)).toMatchObject({ status: "COLLECTED", manifestId: null });
      expect(await ler(entregue.id)).toMatchObject({ status: "DELIVERED", manifestId: null });
    });

    it("carga que já está em outro manifesto → 409 e continua no original", async () => {
      const original = await viagem();
      const [embarcada] = original.cargas;
      const livre = await montar();
      // Dado legado: coletada, mas presa a um manifesto.
      const presa = await montar({ status: "COLLECTED", manifestId: original.id });
      const antes = await contarManifestos();

      for (const ids of [[embarcada.id, livre.id], [presa.id]]) {
        const res = await criar(ids);
        expect(res.status).toBe(409);
        expect((await res.json()).error).toMatch(/não pode embarcar/);
      }

      expect(await contarManifestos()).toBe(antes);
      expect(await ler(embarcada.id)).toMatchObject({ status: "ROUTE", manifestId: original.id });
      expect(await ler(presa.id)).toMatchObject({ status: "COLLECTED", manifestId: original.id });
      expect(await ler(livre.id)).toMatchObject({ status: "COLLECTED", manifestId: null });
    });

    it("duas montagens simultâneas com a mesma carga: só uma grava", async () => {
      const disputada = await montar();
      const [soDaA, soDaB] = await Promise.all([montar(), montar()]);
      const antes = await contarManifestos();

      const respostas = await Promise.all([criar([disputada.id, soDaA.id]), criar([disputada.id, soDaB.id])]);
      expect(respostas.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await contarManifestos()).toBe(antes + 1);

      const vencedora = respostas.findIndex((r) => r.status === 201);
      const manifestId = (await respostas[vencedora].json()).id;
      expect((await respostas[1 - vencedora].json()).error).toMatch(/não pode embarcar/);

      expect(await ler(disputada.id)).toMatchObject({ status: "COLLECTED", manifestId });
      // A carga que só a perdedora levava fica como estava: a transação foi desfeita inteira.
      const [daVencedora, daPerdedora] = vencedora === 0 ? [soDaA, soDaB] : [soDaB, soDaA];
      expect(await ler(daVencedora.id)).toMatchObject({ status: "COLLECTED", manifestId });
      expect(await ler(daPerdedora.id)).toMatchObject({ status: "COLLECTED", manifestId: null });
    });
  });

  describe("listagem", () => {
    it("cada carga traz só o nome do cliente, e nenhuma senha sai na resposta", async () => {
      const { id } = await viagem(2);

      const res = await manifestos.GET();
      expect(res.status).toBe(200);
      const lista = await res.json();
      const achado = lista.find((m: { id: string }) => m.id === id);

      expect(achado.collections).toHaveLength(2);
      for (const item of achado.collections) {
        expect(item.client).toEqual({ tradeName: "Teste Manifestos", companyName: "Empresa Teste Manifestos LTDA" });
        expect(item.status).toBe("ROUTE");
      }
      expect(achado.driver.user.name).toMatch(/^Motorista dupla-/);
      expect(temChaveDeSenha(lista)).toBe(false);
    });
  });

  describe("retirar carga", () => {
    it("manifesto inexistente ou carga de outro manifesto → 404, sem gravar", async () => {
      const a = await viagem();
      const b = await viagem();
      const solta = await montar();

      expect((await retirar(SEM_ID, a.cargas[0].id)).status).toBe(404);
      expect((await retirar("nao-e-uuid", a.cargas[0].id)).status).toBe(404);
      expect((await retirar(a.id, SEM_ID)).status).toBe(404);
      expect((await retirar(a.id, solta.id)).status).toBe(404);
      expect((await retirar(a.id, b.cargas[0].id)).status).toBe(404);

      expect(await ler(a.cargas[0].id)).toMatchObject({ status: "ROUTE", manifestId: a.id });
      expect(await ler(b.cargas[0].id)).toMatchObject({ status: "ROUTE", manifestId: b.id });
      expect(await ler(solta.id)).toMatchObject({ status: "COLLECTED", manifestId: null });
    });

    it("em rota → 200, volta para COLLECTED sem manifesto; repetir → 404", async () => {
      const { id, cargas } = await viagem(2);

      const res = await retirar(id, cargas[0].id);
      expect(res.status).toBe(200);
      expect((await res.json()).collection).toMatchObject({ id: cargas[0].id, status: "COLLECTED", manifestId: null });

      expect(await ler(cargas[0].id)).toMatchObject({ status: "COLLECTED", manifestId: null });
      expect(await ler(cargas[1].id)).toMatchObject({ status: "ROUTE", manifestId: id });
      expect((await retirar(id, cargas[0].id)).status).toBe(404);
    });

    it("carga já entregue → 409 e continua entregue no manifesto", async () => {
      const { id, cargas } = await viagem();
      expect((await mudar(cargas[0].id, { status: "DELIVERED", receiverName: "Fulano" })).status).toBe(200);

      const res = await retirar(id, cargas[0].id);
      expect(res.status).toBe(409);
      expect((await res.json()).error).toMatch(/já foi entregue/);
      expect(await ler(cargas[0].id)).toMatchObject({ status: "DELIVERED", manifestId: id });
    });

    it("carga do manifesto que não está em rota (dado legado) → 409", async () => {
      const { id } = await viagem();
      const presa = await montar({ status: "COLLECTED", manifestId: id });

      const res = await retirar(id, presa.id);
      expect(res.status).toBe(409);
      expect((await res.json()).error).toMatch(/Só carga em rota/);
      expect(await ler(presa.id)).toMatchObject({ status: "COLLECTED", manifestId: id });
    });

    it("manifesto finalizado → 409", async () => {
      const { id, cargas } = await viagem();
      // Estado montado à mão: finalizado com carga ainda em rota.
      await prisma.manifest.update({ where: { id }, data: { status: "FINISHED" } });

      const res = await retirar(id, cargas[0].id);
      expect(res.status).toBe(409);
      expect((await res.json()).error).toMatch(/finalizada/);
      expect(await ler(cargas[0].id)).toMatchObject({ status: "ROUTE", manifestId: id });
    });

    it("baixa e retirada ao mesmo tempo: uma só vale", async () => {
      const { id, cargas } = await viagem();
      const alvo = cargas[0].id;

      const [baixa, retirada] = await Promise.all([
        mudar(alvo, { status: "DELIVERED", receiverName: "Fulano" }),
        retirar(id, alvo),
      ]);
      expect([baixa.status, retirada.status].sort()).toEqual([200, 409]);

      const final = await ler(alvo);
      if (retirada.status === 200) {
        expect(final).toMatchObject({ status: "COLLECTED", manifestId: null });
      } else {
        expect(final).toMatchObject({ status: "DELIVERED", manifestId: id });
      }
    });

    it("depois de retirada, a carga pode ser cancelada pela rota de status", async () => {
      const { id, cargas } = await viagem();
      const alvo = cargas[0].id;

      // Presa no manifesto, o cancelamento é recusado.
      expect((await mudar(alvo, { status: "CANCELLED" })).status).toBe(409);

      expect((await retirar(id, alvo)).status).toBe(200);
      expect((await mudar(alvo, { status: "CANCELLED" })).status).toBe(200);
      expect(await ler(alvo)).toMatchObject({ status: "CANCELLED", manifestId: null });
    });

    it("depois de retirada, a carga pode entrar em outro manifesto", async () => {
      const { id, cargas } = await viagem();
      const alvo = cargas[0].id;
      expect((await retirar(id, alvo)).status).toBe(200);

      const res = await criar([alvo]);
      expect(res.status).toBe(201);
      const novo = (await res.json()).id;
      expect(novo).not.toBe(id);
      expect(await ler(alvo)).toMatchObject({ status: "COLLECTED", manifestId: novo });
    });
  });

  describe("viagem em montagem", () => {
    it("retirar carga em montagem → 200, a carga volta a ficar livre e pode ser cancelada", async () => {
      const { id, cargas } = await montagem(2);

      // Reservada no manifesto, o cancelamento da coleta é recusado.
      expect((await mudar(cargas[0].id, { status: "CANCELLED" })).status).toBe(409);

      expect((await retirar(id, cargas[0].id)).status).toBe(200);
      expect(await ler(cargas[0].id)).toMatchObject({ status: "COLLECTED", manifestId: null });
      expect(await ler(cargas[1].id)).toMatchObject({ status: "COLLECTED", manifestId: id });
      expect((await mudar(cargas[0].id, { status: "CANCELLED" })).status).toBe(200);
    });

    it("alterar troca motorista e veículo e acrescenta carga", async () => {
      const { id, cargas } = await montagem(1);
      const outra = await novaDupla();
      const nova = await montar();

      const res = await alterar(id, { ...outra, addCollectionIds: [nova.id] });
      expect(res.status).toBe(200);
      expect((await res.json()).manifest).toMatchObject({ id, status: "ASSEMBLING", ...outra });

      expect(await lerManifesto(id)).toMatchObject(outra);
      expect(await ler(nova.id)).toMatchObject({ status: "COLLECTED", manifestId: id });
      expect(await ler(cargas[0].id)).toMatchObject({ status: "COLLECTED", manifestId: id });
    });

    it("alteração inválida não grava nada, nem a parte que estava certa", async () => {
      const { id, driverId, vehicleId } = await montagem(1);
      const outraViagem = await montagem(1);
      const livre = await montar();
      const pendente = await montar({ status: "PENDING" });

      const casos: [string, unknown, number][] = [
        ["corpo vazio", {}, 400],
        ["só status", { status: "ROUTE" }, 400],
        ["motorista inativo", { driverId: motoristaInativoId, addCollectionIds: [livre.id] }, 400],
        ["veículo que não existe", { vehicleId: SEM_ID, addCollectionIds: [livre.id] }, 400],
        ["veículo em manutenção", { vehicleId: veiculoManutencaoId, addCollectionIds: [livre.id] }, 409],
        ["carga pendente", { addCollectionIds: [livre.id, pendente.id] }, 409],
        ["carga de outra viagem", { addCollectionIds: [livre.id, outraViagem.cargas[0].id] }, 409],
        ["carga que não existe", { addCollectionIds: [livre.id, SEM_ID] }, 409],
      ];
      for (const [nome, body, esperado] of casos) {
        const res = await alterar(id, body);
        expect(res.status, nome).toBe(esperado);
        expect((await res.json()).error, nome).toBeTruthy();
      }

      expect(await lerManifesto(id)).toMatchObject({ driverId, vehicleId, status: "ASSEMBLING" });
      expect(await ler(livre.id)).toMatchObject({ status: "COLLECTED", manifestId: null });
      expect(await ler(outraViagem.cargas[0].id)).toMatchObject({ manifestId: outraViagem.id });
    });

    it.each([
      ["veículo posto em manutenção", 409, /manutenção/],
      ["motorista desativado", 400, /Motorista não encontrado ou inativo/],
    ] as const)("%s durante a alteração → recusa sem gravar", async (caso, status, mensagem) => {
      const { id, driverId, vehicleId } = await montagem(1);
      const nova = await novaDupla();
      const livre = await montar();

      const res = await comTrocaAberta(caso.startsWith("veículo") ? "veiculo" : "motorista", nova, () =>
        alterar(id, { ...nova, addCollectionIds: [livre.id] }),
      );
      expect(res.status).toBe(status);
      expect((await res.json()).error).toMatch(mensagem);
      expect(await lerManifesto(id)).toMatchObject({ driverId, vehicleId, status: "ASSEMBLING" });
      expect(await ler(livre.id)).toMatchObject({ status: "COLLECTED", manifestId: null });
    });

    it("alterar manifesto inexistente → 404; em rota, finalizado ou cancelado → 409", async () => {
      expect((await alterar(SEM_ID, { driverId: motoristaId })).status).toBe(404);

      const emRota = await viagem();
      const cancelada = await montagem();
      expect((await desistir(cancelada.id)).status).toBe(200);
      const livre = await montar();

      for (const alvo of [emRota, cancelada]) {
        const res = await alterar(alvo.id, { addCollectionIds: [livre.id] });
        expect(res.status).toBe(409);
        expect((await res.json()).error).toMatch(/em montagem/);
      }
      expect(await ler(livre.id)).toMatchObject({ status: "COLLECTED", manifestId: null });
    });

    it("cancelar solta as cargas, que continuam coletadas; repetir → 409", async () => {
      const { id, cargas, vehicleId } = await montagem(2);

      const res = await desistir(id);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ released: 2, manifest: { id, status: "CANCELLED" } });

      for (const alvo of cargas) {
        expect(await ler(alvo.id)).toMatchObject({ status: "COLLECTED", manifestId: null });
      }
      expect((await lerVeiculo(vehicleId)).status).toBe("AVAILABLE");

      const repetida = await desistir(id);
      expect(repetida.status).toBe(409);
      expect((await repetida.json()).error).toMatch(/Cancelada/);
      // Cancelada não sai, não é finalizada e não perde carga.
      expect((await sair(id)).status).toBe(409);
      expect((await encerrar(id)).status).toBe(409);
      expect((await desistir(SEM_ID)).status).toBe(404);
    });

    it("viagem em rota não é cancelada → 409, e as cargas seguem em rota", async () => {
      const { id, cargas } = await viagem();

      const res = await desistir(id);
      expect(res.status).toBe(409);
      expect((await res.json()).error).toMatch(/Em rota/);
      expect(await ler(cargas[0].id)).toMatchObject({ status: "ROUTE", manifestId: id });
    });
  });

  describe("liberar saída", () => {
    it("põe as cargas em rota e ocupa o veículo; repetir → 409", async () => {
      const { id, cargas, vehicleId } = await montagem(2);

      const res = await sair(id);
      expect(res.status).toBe(200);
      expect((await res.json()).manifest).toMatchObject({ id, status: "ROUTE" });

      for (const alvo of cargas) {
        expect(await ler(alvo.id)).toMatchObject({ status: "ROUTE", manifestId: id });
      }
      expect((await lerVeiculo(vehicleId)).status).toBe("ON_ROUTE");

      const repetida = await sair(id);
      expect(repetida.status).toBe(409);
      expect((await repetida.json()).error).toMatch(/Em rota/);
      expect((await sair(SEM_ID)).status).toBe(404);
    });

    it("veículo ou motorista já em rota em outra viagem → 409 com o motivo", async () => {
      const primeira = await viagem();

      const mesmoVeiculo = await montagem(1, { ...(await novaDupla()), vehicleId: primeira.vehicleId });
      const resVeiculo = await sair(mesmoVeiculo.id);
      expect(resVeiculo.status).toBe(409);
      expect((await resVeiculo.json()).error).toMatch(/veículo já está em rota/);

      const mesmoMotorista = await montagem(1, { ...(await novaDupla()), driverId: primeira.driverId });
      const resMotorista = await sair(mesmoMotorista.id);
      expect(resMotorista.status).toBe(409);
      expect((await resMotorista.json()).error).toMatch(/motorista já está em rota/);

      for (const parada of [mesmoVeiculo, mesmoMotorista]) {
        expect((await lerManifesto(parada.id)).status).toBe("ASSEMBLING");
        expect(await ler(parada.cargas[0].id)).toMatchObject({ status: "COLLECTED", manifestId: parada.id });
      }
      expect((await lerVeiculo(mesmoMotorista.vehicleId)).status).toBe("AVAILABLE");
    });

    it("duas viagens disputando o mesmo veículo ao mesmo tempo: só uma sai", async () => {
      const uma = await montagem(1);
      const outra = await montagem(1, { ...(await novaDupla()), vehicleId: uma.vehicleId });

      const respostas = await Promise.all([sair(uma.id), sair(outra.id)]);
      expect(respostas.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await prisma.manifest.count({ where: { vehicleId: uma.vehicleId, status: "ROUTE" } })).toBe(1);
    });

    // A liberação fica parada no meio (outra transação segura o veículo dela),
    // já com a viagem lida. A alteração da mesma viagem tem de esperar a trava
    // do manifesto: se passasse, trocaria o veículo depois de conferido, e a
    // viagem sairia com um veículo enquanto o outro é que ficaria ocupado.
    it("alterar e liberar a mesma viagem ao mesmo tempo: a alteração espera a saída e é recusada", async () => {
      const alvo = await montagem(1);
      const outro = await novaDupla();
      let saida: Promise<Response> | undefined;
      let troca: Promise<Response> | undefined;

      try {
        await prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id = ${alvo.vehicleId} FOR UPDATE`;

          saida = sair(alvo.id);
          expect(await quemChegaPrimeiro(saida), "a liberação não parou no veículo").toBe("parada");

          troca = alterar(alvo.id, { vehicleId: outro.vehicleId });
          expect(await quemChegaPrimeiro(troca, 2), "a alteração não esperou a liberação da mesma viagem").toBe(
            "parada",
          );
        });
      } finally {
        await Promise.all([saida?.catch(() => undefined), troca?.catch(() => undefined)]);
      }

      expect((await saida!).status).toBe(200);
      const recusada = await troca!;
      expect(recusada.status).toBe(409);
      expect((await recusada.json()).error).toMatch(/Só viagem em montagem pode ser alterada/);

      expect(await lerManifesto(alvo.id)).toMatchObject({ status: "ROUTE", vehicleId: alvo.vehicleId });
      expect((await lerVeiculo(alvo.vehicleId)).status).toBe("ON_ROUTE");
      expect((await lerVeiculo(outro.vehicleId)).status).toBe("AVAILABLE");
    });

    it("viagem vazia, motorista desativado ou veículo que foi para a oficina → não sai", async () => {
      const vazia = await montagem(1);
      expect((await retirar(vazia.id, vazia.cargas[0].id)).status).toBe(200);
      const resVazia = await sair(vazia.id);
      expect(resVazia.status).toBe(409);
      expect((await resVazia.json()).error).toMatch(/sem carga/);

      const { id, cargas, driverId, vehicleId } = await montagem(1);

      await prisma.driver.update({ where: { id: driverId }, data: { active: false } });
      expect((await sair(id)).status).toBe(400);
      await prisma.driver.update({ where: { id: driverId }, data: { active: true } });

      await prisma.vehicle.update({ where: { id: vehicleId }, data: { status: "MAINTENANCE" } });
      const oficina = await sair(id);
      expect(oficina.status).toBe(409);
      expect((await oficina.json()).error).toMatch(/manutenção/);

      expect((await lerManifesto(id)).status).toBe("ASSEMBLING");
      expect(await ler(cargas[0].id)).toMatchObject({ status: "COLLECTED", manifestId: id });
      expect((await lerVeiculo(vehicleId)).status).toBe("MAINTENANCE");
    });

    // A viagem foi montada com a dupla em ordem; a troca chega entre a montagem
    // e a saída e ainda não foi gravada quando a liberação começa.
    it.each([
      ["veículo posto em manutenção", 409, /manutenção/],
      ["motorista desativado", 400, /Motorista não encontrado ou inativo/],
    ] as const)("%s durante a liberação → não sai", async (caso, status, mensagem) => {
      const { id, cargas, driverId, vehicleId } = await montagem(1);

      const res = await comTrocaAberta(caso.startsWith("veículo") ? "veiculo" : "motorista", { driverId, vehicleId }, () =>
        sair(id),
      );
      expect(res.status).toBe(status);
      expect((await res.json()).error).toMatch(mensagem);
      expect((await lerManifesto(id)).status).toBe("ASSEMBLING");
      expect(await ler(cargas[0].id)).toMatchObject({ status: "COLLECTED", manifestId: id });
    });

    it("finalizar solta o veículo, que pode sair de novo com o mesmo motorista", async () => {
      const primeira = await viagem();
      expect((await lerVeiculo(primeira.vehicleId)).status).toBe("ON_ROUTE");

      expect((await mudar(primeira.cargas[0].id, { status: "DELIVERED", receiverName: "Fulano" })).status).toBe(200);
      expect((await encerrar(primeira.id)).status).toBe(200);
      expect((await lerVeiculo(primeira.vehicleId)).status).toBe("AVAILABLE");

      const segunda = await viagem(1, { driverId: primeira.driverId, vehicleId: primeira.vehicleId });
      expect((await lerManifesto(segunda.id)).status).toBe("ROUTE");
    });

    it("veículo que foi para a oficina durante a viagem continua em manutenção ao finalizar", async () => {
      const { id, cargas, vehicleId } = await viagem();
      await prisma.vehicle.update({ where: { id: vehicleId }, data: { status: "MAINTENANCE" } });

      expect((await retirar(id, cargas[0].id)).status).toBe(200);
      expect((await encerrar(id)).status).toBe(200);
      expect((await lerVeiculo(vehicleId)).status).toBe("MAINTENANCE");
    });
  });

  describe("encerrar viagem", () => {
    it("manifesto inexistente → 404", async () => {
      expect((await encerrar(SEM_ID)).status).toBe(404);
      expect((await encerrar("nao-e-uuid")).status).toBe(404);
    });

    it("com carga em rota → 409 com a quantidade; depois da baixa → 200; de novo → 409", async () => {
      const { id, cargas } = await viagem(2);

      const pendente = await encerrar(id);
      expect(pendente.status).toBe(409);
      expect((await pendente.json()).error).toMatch(/2 cargas ainda em rota/);
      expect((await lerManifesto(id)).status).toBe("ROUTE");

      expect((await mudar(cargas[0].id, { status: "DELIVERED", receiverName: "Fulano" })).status).toBe(200);
      const falta = await encerrar(id);
      expect(falta.status).toBe(409);
      expect((await falta.json()).error).toMatch(/1 carga ainda em rota/);
      expect((await lerManifesto(id)).status).toBe("ROUTE");

      expect((await mudar(cargas[1].id, { status: "DELIVERED", receiverName: "Fulano" })).status).toBe(200);
      const ok = await encerrar(id);
      expect(ok.status).toBe(200);
      expect((await ok.json()).manifest).toMatchObject({ id, status: "FINISHED" });
      expect((await lerManifesto(id)).status).toBe("FINISHED");

      const repetida = await encerrar(id);
      expect(repetida.status).toBe(409);
      expect((await repetida.json()).error).toMatch(/Finalizada/);

      // As cargas entregues continuam no manifesto.
      for (const alvo of cargas) {
        expect(await ler(alvo.id)).toMatchObject({ status: "DELIVERED", manifestId: id });
      }
    });

    it("viagem em montagem não é finalizada → 409", async () => {
      const emMontagem = await prisma.manifest.create({ data: { driverId: motoristaId, vehicleId: veiculoId } });
      expect(emMontagem.status).toBe("ASSEMBLING");

      expect((await encerrar(emMontagem.id)).status).toBe(409);
      expect((await lerManifesto(emMontagem.id)).status).toBe("ASSEMBLING");
    });

    it("todas as cargas retiradas → a viagem vazia pode ser finalizada", async () => {
      const { id, cargas } = await viagem();
      expect((await retirar(id, cargas[0].id)).status).toBe(200);

      expect((await encerrar(id)).status).toBe(200);
      expect((await lerManifesto(id)).status).toBe("FINISHED");
    });

    it("duas chamadas ao mesmo tempo: só uma finaliza", async () => {
      const { id, cargas } = await viagem();
      expect((await retirar(id, cargas[0].id)).status).toBe(200);

      const respostas = await Promise.all([encerrar(id), encerrar(id)]);
      expect(respostas.map((r) => r.status).sort()).toEqual([200, 409]);
      expect((await lerManifesto(id)).status).toBe("FINISHED");
    });

    // A saída da segunda viagem fica parada já segurando o veículo (outra
    // transação segura o motorista dela), e a finalização da primeira chega
    // nesse intervalo. Se a finalização gravasse FINISHED antes de segurar o
    // veículo, a saída passaria e a soltura, decidida com a fotografia de antes,
    // deixaria o veículo "Disponível" com a segunda viagem em rota.
    it("finalizar e liberar outra viagem do mesmo veículo ao mesmo tempo: o veículo não fica disponível em rota", async () => {
      const primeira = await viagem();
      expect((await retirar(primeira.id, primeira.cargas[0].id)).status).toBe(200);
      const segunda = await montagem(1, { ...(await novaDupla()), vehicleId: primeira.vehicleId });
      let saida: Promise<Response> | undefined;
      let fim: Promise<Response> | undefined;

      try {
        await prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM "Driver" WHERE id = ${segunda.driverId} FOR UPDATE`;

          saida = sair(segunda.id);
          expect(await quemChegaPrimeiro(saida), "a liberação não parou no motorista").toBe("parada");

          fim = encerrar(primeira.id);
          expect(await quemChegaPrimeiro(fim, 2), "a finalização não esperou o veículo que a liberação segura").toBe(
            "parada",
          );
          // Enquanto espera o veículo, a finalização ainda não gravou nada que outra transação veja.
          expect((await lerManifesto(primeira.id)).status).toBe("ROUTE");
        });
      } finally {
        await Promise.all([saida?.catch(() => undefined), fim?.catch(() => undefined)]);
      }

      // A saída conferiu antes de a primeira viagem terminar: recusada. A finalização vale.
      const recusada = await saida!;
      expect(recusada.status).toBe(409);
      expect((await recusada.json()).error).toMatch(/veículo já está em rota/);
      expect((await fim!).status).toBe(200);

      expect((await lerManifesto(primeira.id)).status).toBe("FINISHED");
      expect((await lerManifesto(segunda.id)).status).toBe("ASSEMBLING");
      const emRota = await prisma.manifest.count({ where: { vehicleId: primeira.vehicleId, status: "ROUTE" } });
      expect(emRota).toBe(0);
      expect((await lerVeiculo(primeira.vehicleId)).status).toBe("AVAILABLE");

      // Com a primeira encerrada, a segunda sai e o veículo volta a ficar ocupado.
      expect((await sair(segunda.id)).status).toBe(200);
      expect((await lerVeiculo(primeira.vehicleId)).status).toBe("ON_ROUTE");
    });

    it("o motorista só vê a viagem liberada, e ela some da lista quando finaliza", async () => {
      const { id, cargas } = await montagem(1, { driverId: motoristaId, vehicleId: veiculoId });

      const listar = async () => {
        comoMotorista();
        const res = await viagensDoMotorista.GET();
        expect(res.status).toBe(200);
        comoOperador();
        return ((await res.json()) as { id: string }[]).map((m) => m.id);
      };

      // Em montagem a viagem ainda pode mudar de carga e de motorista.
      expect(await listar()).not.toContain(id);
      expect((await sair(id)).status).toBe(200);
      expect(await listar()).toContain(id);

      expect((await mudar(cargas[0].id, { status: "DELIVERED", receiverName: "Fulano" })).status).toBe(200);
      expect(await listar()).toContain(id);

      expect((await encerrar(id)).status).toBe(200);
      expect(await listar()).not.toContain(id);
    });
  });

  describe("permissões das rotas novas", () => {
    it("sem sessão → 401; DRIVER → 403; nada muda", async () => {
      const { id, cargas } = await viagem();

      sessao.mockResolvedValue(null);
      expect((await retirar(id, cargas[0].id)).status).toBe(401);
      expect((await encerrar(id)).status).toBe(401);

      comoMotorista();
      expect((await retirar(id, cargas[0].id)).status).toBe(403);
      expect((await encerrar(id)).status).toBe(403);

      comoOperador();
      const emMontagem = await montagem();
      for (const [papel, esperado] of [[null, 401], ["DRIVER", 403]] as const) {
        if (papel) comoMotorista();
        else sessao.mockResolvedValue(null);
        expect((await sair(emMontagem.id)).status).toBe(esperado);
        expect((await desistir(emMontagem.id)).status).toBe(esperado);
        expect((await alterar(emMontagem.id, { driverId: motoristaId })).status).toBe(esperado);
      }
      expect((await lerManifesto(emMontagem.id)).status).toBe("ASSEMBLING");

      expect(await ler(cargas[0].id)).toMatchObject({ status: "ROUTE", manifestId: id });
      expect((await lerManifesto(id)).status).toBe("ROUTE");
    });
  });
});
