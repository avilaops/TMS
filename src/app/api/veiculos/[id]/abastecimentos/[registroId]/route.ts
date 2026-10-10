import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import prisma from '@/lib/prisma';
import { escolher, origemDaRequisicao, registrarAuditoriaDepois } from '@/lib/auditoria';

/** Apaga um abastecimento lançado errado. O consumo dos vizinhos é refeito na próxima leitura. */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string; registroId: string }> }) {
  const { user, error } = await requireStaff({ pode: 'frota' });
  if (error) return error;

  try {
    const { id, registroId } = await params;
    // O que vai ser apagado, para a auditoria. Sem ele, o `deleteMany` abaixo responde o 404 de sempre.
    const apagado = await prisma.fueling.findFirst({
      where: { id: registroId, vehicleId: id },
      select: { date: true, liters: true, totalCost: true, odometer: true, station: true, driverId: true },
    });
    const { count } = await prisma.fueling.deleteMany({ where: { id: registroId, vehicleId: id } });
    if (count === 0) return NextResponse.json({ error: 'Abastecimento não encontrado.' }, { status: 404 });

    if (apagado) {
      await registrarAuditoriaDepois(prisma, {
        ator: user,
        origem: origemDaRequisicao(req),
        acao: 'abastecimento.excluir',
        entidade: 'veiculo',
        entidadeId: id,
        resumo: `Abastecimento de ${apagado.liters.toLocaleString('pt-BR')} l excluído`,
        antes: escolher(apagado, ['date', 'liters', 'totalCost', 'odometer', 'station', 'driverId']),
      });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Erro ao apagar abastecimento:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
