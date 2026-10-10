import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getServerSession } from "next-auth";
import {
  ACOES,
  CAMPOS_PROIBIDOS,
  TAMANHO_DA_PAGINA,
  campoProibido,
  diferencas,
  filtroDeAuditoria,
  filtrosDeAuditoriaSchema,
  linhaDeAuditoria,
  linhasDoAntesEDepois,
  nadaMudou,
  origemDaRequisicao,
  resumoDoDispositivo,
  rotuloDaAcao,
  valorLegivel,
  type LinhaDeAuditoria,
} from "../src/lib/auditoria";
import { EMPRESA_OUTRA, EMPRESA_PADRAO } from "./empresas-de-teste";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

// PNG de 1x1 pixel.
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const CHROME_WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

describe("auditoria: o que entra em antes e depois", () => {
  it("campo proibido não entra: senha, hash, segredo, token, símbolo, foto, assinatura e XML, em qualquer caixa e profundidade", () => {
    for (const campo of ["password", "Password", "passwordHash", "senha", "secret", "webhookSecret", "segredo", "token", "accessToken", "logo", "photo", "photoData", "foto", "signature", "assinatura", "image", "imagem", "xml"]) {
      expect(campoProibido(campo), campo).toBe(true);
    }
    for (const campo of ["name", "email", "status", "url", "role", "amount", "cnpj", "phone"]) {
      expect(campoProibido(campo), campo).toBe(false);
    }
    // A lista é o contrato: tirar um item dela precisa quebrar este teste.
    expect([...CAMPOS_PROIBIDOS].sort()).toEqual(
      ["assinatura", "foto", "hash", "image", "imagem", "logo", "password", "photo", "secret", "segredo", "senha", "signature", "token", "xml"].sort(),
    );

    const { antes, depois } = diferencas(
      { name: "Ana", password: "hash-antigo", secret: "s1", logo: PNG, perfil: { token: "t1", nome: "a" } },
      { name: "Ana Maria", password: "hash-novo", secret: "s2", logo: null, perfil: { token: "t2", nome: "b" } },
    );
    expect(antes).toEqual({ name: "Ana", perfil: { nome: "a" } });
    expect(depois).toEqual({ name: "Ana Maria", perfil: { nome: "b" } });
    expect(JSON.stringify({ antes, depois })).not.toMatch(/hash-|s1|s2|t1|t2|data:image/);
  });

  it("imagem embutida é omitida mesmo num campo de nome inocente, e texto longo é cortado", () => {
    const { depois } = diferencas(null, { anexo: PNG, observacao: "x".repeat(2000) });
    expect(depois?.anexo).toBe("[conteúdo omitido]");
    expect(String(depois?.observacao).length).toBeLessThanOrEqual(501);
  });

  it("alteração guarda só os campos que mudaram, nos dois lados", () => {
    const antes = { id: "1", name: "Mello", phone: null, active: true, createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01") };
    const depois = { id: "1", name: "Mello", phone: "17 99999-0000", active: false, createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-10-09") };
    expect(diferencas(antes, depois)).toEqual({ antes: { phone: null, active: true }, depois: { phone: "17 99999-0000", active: false } });
    expect(nadaMudou(antes, depois)).toBe(false);
    // Id, empresa, datas de controle e contadores não contam como mudança.
    expect(nadaMudou(antes, { ...antes, updatedAt: new Date(), _count: { x: 1 } })).toBe(true);
    expect(diferencas(antes, { ...antes })).toEqual({ antes: null, depois: null });
  });

  it("criação guarda os campos preenchidos em depois; exclusão, em antes", () => {
    expect(diferencas(null, { id: "1", name: "Nova", phone: null, amount: 10 })).toEqual({ antes: null, depois: { name: "Nova", amount: 10 } });
    expect(diferencas({ id: "1", description: "Diesel", notes: null }, null)).toEqual({ antes: { description: "Diesel" }, depois: null });
    expect(diferencas(null, null)).toEqual({ antes: null, depois: null });
  });

  it("data vira texto ISO, e data igual não é mudança", () => {
    const dia = new Date("2026-10-09T00:00:00.000Z");
    expect(diferencas({ dueDate: dia }, { dueDate: new Date(dia) })).toEqual({ antes: null, depois: null });
    expect(diferencas({ dueDate: null }, { dueDate: dia }).depois).toEqual({ dueDate: "2026-10-09T00:00:00.000Z" });
  });

  it("a linha pronta para o banco leva quem fez, de onde, e nada proibido", () => {
    const linha = linhaDeAuditoria({
      ator: { id: "u1", name: "Ana", role: "ADMIN" },
      origem: { ip: "203.0.113.7", dispositivo: "Safari no iPhone" },
      acao: "usuario.perfil",
      entidade: "usuario",
      entidadeId: "u2",
      resumo: "r".repeat(500),
      antes: { role: "OPERATION", password: "x" },
      depois: { role: "ADMIN", password: "y" },
    });
    expect(linha).toMatchObject({
      userId: "u1",
      userName: "Ana",
      userRole: "ADMIN",
      action: "usuario.perfil",
      entity: "usuario",
      entityId: "u2",
      before: { role: "OPERATION" },
      after: { role: "ADMIN" },
      ip: "203.0.113.7",
      device: "Safari no iPhone",
    });
    expect(linha.summary.length).toBe(300);
  });
});

describe("auditoria: de onde veio a ação", () => {
  it("resume o user-agent em navegador e aparelho", () => {
    expect(resumoDoDispositivo(IPHONE)).toBe("Safari no iPhone");
    expect(resumoDoDispositivo(CHROME_WINDOWS)).toBe("Chrome no Windows");
    expect(resumoDoDispositivo(`${CHROME_WINDOWS} Edg/126.0.0.0`)).toBe("Edge no Windows");
    expect(resumoDoDispositivo("Mozilla/5.0 (Android 14; Mobile; rv:127.0) Gecko/127.0 Firefox/127.0")).toBe("Firefox no Android");
    expect(resumoDoDispositivo("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36")).toBe("Chrome no Android");
    expect(resumoDoDispositivo("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15")).toBe("Safari no Mac");
    expect(resumoDoDispositivo("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1")).toBe("Chrome no iPhone");
  });

  it("o que não reconhece fica como veio, cortado; ausente é nulo", () => {
    expect(resumoDoDispositivo("curl/8.5.0")).toBe("curl/8.5.0");
    expect(resumoDoDispositivo("x".repeat(300))?.length).toBe(80);
    for (const vazio of [null, undefined, "", "   "]) expect(resumoDoDispositivo(vazio)).toBeNull();
  });

  it("IP é o primeiro valor de x-forwarded-for; cabeçalho ausente ou que não parece IP fica nulo", () => {
    const req = (headers: Record<string, string>) => new Request("http://localhost/x", { headers });
    expect(origemDaRequisicao(req({ "x-forwarded-for": "203.0.113.7, 10.0.0.1, 172.31.0.2", "user-agent": IPHONE }))).toEqual({ ip: "203.0.113.7", dispositivo: "Safari no iPhone" });
    expect(origemDaRequisicao(req({ "x-forwarded-for": " 2001:db8::1 " })).ip).toBe("2001:db8::1");
    expect(origemDaRequisicao(req({ "x-real-ip": "198.51.100.4" })).ip).toBe("198.51.100.4");
    expect(origemDaRequisicao(req({}))).toEqual({ ip: null, dispositivo: null });
    for (const lixo of ["<script>alert(1)</script>", "desconhecido", "1".repeat(60), ""]) {
      expect(origemDaRequisicao(req({ "x-forwarded-for": lixo })).ip, lixo).toBeNull();
    }
    // Rota chamada sem requisição (teste, script): nada a ler, e nada quebra.
    expect(origemDaRequisicao(undefined)).toEqual({ ip: null, dispositivo: null });
    expect(origemDaRequisicao(null)).toEqual({ ip: null, dispositivo: null });
  });
});

describe("auditoria: filtros e leitura", () => {
  it("o período é em dias do Brasil, com o último dia inteiro", () => {
    const filtro = filtroDeAuditoria({ de: "2026-10-01", ate: "2026-10-09" });
    expect(filtro).toEqual({ createdAt: { gte: new Date("2026-10-01T03:00:00.000Z"), lt: new Date("2026-10-10T03:00:00.000Z") } });
    expect(filtroDeAuditoria({ de: "2026-10-01" })).toEqual({ createdAt: { gte: new Date("2026-10-01T03:00:00.000Z") } });
    expect(filtroDeAuditoria({})).toEqual({});
  });

  it("usuário, ação, entidade e id viram filtro exato; o id aceita só o começo", () => {
    expect(filtroDeAuditoria({ usuario: "u1", acao: "fatura.pagar", entidade: "fatura", id: "abc" })).toEqual({
      userId: "u1",
      action: "fatura.pagar",
      entity: "fatura",
      entityId: { startsWith: "abc" },
    });
  });

  it("filtro vazio é o mesmo que ausente; data inválida e período invertido são recusados", () => {
    expect(filtrosDeAuditoriaSchema.parse({ de: "", ate: " ", usuario: "", acao: "", entidade: "", id: "", cursor: "" })).toEqual({});
    expect(filtrosDeAuditoriaSchema.parse({ id: "  abc  " })).toEqual({ id: "abc" });
    for (const ruim of [{ de: "09/10/2026" }, { ate: "2026-13-40" }, { de: "ontem" }, { de: "2026-10-09", ate: "2026-10-01" }]) {
      expect(filtrosDeAuditoriaSchema.safeParse(ruim).success, JSON.stringify(ruim)).toBe(false);
    }
  });

  it("toda ação tem rótulo, e ação desconhecida aparece com o próprio nome", () => {
    for (const [acao, rotulo] of Object.entries(ACOES)) expect(rotulo.length, acao).toBeGreaterThan(3);
    expect(rotuloDaAcao("fatura.pagar")).toBe("Fatura paga");
    expect(rotuloDaAcao("coisa.nova")).toBe("coisa.nova");
  });

  it("antes e depois viram linhas legíveis: sim/não, data em português, vazio", () => {
    expect(valorLegivel(true)).toBe("sim");
    expect(valorLegivel(false)).toBe("não");
    expect(valorLegivel(null)).toBe("(vazio)");
    expect(valorLegivel("2026-10-09T00:00:00.000Z")).toBe("09/10/2026");
    expect(valorLegivel("2026-10-09T18:30:00.000Z")).toMatch(/09\/10\/2026.*15:30/);
    expect(valorLegivel("PAID")).toBe("PAID");

    expect(linhasDoAntesEDepois({ status: "PENDING", paidAt: null }, { status: "PAID", paidAt: "2026-10-09T00:00:00.000Z" })).toEqual([
      { campo: "status", rotulo: "Status", antes: "PENDING", depois: "PAID" },
      { campo: "paidAt", rotulo: "Pago em", antes: "(vazio)", depois: "09/10/2026" },
    ]);
    expect(linhasDoAntesEDepois(null, { name: "Nova" })).toEqual([{ campo: "name", rotulo: "Nome", antes: "", depois: "Nova" }]);
    expect(linhasDoAntesEDepois(null, null)).toEqual([]);
  });
});

/** As rotas, contra um Postgres de verdade. */
const temBanco = Boolean(process.env.DATABASE_URL);

if (!temBanco) {
  console.warn("\n[auditoria.test] DATABASE_URL ausente: testes de integração PULADOS.\n");
}

const suite = temBanco ? describe : describe.skip;

// Tudo o que esta suite cria usa estes marcadores, e só isso é apagado.
const PREFIXO = "teste-auditoria-";
const CNPJ = "45997418000153";
const PLACA = "AUD1T23";
const MARCA = "teste-auditoria"; // nome de quem fez, descrição de lançamento, id de linha fabricada
const HASH_FALSO = "$2b$10$hashfalsoparateste000000000000000000000000000000000";

type Perfil = "ADMIN" | "OPERATION" | "CLIENT" | "DRIVER";
type Pagina = { registros: LinhaDeAuditoria[]; proximo: string | null };

suite("auditoria: rotas", () => {
  let banco: typeof import("../src/lib/prisma");
  let auditoria: typeof import("../src/app/api/auditoria/route");
  let clientes: typeof import("../src/app/api/clientes/route");
  let cliente: typeof import("../src/app/api/clientes/[id]/route");
  let financeiro: typeof import("../src/app/api/financeiro/route");
  let lancamento: typeof import("../src/app/api/financeiro/[id]/route");
  let usuario: typeof import("../src/app/api/usuarios/[id]/route");
  let empresa: typeof import("../src/app/api/empresa/route");
  let webhook: typeof import("../src/app/api/empresa/webhook/route");
  let coletas: typeof import("../src/app/api/coletas/route");
  let coletaStatus: typeof import("../src/app/api/dashboard/coletas/[id]/status/route");
  let veiculos: typeof import("../src/app/api/veiculos/route");
  let veiculo: typeof import("../src/app/api/veiculos/[id]/route");

  const sessao = vi.mocked(getServerSession);
  const ids = {} as Record<Perfil | "ALVO", string>;
  let adminDaOutra: string;

  const entrarComo = (perfil: Perfil | null) =>
    sessao.mockResolvedValue(perfil ? { user: { id: ids[perfil], role: perfil, clientId: null } } : null);
  const entrarNaOutra = () => sessao.mockResolvedValue({ user: { id: adminDaOutra, role: "ADMIN", clientId: null, tenantId: EMPRESA_OUTRA.id } });

  const req = (method = "GET", body?: unknown, headers: Record<string, string> = {}) =>
    new Request("http://localhost/api/teste", {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

  const listar = async (query = ""): Promise<Pagina> => {
    const res = await auditoria.GET(new Request(`http://localhost/api/auditoria${query}`));
    expect(res.status, query).toBe(200);
    return (await res.json()) as Pagina;
  };

  /** As linhas desta suite na empresa padrão, da mais antiga para a mais nova. */
  const linhas = (onde: Record<string, unknown> = {}) =>
    banco.sistema.auditLog.findMany({
      where: { tenantId: EMPRESA_PADRAO.id, userName: { startsWith: MARCA }, ...onde },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
  const ultima = async (acao: string) => {
    const achadas = await linhas({ action: acao });
    expect(achadas.length, acao).toBeGreaterThan(0);
    return achadas[achadas.length - 1];
  };

  async function limpar() {
    const s = banco.sistema;
    await s.auditLog.deleteMany({ where: { OR: [{ userName: { startsWith: MARCA } }, { entityId: { startsWith: MARCA } }] } });
    await s.webhook.deleteMany({ where: { tenantId: EMPRESA_PADRAO.id, url: { contains: "8.8.8.8" } } });
    await s.financialTransaction.deleteMany({ where: { description: { startsWith: MARCA } } });
    await s.collection.deleteMany({ where: { client: { cnpj: CNPJ } } });
    await s.vehicle.deleteMany({ where: { plate: PLACA } });
    await s.user.deleteMany({ where: { email: { startsWith: PREFIXO } } });
    await s.client.deleteMany({ where: { cnpj: CNPJ } });
    await s.tenant.update({ where: { id: EMPRESA_PADRAO.id }, data: { name: EMPRESA_PADRAO.name, logo: null } });
  }

  beforeAll(async () => {
    banco = await import("../src/lib/prisma");
    auditoria = await import("../src/app/api/auditoria/route");
    clientes = await import("../src/app/api/clientes/route");
    cliente = await import("../src/app/api/clientes/[id]/route");
    financeiro = await import("../src/app/api/financeiro/route");
    lancamento = await import("../src/app/api/financeiro/[id]/route");
    usuario = await import("../src/app/api/usuarios/[id]/route");
    empresa = await import("../src/app/api/empresa/route");
    webhook = await import("../src/app/api/empresa/webhook/route");
    coletas = await import("../src/app/api/coletas/route");
    coletaStatus = await import("../src/app/api/dashboard/coletas/[id]/status/route");
    veiculos = await import("../src/app/api/veiculos/route");
    veiculo = await import("../src/app/api/veiculos/[id]/route");

    await limpar();

    const criar = (db: typeof banco.default, nome: string, role: Perfil) =>
      db.user.create({ data: { name: `${MARCA} ${nome}`, email: `${PREFIXO}${nome}@exemplo.br`, password: HASH_FALSO, role } });
    for (const perfil of ["ADMIN", "OPERATION", "CLIENT", "DRIVER"] as const) {
      ids[perfil] = (await criar(banco.default, perfil.toLowerCase(), perfil)).id;
    }
    ids.ALVO = (await criar(banco.default, "alvo", "OPERATION")).id;
    adminDaOutra = (await criar(banco.paraEmpresa(EMPRESA_OUTRA.id).db as typeof banco.default, "outra", "ADMIN")).id;
  });

  beforeEach(() => {
    sessao.mockReset();
  });

  afterAll(async () => {
    if (banco) await limpar();
  });

  it("ler a auditoria é só do administrador: sem sessão 401, demais perfis 403", async () => {
    for (const [perfil, esperado] of [[null, 401], ["OPERATION", 403], ["CLIENT", 403], ["DRIVER", 403], ["ADMIN", 200]] as const) {
      entrarComo(perfil);
      const res = await auditoria.GET(new Request("http://localhost/api/auditoria"));
      expect(res.status, String(perfil)).toBe(esperado);
    }
  });

  describe("as ações principais geram linha com o usuário certo", () => {
    let clienteId: string;

    it("criar cliente: quem fez, perfil, IP, dispositivo e os campos preenchidos", async () => {
      entrarComo("OPERATION");
      const res = await clientes.POST(
        req("POST", { cnpj: CNPJ, companyName: "Auditada Ltda" }, { "x-forwarded-for": "203.0.113.7, 10.0.0.1", "user-agent": IPHONE }),
      );
      expect(res.status).toBe(201);
      clienteId = ((await res.json()) as { id: string }).id;

      const linha = await ultima("cliente.criar");
      expect(linha).toMatchObject({
        tenantId: EMPRESA_PADRAO.id,
        userId: ids.OPERATION,
        userName: `${MARCA} operation`,
        userRole: "OPERATION",
        entity: "cliente",
        entityId: clienteId,
        summary: "Cliente Auditada Ltda criado",
        before: null,
        ip: "203.0.113.7",
        device: "Safari no iPhone",
      });
      expect(linha.after).toMatchObject({ cnpj: CNPJ, companyName: "Auditada Ltda", active: true });
      // Campo vazio não polui a linha da criação.
      expect(linha.after).not.toHaveProperty("phone");
    });

    it("alterar cliente guarda só o que mudou; desativar e reativar têm ação própria; salvar igual não gera linha", async () => {
      entrarComo("ADMIN");
      expect((await cliente.PATCH(req("PATCH", { phone: "17 99999-0000" }), ctx(clienteId))).status).toBe(200);
      const alterou = await ultima("cliente.alterar");
      expect(alterou).toMatchObject({ userId: ids.ADMIN, userRole: "ADMIN", entityId: clienteId, before: { phone: null }, after: { phone: "17 99999-0000" }, ip: null, device: null });

      expect((await cliente.PATCH(req("PATCH", { active: false }), ctx(clienteId))).status).toBe(200);
      expect(await ultima("cliente.desativar")).toMatchObject({ before: { active: true }, after: { active: false }, summary: "Cliente Auditada Ltda desativado" });
      expect((await cliente.PATCH(req("PATCH", { active: true }), ctx(clienteId))).status).toBe(200);
      expect(await ultima("cliente.reativar")).toMatchObject({ before: { active: false }, after: { active: true } });

      const antes = (await linhas({ entityId: clienteId })).length;
      expect((await cliente.PATCH(req("PATCH", { phone: "17 99999-0000", active: true }), ctx(clienteId))).status).toBe(200);
      expect((await linhas({ entityId: clienteId })).length).toBe(antes);
    });

    it("carga: criar e mudar de status, com o status antigo e o novo", async () => {
      entrarComo("OPERATION");
      const res = await coletas.POST(
        req("POST", { clientId: clienteId, sender: "Remetente", receiver: "Destino Ltda", origin: "Rio Preto", destination: "Mirassol", volumes: 2, weight: 10 }),
      );
      expect(res.status).toBe(201);
      const carga = (await res.json()) as { id: string; trackingCode: string };
      const criou = await ultima("coleta.criar");
      expect(criou).toMatchObject({ userId: ids.OPERATION, entity: "coleta", entityId: carga.id });
      expect(criou.after).toMatchObject({ status: "CONFIRMED", receiver: "Destino Ltda", volumes: 2, trackingCode: carga.trackingCode });

      expect((await coletaStatus.POST(req("POST", { status: "COLLECTED" }, { "user-agent": CHROME_WINDOWS }), ctx(carga.id))).status).toBe(200);
      expect(await ultima("coleta.status")).toMatchObject({
        userId: ids.OPERATION,
        entityId: carga.id,
        before: { status: "CONFIRMED" },
        after: { status: "COLLECTED" },
        device: "Chrome no Windows",
      });

      // Troca que a regra recusa (coletada não volta a confirmada) não gera linha.
      const antes = (await linhas({ action: "coleta.status" })).length;
      expect((await coletaStatus.POST(req("POST", { status: "CONFIRMED" }), ctx(carga.id))).status).toBe(409);
      expect((await linhas({ action: "coleta.status" })).length).toBe(antes);
    });

    it("lançamento: criar, pagar e excluir; o excluído fica guardado no antes", async () => {
      entrarComo("ADMIN");
      const res = await financeiro.POST(req("POST", { type: "EXPENSE", amount: 150.5, description: `${MARCA} diesel`, dueDate: "2026-10-20" }));
      expect(res.status).toBe(201);
      const { id } = (await res.json()) as { id: string };
      expect(await ultima("lancamento.criar")).toMatchObject({ userId: ids.ADMIN, entity: "lancamento", entityId: id, after: { type: "EXPENSE", amount: 150.5, status: "PENDING" } });

      expect((await lancamento.PATCH(req("PATCH", { action: "pagar", paymentMethod: "PIX" }), ctx(id))).status).toBe(200);
      const pagou = await ultima("lancamento.pagar");
      expect(pagou.before).toEqual({ status: "PENDING", paidAt: null, paymentMethod: null });
      expect(pagou.after).toMatchObject({ status: "PAID", paymentMethod: "PIX" });

      // Pagar de novo é recusado dentro da transação: a linha não fica.
      const antes = (await linhas({ entityId: id })).length;
      expect((await lancamento.PATCH(req("PATCH", { action: "pagar" }), ctx(id))).status).toBe(409);
      expect((await linhas({ entityId: id })).length).toBe(antes);

      expect((await lancamento.DELETE(req("DELETE"), ctx(id))).status).toBe(200);
      const excluiu = await ultima("lancamento.excluir");
      expect(excluiu).toMatchObject({ entityId: id, after: null });
      expect(excluiu.before).toMatchObject({ description: `${MARCA} diesel`, amount: 150.5, status: "PAID" });
    });

    it("troca de perfil de usuário: ação própria, com o perfil antigo e o novo, e sem senha", async () => {
      entrarComo("ADMIN");
      expect((await usuario.PATCH(req("PATCH", { role: "ADMIN" }), ctx(ids.ALVO))).status).toBe(200);
      const trocou = await ultima("usuario.perfil");
      expect(trocou).toMatchObject({ userId: ids.ADMIN, entity: "usuario", entityId: ids.ALVO, before: { role: "OPERATION" }, after: { role: "ADMIN" } });

      expect((await usuario.PATCH(req("PATCH", { name: `${MARCA} alvo renomeado` }), ctx(ids.ALVO))).status).toBe(200);
      expect(await ultima("usuario.alterar")).toMatchObject({ entityId: ids.ALVO, before: { name: `${MARCA} alvo` }, after: { name: `${MARCA} alvo renomeado` } });

      // Recusa dentro da transação (tirar o próprio perfil) não deixa linha.
      const antes = (await linhas({ entity: "usuario" })).length;
      expect((await usuario.PATCH(req("PATCH", { role: "OPERATION" }), ctx(ids.ADMIN))).status).toBe(409);
      expect((await linhas({ entity: "usuario" })).length).toBe(antes);
    });

    it("veículo: criar e alterar", async () => {
      entrarComo("OPERATION");
      const res = await veiculos.POST(req("POST", { plate: PLACA, model: "Sprinter", type: "VAN" }));
      expect(res.status).toBe(201);
      const { id } = (await res.json()) as { id: string };
      expect(await ultima("veiculo.criar")).toMatchObject({ userId: ids.OPERATION, entity: "veiculo", entityId: id, after: { plate: PLACA, model: "Sprinter" } });

      expect((await veiculo.PATCH(req("PATCH", { status: "MAINTENANCE" }), ctx(id))).status).toBe(200);
      expect(await ultima("veiculo.alterar")).toMatchObject({ entityId: id, before: { status: "AVAILABLE" }, after: { status: "MAINTENANCE" } });
    });

    it("empresa: o símbolo entra como 'próprio' ou 'padrão', nunca a imagem", async () => {
      entrarComo("ADMIN");
      expect((await empresa.PATCH(req("PATCH", { name: "Auditada Transportes", logo: PNG }))).status).toBe(200);
      const linha = await ultima("empresa.alterar");
      expect(linha).toMatchObject({
        userId: ids.ADMIN,
        entity: "empresa",
        entityId: EMPRESA_PADRAO.id,
        before: { name: EMPRESA_PADRAO.name, simbolo: "padrão" },
        after: { name: "Auditada Transportes", simbolo: "próprio" },
      });
      expect(JSON.stringify(linha)).not.toContain("data:image");
      await banco.sistema.tenant.update({ where: { id: EMPRESA_PADRAO.id }, data: { name: EMPRESA_PADRAO.name, logo: null } });
    });

    it("integração: o endereço entra, o segredo não", async () => {
      entrarComo("ADMIN");
      const gravar = (corpo: unknown) => webhook.PUT(req("PUT", corpo));
      const criou = await gravar({ url: "https://8.8.8.8/webhook/auditoria" });
      expect(criou.status).toBe(201);
      const { segredo } = (await criou.json()) as { segredo: string };
      expect(segredo.length).toBeGreaterThan(20);

      const trocou = await gravar({ url: "https://8.8.8.8/webhook/auditoria", novoSegredo: true });
      const { segredo: segundo } = (await trocou.json()) as { segredo: string };
      expect((await gravar({ url: null })).status).toBe(200);

      const daIntegracao = await linhas({ entity: "integracao" });
      expect(daIntegracao.map((l) => l.action)).toEqual(["integracao.alterar", "integracao.alterar", "integracao.remover"]);
      expect(daIntegracao[0]).toMatchObject({ userId: ids.ADMIN, before: null, after: { url: "https://8.8.8.8/webhook/auditoria" } });
      expect(daIntegracao[1].summary).toContain("segredo novo");
      expect(daIntegracao[2]).toMatchObject({ before: { url: "https://8.8.8.8/webhook/auditoria" }, after: null });
      const tudo = JSON.stringify(daIntegracao);
      expect(tudo).not.toContain(segredo);
      expect(tudo).not.toContain(segundo);
    });

    it("nenhuma linha desta suite guarda senha, hash, segredo ou imagem", async () => {
      const tudo = JSON.stringify((await linhas()).map((l) => [l.before, l.after]));
      expect(tudo).not.toMatch(/password|hashfalso|secret|data:image|sem-senha:/i);
    });
  });

  it("falha de validação e falta de permissão não geram linha", async () => {
    const total = () => banco.sistema.auditLog.count({ where: { tenantId: EMPRESA_PADRAO.id } });
    const antes = await total();

    entrarComo("ADMIN");
    expect((await clientes.POST(req("POST", { cnpj: "123", companyName: "x" }))).status).toBe(400);
    expect((await clientes.POST(req("POST", { cnpj: CNPJ, companyName: "Duplicada Ltda" }))).status).toBe(409);
    expect((await financeiro.POST(req("POST", { type: "EXPENSE", amount: -1, description: `${MARCA} inválido` }))).status).toBe(400);
    expect((await usuario.PATCH(req("PATCH", {}), ctx(ids.ALVO))).status).toBe(400);
    expect((await cliente.PATCH(req("PATCH", { phone: "1" }), ctx("00000000-0000-4000-8000-000000000000"))).status).toBe(404);

    entrarComo("OPERATION");
    expect((await financeiro.POST(req("POST", { type: "EXPENSE", amount: 10, description: `${MARCA} sem permissão` }))).status).toBe(403);
    entrarComo("CLIENT");
    expect((await clientes.POST(req("POST", { cnpj: CNPJ, companyName: "Invasora Ltda" }))).status).toBe(403);
    entrarComo(null);
    expect((await clientes.POST(req("POST", { cnpj: CNPJ, companyName: "Invasora Ltda" }))).status).toBe(401);

    expect(await total()).toBe(antes);
  });

  describe("filtros e paginação", () => {
    it("filtra por ação, entidade, usuário, id e período", async () => {
      entrarComo("ADMIN");
      const daSuite = (pagina: Pagina) => pagina.registros.filter((r) => r.userName.startsWith(MARCA));

      const porAcao = await listar("?acao=cliente.desativar");
      expect(porAcao.registros.length).toBeGreaterThan(0);
      expect(new Set(porAcao.registros.map((r) => r.action))).toEqual(new Set(["cliente.desativar"]));

      const porEntidade = await listar("?entidade=lancamento");
      expect(new Set(porEntidade.registros.map((r) => r.entity))).toEqual(new Set(["lancamento"]));
      expect(daSuite(porEntidade).map((r) => r.action).sort()).toEqual(["lancamento.criar", "lancamento.excluir", "lancamento.pagar"]);

      const porUsuario = await listar(`?usuario=${ids.OPERATION}`);
      expect(porUsuario.registros.length).toBeGreaterThan(0);
      expect(new Set(porUsuario.registros.map((r) => r.userId))).toEqual(new Set([ids.OPERATION]));

      const cadastro = await banco.sistema.client.findFirstOrThrow({ where: { cnpj: CNPJ, tenantId: EMPRESA_PADRAO.id } });
      const porId = await listar(`?id=${cadastro.id}`);
      expect(porId.registros.map((r) => r.action).sort()).toEqual(["cliente.alterar", "cliente.criar", "cliente.desativar", "cliente.reativar"]);
      // Só o começo do id também acha.
      expect((await listar(`?id=${cadastro.id.slice(0, 13)}&entidade=cliente`)).registros.length).toBe(4);
      // Os filtros somam.
      expect((await listar(`?id=${cadastro.id}&acao=cliente.criar&usuario=${ids.OPERATION}`)).registros.length).toBe(1);
      expect((await listar(`?id=${cadastro.id}&acao=cliente.criar&usuario=${ids.ADMIN}`)).registros.length).toBe(0);

      const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
      expect((await listar(`?id=${cadastro.id}&de=${hoje}&ate=${hoje}`)).registros.length).toBe(4);
      expect((await listar(`?id=${cadastro.id}&ate=2020-01-01`)).registros.length).toBe(0);
      expect((await listar(`?id=${cadastro.id}&de=2999-01-01`)).registros.length).toBe(0);
    });

    it("filtro inválido é 400 com a mensagem", async () => {
      entrarComo("ADMIN");
      for (const [query, mensagem] of [["?de=09/10/2026", /Data inválida/], ["?de=2026-10-09&ate=2026-10-01", /início do período/]] as const) {
        const res = await auditoria.GET(new Request(`http://localhost/api/auditoria${query}`));
        expect(res.status, query).toBe(400);
        expect((await res.json()).error).toMatch(mensagem);
      }
    });

    it("da mais recente para a mais antiga, uma página por vez, sem repetir nem pular linha", async () => {
      // Uma página e meia de linhas fabricadas num só INSERT: todas com o mesmo
      // instante, que é o caso em que a ordem depende do desempate pelo id.
      const total = TAMANHO_DA_PAGINA + 5;
      const marca = `${MARCA}-pagina-`;
      await banco.default.auditLog.createMany({
        data: Array.from({ length: total }, (_, i) => ({
          userId: ids.ADMIN,
          userName: `${MARCA} admin`,
          userRole: "ADMIN",
          action: "aviso.reenviar",
          entity: "aviso",
          entityId: `${marca}${String(i).padStart(3, "0")}`,
          summary: `Linha ${i}`,
        })),
      });

      entrarComo("ADMIN");
      const primeira = await listar(`?id=${marca}`);
      expect(primeira.registros.length).toBe(TAMANHO_DA_PAGINA);
      expect(primeira.proximo).toBe(primeira.registros[TAMANHO_DA_PAGINA - 1].id);

      const segunda = await listar(`?id=${marca}&cursor=${primeira.proximo}`);
      expect(segunda.registros.length).toBe(5);
      expect(segunda.proximo).toBeNull();

      const todas = [...primeira.registros, ...segunda.registros];
      expect(new Set(todas.map((r) => r.id)).size).toBe(total);
      expect(new Set(todas.map((r) => r.entityId)).size).toBe(total);
      const ordem = todas.map((r) => `${r.createdAt}|${r.id}`);
      expect(ordem).toEqual([...ordem].sort().reverse());

      // A lista geral também vem da mais recente para a mais antiga.
      const geral = (await listar()).registros.map((r) => r.createdAt);
      expect(geral).toEqual([...geral].sort().reverse());

      // Cursor que não existe não devolve a lista inteira.
      expect((await listar(`?id=${marca}&cursor=00000000-0000-4000-8000-000000000000`)).registros).toEqual([]);
    });
  });

  it("isolamento: a outra empresa não vê estas linhas, nem por id, nem por cursor", async () => {
    entrarComo("ADMIN");
    const minhas = await listar(`?id=${MARCA}-pagina-`);
    expect(minhas.registros.length).toBe(TAMANHO_DA_PAGINA);

    entrarNaOutra();
    const dela = await listar();
    expect(dela.registros.filter((r) => r.userName.startsWith(MARCA) && r.userId !== adminDaOutra)).toEqual([]);
    expect((await listar(`?id=${MARCA}-pagina-`)).registros).toEqual([]);
    expect((await listar(`?usuario=${ids.ADMIN}`)).registros).toEqual([]);
    expect((await listar(`?cursor=${minhas.registros[0].id}`)).registros).toEqual([]);

    // E o que a outra empresa faz fica só com ela.
    const res = await financeiro.POST(req("POST", { type: "EXPENSE", amount: 9, description: `${MARCA} da outra` }));
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    const gravada = await banco.sistema.auditLog.findFirstOrThrow({ where: { entityId: id } });
    expect(gravada).toMatchObject({ tenantId: EMPRESA_OUTRA.id, userId: adminDaOutra, action: "lancamento.criar" });
    expect((await listar(`?id=${id}`)).registros.length).toBe(1);

    entrarComo("ADMIN");
    expect((await listar(`?id=${id}`)).registros).toEqual([]);
  });

  describe("a linha não pode ser alterada nem apagada pela aplicação", () => {
    it("UPDATE e DELETE são recusados pelo banco, fora e dentro de transação, e a linha fica como estava", async () => {
      const alvo = await ultima("cliente.criar");
      const negado = /permission denied|permissão negada/i;

      await expect(banco.default.auditLog.update({ where: { id: alvo.id }, data: { summary: "adulterada" } })).rejects.toThrow(negado);
      await expect(banco.default.auditLog.updateMany({ where: { id: alvo.id }, data: { userName: "ninguém" } })).rejects.toThrow(negado);
      await expect(banco.default.auditLog.delete({ where: { id: alvo.id } })).rejects.toThrow(negado);
      await expect(banco.default.auditLog.deleteMany({ where: { id: alvo.id } })).rejects.toThrow(negado);
      await expect(banco.transacao((tx) => tx.auditLog.deleteMany({}))).rejects.toThrow(negado);
      await expect(banco.transacao((tx) => tx.$executeRaw`UPDATE "AuditLog" SET summary = 'adulterada' WHERE id = ${alvo.id}`)).rejects.toThrow(negado);
      await expect(banco.transacao((tx) => tx.$executeRaw`TRUNCATE "AuditLog"`)).rejects.toThrow(negado);

      expect(await banco.sistema.auditLog.findUniqueOrThrow({ where: { id: alvo.id } })).toEqual(alvo);
    });

    it("ler e acrescentar continuam valendo, e a linha de outra empresa não aparece nem para o banco", async () => {
      const minhas = await banco.default.auditLog.count({ where: { userName: { startsWith: MARCA } } });
      expect(minhas).toBeGreaterThan(TAMANHO_DA_PAGINA);
      const daOutra = await banco.sistema.auditLog.findFirstOrThrow({ where: { tenantId: EMPRESA_OUTRA.id, userId: adminDaOutra } });
      expect(await banco.default.auditLog.findUnique({ where: { id: daOutra.id } })).toBeNull();
      // Linha em nome de usuário de outra empresa é recusada pelo gatilho de referência.
      await expect(
        banco.default.auditLog.create({ data: { userId: adminDaOutra, userName: `${MARCA} forjada`, action: "x", entity: "x", summary: "x" } }),
      ).rejects.toThrow(/outra empresa/);
    });

    it("apagar o usuário não apaga a trilha: a linha fica, com o nome guardado e sem o id", async () => {
      const antes = await linhas({ userId: ids.ALVO });
      expect(antes).toEqual([]);
      // O usuário-alvo faz uma ação e depois é apagado pela própria aplicação.
      sessao.mockResolvedValue({ user: { id: ids.ALVO, role: "ADMIN", clientId: null } });
      const res = await financeiro.POST(req("POST", { type: "INCOME", amount: 1, description: `${MARCA} do apagado` }));
      expect(res.status).toBe(201);
      const { id } = (await res.json()) as { id: string };

      await banco.default.user.delete({ where: { id: ids.ALVO } });

      const linha = await banco.sistema.auditLog.findFirstOrThrow({ where: { entityId: id } });
      expect(linha).toMatchObject({ userId: null, userName: `${MARCA} alvo renomeado`, userRole: "ADMIN", action: "lancamento.criar" });
    });
  });
});
