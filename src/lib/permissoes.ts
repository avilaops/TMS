/**
 * Perfis de acesso e o que cada um pode fazer: a matriz inteira mora aqui.
 *
 * As rotas internas perguntam por uma capacidade (`requireStaff({ pode: "financeiro" })`),
 * o menu e as telas também (`pode(perfil, "financeiro")`), e o proxy usa as
 * listas de perfil para separar as áreas. Nada fora deste arquivo compara o
 * perfil com um nome fixo para decidir acesso.
 *
 * Este arquivo não importa nada do servidor: é lido pelo proxy, pelas rotas e
 * pelas telas.
 *
 * Como ler os nomes: `xVer` é só leitura; `x` sem sufixo é criar e alterar
 * (quem tem `x` sempre tem `xVer`, e o teste da matriz confere). Capacidade sem
 * par `Ver` vale para a leitura e para a escrita.
 */

/** Perfis da equipe interna: os que entram em /dashboard. */
export const PERFIS_INTERNOS = ["ADMIN", "DIRECTOR", "OPERATION", "FINANCE", "COMMERCIAL", "EXPEDITION", "WAREHOUSE"] as const;
export type PerfilInterno = (typeof PERFIS_INTERNOS)[number];

/** Todos os perfis do enum `Role` (prisma/schema.prisma). */
export const PERFIS = [...PERFIS_INTERNOS, "DRIVER", "CLIENT"] as const;
export type Perfil = (typeof PERFIS)[number];

/** Nome de cada perfil como a tela mostra. */
export const ROTULO_DO_PERFIL: Record<Perfil, string> = {
  ADMIN: "Administrador",
  DIRECTOR: "Diretoria",
  OPERATION: "Operação",
  FINANCE: "Financeiro",
  COMMERCIAL: "Comercial",
  EXPEDITION: "Expedição",
  WAREHOUSE: "Conferência",
  DRIVER: "Motorista",
  CLIENT: "Cliente",
};

/** A área de cada perfil: cada um tem uma só (src/proxy.ts e a página inicial). */
export const AREA_DO_PERFIL: Record<Perfil, string> = {
  ADMIN: "/dashboard",
  DIRECTOR: "/dashboard",
  OPERATION: "/dashboard",
  FINANCE: "/dashboard",
  COMMERCIAL: "/dashboard",
  EXPEDITION: "/dashboard",
  WAREHOUSE: "/dashboard",
  DRIVER: "/driver",
  CLIENT: "/portal",
};

const TODOS = PERFIS_INTERNOS;

/**
 * Capacidade → perfis que a têm.
 *
 * Regras que a matriz respeita (tests/perfis.test.ts confere todas):
 * - ADMIN tem tudo.
 * - DIRECTOR faz tudo o que OPERATION faz e lê o que é dinheiro, relatório,
 *   auditoria e mensageria; não lança no financeiro, não mexe em tabela de
 *   frete, usuários, empresa nem integração.
 * - OPERATION ficou exatamente como era antes dos perfis novos: o que era
 *   "só ADMIN" continua sem OPERATION.
 * - DRIVER e CLIENT não têm capacidade nenhuma: as áreas deles têm guarda
 *   própria (src/lib/driver.ts e src/lib/portal.ts).
 */
export const CAPACIDADES = {
  /** Visão geral (/api/dashboard): contadores. A receita exige `financeiroVer`. */
  painel: TODOS,

  /** Lista de clientes, com condição de pagamento e limite de crédito. */
  clientesVer: ["ADMIN", "DIRECTOR", "OPERATION", "FINANCE", "COMMERCIAL"],
  /** Criar e alterar o cadastro inteiro do cliente. */
  clientes: ["ADMIN", "DIRECTOR", "OPERATION", "COMMERCIAL"],
  /** Alterar condição de pagamento e limite de crédito do cliente. O financeiro só muda esses dois campos. */
  clientesCondicoes: ["ADMIN", "DIRECTOR", "OPERATION", "COMMERCIAL", "FINANCE"],

  /** Leads e cotações do site: ler, mover no funil e converter em cliente. */
  crm: ["ADMIN", "DIRECTOR", "OPERATION", "COMMERCIAL"],

  /** Ler tabelas de frete e calcular um frete por elas. */
  tabelasFreteVer: ["ADMIN", "DIRECTOR", "OPERATION", "COMMERCIAL", "FINANCE"],
  /** Criar e alterar tabela de frete: preço é de quem administra e do comercial. */
  tabelasFrete: ["ADMIN", "COMMERCIAL"],

  /** Ler cargas (minutas), o histórico e as pendentes. */
  coletasVer: TODOS,
  /** Criar e alterar carga. */
  coletas: ["ADMIN", "DIRECTOR", "OPERATION"],
  /** Mudar o status de uma carga. */
  coletasStatus: ["ADMIN", "DIRECTOR", "OPERATION", "EXPEDITION"],
  /** Informar o frete de uma carga à mão (a tela de faturamento usa). */
  coletasFrete: ["ADMIN", "DIRECTOR", "OPERATION", "FINANCE"],

  /** Ler manifestos (viagens) e as despesas lançadas neles. */
  manifestosVer: ["ADMIN", "DIRECTOR", "OPERATION", "EXPEDITION", "FINANCE"],
  /** Montar, alterar, liberar, cancelar e finalizar viagem; lançar e excluir despesa pendente. */
  manifestos: ["ADMIN", "DIRECTOR", "OPERATION", "EXPEDITION"],

  /** Ler e conferir comprovantes de entrega. */
  comprovantes: ["ADMIN", "DIRECTOR", "OPERATION", "EXPEDITION"],

  /** Depósito: mapa, conferência de volumes, posições e etiquetas. */
  deposito: ["ADMIN", "DIRECTOR", "OPERATION", "WAREHOUSE"],

  /** Ler notas fiscais (com o XML) e CT-e registrados. */
  fiscalVer: ["ADMIN", "DIRECTOR", "OPERATION", "FINANCE", "EXPEDITION"],
  /** Subir nota, ligar nota a carga, criar carga da nota e registrar CT-e. Quem entra aqui cria carga. */
  fiscal: ["ADMIN", "DIRECTOR", "OPERATION"],

  /** Ler veículos, manutenção, abastecimento, documentos, pneus, checklists e os alertas da frota. */
  frotaVer: ["ADMIN", "DIRECTOR", "OPERATION", "EXPEDITION", "FINANCE"],
  /** Criar e alterar veículo e os registros dele. A manutenção concluída vira lançamento no financeiro. */
  frota: ["ADMIN", "DIRECTOR", "OPERATION"],
  /** Registrar checklist de veículo (a vistoria antes da saída). */
  frotaChecklist: ["ADMIN", "DIRECTOR", "OPERATION", "EXPEDITION"],
  /** Custos da frota: o resumo por veículo e o custo do mês nos alertas. */
  frotaCustos: ["ADMIN", "DIRECTOR", "FINANCE"],

  /** Ler o cadastro de motoristas (sem o percentual de comissão, que exige `equipeValoresVer`). */
  motoristasVer: ["ADMIN", "DIRECTOR", "OPERATION", "EXPEDITION", "FINANCE"],
  /** Criar e alterar motorista (cria o usuário dele junto). */
  motoristas: ["ADMIN", "DIRECTOR", "OPERATION"],

  /** Ler a equipe de estrada: pessoas, ajudantes, ausências e produtividade sem valores. */
  equipeVer: ["ADMIN", "DIRECTOR", "OPERATION", "EXPEDITION", "FINANCE"],
  /** Cadastrar ajudante e lançar ausência. */
  equipe: ["ADMIN", "DIRECTOR", "OPERATION"],
  /** Ler o que é dinheiro na equipe: adiantamentos, frete e comissão na produtividade, percentual de comissão. */
  equipeValoresVer: ["ADMIN", "DIRECTOR", "FINANCE"],
  /** Lançar e acertar adiantamento; alterar o percentual de comissão (junto de `motoristas`). */
  equipeValores: ["ADMIN", "FINANCE"],

  /** Chamados: ler, abrir, responder e encaminhar. */
  ocorrencias: ["ADMIN", "DIRECTOR", "OPERATION", "COMMERCIAL", "EXPEDITION", "WAREHOUSE"],

  /** Ler lançamentos, fluxo de caixa, recibos, o acerto e o resultado da viagem, e a receita do painel. */
  financeiroVer: ["ADMIN", "DIRECTOR", "FINANCE"],
  /** Lançar, baixar, alterar e excluir no financeiro; aprovar ou recusar despesa de viagem. */
  financeiro: ["ADMIN", "FINANCE"],

  /** Ler faturas e o que há para faturar. */
  faturamentoVer: ["ADMIN", "DIRECTOR", "FINANCE"],
  /** Emitir, alterar e cancelar fatura. */
  faturamento: ["ADMIN", "FINANCE"],

  /** Painel de cobrança (títulos vencidos e a vencer). Só leitura. */
  cobranca: ["ADMIN", "DIRECTOR", "FINANCE"],

  /** Relatórios (trazem receita, custos e margem). */
  relatorios: ["ADMIN", "DIRECTOR", "FINANCE"],

  /** Trilha de auditoria. */
  auditoria: ["ADMIN", "DIRECTOR"],

  /** Ler o histórico dos avisos enviados (mensageria). */
  mensageriaVer: ["ADMIN", "DIRECTOR"],
  /** Reenviar um aviso: é ação sobre a integração. */
  mensageria: ["ADMIN"],

  /** Usuários: listar, criar, trocar perfil e liberar acesso. */
  usuarios: ["ADMIN"],

  /** Empresa: identidade, webhook e configuração de cobrança (multa, juros, chave Pix). */
  empresa: ["ADMIN"],
} as const satisfies Record<string, readonly PerfilInterno[]>;

export type Capacidade = keyof typeof CAPACIDADES;

/** Os campos do cliente que `clientesCondicoes` deixa alterar sem ter `clientes`. */
export const CAMPOS_DE_CONDICAO = ["paymentCondition", "creditLimit"] as const;

/** O perfil tem a capacidade? Perfil desconhecido, vazio ou ausente nunca tem. */
export function pode(perfil: string | null | undefined, capacidade: Capacidade): boolean {
  if (!perfil) return false;
  return (CAPACIDADES[capacidade] as readonly string[]).includes(perfil);
}

/** Os perfis que têm a capacidade, para filtrar usuários no banco. */
export function perfisQuePodem(capacidade: Capacidade): PerfilInterno[] {
  return [...CAPACIDADES[capacidade]];
}

/** É perfil da equipe interna (entra em /dashboard)? */
export function ehPerfilInterno(perfil: string | null | undefined): perfil is PerfilInterno {
  return (PERFIS_INTERNOS as readonly string[]).includes(perfil ?? "");
}

/** Capacidades do perfil, em ordem alfabética: para a documentação e os testes. */
export function capacidadesDoPerfil(perfil: string): Capacidade[] {
  return (Object.keys(CAPACIDADES) as Capacidade[]).filter((capacidade) => pode(perfil, capacidade)).sort();
}
