import { NextResponse } from 'next/server';
import { transacao } from '@/lib/prisma';
import { requireStaff } from '@/lib/staff';
import { Refusal } from '@/lib/cadastros';
import { canTransition } from '@/lib/coletas';
import { mudarStatusDaColeta } from '@/lib/coletas-db';
import { cargaConferida, codigoDoVolume, sequenciasPendentes } from '@/lib/deposito';
import { gravarConferencia, lerCarga, travarCargaParaConferir } from '@/lib/deposito-db';
import { origemDaRequisicao, registrarAuditoria } from '@/lib/auditoria';

const NADA_CONFERIDO = 'Nenhum volume foi conferido. Leia ao menos um volume antes de concluir.';
const MUDOU = 'A carga mudou de status enquanto você conferia. Leia o código de novo.';

const COLETADA = 'COLLECTED';

/**
 * Conclui a conferência da carga: o que não foi lido fica como faltando, a
 * conferência é gravada (quem, quando, divergência de quantidade e de peso) e,
 * se a carga estava confirmada, ela passa para coletada pela mesma regra e
 * pelo mesmo caminho do painel de minutas, com a linha no histórico.
 *
 * Pode ser chamada de novo enquanto a carga estiver no depósito: refaz as
 * contas e registra quem concluiu por último.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireStaff({ pode: 'deposito' });
  if (error) return error;

  try {
    const { id } = await params;
    const origem = origemDaRequisicao(req);

    const resposta = await transacao(async (tx) => {
      const carga = await travarCargaParaConferir(tx, id);

      const noLimite = carga.volumeItems.filter((linha) => linha.sequence <= carga.volumes);
      if (!noLimite.some((linha) => linha.status !== 'MISSING')) throw new Refusal(NADA_CONFERIDO, 409);

      const pendentes = sequenciasPendentes(carga.volumes, noLimite);
      if (pendentes.length > 0) {
        await tx.collectionVolume.createMany({
          data: pendentes.map((sequence) => ({
            collectionId: id,
            sequence,
            code: codigoDoVolume(carga.trackingCode, sequence),
            status: 'MISSING',
            checkedById: user.id,
          })),
        });
      }

      await gravarConferencia(tx, id, user.id);

      if (carga.status !== COLETADA) {
        const mudou =
          canTransition(carga.status, COLETADA) &&
          (await mudarStatusDaColeta(tx, { collectionId: id, de: carga.status, para: COLETADA, userId: user.id }));
        if (!mudou) throw new Refusal(MUDOU, 409);
      }

      await registrarAuditoria(tx, {
        ator: user,
        origem,
        acao: 'deposito.concluir',
        entidade: 'coleta',
        entidadeId: id,
        resumo: `Conferência da carga ${carga.trackingCode} concluída${pendentes.length > 0 ? `, com ${pendentes.length} volume(s) faltando` : ''}`,
        antes: { status: carga.status },
        depois: { status: COLETADA, volumes: carga.volumes, faltando: pendentes.length },
      });

      const depois = await lerCarga(tx, { id });
      return cargaConferida(depois ?? carga);
    });

    return NextResponse.json(resposta);
  } catch (err) {
    if (err instanceof Refusal) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('Erro ao concluir a conferência:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
