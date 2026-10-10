"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import type { LatLngTuple, LayerGroup, Map as MapaDoLeaflet } from "leaflet";
import { ATRIBUICAO_DO_MAPA, enderecoDosBlocos, type MapaDaViagem } from "@/lib/mapa";
import { haQuantoTempo } from "@/lib/posicao";
import { AVISO_DO_TRANSITO } from "@/lib/roteiro";

/**
 * O mapa da viagem: as paradas numeradas na ordem, a linha entre elas e a
 * posição do motorista. Serve ao painel (aba Rota) e ao app do motorista.
 *
 * Desenhado com o Leaflet sobre os blocos de imagem do OpenStreetMap:
 * - o Leaflet mexe em `window` ao ser carregado, então entra por import
 *   dinâmico, dentro do efeito: no servidor este componente só rende a moldura;
 * - o crédito "© OpenStreetMap" fica visível no canto do mapa (é o que a
 *   licença dos dados pede) e o endereço dos blocos vem de
 *   `NEXT_PUBLIC_MAPA_TILES`, para trocar o servidor depois;
 * - a linha liga as paradas em linha reta, na ordem: não é o caminho pela
 *   estrada, e trânsito não existe em fonte aberta. A legenda diz.
 */

type PosicaoNoMapa = { lat: number; lon: number; precisao: number | null; em: string | number };

const COR_DA_PARADA = "#2563eb";
const COR_DA_ENTREGUE = "#16a34a";
const COR_DO_MOTORISTA = "#dc2626";

/** O marcador numerado: cheio quando o ponto é o do endereço, vazado quando é o centro da cidade. */
function marcadorNumerado(numero: number, { entregue, peloEndereco }: { entregue: boolean; peloEndereco: boolean }): string {
  const cor = entregue ? COR_DA_ENTREGUE : COR_DA_PARADA;
  const fundo = peloEndereco ? cor : "#ffffff";
  const letra = peloEndereco ? "#ffffff" : cor;
  const borda = peloEndereco ? "2px solid #ffffff" : `2px dashed ${cor}`;
  return `<div style="width:26px;height:26px;border-radius:9999px;background:${fundo};color:${letra};border:${borda};box-shadow:0 1px 3px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;font:700 12px/1 system-ui,sans-serif">${numero}</div>`;
}

/** O texto do balão, montado com `textContent`: nome de destinatário e endereço vêm de cadastro e de nota, nunca viram HTML. */
function balao(titulo: string, linha: string): HTMLElement {
  const caixa = document.createElement("div");
  const forte = document.createElement("strong");
  forte.textContent = titulo;
  const texto = document.createElement("div");
  texto.textContent = linha;
  caixa.append(forte, texto);
  return caixa;
}

export function MapaDaViagemNaTela({
  mapa,
  posicaoDoAparelho,
  className = "h-64",
}: {
  mapa: MapaDaViagem;
  /** No app do motorista: a posição lida agora do aparelho, que vale no lugar da última que o servidor guardou. */
  posicaoDoAparelho?: PosicaoNoMapa | null;
  /** A altura da moldura (classe do Tailwind). */
  className?: string;
}) {
  const moldura = useRef<HTMLDivElement>(null);
  const leaflet = useRef<{ L: typeof import("leaflet"); mapa: MapaDoLeaflet; camada: LayerGroup } | null>(null);
  const enquadrado = useRef("");
  const [pronto, setPronto] = useState(false);
  const [falhou, setFalhou] = useState(false);

  const posicao: PosicaoNoMapa | null = posicaoDoAparelho ?? mapa.posicao;
  const comPonto = mapa.paradas.filter((parada) => parada.ponto !== null);
  const semPonto = mapa.paradas.length - comPonto.length;
  const peloCentro = comPonto.filter((parada) => parada.ponto?.precisao === "cidade").length;
  const aLocalizar = mapa.paradas.filter((parada) => parada.aLocalizar).length;

  // Monta o mapa uma vez, só no navegador.
  useEffect(() => {
    let vivo = true;
    void import("leaflet")
      .then((modulo) => {
        if (!vivo || !moldura.current) return;
        // O pacote sai como módulo com nomes ou com `default`, conforme quem empacota.
        const L = ((modulo as unknown as { default?: typeof import("leaflet") }).default ?? modulo) as typeof import("leaflet");
        // A roda do mouse fica desligada: dentro de um painel que rola, ela prenderia a rolagem no mapa.
        const novo = L.map(moldura.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: false });
        L.tileLayer(enderecoDosBlocos(), { attribution: ATRIBUICAO_DO_MAPA, maxZoom: 19 }).addTo(novo);
        leaflet.current = { L, mapa: novo, camada: L.layerGroup().addTo(novo) };
        setPronto(true);
      })
      .catch(() => {
        if (vivo) setFalhou(true);
      });
    return () => {
      vivo = false;
      leaflet.current?.mapa.remove();
      leaflet.current = null;
    };
  }, []);

  // Redesenha os marcadores a cada mudança das paradas ou da posição.
  useEffect(() => {
    const atual = leaflet.current;
    if (!pronto || !atual) return;
    const { L, mapa: desenho, camada } = atual;
    camada.clearLayers();

    const caminho: LatLngTuple[] = [];
    if (mapa.origem) {
      const ponto: LatLngTuple = [mapa.origem.lat, mapa.origem.lon];
      caminho.push(ponto);
      L.circleMarker(ponto, { radius: 6, color: "#374151", weight: 2, fillColor: "#ffffff", fillOpacity: 1 }).bindTooltip(`Origem: ${mapa.origem.nome}`).addTo(camada);
    }
    for (const parada of comPonto) {
      const ponto: LatLngTuple = [parada.ponto!.lat, parada.ponto!.lon];
      caminho.push(ponto);
    }
    if (caminho.length > 1) L.polyline(caminho, { color: COR_DA_PARADA, weight: 3, opacity: 0.6, dashArray: "6 6" }).addTo(camada);
    for (const parada of comPonto) {
      const html = marcadorNumerado(parada.numero, { entregue: parada.status === "DELIVERED", peloEndereco: parada.ponto!.precisao === "endereco" });
      L.marker([parada.ponto!.lat, parada.ponto!.lon], { icon: L.divIcon({ html, className: "", iconSize: [26, 26], iconAnchor: [13, 13] }), title: `${parada.numero}. ${parada.receiver}`, keyboard: false })
        .bindPopup(balao(`${parada.numero}. ${parada.receiver}`, parada.destino))
        .addTo(camada);
    }

    const pontos = [...caminho];
    if (posicao) {
      const ponto: LatLngTuple = [posicao.lat, posicao.lon];
      pontos.push(ponto);
      // O círculo claro é o raio de erro que o aparelho informou; acima de 2 km não ajuda ninguém.
      if (posicao.precisao && posicao.precisao <= 2000) L.circle(ponto, { radius: posicao.precisao, color: COR_DO_MOTORISTA, weight: 1, opacity: 0.4, fillColor: COR_DO_MOTORISTA, fillOpacity: 0.1 }).addTo(camada);
      L.circleMarker(ponto, { radius: 8, color: "#ffffff", weight: 3, fillColor: COR_DO_MOTORISTA, fillOpacity: 1 }).bindTooltip(`Motorista, ${haQuantoTempo(new Date(posicao.em))}`).addTo(camada);
    }

    // Enquadra de novo só quando as paradas mudam ou a posição aparece pela primeira vez:
    // a cada posição nova o mapa não pula enquanto a pessoa olha.
    const chave = `${caminho.map((ponto) => ponto.join()).join(";")}|${posicao ? "p" : ""}`;
    if (pontos.length > 0 && chave !== enquadrado.current) {
      enquadrado.current = chave;
      desenho.invalidateSize();
      if (pontos.length === 1) desenho.setView(pontos[0], 14);
      else desenho.fitBounds(pontos, { padding: [28, 28], maxZoom: 16 });
    }
    // `comPonto` sai de `mapa.paradas`: listar os dois repetiria o efeito a cada desenho.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pronto, mapa.paradas, mapa.origem, posicao?.lat, posicao?.lon, posicao?.precisao, posicao?.em]);

  return (
    <div data-mapa-da-viagem className="space-y-1">
      <div className={`relative isolate w-full overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 ${className}`}>
        <div ref={moldura} className="absolute inset-0" role="application" aria-label="Mapa da viagem" />
        {!pronto && (
          <p className="absolute inset-0 flex items-center justify-center px-4 text-center text-xs text-gray-500">
            {falhou ? "Não foi possível carregar o mapa. A lista de paradas e o link do Google Maps seguem valendo." : "Carregando o mapa…"}
          </p>
        )}
      </div>
      <p data-legenda-do-mapa className="text-[11px] leading-snug text-gray-500">
        {posicao ? (
          <span data-posicao-do-motorista>
            Motorista: localização {haQuantoTempo(new Date(posicao.em))}
            {posicao.precisao ? ` (±${Math.round(posicao.precisao)} m)` : ""}.{" "}
          </span>
        ) : mapa.status === "ROUTE" ? (
          <span data-sem-posicao>Motorista sem localização compartilhada. </span>
        ) : null}
        {peloCentro > 0 && (
          <span data-pelo-centro>
            {peloCentro === 1 ? "1 parada está" : `${peloCentro} paradas estão`} no centro da cidade (marcador tracejado)
            {aLocalizar > 0 ? `; ${aLocalizar === 1 ? "1 endereço ainda está sendo localizado" : `${aLocalizar} endereços ainda estão sendo localizados`}` : ""}.{" "}
          </span>
        )}
        {semPonto > 0 && <span data-fora-do-mapa>{semPonto === 1 ? "1 parada ficou" : `${semPonto} paradas ficaram`} fora do mapa: cidade não reconhecida. </span>}
        Linha reta entre as paradas, não o caminho da estrada. {AVISO_DO_TRANSITO}
      </p>
    </div>
  );
}
