import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import prisma from '@/lib/prisma';

export async function GET() {
  const { error } = await requireStaff(["ADMIN"]);
  if (error) return error;

  try {
    const transactions = await prisma.financialTransaction.findMany({
      orderBy: { createdAt: 'desc' }
    });
    return NextResponse.json(transactions);
  } catch (error) {
    console.error('Error fetching transactions:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const { error } = await requireStaff(["ADMIN"]);
  if (error) return error;

  try {
    const data = await req.json();
    
    if (!data.type || !data.amount || !data.description) {
      return NextResponse.json({ error: 'Campos obrigatórios faltando.' }, { status: 400 });
    }

    const newTransaction = await prisma.financialTransaction.create({
      data: {
        type: data.type,
        amount: parseFloat(data.amount),
        description: data.description,
        dueDate: data.dueDate ? new Date(data.dueDate) : null,
        status: data.status || 'PENDING',
        clientId: data.clientId || null,
      }
    });

    return NextResponse.json(newTransaction, { status: 201 });
  } catch (error) {
    console.error('Error creating transaction:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
