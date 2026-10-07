import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

/**
 * Resolve o cadastro de motorista do usuário logado.
 *
 * Toda rota de /api/driver precisa passar por aqui e filtrar pelo `driverId`
 * devolvido — é o que impede um motorista de ver (ou dar baixa em) a viagem
 * de outro. O `userId` é o usuário desse motorista, para o histórico de status.
 */
export async function requireDriver(): Promise<
  { driverId: string; userId: string; error: null } | { driverId: null; userId: null; error: NextResponse }
> {
  const session = await getServerSession(authOptions);

  if (!session?.user || session.user.role !== "DRIVER") {
    return {
      driverId: null,
      userId: null,
      error: NextResponse.json({ error: "Não autorizado" }, { status: 401 }),
    };
  }

  const driver = await prisma.driver.findUnique({
    where: { userId: session.user.id },
    select: { id: true, active: true },
  });

  if (!driver) {
    return {
      driverId: null,
      userId: null,
      error: NextResponse.json(
        { error: "Usuário não possui cadastro de motorista." },
        { status: 403 }
      ),
    };
  }

  if (!driver.active) {
    return {
      driverId: null,
      userId: null,
      error: NextResponse.json({ error: "Motorista inativo." }, { status: 403 }),
    };
  }

  return { driverId: driver.id, userId: session.user.id, error: null };
}
