import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { requireStaff } from '@/lib/staff';
import prisma, { transacao } from '@/lib/prisma';
import { DRIVER_OMIT, DRIVER_USER_SELECT, firstIssue } from '@/lib/usuarios';
import { INACTIVE_DRIVER_MESSAGE } from '@/lib/coletas';
import {
  EMBARKABLE_STATUSES,
  VEHICLE_IN_MAINTENANCE_MESSAGE,
  VEHICLE_NOT_FOUND_MESSAGE,
  canEmbark,
  cannotEmbarkMessage,
  createManifestSchema,
} from '@/lib/manifestos';
import { ManifestError, ORDEM_DAS_CARGAS, conferirAjudante } from '@/lib/manifestos-db';
import { incoerenciaDaViagem } from '@/lib/viagem';
import { origemDaRequisicao, registrarAuditoria } from '@/lib/auditoria';

/** Desfaz a transação quando alguma carga deixou de estar apta entre a conferência e a gravação. */
class CannotEmbark extends Error {
  constructor(readonly count: number) {
    super('Carga não pode embarcar.');
  }
}

/** Desfaz a transação quando motorista ou veículo deixou de servir depois da primeira conferência. */
class Refused extends Error {
  constructor(readonly response: NextResponse) {
    super('Motorista ou veículo não pode sair em viagem.');
  }
}

/** Resposta de recusa se o motorista não está ativo ou o veículo não pode sair; `null` se os dois servem. */
async function driverOrVehicleRefusal(
  db: Pick<Prisma.TransactionClient, 'driver' | 'vehicle'>,
  driverId: string,
  vehicleId: string
): Promise<NextResponse | null> {
  const driver = await db.driver.findFirst({
    where: { id: driverId, active: true },
    select: { id: true }
  });
  if (!driver) {
    return NextResponse.json({ error: INACTIVE_DRIVER_MESSAGE }, { status: 400 });
  }

  const vehicle = await db.vehicle.findUnique({
    where: { id: vehicleId },
    select: { status: true }
  });
  if (!vehicle) {
    return NextResponse.json({ error: VEHICLE_NOT_FOUND_MESSAGE }, { status: 400 });
  }
  if (vehicle.status === 'MAINTENANCE') {
    return NextResponse.json({ error: VEHICLE_IN_MAINTENANCE_MESSAGE }, { status: 409 });
  }
  return null;
}

export async function GET() {
  const { error } = await requireStaff({ pode: 'manifestosVer' });
  if (error) return error;

  try {
    const manifestos = await prisma.manifest.findMany({
      include: {
        driver: { include: { user: { select: DRIVER_USER_SELECT } }, omit: DRIVER_OMIT },
        vehicle: true,
        helper: { select: { id: true, name: true } },
        collections: {
          include: {
            client: { select: { tradeName: true, companyName: true } },
            // Para a viagem mostrar a entrega com ressalva, o comprovante
            // devolvido e as tentativas sem sucesso de cada carga.
            proof: { select: { status: true, exceptionType: true } },
            _count: { select: { deliveryAttempts: true } },
          },
          orderBy: ORDEM_DAS_CARGAS,
        },
      },
      orderBy: { createdAt: 'desc' }
    });
    return NextResponse.json(manifestos);
  } catch (error) {
    console.error('Error fetching manifestos:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const { user, error } = await requireStaff({ pode: 'manifestos' });
  if (error) return error;

  try {
    const parsed = createManifestSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const { driverId, vehicleId, collectionIds } = parsed.data;
    const dadosDaViagem = {
      helperId: parsed.data.helperId ?? null,
      departureOdometer: parsed.data.departureOdometer ?? null,
      returnOdometer: parsed.data.returnOdometer ?? null,
      plannedDepartureAt: parsed.data.plannedDepartureAt ?? null,
      plannedReturnAt: parsed.data.plannedReturnAt ?? null,
      notes: parsed.data.notes ?? null,
    };
    const incoerencia = incoerenciaDaViagem(dadosDaViagem);
    if (incoerencia) return NextResponse.json({ error: incoerencia }, { status: 400 });

    const refused = await driverOrVehicleRefusal(prisma, driverId, vehicleId);
    if (refused) return refused;

    // Id que não existe conta como carga que não embarca: o manifesto não pode
    // nascer com menos cargas do que o operador marcou.
    const found = await prisma.collection.findMany({
      where: { id: { in: collectionIds } },
      select: { status: true, manifestId: true }
    });
    const embarkable = found.filter(canEmbark).length;
    if (embarkable !== collectionIds.length) {
      return NextResponse.json(
        { error: cannotEmbarkMessage(collectionIds.length - embarkable) },
        { status: 409 }
      );
    }

    const origem = origemDaRequisicao(req);
    const newManifest = await transacao(async (tx) => {
      // Segura veículo e motorista, sempre nesta ordem, e confere de novo: quem
      // desativa o motorista ou põe o veículo em manutenção durante a montagem
      // espera esta transação, ou chega antes e a montagem é recusada aqui.
      await tx.$queryRaw`SELECT id FROM "Vehicle" WHERE id = ${vehicleId} FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM "Driver" WHERE id = ${driverId} FOR SHARE`;
      const changed = await driverOrVehicleRefusal(tx, driverId, vehicleId);
      if (changed) throw new Refused(changed);
      await conferirAjudante(tx, dadosDaViagem.helperId);

      // Nasce em montagem: as cargas ficam reservadas, ainda coletadas. Quem as
      // põe em rota é a liberação da saída (/api/manifestos/[id]/liberar).
      const manifest = await tx.manifest.create({
        data: { driverId, vehicleId, status: 'ASSEMBLING', ...dadosDaViagem }
      });

      // A conferência vale aqui: de duas montagens simultâneas com a mesma
      // carga, a segunda encontra menos linhas e a transação inteira é desfeita.
      const { count } = await tx.collection.updateMany({
        where: {
          id: { in: collectionIds },
          status: { in: [...EMBARKABLE_STATUSES] },
          manifestId: null,
        },
        data: { manifestId: manifest.id }
      });
      if (count !== collectionIds.length) {
        throw new CannotEmbark(collectionIds.length - count);
      }

      await registrarAuditoria(tx, {
        ator: user,
        origem,
        acao: 'manifesto.criar',
        entidade: 'manifesto',
        entidadeId: manifest.id,
        resumo: `Manifesto criado com ${collectionIds.length} carga(s)`,
        depois: { status: manifest.status, driverId, vehicleId, cargas: collectionIds.length },
      });

      return manifest;
    });

    return NextResponse.json(newManifest, { status: 201 });
  } catch (error) {
    if (error instanceof Refused) return error.response;
    if (error instanceof ManifestError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof CannotEmbark) {
      return NextResponse.json({ error: cannotEmbarkMessage(error.count) }, { status: 409 });
    }
    console.error('Error creating manifest:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
