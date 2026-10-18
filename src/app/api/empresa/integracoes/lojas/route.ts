import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/staff";
import prisma, { empresaAtual } from "@/lib/prisma";
import { gerarChaveLojas, hashChaveLojas } from "@/lib/lojas-logistica-auth";

const ORDEM = { externalId: true, mode: true, state: true, direction: true, rma: true, createdAt: true } as const;

export async function GET() {
  const { error } = await requireStaff({ pode: "empresa" });
  if (error) return error;
  const credencial = await prisma.lojasIntegrationCredential.findFirst({ select: { active: true, keyLast4: true, rotatedAt: true } });
  const ordens = await prisma.logisticsOrder.findMany({ orderBy: { createdAt: "desc" }, take: 10, select: ORDEM });
  return NextResponse.json({ configurado: Boolean(credencial?.active), final: credencial?.keyLast4 ?? null, rotacionadaEm: credencial?.rotatedAt ?? null, ordens });
}

export async function POST() {
  const { error } = await requireStaff({ pode: "empresa" });
  if (error) return error;
  const tenantId = await empresaAtual();
  const chave = gerarChaveLojas();
  const credencial = await prisma.lojasIntegrationCredential.upsert({
    where: { tenantId },
    create: { keyHash: hashChaveLojas(chave), keyLast4: chave.slice(-4) },
    update: { keyHash: hashChaveLojas(chave), keyLast4: chave.slice(-4), active: true, rotatedAt: new Date() },
    select: { keyLast4: true, rotatedAt: true },
  });
  return NextResponse.json({ configurado: true, final: credencial.keyLast4, rotacionadaEm: credencial.rotatedAt, chave }, { status: 201 });
}
