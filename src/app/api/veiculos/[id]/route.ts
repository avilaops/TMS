import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import prisma from '@/lib/prisma';
import { INACTIVE_DRIVER_MESSAGE, VEHICLE_PUBLIC_INCLUDE, updateVehicleSchema } from '@/lib/cadastros';
import { firstIssue } from '@/lib/usuarios';
import { escolher, nadaMudou, origemDaRequisicao, registrarAuditoriaDepois } from '@/lib/auditoria';

// O que entra no "antes" e no "depois" da auditoria.
const CAMPOS_AUDITADOS = ['plate', 'model', 'type', 'capacity', 'maxWeight', 'year', 'driverId', 'status'] as const;

/** O veículo, para o cabeçalho da tela de frota (`/dashboard/veiculos/[id]`). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireStaff();
  if (error) return error;

  try {
    const { id } = await params;
    const veiculo = await prisma.vehicle.findUnique({ where: { id }, include: VEHICLE_PUBLIC_INCLUDE });
    if (!veiculo) {
      return NextResponse.json({ error: 'Veículo não encontrado.' }, { status: 404 });
    }
    return NextResponse.json(veiculo);
  } catch (error) {
    console.error('Error fetching vehicle:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireStaff();
  if (error) return error;

  try {
    const { id } = await params;

    const parsed = updateVehicleSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const data = parsed.data;

    // O cadastro inteiro, como estava: é o "antes" da auditoria.
    const target = await prisma.vehicle.findUnique({ where: { id } });
    if (!target) {
      return NextResponse.json({ error: 'Veículo não encontrado.' }, { status: 404 });
    }

    if (data.defaultDriverId) {
      const driver = await prisma.driver.findUnique({
        where: { id: data.defaultDriverId },
        select: { id: true, active: true }
      });
      if (!driver) {
        return NextResponse.json({ error: 'Motorista padrão não encontrado.' }, { status: 400 });
      }
      // Quem já era o motorista do veículo continua valendo depois de desativado:
      // a tela reenvia o mesmo id ao editar os outros campos.
      if (!driver.active && driver.id !== target.driverId) {
        return NextResponse.json({ error: INACTIVE_DRIVER_MESSAGE }, { status: 400 });
      }
    }

    // Campo ausente (`undefined`) fica como está; `null` apaga — em
    // `defaultDriverId`, desvincula o motorista.
    const veiculo = await prisma.vehicle.update({
      where: { id },
      data: {
        model: data.model,
        type: data.type,
        capacity: data.capacityKg,
        maxWeight: data.maxWeight,
        year: data.year,
        driverId: data.defaultDriverId,
        status: data.status,
      },
      include: VEHICLE_PUBLIC_INCLUDE,
    });

    const antes = escolher(target, CAMPOS_AUDITADOS);
    const depois = escolher(veiculo, CAMPOS_AUDITADOS);
    if (!nadaMudou(antes, depois)) {
      await registrarAuditoriaDepois(prisma, {
        ator: user,
        origem: origemDaRequisicao(req),
        acao: 'veiculo.alterar',
        entidade: 'veiculo',
        entidadeId: id,
        resumo: `Veículo ${veiculo.plate} alterado`,
        antes,
        depois,
      });
    }

    return NextResponse.json(veiculo);
  } catch (error) {
    console.error('Error updating vehicle:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
