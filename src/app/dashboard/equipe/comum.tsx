// O que as abas da tela de Equipe têm em comum: estilos, tipos e o tratamento das respostas.

export const CARD = "bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm";
export const INPUT =
  "block w-full min-w-0 px-3 py-1.5 md:py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:text-white";
export const LABEL = "text-xs md:text-sm font-medium text-gray-700 dark:text-gray-300";
export const BOTAO =
  "px-3 py-2 md:px-4 md:py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium disabled:opacity-60 flex items-center gap-2";

// Lista: tabela no computador, cartões no celular (o rótulo vem de `data-rotulo`).
export const TABELA = "block md:table w-full text-sm";
export const THEAD = "hidden md:table-header-group bg-gray-50 dark:bg-gray-950 text-gray-500 text-left";
export const TBODY = "block md:table-row-group divide-y divide-gray-100 dark:divide-gray-800";
export const TR = "grid grid-cols-2 gap-x-3 gap-y-1.5 px-3 py-2.5 md:table-row";
export const TD = "min-w-0 md:table-cell md:px-4 md:py-3";
export const COM_ROTULO =
  "before:content-[attr(data-rotulo)] before:block before:text-[11px] before:leading-tight before:text-gray-500 md:before:content-none";
export const TH = "px-4 py-3 font-medium";

/** Uma pessoa da equipe, como `GET /api/equipe` devolve. */
export type PessoaDaEquipe = {
  /** `motorista:<id>` ou `ajudante:<id>`: é o valor dos campos de escolha. */
  chave: string;
  tipo: "motorista" | "ajudante";
  id: string;
  nome: string;
  cpf: string;
  telefone: string | null;
  ativo: boolean;
  ausencia: { id: string; type: string; startDate: string; endDate: string } | null;
};

export type Aviso = { ok: boolean; texto: string } | null;

/** A mensagem que o servidor devolveu; `padrao` quando a resposta não é JSON. */
export async function erroDe(res: Response, padrao: string): Promise<string> {
  const corpo = (await res.json().catch(() => null)) as { error?: string } | null;
  return typeof corpo?.error === "string" ? corpo.error : padrao;
}

export const enviar = (url: string, method: "POST" | "PATCH" | "DELETE", corpo?: unknown) =>
  fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });

export function Mensagem({ aviso }: { aviso: Aviso }) {
  if (!aviso) return null;
  return (
    <p role={aviso.ok ? "status" : "alert"} className={`text-sm ${aviso.ok ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
      {aviso.texto}
    </p>
  );
}

/** O campo de escolha de pessoa: motoristas e ajudantes ativos, numa lista só. */
export function EscolhaDePessoa({ pessoas, valor, aoMudar }: { pessoas: PessoaDaEquipe[]; valor: string; aoMudar: (chave: string) => void }) {
  const ativos = pessoas.filter((pessoa) => pessoa.ativo);
  return (
    <label className="space-y-0.5 md:space-y-1.5 block min-w-0">
      <span className={LABEL}>Pessoa</span>
      <select required value={valor} onChange={(e) => aoMudar(e.target.value)} data-campo="pessoa" className={INPUT}>
        <option value="">Escolha…</option>
        {ativos.map((pessoa) => (
          <option key={pessoa.chave} value={pessoa.chave}>
            {pessoa.nome} ({pessoa.tipo})
          </option>
        ))}
      </select>
    </label>
  );
}
