import { avisoDeExcesso, linhaDaOcupacao, type Ocupacao } from "@/lib/ocupacao";

/** A prévia é calculada no servidor com os mesmos dados da sugestão de ordem. */
export function OcupacaoNaSugestao({ ocupacao, inicial = false }: { ocupacao: Ocupacao; inicial?: boolean }) {
  const aviso = avisoDeExcesso(ocupacao);
  const ausentes = [
    ocupacao.peso.semMedida ? `${ocupacao.peso.semMedida} ${ocupacao.peso.semMedida === 1 ? "carga sem peso" : "cargas sem peso"}` : null,
    ocupacao.cubagem.semMedida ? `${ocupacao.cubagem.semMedida} ${ocupacao.cubagem.semMedida === 1 ? "carga sem cubagem" : "cargas sem cubagem"}` : null,
  ].filter(Boolean);
  return (
    <div
      data-ocupacao-inicial={inicial ? "" : undefined}
      data-ocupacao-apos-entrega={!inicial ? "" : undefined}
      className={`min-w-0 text-xs ${inicial ? "rounded-xl border border-gray-200 dark:border-gray-700 px-3 py-2 space-y-1" : "mt-1"} ${ocupacao.excesso ? "text-amber-700 dark:text-amber-400" : "text-gray-600 dark:text-gray-300"}`}
    >
      <p>{inicial ? "Carga a entregar: " : "Após a entrega: "}{linhaDaOcupacao(ocupacao)}</p>
      {inicial && aviso && <p>{aviso} Reordenar as entregas não elimina o excesso inicial.</p>}
      {ausentes.length > 0 && <p>{ausentes.join(" · ")}. Soma parcial; confira as medidas.</p>}
      {inicial && ocupacao.peso.capacidade === null && <p>Capacidade de peso não cadastrada.</p>}
      {inicial && ocupacao.cubagem.capacidade === null && <p>Capacidade de cubagem não cadastrada.</p>}
      {inicial && <p>Projeção por descarga completa, sem coletas intermediárias.</p>}
    </div>
  );
}
