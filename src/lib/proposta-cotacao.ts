import { formatCalendarDate, formatCurrency } from "@/lib/format";

export type DadosDaProposta = {
  number: number | null;
  companyName: string;
  origin: string;
  destination: string;
  volumes: number;
  weight: number;
  estimatedValue: number | null;
  deadline: string;
  validUntil: string;
};

const dataDeCalendarioValida = (valor: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  const data = new Date(`${valor}T00:00:00.000Z`);
  return !Number.isNaN(data.getTime()) && data.toISOString().slice(0, 10) === valor;
};

export function mensagemDaProposta(dados: DadosDaProposta): string {
  if (dados.estimatedValue === null) throw new Error("A cotação precisa ter um valor estimado.");
  const prazo = dados.deadline.trim();
  if (!prazo) throw new Error("Informe o prazo de entrega.");
  if (!dados.validUntil) throw new Error("Informe a validade da proposta.");
  if (!dataDeCalendarioValida(dados.validUntil)) throw new Error("Informe uma data de validade válida.");

  const identificacao = dados.number === null ? "Segue a proposta da sua cotação:" : `Segue a proposta da cotação nº ${dados.number}:`;
  return [
    `Olá, ${dados.companyName}!`,
    "",
    identificacao,
    `${dados.origin} → ${dados.destination}`,
    `Carga: ${dados.volumes} volumes · ${dados.weight.toLocaleString("pt-BR")} kg`,
    `Frete estimado: ${formatCurrency(dados.estimatedValue).replace(/\u00a0/g, " ")}`,
    `Prazo de entrega: ${prazo}`,
    `Proposta válida até ${formatCalendarDate(dados.validUntil)}.`,
    "",
    "O valor é estimado e está sujeito à confirmação no momento da coleta.",
  ].join("\n");
}
