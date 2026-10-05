import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import prisma from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { DRIVER_PUBLIC_INCLUDE, createDriverSchema, isUniqueViolation } from '@/lib/cadastros';
import { BCRYPT_ROUNDS, firstIssue } from '@/lib/usuarios';

const DUPLICATE_CPF = 'Já existe um motorista com este CPF.';
const DUPLICATE_EMAIL = 'Já existe um usuário com este e-mail.';

export async function GET() {
  const { error } = await requireStaff();
  if (error) return error;

  try {
    const motoristas = await prisma.driver.findMany({
      include: DRIVER_PUBLIC_INCLUDE,
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
    const parsed = createDriverSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const data = parsed.data;

    const existingDriver = await prisma.driver.findUnique({
      where: { cpf: data.cpf },
      select: { id: true }
    });
    if (existingDriver) {
      return NextResponse.json({ error: DUPLICATE_CPF }, { status: 409 });
    }

    // E-mails antigos podem ter maiúsculas; a comparação ignora a caixa.
    const existingUser = await prisma.user.findFirst({
      where: { email: { equals: data.email, mode: 'insensitive' } },
      select: { id: true }
    });
    if (existingUser) {
      return NextResponse.json({ error: DUPLICATE_EMAIL }, { status: 409 });
    }

    // É com este e-mail e esta senha que o motorista entra no aplicativo. A
    // senha não é devolvida nem registrada em log.
    const password = await bcrypt.hash(data.password, BCRYPT_ROUNDS);

    try {
      // O Driver exige um User. Os dois nascem na mesma transação: se o Driver
      // falhar, o User não fica órfão ocupando o e-mail.
      const newDriver = await prisma.$transaction(async (tx) => {
        const newUser = await tx.user.create({
          data: {
            name: data.name,
            email: data.email,
            password,
            role: 'DRIVER'
          },
          select: { id: true }
        });

        return tx.driver.create({
          data: {
            userId: newUser.id,
            cpf: data.cpf,
            cnh: data.cnh,
            cnhExpiry: data.cnhExpiry,
            category: data.category,
            phone: data.phone,
          },
          include: DRIVER_PUBLIC_INCLUDE,
        });
      });

      return NextResponse.json(newDriver, { status: 201 });
    } catch (err) {
      // Duas criações simultâneas: a segunda bate no índice único do CPF ou do
      // e-mail e a transação inteira é desfeita.
      if (isUniqueViolation(err)) {
        const cpfTaken = await prisma.driver.findUnique({ where: { cpf: data.cpf }, select: { id: true } });
        return NextResponse.json({ error: cpfTaken ? DUPLICATE_CPF : DUPLICATE_EMAIL }, { status: 409 });
      }
      throw err;
    }
  } catch (error) {
    console.error('Error creating driver:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
