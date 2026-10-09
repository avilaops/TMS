import { z } from "zod";
import { paraEmpresa } from "@/lib/prisma";
import { empresaPublica } from "@/lib/empresas";
import { calcularFrete, tabelaVigente } from "@/lib/frete";

/**
 * Pedido de cotação vindo de fora (site da transportadora), sem sessão.
 *
 * As rotas `/api/leads` e `/api/cotacoes` são a mesma coisa com respostas
 * diferentes; as duas passam por aqui. O valor estimado sai da tabela de frete
 * padrão da empresa. Sem tabela, ou com a cidade fora dela, o pedido é gravado
 * do mesmo jeito, sem valor: é o comercial que responde.
 */

const numeroDoFormulario = (valor: unknown) => {
  if (typeof valor !== "string") return valor;
  const texto = valor.trim().replace(",", ".");
  return texto === "" ? undefined : Number(texto);
};

const texto = (max: number) => z.string().trim().min(1).max(max);

const pedidoSchema = z.object({
  empresa: z.unknown().optional(),
  companyName: texto(200),
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  phone: z.string().trim().max(30).optional(),
  origin: texto(200),
  destination: texto(200),
  volumes: z.preprocess(numeroDoFormulario, z.number().int().min(1).max(100000)).optional(),
  weight: z.preprocess(numeroDoFormulario, z.number().positive().max(1000000)),
  invoiceValue: z.preprocess(numeroDoFormulario, z.number().min(0).max(1000000000)).optional(),
});

// O que as duas rotas públicas devolvem do lead gravado. A lista é fechada de
// propósito: o site consome este formato, e coluna nova do funil (valor da
// nota, coleta da conversão) não sai para fora por acréscimo.
const LEAD_PUBLICO_SELECT = {
  tenantId: true,
  id: true,
  companyName: true,
  email: true,
  phone: true,
  origin: true,
  destination: true,
  volumes: true,
  weight: true,
  estimatedValue: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

export type ResultadoDaCotacao =
  | { ok: false; status: 400 | 404; erro: string }
  | {
      ok: true;
      lead: { id: string; estimatedValue: number | null; status: string; createdAt: Date } & Record<string, unknown>;
      estimatedValue: number | null;
      prazoHoras: number | null;
      avisos: string[];
    };

export async function registrarCotacao(corpo: unknown, opcoes: { volumesPadrao?: number } = {}): Promise<ResultadoDaCotacao> {
  const parsed = pedidoSchema.safeParse(corpo);
  if (!parsed.success) return { ok: false, status: 400, erro: "Preencha todos os campos obrigatórios." };
  const pedido = parsed.data;

  const volumes = pedido.volumes ?? opcoes.volumesPadrao;
  if (volumes === undefined) return { ok: false, status: 400, erro: "Preencha todos os campos obrigatórios." };

  // Rota pública: a empresa vem do corpo (`empresa`, o slug) ou do padrão do ambiente.
  const tenantId = await empresaPublica(pedido.empresa);
  if (!tenantId) return { ok: false, status: 404, erro: "Empresa não encontrada." };

  const { db } = paraEmpresa(tenantId);

  const tabela = await tabelaVigente(db);
  const frete = tabela
    ? calcularFrete(tabela, pedido.destination, { peso: pedido.weight, volumes, valorNota: pedido.invoiceValue })
    : null;
  const estimatedValue = frete?.atendida ? frete.valor : null;

  const lead = await db.quoteLead.create({
    data: {
      companyName: pedido.companyName,
      email: pedido.email,
      phone: pedido.phone ?? "",
      origin: pedido.origin,
      destination: pedido.destination,
      volumes,
      weight: pedido.weight,
      estimatedValue,
      invoiceValue: pedido.invoiceValue ?? null,
      status: "NEW",
    },
    select: LEAD_PUBLICO_SELECT,
  });

  return {
    ok: true,
    lead,
    estimatedValue,
    prazoHoras: frete?.atendida ? frete.prazoHoras : null,
    avisos: frete?.atendida ? frete.avisos : [],
  };
}
