import type { LatLngExpression } from "leaflet";

export type HubGeo = {
  name: string;
  position: LatLngExpression;
};

export const originHub: HubGeo = {
  name: "São José do Rio Preto",
  position: [-20.8113, -49.3758],
};

export const hubCoordinates: HubGeo[] = [
  originHub,
  { name: "Araçatuba", position: [-21.2089, -50.4328] },
  { name: "Barretos", position: [-20.5572, -48.5678] },
  { name: "Catanduva", position: [-21.1378, -48.9728] },
  { name: "Lins", position: [-21.6736, -49.7477] },
  { name: "Penápolis", position: [-21.4197, -50.0775] },
  { name: "Ribeirão Preto", position: [-21.1699, -47.8099] },
  { name: "Santa Fé do Sul", position: [-20.2111, -50.9258] },
  { name: "São Carlos", position: [-22.0175, -47.8908] },
];
