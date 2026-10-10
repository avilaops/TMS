import { NextResponse } from 'next/server';
import { transacao } from '@/lib/prisma';
import { requireStaff } from '@/lib/staff';
import { Refusal } from '@/lib/cadastros';
import { firstIssue } from '@/lib/usuarios';
import { cargaConferida, codigoDoVolume, interpretarLeitura, registrarVolumeSchema, registroDoVolume, type VolumeStatus } from '@/lib/deposito';
import { gravarConferencia, lerCarga, travarCargaParaConferir } from '@/lib/deposito-db';

const CODIGO_INVALIDO = 'Isto não é a etiqueta de um volume. Leia o código de barras da etiqueta.';
const DE_OUTRA_CARGA = 'Este volume não é desta carga. Confira a etiqueta.';

/**
 * Registra um volume da carga na conferência.
 *
 * Só `codigo` (a etiqueta lida) ou só `sequence` (o toque em "Conferir") é uma
 * leitura: marca o volume como recebido; repetida, não muda nada e volta com
 * `repetido: true`. Com `status`, corrige o volume: peso conferido, avaria com
 * observação, ou faltando.
 *
 * A etiqueta de outra carga é recusada (409), seja de outra carga da empresa
 * ou de outra transportadora: o código de rastreio dela não é o desta.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireStaff({ pode: 'deposito' });
  if (error) return error;

  try {
    const { id } = await params;
    const parsed = registrarVolumeSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const pedido = parsed.data;

    const resposta = await transacao(async (tx) => {
      const carga = await travarCargaParaConferir(tx, id);

      let sequence = pedido.sequence;
      if (pedido.codigo !== undefined) {
        const leitura = interpretarLeitura(pedido.codigo);
        if (leitura.tipo !== 'VOLUME') throw new Refusal(CODIGO_INVALIDO, 400);
        if (leitura.trackingCode !== carga.trackingCode) throw new Refusal(DE_OUTRA_CARGA, 409);
        sequence = leitura.sequence;
      }
      if (sequence === undefined || sequence > carga.volumes) {
        throw new Refusal(`Esta carga tem ${carga.volumes} volume(s): não existe o volume ${sequence}.`, 400);
      }

      const atual = carga.volumeItems.find((linha) => linha.sequence === sequence) ?? null;
      const { repetido, dados } = registroDoVolume(
        atual ? { status: atual.status as VolumeStatus, weight: atual.weight, damageNote: atual.damageNote } : null,
        pedido,
      );
      if (repetido) return { ...cargaConferida(carga), sequence, repetido };

      const conferido = { ...dados, checkedAt: new Date(), checkedById: user.id };
      await tx.collectionVolume.upsert({
        where: { collectionId_sequence: { collectionId: id, sequence } },
        create: { collectionId: id, sequence, code: codigoDoVolume(carga.trackingCode, sequence), ...conferido },
        // Volume que falta não está em posição nenhuma.
        update: { ...conferido, ...(dados.status === 'MISSING' ? { locationId: null } : {}) },
        select: { id: true },
      });

      // Conferência já concluída acompanha a correção.
      await gravarConferencia(tx, id, null);

      const depois = await lerCarga(tx, { id });
      return { ...cargaConferida(depois ?? carga), sequence, repetido };
    });

    return NextResponse.json(resposta);
  } catch (err) {
    if (err instanceof Refusal) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('Erro ao registrar volume na conferência:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
