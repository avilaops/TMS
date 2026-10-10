import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import prisma, { transacao } from '@/lib/prisma';
import { firstIssue } from '@/lib/usuarios';
import { createMaintenanceSchema } from '@/lib/frota';
import { acharVeiculo, veiculoNaoEncontrado } from '@/lib/frota-db';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { error } = await requireStaff({ pode: 'frotaVer' });
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
  const { error } = await requireStaff({ pode: 'frota' });
  if (error) return error;

  try {
    const parsed = createMaintenanceSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const data = parsed.data;

    if (!(await acharVeiculo(id))) return veiculoNaoEncontrado();

    // Usamos transação para garantir que ambas as operações funcionem juntas
    const result = await transacao(async (tx) => {
      // 1. Cria a manutenção
      const maintenance = await tx.maintenance.create({
        data: {
          vehicleId: id,
          description: data.description,
          cost: data.cost,
          date: data.date,
          status: data.status ?? 'SCHEDULED',
          kind: data.kind ?? null,
          odometer: data.odometer ?? null,
        }
      });

      // 2. Cria a despesa no módulo financeiro
      await tx.financialTransaction.create({
        data: {
          type: 'EXPENSE',
          amount: data.cost,
          description: `Manutenção: ${data.description} (Veículo ID: ${id.substring(0, 8)})`,
          dueDate: data.date,
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
