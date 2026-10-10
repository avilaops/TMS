import { NextResponse } from 'next/server';
import { transacao } from '@/lib/prisma';
import { requireStaff } from '@/lib/staff';
import { FREIGHT_CITY_SELECT, Refusal, freightCitiesSchema } from '@/lib/cadastros';
import { firstIssue } from '@/lib/usuarios';
import { chaveDaCidade } from '@/lib/frete';
import { origemDaRequisicao, registrarAuditoria } from '@/lib/auditoria';

/**
 * Substitui a lista de cidades da tabela pela lista enviada. É o que a tela usa
 * tanto para editar uma cidade quanto para importar a planilha colada: a tabela
 * fica exatamente como o operador a vê, sem sobra de uma versão anterior.
 *
 * Tudo numa transação: lista com erro não apaga a que estava valendo.
 */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireStaff(['ADMIN']);
  if (error) return error;
  const origem = origemDaRequisicao(req);

  try {
    const { id } = await params;
    const parsed = freightCitiesSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }

    // Duas linhas que dão na mesma cidade ("Mirassol" e "MIRASSOL/SP") são erro
    // de planilha: recusar aqui é melhor que escolher uma em silêncio.
    const vistas = new Map<string, string>();
    const linhas = parsed.data.cities.map((linha) => {
      const cityKey = chaveDaCidade(linha.city);
      if (!cityKey) throw new Refusal(`Nome de cidade inválido: "${linha.city}".`, 400);
      const anterior = vistas.get(cityKey);
      if (anterior) throw new Refusal(`Cidade repetida na lista: "${anterior}" e "${linha.city}".`, 400);
      vistas.set(cityKey, linha.city);
      return { ...linha, cityKey, dedicated: linha.dedicated ?? false };
    });

    const cidades = await transacao(async (tx) => {
      const tabela = await tx.freightTable.findUnique({ where: { id }, select: { id: true, name: true } });
      if (!tabela) throw new Refusal('Tabela de frete não encontrada.', 404);

      const { count: antigas } = await tx.freightTableCity.deleteMany({ where: { tableId: id } });
      if (linhas.length > 0) {
        await tx.freightTableCity.createMany({ data: linhas.map((linha) => ({ ...linha, tableId: id })) });
      }
      // Marca a alteração na própria tabela, para a lista mostrar quando o preço mudou.
      await tx.freightTable.update({ where: { id }, data: { updatedAt: new Date() }, select: { id: true } });

      // A lista inteira é trocada: a auditoria guarda quantas cidades havia e quantas ficaram, não cada preço.
      await registrarAuditoria(tx, {
        ator: user,
        origem,
        acao: 'tabela-frete.cidades',
        entidade: 'tabela-frete',
        entidadeId: id,
        resumo: `Cidades da tabela de frete ${tabela.name} trocadas: ${antigas} → ${linhas.length}`,
        antes: { cidades: antigas },
        depois: { cidades: linhas.length },
      });

      return tx.freightTableCity.findMany({ where: { tableId: id }, select: FREIGHT_CITY_SELECT, orderBy: { city: 'asc' } });
    });

    return NextResponse.json(cidades);
  } catch (err) {
    if (err instanceof Refusal) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('Erro ao gravar cidades da tabela de frete:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
