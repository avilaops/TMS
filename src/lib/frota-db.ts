import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { VEHICLE_NOT_FOUND } from "@/lib/frota";

// Apoio das rotas de frota (`/api/veiculos/[id]/...`). Só o servidor importa este arquivo.

/**
 * O veículo da rota, na empresa da sessão. Veículo de outra empresa não existe
 * para esta consulta: a rota responde 404, igual a um id inventado.
 */
export function acharVeiculo(id: string) {
  return prisma.vehicle.findUnique({ where: { id }, select: { id: true, plate: true, model: true } });
}

export const veiculoNaoEncontrado = () => NextResponse.json({ error: VEHICLE_NOT_FOUND }, { status: 404 });
