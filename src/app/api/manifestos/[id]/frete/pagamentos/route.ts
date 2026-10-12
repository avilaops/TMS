import { NextResponse } from 'next/server';
import prisma, { transacao } from '@/lib/prisma';
import { avisoDeCargasSemCte } from '@/lib/subcontratacao';
import { lerSubcontratacao } from '@/lib/subcontratacao-db';
import { requireStaff } from '@/lib/staff';
import { Refusal } from '@/lib/cadastros';
import { diaDoVencimento } from '@/lib/financeiro';
import { firstIssue } from '@/lib/usuarios';
import {
  CAMPOS_DO_PAGAMENTO,
  CATEGORIA_DO_FRETE_CONTRATADO,
  CONTRACT_CANCELLED,
  CONTRACT_NOT_FOUND,
  CONTRACT_SELECT,
  PAYMENT_SELECT,
  TRIP_CANCELLED_NO_CONTRACT,
  baseDaViagem,
  confirmacaoDoPagamento,
  descricaoDoPagamento,
  pagamentoSchema,
  rotuloDoPagamento,
  situacaoDoContrato,
  totalPago,
  valoresDoContrato,
  type Confirmacao,
} from '@/lib/frete-contratado';
import { VIAGEM_DO_FRETE_SELECT, contratoComContas } from '@/lib/frete-contratado-db';
import { ManifestError, lockManifest } from '@/lib/manifestos-db';
import { centroDeCustoDaViagem, codigoDaViagem } from '@/lib/viagem';
import { escolher, origemDaRequisicao, registrarAuditoria } from '@/lib/auditoria';

/** O pagamento precisa de um "sim" explícito: a resposta (409) diz qual campo mandar como `true`. */
class PedeConfirmacao extends Error {
  constructor(
    message: string,
    readonly confirmar: Confirmacao,
  ) {
    super(message);
  }
}

/**
 * Registra um pagamento do contrato de frete (adiantamento ou saldo) e, na
 * mesma transação, a despesa no Financeiro (categoria "Frete contratado", o
 * parceiro como contraparte e a viagem como centro de custo), como o
 * adiantamento da equipe e a manutenção fazem: ou ficam os dois, ou nenhum. O
 * lançamento nasce em aberto, vencendo no dia do pagamento; com `paid`, já
 * nasce pago, nesse dia e com a forma informada.
 *
 * Duas coisas pedem confirmação explícita (409 com `confirmar`): pagar mais que
 * o líquido (`pagarAcima`) e quitar o contrato antes de a viagem ser
 * finalizada (`pagarAntesDeFinalizar`). A situação do contrato sai dos
 * pagamentos: adiantado enquanto falta, quitado quando o líquido foi pago.
 *
 * Quitar o contrato de uma transportadora com carga sem CT-e dela registrado
 * não é bloqueado (a UF pode dispensar o CT-e da subcontratada): a resposta
 * leva `aviso` com as cargas.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireStaff({ pode: 'freteContratado' });
  if (error) return error;

  try {
    const manifestId = (await params).id;
    const parsed = pagamentoSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const data = parsed.data;
    const origem = origemDaRequisicao(req);

    const resposta = await transacao(async (tx) => {
      // Segura a viagem: dois pagamentos ao mesmo tempo correm um depois do outro, e o segundo já enxerga o primeiro.
      const manifesto = await lockManifest(tx, manifestId);
      if (manifesto.status === 'CANCELLED') throw new Refusal(TRIP_CANCELLED_NO_CONTRACT, 409);

      const contrato = await tx.freightContract.findUnique({ where: { manifestId }, select: CONTRACT_SELECT });
      if (!contrato) throw new Refusal(CONTRACT_NOT_FOUND, 404);
      if (contrato.status === 'CANCELADO') throw new Refusal(CONTRACT_CANCELLED, 409);

      const { liquido } = valoresDoContrato(contrato);
      const pago = totalPago(contrato.payments);
      const pede = confirmacaoDoPagamento({
        liquido,
        pago,
        valor: data.amount,
        viagemFinalizada: manifesto.status === 'FINISHED',
        pagarAcima: data.pagarAcima,
        pagarAntesDeFinalizar: data.pagarAntesDeFinalizar,
      });
      if (pede) throw new PedeConfirmacao(pede.mensagem, pede.confirmar);

      const paga = data.paid === true;
      const lancamento = await tx.financialTransaction.create({
        data: {
          type: 'EXPENSE',
          amount: data.amount,
          description: descricaoDoPagamento(data.kind, manifestId, contrato.carrier.name),
          dueDate: data.date,
          status: paga ? 'PAID' : 'PENDING',
          // Pago no dia informado: o meio-dia do Brasil mantém o lançamento no dia e no mês certos do fluxo de caixa.
          paidAt: paga ? new Date(`${diaDoVencimento(data.date)}T12:00:00-03:00`) : null,
          paymentMethod: paga ? data.method : null,
          category: CATEGORIA_DO_FRETE_CONTRATADO,
          costCenter: centroDeCustoDaViagem(manifestId),
          counterparty: contrato.carrier.name,
          notes: data.notes ?? null,
        },
        select: { id: true },
      });

      const pagamento = await tx.freightPayment.create({
        data: { contractId: contrato.id, kind: data.kind, date: data.date, amount: data.amount, method: data.method, notes: data.notes ?? null, transactionId: lancamento.id },
        select: PAYMENT_SELECT,
      });

      const atualizado = await tx.freightContract.update({
        where: { id: contrato.id },
        data: { status: situacaoDoContrato({ cancelado: false, liquido, pago: pago + data.amount }) },
        select: CONTRACT_SELECT,
      });

      await registrarAuditoria(tx, {
        ator: user,
        origem,
        acao: 'frete-contratado.pagar',
        entidade: 'frete-contratado',
        entidadeId: contrato.id,
        resumo: `${rotuloDoPagamento(data.kind)} de frete da viagem #${codigoDaViagem(manifestId)} para ${contrato.carrier.name}: lançamento ${paga ? 'pago' : 'a pagar'} no Financeiro`,
        antes: { status: contrato.status },
        depois: { ...escolher(pagamento, CAMPOS_DO_PAGAMENTO), status: atualizado.status },
      });

      const viagem = await tx.manifest.findUniqueOrThrow({ where: { id: manifestId }, select: VIAGEM_DO_FRETE_SELECT });
      return { pagamento, contrato: contratoComContas(atualizado, baseDaViagem(viagem)) };
    });

    // O pagamento já valeu. Se ele quitou o contrato de uma transportadora com carga sem CT-e dela, a resposta avisa (não bloqueia).
    const subcontratacao = resposta.contrato.status === 'QUITADO' ? await lerSubcontratacao(prisma, manifestId).catch(() => null) : null;
    return NextResponse.json({ ...resposta, aviso: subcontratacao ? avisoDeCargasSemCte(subcontratacao.semCte) : null }, { status: 201 });
  } catch (err) {
    if (err instanceof PedeConfirmacao) return NextResponse.json({ error: err.message, confirmar: err.confirmar }, { status: 409 });
    if (err instanceof Refusal || err instanceof ManifestError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('Erro ao registrar pagamento de frete contratado:', err);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
