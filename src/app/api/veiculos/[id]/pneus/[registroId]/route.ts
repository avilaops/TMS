import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import prisma from '@/lib/prisma';
import { firstIssue } from '@/lib/usuarios';
import { REMOVED_KM_MESSAGE, TIRE_SELECT, updateTireSchema } from '@/lib/frota';
import { CAMPOS_DO_PNEU, escolher, nadaMudou, origemDaRequisicao, registrarAuditoriaDepois } from '@/lib/auditoria';

const NOT_FOUND = 'Pneu não encontrado.';

type Contexto = { params: Promise<{ id: string; registroId: string }> };

/** Altera o pneu: posição, marca, observação e a retirada (`removedKm`; `null` devolve o pneu ao veículo). */
export async function PATCH(req: Request, { params }: Contexto) {
  const { user, error } = await requireStaff({ pode: 'frota' });
  if (error) return error;

  try {
    const { id, registroId } = await params;
    const parsed = updateTireSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const data = parsed.data;

    // O pneu inteiro, e não só o km: o que havia antes vai para a auditoria.
    const atual = await prisma.tire.findFirst({ where: { id: registroId, vehicleId: id }, select: TIRE_SELECT });
    if (!atual) return NextResponse.json({ error: NOT_FOUND }, { status: 404 });

    // O km de instalação não muda por aqui, então a comparação vale até o fim da gravação.
    if (data.removedKm != null && data.removedKm < atual.installedKm) {
      return NextResponse.json({ error: REMOVED_KM_MESSAGE }, { status: 400 });
    }

    const pneu = await prisma.tire.update({ where: { id: registroId }, data, select: TIRE_SELECT });

    const antes = escolher(atual, CAMPOS_DO_PNEU);
    const depois = escolher(pneu, CAMPOS_DO_PNEU);
    if (!nadaMudou(antes, depois)) {
      await registrarAuditoriaDepois(prisma, {
        ator: user,
        origem: origemDaRequisicao(req),
        acao: 'pneu.alterar',
        entidade: 'veiculo',
        entidadeId: id,
        resumo: `Pneu ${pneu.brandModel} (${pneu.position}) alterado`,
        antes,
        depois,
      });
    }

    return NextResponse.json(pneu);
  } catch (error) {
    console.error('Erro ao alterar pneu:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: Contexto) {
  const { user, error } = await requireStaff({ pode: 'frota' });
  if (error) return error;

  try {
    const { id, registroId } = await params;
    // O que vai ser apagado, para a auditoria. Sem ele, o `deleteMany` abaixo responde o 404 de sempre.
    const apagado = await prisma.tire.findFirst({ where: { id: registroId, vehicleId: id }, select: TIRE_SELECT });
    const { count } = await prisma.tire.deleteMany({ where: { id: registroId, vehicleId: id } });
    if (count === 0) return NextResponse.json({ error: NOT_FOUND }, { status: 404 });

    if (apagado) {
      await registrarAuditoriaDepois(prisma, {
        ator: user,
        origem: origemDaRequisicao(req),
        acao: 'pneu.excluir',
        entidade: 'veiculo',
        entidadeId: id,
        resumo: `Pneu ${apagado.brandModel} (${apagado.position}) excluído`,
        antes: escolher(apagado, CAMPOS_DO_PNEU),
      });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Erro ao apagar pneu:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
