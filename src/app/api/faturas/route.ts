import { NextResponse } from 'next/server';
import prisma, { empresaAtual, transacao } from '@/lib/prisma';
import { requireStaff } from '@/lib/staff';
import { Refusal } from '@/lib/cadastros';
import { firstIssue } from '@/lib/usuarios';
import { FATURAVEL, INVOICE_SELECT, centavos, createInvoiceSchema, descricaoDoLancamento } from '@/lib/faturas';

// Faturamento é financeiro: só o administrador, como em /api/financeiro.

export async function GET() {
  const { error } = await requireStaff(['ADMIN']);
  if (error) return error;

  try {
    const faturas = await prisma.invoice.findMany({ orderBy: { number: 'desc' }, select: INVOICE_SELECT });
    return NextResponse.json(faturas);
  } catch (error) {
    console.error('Erro ao listar faturas:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const { error } = await requireStaff(['ADMIN']);
  if (error) return error;

  try {
    const parsed = createInvoiceSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const data = parsed.data;
    const ids = [...new Set(data.collectionIds)];
    const tenantId = await empresaAtual();

    const fatura = await transacao(async (tx) => {
      const cliente = await tx.client.findUnique({ where: { id: data.clientId }, select: { id: true } });
      if (!cliente) throw new Refusal('Cliente não encontrado.', 400);

      // Uma emissão por vez na empresa: é o que mantém a numeração sem buraco
      // nem repetição. A trava some no fim da transação.
      // `::text` porque a função devolve `void`, que o adaptador do banco não sabe ler.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${'tms:fatura:' + tenantId}))::text`;

      // Trava as cargas: duas faturas simultâneas com a mesma carga disputam
      // estas linhas, e a segunda já as encontra faturadas.
      await tx.$queryRaw`SELECT id FROM "Collection" WHERE id = ANY(${ids}) FOR UPDATE`;

      const cargas = await tx.collection.findMany({
        where: { id: { in: ids }, clientId: data.clientId, ...FATURAVEL },
        select: { id: true, freightValue: true },
      });
      if (cargas.length !== ids.length) {
        throw new Refusal(
          'Alguma carga escolhida não pode ser faturada: precisa ser deste cliente, estar entregue, ter frete definido e não estar em outra fatura. Atualize a lista e tente de novo.',
          409,
        );
      }

      const total = centavos(cargas.reduce((soma, carga) => soma + (carga.freightValue ?? 0), 0));
      const ultima = await tx.invoice.findFirst({ orderBy: { number: 'desc' }, select: { number: true } });
      const number = (ultima?.number ?? 0) + 1;

      const criada = await tx.invoice.create({
        data: { number, clientId: data.clientId, total, dueDate: data.dueDate, notes: data.notes ?? null },
        select: { id: true },
      });

      await tx.collection.updateMany({ where: { id: { in: ids } }, data: { invoiceId: criada.id } });

      // O lançamento a receber: é ele que aparece no financeiro e no portal do cliente.
      await tx.financialTransaction.create({
        data: {
          type: 'INCOME',
          amount: total,
          description: descricaoDoLancamento(number, cargas.length),
          dueDate: data.dueDate,
          status: 'PENDING',
          clientId: data.clientId,
          invoiceId: criada.id,
        },
      });

      return tx.invoice.findUniqueOrThrow({ where: { id: criada.id }, select: INVOICE_SELECT });
    });

    return NextResponse.json(fatura, { status: 201 });
  } catch (err) {
    if (err instanceof Refusal) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('Erro ao emitir fatura:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
