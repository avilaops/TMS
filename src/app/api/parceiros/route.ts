import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import { pode } from '@/lib/permissoes';
import prisma from '@/lib/prisma';
import { isUniqueViolation } from '@/lib/cadastros';
import { firstIssue } from '@/lib/usuarios';
import {
  CAMPOS_DA_CONTRATACAO,
  CAMPOS_DO_PARCEIRO,
  CARRIER_SELECT,
  CARRIER_VALUES_SELECT,
  CONTRATACAO_SO_DE_QUEM_PAGA,
  DUPLICATE_CARRIER,
  createCarrierSchema,
} from '@/lib/parceiros';
import { CONTRACT_COST_SELECT, emAberto } from '@/lib/frete-contratado';
import { escolher, origemDaRequisicao, registrarAuditoriaDepois } from '@/lib/auditoria';

const centavos = (valor: number) => Math.round((valor + Number.EPSILON) * 100) / 100;

/**
 * Os parceiros de transporte da empresa, com os veículos e os motoristas
 * ligados a cada um. Ativos e inativos: a tela mostra o selo e é por ela que
 * se reativa.
 *
 * O que é dinheiro (a forma padrão de contratação e o total em aberto a pagar)
 * só vai para quem lê o frete contratado; para os demais os campos nem vão na
 * resposta.
 */
export async function GET() {
  const { user, error } = await requireStaff({ pode: 'parceirosVer' });
  if (error) return error;

  try {
    const comValores = pode(user.role, 'freteContratadoVer');
    const parceiros = await prisma.carrier.findMany({
      select: {
        ...CARRIER_SELECT,
        vehicles: { select: { id: true, plate: true, model: true }, orderBy: { plate: 'asc' } },
        drivers: { select: { id: true, active: true, user: { select: { name: true } } }, orderBy: { createdAt: 'asc' } },
        ...CARRIER_VALUES_SELECT,
        // Só os contratos que ainda podem dever: quitado e cancelado não somam.
        contracts: { where: { status: { in: ['ABERTO', 'ADIANTADO'] } }, select: { ...CONTRACT_COST_SELECT, payments: { select: { amount: true, kind: true } } } },
      },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    });

    return NextResponse.json(
      parceiros.map(({ contracts, defaultCalcMode, defaultCalcBase, ...cadastro }) =>
        comValores
          ? { ...cadastro, defaultCalcMode, defaultCalcBase, emAberto: centavos(contracts.reduce((soma, contrato) => soma + emAberto(contrato), 0)) }
          : cadastro,
      ),
    );
  } catch (error) {
    console.error('Erro ao listar parceiros:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const { user, error } = await requireStaff({ pode: 'parceiros' });
  if (error) return error;

  try {
    const parsed = createCarrierSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const { defaultCalcMode, defaultCalcBase, ...data } = parsed.data;

    // A forma padrão de contratação é dinheiro: quem só cuida do cadastro não a grava.
    // Em branco (`null`) ou ausente é cadastro sem padrão: isso qualquer um que cadastra pode.
    const comContratacao = (defaultCalcMode ?? null) !== null || (defaultCalcBase ?? null) !== null;
    const alteraValores = pode(user.role, 'freteContratado');
    if (comContratacao && !alteraValores) {
      return NextResponse.json({ error: CONTRATACAO_SO_DE_QUEM_PAGA }, { status: 403 });
    }

    // `data.taxId` já vem sem pontuação: com ou sem máscara é o mesmo parceiro.
    const existente = await prisma.carrier.findFirst({ where: { taxId: data.taxId }, select: { id: true } });
    if (existente) return NextResponse.json({ error: DUPLICATE_CARRIER }, { status: 409 });

    try {
      const criado = await prisma.carrier.create({
        data: { ...data, defaultCalcMode: defaultCalcMode ?? null, defaultCalcBase: defaultCalcBase ?? null },
        select: { ...CARRIER_SELECT, ...CARRIER_VALUES_SELECT },
      });

      await registrarAuditoriaDepois(prisma, {
        ator: user,
        origem: origemDaRequisicao(req),
        acao: 'parceiro.criar',
        entidade: 'parceiro',
        entidadeId: criado.id,
        resumo: `Parceiro ${criado.name} criado`,
        depois: escolher(criado, [...CAMPOS_DO_PARCEIRO, ...CAMPOS_DA_CONTRATACAO]),
      });

      // A forma padrão só volta para quem pode vê-la.
      const { defaultCalcMode: forma, defaultCalcBase: base, ...cadastro } = criado;
      return NextResponse.json(pode(user.role, 'freteContratadoVer') ? { ...cadastro, defaultCalcMode: forma, defaultCalcBase: base } : cadastro, { status: 201 });
    } catch (err) {
      // Duas criações simultâneas com o mesmo documento: a segunda bate no índice único.
      if (isUniqueViolation(err)) return NextResponse.json({ error: DUPLICATE_CARRIER }, { status: 409 });
      throw err;
    }
  } catch (error) {
    console.error('Erro ao criar parceiro:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
