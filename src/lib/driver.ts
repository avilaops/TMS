import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";

/**
 * Resolve o cadastro de motorista do usuário logado.
 *
 * Toda rota de /api/driver precisa passar por aqui e filtrar pelo `driverId`
 * devolvido — é o que impede um motorista de ver (ou dar baixa em) a viagem
 * de outro.
 */
export async function requireDriver(): Promise<
  { driverId: string; error: null } | { driverId: null; error: NextResponse }
> {
  const session = await getServerSession(authOptions);

  if (!session?.user || session.user.role !== "DRIVER") {
    return {
      driverId: null,
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
      error: NextResponse.json(
        { error: "Usuário não possui cadastro de motorista." },
        { status: 403 }
      ),
    };
  }

  if (!driver.active) {
    return {
      driverId: null,
      error: NextResponse.json({ error: "Motorista inativo." }, { status: 403 }),
    };
  }

  return { driverId: driver.id, error: null };
}
