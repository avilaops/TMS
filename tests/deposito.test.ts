import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getServerSession } from "next-auth";
import {
  DIAS_PARADO_ALERTA,
  MAX_VOLUMES_CONFERIVEIS,
  alertasDaCarga,
  alocarPosicaoSchema,
  buscarNoDeposito,
  cargaConferida,
  codigoDoVolume,
  contadoresDoDeposito,
  createLocationSchema,
  dataDeEntrada,
  diasParado,
  ehCodigoDePosicao,
  interpretarLeitura,
  normalizarPosicao,
  podeConferir,
  posicoesDaCarga,
  recusaDeConferencia,
  registrarVolumeSchema,
  registroDoVolume,
  resumoDaConferencia,
  sequenciasPendentes,
  updateLocationSchema,
  volumesDaCarga,
  type CargaConferida,
  type CargaLida,
  type CargaNoDeposito,
  type ContadoresDoDeposito,
} from "../src/lib/deposito";
import { EMPRESA_OUTRA, EMPRESA_PADRAO } from "./empresas-de-teste";

/**
 * Recebimento, conferência e depósito: as regras (puras) e as rotas contra um
 * Postgres de verdade, com duas empresas.
 */
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

describe("regras do depósito", () => {
  describe("códigos", () => {
    it("o código do volume é o rastreio da carga mais a sequência, com ao menos dois dígitos", () => {
      expect(codigoDoVolume("1234567890", 1)).toBe("1234567890-01");
      expect(codigoDoVolume("0000000123", 12)).toBe("0000000123-12");
      expect(codigoDoVolume("1234567890", 123)).toBe("1234567890-123");
    });

    it("a posição é comparada sem espaço e em maiúsculas, e precisa de ao menos uma letra", () => {
      expect(normalizarPosicao(" a-01 -03 ")).toBe("A-01-03");
      for (const codigo of ["A-01-03", "DOCA", "R1", "1A", "A1-B2-C3"]) expect(ehCodigoDePosicao(codigo), codigo).toBe(true);
      for (const codigo of ["", "1234567890", "01-03", "A--01", "-A", "A-", "A_01", "A.01", "Á-01", "a-01", "A".repeat(21)]) {
        expect(ehCodigoDePosicao(codigo), codigo).toBe(false);
      }
    });

    it("a leitura distingue carga, volume e posição pelo formato", () => {
      expect(interpretarLeitura(" 1234567890 ")).toEqual({ tipo: "CARGA", trackingCode: "1234567890" });
      expect(interpretarLeitura("1234567890-02")).toEqual({ tipo: "VOLUME", trackingCode: "1234567890", sequence: 2 });
      expect(interpretarLeitura("1234567890-2")).toEqual({ tipo: "VOLUME", trackingCode: "1234567890", sequence: 2 });
      expect(interpretarLeitura("1234567890-123")).toEqual({ tipo: "VOLUME", trackingCode: "1234567890", sequence: 123 });
      expect(interpretarLeitura("a-01-03")).toEqual({ tipo: "POSICAO", code: "A-01-03" });
      for (const texto of ["", "123", "12345678901", "1234567890-00", "1234567890-", "123456789-01", "???", "01-03"]) {
        expect(interpretarLeitura(texto), texto).toEqual({ tipo: "INVALIDO" });
      }
    });
  });

  describe("quem pode ser conferido", () => {
    it("carga confirmada ou coletada; as outras dizem por quê", () => {
      expect(podeConferir("CONFIRMED")).toBe(true);
      expect(podeConferir("COLLECTED")).toBe(true);
      for (const status of ["PENDING", "ROUTE", "DELIVERED", "CANCELLED", "REJECTED", "INVENTADO"]) expect(podeConferir(status), status).toBe(false);

      const carga = { status: "CONFIRMED", trackingCode: "1234567890", volumes: 3 };
      expect(recusaDeConferencia(carga)).toBeNull();
      expect(recusaDeConferencia({ ...carga, status: "PENDING" })).toMatch(/aguarda confirmação/);
      expect(recusaDeConferencia({ ...carga, status: "ROUTE" })).toBe("Esta carga já saiu para entrega.");
      expect(recusaDeConferencia({ ...carga, status: "DELIVERED" })).toBe("Esta carga já foi entregue.");
      expect(recusaDeConferencia({ ...carga, status: "CANCELLED" })).toBe("Esta carga foi cancelada.");
      expect(recusaDeConferencia({ ...carga, status: "INVENTADO" })).toBe("Esta carga não pode ser conferida.");
      expect(recusaDeConferencia({ ...carga, trackingCode: null })).toMatch(/não tem código de rastreio/);
      expect(recusaDeConferencia({ ...carga, volumes: MAX_VOLUMES_CONFERIVEIS })).toBeNull();
      expect(recusaDeConferencia({ ...carga, volumes: MAX_VOLUMES_CONFERIVEIS + 1 })).toMatch(/mais de 999 volumes/);
    });
  });

  describe("registro de volume", () => {
    const recebido = { status: "RECEIVED", weight: 10, damageNote: null } as const;

    it("leitura: volume novo fica recebido; repetida não conta duas vezes; faltante que apareceu passa a recebido", () => {
      expect(registroDoVolume(null, {})).toEqual({ repetido: false, dados: { status: "RECEIVED", weight: null, damageNote: null } });
      expect(registroDoVolume(recebido, {})).toEqual({ repetido: true, dados: recebido });
      const avariado = { status: "DAMAGED", weight: null, damageNote: "Caixa amassada" } as const;
      expect(registroDoVolume(avariado, {})).toEqual({ repetido: true, dados: avariado });
      expect(registroDoVolume({ status: "MISSING", weight: null, damageNote: null }, {})).toEqual({
        repetido: false,
        dados: { status: "RECEIVED", weight: null, damageNote: null },
      });
    });

    it("correção: vale o que veio; peso ausente fica como estava; faltando perde peso e avaria; recebido perde a avaria", () => {
      expect(registroDoVolume(recebido, { status: "DAMAGED", damageNote: "Rasgada" }).dados).toEqual({ status: "DAMAGED", weight: 10, damageNote: "Rasgada" });
      expect(registroDoVolume(recebido, { status: "RECEIVED", weight: 12.5 }).dados).toEqual({ status: "RECEIVED", weight: 12.5, damageNote: null });
      expect(registroDoVolume(recebido, { status: "RECEIVED", weight: null }).dados).toEqual({ status: "RECEIVED", weight: null, damageNote: null });
      expect(registroDoVolume({ status: "DAMAGED", weight: 3, damageNote: "Molhada" }, { status: "RECEIVED" }).dados).toEqual({
        status: "RECEIVED",
        weight: 3,
        damageNote: null,
      });
      expect(registroDoVolume(recebido, { status: "MISSING", weight: 9, damageNote: "x" })).toEqual({
        repetido: false,
        dados: { status: "MISSING", weight: null, damageNote: null },
      });
      expect(registroDoVolume(null, { status: "DAMAGED", weight: 4, damageNote: "Furada" }).dados).toEqual({ status: "DAMAGED", weight: 4, damageNote: "Furada" });
    });
  });

  describe("contas da conferência", () => {
    const linha = (sequence: number, status: string, weight: number | null = null) => ({ sequence, status, weight });

    it("nada conferido: tudo pendente, e o que não chegou é divergência de quantidade", () => {
      expect(resumoDaConferencia(3, 30, [])).toEqual({
        esperados: 3,
        recebidos: 0,
        avariados: 0,
        faltando: 0,
        pendentes: 3,
        pesoConferido: null,
        divergenciaDeQuantidade: true,
        divergenciaDePeso: false,
      });
    });

    it("avariado é volume presente: conta para a quantidade", () => {
      const resumo = resumoDaConferencia(3, 30, [linha(1, "RECEIVED"), linha(2, "DAMAGED"), linha(3, "RECEIVED")]);
      expect(resumo).toMatchObject({ recebidos: 2, avariados: 1, faltando: 0, pendentes: 0, divergenciaDeQuantidade: false });
    });

    it("volume faltando é divergência de quantidade, e aí o peso não é comparado", () => {
      const resumo = resumoDaConferencia(3, 30, [linha(1, "RECEIVED", 10), linha(2, "RECEIVED", 10), linha(3, "MISSING")]);
      expect(resumo).toMatchObject({ recebidos: 2, faltando: 1, pendentes: 0, pesoConferido: 20, divergenciaDeQuantidade: true, divergenciaDePeso: false });
    });

    it("peso: só há soma quando todo volume presente foi pesado, e a divergência respeita a tolerância de 2%", () => {
      expect(resumoDaConferencia(2, 30, [linha(1, "RECEIVED", 15), linha(2, "RECEIVED")])).toMatchObject({ pesoConferido: null, divergenciaDePeso: false });
      // 30 kg declarados: até 0,6 kg de diferença passa.
      expect(resumoDaConferencia(2, 30, [linha(1, "RECEIVED", 15), linha(2, "RECEIVED", 15.6)])).toMatchObject({ pesoConferido: 30.6, divergenciaDePeso: false });
      expect(resumoDaConferencia(2, 30, [linha(1, "RECEIVED", 15), linha(2, "RECEIVED", 15.7)])).toMatchObject({ pesoConferido: 30.7, divergenciaDePeso: true });
      expect(resumoDaConferencia(2, 30, [linha(1, "RECEIVED", 14), linha(2, "DAMAGED", 15)])).toMatchObject({ pesoConferido: 29, divergenciaDePeso: true });
      // Soma de decimais não deixa resto de ponto flutuante.
      expect(resumoDaConferencia(3, 0.6, [linha(1, "RECEIVED", 0.1), linha(2, "RECEIVED", 0.2), linha(3, "RECEIVED", 0.3)]).pesoConferido).toBe(0.6);
    });

    it("linha de sequência acima do declarado (a carga encolheu) não entra na conta", () => {
      const resumo = resumoDaConferencia(2, 20, [linha(1, "RECEIVED", 10), linha(2, "RECEIVED", 10), linha(3, "RECEIVED", 10)]);
      expect(resumo).toMatchObject({ esperados: 2, recebidos: 2, pendentes: 0, pesoConferido: 20, divergenciaDeQuantidade: false });
    });

    it("pendentes são as sequências sem linha", () => {
      expect(sequenciasPendentes(4, [{ sequence: 2 }, { sequence: 4 }])).toEqual([1, 3]);
      expect(sequenciasPendentes(2, [{ sequence: 1 }, { sequence: 2 }, { sequence: 9 }])).toEqual([]);
      expect(sequenciasPendentes(0, [])).toEqual([]);
    });
  });

  describe("carga com os volumes", () => {
    const lida: CargaLida = {
      id: "c1",
      trackingCode: "1234567890",
      status: "CONFIRMED",
      manifestId: null,
      sender: "Remetente",
      receiver: "Mercado",
      origin: "Rio Preto/SP",
      destination: "Mirassol/SP",
      volumes: 3,
      weight: 30,
      client: { id: "cli", companyName: "Cliente LTDA", tradeName: "Cliente" },
      warehouseReceipt: null,
      volumeItems: [
        { sequence: 2, code: "1234567890-02", status: "DAMAGED", weight: 9, damageNote: "Amassada", checkedAt: "2026-10-09T12:00:00.000Z", checkedBy: { id: "u", name: "Ana" }, location: { id: "p", code: "A-01" } },
      ],
    };

    it("lista um volume por sequência: o conferido com o que foi gravado, os outros a conferir com o código da etiqueta", () => {
      const volumes = volumesDaCarga(lida);
      expect(volumes.map((v) => [v.sequence, v.code, v.status])).toEqual([
        [1, "1234567890-01", "PENDING"],
        [2, "1234567890-02", "DAMAGED"],
        [3, "1234567890-03", "PENDING"],
      ]);
      expect(volumes[1]).toMatchObject({ weight: 9, damageNote: "Amassada", location: { code: "A-01" }, checkedBy: { name: "Ana" } });
      expect(volumes[0]).toMatchObject({ weight: null, checkedAt: null, location: null });
    });

    it("carga sem código de rastreio ou acima do teto não tem lista", () => {
      expect(volumesDaCarga({ ...lida, trackingCode: null })).toEqual([]);
      expect(volumesDaCarga({ ...lida, volumes: MAX_VOLUMES_CONFERIVEIS + 1 })).toEqual([]);
    });

    it("a resposta não leva dado financeiro e diz se a carga pode ser conferida", () => {
      const resposta = cargaConferida(lida);
      expect(Object.keys(resposta.carga).sort()).toEqual(
        ["cliente", "destination", "emManifesto", "id", "origin", "receiver", "sender", "status", "trackingCode", "volumes", "weight"].sort(),
      );
      expect(resposta.carga).toMatchObject({ cliente: "Cliente", emManifesto: false });
      expect(resposta.resumo).toMatchObject({ esperados: 3, avariados: 1, pendentes: 2 });
      expect(resposta.recusa).toBeNull();
      expect(cargaConferida({ ...lida, status: "ROUTE", manifestId: "m" })).toMatchObject({ recusa: "Esta carga já saiu para entrega.", carga: { emManifesto: true } });
    });
  });

  describe("visão do depósito", () => {
    const agora = new Date("2026-10-09T15:00:00.000Z");
    const volume = (status: string, posicao: string | null = null) => ({ status, location: posicao ? { code: posicao } : null });

    it("dias parado são dias inteiros desde a entrada", () => {
      expect(diasParado("2026-10-09T14:00:00.000Z", agora)).toBe(0);
      expect(diasParado("2026-10-08T15:00:00.000Z", agora)).toBe(1);
      expect(diasParado("2026-10-05T16:00:00.000Z", agora)).toBe(3);
      expect(diasParado("2026-10-05T15:00:00.000Z", agora)).toBe(4);
      // Relógio adiantado não vira dia negativo.
      expect(diasParado("2026-10-10T15:00:00.000Z", agora)).toBe(0);
    });

    it("a entrada é quando a carga passou para coletada; sem histórico, a conferência; sem ela, a última alteração", () => {
      const datas = { coletadaEm: "2026-10-01T00:00:00.000Z", conferidaEm: "2026-10-02T00:00:00.000Z", updatedAt: "2026-10-03T00:00:00.000Z" };
      expect(dataDeEntrada(datas)).toBe(datas.coletadaEm);
      expect(dataDeEntrada({ ...datas, coletadaEm: null })).toBe(datas.conferidaEm);
      expect(dataDeEntrada({ ...datas, coletadaEm: null, conferidaEm: null })).toBe(datas.updatedAt);
    });

    it("alertas: parada há mais de N dias, divergência de quantidade, avaria e sem posição", () => {
      const emOrdem = { dias: DIAS_PARADO_ALERTA, conferencia: { quantityDivergence: false }, volumeItems: [volume("RECEIVED", "A-01"), volume("RECEIVED", "A-02")] };
      expect(DIAS_PARADO_ALERTA).toBe(3);
      expect(alertasDaCarga(emOrdem)).toEqual([]);
      expect(alertasDaCarga({ ...emOrdem, dias: DIAS_PARADO_ALERTA + 1 })).toEqual(["PARADA"]);
      expect(alertasDaCarga({ ...emOrdem, conferencia: { quantityDivergence: true } })).toEqual(["DIVERGENCIA"]);
      expect(alertasDaCarga({ ...emOrdem, volumeItems: [volume("DAMAGED", "A-01")] })).toEqual(["AVARIA"]);
      expect(alertasDaCarga({ ...emOrdem, volumeItems: [volume("RECEIVED", "A-01"), volume("RECEIVED")] })).toEqual(["SEM_POSICAO"]);
      // Coletada sem passar pela conferência: nenhum volume em lugar nenhum.
      expect(alertasDaCarga({ dias: 0, conferencia: null, volumeItems: [] })).toEqual(["SEM_POSICAO"]);
      // Volume faltando não tem posição para cobrar.
      expect(alertasDaCarga({ ...emOrdem, conferencia: { quantityDivergence: true }, volumeItems: [volume("RECEIVED", "A-01"), volume("MISSING")] })).toEqual(["DIVERGENCIA"]);
      expect(alertasDaCarga({ dias: 9, conferencia: { quantityDivergence: true }, volumeItems: [volume("DAMAGED")] })).toEqual(["PARADA", "DIVERGENCIA", "AVARIA", "SEM_POSICAO"]);
    });

    it("posições da carga: sem repetir, em ordem, só de volume presente", () => {
      expect(posicoesDaCarga([volume("RECEIVED", "A-10"), volume("DAMAGED", "A-2"), volume("RECEIVED", "A-10"), volume("MISSING", "Z-1"), volume("RECEIVED")])).toEqual(["A-2", "A-10"]);
      expect(posicoesDaCarga([])).toEqual([]);
    });

    const carga = (dados: Partial<CargaNoDeposito>): CargaNoDeposito => ({
      id: "x",
      trackingCode: "1234567890",
      cliente: "Açúcar União",
      receiver: "Mercado",
      destination: "Mirassol/SP",
      volumes: 2,
      weight: 20,
      entrouEm: "2026-10-09T00:00:00.000Z",
      dias: 0,
      conferencia: null,
      posicoes: [],
      alertas: [],
      ...dados,
    });

    it("contadores: cargas, volumes declarados e quantas cargas em cada alerta", () => {
      const vazio: ContadoresDoDeposito = { cargas: 0, volumes: 0, PARADA: 0, DIVERGENCIA: 0, AVARIA: 0, SEM_POSICAO: 0 };
      expect(contadoresDoDeposito([])).toEqual(vazio);
      expect(
        contadoresDoDeposito([carga({ volumes: 2, alertas: ["PARADA", "SEM_POSICAO"] }), carga({ volumes: 5, alertas: ["SEM_POSICAO"] }), carga({ volumes: 1 })]),
      ).toEqual({ cargas: 3, volumes: 8, PARADA: 1, DIVERGENCIA: 0, AVARIA: 0, SEM_POSICAO: 2 });
    });

    it("busca por código (ou etiqueta de volume), cliente sem acento, ou posição", () => {
      const a = carga({ id: "a", trackingCode: "1111111111", cliente: "Açúcar União", posicoes: ["A-01-03"] });
      const b = carga({ id: "b", trackingCode: "2222222222", cliente: "Bebidas Sul", posicoes: ["B-02", "DOCA"] });
      const c = carga({ id: "c", trackingCode: null, cliente: "Casa Verde" });
      const todas = [a, b, c];
      const ids = (termo: string) => buscarNoDeposito(todas, termo).map((item) => item.id);

      expect(ids("  ")).toEqual(["a", "b", "c"]);
      expect(ids("1111")).toEqual(["a"]);
      expect(ids("2222222222-02")).toEqual(["b"]);
      expect(ids("acucar")).toEqual(["a"]);
      expect(ids("SUL")).toEqual(["b"]);
      expect(ids("a-01")).toEqual(["a"]);
      expect(ids("doca")).toEqual(["b"]);
      expect(ids("verde")).toEqual(["c"]);
      expect(ids("nada disso")).toEqual([]);
    });
  });

  describe("validação", () => {
    const erroDe = (schema: { safeParse: (v: unknown) => { success: boolean; error?: { issues: { message: string }[] } } }, valor: unknown) => {
      const lido = schema.safeParse(valor);
      return lido.success ? null : lido.error!.issues[0].message;
    };

    it("registro de volume: código ou sequência (um dos dois); correção pede a situação; avaria pede a observação", () => {
      expect(registrarVolumeSchema.parse({ codigo: " 1234567890-01 " })).toEqual({ codigo: "1234567890-01" });
      expect(registrarVolumeSchema.parse({ sequence: 2 })).toEqual({ sequence: 2 });
      expect(registrarVolumeSchema.parse({ sequence: 2, status: "DAMAGED", weight: "12,5", damageNote: " Caixa amassada " })).toEqual({
        sequence: 2,
        status: "DAMAGED",
        weight: 12.5,
        damageNote: "Caixa amassada",
      });
      expect(registrarVolumeSchema.parse({ sequence: 1, status: "RECEIVED", weight: "", damageNote: "" })).toEqual({ sequence: 1, status: "RECEIVED", weight: null, damageNote: null });

      expect(erroDe(registrarVolumeSchema, null)).toBe("Dados inválidos.");
      expect(erroDe(registrarVolumeSchema, {})).toBe("Informe o código ou o número do volume.");
      expect(erroDe(registrarVolumeSchema, { codigo: "1234567890-01", sequence: 1 })).toBe("Informe o código ou o número do volume.");
      expect(erroDe(registrarVolumeSchema, { sequence: 0 })).toBe("Número do volume inválido.");
      expect(erroDe(registrarVolumeSchema, { sequence: 1.5 })).toBe("Número do volume inválido.");
      expect(erroDe(registrarVolumeSchema, { sequence: 1000 })).toBe("Número do volume inválido.");
      expect(erroDe(registrarVolumeSchema, { sequence: 1, status: "PERDIDO" })).toBe("Situação inválida.");
      expect(erroDe(registrarVolumeSchema, { sequence: 1, weight: 10 })).toBe("Informe a situação do volume.");
      expect(erroDe(registrarVolumeSchema, { sequence: 1, damageNote: "x" })).toBe("Informe a situação do volume.");
      expect(erroDe(registrarVolumeSchema, { sequence: 1, status: "RECEIVED", weight: 0 })).toBe("O peso conferido precisa ser um número maior que zero.");
      expect(erroDe(registrarVolumeSchema, { sequence: 1, status: "RECEIVED", weight: "abc" })).toBe("O peso conferido precisa ser um número maior que zero.");
      expect(erroDe(registrarVolumeSchema, { sequence: 1, status: "DAMAGED" })).toBe("Descreva a avaria.");
      expect(erroDe(registrarVolumeSchema, { sequence: 1, status: "DAMAGED", damageNote: "  " })).toBe("Descreva a avaria.");
      expect(erroDe(registrarVolumeSchema, { sequence: 1, status: "DAMAGED", damageNote: "x".repeat(501) })).toBe("Descrição da avaria muito longa.");
    });

    it("alocação: a posição vem normalizada; em branco ou nula tira a posição; ausente é erro", () => {
      expect(alocarPosicaoSchema.parse({ locationCode: " a-01-03 " })).toEqual({ locationCode: "A-01-03" });
      expect(alocarPosicaoSchema.parse({ locationCode: "", sequences: [1, 2] })).toEqual({ locationCode: null, sequences: [1, 2] });
      expect(alocarPosicaoSchema.parse({ locationCode: null })).toEqual({ locationCode: null });
      expect(erroDe(alocarPosicaoSchema, {})).toMatch(/Código de posição inválido/);
      expect(erroDe(alocarPosicaoSchema, { locationCode: "1234567890" })).toMatch(/Código de posição inválido/);
      expect(erroDe(alocarPosicaoSchema, { locationCode: "A-01", sequences: [] })).toBe("Número do volume inválido.");
      expect(erroDe(alocarPosicaoSchema, { locationCode: "A-01", sequences: [0] })).toBe("Número do volume inválido.");
    });

    it("posição: código obrigatório e normalizado; descrição em branco vira nula; alteração pede ao menos um campo", () => {
      expect(createLocationSchema.parse({ code: " a-01-03 ", description: " Prateleira do fundo " })).toEqual({ code: "A-01-03", description: "Prateleira do fundo" });
      expect(createLocationSchema.parse({ code: "DOCA", description: "" })).toEqual({ code: "DOCA", description: null });
      expect(erroDe(createLocationSchema, {})).toMatch(/Código de posição inválido/);
      expect(erroDe(createLocationSchema, { code: "0123456789" })).toMatch(/Código de posição inválido/);
      expect(erroDe(createLocationSchema, { code: "A 01!" })).toMatch(/Código de posição inválido/);
      expect(erroDe(createLocationSchema, { code: "A-01", description: "x".repeat(121) })).toBe("Descrição muito longa.");

      expect(erroDe(updateLocationSchema, {})).toBe("Informe ao menos um campo para alterar.");
      expect(erroDe(updateLocationSchema, { active: "sim" })).toBe("Dados inválidos.");
      expect(updateLocationSchema.parse({ active: false })).toEqual({ active: false });
      expect(updateLocationSchema.parse({ code: "b-02", description: "" })).toEqual({ code: "B-02", description: null });
    });
  });
});

const temBanco = Boolean(process.env.DATABASE_URL);

if (!temBanco) {
  console.warn("\n[deposito.test] DATABASE_URL ausente: testes de integração PULADOS.\n");
}

const suite = temBanco ? describe : describe.skip;

const PREFIXO = "teste-deposito-";
const CNPJ = "99555111000144";
const CNPJ_DA_OUTRA = "99555111000225";
const CPF = "99555111001";
const PLACA = "DEP1A11";
const POSICAO_A = "TDEP-A-01";
const POSICAO_B = "TDEP-B-02";
const POSICAO_INATIVA = "TDEP-FECHADA";
const POSICAO_DA_OUTRA = "TDEP-OUTRA";
const RASTREIO = {
  CONFIRMADA: "9955511101",
  SEM_LEITURA: "9955511102",
  COLETADA: "9955511103",
  PENDENTE: "9955511104",
  EM_ROTA: "9955511105",
  EM_MANIFESTO: "9955511106",
  DA_OUTRA: "9955511107",
};
const SEM_ID = "00000000-0000-0000-0000-000000000000";
const HASH_FALSO = "$2b$10$hashfalsoparateste000000000000000000000000000000000";
const DIA = 86_400_000;

type Posicao = { id: string; code: string; description: string | null; active: boolean; _count: { volumes: number } };
type Visao = { diasDeAlerta: number; contadores: ContadoresDoDeposito; cargas: CargaNoDeposito[] };
type Conferida = CargaConferida & { error?: string; sequence?: number; repetido?: boolean; alocados?: number; sequenciaLida?: number | null };

suite("depósito: conferência, posições, visão e isolamento entre empresas", () => {
  let banco: typeof import("../src/lib/prisma");
  let visao: typeof import("../src/app/api/deposito/route");
  let busca: typeof import("../src/app/api/deposito/conferencia/route");
  let cargaRota: typeof import("../src/app/api/deposito/coletas/[id]/route");
  let volumes: typeof import("../src/app/api/deposito/coletas/[id]/volumes/route");
  let posicao: typeof import("../src/app/api/deposito/coletas/[id]/posicao/route");
  let concluir: typeof import("../src/app/api/deposito/coletas/[id]/concluir/route");
  let posicoes: typeof import("../src/app/api/deposito/posicoes/route");
  let posicaoPorId: typeof import("../src/app/api/deposito/posicoes/[id]/route");
  let statusDaColeta: typeof import("../src/app/api/dashboard/coletas/[id]/status/route");

  const sessao = vi.mocked(getServerSession);
  const ids = { ADMIN: "", OPERATION: "", CLIENT: "", DRIVER: "" };
  let adminDaOutra: string;
  let posicaoDaOutra: string;
  const cargas = { CONFIRMADA: "", SEM_LEITURA: "", COLETADA: "", PENDENTE: "", EM_ROTA: "", EM_MANIFESTO: "", DA_OUTRA: "" };

  const entrarComo = (quem: keyof typeof ids | null) => sessao.mockResolvedValue(quem ? { user: { id: ids[quem], role: quem, clientId: null } } : null);
  const entrarNaOutra = () => sessao.mockResolvedValue({ user: { id: adminDaOutra, role: "ADMIN", clientId: null, tenantId: EMPRESA_OUTRA.id } });

  const req = (method = "GET", body?: unknown, query = "") =>
    new Request(`http://localhost/api/teste${query ? `?${query}` : ""}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const responder = async <T>(res: Response) => ({ status: res.status, corpo: (await res.json()) as T & { error?: string } });

  const buscar = async (codigo: string) => responder<Conferida>(await busca.GET(req("GET", undefined, `codigo=${encodeURIComponent(codigo)}`)));
  const registrar = async (id: string, dados: Record<string, unknown>) => responder<Conferida>(await volumes.POST(req("POST", dados), ctx(id)));
  const alocar = async (id: string, dados: Record<string, unknown>) => responder<Conferida>(await posicao.POST(req("POST", dados), ctx(id)));
  const finalizar = async (id: string) => responder<Conferida>(await concluir.POST(req("POST"), ctx(id)));
  const verVisao = async () => responder<Visao>(await visao.GET());
  const situacoes = (corpo: Conferida) => corpo.volumes.map((v) => v.status);

  const historicoDe = (collectionId: string) =>
    banco.sistema.collectionStatusHistory.findMany({ where: { collectionId }, orderBy: { createdAt: "asc" }, select: { fromStatus: true, toStatus: true, userId: true } });

  async function limpar() {
    const { sistema } = banco;
    // Volumes, conferências e histórico vão junto com a carga.
    await sistema.collection.deleteMany({ where: { client: { cnpj: { in: [CNPJ, CNPJ_DA_OUTRA] } } } });
    await sistema.warehouseLocation.deleteMany({ where: { code: { startsWith: "TDEP-" } } });
    await sistema.manifest.deleteMany({ where: { vehicle: { plate: PLACA } } });
    await sistema.vehicle.deleteMany({ where: { plate: PLACA } });
    await sistema.driver.deleteMany({ where: { cpf: CPF } });
    await sistema.user.deleteMany({ where: { email: { startsWith: PREFIXO } } });
    await sistema.client.deleteMany({ where: { cnpj: { in: [CNPJ, CNPJ_DA_OUTRA] } } });
  }

  const carga = (clientId: string, trackingCode: string, status: string, extra: Record<string, unknown> = {}) => ({
    clientId,
    sender: "Remetente",
    receiver: "Mercado Bom Preço",
    origin: "Rio Preto/SP",
    destination: "Mirassol/SP",
    volumes: 3,
    weight: 30,
    status,
    trackingCode,
    // Dado financeiro que as rotas do depósito não podem devolver.
    invoiceValue: 98765.43,
    freightValue: 4321.09,
    ...extra,
  });

  beforeAll(async () => {
    banco = await import("../src/lib/prisma");
    visao = await import("../src/app/api/deposito/route");
    busca = await import("../src/app/api/deposito/conferencia/route");
    cargaRota = await import("../src/app/api/deposito/coletas/[id]/route");
    volumes = await import("../src/app/api/deposito/coletas/[id]/volumes/route");
    posicao = await import("../src/app/api/deposito/coletas/[id]/posicao/route");
    concluir = await import("../src/app/api/deposito/coletas/[id]/concluir/route");
    posicoes = await import("../src/app/api/deposito/posicoes/route");
    posicaoPorId = await import("../src/app/api/deposito/posicoes/[id]/route");
    statusDaColeta = await import("../src/app/api/dashboard/coletas/[id]/status/route");
    await limpar();

    const db = banco.default;
    const cliente = await db.client.create({ data: { companyName: `${PREFIXO}cliente ltda`, tradeName: `${PREFIXO}cliente`, cnpj: CNPJ } });
    for (const quem of Object.keys(ids) as (keyof typeof ids)[]) {
      ids[quem] = (
        await db.user.create({
          data: { name: `${PREFIXO}${quem}`, email: `${PREFIXO}${quem.toLowerCase()}@exemplo.br`, password: HASH_FALSO, role: quem, clientId: quem === "CLIENT" ? cliente.id : undefined },
        })
      ).id;
    }

    const motorista = await db.driver.create({ data: { userId: ids.DRIVER, cpf: CPF, cnh: "99555111001", cnhExpiry: new Date("2031-01-01T00:00:00.000Z"), category: "C" } });
    const veiculo = await db.vehicle.create({ data: { plate: PLACA, model: `${PREFIXO}caminhão`, type: "TRUCK" } });
    const viagem = await db.manifest.create({ data: { driverId: motorista.id, vehicleId: veiculo.id, status: "ASSEMBLING" } });

    cargas.CONFIRMADA = (await db.collection.create({ data: carga(cliente.id, RASTREIO.CONFIRMADA, "CONFIRMED") })).id;
    cargas.SEM_LEITURA = (await db.collection.create({ data: carga(cliente.id, RASTREIO.SEM_LEITURA, "CONFIRMED", { volumes: 2 }) })).id;
    cargas.PENDENTE = (await db.collection.create({ data: carga(cliente.id, RASTREIO.PENDENTE, "PENDING") })).id;
    cargas.EM_ROTA = (await db.collection.create({ data: carga(cliente.id, RASTREIO.EM_ROTA, "ROUTE") })).id;
    cargas.EM_MANIFESTO = (await db.collection.create({ data: carga(cliente.id, RASTREIO.EM_MANIFESTO, "COLLECTED", { manifestId: viagem.id }) })).id;
    // Dada como coletada pelo painel há cinco dias, sem passar pela conferência.
    cargas.COLETADA = (
      await db.collection.create({
        data: {
          ...carga(cliente.id, RASTREIO.COLETADA, "COLLECTED", { volumes: 2, weight: 20 }),
          statusHistory: { create: [{ fromStatus: "CONFIRMED", toStatus: "COLLECTED", createdAt: new Date(Date.now() - 5 * DIA - 60_000) }] },
        },
      })
    ).id;

    const outra = banco.paraEmpresa(EMPRESA_OUTRA.id).db;
    const clienteDaOutra = await outra.client.create({ data: { companyName: `${PREFIXO}cliente da outra`, cnpj: CNPJ_DA_OUTRA } });
    adminDaOutra = (await outra.user.create({ data: { name: `${PREFIXO}admin da outra`, email: `${PREFIXO}admin-outra@exemplo.br`, password: HASH_FALSO, role: "ADMIN" } })).id;
    cargas.DA_OUTRA = (await outra.collection.create({ data: carga(clienteDaOutra.id, RASTREIO.DA_OUTRA, "CONFIRMED") })).id;
    posicaoDaOutra = (await outra.warehouseLocation.create({ data: { code: POSICAO_DA_OUTRA } })).id;
  });

  beforeEach(() => {
    sessao.mockReset();
  });

  afterAll(async () => {
    if (banco) await limpar();
  });

  describe("permissão", () => {
    const todas = (): [string, () => Promise<Response>][] => [
      ["GET /api/deposito", () => visao.GET()],
      ["GET /api/deposito/conferencia", () => busca.GET(req("GET", undefined, `codigo=${RASTREIO.CONFIRMADA}`))],
      ["GET /api/deposito/coletas/[id]", () => cargaRota.GET(req(), ctx(cargas.CONFIRMADA))],
      ["POST /api/deposito/coletas/[id]/volumes", () => volumes.POST(req("POST", { sequence: 1 }), ctx(cargas.CONFIRMADA))],
      ["POST /api/deposito/coletas/[id]/posicao", () => posicao.POST(req("POST", { locationCode: null }), ctx(cargas.CONFIRMADA))],
      ["POST /api/deposito/coletas/[id]/concluir", () => concluir.POST(req("POST"), ctx(cargas.CONFIRMADA))],
      ["GET /api/deposito/posicoes", () => posicoes.GET()],
      ["POST /api/deposito/posicoes", () => posicoes.POST(req("POST", { code: "TDEP-INVASOR" }))],
      ["PATCH /api/deposito/posicoes/[id]", () => posicaoPorId.PATCH(req("PATCH", { active: false }), ctx(SEM_ID))],
    ];

    it("sem sessão é 401; cliente e motorista são 403; e nada é gravado", async () => {
      for (const [quem, esperado] of [[null, 401], ["CLIENT", 403], ["DRIVER", 403]] as const) {
        entrarComo(quem);
        for (const [nome, chamar] of todas()) expect((await chamar()).status, `${nome} como ${quem}`).toBe(esperado);
      }
      expect(await banco.sistema.collectionVolume.count({ where: { collectionId: cargas.CONFIRMADA } })).toBe(0);
      expect(await banco.sistema.warehouseLocation.count({ where: { code: "TDEP-INVASOR" } })).toBe(0);
    });

    it("administrador e operação entram", async () => {
      for (const quem of ["ADMIN", "OPERATION"] as const) {
        entrarComo(quem);
        expect((await visao.GET()).status, quem).toBe(200);
        expect((await posicoes.GET()).status, quem).toBe(200);
      }
    });
  });

  describe("posições", () => {
    it("valida o código, grava normalizado e recusa repetido na mesma empresa", async () => {
      entrarComo("OPERATION");
      for (const corpo of [null, {}, { code: "1234567890" }, { code: "A 01!" }]) {
        expect((await posicoes.POST(req("POST", corpo))).status, JSON.stringify(corpo)).toBe(400);
      }

      const criada = await responder<Posicao>(await posicoes.POST(req("POST", { code: " tdep-a-01 ", description: " Corredor A " })));
      expect(criada.status).toBe(201);
      expect(criada.corpo).toMatchObject({ code: POSICAO_A, description: "Corredor A", active: true, _count: { volumes: 0 } });

      const repetida = await responder<Posicao>(await posicoes.POST(req("POST", { code: POSICAO_A.toLowerCase() })));
      expect(repetida.status).toBe(409);
      expect(repetida.corpo.error).toBe("Já existe uma posição com este código.");

      expect((await posicoes.POST(req("POST", { code: POSICAO_B }))).status).toBe(201);
      expect((await posicoes.POST(req("POST", { code: POSICAO_INATIVA }))).status).toBe(201);
    });

    it("o mesmo código pode existir em outra empresa", async () => {
      entrarNaOutra();
      expect((await posicoes.POST(req("POST", { code: POSICAO_A }))).status).toBe(201);
    });

    it("altera descrição, código e situação; repetido é 409; id que não existe é 404", async () => {
      entrarComo("ADMIN");
      const lista = (await responder<Posicao[]>(await posicoes.GET())).corpo;
      const inativa = lista.find((p) => p.code === POSICAO_INATIVA)!;
      const b = lista.find((p) => p.code === POSICAO_B)!;

      expect((await posicaoPorId.PATCH(req("PATCH", {}), ctx(b.id))).status).toBe(400);
      expect((await posicaoPorId.PATCH(req("PATCH", { active: false }), ctx(SEM_ID))).status).toBe(404);

      const alterada = await responder<Posicao>(await posicaoPorId.PATCH(req("PATCH", { description: "Corredor B", active: true }), ctx(b.id)));
      expect(alterada.status).toBe(200);
      expect(alterada.corpo).toMatchObject({ code: POSICAO_B, description: "Corredor B", active: true });

      const conflito = await responder<Posicao>(await posicaoPorId.PATCH(req("PATCH", { code: POSICAO_A }), ctx(b.id)));
      expect(conflito.status).toBe(409);

      const desativada = await responder<Posicao>(await posicaoPorId.PATCH(req("PATCH", { active: false }), ctx(inativa.id)));
      expect(desativada.corpo.active).toBe(false);
    });

    it("lista as ativas primeiro, em ordem de código, e não mostra as de outra empresa", async () => {
      entrarComo("OPERATION");
      const minhas = (await responder<Posicao[]>(await posicoes.GET())).corpo.filter((p) => p.code.startsWith("TDEP-"));
      expect(minhas.map((p) => [p.code, p.active])).toEqual([
        [POSICAO_A, true],
        [POSICAO_B, true],
        [POSICAO_INATIVA, false],
      ]);
    });
  });

  describe("busca da carga pela leitura", () => {
    it("recusa o que não é código de carga nem etiqueta de volume", async () => {
      entrarComo("OPERATION");
      for (const codigo of ["", "123", POSICAO_A, "???"]) {
        const { status, corpo } = await buscar(codigo);
        expect(status, codigo).toBe(400);
        expect(corpo.error).toBe("Leia o código de rastreio da carga ou a etiqueta de um dos volumes dela.");
      }
    });

    it("código que não existe e código de carga de outra empresa respondem o mesmo 404", async () => {
      entrarComo("OPERATION");
      const inexistente = await buscar("0000000001");
      expect(inexistente.status).toBe(404);
      expect(inexistente.corpo.error).toBe("Nenhuma carga desta empresa com o código 0000000001.");

      const alheia = await buscar(RASTREIO.DA_OUTRA);
      expect(alheia.status).toBe(404);
      expect(alheia.corpo.error).toBe(`Nenhuma carga desta empresa com o código ${RASTREIO.DA_OUTRA}.`);
      expect((await buscar(`${RASTREIO.DA_OUTRA}-01`)).status).toBe(404);
    });

    it("pelo código de rastreio devolve a carga e os volumes esperados, sem dado financeiro", async () => {
      entrarComo("OPERATION");
      const { status, corpo } = await buscar(RASTREIO.CONFIRMADA);
      expect(status).toBe(200);
      expect(corpo.carga).toMatchObject({ id: cargas.CONFIRMADA, trackingCode: RASTREIO.CONFIRMADA, status: "CONFIRMED", cliente: `${PREFIXO}cliente`, volumes: 3, weight: 30, emManifesto: false });
      expect(corpo.volumes.map((v) => [v.code, v.status])).toEqual([
        [`${RASTREIO.CONFIRMADA}-01`, "PENDING"],
        [`${RASTREIO.CONFIRMADA}-02`, "PENDING"],
        [`${RASTREIO.CONFIRMADA}-03`, "PENDING"],
      ]);
      expect(corpo.resumo).toMatchObject({ esperados: 3, pendentes: 3 });
      expect(corpo.conferencia).toBeNull();
      expect(corpo.recusa).toBeNull();
      expect(corpo.sequenciaLida).toBeNull();

      const texto = JSON.stringify(corpo);
      expect(texto).not.toContain("98765.43");
      expect(texto).not.toContain("4321.09");
      expect(texto).not.toMatch(/invoiceValue|freightValue/);
    });

    it("pela etiqueta de um volume devolve a mesma carga e diz qual volume foi lido", async () => {
      entrarComo("ADMIN");
      const { status, corpo } = await buscar(`${RASTREIO.CONFIRMADA}-02`);
      expect(status).toBe(200);
      expect(corpo.carga.id).toBe(cargas.CONFIRMADA);
      expect(corpo.sequenciaLida).toBe(2);
    });

    it("carga que não pode ser conferida vem com o motivo", async () => {
      entrarComo("OPERATION");
      expect((await buscar(RASTREIO.PENDENTE)).corpo.recusa).toMatch(/aguarda confirmação/);
      expect((await buscar(RASTREIO.EM_ROTA)).corpo.recusa).toBe("Esta carga já saiu para entrega.");
    });

    it("a rota da carga por id devolve o mesmo, e 404 para id que não existe", async () => {
      entrarComo("OPERATION");
      const { status, corpo } = await responder<Conferida>(await cargaRota.GET(req(), ctx(cargas.CONFIRMADA)));
      expect(status).toBe(200);
      expect(corpo.volumes).toHaveLength(3);
      expect((await cargaRota.GET(req(), ctx(SEM_ID))).status).toBe(404);
    });
  });

  describe("conferência dos volumes", () => {
    it("ler a etiqueta marca o volume como recebido, com quem e quando", async () => {
      entrarComo("OPERATION");
      const { status, corpo } = await registrar(cargas.CONFIRMADA, { codigo: `${RASTREIO.CONFIRMADA}-01` });
      expect(status).toBe(200);
      expect(corpo).toMatchObject({ sequence: 1, repetido: false });
      expect(situacoes(corpo)).toEqual(["RECEIVED", "PENDING", "PENDING"]);
      expect(corpo.volumes[0]).toMatchObject({ code: `${RASTREIO.CONFIRMADA}-01`, checkedBy: { id: ids.OPERATION }, weight: null, location: null });
      expect(corpo.volumes[0].checkedAt).toBeTruthy();
      expect(corpo.resumo).toMatchObject({ recebidos: 1, pendentes: 2 });
      // Ler volume não conclui nada: a carga segue confirmada.
      expect(corpo.carga.status).toBe("CONFIRMED");
      expect(corpo.conferencia).toBeNull();
    });

    it("leitura repetida do mesmo volume não conta duas vezes", async () => {
      entrarComo("ADMIN");
      const antes = await banco.sistema.collectionVolume.findFirstOrThrow({ where: { collectionId: cargas.CONFIRMADA, sequence: 1 } });

      for (const leitura of [{ codigo: `${RASTREIO.CONFIRMADA}-01` }, { codigo: `${RASTREIO.CONFIRMADA}-1` }, { sequence: 1 }]) {
        const { status, corpo } = await registrar(cargas.CONFIRMADA, leitura);
        expect(status).toBe(200);
        expect(corpo).toMatchObject({ sequence: 1, repetido: true });
        expect(corpo.resumo).toMatchObject({ recebidos: 1, pendentes: 2 });
      }

      const depois = await banco.sistema.collectionVolume.findMany({ where: { collectionId: cargas.CONFIRMADA } });
      expect(depois).toHaveLength(1);
      // Quem conferiu primeiro continua sendo quem conferiu.
      expect(depois[0]).toMatchObject({ checkedById: ids.OPERATION, checkedAt: antes.checkedAt });
    });

    it("recusa etiqueta de outra carga da empresa, de outra empresa, e o que não é etiqueta", async () => {
      entrarComo("OPERATION");
      for (const codigo of [`${RASTREIO.SEM_LEITURA}-01`, `${RASTREIO.DA_OUTRA}-01`]) {
        const { status, corpo } = await registrar(cargas.CONFIRMADA, { codigo });
        expect(status, codigo).toBe(409);
        expect(corpo.error).toBe("Este volume não é desta carga. Confira a etiqueta.");
      }
      for (const codigo of [RASTREIO.CONFIRMADA, POSICAO_A, "abc"]) {
        const { status, corpo } = await registrar(cargas.CONFIRMADA, { codigo });
        expect(status, codigo).toBe(400);
        expect(corpo.error).toMatch(/não é a etiqueta de um volume/);
      }
      expect(await banco.sistema.collectionVolume.count({ where: { collectionId: { in: [cargas.SEM_LEITURA, cargas.DA_OUTRA] } } })).toBe(0);
    });

    it("recusa volume que a carga não tem", async () => {
      entrarComo("OPERATION");
      for (const leitura of [{ sequence: 4 }, { codigo: `${RASTREIO.CONFIRMADA}-04` }]) {
        const { status, corpo } = await registrar(cargas.CONFIRMADA, leitura);
        expect(status).toBe(400);
        expect(corpo.error).toBe("Esta carga tem 3 volume(s): não existe o volume 4.");
      }
    });

    it("valida a correção: avaria pede observação, peso pede situação", async () => {
      entrarComo("OPERATION");
      expect((await registrar(cargas.CONFIRMADA, {})).status).toBe(400);
      expect((await registrar(cargas.CONFIRMADA, { sequence: 2, status: "DAMAGED" })).corpo.error).toBe("Descreva a avaria.");
      expect((await registrar(cargas.CONFIRMADA, { sequence: 2, weight: 10 })).corpo.error).toBe("Informe a situação do volume.");
      expect((await registrar(cargas.CONFIRMADA, { sequence: 2, status: "RECEIVED", weight: -1 })).status).toBe(400);
    });

    it("registra avaria com observação e peso conferido", async () => {
      entrarComo("ADMIN");
      const { status, corpo } = await registrar(cargas.CONFIRMADA, { sequence: 2, status: "DAMAGED", weight: "9,5", damageNote: "Caixa amassada no canto" });
      expect(status).toBe(200);
      expect(corpo.repetido).toBe(false);
      expect(corpo.volumes[1]).toMatchObject({ status: "DAMAGED", weight: 9.5, damageNote: "Caixa amassada no canto", checkedBy: { id: ids.ADMIN } });
      expect(corpo.resumo).toMatchObject({ recebidos: 1, avariados: 1, pendentes: 1, pesoConferido: null });

      // Ler de novo a etiqueta do avariado não desfaz a avaria.
      const releitura = await registrar(cargas.CONFIRMADA, { codigo: `${RASTREIO.CONFIRMADA}-02` });
      expect(releitura.corpo.repetido).toBe(true);
      expect(releitura.corpo.volumes[1].status).toBe("DAMAGED");
    });

    it("não confere carga pendente, em rota, de outra empresa ou que não existe", async () => {
      entrarComo("OPERATION");
      const pendente = await registrar(cargas.PENDENTE, { sequence: 1 });
      expect(pendente.status).toBe(409);
      expect(pendente.corpo.error).toMatch(/aguarda confirmação/);
      expect((await registrar(cargas.EM_ROTA, { sequence: 1 })).status).toBe(409);
      expect((await registrar(cargas.DA_OUTRA, { sequence: 1 })).status).toBe(404);
      expect((await registrar(SEM_ID, { sequence: 1 })).status).toBe(404);
      expect(await banco.sistema.collectionVolume.count({ where: { collectionId: { in: [cargas.PENDENTE, cargas.EM_ROTA, cargas.DA_OUTRA] } } })).toBe(0);
    });
  });

  describe("posição dos volumes", () => {
    it("sem volume conferido não há o que alocar", async () => {
      entrarComo("OPERATION");
      const { status, corpo } = await alocar(cargas.SEM_LEITURA, { locationCode: POSICAO_A });
      expect(status).toBe(409);
      expect(corpo.error).toBe("Nenhum volume conferido para alocar. Confira os volumes primeiro.");
    });

    it("recusa posição que não existe, inativa ou de outra empresa", async () => {
      entrarComo("OPERATION");
      expect((await alocar(cargas.CONFIRMADA, {})).status).toBe(400);
      for (const locationCode of ["TDEP-NAO-EXISTE", POSICAO_INATIVA, POSICAO_DA_OUTRA]) {
        const { status, corpo } = await alocar(cargas.CONFIRMADA, { locationCode });
        expect(status, locationCode).toBe(400);
        expect(corpo.error).toBe("Posição não encontrada ou inativa.");
      }
    });

    it("aloca todos os volumes presentes de uma vez, pelo código da posição", async () => {
      entrarComo("OPERATION");
      const { status, corpo } = await alocar(cargas.CONFIRMADA, { locationCode: POSICAO_A.toLowerCase() });
      expect(status).toBe(200);
      expect(corpo.alocados).toBe(2);
      expect(corpo.volumes.map((v) => v.location?.code ?? null)).toEqual([POSICAO_A, POSICAO_A, null]);
    });

    it("aloca só os volumes pedidos, e não aceita volume que não foi conferido", async () => {
      entrarComo("ADMIN");
      const movido = await alocar(cargas.CONFIRMADA, { locationCode: POSICAO_B, sequences: [2] });
      expect(movido.status).toBe(200);
      expect(movido.corpo.alocados).toBe(1);
      expect(movido.corpo.volumes.map((v) => v.location?.code ?? null)).toEqual([POSICAO_A, POSICAO_B, null]);

      const pendente = await alocar(cargas.CONFIRMADA, { locationCode: POSICAO_B, sequences: [2, 3] });
      expect(pendente.status).toBe(409);
      expect(pendente.corpo.error).toBe("Só volume conferido e presente pode ir para uma posição.");
    });

    it("posição em branco tira o volume de onde está, e a lista de posições conta os volumes", async () => {
      entrarComo("OPERATION");
      const contagem = async () =>
        Object.fromEntries((await responder<Posicao[]>(await posicoes.GET())).corpo.filter((p) => p.code.startsWith("TDEP-")).map((p) => [p.code, p._count.volumes]));
      expect(await contagem()).toEqual({ [POSICAO_A]: 1, [POSICAO_B]: 1, [POSICAO_INATIVA]: 0 });

      const solto = await alocar(cargas.CONFIRMADA, { locationCode: "", sequences: [2] });
      expect(solto.status).toBe(200);
      expect(solto.corpo.volumes[1].location).toBeNull();
      expect(await contagem()).toEqual({ [POSICAO_A]: 1, [POSICAO_B]: 0, [POSICAO_INATIVA]: 0 });

      expect((await alocar(cargas.CONFIRMADA, { locationCode: POSICAO_B, sequences: [2] })).status).toBe(200);
    });
  });

  describe("concluir a conferência", () => {
    it("sem nenhum volume lido não conclui, e a carga segue confirmada", async () => {
      entrarComo("OPERATION");
      const { status, corpo } = await finalizar(cargas.SEM_LEITURA);
      expect(status).toBe(409);
      expect(corpo.error).toBe("Nenhum volume foi conferido. Leia ao menos um volume antes de concluir.");
      expect((await banco.sistema.collection.findUniqueOrThrow({ where: { id: cargas.SEM_LEITURA } })).status).toBe("CONFIRMED");
      expect(await banco.sistema.warehouseReceipt.count({ where: { collectionId: cargas.SEM_LEITURA } })).toBe(0);
    });

    it("não conclui carga pendente, de outra empresa ou que não existe", async () => {
      entrarComo("OPERATION");
      expect((await finalizar(cargas.PENDENTE)).status).toBe(409);
      expect((await finalizar(cargas.DA_OUTRA)).status).toBe(404);
      expect((await finalizar(SEM_ID)).status).toBe(404);
    });

    it("o que não foi lido fica faltando, a divergência é gravada e a carga confirmada passa para coletada com histórico", async () => {
      entrarComo("OPERATION");
      const { status, corpo } = await finalizar(cargas.CONFIRMADA);
      expect(status).toBe(200);
      expect(situacoes(corpo)).toEqual(["RECEIVED", "DAMAGED", "MISSING"]);
      expect(corpo.carga.status).toBe("COLLECTED");
      expect(corpo.conferencia).toMatchObject({
        expectedVolumes: 3,
        receivedVolumes: 1,
        damagedVolumes: 1,
        missingVolumes: 1,
        declaredWeight: 30,
        checkedWeight: null,
        quantityDivergence: true,
        weightDivergence: false,
        user: { id: ids.OPERATION },
      });
      expect(corpo.conferencia!.concludedAt).toBeTruthy();

      // O mesmo caminho do painel: uma linha no histórico, com quem fez.
      expect(await historicoDe(cargas.CONFIRMADA)).toEqual([{ fromStatus: "CONFIRMED", toStatus: "COLLECTED", userId: ids.OPERATION }]);
    });

    it("o faltante que aparece depois é lido, passa a recebido e a conferência gravada acompanha", async () => {
      entrarComo("ADMIN");
      const { status, corpo } = await registrar(cargas.CONFIRMADA, { codigo: `${RASTREIO.CONFIRMADA}-03` });
      expect(status).toBe(200);
      expect(corpo.repetido).toBe(false);
      expect(situacoes(corpo)).toEqual(["RECEIVED", "DAMAGED", "RECEIVED"]);
      expect(corpo.conferencia).toMatchObject({ receivedVolumes: 2, damagedVolumes: 1, missingVolumes: 0, quantityDivergence: false, user: { id: ids.OPERATION } });
    });

    it("com todos os volumes pesados, grava o peso conferido e a divergência de peso", async () => {
      entrarComo("OPERATION");
      await registrar(cargas.CONFIRMADA, { sequence: 1, status: "RECEIVED", weight: 10 });
      const { corpo } = await registrar(cargas.CONFIRMADA, { sequence: 3, status: "RECEIVED", weight: 12 });
      // 10 + 9,5 + 12 = 31,5 kg contra 30 declarados: 5% a mais.
      expect(corpo.resumo).toMatchObject({ pesoConferido: 31.5, divergenciaDePeso: true, divergenciaDeQuantidade: false });
      expect(corpo.conferencia).toMatchObject({ checkedWeight: 31.5, weightDivergence: true, quantityDivergence: false });

      const acertado = await registrar(cargas.CONFIRMADA, { sequence: 3, status: "RECEIVED", weight: 10.5 });
      expect(acertado.corpo.conferencia).toMatchObject({ checkedWeight: 30, weightDivergence: false });
      // A posição do volume sobrevive à correção do peso.
      expect(acertado.corpo.volumes[1].location?.code).toBe(POSICAO_B);
    });

    it("marcar como faltando tira o volume da posição", async () => {
      entrarComo("OPERATION");
      const { corpo } = await registrar(cargas.CONFIRMADA, { sequence: 2, status: "MISSING" });
      expect(corpo.volumes[1]).toMatchObject({ status: "MISSING", weight: null, damageNote: null, location: null });
      expect(corpo.conferencia).toMatchObject({ missingVolumes: 1, damagedVolumes: 0, quantityDivergence: true });

      // Volta a ser avariado, de novo na posição, para os testes da visão.
      await registrar(cargas.CONFIRMADA, { sequence: 2, status: "DAMAGED", weight: 9.5, damageNote: "Caixa amassada no canto" });
      const realocado = await alocar(cargas.CONFIRMADA, { locationCode: POSICAO_B, sequences: [2] });
      expect(realocado.corpo.volumes.map((v) => v.location?.code ?? null)).toEqual([POSICAO_A, POSICAO_B, null]);
    });

    it("concluir de novo refaz as contas, registra quem concluiu e não repete o histórico", async () => {
      entrarComo("ADMIN");
      const { status, corpo } = await finalizar(cargas.CONFIRMADA);
      expect(status).toBe(200);
      expect(corpo.conferencia).toMatchObject({ receivedVolumes: 2, damagedVolumes: 1, missingVolumes: 0, quantityDivergence: false, user: { id: ids.ADMIN } });
      expect(await historicoDe(cargas.CONFIRMADA)).toHaveLength(1);
      expect(await banco.sistema.warehouseReceipt.count({ where: { collectionId: cargas.CONFIRMADA } })).toBe(1);
    });

    it("carga já coletada pelo painel pode ser conferida depois, sem nova troca de status", async () => {
      entrarComo("OPERATION");
      const antes = await historicoDe(cargas.COLETADA);
      await registrar(cargas.COLETADA, { sequence: 1 });
      const { status, corpo } = await finalizar(cargas.COLETADA);
      expect(status).toBe(200);
      expect(corpo.carga.status).toBe("COLLECTED");
      expect(situacoes(corpo)).toEqual(["RECEIVED", "MISSING"]);
      expect(corpo.conferencia).toMatchObject({ expectedVolumes: 2, receivedVolumes: 1, missingVolumes: 1, quantityDivergence: true });
      expect(await historicoDe(cargas.COLETADA)).toEqual(antes);
    });

    it("o painel de minutas continua trocando o status pelo mesmo caminho", async () => {
      entrarComo("OPERATION");
      const res = await statusDaColeta.POST(req("POST", { status: "COLLECTED" }), ctx(cargas.SEM_LEITURA));
      expect(res.status).toBe(200);
      expect(await historicoDe(cargas.SEM_LEITURA)).toEqual([{ fromStatus: "CONFIRMED", toStatus: "COLLECTED", userId: ids.OPERATION }]);
    });
  });

  describe("visão do depósito", () => {
    it("mostra as cargas coletadas fora de manifesto, com posição, entrada, dias e alertas", async () => {
      entrarComo("OPERATION");
      const { status, corpo } = await verVisao();
      expect(status).toBe(200);
      expect(corpo.diasDeAlerta).toBe(3);

      const minhas = new Map(corpo.cargas.filter((c) => Object.values(cargas).includes(c.id)).map((c) => [c.id, c]));
      // Confirmada sem conferência concluída, pendente, em rota e em manifesto não estão no depósito.
      expect([...minhas.keys()].sort()).toEqual([cargas.CONFIRMADA, cargas.COLETADA, cargas.SEM_LEITURA].sort());

      const conferida = minhas.get(cargas.CONFIRMADA)!;
      expect(conferida).toMatchObject({ trackingCode: RASTREIO.CONFIRMADA, cliente: `${PREFIXO}cliente`, volumes: 3, dias: 0, posicoes: [POSICAO_A, POSICAO_B] });
      expect(conferida.conferencia).toMatchObject({ receivedVolumes: 2, damagedVolumes: 1, missingVolumes: 0, quantityDivergence: false });
      // Avariado, e o terceiro volume ainda sem posição.
      expect(conferida.alertas).toEqual(["AVARIA", "SEM_POSICAO"]);

      const parada = minhas.get(cargas.COLETADA)!;
      expect(parada.dias).toBe(5);
      expect(parada.alertas).toEqual(["PARADA", "DIVERGENCIA", "SEM_POSICAO"]);

      const semConferencia = minhas.get(cargas.SEM_LEITURA)!;
      expect(semConferencia).toMatchObject({ conferencia: null, posicoes: [], alertas: ["SEM_POSICAO"], dias: 0 });

      // Da mais antiga para a mais nova.
      const ordem = corpo.cargas.map((c) => new Date(c.entrouEm).getTime());
      expect(ordem).toEqual([...ordem].sort((a, b) => a - b));

      expect(corpo.contadores.cargas).toBe(corpo.cargas.length);
      expect(corpo.contadores.volumes).toBe(corpo.cargas.reduce((soma, c) => soma + c.volumes, 0));
      for (const alerta of ["PARADA", "DIVERGENCIA", "AVARIA", "SEM_POSICAO"] as const) {
        expect(corpo.contadores[alerta], alerta).toBe(corpo.cargas.filter((c) => c.alertas.includes(alerta)).length);
      }
      expect(corpo.contadores.PARADA).toBeGreaterThanOrEqual(1);
      expect(corpo.contadores.SEM_POSICAO).toBeGreaterThanOrEqual(3);

      const texto = JSON.stringify(corpo);
      expect(texto).not.toContain("98765.43");
      expect(texto).not.toMatch(/invoiceValue|freightValue/);
    });

    it("alocar o último volume tira o alerta de sem posição", async () => {
      entrarComo("OPERATION");
      await alocar(cargas.CONFIRMADA, { locationCode: POSICAO_A, sequences: [3] });
      const { corpo } = await verVisao();
      expect(corpo.cargas.find((c) => c.id === cargas.CONFIRMADA)!.alertas).toEqual(["AVARIA"]);
    });
  });

  describe("isolamento entre empresas", () => {
    it("a outra empresa não vê nem altera cargas, volumes e posições desta", async () => {
      entrarNaOutra();

      const { corpo: deLa } = await verVisao();
      expect(deLa.cargas.filter((c) => Object.values(cargas).includes(c.id))).toEqual([]);

      expect((await buscar(RASTREIO.CONFIRMADA)).status).toBe(404);
      expect((await cargaRota.GET(req(), ctx(cargas.CONFIRMADA))).status).toBe(404);
      expect((await registrar(cargas.CONFIRMADA, { sequence: 3, status: "MISSING" })).status).toBe(404);
      expect((await alocar(cargas.CONFIRMADA, { locationCode: null })).status).toBe(404);
      expect((await finalizar(cargas.CONFIRMADA)).status).toBe(404);

      const posicoesDeLa = (await responder<Posicao[]>(await posicoes.GET())).corpo.filter((p) => p.code.startsWith("TDEP-"));
      // A dela e a de mesmo código que ela criou; nenhuma desta empresa.
      expect(posicoesDeLa.map((p) => p.code).sort()).toEqual([POSICAO_A, POSICAO_DA_OUTRA].sort());
      expect(posicoesDeLa.every((p) => p._count.volumes === 0)).toBe(true);

      const daqui = await banco.sistema.warehouseLocation.findFirstOrThrow({ where: { tenantId: EMPRESA_PADRAO.id, code: POSICAO_B } });
      expect((await posicaoPorId.PATCH(req("PATCH", { active: false }), ctx(daqui.id))).status).toBe(404);
      expect((await banco.sistema.warehouseLocation.findUniqueOrThrow({ where: { id: daqui.id } })).active).toBe(true);

      // Nada mudou do lado de cá.
      const volumesDaqui = await banco.sistema.collectionVolume.findMany({ where: { collectionId: cargas.CONFIRMADA }, orderBy: { sequence: "asc" } });
      expect(volumesDaqui.map((v) => [v.status, v.tenantId])).toEqual([
        ["RECEIVED", EMPRESA_PADRAO.id],
        ["DAMAGED", EMPRESA_PADRAO.id],
        ["RECEIVED", EMPRESA_PADRAO.id],
      ]);
    });

    it("esta empresa não alcança a carga nem a posição da outra", async () => {
      entrarComo("ADMIN");
      const { corpo } = await verVisao();
      expect(corpo.cargas.some((c) => c.id === cargas.DA_OUTRA)).toBe(false);
      expect((await cargaRota.GET(req(), ctx(cargas.DA_OUTRA))).status).toBe(404);
      expect((await posicaoPorId.PATCH(req("PATCH", { description: "invadida" }), ctx(posicaoDaOutra))).status).toBe(404);
      expect((await banco.sistema.warehouseLocation.findUniqueOrThrow({ where: { id: posicaoDaOutra } })).description).toBeNull();
    });

    it("o banco recusa volume apontando para posição de outra empresa", async () => {
      const tentativa = banco.default.collectionVolume.updateMany({ where: { collectionId: cargas.CONFIRMADA, sequence: 1 }, data: { locationId: posicaoDaOutra } });
      await expect(tentativa).rejects.toThrow();
      const volume = await banco.sistema.collectionVolume.findFirstOrThrow({ where: { collectionId: cargas.CONFIRMADA, sequence: 1 }, select: { location: { select: { code: true } } } });
      expect(volume.location?.code).toBe(POSICAO_A);
    });
  });
});
