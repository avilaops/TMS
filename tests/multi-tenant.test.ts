import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getServerSession } from "next-auth";
import bcrypt from "bcryptjs";
import { EMPRESA_OUTRA, EMPRESA_PADRAO } from "./empresas-de-teste";

/**
 * Isolamento entre empresas (tenants), contra um Postgres de verdade.
 *
 * O que se prova aqui é o que o banco devolve e recusa com as políticas de
 * prisma/sql/010-rls.sql ligadas: nenhuma rota, e nem uma consulta escrita
 * errada, mostra ou altera dado de outra empresa.
 */
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

const temBanco = Boolean(process.env.DATABASE_URL);

if (!temBanco) {
  console.warn(
    "\n[multi-tenant.test] DATABASE_URL ausente: testes de integração PULADOS.\n" +
      "Rode com um Postgres real para exercitá-los.\n",
  );
}

const suite = temBanco ? describe : describe.skip;

const PREFIXO = "teste-multitenant-";
const CNPJ = "11222333000181";
const PLACA = "MTT1A23";
const SENHA = "senha-de-teste-123";
const SENHA_OUTRA = "outra-senha-de-teste-456";

suite("isolamento entre empresas", () => {
  let banco: typeof import("../src/lib/prisma");
  let auth: typeof import("../src/lib/auth");
  let clientes: typeof import("../src/app/api/clientes/route");
  let clientePorId: typeof import("../src/app/api/clientes/[id]/route");
  let leads: typeof import("../src/app/api/leads/route");
  let crm: typeof import("../src/app/api/dashboard/crm/route");
  let comprovantes: typeof import("../src/app/api/comprovantes/route");
  let conferir: typeof import("../src/app/api/comprovantes/[id]/conferir/route");

  const sessao = vi.mocked(getServerSession);

  // Um administrador e um cliente em cada empresa.
  const padrao = { tenantId: EMPRESA_PADRAO.id, adminId: "", clienteId: "" };
  const outra = { tenantId: EMPRESA_OUTRA.id, adminId: "", clienteId: "" };

  function entrar(lado: { tenantId: string; adminId: string } | null, comoUsuario?: string) {
    sessao.mockResolvedValue(
      lado
        ? {
            user: {
              id: comoUsuario ?? lado.adminId,
              role: "ADMIN",
              clientId: null,
              tenantId: lado.tenantId,
              name: "Admin",
              email: "admin@teste",
            },
          }
        : null,
    );
  }

  const req = (method = "GET", body?: unknown) =>
    new Request("http://localhost/api/teste", {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

  async function limpar() {
    const { sistema } = banco;
    await sistema.quoteLead.deleteMany({ where: { email: { startsWith: PREFIXO } } });
    await sistema.collection.deleteMany({ where: { sender: { startsWith: PREFIXO } } });
    await sistema.vehicle.deleteMany({ where: { plate: PLACA } });
    await sistema.user.deleteMany({ where: { email: { startsWith: PREFIXO } } });
    await sistema.client.deleteMany({ where: { cnpj: CNPJ } });
  }

  async function montar(lado: typeof padrao, senha: string) {
    const { db } = banco.paraEmpresa(lado.tenantId);
    const admin = await db.user.create({
      data: {
        name: "Admin",
        email: `${PREFIXO}admin@exemplo.br`,
        password: await bcrypt.hash(senha, 4),
        role: "ADMIN",
      },
    });
    const cliente = await db.client.create({
      data: { cnpj: CNPJ, companyName: `${PREFIXO}cliente de ${lado.tenantId.slice(0, 4)}` },
    });
    lado.adminId = admin.id;
    lado.clienteId = cliente.id;
  }

  // Carga entregue com comprovante aguardando conferência, na empresa dada.
  async function comprovanteDe(lado: typeof padrao) {
    const { db } = banco.paraEmpresa(lado.tenantId);
    const coleta = await db.collection.create({
      data: {
        clientId: lado.clienteId,
        sender: `${PREFIXO}remetente do comprovante`,
        receiver: "Destinatário",
        origin: "A",
        destination: "B",
        volumes: 1,
        weight: 1,
        status: "DELIVERED",
      },
    });
    const proof = await db.proofOfDelivery.create({
      data: { collectionId: coleta.id, receiverName: "Maria", receiverDoc: "12345" },
    });
    return { collectionId: coleta.id, proofId: proof.id };
  }

  beforeAll(async () => {
    banco = await import("../src/lib/prisma");
    auth = await import("../src/lib/auth");
    clientes = await import("../src/app/api/clientes/route");
    clientePorId = await import("../src/app/api/clientes/[id]/route");
    leads = await import("../src/app/api/leads/route");
    crm = await import("../src/app/api/dashboard/crm/route");
    comprovantes = await import("../src/app/api/comprovantes/route");
    conferir = await import("../src/app/api/comprovantes/[id]/conferir/route");
    await limpar();
    await montar(padrao, SENHA);
    await montar(outra, SENHA_OUTRA);
  });

  beforeEach(() => {
    sessao.mockReset();
  });

  afterAll(async () => {
    if (banco) await limpar();
  });

  describe("o mesmo cadastro em duas empresas", () => {
    it("CNPJ de cliente e e-mail de usuário se repetem entre empresas, cada um na sua", async () => {
      const linhas = await banco.sistema.client.findMany({ where: { cnpj: CNPJ }, select: { tenantId: true } });
      expect(linhas.map((l) => l.tenantId).sort()).toEqual([EMPRESA_PADRAO.id, EMPRESA_OUTRA.id].sort());

      const usuarios = await banco.sistema.user.count({ where: { email: `${PREFIXO}admin@exemplo.br` } });
      expect(usuarios).toBe(2);
    });

    it("dentro da mesma empresa o CNPJ continua único", async () => {
      entrar(outra);
      const res = await clientes.POST(req("POST", { cnpj: CNPJ, companyName: "Repetido" }));
      expect(res.status).toBe(409);
    });

    it("placa já usada por outra empresa pode ser cadastrada", async () => {
      await banco.paraEmpresa(padrao.tenantId).db.vehicle.create({ data: { plate: PLACA, model: "Baú", type: "TRUCK" } });
      await banco.paraEmpresa(outra.tenantId).db.vehicle.create({ data: { plate: PLACA, model: "Baú", type: "TRUCK" } });
      expect(await banco.sistema.vehicle.count({ where: { plate: PLACA } })).toBe(2);
    });
  });

  describe("rotas", () => {
    it("a lista de clientes só traz os da empresa de quem está logado", async () => {
      entrar(outra);
      const lista = (await (await clientes.GET()).json()) as { id: string }[];
      const ids = lista.map((c) => c.id);
      expect(ids).toContain(outra.clienteId);
      expect(ids).not.toContain(padrao.clienteId);
    });

    it("alterar o cliente de outra empresa pelo id responde 404 e não muda nada", async () => {
      entrar(outra);
      const res = await clientePorId.PATCH(req("PATCH", { companyName: "Invadido" }), ctx(padrao.clienteId));
      expect(res.status).toBe(404);

      const intacto = await banco.sistema.client.findUniqueOrThrow({ where: { id: padrao.clienteId } });
      expect(intacto.companyName).not.toBe("Invadido");
    });

    it("sessão de uma empresa com o id de usuário de outra não entra", async () => {
      entrar(outra, padrao.adminId);
      expect((await clientes.GET()).status).toBe(401);
    });

    it("lead público cai na empresa informada e só o painel dela o enxerga", async () => {
      const email = `${PREFIXO}lead@exemplo.br`;
      const res = await leads.POST(
        req("POST", {
          empresa: EMPRESA_OUTRA.slug,
          companyName: "Interessado",
          email,
          origin: "Rio Preto",
          destination: "Mirassol",
          weight: 10,
        }),
      );
      expect(res.status).toBe(200);

      const gravado = await banco.sistema.quoteLead.findFirstOrThrow({ where: { email } });
      expect(gravado.tenantId).toBe(EMPRESA_OUTRA.id);

      entrar(padrao);
      const doPadrao = (await (await crm.GET()).json()) as { email: string }[];
      expect(doPadrao.map((l) => l.email)).not.toContain(email);

      entrar(outra);
      const daOutra = (await (await crm.GET()).json()) as { email: string }[];
      expect(daOutra.map((l) => l.email)).toContain(email);
    });

    it("a fila de comprovantes só traz os da empresa de quem está logado", async () => {
      const doPadrao = await comprovanteDe(padrao);
      const daOutra = await comprovanteDe(outra);

      entrar(outra);
      const res = await comprovantes.GET(new Request("http://localhost/api/comprovantes"));
      expect(res.status).toBe(200);
      const ids = ((await res.json()) as { id: string }[]).map((c) => c.id);
      expect(ids).toContain(daOutra.proofId);
      expect(ids).not.toContain(doPadrao.proofId);
    });

    it("conferir o comprovante de outra empresa pelo id responde 404 e não muda nada", async () => {
      const doPadrao = await comprovanteDe(padrao);

      entrar(outra);
      for (const body of [{ decision: "APPROVED" }, { decision: "REJECTED", reason: "Motivo da invasão." }]) {
        const res = await conferir.POST(req("POST", body), ctx(doPadrao.collectionId));
        expect(res.status).toBe(404);
      }

      const intacto = await banco.sistema.proofOfDelivery.findUniqueOrThrow({ where: { id: doPadrao.proofId } });
      expect(intacto).toMatchObject({ status: "SUBMITTED", reviewedById: null, reviewedAt: null, rejectionReason: null });

      // Na própria empresa a mesma chamada vale, e o conferente é de lá.
      entrar(padrao);
      expect((await conferir.POST(req("POST", { decision: "APPROVED" }), ctx(doPadrao.collectionId))).status).toBe(200);
      const conferido = await banco.sistema.proofOfDelivery.findUniqueOrThrow({ where: { id: doPadrao.proofId } });
      expect(conferido).toMatchObject({ status: "APPROVED", reviewedById: padrao.adminId, tenantId: EMPRESA_PADRAO.id });
    });

    it("lead público para empresa que não existe responde 404", async () => {
      const res = await leads.POST(
        req("POST", {
          empresa: "nao-existe",
          companyName: "Interessado",
          email: `${PREFIXO}perdido@exemplo.br`,
          origin: "A",
          destination: "B",
          weight: 1,
        }),
      );
      expect(res.status).toBe(404);
    });
  });

  describe("o banco recusa sozinho", () => {
    it("consulta de uma empresa não lê linha de outra, nem pelo id", async () => {
      const { db } = banco.paraEmpresa(outra.tenantId);
      expect(await db.client.findUnique({ where: { id: padrao.clienteId } })).toBeNull();
      expect(await db.user.findUnique({ where: { id: padrao.adminId } })).toBeNull();
      expect((await db.tenant.findMany()).map((t) => t.id)).toEqual([EMPRESA_OUTRA.id]);
    });

    it("UPDATE e DELETE sem filtro só alcançam a própria empresa", async () => {
      const { db } = banco.paraEmpresa(outra.tenantId);
      const alterados = await db.client.updateMany({ where: { cnpj: CNPJ }, data: { contactName: "só a outra" } });
      expect(alterados.count).toBe(1);

      const doPadrao = await banco.sistema.client.findUniqueOrThrow({ where: { id: padrao.clienteId } });
      expect(doPadrao.contactName).toBeNull();
    });

    it("não dá para gravar linha em nome de outra empresa nem mover uma linha para lá", async () => {
      const { db } = banco.paraEmpresa(outra.tenantId);
      await expect(
        db.client.create({ data: { cnpj: "99000111000122", companyName: "Intruso", tenantId: EMPRESA_PADRAO.id } }),
      ).rejects.toThrow();
      await expect(
        db.client.update({ where: { id: outra.clienteId }, data: { tenantId: EMPRESA_PADRAO.id } }),
      ).rejects.toThrow();
    });

    it("coleta não aponta para cliente de outra empresa, mesmo sabendo o id", async () => {
      const coleta = {
        sender: `${PREFIXO}remetente`,
        receiver: "Destinatário",
        origin: "A",
        destination: "B",
        volumes: 1,
        weight: 1,
      };

      // Pela empresa: o cliente alheio nem é visto.
      await expect(
        banco.paraEmpresa(outra.tenantId).db.collection.create({ data: { ...coleta, clientId: padrao.clienteId } }),
      ).rejects.toThrow();

      // Pelo caminho de sistema, que não passa pelas políticas: o gatilho recusa.
      await expect(
        banco.sistema.collection.create({ data: { ...coleta, clientId: padrao.clienteId, tenantId: EMPRESA_OUTRA.id } }),
      ).rejects.toThrow(/outra empresa/);

      expect(await banco.sistema.collection.count({ where: { sender: coleta.sender } })).toBe(0);
    });

    it("comprovante não aponta para conferente de outra empresa, mesmo sabendo o id", async () => {
      const daOutra = await comprovanteDe(outra);
      const conferencia = { status: "APPROVED", reviewedAt: new Date(), reviewedById: padrao.adminId };

      // Pela empresa e pelo caminho de sistema: o gatilho recusa nos dois.
      await expect(
        banco.paraEmpresa(outra.tenantId).db.proofOfDelivery.update({ where: { id: daOutra.proofId }, data: conferencia }),
      ).rejects.toThrow();
      await expect(
        banco.sistema.proofOfDelivery.update({ where: { id: daOutra.proofId }, data: conferencia }),
      ).rejects.toThrow(/outra empresa/);

      const intacto = await banco.sistema.proofOfDelivery.findUniqueOrThrow({ where: { id: daOutra.proofId } });
      expect(intacto).toMatchObject({ status: "SUBMITTED", reviewedById: null });
    });

    it("tabela de frete e cidades de uma empresa não existem para a outra, e cidade não entra em tabela alheia", async () => {
      const daPadrao = await banco.paraEmpresa(padrao.tenantId).db.freightTable.create({
        data: { name: `${PREFIXO}tabela`, isDefault: false, cities: { create: [{ city: "Mirassol", cityKey: "mirassol", minimum: 50 }] } },
      });
      try {
        const { db } = banco.paraEmpresa(outra.tenantId);
        expect(await db.freightTable.findUnique({ where: { id: daPadrao.id } })).toBeNull();
        expect(await db.freightTableCity.count({ where: { tableId: daPadrao.id } })).toBe(0);
        // O mesmo nome pode existir nas duas empresas.
        const daOutra = await db.freightTable.create({ data: { name: `${PREFIXO}tabela` } });
        expect(daOutra.tenantId).toBe(EMPRESA_OUTRA.id);

        // Cidade apontando para a tabela da outra empresa: nem pela empresa, nem pelo caminho de sistema.
        const linha = { tableId: daPadrao.id, city: "Intrusa", cityKey: "intrusa", minimum: 1 };
        await expect(db.freightTableCity.create({ data: linha })).rejects.toThrow();
        await expect(banco.sistema.freightTableCity.create({ data: { ...linha, tenantId: EMPRESA_OUTRA.id } })).rejects.toThrow(
          /outra empresa/,
        );
        // Cliente de uma empresa também não aponta para a tabela da outra.
        await expect(db.client.update({ where: { id: outra.clienteId }, data: { freightTableId: daPadrao.id } })).rejects.toThrow();
      } finally {
        await banco.sistema.freightTable.deleteMany({ where: { name: `${PREFIXO}tabela` } });
      }
    });

    it("gravar sem dizer a empresa falha em vez de cair em alguma", async () => {
      await expect(
        banco.sistema.client.create({ data: { cnpj: "99000111000133", companyName: "Sem empresa" } }),
      ).rejects.toThrow();
    });

    it("transação de empresa é atômica e continua isolada", async () => {
      const { transacao } = banco.paraEmpresa(outra.tenantId);
      await expect(
        transacao(async (tx) => {
          await tx.client.update({ where: { id: outra.clienteId }, data: { contactName: "desfeito" } });
          expect(await tx.client.findUnique({ where: { id: padrao.clienteId } })).toBeNull();
          throw new Error("desfaz");
        }),
      ).rejects.toThrow("desfaz");

      const depois = await banco.sistema.client.findUniqueOrThrow({ where: { id: outra.clienteId } });
      expect(depois.contactName).not.toBe("desfeito");
    });

    it("id de empresa malformado não chega ao banco", () => {
      expect(() => banco.paraEmpresa("' OR 1=1 --")).toThrow(banco.SemEmpresaError);
    });
  });

  describe("a quem pertence um e-mail", () => {
    const email = `${PREFIXO}admin@exemplo.br`;

    it("o mesmo e-mail em duas empresas são dois cadastros; com a empresa informada, um só", async () => {
      const todos = await auth.findUsersForLogin(email);
      expect(todos.map((u) => u.tenantId).sort()).toEqual([EMPRESA_PADRAO.id, EMPRESA_OUTRA.id].sort());
      expect(await auth.findUserForLogin(email)).toBeNull();

      expect((await auth.findUserForLogin(email, EMPRESA_OUTRA.slug))?.id).toBe(outra.adminId);
      expect((await auth.findUserForLogin(email, EMPRESA_PADRAO.slug))?.id).toBe(padrao.adminId);
      expect(await auth.findUsersForLogin(email, "nao-existe")).toEqual([]);
    });

    it("empresa desativada não entra", async () => {
      await banco.sistema.tenant.update({ where: { id: EMPRESA_OUTRA.id }, data: { active: false } });
      try {
        expect(await auth.findUserForLogin(email, EMPRESA_OUTRA.slug)).toBeNull();
        expect((await auth.findUsersForLogin(email)).map((u) => u.tenantId)).toEqual([EMPRESA_PADRAO.id]);
      } finally {
        await banco.sistema.tenant.update({ where: { id: EMPRESA_OUTRA.id }, data: { active: true } });
      }
    });
  });
});
