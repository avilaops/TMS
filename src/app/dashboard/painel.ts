// Carga dos indicadores do painel, fora do componente para poder ser testada
// sem navegador (tests/seguranca-usuarios.test.ts).

// `receita` só vem da API para o perfil ADMIN.
export type Stats = {
  coletas: number;
  manifestos: number;
  clientes: number;
  veiculos: number;
  receita?: number;
};

export type PainelState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; stats: Stats };

export async function loadStats(request: () => Promise<Response>): Promise<PainelState> {
  try {
    const res = await request();
    if (!res.ok) return { status: "error" };
    return { status: "ready", stats: await res.json() };
  } catch {
    return { status: "error" };
  }
}

/**
 * Cartão "Receita" e atalho do financeiro. Com a resposta em mãos quem decide
 * é a API (o campo `receita` só vai para ADMIN). Sem ela — carregando ou com
 * erro — vale o perfil da sessão: o ADMIN vê o cartão em estado de erro em vez
 * de o cartão sumir como se ele não tivesse acesso.
 */
export function showFinance(state: PainelState, sessionRole: string | undefined): boolean {
  if (state.status === "ready") return state.stats.receita !== undefined;
  return sessionRole === "ADMIN";
}
