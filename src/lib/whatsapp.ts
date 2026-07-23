import { company } from "../config/company";

export function whatsappUrl(message: string) {
  return `https://wa.me/${company.whatsappNumber}?text=${encodeURIComponent(message)}`;
}

export function cityCheckMessage(city: string) {
  return `Olá! Gostaria de confirmar se a Mello Transportes atende a cidade de ${city}.`;
}
