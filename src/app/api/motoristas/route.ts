import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import prisma, { transacao } from '@/lib/prisma';
import { DRIVER_PUBLIC_INCLUDE, createDriverSchema, isUniqueViolation } from '@/lib/cadastros';
import { DRIVER_OMIT, firstIssue } from '@/lib/usuarios';
import { dadosDoConvite, liberarAcesso, senhaSemUso } from '@/lib/acessos';
import { origemDaRequisicao, registrarAuditoria, registrarAuditoriaDepois } from '@/lib/auditoria';

const DUPLICATE_CPF = 'Já existe um motorista com este CPF.';
const DUPLICATE_EMAIL = 'Já existe um usuário com este e-mail.';

export async function GET() {
  const { user, error } = await requireStaff();
  if (error) return error;

  try {
    const motoristas = await prisma.driver.findMany({
      include: DRIVER_PUBLIC_INCLUDE,
      // O percentual de comissão só vai para o administrador.
      omit: user.role === 'ADMIN' ? undefined : DRIVER_OMIT,
      orderBy: { createdAt: 'desc' }
    });
    return NextResponse.json(motoristas);
  } catch (error) {
    console.error('Error fetching drivers:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const { user, error } = await requireStaff();
  if (error) return error;

  try {
    const parsed = createDriverSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const data = parsed.data;

    const existingDriver = await prisma.driver.findFirst({
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

    const origem = origemDaRequisicao(req);

    try {
      // O Driver exige um User. Os dois nascem na mesma transação: se o Driver
      // falhar, o User não fica órfão ocupando o e-mail.
      const newDriver = await transacao(async (tx) => {
        const newUser = await tx.user.create({
          data: {
            name: data.name,
            email: data.email,
            password: senhaSemUso(),
            role: 'DRIVER'
          },
          select: { id: true }
        });

        const criado = await tx.driver.create({
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

        await registrarAuditoria(tx, {
          ator: user,
          origem,
          acao: 'motorista.criar',
          entidade: 'motorista',
          entidadeId: criado.id,
          resumo: `Motorista ${data.name} criado`,
          depois: { name: data.name, email: data.email, cpf: criado.cpf, cnh: criado.cnh, cnhExpiry: criado.cnhExpiry, category: criado.category, phone: criado.phone },
        });

        return criado;
      });

      // O motorista entra no aplicativo pelo login único: garante a conta lá
      // (com CPF e telefone, que ele pode usar para entrar) e libera o TMS.
      const acesso = await liberarAcesso({ email: data.email, nome: data.name, cpf: data.cpf, telefone: data.phone }, { convidadoPor: user.name });
      const convite = dadosDoConvite(acesso);
      await prisma.user.update({ where: { id: newDriver.userId }, data: convite, select: { id: true } });
      await registrarAuditoriaDepois(prisma, {
        ator: user,
        origem,
        acao: 'usuario.acesso.liberar',
        entidade: 'usuario',
        entidadeId: newDriver.userId,
        resumo: `Acesso de ${data.name} pedido ao login único: ${convite.inviteDetail}`,
        depois: { email: data.email, inviteStatus: convite.inviteStatus },
      });
      return NextResponse.json({ ...newDriver, acesso }, { status: 201 });
    } catch (err) {
      // Duas criações simultâneas: a segunda bate no índice único do CPF ou do
      // e-mail e a transação inteira é desfeita.
      if (isUniqueViolation(err)) {
        const cpfTaken = await prisma.driver.findFirst({ where: { cpf: data.cpf }, select: { id: true } });
        return NextResponse.json({ error: cpfTaken ? DUPLICATE_CPF : DUPLICATE_EMAIL }, { status: 409 });
      }
      throw err;
    }
  } catch (error) {
    console.error('Error creating driver:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
