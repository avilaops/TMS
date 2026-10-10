import { NextResponse } from 'next/server';
import { transacao } from '@/lib/prisma';
import { requireStaff } from '@/lib/staff';
import { Refusal } from '@/lib/cadastros';
import { firstIssue } from '@/lib/usuarios';
import { POSICAO_NAO_ENCONTRADA, alocarPosicaoSchema, cargaConferida } from '@/lib/deposito';
import { lerCarga, travarCargaParaConferir } from '@/lib/deposito-db';

const NADA_A_ALOCAR = 'Nenhum volume conferido para alocar. Confira os volumes primeiro.';
const NAO_CONFERIDO = 'Só volume conferido e presente pode ir para uma posição.';

/**
 * Põe volumes da carga numa posição do depósito, pelo código da posição
 * (`locationCode`). Sem `sequences`, vale para todos os volumes presentes da
 * carga; com, só para aqueles. Posição em branco tira os volumes de onde estão.
 * Vale na conferência e depois, enquanto a carga estiver no depósito.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireStaff({ pode: 'deposito' });
  if (error) return error;

  try {
    const { id } = await params;
    const parsed = alocarPosicaoSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const { locationCode, sequences } = parsed.data;

    const resposta = await transacao(async (tx) => {
      const carga = await travarCargaParaConferir(tx, id);

      const posicao = locationCode
        ? await tx.warehouseLocation.findFirst({ where: { code: locationCode, active: true }, select: { id: true } })
        : null;
      if (locationCode && !posicao) throw new Refusal(POSICAO_NAO_ENCONTRADA, 400);

      // Só o que chegou tem lugar: volume a conferir ou faltando não é alocado.
      const presentes = carga.volumeItems
        .filter((linha) => linha.status !== 'MISSING' && linha.sequence <= carga.volumes)
        .map((linha) => linha.sequence);
      if (sequences && sequences.some((sequence) => !presentes.includes(sequence))) throw new Refusal(NAO_CONFERIDO, 409);

      const alvo = sequences ?? presentes;
      if (alvo.length === 0) throw new Refusal(NADA_A_ALOCAR, 409);

      const { count } = await tx.collectionVolume.updateMany({
        where: { collectionId: id, sequence: { in: alvo } },
        data: { locationId: posicao?.id ?? null },
      });

      const depois = await lerCarga(tx, { id });
      return { ...cargaConferida(depois ?? carga), alocados: count };
    });

    return NextResponse.json(resposta);
  } catch (err) {
    if (err instanceof Refusal) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('Erro ao alocar volumes na posição:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
