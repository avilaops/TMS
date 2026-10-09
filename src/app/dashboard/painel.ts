// Carga dos indicadores do painel, fora do componente para poder ser testada
// sem navegador (tests/seguranca-usuarios.test.ts).

// `receita` só vem da API para o perfil ADMIN.
export type Stats = {
  coletas: number;
  manifestos: number;
  clientes: number;
  veiculos: number;
  receita?: number;
  /** Entregas de segunda a domingo da semana corrente. */
  entregasDaSemana?: number[];
};

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
