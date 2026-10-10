import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import prisma, { transacao } from '@/lib/prisma';
import { Refusal } from '@/lib/cadastros';
import { firstIssue } from '@/lib/usuarios';
import {
  ADVANCE_SELECT,
  CAMPOS_DO_ADIANTAMENTO,
  CATEGORIA_DO_ADIANTAMENTO,
  PERSON_NOT_FOUND,
  comAcerto,
  createAdvanceSchema,
  descricaoDaDespesa,
  rotuloDoMotivo,
} from '@/lib/equipe';
import { nomeDe } from '@/lib/equipe-db';
import { escolher, origemDaRequisicao, registrarAuditoria } from '@/lib/auditoria';

// A lista não pagina: os mais recentes bastam para a tela.
const LIMITE = 300;

/** Adiantamentos da equipe, do mais recente para o mais antigo. Dinheiro: só o administrador. */
export async function GET() {
  const { error } = await requireStaff({ pode: 'equipeValoresVer' });
  if (error) return error;

  try {
    const adiantamentos = await prisma.crewAdvance.findMany({
      select: ADVANCE_SELECT,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: LIMITE,
    });
    return NextResponse.json(adiantamentos.map(comAcerto));
  } catch (error) {
    console.error('Erro ao listar adiantamentos:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

/**
 * Registra o adiantamento e, na mesma transação, a despesa no Financeiro
 * (categoria "Adiantamento", em aberto, vencendo no dia do adiantamento), como
 * a manutenção faz: ou ficam os dois, ou nenhum.
 */
export async function POST(req: Request) {
  const { user, error } = await requireStaff({ pode: 'equipeValores' });
  if (error) return error;

  try {
    const parsed = createAdvanceSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const data = parsed.data;
    const pessoa = { driverId: data.driverId ?? null, helperId: data.helperId ?? null };
    const origem = origemDaRequisicao(req);

    const adiantamento = await transacao(async (tx) => {
      const nome = await nomeDe(tx, pessoa);
      if (!nome) throw new Refusal(PERSON_NOT_FOUND, 400);

      if (data.manifestId) {
        const viagem = await tx.manifest.findUnique({ where: { id: data.manifestId }, select: { id: true } });
        if (!viagem) throw new Refusal('Viagem não encontrada.', 400);
      }

      const criado = await tx.crewAdvance.create({
        data: {
          ...pessoa,
          date: data.date,
          amount: data.amount,
          reason: data.reason,
          manifestId: data.manifestId ?? null,
          notes: data.notes ?? null,
        },
        select: ADVANCE_SELECT,
      });

      await tx.financialTransaction.create({
        data: {
          type: 'EXPENSE',
          amount: data.amount,
          description: descricaoDaDespesa(data.reason, nome),
          dueDate: data.date,
          status: 'PENDING',
          category: CATEGORIA_DO_ADIANTAMENTO,
          counterparty: nome,
        },
        select: { id: true },
      });

      await registrarAuditoria(tx, {
        ator: user,
        origem,
        acao: 'adiantamento.registrar',
        entidade: 'adiantamento',
        entidadeId: criado.id,
        resumo: `${rotuloDoMotivo(criado.reason)} para ${nome} registrado`,
        depois: escolher(criado, CAMPOS_DO_ADIANTAMENTO),
      });

      return criado;
    });

    return NextResponse.json(comAcerto(adiantamento), { status: 201 });
  } catch (err) {
    if (err instanceof Refusal) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('Erro ao registrar adiantamento:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
