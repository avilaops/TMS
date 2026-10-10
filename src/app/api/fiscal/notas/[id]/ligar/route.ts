import { NextResponse } from 'next/server';
import { transacao } from '@/lib/prisma';
import { requireStaff } from '@/lib/staff';
import { Refusal } from '@/lib/cadastros';
import { isEditable } from '@/lib/coletas';
import { firstIssue } from '@/lib/usuarios';
import { normalizeTrackingCode } from '@/lib/tracking';
import {
  CARGA_COM_OUTRA_CHAVE,
  CARGA_NAO_ENCONTRADA,
  NOTA_JA_LIGADA,
  NOTA_NAO_ENCONTRADA,
  NOTA_SELECT,
  ligarNotaSchema,
} from '@/lib/nfe';

const MUDOU = 'A carga foi alterada enquanto você ligava a nota. Tente de novo.';

/**
 * Liga a nota a uma carga que já existe, achada pelo código de rastreio.
 *
 * Se a carga já tem chave de NF-e, ela precisa ser a desta nota. Se não tem e
 * ainda pode ser editada (a mesma regra do painel, `isEditable`), a chave da
 * nota é gravada nela. Carga que já embarcou sem chave recebe só o anexo: os
 * dados dela não mudam depois do manifesto.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireStaff({ pode: 'fiscal' });
  if (error) return error;

  try {
    const { id } = await params;
    const parsed = ligarNotaSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const trackingCode = normalizeTrackingCode(parsed.data.trackingCode);
    // Código fora do formato não é de carga nenhuma: mesma resposta do que não existe.
    if (!trackingCode) return NextResponse.json({ error: CARGA_NAO_ENCONTRADA }, { status: 404 });

    const nota = await transacao(async (tx) => {
      const atual = await tx.fiscalDocument.findFirst({ where: { id }, select: { accessKey: true, collectionId: true } });
      if (!atual) throw new Refusal(NOTA_NAO_ENCONTRADA, 404);
      if (atual.collectionId) throw new Refusal(NOTA_JA_LIGADA, 409);

      // Carga de outra empresa não aparece para esta: mesma resposta do código que não existe.
      const carga = await tx.collection.findFirst({
        where: { trackingCode },
        select: { id: true, status: true, manifestId: true, invoiceKey: true },
      });
      if (!carga) throw new Refusal(CARGA_NAO_ENCONTRADA, 404);

      const chaveDaCarga = carga.invoiceKey?.replace(/\D/g, '') ?? '';
      if (chaveDaCarga !== '' && chaveDaCarga !== atual.accessKey) throw new Refusal(CARGA_COM_OUTRA_CHAVE, 409);

      if (chaveDaCarga === '' && isEditable(carga)) {
        const { count } = await tx.collection.updateMany({
          where: { id: carga.id, OR: [{ invoiceKey: null }, { invoiceKey: '' }] },
          data: { invoiceKey: atual.accessKey },
        });
        if (count === 0) throw new Refusal(MUDOU, 409);
      }

      const { count } = await tx.fiscalDocument.updateMany({ where: { id, collectionId: null }, data: { collectionId: carga.id } });
      if (count === 0) throw new Refusal(NOTA_JA_LIGADA, 409);

      return tx.fiscalDocument.findFirstOrThrow({ where: { id }, select: NOTA_SELECT });
    });

    return NextResponse.json({ nota });
  } catch (err) {
    if (err instanceof Refusal) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('Erro ao ligar a nota à carga:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
