import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getServerSession } from "next-auth";
import {
  AVISO_NAO_ENCONTRADO,
  NAO_REENVIAVEL,
  SEM_ENDERECO,
  SITUACOES,
  TAMANHO_DA_PAGINA,
  TENTATIVAS,
  TIPOS_DE_AVISO,
  descricaoDaSituacao,
  filtrosDeAvisosSchema,
  podeReenviar,
  rotuloDoTipo,
  situacaoDoAviso,
  type Aviso,
} from "../src/lib/mensageria";
import { EMPRESA_OUTRA, EMPRESA_PADRAO } from "./empresas-de-teste";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

describe("mensageria: tipos e situação do aviso", () => {
  it("a lista de tipos cobre todo tipo de aviso que o código e os gatilhos do banco geram", () => {
    // Onde nasce cada aviso: o despachante, os chamados, os gatilhos de carga e de fatura, e o teste da integração.
    const fontes = ["src/lib/eventos.ts", "src/lib/ocorrencias-db.ts", "prisma/sql/010-rls.sql"].map((arquivo) => readFileSync(arquivo, "utf8")).join("\n");
    const gerados = new Set([...fontes.matchAll(/["'`]((?:coleta|fatura|cobranca|ocorrencia)\.[a-z]+)/g)].map((achado) => achado[1]));
    expect(readFileSync("src/app/api/empresa/webhook/teste/route.ts", "utf8")).toContain("type: 'teste'");
    gerados.add("teste");

    expect([...gerados].sort()).toEqual(Object.keys(TIPOS_DE_AVISO).sort());
    expect(Object.keys(TIPOS_DE_AVISO)).toEqual(expect.arrayContaining(["ocorrencia.aberta", "ocorrencia.status", "cobranca.vencida", "coleta.status"]));
    for (const [tipo, rotulo] of Object.entries(TIPOS_DE_AVISO)) expect(rotulo.length, tipo).toBeGreaterThan(3);
    expect(rotuloDoTipo("fatura.paga")).toBe("Fatura paga");
    // Tipo que a tela ainda não conhece aparece com o próprio nome, em vez de sumir.
    expect(rotuloDoTipo("tipo.novo")).toBe("tipo.novo");
  });

  it("o limite de tentativas da tela é o mesmo do despachante", async () => {
    expect((await import("../src/lib/eventos")).TENTATIVAS).toBe(TENTATIVAS);
  });

  it("situação: entregue, na fila, falhou (ainda vai tentar) e desistiu (gastou as tentativas)", () => {
    const aviso = (parcial: Partial<{ deliveredAt: string | null; attempts: number; lastError: string | null }>) => ({ deliveredAt: null, attempts: 0, lastError: null, ...parcial });

    expect(situacaoDoAviso(aviso({ deliveredAt: "2026-10-09T12:00:00.000Z", attempts: 1 }))).toBe("entregue");
    // Entregue na última tentativa é entregue, não desistência.
    expect(situacaoDoAviso(aviso({ deliveredAt: "2026-10-09T12:00:00.000Z", attempts: TENTATIVAS }))).toBe("entregue");
    expect(situacaoDoAviso(aviso({}))).toBe("fila");
    // Tentativa em curso: o contador já subiu e ainda não há erro.
    expect(situacaoDoAviso(aviso({ attempts: 1 }))).toBe("fila");
    expect(situacaoDoAviso(aviso({ attempts: 2, lastError: "Resposta 500" }))).toBe("falhou");
    expect(situacaoDoAviso(aviso({ attempts: TENTATIVAS, lastError: "Resposta 500" }))).toBe("desistiu");

    expect(descricaoDaSituacao(aviso({ attempts: 2, lastError: "Resposta 500" }))).toBe(`Falhou (tentativa 2 de ${TENTATIVAS}): Resposta 500`);
    expect(descricaoDaSituacao(aviso({ attempts: TENTATIVAS, lastError: "Sem resposta no tempo limite." }))).toBe(`Desistiu depois de ${TENTATIVAS} tentativas: Sem resposta no tempo limite.`);
    expect(descricaoDaSituacao(aviso({}))).toBe("Na fila");
    expect(descricaoDaSituacao(aviso({ deliveredAt: "2026-10-09T12:00:00.000Z" }))).toBe("Entregue");
  });

  it("só o que falhou ou de que o despachante desistiu pode ser tentado de novo", () => {
    expect(podeReenviar({ deliveredAt: null, attempts: 2, lastError: "Resposta 500" })).toBe(true);
    expect(podeReenviar({ deliveredAt: null, attempts: TENTATIVAS, lastError: "Resposta 500" })).toBe(true);
    expect(podeReenviar({ deliveredAt: null, attempts: 0, lastError: null })).toBe(false);
    expect(podeReenviar({ deliveredAt: "2026-10-09T12:00:00.000Z", attempts: 1, lastError: null })).toBe(false);
  });

  it("filtro vazio é o mesmo que ausente, e situação fora da lista é recusada", () => {
    expect(filtrosDeAvisosSchema.parse({ tipo: "", situacao: "", cursor: "" })).toEqual({});
    for (const situacao of SITUACOES) expect(filtrosDeAvisosSchema.parse({ situacao })).toEqual({ situacao });
    expect(filtrosDeAvisosSchema.safeParse({ situacao: "lida" }).success).toBe(false);
  });
});

/** As rotas, contra um Postgres de verdade. */
const temBanco = Boolean(process.env.DATABASE_URL);

if (!temBanco) {
  console.warn("\n[mensageria.test] DATABASE_URL ausente: testes de integração PULADOS.\n");
}

const suite = temBanco ? describe : describe.skip;

const PREFIXO = "teste-mensageria-";
const MARCA = "teste-mensageria";
const ENDERECO = "https://8.8.8.8/webhook/mensageria";
const HASH_FALSO = "$2b$10$hashfalsoparateste000000000000000000000000000000000";
const SEM_ID = "00000000-0000-4000-8000-000000000000";

type Perfil = "ADMIN" | "OPERATION" | "CLIENT" | "DRIVER";
type Pagina = { integracao: { url: string | null }; eventos: Aviso[]; proximo: string | null };

suite("mensageria: rotas", () => {
  let banco: typeof import("../src/lib/prisma");
  let eventos: typeof import("../src/app/api/eventos/route");
  let reenviar: typeof import("../src/app/api/eventos/[id]/reenviar/route");

  const sessao = vi.mocked(getServerSession);
  const ids = {} as Record<Perfil, string>;
  let adminDaOutra: string;
  const avisos = { entregue: "", fila: "", falhou: "", desistiu: "" };

  const entrarComo = (perfil: Perfil | null) =>
    sessao.mockResolvedValue(perfil ? { user: { id: ids[perfil], role: perfil, clientId: null } } : null);
  const entrarNaOutra = () => sessao.mockResolvedValue({ user: { id: adminDaOutra, role: "ADMIN", clientId: null, tenantId: EMPRESA_OUTRA.id } });

  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const pedir = (query = "") => eventos.GET(new Request(`http://localhost/api/eventos${query}`));
  const listar = async (query = ""): Promise<Pagina> => {
    const res = await pedir(query);
    expect(res.status, query).toBe(200);
    return (await res.json()) as Pagina;
  };
  const tentarDeNovo = (id: string) => reenviar.POST(new Request("http://localhost/api/eventos/x/reenviar", { method: "POST" }), ctx(id));

  // Os avisos desta suite levam a marca no conteúdo: é por ela que são achados e apagados.
  const meus = { payload: { path: ["marca"], equals: MARCA } };
  const gravado = (id: string) => banco.sistema.outboxEvent.findUniqueOrThrow({ where: { id } });

  const cadastrarEndereco = (tenantId: string) =>
    banco.paraEmpresa(tenantId).db.webhook.create({ data: { url: ENDERECO, secret: "segredo-de-teste-que-nunca-aparece" } });
  const removerEndereco = () => banco.sistema.webhook.deleteMany({ where: { url: ENDERECO } });

  async function limpar() {
    const s = banco.sistema;
    await s.auditLog.deleteMany({ where: { userName: { startsWith: MARCA } } });
    await s.outboxEvent.deleteMany({ where: meus });
    await removerEndereco();
    await s.user.deleteMany({ where: { email: { startsWith: PREFIXO } } });
  }

  beforeAll(async () => {
    banco = await import("../src/lib/prisma");
    eventos = await import("../src/app/api/eventos/route");
    reenviar = await import("../src/app/api/eventos/[id]/reenviar/route");

    await limpar();

    const criar = (db: typeof banco.default, nome: string, role: Perfil) =>
      db.user.create({ data: { name: `${MARCA} ${nome}`, email: `${PREFIXO}${nome}@exemplo.br`, password: HASH_FALSO, role } });
    for (const perfil of ["ADMIN", "OPERATION", "CLIENT", "DRIVER"] as const) {
      ids[perfil] = (await criar(banco.default, perfil.toLowerCase(), perfil)).id;
    }
    adminDaOutra = (await criar(banco.paraEmpresa(EMPRESA_OUTRA.id).db as typeof banco.default, "outra", "ADMIN")).id;

    const criarAviso = async (type: string, entrega: { deliveredAt?: Date; attempts?: number; lastError?: string; createdAt: Date }) =>
      (await banco.default.outboxEvent.create({ data: { type, payload: { marca: MARCA }, ...entrega }, select: { id: true } })).id;
    const minutosAtras = (minutos: number) => new Date(Date.now() - minutos * 60_000);
    avisos.entregue = await criarAviso("coleta.status", { deliveredAt: minutosAtras(39), attempts: 1, createdAt: minutosAtras(40) });
    avisos.fila = await criarAviso("fatura.emitida", { createdAt: minutosAtras(30) });
    avisos.falhou = await criarAviso("ocorrencia.aberta", { attempts: 2, lastError: "Resposta 500", createdAt: minutosAtras(20) });
    avisos.desistiu = await criarAviso("cobranca.vencida", { attempts: TENTATIVAS, lastError: "Sem resposta no tempo limite.", createdAt: minutosAtras(10) });
  });

  beforeEach(() => {
    sessao.mockReset();
  });

  afterAll(async () => {
    if (banco) await limpar();
  });

  it("listar e tentar de novo são só do administrador: sem sessão 401, demais perfis 403", async () => {
    for (const [perfil, esperado] of [[null, 401], ["OPERATION", 403], ["CLIENT", 403], ["DRIVER", 403]] as const) {
      entrarComo(perfil);
      expect((await pedir()).status, `GET ${perfil}`).toBe(esperado);
      expect((await tentarDeNovo(avisos.falhou)).status, `POST ${perfil}`).toBe(esperado);
    }
    expect(await gravado(avisos.falhou)).toMatchObject({ attempts: 2, lastError: "Resposta 500" });
    entrarComo("ADMIN");
    expect((await pedir()).status).toBe(200);
  });

  it("sem endereço cadastrado a lista diz isso, e tentar de novo é recusado sem mexer no aviso", async () => {
    entrarComo("ADMIN");
    await removerEndereco();
    expect((await listar()).integracao).toEqual({ url: null });

    const res = await tentarDeNovo(avisos.falhou);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(SEM_ENDERECO);
    expect(await gravado(avisos.falhou)).toMatchObject({ attempts: 2, lastError: "Resposta 500" });
  });

  it("lista do mais novo para o mais antigo, com o endereço e o que a tela precisa de cada aviso, e sem o segredo", async () => {
    await cadastrarEndereco(EMPRESA_PADRAO.id);
    entrarComo("ADMIN");
    const res = await pedir();
    const texto = await res.text();
    expect(texto).not.toContain("segredo-de-teste");
    const pagina = JSON.parse(texto) as Pagina;
    expect(pagina.integracao).toEqual({ url: ENDERECO });

    const daSuite = pagina.eventos.filter((e) => Object.values(avisos).includes(e.id));
    expect(daSuite.map((e) => e.id)).toEqual([avisos.desistiu, avisos.falhou, avisos.fila, avisos.entregue]);
    expect(daSuite.map(situacaoDoAviso)).toEqual(["desistiu", "falhou", "fila", "entregue"]);
    expect(Object.keys(daSuite[0]).sort()).toEqual(["attempts", "createdAt", "deliveredAt", "id", "lastError", "nextAttemptAt", "type"]);
    // O conteúdo do aviso (dados de cliente, de carga) não vai para a lista.
    expect(texto).not.toContain(MARCA);
  });

  it("filtra por tipo e por situação; situação inválida é 400", async () => {
    entrarComo("ADMIN");
    const daSuite = (pagina: Pagina) => pagina.eventos.filter((e) => Object.values(avisos).includes(e.id)).map((e) => e.id);

    for (const situacao of SITUACOES) {
      const pagina = await listar(`?situacao=${situacao}`);
      expect(daSuite(pagina), situacao).toEqual([avisos[situacao]]);
      expect(new Set(pagina.eventos.map(situacaoDoAviso)), situacao).toEqual(new Set([situacao]));
    }

    const porTipo = await listar("?tipo=ocorrencia.aberta");
    expect(daSuite(porTipo)).toEqual([avisos.falhou]);
    expect(new Set(porTipo.eventos.map((e) => e.type))).toEqual(new Set(["ocorrencia.aberta"]));
    expect(daSuite(await listar("?tipo=ocorrencia.aberta&situacao=entregue"))).toEqual([]);
    expect(daSuite(await listar("?tipo=cobranca.vencida&situacao=desistiu"))).toEqual([avisos.desistiu]);

    const res = await pedir("?situacao=lida");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Situação inválida/);
  });

  it("uma página por vez, sem repetir nem pular aviso", async () => {
    const total = TAMANHO_DA_PAGINA + 5;
    await banco.default.outboxEvent.createMany({ data: Array.from({ length: total }, (_, i) => ({ type: "teste", payload: { marca: MARCA, i } })) });
    const criados = new Set((await banco.sistema.outboxEvent.findMany({ where: { ...meus, type: "teste" }, select: { id: true } })).map((e) => e.id));
    expect(criados.size).toBe(total);

    entrarComo("ADMIN");
    const primeira = await listar("?tipo=teste");
    expect(primeira.eventos.length).toBe(TAMANHO_DA_PAGINA);
    expect(primeira.proximo).toBe(primeira.eventos[TAMANHO_DA_PAGINA - 1].id);

    const vistos: string[] = primeira.eventos.map((e) => e.id);
    let cursor = primeira.proximo;
    for (let volta = 0; cursor && volta < 20; volta += 1) {
      const pagina = await listar(`?tipo=teste&cursor=${cursor}`);
      vistos.push(...pagina.eventos.map((e) => e.id));
      cursor = pagina.proximo;
    }
    expect(cursor).toBeNull();
    expect(new Set(vistos).size).toBe(vistos.length);
    expect(vistos.filter((id) => criados.has(id)).length).toBe(total);

    await banco.sistema.outboxEvent.deleteMany({ where: { ...meus, type: "teste" } });
  });

  it("tentar de novo devolve à fila o que falhou e o que desistiu, e registra na auditoria", async () => {
    entrarComo("ADMIN");
    const antes = Date.now();

    for (const id of [avisos.falhou, avisos.desistiu]) {
      const res = await tentarDeNovo(id);
      expect(res.status).toBe(200);
      const corpo = (await res.json()) as Aviso;
      expect(corpo).toMatchObject({ id, attempts: 0, lastError: null, deliveredAt: null });
      expect(situacaoDoAviso(corpo)).toBe("fila");

      const noBanco = await gravado(id);
      expect(noBanco).toMatchObject({ attempts: 0, lastError: null, deliveredAt: null });
      // A próxima tentativa é agora: o despachante pega na volta seguinte.
      expect(noBanco.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(antes - 1000);
      expect(noBanco.nextAttemptAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    }

    const trilha = await banco.sistema.auditLog.findMany({ where: { action: "aviso.reenviar", userId: ids.ADMIN }, orderBy: { createdAt: "asc" } });
    expect(trilha.map((l) => l.entityId).sort()).toEqual([avisos.falhou, avisos.desistiu].sort());
    expect(trilha.find((l) => l.entityId === avisos.falhou)?.summary).toBe('Aviso "Chamado aberto" devolvido à fila');
  });

  it("aviso entregue, na fila ou que não existe não é reenviado, e nada muda", async () => {
    entrarComo("ADMIN");
    const entregueAntes = await gravado(avisos.entregue);
    const filaAntes = await gravado(avisos.fila);
    const trilhaAntes = await banco.sistema.auditLog.count({ where: { action: "aviso.reenviar" } });

    for (const id of [avisos.entregue, avisos.fila, avisos.falhou]) {
      // O que falhou acabou de voltar à fila no teste anterior: segundo clique é recusado.
      const res = await tentarDeNovo(id);
      expect(res.status, id).toBe(409);
      expect((await res.json()).error).toBe(NAO_REENVIAVEL);
    }
    const inexistente = await tentarDeNovo(SEM_ID);
    expect(inexistente.status).toBe(404);
    expect((await inexistente.json()).error).toBe(AVISO_NAO_ENCONTRADO);

    expect(await gravado(avisos.entregue)).toEqual(entregueAntes);
    expect(await gravado(avisos.fila)).toEqual(filaAntes);
    expect(await banco.sistema.auditLog.count({ where: { action: "aviso.reenviar" } })).toBe(trilhaAntes);
  });

  it("isolamento: a outra empresa não lista nem reenvia estes avisos", async () => {
    // Um aviso que falhou, para a outra empresa tentar reenviar.
    const alvo = (await banco.default.outboxEvent.create({ data: { type: "fatura.paga", payload: { marca: MARCA }, attempts: 3, lastError: "Resposta 502" }, select: { id: true } })).id;
    await cadastrarEndereco(EMPRESA_OUTRA.id);
    const dela = (
      await banco.paraEmpresa(EMPRESA_OUTRA.id).db.outboxEvent.create({ data: { type: "teste", payload: { marca: MARCA }, attempts: 1, lastError: "Resposta 500" }, select: { id: true } })
    ).id;

    entrarNaOutra();
    const pagina = await listar();
    const vistos = pagina.eventos.map((e) => e.id);
    expect(vistos).toContain(dela);
    for (const id of [...Object.values(avisos), alvo]) expect(vistos).not.toContain(id);
    expect((await listar(`?cursor=${alvo}`)).eventos).toEqual([]);

    // Com endereço próprio, a recusa é "não encontrado": o aviso da outra empresa não existe para ela.
    expect((await tentarDeNovo(alvo)).status).toBe(404);
    expect(await gravado(alvo)).toMatchObject({ tenantId: EMPRESA_PADRAO.id, attempts: 3, lastError: "Resposta 502" });

    // E o dela, ela reenvia.
    expect((await tentarDeNovo(dela)).status).toBe(200);
    expect(await gravado(dela)).toMatchObject({ tenantId: EMPRESA_OUTRA.id, attempts: 0, lastError: null });

    entrarComo("ADMIN");
    expect((await listar()).eventos.map((e) => e.id)).not.toContain(dela);
    expect((await tentarDeNovo(dela)).status).toBe(404);
  });
});
