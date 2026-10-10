import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { requireStaff } from '@/lib/staff';
import { isUniqueViolation } from '@/lib/cadastros';
import { firstIssue } from '@/lib/usuarios';
import {
  CARGA_PARA_CTE_SELECT,
  CTE_CARGA_NAO_ENCONTRADA,
  CTE_CARGA_NAO_SAIU,
  CTE_CHAVE_REPETIDA,
  CARGA_QUE_RECEBE_CTE,
  cargaRecebeCte,
  registrarCteSchema,
} from '@/lib/nfe';
import { nadaMudou, origemDaRequisicao, registrarAuditoriaDepois } from '@/lib/auditoria';
import { EMITIDO_PELO_SISTEMA } from '@/lib/cte';
import { CTE_DA_CARGA, paraATela } from '@/lib/cte-db';

// A lista das cargas que pedem CT-e e o registro manual de um CT-e emitido em
// outro sistema. A emissão pela SEFAZ está em /api/fiscal/cte/emissao; aqui
// nada é enviado.

const CARGA_COM_CTE_SELECT = { ...CARGA_PARA_CTE_SELECT, ...CTE_DA_CARGA } as const;

type CargaLida = Prisma.CollectionGetPayload<{ select: typeof CARGA_COM_CTE_SELECT }>;

/** A carga como a tela a recebe: no lugar da lista de CT-e, só o mais recente (`emitido`). */
const paraALista = ({ ctes, ...carga }: CargaLida) => ({ ...carga, emitido: ctes[0] ? paraATela(ctes[0]) : null });

const MAXIMO_NA_LISTA = 200;

/**
 * Cargas alocadas numa viagem em montagem, em rota ou entregues, com os dados que um CT-e precisa, o registro
 * manual, se houver, e o CT-e mais recente que este sistema montou (`emitido`).
 */
export async function GET() {
  const { error } = await requireStaff({ pode: 'fiscalVer' });
  if (error) return error;

  try {
    const cargas = await prisma.collection.findMany({
      where: CARGA_QUE_RECEBE_CTE,
      select: CARGA_COM_CTE_SELECT,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: MAXIMO_NA_LISTA,
    });
    return NextResponse.json(cargas.map(paraALista));
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
  const { user, error } = await requireStaff({ pode: 'fiscal' });
  if (error) return error;

  try {
    const parsed = registrarCteSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const { collectionId, cteNumber, cteKey } = parsed.data;

    const carga = await prisma.collection.findFirst({
      where: { id: collectionId },
      // O CT-e de antes vai para a auditoria.
      select: { status: true, trackingCode: true, cteNumber: true, cteKey: true, cteStatus: true, manifest: { select: { status: true } } },
    });
    if (!carga) return NextResponse.json({ error: CTE_CARGA_NAO_ENCONTRADA }, { status: 404 });
    if (!cargaRecebeCte(carga)) {
      return NextResponse.json({ error: CTE_CARGA_NAO_SAIU }, { status: 409 });
    }
    // O CT-e que a SEFAZ autorizou por este sistema não é trocado nem apagado à mão: o caminho é o cancelamento.
    if (carga.cteKey !== null) {
      const autorizado = await prisma.cte.findFirst({ where: { collectionId, accessKey: carga.cteKey, status: 'AUTHORIZED' }, select: { id: true } });
      if (autorizado) return NextResponse.json({ error: EMITIDO_PELO_SISTEMA }, { status: 409 });
    }

    let gravadas = 0;
    try {
      const { count } = await prisma.collection.updateMany({
        where: { id: collectionId, ...CARGA_QUE_RECEBE_CTE },
        data: { cteNumber, cteKey, cteStatus: cteKey === null ? 'PENDING' : 'ISSUED' },
      });
      gravadas = count;
    } catch (err) {
      // A chave de CT-e é única no sistema inteiro.
      if (isUniqueViolation(err)) return NextResponse.json({ error: CTE_CHAVE_REPETIDA }, { status: 409 });
      throw err;
    }

    const lida = await prisma.collection.findFirst({ where: { id: collectionId }, select: CARGA_COM_CTE_SELECT });
    const atualizada = lida && paraALista(lida);

    const antes = { cteNumber: carga.cteNumber, cteKey: carga.cteKey, cteStatus: carga.cteStatus };
    const depois = { cteNumber, cteKey, cteStatus: cteKey === null ? 'PENDING' : 'ISSUED' };
    if (gravadas > 0 && !nadaMudou(antes, depois)) {
      await registrarAuditoriaDepois(prisma, {
        ator: user,
        origem: origemDaRequisicao(req),
        acao: 'cte.registrar',
        entidade: 'coleta',
        entidadeId: collectionId,
        resumo:
          cteKey === null
            ? `Registro de CT-e desfeito na carga ${carga.trackingCode ?? ''}`
            : `CT-e nº ${cteNumber ?? ''} registrado na carga ${carga.trackingCode ?? ''}`,
        antes,
        depois,
      });
    }
    return NextResponse.json(atualizada);
  } catch (err) {
    console.error('Erro ao registrar CT-e:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
