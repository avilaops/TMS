import dados from "@/data/municipios.json";
import { indiceDeCidades, type Cidade, type IndiceDeCidades } from "@/lib/roteiro";

/**
 * Os municípios do Brasil com a coordenada do centro (sede) de cada um.
 *
 * Fonte: "municipios-brasileiros", de Kelvin S. do Prado
 * (https://github.com/kelvins/municipios-brasileiros, arquivo csv/municipios.csv,
 * commit 503e2f7 de 10/12/2025), licença MIT, derivado dos dados públicos do
 * IBGE. Em `src/data/municipios.json` ficaram só o nome, a latitude e a
 * longitude, agrupados por UF: `{ "SP": [["Mirassol", -20.8169, -49.5206], ...] }`.
 *
 * SÓ O SERVIDOR importa este arquivo (as rotas): a tabela tem perto de 200 KB e
 * não pode ir para o pacote do navegador. A tela importa de `@/lib/roteiro`,
 * que não puxa os dados.
 */

let indice: IndiceDeCidades | null = null;

/** O índice de busca das cidades, montado na primeira chamada e guardado. */
export function municipios(): IndiceDeCidades {
  if (!indice) {
    const cidades: Cidade[] = [];
    for (const [uf, lista] of Object.entries(dados as unknown as Record<string, [string, number, number][]>)) {
      for (const [nome, lat, lon] of lista) cidades.push({ nome, uf, lat, lon });
    }
    indice = indiceDeCidades(cidades);
  }
  return indice;
}
