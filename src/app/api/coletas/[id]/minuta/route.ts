import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import prisma, { empresaAtual } from '@/lib/prisma';
import { MINUTA_NAO_ENCONTRADA, MINUTA_SELECT, montarMinuta, verFreteNaMinuta } from '@/lib/minuta';

/**
 * A minuta de despacho da carga, pronta para a folha de impressão
 * (/dashboard/coletas/[id]/minuta): a carga, a viagem, as notas e o nome e o
 * símbolo da empresa. Quem lê cargas lê a minuta; o frete segue a regra de
 * `verFreteNaMinuta`. Carga de outra empresa não existe para esta sessão.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireStaff({ pode: 'coletasVer' });
  if (error) return error;

  try {
    const { id } = await params;

    const carga = await prisma.collection.findFirst({ where: { id }, select: MINUTA_SELECT });
    if (!carga) return NextResponse.json({ error: MINUTA_NAO_ENCONTRADA }, { status: 404 });

    // A empresa só lê o próprio cadastro (prisma/sql/010-rls.sql).
    const empresa = await prisma.tenant.findUnique({ where: { id: await empresaAtual() }, select: { name: true, logo: true } });
    if (!empresa) return NextResponse.json({ error: 'Empresa não encontrada.' }, { status: 404 });

    return NextResponse.json(montarMinuta(carga, empresa, { verFrete: verFreteNaMinuta(user.role), agora: new Date() }));
  } catch (error) {
    console.error('Erro ao montar a minuta de despacho:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
