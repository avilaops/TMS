import { NextResponse } from 'next/server';
import prisma, { empresaAtual } from '@/lib/prisma';
import { requireDriver } from '@/lib/driver';
import { MES_MESSAGE, type RemuneracaoDoMotorista, contaCongelada, mesAtual, mesValido } from '@/lib/remuneracao';
import { CLOSING_SELECT, contaDaPessoa } from '@/lib/remuneracao-db';

/**
 * O que as viagens finalizadas do motorista logado renderam no mês
 * (`?mes=AAAA-MM`; sem ele, o mês corrente) e o total. Só leitura.
 *
 * Só responde com valores se a empresa ligou isso em Empresa
 * (`Tenant.driverPayVisible`, desligado por padrão): com o interruptor
 * desligado a resposta é `{ visivel: false }` e nenhum valor sai do servidor.
 *
 * Nunca devolve nada de outro motorista: o filtro é o `driverId` da sessão
 * (`requireDriver`), e o banco só enxerga a empresa dela. Mês fechado vem com
 * os valores congelados no fechamento. Não vão os adiantamentos, o saldo, o
 * frete das cargas nem as formas do cadastro: só o que cada viagem rendeu.
 */
export async function GET(req?: Request) {
  const { driverId, error } = await requireDriver();
  if (error) return error;

  try {
    const empresa = await prisma.tenant.findUnique({ where: { id: await empresaAtual() }, select: { driverPayVisible: true } });
    if (!empresa?.driverPayVisible) return NextResponse.json({ visivel: false } satisfies RemuneracaoDoMotorista);

    const mes = (req ? new URL(req.url).searchParams.get('mes') : null) ?? mesAtual();
    if (!mesValido(mes)) return NextResponse.json({ error: MES_MESSAGE }, { status: 400 });

    const fechamento = await prisma.crewPayClosing.findFirst({ where: { driverId, month: mes }, select: CLOSING_SELECT });
    const conta = fechamento ? contaCongelada(fechamento) : (await contaDaPessoa(prisma, { driverId, helperId: null }, mes))?.conta;

    const resposta: RemuneracaoDoMotorista = {
      visivel: true,
      mes,
      fechado: Boolean(fechamento),
      total: conta?.variavel ?? 0,
      viagens: (conta?.viagens ?? []).map(({ manifestId, codigo, finalizada, placa, dias, km, entregas, parcelas, total, semKm, fora }) => ({ manifestId, codigo, finalizada, placa, dias, km, entregas, parcelas, total, semKm, fora })),
    };
    return NextResponse.json(resposta);
  } catch (error) {
    console.error('Erro ao montar a remuneração do motorista:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
