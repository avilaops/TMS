import { NextResponse } from 'next/server';
import { transacao } from '@/lib/prisma';
import { requireStaff } from '@/lib/staff';
import { Refusal } from '@/lib/cadastros';
import { ALREADY_REVIEWED_MESSAGE, PROOF_NOT_FOUND_MESSAGE, conferenciaSchema } from '@/lib/entregas';
import { firstIssue } from '@/lib/usuarios';
import { origemDaRequisicao, registrarAuditoria } from '@/lib/auditoria';
import { avisar, avisoDeComprovanteDevolvido } from '@/lib/notificacoes';

/**
 * Aprova o comprovante de uma entrega ou devolve ao motorista. O `[id]` é o da
 * coleta, como na baixa do motorista e na página do comprovante.
 *
 * Aprovar é final. Devolver (`REJECTED`, com o motivo) não é: a devolução fica
 * registrada (quem, quando, por quê), o motorista é avisado pelo sininho e vê
 * o comprovante na lista "Comprovantes para refazer" do aplicativo; quando ele
 * manda fotos novas, o comprovante volta para a fila
 * (/api/driver/entregas/[id]/refazer).
 *
 * A conferência não mexe na coleta: ela segue entregue, com o mesmo recebedor
 * e sem linha nova no histórico de status.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { user, error } = await requireStaff({ pode: 'comprovantes' });
    if (error) return error;

    const collectionId = (await params).id;
    const origem = origemDaRequisicao(req);

    const parsed = conferenciaSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const { decision, reason } = parsed.data;

    const proofId = await transacao(async (tx) => {
      const proof = await tx.proofOfDelivery.findUnique({
        where: { collectionId },
        select: {
          id: true,
          collection: { select: { receiver: true, manifest: { select: { driver: { select: { userId: true } } } } } },
        },
      });
      if (!proof) throw new Refusal(PROOF_NOT_FOUND_MESSAGE, 404);

      // Grava só se o comprovante ainda aguarda conferência: de duas decisões
      // simultâneas, uma encontra zero linhas e recebe 409.
      const agora = new Date();
      const { count } = await tx.proofOfDelivery.updateMany({
        where: { collectionId, status: 'SUBMITTED' },
        data: { status: decision, reviewedById: user.id, reviewedAt: agora, rejectionReason: reason },
      });
      if (count === 0) throw new Refusal(ALREADY_REVIEWED_MESSAGE, 409);

      if (decision === 'REJECTED') {
        // `reason` nunca é nulo na devolução: o schema exige o motivo.
        const motivo = reason ?? '';
        await tx.proofRejection.create({
          data: { proofId: proof.id, reason: motivo, rejectedById: user.id, rejectedAt: agora },
          select: { id: true },
        });
        // Sininho do motorista da viagem. Carga sem viagem (dado antigo) não tem a quem avisar.
        await avisar(tx, {
          ...avisoDeComprovanteDevolvido({ id: collectionId, receiver: proof.collection.receiver }, motivo),
          para: proof.collection.manifest?.driver.userId,
          autor: user.id,
        });
      }

      const aprovou = decision === 'APPROVED';
      await registrarAuditoria(tx, {
        ator: user,
        origem,
        acao: aprovou ? 'comprovante.aprovar' : 'comprovante.recusar',
        entidade: 'comprovante',
        entidadeId: proof.id,
        resumo: `Comprovante de entrega ${aprovou ? 'aprovado' : 'devolvido ao motorista'}`,
        antes: { status: 'SUBMITTED' },
        depois: { status: decision, rejectionReason: reason ?? null, cargaId: collectionId },
      });
      return proof.id;
    });

    return NextResponse.json({ success: true, collectionId, proofId, status: decision });
  } catch (error) {
    if (error instanceof Refusal) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Erro ao conferir comprovante:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
