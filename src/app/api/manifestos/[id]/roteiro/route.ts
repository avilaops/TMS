import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireStaff } from '@/lib/staff';
import { firstIssue } from '@/lib/usuarios';
import { MANIFEST_NOT_FOUND_MESSAGE } from '@/lib/manifestos';
import { ORDER_LOCKED, ordenarParadas } from '@/lib/viagem';
import { roteiroDaViagem, roteiroSchema } from '@/lib/roteiro';
import { municipios } from '@/lib/municipios';

/**
 * A ordem sugerida das entregas da viagem (roteirização por cidade). Só calcula
 * e devolve: não grava nada. Quem aplica é `PUT /api/manifestos/[id]/ordem`,
 * que confere a lista de novo e registra a auditoria.
 *
 * Vale para quem pode alterar a viagem e nas mesmas situações em que a ordem
 * pode ser alterada (em montagem e em rota). A conta e os limites dela (linha
 * reta, entre centros das cidades) estão em src/lib/roteiro.ts.
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
        collections: { select: { id: true, origin: true, destination: true, status: true, manifestSequence: true, createdAt: true } },
      },
    });
    if (!viagem) return NextResponse.json({ error: MANIFEST_NOT_FOUND_MESSAGE }, { status: 404 });
    if (viagem.status !== 'ASSEMBLING' && viagem.status !== 'ROUTE') {
      return NextResponse.json({ error: ORDER_LOCKED }, { status: 409 });
    }

    return NextResponse.json(roteiroDaViagem(ordenarParadas(viagem.collections), municipios(), { voltar: parsed.data.voltar }));
  } catch (error) {
    console.error('Erro ao sugerir a ordem das entregas:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
