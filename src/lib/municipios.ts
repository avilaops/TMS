import dados from "@/data/municipios.json";
import { indiceDeCidades, localizarCidade, type Cidade, type IndiceDeCidades } from "@/lib/roteiro";

/**
 * Os municípios do Brasil com a coordenada do centro (sede) e o código IBGE de
 * cada um.
 *
 * Fonte: "municipios-brasileiros", de Kelvin S. do Prado
 * (https://github.com/kelvins/municipios-brasileiros, arquivo csv/municipios.csv,
 * commit 503e2f7 de 10/12/2025), licença MIT, derivado dos dados públicos do
 * IBGE. Em `src/data/municipios.json` ficaram só o nome, a latitude, a
 * longitude e o código IBGE (`codigo_ibge`, 7 dígitos), agrupados por UF:
 * `{ "SP": [["Mirassol", -20.8169, -49.5206, 3530300], ...] }`.
 *
 * SÓ O SERVIDOR importa este arquivo (as rotas): a tabela tem perto de 240 KB e
 * não pode ir para o pacote do navegador. A tela importa de `@/lib/roteiro`,
 * que não puxa os dados.
 */

type Linha = [nome: string, lat: number, lon: number, ibge: number];

let indice: IndiceDeCidades | null = null;
let codigos: Map<string, string> | null = null;

const chaveDoCodigo = (cidade: Pick<Cidade, "nome" | "uf">) => `${cidade.uf}|${cidade.nome}`;

function carregar(): { indice: IndiceDeCidades; codigos: Map<string, string> } {
  if (!indice || !codigos) {
    const cidades: Cidade[] = [];
    const tabela = new Map<string, string>();
    for (const [uf, lista] of Object.entries(dados as unknown as Record<string, Linha[]>)) {
      for (const [nome, lat, lon, ibge] of lista) {
        cidades.push({ nome, uf, lat, lon });
        tabela.set(chaveDoCodigo({ nome, uf }), String(ibge));
      }
    }
    indice = indiceDeCidades(cidades);
    codigos = tabela;
  }
  return { indice, codigos };
}

/** O índice de busca das cidades, montado na primeira chamada e guardado. */
export function municipios(): IndiceDeCidades {
  return carregar().indice;
}

/** O município como os documentos fiscais o pedem: o código IBGE (7 dígitos), o nome oficial e a UF. */
export type Municipio = { codigo: string; nome: string; uf: string };

/**
 * O município de um texto ("Mirassol - SP", "MIRASSOL/SP", "São José do Rio
 * Preto"), com o código IBGE. `uf` desempata nome que existe em mais de um
 * estado quando o texto não diz a UF. `null` quando a cidade não está na tabela.
 */
export function municipioDoTexto(texto: string | null | undefined, uf: string | null = null): Municipio | null {
  const tabela = carregar();
  const cidade = localizarCidade(texto, tabela.indice, uf);
  const codigo = cidade ? tabela.codigos.get(chaveDoCodigo(cidade)) : undefined;
  return cidade && codigo ? { codigo, nome: cidade.nome, uf: cidade.uf } : null;
}
