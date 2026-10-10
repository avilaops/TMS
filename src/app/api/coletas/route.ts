import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import prisma from '@/lib/prisma';
import { COLLECTION_INCLUDE, JANELA_INVERTIDA, createCollectionSchema, janelaInvertida } from '@/lib/coletas';
import { criarColetaConfirmada, recusaDaColetaNova } from '@/lib/coletas-db';
import { firstIssue } from '@/lib/usuarios';
import { withTrackingCode } from '@/lib/tracking';
import { CAMPOS_DA_COLETA, escolher, origemDaRequisicao, registrarAuditoriaDepois } from '@/lib/auditoria';

export async function GET() {
  const { error } = await requireStaff();
  if (error) return error;

  try {
    const coletas = await prisma.collection.findMany({
      include: COLLECTION_INCLUDE,
      orderBy: { createdAt: 'desc' }
    });
    return NextResponse.json(coletas);
  } catch (error) {
    console.error('Error fetching collections:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const { user, error } = await requireStaff();
  if (error) return error;

  try {
    const parsed = createCollectionSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const data = parsed.data;
    if (janelaInvertida(data.pickupFrom, data.pickupTo)) {
      return NextResponse.json({ error: JANELA_INVERTIDA }, { status: 400 });
    }

    const recusa = await recusaDaColetaNova(prisma, data);
    if (recusa) return NextResponse.json({ error: recusa }, { status: 400 });

    // Toda coleta nasce com codigo: e ele, com o CNPJ, que abre o rastreio
    // publico. Uma coleta sem codigo simplesmente nao seria rastreavel.
    // O frete, o status e o histórico ficam em `criarColetaConfirmada`, que é o
    // mesmo caminho da carga criada a partir de uma NF-e.
    const newCollection = await withTrackingCode((trackingCode) => criarColetaConfirmada(prisma, data, user.id, trackingCode));

    await registrarAuditoriaDepois(prisma, {
      ator: user,
      origem: origemDaRequisicao(req),
      acao: 'coleta.criar',
      entidade: 'coleta',
      entidadeId: newCollection.id,
      resumo: `Carga ${newCollection.trackingCode ?? ''} criada para ${newCollection.receiver}`,
      depois: escolher(newCollection, CAMPOS_DA_COLETA),
    });

    return NextResponse.json(newCollection, { status: 201 });
  } catch (error) {
    console.error('Error creating collection:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
