import { NextResponse } from 'next/server';
import prisma, { transacao } from '@/lib/prisma';
import { requireStaff } from '@/lib/staff';
import { Refusal } from '@/lib/cadastros';
import { firstIssue } from '@/lib/usuarios';
import { OCCURRENCE_SELECT, contadoresPorStatus, createOccurrenceSchema, filtrosDaLista } from '@/lib/ocorrencias';
import { abrirOcorrencia } from '@/lib/ocorrencias-db';
import { origemDaRequisicao, registrarAuditoria } from '@/lib/auditoria';

/**
 * Chamados da empresa, do mais novo para o mais antigo, com os contadores por
 * status. Os filtros (`?status=&type=`) valem para a lista; os contadores são
 * sempre de todos os chamados, para o topo da tela não mudar ao filtrar.
 */
export async function GET(req: Request) {
  const { error } = await requireStaff({ pode: 'ocorrencias' });
  if (error) return error;

  try {
    const filtros = filtrosDaLista(new URL(req.url).searchParams);
    const ocorrencias = await prisma.occurrence.findMany({
      where: filtros,
      orderBy: { number: 'desc' },
      select: { ...OCCURRENCE_SELECT, _count: { select: { messages: true } } },
    });
    const porStatus = await prisma.occurrence.groupBy({ by: ['status'], _count: { _all: true } });

    return NextResponse.json({
      contadores: contadoresPorStatus(porStatus.map((linha) => ({ status: linha.status, total: linha._count._all }))),
      ocorrencias,
    });
  } catch (error) {
    console.error('Erro ao listar ocorrências:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

/**
 * Abre um chamado pela equipe. Com código de rastreio, o chamado fica ligado à
 * carga e ao cliente dono dela; sem carga, pode ser de um cliente ou só interno.
 */
export async function POST(req: Request) {
  const { user, error } = await requireStaff({ pode: 'ocorrencias' });
  if (error) return error;

  try {
    const parsed = createOccurrenceSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const data = parsed.data;
    const origem = origemDaRequisicao(req);

    const ocorrencia = await transacao(async (tx) => {
      const carga = data.trackingCode
        ? await tx.collection.findFirst({ where: { trackingCode: data.trackingCode }, select: { id: true, clientId: true } })
        : null;
      if (data.trackingCode && !carga) throw new Refusal('Nenhuma carga com este código de rastreio.', 400);
      if (carga && data.clientId && data.clientId !== carga.clientId) {
        throw new Refusal('Esta carga é de outro cliente. Deixe o cliente em branco ou confira o código.', 400);
      }

      if (!carga && data.clientId) {
        const cliente = await tx.client.findUnique({ where: { id: data.clientId }, select: { id: true } });
        if (!cliente) throw new Refusal('Cliente não encontrado.', 400);
      }

      const criada = await abrirOcorrencia(tx, {
        type: data.type,
        title: data.title,
        description: data.description,
        priority: data.priority,
        collectionId: carga?.id ?? null,
        clientId: carga?.clientId ?? data.clientId ?? null,
        openedById: user.id,
        origin: 'STAFF',
      });

      await registrarAuditoria(tx, {
        ator: user,
        origem,
        acao: 'ocorrencia.abrir',
        entidade: 'ocorrencia',
        entidadeId: criada.id,
        resumo: `Chamado nº ${criada.number} aberto: ${data.title}`,
        depois: {
          number: criada.number,
          type: data.type,
          title: data.title,
          priority: data.priority,
          clientId: carga?.clientId ?? data.clientId ?? null,
          trackingCode: data.trackingCode ?? null,
        },
      });
      return tx.occurrence.findUniqueOrThrow({ where: { id: criada.id }, select: OCCURRENCE_SELECT });
    });

    return NextResponse.json(ocorrencia, { status: 201 });
  } catch (err) {
    if (err instanceof Refusal) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('Erro ao abrir ocorrência:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
