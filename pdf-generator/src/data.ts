import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(__dirname, "../../tabela_frete_serilon.csv");

export interface CompanyInfo {
  legalName: string;
  address: string;
  phone: string;
  whatsapp: string;
  email: string;
  website: string;
  coverage: string;
}

export interface FreightRules {
  minFreight: string;
  minFreightRule: string;
  weightRate: string;
  weightRateRule: string;
  cubageFactor: string;
  cubageFormula: string;
  nfLimit: string;
  redelivery: string;
  returnFee: string;
  note: string;
}

export interface DeliveryTerms {
  general: string;
  exceptions: string;
}

export interface City {
  name: string;
  polo: string;
  deadline: string;
  vehicle: string;
}

export interface PoloGroup {
  polo: string;
  cities: City[];
}

export interface VehicleType {
  name: string;
  description: string;
}

export const companyInfo: CompanyInfo = {
  legalName: "Mello Transportes Rio Preto",
  address:
    "Rua Bonsucesso, nº 695 - Quinta das Paineiras - São José do Rio Preto/SP",
  phone: "(17) 3308-0878",
  whatsapp: "(17) 99714-9702",
  email: "comercial@mellotransportesriopreto.com.br",
  website: "www.mellotransportesriopreto.com.br",
  coverage: "São José do Rio Preto e mais de 130 cidades da região (SP)",
};

export const freightRules: FreightRules = {
  minFreight: "R$ 60,00",
  minFreightRule: "Até 51 kg (sem cubagem)",
  weightRate: "R$ 0,85 / kg",
  weightRateRule: "Aplicado acima de 51 kg",
  cubageFactor: "300 kg/m³",
  cubageFormula: "Altura (m) × Largura (m) × Comprimento (m) × 300 = Peso Cubado",
  nfLimit: "R$ 1.500,00",
  redelivery: "50% do frete original",
  returnFee: "100% do frete original",
  note:
    "O frete peso é cobrado pelo maior valor entre peso físico e peso cubado. Tarifas válidas para Notas Fiscais de até R$ 1.500,00 — acima desse valor, consultar o setor comercial para cotação personalizada.",
};

export const deliveryTerms: DeliveryTerms = {
  general: "Até 24h",
  exceptions: "Até 48h",
};

const VEHICLE_CHARACTERISTICS: Record<string, string> = {
  "Caminhão VUC (Até 3,7m)":
    "Veículo urbano de carga para coletas e entregas",
  "Fiat Strada": "Utilitário leve e rápido",
  "Van de Carga": "Furgão de capacidade média",
};

const VEHICLE_ORDER = ["Caminhão VUC (Até 3,7m)", "Van de Carga", "Fiat Strada"];

export function getFleetTypes(cities: City[]): VehicleType[] {
  const distinct = new Set(cities.map((c) => c.vehicle));
  return VEHICLE_ORDER.filter((v) => distinct.has(v)).map((name) => ({
    name,
    description: VEHICLE_CHARACTERISTICS[name] ?? "",
  }));
}

function parseCsv(raw: string): City[] {
  const lines = raw.trim().split(/\r?\n/);
  const [, ...rows] = lines;
  return rows.map((line) => {
    const [name, polo, deadline, vehicle] = line.split(";");
    return { name: name.trim(), polo: polo.trim(), deadline: deadline.trim(), vehicle: vehicle.trim() };
  });
}

export function loadCities(): City[] {
  const raw = readFileSync(CSV_PATH, "utf-8");
  return parseCsv(raw);
}

const POLO_NAME_FIXES: Record<string, string> = {
  "São José Do Rio Preto": "São José do Rio Preto",
};

export function groupByPolo(cities: City[]): PoloGroup[] {
  const map = new Map<string, City[]>();
  for (const city of cities) {
    const polo = POLO_NAME_FIXES[city.polo] ?? city.polo;
    const list = map.get(polo) ?? [];
    list.push(city);
    map.set(polo, list);
  }

  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "pt-BR"))
    .map(([polo, list]) => {
      const cities = [...list].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
      return { polo, cities };
    });
}
