import { NextResponse } from "next/server";
import { transacao } from "@/lib/prisma";
import { requireStaff } from "@/lib/staff";
import { INACTIVE_CLIENT_MESSAGE } from "@/lib/coletas";
import {
  CONVERTED_COLLECTION_SELECT,
  LEAD_ALREADY_CONVERTED_MESSAGE,
  LEAD_CONVERTIBLE_STATUSES,
  LEAD_INCLUDE,
  LEAD_LOST_MESSAGE,
  LEAD_NOT_FOUND_MESSAGE,
  convertLeadSchema,
} from "@/lib/crm";
import { firstIssue } from "@/lib/usuarios";
import { withTrackingCode } from "@/lib/tracking";
import { freteDaColeta } from "@/lib/frete-coleta";

// Recusa que precisa desfazer a transação: o lead já foi marcado CONVERTED
// quando ela é lançada, e o rollback devolve o status anterior.
class Recusa extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Cotação aprovada vira coleta: cria a coleta e prende o lead a ela, de uma vez. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user, error } = await requireStaff();
  if (error) return error;

  try {
    const { id } = await params;
    const parsed = convertLeadSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const data = parsed.data;

    // O sorteio do código envolve a transação inteira: uma colisão de
    // `trackingCode` aborta a transação no Postgres, e não dá para tentar de
    // novo dentro dela.
    const resultado = await withTrackingCode((trackingCode) =>
      transacao(async (tx) => {
        // Primeiro passo, e é ele que impede a coleta em dobro: de duas
        // conversões juntas, a segunda espera a linha e já não acha o lead aberto.
        const { count } = await tx.quoteLead.updateMany({
          where: { id, status: { in: [...LEAD_CONVERTIBLE_STATUSES] } },
          data: { status: "CONVERTED" },
        });
        if (count === 0) {
          const atual = await tx.quoteLead.findUnique({ where: { id }, select: { status: true } });
          // Lead de outra empresa não aparece para esta: mesma resposta do inexistente.
          if (!atual) throw new Recusa(404, LEAD_NOT_FOUND_MESSAGE);
          if (atual.status === "LOST") throw new Recusa(409, LEAD_LOST_MESSAGE);
          throw new Recusa(409, LEAD_ALREADY_CONVERTED_MESSAGE);
        }

        const client = await tx.client.findFirst({
          where: { id: data.clientId, active: true },
          select: { id: true },
        });
        if (!client) throw new Recusa(400, INACTIVE_CLIENT_MESSAGE);

        const lead = await tx.quoteLead.findUniqueOrThrow({ where: { id } });
        // Ausente (`undefined`) herda o valor informado no pedido de cotação.
        // Apagado (`null`, o campo vazio do formulário) grava a coleta sem valor de nota.
        const invoiceValue = data.invoiceValue === undefined ? lead.invoiceValue : data.invoiceValue;

        // Como toda coleta: o frete sai da tabela do cliente (ou da padrão). O
        // valor estimado do lead não entra aqui de propósito: é o `freightValue`
        // que o faturamento cobra, e trocá-lo por um número digitado no funil
        // tiraria a coleta da tabela sem ninguém decidir isso. A resposta leva o
        // frete para a tela mostrar a diferença quando houver.
        const frete = await freteDaColeta(tx, {
          clientId: data.clientId,
          destination: lead.destination,
          weight: lead.weight,
          volumes: lead.volumes,
          invoiceValue,
        });

        const collection = await tx.collection.create({
          data: {
            clientId: data.clientId,
            sender: data.sender,
            receiver: data.receiver,
            // A carga é a do pedido de cotação: o corpo não a sobrescreve.
            origin: lead.origin,
            destination: lead.destination,
            volumes: lead.volumes,
            weight: lead.weight,
            invoiceKey: data.invoiceKey ?? null,
            invoiceValue,
            ...frete,
            freightDetails: frete.freightDetails ?? undefined,
            // Quem converte é o operador que aprovaria: nasce confirmada.
            status: "CONFIRMED",
            trackingCode,
            statusHistory: { create: { fromStatus: null, toStatus: "CONFIRMED", userId: user.id } },
          },
          select: CONVERTED_COLLECTION_SELECT,
        });

        const convertido = await tx.quoteLead.update({
          where: { id },
          data: { collectionId: collection.id },
          include: LEAD_INCLUDE,
        });

        return { lead: convertido, collection };
      }),
    );

    return NextResponse.json(resultado, { status: 201 });
  } catch (error) {
    if (error instanceof Recusa) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Erro ao converter cotação em coleta:", error);
    return NextResponse.json({ error: "Erro interno ao converter a cotação." }, { status: 500 });
  }
}
