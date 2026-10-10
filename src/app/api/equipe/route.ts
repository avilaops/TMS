import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import prisma from '@/lib/prisma';
import { diaNoBrasil } from '@/lib/financeiro';
import { ABSENCE_SELECT, HELPER_SELECT, ausentesNoDia, chaveDaPessoa } from '@/lib/equipe';

/**
 * As pessoas da equipe de estrada, numa lista só: motoristas (do cadastro de
 * motoristas) e ajudantes, com quem está ausente hoje. Hoje é o dia no relógio
 * do Brasil. Não traz dinheiro: é da equipe interna inteira.
 */
export async function GET() {
  const { error } = await requireStaff({ pode: 'equipeVer' });
  if (error) return error;

  try {
    const hoje = diaNoBrasil(new Date());
    const dia = new Date(`${hoje}T00:00:00.000Z`);

    // Uma consulta por vez: cada uma abre a própria transação (src/lib/prisma.ts).
    const motoristas = await prisma.driver.findMany({
      select: { id: true, cpf: true, phone: true, active: true, user: { select: { name: true } } },
    });
    const ajudantes = await prisma.helper.findMany({ select: HELPER_SELECT });
    const ausencias = await prisma.absence.findMany({
      where: { startDate: { lte: dia }, endDate: { gte: dia } },
      select: ABSENCE_SELECT,
    });
    const ausentes = ausentesNoDia(ausencias, hoje);

    const pessoa = (tipo: 'motorista' | 'ajudante', dados: { id: string; nome: string; cpf: string; telefone: string | null; ativo: boolean }) => {
      const chave = chaveDaPessoa(tipo === 'motorista' ? { driverId: dados.id, helperId: null } : { driverId: null, helperId: dados.id });
      const ausencia = ausentes.get(chave);
      return {
        chave,
        tipo,
        ...dados,
        ausencia: ausencia ? { id: ausencia.id, type: ausencia.type, startDate: ausencia.startDate, endDate: ausencia.endDate } : null,
      };
    };

    const pessoas = [
      ...motoristas.map((m) => pessoa('motorista', { id: m.id, nome: m.user.name, cpf: m.cpf, telefone: m.phone, ativo: m.active })),
      ...ajudantes.map((a) => pessoa('ajudante', { id: a.id, nome: a.name, cpf: a.cpf, telefone: a.phone, ativo: a.active })),
    ].sort((a, b) => Number(b.ativo) - Number(a.ativo) || a.nome.localeCompare(b.nome, 'pt-BR'));

    return NextResponse.json({ hoje, pessoas });
  } catch (error) {
    console.error('Erro ao listar a equipe:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
