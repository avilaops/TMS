import L from "leaflet";
import "leaflet/dist/leaflet.css";
import React from "react";
import { CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer } from "react-leaflet";
import { hubCoordinates, originHub } from "../data/gis";
import { serviceAreas } from "../data/serviceAreas";

const markerIcon = new L.DivIcon({ className: "map-pin", html: "<span></span>", iconSize: [18, 18], iconAnchor: [9, 9] });
const originIcon = new L.DivIcon({ className: "map-pin origin-pin", html: "<span></span>", iconSize: [24, 24], iconAnchor: [12, 12] });

export function RouteMap() {
  const destinationHubs = hubCoordinates.filter((hub) => hub.name !== originHub.name);

  return (
    <MapContainer center={[-21.08, -49.35]} zoom={7} scrollWheelZoom={false} className="osm-map">
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <Marker position={originHub.position} icon={originIcon}>
        <Popup><b>Matriz</b><br />{originHub.name}</Popup>
      </Marker>
      {destinationHubs.map((hub) => {
        const areas = serviceAreas.filter((area) => area.hub === hub.name);
        const has48h = areas.some((area) => area.isExtendedDeadline);
        return (
          <React.Fragment key={hub.name}>
            <Polyline positions={[originHub.position, hub.position]} pathOptions={{ color: has48h ? "#f47b20" : "#f8b400", weight: 4, opacity: 0.85 }} />
            <Marker position={hub.position} icon={markerIcon}>
              <Popup><b>{hub.name}</b><br />{areas.length} cidades cadastradas<br />{has48h ? "Rotas até 24h e 48h" : "Rotas até 24h"}</Popup>
            </Marker>
            <CircleMarker center={hub.position} radius={Math.max(8, Math.min(22, areas.length / 2))} pathOptions={{ color: has48h ? "#f47b20" : "#f8b400", fillColor: has48h ? "#f47b20" : "#f8b400", fillOpacity: 0.18, weight: 2 }} />
          </React.Fragment>
        );
      })}
    </MapContainer>
  );
}
