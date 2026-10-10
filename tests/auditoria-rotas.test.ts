import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getServerSession } from "next-auth";
import { ACOES, ENTIDADES, PERFIL_DA_PLATAFORMA, atorDaPlataforma, linhaDeAuditoria, rotuloDoCampo } from "../src/lib/auditoria";
import { EMPRESA_OUTRA, EMPRESA_PADRAO } from "./empresas-de-teste";

/**
 * Auditoria nas rotas que tinham ficado de fora: o que o motorista faz no
 * aplicativo, o que o cliente faz no portal, CRM, posições do depósito, CT-e,
 * ligar nota a carga e os registros da frota. Um teste por rota, conferindo a
 * linha gerada e quem a fez. As duas rotas da plataforma estão em
 * tests/entrada-e-plataforma.test.ts, junto do cadastro de empresas.
 */
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

describe("auditoria: ações, entidades e autor da plataforma", () => {
  it("as ações novas têm rótulo, e a entidade de cada uma existe", () => {
    const novas = [
      "entrega.baixar",
      "checklist.registrar",
      "coleta.pedir",
      "cotacao.alterar",
      "cotacao.converter",
      "posicao.criar",
      "posicao.alterar",
      "cte.registrar",
      "nota.ligar",
      "manutencao.registrar",
      "pneu.registrar",
      "pneu.alterar",
      "pneu.excluir",
      "abastecimento.excluir",
      "documento-veiculo.alterar",
      "documento-veiculo.excluir",
      "empresa.criar",
    ] as const;
    for (const acao of novas) expect(ACOES[acao], acao).toEqual(expect.any(String));
    expect(ENTIDADES.cotacao).toBe("Cotação");
    expect(ENTIDADES.posicao).toBe("Posição do depósito");
    for (const campo of ["cteNumber", "cteKey", "brandModel", "installedKm", "removedKm", "cost", "code", "estimatedValue", "itensComProblema"]) {
      expect(rotuloDoCampo(campo), campo).not.toBe(campo);
    }
  });

  it("a conta da plataforma assina sem id de usuário, com nome, e-mail e o perfil PLATAFORMA", () => {
    const linha = linhaDeAuditoria({
      ator: atorDaPlataforma({ nome: "Nicolas", email: "nicolas@exemplo.br" }),
      origem: { ip: null, dispositivo: null },
      acao: "empresa.alterar",
      entidade: "empresa",
      entidadeId: "e1",
      resumo: "Empresa X desativada pela plataforma",
      antes: { active: true },
      depois: { active: false },
    });
    expect(linha).toMatchObject({ userId: null, userName: "Nicolas <nicolas@exemplo.br>", userRole: PERFIL_DA_PLATAFORMA, before: { active: true }, after: { active: false } });
  });
});

const temBanco = Boolean(process.env.DATABASE_URL);

if (!temBanco) {
  console.warn("\n[auditoria-rotas.test] DATABASE_URL ausente: testes de integração PULADOS.\nRode com um Postgres real para exercitá-los.\n");
}

const suite = temBanco ? describe : describe.skip;

// Tudo o que esta suite cria usa estes marcadores, e só isso é apagado.
const PREFIXO = "teste-audrotas-";
const CNPJ_CLIENTE = "99666222000107";
const CPF_MOTORISTA = "99666222107";
const PLACA = "AUD9R07";
const HASH_FALSO = "$2b$10$hashfalsoparateste000000000000000000000000000000000";
const SEM_ID = "00000000-0000-0000-0000-000000000000";
const FOTO = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
const ASSINATURA = "data:image/png;base64,iVBORw0KGgo=";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const RASTREIO = { BAIXA: "9966620001", OCORRENCIA: "9966620002", CTE: "9966620003", LIGAR: "9966620004" };

/** Dígito verificador da chave (módulo 11, pesos de 2 a 9), para montar as chaves do teste. */
function comDigito(corpo: string): string {
  const pesos = [2, 3, 4, 5, 6, 7, 8, 9];
  const soma = [...corpo].reverse().reduce((total, numero, i) => total + Number(numero) * pesos[i % 8], 0);
  return `${corpo}${soma % 11 < 2 ? 0 : 11 - (soma % 11)}`;
}
const chave = (modelo: string, numero: number) => comDigito(`352610${CNPJ_CLIENTE}${modelo}001${String(numero).padStart(9, "0")}112345678`);
const CHAVE_DO_CTE = chave("57", 9901);
const CHAVE_DA_NOTA = chave("55", 9902);

type Linha = {
  tenantId: string;
  userId: string | null;
  userName: string;
  userRole: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  summary: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  ip: string | null;
  device: string | null;
};

suite("auditoria nas rotas do motorista, do portal, do CRM, do depósito, do fiscal e da frota", () => {
  let banco: typeof import("../src/lib/prisma");
  const sessao = vi.mocked(getServerSession);
  const ids = { ADMIN: "", OPERATION: "", DRIVER: "", CLIENT: "" };
  let clienteId: string;
  let motoristaId: string;
  let veiculoId: string;
  let viagemId: string;
  const cargas = { BAIXA: "", OCORRENCIA: "", CTE: "", LIGAR: "" };

  const entrarComo = (quem: keyof typeof ids | null) => sessao.mockResolvedValue(quem ? { user: { id: ids[quem], role: quem, clientId: null } } : null);

  const req = (method = "POST", body?: unknown) =>
    new Request("http://localhost/api/teste", {
      method,
      headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.9", "user-agent": IPHONE },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });

  /** As linhas da ação sobre o registro, da mais antiga para a mais nova. Só as desta suite. */
  const linhas = (action: string, entityId: string) =>
    banco.sistema.auditLog.findMany({
      where: { action, entityId, userName: { startsWith: PREFIXO } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }) as unknown as Promise<Linha[]>;

  /** A única linha da ação sobre o registro. */
  const linha = async (action: string, entityId: string) => {
    const achadas = await linhas(action, entityId);
    expect(achadas, `${action} em ${entityId}`).toHaveLength(1);
    return achadas[0];
  };

  const feitaPor = (quem: keyof typeof ids) => ({
    tenantId: EMPRESA_PADRAO.id,
    userId: ids[quem],
    userName: `${PREFIXO}${quem}`,
    userRole: quem,
    ip: "203.0.113.9",
    device: "Safari no iPhone",
  });

  async function limpar() {
    const { sistema } = banco;
    const doVeiculo = { vehicle: { plate: PLACA } };
    await sistema.auditLog.deleteMany({ where: { userName: { startsWith: PREFIXO } } });
    await sistema.occurrence.deleteMany({ where: { openedBy: { email: { startsWith: PREFIXO } } } });
    await sistema.fiscalDocument.deleteMany({ where: { accessKey: CHAVE_DA_NOTA } });
    await sistema.quoteLead.deleteMany({ where: { email: { startsWith: PREFIXO } } });
    await sistema.collection.deleteMany({ where: { client: { cnpj: CNPJ_CLIENTE } } });
    await sistema.fueling.deleteMany({ where: doVeiculo });
    await sistema.vehicleDocument.deleteMany({ where: doVeiculo });
    await sistema.tire.deleteMany({ where: doVeiculo });
    await sistema.vehicleChecklist.deleteMany({ where: doVeiculo });
    await sistema.maintenance.deleteMany({ where: doVeiculo });
    await sistema.manifest.deleteMany({ where: doVeiculo });
    await sistema.financialTransaction.deleteMany({ where: { description: { startsWith: `Manutenção: ${PREFIXO}` } } });
    await sistema.warehouseLocation.deleteMany({ where: { code: { startsWith: "TAUD-" } } });
    await sistema.vehicle.deleteMany({ where: { plate: PLACA } });
    await sistema.driver.deleteMany({ where: { cpf: CPF_MOTORISTA } });
    await sistema.user.deleteMany({ where: { email: { startsWith: PREFIXO } } });
    await sistema.client.deleteMany({ where: { cnpj: CNPJ_CLIENTE } });
  }

  const carga = (trackingCode: string, status: string, extra: Record<string, unknown> = {}) => ({
    clientId: clienteId,
    sender: "Remetente",
    receiver: "Mercado Bom Preço",
    origin: "São José do Rio Preto - SP",
    destination: "Mirassol - SP",
    volumes: 2,
    weight: 30,
    status,
    trackingCode,
    ...extra,
  });

  const lead = (nome: string) =>
    banco.default.quoteLead.create({
      data: { companyName: `${PREFIXO}${nome}`, email: `${PREFIXO}${nome}@exemplo.br`, phone: "17999990000", origin: "São José do Rio Preto - SP", destination: "Mirassol - SP", volumes: 4, weight: 80 },
    });

  beforeAll(async () => {
    banco = await import("../src/lib/prisma");
    await limpar();

    const db = banco.default;
    clienteId = (await db.client.create({ data: { companyName: `${PREFIXO}cliente`, cnpj: CNPJ_CLIENTE } })).id;
    for (const quem of Object.keys(ids) as (keyof typeof ids)[]) {
      ids[quem] = (
        await db.user.create({
          data: { name: `${PREFIXO}${quem}`, email: `${PREFIXO}${quem.toLowerCase()}@exemplo.br`, password: HASH_FALSO, role: quem, clientId: quem === "CLIENT" ? clienteId : undefined },
        })
      ).id;
    }
    motoristaId = (await db.driver.create({ data: { userId: ids.DRIVER, cpf: CPF_MOTORISTA, cnh: "12345678900", cnhExpiry: new Date("2030-01-01T00:00:00.000Z"), category: "C" } })).id;
    veiculoId = (await db.vehicle.create({ data: { plate: PLACA, model: "Caminhão de teste", type: "TRUCK" } })).id;
    viagemId = (await db.manifest.create({ data: { driverId: motoristaId, vehicleId: veiculoId, status: "ROUTE" } })).id;

    cargas.BAIXA = (await db.collection.create({ data: carga(RASTREIO.BAIXA, "ROUTE", { manifestId: viagemId }) })).id;
    cargas.OCORRENCIA = (await db.collection.create({ data: carga(RASTREIO.OCORRENCIA, "ROUTE", { manifestId: viagemId }) })).id;
    cargas.CTE = (await db.collection.create({ data: carga(RASTREIO.CTE, "DELIVERED") })).id;
    cargas.LIGAR = (await db.collection.create({ data: carga(RASTREIO.LIGAR, "CONFIRMED") })).id;
  }, 60_000);

  beforeEach(() => {
    sessao.mockReset();
  });

  afterAll(async () => {
    if (banco) await limpar();
  });

  describe("aplicativo do motorista", () => {
    it("POST /api/driver/entregas/[id]/baixa: uma linha por baixa, do motorista, sem foto, assinatura nem documento", async () => {
      const rota = await import("../src/app/api/driver/entregas/[id]/baixa/route");
      const corpo = { receiverName: "Maria Recebedora", receiverDoc: "123.456.789-00", photoBase64: FOTO, signatureBase64: ASSINATURA, latitude: -20.8, longitude: -49.4 };
      entrarComo("DRIVER");

      const res = await rota.POST(req("POST", corpo), ctx({ id: cargas.BAIXA }));
      expect(res.status).toBe(200);

      const gravada = await linha("entrega.baixar", cargas.BAIXA);
      expect(gravada).toMatchObject({
        ...feitaPor("DRIVER"),
        entity: "coleta",
        before: { status: "ROUTE" },
        after: { status: "DELIVERED", receiverName: "Maria Recebedora" },
      });
      expect(gravada.summary).toContain("Maria Recebedora");
      expect(JSON.stringify(gravada)).not.toMatch(/data:image|123\.456|-20\.8/);

      // O aplicativo reenvia a baixa quando a rede cai: o reenvio responde 200 e não gera outra linha.
      const reenvio = await rota.POST(req("POST", corpo), ctx({ id: cargas.BAIXA }));
      expect(reenvio.status).toBe(200);
      expect((await reenvio.json()).alreadyDelivered).toBe(true);
      expect(await linhas("entrega.baixar", cargas.BAIXA)).toHaveLength(1);
    });

    it("POST /api/driver/entregas/[id]/ocorrencia: chamado aberto pelo motorista; carga de fora da viagem não deixa linha", async () => {
      const rota = await import("../src/app/api/driver/entregas/[id]/ocorrencia/route");
      entrarComo("DRIVER");

      const res = await rota.POST(req("POST", { type: "DAMAGE", description: "Caixa chegou amassada no cliente." }), ctx({ id: cargas.OCORRENCIA }));
      expect(res.status).toBe(201);
      const { id, number } = (await res.json()) as { id: string; number: number };

      const gravada = await linha("ocorrencia.abrir", id);
      expect(gravada).toMatchObject({ ...feitaPor("DRIVER"), entity: "ocorrencia", before: null, after: { number, type: "DAMAGE", cargaId: cargas.OCORRENCIA } });
      expect(gravada.summary).toContain(`Chamado nº ${number} aberto pelo motorista`);

      const antes = await banco.sistema.auditLog.count({ where: { userName: `${PREFIXO}DRIVER` } });
      expect((await rota.POST(req("POST", { type: "DAMAGE", description: "Carga que não é minha." }), ctx({ id: cargas.CTE }))).status).toBe(404);
      expect(await banco.sistema.auditLog.count({ where: { userName: `${PREFIXO}DRIVER` } })).toBe(antes);
    });

    it("POST /api/driver/checklists: checklist do veículo da viagem, com os itens com problema", async () => {
      const rota = await import("../src/app/api/driver/checklists/route");
      entrarComo("DRIVER");
      const items = { pneus: true, freios: false, luzes: true, oleo: true, agua: true, documentos: true, limpeza: false, extintor: true };

      const res = await rota.POST(req("POST", { manifestId: viagemId, items, odometer: 120500, notes: "Freio baixo" }));
      expect(res.status).toBe(201);

      const gravada = await linha("checklist.registrar", veiculoId);
      expect(gravada).toMatchObject({
        ...feitaPor("DRIVER"),
        entity: "veiculo",
        after: { odometer: 120500, notes: "Freio baixo", itensComProblema: ["Freios", "Limpeza"] },
      });
      expect(gravada.summary).toContain("problema em Freios, Limpeza");
    });
  });

  describe("portal do cliente", () => {
    it("POST /api/portal/coletas: pedido de coleta, assinado pelo usuário do cliente", async () => {
      const rota = await import("../src/app/api/portal/coletas/route");
      entrarComo("CLIENT");

      const res = await rota.POST(
        req("POST", { sender: "Fábrica", receiver: `${PREFIXO}destinatário`, origin: "São José do Rio Preto - SP", destination: "Mirassol - SP", volumes: 3, weight: 45, invoiceValue: 900, priority: "URGENT" }),
      );
      expect(res.status).toBe(201);
      const { collection } = (await res.json()) as { collection: { id: string; trackingCode: string } };

      const gravada = await linha("coleta.pedir", collection.id);
      expect(gravada).toMatchObject({
        ...feitaPor("CLIENT"),
        entity: "coleta",
        before: null,
        after: { clientId: clienteId, status: "PENDING", trackingCode: collection.trackingCode, volumes: 3, weight: 45, invoiceValue: 900, priority: "URGENT" },
      });
      expect(gravada.summary).toContain("pedida pelo portal");

      const antes = await banco.sistema.auditLog.count({ where: { action: "coleta.pedir", userName: `${PREFIXO}CLIENT` } });
      expect((await rota.POST(req("POST", { sender: "Fábrica" }))).status).toBe(400);
      expect(await banco.sistema.auditLog.count({ where: { action: "coleta.pedir", userName: `${PREFIXO}CLIENT` } })).toBe(antes);
    });

    it("POST /api/portal/atendimento: chamado aberto pelo cliente", async () => {
      const rota = await import("../src/app/api/portal/atendimento/route");
      entrarComo("CLIENT");

      const res = await rota.POST(req("POST", { type: "DELAY", title: `${PREFIXO}entrega atrasada`, description: "A carga não chegou no prazo combinado.", collectionId: cargas.CTE }));
      expect(res.status).toBe(201);
      const { id, number } = (await res.json()) as { id: string; number: number };

      const gravada = await linha("ocorrencia.abrir", id);
      expect(gravada).toMatchObject({
        ...feitaPor("CLIENT"),
        entity: "ocorrencia",
        after: { number, type: "DELAY", title: `${PREFIXO}entrega atrasada`, clientId: clienteId, cargaId: cargas.CTE },
      });
      expect(gravada.summary).toContain("aberto pelo cliente no portal");
    });
  });

  describe("CRM", () => {
    it("PATCH /api/dashboard/crm/[id]: antes e depois do que mudou; repetir o mesmo valor não gera linha", async () => {
      const rota = await import("../src/app/api/dashboard/crm/[id]/route");
      const { id } = await lead("funil");
      entrarComo("OPERATION");

      expect((await rota.PATCH(req("PATCH", { status: "CONTACTED", estimatedValue: 350 }), ctx({ id }))).status).toBe(200);
      const gravada = await linha("cotacao.alterar", id);
      expect(gravada).toMatchObject({
        ...feitaPor("OPERATION"),
        entity: "cotacao",
        before: { status: "NEW", estimatedValue: null },
        after: { status: "CONTACTED", estimatedValue: 350 },
      });

      expect((await rota.PATCH(req("PATCH", { status: "CONTACTED" }), ctx({ id }))).status).toBe(200);
      expect(await linhas("cotacao.alterar", id)).toHaveLength(1);

      expect((await rota.PATCH(req("PATCH", { status: "LOST" }), ctx({ id: SEM_ID }))).status).toBe(404);
      expect(await linhas("cotacao.alterar", SEM_ID)).toHaveLength(0);
    });

    it("POST /api/dashboard/crm/[id]/converter: a cotação e a carga que nasceu dela; conversão recusada não deixa linha", async () => {
      const rota = await import("../src/app/api/dashboard/crm/[id]/converter/route");
      const { id } = await lead("converter");
      entrarComo("ADMIN");

      const recusada = await rota.POST(req("POST", { clientId: SEM_ID, sender: "Fábrica", receiver: "Mercado" }), ctx({ id }));
      expect(recusada.status).toBe(400);
      expect(await linhas("cotacao.converter", id)).toHaveLength(0);

      const res = await rota.POST(req("POST", { clientId: clienteId, sender: "Fábrica", receiver: "Mercado" }), ctx({ id }));
      expect(res.status).toBe(201);
      const { collection } = (await res.json()) as { collection: { id: string; trackingCode: string } };

      const gravada = await linha("cotacao.converter", id);
      expect(gravada).toMatchObject({
        ...feitaPor("ADMIN"),
        entity: "cotacao",
        after: { status: "CONVERTED", cargaId: collection.id, trackingCode: collection.trackingCode, clientId: clienteId },
      });
      expect(gravada.summary).toContain(`${PREFIXO}converter`);
    });
  });

  describe("depósito", () => {
    it("POST /api/deposito/posicoes e PATCH /api/deposito/posicoes/[id]: criar e alterar posição", async () => {
      const posicoes = await import("../src/app/api/deposito/posicoes/route");
      const posicaoPorId = await import("../src/app/api/deposito/posicoes/[id]/route");
      entrarComo("OPERATION");

      const criada = await posicoes.POST(req("POST", { code: "taud-a-01", description: "Prateleira de teste" }));
      expect(criada.status).toBe(201);
      const { id } = (await criada.json()) as { id: string };

      expect(await linha("posicao.criar", id)).toMatchObject({
        ...feitaPor("OPERATION"),
        entity: "posicao",
        before: null,
        after: { code: "TAUD-A-01", description: "Prateleira de teste", active: true },
      });

      expect((await posicaoPorId.PATCH(req("PATCH", { active: false }), ctx({ id }))).status).toBe(200);
      expect(await linha("posicao.alterar", id)).toMatchObject({ ...feitaPor("OPERATION"), entity: "posicao", before: { active: true }, after: { active: false } });

      // Código repetido é 409 e não deixa linha.
      expect((await posicoes.POST(req("POST", { code: "TAUD-A-01" }))).status).toBe(409);
      expect(await banco.sistema.auditLog.count({ where: { action: "posicao.criar", userName: `${PREFIXO}OPERATION` } })).toBe(1);
      expect((await posicaoPorId.PATCH(req("PATCH", { active: false }), ctx({ id: SEM_ID }))).status).toBe(404);
      expect(await linhas("posicao.alterar", SEM_ID)).toHaveLength(0);
    });
  });

  describe("documentos fiscais", () => {
    it("POST /api/fiscal/cte: registrar e desfazer o registro, cada um com antes e depois", async () => {
      const rota = await import("../src/app/api/fiscal/cte/route");
      entrarComo("ADMIN");

      expect((await rota.POST(req("POST", { collectionId: cargas.CTE, cteNumber: 9901, cteKey: CHAVE_DO_CTE }))).status).toBe(200);
      const [registro] = await linhas("cte.registrar", cargas.CTE);
      expect(registro).toMatchObject({
        ...feitaPor("ADMIN"),
        entity: "coleta",
        before: { cteNumber: null, cteKey: null, cteStatus: "PENDING" },
        after: { cteNumber: 9901, cteKey: CHAVE_DO_CTE, cteStatus: "ISSUED" },
      });
      expect(registro.summary).toContain("CT-e nº 9901");

      expect((await rota.POST(req("POST", { collectionId: cargas.CTE, cteNumber: "", cteKey: "" }))).status).toBe(200);
      const todas = await linhas("cte.registrar", cargas.CTE);
      expect(todas).toHaveLength(2);
      expect(todas[1]).toMatchObject({ before: { cteNumber: 9901, cteStatus: "ISSUED" }, after: { cteNumber: null, cteKey: null, cteStatus: "PENDING" } });
      expect(todas[1].summary).toContain("desfeito");

      // Carga que ainda não saiu: 409, sem linha.
      expect((await rota.POST(req("POST", { collectionId: cargas.LIGAR, cteNumber: 9901, cteKey: CHAVE_DO_CTE }))).status).toBe(409);
      expect(await linhas("cte.registrar", cargas.LIGAR)).toHaveLength(0);
    });

    it("POST /api/fiscal/notas/[id]/ligar: a nota e a carga a que foi ligada, sem o XML", async () => {
      const rota = await import("../src/app/api/fiscal/notas/[id]/ligar/route");
      const nota = await banco.default.fiscalDocument.create({
        data: { accessKey: CHAVE_DA_NOTA, number: 9902, series: 1, issuerTaxId: CNPJ_CLIENTE, issuerName: `${PREFIXO}emitente`, totalValue: 500, xml: "<nfeProc>conteúdo que não vai para a auditoria</nfeProc>" },
      });
      entrarComo("OPERATION");

      expect((await rota.POST(req("POST", { trackingCode: "0000000000" }), ctx({ id: nota.id }))).status).toBe(404);
      expect(await linhas("nota.ligar", nota.id)).toHaveLength(0);

      expect((await rota.POST(req("POST", { trackingCode: RASTREIO.LIGAR }), ctx({ id: nota.id }))).status).toBe(200);
      const gravada = await linha("nota.ligar", nota.id);
      expect(gravada).toMatchObject({
        ...feitaPor("OPERATION"),
        entity: "nota",
        after: { accessKey: CHAVE_DA_NOTA, cargaId: cargas.LIGAR, trackingCode: RASTREIO.LIGAR },
      });
      expect(JSON.stringify(gravada)).not.toContain("nfeProc");

      // Ligar de novo é 409 e não gera segunda linha.
      expect((await rota.POST(req("POST", { trackingCode: RASTREIO.LIGAR }), ctx({ id: nota.id }))).status).toBe(409);
      expect(await linhas("nota.ligar", nota.id)).toHaveLength(1);
    });
  });

  describe("frota", () => {
    it("POST /api/veiculos/[id]/manutencao: a manutenção registrada no veículo", async () => {
      const rota = await import("../src/app/api/veiculos/[id]/manutencao/route");
      entrarComo("ADMIN");

      const res = await rota.POST(req("POST", { description: `${PREFIXO}troca de óleo`, cost: "350.50", date: "2026-05-12", status: "COMPLETED", kind: "PREVENTIVE", odometer: 98000 }), ctx({ id: veiculoId }));
      expect(res.status).toBe(201);

      expect(await linha("manutencao.registrar", veiculoId)).toMatchObject({
        ...feitaPor("ADMIN"),
        entity: "veiculo",
        after: { description: `${PREFIXO}troca de óleo`, cost: 350.5, date: "2026-05-12T00:00:00.000Z", status: "COMPLETED", kind: "PREVENTIVE", odometer: 98000 },
      });

      expect((await rota.POST(req("POST", { description: "x", cost: "1", date: "2026-05-12" }), ctx({ id: SEM_ID }))).status).toBe(404);
      expect(await linhas("manutencao.registrar", SEM_ID)).toHaveLength(0);
    });

    it("POST, PATCH e DELETE de pneu: registrar, alterar (só o que mudou) e excluir (o que havia)", async () => {
      const pneus = await import("../src/app/api/veiculos/[id]/pneus/route");
      const pneuPorId = await import("../src/app/api/veiculos/[id]/pneus/[registroId]/route");
      entrarComo("OPERATION");

      const criado = await pneus.POST(req("POST", { position: "Dianteiro esquerdo", brandModel: "Pirelli FR85", installedAt: "2026-03-01", installedKm: 90000 }), ctx({ id: veiculoId }));
      expect(criado.status).toBe(201);
      const { id: registroId } = (await criado.json()) as { id: string };
      expect(await linha("pneu.registrar", veiculoId)).toMatchObject({
        ...feitaPor("OPERATION"),
        entity: "veiculo",
        after: { position: "Dianteiro esquerdo", brandModel: "Pirelli FR85", installedAt: "2026-03-01T00:00:00.000Z", installedKm: 90000 },
      });

      expect((await pneuPorId.PATCH(req("PATCH", { removedKm: 140000 }), ctx({ id: veiculoId, registroId }))).status).toBe(200);
      expect(await linha("pneu.alterar", veiculoId)).toMatchObject({ ...feitaPor("OPERATION"), before: { removedKm: null }, after: { removedKm: 140000 } });

      // Regra recusada (km de retirada menor que o de instalação) e pneu que não existe: sem linha.
      expect((await pneuPorId.PATCH(req("PATCH", { removedKm: 10 }), ctx({ id: veiculoId, registroId }))).status).toBe(400);
      expect((await pneuPorId.DELETE(req("DELETE"), ctx({ id: veiculoId, registroId: SEM_ID }))).status).toBe(404);
      expect(await linhas("pneu.alterar", veiculoId)).toHaveLength(1);
      expect(await linhas("pneu.excluir", veiculoId)).toHaveLength(0);

      expect((await pneuPorId.DELETE(req("DELETE"), ctx({ id: veiculoId, registroId }))).status).toBe(200);
      expect(await linha("pneu.excluir", veiculoId)).toMatchObject({
        ...feitaPor("OPERATION"),
        before: { position: "Dianteiro esquerdo", brandModel: "Pirelli FR85", installedKm: 90000, removedKm: 140000 },
        after: null,
      });
    });

    it("DELETE /api/veiculos/[id]/abastecimentos/[registroId]: o abastecimento apagado fica na linha", async () => {
      const rota = await import("../src/app/api/veiculos/[id]/abastecimentos/[registroId]/route");
      const abastecimento = await banco.default.fueling.create({
        data: { vehicleId: veiculoId, date: new Date("2026-04-10T00:00:00.000Z"), liters: 120.5, totalCost: 720.3, odometer: 95000, station: "Posto de teste" },
      });
      entrarComo("ADMIN");

      expect((await rota.DELETE(req("DELETE"), ctx({ id: veiculoId, registroId: SEM_ID }))).status).toBe(404);
      expect(await linhas("abastecimento.excluir", veiculoId)).toHaveLength(0);

      expect((await rota.DELETE(req("DELETE"), ctx({ id: veiculoId, registroId: abastecimento.id }))).status).toBe(200);
      expect(await linha("abastecimento.excluir", veiculoId)).toMatchObject({
        ...feitaPor("ADMIN"),
        entity: "veiculo",
        before: { date: "2026-04-10T00:00:00.000Z", liters: 120.5, totalCost: 720.3, odometer: 95000, station: "Posto de teste" },
        after: null,
      });
    });

    it("PATCH e DELETE de documento de veículo: a renovação com antes e depois, e a exclusão com o que havia", async () => {
      const rota = await import("../src/app/api/veiculos/[id]/documentos/[registroId]/route");
      const documento = await banco.default.vehicleDocument.create({
        data: { vehicleId: veiculoId, type: "LICENSING", number: "ABC-123", expiresAt: new Date("2026-06-30T00:00:00.000Z") },
      });
      const registroId = documento.id;
      entrarComo("OPERATION");

      expect((await rota.PATCH(req("PATCH", { expiresAt: "2027-06-30" }), ctx({ id: veiculoId, registroId }))).status).toBe(200);
      expect(await linha("documento-veiculo.alterar", veiculoId)).toMatchObject({
        ...feitaPor("OPERATION"),
        entity: "veiculo",
        before: { expiresAt: "2026-06-30T00:00:00.000Z" },
        after: { expiresAt: "2027-06-30T00:00:00.000Z" },
      });

      // Mandar o mesmo vencimento não muda nada: sem segunda linha.
      expect((await rota.PATCH(req("PATCH", { expiresAt: "2027-06-30" }), ctx({ id: veiculoId, registroId }))).status).toBe(200);
      expect(await linhas("documento-veiculo.alterar", veiculoId)).toHaveLength(1);

      expect((await rota.DELETE(req("DELETE"), ctx({ id: veiculoId, registroId }))).status).toBe(200);
      expect(await linha("documento-veiculo.excluir", veiculoId)).toMatchObject({
        ...feitaPor("OPERATION"),
        before: { type: "LICENSING", number: "ABC-123", expiresAt: "2027-06-30T00:00:00.000Z" },
        after: null,
      });
    });
  });

  describe("isolamento", () => {
    it("as linhas ficam na empresa de quem fez: a outra empresa não as lê", async () => {
      const doTeste = await banco.sistema.auditLog.findMany({ where: { userName: { startsWith: PREFIXO } }, select: { tenantId: true } });
      expect(doTeste.length).toBeGreaterThanOrEqual(18);
      expect(new Set(doTeste.map((linhaDoTeste) => linhaDoTeste.tenantId))).toEqual(new Set([EMPRESA_PADRAO.id]));

      const { db } = banco.paraEmpresa(EMPRESA_OUTRA.id);
      expect(await db.auditLog.count({ where: { userName: { startsWith: PREFIXO } } })).toBe(0);
    });
  });
});
