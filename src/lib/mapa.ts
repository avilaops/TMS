import { enderecoCompleto, type EnderecoDaEntrega } from "@/lib/endereco";
import { ultimaPosicao, type PosicaoDoMotorista } from "@/lib/posicao";
import { lugaresDaViagem, nomeDaCidade, pontoDaParada, type IndiceDeCidades, type Ponto, type PontoDaParada } from "@/lib/roteiro";

/**
 * O mapa de uma viagem: as paradas na ordem, com o ponto de cada uma, a origem
 * e a última posição do motorista. Puro: a tela importa os tipos; quem lê do
 * banco é src/lib/mapa-db.ts.
 *
 * O mapa é desenhado no navegador com o Leaflet e os blocos de imagem do
 * OpenStreetMap (src/components/mapa-da-viagem.tsx). Este arquivo só monta os
 * dados: os pontos vêm da carga (endereço localizado) ou da tabela de
 * municípios (centro da cidade), nunca de consulta feita na hora.
 */

/** O servidor padrão dos blocos de imagem do OpenStreetMap. `NEXT_PUBLIC_MAPA_TILES` troca. */
export const BLOCOS_PADRAO = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

/** O crédito que a licença do OpenStreetMap exige visível no mapa. */
export const ATRIBUICAO_DO_MAPA = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>';

/** O endereço dos blocos: o da variável pública, se for um endereço https com `{z}`, `{x}` e `{y}`; senão o padrão. */
export function enderecoDosBlocos(valor: string | undefined = process.env.NEXT_PUBLIC_MAPA_TILES): string {
  const limpo = (valor ?? "").trim();
  const serve = /^https:\/\//i.test(limpo) && ["{z}", "{x}", "{y}"].every((parte) => limpo.includes(parte));
  return serve ? limpo : BLOCOS_PADRAO;
}

export type ParadaDoMapa = {
  id: string;
  /** A posição na ordem da viagem: 1, 2, 3... */
  numero: number;
  receiver: string;
  /** O endereço inteiro quando a carga tem logradouro; senão a cidade. */
  destino: string;
  status: string;
  /** Onde o marcador fica, e se veio do endereço ou do centro da cidade. `null`: sem localização, fica fora do mapa. */
  ponto: PontoDaParada | null;
  /** Tem endereço e a coordenada ainda não foi procurada: por ora o marcador está no centro da cidade. */
  aLocalizar: boolean;
};

export type MapaDaViagem = {
  status: string;
  origem: (Ponto & { nome: string }) | null;
  paradas: ParadaDoMapa[];
  /** Só com a viagem em rota e se o motorista compartilhou. */
  posicao: PosicaoDoMotorista | null;
  /** `false` sem `GEO_CONTATO` no servidor: os endereços não são procurados e todo marcador é o centro da cidade. */
  localizaEndereco: boolean;
};

export type CargaDoMapa = EnderecoDaEntrega & {
  id: string;
  receiver: string;
  origin: string;
  destination: string;
  status: string;
  deliveryLat: number | null;
  deliveryLon: number | null;
  geoSource: string | null;
};

export type ViagemDoMapa = {
  status: string;
  lastLat: number | null;
  lastLon: number | null;
  lastAccuracy: number | null;
  lastPositionAt: Date | string | null;
  /** Já na ordem da viagem. */
  collections: CargaDoMapa[];
};

/** Monta o mapa a partir da viagem lida do banco. */
export function montarMapa(viagem: ViagemDoMapa, indice: IndiceDeCidades, { localizaEndereco }: { localizaEndereco: boolean }): MapaDaViagem {
  const lugares = lugaresDaViagem(viagem.collections, indice);
  return {
    status: viagem.status,
    origem: lugares.origem ? { lat: lugares.origem.lat, lon: lugares.origem.lon, nome: nomeDaCidade(lugares.origem) } : null,
    paradas: viagem.collections.map((carga, i) => ({
      id: carga.id,
      numero: i + 1,
      receiver: carga.receiver,
      destino: enderecoCompleto(carga, carga.destination),
      status: carga.status,
      ponto: pontoDaParada(lugares.paradas[i]),
      aLocalizar: localizaEndereco && Boolean(carga.deliveryStreet) && carga.geoSource === null,
    })),
    // Viagem que não está em rota não mostra posição: o que ficou gravado é de quando ela estava.
    posicao: viagem.status === "ROUTE" ? ultimaPosicao(viagem) : null,
    localizaEndereco,
  };
}
