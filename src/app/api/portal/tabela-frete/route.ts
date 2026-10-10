import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requirePortalClient } from '@/lib/portal';
import { tabelaVigente } from '@/lib/frete';
import { cidadesAtendidas } from '@/lib/portal-cliente';

/**
 * A tabela de frete do cliente logado, só para leitura: as cidades atendidas,
 * o frete mínimo e o prazo de cada uma. É a tabela que vale para ele hoje (a
 * do cadastro; senão a padrão). Percentuais, limites e o nome da tabela não
 * saem daqui.
 */
export async function GET() {
  const { clientId, error } = await requirePortalClient();
  if (error) return error;

  try {
    const tabela = await tabelaVigente(prisma, clientId);
    return NextResponse.json({ temTabela: tabela !== null, cidades: cidadesAtendidas(tabela) });
  } catch (error) {
    console.error('Erro ao ler a tabela de frete do portal:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
