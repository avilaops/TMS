import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import prisma from '@/lib/prisma';
import { firstIssue } from '@/lib/usuarios';
import { DOCUMENT_SELECT, updateDocumentSchema } from '@/lib/frota';
import { escolher, nadaMudou, origemDaRequisicao, registrarAuditoriaDepois } from '@/lib/auditoria';

const CAMPOS = ['type', 'number', 'expiresAt', 'notes'] as const;

const NOT_FOUND = 'Documento não encontrado.';

type Contexto = { params: Promise<{ id: string; registroId: string }> };

/** Altera o documento. Renovar é mandar o vencimento novo. */
export async function PATCH(req: Request, { params }: Contexto) {
  const { user, error } = await requireStaff({ pode: 'frota' });
  if (error) return error;

  try {
    const { id, registroId } = await params;
    const parsed = updateDocumentSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }

    // O documento inteiro: o que havia antes vai para a auditoria.
    const atual = await prisma.vehicleDocument.findFirst({ where: { id: registroId, vehicleId: id }, select: DOCUMENT_SELECT });
    if (!atual) return NextResponse.json({ error: NOT_FOUND }, { status: 404 });

    // Campo ausente (`undefined`) fica como está; `null` apaga.
    const documento = await prisma.vehicleDocument.update({ where: { id: registroId }, data: parsed.data, select: DOCUMENT_SELECT });

    const antes = escolher(atual, CAMPOS);
    const depois = escolher(documento, CAMPOS);
    if (!nadaMudou(antes, depois)) {
      await registrarAuditoriaDepois(prisma, {
        ator: user,
        origem: origemDaRequisicao(req),
        acao: 'documento-veiculo.alterar',
        entidade: 'veiculo',
        entidadeId: id,
        resumo: `Documento ${documento.type} do veículo alterado`,
        antes,
        depois,
      });
    }

    return NextResponse.json(documento);
  } catch (error) {
    console.error('Erro ao alterar documento do veículo:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: Contexto) {
  const { user, error } = await requireStaff({ pode: 'frota' });
  if (error) return error;

  try {
    const { id, registroId } = await params;
    // O que vai ser apagado, para a auditoria. Sem ele, o `deleteMany` abaixo responde o 404 de sempre.
    const apagado = await prisma.vehicleDocument.findFirst({ where: { id: registroId, vehicleId: id }, select: DOCUMENT_SELECT });
    const { count } = await prisma.vehicleDocument.deleteMany({ where: { id: registroId, vehicleId: id } });
    if (count === 0) return NextResponse.json({ error: NOT_FOUND }, { status: 404 });

    if (apagado) {
      await registrarAuditoriaDepois(prisma, {
        ator: user,
        origem: origemDaRequisicao(req),
        acao: 'documento-veiculo.excluir',
        entidade: 'veiculo',
        entidadeId: id,
        resumo: `Documento ${apagado.type} do veículo excluído`,
        antes: escolher(apagado, CAMPOS),
      });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Erro ao apagar documento do veículo:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
