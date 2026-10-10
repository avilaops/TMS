import type { Prisma } from "@prisma/client";
import type { Pessoa } from "@/lib/equipe";

// Apoio das rotas de equipe (`/api/equipe/...`). Só o servidor importa este arquivo.

type Db = Pick<Prisma.TransactionClient, "driver" | "helper">;

/**
 * O nome do motorista ou do ajudante de uma ausência ou de um adiantamento, na
 * empresa da consulta. Pessoa de outra empresa não existe para ela: devolve
 * `null`, igual a um id inventado, e a rota responde 400.
 */
export async function nomeDe(db: Db, pessoa: Pessoa): Promise<string | null> {
  if (pessoa.driverId) {
    const motorista = await db.driver.findUnique({ where: { id: pessoa.driverId }, select: { user: { select: { name: true } } } });
    return motorista?.user.name ?? null;
  }
  if (pessoa.helperId) {
    const ajudante = await db.helper.findUnique({ where: { id: pessoa.helperId }, select: { name: true } });
    return ajudante?.name ?? null;
  }
  return null;
}
