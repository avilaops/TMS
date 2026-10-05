import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import prisma from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { DRIVER_PUBLIC_INCLUDE, Refusal, isUniqueViolation, updateDriverSchema } from '@/lib/cadastros';
import { BCRYPT_ROUNDS, firstIssue } from '@/lib/usuarios';

const DUPLICATE_EMAIL = 'Já existe um usuário com este e-mail.';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireStaff();
  if (error) return error;

  try {
    const { id } = await params;

    const parsed = updateDriverSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const data = parsed.data;
    const passwordHash = data.password ? await bcrypt.hash(data.password, BCRYPT_ROUNDS) : undefined;

    // Nome, e-mail e senha ficam no User; o resto, no Driver. Uma transação só:
    // ou muda tudo, ou não muda nada.
    const motorista = await prisma.$transaction(async (tx) => {
      const target = await tx.driver.findUnique({ where: { id }, select: { id: true, userId: true } });
      if (!target) throw new Refusal('Motorista não encontrado.', 404);

      if (data.email !== undefined) {
        // E-mails antigos podem ter maiúsculas; a comparação ignora a caixa.
        const other = await tx.user.findFirst({
          where: { email: { equals: data.email, mode: 'insensitive' }, id: { not: target.userId } },
          select: { id: true }
        });
        if (other) throw new Refusal(DUPLICATE_EMAIL, 409);
      }

      if (data.name !== undefined || data.email !== undefined || passwordHash) {
        await tx.user.update({
          where: { id: target.userId },
          data: {
            name: data.name,
            email: data.email,
            ...(passwordHash && { password: passwordHash }),
          },
          select: { id: true }
        });
      }

      // `active: false` é o que barra o acesso: `requireDriver` recusa inativo.
      return tx.driver.update({
        where: { id },
        data: {
          cnh: data.cnh,
          category: data.category,
          cnhExpiry: data.cnhExpiry,
          phone: data.phone,
          active: data.active,
        },
        include: DRIVER_PUBLIC_INCLUDE,
      });
    });

    return NextResponse.json(motorista);
  } catch (err) {
    if (err instanceof Refusal) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (isUniqueViolation(err)) {
      return NextResponse.json({ error: DUPLICATE_EMAIL }, { status: 409 });
    }
    console.error('Error updating driver:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
