import type { Prisma } from "@prisma/client";
import { perfisQuePodem } from "@/lib/permissoes";
import type { LeadChannel } from "@/lib/crm";

// Apoio das rotas de cotação (site e painel). Só o servidor importa este
// arquivo. Tudo aqui roda dentro da transação de quem chama.

/** Quem pode ser responsável por uma cotação: os perfis que têm a capacidade `crm`. */
export const DA_EQUIPE_COMERCIAL = { role: { in: perfisQuePodem("crm") } } as const;

export const EQUIPE_SELECT = { id: true, name: true } as const;

export type NovaCotacao = {
  companyName: string;
  email: string;
  phone: string;
  origin: string;
  destination: string;
  volumes: number;
  weight: number;
  invoiceValue: number | null;
  estimatedValue: number | null;
  channel: LeadChannel;
  assigneeId: string | null;
};

/**
 * Grava a cotação com o próximo número da empresa.
 *
 * Uma criação por vez na empresa, como no chamado e na fatura: é a trava que
 * mantém a numeração sem buraco nem repetição quando duas cotações chegam
 * juntas (o site e o painel ao mesmo tempo). Ela some no fim da transação.
 */
export async function criarCotacao<S extends Prisma.QuoteLeadSelect>(
  tx: Prisma.TransactionClient,
  dados: NovaCotacao,
  select: S,
): Promise<Prisma.QuoteLeadGetPayload<{ select: S }>> {
  // A empresa é a da própria transação. `::text` porque a função devolve
  // `void`, que o adaptador do banco não sabe ler.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('tms:cotacao:' || current_setting('app.tenant_id')))::text`;

  const ultima = await tx.quoteLead.findFirst({ where: { number: { not: null } }, orderBy: { number: "desc" }, select: { number: true } });
  return tx.quoteLead.create({
    data: {
      number: (ultima?.number ?? 0) + 1,
      companyName: dados.companyName,
      email: dados.email,
      phone: dados.phone,
      origin: dados.origin,
      destination: dados.destination,
      volumes: dados.volumes,
      weight: dados.weight,
      invoiceValue: dados.invoiceValue,
      estimatedValue: dados.estimatedValue,
      channel: dados.channel,
      assigneeId: dados.assigneeId,
      status: "NEW",
    },
    select,
  });
}
