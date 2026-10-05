// Carga da tela do financeiro, fora do componente para poder ser testada sem
// navegador (tests/seguranca-usuarios.test.ts).

export type LoadResult =
  | { denied: true }
  | { denied: false; transactions: unknown[] };

// 401 (sessão caiu) e 403 (perfil sem acesso) viram o mesmo aviso na tela.
export function isAccessDenied(status: number): boolean {
  return status === 401 || status === 403;
}

/**
 * `/api/financeiro` é só para ADMIN. Sem separar o 403 de uma lista vazia, o
 * OPERATION que abre a URL direto via a tela com os totais zerados, como se
 * não houvesse lançamento nenhum.
 */
export async function loadTransactions(request: () => Promise<Response>): Promise<LoadResult> {
  const res = await request();
  if (isAccessDenied(res.status)) return { denied: true };
  if (!res.ok) return { denied: false, transactions: [] };
  return { denied: false, transactions: await res.json() };
}
