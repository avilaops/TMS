import csv from "./serviceAreas.csv?raw";
import type { ServiceArea } from "../types/logistics";
import { normalizeText } from "../lib/normalization";

const [, ...rows] = csv.trim().split(/\r?\n/);

export const serviceAreas: ServiceArea[] = rows.map((row) => {
  const [city, hub, deadline, vehicle] = row.split(";");
  const typedDeadline = deadline === "Até 48h" ? "Até 48h" : "Até 24h";
  return { city, hub, deadline: typedDeadline, vehicle, isExtendedDeadline: typedDeadline === "Até 48h" };
});

export const totalServiceAreas = serviceAreas.length;

export function findServiceArea(city: string) {
  const wanted = normalizeText(city);
  return serviceAreas.find((area) => normalizeText(area.city) === wanted);
}

export function suggestServiceAreas(query: string, limit = 8) {
  const wanted = normalizeText(query);
  if (wanted.length < 2) return [];
  return serviceAreas.filter((area) => normalizeText(area.city).includes(wanted)).slice(0, limit);
}

export const hubs = Array.from(new Set(serviceAreas.map((area) => area.hub))).sort();
