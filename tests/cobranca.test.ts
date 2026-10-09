import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getServerSession } from "next-auth";
import {
  FAIXAS,
  FAIXA_LABEL,
  SEM_CLIENTE,
  diasDeAtraso,
  faixaDoAtraso,
  posicaoDeCobranca,
  textoDoAviso,
  type Devedor,
  type TituloEmAberto,
} from "../src/lib/cobranca";
import { centavos } from "../src/lib/faturas";
import { diaNoBrasil, situacaoDoLancamento } from "../src/lib/financeiro";
import { EMPRESA_OUTRA, EMPRESA_PADRAO } from "./empresas-de-teste";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

/** As contas da cobrança, sem banco: títulos na mão, data de referência na mão. */
describe("contas da cobrança", () => {
  // Meio-dia de 15/10/2026 em Brasília.
  const HOJE = new Date("2026-10-15T15:00:00.000Z");
  const dia = (d: string) => new Date(`${d}T00:00:00.000Z`);
  // Vencimento a `n` dias de hoje para trás.
  const haDias = (n: number) => new Date(Date.UTC(2026, 9, 15 - n));

  let seq = 0;
  const cliente = (id: string, extra: Partial<NonNullable<TituloEmAberto["client"]>> = {}) => ({
    id,
    companyName: `Razão ${id} Ltda`,
    tradeName: null,
    contactName: null,
    email: null,
    phone: null,
    ...extra,
  });
  const t = (extra: Partial<TituloEmAberto> = {}): TituloEmAberto => {
    seq += 1;
    return {
      id: `t${seq}`,
      description: `Título ${seq}`,
      amount: 100,
      dueDate: null,
      clientId: extra.client?.id ?? null,
      counterparty: null,
      client: null,
      invoice: null,
      ...extra,
    };
  };

  it("dias de atraso: vence hoje é zero, ontem é um, e o dia é o do Brasil", () => {
    expect(diasDeAtraso(dia("2026-10-15"), HOJE)).toBe(0);
    expect(diasDeAtraso(dia("2026-10-14"), HOJE)).toBe(1);
    expect(diasDeAtraso(dia("2026-10-16"), HOJE)).toBe(0);
    expect(diasDeAtraso(null, HOJE)).toBe(0);
    expect(diasDeAtraso("2026-09-15T00:00:00.000Z", HOJE)).toBe(30);
    // Vira o ano e passa por fevereiro: são dias de calendário.
    expect(diasDeAtraso(dia("2025-10-15"), HOJE)).toBe(365);

    // 01:30 UTC do dia 16 ainda é dia 15 em Brasília.
    const madrugadaUtc = new Date("2026-10-16T01:30:00.000Z");
    expect(diasDeAtraso(dia("2026-10-15"), madrugadaUtc)).toBe(0);
    expect(diasDeAtraso(dia("2026-10-14"), madrugadaUtc)).toBe(1);
  });

  it("atraso maior que zero exatamente quando o financeiro diz vencido", () => {
    for (const referencia of [HOJE, new Date("2026-10-16T01:30:00.000Z"), new Date("2026-10-15T03:00:00.000Z")]) {
      for (const dueDate of [null, dia("2026-10-13"), dia("2026-10-14"), dia("2026-10-15"), dia("2026-10-16")]) {
        const vencido = situacaoDoLancamento({ status: "PENDING", dueDate }, referencia) === "vencido";
        expect(diasDeAtraso(dueDate, referencia) > 0, `${dueDate?.toISOString()} em ${referencia.toISOString()}`).toBe(vencido);
      }
    }
  });

  it("faixas: as cinco, com rótulo, e as bordas de cada uma", () => {
    expect(FAIXAS).toEqual(["a_vencer", "ate_30", "de_31_a_60", "de_61_a_90", "acima_de_90"]);
    expect(FAIXAS.map((f) => FAIXA_LABEL[f])).toEqual(["A vencer", "1 a 30 dias", "31 a 60 dias", "61 a 90 dias", "Mais de 90 dias"]);

    expect([0, 1, 30, 31, 60, 61, 90, 91, 400].map(faixaDoAtraso)).toEqual([
      "a_vencer",
      "ate_30",
      "ate_30",
      "de_31_a_60",
      "de_31_a_60",
      "de_61_a_90",
      "de_61_a_90",
      "acima_de_90",
      "acima_de_90",
    ]);
  });

  it("agrupa por cliente; sem cliente, pelo pagador sem ligar para caixa e espaço; sem nenhum, num grupo só", () => {
    const serilon = cliente("c1", { tradeName: "Serilon", contactName: "Marta", email: "fin@serilon.br", phone: "1733330000" });
    const { devedores } = posicaoDeCobranca(
      [
        t({ client: serilon, counterparty: "ignorado quando há cliente" }),
        t({ client: serilon }),
        t({ client: cliente("c2") }),
        t({ counterparty: "  Posto Avenida " }),
        t({ counterparty: "posto avenida" }),
        t({ counterparty: "POSTO AVENIDA" }),
        t({ counterparty: "   " }),
        t(),
      ],
      HOJE,
    );

    expect(devedores.map((d) => [d.chave, d.clientId, d.nome, d.titulos.length])).toEqual([
      // Nada vencido: vale o total, e no empate o nome.
      ["pagador:posto avenida", null, "Posto Avenida", 3],
      ["sem-cliente", null, SEM_CLIENTE, 2],
      ["cliente:c1", "c1", "Serilon", 2],
      ["cliente:c2", "c2", "Razão c2 Ltda", 1],
    ]);
    expect(SEM_CLIENTE).toBe("Sem cliente informado");
    const [posto, semCliente, daSerilon] = devedores;
    expect(daSerilon.contato).toEqual({ nome: "Marta", email: "fin@serilon.br", telefone: "1733330000" });
    expect(posto.contato).toEqual({ nome: null, email: null, telefone: null });
    expect(semCliente.contato).toEqual({ nome: null, email: null, telefone: null });
  });

  it("ordem: vencido maior primeiro, depois total, depois nome; títulos por vencimento, sem vencimento por último", () => {
    const { devedores } = posicaoDeCobranca(
      [
        t({ client: cliente("b", { tradeName: "Beta" }), amount: 500, dueDate: haDias(-10) }),
        t({ client: cliente("z", { tradeName: "Zeta" }), amount: 50, dueDate: haDias(5) }),
        t({ client: cliente("a", { tradeName: "Alfa" }), amount: 900, dueDate: haDias(-1) }),
        t({ client: cliente("g", { tradeName: "Gama" }), amount: 500 }),
        t({ client: cliente("o", { tradeName: "Ômega" }), amount: 80, dueDate: haDias(100), description: "antigo" }),
        t({ client: cliente("o", { tradeName: "Ômega" }), amount: 10, description: "sem data" }),
        t({ client: cliente("o", { tradeName: "Ômega" }), amount: 10, dueDate: haDias(-3), description: "futuro" }),
        t({ client: cliente("o", { tradeName: "Ômega" }), amount: 10, dueDate: haDias(2), description: "recente" }),
      ],
      HOJE,
    );

    expect(devedores.map((d) => d.nome)).toEqual(["Ômega", "Zeta", "Alfa", "Beta", "Gama"]);
    const omega = devedores[0];
    expect(omega.titulos.map((x) => x.description)).toEqual(["antigo", "recente", "futuro", "sem data"]);
    expect(omega.titulos.map((x) => [x.diasDeAtraso, x.faixa])).toEqual([
      [100, "acima_de_90"],
      [2, "ate_30"],
      [0, "a_vencer"],
      [0, "a_vencer"],
    ]);
    expect(omega).toMatchObject({
      total: 110,
      vencido: 90,
      maiorAtraso: 100,
      porFaixa: { a_vencer: 20, ate_30: 10, de_31_a_60: 0, de_61_a_90: 0, acima_de_90: 80 },
    });
    expect(devedores[4]).toMatchObject({ nome: "Gama", vencido: 0, maiorAtraso: 0 });
  });

  it("totais: em aberto é vencido mais a vencer, e as faixas somam o em aberto", () => {
    const { totais, devedores } = posicaoDeCobranca(
      [
        t({ client: cliente("a"), amount: 100.1, dueDate: haDias(1) }),
        t({ client: cliente("a"), amount: 200.2, dueDate: haDias(30) }),
        t({ client: cliente("b"), amount: 300.3, dueDate: haDias(31) }),
        t({ client: cliente("b"), amount: 400.4, dueDate: haDias(61) }),
        t({ counterparty: "Avulso", amount: 500.5, dueDate: haDias(91) }),
        t({ counterparty: "Em dia", amount: 600.6, dueDate: haDias(0) }),
        t({ counterparty: "Em dia", amount: 700.7 }),
      ],
      HOJE,
    );

    expect(totais).toEqual({
      emAberto: 2802.8,
      vencido: 1501.5,
      aVencer: 1301.3,
      porFaixa: { a_vencer: 1301.3, ate_30: 300.3, de_31_a_60: 300.3, de_61_a_90: 400.4, acima_de_90: 500.5 },
      devedoresEmAtraso: 3,
    });
    expect(centavos(totais.vencido + totais.aVencer)).toBe(totais.emAberto);
    expect(centavos(FAIXAS.reduce((soma, f) => soma + totais.porFaixa[f], 0))).toBe(totais.emAberto);
    expect(centavos(devedores.reduce((soma, d) => soma + d.total, 0))).toBe(totais.emAberto);
    for (const d of devedores) {
      expect(centavos(FAIXAS.reduce((soma, f) => soma + d.porFaixa[f], 0)), d.nome).toBe(d.total);
    }
  });

  it("soma em centavos: três títulos de 0,10 dão 0,30, não 0,30000000000000004", () => {
    const { totais, devedores } = posicaoDeCobranca(
      [1, 2, 3].map(() => t({ counterparty: "Troco", amount: 0.1, dueDate: haDias(3) })),
      HOJE,
    );
    expect(devedores[0].total).toBe(0.3);
    expect(devedores[0].vencido).toBe(0.3);
    expect(devedores[0].porFaixa.ate_30).toBe(0.3);
    expect(totais).toMatchObject({ emAberto: 0.3, vencido: 0.3, aVencer: 0 });
    expect(totais.porFaixa.ate_30).toBe(0.3);
  });

  it("sem título nenhum: tudo zero e nenhum devedor", () => {
    expect(posicaoDeCobranca([], HOJE)).toEqual({
      totais: {
        emAberto: 0,
        vencido: 0,
        aVencer: 0,
        porFaixa: { a_vencer: 0, ate_30: 0, de_31_a_60: 0, de_61_a_90: 0, acima_de_90: 0 },
        devedoresEmAtraso: 0,
      },
      devedores: [],
    });
  });

  describe("texto do aviso", () => {
    const EMPRESA = { name: "Mello Transportes" };
    const devedorDe = (titulos: TituloEmAberto[]): Devedor => posicaoDeCobranca(titulos, HOJE).devedores[0];

    it("com título vencido fala em atraso, lista cada título e soma o total", () => {
      const serilon = cliente("c1", { tradeName: "Serilon", contactName: "Marta" });
      const texto = textoDoAviso({
        empresa: EMPRESA,
        hoje: HOJE,
        devedor: devedorDe([
          t({ client: serilon, description: "Fatura nº 12 (3 cargas)", amount: 1234.56, dueDate: dia("2026-10-10") }),
          t({ client: serilon, description: "Frete avulso", amount: 80, dueDate: dia("2026-10-14") }),
          t({ client: serilon, description: "Fatura nº 15 (1 carga)", amount: 300, dueDate: dia("2026-11-01") }),
          t({ client: serilon, description: "Acerto", amount: 10.1 }),
        ]),
      });

      expect(texto.split("\n")).toEqual([
        "Olá, Marta.",
        "",
        "Identificamos pagamento em atraso em nome de Serilon. Constam em aberto os títulos abaixo. Pedimos a regularização ou, se o pagamento já foi feito, o envio do comprovante.",
        "",
        "- Fatura nº 12 (3 cargas) | vencimento 10/10/2026 | R$ 1.234,56 | vencido há 5 dias",
        "- Frete avulso | vencimento 14/10/2026 | R$ 80,00 | vencido há 1 dia",
        "- Fatura nº 15 (1 carga) | vencimento 01/11/2026 | R$ 300,00",
        "- Acerto | sem vencimento definido | R$ 10,10",
        "",
        "Total em aberto: R$ 1.624,66",
        "",
        "Atenciosamente,",
        "Mello Transportes",
      ]);
      expect(texto).not.toMatch(/lembrete/i);
    });

    it("só com título a vencer é lembrete, e sem contato cumprimenta pelo nome do devedor", () => {
      const texto = textoDoAviso({
        empresa: EMPRESA,
        hoje: HOJE,
        devedor: devedorDe([t({ counterparty: "Posto Avenida", description: "Frete de outubro", amount: 450, dueDate: dia("2026-10-15") })]),
      });

      expect(texto.split("\n")).toEqual([
        "Olá, Posto Avenida.",
        "",
        "Este é um lembrete de vencimento: em nome de Posto Avenida, consta em aberto o título abaixo.",
        "",
        "- Frete de outubro | vencimento 15/10/2026 | R$ 450,00",
        "",
        "Total em aberto: R$ 450,00",
        "",
        "Atenciosamente,",
        "Mello Transportes",
      ]);
      expect(texto).not.toMatch(/atraso|vencido há/i);
    });

    it("é texto puro, com espaço comum no valor, e não inventa dado de pagamento", () => {
      const texto = textoDoAviso({
        empresa: EMPRESA,
        hoje: HOJE,
        devedor: devedorDe([t({ counterparty: "Posto", amount: 1000, dueDate: dia("2026-09-01") })]),
      });
      expect(texto).not.toMatch(/pix|boleto|chave|banco|agência|linha digitável|https?:/i);
      expect(texto).not.toMatch(/[<>]/);
      // Espaço que não quebra (o do `Intl`) vira ponto de interrogação em muito lugar onde o texto é colado.
      expect(texto).not.toMatch(/[  ]/);
      expect(texto).toContain("R$ 1.000,00");
    });

    it("o atraso do texto é o da data de referência passada, não o que veio na lista", () => {
      const devedor = devedorDe([t({ counterparty: "Posto", dueDate: dia("2026-10-14") })]);
      expect(textoDoAviso({ empresa: EMPRESA, devedor, hoje: new Date("2026-10-24T15:00:00.000Z") })).toContain("vencido há 10 dias");
    });

    it("devedor sem título em aberto não tem aviso", () => {
      expect(
        textoDoAviso({ empresa: EMPRESA, hoje: HOJE, devedor: { nome: "Quitado", contato: { nome: null, email: null, telefone: null }, titulos: [] } }),
      ).toBe("");
    });
  });
});

/** Rotas da cobrança e do recibo, contra um Postgres de verdade. */
const temBanco = Boolean(process.env.DATABASE_URL);

if (!temBanco) {
  console.warn("\n[cobranca.test] DATABASE_URL ausente: testes de integração PULADOS.\n");
}

const suite = temBanco ? describe : describe.skip;

// Tudo o que esta suite cria usa estes marcadores, e só isso é apagado.
const PREFIXO = "teste-cobranca-";
const CNPJ = "99555444000166";
const CNPJ_DA_EMPRESA = "99555444000247";
const HASH_FALSO = "$2b$10$hashfalsoparateste000000000000000000000000000000000";
const SEM_ID = "00000000-0000-4000-8000-000000000000";

type Posicao = {
  hoje: string;
  empresa: { name: string };
  totais: { emAberto: number; vencido: number; aVencer: number; porFaixa: Record<string, number>; devedoresEmAtraso: number };
  devedores: Devedor[];
};

suite("rotas da cobrança", () => {
  let banco: typeof import("../src/lib/prisma");
  let cobranca: typeof import("../src/app/api/financeiro/cobranca/route");
  let recibo: typeof import("../src/app/api/financeiro/[id]/recibo/route");
  let financeiro: typeof import("../src/app/api/financeiro/route");
  let lancamentoPorId: typeof import("../src/app/api/financeiro/[id]/route");
  let faturas: typeof import("../src/app/api/faturas/route");
  let faturaPorId: typeof import("../src/app/api/faturas/[id]/route");

  const sessao = vi.mocked(getServerSession);
  const ids = { ADMIN: "", OPERATION: "", CLIENT: "", DRIVER: "" };
  let clienteId: string;

  const entrarComo = (perfil: keyof typeof ids | null) =>
    sessao.mockResolvedValue(perfil ? { user: { id: ids[perfil], role: perfil, clientId: null } } : null);

  const req = (method = "GET", body?: unknown) =>
    new Request("http://localhost/api/teste", {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

  const descricao = (n: string) => `${PREFIXO}${n}`;
  const meus = { description: { startsWith: PREFIXO } };

  // Dia do calendário a `n` dias de hoje no Brasil (negativo: já venceu), como o formulário manda.
  const daquiA = (n: number) => new Date(Date.parse(diaNoBrasil(new Date())) + n * 86_400_000).toISOString().slice(0, 10);

  async function limparLancamentos() {
    const { sistema } = banco;
    await sistema.financialTransaction.deleteMany({ where: { OR: [meus, { client: { cnpj: CNPJ } }] } });
    await sistema.collection.deleteMany({ where: { client: { cnpj: CNPJ } } });
    await sistema.invoice.deleteMany({ where: { client: { cnpj: CNPJ } } });
  }

  async function limpar() {
    await limparLancamentos();
    await banco.sistema.tenant.updateMany({ where: { cnpj: CNPJ_DA_EMPRESA }, data: { cnpj: null } });
    await banco.sistema.client.deleteMany({ where: { cnpj: CNPJ } });
    await banco.sistema.user.deleteMany({ where: { email: { startsWith: PREFIXO } } });
  }

  const criar = async (corpo: Record<string, unknown>) => {
    entrarComo("ADMIN");
    const res = await financeiro.POST(req("POST", { type: "INCOME", amount: "100", description: descricao("x"), ...corpo }));
    expect(res.status).toBe(201);
    return (await res.json()) as { id: string };
  };

  const agir = async (id: string, action: "pagar" | "reabrir", extra: Record<string, unknown> = {}) => {
    entrarComo("ADMIN");
    expect((await lancamentoPorId.PATCH(req("PATCH", { action, ...extra }), ctx(id))).status).toBe(200);
  };

  async function emitirFatura(vencimento: string) {
    const carga = await banco.default.collection.create({
      data: {
        clientId: clienteId,
        sender: "Remetente",
        receiver: "Destinatário",
        origin: "Rio Preto",
        destination: "Mirassol",
        volumes: 1,
        weight: 10,
        status: "DELIVERED",
        freightValue: 300,
      },
    });
    entrarComo("ADMIN");
    const res = await faturas.POST(req("POST", { clientId: clienteId, collectionIds: [carga.id], dueDate: vencimento }));
    expect(res.status).toBe(201);
    const fatura = (await res.json()) as { id: string; number: number };
    const lancamento = await banco.default.financialTransaction.findUniqueOrThrow({ where: { invoiceId: fatura.id } });
    return { fatura, lancamento };
  }

  const agirNaFatura = async (id: string, action: "pagar" | "reabrir") => {
    entrarComo("ADMIN");
    expect((await faturaPorId.PATCH(req("PATCH", { action }), ctx(id))).status).toBe(200);
  };

  const posicao = async () => {
    entrarComo("ADMIN");
    const res = await cobranca.GET();
    expect(res.status).toBe(200);
    return (await res.json()) as Posicao;
  };
  // Só os títulos desta suite, um por linha, para o teste não depender do que mais houver no banco.
  const meusTitulos = (p: Posicao) => p.devedores.flatMap((d) => d.titulos.map((titulo) => titulo.id));

  const lerRecibo = async (id: string) => {
    entrarComo("ADMIN");
    const res = await recibo.GET(req(), ctx(id));
    return { status: res.status, corpo: (await res.json()) as Record<string, unknown> };
  };

  beforeAll(async () => {
    banco = await import("../src/lib/prisma");
    cobranca = await import("../src/app/api/financeiro/cobranca/route");
    recibo = await import("../src/app/api/financeiro/[id]/recibo/route");
    financeiro = await import("../src/app/api/financeiro/route");
    lancamentoPorId = await import("../src/app/api/financeiro/[id]/route");
    faturas = await import("../src/app/api/faturas/route");
    faturaPorId = await import("../src/app/api/faturas/[id]/route");
    await limpar();

    clienteId = (
      await banco.default.client.create({
        data: {
          companyName: `${PREFIXO}cliente ltda`,
          tradeName: `${PREFIXO}fantasia`,
          cnpj: CNPJ,
          contactName: "Marta",
          email: "financeiro@cliente.br",
          phone: "1733330000",
        },
      })
    ).id;
    for (const perfil of ["ADMIN", "OPERATION", "CLIENT", "DRIVER"] as const) {
      ids[perfil] = (
        await banco.default.user.create({
          data: { name: perfil, email: `${PREFIXO}${perfil.toLowerCase()}@exemplo.br`, password: HASH_FALSO, role: perfil },
        })
      ).id;
    }
  });

  beforeEach(async () => {
    sessao.mockReset();
    await limparLancamentos();
  });

  afterAll(async () => {
    if (banco) await limpar();
  });

  it("só o administrador: sem sessão 401; operação, cliente e motorista 403, na posição e no recibo", async () => {
    const pago = await criar({ status: "PAID" });
    const chamadas = [() => cobranca.GET(), () => recibo.GET(req(), ctx(pago.id))];

    for (const [perfil, esperado] of [[null, 401], ["OPERATION", 403], ["CLIENT", 403], ["DRIVER", 403]] as const) {
      for (const chamar of chamadas) {
        entrarComo(perfil);
        const res = await chamar();
        expect(res.status, String(perfil)).toBe(esperado);
        expect(JSON.stringify(await res.json())).not.toContain(PREFIXO);
      }
    }
  });

  it("sem título em aberto: 200 com a lista vazia e todos os totais em zero", async () => {
    // Despesa em aberto e receita paga existem, e nenhuma das duas é título a cobrar.
    await criar({ type: "EXPENSE", dueDate: daquiA(-5) });
    await criar({ status: "PAID" });
    expect(
      await banco.default.financialTransaction.count({ where: { type: "INCOME", status: "PENDING" } }),
      "banco de teste com título a receber alheio",
    ).toBe(0);

    const p = await posicao();
    expect(p.devedores).toEqual([]);
    expect(p.totais).toEqual({
      emAberto: 0,
      vencido: 0,
      aVencer: 0,
      porFaixa: { a_vencer: 0, ate_30: 0, de_31_a_60: 0, de_61_a_90: 0, acima_de_90: 0 },
      devedoresEmAtraso: 0,
    });
  });

  it("traz hoje no relógio do Brasil, a empresa da sessão e só receita em aberto, agrupada por devedor", async () => {
    const vencido = await criar({ clientId: clienteId, amount: "150,50", dueDate: daquiA(-40), description: descricao("vencido") });
    const aVencer = await criar({ clientId: clienteId, amount: "49,50", dueDate: daquiA(10), description: descricao("a vencer") });
    const avulso = await criar({ counterparty: `${PREFIXO}pagador avulso`, amount: "70", description: descricao("avulso") });
    const despesa = await criar({ type: "EXPENSE", clientId: clienteId, dueDate: daquiA(-40), description: descricao("despesa") });
    const pago = await criar({ clientId: clienteId, status: "PAID", description: descricao("pago") });

    const p = await posicao();
    expect(p.hoje).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(p.hoje).toBe(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date()));
    expect(p.empresa).toEqual({ name: EMPRESA_PADRAO.name });

    const titulos = meusTitulos(p);
    expect(titulos).toEqual(expect.arrayContaining([vencido.id, aVencer.id, avulso.id]));
    expect(titulos).not.toContain(despesa.id);
    expect(titulos).not.toContain(pago.id);

    const doCliente = p.devedores.find((d) => d.clientId === clienteId)!;
    expect(doCliente).toMatchObject({
      chave: `cliente:${clienteId}`,
      nome: `${PREFIXO}fantasia`,
      contato: { nome: "Marta", email: "financeiro@cliente.br", telefone: "1733330000" },
      total: 200,
      vencido: 150.5,
      maiorAtraso: 40,
      porFaixa: { a_vencer: 49.5, ate_30: 0, de_31_a_60: 150.5, de_61_a_90: 0, acima_de_90: 0 },
    });
    expect(doCliente.titulos.map((x) => [x.id, x.diasDeAtraso, x.faixa, x.invoice])).toEqual([
      [vencido.id, 40, "de_31_a_60", null],
      [aVencer.id, 0, "a_vencer", null],
    ]);

    const doAvulso = p.devedores.find((d) => d.nome === `${PREFIXO}pagador avulso`)!;
    expect(doAvulso).toMatchObject({ clientId: null, total: 70, vencido: 0, maiorAtraso: 0 });

    expect(p.totais).toEqual({
      emAberto: 270,
      vencido: 150.5,
      aVencer: 119.5,
      porFaixa: { a_vencer: 119.5, ate_30: 0, de_31_a_60: 150.5, de_61_a_90: 0, acima_de_90: 0 },
      devedoresEmAtraso: 1,
    });
    // Quem deve em atraso vem antes.
    expect(p.devedores.map((d) => d.chave)).toEqual([doCliente.chave, doAvulso.chave]);
  });

  it("pagar o lançamento manual tira o título da posição; reabrir devolve", async () => {
    const titulo = await criar({ clientId: clienteId, dueDate: daquiA(-3) });
    expect(meusTitulos(await posicao())).toContain(titulo.id);

    await agir(titulo.id, "pagar");
    expect(meusTitulos(await posicao())).not.toContain(titulo.id);

    await agir(titulo.id, "reabrir");
    expect(meusTitulos(await posicao())).toContain(titulo.id);
  });

  it("pagar a fatura tira o título dela da posição; reabrir devolve, com o número da fatura", async () => {
    const { fatura, lancamento } = await emitirFatura(daquiA(-2));

    const antes = await posicao();
    const titulo = antes.devedores.flatMap((d) => d.titulos).find((x) => x.id === lancamento.id)!;
    expect(titulo).toMatchObject({ amount: 300, diasDeAtraso: 2, faixa: "ate_30", invoice: { id: fatura.id, number: fatura.number } });

    await agirNaFatura(fatura.id, "pagar");
    expect(meusTitulos(await posicao())).not.toContain(lancamento.id);

    await agirNaFatura(fatura.id, "reabrir");
    expect(meusTitulos(await posicao())).toContain(lancamento.id);
  });

  describe("recibo", () => {
    it("lançamento inexistente e de outra empresa respondem o mesmo 404", async () => {
      const alheio = await banco.paraEmpresa(EMPRESA_OUTRA.id).db.financialTransaction.create({
        data: { type: "INCOME", amount: 10, description: descricao("da outra"), status: "PAID", paidAt: new Date() },
      });

      const inexistente = await lerRecibo(SEM_ID);
      const daOutra = await lerRecibo(alheio.id);
      expect(inexistente).toEqual({ status: 404, corpo: { error: "Lançamento não encontrado." } });
      expect(daOutra).toEqual(inexistente);
    });

    it("despesa paga e receita em aberto não têm recibo: 409", async () => {
      const despesaPaga = await criar({ type: "EXPENSE", status: "PAID" });
      const emAberto = await criar({ dueDate: daquiA(5) });
      const semRecibo = { status: 409, corpo: { error: "Só há recibo de valor já recebido." } };

      expect(await lerRecibo(despesaPaga.id)).toEqual(semRecibo);
      expect(await lerRecibo(emAberto.id)).toEqual(semRecibo);

      // Pago e depois reaberto volta a não ter recibo.
      await agir(emAberto.id, "pagar");
      expect((await lerRecibo(emAberto.id)).status).toBe(200);
      await agir(emAberto.id, "reabrir");
      expect(await lerRecibo(emAberto.id)).toEqual(semRecibo);
    });

    it("receita paga de cliente: pagador é a razão social com o CNPJ, e a empresa é a da sessão", async () => {
      await banco.sistema.tenant.update({ where: { id: EMPRESA_PADRAO.id }, data: { cnpj: CNPJ_DA_EMPRESA } });
      try {
        const titulo = await criar({ clientId: clienteId, amount: "1234,56", dueDate: "2026-10-10", description: descricao("frete") });
        await agir(titulo.id, "pagar", { paidAt: "2026-10-12T15:00:00.000Z", paymentMethod: "PIX" });

        const { status, corpo } = await lerRecibo(titulo.id);
        expect(status).toBe(200);
        expect(corpo).toEqual({
          id: titulo.id,
          amount: 1234.56,
          description: descricao("frete"),
          paidAt: "2026-10-12T15:00:00.000Z",
          paymentMethod: "PIX",
          dueDate: "2026-10-10T00:00:00.000Z",
          invoice: null,
          pagador: { nome: `${PREFIXO}cliente ltda`, cnpj: CNPJ },
          empresa: { name: EMPRESA_PADRAO.name, cnpj: CNPJ_DA_EMPRESA },
        });
      } finally {
        await banco.sistema.tenant.update({ where: { id: EMPRESA_PADRAO.id }, data: { cnpj: null } });
      }
    });

    it("receita paga sem cliente: pagador é o nome digitado, sem CNPJ", async () => {
      const titulo = await criar({ counterparty: `${PREFIXO}pagador avulso`, status: "PAID", paymentMethod: "DINHEIRO" });

      const { status, corpo } = await lerRecibo(titulo.id);
      expect(status).toBe(200);
      expect(corpo).toMatchObject({
        id: titulo.id,
        amount: 100,
        paymentMethod: "DINHEIRO",
        dueDate: null,
        invoice: null,
        pagador: { nome: `${PREFIXO}pagador avulso`, cnpj: null },
        empresa: { name: EMPRESA_PADRAO.name, cnpj: null },
      });
      expect(Date.now() - new Date(String(corpo.paidAt)).getTime()).toBeLessThan(60_000);
    });

    it("a fatura devolve o lançamento dela, e é por ele que se chega ao recibo da fatura paga", async () => {
      const { fatura, lancamento } = await emitirFatura(daquiA(5));

      entrarComo("ADMIN");
      const aberta = (await (await faturaPorId.GET(req(), ctx(fatura.id))).json()) as Record<string, unknown>;
      expect(aberta.transaction).toEqual({ id: lancamento.id });
      // O que a fatura já devolvia continua lá.
      expect(Object.keys(aberta).sort()).toEqual(
        ["_count", "client", "collections", "dueDate", "id", "issuedAt", "notes", "number", "paidAt", "status", "total", "transaction"],
      );
      expect((await lerRecibo(lancamento.id)).status).toBe(409);

      await agirNaFatura(fatura.id, "pagar");
      const { status, corpo } = await lerRecibo(lancamento.id);
      expect(status).toBe(200);
      expect(corpo).toMatchObject({
        amount: 300,
        invoice: { id: fatura.id, number: fatura.number },
        pagador: { nome: `${PREFIXO}cliente ltda`, cnpj: CNPJ },
      });

      // Fatura cancelada perde o lançamento: `transaction` nulo, sem recibo.
      await agirNaFatura(fatura.id, "reabrir");
      entrarComo("ADMIN");
      expect((await faturaPorId.PATCH(req("PATCH", { action: "cancelar" }), ctx(fatura.id))).status).toBe(200);
      entrarComo("ADMIN");
      const cancelada = (await (await faturaPorId.GET(req(), ctx(fatura.id))).json()) as Record<string, unknown>;
      expect(cancelada.transaction).toBeNull();
      expect((await lerRecibo(lancamento.id)).status).toBe(404);
    });
  });
});
