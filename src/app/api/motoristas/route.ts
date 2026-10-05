import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import prisma from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { BCRYPT_ROUNDS, DRIVER_USER_SELECT } from '@/lib/usuarios';

export async function GET() {
  const { error } = await requireStaff();
  if (error) return error;

  try {
    const motoristas = await prisma.driver.findMany({
      include: {
        user: { select: DRIVER_USER_SELECT }
      },
      orderBy: { createdAt: 'desc' }
    });
    return NextResponse.json(motoristas);
  } catch (error) {
    console.error('Error fetching drivers:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const { error } = await requireStaff();
  if (error) return error;

  try {
    const data = await req.json();
    
    if (!data.cpf || !data.name) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const existingDriver = await prisma.driver.findUnique({
      where: { cpf: data.cpf }
    });

    if (existingDriver) {
      return NextResponse.json({ error: 'Já existe um motorista com este CPF.' }, { status: 409 });
    }

    // O motorista nasce com uma senha aleatória que ninguém conhece: ela não é
    // devolvida nem registrada em log. Para ele entrar, um ADMIN define a senha
    // em Usuários → Redefinir senha.
    const password = await bcrypt.hash(randomBytes(32).toString('base64url'), BCRYPT_ROUNDS);

    // Since a Driver requires a User, let's create a User first
    const newUser = await prisma.user.create({
      data: {
        name: data.name,
        email: `${data.cpf}@motorista.mello.com`, // mock email
        password,
        role: 'DRIVER'
      }
    });

    const newDriver = await prisma.driver.create({
      data: {
        userId: newUser.id,
        cpf: data.cpf,
        cnh: data.cnh || 'PENDENTE',
        cnhExpiry: new Date(new Date().setFullYear(new Date().getFullYear() + 5)), // mock +5 years
        category: data.category || 'B',
        phone: data.phone,
      }
    });

    return NextResponse.json(newDriver, { status: 201 });
  } catch (error) {
    console.error('Error creating driver:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
