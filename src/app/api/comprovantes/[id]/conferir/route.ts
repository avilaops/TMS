import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireStaff } from '@/lib/staff';
import { ALREADY_REVIEWED_MESSAGE, PROOF_NOT_FOUND_MESSAGE, conferenciaSchema } from '@/lib/entregas';
import { firstIssue } from '@/lib/usuarios';
import { origemDaRequisicao, registrarAuditoriaDepois } from '@/lib/auditoria';

/**
 * Aprova ou recusa o comprovante de uma entrega. O `[id]` é o da coleta, como
 * na baixa do motorista e na página do comprovante.
 *
 * A conferência não mexe na coleta: ela segue entregue, com o mesmo recebedor
 * e sem linha nova no histórico de status.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { user, error } = await requireStaff();
    if (error) return error;

    const collectionId = (await params).id;

    const parsed = conferenciaSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const { decision, reason } = parsed.data;

    const proof = await prisma.proofOfDelivery.findUnique({
      where: { collectionId },
      select: { id: true },
    });
    if (!proof) {
      return NextResponse.json({ error: PROOF_NOT_FOUND_MESSAGE }, { status: 404 });
    }

    // Grava só se o comprovante ainda aguarda conferência: de duas decisões
    // simultâneas, uma encontra zero linhas e recebe 409. A decisão é final.
    const { count } = await prisma.proofOfDelivery.updateMany({
      where: { collectionId, status: 'SUBMITTED' },
      data: {
        status: decision,
        reviewedById: user.id,
        reviewedAt: new Date(),
        rejectionReason: reason,
      },
    });
    if (count === 0) {
      return NextResponse.json({ error: ALREADY_REVIEWED_MESSAGE }, { status: 409 });
    }

    const aprovou = decision === 'APPROVED';
    await registrarAuditoriaDepois(prisma, {
      ator: user,
      origem: origemDaRequisicao(req),
      acao: aprovou ? 'comprovante.aprovar' : 'comprovante.recusar',
      entidade: 'comprovante',
      entidadeId: proof.id,
      resumo: `Comprovante de entrega ${aprovou ? 'aprovado' : 'recusado'}`,
      antes: { status: 'SUBMITTED' },
      depois: { status: decision, rejectionReason: reason ?? null, cargaId: collectionId },
    });

    return NextResponse.json({ success: true, collectionId, proofId: proof.id, status: decision });
  } catch (error) {
    console.error('Erro ao conferir comprovante:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
