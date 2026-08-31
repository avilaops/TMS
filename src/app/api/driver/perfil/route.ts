import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireDriver } from '@/lib/driver';

/** Dados cadastrais do motorista logado, incluindo vencimento da CNH. */
export async function GET() {
  const { driverId, error } = await requireDriver();
  if (error) return error;

  try {
    const driver = await prisma.driver.findUnique({
      where: { id: driverId },
      select: {
        cpf: true,
        cnh: true,
        cnhExpiry: true,
        category: true,
        phone: true,
        user: { select: { name: true, email: true } },
        vehicles: {
          select: { plate: true, model: true, type: true, status: true },
        },
      },
    });

    if (!driver) {
      return NextResponse.json({ error: 'Cadastro não encontrado' }, { status: 404 });
    }

    return NextResponse.json(driver);
  } catch (error) {
    console.error('Erro ao buscar perfil do motorista:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
