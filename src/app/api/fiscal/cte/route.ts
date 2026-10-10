import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireStaff } from '@/lib/staff';
import { isUniqueViolation } from '@/lib/cadastros';
import { firstIssue } from '@/lib/usuarios';
import {
  CARGA_PARA_CTE_SELECT,
  CTE_CARGA_NAO_ENCONTRADA,
  CTE_CARGA_NAO_SAIU,
  CTE_CHAVE_REPETIDA,
  STATUS_COM_CTE,
  registrarCteSchema,
} from '@/lib/nfe';

// Este sistema NÃO emite CT-e. Emitir exige certificado digital A1 da
// transportadora, credenciamento na SEFAZ e homologação, e nada disso existe
// aqui. Estas rotas só listam as cargas com os dados que um CT-e precisa e
// guardam o número e a chave de um CT-e emitido em outro sistema.

const MAXIMO_NA_LISTA = 200;

/** Cargas em rota ou entregues, com os dados que um CT-e precisa e o registro, se houver. */
export async function GET() {
  const { error } = await requireStaff();
  if (error) return error;

  try {
    const cargas = await prisma.collection.findMany({
      where: { status: { in: [...STATUS_COM_CTE] } },
      select: CARGA_PARA_CTE_SELECT,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: MAXIMO_NA_LISTA,
    });
    return NextResponse.json(cargas);
  } catch (err) {
    console.error('Erro ao listar cargas para CT-e:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

/**
 * Registra, à mão, o número e a chave de um CT-e emitido em outro sistema
 * (`cteNumber`, `cteKey`, e a situação passa a `ISSUED`). Os dois em branco
 * desfazem o registro. Nada é enviado à SEFAZ.
 */
export async function POST(req: Request) {
  const { error } = await requireStaff();
  if (error) return error;

  try {
    const parsed = registrarCteSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const { collectionId, cteNumber, cteKey } = parsed.data;

    const carga = await prisma.collection.findFirst({ where: { id: collectionId }, select: { status: true } });
    if (!carga) return NextResponse.json({ error: CTE_CARGA_NAO_ENCONTRADA }, { status: 404 });
    if (!(STATUS_COM_CTE as readonly string[]).includes(carga.status)) {
      return NextResponse.json({ error: CTE_CARGA_NAO_SAIU }, { status: 409 });
    }

    try {
      await prisma.collection.updateMany({
        where: { id: collectionId, status: { in: [...STATUS_COM_CTE] } },
        data: { cteNumber, cteKey, cteStatus: cteKey === null ? 'PENDING' : 'ISSUED' },
      });
    } catch (err) {
      // A chave de CT-e é única no sistema inteiro.
      if (isUniqueViolation(err)) return NextResponse.json({ error: CTE_CHAVE_REPETIDA }, { status: 409 });
      throw err;
    }

    const atualizada = await prisma.collection.findFirst({ where: { id: collectionId }, select: CARGA_PARA_CTE_SELECT });
    return NextResponse.json(atualizada);
  } catch (err) {
    console.error('Erro ao registrar CT-e:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
