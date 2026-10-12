import { NextResponse } from 'next/server';
import { transacao } from '@/lib/prisma';
import { requireStaff } from '@/lib/staff';
import { Refusal } from '@/lib/cadastros';
import { CAMPOS_DO_DOCUMENTO, DOCUMENTO_NAO_ENCONTRADO, DOCUMENT_SELECT, ROTULO_DO_DOCUMENTO, type TipoDeDocumento } from '@/lib/subcontratacao';
import { ManifestError, lockManifest } from '@/lib/manifestos-db';
import { codigoDaViagem } from '@/lib/viagem';
import { escolher, origemDaRequisicao, registrarAuditoria } from '@/lib/auditoria';

/**
 * Exclui o registro de um documento da subcontratada (a chave foi digitada
 * errada, ou o documento foi cancelado por ela). Não mexe em documento nenhum
 * na SEFAZ. Documento de outra viagem é 404, como o que não existe. A exclusão
 * fica na Auditoria com a chave: o MDF-e registrado pode ter liberado a saída.
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string; documentoId: string }> }) {
  const { user, error } = await requireStaff({ pode: 'fiscal' });
  if (error) return error;

  try {
    const { id: manifestId, documentoId } = await params;
    const origem = origemDaRequisicao(req);

    await transacao(async (tx) => {
      await lockManifest(tx, manifestId);
      const documento = await tx.subcontractDocument.findFirst({
        where: { id: documentoId, contract: { manifestId } },
        select: { ...DOCUMENT_SELECT, contractId: true, contract: { select: { carrier: { select: { name: true } } } } },
      });
      if (!documento) throw new Refusal(DOCUMENTO_NAO_ENCONTRADO, 404);

      await tx.subcontractDocument.delete({ where: { id: documento.id } });
      await registrarAuditoria(tx, {
        ator: user,
        origem,
        acao: 'subcontratacao.excluir',
        entidade: 'frete-contratado',
        entidadeId: documento.contractId,
        resumo: `${ROTULO_DO_DOCUMENTO[documento.kind as TipoDeDocumento] ?? documento.kind} da subcontratada ${documento.contract.carrier.name} excluído da viagem #${codigoDaViagem(manifestId)}`,
        antes: escolher(documento, CAMPOS_DO_DOCUMENTO),
      });
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Refusal || err instanceof ManifestError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('Erro ao excluir documento da subcontratada:', err);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
