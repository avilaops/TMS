import { NextResponse } from 'next/server';
import prisma, { transacao } from '@/lib/prisma';
import { requireStaff } from '@/lib/staff';
import { Refusal } from '@/lib/cadastros';
import { firstIssue } from '@/lib/usuarios';
import {
  CAMPOS_DO_DOCUMENTO,
  CARGA_FORA_DA_VIAGEM,
  DOCUMENTO_JA_REGISTRADO,
  DOCUMENT_SELECT,
  ROTULO_DO_DOCUMENTO,
  SEM_CONTRATO_COM_TRANSPORTADORA,
  VIAGEM_CANCELADA_SEM_DOCUMENTO,
  contratoComTransportadora,
  documentoSchema,
  problemaDaChave,
} from '@/lib/subcontratacao';
import { documentoParaATela, lerSubcontratacao } from '@/lib/subcontratacao-db';
import { ManifestError, lockManifest } from '@/lib/manifestos-db';
import { TRIP_NOT_FOUND, codigoDaViagem } from '@/lib/viagem';
import { escolher, origemDaRequisicao, registrarAuditoria } from '@/lib/auditoria';

type Contexto = { params: Promise<{ id: string }> };

/**
 * A subcontratação da viagem: a transportadora do contrato de frete, o CT-e
 * dela por carga, o MDF-e dela por UF de descarregamento e o que falta. São
 * documentos fiscais, sem valor nenhum do contrato: quem lê o fiscal recebe
 * (a operação precisa da chave do MDF-e da subcontratada para liberar a saída).
 */
export async function GET(_req: Request, { params }: Contexto) {
  const { error } = await requireStaff({ pode: 'fiscalVer' });
  if (error) return error;

  try {
    const subcontratacao = await lerSubcontratacao(prisma, (await params).id);
    if (!subcontratacao) return NextResponse.json({ error: TRIP_NOT_FOUND }, { status: 404 });
    return NextResponse.json(subcontratacao);
  } catch (error) {
    console.error('Erro ao ler a subcontratação da viagem:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

/**
 * Registra a chave de um documento que a transportadora subcontratada emitiu
 * para a viagem: o CT-e de subcontratação dela (de uma carga) ou o MDF-e dela
 * (de uma UF de descarregamento). Só guarda: nada é emitido nem consultado na
 * SEFAZ por aqui.
 *
 * A chave tem de ser do modelo certo (57 ou 58), com o dígito verificador, e
 * emitida pelo CNPJ do parceiro do contrato. O MDF-e registrado cobre a UF na
 * liberação da saída quando o veículo da viagem é dela (src/lib/mdfe-db.ts):
 * por isso o registro fica na Auditoria, com quem registrou.
 */
export async function POST(req: Request, { params }: Contexto) {
  const { user, error } = await requireStaff({ pode: 'fiscal' });
  if (error) return error;

  try {
    const manifestId = (await params).id;
    const parsed = documentoSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const data = parsed.data;
    const origem = origemDaRequisicao(req);

    const documento = await transacao(async (tx) => {
      // Segura a viagem: dois registros da mesma chave correm um depois do outro, e o segundo encontra o primeiro.
      const manifesto = await lockManifest(tx, manifestId);
      if (manifesto.status === 'CANCELLED') throw new Refusal(VIAGEM_CANCELADA_SEM_DOCUMENTO, 409);

      const contrato = await tx.freightContract.findUnique({
        where: { manifestId },
        select: { id: true, status: true, carrierId: true, carrier: { select: { name: true, taxId: true, type: true } } },
      });
      if (!contratoComTransportadora(contrato)) throw new Refusal(SEM_CONTRATO_COM_TRANSPORTADORA, 409);

      const problema = problemaDaChave(data.kind, data.accessKey, contrato.carrier);
      if (problema) throw new Refusal(problema, 400);

      const carga = data.collectionId
        ? await tx.collection.findFirst({ where: { id: data.collectionId, manifestId }, select: { id: true, trackingCode: true } })
        : null;
      if (data.collectionId && !carga) throw new Refusal(CARGA_FORA_DA_VIAGEM, 400);

      // O mesmo CT-e da subcontratada pode cobrir mais de uma carga; a mesma chave duas vezes na mesma carga (ou o mesmo MDF-e duas vezes), não.
      const repetido = await tx.subcontractDocument.findFirst({
        where: { contractId: contrato.id, accessKey: data.accessKey, collectionId: data.collectionId },
        select: { id: true },
      });
      if (repetido) throw new Refusal(DOCUMENTO_JA_REGISTRADO, 409);

      const criado = await tx.subcontractDocument.create({
        data: { contractId: contrato.id, kind: data.kind, accessKey: data.accessKey, collectionId: data.collectionId, unloadState: data.unloadState, issuedAt: data.issuedAt, createdById: user.id },
        select: DOCUMENT_SELECT,
      });

      const onde = carga ? `carga ${carga.trackingCode ?? carga.id.slice(0, 8)}` : `descarga em ${data.unloadState}`;
      await registrarAuditoria(tx, {
        ator: user,
        origem,
        acao: 'subcontratacao.registrar',
        entidade: 'frete-contratado',
        entidadeId: contrato.id,
        resumo: `${ROTULO_DO_DOCUMENTO[data.kind]} da subcontratada ${contrato.carrier.name} registrado na viagem #${codigoDaViagem(manifestId)} (${onde})`,
        depois: escolher(criado, CAMPOS_DO_DOCUMENTO),
      });
      return criado;
    });

    return NextResponse.json(documentoParaATela(documento), { status: 201 });
  } catch (err) {
    if (err instanceof Refusal || err instanceof ManifestError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('Erro ao registrar documento da subcontratada:', err);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
