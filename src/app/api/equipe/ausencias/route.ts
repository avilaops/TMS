import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import prisma, { transacao } from '@/lib/prisma';
import { Refusal } from '@/lib/cadastros';
import { firstIssue } from '@/lib/usuarios';
import { ABSENCE_SELECT, CAMPOS_DA_AUSENCIA, PERSON_NOT_FOUND, createAbsenceSchema, rotuloDaAusencia } from '@/lib/equipe';
import { nomeDe } from '@/lib/equipe-db';
import { escolher, origemDaRequisicao, registrarAuditoria } from '@/lib/auditoria';

// A lista não pagina: as mais recentes bastam para a tela, e o filtro por dia resolve o resto.
const LIMITE = 300;

const DIA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Ausências da equipe, da mais recente para a mais antiga. Com `?dia=AAAA-MM-DD`
 * vêm só as que cobrem aquele dia: é o que a montagem de viagem pergunta para
 * avisar que o motorista escolhido está ausente.
 */
export async function GET(req?: Request) {
  const { error } = await requireStaff();
  if (error) return error;

  try {
    const pedido = req ? new URL(req.url).searchParams.get('dia') : null;
    if (pedido !== null && (!DIA.test(pedido) || Number.isNaN(Date.parse(`${pedido}T00:00:00.000Z`)))) {
      return NextResponse.json({ error: 'Dia inválido. Use AAAA-MM-DD.' }, { status: 400 });
    }
    const dia = pedido ? new Date(`${pedido}T00:00:00.000Z`) : null;

    const ausencias = await prisma.absence.findMany({
      where: dia ? { startDate: { lte: dia }, endDate: { gte: dia } } : {},
      select: ABSENCE_SELECT,
      orderBy: [{ startDate: 'desc' }, { id: 'desc' }],
      take: LIMITE,
    });
    return NextResponse.json(ausencias);
  } catch (error) {
    console.error('Erro ao listar ausências:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const { user, error } = await requireStaff();
  if (error) return error;

  try {
    const parsed = createAbsenceSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const data = parsed.data;
    const pessoa = { driverId: data.driverId ?? null, helperId: data.helperId ?? null };
    const origem = origemDaRequisicao(req);

    const ausencia = await transacao(async (tx) => {
      const nome = await nomeDe(tx, pessoa);
      if (!nome) throw new Refusal(PERSON_NOT_FOUND, 400);

      const criada = await tx.absence.create({
        data: { ...pessoa, type: data.type, startDate: data.startDate, endDate: data.endDate, notes: data.notes ?? null },
        select: ABSENCE_SELECT,
      });

      await registrarAuditoria(tx, {
        ator: user,
        origem,
        acao: 'ausencia.registrar',
        entidade: 'ausencia',
        entidadeId: criada.id,
        resumo: `Ausência de ${nome} registrada (${rotuloDaAusencia(criada.type)})`,
        depois: escolher(criada, CAMPOS_DA_AUSENCIA),
      });

      return criada;
    });

    return NextResponse.json(ausencia, { status: 201 });
  } catch (err) {
    if (err instanceof Refusal) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('Erro ao registrar ausência:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
