import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import prisma from '@/lib/prisma';

// O histórico é isolado pela sessão/tenant e jamais expõe documentos ou URLs R2.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireStaff({ pode: 'clientesVer' });
  if (error) return error;
  const { id } = await params;
  const client = await prisma.client.findUnique({ where: { id }, select: { id: true } });
  if (!client) return NextResponse.json({ error: 'Cliente não encontrado.' }, { status: 404 });
  const entregas = await prisma.documentDelivery.findMany({
    where: { clientId: id },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: { id: true, eventId: true, documentType: true, recipientEmail: true, status: true, attempts: true,
      errorMessage: true, createdAt: true, sentAt: true, deliveredAt: true },
  });
  return NextResponse.json({ entregas });
}
