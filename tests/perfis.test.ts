/// <reference types="vite/client" />
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getServerSession } from "next-auth";
import { getToken } from "next-auth/jwt";
import { NextRequest } from "next/server";
import {
  CAPACIDADES,
  PERFIS,
  PERFIS_INTERNOS,
  ROTULO_DO_PERFIL,
  capacidadesDoPerfil,
  ehPerfilInterno,
  perfisQuePodem,
  pode,
  type Capacidade,
  type Perfil,
} from "../src/lib/permissoes";
import { createUserSchema, updateUserSchema } from "../src/lib/usuarios";
import { secoesDoMenu } from "../src/app/dashboard/menu";
import { showFinance } from "../src/app/dashboard/painel";
import { EMPRESA_OUTRA } from "./empresas-de-teste";

/**
 * Perfis de acesso: a matriz de `src/lib/permissoes.ts`, a capacidade que cada
 * rota interna exige e o que cada perfil recebe de volta.
 *
 * O que está escrito aqui é uma segunda cópia da matriz, de propósito: mudar o
 * acesso de um perfil exige mudar o código E este arquivo, e a diferença entre
 * os dois aparece no teste.
 */
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("next-auth/jwt", () => ({ getToken: vi.fn() }));

/* ------------------------------ A matriz esperada ----------------------------- */

// O que OPERATION podia antes dos perfis novos: toda rota que usava
// `requireStaff()` sem argumento. Esta lista não pode crescer nem encolher.
const DA_OPERACAO: Capacidade[] = [
  "painel",
  "clientesVer",
  "clientes",
  "clientesCondicoes",
  "crm",
  "tabelasFreteVer",
  "coletasVer",
  "coletas",
  "coletasStatus",
  "coletasFrete",
  "manifestosVer",
  "manifestos",
  "comprovantes",
  "deposito",
  "fiscalVer",
  "fiscal",
  "frotaVer",
  "frota",
  "frotaChecklist",
  "motoristasVer",
  "motoristas",
  "equipeVer",
  "equipe",
  "ocorrencias",
];

// O que era "só ADMIN" antes dos perfis novos.
const SO_DO_ADMIN_ANTES: Capacidade[] = [
  "tabelasFrete",
  "frotaCustos",
  "equipeValoresVer",
  "equipeValores",
  "financeiroVer",
  "financeiro",
  "faturamentoVer",
  "faturamento",
  "cobranca",
  "relatorios",
  "auditoria",
  "mensageriaVer",
  "mensageria",
  "usuarios",
  "empresa",
];

const ESPERADO: Record<Perfil, Capacidade[]> = {
  ADMIN: [...DA_OPERACAO, ...SO_DO_ADMIN_ANTES],
  OPERATION: DA_OPERACAO,
  // Tudo da operação, mais a leitura do que é dinheiro, relatório, auditoria e mensageria.
  DIRECTOR: [
    ...DA_OPERACAO,
    "frotaCustos",
    "equipeValoresVer",
    "financeiroVer",
    "faturamentoVer",
    "cobranca",
    "relatorios",
    "auditoria",
    "mensageriaVer",
  ],
  FINANCE: [
    "painel",
    "clientesVer",
    "clientesCondicoes",
    "tabelasFreteVer",
    "coletasVer",
    "coletasFrete",
    "manifestosVer",
    "fiscalVer",
    "frotaVer",
    "frotaCustos",
    "motoristasVer",
    "equipeVer",
    "equipeValoresVer",
    "equipeValores",
    "financeiroVer",
    "financeiro",
    "faturamentoVer",
    "faturamento",
    "cobranca",
    "relatorios",
  ],
  COMMERCIAL: ["painel", "clientesVer", "clientes", "clientesCondicoes", "crm", "tabelasFreteVer", "tabelasFrete", "coletasVer", "ocorrencias"],
  EXPEDITION: [
    "painel",
    "coletasVer",
    "coletasStatus",
    "manifestosVer",
    "manifestos",
    "comprovantes",
    "fiscalVer",
    "frotaVer",
    "frotaChecklist",
    "motoristasVer",
    "equipeVer",
    "ocorrencias",
  ],
  WAREHOUSE: ["painel", "coletasVer", "deposito", "ocorrencias"],
  DRIVER: [],
  CLIENT: [],
};

// Toda rota interna e a capacidade que ela exige. Rota nova entra aqui.
const ROTAS: Record<string, Capacidade> = {
  "GET /api/auditoria": "auditoria",
  "PATCH /api/clientes/[id]": "clientesCondicoes",
  "GET /api/clientes": "clientesVer",
  "POST /api/clientes": "clientes",
  "PATCH /api/coletas/[id]/frete": "coletasFrete",
  "GET /api/coletas/[id]/historico": "coletasVer",
  "GET /api/coletas/[id]": "coletasVer",
  "PATCH /api/coletas/[id]": "coletas",
  "GET /api/coletas": "coletasVer",
  "POST /api/coletas": "coletas",
  "POST /api/comprovantes/[id]/conferir": "comprovantes",
  "GET /api/comprovantes": "comprovantes",
  "POST /api/dashboard/coletas/[id]/status": "coletasStatus",
  "GET /api/dashboard/coletas/pendentes": "coletasVer",
  "POST /api/dashboard/crm/[id]/converter": "crm",
  "PATCH /api/dashboard/crm/[id]": "crm",
  "GET /api/dashboard/crm": "crm",
  "GET /api/dashboard": "painel",
  "POST /api/deposito/coletas/[id]/concluir": "deposito",
  "POST /api/deposito/coletas/[id]/posicao": "deposito",
  "GET /api/deposito/coletas/[id]": "deposito",
  "POST /api/deposito/coletas/[id]/volumes": "deposito",
  "GET /api/deposito/conferencia": "deposito",
  "PATCH /api/deposito/posicoes/[id]": "deposito",
  "GET /api/deposito/posicoes": "deposito",
  "POST /api/deposito/posicoes": "deposito",
  "GET /api/deposito": "deposito",
  "GET /api/empresa/gateway": "empresa",
  "PUT /api/empresa/gateway": "empresa",
  "DELETE /api/empresa/gateway": "empresa",
  "POST /api/empresa/gateway/teste": "empresa",
  "GET /api/empresa/cobranca": "empresa",
  "PATCH /api/empresa/cobranca": "empresa",
  "PATCH /api/empresa": "empresa",
  "GET /api/empresa/webhook": "empresa",
  "PUT /api/empresa/webhook": "empresa",
  "POST /api/empresa/webhook/teste": "empresa",
  "PATCH /api/equipe/adiantamentos/[id]": "equipeValores",
  "GET /api/equipe/adiantamentos": "equipeValoresVer",
  "POST /api/equipe/adiantamentos": "equipeValores",
  "PATCH /api/equipe/ajudantes/[id]": "equipe",
  "GET /api/equipe/ajudantes": "equipeVer",
  "POST /api/equipe/ajudantes": "equipe",
  "PATCH /api/equipe/ausencias/[id]": "equipe",
  "DELETE /api/equipe/ausencias/[id]": "equipe",
  "GET /api/equipe/ausencias": "equipeVer",
  "POST /api/equipe/ausencias": "equipe",
  "GET /api/equipe/produtividade": "equipeVer",
  "GET /api/equipe": "equipeVer",
  "POST /api/eventos/[id]/reenviar": "mensageria",
  "GET /api/eventos": "mensageriaVer",
  "GET /api/faturas/faturaveis": "faturamentoVer",
  "GET /api/faturas/[id]": "faturamentoVer",
  "PATCH /api/faturas/[id]": "faturamento",
  "POST /api/faturas/[id]/cobrancas": "faturamento",
  "POST /api/faturas/[id]/cobrancas/[cobrancaId]": "faturamento",
  "GET /api/faturas": "faturamentoVer",
  "POST /api/faturas": "faturamento",
  "GET /api/financeiro/cobranca": "cobranca",
  "POST /api/financeiro/conciliacao/certeiros": "financeiro",
  "PATCH /api/financeiro/conciliacao/[id]": "financeiro",
  "GET /api/financeiro/conciliacao": "financeiro",
  "POST /api/financeiro/conciliacao": "financeiro",
  "GET /api/financeiro/fluxo": "financeiroVer",
  "GET /api/financeiro/[id]/recibo": "financeiroVer",
  "PATCH /api/financeiro/[id]": "financeiro",
  "DELETE /api/financeiro/[id]": "financeiro",
  "GET /api/financeiro": "financeiroVer",
  "POST /api/financeiro": "financeiro",
  "GET /api/fiscal/cte": "fiscalVer",
  "POST /api/fiscal/cte": "fiscal",
  "POST /api/fiscal/notas/[id]/carga": "fiscal",
  "GET /api/fiscal/notas/[id]/danfe": "fiscalVer",
  "POST /api/fiscal/notas/[id]/ligar": "fiscal",
  "GET /api/fiscal/notas/[id]": "fiscalVer",
  "GET /api/fiscal/notas/[id]/xml": "fiscalVer",
  "GET /api/fiscal/notas": "fiscalVer",
  "POST /api/fiscal/notas": "fiscal",
  "GET /api/frota": "frotaVer",
  "GET /api/manifestos/[id]/acerto": "financeiroVer",
  "POST /api/manifestos/[id]/cancelar": "manifestos",
  "DELETE /api/manifestos/[id]/coletas/[coletaId]": "manifestos",
  "PATCH /api/manifestos/[id]/dados": "manifestos",
  "PATCH /api/manifestos/[id]/despesas/[despesaId]": "financeiro",
  "DELETE /api/manifestos/[id]/despesas/[despesaId]": "manifestos",
  "GET /api/manifestos/[id]/despesas": "manifestosVer",
  "POST /api/manifestos/[id]/despesas": "manifestos",
  "POST /api/manifestos/[id]/finalizar": "manifestos",
  "POST /api/manifestos/[id]/liberar": "manifestos",
  "PUT /api/manifestos/[id]/ordem": "manifestos",
  "POST /api/manifestos/[id]/roteiro": "manifestos",
  "PATCH /api/manifestos/[id]": "manifestos",
  "GET /api/manifestos": "manifestosVer",
  "POST /api/manifestos": "manifestos",
  "PATCH /api/motoristas/[id]": "motoristas",
  "GET /api/motoristas": "motoristasVer",
  "POST /api/motoristas": "motoristas",
  "POST /api/ocorrencias/[id]/mensagens": "ocorrencias",
  "GET /api/ocorrencias/[id]": "ocorrencias",
  "PATCH /api/ocorrencias/[id]": "ocorrencias",
  "GET /api/ocorrencias": "ocorrencias",
  "POST /api/ocorrencias": "ocorrencias",
  "GET /api/relatorios": "relatorios",
  "POST /api/tabelas-frete/calcular": "tabelasFreteVer",
  "PUT /api/tabelas-frete/[id]/cidades": "tabelasFrete",
  "GET /api/tabelas-frete/[id]": "tabelasFreteVer",
  "PATCH /api/tabelas-frete/[id]": "tabelasFrete",
  "GET /api/tabelas-frete": "tabelasFreteVer",
  "POST /api/tabelas-frete": "tabelasFrete",
  "POST /api/usuarios/[id]/acesso": "usuarios",
  "PATCH /api/usuarios/[id]": "usuarios",
  "GET /api/usuarios": "usuarios",
  "POST /api/usuarios": "usuarios",
  "DELETE /api/veiculos/[id]/abastecimentos/[registroId]": "frota",
  "GET /api/veiculos/[id]/abastecimentos": "frotaVer",
  "POST /api/veiculos/[id]/abastecimentos": "frota",
  "GET /api/veiculos/[id]/checklists": "frotaVer",
  "POST /api/veiculos/[id]/checklists": "frotaChecklist",
  "GET /api/veiculos/[id]/custos": "frotaCustos",
  "PATCH /api/veiculos/[id]/documentos/[registroId]": "frota",
  "DELETE /api/veiculos/[id]/documentos/[registroId]": "frota",
  "GET /api/veiculos/[id]/documentos": "frotaVer",
  "POST /api/veiculos/[id]/documentos": "frota",
  "GET /api/veiculos/[id]/manutencao": "frotaVer",
  "POST /api/veiculos/[id]/manutencao": "frota",
  "PATCH /api/veiculos/[id]/pneus/[registroId]": "frota",
  "DELETE /api/veiculos/[id]/pneus/[registroId]": "frota",
  "GET /api/veiculos/[id]/pneus": "frotaVer",
  "POST /api/veiculos/[id]/pneus": "frota",
  "GET /api/veiculos/[id]": "frotaVer",
  "PATCH /api/veiculos/[id]": "frota",
  "GET /api/veiculos": "frotaVer",
  "POST /api/veiculos": "frota",
};

// Arquivos de rota que não passam por `requireStaff`: públicos (entre eles o
// webhook do gateway de pagamento, protegido por assinatura), do portal do
// cliente (`requirePortalClient`), do motorista (`requireDriver`), da
// plataforma, do login e do sininho (`requireUsuario`: qualquer perfil, sempre
// só os avisos da própria pessoa). Rota nova sem guarda da equipe precisa
// entrar aqui, com consciência de que ela não é coberta pela matriz.
const FORA_DA_MATRIZ = [
  "/api/auth/[...nextauth]",
  "/api/cotacoes",
  "/api/driver/checklists",
  "/api/driver/entregas/[id]/baixa",
  "/api/driver/entregas/[id]/ocorrencia",
  "/api/driver/manifestos",
  "/api/driver/manifestos/[id]/despesas",
  "/api/driver/perfil",
  "/api/empresas",
  "/api/health",
  "/api/leads",
  "/api/notificacoes",
  "/api/notificacoes/aparelho",
  "/api/notificacoes/chave",
  "/api/notificacoes/lidas",
  // Webhook do Mercado Pago: público, sem sessão. Quem o protege é a assinatura do aviso,
  // conferida com o segredo da empresa do endereço, e nada do corpo vale: o pagamento é
  // buscado na API do Mercado Pago com o token dessa empresa.
  "/api/pagamentos/mercado-pago/[empresa]",
  "/api/plataforma/empresas",
  "/api/plataforma/empresas/[id]",
  "/api/portal/atendimento",
  "/api/portal/atendimento/[id]",
  "/api/portal/atendimento/[id]/mensagens",
  "/api/portal/coletas",
  "/api/portal/coletas/exportar",
  "/api/portal/coletas/[id]",
  "/api/portal/coletas/[id]/notas/[notaId]",
  "/api/portal/coletas/[id]/notas/[notaId]/danfe",
  "/api/portal/cotacao",
  "/api/portal/destinatarios",
  "/api/portal/destinatarios/[id]",
  "/api/portal/faturas",
  "/api/portal/minutas",
  "/api/portal/tabela-frete",
  "/api/rastreio",
  "/api/seed",
];

/* --------------------------- As rotas que existem hoje ------------------------- */

// O código-fonte de cada rota e o módulo dela, achados no disco: rota criada
// depois deste teste aparece aqui sozinha.
const FONTES = import.meta.glob<string>("../src/app/api/**/route.ts", { query: "?raw", import: "default", eager: true });
const MODULOS = import.meta.glob<Record<string, unknown>>("../src/app/api/**/route.ts");

const caminhoDaRota = (arquivo: string) => arquivo.replace("../src/app", "").replace("/route.ts", "");

type Guarda = { rota: string; capacidade: string };

/** Cada chamada de `requireStaff` do arquivo, com o método HTTP em que ela está e a capacidade pedida. */
function guardasDoArquivo(arquivo: string, fonte: string): Guarda[] {
  const guardas: Guarda[] = [];
  let metodo = "?";
  for (const linha of fonte.split("\n")) {
    const exportado = linha.match(/^export (?:async )?function (GET|POST|PUT|PATCH|DELETE)\b/);
    if (exportado) metodo = exportado[1];
    if (!/requireStaff\(/.test(linha) || /^\s*(\/\/|\*)/.test(linha)) continue;
    const pedido = linha.match(/requireStaff\(\{ pode: ['"](\w+)['"] \}\)/);
    guardas.push({ rota: `${metodo} ${caminhoDaRota(arquivo)}`, capacidade: pedido ? pedido[1] : `SEM CAPACIDADE: ${linha.trim()}` });
  }
  return guardas;
}

const GUARDAS = Object.entries(FONTES).flatMap(([arquivo, fonte]) => guardasDoArquivo(arquivo, fonte));

const ordenado = <T,>(lista: readonly T[]) => [...lista].sort();

/* ----------------------------------- Matriz ----------------------------------- */

describe("matriz de permissões", () => {
  it("cada perfil tem exatamente as capacidades esperadas", () => {
    for (const perfil of PERFIS) {
      expect(capacidadesDoPerfil(perfil), perfil).toEqual(ordenado(ESPERADO[perfil]));
    }
    // Nenhuma capacidade ficou fora da cópia deste teste.
    expect(ordenado(Object.keys(CAPACIDADES))).toEqual(ordenado(ESPERADO.ADMIN));
  });

  it("ADMIN tem tudo; DRIVER, CLIENT e perfil que não existe não têm nada", () => {
    for (const capacidade of Object.keys(CAPACIDADES) as Capacidade[]) {
      expect(pode("ADMIN", capacidade), capacidade).toBe(true);
      for (const perfil of ["DRIVER", "CLIENT", "ROOT", "admin", "", null, undefined]) {
        expect(pode(perfil, capacidade), `${capacidade} para ${String(perfil)}`).toBe(false);
      }
    }
  });

  it("OPERATION ficou como era: tem o que era da equipe e nada do que era só do administrador", () => {
    for (const capacidade of DA_OPERACAO) expect(pode("OPERATION", capacidade), capacidade).toBe(true);
    for (const capacidade of SO_DO_ADMIN_ANTES) expect(pode("OPERATION", capacidade), capacidade).toBe(false);
    expect(DA_OPERACAO.length + SO_DO_ADMIN_ANTES.length).toBe(Object.keys(CAPACIDADES).length);
  });

  it("DIRECTOR faz tudo o que OPERATION faz, lê o dinheiro e não escreve nele nem administra", () => {
    for (const capacidade of DA_OPERACAO) expect(pode("DIRECTOR", capacidade), capacidade).toBe(true);
    for (const capacidade of ["financeiroVer", "faturamentoVer", "cobranca", "relatorios", "auditoria", "frotaCustos", "equipeValoresVer"] as const) {
      expect(pode("DIRECTOR", capacidade), capacidade).toBe(true);
    }
    for (const capacidade of ["financeiro", "faturamento", "equipeValores", "tabelasFrete", "mensageria", "usuarios", "empresa"] as const) {
      expect(pode("DIRECTOR", capacidade), capacidade).toBe(false);
    }
  });

  it("dinheiro só para ADMIN, DIRECTOR e FINANCE; escrever nele, só ADMIN e FINANCE", () => {
    for (const capacidade of ["financeiroVer", "faturamentoVer", "cobranca", "relatorios", "frotaCustos", "equipeValoresVer"] as const) {
      expect(ordenado(perfisQuePodem(capacidade)), capacidade).toEqual(["ADMIN", "DIRECTOR", "FINANCE"]);
    }
    for (const capacidade of ["financeiro", "faturamento", "equipeValores"] as const) {
      expect(ordenado(perfisQuePodem(capacidade)), capacidade).toEqual(["ADMIN", "FINANCE"]);
    }
    for (const capacidade of ["usuarios", "empresa", "mensageria"] as const) {
      expect(perfisQuePodem(capacidade), capacidade).toEqual(["ADMIN"]);
    }
  });

  it("quem altera também lê: `x` está contido em `xVer`", () => {
    const pares: [Capacidade, Capacidade][] = (Object.keys(CAPACIDADES) as Capacidade[])
      .filter((capacidade) => `${capacidade}Ver` in CAPACIDADES)
      .map((capacidade) => [capacidade, `${capacidade}Ver` as Capacidade]);
    pares.push(["clientesCondicoes", "clientesVer"], ["coletasStatus", "coletasVer"], ["coletasFrete", "coletasVer"], ["frotaChecklist", "frotaVer"], ["frotaCustos", "frotaVer"]);
    expect(pares.length).toBeGreaterThanOrEqual(17);
    for (const [escreve, le] of pares) {
      for (const perfil of perfisQuePodem(escreve)) expect(pode(perfil, le), `${perfil}: ${escreve} sem ${le}`).toBe(true);
    }
  });

  it("perfis internos, rótulos em português e a validação do cadastro de usuário", () => {
    expect([...PERFIS_INTERNOS]).toEqual(["ADMIN", "DIRECTOR", "OPERATION", "FINANCE", "COMMERCIAL", "EXPEDITION", "WAREHOUSE"]);
    expect(ehPerfilInterno("WAREHOUSE")).toBe(true);
    for (const perfil of ["DRIVER", "CLIENT", "", null, undefined, "ROOT"]) expect(ehPerfilInterno(perfil), String(perfil)).toBe(false);

    expect(ROTULO_DO_PERFIL).toMatchObject({
      ADMIN: "Administrador",
      DIRECTOR: "Diretoria",
      OPERATION: "Operação",
      FINANCE: "Financeiro",
      COMMERCIAL: "Comercial",
      EXPEDITION: "Expedição",
      WAREHOUSE: "Conferência",
      DRIVER: "Motorista",
      CLIENT: "Cliente",
    });

    for (const role of PERFIS) {
      expect(createUserSchema.safeParse({ name: "Fulano de Tal", email: "fulano@exemplo.br", role }).success, role).toBe(true);
      expect(updateUserSchema.safeParse({ role }).success, role).toBe(true);
    }
    for (const role of ["ROOT", "director", "", "DIRETORIA"]) {
      expect(createUserSchema.safeParse({ name: "Fulano de Tal", email: "fulano@exemplo.br", role }).success, role).toBe(false);
      expect(updateUserSchema.safeParse({ role }).success, role).toBe(false);
    }
  });
});

describe("capacidade de cada rota interna", () => {
  it("toda chamada de requireStaff em src/app/api pede uma capacidade da matriz", () => {
    expect(GUARDAS.length).toBeGreaterThan(100);
    for (const { rota, capacidade } of GUARDAS) {
      expect(Object.keys(CAPACIDADES), rota).toContain(capacidade);
    }
  });

  it("a capacidade de cada rota é a registrada aqui, e nenhuma rota ficou de fora", () => {
    const encontradas = Object.fromEntries(GUARDAS.map(({ rota, capacidade }) => [rota, capacidade]));
    // Um método com duas guardas diferentes sumiria no `fromEntries`.
    expect(Object.keys(encontradas).length).toBe(GUARDAS.length);
    expect(encontradas).toEqual(ROTAS);
  });

  it("arquivo de rota sem requireStaff é um dos conhecidos (público, portal, motorista, plataforma)", () => {
    const semGuarda = Object.entries(FONTES)
      .filter(([, fonte]) => !fonte.includes("requireStaff("))
      .map(([arquivo]) => caminhoDaRota(arquivo));
    expect(ordenado(semGuarda)).toEqual(ordenado(FORA_DA_MATRIZ));
  });

  it("toda capacidade é exigida por alguma rota", () => {
    const usadas = new Set(Object.values(ROTAS));
    expect(ordenado([...usadas])).toEqual(ordenado(Object.keys(CAPACIDADES)));
  });
});

/* ------------------------------------ Menu ------------------------------------ */

describe("menu do painel por perfil", () => {
  const links = (perfil: string | undefined) =>
    secoesDoMenu(perfil)
      .flatMap((secao) => secao.links)
      .map((link) => link.href.replace("/dashboard", "") || "/");

  const DA_OPERACAO_NO_MENU = [
    "/",
    "/clientes",
    "/crm",
    "/tabelas-frete",
    "/coletas",
    "/deposito",
    "/manifestos",
    "/comprovantes",
    "/ocorrencias",
    "/fiscal",
    "/motoristas",
    "/veiculos",
    "/equipe",
    "/frota",
  ];

  it("ADMIN e OPERATION veem o mesmo menu de antes", () => {
    expect(links("OPERATION")).toEqual(DA_OPERACAO_NO_MENU);
    expect(secoesDoMenu("OPERATION").map((secao) => secao.titulo)).toEqual([null, "Comercial", "Operação", "Frota"]);
    expect(links("ADMIN")).toEqual([
      "/",
      "/clientes",
      "/crm",
      "/tabelas-frete",
      "/coletas",
      "/deposito",
      "/manifestos",
      "/comprovantes",
      "/ocorrencias",
      "/fiscal",
      "/faturamento",
      "/cobranca",
      "/financeiro",
      "/motoristas",
      "/veiculos",
      "/equipe",
      "/frota",
      "/relatorios",
      "/mensagens",
      "/auditoria",
      "/usuarios",
      "/empresa",
    ]);
  });

  it("cada perfil novo vê só o que pode abrir", () => {
    expect(links("DIRECTOR")).toEqual([
      "/",
      "/clientes",
      "/crm",
      "/tabelas-frete",
      "/coletas",
      "/deposito",
      "/manifestos",
      "/comprovantes",
      "/ocorrencias",
      "/fiscal",
      "/faturamento",
      "/cobranca",
      "/financeiro",
      "/motoristas",
      "/veiculos",
      "/equipe",
      "/frota",
      "/relatorios",
      "/mensagens",
      "/auditoria",
    ]);
    expect(links("FINANCE")).toEqual([
      "/",
      "/clientes",
      "/tabelas-frete",
      "/coletas",
      "/manifestos",
      "/fiscal",
      "/faturamento",
      "/cobranca",
      "/financeiro",
      "/motoristas",
      "/veiculos",
      "/equipe",
      "/frota",
      "/relatorios",
    ]);
    expect(links("COMMERCIAL")).toEqual(["/", "/clientes", "/crm", "/tabelas-frete", "/coletas", "/ocorrencias"]);
    expect(links("EXPEDITION")).toEqual(["/", "/coletas", "/manifestos", "/comprovantes", "/ocorrencias", "/fiscal", "/motoristas", "/veiculos", "/equipe", "/frota"]);
    expect(links("WAREHOUSE")).toEqual(["/", "/coletas", "/deposito", "/ocorrencias"]);
  });

  it("sem perfil, ou com perfil de fora da equipe, o menu vem vazio", () => {
    for (const perfil of [undefined, "", "DRIVER", "CLIENT", "ROOT"]) expect(links(perfil), String(perfil)).toEqual([]);
  });

  it("sem a resposta do painel, o cartão de receita segue o perfil da sessão", () => {
    const carregando = { status: "loading" } as const;
    for (const perfil of ["ADMIN", "DIRECTOR", "FINANCE"]) expect(showFinance(carregando, perfil), perfil).toBe(true);
    for (const perfil of ["OPERATION", "COMMERCIAL", "EXPEDITION", "WAREHOUSE", "DRIVER", "CLIENT", undefined]) {
      expect(showFinance(carregando, perfil), String(perfil)).toBe(false);
    }
  });
});

/* ------------------------------------ Proxy ----------------------------------- */

describe("separação das áreas por perfil (proxy)", () => {
  const token = vi.mocked(getToken);

  async function abrir(caminho: string, perfil: string) {
    const { proxy } = await import("../src/proxy");
    token.mockResolvedValue({ conta: { email: "x@exemplo.br", nome: "X", papel: "CLIENTE" }, tenantId: "empresa", role: perfil } as never);
    const res = await proxy(new NextRequest(`http://localhost${caminho}`));
    const destino = res.headers.get("location");
    return destino ? new URL(destino).pathname : "segue";
  }

  it("a equipe interna inteira entra em /dashboard e não entra em /driver nem em /portal", async () => {
    for (const perfil of PERFIS_INTERNOS) {
      expect(await abrir("/dashboard", perfil), perfil).toBe("segue");
      expect(await abrir("/dashboard/financeiro", perfil), perfil).toBe("segue");
      expect(await abrir("/driver", perfil), perfil).toBe("/dashboard");
      expect(await abrir("/portal/coletas", perfil), perfil).toBe("/dashboard");
    }
  });

  it("motorista e cliente continuam cada um na sua área", async () => {
    expect(await abrir("/dashboard", "DRIVER")).toBe("/driver");
    expect(await abrir("/driver", "DRIVER")).toBe("segue");
    expect(await abrir("/dashboard/usuarios", "CLIENT")).toBe("/portal");
    expect(await abrir("/portal", "CLIENT")).toBe("segue");
    expect(await abrir("/dashboard", "ROOT")).toBe("/empresa");
    expect(await abrir("/dashboard", "")).toBe("/empresa");
  });
});

/* ------------------------------- Rotas, com banco ------------------------------ */

const temBanco = Boolean(process.env.DATABASE_URL);

if (!temBanco) {
  console.warn("\n[perfis.test] DATABASE_URL ausente: testes de integração PULADOS.\nRode com um Postgres real para exercitá-los.\n");
}

const suite = temBanco ? describe : describe.skip;

// Tudo o que esta suite cria usa estes marcadores, e só isso é apagado.
const PREFIXO = "teste-perfis-";
const CNPJ_TESTE = "99888777000247";
const CPF_TESTE = "99888777247";
const HASH_FALSO = "$2b$10$hashfalsoparateste000000000000000000000000000000000";
const SEM_ID = "00000000-0000-0000-0000-000000000000";

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

suite("perfis nas rotas internas", () => {
  let banco: typeof import("../src/lib/prisma");
  const ids = {} as Record<Perfil, string>;
  const handlers = new Map<string, Handler>();
  let clienteId: string;
  let motoristaId: string;

  const sessao = vi.mocked(getServerSession);

  function entrarComo(perfil: Perfil | null) {
    sessao.mockResolvedValue(perfil ? { user: { id: ids[perfil], role: perfil, clientId: null, name: perfil, email: `${perfil}@teste` } } : null);
  }

  const req = (method = "GET", body?: unknown) =>
    new Request("http://localhost/api/teste", {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  const ctx = (id: string) => ({ params: Promise.resolve({ id, registroId: SEM_ID, despesaId: SEM_ID, coletaId: SEM_ID }) });

  /** Chama a rota registrada em `ROTAS` com um corpo vazio e ids que não existem. */
  const chamar = (rota: string, body: unknown = {}, id = SEM_ID) => {
    const metodo = rota.split(" ")[0];
    const handler = handlers.get(rota);
    if (!handler) throw new Error(`Rota sem handler: ${rota}`);
    return handler(req(metodo, metodo === "GET" ? undefined : body), ctx(id));
  };

  async function limpar() {
    const { sistema } = banco;
    await sistema.occurrence.deleteMany({ where: { OR: [{ title: { startsWith: PREFIXO } }, { openedBy: { email: { startsWith: PREFIXO } } }] } });
    await sistema.driver.deleteMany({ where: { cpf: CPF_TESTE } });
    await sistema.auditLog.deleteMany({ where: { userName: { startsWith: PREFIXO } } });
    await sistema.user.deleteMany({ where: { email: { startsWith: PREFIXO } } });
    await sistema.client.deleteMany({ where: { cnpj: CNPJ_TESTE } });
  }

  const criarUsuario = (nome: string, role: Perfil, extra: { clientId?: string } = {}) =>
    banco.default.user.create({ data: { name: `${PREFIXO}${nome}`, email: `${PREFIXO}${nome}@exemplo.br`, password: HASH_FALSO, role, ...extra } });

  beforeAll(async () => {
    banco = await import("../src/lib/prisma");

    // Só as rotas da equipe: as outras (login, portal, motorista) não são desta matriz.
    for (const [arquivo, carregar] of Object.entries(MODULOS)) {
      if (!FONTES[arquivo].includes("requireStaff(")) continue;
      const modulo = await carregar();
      for (const metodo of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
        if (typeof modulo[metodo] === "function") handlers.set(`${metodo} ${caminhoDaRota(arquivo)}`, modulo[metodo] as Handler);
      }
    }

    await limpar();

    const cliente = await banco.default.client.create({
      data: { companyName: "Empresa Teste Perfis LTDA", cnpj: CNPJ_TESTE, paymentCondition: "30 dias", creditLimit: 1000 },
    });
    clienteId = cliente.id;

    for (const perfil of PERFIS) {
      ids[perfil] = (await criarUsuario(perfil.toLowerCase(), perfil, perfil === "CLIENT" ? { clientId: cliente.id } : {})).id;
    }

    const motorista = await banco.default.driver.create({
      data: { userId: ids.DRIVER, cpf: CPF_TESTE, cnh: "12345678900", cnhExpiry: new Date("2030-01-01T00:00:00.000Z"), category: "C", commissionPct: 7.5 },
    });
    motoristaId = motorista.id;
  }, 120_000);

  beforeEach(() => {
    sessao.mockReset();
  });

  afterAll(async () => {
    if (banco) await limpar();
  });

  describe("matriz perfil × rota", () => {
    const contar = async () => {
      const db = banco.default;
      return [
        await db.client.count(),
        await db.driver.count(),
        await db.vehicle.count(),
        await db.user.count(),
        await db.collection.count(),
        await db.manifest.count(),
        await db.financialTransaction.count(),
        await db.invoice.count(),
        await db.freightTable.count(),
        await db.occurrence.count(),
      ];
    };

    it("toda rota registrada tem handler", () => {
      for (const rota of Object.keys(ROTAS)) expect(handlers.has(rota), rota).toBe(true);
    });

    it("sem sessão → 401 em todas", async () => {
      entrarComo(null);
      for (const rota of Object.keys(ROTAS)) expect((await chamar(rota)).status, rota).toBe(401);
    });

    // ADMIN fica de fora deste laço de propósito: ele passa em todas, e chamar
    // todas com corpo vazio dispararia o envio de teste do webhook. O acesso do
    // ADMIN está em tests/permissoes.test.ts e na matriz acima.
    it.each(["OPERATION", "DIRECTOR", "FINANCE", "COMMERCIAL", "EXPEDITION", "WAREHOUSE", "DRIVER", "CLIENT"] as const)(
      "%s: 403 no que não pode, passa da permissão no que pode, e nada é gravado",
      async (perfil) => {
        entrarComo(perfil);
        const antes = await contar();
        const liberadas: string[] = [];

        for (const [rota, capacidade] of Object.entries(ROTAS)) {
          const res = await chamar(rota);
          if (ESPERADO[perfil].includes(capacidade)) {
            liberadas.push(rota);
            // Passou da permissão: para na validação (400), no que não existe (404) ou responde (200).
            expect([401, 403], `${perfil} deveria passar em ${rota} (${capacidade})`).not.toContain(res.status);
            expect(res.status, `${perfil} em ${rota}`).toBeLessThan(500);
          } else {
            expect(res.status, `${perfil} não deveria passar em ${rota} (${capacidade})`).toBe(403);
          }
        }

        expect(await contar()).toEqual(antes);
        if (perfil === "DRIVER" || perfil === "CLIENT") expect(liberadas).toEqual([]);
        else expect(liberadas.length).toBeGreaterThan(0);
      },
      180_000,
    );

    it("o perfil vale só na empresa dele: usuário de outra empresa é 401, mesmo sendo do financeiro lá", async () => {
      const { db } = banco.paraEmpresa(EMPRESA_OUTRA.id);
      const deFora = await db.user.create({
        data: { name: `${PREFIXO}de-fora`, email: `${PREFIXO}de-fora@exemplo.br`, password: HASH_FALSO, role: "FINANCE" },
      });
      sessao.mockResolvedValue({ user: { id: deFora.id, role: "FINANCE", clientId: null } });
      for (const rota of ["GET /api/financeiro", "GET /api/faturas", "GET /api/relatorios", "GET /api/clientes", "GET /api/dashboard"]) {
        expect((await chamar(rota)).status, rota).toBe(401);
      }
    });

    it("o perfil vem do banco: token antigo de ADMIN não vale para quem virou Conferência", async () => {
      sessao.mockResolvedValue({ user: { id: ids.WAREHOUSE, role: "ADMIN", clientId: null } });
      expect((await chamar("GET /api/financeiro")).status).toBe(403);
      expect((await chamar("GET /api/usuarios")).status).toBe(403);
      expect((await chamar("GET /api/deposito")).status).toBe(200);
    });
  });

  describe("campos que a resposta esconde por capacidade", () => {
    const corpo = async (rota: string) => {
      const res = await chamar(rota);
      expect(res.status, rota).toBe(200);
      return res.json();
    };

    it("/api/dashboard: receita só para quem lê o financeiro", async () => {
      for (const perfil of ["ADMIN", "DIRECTOR", "FINANCE"] as const) {
        entrarComo(perfil);
        const stats = await corpo("GET /api/dashboard");
        expect(stats, perfil).toHaveProperty("receita");
        expect(stats, perfil).toHaveProperty("receitaDoMes");
      }
      for (const perfil of ["OPERATION", "COMMERCIAL", "EXPEDITION", "WAREHOUSE"] as const) {
        entrarComo(perfil);
        const stats = await corpo("GET /api/dashboard");
        expect(stats, perfil).not.toHaveProperty("receita");
        expect(stats, perfil).not.toHaveProperty("receitaDoMes");
        expect(stats, perfil).toHaveProperty("coletas");
      }
    });

    it("/api/frota: custo do mês só para quem tem os custos da frota", async () => {
      for (const perfil of ["ADMIN", "DIRECTOR", "FINANCE"] as const) {
        entrarComo(perfil);
        expect(await corpo("GET /api/frota"), perfil).toHaveProperty("custoDoMes");
      }
      for (const perfil of ["OPERATION", "EXPEDITION"] as const) {
        entrarComo(perfil);
        const resposta = await corpo("GET /api/frota");
        expect(resposta, perfil).not.toHaveProperty("custoDoMes");
        expect(resposta, perfil).toHaveProperty("alertas");
      }
    });

    it("/api/equipe/produtividade: frete e comissão só para quem lê os valores da equipe", async () => {
      for (const perfil of ["ADMIN", "DIRECTOR", "FINANCE"] as const) {
        entrarComo(perfil);
        expect((await corpo("GET /api/equipe/produtividade")).comValores, perfil).toBe(true);
      }
      for (const perfil of ["OPERATION", "EXPEDITION"] as const) {
        entrarComo(perfil);
        const resposta = await corpo("GET /api/equipe/produtividade");
        expect(resposta.comValores, perfil).toBe(false);
        expect(JSON.stringify(resposta), perfil).not.toMatch(/comissao|frete/i);
      }
    });

    it("/api/motoristas: percentual de comissão só para quem lê os valores da equipe", async () => {
      const doTeste = async () => ((await corpo("GET /api/motoristas")) as { id: string; commissionPct?: number }[]).find((m) => m.id === motoristaId);

      for (const perfil of ["ADMIN", "DIRECTOR", "FINANCE"] as const) {
        entrarComo(perfil);
        expect((await doTeste())?.commissionPct, perfil).toBe(7.5);
      }
      for (const perfil of ["OPERATION", "EXPEDITION"] as const) {
        entrarComo(perfil);
        const motorista = await doTeste();
        expect(motorista, perfil).toBeDefined();
        expect(motorista, perfil).not.toHaveProperty("commissionPct");
      }
    });

    it("comissão do motorista: a diretoria lê e não altera; a operação nem lê", async () => {
      const rota = "PATCH /api/motoristas/[id]";

      entrarComo("DIRECTOR");
      expect((await chamar(rota, { commissionPct: 20 }, motoristaId)).status).toBe(403);
      const comoDiretoria = await chamar(rota, { phone: "17999990000" }, motoristaId);
      expect(comoDiretoria.status).toBe(200);
      expect((await comoDiretoria.json()).commissionPct).toBe(7.5);

      entrarComo("OPERATION");
      expect((await chamar(rota, { commissionPct: 20 }, motoristaId)).status).toBe(403);
      const comoOperacao = await chamar(rota, { phone: "17999990001" }, motoristaId);
      expect(comoOperacao.status).toBe(200);
      expect(await comoOperacao.json()).not.toHaveProperty("commissionPct");

      // O financeiro altera valores, mas não o cadastro de motorista: a rota inteira é fechada para ele.
      entrarComo("FINANCE");
      expect((await chamar(rota, { commissionPct: 20 }, motoristaId)).status).toBe(403);

      entrarComo("ADMIN");
      const comoAdmin = await chamar(rota, { commissionPct: 9 }, motoristaId);
      expect(comoAdmin.status).toBe(200);
      expect((await comoAdmin.json()).commissionPct).toBe(9);

      expect((await banco.default.driver.findUniqueOrThrow({ where: { id: motoristaId } })).commissionPct).toBe(9);
    });
  });

  describe("cliente: o financeiro só muda condição de pagamento e limite de crédito", () => {
    const rota = "PATCH /api/clientes/[id]";
    const gravado = () => banco.default.client.findUniqueOrThrow({ where: { id: clienteId } });

    it("FINANCE altera os dois campos e mais nenhum", async () => {
      entrarComo("FINANCE");

      const ok = await chamar(rota, { paymentCondition: "45 dias", creditLimit: 2500 }, clienteId);
      expect(ok.status).toBe(200);
      expect(await gravado()).toMatchObject({ paymentCondition: "45 dias", creditLimit: 2500 });

      const recusas: Record<string, unknown>[] = [
        { companyName: "Invasora LTDA" },
        { active: false },
        { email: "invasor@exemplo.br" },
        { freightTableId: null },
        // Campo permitido junto de um proibido: o pedido inteiro é recusado.
        { paymentCondition: "90 dias", companyName: "Invasora LTDA" },
      ];
      for (const body of recusas) {
        const res = await chamar(rota, body, clienteId);
        expect(res.status, JSON.stringify(body)).toBe(403);
        expect((await res.json()).error).toMatch(/condição de pagamento/);
      }
      expect(await gravado()).toMatchObject({ companyName: "Empresa Teste Perfis LTDA", active: true, email: null, paymentCondition: "45 dias" });

      expect((await chamar("POST /api/clientes", { cnpj: "1", companyName: "x" })).status).toBe(403);
    });

    it("COMMERCIAL e OPERATION alteram o cadastro inteiro, como antes; EXPEDITION e WAREHOUSE, nada", async () => {
      for (const perfil of ["COMMERCIAL", "OPERATION", "DIRECTOR"] as const) {
        entrarComo(perfil);
        const res = await chamar(rota, { contactName: `Contato ${perfil}`, paymentCondition: "28 dias" }, clienteId);
        expect(res.status, perfil).toBe(200);
        expect(await gravado(), perfil).toMatchObject({ contactName: `Contato ${perfil}`, paymentCondition: "28 dias" });
      }
      for (const perfil of ["EXPEDITION", "WAREHOUSE"] as const) {
        entrarComo(perfil);
        expect((await chamar(rota, { paymentCondition: "1 dia" }, clienteId)).status, perfil).toBe(403);
      }
      expect((await gravado()).paymentCondition).toBe("28 dias");
    });
  });

  describe("usuários: atribuir os perfis novos", () => {
    const novos = ["DIRECTOR", "FINANCE", "COMMERCIAL", "EXPEDITION", "WAREHOUSE"] as const;

    it("ADMIN cria usuário com cada perfil novo; os demais perfis não criam nem listam", async () => {
      entrarComo("ADMIN");
      for (const role of novos) {
        const email = `${PREFIXO}novo-${role.toLowerCase()}@exemplo.br`;
        const res = await chamar("POST /api/usuarios", { name: `${PREFIXO}novo ${role}`, email, role });
        expect(res.status, role).toBe(201);
        expect(await res.json(), role).toMatchObject({ role, clientId: null });
        expect((await banco.default.user.findFirstOrThrow({ where: { email } })).role).toBe(role);
      }

      for (const perfil of ["DIRECTOR", ...novos.slice(1), "OPERATION"] as const) {
        entrarComo(perfil);
        expect((await chamar("GET /api/usuarios")).status, perfil).toBe(403);
        expect((await chamar("POST /api/usuarios", { name: "Invasor Total", email: `${PREFIXO}invasor@exemplo.br`, role: "ADMIN" })).status, perfil).toBe(403);
        expect((await chamar("PATCH /api/usuarios/[id]", { role: "ADMIN" }, ids[perfil])).status, `${perfil} promovendo a si mesmo`).toBe(403);
      }
      expect(await banco.default.user.count({ where: { email: `${PREFIXO}invasor@exemplo.br` } })).toBe(0);
      for (const perfil of novos) expect((await banco.default.user.findUniqueOrThrow({ where: { id: ids[perfil] } })).role).toBe(perfil);
    });

    it("troca de perfil entre os novos vale na hora e fica na auditoria, com antes e depois", async () => {
      entrarComo("ADMIN");
      const alvo = await criarUsuario("trocar", "OPERATION");

      let anterior = "OPERATION";
      for (const role of novos) {
        const res = await chamar("PATCH /api/usuarios/[id]", { role }, alvo.id);
        expect(res.status, role).toBe(200);
        expect(await res.json(), role).toMatchObject({ role, clientId: null });

        const linha = await banco.sistema.auditLog.findFirstOrThrow({
          where: { entityId: alvo.id, action: "usuario.perfil" },
          orderBy: { createdAt: "desc" },
          select: { before: true, after: true, summary: true, userId: true, userRole: true },
        });
        expect(linha, role).toMatchObject({ before: { role: anterior }, after: { role }, userId: ids.ADMIN, userRole: "ADMIN" });
        expect(linha.summary).toContain(`de ${anterior} para ${role}`);
        anterior = role;
      }
      expect(await banco.sistema.auditLog.count({ where: { entityId: alvo.id, action: "usuario.perfil" } })).toBe(novos.length);

      // Agora é Conferência: o banco decide, não o token.
      sessao.mockResolvedValue({ user: { id: alvo.id, role: "OPERATION", clientId: null } });
      expect((await chamar("GET /api/clientes")).status).toBe(403);
      expect((await chamar("GET /api/deposito")).status).toBe(200);
    });

    it("perfil novo para CLIENT exige empresa, e ao voltar o vínculo é desfeito; DRIVER não entra nem sai por aqui", async () => {
      entrarComo("ADMIN");
      const alvo = await criarUsuario("vai-e-volta", "FINANCE");
      const rota = "PATCH /api/usuarios/[id]";

      expect((await chamar(rota, { role: "CLIENT" }, alvo.id)).status).toBe(400);
      expect((await chamar(rota, { role: "DRIVER" }, alvo.id)).status).toBe(400);
      expect((await chamar(rota, { role: "EXPEDITION" }, ids.DRIVER)).status).toBe(400);

      expect(await (await chamar(rota, { role: "CLIENT", clientId: clienteId }, alvo.id)).json()).toMatchObject({ role: "CLIENT", clientId: clienteId });
      expect(await (await chamar(rota, { role: "COMMERCIAL" }, alvo.id)).json()).toMatchObject({ role: "COMMERCIAL", clientId: null });
    });

    it("a trava do último administrador continua: ele não vira Diretoria nem Financeiro", async () => {
      entrarComo("ADMIN");
      for (const role of ["DIRECTOR", "FINANCE"]) {
        expect((await chamar("PATCH /api/usuarios/[id]", { role }, ids.ADMIN)).status, role).toBe(409);
      }
      expect((await banco.default.user.findUniqueOrThrow({ where: { id: ids.ADMIN } })).role).toBe("ADMIN");
    });

    it("outro administrador rebaixado para Financeiro perde usuários e mantém o financeiro", async () => {
      entrarComo("ADMIN");
      const segundo = await criarUsuario("segundo-admin", "ADMIN");
      const res = await chamar("PATCH /api/usuarios/[id]", { role: "FINANCE" }, segundo.id);
      expect(res.status).toBe(200);

      sessao.mockResolvedValue({ user: { id: segundo.id, role: "ADMIN", clientId: null } });
      expect((await chamar("GET /api/usuarios")).status).toBe(403);
      expect((await chamar("PATCH /api/empresa", { name: "Invasora" })).status).toBe(403);
      expect((await chamar("GET /api/financeiro")).status).toBe(200);
      expect((await chamar("GET /api/clientes")).status).toBe(200);
    });
  });

  describe("chamados: quem pode ser responsável", () => {
    it("a lista da equipe e o responsável aceitam os perfis que atendem chamados, e só eles", async () => {
      entrarComo("WAREHOUSE");
      const criado = await chamar("POST /api/ocorrencias", { type: "OTHER", title: `${PREFIXO}volume avariado`, description: "Caixa amassada na conferência." });
      expect(criado.status).toBe(201);
      const { id } = (await criado.json()) as { id: string };

      const detalhe = (await (await chamar("GET /api/ocorrencias/[id]", undefined, id)).json()) as { equipe: { id: string }[] };
      const daEquipe = detalhe.equipe.map((pessoa) => pessoa.id);
      for (const perfil of ["ADMIN", "DIRECTOR", "OPERATION", "COMMERCIAL", "EXPEDITION", "WAREHOUSE"] as const) expect(daEquipe, perfil).toContain(ids[perfil]);
      for (const perfil of ["FINANCE", "DRIVER", "CLIENT"] as const) expect(daEquipe, perfil).not.toContain(ids[perfil]);

      entrarComo("COMMERCIAL");
      expect((await chamar("PATCH /api/ocorrencias/[id]", { assigneeId: ids.EXPEDITION }, id)).status).toBe(200);
      for (const perfil of ["FINANCE", "DRIVER", "CLIENT"] as const) {
        expect((await chamar("PATCH /api/ocorrencias/[id]", { assigneeId: ids[perfil] }, id)).status, perfil).toBe(400);
      }
      expect((await banco.default.occurrence.findUniqueOrThrow({ where: { id } })).assigneeId).toBe(ids.EXPEDITION);

      entrarComo("FINANCE");
      expect((await chamar("GET /api/ocorrencias/[id]", undefined, id)).status).toBe(403);
    });
  });
});
