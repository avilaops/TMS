import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import prisma from '@/lib/prisma';
import { novoSegredo } from '@/lib/eventos';
import { conferirEnderecoPublico } from '@/lib/url-publica';

const ENTREGA = { id: true, type: true, createdAt: true, deliveredAt: true, attempts: true, lastError: true } as const;

/**
 * Endereço que recebe os eventos da empresa (n8n e afins) e as últimas
 * entregas. Só o administrador. O segredo nunca volta nesta leitura: ele é
 * mostrado uma vez, quando é criado ou trocado.
 */
export async function GET() {
  const { error } = await requireStaff(["ADMIN"]);
  if (error) return error;

  try {
    const webhook = await prisma.webhook.findFirst({ select: { url: true, updatedAt: true } });
    const entregas = await prisma.outboxEvent.findMany({ orderBy: { createdAt: 'desc' }, take: 10, select: ENTREGA });
    return NextResponse.json({ url: webhook?.url ?? null, atualizadoEm: webhook?.updatedAt ?? null, entregas });
  } catch (error) {
    console.error('Erro ao ler a integração:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

/**
 * Grava o endereço. `{ url }` cria ou troca; `{ url: null }` remove (e os
 * eventos param de ser gerados); `{ url, novoSegredo: true }` troca o segredo.
 * A resposta traz `segredo` só quando ele acabou de ser gerado.
 */
export async function PUT(req: Request) {
  const { error } = await requireStaff(["ADMIN"]);
  if (error) return error;

  const corpo = (await req.json().catch(() => null)) as { url?: unknown; novoSegredo?: unknown } | null;
  if (!corpo || typeof corpo !== 'object' || !('url' in corpo)) {
    return NextResponse.json({ error: 'Dados inválidos.' }, { status: 400 });
  }

  try {
    if (corpo.url === null || corpo.url === '') {
      await prisma.webhook.deleteMany({});
      return NextResponse.json({ url: null });
    }
    if (typeof corpo.url !== 'string') return NextResponse.json({ error: 'Dados inválidos.' }, { status: 400 });

    const destino = await conferirEnderecoPublico(corpo.url);
    if (!destino.ok) return NextResponse.json({ error: destino.erro }, { status: 400 });
    const url = destino.url.toString();

    const atual = await prisma.webhook.findFirst({ select: { id: true } });
    if (atual && corpo.novoSegredo !== true) {
      await prisma.webhook.update({ where: { id: atual.id }, data: { url } });
      return NextResponse.json({ url });
    }

    const segredo = novoSegredo();
    if (atual) await prisma.webhook.update({ where: { id: atual.id }, data: { url, secret: segredo } });
    else await prisma.webhook.create({ data: { url, secret: segredo } });
    return NextResponse.json({ url, segredo }, { status: atual ? 200 : 201 });
  } catch (error) {
    console.error('Erro ao gravar a integração:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
