import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getServerSession } from "next-auth";
import {
  comprimentoKm,
  distanciaKm,
  indiceDeCidades,
  localizarCidade,
  nomeDaCidade,
  roteiroDaViagem,
  roteiroSchema,
  sugerirRoteiro,
  textoMaisComum,
  ufDoTexto,
  type Cidade,
  type ParadaDoRoteiro,
} from "../src/lib/roteiro";
import { municipios } from "../src/lib/municipios";
import { EMPRESA_OUTRA } from "./empresas-de-teste";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

/** A roteirização por cidade, sem banco: a tabela dos municípios é a do repositório. */
describe("roteirização por cidade", () => {
  const indice = municipios();
  const achar = (texto: string, uf: string | null = null) => {
    const cidade = localizarCidade(texto, indice, uf);
    return cidade ? nomeDaCidade(cidade) : null;
  };
  const cidade = (texto: string): Cidade => {
    const achada = localizarCidade(texto, indice);
    if (!achada) throw new Error(`Cidade de teste não achada: ${texto}`);
    return achada;
  };

  describe("tabela dos municípios", () => {
    it("tem os municípios do Brasil inteiro, nas 27 UFs, com coordenada dentro do país", () => {
      const todas = new Set<Cidade>();
      for (const lista of indice.values()) for (const c of lista) todas.add(c);
      expect(todas.size).toBeGreaterThanOrEqual(5565);
      expect(todas.size).toBeLessThanOrEqual(5580);
      expect(new Set([...todas].map((c) => c.uf)).size).toBe(27);
      for (const c of todas) {
        expect(c.lat, c.nome).toBeGreaterThan(-34.5);
        expect(c.lat, c.nome).toBeLessThan(6);
        expect(c.lon, c.nome).toBeGreaterThan(-74.5);
        expect(c.lon, c.nome).toBeLessThan(-32);
      }
    });
  });

  describe("achar a cidade pelo texto do destino", () => {
    it("aceita UF com hífen, barra, parênteses, vírgula ou espaço, com e sem acento, em qualquer caixa", () => {
      for (const texto of ["Mirassol - SP", "Mirassol/SP", "mirassol (sp)", "MIRASSOL, SP", "Mirassol SP", "  Mirassol  ", "Mirassol-SP"]) {
        expect(achar(texto), texto).toBe("Mirassol/SP");
      }
      for (const texto of ["São José do Rio Preto", "sao jose do rio preto", "SAO JOSE DO RIO PRETO - SP", "São José do Rio Preto/SP"]) {
        expect(achar(texto), texto).toBe("São José do Rio Preto/SP");
      }
      expect(achar("Santa Bárbara d'Oeste")).toBe("Santa Bárbara d'Oeste/SP");
      expect(achar("Santa Barbara D´Oeste - SP")).toBe("Santa Bárbara d'Oeste/SP");
      expect(ufDoTexto("Mirassol - SP")).toBe("SP");
      expect(ufDoTexto("Mirassol")).toBeNull();
      // "lá" não é UF: o nome com hífen não perde o fim.
      expect(ufDoTexto("Xangri-lá")).toBeNull();
      expect(achar("Xangri-lá")).toBe("Xangri-lá/RS");
      expect(achar("Xangri-lá - RS")).toBe("Xangri-lá/RS");
      // Nome que termina em palavra igual a uma sigla ("Sé" ~ SE) continua sendo o nome inteiro.
      expect(achar("Sento Sé")).toBe("Sento Sé/BA");
      expect(achar("Sento Sé - BA")).toBe("Sento Sé/BA");
    });

    it("acha a cidade no fim de um endereço", () => {
      expect(achar("Rua Bahia, 100, Centro, Mirassol - SP")).toBe("Mirassol/SP");
      expect(achar("Av. Brasil, 500 - Centro, São José do Rio Preto - SP, 15010-000")).toBe("São José do Rio Preto/SP");
      expect(achar("Rua das Flores, 12, Votuporanga, SP")).toBe("Votuporanga/SP");
    });

    it("homônimos: a UF escrita manda; sem UF vale a preferida; sem nenhuma, fica sem localização", () => {
      // "Bom Jesus" existe em cinco estados (PB, PI, RN, RS e SC).
      expect(achar("Bom Jesus - RS")).toBe("Bom Jesus/RS");
      expect(achar("Bom Jesus/PI")).toBe("Bom Jesus/PI");
      expect(achar("Bom Jesus")).toBeNull();
      expect(achar("Bom Jesus", "SC")).toBe("Bom Jesus/SC");
      // A preferida não tem cidade com esse nome: continua ambíguo.
      expect(achar("Bom Jesus", "SP")).toBeNull();
      // UF escrita que não tem a cidade não cai em outra UF, nem com preferida.
      expect(achar("Bom Jesus - SP", "RS")).toBeNull();
      expect(achar("Mirassol - RJ")).toBeNull();
    });

    it("texto vazio, que não é cidade ou com sigla inventada não é localizado", () => {
      for (const texto of ["", "   ", "Depósito central", "Cidade Que Não Existe - SP", "Mirassol - XX", "12345"]) {
        expect(achar(texto), texto).toBeNull();
      }
      expect(localizarCidade(null, indice)).toBeNull();
      expect(localizarCidade(undefined, indice)).toBeNull();
    });

    it("a origem mais comum conta pela cidade, não pela grafia", () => {
      expect(textoMaisComum(["Mirassol - SP", "Votuporanga - SP", "MIRASSOL/SP"])).toBe("Mirassol - SP");
      expect(textoMaisComum(["Votuporanga - SP", "Mirassol - SP"])).toBe("Votuporanga - SP");
      expect(textoMaisComum([])).toBeNull();
      expect(textoMaisComum(["", null, undefined])).toBeNull();
    });
  });

  describe("distância em linha reta", () => {
    it("bate com distâncias conhecidas entre cidades, com 2% de tolerância", () => {
      const conhecidas: [string, string, number][] = [
        ["São José do Rio Preto", "São Paulo", 415],
        ["São Paulo", "Rio de Janeiro - RJ", 358],
        ["São Paulo", "Brasília", 873],
        ["São José do Rio Preto", "Mirassol", 15],
      ];
      for (const [de, para, km] of conhecidas) {
        const medido = distanciaKm(cidade(de), cidade(para));
        expect(Math.abs(medido - km) / km, `${de} → ${para}: ${medido.toFixed(1)} km`).toBeLessThanOrEqual(0.02);
      }
    });

    it("é zero para o mesmo ponto, simétrica, e o caminho soma os trechos", () => {
      const a = cidade("Mirassol");
      const b = cidade("Votuporanga");
      const c = cidade("Catanduva");
      expect(distanciaKm(a, a)).toBe(0);
      expect(distanciaKm(a, b)).toBeCloseTo(distanciaKm(b, a), 9);
      expect(comprimentoKm([b, c], a, a)).toBeCloseTo(distanciaKm(a, b) + distanciaKm(b, c) + distanciaKm(c, a), 9);
      expect(comprimentoKm([b, c], a, null)).toBeCloseTo(distanciaKm(a, b) + distanciaKm(b, c), 9);
      expect(comprimentoKm([b, c], null, null)).toBeCloseTo(distanciaKm(b, c), 9);
      expect(comprimentoKm([], a, a)).toBe(0);
    });
  });

  describe("ordem sugerida", () => {
    const origem = cidade("São José do Rio Preto");
    const parada = (id: string, texto: string | null, feita = false): ParadaDoRoteiro => ({ id, cidade: texto ? cidade(texto) : null, feita });
    const comprimento = (paradas: ParadaDoRoteiro[], ordem: string[], voltar = true) =>
      comprimentoKm(
        ordem.flatMap((id) => paradas.find((p) => p.id === id)?.cidade ?? []),
        origem,
        voltar ? origem : null,
      );

    it("desfaz o vai e volta de uma ordem ingênua e informa a distância antes e depois", () => {
      // Oeste, leste, oeste, leste: a ordem digitada cruza Rio Preto três vezes.
      const paradas = [parada("vot", "Votuporanga"), parada("cat", "Catanduva"), parada("fer", "Fernandópolis"), parada("ara", "Araraquara"), parada("mir", "Mirassol")];
      const atual = paradas.map((p) => p.id);
      const roteiro = sugerirRoteiro(paradas, { origem });

      expect(roteiro.mudou).toBe(true);
      expect([...roteiro.ordem].sort()).toEqual([...atual].sort());
      expect(roteiro.distanciaAntesKm).toBeCloseTo(comprimento(paradas, atual), 1);
      expect(roteiro.distanciaDepoisKm).toBeCloseTo(comprimento(paradas, roteiro.ordem), 1);
      expect(roteiro.distanciaDepoisKm).toBeLessThan(roteiro.distanciaAntesKm * 0.7);
      expect(roteiro.naoLocalizadas).toEqual([]);

      // As do oeste ficam juntas e as do leste também, em qualquer dos dois sentidos do laço.
      const posicao = (id: string) => roteiro.ordem.indexOf(id);
      const oeste = ["mir", "vot", "fer"].map(posicao).sort((a, b) => a - b);
      const leste = ["cat", "ara"].map(posicao).sort((a, b) => a - b);
      expect(oeste[2] - oeste[0]).toBe(2);
      expect(leste[1] - leste[0]).toBe(1);
    });

    it("nunca piora: em vários casos montados, a sugerida é menor ou igual à ordem recebida", () => {
      const cidades = ["Votuporanga", "Catanduva", "Fernandópolis", "Araraquara", "Mirassol", "Jales", "Barretos", "Olímpia", "Novo Horizonte - SP", "Lins", "Birigui", "Bauru"];
      // Embaralhamento determinístico (gerador congruente): o mesmo caso toda vez.
      let semente = 12345;
      const sorteio = () => (semente = (semente * 1103515245 + 12345) % 2147483648) / 2147483648;
      for (let caso = 0; caso < 25; caso += 1) {
        const quantas = 2 + Math.floor(sorteio() * (cidades.length - 1));
        const escolhidas = [...cidades].sort(() => sorteio() - 0.5).slice(0, quantas);
        const paradas = escolhidas.map((nome, i) => parada(`c${i}`, nome));
        for (const voltar of [true, false]) {
          const roteiro = sugerirRoteiro(paradas, { origem, voltar });
          const antes = comprimento(paradas, paradas.map((p) => p.id), voltar);
          const depois = comprimento(paradas, roteiro.ordem, voltar);
          expect(depois, `caso ${caso} (${escolhidas.join(", ")})`).toBeLessThanOrEqual(antes + 1e-6);
          expect([...roteiro.ordem].sort()).toEqual(paradas.map((p) => p.id).sort());
          if (!roteiro.mudou) expect(roteiro.ordem).toEqual(paradas.map((p) => p.id));
        }
      }
    });

    it("ordem que já é a melhor volta como está, com `mudou` falso", () => {
      const paradas = [parada("mir", "Mirassol"), parada("vot", "Votuporanga"), parada("fer", "Fernandópolis")];
      const roteiro = sugerirRoteiro(paradas, { origem, voltar: false });
      expect(roteiro.mudou).toBe(false);
      expect(roteiro.ordem).toEqual(["mir", "vot", "fer"]);
      expect(roteiro.distanciaDepoisKm).toBe(roteiro.distanciaAntesKm);
    });

    it("entregas na mesma cidade ficam juntas, na ordem em que estavam entre si", () => {
      const paradas = [parada("vot1", "Votuporanga"), parada("cat", "Catanduva"), parada("vot2", "Votuporanga - SP"), parada("mir", "Mirassol"), parada("vot3", "VOTUPORANGA")];
      const { ordem } = sugerirRoteiro(paradas, { origem });
      const inicio = ordem.indexOf("vot1");
      expect(ordem.slice(inicio, inicio + 3)).toEqual(["vot1", "vot2", "vot3"]);
    });

    it("carga sem localização vai para o fim, na ordem atual, e é devolvida à parte", () => {
      const paradas = [parada("x1", null), parada("fer", "Fernandópolis"), parada("x2", null), parada("cat", "Catanduva"), parada("mir", "Mirassol"), parada("ara", "Araraquara")];
      const roteiro = sugerirRoteiro(paradas, { origem });
      expect(roteiro.mudou).toBe(true);
      expect(roteiro.ordem.slice(-2)).toEqual(["x1", "x2"]);
      expect(roteiro.naoLocalizadas).toEqual(["x1", "x2"]);
      // A distância conta só o que foi localizado.
      expect(roteiro.distanciaAntesKm).toBeCloseTo(comprimento(paradas, ["fer", "cat", "mir", "ara"]), 1);
    });

    it("viagem de uma carga só, sem carga e só com cargas sem localização: nada a mudar", () => {
      const uma = sugerirRoteiro([parada("mir", "Mirassol")], { origem });
      expect(uma).toMatchObject({ ordem: ["mir"], mudou: false, naoLocalizadas: [] });
      expect(uma.distanciaAntesKm).toBeCloseTo(2 * distanciaKm(origem, cidade("Mirassol")), 1);
      expect(sugerirRoteiro([parada("mir", "Mirassol")], { origem, voltar: false }).distanciaAntesKm).toBeCloseTo(distanciaKm(origem, cidade("Mirassol")), 1);

      expect(sugerirRoteiro([], { origem })).toEqual({ ordem: [], distanciaAntesKm: 0, distanciaDepoisKm: 0, naoLocalizadas: [], mudou: false });
      expect(sugerirRoteiro([parada("a", null), parada("b", null)], { origem })).toEqual({
        ordem: ["a", "b"],
        distanciaAntesKm: 0,
        distanciaDepoisKm: 0,
        naoLocalizadas: ["a", "b"],
        mudou: false,
      });
    });

    it("a volta à origem muda a conta: sem ela a distância é menor e não inclui o retorno", () => {
      const paradas = [parada("fer", "Fernandópolis"), parada("mir", "Mirassol"), parada("vot", "Votuporanga")];
      const comVolta = sugerirRoteiro(paradas, { origem });
      const semVolta = sugerirRoteiro(paradas, { origem, voltar: false });
      expect(semVolta.ordem).toEqual(["mir", "vot", "fer"]);
      expect(semVolta.distanciaDepoisKm).toBeLessThan(comVolta.distanciaDepoisKm);
      expect(comVolta.distanciaDepoisKm).toBeCloseTo(comprimento(paradas, comVolta.ordem, true), 1);
    });

    it("sem origem, a primeira entrega da ordem atual fica onde está", () => {
      const paradas = [parada("cat", "Catanduva"), parada("fer", "Fernandópolis"), parada("ara", "Araraquara"), parada("vot", "Votuporanga")];
      const roteiro = sugerirRoteiro(paradas, { origem: null });
      expect(roteiro.ordem[0]).toBe("cat");
      expect(roteiro.mudou).toBe(true);
      expect(roteiro.distanciaDepoisKm).toBeLessThan(roteiro.distanciaAntesKm);
    });

    it("entrega já feita não muda de lugar, e o caminho parte da última feita", () => {
      const paradas = [parada("ara", "Araraquara", true), parada("fer", "Fernandópolis"), parada("cat", "Catanduva"), parada("vot", "Votuporanga")];
      const roteiro = sugerirRoteiro(paradas, { origem, partida: cidade("Araraquara") });
      // De Araraquara: Catanduva no caminho, depois o oeste, fechando em Rio Preto pelo lado mais perto.
      expect(roteiro.ordem).toEqual(["ara", "cat", "fer", "vot"]);
      expect(sugerirRoteiro(paradas, { origem, partida: cidade("Araraquara"), voltar: false }).ordem).toEqual(["ara", "cat", "vot", "fer"]);
    });
  });

  describe("roteiro da viagem (cargas como vêm do banco)", () => {
    const carga = (id: string, destination: string, extra: Partial<{ origin: string; status: string }> = {}) => ({
      id,
      origin: "São José do Rio Preto - SP",
      destination,
      status: "ROUTE",
      ...extra,
    });

    it("usa a origem mais comum, acha cada cidade e devolve o nome achado de cada carga", () => {
      const roteiro = roteiroDaViagem(
        [carga("a", "Votuporanga - SP"), carga("b", "Catanduva/SP"), carga("c", "FERNANDOPOLIS"), carga("d", "Lugar Nenhum - SP"), carga("e", "Mirassol", { origin: "Mirassol - SP" })],
        indice,
      );
      expect(roteiro.origem).toBe("São José do Rio Preto/SP");
      expect(roteiro.voltar).toBe(true);
      expect(roteiro.cidades).toEqual({ a: "Votuporanga/SP", b: "Catanduva/SP", c: "Fernandópolis/SP", d: null, e: "Mirassol/SP" });
      expect(roteiro.naoLocalizadas).toEqual(["d"]);
      expect(roteiro.ordem[roteiro.ordem.length - 1]).toBe("d");
      expect(roteiro.mudou).toBe(true);
    });

    it("homônimo sem UF no destino é procurado na UF da origem", () => {
      // "Planalto" existe em BA, PR, RS e SP.
      expect(roteiroDaViagem([carga("a", "Planalto")], indice).cidades.a).toBe("Planalto/SP");
      expect(roteiroDaViagem([carga("a", "Planalto", { origin: "Passo Fundo - RS" })], indice).cidades.a).toBe("Planalto/RS");
      // Origem que não diz o estado e destino homônimo sem UF: sem localização.
      expect(roteiroDaViagem([carga("a", "Planalto", { origin: "Depósito" })], indice)).toMatchObject({ origem: null, cidades: { a: null }, naoLocalizadas: ["a"] });
      // Origem homônima sem UF: vale a UF mais escrita nas cargas.
      const roteiro = roteiroDaViagem([carga("a", "Vacaria - RS", { origin: "Bom Jesus" }), carga("b", "Lages - SC", { origin: "Bom Jesus" }), carga("c", "Caxias do Sul - RS", { origin: "Bom Jesus" })], indice);
      expect(roteiro.origem).toBe("Bom Jesus/RS");
    });

    it("carga entregue fica no começo e o resto é ordenado a partir dela", () => {
      const roteiro = roteiroDaViagem(
        [carga("ara", "Araraquara - SP", { status: "DELIVERED" }), carga("fer", "Fernandópolis - SP"), carga("cat", "Catanduva - SP"), carga("vot", "Votuporanga - SP")],
        indice,
      );
      expect(roteiro.ordem).toEqual(["ara", "cat", "fer", "vot"]);
    });

    it("o corpo da rota aceita vazio e recusa `voltar` que não é sim ou não", () => {
      expect(roteiroSchema.safeParse({}).success).toBe(true);
      expect(roteiroSchema.safeParse({ voltar: false }).success).toBe(true);
      expect(roteiroSchema.safeParse({ voltar: "sim" }).success).toBe(false);
      expect(roteiroSchema.safeParse(null).success).toBe(false);
    });
  });

  it("o índice aceita uma lista qualquer de cidades (não depende da tabela do repositório)", () => {
    const pequeno = indiceDeCidades([
      { nome: "Alfa", uf: "SP", lat: -20, lon: -49 },
      { nome: "Alfa", uf: "MG", lat: -19, lon: -44 },
      { nome: "Beta", uf: "SP", lat: -21, lon: -50 },
    ]);
    expect(localizarCidade("Beta", pequeno)?.uf).toBe("SP");
    expect(localizarCidade("Alfa", pequeno)).toBeNull();
    expect(localizarCidade("Alfa - MG", pequeno)?.lat).toBe(-19);
    expect(localizarCidade("alfa", pequeno, "SP")?.lat).toBe(-20);
  });
});

/** A rota da sugestão, contra um Postgres de verdade. */
const temBanco = Boolean(process.env.DATABASE_URL);

if (!temBanco) {
  console.warn("\n[roteiro.test] DATABASE_URL ausente: testes de integração PULADOS.\n");
}

const suite = temBanco ? describe : describe.skip;

// Tudo o que esta suite cria usa estes marcadores, e só isso é apagado.
const PREFIXO = "teste-roteiro-";
const CNPJ = "99222111000660";
const CNPJ_DA_OUTRA = "99222111000741";
const CPF_MOTORISTA = "77788899931";
const CPF_MOTORISTA_DA_OUTRA = "77788899932";
const PLACA = "RTR1A23";
const PLACA_DA_OUTRA = "RTR1A24";
const HASH_FALSO = "$2b$10$hashfalsoparateste000000000000000000000000000000000";
const SEM_ID = "00000000-0000-0000-0000-000000000000";

type Perfil = "ADMIN" | "OPERATION" | "EXPEDITION" | "FINANCE" | "CLIENT" | "DRIVER";
type Resposta = { ordem: string[]; mudou: boolean; distanciaAntesKm: number; distanciaDepoisKm: number; naoLocalizadas: string[]; origem: string | null; voltar: boolean; cidades: Record<string, string | null>; error?: string };

suite("rota da ordem sugerida", () => {
  let banco: typeof import("../src/lib/prisma");
  let roteiroRota: typeof import("../src/app/api/manifestos/[id]/roteiro/route");
  let ordemRota: typeof import("../src/app/api/manifestos/[id]/ordem/route");

  const sessao = vi.mocked(getServerSession);
  const ids = {} as Record<Perfil, string>;
  let clienteId: string;
  let motoristaId: string;
  let veiculoId: string;
  let viagemDaOutra: string;

  const entrarComo = (perfil: Perfil | null) => sessao.mockResolvedValue(perfil ? { user: { id: ids[perfil], role: perfil, clientId: null } } : null);

  const req = (method = "POST", body?: unknown) =>
    new Request("http://localhost/api/teste", {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const nome = (n: string) => `${PREFIXO}${n}`;

  const sugerir = async (viagemId: string, corpo?: unknown, perfil: Perfil | null = "OPERATION") => {
    entrarComo(perfil);
    const res = await roteiroRota.POST(req("POST", corpo), ctx(viagemId));
    return { status: res.status, corpo: (await res.json()) as Resposta };
  };

  async function limparMovimento() {
    const { sistema } = banco;
    await sistema.collection.deleteMany({ where: { client: { cnpj: { in: [CNPJ, CNPJ_DA_OUTRA] } } } });
    await sistema.manifest.deleteMany({ where: { vehicle: { plate: { in: [PLACA, PLACA_DA_OUTRA] } } } });
    await sistema.auditLog.deleteMany({ where: { userName: { startsWith: PREFIXO } } });
  }

  async function limpar() {
    const { sistema } = banco;
    await limparMovimento();
    await sistema.vehicle.deleteMany({ where: { plate: { in: [PLACA, PLACA_DA_OUTRA] } } });
    await sistema.driver.deleteMany({ where: { cpf: { in: [CPF_MOTORISTA, CPF_MOTORISTA_DA_OUTRA] } } });
    await sistema.client.deleteMany({ where: { cnpj: { in: [CNPJ, CNPJ_DA_OUTRA] } } });
    await sistema.user.deleteMany({ where: { email: { startsWith: PREFIXO } } });
  }

  const carga = (destino: string, status = "ROUTE") => ({
    clientId: clienteId,
    sender: "Remetente",
    receiver: nome("destinatário"),
    origin: "São José do Rio Preto - SP",
    destination: destino,
    volumes: 1,
    weight: 10,
    status,
  });

  /** Viagem gravada direto no banco, com as cargas na ordem recebida (sequência 1, 2, 3...). */
  async function viajar(status: string, destinos: string[]) {
    const viagem = await banco.default.manifest.create({ data: { driverId: motoristaId, vehicleId: veiculoId, status } });
    const cargaIds: string[] = [];
    for (const [posicao, destino] of destinos.entries()) {
      const criada = await banco.default.collection.create({ data: { ...carga(destino), manifestId: viagem.id, driverId: motoristaId, manifestSequence: posicao + 1 } });
      cargaIds.push(criada.id);
    }
    return { id: viagem.id, cargaIds };
  }

  const ordemGravada = async (viagemId: string) =>
    (await banco.default.collection.findMany({ where: { manifestId: viagemId }, orderBy: { manifestSequence: "asc" }, select: { id: true } })).map((c) => c.id);

  beforeAll(async () => {
    banco = await import("../src/lib/prisma");
    roteiroRota = await import("../src/app/api/manifestos/[id]/roteiro/route");
    ordemRota = await import("../src/app/api/manifestos/[id]/ordem/route");
    await limpar();

    const db = banco.default;
    for (const perfil of ["ADMIN", "OPERATION", "EXPEDITION", "FINANCE", "CLIENT", "DRIVER"] as const) {
      ids[perfil] = (await db.user.create({ data: { name: nome(perfil), email: `${PREFIXO}${perfil.toLowerCase()}@exemplo.br`, password: HASH_FALSO, role: perfil } })).id;
    }
    clienteId = (await db.client.create({ data: { companyName: nome("cliente"), cnpj: CNPJ } })).id;
    const motorista = { cnh: "77777777731", cnhExpiry: new Date("2031-06-30"), category: "C" };
    motoristaId = (await db.driver.create({ data: { ...motorista, userId: ids.DRIVER, cpf: CPF_MOTORISTA } })).id;
    veiculoId = (await db.vehicle.create({ data: { plate: PLACA, model: nome("caminhão"), type: "TRUCK" } })).id;

    // A viagem da outra empresa: as rotas desta não podem enxergá-la.
    const outra = banco.paraEmpresa(EMPRESA_OUTRA.id).db;
    const usuario = await outra.user.create({ data: { name: nome("motorista da outra"), email: `${PREFIXO}outra@exemplo.br`, password: HASH_FALSO, role: "DRIVER" } });
    const motoristaDaOutra = await outra.driver.create({ data: { ...motorista, userId: usuario.id, cpf: CPF_MOTORISTA_DA_OUTRA } });
    const veiculoDaOutra = await outra.vehicle.create({ data: { plate: PLACA_DA_OUTRA, model: nome("da outra"), type: "TRUCK" } });
    const clienteDaOutra = await outra.client.create({ data: { companyName: nome("cliente da outra"), cnpj: CNPJ_DA_OUTRA } });
    const viagem = await outra.manifest.create({ data: { driverId: motoristaDaOutra.id, vehicleId: veiculoDaOutra.id, status: "ROUTE" } });
    viagemDaOutra = viagem.id;
    for (const destino of ["Votuporanga - SP", "Catanduva - SP", "Fernandópolis - SP"]) {
      await outra.collection.create({ data: { ...carga(destino), clientId: clienteDaOutra.id, manifestId: viagem.id } });
    }
  }, 120_000);

  beforeEach(() => {
    sessao.mockReset();
  });

  afterAll(async () => {
    if (banco) await limpar();
  });

  it("só quem altera a viagem: sem sessão 401; financeiro (só lê), cliente e motorista 403; expedição passa", async () => {
    const viagem = await viajar("ASSEMBLING", ["Votuporanga - SP", "Catanduva - SP"]);
    expect((await sugerir(viagem.id, {}, null)).status).toBe(401);
    for (const perfil of ["FINANCE", "CLIENT", "DRIVER"] as const) {
      expect((await sugerir(viagem.id, {}, perfil)).status, perfil).toBe(403);
    }
    for (const perfil of ["ADMIN", "OPERATION", "EXPEDITION"] as const) {
      expect((await sugerir(viagem.id, {}, perfil)).status, perfil).toBe(200);
    }
  });

  it("devolve a ordem sugerida com as distâncias e NÃO grava: a ordem do banco continua a mesma", async () => {
    const viagem = await viajar("ASSEMBLING", ["Votuporanga - SP", "Catanduva - SP", "Fernandópolis - SP", "Araraquara - SP", "Lugar Nenhum - SP"]);
    const [vot, cat, fer, ara, semLocal] = viagem.cargaIds;

    const { status, corpo } = await sugerir(viagem.id);
    expect(status).toBe(200);
    expect(corpo.origem).toBe("São José do Rio Preto/SP");
    expect(corpo.voltar).toBe(true);
    expect(corpo.mudou).toBe(true);
    expect(corpo.distanciaDepoisKm).toBeLessThan(corpo.distanciaAntesKm);
    expect([...corpo.ordem].sort()).toEqual([...viagem.cargaIds].sort());
    expect(corpo.ordem[4]).toBe(semLocal);
    expect(corpo.naoLocalizadas).toEqual([semLocal]);
    expect(corpo.cidades).toEqual({ [vot]: "Votuporanga/SP", [cat]: "Catanduva/SP", [fer]: "Fernandópolis/SP", [ara]: "Araraquara/SP", [semLocal]: null });
    // Oeste junto e leste junto.
    expect(Math.abs(corpo.ordem.indexOf(vot) - corpo.ordem.indexOf(fer))).toBe(1);
    expect(Math.abs(corpo.ordem.indexOf(cat) - corpo.ordem.indexOf(ara))).toBe(1);

    expect(await ordemGravada(viagem.id)).toEqual(viagem.cargaIds);
    expect(await banco.sistema.auditLog.count({ where: { entityId: viagem.id } })).toBe(0);

    // Sem a volta, a conta é outra e a resposta diz qual foi.
    const semVolta = (await sugerir(viagem.id, { voltar: false })).corpo;
    expect(semVolta.voltar).toBe(false);
    expect(semVolta.distanciaDepoisKm).toBeLessThan(corpo.distanciaDepoisKm);
  });

  it("aplicar é a rota de ordem que já existe: grava a sugestão e registra na auditoria", async () => {
    const viagem = await viajar("ROUTE", ["Votuporanga - SP", "Catanduva - SP", "Fernandópolis - SP", "Araraquara - SP"]);
    const { corpo } = await sugerir(viagem.id);

    entrarComo("OPERATION");
    const res = await ordemRota.PUT(req("PUT", { collectionIds: corpo.ordem }), ctx(viagem.id));
    expect(res.status).toBe(200);
    expect(await ordemGravada(viagem.id)).toEqual(corpo.ordem);

    const trilha = await banco.sistema.auditLog.findMany({ where: { entityId: viagem.id }, select: { action: true, before: true, after: true } });
    expect(trilha).toHaveLength(1);
    expect(trilha[0]).toMatchObject({ action: "viagem.ordem", before: { ordem: viagem.cargaIds }, after: { ordem: corpo.ordem } });

    // Pedir de novo: a ordem gravada já é a sugerida.
    expect((await sugerir(viagem.id)).corpo).toMatchObject({ mudou: false, ordem: corpo.ordem });
  });

  it("vale em montagem e em rota; finalizada e cancelada respondem 409, como a ordem manual", async () => {
    for (const status of ["FINISHED", "CANCELLED"]) {
      const viagem = await viajar(status, ["Votuporanga - SP", "Catanduva - SP"]);
      const { status: http, corpo } = await sugerir(viagem.id);
      expect(http, status).toBe(409);
      expect(corpo.error).toMatch(/em montagem ou em rota/);
    }
  });

  it("corpo inválido é 400; sem corpo vale o padrão; viagem que não existe é 404", async () => {
    const viagem = await viajar("ASSEMBLING", ["Votuporanga - SP", "Catanduva - SP"]);
    expect((await sugerir(viagem.id, { voltar: "sim" })).status).toBe(400);
    expect((await sugerir(viagem.id, undefined)).corpo.voltar).toBe(true);
    expect((await sugerir(SEM_ID)).status).toBe(404);
  });

  it("viagem de uma carga só e viagem sem carga respondem sem nada a mudar", async () => {
    const uma = await viajar("ASSEMBLING", ["Mirassol - SP"]);
    expect((await sugerir(uma.id)).corpo).toMatchObject({ ordem: uma.cargaIds, mudou: false, naoLocalizadas: [] });
    const vazia = await viajar("ASSEMBLING", []);
    expect((await sugerir(vazia.id)).corpo).toMatchObject({ ordem: [], mudou: false, origem: null, distanciaAntesKm: 0 });
  });

  it("isolamento: a viagem de outra empresa responde 404, para qualquer perfil", async () => {
    for (const perfil of ["ADMIN", "OPERATION", "EXPEDITION"] as const) {
      const { status, corpo } = await sugerir(viagemDaOutra, {}, perfil);
      expect(status, perfil).toBe(404);
      expect(corpo.ordem).toBeUndefined();
    }
  });
});
