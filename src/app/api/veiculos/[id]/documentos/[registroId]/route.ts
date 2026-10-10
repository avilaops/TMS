import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import prisma from '@/lib/prisma';
import { firstIssue } from '@/lib/usuarios';
import { DOCUMENT_SELECT, updateDocumentSchema } from '@/lib/frota';

const NOT_FOUND = 'Documento não encontrado.';

type Contexto = { params: Promise<{ id: string; registroId: string }> };

/** Altera o documento. Renovar é mandar o vencimento novo. */
export async function PATCH(req: Request, { params }: Contexto) {
  const { error } = await requireStaff({ pode: 'frota' });
  if (error) return error;

  try {
    const { id, registroId } = await params;
    const parsed = updateDocumentSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }

    const atual = await prisma.vehicleDocument.findFirst({ where: { id: registroId, vehicleId: id }, select: { id: true } });
    if (!atual) return NextResponse.json({ error: NOT_FOUND }, { status: 404 });

    // Campo ausente (`undefined`) fica como está; `null` apaga.
    const documento = await prisma.vehicleDocument.update({ where: { id: registroId }, data: parsed.data, select: DOCUMENT_SELECT });
    return NextResponse.json(documento);
  } catch (error) {
    console.error('Erro ao alterar documento do veículo:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: Contexto) {
  const { error } = await requireStaff({ pode: 'frota' });
  if (error) return error;

  try {
    const { id, registroId } = await params;
    const { count } = await prisma.vehicleDocument.deleteMany({ where: { id: registroId, vehicleId: id } });
    if (count === 0) return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Erro ao apagar documento do veículo:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
