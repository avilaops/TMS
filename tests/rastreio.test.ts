import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * Rastreio publico contra um Postgres de verdade.
 *
 * Mudanca de autorizacao nao se prova com typecheck: o que importa aqui e o que
 * o banco devolve e o que a resposta HTTP carrega. Os testes chamam o handler
 * exportado pela rota, o mesmo que o Next executa em producao.
 *
 * Sem DATABASE_URL a suite e pulada com aviso — no CI ela sempre roda, contra o
 * servico `postgres` do workflow.
 */
const temBanco = Boolean(process.env.DATABASE_URL);

if (!temBanco) {
  console.warn(
    "\n[rastreio.test] DATABASE_URL ausente: testes de integração PULADOS.\n" +
      "Rode com um Postgres real para exercitá-los.\n",
  );
}

const suite = temBanco ? describe : describe.skip;

suite("GET /api/rastreio", () => {
  let prisma: typeof import("../src/lib/prisma").default;
  let GET: typeof import("../src/app/api/rastreio/route").GET;
  let resetRateLimit: typeof import("../src/lib/rate-limit").resetRateLimit;

  const CNPJ_A = "11222333000181";
  const CNPJ_B = "44555666000172";
  const CODIGO_A = "9184726350";
  const CODIGO_ZEROS = "0000000123";
  const CODIGO_B = "5544332211";

  async function consultar(params: Record<string, string>) {
    const query = new URLSearchParams(params);
    const response = await GET(new Request(`http://localhost/api/rastreio?${query}`));
    return { status: response.status, body: await response.json() };
  }

  beforeAll(async () => {
    prisma = (await import("../src/lib/prisma")).default;
    GET = (await import("../src/app/api/rastreio/route")).GET;
    resetRateLimit = (await import("../src/lib/rate-limit")).resetRateLimit;

    // Ordem importa: Collection referencia Manifest, Driver e Client.
    await prisma.collection.deleteMany({});
    await prisma.manifest.deleteMany({});
    await prisma.vehicle.deleteMany({});
    await prisma.driver.deleteMany({});
    await prisma.client.deleteMany({});
    await prisma.user.deleteMany({});

    const clienteA = await prisma.client.create({
      data: {
        companyName: "Cliente A LTDA",
        cnpj: CNPJ_A,
        email: "financeiro@clientea.exemplo.br",
        phone: "(17) 3222-1010",
        address: "Rua A, 100",
        paymentCondition: "28 dias faturado",
        creditLimit: 85000,
      },
    });

    const clienteB = await prisma.client.create({
      data: { companyName: "Cliente B LTDA", cnpj: CNPJ_B, creditLimit: 12000 },
    });

    const usuario = await prisma.user.create({
      data: {
        name: "Carlos Ferreira",
        email: "carlos@exemplo.br",
        password: "$2b$10$hashfalsoparateste000000000000000000000000000000000",
        role: "DRIVER",
      },
    });

    const motorista = await prisma.driver.create({
      data: {
        userId: usuario.id,
        cpf: "39812345678",
        cnh: "04455566677",
        cnhExpiry: new Date("2029-04-01"),
        category: "D",
      },
    });

    const veiculo = await prisma.vehicle.create({
      data: { plate: "FKZ2C34", model: "VUC", type: "VUC", driverId: motorista.id },
    });

    const manifesto = await prisma.manifest.create({
      data: { driverId: motorista.id, vehicleId: veiculo.id, status: "ROUTE" },
    });

    await prisma.collection.create({
      data: {
        clientId: clienteA.id,
        sender: "Cliente A",
        receiver: "Destino A",
        origin: "São José do Rio Preto/SP",
        destination: "Catanduva/SP",
        volumes: 12,
        weight: 340.5,
        invoiceKey: "35260612345678000199550010000012341000012345",
        invoiceValue: 47890.25,
        manifestId: manifesto.id,
        driverId: motorista.id,
        status: "ROUTE",
        trackingCode: CODIGO_A,
      },
    });

    await prisma.collection.create({
      data: {
        clientId: clienteA.id,
        sender: "Cliente A",
        receiver: "Outro destino",
        origin: "Mirassol/SP",
        destination: "Bady Bassitt/SP",
        volumes: 2,
        weight: 15,
        status: "PENDING",
        trackingCode: CODIGO_ZEROS,
      },
    });

    await prisma.collection.create({
      data: {
        clientId: clienteB.id,
        sender: "Cliente B",
        receiver: "Destino B",
        origin: "Barretos/SP",
        destination: "Bebedouro/SP",
        volumes: 1,
        weight: 8,
        status: "PENDING",
        trackingCode: CODIGO_B,
      },
    });
  });

  beforeEach(() => resetRateLimit());

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe("deve funcionar", () => {
    it("CNPJ correto + código correto devolve a carga", async () => {
      const { status, body } = await consultar({ cnpj: CNPJ_A, codigo: CODIGO_A });
      expect(status).toBe(200);
      expect(body).toHaveLength(1);
      expect(body[0].trackingCode).toBe(CODIGO_A);
      expect(body[0].origin).toBe("São José do Rio Preto/SP");
      expect(body[0].manifest.driver.user.name).toBe("Carlos Ferreira");
    });

    it("CNPJ formatado continua funcionando", async () => {
      const { status, body } = await consultar({ cnpj: "11.222.333/0001-81", codigo: CODIGO_A });
      expect(status).toBe(200);
      expect(body).toHaveLength(1);
    });

    it("código com separadores continua funcionando", async () => {
      const { body } = await consultar({ cnpj: CNPJ_A, codigo: "9184-726.350" });
      expect(body).toHaveLength(1);
    });

    it("código com zeros à esquerda funciona", async () => {
      const { status, body } = await consultar({ cnpj: CNPJ_A, codigo: CODIGO_ZEROS });
      expect(status).toBe(200);
      expect(body).toHaveLength(1);
      expect(body[0].trackingCode).toBe(CODIGO_ZEROS);
    });
  });

  describe("deve negar sem revelar o motivo", () => {
    it("todas as negativas são idênticas entre si", async () => {
      const casos = {
        "cnpj certo + código errado": { cnpj: CNPJ_A, codigo: "0000000000" },
        "cnpj errado + código certo": { cnpj: "99888777000166", codigo: CODIGO_A },
        "ambos errados": { cnpj: "99888777000166", codigo: "0000000000" },
        "código de outro cliente": { cnpj: CNPJ_A, codigo: CODIGO_B },
        "cnpj inexistente, código inexistente": { cnpj: "00000000000191", codigo: "1111111111" },
        "código mal formatado": { cnpj: CNPJ_A, codigo: "123" },
        "cnpj mal formatado": { cnpj: "123", codigo: CODIGO_A },
      };

      const respostas = new Map<string, string>();
      for (const [nome, params] of Object.entries(casos)) {
        resetRateLimit();
        const { status, body } = await consultar(params);
        respostas.set(nome, JSON.stringify({ status, body }));
      }

      const distintas = new Set(respostas.values());
      expect(
        distintas.size,
        `respostas negativas divergiram: ${JSON.stringify([...respostas], null, 2)}`,
      ).toBe(1);
      expect([...distintas][0]).toBe(JSON.stringify({ status: 200, body: [] }));
    });

    it("o código de outro cliente não vaza a carga dele", async () => {
      const { body } = await consultar({ cnpj: CNPJ_A, codigo: CODIGO_B });
      expect(body).toEqual([]);
    });

    it("somente CNPJ não localiza carga nenhuma", async () => {
      const { status, body } = await consultar({ cnpj: CNPJ_A });
      expect(status).toBe(400);
      expect(JSON.stringify(body)).not.toContain("Catanduva");
    });

    it("somente código não localiza carga nenhuma", async () => {
      const { status, body } = await consultar({ codigo: CODIGO_A });
      expect(status).toBe(400);
      expect(JSON.stringify(body)).not.toContain("Catanduva");
    });

    it("faltar parâmetro responde igual, seja qual for o que falta", async () => {
      const so_cnpj = await consultar({ cnpj: CNPJ_A });
      const so_codigo = await consultar({ codigo: CODIGO_A });
      const nenhum = await consultar({});
      expect(JSON.stringify(so_cnpj)).toBe(JSON.stringify(so_codigo));
      expect(JSON.stringify(so_cnpj)).toBe(JSON.stringify(nenhum));
    });
  });

  describe("regressão de segurança", () => {
    const PROIBIDOS = [
      "password",
      "creditLimit",
      "paymentCondition",
      "invoiceValue",
      "invoiceKey",
      "cteKey",
      "cpf",
      "cnh",
      "cnhExpiry",
      "clientId",
      "driverId",
      "manifestId",
      "email",
      "phone",
      "address",
      "companyName",
      "sender",
      "receiver",
      "receiverName",
      "updatedAt",
    ];

    it("a resposta pública não carrega nenhum campo interno", async () => {
      const { body } = await consultar({ cnpj: CNPJ_A, codigo: CODIGO_A });
      const serializada = JSON.stringify(body);
      for (const campo of PROIBIDOS) {
        expect(serializada, `campo proibido "${campo}" presente na resposta`).not.toContain(campo);
      }
      expect(serializada).not.toContain("$2b$");
      expect(serializada).not.toContain("85000");
      expect(serializada).not.toContain("47890");
    });

    it("o DTO público tem exatamente as chaves previstas", async () => {
      const { body } = await consultar({ cnpj: CNPJ_A, codigo: CODIGO_A });
      expect(Object.keys(body[0]).sort()).toEqual(
        ["createdAt", "destination", "id", "manifest", "origin", "status", "trackingCode"].sort(),
      );
      expect(Object.keys(body[0].manifest)).toEqual(["driver"]);
      expect(Object.keys(body[0].manifest.driver)).toEqual(["user"]);
      expect(Object.keys(body[0].manifest.driver.user)).toEqual(["name"]);
    });
  });

  describe("limite de tentativas", () => {
    it("corta a repetição do mesmo par e devolve Retry-After", async () => {
      resetRateLimit();
      let ultimo = 200;
      for (let i = 0; i < 20; i += 1) {
        const query = new URLSearchParams({ cnpj: CNPJ_A, codigo: "0000000000" });
        const res = await GET(new Request(`http://localhost/api/rastreio?${query}`));
        ultimo = res.status;
        if (res.status === 429) {
          expect(res.headers.get("Retry-After")).toBeTruthy();
          break;
        }
      }
      expect(ultimo).toBe(429);
    });

    it("não bloqueia quem consulta pouco", async () => {
      resetRateLimit();
      const { status } = await consultar({ cnpj: CNPJ_A, codigo: CODIGO_A });
      expect(status).toBe(200);
    });
  });
});
