import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getServerSession } from "next-auth";
import {
  COLLECTION_STATUSES,
  OPERATOR_TRANSITIONS,
  canTransition,
  changedFields,
  isEditable,
} from "../src/lib/coletas";
import { COLLECTION_STATUS } from "../src/lib/format";

/**
 * Gestão de coletas e entregas pelo painel — criar, consultar, corrigir e
 * trocar de status — contra um Postgres de verdade, no padrão de
 * `cadastros.test.ts` (sessão simulada, handlers reais).
 *
 * A tabela de transições é testada à parte, sem banco. Sem DATABASE_URL a
 * parte de integração é pulada com aviso — no CI ela sempre roda.
 */
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

const temBanco = Boolean(process.env.DATABASE_URL);

if (!temBanco) {
  console.warn(
    "\n[coletas.test] DATABASE_URL ausente: testes de integração PULADOS.\n" +
      "Rode com um Postgres real para exercitá-los.\n",
  );
}

const suite = temBanco ? describe : describe.skip;

describe("transições de status da coleta", () => {
  const tabela: [string, string[]][] = [
    ["PENDING", ["CONFIRMED", "REJECTED", "CANCELLED"]],
    ["CONFIRMED", ["COLLECTED", "CANCELLED"]],
    ["COLLECTED", ["CANCELLED"]],
    ["ROUTE", ["DELIVERED"]],
    ["DELIVERED", []],
    ["CANCELLED", []],
    ["REJECTED", []],
  ];

  it.each(tabela)("%s só vai para o que a tabela permite", (de, permitidos) => {
    for (const para of COLLECTION_STATUSES) {
      expect(canTransition(de, para), `${de} → ${para}`).toBe(permitidos.includes(para));
    }
  });

  it("a tabela cobre os sete status, e nenhum deles leva a ROUTE", () => {
    expect(Object.keys(OPERATOR_TRANSITIONS).sort()).toEqual([...COLLECTION_STATUSES].sort());
    expect(tabela.map(([de]) => de).sort()).toEqual([...COLLECTION_STATUSES].sort());
    for (const de of COLLECTION_STATUSES) {
      expect(canTransition(de, "ROUTE"), de).toBe(false);
    }
  });

  it("recusa voltar atrás, pular etapa e status desconhecido", () => {
    expect(canTransition("DELIVERED", "CONFIRMED")).toBe(false);
    expect(canTransition("PENDING", "DELIVERED")).toBe(false);
    expect(canTransition("CANCELLED", "CONFIRMED")).toBe(false);
    expect(canTransition("INVENTADO", "CONFIRMED")).toBe(false);
    expect(canTransition("PENDING", "INVENTADO")).toBe(false);
    // Nome de propriedade herdada não pode passar por status.
    expect(canTransition("constructor", "CONFIRMED")).toBe(false);
  });

  it("só dá para editar antes do embarque", () => {
    for (const status of ["PENDING", "CONFIRMED", "COLLECTED"]) {
      expect(isEditable({ status, manifestId: null }), status).toBe(true);
      expect(isEditable({ status, manifestId: "m1" }), status).toBe(false);
    }
    for (const status of ["ROUTE", "DELIVERED", "CANCELLED", "REJECTED"]) {
      expect(isEditable({ status, manifestId: null }), status).toBe(false);
    }
  });

  it("a edição manda só os campos que mudaram", () => {
    const original = { sender: "A", volumes: "3", invoiceKey: "NF-ANTIGA", driverId: "" };

    expect(changedFields(original, { ...original, volumes: "4" })).toEqual({ volumes: "4" });
    // Campo apagado vai como "" (a rota grava `null`); o que não mudou fica de fora.
    expect(changedFields(original, { ...original, invoiceKey: "", driverId: "m1" })).toEqual({
      invoiceKey: "",
      driverId: "m1",
    });
    expect(changedFields(original, { ...original })).toEqual({});
  });

  it("todo status tem rótulo em português", () => {
    for (const status of COLLECTION_STATUSES) {
      expect(COLLECTION_STATUS[status]?.label, status).toBeTruthy();
    }
    expect(COLLECTION_STATUS.CANCELLED.label).toBe("Cancelada");
    expect(COLLECTION_STATUS.REJECTED.label).toBe("Recusada");
  });
});

// Tudo o que esta suite cria usa estes marcadores, e só isso é apagado.
const PREFIXO = "teste-coletas-";
const CNPJ_TESTE = "99888777000590";
const CNPJ_INATIVO = "99888777000670";
const CPF_TESTE = "99988877644";
const CPF_INATIVO = "99988877655";
const PLACA_TESTE = "TCL0A01";
const HASH_FALSO = "$2b$10$hashfalsoparateste000000000000000000000000000000000";
const SEM_ID = "00000000-0000-0000-0000-000000000000";
const CHAVE_NF = "35240112345678000190550010000012341000012345";
const CHAVE_NF_MASCARADA = "3524 0112 3456 7800 0190 5500 1000 0012 3410 0001 2345";

suite("coletas e entregas pelo painel", () => {
  let prisma: typeof import("../src/lib/prisma").default;
  let coletas: typeof import("../src/app/api/coletas/route");
  let coleta: typeof import("../src/app/api/coletas/[id]/route");
  let statusRota: typeof import("../src/app/api/dashboard/coletas/[id]/status/route");
  let pendentes: typeof import("../src/app/api/dashboard/coletas/pendentes/route");

  let operadorId: string;
  let clienteId: string;
  let clienteInativoId: string;
  let motoristaId: string;
  let motoristaInativoId: string;
  let manifestId: string;

  const sessao = vi.mocked(getServerSession);

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
    invoiceKey: "",
    invoiceValue: "",
    driverId: "",
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
        ...extra,
      },
    });

  const ler = (id: string) => prisma.collection.findUniqueOrThrow({ where: { id } });

  const mudar = (id: string, body: unknown) => statusRota.POST(req("POST", body), ctx(id));

  // Na ordem das dependências: coletas → manifesto → veículo → motorista → usuário → cliente.
  async function limpar() {
    const cnpjs = [CNPJ_TESTE, CNPJ_INATIVO];
    const cpfs = [CPF_TESTE, CPF_INATIVO];
    await prisma.collection.deleteMany({ where: { client: { cnpj: { in: cnpjs } } } });
    await prisma.manifest.deleteMany({ where: { vehicle: { plate: PLACA_TESTE } } });
    await prisma.vehicle.deleteMany({ where: { plate: PLACA_TESTE } });
    await prisma.driver.deleteMany({ where: { cpf: { in: cpfs } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: PREFIXO, mode: "insensitive" } } });
    await prisma.client.deleteMany({ where: { cnpj: { in: cnpjs } } });
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
    return driver.id;
  }

  beforeAll(async () => {
    prisma = (await import("../src/lib/prisma")).default;
    coletas = await import("../src/app/api/coletas/route");
    coleta = await import("../src/app/api/coletas/[id]/route");
    statusRota = await import("../src/app/api/dashboard/coletas/[id]/status/route");
    pendentes = await import("../src/app/api/dashboard/coletas/pendentes/route");

    await limpar();

    const operador = await prisma.user.create({
      data: { name: "operacao", email: email("operacao"), password: HASH_FALSO, role: "OPERATION" },
    });
    operadorId = operador.id;

    clienteId = (
      await prisma.client.create({ data: { companyName: "Empresa Teste Coletas LTDA", cnpj: CNPJ_TESTE } })
    ).id;
    clienteInativoId = (
      await prisma.client.create({
        data: { companyName: "Empresa Inativa Coletas LTDA", cnpj: CNPJ_INATIVO, active: false },
      })
    ).id;

    motoristaId = await criarMotorista("ativo", CPF_TESTE, true);
    motoristaInativoId = await criarMotorista("inativo", CPF_INATIVO, false);

    const veiculo = await prisma.vehicle.create({ data: { plate: PLACA_TESTE, model: "Teste", type: "VAN" } });
    manifestId = (await prisma.manifest.create({ data: { driverId: motoristaId, vehicleId: veiculo.id } })).id;
  });

  beforeEach(() => {
    sessao.mockReset();
    sessao.mockResolvedValue({ user: { id: operadorId, role: "OPERATION", clientId: null } });
  });

  afterAll(async () => {
    if (prisma) await limpar();
  });

  describe("criação", () => {
    it("válida → 201, nasce CONFIRMED, com código de rastreio de 10 dígitos e número como número", async () => {
      const res = await coletas.POST(req("POST", corpo({ sender: "  Remetente Teste  ", driverId: motoristaId })));
      expect(res.status).toBe(201);
      const criada = await res.json();

      expect(criada.status).toBe("CONFIRMED");
      expect(criada.trackingCode).toMatch(/^\d{10}$/);
      expect(criada).toMatchObject({
        sender: "Remetente Teste",
        volumes: 3,
        weight: 12.5,
        invoiceKey: null,
        invoiceValue: null,
        driverId: motoristaId,
      });
      expect(criada.client.id).toBe(clienteId);
      expect(temChaveDeSenha(criada)).toBe(false);

      const gravada = await ler(criada.id);
      expect(gravada).toMatchObject({ status: "CONFIRMED", volumes: 3, weight: 12.5, manifestId: null });
    });

    it("recusa dados inválidos → 400 com mensagem, sem gravar", async () => {
      const antes = await prisma.collection.count({ where: { clientId: clienteId } });

      const casos: [string, Record<string, unknown>, RegExp][] = [
        ["volumes: abc", corpo({ volumes: "abc" }), /volumes/i],
        ["volumes: 0", corpo({ volumes: 0 }), /volumes/i],
        ["volumes: 1,5", corpo({ volumes: "1,5" }), /volumes/i],
        ["volumes acima do int4", corpo({ volumes: "2147483648" }), /volumes/i],
        ["volumes: 99999999999 (número)", corpo({ volumes: 99999999999 }), /volumes/i],
        ["volumes: 0x10", corpo({ volumes: "0x10" }), /volumes/i],
        ["volumes: 1e3", corpo({ volumes: "1e3" }), /volumes/i],
        ["weight: 0x10", corpo({ weight: "0x10" }), /peso/i],
        ["weight: 1e3", corpo({ weight: "1e3" }), /peso/i],
        ["invoiceValue: 1e3", corpo({ invoiceValue: "1e3" }), /valor da NF/i],
        ["invoiceValue: 0x10", corpo({ invoiceValue: "0x10" }), /valor da NF/i],
        ["weight: 0", corpo({ weight: 0 }), /peso/i],
        ["weight negativo", corpo({ weight: "-3" }), /peso/i],
        ["weight em branco", corpo({ weight: "" }), /peso/i],
        ["invoiceValue negativo", corpo({ invoiceValue: "-1" }), /valor da NF/i],
        ["remetente em branco", corpo({ sender: "   " }), /remetente/i],
        ["destino longo", corpo({ destination: "x".repeat(201) }), /destino/i],
        ["sem cliente", corpo({ clientId: undefined }), /cliente/i],
        ["clientId inexistente", corpo({ clientId: SEM_ID }), /cliente/i],
        ["cliente inativo", corpo({ clientId: clienteInativoId }), /cliente/i],
        ["driverId inexistente", corpo({ driverId: SEM_ID }), /motorista/i],
        ["motorista inativo", corpo({ driverId: motoristaInativoId }), /motorista/i],
        ["invoiceKey com 43 dígitos", corpo({ invoiceKey: CHAVE_NF.slice(0, 43) }), /44 dígitos/],
        ["invoiceKey sem dígito", corpo({ invoiceKey: "abc" }), /44 dígitos/],
      ];

      for (const [nome, body, mensagem] of casos) {
        const res = await coletas.POST(req("POST", body));
        expect(res.status, nome).toBe(400);
        expect((await res.json()).error, nome).toMatch(mensagem);
      }

      const semCorpo = await coletas.POST(
        new Request("http://localhost/api/teste", { method: "POST", body: "{nao e json" }),
      );
      expect(semCorpo.status).toBe(400);

      expect(await prisma.collection.count({ where: { clientId: clienteId } })).toBe(antes);
      expect(await prisma.collection.count({ where: { clientId: clienteInativoId } })).toBe(0);
    });

    it("chave da NF com máscara e 44 dígitos grava só os dígitos", async () => {
      const res = await coletas.POST(req("POST", corpo({ invoiceKey: CHAVE_NF_MASCARADA, invoiceValue: "1.500,50" })));
      // "1.500,50" não é número para o servidor: o formulário manda sem milhar.
      expect(res.status).toBe(400);

      const ok = await coletas.POST(req("POST", corpo({ invoiceKey: CHAVE_NF_MASCARADA, invoiceValue: "1500,50" })));
      expect(ok.status).toBe(201);
      const criada = await ok.json();
      expect(criada.invoiceKey).toBe(CHAVE_NF);
      expect(criada.invoiceValue).toBe(1500.5);
      expect((await ler(criada.id)).invoiceKey).toBe(CHAVE_NF);
    });

    it("status e campos de controle no corpo são ignorados na criação", async () => {
      const res = await coletas.POST(
        req("POST", corpo({ status: "DELIVERED", trackingCode: "1111111111", manifestId, cteKey: "x" })),
      );
      expect(res.status).toBe(201);
      const criada = await res.json();
      expect(criada.status).toBe("CONFIRMED");
      expect(criada.trackingCode).not.toBe("1111111111");
      expect(criada.manifestId).toBeNull();
      expect(criada.cteKey).toBeNull();
    });
  });

  describe("GET /api/coletas/[id]", () => {
    it("devolve a coleta com cliente e motorista, sem a senha do motorista", async () => {
      const criada = await montar({ driverId: motoristaId, status: "CONFIRMED" });

      const res = await coleta.GET(req(), ctx(criada.id));
      expect(res.status).toBe(200);
      const lida = await res.json();

      expect(lida.id).toBe(criada.id);
      expect(lida.client.companyName).toBe("Empresa Teste Coletas LTDA");
      expect(lida.driver.user).toEqual({ id: expect.any(String), name: "Motorista ativo", email: email("ativo") });
      expect(temChaveDeSenha(lida)).toBe(false);
      expect(JSON.stringify(lida)).not.toContain(HASH_FALSO);
    });

    it("id inexistente → 404", async () => {
      expect((await coleta.GET(req(), ctx(SEM_ID))).status).toBe(404);
    });

    it("a lista geral e a de pendentes mantêm o contrato", async () => {
      const pendente = await montar({ driverId: motoristaId });

      const lista = await coletas.GET();
      expect(lista.status).toBe(200);
      const itens = (await lista.json()) as { id: string; client: { cnpj: string } }[];
      expect(itens.find((item) => item.id === pendente.id)?.client.cnpj).toBe(CNPJ_TESTE);
      expect(temChaveDeSenha(itens)).toBe(false);

      const fila = await pendentes.GET(req());
      expect(fila.status).toBe(200);
      const filaItens = (await fila.json()) as { id: string; status: string; client: Record<string, unknown> }[];
      expect(filaItens.every((item) => item.status === "PENDING")).toBe(true);
      expect(filaItens.find((item) => item.id === pendente.id)?.client).toEqual({
        companyName: "Empresa Teste Coletas LTDA",
      });
    });
  });

  describe("PATCH /api/coletas/[id]", () => {
    it("altera volumes e aloca motorista; driverId null desaloca", async () => {
      const alvo = await montar({ status: "CONFIRMED" });

      const res = await coleta.PATCH(req("PATCH", { volumes: "7", driverId: motoristaId }), ctx(alvo.id));
      expect(res.status).toBe(200);
      const alterada = await res.json();
      expect(alterada).toMatchObject({ volumes: 7, driverId: motoristaId, sender: "Remetente Teste" });
      expect(alterada.driver.user.name).toBe("Motorista ativo");
      expect(temChaveDeSenha(alterada)).toBe(false);

      const semMotorista = await coleta.PATCH(req("PATCH", { driverId: null }), ctx(alvo.id));
      expect(semMotorista.status).toBe(200);
      expect((await semMotorista.json()).driver).toBeNull();
      expect(await ler(alvo.id)).toMatchObject({ volumes: 7, driverId: null, weight: 1 });

      // O formulário manda "" no lugar de `null`.
      await coleta.PATCH(req("PATCH", { driverId: motoristaId }), ctx(alvo.id));
      expect((await coleta.PATCH(req("PATCH", { driverId: "" }), ctx(alvo.id))).status).toBe(200);
      expect((await ler(alvo.id)).driverId).toBeNull();
    });

    it("corrige texto, peso e nota; vazio apaga a chave e o valor da NF", async () => {
      const alvo = await montar({ status: "COLLECTED", invoiceKey: CHAVE_NF, invoiceValue: 10 });

      const res = await coleta.PATCH(
        req("PATCH", { receiver: " Novo Destinatário ", weight: "8,25", invoiceKey: "", invoiceValue: "" }),
        ctx(alvo.id),
      );
      expect(res.status).toBe(200);
      expect(await ler(alvo.id)).toMatchObject({
        receiver: "Novo Destinatário",
        weight: 8.25,
        invoiceKey: null,
        invoiceValue: null,
        status: "COLLECTED",
      });
    });

    it("status, cliente, rastreio, manifesto e CT-e no corpo nunca são gravados", async () => {
      const alvo = await montar({ status: "CONFIRMED", trackingCode: null });

      const res = await coleta.PATCH(
        req("PATCH", {
          volumes: 2,
          status: "DELIVERED",
          clientId: clienteInativoId,
          trackingCode: "2222222222",
          manifestId,
          cteKey: "chave",
          cteNumber: 9,
          cteStatus: "ISSUED",
          receiverName: "Invasor",
        }),
        ctx(alvo.id),
      );
      expect(res.status).toBe(200);

      const gravada = await ler(alvo.id);
      expect(gravada).toMatchObject({
        volumes: 2,
        status: "CONFIRMED",
        clientId: clienteId,
        trackingCode: null,
        manifestId: null,
        cteKey: null,
        cteNumber: null,
        cteStatus: "PENDING",
        receiverName: null,
      });

      // Só campo que a rota não conhece é o mesmo que corpo vazio.
      expect((await coleta.PATCH(req("PATCH", { status: "DELIVERED" }), ctx(alvo.id))).status).toBe(400);
      expect((await coleta.PATCH(req("PATCH", {}), ctx(alvo.id))).status).toBe(400);
      expect((await ler(alvo.id)).status).toBe("CONFIRMED");
    });

    it("recusa valor inválido e motorista inexistente ou inativo → 400, sem gravar", async () => {
      const alvo = await montar({ status: "CONFIRMED" });

      const casos: [string, Record<string, unknown>][] = [
        ["volumes: abc", { volumes: "abc" }],
        ["volumes em branco", { volumes: "" }],
        ["volumes acima do int4", { volumes: "2147483648" }],
        ["volumes: 0x10", { volumes: "0x10" }],
        ["weight: 1e3", { weight: "1e3" }],
        ["invoiceValue: 1e3", { invoiceValue: "1e3" }],
        ["weight: 0", { weight: 0 }],
        ["origem em branco", { origin: "" }],
        ["invoiceKey curta", { invoiceKey: "123" }],
        ["driverId inexistente", { driverId: SEM_ID }],
        ["motorista inativo", { driverId: motoristaInativoId }],
      ];
      for (const [nome, body] of casos) {
        const res = await coleta.PATCH(req("PATCH", body), ctx(alvo.id));
        expect(res.status, nome).toBe(400);
        expect((await res.json()).error, nome).toBeTruthy();
      }

      expect(await ler(alvo.id)).toMatchObject({ volumes: 1, weight: 1, origin: "Origem - SP", driverId: null });
    });

    it("volumes no teto do int4 é aceito", async () => {
      const alvo = await montar({ status: "CONFIRMED" });

      const res = await coleta.PATCH(req("PATCH", { volumes: "2147483647" }), ctx(alvo.id));
      expect(res.status).toBe(200);
      expect((await ler(alvo.id)).volumes).toBe(2147483647);
    });

    it("coleta antiga com chave de NF fora do padrão: PATCH parcial altera os outros campos", async () => {
      const CHAVE_ANTIGA = "NF 1234/2019";
      const alvo = await montar({ status: "CONFIRMED", invoiceKey: CHAVE_ANTIGA, invoiceValue: 10 });

      // O que a tela manda quando o operador só troca os volumes e o destino.
      const formulario = {
        sender: alvo.sender,
        receiver: alvo.receiver,
        origin: alvo.origin,
        destination: alvo.destination,
        volumes: "1",
        weight: "1",
        invoiceKey: CHAVE_ANTIGA,
        invoiceValue: "10",
        driverId: "",
      };
      const parcial = changedFields(formulario, { ...formulario, volumes: "5", destination: "Bauru - SP" });
      expect(parcial).toEqual({ volumes: "5", destination: "Bauru - SP" });

      const res = await coleta.PATCH(req("PATCH", parcial), ctx(alvo.id));
      expect(res.status).toBe(200);
      expect(await ler(alvo.id)).toMatchObject({
        volumes: 5,
        destination: "Bauru - SP",
        invoiceKey: CHAVE_ANTIGA,
        invoiceValue: 10,
        weight: 1,
      });

      // Reenviar a chave antiga continua 400: é o formulário inteiro que travava a edição.
      const inteiro = await coleta.PATCH(req("PATCH", { ...formulario, volumes: "6" }), ctx(alvo.id));
      expect(inteiro.status).toBe(400);
      expect((await inteiro.json()).error).toMatch(/44 dígitos/);
      expect((await ler(alvo.id)).volumes).toBe(5);

      // Corrigir ou apagar a chave segue valendo.
      expect((await coleta.PATCH(req("PATCH", { invoiceKey: "" }), ctx(alvo.id))).status).toBe(200);
      expect((await ler(alvo.id)).invoiceKey).toBeNull();
    });

    it("motorista que já estava na coleta e ficou inativo não trava a edição", async () => {
      const alvo = await montar({ status: "CONFIRMED", driverId: motoristaInativoId });

      const res = await coleta.PATCH(req("PATCH", { volumes: 4, driverId: motoristaInativoId }), ctx(alvo.id));
      expect(res.status).toBe(200);
      expect(await ler(alvo.id)).toMatchObject({ volumes: 4, driverId: motoristaInativoId });
    });

    it("coleta entregue, cancelada, em rota ou em manifesto → 409 dizendo o motivo, sem gravar", async () => {
      const entregue = await montar({ status: "DELIVERED" });
      const cancelada = await montar({ status: "CANCELLED" });
      const emRota = await montar({ status: "ROUTE", manifestId });
      const noManifesto = await montar({ status: "COLLECTED", manifestId });

      for (const alvo of [entregue, cancelada]) {
        const res = await coleta.PATCH(req("PATCH", { volumes: 9 }), ctx(alvo.id));
        expect(res.status, alvo.status).toBe(409);
        expect((await res.json()).error).toContain(alvo.status);
      }
      for (const alvo of [emRota, noManifesto]) {
        const res = await coleta.PATCH(req("PATCH", { volumes: 9 }), ctx(alvo.id));
        expect(res.status, alvo.status).toBe(409);
        expect((await res.json()).error).toMatch(/manifesto/);
      }

      for (const alvo of [entregue, cancelada, emRota, noManifesto]) {
        expect((await ler(alvo.id)).volumes, alvo.status).toBe(1);
      }
    });

    it("id inexistente → 404", async () => {
      expect((await coleta.PATCH(req("PATCH", { volumes: 2 }), ctx(SEM_ID))).status).toBe(404);
    });
  });

  describe("POST /api/dashboard/coletas/[id]/status", () => {
    it("PENDING → CONFIRMED → COLLECTED grava cada passo", async () => {
      const alvo = await montar();

      const confirmar = await mudar(alvo.id, { status: "CONFIRMED" });
      expect(confirmar.status).toBe(200);
      expect(await confirmar.json()).toMatchObject({ success: true, collection: { id: alvo.id, status: "CONFIRMED" } });
      expect((await ler(alvo.id)).status).toBe("CONFIRMED");

      expect((await mudar(alvo.id, { status: "COLLECTED" })).status).toBe(200);
      expect((await ler(alvo.id)).status).toBe("COLLECTED");
    });

    it("recusa e cancelamento saem do estado certo e não têm volta", async () => {
      const recusar = await montar();
      expect((await mudar(recusar.id, { status: "REJECTED" })).status).toBe(200);
      expect((await mudar(recusar.id, { status: "CONFIRMED" })).status).toBe(409);
      expect((await ler(recusar.id)).status).toBe("REJECTED");

      const cancelar = await montar({ status: "COLLECTED" });
      expect((await mudar(cancelar.id, { status: "CANCELLED" })).status).toBe(200);
      expect((await mudar(cancelar.id, { status: "CONFIRMED" })).status).toBe(409);
      expect((await ler(cancelar.id)).status).toBe("CANCELLED");

      // Só pedido pendente pode ser recusado.
      const confirmada = await montar({ status: "CONFIRMED" });
      expect((await mudar(confirmada.id, { status: "REJECTED" })).status).toBe(409);
      expect((await ler(confirmada.id)).status).toBe("CONFIRMED");
    });

    it("DELIVERED → CONFIRMED → 409 e o banco não muda", async () => {
      const alvo = await montar({ status: "DELIVERED", receiverName: "Fulano", manifestId });

      const res = await mudar(alvo.id, { status: "CONFIRMED" });
      expect(res.status).toBe(409);
      expect((await res.json()).error).toMatch(/Entregue/);

      const gravada = await ler(alvo.id);
      expect(gravada).toMatchObject({ status: "DELIVERED", receiverName: "Fulano" });
      expect(gravada.updatedAt.getTime()).toBe(alvo.updatedAt.getTime());
    });

    it("pular etapa → 409: PENDING não vira DELIVERED nem COLLECTED", async () => {
      const alvo = await montar();
      expect((await mudar(alvo.id, { status: "DELIVERED", receiverName: "Fulano" })).status).toBe(409);
      expect((await mudar(alvo.id, { status: "COLLECTED" })).status).toBe(409);
      expect(await ler(alvo.id)).toMatchObject({ status: "PENDING", receiverName: null });
    });

    it("ROUTE → DELIVERED exige o nome de quem recebeu e grava status e nome", async () => {
      const alvo = await montar({ status: "ROUTE", manifestId });

      for (const body of [{ status: "DELIVERED" }, { status: "DELIVERED", receiverName: " A " }]) {
        const res = await mudar(alvo.id, body);
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/quem recebeu/);
      }
      expect(await ler(alvo.id)).toMatchObject({ status: "ROUTE", receiverName: null });

      const res = await mudar(alvo.id, { status: "DELIVERED", receiverName: "  Maria da Portaria  " });
      expect(res.status).toBe(200);
      expect(await ler(alvo.id)).toMatchObject({
        status: "DELIVERED",
        receiverName: "Maria da Portaria",
        manifestId,
      });
    });

    it("em rota não se cancela; coleta em manifesto só cancela depois de sair dele", async () => {
      const emRota = await montar({ status: "ROUTE", manifestId });
      expect((await mudar(emRota.id, { status: "CANCELLED" })).status).toBe(409);
      expect((await ler(emRota.id)).status).toBe("ROUTE");

      const noManifesto = await montar({ status: "COLLECTED", manifestId });
      const res = await mudar(noManifesto.id, { status: "CANCELLED" });
      expect(res.status).toBe(409);
      expect((await res.json()).error).toMatch(/retire a carga do manifesto/);
      expect(await ler(noManifesto.id)).toMatchObject({ status: "COLLECTED", manifestId });
    });

    it("receiverName fora da baixa não é gravado", async () => {
      const alvo = await montar();
      expect((await mudar(alvo.id, { status: "CONFIRMED", receiverName: "Fulano de Tal" })).status).toBe(200);
      expect(await ler(alvo.id)).toMatchObject({ status: "CONFIRMED", receiverName: null });
    });

    it("id inexistente → 404; valor fora da lista ou corpo quebrado → 400", async () => {
      expect((await mudar(SEM_ID, { status: "CONFIRMED" })).status).toBe(404);

      const alvo = await montar();
      for (const body of [{ status: "ROUTE" }, { status: "PENDING" }, { status: "INVENTADO" }, { status: 1 }, {}, null]) {
        expect((await mudar(alvo.id, body)).status, JSON.stringify(body)).toBe(400);
      }
      // Corpo inválido é 400 mesmo com id inexistente: a validação vem antes do banco.
      expect((await mudar(SEM_ID, {})).status).toBe(400);
      expect((await ler(alvo.id)).status).toBe("PENDING");
    });

    it("duas trocas simultâneas: só uma é aplicada, a outra recebe 409", async () => {
      const alvo = await montar();

      const respostas = await Promise.all([
        mudar(alvo.id, { status: "CONFIRMED" }),
        mudar(alvo.id, { status: "REJECTED" }),
      ]);
      const codigos = respostas.map((res) => res.status).sort();
      expect(codigos).toEqual([200, 409]);

      const vencedora = respostas[0].status === 200 ? "CONFIRMED" : "REJECTED";
      expect((await ler(alvo.id)).status).toBe(vencedora);
    });
  });
});
