import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireStaff } from '@/lib/staff';
import {
  DIAS_PARADO_ALERTA,
  alertasDaCarga,
  contadoresDoDeposito,
  dataDeEntrada,
  diasParado,
  nomeDoCliente,
  posicoesDaCarga,
  type CargaNoDeposito,
} from '@/lib/deposito';

/**
 * O que está no depósito agora: as cargas coletadas que ainda não entraram em
 * manifesto, da mais antiga para a mais nova, com a posição dos volumes, a
 * data de entrada, os dias parada e os alertas de cada uma. Os contadores são
 * de tudo o que está no depósito. Só leitura, sem dado financeiro.
 */
export async function GET() {
  const { error } = await requireStaff();
  if (error) return error;

  try {
    const agora = new Date();
    const linhas = await prisma.collection.findMany({
      where: { status: 'COLLECTED', manifestId: null },
      select: {
        id: true,
        trackingCode: true,
        receiver: true,
        destination: true,
        volumes: true,
        weight: true,
        updatedAt: true,
        client: { select: { companyName: true, tradeName: true } },
        warehouseReceipt: {
          select: {
            concludedAt: true,
            receivedVolumes: true,
            damagedVolumes: true,
            missingVolumes: true,
            quantityDivergence: true,
            weightDivergence: true,
          },
        },
        volumeItems: { select: { status: true, location: { select: { code: true } } } },
        // A entrada no depósito é a última vez em que a carga passou para coletada.
        statusHistory: { where: { toStatus: 'COLLECTED' }, orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true } },
      },
    });

    const cargas: CargaNoDeposito[] = linhas
      .map((linha) => {
        const entrouEm = dataDeEntrada({
          coletadaEm: linha.statusHistory[0]?.createdAt ?? null,
          conferidaEm: linha.warehouseReceipt?.concludedAt ?? null,
          updatedAt: linha.updatedAt,
        });
        const dias = diasParado(entrouEm, agora);
        return {
          id: linha.id,
          trackingCode: linha.trackingCode,
          cliente: nomeDoCliente(linha.client),
          receiver: linha.receiver,
          destination: linha.destination,
          volumes: linha.volumes,
          weight: linha.weight,
          entrouEm,
          dias,
          conferencia: linha.warehouseReceipt,
          posicoes: posicoesDaCarga(linha.volumeItems),
          alertas: alertasDaCarga({ dias, conferencia: linha.warehouseReceipt, volumeItems: linha.volumeItems }),
        };
      })
      .sort((a, b) => new Date(a.entrouEm).getTime() - new Date(b.entrouEm).getTime());

    return NextResponse.json({ diasDeAlerta: DIAS_PARADO_ALERTA, contadores: contadoresDoDeposito(cargas), cargas });
  } catch (error) {
    console.error('Erro ao montar a visão do depósito:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
