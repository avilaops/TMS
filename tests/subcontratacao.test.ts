import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getServerSession } from "next-auth";
import { aplicarSugestao, camposDaSugestao, entradasDoFormulario, FORMULARIO_EM_BRANCO } from "../src/app/dashboard/fiscal/mdfe/formulario";
import { digitoDaChave } from "../src/lib/chave-dfe";
import { sugestaoParaOMdfe, type SugestaoParaOMdfe } from "../src/lib/frete-contratado";
import { comoASubcontratadaLibera, faltasParaSair, fraseDoBloqueioDaSaida, type CargaNaSaida } from "../src/lib/mdfe";
import {
  CARGA_FORA_DA_VIAGEM,
  CARGA_MESSAGE,
  CHAVE_IMPOSSIVEL,
  CHAVE_MESSAGE,
  CONTRATO_TEM_DOCUMENTOS,
  DATA_NO_FUTURO,
  DOCUMENTO_JA_REGISTRADO,
  DOCUMENTO_NAO_ENCONTRADO,
  SEM_CONTRATO_COM_TRANSPORTADORA,
  UF_MESSAGE,
  VIAGEM_CANCELADA_SEM_DOCUMENTO,
  avisoDeCargasSemCte,
  avisoDeMdfeEmDobro,
  cargasSemCte,
  chaveDeOutroEmitente,
  chaveDeOutroModelo,
  contratoComTransportadora,
  dataForaDoMesDaChave,
  documentoSchema,
  mesDaChave,
  problemaDaChave,
  ufsComMdfeDaSubcontratada,
  ufsEmDobro,
  viagemSubcontratada,
  type DocumentoDaSubcontratada,
  type SubcontratacaoDaViagem,
} from "../src/lib/subcontratacao";
import { MANIFEST_NOT_FOUND_MESSAGE } from "../src/lib/manifestos";
import { EMPRESA_OUTRA, EMPRESA_PADRAO } from "./empresas-de-teste";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

// Documentos com os dígitos verificadores certos.
const CNPJ_DA_SUBCONTRATADA = "99777111000176";
const CNPJ_DA_SEGUNDA = "99777111000257";
const CNPJ_DA_SUBCONTRATADA_DA_OUTRA = "99777111000338";
const CPF_DO_AGREGADO = "99777111355";

/** Uma chave de acesso com o dígito verificador certo: UF 35 (SP), emitida em outubro de 2026 por padrão. */
function chave(modelo: "55" | "57" | "58", numero: number, cnpj = CNPJ_DA_SUBCONTRATADA, aamm = "2610"): string {
  const corpo = `35${aamm}${cnpj}${modelo}001${String(numero).padStart(9, "0")}1${String(numero).padStart(8, "0")}`;
  return `${corpo}${digitoDaChave(corpo)}`;
}

const AGORA = new Date("2026-10-12T15:00:00.000Z");
const PARCEIRO = { name: "Transportes Subcontratada", taxId: CNPJ_DA_SUBCONTRATADA };

/* --------------------------------- Regras puras -------------------------------- */

describe("regras da subcontratação contratada", () => {
  describe("chave do documento da subcontratada", () => {
    it("aceita o CT-e (57) e o MDF-e (58) emitidos pelo CNPJ do parceiro", () => {
      expect(problemaDaChave("CTE", chave("57", 10), PARCEIRO, AGORA)).toBeNull();
      expect(problemaDaChave("MDFE", chave("58", 11), PARCEIRO, AGORA)).toBeNull();
      // Sem o parceiro (o schema, antes da rota), só a forma da chave é conferida.
      expect(problemaDaChave("CTE", chave("57", 10, CNPJ_DA_SEGUNDA), null, AGORA)).toBeNull();
      expect(mesDaChave(chave("57", 10))).toBe("2026-10");
    });

    it("recusa tamanho ou dígito verificador errado, o modelo trocado e a chave de outro CNPJ", () => {
      const boa = chave("57", 10);
      expect(problemaDaChave("CTE", boa.slice(0, 43), PARCEIRO, AGORA)).toBe(CHAVE_MESSAGE);
      expect(problemaDaChave("CTE", `${boa.slice(0, 43)}${(Number(boa[43]) + 1) % 10}`, PARCEIRO, AGORA)).toBe(CHAVE_MESSAGE);
      // A NF-e não é o CT-e, o CT-e não é o MDF-e, e o MDF-e não é o CT-e.
      expect(problemaDaChave("CTE", chave("55", 10), PARCEIRO, AGORA)).toBe(chaveDeOutroModelo("CTE"));
      expect(problemaDaChave("MDFE", chave("57", 10), PARCEIRO, AGORA)).toBe(chaveDeOutroModelo("MDFE"));
      expect(problemaDaChave("CTE", chave("58", 10), PARCEIRO, AGORA)).toBe("A chave informada não é de CT-e (modelo 57).");
      expect(problemaDaChave("MDFE", chave("58", 10, CNPJ_DA_SEGUNDA), PARCEIRO, AGORA)).toBe(chaveDeOutroEmitente(PARCEIRO.name));
    });

    it("recusa a chave com mês, ano, número ou CNPJ que não existem", () => {
      expect(problemaDaChave("CTE", chave("57", 10, CNPJ_DA_SUBCONTRATADA, "2613"), PARCEIRO, AGORA)).toBe(CHAVE_IMPOSSIVEL);
      expect(problemaDaChave("CTE", chave("57", 10, CNPJ_DA_SUBCONTRATADA, "2710"), PARCEIRO, AGORA)).toBe(CHAVE_IMPOSSIVEL);
      expect(problemaDaChave("CTE", chave("57", 0), PARCEIRO, AGORA)).toBe(CHAVE_IMPOSSIVEL);
      expect(problemaDaChave("CTE", chave("57", 10, "99777111000100"), null, AGORA)).toBe(CHAVE_IMPOSSIVEL);
      // O MDF-e existe desde 2012; o CT-e, desde 2009.
      expect(problemaDaChave("MDFE", chave("58", 10, CNPJ_DA_SUBCONTRATADA, "1010"), PARCEIRO, AGORA)).toBe(CHAVE_IMPOSSIVEL);
      expect(problemaDaChave("CTE", chave("57", 10, CNPJ_DA_SUBCONTRATADA, "1010"), PARCEIRO, AGORA)).toBeNull();
    });
  });

  describe("validação do documento", () => {
    const erro = (corpo: unknown) => {
      const lido = documentoSchema.safeParse(corpo);
      return lido.success ? null : lido.error.issues[0].message;
    };
    const cte = { kind: "CTE", accessKey: chave("57", 20), collectionId: "carga-1", issuedAt: "2026-10-05" };
    const mdfe = { kind: "MDFE", accessKey: chave("58", 21), unloadState: "mg", issuedAt: "2026-10-05" };

    it("limpa a chave colada com espaços e guarda de cada documento só o que é dele", () => {
      const colada = chave("57", 20).replace(/(.{4})/g, "$1 ");
      expect(documentoSchema.parse({ ...cte, accessKey: colada, unloadState: "SP" })).toEqual({
        kind: "CTE",
        accessKey: chave("57", 20),
        collectionId: "carga-1",
        unloadState: null,
        issuedAt: new Date("2026-10-05T00:00:00.000Z"),
      });
      expect(documentoSchema.parse({ ...mdfe, collectionId: "carga-1" })).toMatchObject({ kind: "MDFE", collectionId: null, unloadState: "MG" });
    });

    it("o CT-e pede a carga; o MDF-e, a UF de descarga; a chave tem de ser do modelo do documento", () => {
      expect(erro({ ...cte, collectionId: "" })).toBe(CARGA_MESSAGE);
      expect(erro({ ...mdfe, unloadState: "" })).toBe(UF_MESSAGE);
      expect(erro({ ...mdfe, unloadState: "XX" })).toBe(UF_MESSAGE);
      expect(erro({ ...cte, accessKey: chave("58", 20) })).toBe(chaveDeOutroModelo("CTE"));
      expect(erro({ ...mdfe, accessKey: "123" })).toBe(CHAVE_MESSAGE);
      expect(erro({ ...cte, kind: "NFE" })).toBe("Informe se o documento é CT-e ou MDF-e.");
      expect(erro(null)).toBe("Dados inválidos.");
    });

    it("a data de emissão é do mês da chave e não fica no futuro", () => {
      expect(erro({ ...cte, issuedAt: "" })).toBe("Informe a data de emissão do documento.");
      expect(erro({ ...cte, issuedAt: "2026-09-30" })).toBe(dataForaDoMesDaChave(cte.accessKey));
      expect(dataForaDoMesDaChave(cte.accessKey)).toContain("10/2026");
      // O relógio parado em 12/10/2026: uma chave de dezembro do mesmo ano ainda é "possível", mas a data é futura.
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(AGORA);
      try {
        expect(erro({ ...cte, accessKey: chave("57", 20, CNPJ_DA_SUBCONTRATADA, "2612"), issuedAt: "2026-12-31" })).toBe(DATA_NO_FUTURO);
        expect(erro({ ...cte, issuedAt: "2026-10-13" })).toBe(DATA_NO_FUTURO);
        expect(erro({ ...cte, issuedAt: "2026-10-12" })).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("quando a viagem é subcontratada", () => {
    const contrato = (trocas: Record<string, unknown> = {}) => ({ status: "ABERTO", carrierId: "t1", carrier: { type: "TRANSPORTADORA" }, ...trocas });
    const veiculo = (carrier: { id: string; type: string } | null) => ({ carrier });

    it("registra documento só o contrato valendo com transportadora", () => {
      expect(contratoComTransportadora(contrato())).toBe(true);
      expect(contratoComTransportadora(contrato({ status: "QUITADO" }))).toBe(true);
      expect(contratoComTransportadora(contrato({ status: "CANCELADO" }))).toBe(false);
      expect(contratoComTransportadora(contrato({ carrier: { type: "TAC_AGREGADO" } }))).toBe(false);
      expect(contratoComTransportadora(contrato({ carrier: { type: "TAC_INDEPENDENTE" } }))).toBe(false);
      expect(contratoComTransportadora(null)).toBe(false);
    });

    it("o MDF-e dela só vale na viagem feita no veículo dela, com o contrato dela valendo", () => {
      expect(viagemSubcontratada(veiculo({ id: "t1", type: "TRANSPORTADORA" }), contrato())).toBe(true);
      // Veículo próprio com contrato feito à mão, veículo de outro parceiro, agregado e contrato cancelado: o MDF-e é meu.
      expect(viagemSubcontratada(veiculo(null), contrato())).toBe(false);
      expect(viagemSubcontratada(veiculo({ id: "t2", type: "TRANSPORTADORA" }), contrato())).toBe(false);
      expect(viagemSubcontratada(veiculo({ id: "a1", type: "TAC_AGREGADO" }), contrato({ carrierId: "a1", carrier: { type: "TAC_AGREGADO" } }))).toBe(false);
      expect(viagemSubcontratada(veiculo({ id: "i1", type: "TAC_INDEPENDENTE" }), contrato({ carrierId: "i1", carrier: { type: "TAC_INDEPENDENTE" } }))).toBe(false);
      expect(viagemSubcontratada(veiculo({ id: "t1", type: "TRANSPORTADORA" }), contrato({ status: "CANCELADO" }))).toBe(false);
      expect(viagemSubcontratada(veiculo({ id: "t1", type: "TRANSPORTADORA" }), null)).toBe(false);
    });
  });

  describe("o que falta e os avisos", () => {
    const documento = (trocas: Partial<DocumentoDaSubcontratada>): DocumentoDaSubcontratada => ({ id: "d", kind: "CTE", accessKey: chave("57", 1), collectionId: null, unloadState: null, issuedAt: "2026-10-05T00:00:00.000Z", ...trocas });

    it("carga sem CT-e da subcontratada: só as que saem do município", () => {
      const cargas = [
        { id: "a", codigo: "1001", precisaDeCte: true, ctes: [documento({ collectionId: "a" })] },
        { id: "b", codigo: "1002", precisaDeCte: true, ctes: [] },
        { id: "c", codigo: "1003", precisaDeCte: false, ctes: [] },
        { id: "d", codigo: "1004", precisaDeCte: true, ctes: [] },
      ];
      expect(cargasSemCte(cargas)).toEqual([
        { id: "b", codigo: "1002" },
        { id: "d", codigo: "1004" },
      ]);
      expect(avisoDeCargasSemCte([])).toBeNull();
      expect(avisoDeCargasSemCte([{ codigo: "1002" }])).toMatch(/^A carga 1002 está sem CT-e da subcontratada registrado\..*Convênio SINIEF 06\/89, art\. 17, § 7º.*contador/);
      expect(avisoDeCargasSemCte([{ codigo: "1002" }, { codigo: "1004" }, { codigo: "1005" }])).toContain("As cargas 1002, 1004 e 1005 estão sem CT-e");
    });

    it("UF coberta pelo MDF-e dela, sem repetir; e o aviso de MDF-e em dobro", () => {
      const documentos = [documento({ kind: "MDFE", unloadState: "RJ" }), documento({ kind: "MDFE", unloadState: "MG" }), documento({ kind: "MDFE", unloadState: "MG" }), documento({ kind: "CTE", unloadState: null })];
      expect(ufsComMdfeDaSubcontratada(documentos)).toEqual(["MG", "RJ"]);
      expect(ufsEmDobro(["MG", "GO"], ["MG", "RJ"])).toEqual(["MG"]);
      expect(avisoDeMdfeEmDobro([])).toBeNull();
      expect(avisoDeMdfeEmDobro(["MG"])).toMatch(/MDF-e seu e da subcontratada com descarga em MG.*cláusula terceira, § 6º/);
    });
  });

  describe("liberação da saída (função pura)", () => {
    const carga = (uf: string): CargaNaSaida => ({ id: uf, codigo: `c-${uf}`, ufDeOrigem: "SP", ufDeDestino: uf, mesmoMunicipio: false, cteAutorizado: true });
    const cargas = [carga("MG"), carga("RJ")];

    it("a UF coberta pelo MDF-e da subcontratada deixa de faltar; a que não tem MDF-e de ninguém falta, com o nome dela", () => {
      expect(faltasParaSair(cargas, "1", ["MG", "RJ"], ["MG"], "Subcontratada Ltda")).toEqual({ ctes: [], mdfe: { exigencia: "interestadual", ufs: ["RJ"] }, subcontratada: "Subcontratada Ltda" });
      expect(faltasParaSair(cargas, "1", ["MG", "RJ"], ["MG", "RJ"], "Subcontratada Ltda")).toEqual({ ctes: [], mdfe: null });
      // Sem subcontratada (veículo próprio, agregado, autônomo): o resultado é o de sempre.
      expect(faltasParaSair(cargas, "1", ["MG", "RJ"], ["MG"])).toEqual({ ctes: [], mdfe: { exigencia: "interestadual", ufs: ["RJ"] } });
    });

    it("o MEU CT-e continua exigido de cada carga, com ou sem subcontratada", () => {
      const semCte = [{ ...carga("MG"), cteAutorizado: false }];
      expect(faltasParaSair(semCte, "1", ["MG"], ["MG"], "Subcontratada Ltda")).toEqual({ ctes: [{ id: "MG", codigo: "c-MG" }], mdfe: null });
    });

    it("a frase do bloqueio diz que vale a chave do MDF-e dela", () => {
      const faltas = faltasParaSair(cargas, "1", ["MG", "RJ"], [], "Subcontratada Ltda");
      expect(fraseDoBloqueioDaSaida(faltas)).toBe(
        `A saída não foi liberada. Falta: MDF-e com descarga em MG e RJ autorizado. Os documentos têm de estar autorizados antes de o veículo sair (Ajustes SINIEF 09/07 e 21/10).${comoASubcontratadaLibera("Subcontratada Ltda")}`,
      );
      expect(fraseDoBloqueioDaSaida(faltasParaSair(cargas, "1", ["MG", "RJ"], []))).not.toContain("transportadora");
    });
  });

  describe("sugestão do contrato para o pagamento do frete no MDF-e", () => {
    const ZERADO = { grossAmount: 0, tollAmount: 0, otherAdditions: 0, discounts: 0, inss: 0, irrf: 0, sestSenat: 0, otherWithholdings: 0 };
    const contrato = (trocas: Record<string, unknown> = {}) => ({
      ...ZERADO,
      grossAmount: 1000,
      tollAmount: 100,
      discounts: 50,
      inss: 80,
      status: "ABERTO",
      payments: [] as { amount: number; kind: string; method: string }[],
      carrier: { name: "Transportes Subcontratada", taxId: CNPJ_DA_SUBCONTRATADA, pixKey: "pix@subcontratada.br" },
      ...trocas,
    });
    const PAGADOR = { nome: "Minha Transportadora Ltda", documento: "99000108000141" };

    it("valor do contrato é o custo (bruto + acréscimos − descontos: a retenção faz parte); sem pagamento é a prazo e sem adiantamento", () => {
      expect(sugestaoParaOMdfe(contrato(), PAGADOR)).toEqual({
        contratado: { nome: "Transportes Subcontratada", documento: CNPJ_DA_SUBCONTRATADA },
        pagador: PAGADOR,
        valor: 1050,
        adiantamento: 0,
        aPrazo: true,
        forma: null,
        pix: "pix@subcontratada.br",
      });
    });

    it("o adiantamento é a soma dos adiantamentos; a forma é a do último pagamento; quitado sem adiantamento é à vista", () => {
      const adiantado = sugestaoParaOMdfe(contrato({ status: "ADIANTADO", payments: [{ amount: 300, kind: "ADIANTAMENTO", method: "PIX" }, { amount: 100, kind: "ADIANTAMENTO", method: "DINHEIRO" }] }), null);
      expect(adiantado).toMatchObject({ pagador: null, valor: 1050, adiantamento: 400, aPrazo: true, forma: "DINHEIRO" });
      const quitado = sugestaoParaOMdfe(contrato({ status: "QUITADO", payments: [{ amount: 970, kind: "SALDO", method: "TRANSFERENCIA" }] }), PAGADOR);
      expect(quitado).toMatchObject({ adiantamento: 0, aPrazo: false, forma: "TRANSFERENCIA" });
    });

    it("sem contrato, com ele cancelado ou sem valor não há sugestão; chave Pix que não cabe no MDF-e não é sugerida", () => {
      expect(sugestaoParaOMdfe(null, PAGADOR)).toBeNull();
      expect(sugestaoParaOMdfe(contrato({ status: "CANCELADO" }), PAGADOR)).toBeNull();
      expect(sugestaoParaOMdfe(contrato({ ...ZERADO }), PAGADOR)).toBeNull();
      expect(sugestaoParaOMdfe(contrato({ carrier: { name: "X", taxId: CNPJ_DA_SUBCONTRATADA, pixKey: null } }), PAGADOR)?.pix).toBeNull();
      expect(sugestaoParaOMdfe(contrato({ carrier: { name: "X", taxId: CNPJ_DA_SUBCONTRATADA, pixKey: "x".repeat(61) } }), PAGADOR)?.pix).toBeNull();
    });

    const SUGESTAO: SugestaoParaOMdfe = { contratado: { nome: "Subcontratada", documento: CNPJ_DA_SUBCONTRATADA }, pagador: PAGADOR, valor: 1050.5, adiantamento: 400, aPrazo: true, forma: "PIX", pix: "pix@subcontratada.br" };

    it("os campos sugeridos, como texto de campo; à vista não sugere adiantamento (regra F63)", () => {
      expect(camposDaSugestao(SUGESTAO)).toEqual({ pagador: "99000108000141", pagadorNome: "Minha Transportadora Ltda", valorDoFrete: "1050,5", aPrazo: true, adiantamento: "400", pix: "pix@subcontratada.br" });
      expect(camposDaSugestao({ ...SUGESTAO, aPrazo: false })).toMatchObject({ aPrazo: false, adiantamento: "" });
      expect(camposDaSugestao({ ...SUGESTAO, pagador: null, pix: null })).toMatchObject({ pagador: "", pagadorNome: "", pix: "" });
    });

    it("a sugestão só entra no que vai para a rota depois de aceita, e não mexe no vencimento nem na conta sem Pix", () => {
      // Sem aceitar, o formulário em branco não manda o grupo de pagamento.
      expect(entradasDoFormulario(FORMULARIO_EM_BRANCO, false)).not.toHaveProperty("pagamento");
      const aceito = aplicarSugestao({ ...FORMULARIO_EM_BRANCO, vencimento: "2026-11-10" }, SUGESTAO);
      expect(aceito).toMatchObject({ pagador: "99000108000141", valorDoFrete: "1050,5", aPrazo: true, adiantamento: "400", conta: "pix", pix: "pix@subcontratada.br", vencimento: "2026-11-10" });
      expect(entradasDoFormulario(aceito, false).pagamento).toMatchObject({ documento: "99000108000141", valor: "1050,5", aPrazo: true, adiantamento: "400", conta: { pix: "pix@subcontratada.br" }, parcelas: [{ vencimento: "2026-11-10", valor: 650.5 }] });

      const comBanco = aplicarSugestao({ ...FORMULARIO_EM_BRANCO, conta: "banco", banco: "001", agencia: "1234" }, { ...SUGESTAO, pix: null });
      expect(comBanco).toMatchObject({ conta: "banco", banco: "001", agencia: "1234", pix: "" });
    });
  });
});

/* ------------------------------------ Rotas ----------------------------------- */

const temBanco = Boolean(process.env.DATABASE_URL);

if (!temBanco) {
  console.warn("\n[subcontratacao.test] DATABASE_URL ausente: testes de integração PULADOS.\nRode com um Postgres real para exercitá-los.\n");
}

const suite = temBanco ? describe : describe.skip;

// Tudo o que esta suite cria usa estes marcadores, e só isso é apagado.
const PREFIXO = "teste-subcontratacao-";
const CNPJ_DO_CLIENTE = "99777222000182";
const CNPJ_DO_CLIENTE_DA_OUTRA = "99777222000263";
const CNPJS_DE_CLIENTE = [CNPJ_DO_CLIENTE, CNPJ_DO_CLIENTE_DA_OUTRA];
const CPF_MOTORISTA = "77666777175";
const CPF_MOTORISTA_DA_OUTRA = "77666777256";
const CPFS_DE_MOTORISTA = [CPF_MOTORISTA, CPF_MOTORISTA_DA_OUTRA];
const PLACA_PROPRIA = "SBC1A23";
const PLACA_DA_SUBCONTRATADA = "SBC1A24";
const PLACA_DO_AGREGADO = "SBC1A25";
const PLACA_DA_OUTRA = "SBC1A26";
const PLACAS = [PLACA_PROPRIA, PLACA_DA_SUBCONTRATADA, PLACA_DO_AGREGADO, PLACA_DA_OUTRA];
const DOCUMENTOS = [CNPJ_DA_SUBCONTRATADA, CNPJ_DA_SEGUNDA, CNPJ_DA_SUBCONTRATADA_DA_OUTRA, CPF_DO_AGREGADO];
const HASH_FALSO = "$2b$10$hashfalsoparateste000000000000000000000000000000000";
const SEM_ID = "00000000-0000-0000-0000-000000000000";

type Corpo = Record<string, unknown> & { id: string; error?: string; aviso?: string | null };
type Perfil = "ADMIN" | "DIRECTOR" | "OPERATION" | "FINANCE" | "EXPEDITION" | "COMMERCIAL" | "CLIENT" | "DRIVER";
const PERFIS_DO_TESTE = ["ADMIN", "DIRECTOR", "OPERATION", "FINANCE", "EXPEDITION", "COMMERCIAL", "CLIENT", "DRIVER"] as const;

suite("rotas da subcontratação contratada", () => {
  let banco: typeof import("../src/lib/prisma");
  let rota: typeof import("../src/app/api/manifestos/[id]/subcontratacao/route");
  let documentoRota: typeof import("../src/app/api/manifestos/[id]/subcontratacao/[documentoId]/route");
  let freteRota: typeof import("../src/app/api/manifestos/[id]/frete/route");
  let pagamentosRota: typeof import("../src/app/api/manifestos/[id]/frete/pagamentos/route");
  let reciboRota: typeof import("../src/app/api/manifestos/[id]/frete/recibo/route");
  let sugestaoRota: typeof import("../src/app/api/manifestos/[id]/frete/sugestao-mdfe/route");

  const sessao = vi.mocked(getServerSession);
  const ids = {} as Record<Perfil, string>;
  let clienteId: string;
  let motoristaId: string;
  let veiculoProprioId: string;
  let veiculoDaSubcontratadaId: string;
  let veiculoDoAgregadoId: string;
  let subcontratadaId: string;
  let segundaId: string;
  let agregadoId: string;
  const daOutra = { parceiroId: "", veiculoId: "", motoristaId: "", clienteId: "", viagemId: "", contratoId: "", documentoId: "", cargaId: "" };

  const entrarComo = (perfil: Perfil | null) => sessao.mockResolvedValue(perfil ? { user: { id: ids[perfil], role: perfil, clientId: null } } : null);

  const req = (method = "GET", body?: unknown) =>
    new Request("http://localhost/api/teste", {
      method,
      headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.9" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const ctxDocumento = (id: string, documentoId: string) => ({ params: Promise.resolve({ id, documentoId }) });
  const nome = (n: string) => `${PREFIXO}${n}`;

  const chamar = async <T = Corpo>(resposta: Promise<Response>) => {
    const res = await resposta;
    return { status: res.status, corpo: (await res.json()) as T };
  };

  const trilha = (entityId: string) => banco.sistema.auditLog.findMany({ where: { entityId, action: { startsWith: "subcontratacao." } }, orderBy: { createdAt: "asc" }, select: { action: true, userId: true, summary: true, before: true, after: true } });
  const documentosDe = (manifestId: string) => banco.sistema.subcontractDocument.findMany({ where: { contract: { manifestId } }, orderBy: { createdAt: "asc" } });

  async function limparMovimento() {
    const { sistema } = banco;
    await sistema.collection.deleteMany({ where: { client: { cnpj: { in: CNPJS_DE_CLIENTE } } } });
    // O contrato, os pagamentos e os documentos da subcontratada somem com a viagem (ON DELETE CASCADE).
    await sistema.manifest.deleteMany({ where: { vehicle: { plate: { in: PLACAS } } } });
    await sistema.financialTransaction.deleteMany({ where: { counterparty: { startsWith: PREFIXO } } });
    await sistema.fiscalIssuer.deleteMany({ where: { legalName: { startsWith: PREFIXO } } });
    await sistema.auditLog.deleteMany({ where: { userName: { startsWith: PREFIXO } } });
  }

  async function limpar() {
    const { sistema } = banco;
    await limparMovimento();
    await sistema.vehicle.deleteMany({ where: { plate: { in: PLACAS } } });
    await sistema.driver.deleteMany({ where: { cpf: { in: CPFS_DE_MOTORISTA } } });
    await sistema.carrier.deleteMany({ where: { OR: [{ taxId: { in: DOCUMENTOS } }, { name: { startsWith: PREFIXO } }] } });
    await sistema.client.deleteMany({ where: { cnpj: { in: CNPJS_DE_CLIENTE } } });
    await sistema.user.deleteMany({ where: { email: { startsWith: PREFIXO } } });
  }

  const DESTINOS = ["Belo Horizonte - MG", "Mirassol - SP"];

  /**
   * Viagem gravada direto no banco, com uma carga por destino (de São José do
   * Rio Preto) e, quando se pede, o contrato de frete com o parceiro.
   */
  async function viajar(opcoes: { veiculoId?: string; parceiroId?: string | null; status?: string; destinos?: string[]; contrato?: Record<string, unknown> } = {}) {
    const db = banco.default;
    const viagem = await db.manifest.create({ data: { driverId: motoristaId, vehicleId: opcoes.veiculoId ?? veiculoDaSubcontratadaId, status: opcoes.status ?? "ROUTE" } });
    const cargas: { id: string; codigo: string }[] = [];
    for (const [indice, destino] of (opcoes.destinos ?? DESTINOS).entries()) {
      const codigo = `97${String(Date.now() % 1_000_000).padStart(6, "0")}${indice}${Math.floor(Math.random() * 10)}`;
      const carga = await db.collection.create({
        data: { clientId: clienteId, manifestId: viagem.id, driverId: motoristaId, sender: "Remetente", receiver: nome("destinatário"), origin: "São José do Rio Preto - SP", destination: destino, volumes: 1, weight: 10, status: "ROUTE", freightValue: 1000, trackingCode: codigo },
      });
      cargas.push({ id: carga.id, codigo });
    }
    const parceiroId = opcoes.parceiroId === undefined ? subcontratadaId : opcoes.parceiroId;
    const contrato = parceiroId ? await db.freightContract.create({ data: { manifestId: viagem.id, carrierId: parceiroId, calcMode: "FIXO", calcBase: 1000, grossAmount: 1000, ...opcoes.contrato } }) : null;
    return { id: viagem.id, cargas, contratoId: contrato?.id ?? "" };
  }

  const ler = (viagemId: string, perfil: Perfil = "OPERATION") => {
    entrarComo(perfil);
    return chamar<SubcontratacaoDaViagem & Corpo>(rota.GET(req(), ctx(viagemId)));
  };
  const registrar = (viagemId: string, corpo: Record<string, unknown>, perfil: Perfil = "OPERATION") => {
    entrarComo(perfil);
    return chamar<DocumentoDaSubcontratada & Corpo>(rota.POST(req("POST", { issuedAt: "2026-10-05", ...corpo }), ctx(viagemId)));
  };
  const excluir = (viagemId: string, documentoId: string, perfil: Perfil = "OPERATION") => {
    entrarComo(perfil);
    return chamar(documentoRota.DELETE(req("DELETE"), ctxDocumento(viagemId, documentoId)));
  };
  const sugerir = (viagemId: string, perfil: Perfil = "FINANCE") => {
    entrarComo(perfil);
    return chamar<{ sugestao: SugestaoParaOMdfe | null } & Corpo>(sugestaoRota.GET(req(), ctx(viagemId)));
  };

  beforeAll(async () => {
    banco = await import("../src/lib/prisma");
    rota = await import("../src/app/api/manifestos/[id]/subcontratacao/route");
    documentoRota = await import("../src/app/api/manifestos/[id]/subcontratacao/[documentoId]/route");
    freteRota = await import("../src/app/api/manifestos/[id]/frete/route");
    pagamentosRota = await import("../src/app/api/manifestos/[id]/frete/pagamentos/route");
    reciboRota = await import("../src/app/api/manifestos/[id]/frete/recibo/route");
    sugestaoRota = await import("../src/app/api/manifestos/[id]/frete/sugestao-mdfe/route");
    await limpar();

    const db = banco.default;
    for (const perfil of PERFIS_DO_TESTE) {
      ids[perfil] = (await db.user.create({ data: { name: nome(perfil), email: `${PREFIXO}${perfil.toLowerCase()}@exemplo.br`, password: HASH_FALSO, role: perfil } })).id;
    }
    clienteId = (await db.client.create({ data: { companyName: nome("cliente"), cnpj: CNPJ_DO_CLIENTE } })).id;
    const motorista = { cnh: "77666777101", cnhExpiry: new Date("2031-06-30"), category: "C" };
    motoristaId = (await db.driver.create({ data: { ...motorista, userId: ids.DRIVER, cpf: CPF_MOTORISTA } })).id;

    subcontratadaId = (await db.carrier.create({ data: { type: "TRANSPORTADORA", name: nome("Transportes Subcontratada"), taxId: CNPJ_DA_SUBCONTRATADA, rntrc: "12345678", state: "SP", pixKey: "pix@subcontratada.br" } })).id;
    segundaId = (await db.carrier.create({ data: { type: "TRANSPORTADORA", name: nome("Segunda Transportadora"), taxId: CNPJ_DA_SEGUNDA } })).id;
    agregadoId = (await db.carrier.create({ data: { type: "TAC_AGREGADO", name: nome("Agregado"), taxId: CPF_DO_AGREGADO } })).id;
    veiculoProprioId = (await db.vehicle.create({ data: { plate: PLACA_PROPRIA, model: nome("próprio"), type: "TRUCK" } })).id;
    veiculoDaSubcontratadaId = (await db.vehicle.create({ data: { plate: PLACA_DA_SUBCONTRATADA, model: nome("da subcontratada"), type: "TRUCK", carrierId: subcontratadaId } })).id;
    veiculoDoAgregadoId = (await db.vehicle.create({ data: { plate: PLACA_DO_AGREGADO, model: nome("do agregado"), type: "TRUCK", carrierId: agregadoId } })).id;

    const outra = banco.paraEmpresa(EMPRESA_OUTRA.id).db;
    const usuario = await outra.user.create({ data: { name: nome("motorista da outra"), email: `${PREFIXO}outra@exemplo.br`, password: HASH_FALSO, role: "DRIVER" } });
    daOutra.motoristaId = (await outra.driver.create({ data: { ...motorista, userId: usuario.id, cpf: CPF_MOTORISTA_DA_OUTRA } })).id;
    daOutra.parceiroId = (await outra.carrier.create({ data: { type: "TRANSPORTADORA", name: nome("subcontratada da outra"), taxId: CNPJ_DA_SUBCONTRATADA_DA_OUTRA } })).id;
    daOutra.veiculoId = (await outra.vehicle.create({ data: { plate: PLACA_DA_OUTRA, model: nome("da outra"), type: "TRUCK", carrierId: daOutra.parceiroId } })).id;
    daOutra.clienteId = (await outra.client.create({ data: { companyName: nome("cliente da outra"), cnpj: CNPJ_DO_CLIENTE_DA_OUTRA } })).id;
  }, 120_000);

  beforeEach(async () => {
    sessao.mockReset();
    await limparMovimento();

    // A viagem da outra empresa, com contrato de 7.777 e um MDF-e da subcontratada dela registrado.
    const outra = banco.paraEmpresa(EMPRESA_OUTRA.id).db;
    const viagem = await outra.manifest.create({ data: { driverId: daOutra.motoristaId, vehicleId: daOutra.veiculoId, status: "ROUTE" } });
    daOutra.viagemId = viagem.id;
    daOutra.cargaId = (
      await outra.collection.create({ data: { clientId: daOutra.clienteId, manifestId: viagem.id, sender: "Remetente", receiver: nome("da outra"), origin: "São José do Rio Preto - SP", destination: "Belo Horizonte - MG", volumes: 1, weight: 10, status: "ROUTE", freightValue: 8888 } })
    ).id;
    daOutra.contratoId = (await outra.freightContract.create({ data: { manifestId: viagem.id, carrierId: daOutra.parceiroId, calcMode: "FIXO", calcBase: 7777, grossAmount: 7777 } })).id;
    daOutra.documentoId = (
      await outra.subcontractDocument.create({ data: { contractId: daOutra.contratoId, kind: "MDFE", accessKey: chave("58", 900, CNPJ_DA_SUBCONTRATADA_DA_OUTRA), unloadState: "MG", issuedAt: new Date("2026-10-05T00:00:00.000Z") } })
    ).id;
  });

  afterAll(async () => {
    if (banco) await limpar();
  });

  /* --------------------------------- Permissão -------------------------------- */

  describe("permissão por perfil", () => {
    it("sem sessão é 401 em tudo; cliente e motorista levam 403", async () => {
      const viagem = await viajar();
      const rotas: [string, () => Promise<Response>][] = [
        ["GET /api/manifestos/[id]/subcontratacao", () => rota.GET(req(), ctx(viagem.id))],
        ["POST /api/manifestos/[id]/subcontratacao", () => rota.POST(req("POST", {}), ctx(viagem.id))],
        ["DELETE /api/manifestos/[id]/subcontratacao/[documentoId]", () => documentoRota.DELETE(req("DELETE"), ctxDocumento(viagem.id, SEM_ID))],
        ["GET /api/manifestos/[id]/frete/sugestao-mdfe", () => sugestaoRota.GET(req(), ctx(viagem.id))],
      ];
      entrarComo(null);
      for (const [caminho, chamada] of rotas) expect((await chamada()).status, caminho).toBe(401);
      for (const perfil of ["CLIENT", "DRIVER"] as const) {
        entrarComo(perfil);
        for (const [caminho, chamada] of rotas) expect((await chamada()).status, `${perfil} em ${caminho}`).toBe(403);
      }
    });

    it("os documentos são fiscais: quem lê o fiscal lê (a operação e o financeiro), quem escreve no fiscal registra e exclui", async () => {
      const viagem = await viajar();
      for (const perfil of ["ADMIN", "DIRECTOR", "OPERATION", "FINANCE", "EXPEDITION"] as const) expect((await ler(viagem.id, perfil)).status, perfil).toBe(200);
      expect((await ler(viagem.id, "COMMERCIAL")).status).toBe(403);

      const mdfe = { kind: "MDFE", accessKey: chave("58", 100), unloadState: "MG" };
      for (const perfil of ["FINANCE", "EXPEDITION", "COMMERCIAL"] as const) expect((await registrar(viagem.id, mdfe, perfil)).status, perfil).toBe(403);
      expect(await documentosDe(viagem.id)).toHaveLength(0);

      const registrado = await registrar(viagem.id, mdfe, "OPERATION");
      expect(registrado.status).toBe(201);
      for (const perfil of ["FINANCE", "EXPEDITION"] as const) expect((await excluir(viagem.id, registrado.corpo.id, perfil)).status, perfil).toBe(403);
      expect(await documentosDe(viagem.id)).toHaveLength(1);
      expect((await excluir(viagem.id, registrado.corpo.id, "DIRECTOR")).status).toBe(200);
    });

    it("a leitura dos documentos não leva valor nenhum do contrato (a operação não lê o frete contratado)", async () => {
      const viagem = await viajar({ contrato: { grossAmount: 4321.09, calcBase: 4321.09 } });
      const { status, corpo } = await ler(viagem.id, "OPERATION");
      expect(status).toBe(200);
      expect(JSON.stringify(corpo)).not.toContain("4321");
      expect(Object.keys(corpo).sort()).toEqual(["cargas", "mdfes", "noVeiculoDela", "parceiro", "semCte", "ufsDeDescarga", "ufsEmDobro", "viagem"]);
      entrarComo("OPERATION");
      expect((await freteRota.GET(req(), ctx(viagem.id))).status).toBe(403);
    });

    it("a sugestão para o MDF-e é dinheiro: a operação e a expedição levam 403 e não recebem valor; diretoria, financeiro e administração recebem", async () => {
      const viagem = await viajar({ contrato: { grossAmount: 4321.09 } });
      for (const perfil of ["OPERATION", "EXPEDITION", "COMMERCIAL"] as const) {
        const { status, corpo } = await sugerir(viagem.id, perfil);
        expect(status, perfil).toBe(403);
        expect(corpo, perfil).toEqual({ error: "Acesso negado" });
        expect(JSON.stringify(corpo)).not.toContain("4321");
      }
      for (const perfil of ["ADMIN", "DIRECTOR", "FINANCE"] as const) {
        const { status, corpo } = await sugerir(viagem.id, perfil);
        expect(status, perfil).toBe(200);
        expect(corpo.sugestao?.valor, perfil).toBe(4321.09);
      }
    });
  });

  /* --------------------------------- Validação -------------------------------- */

  describe("validação", () => {
    it("400 para chave, modelo, carga, UF e data inválidos; nada é gravado", async () => {
      const viagem = await viajar();
      const [carga] = viagem.cargas;
      const cte = { kind: "CTE", accessKey: chave("57", 200), collectionId: carga.id };
      const casos: [Record<string, unknown>, string][] = [
        [{ ...cte, accessKey: "1234" }, CHAVE_MESSAGE],
        [{ ...cte, accessKey: chave("55", 200) }, chaveDeOutroModelo("CTE")],
        [{ ...cte, accessKey: chave("58", 200) }, chaveDeOutroModelo("CTE")],
        [{ ...cte, collectionId: "" }, CARGA_MESSAGE],
        [{ ...cte, issuedAt: "2026-09-30" }, dataForaDoMesDaChave(cte.accessKey)],
        [{ kind: "MDFE", accessKey: chave("58", 201), unloadState: "" }, UF_MESSAGE],
        [{ kind: "MDFE", accessKey: chave("57", 201), unloadState: "MG" }, chaveDeOutroModelo("MDFE")],
      ];
      for (const [corpo, mensagem] of casos) {
        const resposta = await registrar(viagem.id, corpo);
        expect(resposta.status, mensagem).toBe(400);
        expect(resposta.corpo.error).toBe(mensagem);
      }
      entrarComo("OPERATION");
      expect((await rota.POST(new Request("http://localhost/api/teste", { method: "POST", body: "{" }), ctx(viagem.id))).status).toBe(400);
      expect(await documentosDe(viagem.id)).toHaveLength(0);
    });

    it("400 para a chave emitida por outro CNPJ e para a carga que não é da viagem", async () => {
      const viagem = await viajar();
      const outraViagem = await viajar({ veiculoId: veiculoProprioId, parceiroId: null });
      const parceiro = nome("Transportes Subcontratada");

      const deOutroCnpj = await registrar(viagem.id, { kind: "MDFE", accessKey: chave("58", 210, CNPJ_DA_SEGUNDA), unloadState: "MG" });
      expect(deOutroCnpj.status).toBe(400);
      expect(deOutroCnpj.corpo.error).toBe(chaveDeOutroEmitente(parceiro));

      for (const collectionId of [outraViagem.cargas[0].id, daOutra.cargaId, SEM_ID]) {
        const resposta = await registrar(viagem.id, { kind: "CTE", accessKey: chave("57", 211), collectionId });
        expect(resposta.status, collectionId).toBe(400);
        expect(resposta.corpo.error).toBe(CARGA_FORA_DA_VIAGEM);
      }
      expect(await documentosDe(viagem.id)).toHaveLength(0);
    });

    it("409 sem contrato valendo com transportadora: viagem sem contrato, contrato com agregado, contrato cancelado e viagem cancelada", async () => {
      const mdfe = { kind: "MDFE", accessKey: chave("58", 220), unloadState: "MG" };
      const semContrato = await viajar({ veiculoId: veiculoProprioId, parceiroId: null });
      const comAgregado = await viajar({ veiculoId: veiculoDoAgregadoId, parceiroId: agregadoId });
      const cancelado = await viajar({ contrato: { status: "CANCELADO" } });
      for (const viagem of [semContrato, comAgregado, cancelado]) {
        const resposta = await registrar(viagem.id, mdfe);
        expect(resposta.status).toBe(409);
        expect(resposta.corpo.error).toBe(SEM_CONTRATO_COM_TRANSPORTADORA);
        // A leitura diz que não há subcontratada, e a tela não mostra o bloco.
        expect((await ler(viagem.id)).corpo).toMatchObject({ parceiro: null, noVeiculoDela: false, mdfes: [], semCte: [] });
      }

      const viagemCancelada = await viajar({ status: "CANCELLED" });
      const recusada = await registrar(viagemCancelada.id, mdfe);
      expect(recusada.status).toBe(409);
      expect(recusada.corpo.error).toBe(VIAGEM_CANCELADA_SEM_DOCUMENTO);
      expect(await banco.sistema.subcontractDocument.count({ where: { accessKey: mdfe.accessKey } })).toBe(0);
    });
  });

  /* ------------------------------- Caminho feliz ------------------------------ */

  describe("registro, leitura e exclusão", () => {
    it("registra o CT-e dela por carga e o MDF-e dela por UF, com data e auditoria; a leitura diz o que falta", async () => {
      const viagem = await viajar({ destinos: ["Belo Horizonte - MG", "Mirassol - SP", "São José do Rio Preto - SP"] });
      const [paraMg, paraMirassol, municipal] = viagem.cargas;

      const antes = await ler(viagem.id);
      expect(antes.corpo).toMatchObject({ parceiro: { id: subcontratadaId, name: nome("Transportes Subcontratada"), taxId: CNPJ_DA_SUBCONTRATADA }, noVeiculoDela: true, mdfes: [], ufsEmDobro: [] });
      // A carga que não sai do município não tem CT-e: não entra no que falta.
      expect(antes.corpo.cargas.map((carga) => [carga.codigo, carga.precisaDeCte])).toEqual([[paraMg.codigo, true], [paraMirassol.codigo, true], [municipal.codigo, false]]);
      expect(antes.corpo.semCte).toEqual([{ id: paraMg.id, codigo: paraMg.codigo }, { id: paraMirassol.id, codigo: paraMirassol.codigo }]);

      const cte = await registrar(viagem.id, { kind: "CTE", accessKey: chave("57", 300).replace(/(.{4})/g, "$1 "), collectionId: paraMg.id, issuedAt: "2026-10-03" });
      expect(cte.status).toBe(201);
      expect(cte.corpo).toMatchObject({ kind: "CTE", accessKey: chave("57", 300), collectionId: paraMg.id, unloadState: null, issuedAt: "2026-10-03T00:00:00.000Z" });
      const mdfe = await registrar(viagem.id, { kind: "MDFE", accessKey: chave("58", 301), unloadState: "mg", issuedAt: "2026-10-04" }, "ADMIN");
      expect(mdfe.status).toBe(201);
      expect(mdfe.corpo).toMatchObject({ kind: "MDFE", collectionId: null, unloadState: "MG" });

      const depois = await ler(viagem.id, "FINANCE");
      expect(depois.corpo.cargas[0].ctes).toEqual([{ id: cte.corpo.id, kind: "CTE", accessKey: chave("57", 300), collectionId: paraMg.id, unloadState: null, issuedAt: "2026-10-03T00:00:00.000Z" }]);
      expect(depois.corpo.mdfes).toEqual([{ id: mdfe.corpo.id, kind: "MDFE", accessKey: chave("58", 301), collectionId: null, unloadState: "MG", issuedAt: "2026-10-04T00:00:00.000Z" }]);
      expect(depois.corpo.semCte).toEqual([{ id: paraMirassol.id, codigo: paraMirassol.codigo }]);

      const gravados = await documentosDe(viagem.id);
      expect(gravados.map((documento) => [documento.kind, documento.tenantId, documento.createdById])).toEqual([["CTE", EMPRESA_PADRAO.id, ids.OPERATION], ["MDFE", EMPRESA_PADRAO.id, ids.ADMIN]]);
      const linhas = await trilha(viagem.contratoId);
      expect(linhas).toHaveLength(2);
      expect(linhas[0]).toMatchObject({ action: "subcontratacao.registrar", userId: ids.OPERATION, after: { kind: "CTE", accessKey: chave("57", 300), collectionId: paraMg.id } });
      expect(linhas[0].summary).toContain(`CT-e da subcontratada ${nome("Transportes Subcontratada")}`);
      expect(linhas[0].summary).toContain(`carga ${paraMg.codigo}`);
      expect(linhas[1]).toMatchObject({ action: "subcontratacao.registrar", userId: ids.ADMIN, after: { kind: "MDFE", unloadState: "MG" } });
      expect(linhas[1].summary).toContain("descarga em MG");
    });

    it("o mesmo CT-e dela pode cobrir duas cargas; a mesma chave duas vezes na mesma carga (ou o mesmo MDF-e) é 409", async () => {
      const viagem = await viajar();
      const [primeira, segunda] = viagem.cargas;
      const cte = { kind: "CTE", accessKey: chave("57", 310) };
      expect((await registrar(viagem.id, { ...cte, collectionId: primeira.id })).status).toBe(201);
      expect((await registrar(viagem.id, { ...cte, collectionId: segunda.id })).status).toBe(201);
      const repetido = await registrar(viagem.id, { ...cte, collectionId: primeira.id });
      expect(repetido.status).toBe(409);
      expect(repetido.corpo.error).toBe(DOCUMENTO_JA_REGISTRADO);

      const mdfe = { kind: "MDFE", accessKey: chave("58", 311), unloadState: "MG" };
      expect((await registrar(viagem.id, mdfe)).status).toBe(201);
      expect((await registrar(viagem.id, mdfe)).corpo.error).toBe(DOCUMENTO_JA_REGISTRADO);
      expect(await documentosDe(viagem.id)).toHaveLength(3);
      expect((await ler(viagem.id)).corpo.semCte).toEqual([]);
    });

    it("exclui o registro, com a chave na auditoria; documento de outra viagem ou que não existe é 404", async () => {
      const viagem = await viajar();
      const outraViagem = await viajar();
      const { corpo: documento } = await registrar(viagem.id, { kind: "MDFE", accessKey: chave("58", 320), unloadState: "MG" });

      for (const [viagemId, documentoId] of [[outraViagem.id, documento.id], [viagem.id, SEM_ID]]) {
        const resposta = await excluir(viagemId, documentoId);
        expect(resposta.status).toBe(404);
        expect(resposta.corpo.error).toBe(DOCUMENTO_NAO_ENCONTRADO);
      }
      expect(await documentosDe(viagem.id)).toHaveLength(1);

      const excluido = await excluir(viagem.id, documento.id, "ADMIN");
      expect(excluido.status).toBe(200);
      expect(await documentosDe(viagem.id)).toHaveLength(0);
      expect((await trilha(viagem.contratoId)).at(-1)).toMatchObject({ action: "subcontratacao.excluir", userId: ids.ADMIN, before: { kind: "MDFE", accessKey: chave("58", 320), unloadState: "MG" } });
    });

    it("contrato feito à mão com transportadora em veículo próprio: registra os documentos, mas o MDF-e dela não vale para a saída", async () => {
      const viagem = await viajar({ veiculoId: veiculoProprioId });
      expect((await registrar(viagem.id, { kind: "MDFE", accessKey: chave("58", 330), unloadState: "MG" })).status).toBe(201);
      expect((await ler(viagem.id)).corpo).toMatchObject({ parceiro: { id: subcontratadaId }, noVeiculoDela: false });
    });
  });

  /* ------------------------- Contrato, pagamento e recibo --------------------- */

  describe("no contrato de frete", () => {
    const CONTRATO = { calcMode: "FIXO", calcBase: "1000", grossAmount: "1000", tollAmount: "", otherAdditions: "", discounts: "", inss: "", irrf: "", sestSenat: "", otherWithholdings: "", notes: "" };
    type FreteLido = Corpo & { contrato: { grossAmount: number; sugerido: number | null; status: string } | null; subcontratacao: { ctes: number; mdfes: number; semCte: { id: string; codigo: string }[] } | null };
    const lerFrete = (viagemId: string, perfil: Perfil = "FINANCE") => {
      entrarComo(perfil);
      return chamar<FreteLido>(freteRota.GET(req(), ctx(viagemId)));
    };
    const pagar = (viagemId: string, corpo: Record<string, unknown>) => {
      entrarComo("FINANCE");
      return chamar<Corpo & { contrato: { status: string } }>(pagamentosRota.POST(req("POST", { kind: "SALDO", date: "2026-10-10", method: "PIX", ...corpo }), ctx(viagemId)));
    };

    it("a aba Frete recebe quantos documentos dela há e as cargas sem CT-e; com agregado ou sem contrato vem nulo", async () => {
      const viagem = await viajar();
      expect((await lerFrete(viagem.id)).corpo.subcontratacao).toEqual({ ctes: 0, mdfes: 0, semCte: viagem.cargas });
      await registrar(viagem.id, { kind: "CTE", accessKey: chave("57", 400), collectionId: viagem.cargas[0].id });
      await registrar(viagem.id, { kind: "MDFE", accessKey: chave("58", 401), unloadState: "MG" });
      expect((await lerFrete(viagem.id)).corpo.subcontratacao).toEqual({ ctes: 1, mdfes: 1, semCte: [viagem.cargas[1]] });

      const comAgregado = await viajar({ veiculoId: veiculoDoAgregadoId, parceiroId: agregadoId });
      expect((await lerFrete(comAgregado.id)).corpo.subcontratacao).toBeNull();
      const semContrato = await viajar({ veiculoId: veiculoProprioId, parceiroId: null });
      expect((await lerFrete(semContrato.id)).corpo).toMatchObject({ contrato: null, subcontratacao: null });
    });

    it("quitar com carga sem CT-e dela: o pagamento entra (não bloqueia) e a resposta avisa as cargas; adiantamento e contrato completo não avisam", async () => {
      const viagem = await viajar({ status: "FINISHED" });
      const adiantamento = await pagar(viagem.id, { kind: "ADIANTAMENTO", amount: "300" });
      expect(adiantamento.status).toBe(201);
      expect(adiantamento.corpo.aviso).toBeNull();

      await registrar(viagem.id, { kind: "CTE", accessKey: chave("57", 410), collectionId: viagem.cargas[0].id });
      const saldo = await pagar(viagem.id, { amount: "700" });
      expect(saldo.status).toBe(201);
      expect(saldo.corpo.contrato.status).toBe("QUITADO");
      expect(saldo.corpo.aviso).toBe(avisoDeCargasSemCte([viagem.cargas[1]]));
      expect(saldo.corpo.aviso).toContain(viagem.cargas[1].codigo);
      expect(saldo.corpo.aviso).not.toContain(viagem.cargas[0].codigo);

      // Com o CT-e dela em todas as cargas, ou com agregado, quitar não avisa nada.
      const completa = await viajar({ status: "FINISHED" });
      for (const [indice, carga] of completa.cargas.entries()) await registrar(completa.id, { kind: "CTE", accessKey: chave("57", 420 + indice), collectionId: carga.id });
      expect((await pagar(completa.id, { amount: "1000" })).corpo).toMatchObject({ contrato: { status: "QUITADO" }, aviso: null });
      const comAgregado = await viajar({ status: "FINISHED", veiculoId: veiculoDoAgregadoId, parceiroId: agregadoId });
      expect((await pagar(comAgregado.id, { amount: "1000" })).corpo).toMatchObject({ contrato: { status: "QUITADO" }, aviso: null });
    });

    it("com documento registrado o parceiro do contrato não troca (a chave tem o CNPJ dela); os valores continuam editáveis", async () => {
      const viagem = await viajar();
      await registrar(viagem.id, { kind: "MDFE", accessKey: chave("58", 430), unloadState: "MG" });
      entrarComo("FINANCE");
      const troca = await chamar(freteRota.PUT(req("PUT", { carrierId: segundaId, ...CONTRATO }), ctx(viagem.id)));
      expect(troca.status).toBe(409);
      expect(troca.corpo.error).toBe(CONTRATO_TEM_DOCUMENTOS);
      entrarComo("FINANCE");
      expect((await freteRota.PUT(req("PUT", { carrierId: subcontratadaId, ...CONTRATO, grossAmount: "1200" }), ctx(viagem.id))).status).toBe(200);
      expect((await banco.sistema.freightContract.findUniqueOrThrow({ where: { id: viagem.contratoId } })).grossAmount).toBe(1200);
    });

    it("o recibo traz os documentos dela (CT-e por carga, MDF-e por UF) e as cargas sem CT-e; com agregado não traz a seção", async () => {
      const viagem = await viajar();
      await registrar(viagem.id, { kind: "CTE", accessKey: chave("57", 440), collectionId: viagem.cargas[0].id, issuedAt: "2026-10-03" });
      await registrar(viagem.id, { kind: "MDFE", accessKey: chave("58", 441), unloadState: "MG", issuedAt: "2026-10-04" });
      entrarComo("FINANCE");
      const { status, corpo } = await chamar<Corpo & { subcontratacao: { documentos: Record<string, unknown>[]; cargasSemCte: string[] } | null }>(reciboRota.GET(req(), ctx(viagem.id)));
      expect(status).toBe(200);
      expect(corpo.subcontratacao?.documentos).toEqual([
        { id: expect.any(String), tipo: "CTE", chave: chave("57", 440), data: "2026-10-03T00:00:00.000Z", carga: viagem.cargas[0].codigo, uf: null },
        { id: expect.any(String), tipo: "MDFE", chave: chave("58", 441), data: "2026-10-04T00:00:00.000Z", carga: null, uf: "MG" },
      ]);
      expect(corpo.subcontratacao?.cargasSemCte).toEqual([viagem.cargas[1].codigo]);

      const comAgregado = await viajar({ veiculoId: veiculoDoAgregadoId, parceiroId: agregadoId });
      entrarComo("FINANCE");
      expect((await chamar<Corpo & { subcontratacao: unknown }>(reciboRota.GET(req(), ctx(comAgregado.id)))).corpo.subcontratacao).toBeNull();
    });

    it("contrato por km: com os hodômetros a rota passa a sugerir o valor, o gravado NÃO muda sozinho, e gravar com o sugerido o atualiza", async () => {
      const viagem = await viajar({ contrato: { calcMode: "POR_KM", calcBase: 2.5, grossAmount: 0 } });
      expect((await lerFrete(viagem.id)).corpo.contrato).toMatchObject({ grossAmount: 0, sugerido: null });

      // O retorno é informado (aba Dados ou finalização): a viagem passa a ter km.
      await banco.sistema.manifest.update({ where: { id: viagem.id }, data: { departureOdometer: 1000, returnOdometer: 1420 } });
      const comKm = await lerFrete(viagem.id);
      expect(comKm.corpo.contrato).toMatchObject({ grossAmount: 0, sugerido: 1050 });
      expect((await banco.sistema.freightContract.findUniqueOrThrow({ where: { id: viagem.contratoId } })).grossAmount).toBe(0);

      // "Usar o valor sugerido": a tela grava o contrato como está, só com o bruto sugerido.
      entrarComo("FINANCE");
      const usado = await chamar<Corpo & { grossAmount: number; sugerido: number }>(
        freteRota.PUT(req("PUT", { carrierId: subcontratadaId, ...CONTRATO, calcMode: "POR_KM", calcBase: "2,5", grossAmount: String(comKm.corpo.contrato!.sugerido) }), ctx(viagem.id)),
      );
      expect(usado.status).toBe(200);
      expect(usado.corpo).toMatchObject({ grossAmount: 1050, sugerido: 1050 });
    });
  });

  /* ------------------------------ Sugestão do MDF-e --------------------------- */

  describe("sugestão do contrato para o pagamento do frete no MDF-e", () => {
    it("devolve o valor do contrato, o adiantamento pago, a forma, o Pix e o parceiro; o pagador é o emitente fiscal", async () => {
      // Sem emitente fiscal na empresa (as suítes fiscais apagam o delas ao terminar).
      await banco.sistema.fiscalIssuer.deleteMany({ where: { tenantId: EMPRESA_PADRAO.id } });
      const viagem = await viajar({ status: "FINISHED", contrato: { grossAmount: 1000, tollAmount: 100, discounts: 50, inss: 80 } });
      expect((await sugerir(viagem.id)).corpo.sugestao).toEqual({
        contratado: { nome: nome("Transportes Subcontratada"), documento: CNPJ_DA_SUBCONTRATADA },
        pagador: null,
        valor: 1050,
        adiantamento: 0,
        aPrazo: true,
        forma: null,
        pix: "pix@subcontratada.br",
      });

      entrarComo("FINANCE");
      expect((await pagamentosRota.POST(req("POST", { kind: "ADIANTAMENTO", date: "2026-10-10", amount: "300", method: "TRANSFERENCIA" }), ctx(viagem.id))).status).toBe(201);
      await banco.default.fiscalIssuer.create({
        data: {
          cnpj: "99000108000141",
          ie: "123456789012",
          legalName: nome("Minha Transportadora Ltda"),
          street: "Rua A",
          number: "1",
          district: "Centro",
          cityCode: "3530300",
          cityName: "Mirassol",
          state: "SP",
          zip: "15130000",
          rntrc: "12345678",
          taxRegime: "3",
          cfopInState: "5353",
          cfopOutState: "6353",
          icmsCst: "00",
        },
      });
      expect((await sugerir(viagem.id, "DIRECTOR")).corpo.sugestao).toMatchObject({ pagador: { nome: nome("Minha Transportadora Ltda"), documento: "99000108000141" }, valor: 1050, adiantamento: 300, aPrazo: true, forma: "TRANSFERENCIA" });
    });

    it("sem contrato ou com ele cancelado não há sugestão; viagem que não existe é 404", async () => {
      const semContrato = await viajar({ veiculoId: veiculoProprioId, parceiroId: null });
      expect((await sugerir(semContrato.id)).corpo).toEqual({ sugestao: null });
      const cancelado = await viajar({ contrato: { status: "CANCELADO" } });
      expect((await sugerir(cancelado.id)).corpo).toEqual({ sugestao: null });
      expect((await sugerir(SEM_ID)).status).toBe(404);
    });
  });

  /* ---------------------------------- Isolamento ------------------------------ */

  describe("isolamento entre empresas", () => {
    it("a viagem, o contrato e o documento da outra empresa não existem para esta: 404 em tudo, e nada dela muda", async () => {
      expect((await ler(daOutra.viagemId, "ADMIN")).status).toBe(404);
      const registro = await registrar(daOutra.viagemId, { kind: "MDFE", accessKey: chave("58", 500, CNPJ_DA_SUBCONTRATADA_DA_OUTRA), unloadState: "RJ" }, "ADMIN");
      expect(registro.status).toBe(404);
      expect(registro.corpo.error).toBe(MANIFEST_NOT_FOUND_MESSAGE);
      expect((await excluir(daOutra.viagemId, daOutra.documentoId, "ADMIN")).status).toBe(404);
      expect((await sugerir(daOutra.viagemId, "ADMIN")).status).toBe(404);

      // Nem pela viagem desta empresa se alcança o documento da outra.
      const viagem = await viajar();
      expect((await excluir(viagem.id, daOutra.documentoId, "ADMIN")).status).toBe(404);
      const restantes = await banco.sistema.subcontractDocument.findMany({ where: { contractId: daOutra.contratoId } });
      expect(restantes.map((documento) => [documento.id, documento.tenantId])).toEqual([[daOutra.documentoId, EMPRESA_OUTRA.id]]);
      expect(JSON.stringify((await ler(viagem.id, "ADMIN")).corpo)).not.toContain(CNPJ_DA_SUBCONTRATADA_DA_OUTRA);
    });

    it("o banco recusa documento apontando para contrato ou carga de outra empresa", async () => {
      const viagem = await viajar();
      const documento = { kind: "CTE", accessKey: chave("57", 510), issuedAt: new Date("2026-10-05T00:00:00.000Z") };
      await expect(banco.default.subcontractDocument.create({ data: { ...documento, contractId: daOutra.contratoId } })).rejects.toThrow(/outra empresa/);
      await expect(banco.default.subcontractDocument.create({ data: { ...documento, contractId: viagem.contratoId, collectionId: daOutra.cargaId } })).rejects.toThrow(/outra empresa/);
      expect(await banco.sistema.subcontractDocument.count({ where: { accessKey: documento.accessKey } })).toBe(0);
    });
  });
});
