import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import prisma, { sistema, transacao } from '@/lib/prisma';
import { COMMISSION_ADMIN_ONLY, DRIVER_PUBLIC_INCLUDE, Refusal, isUniqueViolation, updateDriverSchema } from '@/lib/cadastros';
import { firstIssue } from '@/lib/usuarios';
import { dadosDoConvite, liberarAcesso, revogarAcesso } from '@/lib/acessos';
import { nadaMudou, origemDaRequisicao, registrarAuditoria, registrarAuditoriaDepois } from '@/lib/auditoria';

const DUPLICATE_EMAIL = 'Já existe um usuário com este e-mail.';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireStaff();
  if (error) return error;

  try {
    const { id } = await params;

    const parsed = updateDriverSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const data = parsed.data;

    // Comissão é dinheiro: a operação cuida do cadastro, mas não deste campo.
    const admin = user.role === 'ADMIN';
    if (data.commissionPct !== undefined && !admin) {
      return NextResponse.json({ error: COMMISSION_ADMIN_ONLY }, { status: 403 });
    }

    // Nome e e-mail ficam no User; o resto, no Driver. Uma transação só:
    // ou muda tudo, ou não muda nada.
    let emailAnterior: string | null = null;
    const origem = origemDaRequisicao(req);

    const motorista = await transacao(async (tx) => {
      // Além do que a regra precisa, o cadastro como estava: é o "antes" da auditoria.
      const target = await tx.driver.findUnique({
        where: { id },
        select: {
          id: true,
          userId: true,
          cnh: true,
          category: true,
          cnhExpiry: true,
          phone: true,
          active: true,
          commissionPct: true,
          user: { select: { role: true, email: true, name: true } },
        }
      });
      if (!target) throw new Refusal('Motorista não encontrado.', 404);
      // Cadastro antigo pode ligar o motorista a um usuário de outro perfil:
      // por aqui ninguém troca o e-mail de uma conta que não é de motorista.
      // Desativar continua valendo: só mexe no Driver e é o que tira o acesso.
      const changed = Object.keys(data).filter((key) => data[key as keyof typeof data] !== undefined);
      const onlyDeactivating = data.active === false && changed.length === 1;
      if (target.user.role !== 'DRIVER' && !onlyDeactivating) {
        throw new Refusal('O usuário deste motorista não tem perfil de motorista.', 409);
      }

      if (data.email !== undefined) {
        // E-mails antigos podem ter maiúsculas; a comparação ignora a caixa.
        const other = await tx.user.findFirst({
          where: { email: { equals: data.email, mode: 'insensitive' }, id: { not: target.userId } },
          select: { id: true }
        });
        if (other) throw new Refusal(DUPLICATE_EMAIL, 409);
      }

      if (data.name !== undefined || data.email !== undefined) {
        await tx.user.update({
          where: { id: target.userId },
          data: {
            name: data.name,
            email: data.email,
          },
          select: { id: true }
        });
      }

      if (data.email !== undefined && data.email !== target.user.email.toLowerCase()) {
        emailAnterior = target.user.email;
      }

      // `active: false` é o que barra o acesso: `requireDriver` recusa inativo.
      const atualizado = await tx.driver.update({
        where: { id },
        data: {
          cnh: data.cnh,
          category: data.category,
          cnhExpiry: data.cnhExpiry,
          phone: data.phone,
          active: data.active,
          commissionPct: data.commissionPct,
        },
        include: DRIVER_PUBLIC_INCLUDE,
      });

      const campos = (m: { cnh: string | null; category: string | null; cnhExpiry: Date | null; phone: string | null; active: boolean; commissionPct: number | null }, u: { name: string; email: string }) => ({
        name: u.name,
        email: u.email,
        cnh: m.cnh,
        category: m.category,
        cnhExpiry: m.cnhExpiry,
        phone: m.phone,
        active: m.active,
        commissionPct: m.commissionPct,
      });
      const antes = campos(target, target.user);
      const depois = campos(atualizado, atualizado.user);
      if (!nadaMudou(antes, depois)) {
        const desativou = antes.active && !depois.active;
        const reativou = !antes.active && depois.active;
        // Só o percentual mudou: a linha diz isso, em vez de um "alterado" genérico.
        const soComissao = !nadaMudou({ commissionPct: antes.commissionPct }, { commissionPct: depois.commissionPct })
          && nadaMudou({ ...antes, commissionPct: null }, { ...depois, commissionPct: null });
        await registrarAuditoria(tx, {
          ator: user,
          origem,
          acao: desativou ? 'motorista.desativar' : reativou ? 'motorista.reativar' : soComissao ? 'motorista.comissao' : 'motorista.alterar',
          entidade: 'motorista',
          entidadeId: id,
          resumo: soComissao
            ? `Comissão de ${depois.name} ${depois.commissionPct === null ? 'retirada' : `passou para ${depois.commissionPct}%`}`
            : `Motorista ${depois.name} ${desativou ? 'desativado' : reativou ? 'reativado' : 'alterado'}`,
          antes,
          depois,
        });
      }

      // O percentual só volta para quem pode vê-lo.
      return admin ? atualizado : { ...atualizado, commissionPct: undefined };
    });

    // E-mail novo é outra conta no login único: libera a nova e revoga a
    // antiga, se nenhum outro cadastro (em qualquer empresa) ainda a usa.
    if (emailAnterior) {
      const acesso = await liberarAcesso({
        email: motorista.user.email,
        nome: motorista.user.name,
        cpf: motorista.cpf,
        telefone: motorista.phone,
      }, { convidadoPor: user.name });
      const convite = dadosDoConvite(acesso);
      await sistema.user.update({ where: { id: motorista.userId }, data: convite, select: { id: true } });
      await registrarAuditoriaDepois(prisma, {
        ator: user,
        origem,
        acao: 'usuario.acesso.liberar',
        entidade: 'usuario',
        entidadeId: motorista.userId,
        resumo: `Acesso de ${motorista.user.name} pedido ao login único: ${convite.inviteDetail}`,
        depois: { email: motorista.user.email, inviteStatus: convite.inviteStatus },
      });
      const aindaUsado = await sistema.user.count({
        where: { email: { equals: emailAnterior, mode: 'insensitive' } },
      });
      if (aindaUsado === 0) {
        const revogado = await revogarAcesso(emailAnterior);
        await registrarAuditoriaDepois(prisma, {
          ator: user,
          origem,
          acao: 'usuario.acesso.revogar',
          entidade: 'usuario',
          entidadeId: motorista.userId,
          resumo: revogado
            ? `Acesso do e-mail anterior de ${motorista.user.name} revogado no login único`
            : `Revogação do e-mail anterior de ${motorista.user.name} pedida ao login único, sem confirmação`,
          antes: { email: emailAnterior },
        });
      }
      return NextResponse.json({ ...motorista, acesso });
    }

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
