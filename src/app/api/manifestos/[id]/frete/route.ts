import { NextResponse } from 'next/server';
import prisma, { transacao } from '@/lib/prisma';
import { requireStaff } from '@/lib/staff';
import { Refusal } from '@/lib/cadastros';
import { firstIssue } from '@/lib/usuarios';
import {
  CAMPOS_DO_CONTRATO,
  CARRIER_LOCKED_BY_PAYMENTS,
  CARRIER_NOT_FOUND_OR_INACTIVE,
  CONTRACT_HAS_PAYMENTS,
  CONTRACT_NOT_FOUND,
  CONTRACT_SELECT,
  LIQUIDO_MENOR_QUE_O_PAGO,
  QUITARIA_ANTES_DE_FINALIZAR,
  TRIP_CANCELLED_NO_CONTRACT,
  baseDaViagem,
  contratoSchema,
  situacaoDoContrato,
  totalPago,
  valoresDoContrato,
} from '@/lib/frete-contratado';
import { VIAGEM_DO_FRETE_SELECT, contratoComContas } from '@/lib/frete-contratado-db';
import { ManifestError, lockManifest } from '@/lib/manifestos-db';
import { TRIP_NOT_FOUND, codigoDaViagem } from '@/lib/viagem';
import { escolher, nadaMudou, origemDaRequisicao, registrarAuditoria } from '@/lib/auditoria';

type Contexto = { params: Promise<{ id: string }> };

const recusa = (err: unknown) => {
  if (err instanceof Refusal || err instanceof ManifestError) return NextResponse.json({ error: err.message }, { status: err.status });
  return null;
};

/**
 * O frete contratado da viagem, para a aba Frete: o contrato (ou `null`, se a
 * viagem não tem), com os valores, os pagamentos, o saldo e o valor que a
 * forma de cálculo sugere hoje; o que a viagem tem para essa sugestão (frete
 * das cargas, km e entregas); o parceiro dono do veículo; e os parceiros que
 * podem ser escolhidos à mão. É dinheiro: só quem lê o frete contratado.
 */
export async function GET(_req: Request, { params }: Contexto) {
  const { error } = await requireStaff({ pode: 'freteContratadoVer' });
  if (error) return error;

  try {
    const manifestId = (await params).id;

    // Uma consulta por vez: cada uma abre a própria transação (src/lib/prisma.ts).
    const viagem = await prisma.manifest.findUnique({
      where: { id: manifestId },
      select: { ...VIAGEM_DO_FRETE_SELECT, freightContract: { select: CONTRACT_SELECT } },
    });
    if (!viagem) return NextResponse.json({ error: TRIP_NOT_FOUND }, { status: 404 });

    const contrato = viagem.freightContract;
    // Os ativos e, mesmo desativado depois, o parceiro do contrato desta viagem.
    const parceiros = await prisma.carrier.findMany({
      where: { OR: [{ active: true }, ...(contrato ? [{ id: contrato.carrierId }] : [])] },
      select: { id: true, name: true, type: true, active: true, defaultCalcMode: true, defaultCalcBase: true },
      orderBy: { name: 'asc' },
    });

    const base = baseDaViagem(viagem);
    const doVeiculo = viagem.vehicle.carrier;
    return NextResponse.json({
      viagem: { id: viagem.id, status: viagem.status, ...base },
      parceiroDoVeiculo: doVeiculo ? { id: doVeiculo.id, name: doVeiculo.name } : null,
      contrato: contrato ? contratoComContas(contrato, base) : null,
      parceiros,
    });
  } catch (error) {
    console.error('Erro ao ler o frete contratado da viagem:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

/**
 * Grava o contrato de frete da viagem: cria, se ela não tem, ou troca o
 * parceiro, a forma de cálculo e os valores do que existe. Gravar um contrato
 * cancelado o reabre. Viagem cancelada não recebe contrato.
 *
 * As retenções são valores digitados: nada aqui calcula imposto. Com pagamento
 * registrado, o parceiro não muda, o líquido não pode ficar menor que o pago, e
 * a mudança não pode quitar o contrato de uma viagem ainda não finalizada.
 */
export async function PUT(req: Request, { params }: Contexto) {
  const { user, error } = await requireStaff({ pode: 'freteContratado' });
  if (error) return error;

  try {
    const manifestId = (await params).id;
    const parsed = contratoSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const data = parsed.data;
    const origem = origemDaRequisicao(req);

    const resposta = await transacao(async (tx) => {
      // Segura a viagem: cancelar a viagem e pagar o contrato correm um depois do outro.
      const manifesto = await lockManifest(tx, manifestId);
      if (manifesto.status === 'CANCELLED') throw new Refusal(TRIP_CANCELLED_NO_CONTRACT, 409);

      const viagem = await tx.manifest.findUniqueOrThrow({ where: { id: manifestId }, select: VIAGEM_DO_FRETE_SELECT });
      const atual = await tx.freightContract.findUnique({ where: { manifestId }, select: CONTRACT_SELECT });

      const parceiro = await tx.carrier.findUnique({ where: { id: data.carrierId }, select: { id: true, name: true, active: true } });
      // Desativado só continua valendo no contrato que já era dele.
      if (!parceiro || (!parceiro.active && parceiro.id !== atual?.carrierId)) throw new Refusal(CARRIER_NOT_FOUND_OR_INACTIVE, 400);

      const pagamentos = atual?.payments ?? [];
      if (atual && pagamentos.length > 0 && atual.carrierId !== parceiro.id) throw new Refusal(CARRIER_LOCKED_BY_PAYMENTS, 409);

      const pago = totalPago(pagamentos);
      const { liquido } = valoresDoContrato(data);
      if (pago > liquido) throw new Refusal(LIQUIDO_MENOR_QUE_O_PAGO, 409);
      const status = situacaoDoContrato({ cancelado: false, liquido, pago });
      if (status === 'QUITADO' && atual?.status !== 'QUITADO' && manifesto.status !== 'FINISHED') throw new Refusal(QUITARIA_ANTES_DE_FINALIZAR, 409);

      const campos = {
        carrierId: parceiro.id,
        calcMode: data.calcMode,
        calcBase: data.calcBase,
        grossAmount: data.grossAmount,
        tollAmount: data.tollAmount,
        otherAdditions: data.otherAdditions,
        discounts: data.discounts,
        inss: data.inss,
        irrf: data.irrf,
        sestSenat: data.sestSenat,
        otherWithholdings: data.otherWithholdings,
        notes: data.notes ?? null,
        status,
      };
      const gravado = atual
        ? await tx.freightContract.update({ where: { id: atual.id }, data: campos, select: CONTRACT_SELECT })
        : await tx.freightContract.create({ data: { manifestId, ...campos }, select: CONTRACT_SELECT });

      const antes = atual ? escolher(atual, CAMPOS_DO_CONTRATO) : null;
      const depois = escolher(gravado, CAMPOS_DO_CONTRATO);
      if (!antes || !nadaMudou(antes, depois)) {
        await registrarAuditoria(tx, {
          ator: user,
          origem,
          acao: atual ? 'frete-contratado.alterar' : 'frete-contratado.criar',
          entidade: 'frete-contratado',
          entidadeId: gravado.id,
          resumo: `Frete contratado da viagem #${codigoDaViagem(manifestId)} com ${parceiro.name} ${atual ? 'alterado' : 'criado'}`,
          antes,
          depois,
        });
      }

      return { criado: !atual, contrato: contratoComContas(gravado, baseDaViagem(viagem)) };
    });

    return NextResponse.json(resposta.contrato, { status: resposta.criado ? 201 : 200 });
  } catch (err) {
    const resposta = recusa(err);
    if (resposta) return resposta;
    console.error('Erro ao gravar o frete contratado da viagem:', err);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

/**
 * Cancela o contrato de frete da viagem (a viagem segue). Só sem pagamento
 * registrado: com pagamento, a recusa manda excluir os pagamentos antes. O
 * contrato cancelado fica como histórico, sai do custo da viagem e pode ser
 * reaberto gravando de novo (`PUT`).
 */
export async function DELETE(req: Request, { params }: Contexto) {
  const { user, error } = await requireStaff({ pode: 'freteContratado' });
  if (error) return error;

  try {
    const manifestId = (await params).id;
    const origem = origemDaRequisicao(req);

    const contrato = await transacao(async (tx) => {
      await lockManifest(tx, manifestId);
      const viagem = await tx.manifest.findUniqueOrThrow({ where: { id: manifestId }, select: VIAGEM_DO_FRETE_SELECT });
      const atual = await tx.freightContract.findUnique({ where: { manifestId }, select: CONTRACT_SELECT });
      if (!atual) throw new Refusal(CONTRACT_NOT_FOUND, 404);
      if (atual.status === 'CANCELADO') return contratoComContas(atual, baseDaViagem(viagem));
      if (atual.payments.length > 0) throw new Refusal(CONTRACT_HAS_PAYMENTS, 409);

      const cancelado = await tx.freightContract.update({ where: { id: atual.id }, data: { status: 'CANCELADO' }, select: CONTRACT_SELECT });
      await registrarAuditoria(tx, {
        ator: user,
        origem,
        acao: 'frete-contratado.cancelar',
        entidade: 'frete-contratado',
        entidadeId: atual.id,
        resumo: `Frete contratado da viagem #${codigoDaViagem(manifestId)} com ${atual.carrier.name} cancelado`,
        antes: escolher(atual, CAMPOS_DO_CONTRATO),
        depois: escolher(cancelado, CAMPOS_DO_CONTRATO),
      });
      return contratoComContas(cancelado, baseDaViagem(viagem));
    });

    return NextResponse.json(contrato);
  } catch (err) {
    const resposta = recusa(err);
    if (resposta) return resposta;
    console.error('Erro ao cancelar o frete contratado da viagem:', err);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
