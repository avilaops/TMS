import type { Prisma } from "@prisma/client";
import type { OccurrenceOrigin, OccurrencePriority, OccurrenceType } from "@/lib/ocorrencias";

// Apoio das rotas de ocorrência (painel, portal e motorista). Só o servidor
// importa este arquivo. Tudo aqui roda dentro da transação de quem chama.

export type TipoDeAviso = "ocorrencia.aberta" | "ocorrencia.status";

/**
 * Põe na fila o aviso para sistemas de fora, se a empresa tem endereço
 * cadastrado. Vai na mesma transação da mudança: o aviso não sai sem a mudança
 * ter acontecido, nem a mudança fica sem aviso. Os detalhes são lidos na hora
 * da entrega (src/lib/eventos.ts); aqui vai só o id.
 */
export async function avisarOcorrencia(tx: Prisma.TransactionClient, tipo: TipoDeAviso, occurrenceId: string): Promise<void> {
  const webhook = await tx.webhook.findFirst({ select: { id: true } });
  if (!webhook) return;
  await tx.outboxEvent.create({ data: { type: tipo, payload: { occurrenceId } }, select: { id: true } });
}

export type NovaOcorrencia = {
  type: OccurrenceType;
  title: string;
  description: string;
  priority?: OccurrencePriority | null;
  collectionId: string | null;
  clientId: string | null;
  openedById: string;
  origin: OccurrenceOrigin;
};

/**
 * Abre o chamado com o próximo número da empresa e avisa os sistemas de fora.
 *
 * Uma abertura por vez na empresa, como na emissão de fatura: é a trava que
 * mantém a numeração sem buraco nem repetição quando dois chamados nascem
 * juntos. Ela some no fim da transação.
 */
export async function abrirOcorrencia(tx: Prisma.TransactionClient, dados: NovaOcorrencia): Promise<{ id: string; number: number }> {
  // A empresa é a da própria transação. `::text` porque a função devolve
  // `void`, que o adaptador do banco não sabe ler.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('tms:ocorrencia:' || current_setting('app.tenant_id')))::text`;

  const ultima = await tx.occurrence.findFirst({ orderBy: { number: "desc" }, select: { number: true } });
  const criada = await tx.occurrence.create({
    data: {
      number: (ultima?.number ?? 0) + 1,
      type: dados.type,
      title: dados.title,
      description: dados.description,
      priority: dados.priority ?? "NORMAL",
      collectionId: dados.collectionId,
      clientId: dados.clientId,
      openedById: dados.openedById,
      origin: dados.origin,
    },
    select: { id: true, number: true },
  });

  await avisarOcorrencia(tx, "ocorrencia.aberta", criada.id);
  return criada;
}
