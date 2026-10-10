import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getServerSession } from "next-auth";
import {
  LIMITE_DA_CIDADE,
  LIMITE_DO_NOME,
  crc16,
  normalizarChave,
  pixCopiaECola,
  pixDoTitulo,
  recebedorDaEmpresa,
  textoDoCodigo,
  txidDaFatura,
  txidDoTitulo,
  txidValido,
} from "../src/lib/pix";
import { CHAVE_PIX_INVALIDA, parametrosDeCobrancaSchema } from "../src/lib/empresa";
import { posicaoDeCobranca, textoDoAviso, type TituloEmAberto } from "../src/lib/cobranca";
import { EMPRESA_OUTRA, EMPRESA_PADRAO } from "./empresas-de-teste";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

// O exemplo do Manual de Padrões para Iniciação do Pix (Banco Central): chave
// aleatória, sem valor e sem identificador. O CRC publicado é 1D3D.
const EXEMPLO_DO_MANUAL =
  "00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D";

// Montado à mão, campo a campo, com o CRC calculado fora deste código.
const COM_VALOR =
  "00020126360014br.gov.bcb.pix0114112223330001815204000053039865406480.505802BR5917Mello Transportes6015Sao Jose do Rio62130509FAT009001630432F5";

const CNPJ_VALIDO = "11222333000181";
const CPF_VALIDO = "52998224725";
const RECEBEDOR = { chave: CNPJ_VALIDO, nome: "Mello Transportes", cidade: "São José do Rio Preto" };

describe("Pix Copia e Cola: o código", () => {
  it("CRC16-CCITT: confere com o vetor público do algoritmo e com o exemplo do manual do BR Code", () => {
    expect(crc16("123456789")).toBe("29B1");
    expect(crc16(EXEMPLO_DO_MANUAL.slice(0, -4))).toBe("1D3D");
    // Sempre quatro dígitos, com zero à esquerda quando preciso.
    for (const texto of ["", "a", "00020101021226"]) expect(crc16(texto)).toMatch(/^[0-9A-F]{4}$/);
  });

  it("reproduz, caractere por caractere, o exemplo do manual do Banco Central", () => {
    expect(
      pixCopiaECola({ chave: "123e4567-e12b-12d1-a456-426655440000", nome: "Fulano de Tal", cidade: "BRASILIA" }),
    ).toBe(EXEMPLO_DO_MANUAL);
  });

  it("com valor e identificador: campos 54 e 62 entram, nome e cidade saem sem acento e cortados no limite", () => {
    expect(pixCopiaECola({ ...RECEBEDOR, valor: 480.5, txid: "FAT009001" })).toBe(COM_VALOR);
  });

  it("os campos saem na ordem do padrão, cada um com o tamanho certo, e o CRC fecha o código", () => {
    const codigo = pixCopiaECola({ ...RECEBEDOR, valor: 1234.5, txid: txidDaFatura(123) });
    // Lê o código como o aplicativo do banco: identificador, tamanho, valor.
    const campos: [string, string][] = [];
    for (let i = 0; i < codigo.length; ) {
      const tamanho = Number(codigo.slice(i + 2, i + 4));
      campos.push([codigo.slice(i, i + 2), codigo.slice(i + 4, i + 4 + tamanho)]);
      i += 4 + tamanho;
    }
    expect(campos.map(([id]) => id)).toEqual(["00", "26", "52", "53", "54", "58", "59", "60", "62", "63"]);
    const valor = Object.fromEntries(campos);
    expect(valor["00"]).toBe("01");
    expect(valor["26"]).toBe(`0014br.gov.bcb.pix0114${CNPJ_VALIDO}`);
    expect(valor["52"]).toBe("0000");
    expect(valor["53"]).toBe("986");
    expect(valor["54"]).toBe("1234.50");
    expect(valor["58"]).toBe("BR");
    expect(valor["59"]).toBe("Mello Transportes");
    expect(valor["60"]).toBe("Sao Jose do Rio");
    expect(valor["62"]).toBe("0509FAT000123");
    expect(valor["63"]).toBe(crc16(codigo.slice(0, -4)));
  });

  it("sem valor (ou zero, negativo, não número) o campo 54 não entra", () => {
    for (const valor of [undefined, null, 0, -5, Number.NaN]) {
      expect(pixCopiaECola({ ...RECEBEDOR, valor }), String(valor)).not.toContain("5303986540");
    }
    expect(pixCopiaECola({ ...RECEBEDOR, valor: 0.1 })).toContain("530398654040.10");
    // Arredonda para centavos.
    expect(pixCopiaECola({ ...RECEBEDOR, valor: 10.005 })).toMatch(/54051\d\.\d{2}5802BR/);
  });

  it("nome e cidade: sem acento, sem símbolo, sem espaço dobrado e dentro do limite", () => {
    expect(textoDoCodigo("  José   da Conceição & Cia. Ltda  ", LIMITE_DO_NOME)).toBe("Jose da Conceicao Cia Ltd");
    expect(textoDoCodigo("São José do Rio Preto", LIMITE_DA_CIDADE)).toBe("Sao Jose do Rio");
    expect(textoDoCodigo("Transportadora Çãéíõü", 40)).toBe("Transportadora Caeiou");
    // O corte não deixa espaço sobrando no fim.
    expect(textoDoCodigo("abcd efgh", 5)).toBe("abcd");
    expect(textoDoCodigo("***", 10)).toBe("");
  });

  it("identificador: só letras e números, até 25; vazio vira ***", () => {
    expect(txidDaFatura(123)).toBe("FAT000123");
    expect(txidDaFatura(1234567)).toBe("FAT1234567");
    expect(txidDoTitulo("3f2b8c1e-9a4d-4e7f-b1c2-0123456789ab")).toBe("TIT3F2B8C1E9A4D4E7FB1C201");
    expect(txidDoTitulo("3f2b8c1e-9a4d-4e7f-b1c2-0123456789ab")).toHaveLength(25);
    expect(txidValido("fat-00.1/2 x")).toBe("fat0012x");
    expect(txidValido("")).toBe("***");
    expect(txidValido(null)).toBe("***");
    expect(txidValido("-./")).toBe("***");
  });
});

describe("Pix Copia e Cola: a chave", () => {
  it("CPF e CNPJ: só dígitos, com o dígito verificador certo", () => {
    expect(normalizarChave("CPF", "529.982.247-25")).toBe(CPF_VALIDO);
    expect(normalizarChave("CNPJ", "11.222.333/0001-81")).toBe(CNPJ_VALIDO);
    for (const cpf of ["529.982.247-26", "111.111.111-11", "5299822472", "", "abc"]) expect(normalizarChave("CPF", cpf), cpf).toBeNull();
    for (const cnpj of ["11.222.333/0001-82", "00000000000000", CPF_VALIDO, ""]) expect(normalizarChave("CNPJ", cnpj), cnpj).toBeNull();
  });

  it("e-mail em minúsculas; telefone como +55 com DDD; aleatória como UUID", () => {
    expect(normalizarChave("EMAIL", "  Financeiro@Mello.com.BR ")).toBe("financeiro@mello.com.br");
    for (const email of ["sem-arroba.com", "a@b", "josé@mello.com.br", "a b@c.com", `${"a".repeat(80)}@x.com`]) expect(normalizarChave("EMAIL", email), email).toBeNull();

    expect(normalizarChave("TELEFONE", "(17) 99999-8888")).toBe("+5517999998888");
    expect(normalizarChave("TELEFONE", "+55 17 99999-8888")).toBe("+5517999998888");
    expect(normalizarChave("TELEFONE", "1733334444")).toBe("+551733334444");
    for (const telefone of ["99999-8888", "0799999888", "17 1234-5678", "5517", ""]) expect(normalizarChave("TELEFONE", telefone), telefone).toBeNull();

    expect(normalizarChave("ALEATORIA", " 123E4567-E12B-12D1-A456-426655440000 ")).toBe("123e4567-e12b-12d1-a456-426655440000");
    for (const chave of ["123e4567e12b12d1a456426655440000", "123e4567-e12b-12d1-a456-42665544000g", ""]) expect(normalizarChave("ALEATORIA", chave), chave).toBeNull();
  });

  it("o cadastro da empresa: aceita, normaliza a chave, e recusa o que não confere com o tipo ou passa do limite", () => {
    const base = { multaPct: 2, jurosPct: 1 };
    const pix = { tipo: "CNPJ", chave: "11.222.333/0001-81", nome: " Mello Transportes ", cidade: "Rio Preto" };

    expect(parametrosDeCobrancaSchema.parse({ ...base, pix }).pix).toEqual({ tipo: "CNPJ", chave: CNPJ_VALIDO, nome: "Mello Transportes", cidade: "Rio Preto" });
    // `null` remove; ausente não mexe.
    expect(parametrosDeCobrancaSchema.parse({ ...base, pix: null }).pix).toBeNull();
    expect(parametrosDeCobrancaSchema.parse(base).pix).toBeUndefined();

    const recusa = (corpo: unknown) => parametrosDeCobrancaSchema.safeParse({ ...base, pix: corpo });
    expect(recusa({ ...pix, chave: "11.222.333/0001-99" }).error?.issues[0]?.message).toBe(CHAVE_PIX_INVALIDA);
    for (const corpo of [
      { ...pix, tipo: "BOLETO" },
      { ...pix, tipo: "CPF" }, // CNPJ no tipo CPF
      { ...pix, chave: "" },
      { ...pix, nome: "" },
      { ...pix, nome: "x".repeat(LIMITE_DO_NOME + 1) },
      { ...pix, nome: "***" }, // nada sobra sem os símbolos
      { ...pix, cidade: "" },
      { ...pix, cidade: "x".repeat(LIMITE_DA_CIDADE + 1) },
      "texto",
      {},
    ]) {
      expect(recusa(corpo).success, JSON.stringify(corpo)).toBe(false);
    }
  });
});

describe("Pix Copia e Cola: do título e no aviso de cobrança", () => {
  const empresa = { pixKey: CNPJ_VALIDO, pixName: "Mello Transportes", pixCity: "Mirassol" };
  const recebedor = recebedorDaEmpresa(empresa);

  it("sem chave, nome ou cidade a empresa não tem recebedor, e o título não tem código", () => {
    expect(recebedor).toEqual({ chave: CNPJ_VALIDO, nome: "Mello Transportes", cidade: "Mirassol" });
    for (const incompleta of [null, undefined, { ...empresa, pixKey: null }, { ...empresa, pixName: "" }, { ...empresa, pixCity: null }]) {
      expect(recebedorDaEmpresa(incompleta)).toBeNull();
    }
    expect(pixDoTitulo(null, { id: "a", amount: 10 })).toBeNull();
    expect(pixDoTitulo(recebedor, { id: "a", amount: 0 })).toBeNull();
  });

  it("o código leva o valor do título; o identificador é a fatura, ou o próprio título quando não há fatura", () => {
    const daFatura = pixDoTitulo(recebedor, { id: "3f2b8c1e-9a4d-4e7f-b1c2-0123456789ab", amount: 480.5, invoice: { number: 9001 } });
    expect(daFatura).toContain("5406480.50");
    expect(daFatura).toContain("0509FAT009001");

    const avulso = pixDoTitulo(recebedor, { id: "3f2b8c1e-9a4d-4e7f-b1c2-0123456789ab", amount: 50, invoice: null });
    expect(avulso).toContain("540550.00");
    expect(avulso).toContain("0525TIT3F2B8C1E9A4D4E7FB1C201");
  });

  const titulo = (dados: Partial<TituloEmAberto>): TituloEmAberto => ({
    id: "t1",
    description: "Fatura nº 12 (1 carga)",
    amount: 100,
    dueDate: "2026-01-10T00:00:00.000Z",
    clientId: "c1",
    counterparty: null,
    client: { id: "c1", companyName: "Cliente Ltda", tradeName: null, contactName: "Ana", email: null, phone: null },
    invoice: { id: "f1", number: 12 },
    ...dados,
  });
  const hoje = new Date("2026-02-01T15:00:00.000Z");

  it("a posição de cobrança traz o código de cada título só quando há recebedor", () => {
    const titulos = [titulo({}), titulo({ id: "t2", description: "Frete avulso", amount: 30.1, invoice: null })];

    const semPix = posicaoDeCobranca(titulos, hoje);
    expect(semPix.devedores[0].titulos.every((t) => !("pix" in t))).toBe(true);

    const comPix = posicaoDeCobranca(titulos, hoje, recebedor);
    const [primeiro, segundo] = comPix.devedores[0].titulos;
    expect(primeiro.pix).toBe(pixDoTitulo(recebedor, { id: "t1", amount: 100, invoice: { number: 12 } }));
    expect(segundo.pix).toContain("540530.10");
    // O resto da posição não muda com o Pix.
    expect(comPix.totais).toEqual(semPix.totais);
  });

  it("o aviso só fala de Pix quando o título tem código, e diz que a baixa é manual", () => {
    const [devedorSemPix] = posicaoDeCobranca([titulo({})], hoje).devedores;
    const semPix = textoDoAviso({ empresa: { name: "Mello" }, devedor: devedorSemPix, hoje });
    expect(semPix).not.toMatch(/pix/i);

    const [devedor] = posicaoDeCobranca([titulo({})], hoje, recebedor).devedores;
    const comPix = textoDoAviso({ empresa: { name: "Mello" }, devedor, hoje });
    expect(comPix).toContain("Pix Copia e Cola");
    expect(comPix).toContain(devedor.titulos[0].pix as string);
    expect(comPix).toContain("a baixa é feita manualmente");
    // Fora o trecho do Pix, o aviso é o mesmo.
    expect(comPix.startsWith(semPix.split("\n\nAtenciosamente")[0])).toBe(true);
    expect(comPix.endsWith("Atenciosamente,\nMello")).toBe(true);
  });
});

/** As rotas, contra um Postgres de verdade. */
const temBanco = Boolean(process.env.DATABASE_URL);

if (!temBanco) {
  console.warn("\n[pix.test] DATABASE_URL ausente: testes de integração PULADOS.\n");
}

const suite = temBanco ? describe : describe.skip;

const PREFIXO = "teste-pix-";
const CNPJ_A = "99414141000111";
const CNPJ_B = "99414141000202";
const CNPJ_DA_OUTRA = "99414141000393";
const HASH_FALSO = "$2b$10$hashfalsoparateste000000000000000000000000000000000";

// A cidade cabe no limite do padrão (15) e tem acento e ponto, que saem só na hora de montar o código.
const PIX = { tipo: "CNPJ", chave: "11.222.333/0001-81", nome: "Mello Transportes", cidade: "S. J. Rio Prêto" };

suite("cobrança por Pix: rotas", () => {
  let banco: typeof import("../src/lib/prisma");
  let eventos: typeof import("../src/lib/eventos");
  let cobrancaDaEmpresa: typeof import("../src/app/api/empresa/cobranca/route");
  let webhook: typeof import("../src/app/api/empresa/webhook/route");
  let faturaPorId: typeof import("../src/app/api/faturas/[id]/route");
  let posicao: typeof import("../src/app/api/financeiro/cobranca/route");
  let faturasDoPortal: typeof import("../src/app/api/portal/faturas/route");

  const sessao = vi.mocked(getServerSession);
  const ids = { ADMIN: "", OPERATION: "", DRIVER: "", CLIENTE_A: "", CLIENTE_B: "" };
  const papel = { ADMIN: "ADMIN", OPERATION: "OPERATION", DRIVER: "DRIVER", CLIENTE_A: "CLIENT", CLIENTE_B: "CLIENT" } as const;
  let clienteA: string;
  let clienteB: string;
  let faturaA: { id: string; number: number };
  let tituloDaFatura: string;
  let tituloAvulsoB: string;

  let servidor: Server;
  let endereco: string;
  let recebidos: { tipo: string; dados: Record<string, Record<string, unknown> | null> }[] = [];

  const entrarComo = (quem: keyof typeof ids | null) =>
    sessao.mockResolvedValue(quem ? { user: { id: ids[quem], role: papel[quem], clientId: null } } : null);

  const req = (metodo: string, corpo?: unknown) =>
    new Request("http://localhost/api/teste", {
      method: metodo,
      headers: { "Content-Type": "application/json" },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });

  const gravar = async (corpo: unknown) => {
    const res = await cobrancaDaEmpresa.PATCH(req("PATCH", corpo));
    return { status: res.status, corpo: (await res.json()) as Record<string, unknown> };
  };
  const ler = async () => {
    const res = await cobrancaDaEmpresa.GET();
    return { status: res.status, corpo: (await res.json()) as Record<string, unknown> };
  };

  const SEM_PIX = { pixKeyType: null, pixKey: null, pixName: null, pixCity: null };
  const colunas = (id: string) =>
    banco.sistema.tenant.findUniqueOrThrow({ where: { id }, select: { pixKeyType: true, pixKey: true, pixName: true, pixCity: true } });

  /** As duas empresas voltam ao que eram: sem Pix e com os encargos padrão. */
  const restaurarEmpresas = () =>
    banco.sistema.tenant.updateMany({
      where: { id: { in: [EMPRESA_PADRAO.id, EMPRESA_OUTRA.id] } },
      data: { ...SEM_PIX, lateFinePct: 2, lateInterestPct: 1 },
    });

  async function limpar() {
    const empresas = { tenantId: { in: [EMPRESA_PADRAO.id, EMPRESA_OUTRA.id] } };
    const clientes = { client: { cnpj: { in: [CNPJ_A, CNPJ_B, CNPJ_DA_OUTRA] } } };
    await banco.sistema.outboxEvent.deleteMany({ where: empresas });
    await banco.sistema.webhook.deleteMany({ where: empresas });
    await banco.sistema.financialTransaction.deleteMany({ where: { OR: [{ description: { startsWith: PREFIXO } }, clientes] } });
    await banco.sistema.invoice.deleteMany({ where: clientes });
    await banco.sistema.auditLog.deleteMany({ where: { userName: { startsWith: PREFIXO } } });
    await banco.sistema.user.deleteMany({ where: { email: { startsWith: PREFIXO } } });
    await banco.sistema.client.deleteMany({ where: { cnpj: { in: [CNPJ_A, CNPJ_B, CNPJ_DA_OUTRA] } } });
    await restaurarEmpresas();
  }

  beforeAll(async () => {
    process.env.TMS_WEBHOOK_PERMITE_LOCAL = "1";
    banco = await import("../src/lib/prisma");
    eventos = await import("../src/lib/eventos");
    cobrancaDaEmpresa = await import("../src/app/api/empresa/cobranca/route");
    webhook = await import("../src/app/api/empresa/webhook/route");
    faturaPorId = await import("../src/app/api/faturas/[id]/route");
    posicao = await import("../src/app/api/financeiro/cobranca/route");
    faturasDoPortal = await import("../src/app/api/portal/faturas/route");
    await limpar();

    clienteA = (await banco.default.client.create({ data: { companyName: `${PREFIXO}cliente A`, cnpj: CNPJ_A } })).id;
    clienteB = (await banco.default.client.create({ data: { companyName: `${PREFIXO}cliente B`, cnpj: CNPJ_B } })).id;

    for (const quem of ["ADMIN", "OPERATION", "DRIVER", "CLIENTE_A", "CLIENTE_B"] as const) {
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

    // Cliente A: uma fatura em aberto (com o lançamento dela) e um título já pago.
    const fatura = await banco.default.invoice.create({
      data: {
        number: 9414,
        clientId: clienteA,
        total: 480.5,
        dueDate: new Date("2020-01-10T00:00:00.000Z"),
        transaction: { create: { type: "INCOME", amount: 480.5, description: `${PREFIXO}Fatura nº 9414`, dueDate: new Date("2020-01-10T00:00:00.000Z"), clientId: clienteA } },
      },
      select: { id: true, number: true, transaction: { select: { id: true } } },
    });
    faturaA = { id: fatura.id, number: fatura.number };
    tituloDaFatura = fatura.transaction!.id;
    await banco.default.financialTransaction.create({
      data: { type: "INCOME", amount: 99, description: `${PREFIXO}já pago`, status: "PAID", paidAt: new Date(), clientId: clienteA },
    });
    // Cliente B: um título avulso em aberto, sem fatura.
    tituloAvulsoB = (
      await banco.default.financialTransaction.create({
        data: { type: "INCOME", amount: 50, description: `${PREFIXO}avulso de B`, dueDate: new Date("2020-01-10T00:00:00.000Z"), clientId: clienteB },
      })
    ).id;

    servidor = createServer((pedido, resposta) => {
      let corpo = "";
      pedido.on("data", (parte) => (corpo += parte));
      pedido.on("end", () => {
        recebidos.push(JSON.parse(corpo));
        resposta.writeHead(200).end();
      });
    });
    await new Promise<void>((pronto) => servidor.listen(0, "127.0.0.1", pronto));
    endereco = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/webhook/tms`;
  });

  beforeEach(async () => {
    sessao.mockReset();
    recebidos = [];
    await restaurarEmpresas();
    const empresas = { tenantId: { in: [EMPRESA_PADRAO.id, EMPRESA_OUTRA.id] } };
    await banco.sistema.outboxEvent.deleteMany({ where: empresas });
    await banco.sistema.webhook.deleteMany({ where: empresas });
  });

  afterAll(async () => {
    delete process.env.TMS_WEBHOOK_PERMITE_LOCAL;
    if (servidor) await new Promise((fechado) => servidor.close(fechado));
    if (banco) await limpar();
  });

  /** Cadastra o Pix da empresa padrão, como o administrador faz pela tela. */
  async function cadastrarPix() {
    entrarComo("ADMIN");
    expect((await gravar({ multaPct: 2, jurosPct: 1, pix: PIX })).status).toBe(200);
  }

  describe("cadastro da chave em Empresa > Cobrança", () => {
    it("só o administrador grava: sem sessão 401; operação, cliente e motorista 403; nada muda", async () => {
      for (const [quem, esperado] of [[null, 401], ["OPERATION", 403], ["CLIENTE_A", 403], ["DRIVER", 403]] as const) {
        entrarComo(quem);
        expect((await gravar({ multaPct: 2, jurosPct: 1, pix: PIX })).status, String(quem)).toBe(esperado);
        entrarComo(quem);
        expect((await ler()).status, String(quem)).toBe(esperado);
      }
      expect(await colunas(EMPRESA_PADRAO.id)).toEqual(SEM_PIX);
    });

    it("grava a chave normalizada, a leitura traz, a auditoria registra, e null remove", async () => {
      entrarComo("ADMIN");
      expect((await ler()).corpo).toEqual({ multaPct: 2, jurosPct: 1 });

      entrarComo("ADMIN");
      const gravado = await gravar({ multaPct: 2, jurosPct: 1, pix: PIX });
      expect(gravado).toEqual({ status: 200, corpo: { multaPct: 2, jurosPct: 1, pix: { ...PIX, chave: CNPJ_VALIDO } } });
      expect(await colunas(EMPRESA_PADRAO.id)).toEqual({ pixKeyType: "CNPJ", pixKey: CNPJ_VALIDO, pixName: PIX.nome, pixCity: PIX.cidade });
      entrarComo("ADMIN");
      expect((await ler()).corpo).toEqual(gravado.corpo);

      const linha = await banco.sistema.auditLog.findFirstOrThrow({ where: { action: "empresa.cobranca", userId: ids.ADMIN }, orderBy: { createdAt: "desc" } });
      expect(linha.before).toEqual({ pix: null });
      expect(linha.after).toEqual({ pix: `CNPJ ${CNPJ_VALIDO} | ${PIX.nome} | ${PIX.cidade}` });
      expect(linha.summary).toContain("Pix por CNPJ");

      // Salvar só os encargos (sem `pix` no corpo) não mexe na chave.
      entrarComo("ADMIN");
      expect((await gravar({ multaPct: 3, jurosPct: 1 })).corpo).toMatchObject({ multaPct: 3, pix: { chave: CNPJ_VALIDO } });

      entrarComo("ADMIN");
      expect((await gravar({ multaPct: 3, jurosPct: 1, pix: null })).corpo).toEqual({ multaPct: 3, jurosPct: 1 });
      expect(await colunas(EMPRESA_PADRAO.id)).toEqual(SEM_PIX);
    });

    it("chave que não confere com o tipo, nome ou cidade fora do limite: 400 e nada é gravado", async () => {
      for (const pix of [
        { ...PIX, chave: "11.222.333/0001-99" },
        { ...PIX, tipo: "EMAIL" },
        { ...PIX, tipo: "QUALQUER" },
        { ...PIX, nome: "x".repeat(26) },
        { ...PIX, cidade: "" },
        { ...PIX, cidade: "São José do Rio Preto" }, // 21 letras: passa do limite de 15
        "texto",
      ]) {
        entrarComo("ADMIN");
        expect((await gravar({ multaPct: 2, jurosPct: 1, pix })).status, JSON.stringify(pix)).toBe(400);
      }
      expect(await colunas(EMPRESA_PADRAO.id)).toEqual(SEM_PIX);
    });

    it("isolamento: a chave fica na empresa da sessão, mesmo com o id de outra no corpo", async () => {
      entrarComo("ADMIN");
      expect((await gravar({ multaPct: 2, jurosPct: 1, pix: PIX, id: EMPRESA_OUTRA.id, tenantId: EMPRESA_OUTRA.id })).status).toBe(200);
      expect((await colunas(EMPRESA_PADRAO.id)).pixKey).toBe(CNPJ_VALIDO);
      expect(await colunas(EMPRESA_OUTRA.id)).toEqual(SEM_PIX);
    });
  });

  describe("onde o código aparece", () => {
    const esperado = () =>
      pixCopiaECola({ chave: CNPJ_VALIDO, nome: PIX.nome, cidade: PIX.cidade, valor: 480.5, txid: txidDaFatura(faturaA.number) });

    const verFatura = async () => {
      entrarComo("ADMIN");
      const res = await faturaPorId.GET(req("GET"), { params: Promise.resolve({ id: faturaA.id }) });
      return (await res.json()) as { pix: string | null; number: number };
    };

    const verPortal = async (quem: "CLIENTE_A" | "CLIENTE_B") => {
      entrarComo(quem);
      const res = await faturasDoPortal.GET();
      expect(res.status).toBe(200);
      return (await res.json()) as { id: string; status: string; amount: number; pix: string | null }[];
    };

    it("sem chave cadastrada, a fatura, o portal e a posição de cobrança saem sem Pix", async () => {
      expect((await verFatura()).pix).toBeNull();
      expect((await verPortal("CLIENTE_A")).every((titulo) => titulo.pix === null)).toBe(true);

      entrarComo("ADMIN");
      const corpo = (await (await posicao.GET()).json()) as { devedores: { titulos: Record<string, unknown>[] }[] };
      expect(corpo.devedores.flatMap((d) => d.titulos).some((titulo) => "pix" in titulo)).toBe(false);
    });

    it("fatura do painel: em aberto traz o código com o total e FAT + número; paga não traz", async () => {
      await cadastrarPix();
      expect((await verFatura()).pix).toBe(esperado());
      expect(esperado()).toContain("0509FAT009414");
      expect(esperado()).toContain("6013S J Rio Preto");

      await banco.default.invoice.update({ where: { id: faturaA.id }, data: { status: "PAID", paidAt: new Date() } });
      try {
        expect((await verFatura()).pix).toBeNull();
      } finally {
        await banco.default.invoice.update({ where: { id: faturaA.id }, data: { status: "OPEN", paidAt: null } });
      }
    });

    it("portal: o título em aberto do cliente traz o mesmo código da fatura; o pago não; e um cliente não vê o do outro", async () => {
      await cadastrarPix();

      const deA = await verPortal("CLIENTE_A");
      expect(deA).toHaveLength(2);
      expect(deA.find((titulo) => titulo.id === tituloDaFatura)?.pix).toBe(esperado());
      expect(deA.find((titulo) => titulo.status === "PAID")?.pix).toBeNull();
      // A resposta não ganha o número da fatura nem outro dado além do código (e da cobrança do
      // Mercado Pago em aberto, nula aqui: tests/gateway.test.ts).
      expect(Object.keys(deA[0]).sort()).toEqual(["amount", "cobranca", "createdAt", "description", "dueDate", "id", "pix", "status"]);
      expect(deA.every((titulo) => (titulo as { cobranca?: unknown }).cobranca === null)).toBe(true);

      const deB = await verPortal("CLIENTE_B");
      expect(deB.map((titulo) => titulo.id)).toEqual([tituloAvulsoB]);
      // Título sem fatura: o identificador é o do próprio título.
      expect(deB[0].pix).toBe(pixCopiaECola({ chave: CNPJ_VALIDO, nome: PIX.nome, cidade: PIX.cidade, valor: 50, txid: txidDoTitulo(tituloAvulsoB) }));
    });

    it("portal: só cliente entra (sem sessão 401; equipe e motorista 401)", async () => {
      for (const quem of [null, "ADMIN", "OPERATION", "DRIVER"] as const) {
        entrarComo(quem);
        expect((await faturasDoPortal.GET()).status, String(quem)).toBe(401);
      }
    });

    it("posição de cobrança: cada título em aberto sai com o código dele, que entra no aviso", async () => {
      await cadastrarPix();
      entrarComo("ADMIN");
      const corpo = (await (await posicao.GET()).json()) as { empresa: { name: string }; devedores: { clientId: string | null; titulos: { id: string; pix?: string | null }[] }[] };

      const devedorA = corpo.devedores.find((d) => d.clientId === clienteA)!;
      expect(devedorA.titulos.map((titulo) => titulo.pix)).toEqual([esperado()]);
      // A empresa do aviso continua só com o nome: a chave não vai solta na resposta.
      expect(corpo.empresa).toEqual({ name: EMPRESA_PADRAO.name });
    });

    it("isolamento entre empresas: a chave de uma não aparece nos títulos da outra", async () => {
      await cadastrarPix();
      const outra = banco.paraEmpresa(EMPRESA_OUTRA.id).db;
      const alheio = await outra.client.create({ data: { companyName: `${PREFIXO}da outra`, cnpj: CNPJ_DA_OUTRA } });
      const faturaAlheia = await outra.invoice.create({ data: { number: 9415, clientId: alheio.id, total: 70, dueDate: new Date("2020-01-10T00:00:00.000Z") } });

      // A fatura da outra empresa não existe para o administrador desta.
      entrarComo("ADMIN");
      expect((await faturaPorId.GET(req("GET"), { params: Promise.resolve({ id: faturaAlheia.id }) })).status).toBe(404);
      // E a outra empresa, sem chave própria, não herda a desta.
      expect(recebedorDaEmpresa(await outra.tenant.findUnique({ where: { id: EMPRESA_OUTRA.id }, select: { pixKey: true, pixName: true, pixCity: true } }))).toBeNull();
      expect(await outra.tenant.findUnique({ where: { id: EMPRESA_PADRAO.id }, select: { pixKey: true } })).toBeNull();
    });
  });

  describe("avisos para o n8n", () => {
    async function cadastrarEndereco() {
      entrarComo("ADMIN");
      const res = await webhook.PUT(req("PUT", { url: endereco }));
      expect(res.status).toBe(201);
    }

    const emitirFatura = (numero: number) =>
      banco.default.invoice.create({ data: { number: numero, clientId: clienteA, total: 120, dueDate: new Date("2026-11-10T00:00:00.000Z") } });

    it("fatura.emitida e cobranca.vencida levam o pixCopiaECola quando a empresa tem chave", async () => {
      await cadastrarEndereco();
      await cadastrarPix();

      const nova = await emitirFatura(9416);
      // Os dois títulos vencidos desta suíte (o da fatura de A e o avulso de B).
      expect(await eventos.avisarTitulosVencidos()).toBeGreaterThanOrEqual(2);
      await eventos.despacharPendentes();

      const emitida = recebidos.find((r) => r.tipo === "fatura.emitida")!;
      expect(emitida.dados.fatura).toMatchObject({
        id: nova.id,
        pixCopiaECola: pixCopiaECola({ chave: CNPJ_VALIDO, nome: PIX.nome, cidade: PIX.cidade, valor: 120, txid: "FAT009416" }),
      });

      const vencidos = recebidos.filter((r) => r.tipo === "cobranca.vencida").map((r) => r.dados.titulo as { id: string; pixCopiaECola?: string });
      expect(vencidos.find((titulo) => titulo.id === tituloDaFatura)?.pixCopiaECola).toBe(
        pixCopiaECola({ chave: CNPJ_VALIDO, nome: PIX.nome, cidade: PIX.cidade, valor: 480.5, txid: "FAT009414" }),
      );
      expect(vencidos.find((titulo) => titulo.id === tituloAvulsoB)?.pixCopiaECola).toContain("540550.00");
    });

    it("sem chave cadastrada os avisos saem como antes, sem o campo; e fatura paga não leva código", async () => {
      await cadastrarEndereco();
      await emitirFatura(9417);
      await eventos.avisarTitulosVencidos();
      await eventos.despacharPendentes();
      expect(recebidos.length).toBeGreaterThan(0);
      for (const recebido of recebidos) {
        expect("pixCopiaECola" in (recebido.dados.fatura ?? recebido.dados.titulo ?? {}), recebido.tipo).toBe(false);
      }

      // Com chave, o aviso de pagamento não leva código: só o de emissão, e só com a fatura em aberto.
      recebidos = [];
      await cadastrarPix();
      const paga = await emitirFatura(9418);
      await banco.default.invoice.update({ where: { id: paga.id }, data: { status: "PAID", paidAt: new Date() } });
      await eventos.despacharPendentes();
      expect(recebidos.map((r) => r.tipo)).toEqual(["fatura.emitida", "fatura.paga"]);
      for (const recebido of recebidos) expect("pixCopiaECola" in recebido.dados.fatura!, recebido.tipo).toBe(false);
    });
  });
});
