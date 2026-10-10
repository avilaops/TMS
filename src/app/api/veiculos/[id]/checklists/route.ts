import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import prisma from '@/lib/prisma';
import { firstIssue } from '@/lib/usuarios';
import { CHECKLIST_SELECT, createChecklistSchema } from '@/lib/frota';
import { acharVeiculo, veiculoNaoEncontrado } from '@/lib/frota-db';

/** Quantos checklists a lista devolve: os mais recentes. */
const LIMITE = 50;

/** Checklists do veículo, do mais recente para o mais antigo, feitos no painel ou pelo motorista no app. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireStaff();
  if (error) return error;

  try {
    const { id } = await params;
    if (!(await acharVeiculo(id))) return veiculoNaoEncontrado();

    const checklists = await prisma.vehicleChecklist.findMany({
      where: { vehicleId: id },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      take: LIMITE,
      select: CHECKLIST_SELECT,
    });
    return NextResponse.json(checklists);
  } catch (error) {
    console.error('Erro ao buscar checklists:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

/** Registra um checklist pelo painel. Quem fez é o usuário logado; a data é a de agora. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireStaff();
  if (error) return error;

  try {
    const { id } = await params;
    const parsed = createChecklistSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const data = parsed.data;

    if (!(await acharVeiculo(id))) return veiculoNaoEncontrado();

    const checklist = await prisma.vehicleChecklist.create({
      data: { vehicleId: id, userId: user.id, items: data.items, odometer: data.odometer ?? null, notes: data.notes ?? null },
      select: CHECKLIST_SELECT,
    });

    return NextResponse.json(checklist, { status: 201 });
  } catch (error) {
    console.error('Erro ao registrar checklist:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
