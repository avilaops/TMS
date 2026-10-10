import { NextResponse } from 'next/server';
import prisma, { transacao } from '@/lib/prisma';
import { requireStaff } from '@/lib/staff';
import { firstIssue } from '@/lib/usuarios';
import { ManifestError, conferirAjudante, lockManifest } from '@/lib/manifestos-db';
import { CAMPOS_DA_VIAGEM, TRIP_CANCELLED, codigoDaViagem, incoerenciaDaViagem, updateTripDataSchema } from '@/lib/viagem';
import { escolher, nadaMudou, origemDaRequisicao, registrarAuditoria } from '@/lib/auditoria';

/**
 * Dados da viagem: ajudante, hodômetro de saída e de retorno, previsão de saída
 * e de retorno, observação. Todos opcionais; campo ausente não muda, campo em
 * branco apaga.
 *
 * Fica fora do PATCH de /api/manifestos/[id] de propósito: aquele troca
 * motorista, veículo e carga e só vale em montagem; estes dados se completam
 * com a viagem na rua e depois dela (o hodômetro de retorno chega no fim).
 * Só a viagem cancelada não recebe alteração.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user, error } = await requireStaff();
    if (error) return error;

    const manifestId = (await params).id;
    const origem = origemDaRequisicao(req);

    const parsed = updateTripDataSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const pedido = parsed.data;

    await transacao(async (tx) => {
      const { status } = await lockManifest(tx, manifestId);
      if (status === 'CANCELLED') throw new ManifestError(409, TRIP_CANCELLED);

      const atual = await tx.manifest.findUniqueOrThrow({
        where: { id: manifestId },
        select: {
          helperId: true,
          departureOdometer: true,
          returnOdometer: true,
          plannedDepartureAt: true,
          plannedReturnAt: true,
          notes: true,
          finishedAt: true,
          updatedAt: true,
        },
      });
      const antes = escolher(atual, CAMPOS_DA_VIAGEM);

      // O que fica gravado: o pedido por cima do que já havia.
      const depois = { ...antes };
      for (const campo of CAMPOS_DA_VIAGEM) {
        if (pedido[campo] !== undefined) Object.assign(depois, { [campo]: pedido[campo] });
      }

      const incoerencia = incoerenciaDaViagem(depois);
      if (incoerencia) throw new ManifestError(400, incoerencia);
      if (depois.helperId !== antes.helperId) await conferirAjudante(tx, depois.helperId);

      if (nadaMudou(antes, depois)) return;

      await tx.manifest.update({
        where: { id: manifestId },
        data: {
          ...depois,
          // Viagem finalizada antes de existir `finishedAt`: a data da última
          // alteração era a da finalização, e esta gravação a mudaria. Fica guardada.
          ...(status === 'FINISHED' && atual.finishedAt === null ? { finishedAt: atual.updatedAt } : {}),
        },
      });

      await registrarAuditoria(tx, {
        ator: user,
        origem,
        acao: 'viagem.dados',
        entidade: 'manifesto',
        entidadeId: manifestId,
        resumo: `Dados da viagem #${codigoDaViagem(manifestId)} alterados`,
        antes,
        depois,
      });
    });

    const manifest = await prisma.manifest.findUnique({
      where: { id: manifestId },
      include: { helper: { select: { id: true, name: true } } },
    });
    return NextResponse.json({ success: true, manifest });
  } catch (error) {
    if (error instanceof ManifestError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Erro ao alterar os dados da viagem:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
