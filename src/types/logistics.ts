export type ServiceArea = {
  city: string;
  hub: string;
  deadline: "Até 24h" | "Até 48h";
  vehicle: string;
  isExtendedDeadline: boolean;
};

export type FleetVehicle = {
  name: string;
  description: string;
  hubs: string[];
};
