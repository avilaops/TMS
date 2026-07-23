import type { FleetVehicle } from "../types/logistics";

export const fleet: FleetVehicle[] = [
  { name: "Fiat Strada", description: "Utilitário leve para coletas e entregas ágeis.", hubs: ["Araçatuba", "Barretos", "São Carlos"] },
  { name: "Van de Carga", description: "Furgão de capacidade média para distribuição regional.", hubs: ["Catanduva", "Santa Fé do Sul"] },
  { name: "Caminhão VUC (Até 3,7m)", description: "Veículo urbano de carga para coletas e entregas.", hubs: ["São José do Rio Preto", "Lins", "Penápolis", "Ribeirão Preto"] },
];
