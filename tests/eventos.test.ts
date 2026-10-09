import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getServerSession } from "next-auth";
import { assinar } from "../src/lib/eventos";
import { ENDERECO_INTERNO, ENDERECO_INVALIDO, conferirEnderecoPublico, conferirFormato, ipPrivado } from "../src/lib/url-publica";
import { EMPRESA_OUTRA, EMPRESA_PADRAO } from "./empresas-de-teste";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

describe("conferência do endereço que recebe os eventos", () => {
  const LOCAL = "TMS_WEBHOOK_PERMITE_LOCAL";
  let antes: string | undefined;
  beforeEach(() => {
    antes = process.env[LOCAL];
    delete process.env[LOCAL];
  });
  afterEach(() => {
    if (antes === undefined) delete process.env[LOCAL];
    else process.env[LOCAL] = antes;
  });

  it("IP privado, local, link-local, CGNAT e multicast não são da internet; IP público é", () => {
    for (const ip of ["10.0.0.1", "127.0.0.1", "172.16.0.1", "172.31.0.11", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fd00::1", "fe80::1", "::ffff:10.0.0.1", "::ffff:a00:1"]) {
      expect(ipPrivado(ip), ip).toBe(true);
    }
    for (const ip of ["8.8.8.8", "172.32.0.1", "100.63.0.1", "178.105.82.48", "2606:4700::1111"]) {
      expect(ipPrivado(ip), ip).toBe(false);
    }
  });

  it("forma: só https, sem usuário e senha, e sem endereço interno escrito direto", () => {
    expect(conferirFormato(" https://n8n.exemplo.com/webhook/tms ")).toMatchObject({ ok: true });
    for (const url of ["", "n8n.exemplo.com", "http://n8n.exemplo.com/x", "ftp://exemplo.com", "https://usuario:senha@exemplo.com", `https://exemplo.com/${"a".repeat(500)}`]) {
      expect(conferirFormato(url), url).toEqual({ ok: false, erro: ENDERECO_INVALIDO });
    }
    for (const url of ["https://localhost/x", "https://api.localhost", "https://servico.internal/x", "https://127.0.0.1/x", "https://10.66.0.10:5001", "https://172.31.0.11:3000/api", "https://[::1]/x", "https://169.254.169.254/latest/meta-data"]) {
      expect(conferirFormato(url), url).toEqual({ ok: false, erro: ENDERECO_INTERNO });
    }
  });

  it("destino: IP público passa sem consulta; nome que não existe é recusado", async () => {
    expect(await conferirEnderecoPublico("https://8.8.8.8/webhook")).toMatchObject({ ok: true });
    expect((await conferirEnderecoPublico("https://nome-que-nao-existe.invalid/x")).ok).toBe(false);
    expect(await conferirEnderecoPublico("https://127.0.0.1/x")).toEqual({ ok: false, erro: ENDERECO_INTERNO });
  });

  it("com a liberação de teste ligada, http e endereço local passam", () => {
    process.env[LOCAL] = "1";
    expect(conferirFormato("http://127.0.0.1:9999/x")).toMatchObject({ ok: true });
  });
});

/** Eventos de ponta a ponta, contra um Postgres de verdade e um servidor HTTP local. */
const temBanco = Boolean(process.env.DATABASE_URL);

if (!temBanco) {
  console.warn("\n[eventos.test] DATABASE_URL ausente: testes de integração PULADOS.\n");
}

const suite = temBanco ? describe : describe.skip;

const PREFIXO = "teste-eventos-";
const CNPJ = "99333222000144";
const CNPJ_DA_OUTRA = "99333222000225";
const HASH_FALSO = "$2b$10$hashfalsoparateste000000000000000000000000000000000";

type Recebido = { cabecalhos: Record<string, string | string[] | undefined>; corpo: string; json: Record<string, unknown> };

suite("eventos para sistemas de fora", () => {
  let banco: typeof import("../src/lib/prisma");
  let eventos: typeof import("../src/lib/eventos");
  let historico: typeof import("../src/lib/historico");
  let webhook: typeof import("../src/app/api/empresa/webhook/route");
  let teste: typeof import("../src/app/api/empresa/webhook/teste/route");

  const sessao = vi.mocked(getServerSession);
  const ids = { ADMIN: "", OPERATION: "", CLIENT: "", DRIVER: "" };
  let clienteId: string;

  let servidor: Server;
  let endereco: string;
  let recebidos: Recebido[] = [];
  let resposta = 200;

  const entrarComo = (perfil: keyof typeof ids | null) =>
    sessao.mockResolvedValue(perfil ? { user: { id: ids[perfil], role: perfil, clientId: null } } : null);

  const gravar = (corpo: unknown) =>
    webhook.PUT(new Request("http://localhost/api/empresa/webhook", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) }));

  /** Cadastra o endereço local como administrador e devolve o segredo gerado. */
  async function cadastrar() {
    entrarComo("ADMIN");
    const res = await gravar({ url: endereco });
    expect(res.status).toBe(201);
    return ((await res.json()) as { segredo: string }).segredo;
  }

  const criarColeta = (db: typeof banco.default, cliente: string, status = "CONFIRMED") =>
    db.collection.create({
      data: {
        clientId: cliente,
        sender: "Remetente",
        receiver: "Destinatário Ltda",
        origin: "Rio Preto",
        destination: "Mirassol",
        volumes: 2,
        weight: 10,
        status,
        freightValue: 150,
        trackingCode: `${Date.now()}`.slice(-10),
        statusHistory: { create: { fromStatus: null, toStatus: status, userId: null } },
      },
    });

  const pendentes = (tenantId: string) =>
    banco.sistema.outboxEvent.findMany({ where: { tenantId }, orderBy: { createdAt: "asc" } });

  async function limparEventos() {
    const empresas = { tenantId: { in: [EMPRESA_PADRAO.id, EMPRESA_OUTRA.id] } };
    await banco.sistema.outboxEvent.deleteMany({ where: empresas });
    await banco.sistema.webhook.deleteMany({ where: empresas });
    await banco.sistema.financialTransaction.deleteMany({ where: { OR: [{ description: { startsWith: PREFIXO } }, { client: { cnpj: { in: [CNPJ, CNPJ_DA_OUTRA] } } }] } });
    await banco.sistema.collection.deleteMany({ where: { client: { cnpj: { in: [CNPJ, CNPJ_DA_OUTRA] } } } });
    await banco.sistema.invoice.deleteMany({ where: { client: { cnpj: { in: [CNPJ, CNPJ_DA_OUTRA] } } } });
  }

  async function limpar() {
    await limparEventos();
    await banco.sistema.client.deleteMany({ where: { cnpj: { in: [CNPJ, CNPJ_DA_OUTRA] } } });
    await banco.sistema.user.deleteMany({ where: { email: { startsWith: PREFIXO } } });
  }

  beforeAll(async () => {
    process.env.TMS_WEBHOOK_PERMITE_LOCAL = "1";
    banco = await import("../src/lib/prisma");
    eventos = await import("../src/lib/eventos");
    historico = await import("../src/lib/historico");
    webhook = await import("../src/app/api/empresa/webhook/route");
    teste = await import("../src/app/api/empresa/webhook/teste/route");
    await limpar();

    clienteId = (await banco.default.client.create({ data: { companyName: `${PREFIXO}cliente ltda`, tradeName: `${PREFIXO}fantasia`, cnpj: CNPJ, phone: "1733330000" } })).id;
    for (const perfil of ["ADMIN", "OPERATION", "CLIENT", "DRIVER"] as const) {
      ids[perfil] = (
        await banco.default.user.create({
          data: { name: `${PREFIXO}${perfil}`, email: `${PREFIXO}${perfil.toLowerCase()}@exemplo.br`, password: HASH_FALSO, role: perfil },
        })
      ).id;
    }

    servidor = createServer((req, res) => {
      let corpo = "";
      req.on("data", (parte) => (corpo += parte));
      req.on("end", () => {
        recebidos.push({ cabecalhos: req.headers, corpo, json: JSON.parse(corpo) });
        res.writeHead(resposta).end();
      });
    });
    await new Promise<void>((pronto) => servidor.listen(0, "127.0.0.1", pronto));
    endereco = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/webhook/tms`;
  });

  beforeEach(async () => {
    sessao.mockReset();
    recebidos = [];
    resposta = 200;
    await limparEventos();
  });

  afterAll(async () => {
    delete process.env.TMS_WEBHOOK_PERMITE_LOCAL;
    if (servidor) await new Promise((fechado) => servidor.close(fechado));
    if (banco) await limpar();
  });

  it("só o administrador lê, grava e testa a integração", async () => {
    const chamadas = [() => webhook.GET(), () => gravar({ url: endereco }), () => teste.POST()];
    for (const [perfil, esperado] of [[null, 401], ["OPERATION", 403], ["CLIENT", 403], ["DRIVER", 403]] as const) {
      for (const chamar of chamadas) {
        entrarComo(perfil);
        expect((await chamar()).status, String(perfil)).toBe(esperado);
      }
    }
    expect(await banco.sistema.webhook.count({ where: { tenantId: EMPRESA_PADRAO.id } })).toBe(0);
  });

  it("cadastrar devolve o segredo uma vez; ler e trocar o endereço não o devolvem; pedir novo segredo troca", async () => {
    const segredo = await cadastrar();
    expect(segredo.length).toBeGreaterThanOrEqual(32);

    const lido = await (await webhook.GET()).json();
    expect(lido.url).toBe(endereco);
    expect(JSON.stringify(lido)).not.toContain(segredo);

    const trocado = await gravar({ url: `${endereco}?v=2` });
    expect(trocado.status).toBe(200);
    expect(await trocado.json()).toEqual({ url: `${endereco}?v=2` });
    expect((await banco.sistema.webhook.findUniqueOrThrow({ where: { tenantId: EMPRESA_PADRAO.id } })).secret).toBe(segredo);

    const novo = (await (await gravar({ url: endereco, novoSegredo: true })).json()) as { segredo: string };
    expect(novo.segredo).not.toBe(segredo);
    expect(await banco.sistema.webhook.count({ where: { tenantId: EMPRESA_PADRAO.id } })).toBe(1);
  });

  it("endereço inválido ou interno é 400 e nada é gravado", async () => {
    entrarComo("ADMIN");
    delete process.env.TMS_WEBHOOK_PERMITE_LOCAL;
    try {
      for (const [corpo, mensagem] of [
        [{}, /Dados inválidos/],
        [{ url: 12 }, /Dados inválidos/],
        [{ url: "n8n.exemplo.com" }, /https/],
        [{ url: endereco }, /https/],
        [{ url: "https://172.31.0.11:3000/api" }, /não é público/],
        [{ url: "https://localhost/webhook" }, /não é público/],
      ] as const) {
        const res = await gravar(corpo);
        expect(res.status, JSON.stringify(corpo)).toBe(400);
        expect((await res.json()).error).toMatch(mensagem);
      }
    } finally {
      process.env.TMS_WEBHOOK_PERMITE_LOCAL = "1";
    }
    expect(await banco.sistema.webhook.count({ where: { tenantId: EMPRESA_PADRAO.id } })).toBe(0);
  });

  it("empresa sem endereço cadastrado não gera evento", async () => {
    const coleta = await criarColeta(banco.default, clienteId);
    await historico.recordStatusChanges(banco.default, [{ collectionId: coleta.id, fromStatus: "CONFIRMED", toStatus: "COLLECTED", userId: null }]);
    expect(await pendentes(EMPRESA_PADRAO.id)).toHaveLength(0);
    expect(await eventos.despacharPendentes()).toEqual({ entregues: 0, falhas: 0 });
  });

  it("criação e troca de status viram eventos, entregues em ordem, assinados e com os dados da carga", async () => {
    const segredo = await cadastrar();
    const coleta = await criarColeta(banco.default, clienteId);
    await historico.recordStatusChanges(banco.default, [{ collectionId: coleta.id, fromStatus: "CONFIRMED", toStatus: "COLLECTED", userId: null }]);

    expect((await pendentes(EMPRESA_PADRAO.id)).map((e) => [e.type, e.attempts, e.deliveredAt])).toEqual([
      ["coleta.status", 0, null],
      ["coleta.status", 0, null],
    ]);

    expect(await eventos.despacharPendentes()).toEqual({ entregues: 2, falhas: 0 });
    expect(recebidos).toHaveLength(2);

    const [criada, coletada] = recebidos;
    expect(criada.json).toMatchObject({ tipo: "coleta.status", empresa: { id: EMPRESA_PADRAO.id, slug: EMPRESA_PADRAO.slug, nome: EMPRESA_PADRAO.name } });
    expect(criada.json.dados).toMatchObject({ de: null, para: "CONFIRMED" });
    expect(coletada.json.dados).toMatchObject({
      de: "CONFIRMED",
      para: "COLLECTED",
      coleta: {
        id: coleta.id,
        destino: "Mirassol",
        destinatario: "Destinatário Ltda",
        volumes: 2,
        frete: 150,
        cliente: { nome: `${PREFIXO}fantasia`, cnpj: CNPJ, telefone: "1733330000" },
        motorista: null,
        rastreio: { codigo: coleta.trackingCode },
      },
    });
    expect(String((coletada.json.dados as { coleta: { rastreio: { link: string } } }).coleta.rastreio.link)).toContain(`/rastreio?cnpj=${CNPJ}&codigo=${coleta.trackingCode}`);

    for (const pedido of recebidos) {
      expect(pedido.cabecalhos["x-tms-evento"]).toBe("coleta.status");
      expect(pedido.cabecalhos["x-tms-entrega"]).toBe(pedido.json.id);
      // A assinatura confere com o corpo exatamente como chegou, e só com o segredo certo.
      expect(pedido.cabecalhos["x-tms-assinatura"]).toBe(assinar(segredo, pedido.corpo));
      expect(pedido.cabecalhos["x-tms-assinatura"]).not.toBe(assinar("outro-segredo", pedido.corpo));
      expect(pedido.corpo).not.toContain(segredo);
    }

    // Entregue não sai de novo.
    expect((await pendentes(EMPRESA_PADRAO.id)).every((e) => e.deliveredAt !== null && e.attempts === 1)).toBe(true);
    expect(await eventos.despacharPendentes()).toEqual({ entregues: 0, falhas: 0 });
    expect(recebidos).toHaveLength(2);
  });

  it("falha guarda o motivo e espera para tentar de novo; na hora certa, entrega", async () => {
    await cadastrar();
    await criarColeta(banco.default, clienteId);

    resposta = 500;
    expect(await eventos.despacharPendentes()).toEqual({ entregues: 0, falhas: 1 });
    const [falho] = await pendentes(EMPRESA_PADRAO.id);
    expect(falho).toMatchObject({ attempts: 1, deliveredAt: null, lastError: "Resposta 500" });
    expect(falho.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 30_000);

    // Ainda não é hora: nada sai.
    resposta = 200;
    expect(await eventos.despacharPendentes()).toEqual({ entregues: 0, falhas: 0 });
    expect(recebidos).toHaveLength(1);

    await banco.sistema.outboxEvent.update({ where: { id: falho.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
    expect(await eventos.despacharPendentes()).toEqual({ entregues: 1, falhas: 0 });
    expect((await pendentes(EMPRESA_PADRAO.id))[0]).toMatchObject({ attempts: 2, lastError: null });
    expect((await pendentes(EMPRESA_PADRAO.id))[0].deliveredAt).not.toBeNull();
  });

  it("depois do limite de tentativas o evento para de sair", async () => {
    await cadastrar();
    await criarColeta(banco.default, clienteId);
    const [evento] = await pendentes(EMPRESA_PADRAO.id);
    await banco.sistema.outboxEvent.update({ where: { id: evento.id }, data: { attempts: eventos.TENTATIVAS, nextAttemptAt: new Date(Date.now() - 1000) } });

    expect(await eventos.despacharPendentes()).toEqual({ entregues: 0, falhas: 0 });
    expect(recebidos).toHaveLength(0);
  });

  it("evento de teste: 409 sem endereço; com endereço entra na fila, sai e aparece nas últimas entregas", async () => {
    entrarComo("ADMIN");
    expect((await teste.POST()).status).toBe(409);

    await cadastrar();
    const res = await teste.POST();
    expect(res.status).toBe(202);
    const { id } = (await res.json()) as { id: string };

    expect(await eventos.despacharPendentes()).toEqual({ entregues: 1, falhas: 0 });
    expect(recebidos[0].json).toMatchObject({ id, tipo: "teste", dados: { mensagem: "Evento de teste do TMS." } });

    const { entregas } = (await (await webhook.GET()).json()) as { entregas: { id: string; type: string; deliveredAt: string | null; attempts: number }[] };
    expect(entregas[0]).toMatchObject({ id, type: "teste", attempts: 1 });
    expect(entregas[0].deliveredAt).not.toBeNull();
  });

  it("remover o endereço para de gerar evento, e o que estava na fila fica sem destino", async () => {
    await cadastrar();
    await criarColeta(banco.default, clienteId);
    expect((await gravar({ url: null })).status).toBe(200);
    expect(await banco.sistema.webhook.count({ where: { tenantId: EMPRESA_PADRAO.id } })).toBe(0);

    await criarColeta(banco.default, clienteId);
    expect(await pendentes(EMPRESA_PADRAO.id)).toHaveLength(1);

    expect(await eventos.despacharPendentes()).toEqual({ entregues: 0, falhas: 1 });
    expect((await pendentes(EMPRESA_PADRAO.id))[0].lastError).toBe("Endereço removido.");
    expect(recebidos).toHaveLength(0);
  });

  it("fatura: emitida ao nascer; paga, reaberta e cancelada quando o status muda; alterar outro campo não avisa", async () => {
    await cadastrar();
    const fatura = await banco.default.invoice.create({
      data: { number: 9001, clientId: clienteId, total: 480.5, dueDate: new Date("2026-11-10T00:00:00.000Z") },
    });
    await banco.default.invoice.update({ where: { id: fatura.id }, data: { notes: "só uma observação" } });
    await banco.default.invoice.update({ where: { id: fatura.id }, data: { status: "PAID", paidAt: new Date() } });
    await banco.default.invoice.update({ where: { id: fatura.id }, data: { status: "OPEN", paidAt: null } });
    await banco.default.invoice.update({ where: { id: fatura.id }, data: { status: "CANCELLED" } });

    expect((await pendentes(EMPRESA_PADRAO.id)).map((e) => e.type)).toEqual(["fatura.emitida", "fatura.paga", "fatura.reaberta", "fatura.cancelada"]);

    expect(await eventos.despacharPendentes()).toEqual({ entregues: 4, falhas: 0 });
    expect(recebidos.map((r) => r.json.tipo)).toEqual(["fatura.emitida", "fatura.paga", "fatura.reaberta", "fatura.cancelada"]);
    // Os detalhes são lidos na hora da entrega: todos trazem a fatura como está agora.
    expect(recebidos[0].json.dados).toMatchObject({
      fatura: {
        id: fatura.id,
        numero: 9001,
        status: "CANCELLED",
        total: 480.5,
        vencimento: "2026-11-10",
        cargas: 0,
        cliente: { nome: `${PREFIXO}fantasia`, cnpj: CNPJ, telefone: "1733330000" },
      },
    });
    expect(String((recebidos[0].json.dados as { fatura: { portal: string } }).fatura.portal)).toMatch(/\/portal\/faturas$/);
  });

  it("título vencido: um aviso por título, só de receita em aberto que já venceu, e rodar de novo não repete", async () => {
    await cadastrar();
    const ontem = new Date(Date.now() - 2 * 86_400_000);
    const vencimento = new Date(`${ontem.toISOString().slice(0, 10)}T00:00:00.000Z`);
    const amanha = new Date(Date.now() + 2 * 86_400_000);
    const titulo = (dados: Record<string, unknown>) =>
      banco.default.financialTransaction.create({ data: { description: `${PREFIXO}título`, type: "INCOME", amount: 300, status: "PENDING", dueDate: vencimento, ...dados } });

    const vencido = await titulo({ clientId: clienteId });
    const avulso = await titulo({ counterparty: "Zé da Esquina", amount: 50 });
    await titulo({ dueDate: amanha }); // ainda não venceu
    await titulo({ dueDate: null }); // sem vencimento
    await titulo({ status: "PAID", paidAt: new Date() }); // já recebido
    await titulo({ type: "EXPENSE" }); // conta a pagar

    expect(await eventos.avisarTitulosVencidos()).toBe(2);
    expect(await eventos.avisarTitulosVencidos()).toBe(0);
    expect((await pendentes(EMPRESA_PADRAO.id)).map((e) => e.type)).toEqual(["cobranca.vencida", "cobranca.vencida"]);

    expect(await eventos.despacharPendentes()).toEqual({ entregues: 2, falhas: 0 });
    const porId = new Map(recebidos.map((r) => [(r.json.dados as { titulo: { id: string } }).titulo.id, r.json.dados as { titulo: Record<string, unknown> }]));
    expect(porId.get(vencido.id)!.titulo).toMatchObject({
      descricao: `${PREFIXO}título`,
      valor: 300,
      vencimento: vencimento.toISOString().slice(0, 10),
      emAberto: true,
      fatura: null,
      pagador: null,
      cliente: { nome: `${PREFIXO}fantasia`, telefone: "1733330000" },
    });
    expect(Number(porId.get(vencido.id)!.titulo.diasDeAtraso)).toBeGreaterThanOrEqual(1);
    expect(porId.get(avulso.id)!.titulo).toMatchObject({ valor: 50, cliente: null, pagador: "Zé da Esquina" });

    // Vencimento alterado que vence de novo gera outro aviso; o mesmo vencimento, não.
    await banco.default.financialTransaction.update({ where: { id: vencido.id }, data: { dueDate: new Date(vencimento.getTime() - 86_400_000) } });
    expect(await eventos.avisarTitulosVencidos()).toBe(1);
  });

  it("empresa sem endereço não recebe aviso de fatura nem de título vencido", async () => {
    await banco.default.invoice.create({ data: { number: 9002, clientId: clienteId, total: 10, dueDate: new Date("2026-11-10T00:00:00.000Z") } });
    await banco.default.financialTransaction.create({
      data: { description: `${PREFIXO}título`, type: "INCOME", amount: 300, status: "PENDING", dueDate: new Date("2020-01-10T00:00:00.000Z") },
    });
    expect(await eventos.avisarTitulosVencidos()).toBe(0);
    expect(await pendentes(EMPRESA_PADRAO.id)).toHaveLength(0);
  });

  it("isolamento: carga de outra empresa não gera evento para o endereço desta, e uma não lê as entregas da outra", async () => {
    await cadastrar();
    const outra = banco.paraEmpresa(EMPRESA_OUTRA.id).db;
    const alheio = await outra.client.create({ data: { companyName: `${PREFIXO}da outra`, cnpj: CNPJ_DA_OUTRA } });
    await criarColeta(outra as typeof banco.default, alheio.id);

    expect(await pendentes(EMPRESA_OUTRA.id)).toHaveLength(0);
    expect(await pendentes(EMPRESA_PADRAO.id)).toHaveLength(0);
    expect(await eventos.despacharPendentes()).toEqual({ entregues: 0, falhas: 0 });

    // Pela política do banco, a outra empresa não enxerga o endereço nem os eventos desta.
    await criarColeta(banco.default, clienteId);
    expect(await outra.webhook.count()).toBe(0);
    expect(await outra.outboxEvent.count()).toBe(0);
    expect(await banco.default.outboxEvent.count()).toBe(1);
  });
});
