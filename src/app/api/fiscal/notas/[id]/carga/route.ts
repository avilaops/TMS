import { NextResponse } from 'next/server';
import { transacao } from '@/lib/prisma';
import { requireStaff } from '@/lib/staff';
import { Refusal } from '@/lib/cadastros';
import { criarColetaConfirmada, recusaDaColetaNova } from '@/lib/coletas-db';
import { firstIssue } from '@/lib/usuarios';
import { withTrackingCode } from '@/lib/tracking';
import { CARGA_JA_EXISTE, NOTA_JA_LIGADA, NOTA_NAO_ENCONTRADA, NOTA_SELECT, criarCargaDaNotaSchema } from '@/lib/nfe';
import { cargaComAChave } from '@/lib/nfe-db';
import { CAMPOS_DA_COLETA, escolher, origemDaRequisicao, registrarAuditoria } from '@/lib/auditoria';

/**
 * Confirma a carga sugerida pela nota: cria a coleta pelo mesmo caminho do
 * painel de minutas (`criarColetaConfirmada`: frete pela tabela, código de
 * rastreio, histórico) e liga a nota a ela, na mesma transação. A chave e o
 * valor da NF da carga são os da nota, não os do formulário.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireStaff();
  if (error) return error;

  try {
    const { id } = await params;
    const parsed = criarCargaDaNotaSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const dados = parsed.data;
    const origem = origemDaRequisicao(req);

    // O sorteio do código envolve a transação inteira: uma colisão de
    // `trackingCode` aborta a transação no Postgres, e não dá para tentar de
    // novo dentro dela.
    const resposta = await withTrackingCode((trackingCode) =>
      transacao(async (tx) => {
        const nota = await tx.fiscalDocument.findFirst({
          where: { id },
          select: { accessKey: true, totalValue: true, collectionId: true },
        });
        if (!nota) throw new Refusal(NOTA_NAO_ENCONTRADA, 404);
        if (nota.collectionId) throw new Refusal(NOTA_JA_LIGADA, 409);

        const existente = await cargaComAChave(tx, nota.accessKey);
        if (existente) throw new Refusal(`${CARGA_JA_EXISTE} Código de rastreio: ${existente.trackingCode ?? 'sem código'}.`, 409);

        const recusa = await recusaDaColetaNova(tx, dados);
        if (recusa) throw new Refusal(recusa, 400);

        const coleta = await criarColetaConfirmada(
          tx,
          { ...dados, invoiceKey: nota.accessKey, invoiceValue: nota.totalValue },
          user.id,
          trackingCode,
        );

        // De duas confirmações juntas, a segunda espera a linha da nota, já a
        // encontra ligada e desfaz a própria carga.
        const { count } = await tx.fiscalDocument.updateMany({ where: { id, collectionId: null }, data: { collectionId: coleta.id } });
        if (count === 0) throw new Refusal(NOTA_JA_LIGADA, 409);

        const ligada = await tx.fiscalDocument.findFirstOrThrow({ where: { id }, select: NOTA_SELECT });

        // Duas linhas: a carga nasceu (como no painel de minutas) e a nota ficou ligada a ela.
        await registrarAuditoria(tx, {
          ator: user,
          origem,
          acao: 'coleta.criar',
          entidade: 'coleta',
          entidadeId: coleta.id,
          resumo: `Carga ${coleta.trackingCode ?? ''} criada a partir da NF-e nº ${ligada.number}`,
          depois: escolher(coleta, CAMPOS_DA_COLETA),
        });
        await registrarAuditoria(tx, {
          ator: user,
          origem,
          acao: 'nota.carga',
          entidade: 'nota',
          entidadeId: id,
          resumo: `NF-e nº ${ligada.number} ligada à carga ${coleta.trackingCode ?? ''}`,
          antes: { cargaId: null },
          depois: { cargaId: coleta.id, trackingCode: coleta.trackingCode },
        });
        return { nota: ligada, coleta };
      }),
    );

    return NextResponse.json(resposta, { status: 201 });
  } catch (err) {
    if (err instanceof Refusal) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('Erro ao criar a carga da nota:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
