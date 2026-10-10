import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import prisma from '@/lib/prisma';
import { firstIssue } from '@/lib/usuarios';
import { TRANSACTION_SELECT, createTransactionSchema, situacaoDoLancamento, type Situacao } from '@/lib/financeiro';
import { CAMPOS_DO_LANCAMENTO, escolher, origemDaRequisicao, registrarAuditoriaDepois } from '@/lib/auditoria';

const SITUACOES: readonly Situacao[] = ['pago', 'vencido', 'aberto'];

/**
 * Lançamentos do financeiro. Filtros opcionais na query: `tipo` (INCOME ou
 * EXPENSE), `situacao` (aberto, vencido ou pago), `de`/`ate` (AAAA-MM-DD, pelo
 * vencimento) e `centro` (o centro de custo, sem diferenciar maiúsculas). Sem
 * filtro devolve tudo, do mais novo para o mais antigo.
 */
export async function GET(req?: Request) {
  const { error } = await requireStaff(["ADMIN"]);
  if (error) return error;

  try {
    const query = req ? new URL(req.url).searchParams : new URLSearchParams();
    const tipo = query.get('tipo');
    const situacao = query.get('situacao');
    const de = query.get('de');
    const ate = query.get('ate');
    const centro = query.get('centro')?.trim();

    const dia = (valor: string | null) => (valor && /^\d{4}-\d{2}-\d{2}$/.test(valor) ? new Date(`${valor}T00:00:00.000Z`) : null);
    const inicio = dia(de);
    const fim = dia(ate);

    const transactions = await prisma.financialTransaction.findMany({
      where: {
        ...(tipo === 'INCOME' || tipo === 'EXPENSE' ? { type: tipo } : {}),
        ...(centro ? { costCenter: { equals: centro, mode: 'insensitive' as const } } : {}),
        ...(inicio || fim
          ? { dueDate: { ...(inicio && { gte: inicio }), ...(fim && { lte: fim }) } }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: TRANSACTION_SELECT,
    });

    // "Vencido" depende do dia de hoje, não só do banco: o filtro é feito aqui.
    const filtradas = SITUACOES.includes(situacao as Situacao)
      ? transactions.filter((t) => situacaoDoLancamento(t) === situacao)
      : transactions;

    return NextResponse.json(filtradas);
  } catch (error) {
    console.error('Error fetching transactions:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const { user, error } = await requireStaff(["ADMIN"]);
  if (error) return error;

  try {
    const parsed = createTransactionSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const { status, paidAt, paymentMethod, ...data } = parsed.data;

    if (data.clientId) {
      const cliente = await prisma.client.findUnique({ where: { id: data.clientId }, select: { id: true } });
      if (!cliente) return NextResponse.json({ error: 'Cliente não encontrado.' }, { status: 400 });
    }

    const pago = status === 'PAID';
    const newTransaction = await prisma.financialTransaction.create({
      data: {
        ...data,
        clientId: data.clientId ?? null,
        dueDate: data.dueDate ?? null,
        status: pago ? 'PAID' : 'PENDING',
        // Já nasce pago: sem data informada, vale agora. Em aberto não guarda pagamento.
        paidAt: pago ? (paidAt ?? new Date()) : null,
        paymentMethod: pago ? (paymentMethod ?? null) : null,
      },
      select: TRANSACTION_SELECT,
    });

    await registrarAuditoriaDepois(prisma, {
      ator: user,
      origem: origemDaRequisicao(req),
      acao: 'lancamento.criar',
      entidade: 'lancamento',
      entidadeId: newTransaction.id,
      resumo: `Lançamento "${newTransaction.description}" criado (${newTransaction.type === 'INCOME' ? 'a receber' : 'a pagar'})`,
      depois: escolher(newTransaction, CAMPOS_DO_LANCAMENTO),
    });

    return NextResponse.json(newTransaction, { status: 201 });
  } catch (error) {
    console.error('Error creating transaction:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
