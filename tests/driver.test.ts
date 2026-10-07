import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getServerSession } from "next-auth";
import {
  DELIVERED_BY_PANEL_MESSAGE,
  DELIVERY_NOT_FOUND_MESSAGE,
  MAX_SIGNATURE_CHARS,
  NOT_IN_ROUTE_MESSAGE,
} from "../src/lib/entregas";
import { classifyBaixaResponse } from "../src/lib/offline-queue";

/**
 * Aplicativo do motorista: a baixa de entrega pela viagem e a lista de viagens,
 * contra um Postgres de verdade, no padrão de `manifestos.test.ts` (sessão
 * simulada, handlers reais).
 *
 * A regra de reenvio da fila offline é testada à parte, sem banco e sem
 * navegador. Sem DATABASE_URL a parte de integração é pulada com aviso — no CI
 * ela sempre roda.
 */
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

const temBanco = Boolean(process.env.DATABASE_URL);

if (!temBanco) {
  console.warn(
    "\n[driver.test] DATABASE_URL ausente: testes de integração PULADOS.\n" +
      "Rode com um Postgres real para exercitá-los.\n",
  );
}

const suite = temBanco ? describe : describe.skip;

describe("fila offline: o que fazer com a resposta do servidor", () => {
  it.each([200, 201])("%i → sent", (status) => {
    expect(classifyBaixaResponse(status)).toBe("sent");
  });

  it.each([400, 404, 409])("%i → rejected", (status) => {
    expect(classifyBaixaResponse(status)).toBe("rejected");
  });

  it.each([500, 502, 503])("%i → retry", (status) => {
    expect(classifyBaixaResponse(status)).toBe("retry");
  });
});

// Tudo o que esta suite cria usa estes marcadores, e só isso é apagado.
const PREFIXO = "teste-driver-";
const CNPJ_TESTE = "99888777001057";
// Todo CPF e toda placa da suite começam assim: cada viagem tem a sua dupla.
const CPF_PREFIXO = "99955544";
const PLACA_PREFIXO = "TDR";
const HASH_FALSO = "$2b$10$hashfalsoparateste000000000000000000000000000000000";
const SEM_ID = "00000000-0000-0000-0000-000000000000";

const FOTO = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
const ASSINATURA = "data:image/png;base64,iVBORw0KGgo=";

const RECEIVER_NAME_MESSAGE = "Informe o nome de quem recebeu (2 a 120 caracteres).";
const RECEIVER_DOC_MESSAGE = "Informe o documento de quem recebeu (5 a 20 caracteres).";
const PHOTO_MESSAGE = "A foto precisa ser uma imagem JPEG, PNG ou WebP.";
const SIGNATURE_MESSAGE = "A assinatura precisa ser uma imagem.";
const SIGNATURE_TOO_BIG = "A assinatura ficou grande demais. Limpe e assine de novo.";
const LOCATION_MESSAGE = "Localização inválida.";

type Linha = {
  fromStatus: string | null;
  toStatus: string;
  user: { id: string; name: string } | null;
};

suite("aplicativo do motorista", () => {
  let prisma: typeof import("../src/lib/prisma").default;
  let baixaRota: typeof import("../src/app/api/driver/entregas/[id]/baixa/route");
  let viagensDoMotorista: typeof import("../src/app/api/driver/manifestos/route");
  let manifestos: typeof import("../src/app/api/manifestos/route");
  let liberar: typeof import("../src/app/api/manifestos/[id]/liberar/route");
  let finalizar: typeof import("../src/app/api/manifestos/[id]/finalizar/route");
  let coletas: typeof import("../src/app/api/coletas/route");
  let statusRota: typeof import("../src/app/api/dashboard/coletas/[id]/status/route");
  let historico: typeof import("../src/app/api/coletas/[id]/historico/route");

  let operadorId: string;
  let adminId: string;
  let usuarioClienteId: string;
  let semCadastroId: string;
  let clienteId: string;

  const sessao = vi.mocked(getServerSession);

  const entrar = (id: string, role: string, clientId: string | null = null) =>
    sessao.mockResolvedValue({ user: { id, role, clientId } });
  const comoOperador = () => entrar(operadorId, "OPERATION");
  const comoMotorista = (userId: string) => entrar(userId, "DRIVER");

  const req = (method = "GET", body?: unknown) =>
    new Request("http://localhost/api/teste", {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

  const email = (nome: string) => `${PREFIXO}${nome}@exemplo.br`;

  const corpo = (extra: Record<string, unknown> = {}) => ({
    receiverName: "Maria Recebedora",
    receiverDoc: "123.456.789-00",
    photoBase64: FOTO,
    signatureBase64: ASSINATURA,
    latitude: -20.8113,
    longitude: -49.3758,
    ...extra,
  });

  // Coleta montada direto no banco, no estado que o teste precisa.
  const montar = (extra: Record<string, unknown> = {}) =>
    prisma.collection.create({
      data: {
        clientId: clienteId,
        sender: "Remetente Teste",
        receiver: "Destinatário Teste",
        origin: "Origem - SP",
        destination: "Destino - SP",
        volumes: 1,
        weight: 1,
        status: "COLLECTED",
        ...extra,
      },
    });

  const ler = (id: string) => prisma.collection.findUniqueOrThrow({ where: { id } });
  const comprovantes = (collectionId: string) => prisma.proofOfDelivery.findMany({ where: { collectionId } });
  const linhas = (collectionId: string) =>
    prisma.collectionStatusHistory.findMany({
      where: { collectionId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });

  let serie = 0;
  async function criarMotorista(active = true) {
    serie += 1;
    const n = String(serie).padStart(3, "0");
    const user = await prisma.user.create({
      data: { name: `Motorista ${n}`, email: email(`motorista-${n}`), password: HASH_FALSO, role: "DRIVER" },
    });
    const driver = await prisma.driver.create({
      data: {
        userId: user.id,
        cpf: `${CPF_PREFIXO}${n}`,
        cnh: "12345678900",
        cnhExpiry: new Date("2031-06-30"),
        category: "D",
        active,
      },
    });
    const veiculo = await prisma.vehicle.create({
      data: { plate: `${PLACA_PREFIXO}9${n}`, model: "Teste", type: "VAN" },
    });
    return { driverId: driver.id, userId: user.id, name: user.name, vehicleId: veiculo.id };
  }

  type Dupla = Awaited<ReturnType<typeof criarMotorista>>;

  // Viagem em montagem, com as cargas reservadas, pela rota de verdade.
  async function montagem(quantas = 1, cargasProntas?: { id: string }[], dupla?: Dupla) {
    const cargas = cargasProntas ?? (await Promise.all(Array.from({ length: quantas }, () => montar())));
    const motorista = dupla ?? (await criarMotorista());
    comoOperador();
    const res = await manifestos.POST(
      req("POST", {
        driverId: motorista.driverId,
        vehicleId: motorista.vehicleId,
        collectionIds: cargas.map((c) => c.id),
      }),
    );
    expect(res.status).toBe(201);
    return { id: (await res.json()).id as string, cargas, ...motorista };
  }

  // Viagem em rota: montada e com a saída liberada pelo operador.
  async function viagem(quantas = 1, cargasProntas?: { id: string }[], dupla?: Dupla) {
    const montada = await montagem(quantas, cargasProntas, dupla);
    comoOperador();
    expect((await liberar.POST(req("POST"), ctx(montada.id))).status).toBe(200);
    return montada;
  }

  const baixar = (collectionId: string, body: unknown = corpo()) => baixaRota.POST(req("POST", body), ctx(collectionId));

  // Baixa feita pelo motorista dono da viagem.
  async function baixarComo(userId: string, collectionId: string, body: unknown = corpo()) {
    comoMotorista(userId);
    return baixar(collectionId, body);
  }

  // Procura uma chave em qualquer profundidade da resposta.
  function temChave(valor: unknown, proibidas: string[]): boolean {
    if (Array.isArray(valor)) return valor.some((item) => temChave(item, proibidas));
    if (valor && typeof valor === "object") {
      return Object.entries(valor).some(([chave, filho]) => proibidas.includes(chave) || temChave(filho, proibidas));
    }
    return false;
  }

  // Na ordem das dependências: coletas → manifesto → veículo → motorista →
  // usuário → cliente. Comprovante e histórico saem junto da coleta, pela chave
  // estrangeira.
  async function limpar() {
    const daSuite = { email: { startsWith: PREFIXO, mode: "insensitive" as const } };
    await prisma.collection.deleteMany({ where: { client: { cnpj: CNPJ_TESTE } } });
    await prisma.manifest.deleteMany({ where: { vehicle: { plate: { startsWith: PLACA_PREFIXO } } } });
    await prisma.vehicle.deleteMany({ where: { plate: { startsWith: PLACA_PREFIXO } } });
    await prisma.driver.deleteMany({ where: { OR: [{ cpf: { startsWith: CPF_PREFIXO } }, { user: daSuite }] } });
    await prisma.user.deleteMany({ where: daSuite });
    await prisma.client.deleteMany({ where: { cnpj: CNPJ_TESTE } });
  }

  beforeAll(async () => {
    prisma = (await import("../src/lib/prisma")).default;
    baixaRota = await import("../src/app/api/driver/entregas/[id]/baixa/route");
    viagensDoMotorista = await import("../src/app/api/driver/manifestos/route");
    manifestos = await import("../src/app/api/manifestos/route");
    liberar = await import("../src/app/api/manifestos/[id]/liberar/route");
    finalizar = await import("../src/app/api/manifestos/[id]/finalizar/route");
    coletas = await import("../src/app/api/coletas/route");
    statusRota = await import("../src/app/api/dashboard/coletas/[id]/status/route");
    historico = await import("../src/app/api/coletas/[id]/historico/route");

    await limpar();

    clienteId = (
      await prisma.client.create({
        data: {
          companyName: "Empresa Teste Driver LTDA",
          tradeName: "Teste Driver",
          cnpj: CNPJ_TESTE,
          email: email("contato-da-empresa"),
          creditLimit: 12345,
        },
      })
    ).id;

    const usuario = (nome: string, role: "ADMIN" | "OPERATION" | "CLIENT" | "DRIVER", extra: { clientId?: string } = {}) =>
      prisma.user.create({ data: { name: nome, email: email(nome), password: HASH_FALSO, role, ...extra } });

    operadorId = (await usuario("operacao", "OPERATION")).id;
    adminId = (await usuario("admin", "ADMIN")).id;
    usuarioClienteId = (await usuario("cliente", "CLIENT", { clientId: clienteId })).id;
    semCadastroId = (await usuario("sem-cadastro", "DRIVER")).id;
  });

  beforeEach(() => {
    sessao.mockReset();
    comoOperador();
  });

  afterAll(async () => {
    if (prisma) await limpar();
  });

  describe("POST /api/driver/entregas/[id]/baixa", () => {
    it("sem sessão, ADMIN, OPERATION e CLIENT → 401; DRIVER sem cadastro e motorista inativo → 403; a carga não muda", async () => {
      const { cargas, driverId, userId } = await viagem();
      const alvo = cargas[0].id;

      sessao.mockResolvedValue(null);
      expect((await baixar(alvo)).status).toBe(401);

      entrar(adminId, "ADMIN");
      expect((await baixar(alvo)).status, "ADMIN").toBe(401);
      entrar(operadorId, "OPERATION");
      expect((await baixar(alvo)).status, "OPERATION").toBe(401);
      entrar(usuarioClienteId, "CLIENT", clienteId);
      expect((await baixar(alvo)).status, "CLIENT").toBe(401);

      entrar(semCadastroId, "DRIVER");
      const semCadastro = await baixar(alvo);
      expect(semCadastro.status).toBe(403);
      expect(await semCadastro.json()).toEqual({ error: "Usuário não possui cadastro de motorista." });

      await prisma.driver.update({ where: { id: driverId }, data: { active: false } });
      const inativo = await baixarComo(userId, alvo);
      expect(inativo.status).toBe(403);
      expect(await inativo.json()).toEqual({ error: "Motorista inativo." });
      await prisma.driver.update({ where: { id: driverId }, data: { active: true } });

      expect(await ler(alvo)).toMatchObject({ status: "ROUTE", receiverName: null });
      expect(await comprovantes(alvo)).toHaveLength(0);
      expect(await linhas(alvo)).toHaveLength(1);
    });

    it.each([
      ["sem nome do recebedor", { receiverName: undefined }, RECEIVER_NAME_MESSAGE],
      ["nome com 1 caractere", { receiverName: " A " }, RECEIVER_NAME_MESSAGE],
      ["nome com 121 caracteres", { receiverName: "x".repeat(121) }, RECEIVER_NAME_MESSAGE],
      ["nome que não é texto", { receiverName: 7 }, RECEIVER_NAME_MESSAGE],
      ["sem documento", { receiverDoc: undefined }, RECEIVER_DOC_MESSAGE],
      ["documento com 4 caracteres", { receiverDoc: "1234" }, RECEIVER_DOC_MESSAGE],
      ["documento com 21 caracteres", { receiverDoc: "1".repeat(21) }, RECEIVER_DOC_MESSAGE],
      ["foto em data:text/html", { photoBase64: "data:text/html;base64,PHNjcmlwdD4=" }, PHOTO_MESSAGE],
      ["foto em endereço externo", { photoBase64: "https://exemplo.br/foto.jpg" }, PHOTO_MESSAGE],
      ["foto em svg", { photoBase64: "data:image/svg+xml;base64,PHN2Zz4=" }, PHOTO_MESSAGE],
      ["assinatura em data:text/html", { signatureBase64: "data:text/html;base64,PHNjcmlwdD4=" }, SIGNATURE_MESSAGE],
      ["assinatura em endereço externo", { signatureBase64: "https://exemplo.br/a.png" }, SIGNATURE_MESSAGE],
      [
        "assinatura grande demais",
        { signatureBase64: `data:image/png;base64,${"A".repeat(MAX_SIGNATURE_CHARS)}` },
        SIGNATURE_TOO_BIG,
      ],
      ["latitude fora da faixa", { latitude: 90.5 }, LOCATION_MESSAGE],
      ["longitude fora da faixa", { longitude: -180.5 }, LOCATION_MESSAGE],
      ["latitude que não é número", { latitude: "-20.8" }, LOCATION_MESSAGE],
    ])("corpo inválido (%s) → 400 com a mensagem do schema, sem gravar", async (_caso, extra, mensagem) => {
      const { cargas, userId } = await viagem();

      const res = await baixarComo(userId, cargas[0].id, corpo(extra));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: mensagem });

      expect((await ler(cargas[0].id)).status).toBe("ROUTE");
      expect(await comprovantes(cargas[0].id)).toHaveLength(0);
    });

    it("corpo que não é JSON ou não é objeto → 400, sem gravar", async () => {
      const { cargas, userId } = await viagem();
      comoMotorista(userId);

      const naoJson = await baixaRota.POST(
        new Request("http://localhost/api/teste", { method: "POST", body: "<html>" }),
        ctx(cargas[0].id),
      );
      expect(naoJson.status).toBe(400);
      expect(await naoJson.json()).toEqual({ error: "Dados inválidos." });

      for (const invalido of [null, [], "texto", 7]) {
        const res = await baixar(cargas[0].id, invalido);
        expect(res.status, JSON.stringify(invalido)).toBe(400);
        expect((await res.json()).error).toBeTruthy();
      }

      expect((await ler(cargas[0].id)).status).toBe("ROUTE");
      expect(await comprovantes(cargas[0].id)).toHaveLength(0);
    });

    it("carga em rota na viagem do motorista → 200; coleta entregue, um comprovante e uma linha no histórico com o motorista", async () => {
      const { cargas, userId } = await viagem(2);
      const alvo = cargas[0].id;

      const res = await baixarComo(userId, alvo, corpo({ receiverName: "  Maria Recebedora  " }));
      expect(res.status).toBe(200);
      const json = await res.json();
      const [comprovante] = await comprovantes(alvo);
      expect(json).toEqual({ success: true, collectionId: alvo, proofId: comprovante.id });

      expect(await ler(alvo)).toMatchObject({ status: "DELIVERED", receiverName: "Maria Recebedora" });
      expect(await comprovantes(alvo)).toHaveLength(1);
      expect(comprovante).toMatchObject({
        collectionId: alvo,
        status: "SUBMITTED",
        receiverName: "Maria Recebedora",
        receiverDoc: "123.456.789-00",
        photoBase64: FOTO,
        signatureBase64: ASSINATURA,
        latitude: -20.8113,
        longitude: -49.3758,
      });

      const entrega = (await linhas(alvo)).filter((linha) => linha.toStatus === "DELIVERED");
      expect(entrega).toHaveLength(1);
      expect(entrega[0]).toMatchObject({ fromStatus: "ROUTE", toStatus: "DELIVERED", userId });

      // A outra carga da viagem não é tocada.
      expect((await ler(cargas[1].id)).status).toBe("ROUTE");
      expect(await comprovantes(cargas[1].id)).toHaveLength(0);
    });

    it("sem foto, sem assinatura e sem localização → 200, e a string vazia vira nulo", async () => {
      const { cargas, userId } = await viagem(2);

      const vazio = await baixarComo(
        userId,
        cargas[0].id,
        corpo({ photoBase64: "", signatureBase64: "", latitude: null, longitude: null }),
      );
      expect(vazio.status).toBe(200);
      expect((await comprovantes(cargas[0].id))[0]).toMatchObject({
        photoBase64: null,
        signatureBase64: null,
        latitude: null,
        longitude: null,
      });

      const ausente = await baixarComo(userId, cargas[1].id, { receiverName: "João", receiverDoc: "12345" });
      expect(ausente.status).toBe(200);
      expect((await comprovantes(cargas[1].id))[0]).toMatchObject({ photoBase64: null, signatureBase64: null });
    });

    it("se o comprovante não grava, a coleta não muda e o histórico não ganha linha", async () => {
      const { cargas, userId } = await viagem();
      const alvo = cargas[0].id;

      // Um comprovante já gravado para a carga em rota (dado que as rotas não
      // produzem) faz a criação falhar na chave única, depois do `updateMany`.
      const plantado = await prisma.proofOfDelivery.create({
        data: { collectionId: alvo, receiverName: "Plantado", receiverDoc: "00000" },
      });
      const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
      try {
        expect((await baixarComo(userId, alvo)).status).toBe(500);
      } finally {
        erro.mockRestore();
      }

      expect(await ler(alvo)).toMatchObject({ status: "ROUTE", receiverName: null });
      expect((await linhas(alvo)).map((linha) => linha.toStatus)).toEqual(["ROUTE"]);
      expect((await comprovantes(alvo)).map((c) => c.id)).toEqual([plantado.id]);
    });

    it("carga da viagem de outro motorista, carga sem viagem e id inexistente → 404; nada muda", async () => {
      const minha = await viagem();
      const alheia = await viagem();
      const solta = await montar();

      for (const [caso, id] of [
        ["de outro motorista", alheia.cargas[0].id],
        ["sem viagem", solta.id],
        ["inexistente", SEM_ID],
        ["que não é uuid", "nao-e-uuid"],
      ] as const) {
        const res = await baixarComo(minha.userId, id);
        expect(res.status, caso).toBe(404);
        expect(await res.json(), caso).toEqual({ error: DELIVERY_NOT_FOUND_MESSAGE });
      }

      expect(await ler(alheia.cargas[0].id)).toMatchObject({ status: "ROUTE", receiverName: null });
      expect(await ler(solta.id)).toMatchObject({ status: "COLLECTED", manifestId: null });
      expect(await comprovantes(alheia.cargas[0].id)).toHaveLength(0);
      expect(await comprovantes(solta.id)).toHaveLength(0);
    });

    it("viagem ainda em montagem → 404; carga fora de rota em viagem liberada → 409; nada muda", async () => {
      const emMontagem = await montagem();
      const reservada = await baixarComo(emMontagem.userId, emMontagem.cargas[0].id);
      expect(reservada.status).toBe(404);
      expect(await reservada.json()).toEqual({ error: DELIVERY_NOT_FOUND_MESSAGE });
      expect(await ler(emMontagem.cargas[0].id)).toMatchObject({ status: "COLLECTED", manifestId: emMontagem.id });

      // Dado legado: carga que não está em rota dentro de uma viagem liberada.
      const liberada = await viagem(2);
      for (const status of ["COLLECTED", "CONFIRMED", "CANCELLED"]) {
        await prisma.collection.update({ where: { id: liberada.cargas[0].id }, data: { status } });
        const res = await baixarComo(liberada.userId, liberada.cargas[0].id);
        expect(res.status, status).toBe(409);
        expect(await res.json(), status).toEqual({ error: NOT_IN_ROUTE_MESSAGE });
        expect((await ler(liberada.cargas[0].id)).status).toBe(status);
      }

      expect(await comprovantes(emMontagem.cargas[0].id)).toHaveLength(0);
      expect(await comprovantes(liberada.cargas[0].id)).toHaveLength(0);
    });

    it("repetir a baixa → 200 alreadyDelivered com o mesmo comprovante, sem reescrever; vale com a viagem finalizada", async () => {
      const { id, cargas, userId } = await viagem();
      const alvo = cargas[0].id;

      const primeira = await (await baixarComo(userId, alvo)).json();
      const antes = (await comprovantes(alvo))[0];
      const historicoAntes = await linhas(alvo);

      const repetida = await baixarComo(userId, alvo, corpo({ receiverName: "Outro Nome", receiverDoc: "99999" }));
      expect(repetida.status).toBe(200);
      expect(await repetida.json()).toEqual({
        success: true,
        alreadyDelivered: true,
        collectionId: alvo,
        proofId: primeira.proofId,
      });

      comoOperador();
      expect((await finalizar.POST(req("POST"), ctx(id))).status).toBe(200);

      const depois = await baixarComo(userId, alvo, corpo({ receiverName: "Terceiro Nome" }));
      expect(depois.status).toBe(200);
      expect(await depois.json()).toMatchObject({ alreadyDelivered: true, proofId: primeira.proofId });

      expect(await comprovantes(alvo)).toEqual([antes]);
      expect((await ler(alvo)).receiverName).toBe("Maria Recebedora");
      expect(await linhas(alvo)).toEqual(historicoAntes);
    });

    it("carga entregue pelo painel, sem comprovante → 409, e nenhum comprovante é criado", async () => {
      const { cargas, userId } = await viagem();
      const alvo = cargas[0].id;

      comoOperador();
      expect((await statusRota.POST(req("POST", { status: "DELIVERED", receiverName: "Fulano" }), ctx(alvo))).status).toBe(200);
      const historicoAntes = await linhas(alvo);

      const res = await baixarComo(userId, alvo);
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: DELIVERED_BY_PANEL_MESSAGE });

      expect(await comprovantes(alvo)).toHaveLength(0);
      expect((await ler(alvo)).receiverName).toBe("Fulano");
      expect(await linhas(alvo)).toEqual(historicoAntes);
    });

    it("duas baixas simultâneas da mesma carga: as duas 200, um comprovante e uma linha no histórico", async () => {
      const { cargas, userId } = await viagem();
      const alvo = cargas[0].id;
      comoMotorista(userId);

      const respostas = await Promise.all([baixar(alvo), baixar(alvo)]);
      expect(respostas.map((res) => res.status)).toEqual([200, 200]);

      const corpos = await Promise.all(respostas.map((res) => res.json()));
      expect(corpos.filter((json) => json.alreadyDelivered === true)).toHaveLength(1);
      expect(corpos[0].proofId).toBe(corpos[1].proofId);

      expect(await comprovantes(alvo)).toHaveLength(1);
      expect((await linhas(alvo)).filter((linha) => linha.toStatus === "DELIVERED")).toHaveLength(1);
      expect((await ler(alvo)).status).toBe("DELIVERED");
    });

    it("a baixa do motorista vale para encerrar a viagem: com carga pendente 409, depois da última 200", async () => {
      const { id, cargas, userId, vehicleId } = await viagem(2);

      expect((await baixarComo(userId, cargas[0].id)).status).toBe(200);
      comoOperador();
      expect((await finalizar.POST(req("POST"), ctx(id))).status).toBe(409);

      expect((await baixarComo(userId, cargas[1].id)).status).toBe(200);
      comoOperador();
      const res = await finalizar.POST(req("POST"), ctx(id));
      expect(res.status).toBe(200);
      expect((await res.json()).manifest).toMatchObject({ id, status: "FINISHED" });
      expect((await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicleId } })).status).toBe("AVAILABLE");
    });
  });

  describe("GET /api/driver/manifestos", () => {
    it("cada carga sai só com o que a tela usa, em ordem de criação, sem dado do cliente nem foto", async () => {
      const primeira = await montar({ receiver: "Primeira", createdAt: new Date("2026-01-01T10:00:00.000Z") });
      const segunda = await montar({ receiver: "Segunda", createdAt: new Date("2026-01-01T11:00:00.000Z") });
      // Entregue na ordem inversa, para a ordem não sair por acaso.
      const { id, userId } = await viagem(2, [segunda, primeira]);
      expect((await baixarComo(userId, primeira.id)).status).toBe(200);

      const res = await viagensDoMotorista.GET();
      expect(res.status).toBe(200);
      const texto = await res.text();
      const lista = JSON.parse(texto) as { id: string; collections: Record<string, unknown>[] }[];

      expect(lista.map((m) => m.id)).toEqual([id]);
      const [daViagem] = lista;
      expect(Object.keys(daViagem).sort()).toEqual(["collections", "createdAt", "id", "status", "vehicle"]);
      expect("deliveries" in daViagem).toBe(false);

      expect(daViagem.collections.map((c) => c.id)).toEqual([primeira.id, segunda.id]);
      for (const coleta of daViagem.collections) {
        expect(Object.keys(coleta).sort()).toEqual(
          ["client", "destination", "id", "origin", "receiver", "receiverName", "status", "volumes", "weight"],
        );
        expect(coleta.client).toEqual({ tradeName: "Teste Driver", companyName: "Empresa Teste Driver LTDA" });
      }
      expect(daViagem.collections[0]).toMatchObject({ status: "DELIVERED", receiverName: "Maria Recebedora" });
      expect(daViagem.collections[1]).toMatchObject({ status: "ROUTE", receiverName: null });

      expect(temChave(lista, ["deliveries", "creditLimit", "cnpj", "email", "photoBase64", "signatureBase64", "proof"])).toBe(false);
      for (const proibido of ["creditLimit", "cnpj", "email", "photoBase64", CNPJ_TESTE, FOTO]) {
        expect(texto).not.toContain(proibido);
      }
    });

    it("o motorista não vê a viagem de outro", async () => {
      const minha = await viagem();
      const alheia = await viagem();

      comoMotorista(minha.userId);
      const lista = (await (await viagensDoMotorista.GET()).json()) as { id: string }[];
      expect(lista.map((m) => m.id)).toEqual([minha.id]);
      expect(lista.map((m) => m.id)).not.toContain(alheia.id);
    });
  });

  describe("histórico ponta a ponta", () => {
    it("criada no painel, coletada, embarcada e entregue pelo motorista: quatro linhas em ordem, a última com o nome dele", async () => {
      comoOperador();
      const criada = await coletas.POST(
        req("POST", {
          clientId: clienteId,
          sender: "Remetente Teste",
          receiver: "Destinatário Teste",
          origin: "São José do Rio Preto - SP",
          destination: "São Paulo - SP",
          volumes: "3",
          weight: "12,5",
        }),
      );
      expect(criada.status).toBe(201);
      const { id: coletaId } = (await criada.json()) as { id: string };

      expect((await statusRota.POST(req("POST", { status: "COLLECTED" }), ctx(coletaId))).status).toBe(200);

      const motorista = await criarMotorista();
      await viagem(1, [{ id: coletaId }], motorista);
      expect((await baixarComo(motorista.userId, coletaId)).status).toBe(200);

      comoOperador();
      const res = await historico.GET(req(), ctx(coletaId));
      expect(res.status).toBe(200);
      const lista = (await res.json()) as Linha[];

      expect(lista.map((linha) => [linha.fromStatus, linha.toStatus])).toEqual([
        [null, "CONFIRMED"],
        ["CONFIRMED", "COLLECTED"],
        ["COLLECTED", "ROUTE"],
        ["ROUTE", "DELIVERED"],
      ]);
      const operador = { id: operadorId, name: "operacao" };
      expect(lista.slice(0, 3).map((linha) => linha.user)).toEqual([operador, operador, operador]);
      expect(lista[3].user).toEqual({ id: motorista.userId, name: motorista.name });
    });
  });
});
