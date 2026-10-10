import { NextResponse } from 'next/server';
import prisma, { transacao } from '@/lib/prisma';
import { requireStaff } from '@/lib/staff';
import { Refusal } from '@/lib/cadastros';
import { origemDaRequisicao } from '@/lib/auditoria';
import { carregarConciliacao, conciliarLinha } from '@/lib/conciliacao-db';

/**
 * Concilia de uma vez as linhas pendentes que têm candidato certeiro (um só
 * lançamento forte, que não é o certeiro de outra linha: src/lib/conciliacao.ts).
 *
 * Cada linha é a sua própria transação, com a mesma regra e a mesma auditoria
 * da conciliação feita uma a uma. A que for recusada (alguém mexeu no
 * lançamento enquanto isso, por exemplo) fica pendente e volta em `falhas`,
 * sem derrubar as outras.
 */
export async function POST(req: Request) {
  const { user, error } = await requireStaff({ pode: 'financeiro' });
  if (error) return error;

  try {
    const quem = { ator: user, origem: origemDaRequisicao(req) };
    const { linhas } = await carregarConciliacao(prisma, 'pendentes');

    let conciliadas = 0;
    const falhas: { id: string; error: string }[] = [];
    for (const linha of linhas) {
      const certeiro = linha.certeiro;
      if (!certeiro) continue;
      try {
        await transacao((tx) => conciliarLinha(tx, linha.id, certeiro, {}, quem));
        conciliadas += 1;
      } catch (err) {
        if (!(err instanceof Refusal)) throw err;
        falhas.push({ id: linha.id, error: err.message });
      }
    }

    return NextResponse.json({ conciliadas, falhas });
  } catch (error) {
    console.error('Erro ao conciliar os certeiros:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
