import type { Prisma } from "@prisma/client";
import { ORDEM_DAS_CARGAS } from "@/lib/manifestos-db";
import { configuracaoDoGeo } from "@/lib/geo";
import { montarMapa, type MapaDaViagem } from "@/lib/mapa";
import { municipios } from "@/lib/municipios";

// Leitura do mapa da viagem, para a rota do painel e a do motorista. Só o servidor importa este arquivo.

const VIAGEM_DO_MAPA_SELECT = {
  status: true,
  lastLat: true,
  lastLon: true,
  lastAccuracy: true,
  lastPositionAt: true,
  collections: {
    select: {
      id: true,
      receiver: true,
      origin: true,
      destination: true,
      status: true,
      deliveryStreet: true,
      deliveryNumber: true,
      deliveryDistrict: true,
      deliveryZip: true,
      deliveryLat: true,
      deliveryLon: true,
      geoSource: true,
    },
    orderBy: ORDEM_DAS_CARGAS,
  },
} satisfies Prisma.ManifestSelect;

/**
 * O mapa da viagem que casa com `where`, ou `null`. Quem chama diz de quem é a
 * viagem: o painel passa só o id (a empresa vem da sessão); o motorista passa
 * também o `driverId` dele e o status em rota.
 */
export async function lerMapaDaViagem(db: Pick<Prisma.TransactionClient, "manifest">, where: Prisma.ManifestWhereInput): Promise<MapaDaViagem | null> {
  const viagem = await db.manifest.findFirst({ where, select: VIAGEM_DO_MAPA_SELECT });
  if (!viagem) return null;
  return montarMapa(viagem, municipios(), { localizaEndereco: configuracaoDoGeo() !== null });
}
