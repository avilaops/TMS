import { NextResponse } from 'next/server';
import { transacao } from '@/lib/prisma';
import { requireStaff } from '@/lib/staff';
import { firstIssue } from '@/lib/usuarios';
import { ManifestError, lockManifest } from '@/lib/manifestos-db';
import { INCOMPLETE_ORDER_MESSAGE, ORDER_LOCKED, codigoDaViagem, ordemCompleta, ordenarParadas, orderSchema } from '@/lib/viagem';
import { origemDaRequisicao, registrarAuditoria } from '@/lib/auditoria';

/**
 * Grava a ordem das entregas da viagem. O corpo traz todas as cargas dela, na
 * ordem; cada uma recebe a sequência 1, 2, 3... É a ordem que o painel e o
 * aplicativo do motorista mostram e a do link da rota no mapa.
 *
 * Vale em montagem e em rota (a operação reordena com o caminhão na rua).
 * Lista que não bate com as cargas da viagem é 409: alguém embarcou ou retirou
 * carga enquanto a tela estava aberta.
 */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user, error } = await requireStaff({ pode: 'manifestos' });
    if (error) return error;

    const manifestId = (await params).id;
    const origem = origemDaRequisicao(req);

    const parsed = orderSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const pedida = parsed.data.collectionIds;

    await transacao(async (tx) => {
      const manifest = await lockManifest(tx, manifestId);
      if (manifest.status !== 'ASSEMBLING' && manifest.status !== 'ROUTE') throw new ManifestError(409, ORDER_LOCKED);

      const cargas = await tx.collection.findMany({
        where: { manifestId },
        select: { id: true, manifestSequence: true, createdAt: true },
      });
      const antes = ordenarParadas(cargas).map((carga) => carga.id);
      if (!ordemCompleta(antes, pedida)) throw new ManifestError(409, INCOMPLETE_ORDER_MESSAGE);

      // Uma carga por vez: são poucas por viagem, e cada uma tem a sua sequência.
      for (const [posicao, id] of pedida.entries()) {
        await tx.collection.updateMany({ where: { id, manifestId }, data: { manifestSequence: posicao + 1 } });
      }

      if (antes.join() !== pedida.join()) {
        await registrarAuditoria(tx, {
          ator: user,
          origem,
          acao: 'viagem.ordem',
          entidade: 'manifesto',
          entidadeId: manifestId,
          resumo: `Ordem das entregas da viagem #${codigoDaViagem(manifestId)} alterada`,
          antes: { ordem: antes },
          depois: { ordem: pedida },
        });
      }
    });

    return NextResponse.json({ success: true, collectionIds: pedida });
  } catch (error) {
    if (error instanceof ManifestError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Erro ao ordenar as entregas da viagem:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
