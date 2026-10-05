// Carga da tela do financeiro, fora do componente para poder ser testada sem
// navegador (tests/seguranca-usuarios.test.ts).

// `login`: a sessão caiu (401). `forbidden`: o perfil não tem acesso (403).
export type DeniedReason = "login" | "forbidden";

export type LoadResult =
  | { denied: DeniedReason }
  | { denied: null; transactions: unknown[] };

// São avisos diferentes na tela: quem perdeu a sessão resolve entrando de novo;
// quem não é Administrador, não.
export function deniedReason(status: number): DeniedReason | null {
  if (status === 401) return "login";
  if (status === 403) return "forbidden";
  return null;
}

/**
 * `/api/financeiro` é só para ADMIN. Sem separar o 403 de uma lista vazia, o
 * OPERATION que abre a URL direto via a tela com os totais zerados, como se
 * não houvesse lançamento nenhum.
 */
export async function loadTransactions(request: () => Promise<Response>): Promise<LoadResult> {
  const res = await request();
  const denied = deniedReason(res.status);
  if (denied) return { denied };
  if (!res.ok) return { denied: null, transactions: [] };
  return { denied: null, transactions: await res.json() };
}
