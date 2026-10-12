import { NextResponse } from 'next/server';
import prisma, { empresaAtual } from '@/lib/prisma';
import { requireStaff } from '@/lib/staff';
import { CONTRACT_SELECT, sugestaoParaOMdfe } from '@/lib/frete-contratado';
import { TRIP_NOT_FOUND } from '@/lib/viagem';

/**
 * O que o contrato de frete da viagem sugere para o grupo de pagamento do
 * MDF-e: valor do contrato, adiantamento já pago, à vista ou a prazo, a forma
 * do último pagamento, a chave Pix do parceiro e quem paga (o emitente). É
 * dinheiro: só quem lê o frete contratado recebe; para os outros perfis a
 * conferência do MDF-e fica com os campos em branco, como sempre foi.
 *
 * Só sugere: a validação e a montagem do MDF-e não leem nada daqui. Viagem sem
 * contrato (ou com ele cancelado) responde `{ sugestao: null }`.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireStaff({ pode: 'freteContratadoVer' });
  if (error) return error;

  try {
    const viagem = await prisma.manifest.findUnique({ where: { id: (await params).id }, select: { id: true, freightContract: { select: CONTRACT_SELECT } } });
    if (!viagem) return NextResponse.json({ error: TRIP_NOT_FOUND }, { status: 404 });

    const emitente = await prisma.fiscalIssuer.findUnique({ where: { tenantId: await empresaAtual() }, select: { cnpj: true, legalName: true } });
    const pagador = emitente ? { nome: emitente.legalName, documento: emitente.cnpj } : null;
    return NextResponse.json({ sugestao: sugestaoParaOMdfe(viagem.freightContract, pagador) });
  } catch (error) {
    console.error('Erro ao sugerir o pagamento do frete para o MDF-e:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
