import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { requireStaff } from '@/lib/staff';
import prisma, { transacao } from '@/lib/prisma';
import { Refusal, isUniqueViolation } from '@/lib/cadastros';
import { firstIssue } from '@/lib/usuarios';
import { PERSON_NOT_FOUND } from '@/lib/equipe';
import { diaNoBrasil } from '@/lib/financeiro';
import {
  ALREADY_CLOSED,
  CATEGORIA_DA_REMUNERACAO,
  FUTURE_MONTH,
  MES_MESSAGE,
  NOTHING_TO_CLOSE,
  type DetalhesDoFechamento,
  descricaoDoFechamento,
  fecharMesSchema,
  mesAtual,
  mesPorExtenso,
  mesValido,
  valorALancar,
} from '@/lib/remuneracao';
import { CLOSING_SELECT, contaDaPessoa, fechamentoDoMes, fechamentoParaATela } from '@/lib/remuneracao-db';
import { origemDaRequisicao, registrarAuditoria } from '@/lib/auditoria';

const centavos = (valor: number) => Math.round((valor + Number.EPSILON) * 100) / 100;

/**
 * O fechamento mensal da remuneração variável (`?mes=AAAA-MM`; sem ele, o mês
 * corrente): por motorista e por ajudante, as viagens finalizadas no mês com a
 * apuração de cada uma, o total do variável, os adiantamentos e vales em
 * aberto do mês e o saldo. Mês já fechado vem também com os valores
 * congelados e a diferença para a conta de hoje. Só leitura; as contas estão em
 * src/lib/remuneracao.ts.
 *
 * É dinheiro: só quem lê os valores da equipe (`equipeValoresVer`).
 */
export async function GET(req?: Request) {
  const { error } = await requireStaff({ pode: 'equipeValoresVer' });
  if (error) return error;

  try {
    const mes = (req ? new URL(req.url).searchParams.get('mes') : null) ?? mesAtual();
    if (!mesValido(mes)) return NextResponse.json({ error: MES_MESSAGE }, { status: 400 });

    const pessoas = await fechamentoDoMes(prisma, mes);
    // O total do mês: o fechado vale pelo que foi congelado; o aberto, pela conta de hoje.
    const total = pessoas.reduce(
      (soma, pessoa) => {
        const conta = pessoa.fechamento?.conta ?? pessoa.atual;
        return { variavel: soma.variavel + conta.variavel, adiantado: soma.adiantado + conta.adiantado, saldo: soma.saldo + conta.saldo };
      },
      { variavel: 0, adiantado: 0, saldo: 0 },
    );

    return NextResponse.json({ mes, pessoas, total: { variavel: centavos(total.variavel), adiantado: centavos(total.adiantado), saldo: centavos(total.saldo) } });
  } catch (error) {
    console.error('Erro ao montar o fechamento da equipe:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

/**
 * Fecha o mês de uma pessoa: grava o fechamento com os valores congelados (o
 * variável, os adiantamentos descontados, o saldo, cada viagem e cada
 * adiantamento como estavam) e quem fechou e, na mesma transação, lança a
 * despesa no Financeiro (categoria "Remuneração variável", a pessoa como
 * contraparte), como o adiantamento e o pagamento de frete contratado fazem: ou
 * ficam os dois, ou nenhum.
 *
 * O lançamento é o SALDO A PAGAR (variável − adiantamentos em aberto do mês):
 * o adiantamento já virou despesa quando foi entregue. Sem saldo a pagar o mês
 * fecha sem lançamento. Um fechamento por pessoa e mês: fechar de novo é 409.
 * Só o administrador (`equipeFechamento`).
 */
export async function POST(req: Request) {
  const { user, error } = await requireStaff({ pode: 'equipeFechamento' });
  if (error) return error;

  try {
    const parsed = fecharMesSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    const { pessoa, mes } = parsed.data;
    if (mes > mesAtual()) return NextResponse.json({ error: FUTURE_MONTH }, { status: 400 });
    const origem = origemDaRequisicao(req);

    const fechamento = await transacao(async (tx) => {
      // Dois fechamentos ao mesmo tempo: o segundo espera na linha da pessoa e encontra o mês já fechado.
      if (pessoa.driverId) await tx.$queryRaw`SELECT id FROM "Driver" WHERE id = ${pessoa.driverId} FOR UPDATE`;
      else await tx.$queryRaw`SELECT id FROM "Helper" WHERE id = ${pessoa.helperId} FOR UPDATE`;

      // Pessoa de outra empresa não existe para esta consulta: 400, como um id inventado.
      const apurado = await contaDaPessoa(tx, pessoa, mes);
      if (!apurado) throw new Refusal(PERSON_NOT_FOUND, 400);

      const dela = pessoa.driverId ? { driverId: pessoa.driverId } : { helperId: pessoa.helperId };
      if (await tx.crewPayClosing.findFirst({ where: { ...dela, month: mes }, select: { id: true } })) throw new Refusal(ALREADY_CLOSED, 409);

      const { conta, nome, formas } = apurado;
      if (conta.viagens.length === 0 && conta.adiantamentos.length === 0) throw new Refusal(NOTHING_TO_CLOSE, 409);

      const aLancar = valorALancar(conta);
      const lancamento =
        aLancar > 0
          ? await tx.financialTransaction.create({
              data: {
                type: 'EXPENSE',
                amount: aLancar,
                description: descricaoDoFechamento(mes, nome),
                // Vence no dia do fechamento (relógio do Brasil): dia do calendário, gravado à meia-noite UTC.
                dueDate: new Date(`${diaNoBrasil(new Date())}T00:00:00.000Z`),
                status: 'PENDING',
                category: CATEGORIA_DA_REMUNERACAO,
                counterparty: nome,
              },
              select: { id: true },
            })
          : null;

      const detalhes: DetalhesDoFechamento = { formas, viagens: conta.viagens, adiantamentos: conta.adiantamentos };
      const criado = await tx.crewPayClosing.create({
        data: {
          ...dela,
          month: mes,
          variableTotal: conta.variavel,
          advancesTotal: conta.adiantado,
          balance: conta.saldo,
          details: detalhes as unknown as Prisma.InputJsonValue,
          closedById: user.id,
          closedByName: user.name,
          transactionId: lancamento?.id ?? null,
        },
        select: CLOSING_SELECT,
      });

      await registrarAuditoria(tx, {
        ator: user,
        origem,
        acao: 'fechamento-equipe.fechar',
        entidade: 'fechamento-equipe',
        entidadeId: criado.id,
        resumo: `Remuneração variável de ${nome} em ${mesPorExtenso(mes)} fechada${lancamento ? ', com o lançamento no Financeiro' : ', sem saldo a pagar'}`,
        depois: { ...dela, month: mes, variableTotal: conta.variavel, advancesTotal: conta.adiantado, balance: conta.saldo, viagens: conta.viagens.length, transactionId: lancamento?.id ?? null },
      });

      return criado;
    });

    return NextResponse.json(fechamentoParaATela(fechamento), { status: 201 });
  } catch (err) {
    if (err instanceof Refusal) return NextResponse.json({ error: err.message }, { status: err.status });
    // Dois fechamentos simultâneos que passaram da conferência: o segundo bate no índice único.
    if (isUniqueViolation(err)) return NextResponse.json({ error: ALREADY_CLOSED }, { status: 409 });
    console.error('Erro ao fechar o mês da equipe:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
