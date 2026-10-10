import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireStaff } from '@/lib/staff';
import { firstIssue } from '@/lib/usuarios';
import { MANIFEST_NOT_FOUND_MESSAGE } from '@/lib/manifestos';
import { ORDER_LOCKED, ordenarParadas } from '@/lib/viagem';
import { lugaresDaViagem, pontosDaConta, roteiroDaViagem, roteiroSchema } from '@/lib/roteiro';
import { distanciaPorEstrada } from '@/lib/rota-osrm';
import { municipios } from '@/lib/municipios';

/**
 * A ordem sugerida das entregas da viagem: pelo endereço localizado de cada
 * carga e, onde não há, pelo centro da cidade. Só calcula e devolve: não grava nada. Quem aplica é `PUT /api/manifestos/[id]/ordem`,
 * que confere a lista de novo e registra a auditoria.
 *
 * Vale para quem pode alterar a viagem e nas mesmas situações em que a ordem
 * pode ser alterada (em montagem e em rota). A conta e os limites dela estão em
 * src/lib/roteiro.ts. A distância é em linha reta; com `ROTA_URL` apontando para
 * um servidor OSRM, é por estrada (src/lib/rota-osrm.ts), e qualquer falha dele
 * volta para a linha reta sem derrubar a sugestão.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireStaff({ pode: 'manifestos' });
  if (error) return error;

  try {
    const manifestId = (await params).id;

    // Sem corpo vale o padrão (com a volta à origem).
    const parsed = roteiroSchema.safeParse((await req.json().catch(() => null)) ?? {});
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }

    const viagem = await prisma.manifest.findUnique({
      where: { id: manifestId },
      select: {
        status: true,
        collections: {
          select: { id: true, origin: true, destination: true, status: true, manifestSequence: true, createdAt: true, deliveryLat: true, deliveryLon: true },
        },
      },
    });
    if (!viagem) return NextResponse.json({ error: MANIFEST_NOT_FOUND_MESSAGE }, { status: 404 });
    if (viagem.status !== 'ASSEMBLING' && viagem.status !== 'ROUTE') {
      return NextResponse.json({ error: ORDER_LOCKED }, { status: 409 });
    }

    const cargas = ordenarParadas(viagem.collections);
    const lugares = lugaresDaViagem(cargas, municipios());
    // `null` sem `ROTA_URL` ou em qualquer falha do servidor de rotas: vale a linha reta.
    const distancia = await distanciaPorEstrada(pontosDaConta(lugares));

    return NextResponse.json(roteiroDaViagem(cargas, municipios(), { voltar: parsed.data.voltar, distancia, lugares }));
  } catch (error) {
    console.error('Erro ao sugerir a ordem das entregas:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
