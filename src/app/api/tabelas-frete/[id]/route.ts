import { NextResponse } from 'next/server';
import prisma, { transacao } from '@/lib/prisma';
import { requireStaff } from '@/lib/staff';
import {
  FREIGHT_CITY_SELECT,
  FREIGHT_TABLE_SELECT,
  Refusal,
  isUniqueViolation,
  updateFreightTableSchema,
} from '@/lib/cadastros';
import { firstIssue } from '@/lib/usuarios';
import { nadaMudou, origemDaRequisicao, registrarAuditoria } from '@/lib/auditoria';

const DUPLICATE_MESSAGE = 'Já existe uma tabela de frete com este nome.';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireStaff({ pode: 'tabelasFreteVer' });
  if (error) return error;

  try {
    const { id } = await params;
    const tabela = await prisma.freightTable.findUnique({
      where: { id },
      select: { ...FREIGHT_TABLE_SELECT, cities: { select: FREIGHT_CITY_SELECT, orderBy: { city: 'asc' } } },
    });
    if (!tabela) return NextResponse.json({ error: 'Tabela de frete não encontrada.' }, { status: 404 });
    return NextResponse.json(tabela);
  } catch (error) {
    console.error('Erro ao buscar tabela de frete:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireStaff({ pode: 'tabelasFrete' });
  if (error) return error;

  try {
    const { id } = await params;
    const parsed = updateFreightTableSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const { isDefault, ...data } = parsed.data;
    const origem = origemDaRequisicao(req);

    const tabela = await transacao(async (tx) => {
      // A tabela inteira, como estava: é o "antes" da auditoria.
      const atual = await tx.freightTable.findUnique({ where: { id }, select: FREIGHT_TABLE_SELECT });
      if (!atual) throw new Refusal('Tabela de frete não encontrada.', 404);

      // A validade só é conferida inteira no corpo; mudar uma ponta precisa olhar a que já está gravada.
      const inicio = data.validFrom === undefined ? atual.validFrom : data.validFrom;
      const fim = data.validTo === undefined ? atual.validTo : data.validTo;
      if (inicio && fim && inicio > fim) {
        throw new Refusal('O fim da validade não pode ser antes do início.', 400);
      }

      if (data.name !== undefined) {
        const outra = await tx.freightTable.findFirst({ where: { name: data.name, id: { not: id } }, select: { id: true } });
        if (outra) throw new Refusal(DUPLICATE_MESSAGE, 409);
      }

      if (isDefault === true) {
        await tx.freightTable.updateMany({ where: { isDefault: true, id: { not: id } }, data: { isDefault: false } });
      }

      const alterada = await tx.freightTable.update({
        where: { id },
        data: { ...data, ...(isDefault !== undefined && { isDefault }) },
        select: FREIGHT_TABLE_SELECT,
      });

      if (!nadaMudou(atual, alterada)) {
        await registrarAuditoria(tx, {
          ator: user,
          origem,
          acao: 'tabela-frete.alterar',
          entidade: 'tabela-frete',
          entidadeId: id,
          resumo: `Tabela de frete ${alterada.name} alterada`,
          antes: atual,
          depois: alterada,
        });
      }

      return alterada;
    });

    return NextResponse.json(tabela);
  } catch (err) {
    if (err instanceof Refusal) return NextResponse.json({ error: err.message }, { status: err.status });
    if (isUniqueViolation(err)) return NextResponse.json({ error: DUPLICATE_MESSAGE }, { status: 409 });
    console.error('Erro ao alterar tabela de frete:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
