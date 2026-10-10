import { NextResponse } from 'next/server';
import prisma, { transacao } from '@/lib/prisma';
import { requirePortalClient } from '@/lib/portal';
import { Refusal } from '@/lib/cadastros';
import { firstIssue } from '@/lib/usuarios';
import { PORTAL_OCCURRENCE_SELECT, portalOccurrenceSchema } from '@/lib/ocorrencias';
import { abrirOcorrencia } from '@/lib/ocorrencias-db';
import { origemDaRequisicao, registrarAuditoria } from '@/lib/auditoria';

/**
 * Atendimento no portal: os chamados da empresa do cliente logado.
 *
 * O filtro por `clientId` é o que separa um cliente do outro dentro da mesma
 * transportadora. Entram os chamados que ele abriu e os que a transportadora
 * abriu em nome dele; chamado só interno (sem cliente) nunca aparece.
 */
export async function GET() {
  const { clientId, error } = await requirePortalClient();
  if (error) return error;

  try {
    const ocorrencias = await prisma.occurrence.findMany({
      where: { clientId },
      orderBy: { number: 'desc' },
      select: PORTAL_OCCURRENCE_SELECT,
    });
    return NextResponse.json(ocorrencias);
  } catch (error) {
    console.error('Erro ao listar atendimentos do portal:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

/** Abre um chamado. A carga é opcional e precisa ser uma das cargas deste cliente. */
export async function POST(req: Request) {
  const { clientId, userId, ator, error } = await requirePortalClient();
  if (error) return error;

  try {
    const origem = origemDaRequisicao(req);
    const parsed = portalOccurrenceSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const data = parsed.data;

    const ocorrencia = await transacao(async (tx) => {
      if (data.collectionId) {
        // Carga de outro cliente responde igual a carga que não existe.
        const carga = await tx.collection.findFirst({ where: { id: data.collectionId, clientId }, select: { id: true } });
        if (!carga) throw new Refusal('Carga não encontrada.', 400);
      }

      const criada = await abrirOcorrencia(tx, {
        type: data.type,
        title: data.title,
        description: data.description,
        collectionId: data.collectionId ?? null,
        clientId,
        openedById: userId,
        origin: 'CLIENT',
      });

      await registrarAuditoria(tx, {
        ator,
        origem,
        acao: 'ocorrencia.abrir',
        entidade: 'ocorrencia',
        entidadeId: criada.id,
        resumo: `Chamado nº ${criada.number} aberto pelo cliente no portal: ${data.title}`,
        depois: { number: criada.number, type: data.type, title: data.title, clientId, cargaId: data.collectionId ?? null },
      });
      return tx.occurrence.findUniqueOrThrow({ where: { id: criada.id }, select: PORTAL_OCCURRENCE_SELECT });
    });

    return NextResponse.json(ocorrencia, { status: 201 });
  } catch (err) {
    if (err instanceof Refusal) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('Erro ao abrir atendimento no portal:', err);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
