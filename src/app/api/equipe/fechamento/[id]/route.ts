import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import prisma, { empresaAtual, transacao } from '@/lib/prisma';
import { Refusal } from '@/lib/cadastros';
import { nomeDaPessoa } from '@/lib/equipe';
import { CLOSING_ALREADY_PAID, CLOSING_NOT_FOUND, type ReciboDoFechamento, contaCongelada, lerDetalhes, mesPorExtenso } from '@/lib/remuneracao';
import { CLOSING_SELECT } from '@/lib/remuneracao-db';
import { origemDaRequisicao, registrarAuditoria } from '@/lib/auditoria';

const DA_PESSOA = {
  driver: { select: { cpf: true, user: { select: { name: true } } } },
  helper: { select: { name: true, cpf: true } },
} as const;

/**
 * O demonstrativo de um fechamento, para a folha de impressão: a empresa, a
 * pessoa (nome e CPF), o mês, as viagens com dias, km, entregas, frete e o
 * valor de cada forma, os adiantamentos descontados e o saldo. Tudo como foi
 * CONGELADO no fechamento, não a conta de hoje. Fechamento de outra empresa é
 * 404, como um id inventado. Dinheiro: `equipeValoresVer`.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireStaff({ pode: 'equipeValoresVer' });
  if (error) return error;

  try {
    const { id } = await params;
    const fechamento = await prisma.crewPayClosing.findUnique({ where: { id }, select: { ...CLOSING_SELECT, ...DA_PESSOA } });
    if (!fechamento) return NextResponse.json({ error: CLOSING_NOT_FOUND }, { status: 404 });
    const empresa = await prisma.tenant.findUnique({ where: { id: await empresaAtual() }, select: { name: true, logo: true } });

    const recibo: ReciboDoFechamento = {
      empresa: { name: empresa?.name ?? '', logo: empresa?.logo ?? null },
      emitidoEm: new Date().toISOString(),
      pessoa: {
        tipo: fechamento.driverId ? 'motorista' : 'ajudante',
        nome: nomeDaPessoa(fechamento),
        cpf: fechamento.driver?.cpf ?? fechamento.helper?.cpf ?? '',
      },
      mes: fechamento.month,
      fechadoEm: fechamento.closedAt.toISOString(),
      fechadoPor: fechamento.closedByName,
      formas: lerDetalhes(fechamento.details).formas,
      conta: contaCongelada(fechamento),
    };
    return NextResponse.json(recibo);
  } catch (error) {
    console.error('Erro ao montar o demonstrativo do fechamento:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

/**
 * Reabre o mês: apaga o fechamento e, na mesma transação, desfaz o lançamento
 * que ele fez no Financeiro. Só enquanto o lançamento está em aberto: se já foi
 * pago por lá, a reabertura é recusada (409) com o aviso de reabri-lo antes —
 * dinheiro que saiu não some em silêncio. O que estava fechado fica na
 * auditoria. Só o administrador (`equipeFechamento`).
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireStaff({ pode: 'equipeFechamento' });
  if (error) return error;

  try {
    const { id } = await params;
    const origem = origemDaRequisicao(req);

    await transacao(async (tx) => {
      // Duas reaberturas ao mesmo tempo: a segunda espera e não encontra mais o fechamento.
      await tx.$queryRaw`SELECT id FROM "CrewPayClosing" WHERE id = ${id} FOR UPDATE`;
      const fechamento = await tx.crewPayClosing.findUnique({ where: { id }, select: { ...CLOSING_SELECT, ...DA_PESSOA } });
      if (!fechamento) throw new Refusal(CLOSING_NOT_FOUND, 404);

      if (fechamento.transactionId) {
        // Segura o lançamento: quem o estiver pagando no Financeiro agora espera, ou chega antes e a reabertura é recusada aqui.
        await tx.$queryRaw`SELECT id FROM "FinancialTransaction" WHERE id = ${fechamento.transactionId} FOR UPDATE`;
        const lancamento = await tx.financialTransaction.findUnique({ where: { id: fechamento.transactionId }, select: { status: true } });
        if (lancamento?.status === 'PAID') throw new Refusal(CLOSING_ALREADY_PAID, 409);
      }

      await tx.crewPayClosing.delete({ where: { id } });
      if (fechamento.transactionId) await tx.financialTransaction.deleteMany({ where: { id: fechamento.transactionId } });

      await registrarAuditoria(tx, {
        ator: user,
        origem,
        acao: 'fechamento-equipe.reabrir',
        entidade: 'fechamento-equipe',
        entidadeId: id,
        resumo: `Remuneração variável de ${nomeDaPessoa(fechamento)} em ${mesPorExtenso(fechamento.month)} reaberta${fechamento.transactionId ? ', com o lançamento do Financeiro desfeito' : ''}`,
        antes: {
          driverId: fechamento.driverId,
          helperId: fechamento.helperId,
          month: fechamento.month,
          variableTotal: fechamento.variableTotal,
          advancesTotal: fechamento.advancesTotal,
          balance: fechamento.balance,
          transactionId: fechamento.transactionId,
        },
      });
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Refusal) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('Erro ao reabrir o mês da equipe:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
