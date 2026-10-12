import { NextResponse } from 'next/server';
import { transacao } from '@/lib/prisma';
import { requireStaff } from '@/lib/staff';
import { Refusal } from '@/lib/cadastros';
import {
  CAMPOS_DO_PAGAMENTO,
  CONTRACT_SELECT,
  PAYMENT_ALREADY_PAID,
  PAYMENT_NOT_FOUND,
  PAYMENT_SELECT,
  baseDaViagem,
  rotuloDoPagamento,
  situacaoDoContrato,
  totalPago,
  valoresDoContrato,
} from '@/lib/frete-contratado';
import { VIAGEM_DO_FRETE_SELECT, contratoComContas } from '@/lib/frete-contratado-db';
import { ManifestError, lockManifest } from '@/lib/manifestos-db';
import { codigoDaViagem } from '@/lib/viagem';
import { escolher, origemDaRequisicao, registrarAuditoria } from '@/lib/auditoria';

/**
 * Exclui (estorna) um pagamento do contrato de frete e, na mesma transação,
 * desfaz o lançamento que ele criou no Financeiro. Só enquanto o lançamento
 * está em aberto: se já foi pago por lá, a exclusão é recusada (409) com o
 * aviso de reabri-lo antes — dinheiro que saiu não some em silêncio. Pagamento
 * de outra viagem é 404, como o que não existe.
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string; registroId: string }> }) {
  const { user, error } = await requireStaff({ pode: 'freteContratado' });
  if (error) return error;

  try {
    const { id: manifestId, registroId } = await params;
    const origem = origemDaRequisicao(req);

    const contrato = await transacao(async (tx) => {
      await lockManifest(tx, manifestId);
      const pagamento = await tx.freightPayment.findFirst({
        where: { id: registroId, contract: { manifestId } },
        select: { ...PAYMENT_SELECT, contractId: true },
      });
      if (!pagamento) throw new Refusal(PAYMENT_NOT_FOUND, 404);

      if (pagamento.transactionId) {
        // Segura o lançamento: quem o estiver pagando no Financeiro agora espera, ou chega antes e a exclusão é recusada aqui.
        await tx.$queryRaw`SELECT id FROM "FinancialTransaction" WHERE id = ${pagamento.transactionId} FOR UPDATE`;
        const lancamento = await tx.financialTransaction.findUnique({ where: { id: pagamento.transactionId }, select: { status: true } });
        if (lancamento?.status === 'PAID') throw new Refusal(PAYMENT_ALREADY_PAID, 409);
      }

      await tx.freightPayment.delete({ where: { id: registroId } });
      if (pagamento.transactionId) await tx.financialTransaction.deleteMany({ where: { id: pagamento.transactionId } });

      const restante = await tx.freightContract.findUniqueOrThrow({ where: { id: pagamento.contractId }, select: CONTRACT_SELECT });
      const status = situacaoDoContrato({ cancelado: restante.status === 'CANCELADO', liquido: valoresDoContrato(restante).liquido, pago: totalPago(restante.payments) });
      const atualizado = await tx.freightContract.update({ where: { id: restante.id }, data: { status }, select: CONTRACT_SELECT });

      await registrarAuditoria(tx, {
        ator: user,
        origem,
        acao: 'frete-contratado.estornar',
        entidade: 'frete-contratado',
        entidadeId: restante.id,
        resumo: `${rotuloDoPagamento(pagamento.kind)} de frete da viagem #${codigoDaViagem(manifestId)} para ${restante.carrier.name} excluído, com o lançamento do Financeiro`,
        antes: { ...escolher(pagamento, CAMPOS_DO_PAGAMENTO), status: restante.status },
        depois: { status: atualizado.status },
      });

      const viagem = await tx.manifest.findUniqueOrThrow({ where: { id: manifestId }, select: VIAGEM_DO_FRETE_SELECT });
      return contratoComContas(atualizado, baseDaViagem(viagem));
    });

    return NextResponse.json(contrato);
  } catch (err) {
    if (err instanceof Refusal || err instanceof ManifestError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('Erro ao excluir pagamento de frete contratado:', err);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
