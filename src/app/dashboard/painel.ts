// Carga dos indicadores do painel, fora do componente para poder ser testada
// sem navegador (tests/seguranca-usuarios.test.ts).

// `receita` só vem da API para o perfil ADMIN.
export type Stats = {
  coletas: number;
  manifestos: number;
  clientes: number;
  veiculos: number;
  receita?: number;
  /** Recebido no mês corrente; só para ADMIN, como `receita`. */
  receitaDoMes?: number;
  /** Entregas de segunda a domingo da semana corrente. */
  entregasDaSemana?: number[];
  detalhe?: Detalhe;
};

/** O que cada cartão mostra em destaque e em segundo plano. */
export type Detalhe = {
  coletasAtivas: number;
  coletasEntregues: number;
  viagensEmRota: number;
  viagensEmMontagem: number;
  viagensFinalizadas: number;
  clientesAtivos: number;
  clientesInativos: number;
  motoristas: number;
};

export type Passo = { titulo: string; href: string; feito: boolean };

/**
 * Primeiros passos de uma transportadora nova, na ordem em que um depende do
 * outro. A lista some do painel quando todos estão feitos.
 */
export function primeirosPassos(stats: Stats): Passo[] {
  return [
    { titulo: "Cadastre o primeiro cliente", href: "/dashboard/clientes", feito: stats.clientes > 0 },
    { titulo: "Cadastre um motorista", href: "/dashboard/motoristas", feito: (stats.detalhe?.motoristas ?? 0) > 0 },
    { titulo: "Cadastre um veículo", href: "/dashboard/veiculos", feito: stats.veiculos > 0 },
    { titulo: "Emita a primeira minuta", href: "/dashboard/coletas", feito: stats.coletas > 0 },
    { titulo: "Monte a primeira viagem", href: "/dashboard/manifestos", feito: stats.manifestos > 0 },
  ];
}

// `expired`: a sessão caiu (401) e tentar de novo não resolve, só entrar de
// novo. `cause` é o que vai para o console: o status HTTP ou a exceção.
export type PainelState =
  | { status: "loading" }
  | { status: "expired"; cause: string }
  | { status: "error"; cause: unknown }
  | { status: "ready"; stats: Stats };

export async function loadStats(request: () => Promise<Response>): Promise<PainelState> {
  try {
    const res = await request();
    if (res.status === 401) return { status: "expired", cause: "HTTP 401" };
    if (!res.ok) return { status: "error", cause: `HTTP ${res.status}` };
    return { status: "ready", stats: await res.json() };
  } catch (cause) {
    return { status: "error", cause };
  }
}

/**
 * Cartão "Receita" e atalho do financeiro. Com a resposta em mãos quem decide
 * é a API (o campo `receita` só vai para ADMIN). Sem ela — carregando, com erro
 * ou com a sessão caída — vale o perfil da sessão: o ADMIN vê o cartão em estado de erro em vez
 * de o cartão sumir como se ele não tivesse acesso.
 */
export function showFinance(state: PainelState, sessionRole: string | undefined): boolean {
  if (state.status === "ready") return state.stats.receita !== undefined;
  return sessionRole === "ADMIN";
}

/* ----------------------- Receita à mostra ou escondida ----------------------- */

// A escolha fica guardada no aparelho. Lida com `useSyncExternalStore`: no
// servidor e na primeira pintura a receita está à mostra, e a tela troca
// sozinha quando o navegador diz o que estava guardado.
const RECEITA_OCULTA = "tms:receita-oculta";
const ouvintes = new Set<() => void>();
// Só é usada quando o navegador recusa o armazenamento (aba privada restrita):
// aí a escolha vale até recarregar.
let semArmazenamento: boolean | null = null;

export function assinarReceitaOculta(avisar: () => void): () => void {
  ouvintes.add(avisar);
  return () => {
    ouvintes.delete(avisar);
  };
}

export function receitaEstaOculta(): boolean {
  if (semArmazenamento !== null) return semArmazenamento;
  try {
    return localStorage.getItem(RECEITA_OCULTA) === "1";
  } catch {
    return false;
  }
}

export function alternarReceitaOculta(): void {
  const oculta = !receitaEstaOculta();
  try {
    localStorage.setItem(RECEITA_OCULTA, oculta ? "1" : "0");
  } catch {
    semArmazenamento = oculta;
  }
  for (const avisar of ouvintes) avisar();
}
