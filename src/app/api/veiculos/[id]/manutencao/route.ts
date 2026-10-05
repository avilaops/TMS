import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import prisma from '@/lib/prisma';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { error } = await requireStaff();
  if (error) return error;

  try {
    const maintenances = await prisma.maintenance.findMany({
      where: { vehicleId: id },
      orderBy: { date: 'desc' }
    });

    return NextResponse.json(maintenances);
  } catch (error) {
    console.error('Error fetching maintenances:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { error } = await requireStaff();
  if (error) return error;

  try {
    const data = await req.json();
    
    if (!data.description || !data.cost || !data.date) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Usamos transação para garantir que ambas as operações funcionem juntas
    const result = await prisma.$transaction(async (tx) => {
      // 1. Cria a manutenção
      const maintenance = await tx.maintenance.create({
        data: {
          vehicleId: id,
          description: data.description,
          cost: parseFloat(data.cost),
          date: new Date(data.date),
          status: data.status || 'SCHEDULED'
        }
      });

      // 2. Cria a despesa no módulo financeiro
      await tx.financialTransaction.create({
        data: {
          type: 'EXPENSE',
          amount: parseFloat(data.cost),
          description: `Manutenção: ${data.description} (Veículo ID: ${id.substring(0, 8)})`,
          dueDate: new Date(data.date),
          status: 'PENDING'
        }
      });

      return maintenance;
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    console.error('Error creating maintenance:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
