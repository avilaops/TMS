import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getServerSession } from "next-auth";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ALREADY_REVIEWED_MESSAGE,
  DECISION_MESSAGE,
  PROOF_LIST_LIMIT,
  PROOF_NOT_FOUND_MESSAGE,
  PROOF_STATUS_FILTER_MESSAGE,
  REJECTION_REASON_MESSAGE,
  conferenciaSchema,
} from "../src/lib/entregas";

/**
 * Conferência de comprovantes no painel: a fila e a decisão de aprovar ou
 * recusar, contra um Postgres de verdade, no padrão de `driver.test.ts` (sessão
 * simulada, handlers reais). O comprovante é plantado direto no banco: como ele
 * nasce é assunto de `driver.test.ts`.
 *
 * Sem DATABASE_URL a parte de integração é pulada com aviso — no CI ela sempre
 * roda.
 */
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));

const temBanco = Boolean(process.env.DATABASE_URL);

if (!temBanco) {
  console.warn(
    "\n[comprovantes.test] DATABASE_URL ausente: testes de integração PULADOS.\n" +
      "Rode com um Postgres real para exercitá-los.\n",
  );
}

const suite = temBanco ? describe : describe.skip;

describe("conferenciaSchema", () => {
  it("aprovação ignora o motivo, seja o que for", () => {
    expect(conferenciaSchema.parse({ decision: "APPROVED" })).toEqual({ decision: "APPROVED", reason: null });
    expect(conferenciaSchema.parse({ decision: "APPROVED", reason: "tanto faz" })).toEqual({
      decision: "APPROVED",
      reason: null,
    });
    expect(conferenciaSchema.parse({ decision: "APPROVED", reason: 7 })).toEqual({ decision: "APPROVED", reason: null });
  });

  it("recusa apara o motivo e aceita de 5 a 500 caracteres", () => {
    expect(conferenciaSchema.parse({ decision: "REJECTED", reason: "  Foto ilegível  " })).toEqual({
      decision: "REJECTED",
      reason: "Foto ilegível",
    });
    expect(conferenciaSchema.safeParse({ decision: "REJECTED", reason: "x".repeat(5) }).success).toBe(true);
    expect(conferenciaSchema.safeParse({ decision: "REJECTED", reason: "x".repeat(500) }).success).toBe(true);
  });
});

const PREFIXO = "teste-comprovantes-";
const CNPJ_TESTE = "99777666000149";
const HASH_FALSO = "$2b$10$hashfalsoparateste000000000000000000000000000000000";
const SEM_ID = "00000000-0000-0000-0000-000000000000";

const FOTO = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
const ASSINATURA = "data:image/png;base64,iVBORw0KGgo=";
const MOTIVO = "Assinatura não confere com o recebedor.";

type Item = {
  id: string;
  status: string;
  receiverName: string;
  receiverDoc: string;
  createdAt: string;
  reviewedAt: string | null;
  rejectionReason: string | null;
  reviewedBy: { id: string; name: string } | null;
  collection: {
    id: string;
    trackingCode: string | null;
    receiver: string;
    destination: string;
    client: { tradeName: string | null; companyName: string };
  };
};

suite("conferência de comprovantes", () => {
  let prisma: typeof import("../src/lib/prisma").default;
  let lista: typeof import("../src/app/api/comprovantes/route");
  let conferirRota: typeof import("../src/app/api/comprovantes/[id]/conferir/route");
  let comprovantePagina: typeof import("../src/app/dashboard/entregas/[id]/comprovante/page");

  let operadorId: string;
  let adminId: string;
  let usuarioClienteId: string;
  let motoristaId: string;
  let clienteId: string;

  const sessao = vi.mocked(getServerSession);

  const entrar = (id: string, role: string, clientId: string | null = null) =>
    sessao.mockResolvedValue({ user: { id, role, clientId } });
  const comoOperador = () => entrar(operadorId, "OPERATION");
  const comoAdmin = () => entrar(adminId, "ADMIN");

  const req = (body?: unknown) =>
    new Request("http://localhost/api/teste", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

  const email = (nome: string) => `${PREFIXO}${nome}@exemplo.br`;

  const conferir = (collectionId: string, body: unknown) => conferirRota.POST(req(body), ctx(collectionId));
  const listar = (query = "") => lista.GET(new Request(`http://localhost/api/comprovantes${query}`));

  const coleta = (extra: Record<string, unknown> = {}) => ({
    clientId: clienteId,
    sender: "Remetente Teste",
    receiver: "Destinatário Teste",
    origin: "Origem - SP",
    destination: "Destino - SP",
    volumes: 1,
    weight: 1,
    status: "DELIVERED",
    receiverName: "Maria Recebedora",
    ...extra,
  });

  const comprovante = (collectionId: string, extra: Record<string, unknown> = {}) => ({
    collectionId,
    receiverName: "Maria Recebedora",
    receiverDoc: "123.456.789-00",
    photoBase64: FOTO,
    signatureBase64: ASSINATURA,
    ...extra,
  });

  // Carga entregue com comprovante, no estado que o teste precisa.
  async function plantar(extra: Record<string, unknown> = {}) {
    const carga = await prisma.collection.create({ data: coleta() });
    const proof = await prisma.proofOfDelivery.create({ data: comprovante(carga.id, extra) });
    return { collectionId: carga.id, proofId: proof.id };
  }

  const ler = (collectionId: string) => prisma.proofOfDelivery.findUniqueOrThrow({ where: { collectionId } });
  const lerColeta = (id: string) => prisma.collection.findUniqueOrThrow({ where: { id } });
  const linhas = (collectionId: string) => prisma.collectionStatusHistory.count({ where: { collectionId } });

  const INTACTO = { status: "SUBMITTED", reviewedById: null, reviewedAt: null, rejectionReason: null };

  // Procura uma chave em qualquer profundidade da resposta.
  function temChave(valor: unknown, proibidas: string[]): boolean {
    if (Array.isArray(valor)) return valor.some((item) => temChave(item, proibidas));
    if (valor && typeof valor === "object") {
      return Object.entries(valor).some(([chave, filho]) => proibidas.includes(chave) || temChave(filho, proibidas));
    }
    return false;
  }

  // Coletas → usuários → cliente. O comprovante sai junto da coleta, pela
  // chave estrangeira.
  async function limpar() {
    await prisma.collection.deleteMany({ where: { client: { cnpj: CNPJ_TESTE } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: PREFIXO, mode: "insensitive" } } });
    await prisma.client.deleteMany({ where: { cnpj: CNPJ_TESTE } });
  }

  beforeAll(async () => {
    prisma = (await import("../src/lib/prisma")).default;
    lista = await import("../src/app/api/comprovantes/route");
    conferirRota = await import("../src/app/api/comprovantes/[id]/conferir/route");
    comprovantePagina = await import("../src/app/dashboard/entregas/[id]/comprovante/page");

    await limpar();

    clienteId = (
      await prisma.client.create({
        data: {
          companyName: "Empresa Teste Comprovantes LTDA",
          tradeName: "Teste Comprovantes",
          cnpj: CNPJ_TESTE,
          email: email("contato-da-empresa"),
        },
      })
    ).id;

    const usuario = (nome: string, role: "ADMIN" | "OPERATION" | "CLIENT" | "DRIVER", extra: { clientId?: string } = {}) =>
      prisma.user.create({ data: { name: nome, email: email(nome), password: HASH_FALSO, role, ...extra } });

    operadorId = (await usuario("operacao", "OPERATION")).id;
    adminId = (await usuario("admin", "ADMIN")).id;
    usuarioClienteId = (await usuario("cliente", "CLIENT", { clientId: clienteId })).id;
    motoristaId = (await usuario("motorista", "DRIVER")).id;
  });

  beforeEach(() => {
    sessao.mockReset();
    comoOperador();
  });

  afterAll(async () => {
    if (prisma) await limpar();
  });

  describe("POST /api/comprovantes/[id]/conferir", () => {
    it("sem sessão → 401; CLIENT e DRIVER → 403; o comprovante não muda", async () => {
      const { collectionId } = await plantar();
      const aprovar = { decision: "APPROVED" };

      sessao.mockResolvedValue(null);
      expect((await conferir(collectionId, aprovar)).status).toBe(401);

      entrar(usuarioClienteId, "CLIENT", clienteId);
      expect((await conferir(collectionId, aprovar)).status, "CLIENT").toBe(403);

      entrar(motoristaId, "DRIVER");
      expect((await conferir(collectionId, aprovar)).status, "DRIVER").toBe(403);

      // O perfil vale o do banco: token que diz ADMIN não promove o motorista.
      entrar(motoristaId, "ADMIN");
      expect((await conferir(collectionId, aprovar)).status, "token ADMIN de motorista").toBe(403);

      entrar(SEM_ID, "ADMIN");
      expect((await conferir(collectionId, aprovar)).status, "usuário apagado").toBe(401);

      expect(await ler(collectionId)).toMatchObject(INTACTO);
    });

    it.each([
      ["sem decisão", {}, DECISION_MESSAGE],
      ["decisão fora da lista", { decision: "SUBMITTED" }, DECISION_MESSAGE],
      ["decisão que não é texto", { decision: 1 }, DECISION_MESSAGE],
      ["recusa sem motivo", { decision: "REJECTED" }, REJECTION_REASON_MESSAGE],
      ["recusa com motivo só de espaços", { decision: "REJECTED", reason: "        " }, REJECTION_REASON_MESSAGE],
      ["recusa com motivo de 4 caracteres", { decision: "REJECTED", reason: " ruim " }, REJECTION_REASON_MESSAGE],
      ["recusa com motivo de 501 caracteres", { decision: "REJECTED", reason: "x".repeat(501) }, REJECTION_REASON_MESSAGE],
      ["recusa com motivo que não é texto", { decision: "REJECTED", reason: 12345 }, REJECTION_REASON_MESSAGE],
      ["corpo que não é objeto", "aprovar", "Dados inválidos."],
    ])("%s → 400 e o comprovante não muda", async (_caso, body, mensagem) => {
      const { collectionId } = await plantar();

      const res = await conferir(collectionId, body);

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: mensagem });
      expect(await ler(collectionId)).toMatchObject(INTACTO);
    });

    it("corpo que não é JSON → 400", async () => {
      const { collectionId } = await plantar();

      const res = await conferirRota.POST(
        new Request("http://localhost/api/teste", { method: "POST", body: "{decision" }),
        ctx(collectionId),
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Dados inválidos." });
      expect(await ler(collectionId)).toMatchObject(INTACTO);
    });

    it("coleta que não existe ou sem comprovante (baixa pelo painel) → 404", async () => {
      const semComprovante = await prisma.collection.create({ data: coleta() });

      for (const id of [SEM_ID, semComprovante.id]) {
        const res = await conferir(id, { decision: "APPROVED" });
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({ error: PROOF_NOT_FOUND_MESSAGE });
      }
      expect(await prisma.proofOfDelivery.count({ where: { collectionId: semComprovante.id } })).toBe(0);
    });

    it("aprovar → 200; grava quem conferiu e quando, e ignora o motivo enviado junto", async () => {
      const { collectionId, proofId } = await plantar();
      const antes = Date.now();

      for (const [id, role] of [[adminId, "ADMIN"], [operadorId, "OPERATION"]] as const) {
        const alvo = role === "ADMIN" ? collectionId : (await plantar()).collectionId;
        entrar(id, role);
        const res = await conferir(alvo, { decision: "APPROVED", reason: "motivo que não vale" });

        expect(res.status, role).toBe(200);
        const body = await res.json();
        expect(body).toEqual({
          success: true,
          collectionId: alvo,
          proofId: role === "ADMIN" ? proofId : expect.any(String),
          status: "APPROVED",
        });

        const gravado = await ler(alvo);
        expect(gravado).toMatchObject({ status: "APPROVED", reviewedById: id, rejectionReason: null });
        expect(gravado.reviewedAt!.getTime()).toBeGreaterThanOrEqual(antes - 1000);
        expect(gravado.reviewedAt!.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
      }
    });

    it("recusar com motivo → 200; grava o motivo aparado, quem conferiu e quando", async () => {
      const { collectionId, proofId } = await plantar();

      const res = await conferir(collectionId, { decision: "REJECTED", reason: `  ${MOTIVO}  ` });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true, collectionId, proofId, status: "REJECTED" });

      const gravado = await ler(collectionId);
      expect(gravado).toMatchObject({ status: "REJECTED", reviewedById: operadorId, rejectionReason: MOTIVO });
      expect(gravado.reviewedAt).toBeInstanceOf(Date);
    });

    it("comprovante já conferido → 409 e a decisão anterior fica como estava", async () => {
      const { collectionId } = await plantar();
      expect((await conferir(collectionId, { decision: "REJECTED", reason: MOTIVO })).status).toBe(200);
      const decidido = await ler(collectionId);

      comoAdmin();
      for (const body of [{ decision: "APPROVED" }, { decision: "REJECTED", reason: "Outro motivo qualquer." }]) {
        const res = await conferir(collectionId, body);
        expect(res.status).toBe(409);
        expect(await res.json()).toEqual({ error: ALREADY_REVIEWED_MESSAGE });
      }

      const depois = await ler(collectionId);
      expect(depois).toMatchObject({
        status: "REJECTED",
        reviewedById: operadorId,
        rejectionReason: MOTIVO,
      });
      expect(depois.reviewedAt).toEqual(decidido.reviewedAt);
    });

    it("duas decisões simultâneas: uma vale (200), a outra recebe 409, e o banco fica com a que valeu", async () => {
      for (let rodada = 0; rodada < 5; rodada += 1) {
        const { collectionId } = await plantar();

        const respostas = await Promise.all([
          conferir(collectionId, { decision: "APPROVED" }),
          conferir(collectionId, { decision: "REJECTED", reason: MOTIVO }),
        ]);

        expect(respostas.map((r) => r.status).sort()).toEqual([200, 409]);
        const venceu = await respostas.find((r) => r.status === 200)!.json();
        const gravado = await ler(collectionId);
        expect(gravado.status).toBe(venceu.status);
        expect(gravado.rejectionReason).toBe(venceu.status === "REJECTED" ? MOTIVO : null);
        expect(gravado.reviewedById).toBe(operadorId);
      }
    });

    it("a conferência não mexe na coleta nem no histórico, e a resposta não traz foto nem assinatura", async () => {
      const aprovado = await plantar();
      const recusado = await plantar();
      const antes = await lerColeta(aprovado.collectionId);

      const respostas = [
        await conferir(aprovado.collectionId, { decision: "APPROVED" }),
        await conferir(recusado.collectionId, { decision: "REJECTED", reason: MOTIVO }),
      ];

      for (const res of respostas) {
        expect(res.status).toBe(200);
        expect(temChave(await res.json(), ["photoBase64", "signatureBase64"])).toBe(false);
      }
      for (const { collectionId } of [aprovado, recusado]) {
        expect(await lerColeta(collectionId)).toMatchObject({ status: "DELIVERED", receiverName: "Maria Recebedora" });
        expect(await linhas(collectionId)).toBe(0);
      }
      expect((await lerColeta(aprovado.collectionId)).updatedAt).toEqual(antes.updatedAt);
      // A foto e a assinatura continuam no comprovante.
      expect(await ler(aprovado.collectionId)).toMatchObject({ photoBase64: FOTO, signatureBase64: ASSINATURA });
    });
  });

  describe("GET /api/comprovantes", () => {
    const daSuite = async (query = "") => {
      const res = await listar(query);
      expect(res.status).toBe(200);
      const itens = (await res.json()) as Item[];
      return itens.filter((item) => item.collection.client.companyName === "Empresa Teste Comprovantes LTDA");
    };

    beforeEach(async () => {
      await prisma.collection.deleteMany({ where: { client: { cnpj: CNPJ_TESTE } } });
    });

    it("sem sessão → 401; CLIENT e DRIVER → 403; ADMIN e OPERATION → 200", async () => {
      sessao.mockResolvedValue(null);
      expect((await listar()).status).toBe(401);

      entrar(usuarioClienteId, "CLIENT", clienteId);
      expect((await listar()).status, "CLIENT").toBe(403);
      entrar(motoristaId, "DRIVER");
      expect((await listar()).status, "DRIVER").toBe(403);
      entrar(motoristaId, "ADMIN");
      expect((await listar()).status, "token ADMIN de motorista").toBe(403);

      comoAdmin();
      expect((await listar()).status, "ADMIN").toBe(200);
      comoOperador();
      expect((await listar()).status, "OPERATION").toBe(200);
    });

    it("status fora da lista → 400", async () => {
      for (const query of ["?status=PENDING", "?status=", "?status=submitted"]) {
        const res = await listar(query);
        expect(res.status, query).toBe(400);
        expect(await res.json()).toEqual({ error: PROOF_STATUS_FILTER_MESSAGE });
      }
    });

    it("sem parâmetro vale a fila (SUBMITTED), do mais antigo para o mais novo; o filtro separa os três status", async () => {
      const novo = await plantar({ createdAt: new Date("2026-03-03T12:00:00Z") });
      const antigo = await plantar({ createdAt: new Date("2026-03-01T12:00:00Z") });
      const meio = await plantar({ createdAt: new Date("2026-03-02T12:00:00Z") });
      const aprovado = await plantar();
      const recusado = await plantar();
      expect((await conferir(aprovado.collectionId, { decision: "APPROVED" })).status).toBe(200);
      expect((await conferir(recusado.collectionId, { decision: "REJECTED", reason: MOTIVO })).status).toBe(200);

      const fila = [antigo.proofId, meio.proofId, novo.proofId];
      expect((await daSuite()).map((item) => item.id)).toEqual(fila);
      expect((await daSuite("?status=SUBMITTED")).map((item) => item.id)).toEqual(fila);
      expect((await daSuite("?status=APPROVED")).map((item) => item.id)).toEqual([aprovado.proofId]);
      expect((await daSuite("?status=REJECTED")).map((item) => item.id)).toEqual([recusado.proofId]);
    });

    it("cada item traz o comprovante, a carga e quem conferiu — sem foto, assinatura, senha, e-mail ou CNPJ", async () => {
      const carga = await prisma.collection.create({ data: coleta({ trackingCode: `TC${randomUUID().slice(0, 10)}` }) });
      const proof = await prisma.proofOfDelivery.create({ data: comprovante(carga.id) });

      const [pendente] = await daSuite();
      expect(pendente).toEqual({
        id: proof.id,
        status: "SUBMITTED",
        receiverName: "Maria Recebedora",
        receiverDoc: "123.456.789-00",
        createdAt: proof.createdAt.toISOString(),
        reviewedAt: null,
        rejectionReason: null,
        reviewedBy: null,
        collection: {
          id: carga.id,
          trackingCode: carga.trackingCode,
          receiver: "Destinatário Teste",
          destination: "Destino - SP",
          client: { tradeName: "Teste Comprovantes", companyName: "Empresa Teste Comprovantes LTDA" },
        },
      });

      expect((await conferir(carga.id, { decision: "REJECTED", reason: MOTIVO })).status).toBe(200);
      const [recusado] = await daSuite("?status=REJECTED");
      expect(recusado).toMatchObject({
        id: proof.id,
        status: "REJECTED",
        rejectionReason: MOTIVO,
        reviewedBy: { id: operadorId, name: "operacao" },
      });
      expect(Object.keys(recusado.reviewedBy!).sort()).toEqual(["id", "name"]);
      expect(new Date(recusado.reviewedAt!).getTime()).not.toBeNaN();

      for (const query of ["", "?status=REJECTED"]) {
        const texto = await (await listar(query)).text();
        expect(temChave(JSON.parse(texto), ["photoBase64", "signatureBase64", "password", "email", "cnpj"])).toBe(false);
        expect(texto).not.toContain(FOTO);
        expect(texto).not.toContain(ASSINATURA);
        expect(texto).not.toContain(HASH_FALSO);
        expect(texto).not.toContain(CNPJ_TESTE);
      }
    });

    it("apagar o usuário que conferiu não apaga a decisão: fica sem conferente", async () => {
      const { collectionId, proofId } = await plantar();
      const temporario = await prisma.user.create({
        data: { name: "Temporário", email: email("temporario"), password: HASH_FALSO, role: "OPERATION" },
      });
      entrar(temporario.id, "OPERATION");
      expect((await conferir(collectionId, { decision: "APPROVED" })).status).toBe(200);

      await prisma.user.delete({ where: { id: temporario.id } });

      comoOperador();
      const [item] = await daSuite("?status=APPROVED");
      expect(item).toMatchObject({ id: proofId, status: "APPROVED", reviewedBy: null });
      expect(item.reviewedAt).not.toBeNull();
    });

    it(`devolve no máximo ${PROOF_LIST_LIMIT} itens`, async () => {
      const total = PROOF_LIST_LIMIT + 1;
      const ids = Array.from({ length: total }, () => randomUUID());
      await prisma.collection.createMany({ data: ids.map((id) => ({ id, ...coleta() })) });
      await prisma.proofOfDelivery.createMany({
        data: ids.map((id) => ({ collectionId: id, receiverName: "Maria", receiverDoc: "12345", status: "APPROVED" })),
      });

      const res = await listar("?status=APPROVED");
      expect(res.status).toBe(200);
      expect(await res.json()).toHaveLength(PROOF_LIST_LIMIT);
    });
  });

  describe("página do comprovante: conferência", () => {
    const abrir = async (collectionId: string) =>
      renderToStaticMarkup(await comprovantePagina.default({ params: Promise.resolve({ id: collectionId }) }));

    it("aguardando conferência: mostra Aprovar e Recusar, e volta para a fila", async () => {
      const { collectionId } = await plantar();

      const html = await abrir(collectionId);

      expect(html).toContain("Aprovar");
      expect(html).toContain("Recusar");
      expect(html).not.toContain("Conferido por");
      expect(html).toContain('href="/dashboard/comprovantes"');
    });

    it("aprovado: mostra quem conferiu e quando (fuso de São Paulo), sem botão", async () => {
      const { collectionId } = await plantar();
      comoAdmin();
      expect((await conferir(collectionId, { decision: "APPROVED" })).status).toBe(200);
      const quando = (await ler(collectionId)).reviewedAt!.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

      const html = await abrir(collectionId);

      expect(html).toContain("Conferido por");
      expect(html).toContain("admin");
      expect(html).toContain(quando);
      expect(html).not.toContain("<button");
      expect(html).not.toContain("Motivo da recusa");
    });

    it("recusado: mostra também o motivo, sem botão", async () => {
      const { collectionId } = await plantar();
      expect((await conferir(collectionId, { decision: "REJECTED", reason: MOTIVO })).status).toBe(200);

      const html = await abrir(collectionId);

      expect(html).toContain("Conferido por");
      expect(html).toContain("operacao");
      expect(html).toContain("Motivo da recusa");
      expect(html).toContain(MOTIVO);
      expect(html).not.toContain("<button");
    });
  });
});
