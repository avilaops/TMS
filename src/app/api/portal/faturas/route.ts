import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requirePortalClient } from '@/lib/portal';

export async function GET() {
  const { clientId, error } = await requirePortalClient();
  if (error) return error;

  try {
    const invoices = await prisma.financialTransaction.findMany({
      where: { type: 'INCOME', clientId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        amount: true,
        description: true,
        dueDate: true,
        status: true,
        createdAt: true,
      },
    });

    return NextResponse.json(invoices);
  } catch (error) {
    console.error('Error fetching portal invoices:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
