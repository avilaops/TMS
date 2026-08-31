import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import bcrypt from 'bcryptjs';

/**
 * Cria/reseta o usuário administrador em ambiente de desenvolvimento.
 *
 * Este endpoint reseta a senha do admin, então NUNCA pode ficar aberto:
 *  - responde 404 em produção;
 *  - só aceita POST (um GET era disparável por qualquer link, crawler ou prefetch);
 *  - exige o header `x-seed-secret` conferindo com SEED_SECRET do .env.
 *
 * Para popular dados fora de desenvolvimento, use `prisma/seed.ts` ou
 * `scripts/seed-admin.js` pela linha de comando.
 */
export async function POST(request: Request) {
  if (process.env.NODE_ENV === 'production') {
    return new NextResponse(null, { status: 404 });
  }

  const secret = process.env.SEED_SECRET;

  if (!secret || request.headers.get('x-seed-secret') !== secret) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  try {
    const email = 'admin@mello.com.br';
    const password = process.env.SEED_ADMIN_PASSWORD;

    if (!password) {
      return NextResponse.json(
        { error: 'Defina SEED_ADMIN_PASSWORD no .env antes de rodar o seed.' },
        { status: 400 }
      );
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.upsert({
      where: { email },
      update: { password: hashedPassword, role: 'ADMIN' },
      create: {
        name: 'Administrador Mello',
        email,
        password: hashedPassword,
        role: 'ADMIN',
      },
      // Nunca devolver o hash da senha na resposta.
      select: { id: true, name: true, email: true, role: true },
    });

    return NextResponse.json({ message: 'Administrador pronto', user });
  } catch (error) {
    console.error('Erro no seed:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
