import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  cotacaoLojasSchema,
  hashCanonico,
  resumirCarga,
} from "../src/lib/lojas-logistica";
import {
  chaveLojasConfere,
  gerarChaveLojas,
  hashChaveLojas,
} from "../src/lib/lojas-logistica-auth";
import {
  ConflitoDeIdempotencia,
  executarIdempotente,
  type ArmazenamentoIdempotente,
} from "../src/lib/lojas-logistica-db";

const raiz = join(import.meta.dirname, "..");
const schema = readFileSync(join(raiz, "prisma/schema.prisma"), "utf8");
const rls = readFileSync(join(raiz, "prisma/sql/010-rls.sql"), "utf8");
const migracao = readFileSync(join(raiz, "prisma/sql/040-lojas-logistica.sql"), "utf8");

describe("persistencia da integracao Lojas", () => {
  it.each([
    "LojasIntegrationCredential",
    "LogisticsOrder",
    "LogisticsShipment",
    "IntegrationRequest",
  ])("declara o modelo multi-tenant %s", (modelo) => {
    expect(schema).toContain(`model ${modelo} {`);
    expect(schema).toMatch(
      new RegExp(`model ${modelo} \\{[\\s\\S]*?tenantId\\s+String[\\s\\S]*?tenant\\s+Tenant`),
    );
  });

  it("protege todas as referencias entre tenants", () => {
    expect(rls).toContain(
      '"LogisticsOrder": ["clientId", "Client", "reverseOfId", "LogisticsOrder"]',
    );
    expect(rls).toContain(
      '"LogisticsShipment": ["orderId", "LogisticsOrder", "collectionId", "Collection"]',
    );
    expect(rls).toContain(
      '"IntegrationRequest": ["credentialId", "LojasIntegrationCredential"]',
    );
  });

  it("define unicidade por tenant e constraints de dominio no banco", () => {
    expect(migracao).toContain('UNIQUE ("tenantId", "externalId")');
    expect(migracao).toContain('UNIQUE ("tenantId", "idempotencyKey")');
    expect(migracao).toContain("lojas_logistics_mode_check");
    expect(migracao).toContain("lojas_logistics_order_state_check");
    expect(migracao).toContain("lojas_integration_request_status_check");
  });
});

const pedidoValido = {
  externalId: "pedido-123",
  modalidade: "CIF",
  cliente: { documento: "12.345.678/0001-90", nome: "Loja" },
  destino: { cidade: "São José do Rio Preto", uf: "SP", cep: "15000000" },
  origens: [
    {
      id: "cd-1",
      nome: "Centro 1",
      cidade: "Campinas",
      uf: "SP",
      volumes: [
        { quantidade: 2, pesoKg: 10, comprimentoCm: 100, larguraCm: 50, alturaCm: 40, pallet: false },
      ],
    },
  ],
};

describe("contrato da integração Lojas", () => {
  it.each(["CIF", "FOB", "PICKUP", "OWN_CARRIER"])("aceita a modalidade %s", (modalidade) => {
    expect(cotacaoLojasSchema.parse({ ...pedidoValido, modalidade }).modalidade).toBe(modalidade);
  });

  it("normaliza documento e calcula peso, quantidade, cubagem e pallets", () => {
    const pedido = cotacaoLojasSchema.parse(pedidoValido);
    expect(pedido.cliente.documento).toBe("12345678000190");
    expect(resumirCarga(pedido)).toEqual({ volumes: 2, pesoKg: 20, cubagemM3: 0.4, pallets: 0 });
  });

  it("recusa medidas, peso e coleções fora dos limites", () => {
    const semOrigens = { ...pedidoValido, origens: [] };
    const medidaZero = structuredClone(pedidoValido);
    medidaZero.origens[0].volumes[0].alturaCm = 0;
    expect(cotacaoLojasSchema.safeParse(semOrigens).success).toBe(false);
    expect(cotacaoLojasSchema.safeParse(medidaZero).success).toBe(false);
  });

  it("gera chave forte e compara somente por hash em tempo constante", () => {
    const chave = gerarChaveLojas();
    const hash = hashChaveLojas(chave);
    expect(chave).toMatch(/^lojas_[A-Za-z0-9_-]{43}$/);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(chaveLojasConfere(chave, hash)).toBe(true);
    expect(chaveLojasConfere(`${chave}x`, hash)).toBe(false);
  });

  it("produz o mesmo hash para objetos semanticamente iguais", () => {
    expect(hashCanonico({ b: 2, a: { d: 4, c: 3 } })).toBe(hashCanonico({ a: { c: 3, d: 4 }, b: 2 }));
  });
});

describe("idempotência", () => {
  function memoria(): ArmazenamentoIdempotente {
    const itens = new Map<string, { hash: string; status: "PROCESSING" | "COMPLETED"; response?: { status: number; body: unknown } }>();
    return {
      async obter(chave) {
        return itens.get(chave) ?? null;
      },
      async iniciar(chave, hash) {
        if (itens.has(chave)) return false;
        itens.set(chave, { hash, status: "PROCESSING" });
        return true;
      },
      async concluir(chave, response) {
        const atual = itens.get(chave)!;
        itens.set(chave, { ...atual, status: "COMPLETED", response });
      },
      async falhar(chave) {
        itens.delete(chave);
      },
    };
  }

  it("reapresenta a resposta anterior e não repete o efeito", async () => {
    const armazenamento = memoria();
    let execucoes = 0;
    const executar = () => executarIdempotente(armazenamento, "chave-123", { a: 1 }, async () => ({ status: 201, body: { numero: ++execucoes } }));
    expect(await executar()).toEqual({ status: 201, body: { numero: 1 }, replay: false });
    expect(await executar()).toEqual({ status: 201, body: { numero: 1 }, replay: true });
    expect(execucoes).toBe(1);
  });

  it("recusa a mesma chave com outro corpo", async () => {
    const armazenamento = memoria();
    await executarIdempotente(armazenamento, "chave-123", { a: 1 }, async () => ({ status: 201, body: {} }));
    await expect(executarIdempotente(armazenamento, "chave-123", { a: 2 }, async () => ({ status: 201, body: {} }))).rejects.toBeInstanceOf(ConflitoDeIdempotencia);
  });

  it("libera nova tentativa depois de falha transitória", async () => {
    const armazenamento = memoria();
    await expect(executarIdempotente(armazenamento, "chave-123", { a: 1 }, async () => { throw new Error("fora do ar"); })).rejects.toThrow("fora do ar");
    await expect(executarIdempotente(armazenamento, "chave-123", { a: 1 }, async () => ({ status: 200, body: { ok: true } }))).resolves.toMatchObject({ replay: false });
  });
});

const temBanco = Boolean(process.env.DATABASE_URL);
const suiteBanco = temBanco ? describe : describe.skip;

suiteBanco("persistência Lojas em PostgreSQL com RLS", () => {
  const tenants = [
    { id: "33333333-3333-4333-8333-333333333333", slug: "lojas-logistica-a", name: "Logística A" },
    { id: "44444444-4444-4444-8444-444444444444", slug: "lojas-logistica-b", name: "Logística B" },
  ];
  let banco: typeof import("../src/lib/prisma");

  beforeAll(async () => {
    banco = await import("../src/lib/prisma");
    for (const tenant of tenants) await banco.sistema.tenant.upsert({ where: { id: tenant.id }, create: tenant, update: { active: true } });
  });

  afterAll(async () => {
    await banco.sistema.integrationRequest.deleteMany({ where: { tenantId: { in: tenants.map((item) => item.id) } } });
    await banco.sistema.logisticsShipment.deleteMany({ where: { tenantId: { in: tenants.map((item) => item.id) } } });
    await banco.sistema.logisticsOrder.deleteMany({ where: { tenantId: { in: tenants.map((item) => item.id) } } });
    await banco.sistema.lojasIntegrationCredential.deleteMany({ where: { tenantId: { in: tenants.map((item) => item.id) } } });
    await banco.sistema.tenant.deleteMany({ where: { id: { in: tenants.map((item) => item.id) } } });
    await banco.sistema.$disconnect();
  });

  it("permite o mesmo externalId em tenants diferentes e não deixa um enxergar o outro", async () => {
    for (const tenant of tenants) {
      await banco.paraEmpresa(tenant.id).db.logisticsOrder.create({ data: { externalId: "pedido-igual", mode: "PICKUP", payload: {} } });
    }
    expect(await banco.paraEmpresa(tenants[0].id).db.logisticsOrder.count()).toBe(1);
    expect(await banco.paraEmpresa(tenants[1].id).db.logisticsOrder.count()).toBe(1);
  });

  it("bloqueia vínculo de reversa com ordem de outro tenant", async () => {
    const outra = await banco.paraEmpresa(tenants[1].id).db.logisticsOrder.findFirstOrThrow();
    await expect(banco.paraEmpresa(tenants[0].id).db.logisticsOrder.create({ data: { externalId: "reversa-cruzada", mode: "CIF", direction: "REVERSE", reverseOfId: outra.id, payload: {} } })).rejects.toThrow(/outra empresa/);
  });

  it("aplica constraints de modalidade e estado no banco", async () => {
    await expect(banco.paraEmpresa(tenants[0].id).db.logisticsOrder.create({ data: { externalId: "modo-invalido", mode: "TELEPORTE", payload: {} } })).rejects.toThrow();
  });
});
