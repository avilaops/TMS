import { createHash } from "node:crypto";
import { z } from "zod";

const texto = z.string().trim().min(1).max(200);
const documento = z.string().transform((valor, contexto) => {
  const normalizado = valor.replace(/\D/g, "");
  if (normalizado.length !== 11 && normalizado.length !== 14) {
    contexto.addIssue({ code: "custom", message: "Documento deve ter CPF ou CNPJ válido em tamanho." });
    return z.NEVER;
  }
  return normalizado;
});

const enderecoSchema = z.object({
  cidade: texto,
  uf: z.string().trim().toUpperCase().length(2),
  cep: z.string().transform((valor, contexto) => {
    const normalizado = valor.replace(/\D/g, "");
    if (normalizado.length !== 8) {
      contexto.addIssue({ code: "custom", message: "CEP deve ter oito dígitos." });
      return z.NEVER;
    }
    return normalizado;
  }),
  logradouro: z.string().trim().max(200).optional(),
  numero: z.string().trim().max(30).optional(),
  bairro: z.string().trim().max(100).optional(),
});

const volumeSchema = z.object({
  quantidade: z.number().int().min(1).max(10_000),
  pesoKg: z.number().positive().max(100_000),
  comprimentoCm: z.number().positive().max(10_000),
  larguraCm: z.number().positive().max(10_000),
  alturaCm: z.number().positive().max(10_000),
  pallet: z.boolean().default(false),
});

export const cotacaoLojasSchema = z.object({
  externalId: z.string().trim().min(1).max(120),
  modalidade: z.enum(["CIF", "FOB", "PICKUP", "OWN_CARRIER"]),
  cliente: z.object({ documento, nome: texto }),
  destino: enderecoSchema,
  origens: z.array(z.object({
    id: z.string().trim().min(1).max(120),
    nome: texto,
    cidade: texto,
    uf: z.string().trim().toUpperCase().length(2),
    volumes: z.array(volumeSchema).min(1).max(1_000),
  })).min(1).max(100),
  valorNota: z.number().nonnegative().max(1_000_000_000).optional(),
});

export type CotacaoLojas = z.infer<typeof cotacaoLojasSchema>;

export const reversaLojasSchema = z.object({
  externalId: z.string().trim().min(1).max(120),
  pedidoOriginal: z.string().trim().min(1).max(120),
  rma: z.string().trim().min(1).max(120),
});

export const inspecaoLojasSchema = z.object({
  decisao: z.enum(["RESTOCK", "REPAIR", "DISCARD", "RETURN_TO_CUSTOMER"]),
  observacao: z.string().trim().max(1_000).optional(),
});

export function resumirCarga(pedido: CotacaoLojas) {
  const resumo = pedido.origens.flatMap((origem) => origem.volumes).reduce(
    (total, volume) => ({
      volumes: total.volumes + volume.quantidade,
      pesoKg: total.pesoKg + volume.pesoKg * volume.quantidade,
      cubagemM3: total.cubagemM3 + (volume.comprimentoCm * volume.larguraCm * volume.alturaCm * volume.quantidade) / 1_000_000,
      pallets: total.pallets + (volume.pallet ? volume.quantidade : 0),
    }),
    { volumes: 0, pesoKg: 0, cubagemM3: 0, pallets: 0 },
  );
  return { ...resumo, cubagemM3: Number(resumo.cubagemM3.toFixed(6)) };
}

function ordenar(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(ordenar);
  if (valor && typeof valor === "object" && Object.getPrototypeOf(valor) === Object.prototype) {
    return Object.fromEntries(Object.entries(valor as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([chave, item]) => [chave, ordenar(item)]));
  }
  return valor;
}

export function hashCanonico(valor: unknown) {
  return createHash("sha256").update(JSON.stringify(ordenar(valor))).digest("hex");
}
