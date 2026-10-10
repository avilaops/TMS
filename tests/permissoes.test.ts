import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getServerSession } from "next-auth";

/**
 * Permissão por perfil nas rotas internas e gestão de usuários, contra um
 * Postgres de verdade.
 *
 * A sessão é simulada trocando `getServerSession`; todo o resto é o handler
 * que o Next executa em produção. Os usuários existem de verdade no banco
 * porque `requireStaff` confere o perfil lá, não no token.
 *
 * Sem DATABASE_URL a suite é pulada com aviso — no CI ela sempre roda, contra
 * o serviço `postgres` do workflow.
 */
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));

const temBanco = Boolean(process.env.DATABASE_URL);

if (!temBanco) {
  console.warn(
    "\n[permissoes.test] DATABASE_URL ausente: testes de integração PULADOS.\n" +
      "Rode com um Postgres real para exercitá-los.\n",
  );
}

const suite = temBanco ? describe : describe.skip;

// Tudo o que esta suite cria usa estes marcadores, e só isso é apagado.
const PREFIXO = "teste-permissoes-";
const CNPJ_TESTE = "99888777000166";
const HASH_FALSO = "$2b$10$hashfalsoparateste000000000000000000000000000000000";

type Perfil = "ADMIN" | "OPERATION" | "DRIVER" | "CLIENT";
type Handler = (req: Request) => Promise<Response>;

suite("permissões das rotas internas", () => {
  let prisma: typeof import("../src/lib/prisma").default;
  let clientes: typeof import("../src/app/api/clientes/route");
  let clientePorId: typeof import("../src/app/api/clientes/[id]/route");
  let coletas: typeof import("../src/app/api/coletas/route");
  let coletaPorId: typeof import("../src/app/api/coletas/[id]/route");
  let coletaHistorico: typeof import("../src/app/api/coletas/[id]/historico/route");
  let dashboard: typeof import("../src/app/api/dashboard/route");
  let financeiro: typeof import("../src/app/api/financeiro/route");
  let financeiroPorId: typeof import("../src/app/api/financeiro/[id]/route");
  let financeiroFluxo: typeof import("../src/app/api/financeiro/fluxo/route");
  let financeiroCobranca: typeof import("../src/app/api/financeiro/cobranca/route");
  let financeiroRecibo: typeof import("../src/app/api/financeiro/[id]/recibo/route");
  let relatorios: typeof import("../src/app/api/relatorios/route");
  let empresa: typeof import("../src/app/api/empresa/route");
  let empresaWebhook: typeof import("../src/app/api/empresa/webhook/route");
  let empresaWebhookTeste: typeof import("../src/app/api/empresa/webhook/teste/route");
  let fiscalNotas: typeof import("../src/app/api/fiscal/notas/route");
  let fiscalNota: typeof import("../src/app/api/fiscal/notas/[id]/route");
  let fiscalNotaXml: typeof import("../src/app/api/fiscal/notas/[id]/xml/route");
  let fiscalNotaCarga: typeof import("../src/app/api/fiscal/notas/[id]/carga/route");
  let fiscalNotaLigar: typeof import("../src/app/api/fiscal/notas/[id]/ligar/route");
  let fiscalCte: typeof import("../src/app/api/fiscal/cte/route");
  let manifestos: typeof import("../src/app/api/manifestos/route");
  let manifestoPorId: typeof import("../src/app/api/manifestos/[id]/route");
  let manifestoLiberar: typeof import("../src/app/api/manifestos/[id]/liberar/route");
  let manifestoCancelar: typeof import("../src/app/api/manifestos/[id]/cancelar/route");
  let manifestoFinalizar: typeof import("../src/app/api/manifestos/[id]/finalizar/route");
  let manifestoCarga: typeof import("../src/app/api/manifestos/[id]/coletas/[coletaId]/route");
  let motoristas: typeof import("../src/app/api/motoristas/route");
  let motoristaPorId: typeof import("../src/app/api/motoristas/[id]/route");
  let veiculos: typeof import("../src/app/api/veiculos/route");
  let veiculoPorId: typeof import("../src/app/api/veiculos/[id]/route");
  let manutencao: typeof import("../src/app/api/veiculos/[id]/manutencao/route");
  let abastecimentos: typeof import("../src/app/api/veiculos/[id]/abastecimentos/route");
  let abastecimento: typeof import("../src/app/api/veiculos/[id]/abastecimentos/[registroId]/route");
  let documentosDoVeiculo: typeof import("../src/app/api/veiculos/[id]/documentos/route");
  let documentoDoVeiculo: typeof import("../src/app/api/veiculos/[id]/documentos/[registroId]/route");
  let pneus: typeof import("../src/app/api/veiculos/[id]/pneus/route");
  let pneu: typeof import("../src/app/api/veiculos/[id]/pneus/[registroId]/route");
  let checklists: typeof import("../src/app/api/veiculos/[id]/checklists/route");
  let custosDoVeiculo: typeof import("../src/app/api/veiculos/[id]/custos/route");
  let frota: typeof import("../src/app/api/frota/route");
  let pendentes: typeof import("../src/app/api/dashboard/coletas/pendentes/route");
  let coletaStatus: typeof import("../src/app/api/dashboard/coletas/[id]/status/route");
  let crm: typeof import("../src/app/api/dashboard/crm/route");
  let crmLead: typeof import("../src/app/api/dashboard/crm/[id]/route");
  let crmConverter: typeof import("../src/app/api/dashboard/crm/[id]/converter/route");
  let ocorrencias: typeof import("../src/app/api/ocorrencias/route");
  let ocorrencia: typeof import("../src/app/api/ocorrencias/[id]/route");
  let ocorrenciaMensagens: typeof import("../src/app/api/ocorrencias/[id]/mensagens/route");
  let deposito: typeof import("../src/app/api/deposito/route");
  let depositoConferencia: typeof import("../src/app/api/deposito/conferencia/route");
  let depositoCarga: typeof import("../src/app/api/deposito/coletas/[id]/route");
  let depositoVolumes: typeof import("../src/app/api/deposito/coletas/[id]/volumes/route");
  let depositoPosicao: typeof import("../src/app/api/deposito/coletas/[id]/posicao/route");
  let depositoConcluir: typeof import("../src/app/api/deposito/coletas/[id]/concluir/route");
  let depositoPosicoes: typeof import("../src/app/api/deposito/posicoes/route");
  let depositoPosicaoPorId: typeof import("../src/app/api/deposito/posicoes/[id]/route");
  let usuarios: typeof import("../src/app/api/usuarios/route");
  let usuario: typeof import("../src/app/api/usuarios/[id]/route");
  let auditoria: typeof import("../src/app/api/auditoria/route");
  let eventos: typeof import("../src/app/api/eventos/route");
  let eventoReenviar: typeof import("../src/app/api/eventos/[id]/reenviar/route");
  let empresaCobranca: typeof import("../src/app/api/empresa/cobranca/route");
  let equipe: typeof import("../src/app/api/equipe/route");
  let equipeAjudantes: typeof import("../src/app/api/equipe/ajudantes/route");
  let equipeAjudante: typeof import("../src/app/api/equipe/ajudantes/[id]/route");
  let equipeAusencias: typeof import("../src/app/api/equipe/ausencias/route");
  let equipeAusencia: typeof import("../src/app/api/equipe/ausencias/[id]/route");
  let equipeAdiantamentos: typeof import("../src/app/api/equipe/adiantamentos/route");
  let equipeAdiantamento: typeof import("../src/app/api/equipe/adiantamentos/[id]/route");
  let equipeProdutividade: typeof import("../src/app/api/equipe/produtividade/route");
  let viagemDados: typeof import("../src/app/api/manifestos/[id]/dados/route");
  let viagemOrdem: typeof import("../src/app/api/manifestos/[id]/ordem/route");
  let viagemDespesas: typeof import("../src/app/api/manifestos/[id]/despesas/route");
  let viagemDespesa: typeof import("../src/app/api/manifestos/[id]/despesas/[despesaId]/route");
  let viagemAcerto: typeof import("../src/app/api/manifestos/[id]/acerto/route");

  const ids = {} as Record<Perfil, string>;
  let clienteId: string;

  const sessao = vi.mocked(getServerSession);

  function entrarComo(perfil: Perfil | null) {
    sessao.mockResolvedValue(
      perfil
        ? { user: { id: ids[perfil], role: perfil, clientId: null, name: perfil, email: `${perfil}@teste` } }
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
    await prisma.user.deleteMany({ where: { email: { startsWith: PREFIXO } } });
    await prisma.client.deleteMany({ where: { cnpj: CNPJ_TESTE } });
  }

  async function criarUsuario(nome: string, role: Perfil, extra: { clientId?: string } = {}) {
    return prisma.user.create({
      data: { name: nome, email: `${PREFIXO}${nome}@exemplo.br`, password: HASH_FALSO, role, ...extra },
    });
  }

  // Toda rota interna, com um corpo que seria aceito se a permissão deixasse
  // passar: nenhuma delas pode chegar ao banco com o perfil errado.
  let rotasStaff: [string, Handler][];
  let rotasAdmin: [string, Handler][];

  beforeAll(async () => {
    prisma = (await import("../src/lib/prisma")).default;
    clientes = await import("../src/app/api/clientes/route");
    clientePorId = await import("../src/app/api/clientes/[id]/route");
    coletas = await import("../src/app/api/coletas/route");
    coletaPorId = await import("../src/app/api/coletas/[id]/route");
    coletaHistorico = await import("../src/app/api/coletas/[id]/historico/route");
    dashboard = await import("../src/app/api/dashboard/route");
    financeiro = await import("../src/app/api/financeiro/route");
    financeiroPorId = await import("../src/app/api/financeiro/[id]/route");
    financeiroFluxo = await import("../src/app/api/financeiro/fluxo/route");
    financeiroCobranca = await import("../src/app/api/financeiro/cobranca/route");
    financeiroRecibo = await import("../src/app/api/financeiro/[id]/recibo/route");
    relatorios = await import("../src/app/api/relatorios/route");
    empresa = await import("../src/app/api/empresa/route");
    empresaWebhook = await import("../src/app/api/empresa/webhook/route");
    empresaWebhookTeste = await import("../src/app/api/empresa/webhook/teste/route");
    fiscalNotas = await import("../src/app/api/fiscal/notas/route");
    fiscalNota = await import("../src/app/api/fiscal/notas/[id]/route");
    fiscalNotaXml = await import("../src/app/api/fiscal/notas/[id]/xml/route");
    fiscalNotaCarga = await import("../src/app/api/fiscal/notas/[id]/carga/route");
    fiscalNotaLigar = await import("../src/app/api/fiscal/notas/[id]/ligar/route");
    fiscalCte = await import("../src/app/api/fiscal/cte/route");
    manifestos = await import("../src/app/api/manifestos/route");
    manifestoPorId = await import("../src/app/api/manifestos/[id]/route");
    manifestoLiberar = await import("../src/app/api/manifestos/[id]/liberar/route");
    manifestoCancelar = await import("../src/app/api/manifestos/[id]/cancelar/route");
    manifestoFinalizar = await import("../src/app/api/manifestos/[id]/finalizar/route");
    manifestoCarga = await import("../src/app/api/manifestos/[id]/coletas/[coletaId]/route");
    motoristas = await import("../src/app/api/motoristas/route");
    motoristaPorId = await import("../src/app/api/motoristas/[id]/route");
    veiculos = await import("../src/app/api/veiculos/route");
    veiculoPorId = await import("../src/app/api/veiculos/[id]/route");
    manutencao = await import("../src/app/api/veiculos/[id]/manutencao/route");
    abastecimentos = await import("../src/app/api/veiculos/[id]/abastecimentos/route");
    abastecimento = await import("../src/app/api/veiculos/[id]/abastecimentos/[registroId]/route");
    documentosDoVeiculo = await import("../src/app/api/veiculos/[id]/documentos/route");
    documentoDoVeiculo = await import("../src/app/api/veiculos/[id]/documentos/[registroId]/route");
    pneus = await import("../src/app/api/veiculos/[id]/pneus/route");
    pneu = await import("../src/app/api/veiculos/[id]/pneus/[registroId]/route");
    checklists = await import("../src/app/api/veiculos/[id]/checklists/route");
    custosDoVeiculo = await import("../src/app/api/veiculos/[id]/custos/route");
    frota = await import("../src/app/api/frota/route");
    pendentes = await import("../src/app/api/dashboard/coletas/pendentes/route");
    coletaStatus = await import("../src/app/api/dashboard/coletas/[id]/status/route");
    crm = await import("../src/app/api/dashboard/crm/route");
    crmLead = await import("../src/app/api/dashboard/crm/[id]/route");
    crmConverter = await import("../src/app/api/dashboard/crm/[id]/converter/route");
    ocorrencias = await import("../src/app/api/ocorrencias/route");
    ocorrencia = await import("../src/app/api/ocorrencias/[id]/route");
    ocorrenciaMensagens = await import("../src/app/api/ocorrencias/[id]/mensagens/route");
    deposito = await import("../src/app/api/deposito/route");
    depositoConferencia = await import("../src/app/api/deposito/conferencia/route");
    depositoCarga = await import("../src/app/api/deposito/coletas/[id]/route");
    depositoVolumes = await import("../src/app/api/deposito/coletas/[id]/volumes/route");
    depositoPosicao = await import("../src/app/api/deposito/coletas/[id]/posicao/route");
    depositoConcluir = await import("../src/app/api/deposito/coletas/[id]/concluir/route");
    depositoPosicoes = await import("../src/app/api/deposito/posicoes/route");
    depositoPosicaoPorId = await import("../src/app/api/deposito/posicoes/[id]/route");
    usuarios = await import("../src/app/api/usuarios/route");
    usuario = await import("../src/app/api/usuarios/[id]/route");
    auditoria = await import("../src/app/api/auditoria/route");
    eventos = await import("../src/app/api/eventos/route");
    eventoReenviar = await import("../src/app/api/eventos/[id]/reenviar/route");
    empresaCobranca = await import("../src/app/api/empresa/cobranca/route");
    equipe = await import("../src/app/api/equipe/route");
    equipeAjudantes = await import("../src/app/api/equipe/ajudantes/route");
    equipeAjudante = await import("../src/app/api/equipe/ajudantes/[id]/route");
    equipeAusencias = await import("../src/app/api/equipe/ausencias/route");
    equipeAusencia = await import("../src/app/api/equipe/ausencias/[id]/route");
    equipeAdiantamentos = await import("../src/app/api/equipe/adiantamentos/route");
    equipeAdiantamento = await import("../src/app/api/equipe/adiantamentos/[id]/route");
    equipeProdutividade = await import("../src/app/api/equipe/produtividade/route");
    viagemDados = await import("../src/app/api/manifestos/[id]/dados/route");
    viagemOrdem = await import("../src/app/api/manifestos/[id]/ordem/route");
    viagemDespesas = await import("../src/app/api/manifestos/[id]/despesas/route");
    viagemDespesa = await import("../src/app/api/manifestos/[id]/despesas/[despesaId]/route");
    viagemAcerto = await import("../src/app/api/manifestos/[id]/acerto/route");

    await limpar();

    const cliente = await prisma.client.create({
      data: { companyName: "Empresa Teste Permissoes LTDA", cnpj: CNPJ_TESTE },
    });
    clienteId = cliente.id;

    ids.ADMIN = (await criarUsuario("admin", "ADMIN")).id;
    ids.OPERATION = (await criarUsuario("operacao", "OPERATION")).id;
    ids.DRIVER = (await criarUsuario("motorista", "DRIVER")).id;
    ids.CLIENT = (await criarUsuario("cliente", "CLIENT", { clientId: clienteId })).id;

    const semId = "00000000-0000-0000-0000-000000000000";
    const registro = { params: Promise.resolve({ id: semId, registroId: semId }) };
    const despesaDaViagem = { params: Promise.resolve({ id: semId, despesaId: semId }) };

    rotasStaff = [
      ["GET /api/clientes", () => clientes.GET()],
      ["POST /api/clientes", () => clientes.POST(req("POST", { cnpj: "1", companyName: "x" }))],
      ["PATCH /api/clientes/[id]", () => clientePorId.PATCH(req("PATCH", { companyName: "Invasor LTDA" }), ctx(clienteId))],
      ["GET /api/coletas", () => coletas.GET()],
      ["POST /api/coletas", () => coletas.POST(req("POST", {}))],
      ["GET /api/coletas/[id]", () => coletaPorId.GET(req(), ctx(semId))],
      ["PATCH /api/coletas/[id]", () => coletaPorId.PATCH(req("PATCH", { volumes: 1 }), ctx(semId))],
      ["GET /api/coletas/[id]/historico", () => coletaHistorico.GET(req(), ctx(semId))],
      ["GET /api/dashboard", () => dashboard.GET()],
      ["GET /api/fiscal/notas", () => fiscalNotas.GET(req())],
      ["POST /api/fiscal/notas", () => fiscalNotas.POST(req("POST", {}))],
      ["GET /api/fiscal/notas/[id]", () => fiscalNota.GET(req(), ctx(semId))],
      ["GET /api/fiscal/notas/[id]/xml", () => fiscalNotaXml.GET(req(), ctx(semId))],
      ["POST /api/fiscal/notas/[id]/carga", () => fiscalNotaCarga.POST(req("POST", {}), ctx(semId))],
      ["POST /api/fiscal/notas/[id]/ligar", () => fiscalNotaLigar.POST(req("POST", {}), ctx(semId))],
      ["GET /api/fiscal/cte", () => fiscalCte.GET()],
      ["POST /api/fiscal/cte", () => fiscalCte.POST(req("POST", {}))],
      ["GET /api/manifestos", () => manifestos.GET()],
      ["POST /api/manifestos", () => manifestos.POST(req("POST", {}))],
      ["PATCH /api/manifestos/[id]", () => manifestoPorId.PATCH(req("PATCH", { driverId: semId }), ctx(semId))],
      ["POST /api/manifestos/[id]/liberar", () => manifestoLiberar.POST(req("POST"), ctx(semId))],
      ["POST /api/manifestos/[id]/cancelar", () => manifestoCancelar.POST(req("POST"), ctx(semId))],
      ["POST /api/manifestos/[id]/finalizar", () => manifestoFinalizar.POST(req("POST"), ctx(semId))],
      [
        "DELETE /api/manifestos/[id]/coletas/[coletaId]",
        () => manifestoCarga.DELETE(req("DELETE"), { params: Promise.resolve({ id: semId, coletaId: semId }) }),
      ],
      ["GET /api/motoristas", () => motoristas.GET()],
      ["POST /api/motoristas", () => motoristas.POST(req("POST", { cpf: "1", name: "x" }))],
      ["PATCH /api/motoristas/[id]", () => motoristaPorId.PATCH(req("PATCH", { active: false }), ctx(semId))],
      ["GET /api/veiculos", () => veiculos.GET()],
      ["POST /api/veiculos", () => veiculos.POST(req("POST", { plate: "X", model: "x", type: "VAN" }))],
      ["PATCH /api/veiculos/[id]", () => veiculoPorId.PATCH(req("PATCH", { status: "MAINTENANCE" }), ctx(semId))],
      ["GET /api/veiculos/[id]/manutencao", () => manutencao.GET(req(), ctx(semId))],
      ["POST /api/veiculos/[id]/manutencao", () => manutencao.POST(req("POST", {}), ctx(semId))],
      ["GET /api/veiculos/[id]", () => veiculoPorId.GET(req(), ctx(semId))],
      ["GET /api/veiculos/[id]/abastecimentos", () => abastecimentos.GET(req(), ctx(semId))],
      ["POST /api/veiculos/[id]/abastecimentos", () => abastecimentos.POST(req("POST", {}), ctx(semId))],
      ["DELETE /api/veiculos/[id]/abastecimentos/[registroId]", () => abastecimento.DELETE(req("DELETE"), registro)],
      ["GET /api/veiculos/[id]/documentos", () => documentosDoVeiculo.GET(req(), ctx(semId))],
      ["POST /api/veiculos/[id]/documentos", () => documentosDoVeiculo.POST(req("POST", {}), ctx(semId))],
      ["PATCH /api/veiculos/[id]/documentos/[registroId]", () => documentoDoVeiculo.PATCH(req("PATCH", { notes: "x" }), registro)],
      ["DELETE /api/veiculos/[id]/documentos/[registroId]", () => documentoDoVeiculo.DELETE(req("DELETE"), registro)],
      ["GET /api/veiculos/[id]/pneus", () => pneus.GET(req(), ctx(semId))],
      ["POST /api/veiculos/[id]/pneus", () => pneus.POST(req("POST", {}), ctx(semId))],
      ["PATCH /api/veiculos/[id]/pneus/[registroId]", () => pneu.PATCH(req("PATCH", { notes: "x" }), registro)],
      ["DELETE /api/veiculos/[id]/pneus/[registroId]", () => pneu.DELETE(req("DELETE"), registro)],
      ["GET /api/veiculos/[id]/checklists", () => checklists.GET(req(), ctx(semId))],
      ["POST /api/veiculos/[id]/checklists", () => checklists.POST(req("POST", {}), ctx(semId))],
      ["GET /api/frota", () => frota.GET()],
      ["GET /api/dashboard/coletas/pendentes", () => pendentes.GET(req())],
      ["POST /api/dashboard/coletas/[id]/status", () => coletaStatus.POST(req("POST", {}), ctx(semId))],
      ["GET /api/dashboard/crm", () => crm.GET()],
      ["PATCH /api/dashboard/crm/[id]", () => crmLead.PATCH(req("PATCH", {}), ctx(semId))],
      ["POST /api/dashboard/crm/[id]/converter", () => crmConverter.POST(req("POST", {}), ctx(semId))],
      ["GET /api/ocorrencias", () => ocorrencias.GET(req())],
      ["POST /api/ocorrencias", () => ocorrencias.POST(req("POST", { type: "OTHER", title: "Invasor", description: "x" }))],
      ["GET /api/ocorrencias/[id]", () => ocorrencia.GET(req(), ctx(semId))],
      ["PATCH /api/ocorrencias/[id]", () => ocorrencia.PATCH(req("PATCH", { status: "CLOSED" }), ctx(semId))],
      ["POST /api/ocorrencias/[id]/mensagens", () => ocorrenciaMensagens.POST(req("POST", { body: "x" }), ctx(semId))],
      ["GET /api/deposito", () => deposito.GET()],
      ["GET /api/deposito/conferencia", () => depositoConferencia.GET(req())],
      ["GET /api/deposito/coletas/[id]", () => depositoCarga.GET(req(), ctx(semId))],
      ["POST /api/deposito/coletas/[id]/volumes", () => depositoVolumes.POST(req("POST", { sequence: 1 }), ctx(semId))],
      ["POST /api/deposito/coletas/[id]/posicao", () => depositoPosicao.POST(req("POST", { locationCode: "A-01" }), ctx(semId))],
      ["POST /api/deposito/coletas/[id]/concluir", () => depositoConcluir.POST(req("POST"), ctx(semId))],
      ["GET /api/deposito/posicoes", () => depositoPosicoes.GET()],
      ["POST /api/deposito/posicoes", () => depositoPosicoes.POST(req("POST", { code: "INVASOR-01" }))],
      ["PATCH /api/deposito/posicoes/[id]", () => depositoPosicaoPorId.PATCH(req("PATCH", { active: false }), ctx(semId))],
      ["GET /api/equipe", () => equipe.GET()],
      ["GET /api/equipe/ajudantes", () => equipeAjudantes.GET()],
      ["POST /api/equipe/ajudantes", () => equipeAjudantes.POST(req("POST", { name: "Invasor", cpf: "99988877766" }))],
      ["PATCH /api/equipe/ajudantes/[id]", () => equipeAjudante.PATCH(req("PATCH", { active: false }), ctx(semId))],
      ["GET /api/equipe/ausencias", () => equipeAusencias.GET()],
      [
        "POST /api/equipe/ausencias",
        () => equipeAusencias.POST(req("POST", { driverId: semId, type: "VACATION", startDate: "2026-01-10", endDate: "2026-01-20" })),
      ],
      [
        "PATCH /api/equipe/ausencias/[id]",
        () => equipeAusencia.PATCH(req("PATCH", { type: "DAY_OFF", startDate: "2026-01-10", endDate: "2026-01-10" }), ctx(semId)),
      ],
      ["DELETE /api/equipe/ausencias/[id]", () => equipeAusencia.DELETE(req("DELETE"), ctx(semId))],
      ["GET /api/equipe/produtividade", () => equipeProdutividade.GET()],
      ["PATCH /api/manifestos/[id]/dados", () => viagemDados.PATCH(req("PATCH", { notes: "Invasor" }), ctx(semId))],
      ["PUT /api/manifestos/[id]/ordem", () => viagemOrdem.PUT(req("PUT", { collectionIds: [semId] }), ctx(semId))],
      ["GET /api/manifestos/[id]/despesas", () => viagemDespesas.GET(req(), ctx(semId))],
      ["POST /api/manifestos/[id]/despesas", () => viagemDespesas.POST(req("POST", { type: "TOLL", amount: "10", date: "2026-01-10" }), ctx(semId))],
      ["DELETE /api/manifestos/[id]/despesas/[despesaId]", () => viagemDespesa.DELETE(req("DELETE"), despesaDaViagem)],
    ];

    rotasAdmin = [
      ["GET /api/financeiro", () => financeiro.GET()],
      ["POST /api/financeiro", () => financeiro.POST(req("POST", {}))],
      ["PATCH /api/financeiro/[id]", () => financeiroPorId.PATCH(req("PATCH", { action: "pagar" }), ctx(semId))],
      ["DELETE /api/financeiro/[id]", () => financeiroPorId.DELETE(req("DELETE"), ctx(semId))],
      ["GET /api/financeiro/fluxo", () => financeiroFluxo.GET()],
      ["GET /api/financeiro/cobranca", () => financeiroCobranca.GET()],
      ["GET /api/financeiro/[id]/recibo", () => financeiroRecibo.GET(req(), ctx(semId))],
      ["GET /api/relatorios", () => relatorios.GET()],
      ["GET /api/veiculos/[id]/custos", () => custosDoVeiculo.GET(req(), ctx(semId))],
      ["PATCH /api/empresa", () => empresa.PATCH(req("PATCH", { name: "Invasora" }))],
      ["GET /api/empresa/webhook", () => empresaWebhook.GET()],
      ["PUT /api/empresa/webhook", () => empresaWebhook.PUT(req("PUT", { url: "https://invasor.exemplo.com/x" }))],
      ["POST /api/empresa/webhook/teste", () => empresaWebhookTeste.POST()],
      ["GET /api/usuarios", () => usuarios.GET()],
      ["POST /api/usuarios", () => usuarios.POST(req("POST", {}))],
      ["PATCH /api/usuarios/[id]", () => usuario.PATCH(req("PATCH", { name: "Invasor" }), ctx(ids.OPERATION))],
      ["GET /api/auditoria", () => auditoria.GET(req())],
      ["GET /api/eventos", () => eventos.GET(req())],
      ["POST /api/eventos/[id]/reenviar", () => eventoReenviar.POST(req("POST"), ctx(semId))],
      ["GET /api/empresa/cobranca", () => empresaCobranca.GET()],
      ["PATCH /api/empresa/cobranca", () => empresaCobranca.PATCH(req("PATCH", { multaPct: 50, jurosPct: 50 }))],
      ["GET /api/equipe/adiantamentos", () => equipeAdiantamentos.GET()],
      [
        "POST /api/equipe/adiantamentos",
        () => equipeAdiantamentos.POST(req("POST", { driverId: semId, date: "2026-01-10", amount: "100", reason: "TRIP" })),
      ],
      ["PATCH /api/equipe/adiantamentos/[id]", () => equipeAdiantamento.PATCH(req("PATCH", { action: "acertar", spentAmount: "1" }), ctx(semId))],
      ["PATCH /api/manifestos/[id]/despesas/[despesaId]", () => viagemDespesa.PATCH(req("PATCH", { action: "aprovar" }), despesaDaViagem)],
      ["GET /api/manifestos/[id]/acerto", () => viagemAcerto.GET(req(), ctx(semId))],
    ];
  });

  beforeEach(() => {
    sessao.mockReset();
  });

  afterAll(async () => {
    if (prisma) await limpar();
  });

  describe("sem sessão → 401", () => {
    it("em todas as rotas internas", async () => {
      entrarComo(null);
      for (const [nome, chamar] of [...rotasStaff, ...rotasAdmin]) {
        const res = await chamar(req());
        expect(res.status, nome).toBe(401);
      }
    });

    it("sessão de usuário que não existe mais também é 401", async () => {
      sessao.mockResolvedValue({
        user: { id: "00000000-0000-0000-0000-000000000000", role: "ADMIN", clientId: null },
      });
      expect((await clientes.GET()).status).toBe(401);
      expect((await usuarios.GET()).status).toBe(401);
    });
  });

  describe.each(["CLIENT", "DRIVER"] as const)("%s → 403", (perfil) => {
    it("em todas as rotas internas, sem gravar nada", async () => {
      entrarComo(perfil);
      const antes = await Promise.all([
        prisma.client.count(),
        prisma.driver.count(),
        prisma.vehicle.count(),
        prisma.user.count(),
      ]);

      for (const [nome, chamar] of [...rotasStaff, ...rotasAdmin]) {
        const res = await chamar(req());
        expect(res.status, nome).toBe(403);
      }

      const depois = await Promise.all([
        prisma.client.count(),
        prisma.driver.count(),
        prisma.vehicle.count(),
        prisma.user.count(),
      ]);
      expect(depois).toEqual(antes);
    });
  });

  describe("OPERATION", () => {
    it("lê as rotas operacionais → 200", async () => {
      entrarComo("OPERATION");
      expect((await clientes.GET()).status).toBe(200);
      expect((await coletas.GET()).status).toBe(200);
      expect((await dashboard.GET()).status).toBe(200);
      expect((await manifestos.GET()).status).toBe(200);
      expect((await motoristas.GET()).status).toBe(200);
      expect((await veiculos.GET()).status).toBe(200);
      expect((await pendentes.GET(req())).status).toBe(200);
      expect((await crm.GET()).status).toBe(200);
    });

    it("passa da permissão nas rotas de escrita (para na validação, 400)", async () => {
      entrarComo("OPERATION");
      expect((await clientes.POST(req("POST", {}))).status).toBe(400);
      expect((await fiscalNotas.POST(req("POST", {}))).status).toBe(400);
      expect((await fiscalCte.POST(req("POST", {}))).status).toBe(400);
    });

    it("não entra em financeiro nem em usuários → 403", async () => {
      entrarComo("OPERATION");
      for (const [nome, chamar] of rotasAdmin) {
        const res = await chamar(req());
        expect(res.status, nome).toBe(403);
      }
      const alvo = await prisma.user.findUniqueOrThrow({ where: { id: ids.OPERATION } });
      expect(alvo.name).toBe("operacao");
    });
  });

  describe("ADMIN", () => {
    it("lê financeiro e as rotas operacionais → 200", async () => {
      entrarComo("ADMIN");
      expect((await financeiro.GET()).status).toBe(200);
      expect((await clientes.GET()).status).toBe(200);
      expect((await veiculos.GET()).status).toBe(200);
    });

    it("lista usuários sem devolver a senha", async () => {
      entrarComo("ADMIN");
      const res = await usuarios.GET();
      expect(res.status).toBe(200);
      const lista = (await res.json()) as Record<string, unknown>[];

      expect(lista.length).toBeGreaterThanOrEqual(4);
      for (const item of lista) {
        expect(item).not.toHaveProperty("password");
        expect(Object.keys(item).sort()).toEqual(["clientId", "createdAt", "email", "id", "inviteAt", "inviteDetail", "inviteStatus", "name", "role"]);
      }
      expect(JSON.stringify(lista)).not.toContain(HASH_FALSO);
    });

    it("cria usuário sem senha, pede a liberação no login único, e e-mail repetido → 409", async () => {
      entrarComo("ADMIN");
      const email = `${PREFIXO}novo@exemplo.br`;
      const senha = "senha-de-teste-123";

      const res = await usuarios.POST(
        req("POST", { name: "Novo Operador", email: ` ${email.toUpperCase()} `, role: "OPERATION", password: senha }),
      );
      expect(res.status).toBe(201);
      const corpo = await res.json();
      expect(corpo).not.toHaveProperty("password");
      expect(corpo).toMatchObject({ name: "Novo Operador", email, role: "OPERATION", clientId: null });

      const gravado = await prisma.user.findFirstOrThrow({ where: { email } });
      // Senha no corpo é ignorada; a coluna guarda um valor que não é hash de nada.
      expect(gravado.password).toMatch(/^sem-senha:/);
      expect(corpo.acesso).toEqual({ ok: false, erro: expect.any(String) });

      const repetido = await usuarios.POST(
        req("POST", { name: "Outro", email, role: "OPERATION", password: senha }),
      );
      expect(repetido.status).toBe(409);
      expect(await prisma.user.count({ where: { email } })).toBe(1);
    });

    it("recusa dados inválidos → 400", async () => {
      entrarComo("ADMIN");
      const base = { name: "Fulano", email: `${PREFIXO}invalido@exemplo.br`, role: "OPERATION", password: "12345678" };

      const casos: [string, Record<string, unknown>][] = [
        ["e-mail inválido", { ...base, email: "nao-e-email" }],
        ["perfil inexistente", { ...base, role: "ROOT" }],
        ["CLIENT sem empresa", { ...base, role: "CLIENT" }],
        ["CLIENT com empresa inexistente", { ...base, role: "CLIENT", clientId: "nao-existe" }],
        ["DRIVER", { ...base, role: "DRIVER" }],
      ];
      for (const [nome, corpo] of casos) {
        const res = await usuarios.POST(req("POST", corpo));
        expect(res.status, nome).toBe(400);
      }
      expect(await prisma.user.count({ where: { email: base.email } })).toBe(0);

      const motorista = await usuarios.POST(req("POST", { ...base, role: "DRIVER" }));
      expect((await motorista.json()).error).toMatch(/cadastro de motoristas/);
    });

    it("cria CLIENT vinculado a uma empresa existente", async () => {
      entrarComo("ADMIN");
      const res = await usuarios.POST(
        req("POST", {
          name: "Contato Cliente",
          email: `${PREFIXO}contato@exemplo.br`,
          role: "CLIENT",
          password: "12345678",
          clientId: clienteId,
        }),
      );
      expect(res.status).toBe(201);
      expect((await res.json()).clientId).toBe(clienteId);
    });

    it("altera o nome; senha no corpo é ignorada", async () => {
      entrarComo("ADMIN");
      const alvo = await criarUsuario("alterar", "OPERATION");

      const res = await usuario.PATCH(
        req("PATCH", { name: "Nome Novo", password: "outra-senha-456" }),
        ctx(alvo.id),
      );
      expect(res.status).toBe(200);
      const corpo = await res.json();
      expect(corpo).not.toHaveProperty("password");
      expect(corpo.name).toBe("Nome Novo");

      const gravado = await prisma.user.findUniqueOrThrow({ where: { id: alvo.id } });
      expect(gravado.password).toBe(alvo.password);

      expect((await usuario.PATCH(req("PATCH", { password: "curta" }), ctx(alvo.id))).status).toBe(400);
      expect((await usuario.PATCH(req("PATCH", {}), ctx(alvo.id))).status).toBe(400);
      expect(
        (await usuario.PATCH(req("PATCH", { name: "X Y" }), ctx("00000000-0000-0000-0000-000000000000"))).status,
      ).toBe(404);
    });

    it("troca perfil; CLIENT exige empresa e DRIVER não entra nem sai por aqui", async () => {
      entrarComo("ADMIN");
      const alvo = await criarUsuario("trocar", "OPERATION");

      expect((await usuario.PATCH(req("PATCH", { role: "CLIENT" }), ctx(alvo.id))).status).toBe(400);
      expect((await usuario.PATCH(req("PATCH", { role: "DRIVER" }), ctx(alvo.id))).status).toBe(400);
      expect((await usuario.PATCH(req("PATCH", { role: "OPERATION" }), ctx(ids.DRIVER))).status).toBe(400);

      const paraCliente = await usuario.PATCH(req("PATCH", { role: "CLIENT", clientId: clienteId }), ctx(alvo.id));
      expect(paraCliente.status).toBe(200);
      expect(await paraCliente.json()).toMatchObject({ role: "CLIENT", clientId: clienteId });

      // Ao sair de CLIENT o vínculo com a empresa é desfeito.
      const paraOperacao = await usuario.PATCH(req("PATCH", { role: "OPERATION" }), ctx(alvo.id));
      expect(await paraOperacao.json()).toMatchObject({ role: "OPERATION", clientId: null });
    });

    it("rebaixar o último ADMIN (ele mesmo) → 409 e o perfil fica como estava", async () => {
      entrarComo("ADMIN");
      const res = await usuario.PATCH(req("PATCH", { role: "OPERATION" }), ctx(ids.ADMIN));
      expect(res.status).toBe(409);

      const admin = await prisma.user.findUniqueOrThrow({ where: { id: ids.ADMIN } });
      expect(admin.role).toBe("ADMIN");
      expect(await prisma.user.count({ where: { role: "ADMIN" } })).toBeGreaterThanOrEqual(1);
    });

    it("com outro ADMIN no sistema, rebaixar um deles é permitido e vale na hora", async () => {
      entrarComo("ADMIN");
      const segundo = await criarUsuario("segundo-admin", "ADMIN");

      const res = await usuario.PATCH(req("PATCH", { role: "OPERATION" }), ctx(segundo.id));
      expect(res.status).toBe(200);
      expect((await res.json()).role).toBe("OPERATION");

      // O token do rebaixado ainda diz ADMIN; o banco é que decide.
      sessao.mockResolvedValue({ user: { id: segundo.id, role: "ADMIN", clientId: null } });
      expect((await usuarios.GET()).status).toBe(403);
      expect((await financeiro.GET()).status).toBe(403);
      expect((await clientes.GET()).status).toBe(200);
    });
  });
});
