import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getServerSession } from "next-auth";
import {
  CANCELAMENTO_COM_CARTA,
  CANCELAMENTO_COM_ENTREGA,
  CTE_NAO_ENCONTRADO,
  ENTREGA_JA_REGISTRADA,
  JA_AUTORIZADO,
  LIMITE_DE_CARTAS,
  RECEBEDOR_INCOMPLETO,
  SEM_COMPROVANTE_ACEITO,
  SEM_ENTREGA_REGISTRADA,
  SEM_IMAGEM_NO_COMPROVANTE,
  SO_AUTORIZADO_RECEBE_EVENTO,
  SO_ENVIADO_SE_CONFERE,
  SVC_AINDA_NAO_SINCRONIZADA,
  SVC_NAO_OFERECIDA,
  fraseDoCampoProibido,
  type ConferenciaDoCte,
  type ConferenciaNaSefaz,
  type CteEmitido,
  type EventosDoCte,
  type ResultadoDaEmissao,
} from "../src/lib/cte";
import { assinaturaConfere } from "../src/lib/cte/assinar";
import { lerChaveDoCte } from "../src/lib/cte/chave";
import { usarSefazDeTeste } from "../src/lib/cte/sefaz";
import type { CargaParaCte } from "../src/lib/nfe";
import { EMPRESA_OUTRA, EMPRESA_PADRAO } from "./empresas-de-teste";
import { REMETENTE, certificadoDeTeste, chaveDeNfe, errosNoEsquema, nfeDeExemplo, registrarEventoDeFora, subirSefazDeMentira, type CertificadoDeTeste, type SefazDeMentira } from "./cte-apoio";

/**
 * Carta de correção, comprovante de entrega, emissão pela SVC e "Conferir na
 * SEFAZ" do CT-e, com banco, pelas rotas.
 *
 * NENHUM teste fala com a SEFAZ: as rotas conversam com o servidor HTTPS local
 * de tests/cte-apoio.ts (`usarSefazDeTeste`), e o certificado é autoassinado.
 * Nenhum documento nem evento fica registrado aqui sem o retorno desse servidor.
 */
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

const temBanco = Boolean(process.env.DATABASE_URL);
if (!temBanco) {
  console.warn("\n[cte-eventos-rotas.test] DATABASE_URL ausente: testes de integração PULADOS.\n");
}
const suite = temBanco ? describe : describe.skip;

const PREFIXO = "teste-cteev-";
const HASH_FALSO = "$2b$10$hashfalsoparateste000000000000000000000000000000000";
const SEM_ID = "00000000-0000-0000-0000-000000000000";
const CNPJ_DA_PADRAO = "99000108000141";
const SENHA = "senha-do-certificado-dos-eventos";
const JUSTIFICATIVA = "SEFAZ de origem fora do ar desde as 14h";
const CANHOTO = `data:image/jpeg;base64,${Buffer.from("foto do canhoto assinado, de mentira").toString("base64")}`;
const ENTREGA = `data:image/jpeg;base64,${Buffer.from("foto da carga no local, de mentira").toString("base64")}`;
const ASSINATURA = `data:image/png;base64,${Buffer.from("assinatura na tela, de mentira").toString("base64")}`;
const base64De = (dataUrl: string) => dataUrl.slice(dataUrl.indexOf(",") + 1);
const sha256 = (dataUrl: string) => createHash("sha256").update(Buffer.from(base64De(dataUrl), "base64")).digest("hex");

type Perfil = "ADMIN" | "OPERATION" | "FINANCE" | "EXPEDITION" | "COMMERCIAL" | "CLIENTE" | "ADMIN_DA_OUTRA";
type Corpo = Record<string, unknown> & { error?: string };

const FORMULARIO = {
  cnpj: "99.000.108/0001-41",
  ie: "123456789012",
  razaoSocial: `${PREFIXO}Transportadora Ltda`,
  logradouro: "Rua das Flores",
  numero: "120",
  bairro: "Centro",
  cidade: "mirassol",
  uf: "SP",
  cep: "15130-000",
  rntrc: "12345678",
  regime: "3",
  serie: "1",
  proximoNumero: "1",
  ambiente: "HOMOLOGACAO",
  cfopDentro: "5353",
  cfopFora: "6353",
  icms: "00",
  aliquota: "12",
  ibsCbsCst: "000",
  ibsCbsClasse: "000001",
};

suite("rotas dos eventos, da SVC e da conferência do CT-e", () => {
  let banco: typeof import("../src/lib/prisma");
  let fiscalRota: typeof import("../src/app/api/empresa/fiscal/route");
  let certificadoRota: typeof import("../src/app/api/empresa/fiscal/certificado/route");
  let listaRota: typeof import("../src/app/api/fiscal/cte/route");
  let emissaoRota: typeof import("../src/app/api/fiscal/cte/emissao/route");
  let cancelarRota: typeof import("../src/app/api/fiscal/cte/emissao/[id]/cancelar/route");
  let eventosRota: typeof import("../src/app/api/fiscal/cte/emissao/[id]/eventos/route");
  let correcaoRota: typeof import("../src/app/api/fiscal/cte/emissao/[id]/correcao/route");
  let entregaRota: typeof import("../src/app/api/fiscal/cte/emissao/[id]/entrega/route");
  let situacaoRota: typeof import("../src/app/api/fiscal/cte/emissao/[id]/situacao/route");

  const sessao = vi.mocked(getServerSession);
  const ids = {} as Record<Perfil, string>;
  let clienteId: string;
  let clienteDaOutra: string;
  let sefaz: SefazDeMentira;
  let certificado: CertificadoDeTeste;
  let sequencia = 0;

  const DAS_EMPRESAS = { tenantId: { in: [EMPRESA_PADRAO.id, EMPRESA_OUTRA.id] } };

  const entrarComo = (perfil: Perfil | null) =>
    sessao.mockResolvedValue(
      perfil
        ? { user: { id: ids[perfil], role: perfil === "CLIENTE" ? "CLIENT" : perfil === "ADMIN_DA_OUTRA" ? "ADMIN" : perfil, clientId: null, ...(perfil === "ADMIN_DA_OUTRA" && { tenantId: EMPRESA_OUTRA.id }) } }
        : null,
    );

  const req = (method = "GET", body?: unknown, url = "http://localhost/api/teste") =>
    new Request(url, { method, headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.9" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

  async function lida<T = Corpo>(res: Response): Promise<{ status: number; corpo: T & Corpo }> {
    return { status: res.status, corpo: (await res.json()) as T & Corpo };
  }

  /** A empresa padrão pronta para emitir: dados fiscais e certificado. */
  const prepararEmpresa = async (trocas: Record<string, unknown> = {}) => {
    entrarComo("ADMIN");
    expect((await fiscalRota.PUT(req("PUT", { ...FORMULARIO, ...trocas }))).status).toBe(200);
    expect((await certificadoRota.PUT(req("PUT", { arquivo: certificado.pfx.toString("base64"), senha: certificado.senha }))).status).toBe(200);
  };

  const conferencia = async (collectionId: string) => {
    entrarComo("OPERATION");
    return lida<ConferenciaDoCte>(await emissaoRota.GET(req("GET", undefined, `http://localhost/x?collectionId=${collectionId}`)));
  };
  const emitir = async (collectionId: string, svc?: { justificativa: string }, perfil: Perfil = "OPERATION") => {
    entrarComo(perfil);
    return lida<ResultadoDaEmissao>(await emissaoRota.POST(req("POST", svc ? { collectionId, svc } : { collectionId })));
  };
  const cancelar = async (cteId: string) => {
    entrarComo("OPERATION");
    return lida<CteEmitido>(await cancelarRota.POST(req("POST", { justificativa: "Carga recusada pelo destinatário na entrega" }), ctx(cteId)));
  };
  const eventosDe = async (cteId: string, perfil: Perfil = "OPERATION") => {
    entrarComo(perfil);
    return lida<EventosDoCte>(await eventosRota.GET(req(), ctx(cteId)));
  };
  const corrigir = async (cteId: string, correcoes: unknown = [{ grupo: "compl", campo: "xObs", valor: "Entregar no depósito 2" }], perfil: Perfil = "OPERATION") => {
    entrarComo(perfil);
    return lida<EventosDoCte>(await correcaoRota.POST(req("POST", { correcoes }), ctx(cteId)));
  };
  const registrarEntrega = async (cteId: string, perfil: Perfil = "OPERATION") => {
    entrarComo(perfil);
    return lida<EventosDoCte>(await entregaRota.POST(req("POST"), ctx(cteId)));
  };
  const cancelarEntrega = async (cteId: string) => {
    entrarComo("OPERATION");
    return lida<EventosDoCte>(await entregaRota.DELETE(req("DELETE"), ctx(cteId)));
  };
  const conferirNaSefaz = async (cteId: string, perfil: Perfil = "OPERATION") => {
    entrarComo(perfil);
    return lida<ConferenciaNaSefaz>(await situacaoRota.POST(req("POST"), ctx(cteId)));
  };
  const lista = async () => {
    entrarComo("OPERATION");
    return (await lida<CargaParaCte[]>(await listaRota.GET())).corpo as unknown as CargaParaCte[];
  };

  /** Uma carga em rota, com a NF-e dela importada e ligada. */
  async function novaCarga(outra = false) {
    const numero = 7000 + (sequencia += 1);
    const db = outra ? banco.paraEmpresa(EMPRESA_OUTRA.id).db : banco.default;
    const carga = await db.collection.create({
      data: {
        clientId: outra ? clienteDaOutra : clienteId,
        sender: "Indústria Remetente S/A",
        receiver: "Comércio Destinatário Ltda",
        origin: "São José do Rio Preto - SP",
        destination: "Belo Horizonte - MG",
        volumes: 12,
        weight: 1250.5,
        invoiceKey: chaveDeNfe(numero),
        invoiceValue: 32500.9,
        freightValue: 850.5,
        status: "ROUTE",
        trackingCode: `96${String(Date.now() % 1_000_000).padStart(6, "0")}${String(numero % 100).padStart(2, "0")}`,
      },
      select: { id: true, trackingCode: true },
    });
    await db.fiscalDocument.create({
      data: { accessKey: chaveDeNfe(numero), number: numero, series: 1, issuerTaxId: REMETENTE.documento, issuerName: "Indústria Remetente S/A", totalValue: 32500.9, xml: nfeDeExemplo({ numero }), collectionId: carga.id },
      select: { id: true },
    });
    return { ...carga, nota: chaveDeNfe(numero) };
  }

  /** Uma carga com o CT-e autorizado em homologação. */
  async function cargaComCte() {
    const carga = await novaCarga();
    const emitido = await emitir(carga.id);
    expect(emitido.corpo.autorizado, emitido.corpo.error ?? emitido.corpo.mensagem).toBe(true);
    return { carga, cte: emitido.corpo.cte };
  }

  type Foto = { kind: string; dataUrl: string; replacedAt?: Date | null };
  /** O comprovante de entrega da carga, plantado direto no banco (como ele nasce é assunto dos testes do motorista). */
  async function plantarComprovante(collectionId: string, trocas: Record<string, unknown> = {}, fotos: Foto[] = [{ kind: "CANHOTO", dataUrl: CANHOTO }]) {
    const comprovante = await banco.default.proofOfDelivery.create({
      data: { collectionId, receiverName: "Maria Recebedora", receiverDoc: "123.456.789-00", latitude: -19.9166813, longitude: -43.9344931, status: "APPROVED", ...trocas },
      select: { id: true, createdAt: true },
    });
    for (const [indice, foto] of fotos.entries()) {
      await banco.default.proofPhoto.create({ data: { proofId: comprovante.id, kind: foto.kind, dataUrl: foto.dataUrl, sha256: sha256(foto.dataUrl), replacedAt: foto.replacedAt ?? null, createdAt: new Date(Date.now() + indice) }, select: { id: true } });
    }
    return comprovante;
  }

  const ctesDe = (collectionId: string) => banco.sistema.cte.findMany({ where: { collectionId }, orderBy: { createdAt: "asc" } });
  const eventosNoBanco = (cteId: string) => banco.sistema.cteEvent.findMany({ where: { cteId }, orderBy: [{ registeredAt: "asc" }, { createdAt: "asc" }] });
  const trilha = (acao: string) => banco.sistema.auditLog.findMany({ where: { ...DAS_EMPRESAS, action: acao, userName: { startsWith: PREFIXO } }, orderBy: { createdAt: "asc" } });
  const numeracao = async (ambiente = "HOMOLOGACAO") =>
    (await banco.sistema.cteNumbering.findFirst({ where: { tenantId: EMPRESA_PADRAO.id, environment: ambiente, series: 1 }, select: { nextNumber: true } }))?.nextNumber ?? null;
  const chamadasDe = (servico: string) => sefaz.chamadas.filter((chamada) => chamada.servico === servico);

  async function limparMovimento() {
    const { sistema } = banco;
    await sistema.outboxEvent.deleteMany({ where: DAS_EMPRESAS });
    await sistema.cteEvent.deleteMany({ where: DAS_EMPRESAS });
    await sistema.cte.deleteMany({ where: DAS_EMPRESAS });
    await sistema.cteNumbering.deleteMany({ where: DAS_EMPRESAS });
    await sistema.fiscalIssuer.deleteMany({ where: DAS_EMPRESAS });
    await sistema.fiscalDocument.deleteMany({ where: { ...DAS_EMPRESAS, issuerTaxId: REMETENTE.documento, issuerName: "Indústria Remetente S/A" } });
    await sistema.collection.deleteMany({ where: { client: { companyName: { startsWith: PREFIXO } } } });
    await sistema.notification.deleteMany({ where: { user: { email: { startsWith: PREFIXO } } } });
    await sistema.auditLog.deleteMany({ where: { ...DAS_EMPRESAS, userName: { startsWith: PREFIXO } } });
  }

  async function limpar() {
    await limparMovimento();
    await banco.sistema.user.deleteMany({ where: { email: { startsWith: PREFIXO } } });
    await banco.sistema.client.deleteMany({ where: { companyName: { startsWith: PREFIXO } } });
  }

  const anteriores = { chave: process.env.TMS_CHAVE_DE_DADOS, fiscal: process.env.FISCAL_MCP_URL };
  const restaurar = (nome: string, valor: string | undefined) => {
    if (valor === undefined) delete process.env[nome];
    else process.env[nome] = valor;
  };

  beforeAll(async () => {
    sefaz = await subirSefazDeMentira();
    usarSefazDeTeste({ url: sefaz.url, autoridades: sefaz.autoridades, tempoLimiteMs: 1500 });
    certificado = certificadoDeTeste({ cnpj: CNPJ_DA_PADRAO, senha: SENHA });
    delete process.env.FISCAL_MCP_URL;
    process.env.TMS_CHAVE_DE_DADOS = "chave-de-dados-dos-testes-dos-eventos-do-cte-0123456789";
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    banco = await import("../src/lib/prisma");
    fiscalRota = await import("../src/app/api/empresa/fiscal/route");
    certificadoRota = await import("../src/app/api/empresa/fiscal/certificado/route");
    listaRota = await import("../src/app/api/fiscal/cte/route");
    emissaoRota = await import("../src/app/api/fiscal/cte/emissao/route");
    cancelarRota = await import("../src/app/api/fiscal/cte/emissao/[id]/cancelar/route");
    eventosRota = await import("../src/app/api/fiscal/cte/emissao/[id]/eventos/route");
    correcaoRota = await import("../src/app/api/fiscal/cte/emissao/[id]/correcao/route");
    entregaRota = await import("../src/app/api/fiscal/cte/emissao/[id]/entrega/route");
    situacaoRota = await import("../src/app/api/fiscal/cte/emissao/[id]/situacao/route");
    await limpar();

    const outra = banco.paraEmpresa(EMPRESA_OUTRA.id).db;
    clienteId = (await banco.default.client.create({ data: { companyName: `${PREFIXO}Indústria Remetente S/A`, cnpj: REMETENTE.documento, ie: "110042490114" } })).id;
    clienteDaOutra = (await outra.client.create({ data: { companyName: `${PREFIXO}Cliente da outra`, cnpj: REMETENTE.documento, ie: "110042490114" } })).id;
    for (const perfil of ["ADMIN", "OPERATION", "FINANCE", "EXPEDITION", "COMMERCIAL"] as const) {
      ids[perfil] = (await banco.default.user.create({ data: { name: `${PREFIXO}${perfil}`, email: `${PREFIXO}${perfil.toLowerCase()}@exemplo.br`, password: HASH_FALSO, role: perfil } })).id;
    }
    ids.CLIENTE = (await banco.default.user.create({ data: { name: `${PREFIXO}cliente`, email: `${PREFIXO}cliente@exemplo.br`, password: HASH_FALSO, role: "CLIENT", clientId: clienteId } })).id;
    ids.ADMIN_DA_OUTRA = (await outra.user.create({ data: { name: `${PREFIXO}admin-da-outra`, email: `${PREFIXO}admin-da-outra@exemplo.br`, password: HASH_FALSO, role: "ADMIN" } })).id;
  }, 180_000);

  beforeEach(async () => {
    sessao.mockReset();
    sefaz.modo = "autorizar";
    sefaz.modoDaSvc = "autorizar";
    sefaz.modoDe = {};
    sefaz.svcAtiva = false;
    sefaz.atrasoMs = 0;
    sefaz.consultasCegas = 0;
    sefaz.eventoComRessalva = null;
    sefaz.chamadas.length = 0;
    await limparMovimento();
  });

  afterAll(async () => {
    usarSefazDeTeste(null);
    if (banco) await limpar();
    restaurar("TMS_CHAVE_DE_DADOS", anteriores.chave);
    restaurar("FISCAL_MCP_URL", anteriores.fiscal);
    vi.restoreAllMocks();
    await sefaz.fechar();
  });

  /* --------------------------------- Permissão -------------------------------- */

  describe("permissão", () => {
    it("ver os eventos é de quem lê o fiscal; corrigir, registrar e cancelar a entrega e conferir na SEFAZ, de quem escreve", async () => {
      await prepararEmpresa();
      const { cte } = await cargaComCte();
      sefaz.chamadas.length = 0;
      const leitura: [string, () => Promise<Response>][] = [["eventos", () => eventosRota.GET(req(), ctx(cte.id))]];
      const escrita: [string, () => Promise<Response>][] = [
        ["correção", () => correcaoRota.POST(req("POST", { correcoes: [{ grupo: "compl", campo: "xObs", valor: "x" }] }), ctx(cte.id))],
        ["registrar entrega", () => entregaRota.POST(req("POST"), ctx(cte.id))],
        ["cancelar entrega", () => entregaRota.DELETE(req("DELETE"), ctx(cte.id))],
        ["conferir na SEFAZ", () => situacaoRota.POST(req("POST"), ctx(cte.id))],
        ["emitir pela SVC", () => emissaoRota.POST(req("POST", { collectionId: SEM_ID, svc: { justificativa: JUSTIFICATIVA } }))],
      ];
      for (const [nome, chamar] of [...leitura, ...escrita]) {
        entrarComo(null);
        expect((await chamar()).status, `${nome} sem sessão`).toBe(401);
        for (const perfil of ["COMMERCIAL", "CLIENTE"] as const) {
          entrarComo(perfil);
          expect((await chamar()).status, `${nome} ${perfil}`).toBe(403);
        }
      }
      // Financeiro e expedição leem os eventos, mas não enviam nada à SEFAZ.
      for (const perfil of ["FINANCE", "EXPEDITION"] as const) {
        entrarComo(perfil);
        for (const [nome, chamar] of leitura) expect((await chamar()).status, `${nome} ${perfil}`).toBe(200);
        for (const [nome, chamar] of escrita) expect((await chamar()).status, `${nome} ${perfil}`).toBe(403);
      }
      expect(sefaz.chamadas).toHaveLength(0);
      expect(await eventosNoBanco(cte.id)).toHaveLength(0);
    });
  });

  /* ------------------------------ Carta de correção ---------------------------- */

  describe("carta de correção (110110)", () => {
    it("registrada pela SEFAZ: guarda o XML assinado, o retorno e o protocolo; a sequência cresce; e o CT-e não pode mais ser cancelado", async () => {
      await prepararEmpresa({ proximoNumero: "100" });
      const { cte } = await cargaComCte();
      expect((await eventosDe(cte.id)).corpo).toMatchObject({ cte: { id: cte.id, situacao: "AUTHORIZED" }, eventos: [] });

      sefaz.chamadas.length = 0;
      const primeira = await corrigir(cte.id, [{ grupo: "compl", campo: "xObs", valor: "Entregar no depósito 2" }, { grupo: "infQ", campo: "qCarga", valor: "1300.0000", item: "1" }]);
      expect(primeira.status).toBe(200);
      expect(primeira.corpo.eventos).toHaveLength(1);
      expect(primeira.corpo.eventos[0]).toMatchObject({ tipo: "110110", sequencia: 1, descricao: "compl/xObs: Entregar no depósito 2; infQ/qCarga (item 1): 1300.0000", canceladoEm: null, deFora: false });
      expect(primeira.corpo.eventos[0].protocolo).toMatch(/^\d{15}$/);

      const [enviado] = chamadasDe("CTeRecepcaoEventoV4");
      expect(enviado.svc).toBeNull();
      expect(enviado.dados).toContain(`<chCTe>${cte.chave}</chCTe>`);
      expect(enviado.dados).toContain("<tpEvento>110110</tpEvento><nSeqEvento>1</nSeqEvento>");
      expect(enviado.dados).toContain("<infCorrecao><grupoAlterado>infQ</grupoAlterado><campoAlterado>qCarga</campoAlterado><valorAlterado>1300.0000</valorAlterado><nroItemAlterado>01</nroItemAlterado></infCorrecao>");
      expect(await errosNoEsquema(enviado.dados, "eventoCTe_v4.00.xsd")).toEqual([]);
      expect(assinaturaConfere(enviado.dados, certificado.certificadoPem)).toBe(true);

      const [linha] = await eventosNoBanco(cte.id);
      expect(linha).toMatchObject({ type: "110110", sequence: 1, statusCode: 135, xmlSent: enviado.dados, protocol: primeira.corpo.eventos[0].protocolo, createdById: ids.OPERATION, cancelledAt: null });
      expect(await errosNoEsquema(linha.xmlReturn, "procEventoCTe_v4.00.xsd")).toEqual([]);

      const segunda = await corrigir(cte.id, [{ grupo: "ide", campo: "retira", valor: "0" }], "ADMIN");
      expect(segunda.corpo.eventos.map((evento) => [evento.tipo, evento.sequencia])).toEqual([["110110", 1], ["110110", 2]]);
      expect(chamadasDe("CTeRecepcaoEventoV4")[1].dados).toContain("<nSeqEvento>2</nSeqEvento>");
      expect((await trilha("cte.corrigir")).map((registro) => registro.summary)).toEqual([expect.stringContaining("Carta de correção nº 1 registrada para o CT-e nº 100"), expect.stringContaining("Carta de correção nº 2 registrada")]);

      // MOC 4.00, item 6.2.1, regra O14 (523): com carta de correção não há mais cancelamento. O pedido nem vai à SEFAZ.
      sefaz.chamadas.length = 0;
      expect(await cancelar(cte.id)).toMatchObject({ status: 409, corpo: { error: CANCELAMENTO_COM_CARTA } });
      expect(sefaz.chamadas).toHaveLength(0);
      expect((await ctesDe((await ctesDeCte(cte.id)).collectionId))[0].status).toBe("AUTHORIZED");
    });

    it("recusa no servidor o campo proibido e o formulário errado (400); CT-e que não existe (404) e que não está autorizado (409)", async () => {
      await prepararEmpresa();
      const { cte } = await cargaComCte();
      sefaz.chamadas.length = 0;
      expect(await corrigir(cte.id, [{ grupo: "vPrest", campo: "vTPrest", valor: "900.00" }])).toMatchObject({ status: 400, corpo: { error: fraseDoCampoProibido("vPrest", "vTPrest") } });
      expect(await corrigir(cte.id, [{ grupo: "compl", campo: "xObs", valor: "ok" }, { grupo: "EMIT", campo: "cnpj", valor: "99000108000222" }])).toMatchObject({ status: 400, corpo: { error: fraseDoCampoProibido("EMIT", "cnpj") } });
      expect(await corrigir(cte.id, [{ grupo: "ide", campo: "dhEmi", valor: "2026-10-10T10:00:00-03:00" }])).toMatchObject({ status: 400 });
      expect((await corrigir(cte.id, [])).status).toBe(400);
      expect((await corrigir(cte.id, "x")).status).toBe(400);
      expect(await corrigir(SEM_ID)).toMatchObject({ status: 404, corpo: { error: CTE_NAO_ENCONTRADO } });

      // Rejeitado: não existe na SEFAZ.
      sefaz.modo = "rejeitar";
      const outra = await novaCarga();
      const rejeitado = (await emitir(outra.id)).corpo.cte;
      expect(rejeitado.situacao).toBe("REJECTED");
      sefaz.modo = "autorizar";
      expect(await corrigir(rejeitado.id)).toMatchObject({ status: 409, corpo: { error: SO_AUTORIZADO_RECEBE_EVENTO } });
      // Cancelado também não recebe.
      expect((await cancelar(cte.id)).status).toBe(200);
      sefaz.chamadas.length = 0;
      expect(await corrigir(cte.id)).toMatchObject({ status: 409, corpo: { error: SO_AUTORIZADO_RECEBE_EVENTO } });
      expect(sefaz.chamadas).toHaveLength(0);
      expect((await eventosNoBanco(cte.id)).map((evento) => evento.type)).toEqual(["110111"]);
    });

    it("nada é dado como registrado sem o retorno da SEFAZ: recusa, evento sem vínculo (136) e falta de resposta não gravam; o 134 (vinculado, com alerta) grava", async () => {
      await prepararEmpresa();
      const { cte } = await cargaComCte();

      sefaz.modo = "rejeitar";
      expect(await corrigir(cte.id)).toMatchObject({ status: 409, corpo: { error: "A SEFAZ recusou a carta de correção: 220 - Rejeição: CTe autorizado há mais de 7 dias (168 horas)." } });
      sefaz.modo = "autorizar";
      sefaz.eventoComRessalva = 136;
      const semVinculo = await corrigir(cte.id);
      expect(semVinculo.status).toBe(409);
      expect(semVinculo.corpo.error).toContain("A SEFAZ guardou a carta de correção com ressalva (136 - Evento registrado, mas não vinculado a CT-e");
      sefaz.eventoComRessalva = null;
      sefaz.modo = "mudo";
      const muda = await corrigir(cte.id);
      expect(muda.status).toBe(504);
      expect(muda.corpo.error).toContain('Antes de tentar de novo, use "Conferir na SEFAZ"');
      expect(await eventosNoBanco(cte.id)).toHaveLength(0);
      expect(await trilha("cte.corrigir")).toHaveLength(0);

      sefaz.modo = "autorizar";
      sefaz.eventoComRessalva = 134;
      const comAlerta = await corrigir(cte.id);
      expect(comAlerta.status).toBe(200);
      expect((await eventosNoBanco(cte.id))[0]).toMatchObject({ type: "110110", sequence: 1, statusCode: 134 });
    });

    it("a resposta se perdeu depois de a SEFAZ registrar: a repetição é duplicidade (631), não vira registro; a conferência traz o evento e a próxima carta leva a sequência seguinte", async () => {
      await prepararEmpresa();
      const { cte } = await cargaComCte();
      sefaz.modo = "mudo-processando";
      expect((await corrigir(cte.id)).status).toBe(504);
      expect(await eventosNoBanco(cte.id)).toHaveLength(0);

      sefaz.modo = "autorizar";
      const repetida = await corrigir(cte.id);
      expect(repetida.status).toBe(409);
      expect(repetida.corpo.error).toContain("A SEFAZ já tem um evento deste tipo com a sequência 1 para este CT-e (631 - Rejeição: Duplicidade de evento");
      expect(await eventosNoBanco(cte.id)).toHaveLength(0);

      const conferida = await conferirNaSefaz(cte.id);
      expect(conferida.status).toBe(200);
      expect(conferida.corpo).toMatchObject({ novos: 1, cte: { situacao: "AUTHORIZED" } });
      expect(conferida.corpo.eventos).toMatchObject([{ tipo: "110110", sequencia: 1, deFora: true, descricao: "Carta de correção (registrado fora deste sistema)" }]);
      const [trazido] = await eventosNoBanco(cte.id);
      expect(trazido).toMatchObject({ xmlSent: "", createdById: null, statusCode: 135 });
      expect(trazido.xmlReturn).toMatch(/^<procEventoCTe[\s\S]*<\/procEventoCTe>$/);

      const seguinte = await corrigir(cte.id);
      expect(seguinte.status).toBe(200);
      expect(seguinte.corpo.eventos.map((evento) => evento.sequencia)).toEqual([1, 2]);
    });

    it("são no máximo 20 cartas por CT-e (regra O01): a 21ª nem vai à SEFAZ", async () => {
      await prepararEmpresa();
      const { cte } = await cargaComCte();
      for (let sequenciaDaCarta = 1; sequenciaDaCarta <= 20; sequenciaDaCarta += 1) {
        await banco.default.cteEvent.create({ data: { cteId: cte.id, type: "110110", sequence: sequenciaDaCarta, xmlSent: "<x/>", xmlReturn: "", statusCode: 135, statusReason: "Evento registrado", registeredAt: new Date() }, select: { id: true } });
      }
      sefaz.chamadas.length = 0;
      expect(await corrigir(cte.id)).toMatchObject({ status: 409, corpo: { error: LIMITE_DE_CARTAS } });
      expect(sefaz.chamadas).toHaveLength(0);
    });
  });

  const ctesDeCte = (cteId: string) => banco.sistema.cte.findUniqueOrThrow({ where: { id: cteId }, select: { collectionId: true } });

  /* ----------------------------- Comprovante de entrega ------------------------ */

  describe("comprovante de entrega (110180) e o cancelamento dele (110181)", () => {
    it("só com comprovante APROVADO e com imagem; registra com o hash da foto do canhoto, guarda o evento, e o cancelamento informa o protocolo dele", async () => {
      await prepararEmpresa({ proximoNumero: "200" });
      const { carga, cte } = await cargaComCte();

      // Sem comprovante, ou com comprovante ainda não aprovado: não há o que enviar.
      expect((await eventosDe(cte.id)).corpo.entrega).toEqual({ situacao: "INDISPONIVEL", motivo: SEM_COMPROVANTE_ACEITO, recebedor: null, entregueEm: null, imagem: null, protocolo: null });
      expect((await lista()).find((c) => c.id === carga.id)?.comprovanteAceito).toBe(false);
      const comprovante = await plantarComprovante(carga.id, { status: "SUBMITTED" }, [{ kind: "ENTREGA", dataUrl: ENTREGA }, { kind: "CANHOTO", dataUrl: CANHOTO }, { kind: "AVARIA", dataUrl: ASSINATURA }]);
      sefaz.chamadas.length = 0;
      expect(await registrarEntrega(cte.id)).toMatchObject({ status: 409, corpo: { error: SEM_COMPROVANTE_ACEITO } });
      expect(sefaz.chamadas).toHaveLength(0);

      await banco.default.proofOfDelivery.update({ where: { id: comprovante.id }, data: { status: "APPROVED" } });
      expect((await lista()).find((c) => c.id === carga.id)?.comprovanteAceito).toBe(true);
      expect((await eventosDe(cte.id, "FINANCE")).corpo.entrega).toEqual({ situacao: "DISPONIVEL", motivo: null, recebedor: "Maria Recebedora", entregueEm: comprovante.createdAt.toISOString(), imagem: "foto do canhoto", protocolo: null });

      const registrada = await registrarEntrega(cte.id);
      expect(registrada.status, registrada.corpo.error).toBe(200);
      expect(registrada.corpo.entrega).toMatchObject({ situacao: "REGISTRADA", recebedor: "Maria Recebedora", entregueEm: comprovante.createdAt.toISOString() });
      expect(registrada.corpo.entrega.protocolo).toMatch(/^\d{15}$/);
      expect(registrada.corpo.eventos).toMatchObject([{ tipo: "110180", sequencia: 1, canceladoEm: null }]);
      expect(registrada.corpo.eventos[0].descricao).toMatch(/^Entregue a Maria Recebedora em \d\d\/\d\d\/\d{4},? \d\d:\d\d \(foto do canhoto\)$/);

      const [enviado] = chamadasDe("CTeRecepcaoEventoV4");
      // Base64 do SHA-1 de: chave do CT-e + Base64 da imagem (MOC 4.00, item 6.8, campo IP09). É a foto do canhoto, não a da entrega.
      const hash = createHash("sha1").update(cte.chave + base64De(CANHOTO)).digest("base64");
      expect(enviado.dados).toContain(`<tpEvento>110180</tpEvento><nSeqEvento>1</nSeqEvento><detEvento versaoEvento="4.00"><evCECTe><descEvento>Comprovante de Entrega do CT-e</descEvento><nProt>${cte.protocolo}</nProt><dhEntrega>`);
      expect(enviado.dados).toContain(`<nDoc>123.456.789-00</nDoc><xNome>Maria Recebedora</xNome><latitude>-19.916681</latitude><longitude>-43.934493</longitude><hashEntrega>${hash}</hashEntrega><dhHashEntrega>`);
      expect(enviado.dados).toContain(`<infEntrega><chNFe>${carga.nota}</chNFe></infEntrega></evCECTe>`);
      expect(await errosNoEsquema(enviado.dados, "eventoCTe_v4.00.xsd")).toEqual([]);
      const detalhe = /<evCECTe>[\s\S]*<\/evCECTe>/.exec(enviado.dados)![0].replace("<evCECTe>", '<evCECTe xmlns="http://www.portalfiscal.inf.br/cte">');
      expect(await errosNoEsquema(detalhe, "evCECTe_v4.00.xsd")).toEqual([]);
      expect(assinaturaConfere(enviado.dados, certificado.certificadoPem)).toBe(true);

      const [linha] = await eventosNoBanco(cte.id);
      expect(linha).toMatchObject({ type: "110180", sequence: 1, statusCode: 135, xmlSent: enviado.dados, cancelledAt: null });
      expect(await errosNoEsquema(linha.xmlReturn, "procEventoCTe_v4.00.xsd")).toEqual([]);
      // Documento, posição, imagem e hash não vão para a auditoria nem para a tela.
      const [registro] = await trilha("cte.entrega");
      expect(registro.summary).toContain("Comprovante de entrega registrado na SEFAZ para o CT-e nº 200");
      expect(JSON.stringify([registro, registrada.corpo])).not.toMatch(/123\.456|-19\.9|hashEntrega|base64/);
      expect(JSON.stringify(registro)).not.toContain(hash);

      // Um comprovante por CT-e (regra O08), e com ele em vigor o CT-e não é cancelado (regra Q16): nada vai à SEFAZ.
      sefaz.chamadas.length = 0;
      expect(await registrarEntrega(cte.id)).toMatchObject({ status: 409, corpo: { error: ENTREGA_JA_REGISTRADA } });
      expect(await cancelar(cte.id)).toMatchObject({ status: 409, corpo: { error: CANCELAMENTO_COM_ENTREGA } });
      expect(sefaz.chamadas).toHaveLength(0);

      const cancelada = await cancelarEntrega(cte.id);
      expect(cancelada.status, cancelada.corpo.error).toBe(200);
      expect(chamadasDe("CTeRecepcaoEventoV4")[0].dados).toContain(`<tpEvento>110181</tpEvento><nSeqEvento>1</nSeqEvento><detEvento versaoEvento="4.00"><evCancCECTe><descEvento>Cancelamento do Comprovante de Entrega do CT-e</descEvento><nProt>${cte.protocolo}</nProt><nProtCE>${registrada.corpo.entrega.protocolo}</nProtCE></evCancCECTe>`);
      expect(cancelada.corpo.entrega.situacao).toBe("DISPONIVEL");
      expect(cancelada.corpo.eventos.map((evento) => [evento.tipo, evento.canceladoEm !== null])).toEqual([["110180", true], ["110181", false]]);
      expect(await trilha("cte.entrega.cancelar")).toHaveLength(1);
      expect(await cancelarEntrega(cte.id)).toMatchObject({ status: 409, corpo: { error: SEM_ENTREGA_REGISTRADA } });

      // Cancelado o comprovante, dá para registrar outro: a sequência do evento é a seguinte.
      const outra = await registrarEntrega(cte.id);
      expect(outra.corpo.eventos.map((evento) => [evento.tipo, evento.sequencia])).toEqual([["110180", 1], ["110181", 1], ["110180", 2]]);
      expect(outra.corpo.entrega.situacao).toBe("REGISTRADA");
    });

    it("a imagem do hash: o canhoto que vale hoje; sem canhoto, a foto da entrega; no comprovante antigo, a foto dele; por último, a assinatura", async () => {
      await prepararEmpresa();
      const casos: [string, Record<string, unknown>, Foto[], string, string][] = [
        ["canhoto substituído não vale", {}, [{ kind: "CANHOTO", dataUrl: ASSINATURA, replacedAt: new Date() }, { kind: "ENTREGA", dataUrl: ENTREGA }], "foto da entrega", base64De(ENTREGA)],
        ["comprovante antigo", { photoBase64: base64De(ENTREGA), signatureBase64: ASSINATURA }, [], "foto da entrega", base64De(ENTREGA)],
        ["só a assinatura", { signatureBase64: ASSINATURA }, [{ kind: "AVARIA", dataUrl: CANHOTO }, { kind: "FACHADA", dataUrl: CANHOTO }], "assinatura", base64De(ASSINATURA)],
      ];
      for (const [nome, trocas, fotos, imagem, base64] of casos) {
        const { carga, cte } = await cargaComCte();
        await plantarComprovante(carga.id, { latitude: null, longitude: null, ...trocas }, fotos);
        expect((await eventosDe(cte.id)).corpo.entrega, nome).toMatchObject({ situacao: "DISPONIVEL", imagem });
        sefaz.chamadas.length = 0;
        expect((await registrarEntrega(cte.id)).status, nome).toBe(200);
        const [enviado] = chamadasDe("CTeRecepcaoEventoV4");
        expect(enviado.dados, nome).toContain(`<hashEntrega>${createHash("sha1").update(cte.chave + base64).digest("base64")}</hashEntrega>`);
        // Sem posição no comprovante, o evento vai sem latitude e longitude.
        expect(enviado.dados, nome).not.toMatch(/latitude|longitude/);
      }
    });

    it("sem imagem, com recebedor incompleto ou com a entrega anterior à emissão do CT-e, o evento não é montado: 409 com o motivo, e nada vai à SEFAZ", async () => {
      await prepararEmpresa();
      const semImagem = await cargaComCte();
      await plantarComprovante(semImagem.carga.id, {}, [{ kind: "AVARIA", dataUrl: CANHOTO }]);
      const recebedorCurto = await cargaComCte();
      await plantarComprovante(recebedorCurto.carga.id, { receiverDoc: "1" });
      const antiga = await cargaComCte();
      await plantarComprovante(antiga.carga.id, { createdAt: new Date(Date.now() - 86_400_000) });

      sefaz.chamadas.length = 0;
      expect((await eventosDe(semImagem.cte.id)).corpo.entrega).toMatchObject({ situacao: "INDISPONIVEL", motivo: SEM_IMAGEM_NO_COMPROVANTE });
      expect(await registrarEntrega(semImagem.cte.id)).toMatchObject({ status: 409, corpo: { error: SEM_IMAGEM_NO_COMPROVANTE } });
      expect(await registrarEntrega(recebedorCurto.cte.id)).toMatchObject({ status: 409, corpo: { error: RECEBEDOR_INCOMPLETO } });
      expect((await registrarEntrega(antiga.cte.id)).corpo.error).toContain("antes da emissão deste CT-e");
      expect(await registrarEntrega(SEM_ID)).toMatchObject({ status: 404, corpo: { error: CTE_NAO_ENCONTRADO } });
      expect(await cancelarEntrega(SEM_ID)).toMatchObject({ status: 404 });
      expect(sefaz.chamadas).toHaveLength(0);
      expect(await banco.sistema.cteEvent.count({ where: DAS_EMPRESAS })).toBe(0);
    });

    it("a SEFAZ recusa ou não responde: o comprovante não fica registrado", async () => {
      await prepararEmpresa();
      const { carga, cte } = await cargaComCte();
      await plantarComprovante(carga.id);
      sefaz.modo = "rejeitar";
      expect((await registrarEntrega(cte.id)).corpo.error).toContain("A SEFAZ recusou o comprovante de entrega: 220");
      sefaz.modo = "mudo";
      expect((await registrarEntrega(cte.id)).status).toBe(504);
      expect(await eventosNoBanco(cte.id)).toHaveLength(0);
      expect((await eventosDe(cte.id)).corpo.entrega.situacao).toBe("DISPONIVEL");
    });
  });

  /* ------------------------------ Conferir na SEFAZ ---------------------------- */

  describe("conferir na SEFAZ (consulta pela chave)", () => {
    it("autorizado lá como aqui: nada muda; rejeitado e inexistente não se conferem; sem resposta da SEFAZ, nada muda", async () => {
      await prepararEmpresa({ proximoNumero: "300" });
      const { cte } = await cargaComCte();
      sefaz.chamadas.length = 0;
      const igual = await conferirNaSefaz(cte.id);
      expect(igual).toMatchObject({ status: 200, corpo: { novos: 0, eventos: [], cte: { id: cte.id, situacao: "AUTHORIZED" }, mensagem: "O CT-e nº 300 está autorizado na SEFAZ, como aqui (100 - Autorizado o uso do CT-e)." } });
      expect(sefaz.chamadas.map((chamada) => chamada.servico)).toEqual(["CTeConsultaV4"]);
      expect(await trilha("cte.conferir")).toHaveLength(0);

      sefaz.modo = "mudo";
      const muda = await conferirNaSefaz(cte.id);
      expect(muda.status).toBe(504);
      expect(muda.corpo.error).toContain("Nada mudou neste sistema");
      sefaz.modo = "rejeitar";
      const rejeitado = (await emitir((await novaCarga()).id)).corpo.cte;
      sefaz.modo = "autorizar";
      expect(await conferirNaSefaz(rejeitado.id)).toMatchObject({ status: 409, corpo: { error: SO_ENVIADO_SE_CONFERE } });
      expect(await conferirNaSefaz(SEM_ID)).toMatchObject({ status: 404, corpo: { error: CTE_NAO_ENCONTRADO } });
    });

    it("cancelado por fora (101 no topo): passa a cancelado aqui, com o protocolo do evento, a auditoria e o aviso; o evento fica gravado", async () => {
      await prepararEmpresa({ ambiente: "PRODUCAO", confirmacaoDoCnpj: CNPJ_DA_PADRAO, proximoNumero: "310" });
      const carga = await novaCarga();
      const cte = (await emitir(carga.id, undefined, "ADMIN")).corpo.cte;
      const protocolo = registrarEventoDeFora(sefaz, cte.chave, { tipo: "110111", sequencia: 1, detalhe: `<evCancCTe><descEvento>Cancelamento</descEvento><nProt>${cte.protocolo}</nProt><xJust>Cancelado no outro sistema da transportadora</xJust></evCancCTe>` });

      const conferida = await conferirNaSefaz(cte.id);
      expect(conferida.status).toBe(200);
      expect(conferida.corpo).toMatchObject({ novos: 1, cte: { situacao: "CANCELLED" } });
      expect(conferida.corpo.mensagem).toContain("A SEFAZ informa que o CT-e nº 310 está CANCELADO (101 - Cancelamento de CT-e homologado): a situação foi atualizada. 1 evento(s)");
      expect(conferida.corpo.eventos).toMatchObject([{ tipo: "110111", sequencia: 1, protocolo, deFora: true }]);
      const [linha] = await ctesDe(carga.id);
      expect(linha).toMatchObject({ status: "CANCELLED", cancelProtocol: protocolo, cancelReason: "Cancelado fora deste sistema (situação lida na consulta à SEFAZ)", statusCode: 101 });
      expect(linha.cancelledAt).not.toBeNull();
      // Em produção o CT-e da carga acompanha.
      expect(await banco.sistema.collection.findUniqueOrThrow({ where: { id: carga.id }, select: { cteStatus: true } })).toEqual({ cteStatus: "CANCELLED" });
      expect((await trilha("cte.conferir")).map((registro) => registro.summary)).toEqual([expect.stringContaining("está cancelado na SEFAZ (101")]);

      // De novo: nada a fazer, e nenhum evento em dobro.
      const outraVez = await conferirNaSefaz(cte.id);
      expect(outraVez.corpo).toMatchObject({ novos: 0, cte: { situacao: "CANCELLED" } });
      expect(outraVez.corpo.mensagem).toContain("está cancelado na SEFAZ, como aqui");
      expect(await eventosNoBanco(cte.id)).toHaveLength(1);
      expect(await trilha("cte.conferir")).toHaveLength(1);
    });

    it("grava os eventos vinculados que o sistema não tinha, uma vez só; o cancelamento de comprovante feito por fora marca o comprovante", async () => {
      await prepararEmpresa();
      const { carga, cte } = await cargaComCte();
      await plantarComprovante(carga.id);
      expect((await corrigir(cte.id)).status).toBe(200);
      const entrega = await registrarEntrega(cte.id);
      expect(entrega.status).toBe(200);

      registrarEventoDeFora(sefaz, cte.chave, { tipo: "310610", sequencia: 1, detalhe: "<evCTeAutorizadoMDFe><descEvento>MDF-e Autorizado</descEvento></evCTeAutorizadoMDFe>" });
      registrarEventoDeFora(sefaz, cte.chave, { tipo: "110110", sequencia: 2, detalhe: "<evCCeCTe><descEvento>Carta de Correcao</descEvento></evCCeCTe>" });
      registrarEventoDeFora(sefaz, cte.chave, {
        tipo: "110181",
        sequencia: 1,
        cancela: entrega.corpo.entrega.protocolo!,
        detalhe: `<evCancCECTe><descEvento>Cancelamento do Comprovante de Entrega do CT-e</descEvento><nProt>${cte.protocolo}</nProt><nProtCE>${entrega.corpo.entrega.protocolo}</nProtCE></evCancCECTe>`,
      });

      const conferida = await conferirNaSefaz(cte.id);
      expect(conferida.corpo).toMatchObject({ novos: 3, cte: { situacao: "AUTHORIZED" } });
      expect(conferida.corpo.mensagem).toContain("3 evento(s) que este sistema não tinha foram gravados.");
      expect(conferida.corpo.eventos.map((evento) => [evento.tipo, evento.sequencia, evento.deFora])).toEqual([["110110", 1, false], ["110180", 1, false], ["310610", 1, true], ["110110", 2, true], ["110181", 1, true]]);
      expect(conferida.corpo.eventos.find((evento) => evento.tipo === "310610")?.descricao).toBe("MDF-e autorizado (registrado fora deste sistema)");
      // O comprovante que o 110181 de fora cancelou deixa de estar em vigor.
      expect(conferida.corpo.eventos.find((evento) => evento.tipo === "110180")?.canceladoEm).not.toBeNull();
      expect((await eventosDe(cte.id)).corpo.entrega.situacao).toBe("DISPONIVEL");

      expect((await conferirNaSefaz(cte.id)).corpo.novos).toBe(0);
      expect(await eventosNoBanco(cte.id)).toHaveLength(5);
      // A próxima carta leva a sequência depois da que veio de fora.
      expect((await corrigir(cte.id)).corpo.eventos.filter((evento) => evento.tipo === "110110").map((evento) => evento.sequencia)).toEqual([1, 2, 3]);
    });

    it("envio que ficou sem resposta: se a SEFAZ autorizou, grava com o protocolo; se não consta, continua sem resposta", async () => {
      await prepararEmpresa({ proximoNumero: "320" });
      const autorizadoLa = await novaCarga();
      sefaz.modo = "mudo-processando";
      expect((await emitir(autorizadoLa.id)).status).toBe(504);
      const naoChegou = await novaCarga();
      sefaz.modo = "mudo";
      expect((await emitir(naoChegou.id)).status).toBe(504);
      sefaz.modo = "autorizar";

      const [orfao] = await ctesDe(autorizadoLa.id);
      const conferida = await conferirNaSefaz(orfao.id);
      expect(conferida.corpo.cte).toMatchObject({ situacao: "AUTHORIZED", numero: 320, semResposta: false });
      expect(conferida.corpo.cte.protocolo).toMatch(/^\d{15}$/);
      expect(conferida.corpo.mensagem).toMatch(/^A SEFAZ tinha autorizado o CT-e nº 320: ele está gravado, com o protocolo \d{15}\.$/);
      expect((await ctesDe(autorizadoLa.id))[0].xmlReturn).toContain("<cteProc");

      const [perdido] = await ctesDe(naoChegou.id);
      const semNada = await conferirNaSefaz(perdido.id);
      expect(semNada.corpo.cte).toMatchObject({ situacao: "DRAFT", semResposta: true });
      expect(semNada.corpo.mensagem).toContain('Ele continua "sem resposta": emitir de novo reenvia o mesmo XML, sem duplicar.');
      // E emitir de novo reenvia mesmo o MESMO XML.
      const retomada = await emitir(naoChegou.id);
      expect(retomada.corpo.cte).toMatchObject({ id: perdido.id, chave: perdido.accessKey, situacao: "AUTHORIZED" });
    });
  });

  /* ------------------------------------- SVC ----------------------------------- */

  describe("emissão pela SVC (contingência)", () => {
    it("não é oferecida sem uma emissão normal que não se resolveu; a justificativa é obrigatória", async () => {
      await prepararEmpresa({ proximoNumero: "400" });
      const carga = await novaCarga();
      expect((await conferencia(carga.id)).corpo.svc).toEqual({ nome: "SVC-RS", oferecida: false });
      sefaz.svcAtiva = true;
      expect(await emitir(carga.id, { justificativa: JUSTIFICATIVA })).toMatchObject({ status: 409, corpo: { error: SVC_NAO_OFERECIDA } });
      expect(await emitir(carga.id, { justificativa: "curta" })).toMatchObject({ status: 400, corpo: { error: "A justificativa da contingência precisa ter de 15 a 256 letras." } });
      expect(sefaz.chamadas).toHaveLength(0);
      expect(await ctesDe(carga.id)).toHaveLength(0);
      expect(await numeracao()).toBe(400);
      // Depois de autorizado, também não.
      expect((await emitir(carga.id)).corpo.autorizado).toBe(true);
      expect((await conferencia(carga.id)).corpo.svc).toEqual({ nome: "SVC-RS", oferecida: false });
      expect((await emitir(carga.id, { justificativa: JUSTIFICATIVA })).status).toBe(409);
    });

    it("autorizadora parada (108): com a SVC inativa nada é numerado; ativa, o CT-e sai com tpEmis 7, número novo e protocolo da SVC, e a justificativa fica na auditoria", async () => {
      await prepararEmpresa({ proximoNumero: "410" });
      const carga = await novaCarga();
      sefaz.modo = "parado";
      expect((await emitir(carga.id)).corpo).toMatchObject({ autorizado: false, cte: { situacao: "DRAFT", numero: 410, cStat: 108 } });
      expect((await conferencia(carga.id)).corpo.svc).toEqual({ nome: "SVC-RS", oferecida: true });
      expect(await numeracao()).toBe(411);

      // A SVC só vale quando a SEFAZ de origem a aciona: o status dela responde 114.
      sefaz.chamadas.length = 0;
      const inativa = await emitir(carga.id, { justificativa: JUSTIFICATIVA });
      expect(inativa.status).toBe(409);
      expect(inativa.corpo.error).toBe("A SVC-RS não está ativa para a sua UF (114 - SVC-RS desabilitada pela SEFAZ de Origem): é a SEFAZ de origem que a aciona. Nada foi emitido nem numerado. Tente a emissão normal ou aguarde.");
      expect(sefaz.chamadas.map((chamada) => [chamada.servico, chamada.svc])).toEqual([["CTeStatusServicoV4", "SVC-RS"]]);
      expect(await numeracao()).toBe(411);
      expect((await ctesDe(carga.id))[0]).toMatchObject({ status: "DRAFT", number: 410 });

      sefaz.svcAtiva = true;
      sefaz.chamadas.length = 0;
      const pelaSvc = await emitir(carga.id, { justificativa: JUSTIFICATIVA });
      expect(pelaSvc.status, pelaSvc.corpo.error).toBe(200);
      expect(pelaSvc.corpo).toMatchObject({ autorizado: true, cte: { situacao: "AUTHORIZED", numero: 411, svc: "SVC-RS", cStat: 100 } });
      expect(pelaSvc.corpo.mensagem).toMatch(/^CT-e nº 411 autorizado pela SVC-RS em homologação \(sem valor fiscal\)\. Protocolo \d{15}\.$/);
      // Status da SVC e recepção na SVC: nada vai à autorizadora parada (não havia envio sem resposta para consultar).
      expect(sefaz.chamadas.map((chamada) => [chamada.servico, chamada.svc])).toEqual([["CTeStatusServicoV4", "SVC-RS"], ["CTeRecepcaoSincV4", "SVC-RS"]]);
      const enviado = sefaz.chamadas[1].dados;
      expect(enviado).toContain("<tpEmis>7</tpEmis>");
      expect(enviado).not.toMatch(/dhCont|xJust|sign=/);
      expect(await errosNoEsquema(enviado, "cte_v4.00.xsd")).toEqual([]);
      expect(lerChaveDoCte(pelaSvc.corpo.cte.chave)).toMatchObject({ tipoDeEmissao: "7", numero: 411 });
      // O número do envio normal (410) não é reaproveitado na contingência; a linha é a mesma.
      const linhas = await ctesDe(carga.id);
      expect(linhas).toHaveLength(1);
      expect(linhas[0]).toMatchObject({ status: "AUTHORIZED", number: 411, accessKey: pelaSvc.corpo.cte.chave });
      expect(linhas[0].xmlReturn).toContain("<cteProc");
      expect(await numeracao()).toBe(412);
      const [contingencia] = await trilha("cte.contingencia");
      expect(contingencia.summary).toContain("CT-e nº 411");
      expect(contingencia.summary).toContain("enviado à SVC-RS (contingência)");
      expect(JSON.stringify(contingencia.after)).toContain(JUSTIFICATIVA);
      expect((await trilha("cte.emitir")).map((registro) => registro.summary)).toEqual([expect.stringContaining("CT-e nº 411 autorizado pela SVC-RS em homologação")]);
      expect((await lista()).find((c) => c.id === carga.id)).toMatchObject({ emitido: { numero: 411, svc: "SVC-RS" }, aResolver: [] });

      // O CT-e da SVC é conferido e cancelado NA SVC. Carta de correção e comprovante vão para a SEFAZ DE ORIGEM (a SVC os rejeita:
      // regra N09, 530). Enquanto a origem não tem o CT-e (217), nada é gravado e a sequência não é consumida.
      const cteId = pelaSvc.corpo.cte.id;
      const chave = pelaSvc.corpo.cte.chave;
      sefaz.modo = "autorizar";
      sefaz.chamadas.length = 0;
      expect((await conferirNaSefaz(cteId)).corpo.mensagem).toContain("está autorizado na SEFAZ, como aqui");
      expect(await corrigir(cteId)).toMatchObject({ status: 409, corpo: { error: SVC_AINDA_NAO_SINCRONIZADA } });
      await plantarComprovante(carga.id);
      expect(await registrarEntrega(cteId)).toMatchObject({ status: 409, corpo: { error: SVC_AINDA_NAO_SINCRONIZADA } });
      expect(sefaz.chamadas.map((chamada) => [chamada.servico, chamada.svc])).toEqual([["CTeConsultaV4", "SVC-RS"], ["CTeRecepcaoEventoV4", null], ["CTeRecepcaoEventoV4", null]]);
      expect(await banco.sistema.cteEvent.count({ where: { cteId } })).toBe(0);
      expect((await eventosDe(cteId)).corpo.entrega).toMatchObject({ situacao: "DISPONIVEL" });

      // A SVC repassou o CT-e à origem: a carta sai com a sequência 1 (a tentativa recusada não a consumiu), e a entrega é registrada e cancelada lá.
      sefaz.autorizados.get(chave)!.sincronizado = true;
      sefaz.chamadas.length = 0;
      const carta = await corrigir(cteId);
      expect(carta.status, carta.corpo.error).toBe(200);
      expect(carta.corpo.eventos).toMatchObject([{ tipo: "110110", sequencia: 1 }]);
      expect((await registrarEntrega(cteId)).corpo.entrega).toMatchObject({ situacao: "REGISTRADA" });
      expect((await cancelarEntrega(cteId)).corpo.entrega).toMatchObject({ situacao: "DISPONIVEL" });
      expect(sefaz.chamadas.map((chamada) => [chamada.servico, chamada.svc])).toEqual([["CTeRecepcaoEventoV4", null], ["CTeRecepcaoEventoV4", null], ["CTeRecepcaoEventoV4", null]]);
      expect(sefaz.chamadas.every((chamada) => chamada.dados.includes(`<chCTe>${chave}</chCTe>`))).toBe(true);
    });

    it("CT-e da SVC sem carta nem comprovante: o cancelamento vai para a SVC que o autorizou", async () => {
      await prepararEmpresa({ proximoNumero: "430" });
      const carga = await novaCarga();
      sefaz.modo = "parado";
      await emitir(carga.id);
      sefaz.svcAtiva = true;
      const pelaSvc = await emitir(carga.id, { justificativa: JUSTIFICATIVA });
      expect(pelaSvc.corpo).toMatchObject({ autorizado: true, cte: { svc: "SVC-RS" } });
      sefaz.chamadas.length = 0;
      expect((await cancelar(pelaSvc.corpo.cte.id)).corpo).toMatchObject({ situacao: "CANCELLED" });
      expect(sefaz.chamadas.map((chamada) => [chamada.servico, chamada.svc])).toEqual([["CTeRecepcaoEventoV4", "SVC-RS"]]);
    });

    it("envio sem resposta e a SEFAZ de origem fora do ar: a SVC emite outro CT-e, o envio fica à espera; depois, se a origem não o tem, ele é encerrado", async () => {
      await prepararEmpresa({ proximoNumero: "420" });
      const carga = await novaCarga();
      sefaz.modo = "mudo";
      expect((await emitir(carga.id)).status).toBe(504);
      expect((await conferencia(carga.id)).corpo.svc).toEqual({ nome: "SVC-RS", oferecida: true });

      sefaz.svcAtiva = true;
      sefaz.chamadas.length = 0;
      const pelaSvc = await emitir(carga.id, { justificativa: JUSTIFICATIVA });
      expect(pelaSvc.status, pelaSvc.corpo.error).toBe(200);
      expect(pelaSvc.corpo).toMatchObject({ autorizado: true, cte: { numero: 421, svc: "SVC-RS", situacao: "AUTHORIZED" } });
      expect(pelaSvc.corpo.mensagem).toContain('O envio normal anterior (CT-e nº 420) continua sem resposta: quando a SEFAZ de origem voltar, use "Conferir na SEFAZ" nele.');
      // Tentou a consulta na origem (que não respondeu) antes de emitir pela SVC.
      expect(sefaz.chamadas.map((chamada) => [chamada.servico, chamada.svc])).toEqual([["CTeStatusServicoV4", "SVC-RS"], ["CTeConsultaV4", null], ["CTeRecepcaoSincV4", "SVC-RS"]]);

      const [orfao, daSvc] = await ctesDe(carga.id);
      expect(orfao).toMatchObject({ status: "DRAFT", number: 420, unanswered: true });
      expect(daSvc).toMatchObject({ status: "AUTHORIZED", number: 421 });
      expect((await lista()).find((c) => c.id === carga.id)).toMatchObject({ emitido: { id: daSvc.id, numero: 421 }, aResolver: [{ id: orfao.id, numero: 420, situacao: "DRAFT", semResposta: true }] });
      // A carga já tem CT-e: não se emite outro, nem normal nem pela SVC.
      expect(await emitir(carga.id)).toMatchObject({ status: 409, corpo: { error: JA_AUTORIZADO } });

      // A origem voltou e não tem o envio (217): ele é encerrado, e o número não volta a ser usado.
      sefaz.modo = "autorizar";
      const conferida = await conferirNaSefaz(orfao.id);
      expect(conferida.corpo.cte).toMatchObject({ situacao: "REJECTED", semResposta: false, cStat: 217 });
      expect(conferida.corpo.mensagem).toContain("A SEFAZ não tem o envio do CT-e nº 420");
      expect((await ctesDe(carga.id))[0]).toMatchObject({ status: "REJECTED", numberBurned: true });
      expect((await lista()).find((c) => c.id === carga.id)).toMatchObject({ emitido: { id: daSvc.id }, aResolver: [] });
    }, 60_000);

    it("o envio sem resposta tinha sido autorizado pela origem: conferido depois, é gravado SEM tomar o lugar do CT-e da SVC e com a ordem de cancelar", async () => {
      await prepararEmpresa({ ambiente: "PRODUCAO", confirmacaoDoCnpj: CNPJ_DA_PADRAO, proximoNumero: "430" });
      const carga = await novaCarga();
      sefaz.modo = "mudo-processando";
      expect((await emitir(carga.id, undefined, "ADMIN")).status).toBe(504);
      // A origem cai de vez; a SVC é acionada.
      sefaz.modo = "mudo";
      sefaz.svcAtiva = true;
      const pelaSvc = await emitir(carga.id, { justificativa: JUSTIFICATIVA }, "ADMIN");
      expect(pelaSvc.corpo).toMatchObject({ autorizado: true, cte: { numero: 431, svc: "SVC-RS" } });
      const daCarga = () => banco.sistema.collection.findUniqueOrThrow({ where: { id: carga.id }, select: { cteKey: true, cteNumber: true, cteStatus: true } });
      expect(await daCarga()).toEqual({ cteKey: pelaSvc.corpo.cte.chave, cteNumber: 431, cteStatus: "ISSUED" });

      sefaz.modo = "autorizar";
      const [orfao] = await ctesDe(carga.id);
      const conferida = await conferirNaSefaz(orfao.id);
      expect(conferida.corpo.cte).toMatchObject({ situacao: "AUTHORIZED", numero: 430, svc: null });
      expect(conferida.corpo.cte.motivo).toBe("Autorizado pela SEFAZ de origem, mas a carga já tem o CT-e nº 431: este precisa ser CANCELADO (MOC 4.00, Visão Geral, item 11.5.3).");
      expect(conferida.corpo.mensagem).toMatch(/^A SEFAZ tinha autorizado o CT-e nº 430 \(protocolo \d{15}\), e a carga já tem o CT-e nº 431: CANCELE o CT-e nº 430/);
      // O CT-e da carga continua o da SVC.
      expect(await daCarga()).toEqual({ cteKey: pelaSvc.corpo.cte.chave, cteNumber: 431, cteStatus: "ISSUED" });
      expect((await lista()).find((c) => c.id === carga.id)).toMatchObject({ emitido: { numero: 431, svc: "SVC-RS" }, aResolver: [{ id: orfao.id, numero: 430, situacao: "AUTHORIZED" }] });

      // O cancelamento do normal vai à autorizadora da UF, e não mexe no CT-e da carga.
      sefaz.chamadas.length = 0;
      expect((await cancelar(orfao.id)).corpo).toMatchObject({ situacao: "CANCELLED", numero: 430 });
      expect(sefaz.chamadas.map((chamada) => [chamada.servico, chamada.svc])).toEqual([["CTeRecepcaoEventoV4", null]]);
      expect(await daCarga()).toEqual({ cteKey: pelaSvc.corpo.cte.chave, cteNumber: 431, cteStatus: "ISSUED" });
      expect((await lista()).find((c) => c.id === carga.id)).toMatchObject({ emitido: { numero: 431 }, aResolver: [] });
    }, 60_000);

    it("o envio sem resposta que a origem confirma autorizado NA HORA: ele é gravado e a SVC não emite nada", async () => {
      await prepararEmpresa({ proximoNumero: "440" });
      const carga = await novaCarga();
      sefaz.modo = "mudo-processando";
      expect((await emitir(carga.id)).status).toBe(504);
      sefaz.modo = "autorizar";
      sefaz.svcAtiva = true;
      sefaz.chamadas.length = 0;
      const recusa = await emitir(carga.id, { justificativa: JUSTIFICATIVA });
      expect(recusa.status).toBe(409);
      expect(recusa.corpo.error).toMatch(/^O envio normal anterior \(CT-e nº 440\) tinha sido autorizado pela SEFAZ \(protocolo \d{15}\) e agora está gravado: a carga já tem CT-e\. Nada foi emitido pela SVC-RS\.$/);
      expect(chamadasDe("CTeRecepcaoSincV4")).toHaveLength(0);
      const linhas = await ctesDe(carga.id);
      expect(linhas).toHaveLength(1);
      expect(linhas[0]).toMatchObject({ status: "AUTHORIZED", number: 440, unanswered: false });
      expect(await numeracao()).toBe(441);
      expect(await trilha("cte.contingencia")).toHaveLength(0);
    });

    it("a SVC rejeita ou não responde: nada fica autorizado; a nova tentativa pela SVC retoma o mesmo documento", async () => {
      await prepararEmpresa({ proximoNumero: "450" });
      const carga = await novaCarga();
      sefaz.modo = "parado";
      await emitir(carga.id);
      sefaz.svcAtiva = true;
      // O status da SVC responde; a recepção dela, não.
      sefaz.modoDe = { CTeRecepcaoSincV4: "mudo" };
      const muda = await emitir(carga.id, { justificativa: JUSTIFICATIVA });
      expect(muda.status).toBe(504);
      const [semResposta] = await ctesDe(carga.id);
      expect(semResposta).toMatchObject({ status: "DRAFT", number: 451, unanswered: true });
      expect(lerChaveDoCte(semResposta.accessKey).tipoDeEmissao).toBe("7");

      // A retomada consulta a SVC pela chave e reenvia o MESMO XML a ela.
      sefaz.modoDe = {};
      sefaz.chamadas.length = 0;
      const retomada = await emitir(carga.id, { justificativa: JUSTIFICATIVA });
      expect(retomada.corpo).toMatchObject({ autorizado: true, cte: { id: semResposta.id, numero: 451, chave: semResposta.accessKey, svc: "SVC-RS" } });
      expect(sefaz.chamadas.map((chamada) => [chamada.servico, chamada.svc])).toEqual([["CTeStatusServicoV4", "SVC-RS"], ["CTeConsultaV4", "SVC-RS"], ["CTeRecepcaoSincV4", "SVC-RS"]]);
      expect(sefaz.chamadas[2].dados).toBe(semResposta.xmlSent);
      expect(await numeracao()).toBe(452);
      // A justificativa entra na auditoria uma vez: a retomada não é uma nova contingência.
      expect(await trilha("cte.contingencia")).toHaveLength(1);
    }, 60_000);
  });

  /* --------------------------- Isolamento entre empresas ----------------------- */

  describe("isolamento entre empresas", () => {
    it("a outra empresa não vê os eventos, não corrige, não registra entrega e não confere o CT-e desta; o evento não aponta para CT-e de outra empresa", async () => {
      await prepararEmpresa();
      const { carga, cte } = await cargaComCte();
      await plantarComprovante(carga.id);
      expect((await corrigir(cte.id)).status).toBe(200);
      sefaz.chamadas.length = 0;

      expect((await eventosDe(cte.id, "ADMIN_DA_OUTRA")).status).toBe(404);
      expect((await corrigir(cte.id, undefined, "ADMIN_DA_OUTRA")).status).toBe(404);
      expect((await registrarEntrega(cte.id, "ADMIN_DA_OUTRA")).status).toBe(404);
      expect((await conferirNaSefaz(cte.id, "ADMIN_DA_OUTRA")).status).toBe(404);
      entrarComo("ADMIN_DA_OUTRA");
      expect((await entregaRota.DELETE(req("DELETE"), ctx(cte.id))).status).toBe(404);
      expect(sefaz.chamadas).toHaveLength(0);
      expect(await banco.sistema.cteEvent.count({ where: { tenantId: EMPRESA_OUTRA.id } })).toBe(0);
      expect(await eventosNoBanco(cte.id)).toHaveLength(1);

      // A tabela nova está no isolamento por empresa: a outra não lê a linha, e o gatilho recusa o evento que aponta para o CT-e desta.
      const outra = banco.paraEmpresa(EMPRESA_OUTRA.id).db;
      expect(await outra.cteEvent.count()).toBe(0);
      await expect(
        outra.cteEvent.create({ data: { cteId: cte.id, type: "110110", sequence: 9, xmlSent: "<x/>", xmlReturn: "", statusCode: 135, statusReason: "x", registeredAt: new Date() }, select: { id: true } }),
      ).rejects.toThrow();
      expect(await eventosNoBanco(cte.id)).toHaveLength(1);
    });
  });
});
