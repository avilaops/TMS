import { NextResponse } from 'next/server';
import prisma, { transacao } from '@/lib/prisma';
import { requireStaff } from '@/lib/staff';
import { origemDaRequisicao, registrarAuditoria } from '@/lib/auditoria';
import { OFX_GRANDE, OfxError, TAMANHO_MAXIMO_DO_OFX, lerOfx, textoDoOfx } from '@/lib/ofx';
import { FILTROS_DA_LISTA, type FiltroDaLista, type RespostaDaImportacao } from '@/lib/conciliacao';
import { carregarConciliacao, chaveDaConta } from '@/lib/conciliacao-db';

/**
 * As linhas do extrato bancário importado, na situação pedida (`?situacao=`:
 * `pendentes`, que é o padrão, `conciliadas` ou `ignoradas`), com a contagem de
 * cada situação. Cada pendente vem com os lançamentos sugeridos e o certeiro.
 * As regras da sugestão estão em src/lib/conciliacao.ts.
 */
export async function GET(req?: Request) {
  const { error } = await requireStaff({ pode: 'financeiro' });
  if (error) return error;

  try {
    const pedido = req ? new URL(req.url).searchParams.get('situacao') : null;
    const filtro: FiltroDaLista = (FILTROS_DA_LISTA as readonly string[]).includes(pedido ?? '') ? (pedido as FiltroDaLista) : 'pendentes';
    return NextResponse.json(await carregarConciliacao(prisma, filtro));
  } catch (error) {
    console.error('Erro ao listar o extrato para conciliação:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

/**
 * Importa um extrato em OFX. O corpo da requisição é o arquivo, como o banco o
 * exportou (os bytes, sem JSON em volta: OFX antigo vem em Windows-1252 e o
 * leitor é quem decide como ler).
 *
 * Cada movimentação vira uma linha pendente. A linha é única por conta +
 * identificador da movimentação no banco: reenviar o mesmo arquivo, ou um
 * período que se sobrepõe a outro já enviado, não duplica nada — a resposta diz
 * quantas eram novas e quantas já estavam.
 */
export async function POST(req: Request) {
  const { user, error } = await requireStaff({ pode: 'financeiro' });
  if (error) return error;

  try {
    if (Number(req.headers.get('content-length') ?? 0) > TAMANHO_MAXIMO_DO_OFX) {
      return NextResponse.json({ error: OFX_GRANDE }, { status: 413 });
    }

    let leitura;
    try {
      leitura = lerOfx(textoDoOfx(new Uint8Array(await req.arrayBuffer())));
    } catch (err) {
      if (err instanceof OfxError) return NextResponse.json({ error: err.message }, { status: err.message === OFX_GRANDE ? 413 : 400 });
      throw err;
    }

    const origem = origemDaRequisicao(req);
    const resposta = await transacao(async (tx): Promise<RespostaDaImportacao> => {
      const contas: RespostaDaImportacao['contas'] = [];
      let importadas = 0;
      let noArquivo = 0;

      for (const extrato of leitura.extratos) {
        const accountKey = chaveDaConta(extrato.conta);
        const { count } = await tx.bankStatementLine.createMany({
          data: extrato.transacoes.map((transacao) => ({
            accountKey,
            bankId: extrato.conta.banco,
            account: extrato.conta.mascarada,
            fitId: transacao.fitId,
            postedAt: new Date(`${transacao.dia}T00:00:00.000Z`),
            amount: transacao.valor,
            kind: transacao.tipo,
            description: transacao.descricao.slice(0, 500),
          })),
          // A unicidade (empresa + conta + identificador) é o que segura a reimportação.
          skipDuplicates: true,
        });
        importadas += count;
        noArquivo += extrato.transacoes.length;
        contas.push({ conta: extrato.conta.mascarada, banco: extrato.conta.banco, inicio: extrato.inicio, fim: extrato.fim, movimentacoes: extrato.transacoes.length });
      }

      await registrarAuditoria(tx, {
        ator: user,
        origem,
        acao: 'conciliacao.importar',
        entidade: 'extrato',
        resumo: `Extrato importado (${contas.map((c) => c.conta).join(', ')}): ${importadas} ${importadas === 1 ? 'linha nova' : 'linhas novas'}, ${noArquivo - importadas} já importadas`,
        depois: { importadas, repetidas: noArquivo - importadas, contas: contas.map((c) => `${c.banco ?? 'banco não informado'} ${c.conta}`).join(', ') },
      });

      return { importadas, repetidas: noArquivo - importadas, contas };
    });

    return NextResponse.json(resposta, { status: 201 });
  } catch (error) {
    console.error('Erro ao importar o extrato:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
