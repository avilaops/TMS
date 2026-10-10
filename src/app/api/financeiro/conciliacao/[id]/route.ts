import { NextResponse } from 'next/server';
import { transacao } from '@/lib/prisma';
import { requireStaff } from '@/lib/staff';
import { Refusal } from '@/lib/cadastros';
import { firstIssue } from '@/lib/usuarios';
import { origemDaRequisicao } from '@/lib/auditoria';
import { acaoDaLinhaSchema } from '@/lib/conciliacao';
import { conciliarLinha, criarLancamentoDaLinha, desfazerLinha, ignorarLinha } from '@/lib/conciliacao-db';

/**
 * O que se faz com uma linha do extrato: `conciliar` com um lançamento (dá a
 * baixa nele se está em aberto; se é de fatura, paga a fatura), `criar` um
 * lançamento já pago a partir dela, `ignorar`, ou `desfazer`. Cada ação é uma
 * transação e fica na auditoria. As regras estão em src/lib/conciliacao-db.ts.
 *
 * Conciliar pode pagar uma fatura e desfazer pode reabri-la: quem lança no
 * financeiro (`financeiro`) é o mesmo grupo que baixa fatura (`faturamento`),
 * e `tests/conciliacao.test.ts` confere que as duas capacidades têm os mesmos perfis.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireStaff({ pode: 'financeiro' });
  if (error) return error;

  try {
    const { id } = await params;
    const parsed = acaoDaLinhaSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const dados = parsed.data;
    const quem = { ator: user, origem: origemDaRequisicao(req) };

    const resultado = await transacao(async (tx) => {
      switch (dados.action) {
        case 'conciliar': {
          const { juros, multa, desconto } = dados;
          return conciliarLinha(tx, id, dados.transactionId, { juros, multa, desconto }, quem);
        }
        case 'criar': {
          const criado = await criarLancamentoDaLinha(tx, id, dados, quem);
          return { transactionId: criado.id };
        }
        case 'ignorar':
          await ignorarLinha(tx, id, quem);
          return {};
        case 'desfazer':
          return desfazerLinha(tx, id, quem);
      }
    });

    return NextResponse.json({ id, action: dados.action, ...resultado });
  } catch (err) {
    if (err instanceof Refusal) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('Erro ao conciliar a linha do extrato:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
