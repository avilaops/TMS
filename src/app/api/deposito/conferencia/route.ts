import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireStaff } from '@/lib/staff';
import { cargaConferida, interpretarLeitura } from '@/lib/deposito';
import { lerCarga } from '@/lib/deposito-db';

const LEITURA_INVALIDA = 'Leia o código de rastreio da carga ou a etiqueta de um dos volumes dela.';

/**
 * Acha a carga pelo que o operador leu (`?codigo=`): o código de rastreio ou a
 * etiqueta de um volume. Devolve a carga, os volumes esperados e, se foi uma
 * etiqueta, a sequência lida (`sequenciaLida`), para a tela já conferir aquele
 * volume. Só lê: quem grava é a rota de volumes.
 *
 * A busca roda na empresa de quem está logado: o código de uma carga de outra
 * transportadora responde 404, igual a um código que não existe.
 */
export async function GET(req: Request) {
  const { error } = await requireStaff({ pode: 'deposito' });
  if (error) return error;

  try {
    const leitura = interpretarLeitura(new URL(req.url).searchParams.get('codigo') ?? '');
    if (leitura.tipo !== 'CARGA' && leitura.tipo !== 'VOLUME') {
      return NextResponse.json({ error: LEITURA_INVALIDA }, { status: 400 });
    }

    const carga = await lerCarga(prisma, { trackingCode: leitura.trackingCode });
    if (!carga) {
      return NextResponse.json({ error: `Nenhuma carga desta empresa com o código ${leitura.trackingCode}.` }, { status: 404 });
    }

    return NextResponse.json({ ...cargaConferida(carga), sequenciaLida: leitura.tipo === 'VOLUME' ? leitura.sequence : null });
  } catch (error) {
    console.error('Erro ao buscar a carga para conferência:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
