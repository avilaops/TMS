import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import prisma from '@/lib/prisma';
import { CARRIER_NOT_FOUND } from '@/lib/parceiros';
import { CONTRACT_COST_SELECT, csvDoFechamento, fechamentoDoParceiro } from '@/lib/frete-contratado';
import { limitesDoPeriodo, periodoDoRelatorio } from '@/lib/relatorios';

/**
 * O fechamento do parceiro num período: as viagens dele com contrato de frete,
 * com bruto, acréscimos, descontos, retenções, líquido, pago e saldo de cada
 * uma, e o total. É o que o agregado confere no fim do mês.
 *
 * `?de=AAAA-MM&ate=AAAA-MM` (o mesmo período dos relatórios; sem os dois, o
 * mês corrente e os dois anteriores). A viagem entra pelo dia em que saiu, no
 * relógio do Brasil; a que ainda não saiu, pelo dia em que foi montada.
 * Contrato cancelado não entra. Com `?formato=csv`, o mesmo quadro em CSV.
 *
 * É dinheiro: só quem lê o frete contratado.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireStaff({ pode: 'freteContratadoVer' });
  if (error) return error;

  try {
    const { id } = await params;
    const query = new URL(req.url).searchParams;
    const padrao = periodoDoRelatorio();
    const de = query.get('de') ?? padrao.de;
    const ate = query.get('ate') ?? padrao.ate;
    const limites = limitesDoPeriodo(de, ate);
    if (!limites) {
      return NextResponse.json({ error: 'Período inválido. Use de=AAAA-MM e ate=AAAA-MM, com no máximo 36 meses.' }, { status: 400 });
    }
    const noPeriodo = { gte: limites.inicio, lt: limites.fim };

    const parceiro = await prisma.carrier.findUnique({ where: { id }, select: { id: true, name: true, taxId: true, type: true } });
    if (!parceiro) return NextResponse.json({ error: CARRIER_NOT_FOUND }, { status: 404 });

    const contratos = await prisma.freightContract.findMany({
      where: {
        carrierId: id,
        status: { not: 'CANCELADO' },
        // Pela saída; a viagem que ainda não saiu, pela montagem.
        manifest: { OR: [{ departedAt: noPeriodo }, { departedAt: null, createdAt: noPeriodo }] },
      },
      select: {
        id: true,
        ...CONTRACT_COST_SELECT,
        payments: { select: { amount: true, kind: true } },
        manifest: {
          select: {
            id: true,
            status: true,
            createdAt: true,
            departedAt: true,
            vehicle: { select: { plate: true } },
            driver: { select: { user: { select: { name: true } } } },
          },
        },
      },
    });
    const fechamento = fechamentoDoParceiro(contratos);

    if (query.get('formato') === 'csv') {
      return new NextResponse(csvDoFechamento(fechamento), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="fechamento-${parceiro.taxId}-${de}-a-${ate}.csv"`,
          'Cache-Control': 'private, no-store',
        },
      });
    }

    return NextResponse.json({ periodo: { de, ate }, parceiro, ...fechamento });
  } catch (error) {
    console.error('Erro ao montar o fechamento do parceiro:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
