// Tipos do que o TMS usa do pacote `leaflet` (src/components/mapa-da-viagem.tsx).
// A única dependência nova do módulo de mapa é o próprio `leaflet`; os tipos da
// comunidade (`@types/leaflet`) seriam um segundo pacote, então fica aqui só o
// que o componente chama.
declare module "leaflet" {
  export type LatLngTuple = [number, number];

  export interface Layer {
    addTo(destino: Map | LayerGroup): this;
    remove(): this;
    bindPopup(conteudo: string | HTMLElement): this;
    bindTooltip(conteudo: string | HTMLElement): this;
  }

  export interface LayerGroup extends Layer {
    clearLayers(): this;
  }

  export interface Map {
    setView(centro: LatLngTuple, zoom: number): this;
    fitBounds(limites: LatLngTuple[], opcoes?: { padding?: [number, number]; maxZoom?: number }): this;
    invalidateSize(): this;
    remove(): this;
  }

  export interface DivIcon {
    readonly options: Record<string, unknown>;
  }

  export type OpcoesDoMapa = { zoomControl?: boolean; attributionControl?: boolean; scrollWheelZoom?: boolean };
  export type OpcoesDosBlocos = { attribution?: string; maxZoom?: number };
  export type OpcoesDeTraco = { color?: string; weight?: number; opacity?: number; dashArray?: string; fillColor?: string; fillOpacity?: number; radius?: number };

  export function map(elemento: HTMLElement, opcoes?: OpcoesDoMapa): Map;
  export function tileLayer(endereco: string, opcoes?: OpcoesDosBlocos): Layer;
  export function layerGroup(): LayerGroup;
  export function marker(ponto: LatLngTuple, opcoes?: { icon?: DivIcon; title?: string; keyboard?: boolean }): Layer;
  export function divIcon(opcoes: { html: string; className?: string; iconSize?: [number, number]; iconAnchor?: [number, number] }): DivIcon;
  export function polyline(pontos: LatLngTuple[], opcoes?: OpcoesDeTraco): Layer;
  export function circleMarker(ponto: LatLngTuple, opcoes?: OpcoesDeTraco): Layer;
  export function circle(ponto: LatLngTuple, opcoes?: OpcoesDeTraco): Layer;
}

declare module "leaflet/dist/leaflet.css";
