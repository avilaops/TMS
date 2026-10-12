import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getServerSession } from "next-auth";
import { createVehicleSchema, updateVehicleSchema } from "../src/lib/cadastros";
import { releaseSchema } from "../src/lib/manifestos";
import { CONFIRMACAO_DE_EXCESSO, SEM_CAPACIDADE, type Ocupacao, avisoDeExcesso, capacidadeDoVeiculo, confirmarSaidaComExcesso, linhaDaOcupacao, ocupacaoDaViagem } from "../src/lib/ocupacao";
import { EMPRESA_OUTRA } from "./empresas-de-teste";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

/** A ocupação do veículo, sem banco: cargas e capacidade na mão. */
describe("ocupação do veículo", () => {
  const VEICULO = { capacity: 3000, cubicCapacity: 20 };
  const carga = (weight: number | null, cubicMeters: number | null = null) => ({ weight, cubicMeters });

  it("soma peso e cubagem das cargas contra a capacidade, com o percentual inteiro", () => {
    const ocupacao = ocupacaoDaViagem([carga(1000, 5), carga(250, 3.2)], VEICULO);
    expect(ocupacao.peso).toEqual({ total: 1250, capacidade: 3000, percentual: 42, excesso: false, acima: 0, semMedida: 0 });
    expect(ocupacao.cubagem).toEqual({ total: 8.2, capacidade: 20, percentual: 41, excesso: false, acima: 0, semMedida: 0 });
    expect(ocupacao).toMatchObject({ excesso: false, semCapacidade: false });
    expect(linhaDaOcupacao(ocupacao)).toBe("Peso 1.250 de 3.000 kg (42%) · Cubagem 8,2 de 20 m³ (41%)");
    expect(avisoDeExcesso(ocupacao)).toBeNull();
  });

  it("exatamente 100% cabe; qualquer coisa acima é excesso", () => {
    const cheio = ocupacaoDaViagem([carga(3000, 20)], VEICULO);
    expect(cheio.peso).toMatchObject({ percentual: 100, excesso: false, acima: 0 });
    expect(cheio.cubagem).toMatchObject({ percentual: 100, excesso: false });
    expect(cheio.excesso).toBe(false);

    const umQuiloAMais = ocupacaoDaViagem([carga(3001, 20)], VEICULO);
    expect(umQuiloAMais.peso).toMatchObject({ excesso: true, acima: 1 });
    expect(umQuiloAMais.excesso).toBe(true);
    // Excesso pequeno nunca aparece como "100%": o percentual sobe para o inteiro seguinte.
    expect(umQuiloAMais.peso.percentual).toBe(101);
    expect(ocupacaoDaViagem([carga(3000, 20.01)], VEICULO).cubagem).toMatchObject({ excesso: true, percentual: 101, acima: 0.01 });
  });

  it("o excesso em qualquer das duas medidas vale, e o aviso traz os números", () => {
    const peso = ocupacaoDaViagem([carga(2000, 4), carga(1600, 4)], VEICULO);
    expect(peso).toMatchObject({ excesso: true, peso: { total: 3600, percentual: 120, acima: 600 }, cubagem: { excesso: false } });
    expect(avisoDeExcesso(peso)).toBe("Excesso de peso: 3.600 de 3.000 kg (120%), 600 kg acima.");
    expect(confirmarSaidaComExcesso(peso)).toMatch(/^Excesso de peso: 3\.600 de 3\.000 kg \(120%\), 600 kg acima\. .*sair com excesso de peso\.$/);

    const cubagem = ocupacaoDaViagem([carga(100, 12.5), carga(100, 12.5)], VEICULO);
    expect(cubagem).toMatchObject({ excesso: true, peso: { excesso: false }, cubagem: { total: 25, percentual: 125, acima: 5 } });
    expect(avisoDeExcesso(cubagem)).toBe("Excesso de cubagem: 25 de 20 m³ (125%), 5 m³ acima.");

    const osDois = ocupacaoDaViagem([carga(4000, 30)], VEICULO);
    expect(avisoDeExcesso(osDois)).toBe("Excesso de peso: 4.000 de 3.000 kg (134%), 1.000 kg acima. Excesso de cubagem: 30 de 20 m³ (150%), 10 m³ acima.");
  });

  it("a soma de frações não acusa excesso que não existe", () => {
    // 0,1 + 0,2 dá 0,30000000000000004 em ponto flutuante.
    const pesos = ocupacaoDaViagem([carga(0.1), carga(0.2)], { capacity: 0.3 });
    expect(pesos.peso).toMatchObject({ total: 0.3, excesso: false, percentual: 100 });
    const cubagens = ocupacaoDaViagem([carga(1, 6.7), carga(1, 6.7), carga(1, 6.6)], { cubicCapacity: 20 });
    expect(cubagens.cubagem).toMatchObject({ total: 20, excesso: false, percentual: 100 });
  });

  it("carga sem peso ou sem cubagem não soma, e a conta diz quantas ficaram de fora", () => {
    const ocupacao = ocupacaoDaViagem([carga(1000, 5), carga(0, null), carga(null, 0), { weight: 500 }, {}], VEICULO);
    expect(ocupacao.peso).toMatchObject({ total: 1500, semMedida: 3, excesso: false });
    expect(ocupacao.cubagem).toMatchObject({ total: 5, semMedida: 4, excesso: false });
    expect(ocupacaoDaViagem([], VEICULO)).toMatchObject({ excesso: false, peso: { total: 0, percentual: 0 }, cubagem: { total: 0, percentual: 0 } });
  });

  it("veículo sem capacidade cadastrada: nenhum aviso de excesso, e a linha discreta", () => {
    for (const veiculo of [{}, { capacity: null, cubicCapacity: null }, { capacity: 0, cubicCapacity: 0 }, null, undefined]) {
      const ocupacao = ocupacaoDaViagem([carga(99_999, 999)], veiculo);
      expect(ocupacao, JSON.stringify(veiculo)).toMatchObject({ excesso: false, semCapacidade: true, peso: { capacidade: null, percentual: null }, cubagem: { capacidade: null, percentual: null } });
      expect(linhaDaOcupacao(ocupacao)).toBe(SEM_CAPACIDADE);
      expect(avisoDeExcesso(ocupacao)).toBeNull();
    }
  });

  it("com uma capacidade só, a outra medida fica fora da linha e não acusa excesso", () => {
    const soPeso = ocupacaoDaViagem([carga(1500, 999)], { capacity: 3000, cubicCapacity: null });
    expect(soPeso).toMatchObject({ excesso: false, semCapacidade: false });
    expect(linhaDaOcupacao(soPeso)).toBe("Peso 1.500 de 3.000 kg (50%)");
    const soCubagem = ocupacaoDaViagem([carga(99_999, 30)], { cubicCapacity: 20 });
    expect(soCubagem.excesso).toBe(true);
    expect(linhaDaOcupacao(soCubagem)).toBe("Cubagem 30 de 20 m³ (150%)");
  });

  it("a capacidade ao lado da placa, na lista de veículos do formulário", () => {
    expect(capacidadeDoVeiculo(VEICULO)).toBe("3.000 kg · 20 m³");
    expect(capacidadeDoVeiculo({ capacity: 1500.5, cubicCapacity: null })).toBe("1.500,5 kg");
    expect(capacidadeDoVeiculo({ capacity: 0, cubicCapacity: 12.5 })).toBe("12,5 m³");
    expect(capacidadeDoVeiculo({})).toBe("");
  });

  it("validação: a cubagem útil do veículo e a confirmação da saída", () => {
    const veiculo = { plate: "ABC1D23", model: "Accelo", type: "TRUCK" };
    expect(createVehicleSchema.parse({ ...veiculo, cubicCapacity: "20,5" })).toMatchObject({ cubicCapacity: 20.5 });
    expect(createVehicleSchema.parse({ ...veiculo, cubicCapacity: "" })).toMatchObject({ cubicCapacity: null });
    expect(updateVehicleSchema.parse({ cubicCapacity: null })).toEqual({ cubicCapacity: null });
    for (const cubicCapacity of [-1, "abc", 1001]) {
      const recusa = updateVehicleSchema.safeParse({ cubicCapacity });
      expect(recusa.success, String(cubicCapacity)).toBe(false);
      if (!recusa.success) expect(recusa.error.issues[0].message).toBe("A cubagem útil precisa ser um número de 0 a 1000 m³.");
    }

    expect(CONFIRMACAO_DE_EXCESSO).toBe("sairComExcesso");
    expect(releaseSchema.parse({})).toEqual({});
    expect(releaseSchema.parse({ sairComExcesso: true })).toEqual({ sairComExcesso: true });
    for (const corpo of [{ sairComExcesso: "sim" }, { sairComExcesso: 1 }, null, "sim"]) expect(releaseSchema.safeParse(corpo).success, JSON.stringify(corpo)).toBe(false);
  });
});

/** A conferência da capacidade nas rotas da viagem, contra um Postgres de verdade. */
const temBanco = Boolean(process.env.DATABASE_URL);

if (!temBanco) {
  console.warn("\n[ocupacao.test] DATABASE_URL ausente: testes de integração PULADOS.\n");
}

const suite = temBanco ? describe : describe.skip;

// Tudo o que esta suite cria usa estes marcadores, e só isso é apagado.
const PREFIXO = "teste-ocupacao-";
const CNPJ = "99666111000141";
const CNPJ_DA_OUTRA = "99666111000222";
const CPF_MOTORISTA = "33322211101";
const CPF_MOTORISTA_DA_OUTRA = "33322211102";
const PLACA = "OCP1A23";
const PLACA_SEM_CAPACIDADE = "OCP1A24";
const PLACA_DA_OUTRA = "OCP1A25";
const PLACAS = [PLACA, PLACA_SEM_CAPACIDADE, PLACA_DA_OUTRA];
const HASH_FALSO = "$2b$10$hashfalsoparateste000000000000000000000000000000000";

type Corpo = Record<string, unknown> & { id: string; error?: string; aviso?: string | null; confirmar?: string; ocupacao?: Ocupacao | null };
type Perfil = "ADMIN" | "OPERATION" | "FINANCE" | "CLIENT" | "DRIVER";

suite("conferência da capacidade nas rotas da viagem", () => {
  let banco: typeof import("../src/lib/prisma");
  let manifestos: typeof import("../src/app/api/manifestos/route");
  let manifestoRota: typeof import("../src/app/api/manifestos/[id]/route");
  let liberarRota: typeof import("../src/app/api/manifestos/[id]/liberar/route");
  let veiculosRota: typeof import("../src/app/api/veiculos/route");
  let veiculoRota: typeof import("../src/app/api/veiculos/[id]/route");

  const sessao = vi.mocked(getServerSession);
  const ids = {} as Record<Perfil, string>;
  let clienteId: string;
  let motoristaId: string;
  /** O veículo com capacidade: 3.000 kg e 20 m³. */
  let veiculoId: string;
  let veiculoSemCapacidadeId: string;
  const daOutra = { veiculoId: "", motoristaId: "", clienteId: "", viagemId: "" };

  const entrarComo = (perfil: Perfil | null) => sessao.mockResolvedValue(perfil ? { user: { id: ids[perfil], role: perfil, clientId: null } } : null);
  const req = (method = "GET", body?: unknown) =>
    new Request("http://localhost/api/teste", {
      method,
      headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.9" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const nome = (n: string) => `${PREFIXO}${n}`;
  const chamar = async (resposta: Promise<Response>) => {
    const res = await resposta;
    return { status: res.status, corpo: (await res.json()) as Corpo };
  };

  async function limparMovimento() {
    const { sistema } = banco;
    await sistema.collection.deleteMany({ where: { client: { cnpj: { in: [CNPJ, CNPJ_DA_OUTRA] } } } });
    await sistema.manifest.deleteMany({ where: { vehicle: { plate: { in: PLACAS } } } });
    await sistema.auditLog.deleteMany({ where: { userName: { startsWith: PREFIXO } } });
    await sistema.notification.deleteMany({ where: { user: { email: { startsWith: PREFIXO } } } });
  }

  async function limpar() {
    const { sistema } = banco;
    await limparMovimento();
    await sistema.vehicle.deleteMany({ where: { OR: [{ plate: { in: PLACAS } }, { model: { startsWith: PREFIXO } }] } });
    await sistema.driver.deleteMany({ where: { cpf: { in: [CPF_MOTORISTA, CPF_MOTORISTA_DA_OUTRA] } } });
    await sistema.client.deleteMany({ where: { cnpj: { in: [CNPJ, CNPJ_DA_OUTRA] } } });
    await sistema.user.deleteMany({ where: { email: { startsWith: PREFIXO } } });
  }

  /** Carga coletada e livre, pronta para embarcar. */
  async function coletar(weight: number, cubicMeters: number | null = null) {
    const carga = await banco.default.collection.create({
      data: { clientId: clienteId, sender: "Remetente", receiver: nome("destinatário"), origin: "Rio Preto - SP", destination: "Mirassol - SP", volumes: 1, weight, cubicMeters, status: "COLLECTED" },
    });
    return carga.id;
  }

  const montar = (collectionIds: string[], vehicleId = veiculoId, perfil: Perfil = "OPERATION") => {
    entrarComo(perfil);
    return chamar(manifestos.POST(req("POST", { driverId: motoristaId, vehicleId, collectionIds })));
  };
  const alterar = (manifestId: string, corpo: Record<string, unknown>) => {
    entrarComo("OPERATION");
    return chamar(manifestoRota.PATCH(req("PATCH", corpo), ctx(manifestId)));
  };
  const sair = (manifestId: string, corpo?: unknown, perfil: Perfil = "OPERATION") => {
    entrarComo(perfil);
    return chamar(liberarRota.POST(req("POST", corpo), ctx(manifestId)));
  };
  const statusDaViagem = async (manifestId: string) => (await banco.sistema.manifest.findUniqueOrThrow({ where: { id: manifestId }, select: { status: true } })).status;
  const trilha = (entityId: string) => banco.sistema.auditLog.findMany({ where: { entityId }, orderBy: { createdAt: "asc" }, select: { action: true, userId: true, summary: true, after: true } });

  beforeAll(async () => {
    banco = await import("../src/lib/prisma");
    manifestos = await import("../src/app/api/manifestos/route");
    manifestoRota = await import("../src/app/api/manifestos/[id]/route");
    liberarRota = await import("../src/app/api/manifestos/[id]/liberar/route");
    veiculosRota = await import("../src/app/api/veiculos/route");
    veiculoRota = await import("../src/app/api/veiculos/[id]/route");
    await limpar();

    const db = banco.default;
    for (const perfil of ["ADMIN", "OPERATION", "FINANCE", "CLIENT", "DRIVER"] as const) {
      ids[perfil] = (await db.user.create({ data: { name: nome(perfil), email: `${PREFIXO}${perfil.toLowerCase()}@exemplo.br`, password: HASH_FALSO, role: perfil } })).id;
    }
    clienteId = (await db.client.create({ data: { companyName: nome("cliente"), cnpj: CNPJ } })).id;
    const habilitacao = { cnh: "33322211199", cnhExpiry: new Date("2031-06-30"), category: "C" };
    motoristaId = (await db.driver.create({ data: { ...habilitacao, userId: ids.DRIVER, cpf: CPF_MOTORISTA } })).id;
    veiculoId = (await db.vehicle.create({ data: { plate: PLACA, model: nome("com capacidade"), type: "TRUCK", capacity: 3000, cubicCapacity: 20 } })).id;
    veiculoSemCapacidadeId = (await db.vehicle.create({ data: { plate: PLACA_SEM_CAPACIDADE, model: nome("sem capacidade"), type: "VAN" } })).id;

    // A outra empresa: uma viagem em montagem com excesso, no veículo dela.
    const outra = banco.paraEmpresa(EMPRESA_OUTRA.id).db;
    const usuario = await outra.user.create({ data: { name: nome("motorista da outra"), email: `${PREFIXO}outra@exemplo.br`, password: HASH_FALSO, role: "DRIVER" } });
    daOutra.motoristaId = (await outra.driver.create({ data: { ...habilitacao, userId: usuario.id, cpf: CPF_MOTORISTA_DA_OUTRA } })).id;
    daOutra.veiculoId = (await outra.vehicle.create({ data: { plate: PLACA_DA_OUTRA, model: nome("da outra"), type: "TRUCK", capacity: 100, cubicCapacity: 1 } })).id;
    daOutra.clienteId = (await outra.client.create({ data: { companyName: nome("cliente da outra"), cnpj: CNPJ_DA_OUTRA } })).id;
  }, 120_000);

  beforeEach(async () => {
    sessao.mockReset();
    await limparMovimento();
    await banco.sistema.vehicle.updateMany({ where: { plate: { in: PLACAS } }, data: { status: "AVAILABLE" } });
    await banco.sistema.vehicle.update({ where: { id: veiculoId }, data: { capacity: 3000, cubicCapacity: 20 } });
    const outra = banco.paraEmpresa(EMPRESA_OUTRA.id).db;
    daOutra.viagemId = (await outra.manifest.create({ data: { driverId: daOutra.motoristaId, vehicleId: daOutra.veiculoId, status: "ASSEMBLING" } })).id;
    await outra.collection.create({
      data: { clientId: daOutra.clienteId, sender: "Remetente", receiver: nome("destinatário da outra"), origin: "A", destination: "B", volumes: 1, weight: 9999, status: "COLLECTED", manifestId: daOutra.viagemId },
    });
  });

  afterAll(async () => {
    if (banco) await limpar();
  });

  describe("cubagem útil no cadastro do veículo", () => {
    it("criar e alterar gravam a cubagem; valor inválido é 400; a auditoria registra", async () => {
      entrarComo("OPERATION");
      const placa = "OCP9Z99";
      await banco.sistema.vehicle.deleteMany({ where: { plate: placa } });
      const criado = await chamar(veiculosRota.POST(req("POST", { plate: placa, model: nome("novo"), type: "VUC", capacityKg: "1500", cubicCapacity: "12,5" })));
      expect(criado.status).toBe(201);
      expect(criado.corpo).toMatchObject({ capacity: 1500, cubicCapacity: 12.5 });

      expect((await chamar(veiculoRota.PATCH(req("PATCH", { cubicCapacity: -3 }), ctx(criado.corpo.id)))).status).toBe(400);
      const alterado = await chamar(veiculoRota.PATCH(req("PATCH", { cubicCapacity: "" }), ctx(criado.corpo.id)));
      expect(alterado).toMatchObject({ status: 200, corpo: { cubicCapacity: null, capacity: 1500 } });
      expect((await trilha(criado.corpo.id)).map((l) => [l.action, l.after])).toEqual([
        ["veiculo.criar", expect.objectContaining({ cubicCapacity: 12.5 })],
        ["veiculo.alterar", { cubicCapacity: null }],
      ]);
      await banco.sistema.vehicle.deleteMany({ where: { plate: placa } });
    });
  });

  describe("montar e alterar a viagem", () => {
    it("carga que cabe: a resposta leva a ocupação e nenhum aviso", async () => {
      const montada = await montar([await coletar(1000, 5), await coletar(250, 3.2)]);
      expect(montada.status).toBe(201);
      expect(montada.corpo.aviso).toBeNull();
      expect(montada.corpo.ocupacao).toMatchObject({ excesso: false, peso: { total: 1250, capacidade: 3000, percentual: 42 }, cubagem: { total: 8.2, capacidade: 20, percentual: 41 } });
    });

    it("acima da capacidade a viagem é montada assim mesmo, com o aviso e os números", async () => {
      const montada = await montar([await coletar(2000, 4), await coletar(1600, 4)]);
      expect(montada.status).toBe(201);
      expect(montada.corpo.aviso).toBe("Excesso de peso: 3.600 de 3.000 kg (120%), 600 kg acima.");
      expect(montada.corpo.ocupacao).toMatchObject({ excesso: true, peso: { total: 3600, acima: 600 } });
      expect(await statusDaViagem(montada.corpo.id)).toBe("ASSEMBLING");
    });

    it("acrescentar carga e trocar de veículo refazem a conferência", async () => {
      const montada = await montar([await coletar(2500, 10)]);
      expect(montada.corpo.aviso).toBeNull();

      const comMaisCarga = await alterar(montada.corpo.id, { addCollectionIds: [await coletar(400, 12)] });
      expect(comMaisCarga.status).toBe(200);
      expect(comMaisCarga.corpo.aviso).toBe("Excesso de cubagem: 22 de 20 m³ (110%), 2 m³ acima.");
      expect(comMaisCarga.corpo.ocupacao).toMatchObject({ excesso: true, peso: { total: 2900, excesso: false }, cubagem: { total: 22, excesso: true } });

      // Veículo sem capacidade cadastrada: nenhum aviso de excesso.
      const noOutroVeiculo = await alterar(montada.corpo.id, { vehicleId: veiculoSemCapacidadeId });
      expect(noOutroVeiculo.status).toBe(200);
      expect(noOutroVeiculo.corpo.aviso).toBeNull();
      expect(noOutroVeiculo.corpo.ocupacao).toMatchObject({ excesso: false, semCapacidade: true });
    });
  });

  describe("liberar a saída", () => {
    it("carga que cabe sai como sempre, sem confirmação e sem marca na auditoria", async () => {
      const montada = await montar([await coletar(1000, 5)]);
      const saida = await sair(montada.corpo.id);
      expect(saida.status).toBe(200);
      expect(await statusDaViagem(montada.corpo.id)).toBe("ROUTE");
      const liberacao = (await trilha(montada.corpo.id)).find((l) => l.action === "manifesto.liberar");
      expect(liberacao?.after).toMatchObject({ status: "ROUTE", cargas: 1 });
      expect(liberacao?.after).not.toHaveProperty("excessoDePeso");
      expect(liberacao?.summary).not.toContain("excesso");
    });

    it("com excesso a saída pede a confirmação explícita: sem ela é 409 e nada muda", async () => {
      const cargas = [await coletar(2000, 4), await coletar(1600, 4)];
      const montada = await montar(cargas);

      for (const corpo of [undefined, {}, { sairComExcesso: false }]) {
        const recusa = await sair(montada.corpo.id, corpo);
        expect(recusa.status, JSON.stringify(corpo)).toBe(409);
        expect(recusa.corpo.confirmar).toBe(CONFIRMACAO_DE_EXCESSO);
        expect(recusa.corpo.error).toMatch(/^Excesso de peso: 3\.600 de 3\.000 kg \(120%\), 600 kg acima\..*confirme para sair com excesso de peso\.$/);
        expect(recusa.corpo.ocupacao).toMatchObject({ excesso: true, peso: { total: 3600, capacidade: 3000, percentual: 120 } });
      }
      expect(await statusDaViagem(montada.corpo.id)).toBe("ASSEMBLING");
      expect((await banco.sistema.collection.findMany({ where: { id: { in: cargas } }, select: { status: true } })).map((c) => c.status)).toEqual(["COLLECTED", "COLLECTED"]);
      expect((await banco.sistema.vehicle.findUniqueOrThrow({ where: { id: veiculoId } })).status).toBe("AVAILABLE");
      expect((await trilha(montada.corpo.id)).map((l) => l.action)).not.toContain("manifesto.liberar");
    });

    it("confirmação que não é verdadeiro ou falso é 400", async () => {
      const montada = await montar([await coletar(3600)]);
      expect((await sair(montada.corpo.id, { sairComExcesso: "sim" })).status).toBe(400);
      expect(await statusDaViagem(montada.corpo.id)).toBe("ASSEMBLING");
    });

    it("com a confirmação a viagem sai, e a auditoria guarda quem confirmou e os números", async () => {
      const montada = await montar([await coletar(2000, 4), await coletar(1600, 4)]);
      const saida = await sair(montada.corpo.id, { sairComExcesso: true });
      expect(saida.status).toBe(200);
      expect(await statusDaViagem(montada.corpo.id)).toBe("ROUTE");

      const liberacao = (await trilha(montada.corpo.id)).find((l) => l.action === "manifesto.liberar");
      expect(liberacao).toMatchObject({ userId: ids.OPERATION });
      expect(liberacao?.summary).toContain("com excesso confirmado. Excesso de peso: 3.600 de 3.000 kg (120%), 600 kg acima.");
      expect(liberacao?.after).toMatchObject({ status: "ROUTE", cargas: 2, excessoDePeso: true, pesoKg: 3600, capacidadeKg: 3000, cubagemM3: 8, capacidadeM3: 20 });
    });

    it("veículo sem capacidade cadastrada não pede confirmação, por mais pesada que a carga seja", async () => {
      const montada = await montar([await coletar(99_999, 500)], veiculoSemCapacidadeId);
      expect(montada.corpo.aviso).toBeNull();
      expect((await sair(montada.corpo.id)).status).toBe(200);
      expect(await statusDaViagem(montada.corpo.id)).toBe("ROUTE");
    });

    it("cadastro corrigido depois da montagem: a conferência da saída usa a capacidade de agora", async () => {
      const montada = await montar([await coletar(3600)]);
      expect((await sair(montada.corpo.id)).status).toBe(409);
      await banco.sistema.vehicle.update({ where: { id: veiculoId }, data: { capacity: 4000 } });
      expect((await sair(montada.corpo.id)).status).toBe(200);
    });

    it("permissão: sem sessão 401; cliente, motorista e financeiro 403, mesmo mandando a confirmação", async () => {
      const montada = await montar([await coletar(3600)]);
      expect((await sair(montada.corpo.id, { sairComExcesso: true }, null as unknown as Perfil)).status).toBe(401);
      for (const perfil of ["CLIENT", "DRIVER", "FINANCE"] as const) {
        expect((await sair(montada.corpo.id, { sairComExcesso: true }, perfil)).status, perfil).toBe(403);
      }
      expect(await statusDaViagem(montada.corpo.id)).toBe("ASSEMBLING");
    });
  });

  describe("isolamento entre empresas", () => {
    it("a viagem da outra empresa não existe para esta: nem a conferência, nem a confirmação a alcançam", async () => {
      expect((await sair(daOutra.viagemId, { sairComExcesso: true })).status).toBe(404);
      expect((await alterar(daOutra.viagemId, { vehicleId: veiculoId })).status).toBe(404);
      expect(await statusDaViagem(daOutra.viagemId)).toBe("ASSEMBLING");

      // Montar com o veículo da outra empresa é recusado: a capacidade dela não entra em conta nenhuma daqui.
      const comVeiculoDela = await montar([await coletar(10)], daOutra.veiculoId);
      expect(comVeiculoDela.status).toBe(400);
      expect(JSON.stringify(comVeiculoDela.corpo)).not.toMatch(/ocupacao|Excesso/);
    });
  });
});
