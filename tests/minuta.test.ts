import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getServerSession } from "next-auth";
import {
  AVISO_SEM_VALOR_FISCAL,
  chaveEmBlocos,
  composicaoDoFrete,
  dataDeEmissao,
  montarMinuta,
  notasDaMinuta,
  verFreteNaMinuta,
  type CargaDaMinuta,
  type Minuta,
} from "../src/lib/minuta";
import { PERFIS, PERFIS_INTERNOS, pode } from "../src/lib/permissoes";
import { EMPRESA_OUTRA, EMPRESA_PADRAO } from "./empresas-de-teste";

/**
 * Minuta de despacho: a montagem da folha a partir da carga (funções puras) e
 * a rota que a entrega, contra um Postgres de verdade. A tela é testada em
 * `tests/minuta-tela.test.tsx`.
 */
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

const temBanco = Boolean(process.env.DATABASE_URL);

if (!temBanco) {
  console.warn("\n[minuta.test] DATABASE_URL ausente: testes de integração PULADOS.\nRode com um Postgres real para exercitá-los.\n");
}

const suite = temBanco ? describe : describe.skip;

const CHAVE_NF = "35261099313131000101550010000001231000001239";
const CHAVE_CTE = "35261099313131000101570010000000771000000775";
const AGORA = new Date("2026-10-10T17:32:00.000Z");
const EMPRESA = { name: "Transportes Avila", logo: null };

const cargaBase = (dados: Partial<CargaDaMinuta> = {}): CargaDaMinuta => ({
  id: "c1",
  trackingCode: "1234567890",
  sender: "Serilon Brasil",
  receiver: "Mercado Bom Preço",
  origin: "São José do Rio Preto - SP",
  destination: "Mirassol - SP",
  volumes: 3,
  weight: 120.5,
  cubicMeters: null,
  invoiceKey: null,
  invoiceValue: null,
  freightValue: null,
  freightManual: false,
  freightDetails: null,
  pickupNotes: null,
  deliveryStreet: null,
  deliveryNumber: null,
  deliveryDistrict: null,
  deliveryZip: null,
  cteKey: null,
  cteNumber: null,
  cteStatus: "PENDING",
  client: { companyName: "Serilon Brasil Ltda", tradeName: "Serilon", cnpj: "11222333000181", address: null, paymentCondition: null },
  driver: null,
  manifest: null,
  fiscalDocuments: [],
  ...dados,
});

const nota = (dados: Partial<CargaDaMinuta["fiscalDocuments"][number]> = {}): CargaDaMinuta["fiscalDocuments"][number] => ({
  number: 123,
  series: 1,
  accessKey: CHAVE_NF,
  issuerName: "Serilon Brasil",
  issuerTaxId: "11222333000181",
  issuerAddress: "Av. Industrial, 500 - Distrito",
  recipientName: "Mercado Bom Preço",
  recipientTaxId: "52998224725",
  recipientAddress: "Rua da Nota, 9 - Centro",
  ...dados,
});

const montar = (dados: Partial<CargaDaMinuta> = {}, verFrete = true) => montarMinuta(cargaBase(dados), EMPRESA, { verFrete, agora: AGORA });

describe("minuta de despacho: montagem", () => {
  it("carga mínima: só o que a carga tem; o que não tem sai nulo, sem nada inventado", () => {
    expect(montar()).toEqual({
      empresa: EMPRESA,
      codigo: "1234567890",
      emitidaEm: "2026-10-10T17:32:00.000Z",
      pagador: { nome: "Serilon Brasil Ltda", documento: "11222333000181", endereco: null },
      remetente: { nome: "Serilon Brasil", documento: null, endereco: null, cidade: "São José do Rio Preto - SP" },
      destinatario: { nome: "Mercado Bom Preço", documento: null, endereco: null, cidade: "Mirassol - SP" },
      carga: { volumes: 3, peso: 120.5, cubagem: null, valorDaMercadoria: null },
      notas: [],
      frete: { valor: null, manual: false, tabela: null, composicao: [], condicaoDePagamento: null },
      viagem: null,
      motorista: null,
      cte: null,
      observacoes: null,
    } satisfies Minuta);
  });

  it("carga completa: partes, nota, frete com composição, viagem, CT-e e observação", () => {
    const minuta = montar({
      cubicMeters: 1.25,
      invoiceKey: CHAVE_NF,
      invoiceValue: 9876.5,
      freightValue: 350,
      freightDetails: { tabela: "Tabela 2026", composicao: [{ rotulo: "Frete peso", valor: 300 }, { rotulo: "Ad valorem", valor: 50 }], avisos: [] },
      pickupNotes: "  Procurar o João na doca 2  ",
      deliveryStreet: "Rua das Flores",
      deliveryNumber: "120",
      deliveryDistrict: "Centro",
      deliveryZip: "15130000",
      cteKey: CHAVE_CTE,
      cteNumber: 77,
      cteStatus: "ISSUED",
      client: { companyName: "Serilon Brasil Ltda", tradeName: "Serilon", cnpj: "11222333000181", address: "Av. Industrial, 500", paymentCondition: "28 dias" },
      driver: { user: { name: "Motorista da carga" } },
      manifest: { id: "ab12cd34-0000-4000-8000-000000000000", driver: { user: { name: "José da Viagem" } }, vehicle: { plate: "ABC1D23", model: "VW Delivery" } },
      fiscalDocuments: [nota()],
    });

    expect(minuta.pagador).toEqual({ nome: "Serilon Brasil Ltda", documento: "11222333000181", endereco: "Av. Industrial, 500" });
    expect(minuta.remetente).toEqual({ nome: "Serilon Brasil", documento: "11222333000181", endereco: "Av. Industrial, 500 - Distrito", cidade: "São José do Rio Preto - SP" });
    // O endereço da entrega vale mais que o da nota.
    expect(minuta.destinatario).toEqual({ nome: "Mercado Bom Preço", documento: "52998224725", endereco: "Rua das Flores, 120 - Centro, Mirassol - SP, 15130-000", cidade: "Mirassol - SP" });
    expect(minuta.carga).toEqual({ volumes: 3, peso: 120.5, cubagem: 1.25, valorDaMercadoria: 9876.5 });
    // A chave digitada é a da nota importada: aparece uma vez só, com o número.
    expect(minuta.notas).toEqual([{ numero: "123/1", chave: CHAVE_NF }]);
    expect(minuta.frete).toEqual({
      valor: 350,
      manual: false,
      tabela: "Tabela 2026",
      composicao: [{ rotulo: "Frete peso", valor: 300 }, { rotulo: "Ad valorem", valor: 50 }],
      condicaoDePagamento: "28 dias",
    });
    expect(minuta.viagem).toEqual({ codigo: "AB12CD", placa: "ABC1D23", veiculo: "VW Delivery" });
    // Em viagem, o motorista é o da viagem.
    expect(minuta.motorista).toBe("José da Viagem");
    expect(minuta.cte).toEqual({ numero: 77, chave: CHAVE_CTE });
    expect(minuta.observacoes).toBe("Procurar o João na doca 2");
  });

  it("perfil que não vê frete: some o valor, a composição e a condição de pagamento, e nada mais", () => {
    const dados = { freightValue: 350, freightDetails: { tabela: "T", composicao: [{ rotulo: "Frete peso", valor: 350 }] }, invoiceValue: 1000 };
    const sem = montar(dados, false);
    const com = montar(dados, true);
    expect(sem.frete).toBeNull();
    expect(JSON.stringify(sem)).not.toMatch(/350|Frete peso|condicaoDePagamento/);
    expect({ ...com, frete: null }).toEqual(sem);
    // O valor da mercadoria não é frete: fica.
    expect(sem.carga.valorDaMercadoria).toBe(1000);
  });

  it("quem vê o frete na minuta é quem lê cargas: toda a equipe interna, e ninguém de fora", () => {
    for (const perfil of PERFIS) expect(verFreteNaMinuta(perfil), perfil).toBe(pode(perfil, "coletasVer"));
    for (const perfil of PERFIS_INTERNOS) expect(verFreteNaMinuta(perfil), perfil).toBe(true);
    for (const perfil of ["DRIVER", "CLIENT", "", null, undefined, "QUALQUER"]) expect(verFreteNaMinuta(perfil), String(perfil)).toBe(false);
  });

  it("frete informado à mão não leva composição; frete a cotar não leva valor", () => {
    const detalhes = { tabela: "Tabela 2026", composicao: [{ rotulo: "Frete peso", valor: 300 }] };
    expect(montar({ freightValue: 500, freightManual: true, freightDetails: detalhes }).frete).toEqual({ valor: 500, manual: true, tabela: null, composicao: [], condicaoDePagamento: null });
    expect(montar({ freightValue: null, freightDetails: detalhes }).frete).toEqual({ valor: null, manual: false, tabela: null, composicao: [], condicaoDePagamento: null });
  });

  it("composição do frete: JSON fora do formato é ignorado, sem quebrar", () => {
    expect(composicaoDoFrete(null)).toEqual({ tabela: null, composicao: [] });
    expect(composicaoDoFrete("texto")).toEqual({ tabela: null, composicao: [] });
    expect(composicaoDoFrete({ tabela: 7, composicao: "x" })).toEqual({ tabela: null, composicao: [] });
    expect(composicaoDoFrete({ tabela: " ", composicao: [null, { rotulo: "Sem valor" }, { rotulo: 1, valor: 2 }, { rotulo: "Infinito", valor: Infinity }, { rotulo: "Pedágio", valor: 12.5 }] })).toEqual({
      tabela: null,
      composicao: [{ rotulo: "Pedágio", valor: 12.5 }],
    });
  });

  it("documento e endereço da nota só valem se o nome na nota é o da carga", () => {
    const minuta = montar({ fiscalDocuments: [nota({ issuerName: "Outro Emitente SA", recipientName: "Outro Destinatário" })] });
    expect(minuta.remetente).toMatchObject({ documento: null, endereco: null });
    expect(minuta.destinatario).toMatchObject({ documento: null, endereco: null });
    // A nota continua listada: ela é da carga.
    expect(minuta.notas).toEqual([{ numero: "123/1", chave: CHAVE_NF }]);

    // Maiúsculas e espaços não separam o mesmo nome; sem endereço de entrega, vale o da nota.
    const igual = montar({ fiscalDocuments: [nota({ issuerName: " SERILON BRASIL ", recipientName: "mercado bom preço" })] });
    expect(igual.remetente.documento).toBe("11222333000181");
    expect(igual.destinatario).toMatchObject({ documento: "52998224725", endereco: "Rua da Nota, 9 - Centro" });
  });

  it("notas: as importadas com número e série; a chave digitada, sem número, só quando não é de uma importada", () => {
    expect(notasDaMinuta({ invoiceKey: null, fiscalDocuments: [] })).toEqual([]);
    expect(notasDaMinuta({ invoiceKey: " ", fiscalDocuments: [] })).toEqual([]);
    expect(notasDaMinuta({ invoiceKey: CHAVE_NF, fiscalDocuments: [] })).toEqual([{ numero: null, chave: CHAVE_NF }]);
    expect(notasDaMinuta({ invoiceKey: CHAVE_CTE, fiscalDocuments: [nota(), nota({ number: 124, accessKey: "2".repeat(44) })] })).toEqual([
      { numero: "123/1", chave: CHAVE_NF },
      { numero: "124/1", chave: "2".repeat(44) },
      { numero: null, chave: CHAVE_CTE },
    ]);
  });

  it("CT-e: só o que tem valor fiscal (registrado ou autorizado); pendente e cancelado ficam de fora", () => {
    expect(montar({ cteKey: CHAVE_CTE, cteNumber: null, cteStatus: "ISSUED" }).cte).toEqual({ numero: null, chave: CHAVE_CTE });
    expect(montar({ cteKey: CHAVE_CTE, cteNumber: 77, cteStatus: "CANCELLED" }).cte).toBeNull();
    expect(montar({ cteKey: null, cteNumber: 77, cteStatus: "PENDING" }).cte).toBeNull();
  });

  it("fora de viagem vale o motorista alocado na carga; sem código de rastreio a minuta sai sem número", () => {
    const minuta = montar({ driver: { user: { name: "Motorista da carga" } }, trackingCode: null });
    expect(minuta.viagem).toBeNull();
    expect(minuta.motorista).toBe("Motorista da carga");
    expect(minuta.codigo).toBeNull();
  });

  it("emissão no relógio do Brasil, chave em blocos de quatro e o aviso de que não é documento fiscal", () => {
    expect(dataDeEmissao("2026-10-10T17:32:00.000Z")).toMatch(/^10\/10\/2026,? 14:32$/);
    // Meia-noite e meia UTC ainda é o dia anterior no Brasil.
    expect(dataDeEmissao(new Date("2026-10-11T00:30:00.000Z"))).toMatch(/^10\/10\/2026,? 21:30$/);
    expect(dataDeEmissao("não é data")).toBe("");
    expect(chaveEmBlocos(CHAVE_NF)).toBe("3526 1099 3131 3100 0101 5500 1000 0001 2310 0000 1239");
    expect(chaveEmBlocos("")).toBe("");
    expect(AVISO_SEM_VALOR_FISCAL).toBe("Documento sem valor fiscal. Não substitui o CT-e.");
  });
});

/* ------------------------------------ Rota ------------------------------------ */

// Tudo o que esta suite cria usa estes marcadores, e só isso é apagado.
const PREFIXO = "teste-minuta-";
const CNPJ = "99313131000101";
const CNPJ_DA_OUTRA = "99313131000282";
const CPF = "99313131001";
const PLACA = "MNT1A31";
const HASH_FALSO = "$2b$10$hashfalsoparateste000000000000000000000000000000000";
const RASTREIO = { COMPLETA: "9931313101", SIMPLES: "9931313102", DA_OUTRA: "9931313103" };
const SEM_CARGA = "00000000-0000-0000-0000-000000000000";

suite("minuta de despacho: rota, permissão por perfil e isolamento entre empresas", () => {
  let banco: typeof import("../src/lib/prisma");
  let rota: typeof import("../src/app/api/coletas/[id]/minuta/route");
  let lista: typeof import("../src/app/api/coletas/route");

  const sessao = vi.mocked(getServerSession);
  const ids = Object.fromEntries(PERFIS.map((perfil) => [perfil, ""])) as Record<(typeof PERFIS)[number], string>;
  let adminDaOutra: string;
  let viagemId: string;
  const cargas = { COMPLETA: "", SIMPLES: "", DA_OUTRA: "" };

  const entrarComo = (quem: keyof typeof ids | null) => sessao.mockResolvedValue(quem ? { user: { id: ids[quem], role: quem, clientId: null } } : null);
  const entrarNaOutra = () => sessao.mockResolvedValue({ user: { id: adminDaOutra, role: "ADMIN", clientId: null, tenantId: EMPRESA_OUTRA.id } });

  const ver = async (id: string) => {
    const res = await rota.GET(new Request("http://localhost/api/teste"), { params: Promise.resolve({ id }) });
    return { status: res.status, corpo: (await res.json()) as Minuta & { error?: string } };
  };

  async function limpar() {
    const { sistema } = banco;
    await sistema.fiscalDocument.deleteMany({ where: { accessKey: CHAVE_NF } });
    await sistema.collection.deleteMany({ where: { client: { cnpj: { in: [CNPJ, CNPJ_DA_OUTRA] } } } });
    await sistema.manifest.deleteMany({ where: { vehicle: { plate: PLACA } } });
    await sistema.vehicle.deleteMany({ where: { plate: PLACA } });
    await sistema.driver.deleteMany({ where: { cpf: CPF } });
    await sistema.user.deleteMany({ where: { email: { startsWith: PREFIXO } } });
    await sistema.client.deleteMany({ where: { cnpj: { in: [CNPJ, CNPJ_DA_OUTRA] } } });
  }

  const carga = (clientId: string, trackingCode: string, extra: Record<string, unknown> = {}) => ({
    clientId,
    sender: `${PREFIXO}remetente`,
    receiver: `${PREFIXO}destinatário`,
    origin: "Rio Preto - SP",
    destination: "Mirassol - SP",
    volumes: 3,
    weight: 30,
    status: "CONFIRMED",
    trackingCode,
    ...extra,
  });

  beforeAll(async () => {
    banco = await import("../src/lib/prisma");
    rota = await import("../src/app/api/coletas/[id]/minuta/route");
    lista = await import("../src/app/api/coletas/route");
    await limpar();

    const db = banco.default;
    const cliente = await db.client.create({
      data: { companyName: `${PREFIXO}cliente ltda`, tradeName: `${PREFIXO}cliente`, cnpj: CNPJ, address: "Av. do Cliente, 10", paymentCondition: "28 dias" },
    });
    for (const perfil of PERFIS) {
      ids[perfil] = (
        await db.user.create({
          data: { name: `${PREFIXO}${perfil}`, email: `${PREFIXO}${perfil.toLowerCase()}@exemplo.br`, password: HASH_FALSO, role: perfil, clientId: perfil === "CLIENT" ? cliente.id : undefined },
        })
      ).id;
    }

    const motorista = await db.driver.create({ data: { userId: ids.DRIVER, cpf: CPF, cnh: "99313131001", cnhExpiry: new Date("2031-01-01T00:00:00.000Z"), category: "C", commissionPct: 7.5 } });
    const veiculo = await db.vehicle.create({ data: { plate: PLACA, model: `${PREFIXO}caminhão`, type: "TRUCK" } });
    viagemId = (await db.manifest.create({ data: { driverId: motorista.id, vehicleId: veiculo.id, status: "ASSEMBLING" } })).id;

    cargas.COMPLETA = (
      await db.collection.create({
        data: carga(cliente.id, RASTREIO.COMPLETA, {
          manifestId: viagemId,
          cubicMeters: 1.5,
          invoiceKey: CHAVE_NF,
          invoiceValue: 98765.43,
          freightValue: 4321.09,
          freightDetails: { tabela: `${PREFIXO}tabela`, composicao: [{ rotulo: "Frete peso", valor: 4000 }, { rotulo: "Ad valorem", valor: 321.09 }], avisos: [] },
          pickupNotes: "Procurar a doca 2",
          deliveryStreet: "Rua das Flores",
          deliveryNumber: "120",
          deliveryDistrict: "Centro",
          deliveryZip: "15130000",
          cteKey: CHAVE_CTE,
          cteNumber: 77,
          cteStatus: "ISSUED",
        }),
      })
    ).id;
    await db.fiscalDocument.create({
      data: {
        accessKey: CHAVE_NF,
        number: 123,
        series: 1,
        issuerTaxId: CNPJ,
        issuerName: `${PREFIXO}remetente`,
        issuerAddress: "Av. do Emitente, 500",
        recipientTaxId: "52998224725",
        recipientName: `${PREFIXO}destinatário`,
        totalValue: 98765.43,
        xml: "<nfe/>",
        collectionId: cargas.COMPLETA,
      },
    });
    cargas.SIMPLES = (await db.collection.create({ data: carga(cliente.id, RASTREIO.SIMPLES) })).id;

    const outra = banco.paraEmpresa(EMPRESA_OUTRA.id).db;
    const clienteDaOutra = await outra.client.create({ data: { companyName: `${PREFIXO}cliente da outra`, cnpj: CNPJ_DA_OUTRA } });
    adminDaOutra = (await outra.user.create({ data: { name: `${PREFIXO}admin da outra`, email: `${PREFIXO}admin-outra@exemplo.br`, password: HASH_FALSO, role: "ADMIN" } })).id;
    cargas.DA_OUTRA = (await outra.collection.create({ data: carga(clienteDaOutra.id, RASTREIO.DA_OUTRA, { freightValue: 111.11 }) })).id;
  });

  beforeEach(() => {
    sessao.mockReset();
  });

  afterAll(async () => {
    if (banco) await limpar();
  });

  it("sem sessão é 401; motorista e cliente são 403; toda a equipe interna lê", async () => {
    entrarComo(null);
    expect((await ver(cargas.COMPLETA)).status).toBe(401);

    for (const perfil of ["DRIVER", "CLIENT"] as const) {
      entrarComo(perfil);
      const { status, corpo } = await ver(cargas.COMPLETA);
      expect(status, perfil).toBe(403);
      expect(JSON.stringify(corpo), perfil).not.toContain(RASTREIO.COMPLETA);
    }

    for (const perfil of PERFIS_INTERNOS) {
      entrarComo(perfil);
      const { status, corpo } = await ver(cargas.COMPLETA);
      expect(status, perfil).toBe(200);
      expect(corpo.codigo, perfil).toBe(RASTREIO.COMPLETA);
    }
  });

  it("a minuta completa traz a empresa, as partes, a carga, a nota, o frete, a viagem e o CT-e", async () => {
    entrarComo("ADMIN");
    const antes = Date.now();
    const { status, corpo } = await ver(cargas.COMPLETA);
    expect(status).toBe(200);

    // O nome e o símbolo são os do cadastro da empresa da sessão (Empresa → identidade).
    const empresa = await banco.sistema.tenant.findUniqueOrThrow({ where: { id: EMPRESA_PADRAO.id }, select: { name: true, logo: true } });
    expect(corpo.empresa).toEqual(empresa);
    expect(new Date(corpo.emitidaEm).getTime()).toBeGreaterThanOrEqual(antes - 1000);
    expect(new Date(corpo.emitidaEm).getTime()).toBeLessThanOrEqual(Date.now() + 1000);

    expect(corpo.pagador).toEqual({ nome: `${PREFIXO}cliente ltda`, documento: CNPJ, endereco: "Av. do Cliente, 10" });
    expect(corpo.remetente).toEqual({ nome: `${PREFIXO}remetente`, documento: CNPJ, endereco: "Av. do Emitente, 500", cidade: "Rio Preto - SP" });
    expect(corpo.destinatario).toEqual({ nome: `${PREFIXO}destinatário`, documento: "52998224725", endereco: "Rua das Flores, 120 - Centro, Mirassol - SP, 15130-000", cidade: "Mirassol - SP" });
    expect(corpo.carga).toEqual({ volumes: 3, peso: 30, cubagem: 1.5, valorDaMercadoria: 98765.43 });
    expect(corpo.notas).toEqual([{ numero: "123/1", chave: CHAVE_NF }]);
    expect(corpo.frete).toEqual({
      valor: 4321.09,
      manual: false,
      tabela: `${PREFIXO}tabela`,
      composicao: [{ rotulo: "Frete peso", valor: 4000 }, { rotulo: "Ad valorem", valor: 321.09 }],
      condicaoDePagamento: "28 dias",
    });
    expect(corpo.viagem).toEqual({ codigo: viagemId.substring(0, 6).toUpperCase(), placa: PLACA, veiculo: `${PREFIXO}caminhão` });
    expect(corpo.motorista).toBe(`${PREFIXO}DRIVER`);
    expect(corpo.cte).toEqual({ numero: 77, chave: CHAVE_CTE });
    expect(corpo.observacoes).toBe("Procurar a doca 2");

    // Nada além da folha: nem o XML da nota, nem a comissão ou o CPF do motorista, nem ids internos.
    const texto = JSON.stringify(corpo);
    expect(texto).not.toMatch(/<nfe|commission|password/i);
    expect(texto).not.toContain(CPF);
    expect(texto).not.toContain(cargas.COMPLETA);
  });

  it("a carga simples sai sem o que ela não tem", async () => {
    entrarComo("OPERATION");
    const { status, corpo } = await ver(cargas.SIMPLES);
    expect(status).toBe(200);
    expect(corpo).toMatchObject({
      codigo: RASTREIO.SIMPLES,
      remetente: { documento: null, endereco: null },
      destinatario: { documento: null, endereco: null },
      carga: { volumes: 3, peso: 30, cubagem: null, valorDaMercadoria: null },
      notas: [],
      frete: { valor: null, manual: false, tabela: null, composicao: [], condicaoDePagamento: "28 dias" },
      viagem: null,
      motorista: null,
      cte: null,
      observacoes: null,
    });
  });

  it("o frete na minuta acompanha a lista de minutas: o perfil que o vê lá o vê aqui", async () => {
    for (const perfil of PERFIS_INTERNOS) {
      entrarComo(perfil);
      const resLista = await lista.GET();
      expect(resLista.status, perfil).toBe(200);
      const naLista = ((await resLista.json()) as { id: string; freightValue?: number | null }[]).find((c) => c.id === cargas.COMPLETA);
      const veNaLista = naLista?.freightValue === 4321.09;

      const { corpo } = await ver(cargas.COMPLETA);
      expect(corpo.frete !== null, perfil).toBe(veNaLista);
      expect(verFreteNaMinuta(perfil), perfil).toBe(veNaLista);
      if (corpo.frete) expect(corpo.frete.valor, perfil).toBe(4321.09);
    }
  });

  it("carga inexistente é 404", async () => {
    entrarComo("ADMIN");
    const { status, corpo } = await ver(SEM_CARGA);
    expect(status).toBe(404);
    expect(corpo.error).toBe("Carga não encontrada.");
  });

  it("isolamento: carga de outra empresa não existe para esta, e cada uma sai com o nome da sua", async () => {
    entrarComo("ADMIN");
    const daqui = await ver(cargas.DA_OUTRA);
    expect(daqui.status).toBe(404);
    expect(JSON.stringify(daqui.corpo)).not.toMatch(new RegExp(`${RASTREIO.DA_OUTRA}|111\\.11`));

    entrarNaOutra();
    const deLa = await ver(cargas.DA_OUTRA);
    expect(deLa.status).toBe(200);
    expect(deLa.corpo.codigo).toBe(RASTREIO.DA_OUTRA);
    const outraEmpresa = await banco.sistema.tenant.findUniqueOrThrow({ where: { id: EMPRESA_OUTRA.id }, select: { name: true } });
    expect(deLa.corpo.empresa.name).toBe(outraEmpresa.name);
    expect(outraEmpresa.name).not.toBe((await banco.sistema.tenant.findUniqueOrThrow({ where: { id: EMPRESA_PADRAO.id }, select: { name: true } })).name);
    expect(deLa.corpo.frete?.valor).toBe(111.11);

    for (const id of [cargas.COMPLETA, cargas.SIMPLES]) expect((await ver(id)).status).toBe(404);
  });
});
