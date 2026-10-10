import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import prisma from '@/lib/prisma';
import { firstIssue } from '@/lib/usuarios';
import { DOCUMENT_SELECT, createDocumentSchema, diasAteVencer, situacaoDoVencimento } from '@/lib/frota';
import { acharVeiculo, veiculoNaoEncontrado } from '@/lib/frota-db';
import { escolher, origemDaRequisicao, registrarAuditoriaDepois } from '@/lib/auditoria';

/**
 * Documentos do veículo, do que vence primeiro para o que vence por último,
 * cada um com a situação de hoje (em dia, a vencer em até 30 dias ou vencido).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireStaff({ pode: 'frotaVer' });
  if (error) return error;

  try {
    const { id } = await params;
    if (!(await acharVeiculo(id))) return veiculoNaoEncontrado();

    const documentos = await prisma.vehicleDocument.findMany({
      where: { vehicleId: id },
      orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
      select: DOCUMENT_SELECT,
    });
    const hoje = new Date();
    return NextResponse.json(
      documentos.map((documento) => ({
        ...documento,
        situacao: situacaoDoVencimento(documento.expiresAt, hoje),
        dias: diasAteVencer(documento.expiresAt, hoje),
      })),
    );
  } catch (error) {
    console.error('Erro ao buscar documentos do veículo:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireStaff({ pode: 'frota' });
  if (error) return error;

  try {
    const { id } = await params;
    const parsed = createDocumentSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const data = parsed.data;

    if (!(await acharVeiculo(id))) return veiculoNaoEncontrado();

    const documento = await prisma.vehicleDocument.create({
      data: { vehicleId: id, type: data.type, number: data.number ?? null, expiresAt: data.expiresAt, notes: data.notes ?? null },
      select: DOCUMENT_SELECT,
    });

    await registrarAuditoriaDepois(prisma, {
      ator: user,
      origem: origemDaRequisicao(req),
      acao: 'documento-veiculo.registrar',
      entidade: 'veiculo',
      entidadeId: id,
      resumo: `Documento ${documento.type} do veículo registrado`,
      depois: escolher(documento, ['type', 'number', 'expiresAt', 'notes']),
    });

    return NextResponse.json(documento, { status: 201 });
  } catch (error) {
    console.error('Erro ao registrar documento do veículo:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
