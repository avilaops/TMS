import { NextResponse } from 'next/server';
import { transacao } from '@/lib/prisma';
import { requireDriver } from '@/lib/driver';
import { firstIssue } from '@/lib/usuarios';
import { consumeRateLimit } from '@/lib/rate-limit';
import { TRIP_NOT_FOUND } from '@/lib/viagem';
import { LIMITE_POR_MINUTO, POSICOES_DEMAIS, posicaoSchema } from '@/lib/posicao';
import { registrarPosicao } from '@/lib/posicao-db';

/**
 * O motorista manda a posição do aparelho (o `[id]` é o do manifesto). O app só
 * chama com o compartilhamento ligado por ele, a cada 30 segundos e ao
 * registrar uma entrega.
 *
 * Só vale para viagem liberada deste motorista: a de outro, a em montagem e a
 * finalizada respondem 404, como a que não existe. A posição fica no manifesto
 * (a última) e num histórico enxuto; só o painel lê. Não entra na auditoria.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { driverId, error } = await requireDriver();
  if (error) return error;

  try {
    // Por motorista, não por aparelho: o app manda 2 por minuto; isto segura um aparelho com defeito ou um script.
    const limite = consumeRateLimit(`posicao:${driverId}`, LIMITE_POR_MINUTO, 60_000);
    if (!limite.allowed) {
      return NextResponse.json({ error: POSICOES_DEMAIS }, { status: 429, headers: { 'Retry-After': String(limite.retryAfterSeconds) } });
    }

    const parsed = posicaoSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }

    const manifestId = (await params).id;
    const gravada = await transacao((tx) => registrarPosicao(tx, { manifestId, driverId, posicao: parsed.data }));
    if (!gravada) return NextResponse.json({ error: TRIP_NOT_FOUND }, { status: 404 });

    return NextResponse.json({ ok: true, em: gravada.em.toISOString() });
  } catch (err) {
    console.error('Erro ao gravar a posição do motorista:', err);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
