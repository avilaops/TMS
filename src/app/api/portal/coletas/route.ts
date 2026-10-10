import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requirePortalClient } from '@/lib/portal';
import { withTrackingCode } from '@/lib/tracking';
import { freteDaColeta } from '@/lib/frete-coleta';
import { JANELA_INVERTIDA, janelaInvertida, pedidoDeColetaSchema } from '@/lib/coletas';
import { firstIssue } from '@/lib/usuarios';
import { enderecoDaEntregaSchema } from '@/lib/endereco';
import { escolher, origemDaRequisicao, registrarAuditoriaDepois } from '@/lib/auditoria';
import { avisarDepois, avisarEquipe, avisoDePedidoDeColeta } from '@/lib/notificacoes';

const COLLECTION_FIELDS = {
  id: true,
  sender: true,
  receiver: true,
  origin: true,
  destination: true,
  volumes: true,
  weight: true,
  invoiceValue: true,
  status: true,
  createdAt: true,
  trackingCode: true,
  // O cliente vê o valor e o prazo; a composição e a tabela ficam com a transportadora.
  freightValue: true,
  freightDeadlineHours: true,
  // O que ele mesmo pediu para a coleta.
  pickupDate: true,
  pickupFrom: true,
  pickupTo: true,
  priority: true,
  cubicMeters: true,
  pickupNotes: true,
  // O endereço de entrega que ele informou. A coordenada achada a partir dele
  // não vem: no portal não há mapa nem posição de motorista.
  deliveryStreet: true,
  deliveryNumber: true,
  deliveryDistrict: true,
  deliveryZip: true,
} as const;

export async function GET() {
  const { clientId, error } = await requirePortalClient();
  if (error) return error;

  try {
    const coletas = await prisma.collection.findMany({
      where: { clientId },
      orderBy: { createdAt: 'desc' },
      select: COLLECTION_FIELDS,
    });

    return NextResponse.json(coletas);
  } catch (error) {
    console.error('Erro ao buscar coletas:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const { clientId, userId, ator, error } = await requirePortalClient();
  if (error) return error;

  try {
    const body = await req.json();
    const { sender, receiver, origin, destination, volumes, weight, invoiceValue } = body;

    if (!sender || !receiver || !origin || !destination || !volumes || !weight) {
      return NextResponse.json({ error: 'Dados obrigatórios incompletos' }, { status: 400 });
    }

    const volumesNumber = Number(volumes);
    const weightNumber = Number(weight);

    if (!Number.isFinite(volumesNumber) || volumesNumber <= 0) {
      return NextResponse.json({ error: 'Quantidade de volumes inválida' }, { status: 400 });
    }

    if (!Number.isFinite(weightNumber) || weightNumber <= 0) {
      return NextResponse.json({ error: 'Peso inválido' }, { status: 400 });
    }

    let invoiceValueNumber: number | null = null;
    if (invoiceValue !== undefined && invoiceValue !== null && invoiceValue !== '') {
      invoiceValueNumber = Number(invoiceValue);
      if (!Number.isFinite(invoiceValueNumber) || invoiceValueNumber < 0) {
        return NextResponse.json({ error: 'Valor da mercadoria inválido' }, { status: 400 });
      }
    }

    // Janela de horário, prioridade, cubagem e observação: tudo opcional.
    const extras = pedidoDeColetaSchema.safeParse(body);
    if (!extras.success) {
      return NextResponse.json({ error: firstIssue(extras.error) }, { status: 400 });
    }
    const pedido = extras.data;
    if (janelaInvertida(pedido.pickupFrom, pedido.pickupTo)) {
      return NextResponse.json({ error: JANELA_INVERTIDA }, { status: 400 });
    }

    // Endereço da entrega (logradouro, número, bairro e CEP): opcional.
    const lido = enderecoDaEntregaSchema.safeParse(body);
    if (!lido.success) {
      return NextResponse.json({ error: firstIssue(lido.error) }, { status: 400 });
    }
    const endereco = lido.data;

    const frete = await freteDaColeta(prisma, {
      clientId,
      destination: String(destination),
      weight: weightNumber,
      volumes: volumesNumber,
      invoiceValue: invoiceValueNumber,
      cubicMeters: pedido.cubicMeters,
    });

    const collection = await withTrackingCode((trackingCode) =>
      prisma.collection.create({
        data: {
          clientId,
          sender: String(sender),
          receiver: String(receiver),
          origin: String(origin),
          destination: String(destination),
          volumes: volumesNumber,
          weight: weightNumber,
          invoiceValue: invoiceValueNumber,
          pickupDate: pedido.pickupDate ?? null,
          pickupFrom: pedido.pickupFrom ?? null,
          pickupTo: pedido.pickupTo ?? null,
          priority: pedido.priority ?? 'NORMAL',
          cubicMeters: pedido.cubicMeters ?? null,
          pickupNotes: pedido.pickupNotes ?? null,
          deliveryStreet: endereco.deliveryStreet ?? null,
          deliveryNumber: endereco.deliveryNumber ?? null,
          deliveryDistrict: endereco.deliveryDistrict ?? null,
          deliveryZip: endereco.deliveryZip ?? null,
          ...frete,
          freightDetails: frete.freightDetails ?? undefined,
          status: 'PENDING',
          trackingCode,
          // Primeira linha do histórico, gravada junto da coleta.
          statusHistory: { create: { fromStatus: null, toStatus: 'PENDING', userId } },
        },
        select: COLLECTION_FIELDS,
      })
    );

    await registrarAuditoriaDepois(prisma, {
      ator,
      origem: origemDaRequisicao(req),
      acao: 'coleta.pedir',
      entidade: 'coleta',
      entidadeId: collection.id,
      resumo: `Coleta ${collection.trackingCode ?? ''} pedida pelo portal para ${collection.receiver}`,
      depois: {
        clientId,
        ...escolher(collection, [
          'trackingCode',
          'status',
          'sender',
          'receiver',
          'origin',
          'destination',
          'volumes',
          'weight',
          'invoiceValue',
          'pickupDate',
          'pickupFrom',
          'pickupTo',
          'priority',
          'cubicMeters',
          'pickupNotes',
          'deliveryStreet',
          'deliveryNumber',
          'deliveryDistrict',
          'deliveryZip',
          'freightValue',
        ]),
      },
    });

    // Sininho: quem confirma coleta sabe que chegou um pedido. A coleta já foi
    // gravada: se o aviso falhar, o pedido segue valendo.
    await avisarDepois(`coleta.pedida ${collection.id}`, async () => {
      const cliente = await prisma.client.findUnique({ where: { id: clientId }, select: { companyName: true, tradeName: true } });
      await avisarEquipe(
        prisma,
        'coletas',
        avisoDePedidoDeColeta({ cliente: cliente?.tradeName || cliente?.companyName || 'Cliente', origin: collection.origin, destination: collection.destination }),
        userId,
      );
    });

    return NextResponse.json({ success: true, collection }, { status: 201 });
  } catch (error) {
    console.error('Erro ao criar solicitação de coleta:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
