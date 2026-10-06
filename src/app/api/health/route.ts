import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

/**
 * Saude do sistema, para o healthcheck do container e para o deploy.
 *
 * Consulta o banco de proposito: um processo de pe sem banco nao atende
 * ninguem, e o deploy so pode trocar a versao em producao se a nova conseguir
 * ler. Rota publica e sem dado nenhum — so diz se esta de pe e qual commit roda.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const commit = process.env.GIT_SHA || 'dev';

  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: 'ok', commit });
  } catch (error) {
    console.error('Health check: banco indisponivel:', error);
    return NextResponse.json({ status: 'erro', commit }, { status: 503 });
  }
}
