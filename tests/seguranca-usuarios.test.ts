import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getServerSession } from "next-auth";
import bcrypt from "bcryptjs";

/**
 * Login sem diferenciar caixa, senha de motorista, hash fora das respostas,
 * receita só para ADMIN, aviso de acesso negado no financeiro e a corrida da
 * trava do último ADMIN — contra um Postgres de verdade, no padrão de
 * `permissoes.test.ts` (sessão simulada, handlers reais).
 *
 * Sem DATABASE_URL a suite é pulada com aviso — no CI ela sempre roda.
 */
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

const temBanco = Boolean(process.env.DATABASE_URL);

if (!temBanco) {
  console.warn(
    "\n[seguranca-usuarios.test] DATABASE_URL ausente: testes de integração PULADOS.\n" +
      "Rode com um Postgres real para exercitá-los.\n",
  );
}

const suite = temBanco ? describe : describe.skip;

// Tudo o que esta suite cria usa estes marcadores, e só isso é apagado.
const PREFIXO = "teste-seguranca-";
const CNPJ_TESTE = "99888777000247";
const CPF_EXISTENTE = "99988877766";
const CPF_NOVO = "99988877755";
const CPF_FALHA = "99988877744";
const PLACA_TESTE = "TSG0T35";
const DESCRICAO_RECEITA = "teste-seguranca-receita";
const HASH_FALSO = "$2b$10$hashfalsoparateste000000000000000000000000000000000";
const SENHA = "senha-de-teste-123";

type Perfil = "ADMIN" | "OPERATION";

suite("segurança de usuários e motoristas", () => {
  let prisma: typeof import("../src/lib/prisma").default;
  let sistema: typeof import("../src/lib/prisma").sistema;
  let auth: typeof import("../src/lib/auth");
  let coletas: typeof import("../src/app/api/coletas/route");
  let dashboard: typeof import("../src/app/api/dashboard/route");
  let financeiro: typeof import("../src/app/api/financeiro/route");
  let manifestos: typeof import("../src/app/api/manifestos/route");
  let motoristas: typeof import("../src/app/api/motoristas/route");
  let veiculos: typeof import("../src/app/api/veiculos/route");
  let usuario: typeof import("../src/app/api/usuarios/[id]/route");
  let tela: typeof import("../src/app/dashboard/financeiro/carregar");
  let painel: typeof import("../src/app/dashboard/painel");

  const ids = {} as Record<Perfil, string>;
  let senhaHash: string;

  const sessao = vi.mocked(getServerSession);
  const sessaoDe = (id: string) => ({ user: { id, role: "ADMIN", clientId: null } });

  function entrarComo(perfil: Perfil) {
    sessao.mockResolvedValue(sessaoDe(ids[perfil]));
  }

  const req = (method = "GET", body?: unknown) =>
    new Request("http://localhost/api/teste", {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

  async function limpar() {
    const cpfs = [CPF_EXISTENTE, CPF_NOVO, CPF_FALHA];
    await prisma.collection.deleteMany({ where: { client: { cnpj: CNPJ_TESTE } } });
    await prisma.manifest.deleteMany({ where: { driver: { cpf: { in: cpfs } } } });
    await prisma.vehicle.deleteMany({ where: { plate: PLACA_TESTE } });
    await prisma.driver.deleteMany({ where: { cpf: { in: cpfs } } });
    await prisma.financialTransaction.deleteMany({ where: { description: DESCRICAO_RECEITA } });
    await prisma.user.deleteMany({
      where: {
        OR: [
          { email: { startsWith: PREFIXO, mode: "insensitive" } },
          { email: { in: cpfs.map((cpf) => `${cpf}@motorista.mello.com`) } },
        ],
      },
    });
    await prisma.client.deleteMany({ where: { cnpj: CNPJ_TESTE } });
  }

  // `email` é gravado como vier: é assim que se simula o cadastro antigo com maiúscula.
  async function criarUsuario(email: string, role: Perfil | "DRIVER", password = HASH_FALSO) {
    return prisma.user.create({ data: { name: email, email, password, role } });
  }

  // Procura a chave `password` em qualquer profundidade da resposta.
  function temChaveDeSenha(valor: unknown): boolean {
    if (Array.isArray(valor)) return valor.some(temChaveDeSenha);
    if (valor && typeof valor === "object") {
      return Object.entries(valor).some(([chave, filho]) => chave === "password" || temChaveDeSenha(filho));
    }
    return false;
  }

  beforeAll(async () => {
    const banco = await import("../src/lib/prisma");
    prisma = banco.default;
    sistema = banco.sistema;
    auth = await import("../src/lib/auth");
    coletas = await import("../src/app/api/coletas/route");
    dashboard = await import("../src/app/api/dashboard/route");
    financeiro = await import("../src/app/api/financeiro/route");
    manifestos = await import("../src/app/api/manifestos/route");
    motoristas = await import("../src/app/api/motoristas/route");
    veiculos = await import("../src/app/api/veiculos/route");
    usuario = await import("../src/app/api/usuarios/[id]/route");
    tela = await import("../src/app/dashboard/financeiro/carregar");
    painel = await import("../src/app/dashboard/painel");

    await limpar();

    // Custo baixo só para o teste não demorar; o que importa é ser bcrypt de verdade.
    senhaHash = await bcrypt.hash(SENHA, 4);

    ids.ADMIN = (await criarUsuario(`${PREFIXO}admin@exemplo.br`, "ADMIN")).id;
    ids.OPERATION = (await criarUsuario(`${PREFIXO}operacao@exemplo.br`, "OPERATION")).id;
  });

  beforeEach(() => {
    sessao.mockReset();
  });

  afterAll(async () => {
    if (prisma) await limpar();
  });

  describe("login não diferencia caixa do e-mail", () => {
    // A busca que o login único faz com o e-mail vindo do auth.
    const achar = async (email: string) => (await auth.findUserForLogin(email))?.id;

    it("usuário novo (gravado em minúsculas) é achado com maiúsculas e espaços", async () => {
      const novo = await criarUsuario(`${PREFIXO}novo@exemplo.br`, "OPERATION", senhaHash);
      expect(await achar(`  ${PREFIXO.toUpperCase()}Novo@Exemplo.BR `)).toBe(novo.id);
    });

    it("usuário antigo (gravado com maiúscula) é achado de qualquer jeito", async () => {
      const antigo = await criarUsuario("Teste-Seguranca-Antigo@Exemplo.BR", "OPERATION", senhaHash);

      expect(await achar("Teste-Seguranca-Antigo@Exemplo.BR")).toBe(antigo.id);
      expect(await achar("teste-seguranca-antigo@exemplo.br")).toBe(antigo.id);
    });

    it("não trata `_` e `%` como curinga, nem acha e-mail vazio", async () => {
      await criarUsuario(`${PREFIXO}axb@exemplo.br`, "OPERATION", senhaHash);

      expect(await auth.findUserForLogin(`${PREFIXO}a_b@exemplo.br`)).toBeNull();
      expect(await auth.findUserForLogin(`${PREFIXO}a%@exemplo.br`)).toBeNull();
      expect(await auth.findUserForLogin("%")).toBeNull();
      expect(await auth.findUserForLogin("   ")).toBeNull();
    });

    it("dois cadastros antigos que só diferem na caixa: vale o digitado exato, senão ninguém", async () => {
      const minusculo = await criarUsuario(`${PREFIXO}duplo@exemplo.br`, "OPERATION", senhaHash);
      const maiusculo = await criarUsuario(`${PREFIXO}DUPLO@exemplo.br`, "OPERATION", senhaHash);

      expect((await auth.findUserForLogin(`${PREFIXO}duplo@exemplo.br`))?.id).toBe(minusculo.id);
      expect((await auth.findUserForLogin(`${PREFIXO}DUPLO@exemplo.br`))?.id).toBe(maiusculo.id);
      expect(await auth.findUserForLogin(`${PREFIXO}Duplo@exemplo.br`)).toBeNull();
    });
  });

  describe("hash de senha do motorista fora das respostas", () => {
    beforeAll(async () => {
      const cliente = await prisma.client.create({
        data: { companyName: "Empresa Teste Seguranca LTDA", cnpj: CNPJ_TESTE },
      });
      const user = await criarUsuario(`${PREFIXO}motorista@exemplo.br`, "DRIVER");
      const driver = await prisma.driver.create({
        data: { userId: user.id, cpf: CPF_EXISTENTE, cnh: "123", cnhExpiry: new Date("2030-01-01"), category: "C" },
      });
      const vehicle = await prisma.vehicle.create({
        data: { plate: PLACA_TESTE, model: "Teste", type: "VAN", driverId: driver.id },
      });
      const manifest = await prisma.manifest.create({ data: { driverId: driver.id, vehicleId: vehicle.id } });
      await prisma.collection.create({
        data: {
          clientId: cliente.id,
          sender: "Remetente",
          receiver: "Destinatário",
          origin: "A",
          destination: "B",
          volumes: 1,
          weight: 1,
          driverId: driver.id,
          manifestId: manifest.id,
        },
      });
    });

    it.each(["motoristas", "coletas", "manifestos", "veiculos"] as const)(
      "GET /api/%s traz o nome do motorista, sem senha nem hash",
      async (rota) => {
        entrarComo("OPERATION");
        const res = await { motoristas, coletas, manifestos, veiculos }[rota].GET();
        expect(res.status).toBe(200);
        const corpo = await res.json();
        const texto = JSON.stringify(corpo);

        // O motorista do teste está na resposta: sem isto o teste passaria vazio.
        expect(texto).toContain(`${PREFIXO}motorista@exemplo.br`);
        expect(texto).not.toContain(HASH_FALSO);
        expect(temChaveDeSenha(corpo)).toBe(false);
      },
    );
  });

  describe("POST /api/motoristas", () => {
    // O cadastro define o acesso: e-mail e senha vêm no formulário.
    const corpo = (cpf: string, email: string) => ({
      name: "Motorista Novo",
      cpf,
      email,
      password: SENHA,
      cnh: "12345678900",
      category: "C",
      cnhExpiry: "2031-06-30",
    });

    it("ignora senha informada: nada dela é gravado nem devolvido", async () => {
      entrarComo("OPERATION");
      const email = `${PREFIXO}motorista-novo@exemplo.br`;
      const res = await motoristas.POST(req("POST", corpo(CPF_NOVO, email)));
      expect(res.status).toBe(201);
      const resposta = await res.json();
      expect(temChaveDeSenha(resposta)).toBe(false);

      const gravado = await prisma.user.findFirstOrThrow({ where: { email } });
      expect(gravado.role).toBe("DRIVER");
      // O TMS não tem senha: a que vier no corpo é ignorada, e a coluna guarda
      // um valor que não é hash de nada.
      expect(gravado.password).toMatch(/^sem-senha:/);
      expect(JSON.stringify(resposta)).not.toContain(gravado.password);
      expect(JSON.stringify(resposta)).not.toContain(SENHA);

      // Nem o ADMIN define senha em Usuários: o campo não existe mais.
      entrarComo("ADMIN");
      expect((await usuario.PATCH(req("PATCH", { password: "outra-senha-456" }), ctx(gravado.id))).status).toBe(400);
      const depois = await prisma.user.findUniqueOrThrow({ where: { id: gravado.id } });
      expect(depois.password).toBe(gravado.password);
    });

    it("falha ao criar o Driver não deixa User órfão", async () => {
      entrarComo("OPERATION");
      const emails = [`${PREFIXO}mesmo-cpf-a@exemplo.br`, `${PREFIXO}mesmo-cpf-b@exemplo.br`];

      // Dois cadastros simultâneos do mesmo CPF com e-mails diferentes: os dois
      // passam pela conferência de duplicado (nenhum gravou ainda) e criam o
      // User; o índice único do CPF recusa o segundo Driver. Sem a transação,
      // o User do perdedor ficaria no banco.
      const respostas = await Promise.all(emails.map((email) => motoristas.POST(req("POST", corpo(CPF_FALHA, email)))));

      expect(respostas.map((res) => res.status).sort()).toEqual([201, 409]);
      expect(await prisma.driver.count({ where: { cpf: CPF_FALHA } })).toBe(1);
      expect(await prisma.user.count({ where: { email: { in: emails } } })).toBe(1);

      // O e-mail do perdedor continua livre para um cadastro novo.
      const vencedor = await prisma.user.findFirstOrThrow({ where: { email: { in: emails } } });
      const livre = emails.find((email) => email !== vencedor.email)!;
      await prisma.driver.deleteMany({ where: { cpf: CPF_FALHA } });
      await prisma.user.delete({ where: { id: vencedor.id } });
      const depois = await motoristas.POST(req("POST", corpo(CPF_FALHA, livre)));
      expect(depois.status).toBe(201);
    });
  });

  describe("receita no painel", () => {
    beforeAll(async () => {
      await prisma.financialTransaction.create({
        data: { type: "INCOME", status: "PAID", amount: 1234.5, description: DESCRICAO_RECEITA },
      });
    });

    it("OPERATION recebe os contadores, sem o campo receita", async () => {
      entrarComo("OPERATION");
      const res = await dashboard.GET();
      expect(res.status).toBe(200);
      const corpo = await res.json();
      expect(corpo).not.toHaveProperty("receita");
      expect(Object.keys(corpo).sort()).toEqual(["clientes", "coletas", "detalhe", "entregasDaSemana", "manifestos", "veiculos"]);
    });

    it("ADMIN continua recebendo a receita", async () => {
      entrarComo("ADMIN");
      const corpo = await (await dashboard.GET()).json();
      expect(corpo.receita).toBeGreaterThanOrEqual(1234.5);
    });

    it("tela: a resposta da API decide quem vê o cartão Receita", async () => {
      entrarComo("ADMIN");
      const admin = await painel.loadStats(() => dashboard.GET());
      expect(admin.status).toBe("ready");
      expect(painel.showFinance(admin, "ADMIN")).toBe(true);

      // Perfil da sessão desatualizado (rebaixado depois do login): vale a API.
      entrarComo("OPERATION");
      const operacao = await painel.loadStats(() => dashboard.GET());
      expect(operacao.status).toBe("ready");
      expect(painel.showFinance(operacao, "ADMIN")).toBe(false);
    });

    const redeFora = new TypeError("fetch failed");

    // `cause` é o que a tela registra no console: o status HTTP ou a exceção.
    it.each([
      ["resposta 500", async () => new Response("{}", { status: 500 }), { status: "error", cause: "HTTP 500" }],
      ["perfil sem acesso (403)", async () => new Response("{}", { status: 403 }), { status: "error", cause: "HTTP 403" }],
      ["sessão caída (401)", async () => { sessao.mockResolvedValue(null); return dashboard.GET(); }, { status: "expired", cause: "HTTP 401" }],
      ["rede fora", async () => { throw redeFora; }, { status: "error", cause: redeFora }],
    ] as const)("tela: com %s o ADMIN vê o cartão em estado de erro, não some", async (_caso, chamada, esperado) => {
      const estado = await painel.loadStats(chamada);
      expect(estado).toEqual(esperado);
      expect(painel.showFinance(estado, "ADMIN")).toBe(true);
      expect(painel.showFinance(estado, "OPERATION")).toBe(false);
      expect(painel.showFinance(estado, undefined)).toBe(false);
    });

    it("tela: sessão caída pede novo login, não \"Tentar de novo\"", async () => {
      sessao.mockResolvedValue(null);
      const res = await dashboard.GET();
      expect(res.status).toBe(401);
      expect((await painel.loadStats(async () => res)).status).toBe("expired");

      // Só o 401 é sessão caída: os demais erros seguem com "Tentar de novo".
      for (const status of [400, 403, 404, 500, 503]) {
        const estado = await painel.loadStats(async () => new Response("{}", { status }));
        expect(estado, `HTTP ${status}`).toEqual({ status: "error", cause: `HTTP ${status}` });
      }
    });

    it("tela: enquanto carrega, o ADMIN já vê o cartão", () => {
      expect(painel.showFinance({ status: "loading" }, "ADMIN")).toBe(true);
      expect(painel.showFinance({ status: "loading" }, "OPERATION")).toBe(false);
    });
  });

  describe("tela do financeiro", () => {
    it("OPERATION → aviso de acesso restrito, não lista vazia", async () => {
      entrarComo("OPERATION");
      expect(await tela.loadTransactions(() => financeiro.GET())).toEqual({ denied: "forbidden" });
    });

    it("sem sessão → pede novo login, não diz que o perfil é restrito", async () => {
      sessao.mockResolvedValue(null);
      expect(await tela.loadTransactions(() => financeiro.GET())).toEqual({ denied: "login" });
    });

    it("ADMIN → lançamentos", async () => {
      entrarComo("ADMIN");
      const resultado = await tela.loadTransactions(() => financeiro.GET());
      expect(resultado.denied).toBeNull();
      expect(JSON.stringify(resultado)).toContain(DESCRICAO_RECEITA);
    });

    it("erro do servidor não vira acesso negado", async () => {
      const resultado = await tela.loadTransactions(async () => new Response("{}", { status: 500 }));
      expect(resultado).toEqual({ denied: null, transactions: [] });
    });
  });

  describe("trava do último ADMIN em concorrência", () => {
    it("dois ADMIN rebaixando um ao outro ao mesmo tempo: só um passa e sobra um ADMIN", async () => {
      const a = await criarUsuario(`${PREFIXO}corrida-a@exemplo.br`, "OPERATION");
      const b = await criarUsuario(`${PREFIXO}corrida-b@exemplo.br`, "OPERATION");
      const dupla = { id: { in: [a.id, b.id] } };

      // A contagem da trava é do banco inteiro: durante a corrida, A e B têm
      // de ser os únicos ADMIN. O ADMIN da suite sai e volta no fim.
      await prisma.user.update({ where: { id: ids.ADMIN }, data: { role: "OPERATION" } });
      try {
        expect(await prisma.user.count({ where: { role: "ADMIN" } }), "banco de teste com ADMIN alheio").toBe(0);

        for (let rodada = 0; rodada < 8; rodada++) {
          await prisma.user.updateMany({ where: dupla, data: { role: "ADMIN" } });

          // Cada PATCH lê a sessão antes do primeiro `await` de banco: a 1ª chamada é A, a 2ª é B.
          sessao.mockReset();
          sessao.mockResolvedValueOnce(sessaoDe(a.id)).mockResolvedValueOnce(sessaoDe(b.id));

          // A conferência de perfil (`requireStaff`) lê o banco fora da transação
          // da rota. Soltos, os dois PATCH às vezes nem se cruzam: um grava antes
          // de o outro conferir o perfil, e o segundo sai com 403 (já não é ADMIN)
          // sem chegar à trava. Para a corrida acontecer sempre, o teste segura as
          // linhas de A e B até os dois estarem parados na trava da rota, já com o
          // perfil conferido, e só então solta.
          const respostas = await sistema.$transaction(
            async (tx) => {
              await tx.$queryRaw`SELECT id FROM "User" WHERE id IN (${a.id}, ${b.id}) FOR UPDATE`;

              const chamadas = [
                usuario.PATCH(req("PATCH", { role: "OPERATION" }), ctx(b.id)),
                usuario.PATCH(req("PATCH", { role: "OPERATION" }), ctx(a.id)),
              ];

              await vi.waitFor(
                async () => {
                  // `pg_locks` e não `pg_stat_activity`: este fica congelado dentro da transação.
                  const [{ parados }] = await tx.$queryRaw<{ parados: number }[]>`
                    SELECT count(DISTINCT pid)::int AS parados FROM pg_locks WHERE NOT granted`;
                  expect(parados, "PATCH parados na trava").toBe(2);
                },
                { timeout: 4000, interval: 20 },
              );

              return chamadas;
            },
            { timeout: 15000 },
          ).then((chamadas) => Promise.all(chamadas));

          // Quem perde a corrida já foi rebaixado quando a trava solta: a rota
          // relê o perfil do autor dentro da transação e responde 403.
          expect(respostas.map((r) => r.status).sort(), `rodada ${rodada}`).toEqual([200, 403]);
          expect(await prisma.user.count({ where: { role: "ADMIN" } }), `rodada ${rodada}`).toBe(1);
        }
      } finally {
        await prisma.user.updateMany({ where: dupla, data: { role: "OPERATION" } });
        await prisma.user.update({ where: { id: ids.ADMIN }, data: { role: "ADMIN" } });
      }
    });

    it("autor rebaixado enquanto esperava a trava: 403, e o alvo continua ADMIN", async () => {
      // Três ADMIN: o da suite, B (o autor) e C (o alvo). Sobra ADMIN de qualquer
      // jeito, então a trava do último ADMIN não barra nada aqui: quem tem de
      // barrar é a conferência do perfil do autor dentro da transação.
      const b = await criarUsuario(`${PREFIXO}autor-b@exemplo.br`, "ADMIN");
      const c = await criarUsuario(`${PREFIXO}alvo-c@exemplo.br`, "ADMIN");
      try {
        sessao.mockResolvedValue(sessaoDe(b.id));

        // O teste segura as linhas de ADMIN até o PATCH de B estar parado na
        // trava da rota, já com o perfil conferido por `requireStaff`. Com ele
        // parado, B é rebaixado (o que outro administrador faria), e só então
        // a trava solta.
        const resposta = await sistema.$transaction(
          async (tx) => {
            await tx.$queryRaw`SELECT id FROM "User" WHERE id IN (${b.id}, ${c.id}) FOR UPDATE`;

            const chamada = usuario.PATCH(req("PATCH", { role: "OPERATION" }), ctx(c.id));

            await vi.waitFor(
              async () => {
                // Sem filtro por banco: quem espera linha travada aparece em
                // `pg_locks` como espera de `transactionid`, que não tem banco.
                const [{ parados }] = await tx.$queryRaw<{ parados: number }[]>`
                  SELECT count(DISTINCT pid)::int AS parados FROM pg_locks WHERE NOT granted`;
                expect(parados, "PATCH parado na trava").toBe(1);
              },
              { timeout: 4000, interval: 20 },
            );

            await tx.user.update({ where: { id: b.id }, data: { role: "OPERATION" } });
            // Dentro de uma lista: devolver a promessa solta faria a transação
            // esperar o PATCH, que espera a transação.
            return [chamada];
          },
          { timeout: 15000 },
        ).then(([chamada]) => chamada);

        expect(resposta.status).toBe(403);
        expect(await resposta.json()).toEqual({ error: "Acesso negado" });
        expect((await prisma.user.findUniqueOrThrow({ where: { id: c.id } })).role).toBe("ADMIN");
        expect((await prisma.user.findUniqueOrThrow({ where: { id: b.id } })).role).toBe("OPERATION");

        // Já rebaixado, sem corrida nenhuma: trocar só o nome também é recusado.
        const soNome = await usuario.PATCH(req("PATCH", { name: "Nome trocado por ex-admin" }), ctx(c.id));
        expect(soNome.status).toBe(403);
      } finally {
        await prisma.user.updateMany({ where: { id: { in: [b.id, c.id] } }, data: { role: "OPERATION" } });
      }
    });

    it("troca só de nome também espera a trava: autor rebaixado nesse meio-tempo leva 403 e o nome não muda", async () => {
      // B (autor) troca o nome de C. Enquanto isso, outro administrador rebaixa B.
      // Sem a trava na troca de nome, a rota relia o perfil de B antes do
      // rebaixamento valer e gravava o nome com um autor que já não era ADMIN.
      const b = await criarUsuario(`${PREFIXO}nome-autor-b@exemplo.br`, "ADMIN");
      const c = await criarUsuario(`${PREFIXO}nome-alvo-c@exemplo.br`, "OPERATION");
      const NOME_ANTES = c.name;
      try {
        sessao.mockResolvedValue(sessaoDe(b.id));

        const resposta = await sistema.$transaction(
          async (tx) => {
            // Só a linha de B fica presa: C é OPERATION e está livre, então quem
            // parar aqui parou na trava das linhas de ADMIN, não no `update` do alvo.
            await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${b.id} FOR UPDATE`;

            const chamada = usuario.PATCH(req("PATCH", { name: "Nome trocado por ex-admin" }), ctx(c.id));

            await vi.waitFor(
              async () => {
                const [{ parados }] = await tx.$queryRaw<{ parados: number }[]>`
                  SELECT count(DISTINCT pid)::int AS parados FROM pg_locks WHERE NOT granted`;
                expect(parados, "PATCH de nome parado na trava").toBe(1);
              },
              { timeout: 4000, interval: 20 },
            );

            await tx.user.update({ where: { id: b.id }, data: { role: "OPERATION" } });
            return [chamada];
          },
          { timeout: 15000 },
        ).then(([chamada]) => chamada);

        expect(resposta.status).toBe(403);
        expect(await resposta.json()).toEqual({ error: "Acesso negado" });
        expect((await prisma.user.findUniqueOrThrow({ where: { id: c.id } })).name).toBe(NOME_ANTES);
      } finally {
        await prisma.user.updateMany({ where: { id: { in: [b.id, c.id] } }, data: { role: "OPERATION" } });
      }
    });

    it("administrador em dia troca o nome de outro usuário normalmente, e de dois ao mesmo tempo", async () => {
      const c = await criarUsuario(`${PREFIXO}nome-livre-c@exemplo.br`, "OPERATION");
      const d = await criarUsuario(`${PREFIXO}nome-livre-d@exemplo.br`, "OPERATION");
      entrarComo("ADMIN");

      // Duas trocas de nome juntas pegam a mesma trava, uma depois da outra: nenhuma falha.
      const respostas = await Promise.all([
        usuario.PATCH(req("PATCH", { name: "Nome novo de C" }), ctx(c.id)),
        usuario.PATCH(req("PATCH", { name: "Nome novo de D" }), ctx(d.id)),
      ]);
      expect(respostas.map((r) => r.status)).toEqual([200, 200]);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: c.id } })).name).toBe("Nome novo de C");
      expect((await prisma.user.findUniqueOrThrow({ where: { id: d.id } })).name).toBe("Nome novo de D");
      expect((await prisma.user.findUniqueOrThrow({ where: { id: ids.ADMIN } })).role).toBe("ADMIN");
    });
  });
});
