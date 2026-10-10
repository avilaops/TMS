import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getServerSession } from "next-auth";
import {
  CAMPOS_DE_ENDERECO,
  cepFormatado,
  chaveDoEndereco,
  enderecoCompleto,
  enderecoDaEntregaSchema,
  enderecoDoTexto,
  enderecoEmLinha,
  enderecoMudou,
  logradouroNormalizado,
  numeroNormalizado,
} from "../src/lib/endereco";
import { GEO_URL_PADRAO, agenteDoGeo, configuracaoDoGeo, consultaDoEndereco, localizarNoNominatim, zerarFilaDoGeo } from "../src/lib/geo";
import { MAXIMO_DE_PONTOS_NA_MATRIZ, configuracaoDaRota, distanciaPorEstrada, enderecoDaMatriz, matrizDaResposta } from "../src/lib/rota-osrm";
import {
  avisoDaDistancia,
  chaveDoPonto,
  distanciaKm,
  indiceDeCidades,
  lugaresDaViagem,
  pontoDaCarga,
  pontosDaConta,
  roteiroDaViagem,
  sugerirRoteiro,
  type Cidade,
  type Ponto,
} from "../src/lib/roteiro";
import { LIMITE_POR_MINUTO, MAXIMO_DE_PONTOS, POSICAO_INVALIDA, entraNoHistorico, haQuantoTempo, posicaoSchema, ultimaPosicao } from "../src/lib/posicao";
import { BLOCOS_PADRAO, enderecoDosBlocos, montarMapa, type CargaDoMapa, type MapaDaViagem } from "../src/lib/mapa";
import { createCollectionSchema, updateCollectionSchema } from "../src/lib/coletas";
import { criarCargaDaNotaSchema } from "../src/lib/nfe";
import { CAMPOS_DA_COLETA } from "../src/lib/auditoria";
import { EMPRESA_OUTRA, EMPRESA_PADRAO } from "./empresas-de-teste";

/**
 * Roteirização por endereço, mapa e GPS do motorista.
 *
 * Primeiro as regras, sem banco: o endereço e a chave do cache, o cliente do
 * Nominatim e o do OSRM contra um servidor HTTP local (nenhum teste fala com a
 * internet), a ordem por coordenada, a posição e o mapa. Depois as rotas e a
 * volta de localização contra um Postgres de verdade, com sessão simulada.
 */
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

const temBanco = Boolean(process.env.DATABASE_URL);
if (!temBanco) console.warn("\n[mapa.test] DATABASE_URL ausente: testes de integração PULADOS.\n");
const suite = temBanco ? describe : describe.skip;

/* ------------------------------ Servidor local ------------------------------- */

type Pedido = { url: URL; agente: string | undefined; chegou: number; saiu: number };
type Resposta = { status?: number; corpo?: unknown; texto?: string; esperaMs?: number };

/** Um servidor HTTP de mentira, na máquina: faz o papel do Nominatim e do OSRM. */
async function servidorLocal(responder: (req: IncomingMessage, url: URL) => Resposta) {
  const pedidos: Pedido[] = [];
  const servidor: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://local");
    const pedido: Pedido = { url, agente: req.headers["user-agent"], chegou: Date.now(), saiu: 0 };
    pedidos.push(pedido);
    const resposta = responder(req, url);
    setTimeout(() => {
      pedido.saiu = Date.now();
      res.writeHead(resposta.status ?? 200, { "Content-Type": "application/json" });
      res.end(resposta.texto ?? JSON.stringify(resposta.corpo ?? []));
    }, resposta.esperaMs ?? 0);
  });
  await new Promise<void>((resolve) => servidor.listen(0, "127.0.0.1", resolve));
  const porta = (servidor.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${porta}`,
    pedidos,
    fechar: () =>
      new Promise<void>((resolve) => {
        servidor.closeAllConnections();
        servidor.close(() => resolve());
      }),
  };
}

type ServidorLocal = Awaited<ReturnType<typeof servidorLocal>>;

/* --------------------------------- Endereço ---------------------------------- */

describe("endereço da entrega", () => {
  it("a chave do cache ignora acento, caixa, pontuação e abreviação do tipo de logradouro", () => {
    const chave = chaveDoEndereco({ rua: "Rua das Flores", numero: "120", cidade: "Mirassol", uf: "SP" });
    expect(chave).toBe("rua das flores 120|mirassol|sp");
    expect(chaveDoEndereco({ rua: "  R. DAS FLÔRES ", numero: " 120 ", cidade: "MIRASSOL", uf: "sp" })).toBe(chave);
    expect(chaveDoEndereco({ rua: "Av. Brasil", numero: null, cidade: "São José do Rio Preto", uf: "SP" })).toBe("avenida brasil|sao jose do rio preto|sp");
    // "S/N" é endereço sem número: a mesma pergunta de quem deixou o número em branco.
    for (const semNumero of ["S/N", "s/n", "SN", "s/nº", "", null]) {
      expect(chaveDoEndereco({ rua: "Av. Brasil", numero: semNumero, cidade: "Mirassol", uf: "SP" }), String(semNumero)).toBe("avenida brasil|mirassol|sp");
    }
    // Número diferente, cidade diferente e UF diferente são outra pergunta.
    expect(chaveDoEndereco({ rua: "Rua das Flores", numero: "121", cidade: "Mirassol", uf: "SP" })).not.toBe(chave);
    expect(chaveDoEndereco({ rua: "Rua das Flores", numero: "120", cidade: "Bálsamo", uf: "SP" })).not.toBe(chave);
    expect(chaveDoEndereco({ rua: "Rua das Flores", numero: "120", cidade: "Mirassol", uf: "MG" })).not.toBe(chave);
  });

  it("sem logradouro, cidade ou UF não há chave: não há o que perguntar", () => {
    expect(chaveDoEndereco({ rua: "", numero: "120", cidade: "Mirassol", uf: "SP" })).toBeNull();
    expect(chaveDoEndereco({ rua: " , . ", numero: "120", cidade: "Mirassol", uf: "SP" })).toBeNull();
    expect(chaveDoEndereco({ rua: "Rua A", numero: "1", cidade: "", uf: "SP" })).toBeNull();
    expect(chaveDoEndereco({ rua: "Rua A", numero: "1", cidade: "Mirassol", uf: "" })).toBeNull();
  });

  it("só a primeira palavra é tratada como tipo de logradouro", () => {
    expect(logradouroNormalizado("R. Dr. Raul Silva")).toBe("rua dr raul silva");
    expect(logradouroNormalizado("Rod. BR-153, km 60")).toBe("rodovia br 153 km 60");
    // Uma letra sozinha não é abreviação: "R" como nome inteiro fica como veio.
    expect(logradouroNormalizado("R")).toBe("r");
    expect(numeroNormalizado("120-A")).toBe("120 a");
  });

  it("lê o endereço da NF-e e o do destinatário frequente, que são um texto só", () => {
    expect(enderecoDoTexto("Av. Brasil, S/N, Loja 2, Centro, CEP 15130-000")).toEqual({
      deliveryStreet: "Av. Brasil",
      deliveryNumber: "S/N",
      deliveryDistrict: "Centro",
      deliveryZip: "15130000",
    });
    expect(enderecoDoTexto("Rua das Flores, 120 - Centro")).toEqual({ deliveryStreet: "Rua das Flores", deliveryNumber: "120", deliveryDistrict: "Centro", deliveryZip: null });
    // O formato do cadastro (o que a busca por CNPJ preenche) é lido pela mesma função do boleto.
    expect(enderecoDoTexto("Rua das Flores, 120 - Centro, Mirassol - SP, CEP 15130-000")).toEqual({ deliveryStreet: "Rua das Flores", deliveryNumber: "120", deliveryDistrict: "Centro", deliveryZip: "15130000" });
    // Cidade e UF escritas no fim não viram bairro: a carga já tem a cidade.
    expect(enderecoDoTexto("Rua das Flores, 120 - Centro, Mirassol - SP")).toEqual({ deliveryStreet: "Rua das Flores", deliveryNumber: "120", deliveryDistrict: "Centro", deliveryZip: null });
    expect(enderecoDoTexto("Rua das Flores, 120, Mirassol, SP")).toEqual({ deliveryStreet: "Rua das Flores", deliveryNumber: "120", deliveryDistrict: null, deliveryZip: null });
    expect(enderecoDoTexto("Rua das Flores, 120 - SP")).toMatchObject({ deliveryStreet: "Rua das Flores", deliveryNumber: "120", deliveryDistrict: null });
    expect(enderecoDoTexto("Rua das Flores, 120")).toMatchObject({ deliveryStreet: "Rua das Flores", deliveryNumber: "120", deliveryDistrict: null });
    // Sem vírgula nem traço, o texto inteiro é o logradouro; o CEP sai de qualquer lugar.
    expect(enderecoDoTexto("Sítio Boa Vista km 12 15130000")).toEqual({ deliveryStreet: "Sítio Boa Vista km 12", deliveryNumber: null, deliveryDistrict: null, deliveryZip: "15130000" });
    for (const vazio of [null, undefined, "", "   "]) {
      expect(enderecoDoTexto(vazio)).toEqual({ deliveryStreet: null, deliveryNumber: null, deliveryDistrict: null, deliveryZip: null });
    }
    expect(enderecoDoTexto("CEP 15130-000")).toMatchObject({ deliveryStreet: null, deliveryZip: "15130000" });
  });

  it("mostra o endereço numa linha e inteiro; sem logradouro é só a cidade, como era", () => {
    const endereco = { deliveryStreet: "Rua das Flores", deliveryNumber: "120", deliveryDistrict: "Centro", deliveryZip: "15130000" };
    expect(enderecoEmLinha(endereco)).toBe("Rua das Flores, 120 - Centro");
    expect(enderecoCompleto(endereco, "Mirassol - SP")).toBe("Rua das Flores, 120 - Centro, Mirassol - SP, 15130-000");
    expect(enderecoCompleto({ deliveryStreet: "Rua das Flores" }, "Mirassol - SP")).toBe("Rua das Flores, Mirassol - SP");
    expect(enderecoCompleto({ deliveryStreet: null, deliveryDistrict: "Centro", deliveryZip: "15130000" }, "Mirassol - SP")).toBe("Mirassol - SP");
    expect(enderecoCompleto({}, "Mirassol - SP")).toBe("Mirassol - SP");
    expect(cepFormatado("15130000")).toBe("15130-000");
    expect(cepFormatado("1513")).toBe("");
    expect(cepFormatado(null)).toBe("");
  });

  it("valida os quatro campos: tudo opcional, vazio apaga, CEP com 8 dígitos", () => {
    const ler = (corpo: unknown) => enderecoDaEntregaSchema.safeParse(corpo);
    expect(ler({}).data).toEqual({});
    expect(ler({ deliveryStreet: " Rua A ", deliveryNumber: "10", deliveryDistrict: "Centro", deliveryZip: "15.130-000" }).data).toEqual({
      deliveryStreet: "Rua A",
      deliveryNumber: "10",
      deliveryDistrict: "Centro",
      deliveryZip: "15130000",
    });
    expect(ler({ deliveryStreet: "", deliveryNumber: "  ", deliveryDistrict: "", deliveryZip: "" }).data).toEqual({ deliveryStreet: null, deliveryNumber: null, deliveryDistrict: null, deliveryZip: null });
    expect(ler({ deliveryZip: "1513" }).error?.issues[0].message).toBe("O CEP precisa ter 8 dígitos.");
    expect(ler({ deliveryZip: "151300001" }).success).toBe(false);
    expect(ler({ deliveryStreet: "x".repeat(201) }).success).toBe(false);
    expect(ler({ deliveryNumber: "x".repeat(21) }).success).toBe(false);
    expect(ler({ deliveryDistrict: 7 }).success).toBe(false);
  });

  it("os campos entram na criação e na edição da carga, na carga da NF-e e na auditoria", () => {
    const base = { clientId: "c1", sender: "A", receiver: "B", origin: "Rio Preto - SP", destination: "Mirassol - SP", volumes: "1", weight: "10" };
    expect(createCollectionSchema.parse({ ...base, deliveryStreet: "Rua A", deliveryZip: "15130-000" })).toMatchObject({ deliveryStreet: "Rua A", deliveryZip: "15130000" });
    expect(createCollectionSchema.safeParse({ ...base, deliveryZip: "abc" }).success).toBe(false);
    expect(updateCollectionSchema.parse({ deliveryNumber: "" })).toEqual({ deliveryNumber: null });
    expect(criarCargaDaNotaSchema.parse({ ...base, deliveryDistrict: "Centro" })).toMatchObject({ deliveryDistrict: "Centro" });
    for (const campo of Object.keys(CAMPOS_DE_ENDERECO)) expect(CAMPOS_DA_COLETA as readonly string[], campo).toContain(campo);
    // A coordenada não é dado que alguém altera: não vai para a trilha.
    for (const campo of ["deliveryLat", "deliveryLon", "geoSource", "geoAt"]) expect(CAMPOS_DA_COLETA as readonly string[], campo).not.toContain(campo);
  });

  it("endereço ou cidade diferente do gravado invalida a coordenada; reenviar o mesmo valor, não", () => {
    const antes = { destination: "Mirassol - SP", deliveryStreet: "Rua A", deliveryNumber: "10", deliveryDistrict: null, deliveryZip: null };
    expect(enderecoMudou(antes, {})).toBe(false);
    expect(enderecoMudou(antes, { deliveryStreet: "Rua A", deliveryNumber: "10", destination: "Mirassol - SP", deliveryDistrict: null })).toBe(false);
    expect(enderecoMudou(antes, { deliveryStreet: "Rua B" })).toBe(true);
    expect(enderecoMudou(antes, { deliveryNumber: null })).toBe(true);
    expect(enderecoMudou(antes, { destination: "Bálsamo - SP" })).toBe(true);
    expect(enderecoMudou(antes, { deliveryZip: "15130000" })).toBe(true);
  });
});

/* --------------------------------- Nominatim --------------------------------- */

describe("cliente do Nominatim", () => {
  const ENDERECO = { rua: "Rua das Flores", numero: "120", cidade: "Mirassol", uf: "SP" };
  let servidor: ServidorLocal;
  let resposta: Resposta = {};

  beforeAll(async () => {
    servidor = await servidorLocal(() => resposta);
  });
  afterAll(() => servidor.fechar());
  beforeEach(() => {
    servidor.pedidos.length = 0;
    resposta = {};
    zerarFilaDoGeo();
  });

  const configuracao = (extra: Partial<Parameters<typeof localizarNoNominatim>[1]> = {}) => ({ url: servidor.url, contato: "contato@teste.example", intervaloMs: 0, ...extra });

  it("sem GEO_CONTATO não há configuração: ninguém consulta o serviço", () => {
    expect(configuracaoDoGeo({})).toBeNull();
    expect(configuracaoDoGeo({ GEO_CONTATO: "   " })).toBeNull();
    expect(configuracaoDoGeo({ GEO_URL: "https://geo.example" })).toBeNull();
    expect(configuracaoDoGeo({ GEO_CONTATO: "ops@example.com" })).toEqual({ url: GEO_URL_PADRAO, contato: "ops@example.com" });
    expect(GEO_URL_PADRAO).toBe("https://nominatim.openstreetmap.org");
    expect(configuracaoDoGeo({ GEO_CONTATO: "ops@example.com", GEO_URL: " http://nominatim.interno:8080/// " })).toEqual({ url: "http://nominatim.interno:8080", contato: "ops@example.com" });
    // Endereço que não é http(s) desliga em vez de mandar a consulta para lugar errado.
    expect(configuracaoDoGeo({ GEO_CONTATO: "ops@example.com", GEO_URL: "ftp://geo.example" })).toBeNull();
  });

  it("a consulta é estruturada, do Brasil, sem bairro nem CEP", () => {
    const consulta = Object.fromEntries(consultaDoEndereco({ rua: "R. das Flôres", numero: "120", cidade: "Mirassol", uf: "SP" }));
    expect(consulta).toEqual({ format: "jsonv2", limit: "1", countrycodes: "br", addressdetails: "0", street: "120 rua das flores", city: "Mirassol", state: "SP", country: "Brasil" });
    expect(consultaDoEndereco({ rua: "Av. Brasil", numero: "S/N", cidade: "Mirassol", uf: "SP" }).get("street")).toBe("avenida brasil");
  });

  it("achou: devolve o ponto e se identifica com o sistema e o contato no User-Agent", async () => {
    resposta = { corpo: [{ lat: "-20.8200", lon: "-49.5100", display_name: "Rua das Flores, Mirassol" }] };
    expect(await localizarNoNominatim(ENDERECO, configuracao())).toEqual({ ok: true, ponto: { lat: -20.82, lon: -49.51 } });

    expect(servidor.pedidos).toHaveLength(1);
    const [pedido] = servidor.pedidos;
    expect(pedido.url.pathname).toBe("/search");
    expect(pedido.url.searchParams.get("street")).toBe("120 rua das flores");
    expect(pedido.url.searchParams.get("city")).toBe("Mirassol");
    expect(pedido.agente).toBe(agenteDoGeo("contato@teste.example"));
    expect(pedido.agente).toBe("TMS-Avila-Ops/1.0 (contato@teste.example)");
  });

  it("lista vazia é resposta: não achou. Coordenada fora de faixa também", async () => {
    resposta = { corpo: [] };
    expect(await localizarNoNominatim(ENDERECO, configuracao())).toEqual({ ok: true, ponto: null });
    resposta = { corpo: [{ lat: "abc", lon: "-49.5" }] };
    expect(await localizarNoNominatim(ENDERECO, configuracao())).toEqual({ ok: true, ponto: null });
    resposta = { corpo: [{ lat: "-120", lon: "-49.5" }] };
    expect(await localizarNoNominatim(ENDERECO, configuracao())).toEqual({ ok: true, ponto: null });
    // 400 é da pergunta, não do serviço: repetir não muda nada.
    resposta = { status: 400, corpo: { error: "bad" } };
    expect(await localizarNoNominatim(ENDERECO, configuracao())).toEqual({ ok: true, ponto: null });
  });

  it("erro do serviço, limite estourado, resposta que não é JSON e servidor fora não viram resposta", async () => {
    resposta = { status: 500 };
    expect(await localizarNoNominatim(ENDERECO, configuracao())).toEqual({ ok: false, erro: "Resposta 500" });
    resposta = { status: 429 };
    expect(await localizarNoNominatim(ENDERECO, configuracao())).toEqual({ ok: false, erro: "Resposta 429" });
    resposta = { texto: "<html>manutenção</html>" };
    expect(await localizarNoNominatim(ENDERECO, configuracao())).toEqual({ ok: false, erro: "Não foi possível consultar." });
    // Porta sem ninguém ouvindo.
    expect(await localizarNoNominatim(ENDERECO, configuracao({ url: "http://127.0.0.1:9" }))).toEqual({ ok: false, erro: "Não foi possível consultar." });
  });

  it("passou do tempo limite: desiste e diz", async () => {
    resposta = { corpo: [{ lat: "-20.8", lon: "-49.5" }], esperaMs: 400 };
    expect(await localizarNoNominatim(ENDERECO, configuracao({ tempoLimiteMs: 60 }))).toEqual({ ok: false, erro: "Sem resposta no tempo limite." });
  });

  it("uma consulta por vez, com o intervalo mínimo entre elas, mesmo pedidas todas juntas", async () => {
    const INTERVALO = 200;
    resposta = { corpo: [{ lat: "-20.8", lon: "-49.5" }], esperaMs: 40 };
    const respostas = await Promise.all([1, 2, 3].map((n) => localizarNoNominatim({ ...ENDERECO, numero: String(n) }, configuracao({ intervaloMs: INTERVALO }))));
    expect(respostas.every((r) => r.ok)).toBe(true);

    expect(servidor.pedidos.map((p) => p.url.searchParams.get("street"))).toEqual(["1 rua das flores", "2 rua das flores", "3 rua das flores"]);
    for (let i = 1; i < servidor.pedidos.length; i += 1) {
      // Do fim de uma consulta ao começo da seguinte (folga de 15 ms para o relógio da máquina de teste):
      // nunca duas ao mesmo tempo, e nunca antes do intervalo.
      expect(servidor.pedidos[i].chegou - servidor.pedidos[i - 1].saiu, `entre ${i} e ${i + 1}`).toBeGreaterThanOrEqual(INTERVALO - 15);
    }
  });

  it("uma consulta que falha não trava a fila", async () => {
    resposta = { status: 500 };
    expect((await localizarNoNominatim(ENDERECO, configuracao())).ok).toBe(false);
    resposta = { corpo: [{ lat: "-20.8", lon: "-49.5" }] };
    expect((await localizarNoNominatim(ENDERECO, configuracao())).ok).toBe(true);
  });
});

/* ----------------------------- Ordem por coordenada --------------------------- */

const RIO_PRETO: Cidade = { nome: "São José do Rio Preto", uf: "SP", lat: -20.8113, lon: -49.3758 };
const MIRASSOL: Cidade = { nome: "Mirassol", uf: "SP", lat: -20.8169, lon: -49.5206 };
const CATANDUVA: Cidade = { nome: "Catanduva", uf: "SP", lat: -21.1314, lon: -48.977 };
const INDICE = indiceDeCidades([RIO_PRETO, MIRASSOL, CATANDUVA]);

describe("ordem das entregas por coordenada", () => {
  // Três endereços em Rio Preto, numa reta para o leste a partir do centro.
  const PERTO = { lat: -20.8113, lon: -49.37 };
  const MEIO = { lat: -20.8113, lon: -49.34 };
  const LONGE = { lat: -20.8113, lon: -49.3 };
  const carga = (id: string, ponto: Ponto | null, extra: Record<string, unknown> = {}) => ({
    id,
    origin: "São José do Rio Preto - SP",
    destination: "São José do Rio Preto - SP",
    status: "ROUTE",
    deliveryLat: ponto?.lat ?? null,
    deliveryLon: ponto?.lon ?? null,
    ...extra,
  });

  it("duas ou mais entregas na mesma cidade, com endereço localizado, entram na ordem", () => {
    const roteiro = roteiroDaViagem([carga("longe", LONGE), carga("perto", PERTO), carga("meio", MEIO)], INDICE, { voltar: false });
    expect(roteiro.ordem).toEqual(["perto", "meio", "longe"]);
    expect(roteiro.mudou).toBe(true);
    expect(roteiro.porEndereco).toBe(3);
    expect(roteiro.medida).toBe("reta");
    expect(roteiro.naoLocalizadas).toEqual([]);
    expect(roteiro.distanciaDepoisKm).toBeLessThan(roteiro.distanciaAntesKm);
    expect(roteiro.distanciaDepoisKm).toBeCloseTo(distanciaKm(RIO_PRETO, LONGE), 1);
  });

  it("sem endereço localizado a mesma cidade segue sendo uma parada só, na ordem em que estava", () => {
    const roteiro = roteiroDaViagem([carga("a", null), carga("b", null), carga("c", null)], INDICE, { voltar: false });
    expect(roteiro).toMatchObject({ ordem: ["a", "b", "c"], mudou: false, porEndereco: 0, distanciaAntesKm: 0 });
  });

  it("mistura: quem tem endereço vai no ponto dele; quem não tem, no centro da cidade", () => {
    const cargas = [
      carga("catanduva", null, { destination: "Catanduva - SP" }),
      carga("longe", LONGE),
      carga("mirassol", null, { destination: "Mirassol - SP" }),
      carga("perto", PERTO),
    ];
    const roteiro = roteiroDaViagem(cargas, INDICE, { voltar: false });
    // Sem a volta, o melhor é sair para o lado curto (Mirassol, a oeste), voltar pelos dois endereços da cidade e terminar longe (Catanduva).
    expect(roteiro.ordem).toEqual(["mirassol", "perto", "longe", "catanduva"]);
    expect(roteiro.porEndereco).toBe(2);
    expect(roteiro.cidades).toEqual({ catanduva: "Catanduva/SP", longe: "São José do Rio Preto/SP", mirassol: "Mirassol/SP", perto: "São José do Rio Preto/SP" });
  });

  it("carga com endereço localizado entra na conta mesmo com a cidade não reconhecida", () => {
    const roteiro = roteiroDaViagem([carga("sem-cidade", MEIO, { destination: "Lugar Nenhum" }), carga("perdida", null, { destination: "Lugar Nenhum" })], INDICE);
    expect(roteiro.naoLocalizadas).toEqual(["perdida"]);
    expect(roteiro.cidades).toEqual({ "sem-cidade": null, perdida: null });
    expect(roteiro.porEndereco).toBe(1);
  });

  it("duas cargas no mesmo endereço ficam juntas", () => {
    const roteiro = roteiroDaViagem([carga("longe", LONGE), carga("perto-1", PERTO), carga("meio", MEIO), carga("perto-2", PERTO)], INDICE, { voltar: false });
    expect(roteiro.ordem).toEqual(["perto-1", "perto-2", "meio", "longe"]);
  });

  it("com a viagem na rua, o caminho parte do endereço da última entrega feita", () => {
    const cargas = [carga("feita", LONGE, { status: "DELIVERED" }), carga("perto", PERTO), carga("meio", MEIO)];
    const lugares = lugaresDaViagem(cargas, INDICE);
    expect(lugares.partida).toEqual(LONGE);
    // Saindo de LONGE, MEIO vem antes de PERTO; a entregue não muda de lugar.
    expect(roteiroDaViagem(cargas, INDICE, { voltar: false }).ordem).toEqual(["feita", "meio", "perto"]);
  });

  it("coordenada que não é coordenada não vale: a carga cai no centro da cidade", () => {
    expect(pontoDaCarga({ deliveryLat: -20.8, deliveryLon: -49.3 })).toEqual({ lat: -20.8, lon: -49.3 });
    for (const ruim of [
      { deliveryLat: null, deliveryLon: -49.3 },
      { deliveryLat: -20.8, deliveryLon: null },
      { deliveryLat: Number.NaN, deliveryLon: -49.3 },
      { deliveryLat: 91, deliveryLon: -49.3 },
      { deliveryLat: -20.8, deliveryLon: -181 },
      {},
    ]) {
      expect(pontoDaCarga(ruim)).toBeNull();
    }
  });

  it("os pontos da conta: origem, partida e as paradas a entregar, sem repetir", () => {
    const lugares = lugaresDaViagem([carga("feita", LONGE, { status: "DELIVERED" }), carga("a", PERTO), carga("b", PERTO), carga("c", null)], INDICE);
    expect(pontosDaConta(lugares).map(chaveDoPonto)).toEqual([chaveDoPonto(RIO_PRETO), chaveDoPonto(LONGE), chaveDoPonto(PERTO)]);
  });

  it("a frase da distância diz a medida; trânsito nunca entra", () => {
    expect(avisoDaDistancia("reta")).toContain("em linha reta");
    expect(avisoDaDistancia("reta")).toContain("não é o km de estrada");
    expect(avisoDaDistancia("estrada")).toContain("por estrada");
    expect(avisoDaDistancia("estrada")).toContain("sem contar trânsito");
  });
});

/* ------------------------------------ OSRM ----------------------------------- */

describe("distância por estrada (OSRM), opcional", () => {
  const A = { lat: -20.8, lon: -49.4 };
  const B = { lat: -20.8, lon: -49.3 };
  const C = { lat: -20.9, lon: -49.3 };
  let servidor: ServidorLocal;
  let resposta: Resposta = {};

  beforeAll(async () => {
    servidor = await servidorLocal(() => resposta);
  });
  afterAll(() => servidor.fechar());
  beforeEach(() => {
    servidor.pedidos.length = 0;
    resposta = {};
  });

  it("sem ROTA_URL não há servidor de rotas; o de demonstração público é recusado", () => {
    expect(configuracaoDaRota({})).toBeNull();
    expect(configuracaoDaRota({ ROTA_URL: "  " })).toBeNull();
    expect(configuracaoDaRota({ ROTA_URL: "osrm:5000" })).toBeNull();
    expect(configuracaoDaRota({ ROTA_URL: "https://router.project-osrm.org" })).toBeNull();
    expect(configuracaoDaRota({ ROTA_URL: "http://ROUTER.project-osrm.org/" })).toBeNull();
    expect(configuracaoDaRota({ ROTA_URL: "http://osrm:5000/" })).toEqual({ url: "http://osrm:5000" });
  });

  it("pede a matriz com longitude antes da latitude", () => {
    expect(enderecoDaMatriz("http://osrm:5000", [A, B])).toBe("http://osrm:5000/table/v1/driving/-49.400000,-20.800000;-49.300000,-20.800000?annotations=distance");
  });

  it("devolve a medida em km, média da ida e da volta", async () => {
    resposta = { corpo: { code: "Ok", distances: [[0, 12000, 30000], [14000, 0, 9000], [30000, 11000, 0]] } };
    const medida = await distanciaPorEstrada([A, B, C], { url: servidor.url });
    expect(medida).not.toBeNull();
    expect(medida!(A, B)).toBe(13);
    expect(medida!(B, A)).toBe(13);
    expect(medida!(B, C)).toBe(10);
    expect(medida!(A, A)).toBe(0);
    expect(servidor.pedidos).toHaveLength(1);
    expect(servidor.pedidos[0].url.pathname).toBe("/table/v1/driving/-49.400000,-20.800000;-49.300000,-20.800000;-49.300000,-20.900000");
    expect(servidor.pedidos[0].url.searchParams.get("annotations")).toBe("distance");
    // Ponto que não foi mandado cai na linha reta, para a conta nunca dar infinito.
    const fora = { lat: -21, lon: -49 };
    expect(medida!(A, fora)).toBeCloseTo(distanciaKm(A, fora), 6);
  });

  it("qualquer falha devolve null: quem chama cai para a linha reta", async () => {
    const pedir = () => distanciaPorEstrada([A, B], { url: servidor.url, tempoLimiteMs: 80 });
    resposta = { status: 500 };
    expect(await pedir()).toBeNull();
    resposta = { corpo: { code: "NoTable", distances: [[0, 1], [1, 0]] } };
    expect(await pedir()).toBeNull();
    // Par sem caminho (ilha, ponto fora da malha).
    resposta = { corpo: { code: "Ok", distances: [[0, null], [1, 0]] } };
    expect(await pedir()).toBeNull();
    // Matriz de tamanho errado.
    resposta = { corpo: { code: "Ok", distances: [[0, 1, 2], [1, 0, 2], [2, 1, 0]] } };
    expect(await pedir()).toBeNull();
    resposta = { texto: "não é json" };
    expect(await pedir()).toBeNull();
    resposta = { corpo: { code: "Ok", distances: [[0, 1], [1, 0]] }, esperaMs: 400 };
    expect(await pedir()).toBeNull();
    expect(await distanciaPorEstrada([A, B], { url: "http://127.0.0.1:9" })).toBeNull();
  });

  it("não chama o servidor sem configuração, com menos de dois pontos ou com pontos demais", async () => {
    expect(await distanciaPorEstrada([A, B], null)).toBeNull();
    expect(await distanciaPorEstrada([A], { url: servidor.url })).toBeNull();
    const muitos = Array.from({ length: MAXIMO_DE_PONTOS_NA_MATRIZ + 1 }, (_, i) => ({ lat: -20 - i / 1000, lon: -49 }));
    expect(await distanciaPorEstrada(muitos, { url: servidor.url })).toBeNull();
    expect(servidor.pedidos).toHaveLength(0);
    expect(matrizDaResposta(null, 2)).toBeNull();
    expect(matrizDaResposta({ code: "Ok", distances: [[0, -1], [1, 0]] }, 2)).toBeNull();
  });

  it("a ordem sugerida segue a estrada quando ela discorda da linha reta, e a resposta diz a medida", () => {
    // Em linha reta, B fica mais perto da origem que C; pela estrada (um rio no meio), é o contrário.
    const origem = { lat: -20.8, lon: -49.5 };
    const estrada = new Map([
      [`${chaveDoPonto(origem)}>${chaveDoPonto(B)}`, 80],
      [`${chaveDoPonto(origem)}>${chaveDoPonto(C)}`, 20],
      [`${chaveDoPonto(B)}>${chaveDoPonto(C)}`, 15],
    ]);
    const medida = (a: Ponto, b: Ponto) => estrada.get(`${chaveDoPonto(a)}>${chaveDoPonto(b)}`) ?? estrada.get(`${chaveDoPonto(b)}>${chaveDoPonto(a)}`) ?? 0;
    const paradas = [
      { id: "b", cidade: null, ponto: B },
      { id: "c", cidade: null, ponto: C },
    ];
    expect(sugerirRoteiro(paradas, { origem, voltar: false })).toMatchObject({ ordem: ["b", "c"], mudou: false });
    expect(sugerirRoteiro(paradas, { origem, voltar: false, distancia: medida })).toMatchObject({ ordem: ["c", "b"], mudou: true, distanciaAntesKm: 95, distanciaDepoisKm: 35 });

    const cargas = [
      { id: "b", origin: "X", destination: "Y", status: "ROUTE", deliveryLat: B.lat, deliveryLon: B.lon },
      { id: "c", origin: "X", destination: "Y", status: "ROUTE", deliveryLat: C.lat, deliveryLon: C.lon },
    ];
    expect(roteiroDaViagem(cargas, INDICE, { distancia: medida }).medida).toBe("estrada");
    expect(roteiroDaViagem(cargas, INDICE, { distancia: null }).medida).toBe("reta");
  });
});

/* ----------------------------------- Posição ---------------------------------- */

describe("posição do motorista", () => {
  it("aceita latitude e longitude na faixa, com a precisão opcional", () => {
    expect(posicaoSchema.parse({ lat: -20.81, lon: -49.37 })).toEqual({ lat: -20.81, lon: -49.37 });
    expect(posicaoSchema.parse({ lat: -90, lon: 180, precisao: 12.5 })).toEqual({ lat: -90, lon: 180, precisao: 12.5 });
    expect(posicaoSchema.parse({ lat: 1, lon: 1, precisao: null })).toMatchObject({ precisao: null });
  });

  it.each([
    ["latitude acima de 90", { lat: 90.01, lon: 0 }, "Latitude inválida."],
    ["latitude abaixo de -90", { lat: -91, lon: 0 }, "Latitude inválida."],
    ["longitude acima de 180", { lat: 0, lon: 180.5 }, "Longitude inválida."],
    ["longitude abaixo de -180", { lat: 0, lon: -181 }, "Longitude inválida."],
    ["latitude em texto", { lat: "-20.8", lon: -49.3 }, "Latitude inválida."],
    ["latitude NaN", { lat: Number.NaN, lon: -49.3 }, "Latitude inválida."],
    ["sem longitude", { lat: -20.8 }, "Longitude inválida."],
    ["precisão negativa", { lat: -20.8, lon: -49.3, precisao: -1 }, "Precisão inválida."],
    ["precisão absurda", { lat: -20.8, lon: -49.3, precisao: 100_001 }, "Precisão inválida."],
    ["0,0 (aparelho sem sinal)", { lat: 0, lon: 0 }, POSICAO_INVALIDA],
    ["corpo vazio", null, "Dados inválidos."],
  ])("recusa %s", (_caso, corpo, mensagem) => {
    const lido = posicaoSchema.safeParse(corpo);
    expect(lido.success).toBe(false);
    expect(lido.error?.issues[0].message).toBe(mensagem);
  });

  it("o histórico é enxuto: ponto novo só entra se andou ou se faz tempo", () => {
    const agora = new Date("2026-10-10T12:00:00.000Z");
    const ha = (segundos: number) => new Date(agora.getTime() - segundos * 1000);
    const aqui = { lat: -20.8113, lon: -49.3758 };
    expect(entraNoHistorico(null, aqui, agora)).toBe(true);
    // Parado, 30 segundos depois: não.
    expect(entraNoHistorico({ ...aqui, recordedAt: ha(30) }, aqui, agora)).toBe(false);
    // Tremor do GPS (uns 10 metros): não.
    expect(entraNoHistorico({ ...aqui, recordedAt: ha(30) }, { lat: aqui.lat + 0.00009, lon: aqui.lon }, agora)).toBe(false);
    // Andou uns 100 metros: sim.
    expect(entraNoHistorico({ ...aqui, recordedAt: ha(30) }, { lat: aqui.lat + 0.0009, lon: aqui.lon }, agora)).toBe(true);
    // Parado há cinco minutos: sim, de vez em quando o parado também deixa rastro.
    expect(entraNoHistorico({ ...aqui, recordedAt: ha(300) }, aqui, agora)).toBe(true);
    expect(MAXIMO_DE_PONTOS).toBe(500);
  });

  it("diz há quanto tempo a posição chegou", () => {
    const agora = new Date("2026-10-10T12:00:00.000Z").getTime();
    const ha = (minutos: number) => new Date(agora - minutos * 60_000);
    expect(haQuantoTempo(ha(0.5), agora)).toBe("agora");
    expect(haQuantoTempo(ha(1), agora)).toBe("há 1 min");
    expect(haQuantoTempo(ha(59), agora)).toBe("há 59 min");
    expect(haQuantoTempo(ha(60), agora)).toBe("há 1 h");
    expect(haQuantoTempo(ha(60 * 23 + 59), agora)).toBe("há 23 h");
    expect(haQuantoTempo(ha(60 * 24 * 3), agora).toString()).toBe("há 3 d");
    expect(haQuantoTempo(ha(5).toISOString(), agora)).toBe("há 5 min");
    expect(haQuantoTempo("não é data", agora)).toBe("");
  });

  it("a última posição só existe com latitude, longitude e hora", () => {
    const em = new Date("2026-10-10T12:00:00.000Z");
    expect(ultimaPosicao({ lastLat: -20.8, lastLon: -49.3, lastAccuracy: 15, lastPositionAt: em })).toEqual({ lat: -20.8, lon: -49.3, precisao: 15, em: em.toISOString() });
    expect(ultimaPosicao({ lastLat: -20.8, lastLon: -49.3, lastPositionAt: em })).toMatchObject({ precisao: null });
    expect(ultimaPosicao({ lastLat: null, lastLon: null, lastPositionAt: null })).toBeNull();
    expect(ultimaPosicao({ lastLat: -20.8, lastLon: -49.3, lastPositionAt: null })).toBeNull();
    expect(ultimaPosicao({})).toBeNull();
  });
});

/* ------------------------------------ Mapa ------------------------------------ */

describe("dados do mapa da viagem", () => {
  const carga = (id: string, extra: Partial<CargaDoMapa> = {}): CargaDoMapa => ({
    id,
    receiver: `Destinatário ${id}`,
    origin: "São José do Rio Preto - SP",
    destination: "Mirassol - SP",
    status: "ROUTE",
    deliveryStreet: null,
    deliveryNumber: null,
    deliveryDistrict: null,
    deliveryZip: null,
    deliveryLat: null,
    deliveryLon: null,
    geoSource: null,
    ...extra,
  });
  const viagem = (status: string, cargas: CargaDoMapa[]) => ({
    status,
    lastLat: -20.8,
    lastLon: -49.45,
    lastAccuracy: 20,
    lastPositionAt: new Date("2026-10-10T12:00:00.000Z"),
    collections: cargas,
  });

  it("cada parada sai numerada, com o ponto do endereço ou o centro da cidade, e diz qual", () => {
    const mapa = montarMapa(
      viagem("ROUTE", [
        carga("a", { deliveryStreet: "Rua das Flores", deliveryNumber: "120", deliveryLat: -20.82, deliveryLon: -49.51, geoSource: "ADDRESS" }),
        carga("b"),
        carga("c", { deliveryStreet: "Rua Nova", geoSource: null }),
        carga("d", { deliveryStreet: "Rua Que Não Existe", geoSource: "NONE" }),
        carga("e", { destination: "Lugar Nenhum" }),
      ]),
      INDICE,
      { localizaEndereco: true },
    );
    expect(mapa.origem).toEqual({ lat: RIO_PRETO.lat, lon: RIO_PRETO.lon, nome: "São José do Rio Preto/SP" });
    expect(mapa.paradas.map((p) => [p.id, p.numero, p.ponto?.precisao ?? null, p.aLocalizar])).toEqual([
      ["a", 1, "endereco", false],
      ["b", 2, "cidade", false],
      // Tem endereço e ainda não foi procurado: por ora no centro da cidade.
      ["c", 3, "cidade", true],
      // Procurou e não achou: centro da cidade, e não está mais na fila.
      ["d", 4, "cidade", false],
      ["e", 5, null, false],
    ]);
    expect(mapa.paradas[0]).toMatchObject({ destino: "Rua das Flores, 120, Mirassol - SP", ponto: { lat: -20.82, lon: -49.51 } });
    expect(mapa.paradas[1]).toMatchObject({ destino: "Mirassol - SP", ponto: { lat: MIRASSOL.lat, lon: MIRASSOL.lon } });
    expect(mapa.posicao).toEqual({ lat: -20.8, lon: -49.45, precisao: 20, em: "2026-10-10T12:00:00.000Z" });
  });

  it("a posição do motorista só aparece com a viagem em rota", () => {
    for (const status of ["ASSEMBLING", "FINISHED", "CANCELLED"]) {
      expect(montarMapa(viagem(status, [carga("a")]), INDICE, { localizaEndereco: true }).posicao, status).toBeNull();
    }
    expect(montarMapa({ ...viagem("ROUTE", [carga("a")]), lastLat: null, lastLon: null, lastPositionAt: null }, INDICE, { localizaEndereco: true }).posicao).toBeNull();
  });

  it("sem GEO_CONTATO nada está sendo localizado, e o mapa diz", () => {
    const mapa = montarMapa(viagem("ROUTE", [carga("c", { deliveryStreet: "Rua Nova" })]), INDICE, { localizaEndereco: false });
    expect(mapa.localizaEndereco).toBe(false);
    expect(mapa.paradas[0].aLocalizar).toBe(false);
  });

  it("os blocos do mapa vêm do OpenStreetMap, ou do endereço https da variável pública", () => {
    expect(BLOCOS_PADRAO).toBe("https://tile.openstreetmap.org/{z}/{x}/{y}.png");
    expect(enderecoDosBlocos(undefined)).toBe(BLOCOS_PADRAO);
    expect(enderecoDosBlocos("")).toBe(BLOCOS_PADRAO);
    expect(enderecoDosBlocos(" https://blocos.example/{z}/{x}/{y}.png ")).toBe("https://blocos.example/{z}/{x}/{y}.png");
    // Sem https, ou sem as três partes, vale o padrão: mapa quebrado não ajuda ninguém.
    expect(enderecoDosBlocos("http://blocos.example/{z}/{x}/{y}.png")).toBe(BLOCOS_PADRAO);
    expect(enderecoDosBlocos("https://blocos.example/{z}/{x}.png")).toBe(BLOCOS_PADRAO);
  });
});

/* ------------------------------ Rotas e banco -------------------------------- */

const PREFIXO = "teste-mapa-";
const CNPJ = "99313100000111";
const CNPJ_DA_OUTRA = "99313100000222";
const CPF_MOTORISTA = "66611122201";
const CPF_SEGUNDO = "66611122202";
const CPF_DA_OUTRA = "66611122203";
const CPFS = [CPF_MOTORISTA, CPF_SEGUNDO, CPF_DA_OUTRA];
const PLACA = "MPA1A11";
const PLACA_DA_OUTRA = "MPA2B22";
const HASH_FALSO = "$2b$10$hashfalsoparateste000000000000000000000000000000000";
const SEM_ID = "00000000-0000-0000-0000-000000000000";
const CODIGO = "7300000001";

type Perfil = "ADMIN" | "OPERATION" | "FINANCE" | "COMMERCIAL" | "CLIENT" | "DRIVER" | "DRIVER2";

/** As chaves que nunca podem sair para o rastreio público nem para o portal. */
const CHAVES_PRIVADAS = ["deliveryLat", "deliveryLon", "geoSource", "geoAt", "lastLat", "lastLon", "lastAccuracy", "lastPositionAt", "posicao", "positions", "lat", "lon", "latitude", "longitude"];

function chavesDe(valor: unknown, achadas = new Set<string>()): Set<string> {
  if (Array.isArray(valor)) for (const item of valor) chavesDe(item, achadas);
  else if (valor && typeof valor === "object") {
    for (const [chave, dentro] of Object.entries(valor)) {
      achadas.add(chave);
      chavesDe(dentro, achadas);
    }
  }
  return achadas;
}

suite("rotas de mapa, endereço e posição", () => {
  let banco: typeof import("../src/lib/prisma");
  let geoDb: typeof import("../src/lib/geo-db");
  let posicaoDb: typeof import("../src/lib/posicao-db");
  let resetRateLimit: typeof import("../src/lib/rate-limit").resetRateLimit;
  let coletas: typeof import("../src/app/api/coletas/route");
  let coleta: typeof import("../src/app/api/coletas/[id]/route");
  let mapaRota: typeof import("../src/app/api/manifestos/[id]/mapa/route");
  let roteiroRota: typeof import("../src/app/api/manifestos/[id]/roteiro/route");
  let manifestosRota: typeof import("../src/app/api/manifestos/route");
  let mapaDoMotorista: typeof import("../src/app/api/driver/manifestos/[id]/mapa/route");
  let posicaoRota: typeof import("../src/app/api/driver/manifestos/[id]/posicao/route");
  let viagensDoMotorista: typeof import("../src/app/api/driver/manifestos/route");
  let rastreio: typeof import("../src/app/api/rastreio/route");
  let portalColetas: typeof import("../src/app/api/portal/coletas/route");
  let portalColeta: typeof import("../src/app/api/portal/coletas/[id]/route");
  let portalMinutas: typeof import("../src/app/api/portal/minutas/route");

  const sessao = vi.mocked(getServerSession);
  const ids: Record<Perfil, string> = { ADMIN: "", OPERATION: "", FINANCE: "", COMMERCIAL: "", CLIENT: "", DRIVER: "", DRIVER2: "" };
  let clienteId: string;
  let motoristaId: string;
  let segundoMotoristaId: string;
  let veiculoId: string;
  const daOutra = { usuarioId: "", motoristaId: "", veiculoId: "", clienteId: "" };

  const entrarComo = (perfil: Perfil | null) =>
    sessao.mockResolvedValue(perfil ? { user: { id: ids[perfil], role: perfil === "DRIVER2" ? "DRIVER" : perfil, clientId: perfil === "CLIENT" ? clienteId : null } } : null);

  const req = (method = "GET", body?: unknown) =>
    new Request("http://localhost/api/teste", {
      method,
      headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.31" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const nome = (n: string) => `${PREFIXO}${n}`;

  async function limparMovimento() {
    const { sistema } = banco;
    await sistema.collection.deleteMany({ where: { client: { cnpj: { in: [CNPJ, CNPJ_DA_OUTRA] } } } });
    // As posições somem com a viagem (ON DELETE CASCADE).
    await sistema.manifest.deleteMany({ where: { vehicle: { plate: { in: [PLACA, PLACA_DA_OUTRA] } } } });
    await sistema.geoCache.deleteMany({ where: { key: { contains: "mapateste" } } });
    await sistema.auditLog.deleteMany({ where: { userName: { startsWith: PREFIXO } } });
    await sistema.notification.deleteMany({ where: { user: { email: { startsWith: PREFIXO } } } });
  }

  async function limpar() {
    const { sistema } = banco;
    await limparMovimento();
    await sistema.vehicle.deleteMany({ where: { plate: { in: [PLACA, PLACA_DA_OUTRA] } } });
    await sistema.driver.deleteMany({ where: { cpf: { in: CPFS } } });
    await sistema.user.deleteMany({ where: { email: { startsWith: PREFIXO } } });
    await sistema.client.deleteMany({ where: { cnpj: { in: [CNPJ, CNPJ_DA_OUTRA] } } });
  }

  type DadosDaCarga = Record<string, unknown>;
  const dadosDaCarga = (extra: DadosDaCarga = {}) => ({
    clientId: clienteId,
    sender: "Remetente",
    receiver: nome("destinatário"),
    origin: "São José do Rio Preto - SP",
    destination: "Mirassol - SP",
    volumes: 1,
    weight: 10,
    status: "ROUTE",
    ...extra,
  });

  /** Viagem gravada direto no banco, com as cargas na ordem recebida. */
  async function viajar(status: string, cargas: DadosDaCarga[] = [{}], extra: Record<string, unknown> = {}) {
    const viagem = await banco.default.manifest.create({ data: { driverId: motoristaId, vehicleId: veiculoId, status, ...extra } });
    const cargaIds: string[] = [];
    let sequencia = 1;
    for (const dados of cargas) {
      const criada = await banco.default.collection.create({ data: { ...dadosDaCarga(dados), manifestId: viagem.id, driverId: motoristaId, manifestSequence: sequencia } as never });
      cargaIds.push(criada.id);
      sequencia += 1;
    }
    return { id: viagem.id, cargaIds };
  }

  const enviarPosicao = async (viagemId: string, corpo: unknown, perfil: Perfil | null = "DRIVER") => {
    entrarComo(perfil);
    const res = await posicaoRota.POST(req("POST", corpo), ctx(viagemId));
    return { status: res.status, corpo: (await res.json()) as { error?: string; ok?: boolean; em?: string }, retryAfter: res.headers.get("Retry-After") };
  };
  const pontosDa = (manifestId: string) => banco.sistema.tripPosition.findMany({ where: { manifestId }, orderBy: [{ recordedAt: "asc" }, { id: "asc" }] });

  beforeAll(async () => {
    banco = await import("../src/lib/prisma");
    geoDb = await import("../src/lib/geo-db");
    posicaoDb = await import("../src/lib/posicao-db");
    resetRateLimit = (await import("../src/lib/rate-limit")).resetRateLimit;
    coletas = await import("../src/app/api/coletas/route");
    coleta = await import("../src/app/api/coletas/[id]/route");
    mapaRota = await import("../src/app/api/manifestos/[id]/mapa/route");
    roteiroRota = await import("../src/app/api/manifestos/[id]/roteiro/route");
    manifestosRota = await import("../src/app/api/manifestos/route");
    mapaDoMotorista = await import("../src/app/api/driver/manifestos/[id]/mapa/route");
    posicaoRota = await import("../src/app/api/driver/manifestos/[id]/posicao/route");
    viagensDoMotorista = await import("../src/app/api/driver/manifestos/route");
    rastreio = await import("../src/app/api/rastreio/route");
    portalColetas = await import("../src/app/api/portal/coletas/route");
    portalColeta = await import("../src/app/api/portal/coletas/[id]/route");
    portalMinutas = await import("../src/app/api/portal/minutas/route");
    await limpar();

    const db = banco.default;
    clienteId = (await db.client.create({ data: { companyName: nome("cliente"), cnpj: CNPJ } })).id;
    for (const perfil of ["ADMIN", "OPERATION", "FINANCE", "COMMERCIAL", "CLIENT", "DRIVER", "DRIVER2"] as const) {
      ids[perfil] = (
        await db.user.create({
          data: {
            name: nome(perfil),
            email: `${PREFIXO}${perfil.toLowerCase()}@exemplo.br`,
            password: HASH_FALSO,
            role: perfil === "DRIVER2" ? "DRIVER" : perfil,
            clientId: perfil === "CLIENT" ? clienteId : null,
          },
        })
      ).id;
    }
    const motorista = { cnh: "66666666601", cnhExpiry: new Date("2031-06-30"), category: "C" };
    motoristaId = (await db.driver.create({ data: { ...motorista, userId: ids.DRIVER, cpf: CPF_MOTORISTA } })).id;
    segundoMotoristaId = (await db.driver.create({ data: { ...motorista, userId: ids.DRIVER2, cpf: CPF_SEGUNDO } })).id;
    veiculoId = (await db.vehicle.create({ data: { plate: PLACA, model: nome("caminhão"), type: "TRUCK" } })).id;

    const outra = banco.paraEmpresa(EMPRESA_OUTRA.id).db;
    daOutra.usuarioId = (await outra.user.create({ data: { name: nome("motorista da outra"), email: `${PREFIXO}outra@exemplo.br`, password: HASH_FALSO, role: "DRIVER" } })).id;
    daOutra.motoristaId = (await outra.driver.create({ data: { ...motorista, userId: daOutra.usuarioId, cpf: CPF_DA_OUTRA } })).id;
    daOutra.veiculoId = (await outra.vehicle.create({ data: { plate: PLACA_DA_OUTRA, model: nome("da outra"), type: "TRUCK" } })).id;
    daOutra.clienteId = (await outra.client.create({ data: { companyName: nome("cliente da outra"), cnpj: CNPJ_DA_OUTRA } })).id;
  });

  beforeEach(async () => {
    sessao.mockReset();
    resetRateLimit();
    geoDb.zerarPausaDoGeo();
    zerarFilaDoGeo();
    await limparMovimento();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    if (banco) await limpar();
  });

  /* ------------------------------ Endereço na carga ----------------------------- */

  describe("endereço na carga", () => {
    const nova = (extra: Record<string, unknown> = {}) => ({
      clientId: clienteId,
      sender: "Remetente",
      receiver: nome("destinatário"),
      origin: "São José do Rio Preto - SP",
      destination: "Mirassol - SP",
      volumes: "1",
      weight: "10",
      ...extra,
    });

    it("o painel cria a carga com o endereço, sem coordenada: quem procura é o segundo plano", async () => {
      entrarComo("OPERATION");
      const res = await coletas.POST(req("POST", nova({ deliveryStreet: " Rua das Flores ", deliveryNumber: "120", deliveryDistrict: "Centro", deliveryZip: "15130-000" })));
      expect(res.status).toBe(201);
      const criada = (await res.json()) as { id: string };
      const gravada = await banco.sistema.collection.findUniqueOrThrow({ where: { id: criada.id } });
      expect(gravada).toMatchObject({
        deliveryStreet: "Rua das Flores",
        deliveryNumber: "120",
        deliveryDistrict: "Centro",
        deliveryZip: "15130000",
        deliveryLat: null,
        deliveryLon: null,
        geoSource: null,
        geoAt: null,
      });
      const [linha] = await banco.sistema.auditLog.findMany({ where: { entityId: criada.id, action: "coleta.criar" } });
      expect(linha.after).toMatchObject({ deliveryStreet: "Rua das Flores", deliveryZip: "15130000" });
    });

    it("endereço é opcional, e CEP torto é recusado com 400", async () => {
      entrarComo("OPERATION");
      const sem = await coletas.POST(req("POST", nova()));
      expect(sem.status).toBe(201);
      expect(await banco.sistema.collection.findUniqueOrThrow({ where: { id: ((await sem.json()) as { id: string }).id } })).toMatchObject({ deliveryStreet: null, deliveryZip: null });

      entrarComo("OPERATION");
      const ruim = await coletas.POST(req("POST", nova({ deliveryZip: "1513" })));
      expect(ruim.status).toBe(400);
      expect(((await ruim.json()) as { error: string }).error).toBe("O CEP precisa ter 8 dígitos.");
    });

    it("mudar o endereço ou a cidade zera a coordenada e registra na auditoria; mudar outra coisa, não", async () => {
      const carga = await banco.default.collection.create({
        data: dadosDaCarga({ status: "CONFIRMED", deliveryStreet: "Rua A", deliveryNumber: "10", deliveryLat: -20.82, deliveryLon: -49.51, geoSource: "ADDRESS", geoAt: new Date() }) as never,
      });
      const ler = () => banco.sistema.collection.findUniqueOrThrow({ where: { id: carga.id } });

      entrarComo("OPERATION");
      expect((await coleta.PATCH(req("PATCH", { weight: "12" }), ctx(carga.id))).status).toBe(200);
      expect(await ler()).toMatchObject({ weight: 12, deliveryLat: -20.82, geoSource: "ADDRESS" });

      // Reenviar o mesmo endereço (o formulário inteiro) também não zera.
      entrarComo("OPERATION");
      expect((await coleta.PATCH(req("PATCH", { deliveryStreet: "Rua A", deliveryNumber: "10" }), ctx(carga.id))).status).toBe(200);
      expect(await ler()).toMatchObject({ deliveryLat: -20.82, geoSource: "ADDRESS" });

      entrarComo("OPERATION");
      expect((await coleta.PATCH(req("PATCH", { deliveryStreet: "Rua B" }), ctx(carga.id))).status).toBe(200);
      expect(await ler()).toMatchObject({ deliveryStreet: "Rua B", deliveryNumber: "10", deliveryLat: null, deliveryLon: null, geoSource: null, geoAt: null });
      const trilha = await banco.sistema.auditLog.findMany({ where: { entityId: carga.id, action: "coleta.alterar" }, orderBy: { createdAt: "asc" } });
      expect(trilha.at(-1)).toMatchObject({ before: { deliveryStreet: "Rua A" }, after: { deliveryStreet: "Rua B" } });

      await banco.sistema.collection.update({ where: { id: carga.id }, data: { deliveryLat: -20.83, deliveryLon: -49.52, geoSource: "ADDRESS" } });
      entrarComo("OPERATION");
      expect((await coleta.PATCH(req("PATCH", { destination: "Bálsamo - SP" }), ctx(carga.id))).status).toBe(200);
      expect(await ler()).toMatchObject({ destination: "Bálsamo - SP", deliveryLat: null, geoSource: null });
    });

    it("carga que já embarcou não tem o endereço alterado", async () => {
      const viagem = await viajar("ROUTE", [{ deliveryStreet: "Rua A" }]);
      entrarComo("OPERATION");
      expect((await coleta.PATCH(req("PATCH", { deliveryStreet: "Rua B" }), ctx(viagem.cargaIds[0]))).status).toBe(409);
      expect(await banco.sistema.collection.findUniqueOrThrow({ where: { id: viagem.cargaIds[0] } })).toMatchObject({ deliveryStreet: "Rua A" });
    });

    it("o portal pede a coleta com o endereço e recebe o endereço de volta, sem coordenada", async () => {
      entrarComo("CLIENT");
      const res = await portalColetas.POST(req("POST", { sender: "Remetente", receiver: nome("destinatário"), origin: "Rio Preto - SP", destination: "Mirassol - SP", volumes: 1, weight: 10, deliveryStreet: "Rua do Portal", deliveryNumber: "7", deliveryZip: "15130000" }));
      expect(res.status).toBe(201);
      const { collection } = (await res.json()) as { collection: Record<string, unknown> };
      expect(collection).toMatchObject({ deliveryStreet: "Rua do Portal", deliveryNumber: "7", deliveryDistrict: null, deliveryZip: "15130000", status: "PENDING" });
      for (const chave of CHAVES_PRIVADAS) expect(chavesDe(collection), chave).not.toContain(chave);

      entrarComo("CLIENT");
      const ruim = await portalColetas.POST(req("POST", { sender: "R", receiver: "D", origin: "Rio Preto - SP", destination: "Mirassol - SP", volumes: 1, weight: 10, deliveryZip: "123" }));
      expect(ruim.status).toBe(400);
    });
  });

  /* ------------------------- Localização em segundo plano ------------------------ */

  describe("localização dos endereços em segundo plano", () => {
    let nominatim: ServidorLocal;
    let resposta: Resposta = {};
    const ACHADO = { lat: "-20.8200", lon: "-49.5100" };

    beforeAll(async () => {
      nominatim = await servidorLocal(() => resposta);
    });
    afterAll(() => nominatim.fechar());
    beforeEach(() => {
      nominatim.pedidos.length = 0;
      resposta = { corpo: [ACHADO] };
    });

    const configuracao = () => ({ url: nominatim.url, contato: "contato@teste.example", intervaloMs: 0 });
    const volta = (extra: { agora?: number } = {}) => geoDb.localizarEnderecosPendentes({ configuracao: configuracao(), ...extra });
    const pendente = (extra: DadosDaCarga = {}) =>
      banco.default.collection.create({ data: dadosDaCarga({ status: "CONFIRMED", deliveryStreet: "Rua Mapateste Um", deliveryNumber: "120", ...extra }) as never });
    const ler = (id: string) => banco.sistema.collection.findUniqueOrThrow({ where: { id } });

    it("sem GEO_CONTATO não consulta ninguém, e a carga fica esperando", async () => {
      const carga = await pendente();
      expect(await geoDb.localizarEnderecosPendentes({ configuracao: null })).toEqual({ localizadas: 0, semResultado: 0, consultas: 0, erro: null });
      // O padrão lê o ambiente: sem a variável, é o mesmo que desligado.
      vi.stubEnv("GEO_CONTATO", "");
      vi.stubEnv("GEO_URL", nominatim.url);
      expect((await geoDb.localizarEnderecosPendentes()).consultas).toBe(0);
      expect(nominatim.pedidos).toHaveLength(0);
      expect(await ler(carga.id)).toMatchObject({ geoSource: null, deliveryLat: null });
    });

    it("com a variável definida, a volta lê GEO_URL e GEO_CONTATO do ambiente", async () => {
      const carga = await pendente();
      vi.stubEnv("GEO_CONTATO", "ambiente@teste.example");
      vi.stubEnv("GEO_URL", nominatim.url);
      // O intervalo padrão é de mais de um segundo, mas esta é a primeira consulta da fila.
      expect(await geoDb.localizarEnderecosPendentes()).toMatchObject({ localizadas: 1, consultas: 1 });
      expect(nominatim.pedidos[0].agente).toBe("TMS-Avila-Ops/1.0 (ambiente@teste.example)");
      expect(await ler(carga.id)).toMatchObject({ geoSource: "ADDRESS" });
    });

    it("acha o endereço, grava a coordenada na carga e a resposta no cache, sem mexer em updatedAt", async () => {
      const carga = await pendente();
      expect(await volta()).toEqual({ localizadas: 1, semResultado: 0, consultas: 1, erro: null });

      const depois = await ler(carga.id);
      expect(depois).toMatchObject({ deliveryLat: -20.82, deliveryLon: -49.51, geoSource: "ADDRESS" });
      expect(depois.geoAt).toBeInstanceOf(Date);
      expect(depois.updatedAt.getTime()).toBe(carga.updatedAt.getTime());

      expect(nominatim.pedidos).toHaveLength(1);
      expect(nominatim.pedidos[0].url.searchParams.get("street")).toBe("120 rua mapateste um");
      expect(nominatim.pedidos[0].url.searchParams.get("city")).toBe("Mirassol");
      expect(nominatim.pedidos[0].url.searchParams.get("state")).toBe("SP");

      const cache = await banco.sistema.geoCache.findMany({ where: { key: { contains: "mapateste" } } });
      expect(cache).toMatchObject([{ key: "rua mapateste um 120|mirassol|sp", lat: -20.82, lon: -49.51 }]);
      // O cache guarda só o endereço e a coordenada: nada que diga de quem veio a pergunta.
      expect(Object.keys(cache[0]).sort()).toEqual(["createdAt", "key", "lat", "lon"]);

      // Carga já localizada não é procurada de novo.
      expect(await volta()).toEqual({ localizadas: 0, semResultado: 0, consultas: 0, erro: null });
      expect(nominatim.pedidos).toHaveLength(1);
    });

    it("o mesmo endereço em outra carga, até de outra empresa, sai do cache sem segunda consulta", async () => {
      await pendente();
      expect((await volta()).consultas).toBe(1);

      // Escrito de outro jeito, é a mesma chave.
      const outraCarga = await pendente({ deliveryStreet: "R. MAPATESTE UM", deliveryNumber: " 120 " });
      const outra = banco.paraEmpresa(EMPRESA_OUTRA.id).db;
      const daOutraEmpresa = await outra.collection.create({
        data: { ...dadosDaCarga({ clientId: daOutra.clienteId, status: "CONFIRMED", deliveryStreet: "Rua Mapateste Um", deliveryNumber: "120" }) } as never,
      });

      expect(await volta()).toEqual({ localizadas: 2, semResultado: 0, consultas: 0, erro: null });
      expect(nominatim.pedidos).toHaveLength(1);
      expect(await ler(outraCarga.id)).toMatchObject({ deliveryLat: -20.82, geoSource: "ADDRESS" });
      expect(await ler(daOutraEmpresa.id)).toMatchObject({ deliveryLat: -20.82, geoSource: "ADDRESS", tenantId: EMPRESA_OUTRA.id });
    });

    it("sem resultado: a carga fica sem coordenada (a rota usa o centro da cidade) e a pergunta não se repete", async () => {
      resposta = { corpo: [] };
      const carga = await pendente({ deliveryStreet: "Rua Mapateste Inexistente" });
      expect(await volta()).toEqual({ localizadas: 0, semResultado: 1, consultas: 1, erro: null });
      expect(await ler(carga.id)).toMatchObject({ deliveryLat: null, deliveryLon: null, geoSource: "NONE" });
      expect(await banco.sistema.geoCache.findMany({ where: { key: { contains: "mapateste" } } })).toMatchObject([{ lat: null, lon: null }]);

      const repetida = await pendente({ deliveryStreet: "Rua Mapateste Inexistente" });
      expect(await volta()).toMatchObject({ semResultado: 1, consultas: 0 });
      expect(nominatim.pedidos).toHaveLength(1);
      expect(await ler(repetida.id)).toMatchObject({ geoSource: "NONE" });
    });

    it("resultado longe demais da cidade do destino é descartado: é rua de mesmo nome em outro lugar", async () => {
      // Belo Horizonte, a mais de 600 km de Mirassol.
      resposta = { corpo: [{ lat: "-19.9167", lon: "-43.9345" }] };
      const carga = await pendente();
      expect(await volta()).toMatchObject({ localizadas: 0, semResultado: 1, consultas: 1 });
      expect(await ler(carga.id)).toMatchObject({ deliveryLat: null, geoSource: "NONE" });
    });

    it("cidade do destino não reconhecida: não há onde procurar, e nada é consultado", async () => {
      const carga = await pendente({ destination: "Lugar Nenhum" });
      expect(await volta()).toEqual({ localizadas: 0, semResultado: 1, consultas: 0, erro: null });
      expect(nominatim.pedidos).toHaveLength(0);
      expect(await ler(carga.id)).toMatchObject({ geoSource: "NONE" });
    });

    it("falha do serviço: a carga fica como estava, nada vai para o cache e a localização entra em pausa", async () => {
      resposta = { status: 503 };
      const carga = await pendente();
      const segunda = await pendente({ deliveryStreet: "Rua Mapateste Dois" });
      expect(await volta()).toEqual({ localizadas: 0, semResultado: 0, consultas: 0, erro: "Resposta 503" });
      // Parou na primeira falha: a segunda carga nem foi tentada.
      expect(nominatim.pedidos).toHaveLength(1);
      expect(await ler(carga.id)).toMatchObject({ geoSource: null });
      expect(await ler(segunda.id)).toMatchObject({ geoSource: null });
      expect(await banco.sistema.geoCache.count({ where: { key: { contains: "mapateste" } } })).toBe(0);

      // Em pausa: mesmo com o serviço de volta, a próxima volta não consulta.
      resposta = { corpo: [ACHADO] };
      expect(await volta()).toEqual({ localizadas: 0, semResultado: 0, consultas: 0, erro: null });
      expect(nominatim.pedidos).toHaveLength(1);
      // Dez minutos depois, volta a procurar.
      expect(await volta({ agora: Date.now() + 10 * 60_000 + 1 })).toMatchObject({ localizadas: 2, consultas: 2 });
    });

    it("poucas consultas por volta: o resto fica para a volta seguinte", async () => {
      for (const n of ["Tres", "Quatro", "Cinco"]) await pendente({ deliveryStreet: `Rua Mapateste ${n}` });
      expect(await volta()).toMatchObject({ localizadas: 2, consultas: 2 });
      expect(nominatim.pedidos).toHaveLength(2);
      expect(await banco.sistema.collection.count({ where: { client: { cnpj: CNPJ }, geoSource: null } })).toBe(1);
      expect(await volta()).toMatchObject({ localizadas: 1, consultas: 1 });
    });

    it("carga em viagem vem primeiro; cancelada, entregue e sem logradouro não entram", async () => {
      const solta = await pendente({ deliveryStreet: "Rua Mapateste Solta" });
      const viagem = await viajar("ROUTE", [{ deliveryStreet: "Rua Mapateste Viagem A" }, { deliveryStreet: "Rua Mapateste Viagem B" }]);
      const cancelada = await pendente({ deliveryStreet: "Rua Mapateste Cancelada", status: "CANCELLED" });
      const entregue = await pendente({ deliveryStreet: "Rua Mapateste Entregue", status: "DELIVERED" });
      const semRua = await pendente({ deliveryStreet: null, deliveryNumber: "9" });

      expect(await volta()).toMatchObject({ localizadas: 2, consultas: 2 });
      expect(nominatim.pedidos.map((p) => p.url.searchParams.get("street")).sort()).toEqual(["rua mapateste viagem a", "rua mapateste viagem b"]);
      for (const id of viagem.cargaIds) expect(await ler(id)).toMatchObject({ geoSource: "ADDRESS" });
      expect(await ler(solta.id)).toMatchObject({ geoSource: null });

      expect(await volta()).toMatchObject({ localizadas: 1, consultas: 1 });
      expect(await volta()).toMatchObject({ localizadas: 0, consultas: 0 });
      for (const id of [cancelada.id, entregue.id, semRua.id]) expect(await ler(id)).toMatchObject({ geoSource: null, deliveryLat: null });
    });

    it("endereço corrigido enquanto era procurado: a coordenada do antigo não é gravada", async () => {
      const carga = await pendente({ deliveryStreet: "Rua Mapateste Antiga" });
      resposta = { corpo: [ACHADO], esperaMs: 150 };
      const emCurso = volta();
      await new Promise((resolve) => setTimeout(resolve, 50));
      await banco.sistema.collection.update({ where: { id: carga.id }, data: { deliveryStreet: "Rua Mapateste Nova" } });
      expect(await emCurso).toMatchObject({ localizadas: 0, consultas: 1 });
      expect(await ler(carga.id)).toMatchObject({ deliveryStreet: "Rua Mapateste Nova", deliveryLat: null, geoSource: null });
    });

    it("o cache é do sistema: o papel da aplicação não lê nem grava nele", async () => {
      await expect(banco.default.geoCache.findMany()).rejects.toThrow(/permission denied|permissão negada/i);
      await expect(banco.default.geoCache.create({ data: { key: "invasor mapateste|x|sp", lat: 1, lon: 1 } })).rejects.toThrow(/permission denied|permissão negada/i);
      expect(await banco.sistema.geoCache.count({ where: { key: { contains: "invasor" } } })).toBe(0);
    });
  });

  /* ---------------------------------- Posição ---------------------------------- */

  describe("POST /api/driver/manifestos/[id]/posicao", () => {
    const AQUI = { lat: -20.8113, lon: -49.3758, precisao: 12 };

    it("sem sessão e com perfil que não é motorista: 401, e nada é gravado", async () => {
      const viagem = await viajar("ROUTE");
      expect((await enviarPosicao(viagem.id, AQUI, null)).status).toBe(401);
      for (const perfil of ["ADMIN", "OPERATION", "CLIENT"] as const) {
        expect((await enviarPosicao(viagem.id, AQUI, perfil)).status, perfil).toBe(401);
      }
      expect(await banco.sistema.manifest.findUniqueOrThrow({ where: { id: viagem.id } })).toMatchObject({ lastLat: null, lastPositionAt: null });
      expect(await pontosDa(viagem.id)).toHaveLength(0);
    });

    it("o motorista da viagem em rota grava a última posição e um ponto no histórico, sem auditoria", async () => {
      const viagem = await viajar("ROUTE");
      const antes = Date.now();
      const { status, corpo } = await enviarPosicao(viagem.id, AQUI);
      expect(status).toBe(200);
      expect(corpo.ok).toBe(true);

      const gravada = await banco.sistema.manifest.findUniqueOrThrow({ where: { id: viagem.id } });
      expect(gravada).toMatchObject({ lastLat: AQUI.lat, lastLon: AQUI.lon, lastAccuracy: 12, status: "ROUTE" });
      expect(gravada.lastPositionAt!.getTime()).toBeGreaterThanOrEqual(antes - 1000);
      expect(corpo.em).toBe(gravada.lastPositionAt!.toISOString());
      expect(await pontosDa(viagem.id)).toMatchObject([{ lat: AQUI.lat, lon: AQUI.lon, accuracy: 12, tenantId: EMPRESA_PADRAO.id }]);
      // Posição não é alteração de cadastro: não vai para a trilha.
      expect(await banco.sistema.auditLog.count({ where: { OR: [{ entityId: viagem.id }, { userId: ids.DRIVER }] } })).toBe(0);
    });

    it("sem a precisão a posição vale do mesmo jeito", async () => {
      const viagem = await viajar("ROUTE");
      expect((await enviarPosicao(viagem.id, { lat: -20.9, lon: -49.4 })).status).toBe(200);
      expect(await banco.sistema.manifest.findUniqueOrThrow({ where: { id: viagem.id } })).toMatchObject({ lastLat: -20.9, lastAccuracy: null });
    });

    it("viagem de outro motorista: 404, e a viagem alheia não ganha posição", async () => {
      const viagem = await viajar("ROUTE");
      const res = await enviarPosicao(viagem.id, AQUI, "DRIVER2");
      expect(res).toMatchObject({ status: 404, corpo: { error: "Viagem não encontrada." } });
      expect(await banco.sistema.manifest.findUniqueOrThrow({ where: { id: viagem.id } })).toMatchObject({ lastLat: null });
      expect(await pontosDa(viagem.id)).toHaveLength(0);
      expect(segundoMotoristaId).not.toBe(motoristaId);
    });

    it("viagem fora de rota (em montagem, finalizada) e viagem que não existe: 404", async () => {
      for (const status of ["ASSEMBLING", "FINISHED"]) {
        const viagem = await viajar(status);
        expect((await enviarPosicao(viagem.id, AQUI)).status, status).toBe(404);
        expect(await pontosDa(viagem.id)).toHaveLength(0);
      }
      expect((await enviarPosicao(SEM_ID, AQUI)).status).toBe(404);
    });

    it.each([
      ["latitude fora da faixa", { lat: 91, lon: -49.3 }, "Latitude inválida."],
      ["longitude fora da faixa", { lat: -20.8, lon: -181 }, "Longitude inválida."],
      ["texto no lugar de número", { lat: "-20.8", lon: "-49.3" }, "Latitude inválida."],
      ["precisão negativa", { lat: -20.8, lon: -49.3, precisao: -5 }, "Precisão inválida."],
      ["0,0", { lat: 0, lon: 0 }, POSICAO_INVALIDA],
      ["sem corpo", undefined, "Dados inválidos."],
    ])("coordenada inválida (%s): 400, e nada é gravado", async (_caso, corpo, mensagem) => {
      const viagem = await viajar("ROUTE");
      const res = await enviarPosicao(viagem.id, corpo);
      expect(res).toMatchObject({ status: 400, corpo: { error: mensagem } });
      expect(await banco.sistema.manifest.findUniqueOrThrow({ where: { id: viagem.id } })).toMatchObject({ lastLat: null });
    });

    it("limite de envios por minuto, por motorista: passou, 429 com Retry-After; o outro motorista segue", async () => {
      const viagem = await viajar("ROUTE");
      for (let i = 0; i < LIMITE_POR_MINUTO; i += 1) {
        expect((await enviarPosicao(viagem.id, { lat: -20.8 - i / 1000, lon: -49.3 })).status, `envio ${i + 1}`).toBe(200);
      }
      const barrado = await enviarPosicao(viagem.id, { lat: -20.5, lon: -49.3 });
      expect(barrado.status).toBe(429);
      expect(Number(barrado.retryAfter)).toBeGreaterThan(0);
      expect(barrado.corpo.error).toBe("Muitas posições em pouco tempo. Aguarde um instante.");
      // A posição barrada não foi gravada.
      expect((await banco.sistema.manifest.findUniqueOrThrow({ where: { id: viagem.id } })).lastLat).not.toBe(-20.5);
      // O limite é de cada motorista: o segundo não foi barrado (404 é só porque a viagem não é dele).
      expect((await enviarPosicao(viagem.id, AQUI, "DRIVER2")).status).toBe(404);
    });

    it("parado, a última posição é atualizada mas o histórico não cresce", async () => {
      const viagem = await viajar("ROUTE");
      expect((await enviarPosicao(viagem.id, AQUI)).status).toBe(200);
      const primeira = (await banco.sistema.manifest.findUniqueOrThrow({ where: { id: viagem.id } })).lastPositionAt!;
      await new Promise((resolve) => setTimeout(resolve, 15));
      expect((await enviarPosicao(viagem.id, { ...AQUI, precisao: 30 })).status).toBe(200);

      const depois = await banco.sistema.manifest.findUniqueOrThrow({ where: { id: viagem.id } });
      expect(depois.lastAccuracy).toBe(30);
      expect(depois.lastPositionAt!.getTime()).toBeGreaterThan(primeira.getTime());
      expect(await pontosDa(viagem.id)).toHaveLength(1);
    });

    it("o histórico é podado: ficam só os pontos mais novos", async () => {
      const viagem = await viajar("ROUTE");
      const inicio = new Date("2026-10-10T12:00:00.000Z").getTime();
      for (let i = 0; i < 7; i += 1) {
        const gravada = await banco.transacao((tx) =>
          posicaoDb.registrarPosicao(tx, { manifestId: viagem.id, driverId: motoristaId, posicao: { lat: -20.8 - i / 100, lon: -49.3 }, agora: new Date(inicio + i * 60_000), maximo: 3 }),
        );
        expect(gravada).toMatchObject({ guardada: true });
      }
      const pontos = await pontosDa(viagem.id);
      expect(pontos.map((p) => p.lat)).toEqual([-20.84, -20.85, -20.86]);
      expect(await banco.sistema.manifest.findUniqueOrThrow({ where: { id: viagem.id } })).toMatchObject({ lastLat: -20.86 });
      // Viagem de outro motorista, direto na função: não grava.
      expect(await banco.transacao((tx) => posicaoDb.registrarPosicao(tx, { manifestId: viagem.id, driverId: segundoMotoristaId, posicao: { lat: 1, lon: 1 } }))).toBeNull();
    });

    it("apagar a viagem leva o histórico junto", async () => {
      const viagem = await viajar("ROUTE", []);
      expect((await enviarPosicao(viagem.id, AQUI)).status).toBe(200);
      await banco.sistema.manifest.delete({ where: { id: viagem.id } });
      expect(await pontosDa(viagem.id)).toHaveLength(0);
    });
  });

  /* ------------------------------------ Mapa ------------------------------------ */

  describe("mapa da viagem", () => {
    const ver = async (viagemId: string, perfil: Perfil | null) => {
      entrarComo(perfil);
      const res = await mapaRota.GET(req(), ctx(viagemId));
      return { status: res.status, corpo: (await res.json()) as MapaDaViagem & { error?: string } };
    };
    const verComoMotorista = async (viagemId: string, perfil: Perfil | null = "DRIVER") => {
      entrarComo(perfil);
      const res = await mapaDoMotorista.GET(req(), ctx(viagemId));
      return { status: res.status, corpo: (await res.json()) as MapaDaViagem & { error?: string } };
    };

    it("painel: quem lê viagens vê o mapa; os outros perfis, o cliente e o motorista, não", async () => {
      const viagem = await viajar("ROUTE");
      expect((await ver(viagem.id, null)).status).toBe(401);
      for (const perfil of ["COMMERCIAL", "CLIENT", "DRIVER"] as const) expect((await ver(viagem.id, perfil)).status, perfil).toBe(403);
      // FINANCE lê viagens (`manifestosVer`) sem poder alterá-las (`manifestos`).
      for (const perfil of ["ADMIN", "OPERATION", "FINANCE"] as const) expect((await ver(viagem.id, perfil)).status, perfil).toBe(200);
      expect((await ver(SEM_ID, "ADMIN")).status).toBe(404);
    });

    it("traz as paradas na ordem, com o ponto de cada uma, a origem e a posição do motorista", async () => {
      const viagem = await viajar("ROUTE", [
        { deliveryStreet: "Rua das Flores", deliveryNumber: "120", deliveryLat: -20.82, deliveryLon: -49.51, geoSource: "ADDRESS" },
        { destination: "Catanduva - SP" },
        { destination: "Lugar Nenhum" },
      ]);
      expect((await enviarPosicao(viagem.id, { lat: -20.815, lon: -49.44, precisao: 18 })).status).toBe(200);

      const { status, corpo } = await ver(viagem.id, "FINANCE");
      expect(status).toBe(200);
      expect(Object.keys(corpo).sort()).toEqual(["localizaEndereco", "origem", "paradas", "posicao", "status"]);
      expect(corpo.origem).toMatchObject({ nome: "São José do Rio Preto/SP" });
      expect(corpo.paradas.map((p) => [p.id, p.numero, p.ponto?.precisao ?? null])).toEqual([
        [viagem.cargaIds[0], 1, "endereco"],
        [viagem.cargaIds[1], 2, "cidade"],
        [viagem.cargaIds[2], 3, null],
      ]);
      expect(corpo.paradas[0]).toMatchObject({ destino: "Rua das Flores, 120, Mirassol - SP", ponto: { lat: -20.82, lon: -49.51 }, status: "ROUTE" });
      expect(corpo.posicao).toMatchObject({ lat: -20.815, lon: -49.44, precisao: 18 });
      expect(typeof corpo.posicao!.em).toBe("string");
    });

    it("viagem finalizada não mostra a posição que ficou gravada", async () => {
      const viagem = await viajar("FINISHED", [{ status: "DELIVERED" }], { lastLat: -20.8, lastLon: -49.4, lastPositionAt: new Date() });
      const { status, corpo } = await ver(viagem.id, "ADMIN");
      expect(status).toBe(200);
      expect(corpo.posicao).toBeNull();
    });

    it("diz quando a localização por endereço está desligada no servidor", async () => {
      const viagem = await viajar("ROUTE", [{ deliveryStreet: "Rua Mapateste Fila" }]);
      vi.stubEnv("GEO_CONTATO", "");
      expect((await ver(viagem.id, "ADMIN")).corpo).toMatchObject({ localizaEndereco: false, paradas: [{ aLocalizar: false }] });
      vi.stubEnv("GEO_CONTATO", "contato@teste.example");
      expect((await ver(viagem.id, "ADMIN")).corpo).toMatchObject({ localizaEndereco: true, paradas: [{ aLocalizar: true }] });
    });

    it("motorista: só o mapa da viagem dele, e só com ela em rota", async () => {
      const viagem = await viajar("ROUTE", [{ deliveryStreet: "Rua A", deliveryLat: -20.82, deliveryLon: -49.51, geoSource: "ADDRESS" }]);
      const minha = await verComoMotorista(viagem.id);
      expect(minha.status).toBe(200);
      expect(minha.corpo.paradas).toMatchObject([{ id: viagem.cargaIds[0], numero: 1, ponto: { precisao: "endereco" } }]);

      expect((await verComoMotorista(viagem.id, "DRIVER2")).status).toBe(404);
      expect((await verComoMotorista(viagem.id, null)).status).toBe(401);
      expect((await verComoMotorista(viagem.id, "ADMIN")).status).toBe(401);
      for (const status of ["ASSEMBLING", "FINISHED"]) expect((await verComoMotorista((await viajar(status)).id)).status, status).toBe(404);
    });

    it("a lista de viagens do painel traz quando a posição chegou, para o selo", async () => {
      const viagem = await viajar("ROUTE");
      expect((await enviarPosicao(viagem.id, { lat: -20.815, lon: -49.44 })).status).toBe(200);
      entrarComo("OPERATION");
      const lista = (await (await manifestosRota.GET()).json()) as { id: string; lastPositionAt: string | null }[];
      const daLista = lista.find((m) => m.id === viagem.id)!;
      expect(typeof daLista.lastPositionAt).toBe("string");
    });

    it("a lista de viagens do motorista traz o endereço da parada, sem coordenada", async () => {
      const viagem = await viajar("ROUTE", [{ deliveryStreet: "Rua das Flores", deliveryNumber: "120", deliveryDistrict: "Centro", deliveryZip: "15130000", deliveryLat: -20.82, deliveryLon: -49.51, geoSource: "ADDRESS" }]);
      entrarComo("DRIVER");
      const lista = (await (await viagensDoMotorista.GET()).json()) as { id: string; collections: Record<string, unknown>[] }[];
      const minha = lista.find((m) => m.id === viagem.id)!;
      expect(minha.collections[0]).toMatchObject({ deliveryStreet: "Rua das Flores", deliveryNumber: "120", deliveryDistrict: "Centro", deliveryZip: "15130000" });
      for (const chave of ["deliveryLat", "deliveryLon", "geoSource", "lastLat", "lastLon"]) expect(chavesDe(minha), chave).not.toContain(chave);
    });
  });

  /* ----------------------------------- Roteiro ---------------------------------- */

  describe("POST /api/manifestos/[id]/roteiro com endereço", () => {
    const PERTO = { deliveryStreet: "Rua Perto", deliveryLat: -20.8113, deliveryLon: -49.37, geoSource: "ADDRESS", destination: "São José do Rio Preto - SP" };
    const MEIO = { deliveryStreet: "Rua Meio", deliveryLat: -20.8113, deliveryLon: -49.34, geoSource: "ADDRESS", destination: "São José do Rio Preto - SP" };
    const LONGE = { deliveryStreet: "Rua Longe", deliveryLat: -20.8113, deliveryLon: -49.3, geoSource: "ADDRESS", destination: "São José do Rio Preto - SP" };

    const sugerir = async (viagemId: string) => {
      entrarComo("OPERATION");
      const res = await roteiroRota.POST(req("POST", { voltar: false }), ctx(viagemId));
      return { status: res.status, corpo: (await res.json()) as import("../src/lib/roteiro").RespostaDoRoteiro };
    };

    it("ordena as entregas da mesma cidade pelo endereço localizado; sem ROTA_URL, em linha reta", async () => {
      vi.stubEnv("ROTA_URL", "");
      const viagem = await viajar("ASSEMBLING", [LONGE, PERTO, MEIO]);
      const [longe, perto, meio] = viagem.cargaIds;
      const { status, corpo } = await sugerir(viagem.id);
      expect(status).toBe(200);
      expect(corpo).toMatchObject({ ordem: [perto, meio, longe], mudou: true, porEndereco: 3, medida: "reta", naoLocalizadas: [] });
      // Só sugere: a ordem gravada segue a mesma.
      expect((await banco.sistema.collection.findUniqueOrThrow({ where: { id: longe } })).manifestSequence).toBe(1);
    });

    it("com ROTA_URL, usa a distância por estrada do servidor OSRM", async () => {
      // Pela estrada (de mentira), MEIO fica longíssimo de tudo: a melhor ordem deixa MEIO para o fim.
      const osrm = await servidorLocal((_req, url) => {
        const pontos = url.pathname.split("/").pop()!.split(";");
        const meio = pontos.findIndex((ponto) => ponto.startsWith("-49.34"));
        const distances = pontos.map((_, i) => pontos.map((__, j) => (i === j ? 0 : i === meio || j === meio ? 90_000 : 5_000)));
        return { corpo: { code: "Ok", distances } };
      });
      try {
        vi.stubEnv("ROTA_URL", osrm.url);
        const viagem = await viajar("ASSEMBLING", [MEIO, PERTO, LONGE]);
        const [meio, perto, longe] = viagem.cargaIds;
        const { status, corpo } = await sugerir(viagem.id);
        expect(status).toBe(200);
        expect(corpo.medida).toBe("estrada");
        expect(corpo.ordem).toEqual([perto, longe, meio]);
        expect(corpo.distanciaDepoisKm).toBe(100);
        expect(osrm.pedidos).toHaveLength(1);
        expect(osrm.pedidos[0].url.pathname.startsWith("/table/v1/driving/")).toBe(true);
      } finally {
        await osrm.fechar();
      }
    });

    it("servidor de rotas fora do ar: a sugestão sai do mesmo jeito, em linha reta", async () => {
      vi.stubEnv("ROTA_URL", "http://127.0.0.1:9");
      const viagem = await viajar("ASSEMBLING", [LONGE, PERTO, MEIO]);
      const [longe, perto, meio] = viagem.cargaIds;
      const { status, corpo } = await sugerir(viagem.id);
      expect(status).toBe(200);
      expect(corpo).toMatchObject({ ordem: [perto, meio, longe], medida: "reta" });
    });
  });

  /* --------------------------------- Privacidade -------------------------------- */

  describe("privacidade: o rastreio público e o portal não recebem posição nem coordenada", () => {
    // Números que não aparecem em mais nada da resposta.
    const POSICAO = { lat: -20.713579, lon: -49.246813 };
    const ENTREGA = { deliveryLat: -20.824681, deliveryLon: -49.513579 };

    async function viagemComPosicao() {
      const viagem = await viajar("ROUTE", [{ trackingCode: CODIGO, deliveryStreet: "Rua das Flores", deliveryNumber: "120", geoSource: "ADDRESS", ...ENTREGA }]);
      expect((await enviarPosicao(viagem.id, POSICAO)).status).toBe(200);
      return viagem;
    }

    const semNadaPrivado = (texto: string) => {
      for (const chave of CHAVES_PRIVADAS) expect(chavesDe(JSON.parse(texto)), chave).not.toContain(chave);
      for (const numero of ["713579", "246813", "824681", "513579"]) expect(texto, numero).not.toContain(numero);
    };

    it("rastreio público: só o status, como sempre", async () => {
      await viagemComPosicao();
      sessao.mockResolvedValue(null);
      const res = await rastreio.GET(new Request(`http://localhost/api/rastreio?cnpj=${CNPJ}&codigo=${CODIGO}`));
      expect(res.status).toBe(200);
      const texto = await res.text();
      const [minuta] = JSON.parse(texto) as Record<string, unknown>[];
      expect(minuta).toMatchObject({ trackingCode: CODIGO, status: "ROUTE" });
      expect(Object.keys(minuta).sort()).toEqual(["createdAt", "destination", "id", "manifest", "origin", "status", "statusHistory", "tenant", "trackingCode"]);
      semNadaPrivado(texto);
    });

    it("portal do cliente: lista, detalhe e visão geral sem posição nem coordenada", async () => {
      const viagem = await viagemComPosicao();

      entrarComo("CLIENT");
      const lista = await (await portalColetas.GET()).text();
      expect(JSON.parse(lista)).toMatchObject([{ id: viagem.cargaIds[0], deliveryStreet: "Rua das Flores" }]);
      semNadaPrivado(lista);

      entrarComo("CLIENT");
      const detalhe = await portalColeta.GET(req(), ctx(viagem.cargaIds[0]));
      expect(detalhe.status).toBe(200);
      semNadaPrivado(await detalhe.text());

      entrarComo("CLIENT");
      const minutas = await portalMinutas.GET();
      expect(minutas.status).toBe(200);
      semNadaPrivado(await minutas.text());
    });

    it("o cliente não entra no mapa nem manda posição", async () => {
      const viagem = await viagemComPosicao();
      entrarComo("CLIENT");
      expect((await mapaRota.GET(req(), ctx(viagem.id))).status).toBe(403);
      entrarComo("CLIENT");
      expect((await mapaDoMotorista.GET(req(), ctx(viagem.id))).status).toBe(401);
      expect((await enviarPosicao(viagem.id, POSICAO, "CLIENT")).status).toBe(401);
    });
  });

  /* ---------------------------------- Isolamento --------------------------------- */

  describe("isolamento entre empresas", () => {
    async function viagemDaOutra() {
      const outra = banco.paraEmpresa(EMPRESA_OUTRA.id).db;
      const viagem = await outra.manifest.create({
        data: { driverId: daOutra.motoristaId, vehicleId: daOutra.veiculoId, status: "ROUTE", lastLat: -20.5, lastLon: -49.5, lastPositionAt: new Date() },
      });
      const carga = await outra.collection.create({
        data: { ...dadosDaCarga({ clientId: daOutra.clienteId, deliveryStreet: "Rua da Outra", deliveryLat: -20.6, deliveryLon: -49.6, geoSource: "ADDRESS" }), manifestId: viagem.id, driverId: daOutra.motoristaId } as never,
      });
      await outra.tripPosition.create({ data: { manifestId: viagem.id, lat: -20.5, lon: -49.5 } });
      return { id: viagem.id, cargaId: carga.id };
    }

    it("viagem de outra empresa não existe para o mapa, o roteiro e a posição desta", async () => {
      const alheia = await viagemDaOutra();

      entrarComo("ADMIN");
      expect((await mapaRota.GET(req(), ctx(alheia.id))).status).toBe(404);
      entrarComo("ADMIN");
      expect((await roteiroRota.POST(req("POST", {}), ctx(alheia.id))).status).toBe(404);
      entrarComo("DRIVER");
      expect((await mapaDoMotorista.GET(req(), ctx(alheia.id))).status).toBe(404);
      expect((await enviarPosicao(alheia.id, { lat: -20.1, lon: -49.1 })).status).toBe(404);

      expect(await banco.sistema.manifest.findUniqueOrThrow({ where: { id: alheia.id } })).toMatchObject({ lastLat: -20.5, lastLon: -49.5 });
      expect(await pontosDa(alheia.id)).toHaveLength(1);
    });

    it("o histórico de posições de uma empresa não aparece para a outra, e não aponta para viagem alheia", async () => {
      const alheia = await viagemDaOutra();
      const minha = await viajar("ROUTE");
      expect((await enviarPosicao(minha.id, { lat: -20.8, lon: -49.3 })).status).toBe(200);

      const daqui = await banco.default.tripPosition.findMany({ where: { manifestId: { in: [minha.id, alheia.id] } } });
      expect(daqui.map((p) => p.manifestId)).toEqual([minha.id]);
      const deLa = await banco.paraEmpresa(EMPRESA_OUTRA.id).db.tripPosition.findMany({ where: { manifestId: { in: [minha.id, alheia.id] } } });
      expect(deLa.map((p) => p.manifestId)).toEqual([alheia.id]);

      // O gatilho do banco recusa um ponto desta empresa apontando para a viagem da outra.
      await expect(banco.default.tripPosition.create({ data: { manifestId: alheia.id, lat: -20, lon: -49 } })).rejects.toThrow();
      expect(await pontosDa(alheia.id)).toHaveLength(1);
    });

    it("a lista de viagens do painel e a do motorista não trazem a viagem da outra empresa", async () => {
      const alheia = await viagemDaOutra();
      entrarComo("ADMIN");
      const doPainel = (await (await manifestosRota.GET()).json()) as { id: string }[];
      expect(doPainel.map((m) => m.id)).not.toContain(alheia.id);
      entrarComo("DRIVER");
      const doMotorista = (await (await viagensDoMotorista.GET()).json()) as { id: string }[];
      expect(doMotorista.map((m) => m.id)).not.toContain(alheia.id);
    });
  });
});
