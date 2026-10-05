import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getServerSession } from "next-auth";
import bcrypt from "bcryptjs";

/**
 * Cadastros de clientes, motoristas e veículos — criar, listar, editar e
 * desativar — contra um Postgres de verdade, no padrão de `permissoes.test.ts`
 * (sessão simulada, handlers reais).
 *
 * Sem DATABASE_URL a suite é pulada com aviso — no CI ela sempre roda.
 */
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

const temBanco = Boolean(process.env.DATABASE_URL);

if (!temBanco) {
  console.warn(
    "\n[cadastros.test] DATABASE_URL ausente: testes de integração PULADOS.\n" +
      "Rode com um Postgres real para exercitá-los.\n",
  );
}

const suite = temBanco ? describe : describe.skip;

// Tudo o que esta suite cria usa estes marcadores, e só isso é apagado.
const PREFIXO = "teste-cadastros-";
const CNPJ_MASCARADO = "99.888.777/0003-28";
const CNPJ_TESTE = "99888777000328";
const CNPJ_OUTRO = "99888777000409";
const CPF_MASCARADO = "999.888.777-33";
const CPF_TESTE = "99988877733";
const CPF_OUTRO = "99988877722";
const PLACA_DIGITADA = "abc-1d23";
const PLACA_TESTE = "ABC1D23";
const HASH_FALSO = "$2b$10$hashfalsoparateste000000000000000000000000000000000";
const SENHA = "senha-de-teste-123";
const SEM_ID = "00000000-0000-0000-0000-000000000000";

suite("cadastros de clientes, motoristas e veículos", () => {
  let prisma: typeof import("../src/lib/prisma").default;
  let clientes: typeof import("../src/app/api/clientes/route");
  let cliente: typeof import("../src/app/api/clientes/[id]/route");
  let motoristas: typeof import("../src/app/api/motoristas/route");
  let motorista: typeof import("../src/app/api/motoristas/[id]/route");
  let veiculos: typeof import("../src/app/api/veiculos/route");
  let veiculo: typeof import("../src/app/api/veiculos/[id]/route");

  let operadorId: string;

  const sessao = vi.mocked(getServerSession);

  const req = (method = "GET", body?: unknown) =>
    new Request("http://localhost/api/teste", {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

  const email = (nome: string) => `${PREFIXO}${nome}@exemplo.br`;

  const corpoMotorista = (extra: Record<string, unknown> = {}) => ({
    name: "Motorista de Teste",
    cpf: CPF_MASCARADO,
    email: email("motorista"),
    password: SENHA,
    cnh: "12345678900",
    category: "D",
    cnhExpiry: "2031-06-30",
    phone: "(17) 99999-0000",
    ...extra,
  });

  // Na ordem das dependências: veículo → motorista → usuário → cliente.
  async function limpar() {
    const cpfs = [CPF_TESTE, CPF_OUTRO];
    await prisma.vehicle.deleteMany({ where: { plate: PLACA_TESTE } });
    await prisma.driver.deleteMany({ where: { cpf: { in: cpfs } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: PREFIXO, mode: "insensitive" } } });
    await prisma.client.deleteMany({ where: { cnpj: { in: [CNPJ_TESTE, CNPJ_OUTRO, CNPJ_MASCARADO] } } });
  }

  // Procura a chave `password` em qualquer profundidade da resposta.
  function temChaveDeSenha(valor: unknown): boolean {
    if (Array.isArray(valor)) return valor.some(temChaveDeSenha);
    if (valor && typeof valor === "object") {
      return Object.entries(valor).some(([chave, filho]) => chave === "password" || temChaveDeSenha(filho));
    }
    return false;
  }

  beforeAll(async () => {
    prisma = (await import("../src/lib/prisma")).default;
    clientes = await import("../src/app/api/clientes/route");
    cliente = await import("../src/app/api/clientes/[id]/route");
    motoristas = await import("../src/app/api/motoristas/route");
    motorista = await import("../src/app/api/motoristas/[id]/route");
    veiculos = await import("../src/app/api/veiculos/route");
    veiculo = await import("../src/app/api/veiculos/[id]/route");

    await limpar();

    const operador = await prisma.user.create({
      data: { name: "operacao", email: email("operacao"), password: HASH_FALSO, role: "OPERATION" },
    });
    operadorId = operador.id;
  });

  beforeEach(() => {
    sessao.mockReset();
    sessao.mockResolvedValue({ user: { id: operadorId, role: "OPERATION", clientId: null } });
  });

  afterAll(async () => {
    if (prisma) await limpar();
  });

  describe("clientes", () => {
    let clienteId: string;

    it("cria com CNPJ mascarado e guarda só os dígitos, com os campos novos", async () => {
      const res = await clientes.POST(
        req("POST", {
          cnpj: CNPJ_MASCARADO,
          companyName: "  Empresa Teste Cadastros LTDA  ",
          tradeName: "",
          ie: "123.456.789.110",
          contactName: "Fulana",
          email: " Contato@Exemplo.BR ",
          paymentCondition: "28 dias",
          creditLimit: "1500.50",
        }),
      );
      expect(res.status).toBe(201);
      clienteId = (await res.json()).id;

      const gravado = await prisma.client.findUniqueOrThrow({ where: { id: clienteId } });
      expect(gravado).toMatchObject({
        cnpj: CNPJ_TESTE,
        companyName: "Empresa Teste Cadastros LTDA",
        tradeName: null,
        ie: "123.456.789.110",
        contactName: "Fulana",
        email: "contato@exemplo.br",
        paymentCondition: "28 dias",
        creditLimit: 1500.5,
        active: true,
      });
    });

    it("o mesmo CNPJ sem máscara → 409", async () => {
      const res = await clientes.POST(req("POST", { cnpj: CNPJ_TESTE, companyName: "Outra Empresa LTDA" }));
      expect(res.status).toBe(409);
      expect(await prisma.client.count({ where: { cnpj: CNPJ_TESTE } })).toBe(1);
    });

    it("duas criações simultâneas do mesmo CNPJ: uma entra, a outra → 409", async () => {
      const corpo = { cnpj: CNPJ_OUTRO, companyName: "Empresa Corrida LTDA" };
      const respostas = await Promise.all([clientes.POST(req("POST", corpo)), clientes.POST(req("POST", corpo))]);

      expect(respostas.map((res) => res.status).sort()).toEqual([201, 409]);
      expect(await prisma.client.count({ where: { cnpj: CNPJ_OUTRO } })).toBe(1);
    });

    it("dados inválidos → 400 com mensagem em português", async () => {
      const casos: [string, unknown][] = [
        ["CNPJ com 10 dígitos", { cnpj: "1234567890", companyName: "Empresa X LTDA" }],
        ["sem razão social", { cnpj: "99888777000581" }],
        ["limite negativo", { cnpj: "99888777000581", companyName: "Empresa X LTDA", creditLimit: -1 }],
        ["limite que não é número", { cnpj: "99888777000581", companyName: "Empresa X LTDA", creditLimit: "muito" }],
        ["e-mail inválido", { cnpj: "99888777000581", companyName: "Empresa X LTDA", email: "nao-e-email" }],
        ["corpo que não é JSON de objeto", "texto solto"],
      ];
      for (const [nome, corpo] of casos) {
        const res = await clientes.POST(req("POST", corpo));
        expect(res.status, nome).toBe(400);
        expect((await res.json()).error, nome).toMatch(/[a-zà-ú]/i);
      }
      const curto = await clientes.POST(req("POST", { cnpj: "1234567890", companyName: "Empresa X LTDA" }));
      expect((await curto.json()).error).toMatch(/CNPJ/);
      expect(await prisma.client.count({ where: { cnpj: "99888777000581" } })).toBe(0);
    });

    it("PATCH grava limite de crédito e desativa; GET continua listando o inativo", async () => {
      const res = await cliente.PATCH(req("PATCH", { creditLimit: 2500, active: false }), ctx(clienteId));
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ id: clienteId, creditLimit: 2500, active: false });

      const gravado = await prisma.client.findUniqueOrThrow({ where: { id: clienteId } });
      expect(gravado).toMatchObject({ creditLimit: 2500, active: false, contactName: "Fulana" });

      const lista = (await (await clientes.GET()).json()) as { id: string; active: boolean }[];
      expect(lista.find((item) => item.id === clienteId)).toMatchObject({ active: false });
    });

    it("PATCH: id inexistente → 404, CNPJ de outro → 409, corpo vazio → 400", async () => {
      expect((await cliente.PATCH(req("PATCH", { active: true }), ctx(SEM_ID))).status).toBe(404);
      expect((await cliente.PATCH(req("PATCH", { cnpj: CNPJ_OUTRO }), ctx(clienteId))).status).toBe(409);
      expect((await cliente.PATCH(req("PATCH", {}), ctx(clienteId))).status).toBe(400);
      expect((await cliente.PATCH(req("PATCH", { cnpj: "123" }), ctx(clienteId))).status).toBe(400);

      // Regravar o próprio CNPJ, com máscara, não é duplicado.
      const proprio = await cliente.PATCH(req("PATCH", { cnpj: CNPJ_MASCARADO, active: true }), ctx(clienteId));
      expect(proprio.status).toBe(200);
      expect(await proprio.json()).toMatchObject({ cnpj: CNPJ_TESTE, active: true });
    });
  });

  describe("motoristas", () => {
    let motoristaId: string;

    it("cria motorista e usuário DRIVER, com a senha em bcrypt", async () => {
      const res = await motoristas.POST(req("POST", corpoMotorista({ email: ` ${email("motorista").toUpperCase()} ` })));
      expect(res.status).toBe(201);
      const corpo = await res.json();
      motoristaId = corpo.id;
      expect(temChaveDeSenha(corpo)).toBe(false);
      expect(JSON.stringify(corpo)).not.toContain(SENHA);
      expect(corpo.user).toMatchObject({ name: "Motorista de Teste", email: email("motorista") });

      const gravado = await prisma.driver.findUniqueOrThrow({ where: { id: motoristaId }, include: { user: true } });
      expect(gravado).toMatchObject({ cpf: CPF_TESTE, cnh: "12345678900", category: "D", active: true });
      expect(gravado.cnhExpiry.toISOString().slice(0, 10)).toBe("2031-06-30");
      expect(gravado.user).toMatchObject({ role: "DRIVER", email: email("motorista") });
      expect(gravado.user.password).not.toBe(SENHA);
      expect(await bcrypt.compare(SENHA, gravado.user.password)).toBe(true);
    });

    it("CPF repetido → 409 e não sobra usuário órfão", async () => {
      const tentado = email("orfao");
      const res = await motoristas.POST(req("POST", corpoMotorista({ cpf: CPF_TESTE, email: tentado })));
      expect(res.status).toBe(409);
      expect((await res.json()).error).toMatch(/CPF/);
      expect(await prisma.user.count({ where: { email: tentado } })).toBe(0);
      expect(await prisma.driver.count({ where: { cpf: CPF_TESTE } })).toBe(1);
    });

    it("e-mail repetido, mesmo com outra caixa → 409", async () => {
      const res = await motoristas.POST(
        req("POST", corpoMotorista({ cpf: CPF_OUTRO, email: email("motorista").toUpperCase() })),
      );
      expect(res.status).toBe(409);
      expect((await res.json()).error).toMatch(/e-mail/);
      expect(await prisma.driver.count({ where: { cpf: CPF_OUTRO } })).toBe(0);
    });

    it("dados inválidos → 400", async () => {
      const base = corpoMotorista({ cpf: CPF_OUTRO, email: email("invalido") });
      const casos: [string, Record<string, unknown>][] = [
        ["senha curta", { ...base, password: "1234567" }],
        ["senha longa demais", { ...base, password: "x".repeat(73) }],
        ["sem senha", { ...base, password: undefined }],
        ["sem e-mail", { ...base, email: undefined }],
        ["CPF com 10 dígitos", { ...base, cpf: "1234567890" }],
        ["categoria fora da lista", { ...base, category: "Z" }],
        ["validade que não é data", { ...base, cnhExpiry: "amanhã" }],
        ["sem validade", { ...base, cnhExpiry: undefined }],
        ["sem CNH", { ...base, cnh: "" }],
      ];
      for (const [nome, corpo] of casos) {
        const res = await motoristas.POST(req("POST", corpo));
        expect(res.status, nome).toBe(400);
      }
      expect(await prisma.driver.count({ where: { cpf: CPF_OUTRO } })).toBe(0);
      expect(await prisma.user.count({ where: { email: email("invalido") } })).toBe(0);
    });

    it("GET não contém a chave password em nenhum nível", async () => {
      const res = await motoristas.GET();
      expect(res.status).toBe(200);
      const corpo = await res.json();
      const texto = JSON.stringify(corpo);

      // O motorista do teste está na resposta: sem isto o teste passaria vazio.
      expect(texto).toContain(email("motorista"));
      expect(texto).not.toContain('"password"');
      expect(temChaveDeSenha(corpo)).toBe(false);
    });

    it("PATCH altera os dados e, com senha nova, troca o hash", async () => {
      const antes = await prisma.driver.findUniqueOrThrow({ where: { id: motoristaId }, include: { user: true } });

      const res = await motorista.PATCH(
        req("PATCH", {
          name: "Motorista Renomeado",
          phone: "",
          category: "E",
          cnhExpiry: "2020-01-15",
          password: "outra-senha-456",
          cpf: CPF_OUTRO,
        }),
        ctx(motoristaId),
      );
      expect(res.status).toBe(200);
      const corpo = await res.json();
      expect(temChaveDeSenha(corpo)).toBe(false);
      expect(corpo.user.name).toBe("Motorista Renomeado");

      const depois = await prisma.driver.findUniqueOrThrow({ where: { id: motoristaId }, include: { user: true } });
      // CPF não é editável: o campo é ignorado.
      expect(depois).toMatchObject({ cpf: CPF_TESTE, phone: null, category: "E" });
      expect(depois.cnhExpiry.toISOString().slice(0, 10)).toBe("2020-01-15");
      expect(depois.user.password).not.toBe(antes.user.password);
      expect(await bcrypt.compare("outra-senha-456", depois.user.password)).toBe(true);
      expect(await bcrypt.compare(SENHA, depois.user.password)).toBe(false);
    });

    it("PATCH sem senha mantém o hash; active: false grava", async () => {
      const antes = await prisma.driver.findUniqueOrThrow({ where: { id: motoristaId }, include: { user: true } });

      const res = await motorista.PATCH(req("PATCH", { active: false }), ctx(motoristaId));
      expect(res.status).toBe(200);
      expect((await res.json()).active).toBe(false);

      const depois = await prisma.driver.findUniqueOrThrow({ where: { id: motoristaId }, include: { user: true } });
      expect(depois.active).toBe(false);
      expect(depois.user.password).toBe(antes.user.password);
    });

    it("PATCH: id inexistente → 404, e-mail de outro usuário → 409 sem gravar o resto, inválido → 400", async () => {
      expect((await motorista.PATCH(req("PATCH", { active: true }), ctx(SEM_ID))).status).toBe(404);

      // O e-mail do operador já existe: nada do pedido pode ficar gravado.
      const repetido = await motorista.PATCH(
        req("PATCH", { email: email("operacao").toUpperCase(), cnh: "00000000000" }),
        ctx(motoristaId),
      );
      expect(repetido.status).toBe(409);
      const gravado = await prisma.driver.findUniqueOrThrow({ where: { id: motoristaId }, include: { user: true } });
      expect(gravado.cnh).toBe("12345678900");
      expect(gravado.user.email).toBe(email("motorista"));

      expect((await motorista.PATCH(req("PATCH", {}), ctx(motoristaId))).status).toBe(400);
      expect((await motorista.PATCH(req("PATCH", { password: "curta" }), ctx(motoristaId))).status).toBe(400);
      // Só campo não editável é o mesmo que não mandar nada.
      expect((await motorista.PATCH(req("PATCH", { cpf: CPF_OUTRO }), ctx(motoristaId))).status).toBe(400);

      // Regravar o próprio e-mail não é duplicado.
      const proprio = await motorista.PATCH(req("PATCH", { email: email("motorista"), active: true }), ctx(motoristaId));
      expect(proprio.status).toBe(200);
    });
  });

  describe("veículos", () => {
    let veiculoId: string;
    let motoristaId: string;

    beforeAll(async () => {
      motoristaId = (await prisma.driver.findUniqueOrThrow({ where: { cpf: CPF_TESTE } })).id;
    });

    it("cria com a placa digitada e guarda normalizada, com os nomes que a tela manda", async () => {
      const res = await veiculos.POST(
        req("POST", {
          plate: PLACA_DIGITADA,
          model: "Accelo 1016",
          type: "TOCO",
          capacityKg: "5000",
          maxWeight: "",
          year: "2022",
          defaultDriverId: motoristaId,
        }),
      );
      expect(res.status).toBe(201);
      const corpo = await res.json();
      veiculoId = corpo.id;
      expect(temChaveDeSenha(corpo)).toBe(false);

      const gravado = await prisma.vehicle.findUniqueOrThrow({ where: { id: veiculoId } });
      expect(gravado).toMatchObject({
        plate: PLACA_TESTE,
        model: "Accelo 1016",
        type: "TOCO",
        capacity: 5000,
        maxWeight: null,
        year: 2022,
        driverId: motoristaId,
        status: "AVAILABLE",
      });
    });

    it("a mesma placa, em qualquer formato → 409", async () => {
      for (const plate of [PLACA_TESTE, PLACA_DIGITADA, "ABC 1D23"]) {
        const res = await veiculos.POST(req("POST", { plate, model: "Outro", type: "VAN" }));
        expect(res.status, plate).toBe(409);
      }
      expect(await prisma.vehicle.count({ where: { plate: PLACA_TESTE } })).toBe(1);
    });

    it("dados inválidos → 400", async () => {
      const base = { plate: "TCD0A01", model: "Modelo", type: "VAN" };
      const casos: [string, Record<string, unknown>][] = [
        ["motorista inexistente", { ...base, defaultDriverId: SEM_ID }],
        ["placa fora do padrão", { ...base, plate: "AB-12345" }],
        ["sem modelo", { ...base, model: " " }],
        ["sem tipo", { ...base, type: undefined }],
        ["capacidade negativa", { ...base, capacityKg: -1 }],
        ["peso máximo que não é número", { ...base, maxWeight: "pesado" }],
        ["ano antigo demais", { ...base, year: 1949 }],
        ["ano depois do ano que vem", { ...base, year: new Date().getFullYear() + 2 }],
        ["ano quebrado", { ...base, year: 2020.5 }],
      ];
      for (const [nome, corpo] of casos) {
        const res = await veiculos.POST(req("POST", corpo));
        expect(res.status, nome).toBe(400);
      }
      expect(await prisma.vehicle.count({ where: { plate: "TCD0A01" } })).toBe(0);
    });

    it("PATCH troca o status e os dados; a placa não muda", async () => {
      const res = await veiculo.PATCH(
        req("PATCH", { status: "MAINTENANCE", maxWeight: 8000, year: "", plate: "ZZZ9Z99" }),
        ctx(veiculoId),
      );
      expect(res.status).toBe(200);
      expect(temChaveDeSenha(await res.json())).toBe(false);

      const gravado = await prisma.vehicle.findUniqueOrThrow({ where: { id: veiculoId } });
      expect(gravado).toMatchObject({
        plate: PLACA_TESTE,
        status: "MAINTENANCE",
        maxWeight: 8000,
        year: null,
        capacity: 5000,
        driverId: motoristaId,
      });
    });

    it("PATCH: status fora da lista → 400, motorista inexistente → 400, id inexistente → 404", async () => {
      expect((await veiculo.PATCH(req("PATCH", { status: "VENDIDO" }), ctx(veiculoId))).status).toBe(400);
      expect((await veiculo.PATCH(req("PATCH", { defaultDriverId: SEM_ID }), ctx(veiculoId))).status).toBe(400);
      expect((await veiculo.PATCH(req("PATCH", {}), ctx(veiculoId))).status).toBe(400);
      expect((await veiculo.PATCH(req("PATCH", { status: "AVAILABLE" }), ctx(SEM_ID))).status).toBe(404);

      const gravado = await prisma.vehicle.findUniqueOrThrow({ where: { id: veiculoId } });
      expect(gravado).toMatchObject({ status: "MAINTENANCE", driverId: motoristaId });
    });

    it("GET traz o motorista do veículo sem a chave password", async () => {
      const res = await veiculos.GET();
      expect(res.status).toBe(200);
      const corpo = (await res.json()) as { id: string; driver: { user: { name: string } } | null }[];
      const texto = JSON.stringify(corpo);

      expect(corpo.find((item) => item.id === veiculoId)?.driver?.user.name).toBe("Motorista Renomeado");
      expect(texto).not.toContain('"password"');
      expect(temChaveDeSenha(corpo)).toBe(false);
    });

    it("PATCH com defaultDriverId null desvincula o motorista", async () => {
      const res = await veiculo.PATCH(req("PATCH", { defaultDriverId: null }), ctx(veiculoId));
      expect(res.status).toBe(200);
      expect((await res.json()).driver).toBeNull();

      const gravado = await prisma.vehicle.findUniqueOrThrow({ where: { id: veiculoId } });
      expect(gravado.driverId).toBeNull();
    });
  });
});
