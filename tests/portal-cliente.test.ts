import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getServerSession } from "next-auth";
import {
  CABECALHO_DO_CSV,
  MAX_DESTINATARIOS,
  alterarDestinatarioSchema,
  celulaDeTexto,
  cidadesAtendidas,
  cotacaoDoPortalSchema,
  cotacaoParaOCliente,
  criarDestinatarioSchema,
  csvDasColetas,
  periodoDaExportacao,
  prazoPorExtenso,
} from "../src/lib/portal-cliente";
import { JANELA_INVERTIDA, janelaDaColeta, janelaInvertida, pedidoDeColetaSchema } from "../src/lib/coletas";
import { calcularFrete, chaveDaCidade, type TabelaDeFrete } from "../src/lib/frete";
import { EMPRESA_OUTRA, EMPRESA_PADRAO } from "./empresas-de-teste";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

const cidade = (city: string, minimum: number, deadlineHours = 24, dedicated = false) => ({ city, cityKey: chaveDaCidade(city), minimum, deadlineHours, dedicated });

const TABELA: TabelaDeFrete = {
  id: "t1",
  name: "Tabela secreta do cliente",
  includedWeightKg: 100,
  excessPerKg: 1.5,
  cubageFactor: 300,
  invoiceLimit: 1000,
  adValoremPct: 0.5,
  maxVolumes: 10,
  cities: [cidade("Mirassol", 80), cidade("Bady Bassitt", 60, 48, true), cidade("Álvares Florence", 120, 72)],
};

describe("cotação pelo portal", () => {
  it("devolve só valor, prazo, cidade e avisos: a composição e o peso taxável ficam com a transportadora", () => {
    const frete = calcularFrete(TABELA, "mirassol - sp", { peso: 150, volumes: 12, valorNota: 3000 });
    const resposta = cotacaoParaOCliente(frete);

    expect(resposta).toEqual({
      atendida: true,
      cidade: "Mirassol",
      // 80 do mínimo + 50 kg × 1,50 + 0,5% de 2.000
      valor: 165,
      prazoHoras: 24,
      avisos: ["A tabela cobre até 10 volumes; esta carga tem 12."],
    });
    const texto = JSON.stringify(resposta);
    for (const interno of ["composicao", "pesoTaxavel", "rotulo", "Tabela secreta"]) expect(texto).not.toContain(interno);
  });

  it("sem tabela e cidade fora da tabela saem sem valor, cada uma com o seu motivo", () => {
    expect(cotacaoParaOCliente(null)).toEqual({ atendida: false, motivo: "sem_tabela" });
    expect(cotacaoParaOCliente(calcularFrete(TABELA, "Cidade Que Não Existe", { peso: 10 }))).toEqual({ atendida: false, motivo: "fora_da_tabela" });
  });

  it("valida o pedido: destino, peso e volumes obrigatórios; nota e cubagem opcionais", () => {
    expect(cotacaoDoPortalSchema.parse({ destination: " Mirassol ", weight: "12,5", volumes: "3", invoiceValue: "", cubicMeters: "0,8" })).toEqual({
      destination: "Mirassol",
      weight: 12.5,
      volumes: 3,
      invoiceValue: null,
      cubicMeters: 0.8,
    });
    for (const corpo of [
      null,
      {},
      { destination: "", weight: 1, volumes: 1 },
      { destination: "Mirassol", weight: 0, volumes: 1 },
      { destination: "Mirassol", weight: "1e3", volumes: 1 },
      { destination: "Mirassol", weight: 1, volumes: 0 },
      { destination: "Mirassol", weight: 1, volumes: 1.5 },
      { destination: "Mirassol", weight: 1, volumes: 1, invoiceValue: -1 },
      { destination: "Mirassol", weight: 1, volumes: 1, cubicMeters: 0 },
    ]) {
      expect(cotacaoDoPortalSchema.safeParse(corpo).success, JSON.stringify(corpo)).toBe(false);
    }
  });

  it("prazo por extenso: horas até dois dias, depois em dias inteiros", () => {
    expect([1, 24, 36, 48, 72, 50].map(prazoPorExtenso)).toEqual(["1 hora", "24 horas", "36 horas", "2 dias", "3 dias", "50 horas"]);
  });
});

describe("tabela de frete que o cliente vê", () => {
  it("cidades em ordem alfabética, só com nome, mínimo, prazo e dedicado", () => {
    const cidades = cidadesAtendidas(TABELA);
    expect(cidades.map((c) => c.city)).toEqual(["Álvares Florence", "Bady Bassitt", "Mirassol"]);
    for (const linha of cidades) expect(Object.keys(linha).sort()).toEqual(["city", "deadlineHours", "dedicated", "minimum"]);
    expect(cidades[1]).toEqual({ city: "Bady Bassitt", minimum: 60, deadlineHours: 48, dedicated: true });
    expect(cidadesAtendidas(null)).toEqual([]);
  });
});

describe("destinatário frequente: validação", () => {
  it("aceita o cadastro, guarda só os dígitos do documento e transforma vazio em nulo", () => {
    expect(
      criarDestinatarioSchema.parse({ name: "  Loja do Zé  ", document: "11.222.333/0001-81", city: "Mirassol - SP", address: "", contactName: " Zé ", phone: "" }),
    ).toEqual({ name: "Loja do Zé", document: "11222333000181", city: "Mirassol - SP", address: null, contactName: "Zé", phone: null });
    expect(criarDestinatarioSchema.parse({ name: "Loja", city: "Mirassol" })).toEqual({ name: "Loja", city: "Mirassol" });
    expect(criarDestinatarioSchema.parse({ name: "Loja", city: "Mirassol", document: "529.982.247-25" }).document).toBe("52998224725");
    expect(criarDestinatarioSchema.parse({ name: "Loja", city: "Mirassol", document: "" }).document).toBeNull();
  });

  it("recusa sem nome, sem cidade, documento de tamanho errado e texto longo demais", () => {
    for (const corpo of [
      null,
      {},
      { name: "", city: "Mirassol" },
      { name: "Loja" },
      { name: "Loja", city: "" },
      { name: "Loja", city: "Mirassol", document: "123" },
      { name: "x".repeat(201), city: "Mirassol" },
      { name: "Loja", city: "Mirassol", address: "x".repeat(301) },
    ]) {
      expect(criarDestinatarioSchema.safeParse(corpo).success, JSON.stringify(corpo)).toBe(false);
    }
    expect(alterarDestinatarioSchema.safeParse({}).success).toBe(false);
    expect(alterarDestinatarioSchema.parse({ phone: "17 3333-0000" })).toEqual({ phone: "17 3333-0000" });
  });
});

describe("pedido de coleta: janela, prioridade, cubagem e observação", () => {
  it("tudo opcional; vazio vira nulo; a data é um dia do calendário, à meia-noite UTC", () => {
    expect(pedidoDeColetaSchema.parse({})).toEqual({});
    expect(pedidoDeColetaSchema.parse({ pickupDate: "", pickupFrom: "", pickupTo: " ", cubicMeters: "", pickupNotes: "  " })).toEqual({
      pickupDate: null,
      pickupFrom: null,
      pickupTo: null,
      cubicMeters: null,
      pickupNotes: null,
    });
    expect(
      pedidoDeColetaSchema.parse({ pickupDate: "2026-10-12", pickupFrom: "08:00", pickupTo: "12:30", priority: "URGENT", cubicMeters: "1,25", pickupNotes: " Doca 2 " }),
    ).toEqual({ pickupDate: new Date("2026-10-12T00:00:00.000Z"), pickupFrom: "08:00", pickupTo: "12:30", priority: "URGENT", cubicMeters: 1.25, pickupNotes: "Doca 2" });
  });

  it("recusa dia que não existe, hora fora do formato, prioridade desconhecida, cubagem zero e observação longa", () => {
    for (const corpo of [
      { pickupDate: "2026-02-31" },
      { pickupDate: "12/10/2026" },
      { pickupFrom: "8:00" },
      { pickupTo: "25:00" },
      { pickupTo: "12:60" },
      { priority: "ALTA" },
      { cubicMeters: 0 },
      { cubicMeters: "abc" },
      { pickupNotes: "x".repeat(501) },
    ]) {
      expect(pedidoDeColetaSchema.safeParse(corpo).success, JSON.stringify(corpo)).toBe(false);
    }
  });

  it("janela: o fim precisa ser depois do início; com um lado só, vale", () => {
    expect(janelaInvertida("08:00", "12:00")).toBe(false);
    expect(janelaInvertida("12:00", "08:00")).toBe(true);
    expect(janelaInvertida("08:00", "08:00")).toBe(true);
    for (const [de, ate] of [[null, "12:00"], ["08:00", null], [undefined, undefined]] as const) expect(janelaInvertida(de, ate)).toBe(false);
  });

  it("a janela por extenso, com o que foi informado", () => {
    const dia = "2026-10-12T00:00:00.000Z";
    expect(janelaDaColeta({ pickupDate: dia, pickupFrom: "08:00", pickupTo: "12:00" })).toBe("12/10 das 08:00 às 12:00");
    expect(janelaDaColeta({ pickupDate: new Date(dia) })).toBe("12/10");
    expect(janelaDaColeta({ pickupFrom: "08:00" })).toBe("a partir das 08:00");
    expect(janelaDaColeta({ pickupTo: "17:00" })).toBe("até as 17:00");
    expect(janelaDaColeta({})).toBe("");
  });
});

describe("exportação das coletas em CSV", () => {
  it("período: sem datas vale os últimos 30 dias no relógio do Brasil; os instantes cobrem os dias inteiros", () => {
    // 01:30 UTC do dia 11 ainda é dia 10 no Brasil.
    const hoje = new Date("2026-10-11T01:30:00.000Z");
    expect(periodoDaExportacao(null, null, hoje)).toEqual({
      ok: true,
      de: "2026-09-11",
      ate: "2026-10-10",
      inicio: new Date("2026-09-11T03:00:00.000Z"),
      fim: new Date("2026-10-11T03:00:00.000Z"),
    });
    expect(periodoDaExportacao("2026-01-01", "2026-01-01", hoje)).toMatchObject({
      inicio: new Date("2026-01-01T03:00:00.000Z"),
      fim: new Date("2026-01-02T03:00:00.000Z"),
    });
    // Só o fim informado: 30 dias até ele.
    expect(periodoDaExportacao("", "2026-03-31", hoje)).toMatchObject({ de: "2026-03-02", ate: "2026-03-31" });
  });

  it("período: recusa data inválida, início depois do fim e mais de 366 dias", () => {
    for (const [de, ate] of [
      ["2026-02-31", "2026-03-01"],
      ["ontem", "2026-03-01"],
      ["2026-03-02", "2026-03-01"],
      ["2025-01-01", "2026-03-01"],
    ]) {
      expect(periodoDaExportacao(de, ate).ok, `${de} a ${ate}`).toBe(false);
    }
    expect(periodoDaExportacao("2025-10-11", "2026-10-11").ok).toBe(true);
  });

  it("célula: entre aspas, aspas dobradas, sem quebra de linha, e fórmula neutralizada com apóstrofo", () => {
    expect(celulaDeTexto("Loja do Zé")).toBe('"Loja do Zé"');
    expect(celulaDeTexto('Loja "A"; filial')).toBe('"Loja ""A""; filial"');
    expect(celulaDeTexto("linha 1\r\nlinha 2")).toBe('"linha 1 linha 2"');
    expect(celulaDeTexto(null)).toBe('""');
    for (const perigo of ["=HYPERLINK(\"http://x\")", "+55 17", "-1+1", "@SUM(A1)", "  =2+2", "\t=2+2"]) {
      expect(celulaDeTexto(perigo).startsWith(`"'`), perigo).toBe(true);
    }
    // Sinal no meio do texto não é fórmula.
    expect(celulaDeTexto("A = B")).toBe('"A = B"');
  });

  it("arquivo: BOM, cabeçalho, separador ponto e vírgula, CRLF, vírgula decimal e frete a cotar", () => {
    const csv = csvDasColetas([
      { trackingCode: "1234567890", createdAt: "2026-10-10T02:00:00.000Z", destination: "Mirassol - SP", receiver: "=cmd|' /C calc'!A0", volumes: 3, weight: 12.5, freightValue: 1234.5, status: "DELIVERED" },
      { trackingCode: null, createdAt: new Date("2026-10-10T15:00:00.000Z"), destination: "Bady; Bassitt", receiver: "Loja", volumes: 1, weight: 40, freightValue: null, status: "PENDING" },
    ]);

    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.endsWith("\r\n")).toBe(true);
    const linhas = csv.slice(1).trimEnd().split("\r\n");
    expect(linhas).toHaveLength(3);
    expect(linhas[0]).toBe(CABECALHO_DO_CSV.map((titulo) => `"${titulo}"`).join(";"));
    // 02:00 UTC do dia 10 ainda é dia 9 no Brasil.
    expect(linhas[1]).toBe(`"1234567890";"09/10/2026";"Mirassol - SP";"'=cmd|' /C calc'!A0";3;12,5;1234,50;"Entregue"`);
    expect(linhas[2]).toBe(`"";"10/10/2026";"Bady; Bassitt";"Loja";1;40;"A cotar";"Aguardando confirmação"`);

    // Sem coleta no período, o arquivo sai só com o cabeçalho.
    expect(csvDasColetas([]).slice(1)).toBe(`${linhas[0]}\r\n`);
  });
});

/** As rotas do portal, contra um Postgres de verdade. */
const temBanco = Boolean(process.env.DATABASE_URL);

if (!temBanco) {
  console.warn("\n[portal-cliente.test] DATABASE_URL ausente: testes de integração PULADOS.\n");
}

const suite = temBanco ? describe : describe.skip;

const PREFIXO = "teste-portalcliente-";
const CNPJ_A = "99525252000111";
const CNPJ_B = "99525252000202";
const CNPJ_DA_OUTRA = "99525252000393";
const HASH_FALSO = "$2b$10$hashfalsoparateste000000000000000000000000000000000";
const ID_INEXISTENTE = "00000000-0000-4000-8000-000000000000";

suite("portal do cliente: cotação, tabela, destinatários, pedido e exportação", () => {
  let banco: typeof import("../src/lib/prisma");
  let cotacao: typeof import("../src/app/api/portal/cotacao/route");
  let tabelaDoPortal: typeof import("../src/app/api/portal/tabela-frete/route");
  let destinatarios: typeof import("../src/app/api/portal/destinatarios/route");
  let destinatarioPorId: typeof import("../src/app/api/portal/destinatarios/[id]/route");
  let coletasDoPortal: typeof import("../src/app/api/portal/coletas/route");
  let coletaDoPortal: typeof import("../src/app/api/portal/coletas/[id]/route");
  let exportar: typeof import("../src/app/api/portal/coletas/exportar/route");
  let coletas: typeof import("../src/app/api/coletas/route");
  let coletaPorId: typeof import("../src/app/api/coletas/[id]/route");

  const sessao = vi.mocked(getServerSession);
  const ids = { ADMIN: "", OPERATION: "", DRIVER: "", CLIENTE_A: "", CLIENTE_B: "", SEM_EMPRESA: "" };
  const papel = { ADMIN: "ADMIN", OPERATION: "OPERATION", DRIVER: "DRIVER", CLIENTE_A: "CLIENT", CLIENTE_B: "CLIENT", SEM_EMPRESA: "CLIENT" } as const;
  let clienteA: string;
  let clienteB: string;
  let clienteDaOutra: string;
  let destinatarioDaOutra: string;

  const entrarComo = (quem: keyof typeof ids | null) =>
    sessao.mockResolvedValue(quem ? { user: { id: ids[quem], role: papel[quem], clientId: null } } : null);

  const req = (metodo: string, corpo?: unknown, endereco = "http://localhost/api/teste") =>
    new Request(endereco, {
      method: metodo,
      headers: { "Content-Type": "application/json" },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

  const cotar = async (quem: keyof typeof ids, corpo: unknown) => {
    entrarComo(quem);
    const res = await cotacao.POST(req("POST", corpo));
    return { status: res.status, corpo: (await res.json()) as Record<string, unknown> };
  };

  const pedir = async (quem: keyof typeof ids, corpo: Record<string, unknown>) => {
    entrarComo(quem);
    const res = await coletasDoPortal.POST(req("POST", { sender: "Fábrica", receiver: "Loja", origin: "Rio Preto - SP", destination: "Mirassol - SP", volumes: 2, weight: 50, ...corpo }));
    return { status: res.status, corpo: (await res.json()) as { error?: string; collection?: Record<string, unknown> } };
  };

  const baixar = async (quem: keyof typeof ids | null, consulta = "") => {
    entrarComo(quem);
    return exportar.GET(req("GET", undefined, `http://localhost/api/portal/coletas/exportar${consulta}`));
  };

  async function limpar() {
    const cnpjs = [CNPJ_A, CNPJ_B, CNPJ_DA_OUTRA];
    await banco.sistema.clientReceiver.deleteMany({ where: { client: { cnpj: { in: cnpjs } } } });
    await banco.sistema.collection.deleteMany({ where: { client: { cnpj: { in: cnpjs } } } });
    await banco.sistema.auditLog.deleteMany({ where: { userName: { startsWith: PREFIXO } } });
    await banco.sistema.user.deleteMany({ where: { email: { startsWith: PREFIXO } } });
    await banco.sistema.client.deleteMany({ where: { cnpj: { in: cnpjs } } });
    await banco.sistema.freightTable.deleteMany({ where: { name: { startsWith: PREFIXO } } });
  }

  beforeAll(async () => {
    banco = await import("../src/lib/prisma");
    cotacao = await import("../src/app/api/portal/cotacao/route");
    tabelaDoPortal = await import("../src/app/api/portal/tabela-frete/route");
    destinatarios = await import("../src/app/api/portal/destinatarios/route");
    destinatarioPorId = await import("../src/app/api/portal/destinatarios/[id]/route");
    coletasDoPortal = await import("../src/app/api/portal/coletas/route");
    coletaDoPortal = await import("../src/app/api/portal/coletas/[id]/route");
    exportar = await import("../src/app/api/portal/coletas/exportar/route");
    coletas = await import("../src/app/api/coletas/route");
    coletaPorId = await import("../src/app/api/coletas/[id]/route");
    await limpar();

    // A tabela negociada com o cliente A e a padrão da transportadora (a do B).
    const negociada = await banco.default.freightTable.create({
      data: {
        name: `${PREFIXO}negociada com A`,
        includedWeightKg: 100,
        excessPerKg: 1,
        cubageFactor: 300,
        invoiceLimit: 1000,
        adValoremPct: 0.5,
        maxVolumes: 10,
        cities: { create: [{ city: "Mirassol", cityKey: chaveDaCidade("Mirassol"), minimum: 80, deadlineHours: 24 }] },
      },
    });
    await banco.default.freightTable.create({
      data: {
        name: `${PREFIXO}padrão`,
        isDefault: true,
        includedWeightKg: 50,
        excessPerKg: 2,
        cities: {
          create: [
            { city: "Mirassol", cityKey: chaveDaCidade("Mirassol"), minimum: 150, deadlineHours: 48 },
            { city: "Bady Bassitt", cityKey: chaveDaCidade("Bady Bassitt"), minimum: 60, deadlineHours: 24, dedicated: true },
          ],
        },
      },
    });

    clienteA = (await banco.default.client.create({ data: { companyName: `${PREFIXO}cliente A`, cnpj: CNPJ_A, freightTableId: negociada.id } })).id;
    clienteB = (await banco.default.client.create({ data: { companyName: `${PREFIXO}cliente B`, cnpj: CNPJ_B } })).id;

    for (const quem of ["ADMIN", "OPERATION", "DRIVER", "CLIENTE_A", "CLIENTE_B", "SEM_EMPRESA"] as const) {
      ids[quem] = (
        await banco.default.user.create({
          data: {
            name: `${PREFIXO}${quem}`,
            email: `${PREFIXO}${quem.toLowerCase()}@exemplo.br`,
            password: HASH_FALSO,
            role: papel[quem],
            clientId: quem === "CLIENTE_A" ? clienteA : quem === "CLIENTE_B" ? clienteB : null,
          },
        })
      ).id;
    }

    // Outra transportadora: um cliente, um destinatário e uma carga dela.
    const outra = banco.paraEmpresa(EMPRESA_OUTRA.id).db;
    clienteDaOutra = (await outra.client.create({ data: { companyName: `${PREFIXO}da outra`, cnpj: CNPJ_DA_OUTRA } })).id;
    destinatarioDaOutra = (await outra.clientReceiver.create({ data: { clientId: clienteDaOutra, name: "Destinatário da outra", city: "Campinas - SP" } })).id;
    await outra.collection.create({
      data: { clientId: clienteDaOutra, sender: "X", receiver: "Carga da outra transportadora", origin: "A", destination: "B", volumes: 1, weight: 1 },
    });
  });

  beforeEach(() => sessao.mockReset());

  afterAll(async () => {
    if (banco) await limpar();
  });

  it("só o cliente do portal entra nas rotas novas: sem sessão, equipe e motorista 401; cliente sem empresa 403", async () => {
    const rotas: [string, () => Promise<Response>][] = [
      ["POST cotacao", () => cotacao.POST(req("POST", { destination: "Mirassol", weight: 1, volumes: 1 }))],
      ["GET tabela-frete", () => tabelaDoPortal.GET()],
      ["GET destinatarios", () => destinatarios.GET()],
      ["POST destinatarios", () => destinatarios.POST(req("POST", { name: "Loja", city: "Mirassol" }))],
      ["PATCH destinatarios/[id]", () => destinatarioPorId.PATCH(req("PATCH", { name: "Loja" }), ctx(ID_INEXISTENTE))],
      ["DELETE destinatarios/[id]", () => destinatarioPorId.DELETE(req("DELETE"), ctx(ID_INEXISTENTE))],
      ["GET coletas/exportar", () => exportar.GET(req("GET"))],
    ];
    for (const [nome, chamar] of rotas) {
      for (const [quem, esperado] of [[null, 401], ["ADMIN", 401], ["OPERATION", 401], ["DRIVER", 401], ["SEM_EMPRESA", 403]] as const) {
        entrarComo(quem);
        expect((await chamar()).status, `${nome} como ${quem}`).toBe(esperado);
      }
    }
    expect(await banco.default.clientReceiver.count({ where: { clientId: { in: [clienteA, clienteB] } } })).toBe(0);
  });

  describe("cotação", () => {
    it("cada cliente cota pela tabela dele: A pela negociada, B pela padrão", async () => {
      const pedido = { destination: "mirassol/sp", weight: "50", volumes: "2" };
      const deA = await cotar("CLIENTE_A", pedido);
      const deB = await cotar("CLIENTE_B", pedido);

      expect(deA).toEqual({ status: 200, corpo: { atendida: true, cidade: "Mirassol", valor: 80, prazoHoras: 24, avisos: [] } });
      expect(deB).toEqual({ status: 200, corpo: { atendida: true, cidade: "Mirassol", valor: 150, prazoHoras: 48, avisos: [] } });
    });

    it("a resposta não entrega a regra da tabela: nem nome, nem composição, nem percentual", async () => {
      // 1 m³ × 300 = 300 kg cubados: 200 kg acima do coberto. Nota de 3.000: 0,5% de 2.000.
      const { corpo } = await cotar("CLIENTE_A", { destination: "Mirassol", weight: 50, volumes: 12, invoiceValue: 3000, cubicMeters: 1 });
      expect(corpo).toEqual({ atendida: true, cidade: "Mirassol", valor: 290, prazoHoras: 24, avisos: ["A tabela cobre até 10 volumes; esta carga tem 12."] });

      const texto = JSON.stringify(corpo);
      for (const interno of ["negociada", PREFIXO, "composicao", "pesoTaxavel", "0,5%", "tabela\":"]) expect(texto, interno).not.toContain(interno);
    });

    it("cidade fora da tabela do cliente sai sem valor, mesmo que esteja na tabela de outro", async () => {
      // Bady Bassitt só existe na padrão: A, com tabela própria, não é atendido lá.
      expect((await cotar("CLIENTE_A", { destination: "Bady Bassitt", weight: 10, volumes: 1 })).corpo).toEqual({ atendida: false, motivo: "fora_da_tabela" });
      expect((await cotar("CLIENTE_B", { destination: "Bady Bassitt", weight: 10, volumes: 1 })).corpo).toMatchObject({
        atendida: true,
        valor: 60,
        avisos: ["Bady Bassitt é atendida só com veículo dedicado."],
      });
    });

    it("pedido inválido é 400, e a cotação não grava nada", async () => {
      const antes = await banco.default.collection.count();
      for (const corpo of [null, {}, { destination: "Mirassol", weight: 0, volumes: 1 }, { destination: "Mirassol", weight: 10 }]) {
        expect((await cotar("CLIENTE_A", corpo)).status, JSON.stringify(corpo)).toBe(400);
      }
      await cotar("CLIENTE_A", { destination: "Mirassol", weight: 10, volumes: 1 });
      expect(await banco.default.collection.count()).toBe(antes);
    });
  });

  describe("tabela de frete", () => {
    const ver = async (quem: keyof typeof ids) => {
      entrarComo(quem);
      const res = await tabelaDoPortal.GET();
      expect(res.status).toBe(200);
      return (await res.json()) as { temTabela: boolean; cidades: Record<string, unknown>[] };
    };

    it("cada cliente vê as cidades da tabela dele, com mínimo e prazo, e nada das regras", async () => {
      const deA = await ver("CLIENTE_A");
      expect(deA).toEqual({ temTabela: true, cidades: [{ city: "Mirassol", minimum: 80, deadlineHours: 24, dedicated: false }] });

      const deB = await ver("CLIENTE_B");
      expect(deB.cidades).toEqual([
        { city: "Bady Bassitt", minimum: 60, deadlineHours: 24, dedicated: true },
        { city: "Mirassol", minimum: 150, deadlineHours: 48, dedicated: false },
      ]);

      for (const texto of [JSON.stringify(deA), JSON.stringify(deB)]) {
        for (const interno of [PREFIXO, "excessPerKg", "adValoremPct", "invoiceLimit", "cubageFactor", "includedWeightKg", "cityKey", "tenantId", "name"]) {
          expect(texto, interno).not.toContain(interno);
        }
      }
    });
  });

  describe("destinatários frequentes", () => {
    const listar = async (quem: keyof typeof ids) => {
      entrarComo(quem);
      return (await (await destinatarios.GET()).json()) as { id: string; name: string; city: string }[];
    };
    const criar = async (quem: keyof typeof ids, corpo: unknown) => {
      entrarComo(quem);
      const res = await destinatarios.POST(req("POST", corpo));
      return { status: res.status, corpo: (await res.json()) as Record<string, unknown> };
    };

    beforeEach(async () => {
      await banco.sistema.clientReceiver.deleteMany({ where: { clientId: { in: [clienteA, clienteB] } } });
    });

    it("o cliente cadastra, lista em ordem de nome, altera e apaga os seus", async () => {
      const loja = await criar("CLIENTE_A", { name: "Loja do Zé", document: "11.222.333/0001-81", city: "Mirassol - SP", address: "Rua 1, 100", contactName: "Zé", phone: "17 3333-0000" });
      expect(loja.status).toBe(201);
      expect(loja.corpo).toEqual({ id: expect.any(String), name: "Loja do Zé", document: "11222333000181", city: "Mirassol - SP", address: "Rua 1, 100", contactName: "Zé", phone: "17 3333-0000" });
      await criar("CLIENTE_A", { name: "Armazém Central", city: "Bady Bassitt - SP" });

      expect((await listar("CLIENTE_A")).map((d) => d.name)).toEqual(["Armazém Central", "Loja do Zé"]);

      entrarComo("CLIENTE_A");
      const alterado = await destinatarioPorId.PATCH(req("PATCH", { city: "Jaci - SP", phone: "" }), ctx(String(loja.corpo.id)));
      expect(alterado.status).toBe(200);
      expect(await alterado.json()).toMatchObject({ name: "Loja do Zé", city: "Jaci - SP", phone: null, contactName: "Zé" });

      entrarComo("CLIENTE_A");
      expect((await destinatarioPorId.DELETE(req("DELETE"), ctx(String(loja.corpo.id)))).status).toBe(200);
      expect((await listar("CLIENTE_A")).map((d) => d.name)).toEqual(["Armazém Central"]);
    });

    it("dado inválido é 400; o clientId do corpo é ignorado: vale o da sessão", async () => {
      for (const corpo of [null, {}, { name: "Loja" }, { name: "Loja", city: "Mirassol", document: "123" }]) {
        expect((await criar("CLIENTE_A", corpo)).status, JSON.stringify(corpo)).toBe(400);
      }

      const criado = await criar("CLIENTE_A", { name: "Loja", city: "Mirassol", clientId: clienteB, tenantId: EMPRESA_OUTRA.id });
      expect(criado.status).toBe(201);
      const gravado = await banco.sistema.clientReceiver.findUniqueOrThrow({ where: { id: String(criado.corpo.id) } });
      expect(gravado).toMatchObject({ clientId: clienteA, tenantId: EMPRESA_PADRAO.id });

      // Na alteração também: o destinatário não muda de dono.
      entrarComo("CLIENTE_A");
      expect((await destinatarioPorId.PATCH(req("PATCH", { name: "Loja 2", clientId: clienteB }), ctx(gravado.id))).status).toBe(200);
      expect((await banco.sistema.clientReceiver.findUniqueOrThrow({ where: { id: gravado.id } })).clientId).toBe(clienteA);
    });

    it("isolamento entre clientes da mesma transportadora: B não lista, não altera e não apaga o de A", async () => {
      const deA = String((await criar("CLIENTE_A", { name: "Só de A", city: "Mirassol" })).corpo.id);

      expect(await listar("CLIENTE_B")).toEqual([]);

      entrarComo("CLIENTE_B");
      const alterar = await destinatarioPorId.PATCH(req("PATCH", { name: "Invadido" }), ctx(deA));
      entrarComo("CLIENTE_B");
      const apagar = await destinatarioPorId.DELETE(req("DELETE"), ctx(deA));
      entrarComo("CLIENTE_B");
      const inexistente = await destinatarioPorId.DELETE(req("DELETE"), ctx(ID_INEXISTENTE));

      expect([alterar.status, apagar.status, inexistente.status]).toEqual([404, 404, 404]);
      // Igual a id que não existe: a resposta não diz que o destinatário é de outro.
      expect(await apagar.json()).toEqual(await inexistente.json());
      expect((await banco.sistema.clientReceiver.findUniqueOrThrow({ where: { id: deA } })).name).toBe("Só de A");
    });

    it("isolamento entre transportadoras: o destinatário da outra não aparece nem pode ser mexido, e a outra não vê os desta", async () => {
      const deA = String((await criar("CLIENTE_A", { name: "Só de A", city: "Mirassol" })).corpo.id);

      expect((await listar("CLIENTE_A")).map((d) => d.id)).toEqual([deA]);
      entrarComo("CLIENTE_A");
      expect((await destinatarioPorId.PATCH(req("PATCH", { name: "Invadido" }), ctx(destinatarioDaOutra))).status).toBe(404);
      entrarComo("CLIENTE_A");
      expect((await destinatarioPorId.DELETE(req("DELETE"), ctx(destinatarioDaOutra))).status).toBe(404);

      const outra = banco.paraEmpresa(EMPRESA_OUTRA.id).db;
      expect((await outra.clientReceiver.findMany({ select: { id: true, name: true } })).map((d) => d.name)).toEqual(["Destinatário da outra"]);
      // O banco recusa destinatário de uma empresa apontando para cliente de outra.
      await expect(outra.clientReceiver.create({ data: { clientId: clienteA, name: "Cruzado", city: "X" } })).rejects.toThrow();
    });

    it("o cadastro tem teto por cliente", async () => {
      await banco.default.clientReceiver.createMany({
        data: Array.from({ length: MAX_DESTINATARIOS }, (_, i) => ({ clientId: clienteA, name: `Destinatário ${i}`, city: "Mirassol" })),
      });
      expect((await criar("CLIENTE_A", { name: "Um a mais", city: "Mirassol" })).status).toBe(409);
      // O teto é de cada cliente: B segue cadastrando.
      expect((await criar("CLIENTE_B", { name: "Primeiro de B", city: "Mirassol" })).status).toBe(201);
    });
  });

  describe("pedido de coleta com janela, prioridade, cubagem e observação", () => {
    beforeEach(async () => {
      await banco.sistema.collection.deleteMany({ where: { clientId: { in: [clienteA, clienteB] } } });
    });

    it("portal: grava os campos do pedido, a cubagem entra no frete, e a lista e o detalhe os devolvem", async () => {
      const { status, corpo } = await pedir("CLIENTE_A", {
        pickupDate: "2026-10-12",
        pickupFrom: "08:00",
        pickupTo: "12:00",
        priority: "URGENT",
        cubicMeters: "1",
        pickupNotes: " Procurar o João na doca 2 ",
      });
      expect(status).toBe(201);
      const coleta = corpo.collection!;
      expect(coleta).toMatchObject({
        status: "PENDING",
        pickupDate: "2026-10-12T00:00:00.000Z",
        pickupFrom: "08:00",
        pickupTo: "12:00",
        priority: "URGENT",
        cubicMeters: 1,
        pickupNotes: "Procurar o João na doca 2",
        // 80 do mínimo + 200 kg cubados acima dos 100 cobertos.
        freightValue: 280,
      });

      entrarComo("CLIENTE_A");
      const lista = (await (await coletasDoPortal.GET()).json()) as Record<string, unknown>[];
      expect(lista).toHaveLength(1);
      expect(lista[0]).toMatchObject({ id: coleta.id, priority: "URGENT", pickupFrom: "08:00" });

      entrarComo("CLIENTE_A");
      const detalhe = await (await coletaDoPortal.GET(req("GET"), ctx(String(coleta.id)))).json();
      expect(detalhe).toMatchObject({ pickupDate: "2026-10-12T00:00:00.000Z", pickupTo: "12:00", cubicMeters: 1, pickupNotes: "Procurar o João na doca 2" });
    });

    it("portal: sem os campos novos o pedido segue como antes, com prioridade normal e frete pelo peso", async () => {
      const { status, corpo } = await pedir("CLIENTE_A", {});
      expect(status).toBe(201);
      expect(corpo.collection).toMatchObject({ pickupDate: null, pickupFrom: null, pickupTo: null, priority: "NORMAL", cubicMeters: null, pickupNotes: null, freightValue: 80 });
    });

    it("portal: janela invertida, dia inválido e prioridade desconhecida são 400 e nada é gravado", async () => {
      expect(await pedir("CLIENTE_A", { pickupFrom: "14:00", pickupTo: "09:00" })).toMatchObject({ status: 400, corpo: { error: JANELA_INVERTIDA } });
      for (const extras of [{ pickupDate: "2026-02-31" }, { priority: "ALTA" }, { pickupTo: "25:00" }, { cubicMeters: "-1" }]) {
        expect((await pedir("CLIENTE_A", extras)).status, JSON.stringify(extras)).toBe(400);
      }
      expect(await banco.default.collection.count({ where: { clientId: clienteA } })).toBe(0);
    });

    it("painel: a minuta nasce com os campos do pedido, a auditoria registra, e a edição confere a janela inteira", async () => {
      entrarComo("OPERATION");
      const criada = await coletas.POST(
        req("POST", { clientId: clienteA, sender: "Fábrica", receiver: "Loja", origin: "Rio Preto - SP", destination: "Mirassol - SP", volumes: "2", weight: "50", pickupDate: "2026-10-12", pickupFrom: "08:00", pickupTo: "12:00", priority: "URGENT", pickupNotes: "Doca 2" }),
      );
      expect(criada.status).toBe(201);
      const coleta = (await criada.json()) as { id: string; priority: string; pickupDate: string; freightValue: number };
      expect(coleta).toMatchObject({ priority: "URGENT", pickupDate: "2026-10-12T00:00:00.000Z", pickupFrom: "08:00", pickupNotes: "Doca 2", freightValue: 80 });

      const linha = await banco.sistema.auditLog.findFirstOrThrow({ where: { action: "coleta.criar", entityId: coleta.id } });
      expect(linha.after).toMatchObject({ priority: "URGENT", pickupFrom: "08:00", pickupTo: "12:00", pickupNotes: "Doca 2" });

      const alterar = async (corpo: unknown) => {
        entrarComo("OPERATION");
        const res = await coletaPorId.PATCH(req("PATCH", corpo), ctx(coleta.id));
        return { status: res.status, corpo: (await res.json()) as Record<string, unknown> };
      };

      // Só o fim muda: é conferido contra o início que já está gravado (08:00).
      expect(await alterar({ pickupTo: "07:00" })).toMatchObject({ status: 400, corpo: { error: JANELA_INVERTIDA } });
      expect(await alterar({ pickupTo: "18:00" })).toMatchObject({ status: 200, corpo: { pickupFrom: "08:00", pickupTo: "18:00" } });

      // A cubagem informada depois refaz o frete; vazio apaga e volta ao peso.
      expect((await alterar({ cubicMeters: "1" })).corpo).toMatchObject({ cubicMeters: 1, freightValue: 280 });
      expect((await alterar({ cubicMeters: "", pickupNotes: "", priority: "NORMAL", pickupDate: "" })).corpo).toMatchObject({
        cubicMeters: null,
        pickupNotes: null,
        priority: "NORMAL",
        pickupDate: null,
        freightValue: 80,
      });

      const alteracao = await banco.sistema.auditLog.findFirstOrThrow({ where: { action: "coleta.alterar", entityId: coleta.id }, orderBy: { createdAt: "desc" } });
      expect(alteracao.before).toMatchObject({ priority: "URGENT", pickupNotes: "Doca 2", cubicMeters: 1 });
      expect(alteracao.after).toMatchObject({ priority: "NORMAL", pickupNotes: null, cubicMeters: null });
    });

    it("painel: janela invertida na criação é 400", async () => {
      entrarComo("OPERATION");
      const res = await coletas.POST(
        req("POST", { clientId: clienteA, sender: "Fábrica", receiver: "Loja", origin: "Rio Preto", destination: "Mirassol", volumes: 1, weight: 1, pickupFrom: "10:00", pickupTo: "10:00" }),
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: JANELA_INVERTIDA });
    });
  });

  describe("exportação em CSV", () => {
    const carga = (clientId: string, receiver: string, createdAt: string, extras: Record<string, unknown> = {}) =>
      banco.default.collection.create({
        data: { clientId, sender: "Fábrica", receiver, origin: "Rio Preto - SP", destination: "Mirassol - SP", volumes: 3, weight: 12.5, status: "DELIVERED", freightValue: 80, createdAt: new Date(createdAt), ...extras },
      });

    beforeAll(async () => {
      await banco.sistema.collection.deleteMany({ where: { clientId: { in: [clienteA, clienteB] } } });
      await carga(clienteA, "Loja de outubro", "2026-10-05T15:00:00.000Z", { trackingCode: "9952525201" });
      await carga(clienteA, "=HYPERLINK(\"http://golpe\")", "2026-10-06T15:00:00.000Z", { trackingCode: "9952525202", freightValue: null, status: "PENDING" });
      await carga(clienteA, "Loja de setembro", "2026-09-05T15:00:00.000Z", { trackingCode: "9952525203" });
      // 02:00 UTC do dia 1º de novembro ainda é 31 de outubro no Brasil: entra no mês de outubro.
      await carga(clienteA, "Loja da virada", "2026-11-01T02:00:00.000Z", { trackingCode: "9952525204" });
      await carga(clienteB, "Carga do cliente B", "2026-10-05T15:00:00.000Z", { trackingCode: "9952525205" });
    });

    it("baixa só as cargas do cliente no período, em CSV para o Excel", async () => {
      const res = await baixar("CLIENTE_A", "?de=2026-10-01&ate=2026-10-31");
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
      expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="coletas-2026-10-01-a-2026-10-31.csv"');
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");

      // O `text()` da resposta tira a marca de UTF-8: os bytes mostram que ela foi.
      const bytes = new Uint8Array(await res.arrayBuffer());
      expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
      const linhas = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes).slice(1).trimEnd().split("\r\n");

      expect(linhas).toEqual([
        '"Código";"Data";"Destino";"Destinatário";"Volumes";"Peso (kg)";"Frete (R$)";"Situação"',
        '"9952525201";"05/10/2026";"Mirassol - SP";"Loja de outubro";3;12,5;80,00;"Entregue"',
        // Fórmula digitada no destinatário sai neutralizada.
        `"9952525202";"06/10/2026";"Mirassol - SP";"'=HYPERLINK(""http://golpe"")";3;12,5;"A cotar";"Aguardando confirmação"`,
        '"9952525204";"31/10/2026";"Mirassol - SP";"Loja da virada";3;12,5;80,00;"Entregue"',
      ]);
    });

    it("isolamento: o arquivo de um cliente não traz carga de outro, nem de outra transportadora", async () => {
      const deB = await (await baixar("CLIENTE_B", "?de=2026-01-01&ate=2026-12-31")).text();
      expect(deB).toContain("Carga do cliente B");
      for (const alheio of ["Loja de outubro", "Loja de setembro", "golpe", "Carga da outra transportadora"]) expect(deB).not.toContain(alheio);

      const deA = await (await baixar("CLIENTE_A", "?de=2026-01-01&ate=2026-12-31")).text();
      for (const alheio of ["Carga do cliente B", "Carga da outra transportadora"]) expect(deA).not.toContain(alheio);
      expect(deA.trimEnd().split("\r\n")).toHaveLength(5);
    });

    it("período inválido é 400; sem período vêm os últimos 30 dias", async () => {
      for (const consulta of ["?de=2026-10-31&ate=2026-10-01", "?de=ontem", "?de=2025-01-01&ate=2026-10-01", "?ate=2026-02-31"]) {
        expect((await baixar("CLIENTE_A", consulta)).status, consulta).toBe(400);
      }

      const recente = await carga(clienteA, "Carga de agora", new Date().toISOString());
      try {
        const res = await baixar("CLIENTE_A");
        expect(res.status).toBe(200);
        expect(await res.text()).toContain("Carga de agora");
      } finally {
        await banco.sistema.collection.delete({ where: { id: recente.id } });
      }
    });
  });
});
