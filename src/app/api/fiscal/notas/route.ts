import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireStaff } from '@/lib/staff';
import { isUniqueViolation } from '@/lib/cadastros';
import { firstIssue } from '@/lib/usuarios';
import {
  LIMITE_DO_XML_BYTES,
  MAXIMO_DE_NOTAS_NA_LISTA,
  NOTA_JA_IMPORTADA,
  NOTA_SELECT,
  XML_GRANDE,
  filtroDeNotas,
  importarNotaSchema,
  lerNfe,
} from '@/lib/nfe';
import { sugestaoDaNota } from '@/lib/nfe-db';

// O XML viaja dentro de um JSON: aspas e quebras de linha escapadas aumentam o
// corpo. O dobro do limite do arquivo cobre isso com folga.
const LIMITE_DO_CORPO_BYTES = LIMITE_DO_XML_BYTES * 2 + 1024;

const grandeDemais = () => NextResponse.json({ error: XML_GRANDE }, { status: 413 });

/** Notas importadas, da mais nova para a mais antiga. `?busca=` por chave, número, CNPJ/CPF ou razão social. */
export async function GET(req: Request) {
  const { error } = await requireStaff();
  if (error) return error;

  try {
    const busca = new URL(req.url).searchParams.get('busca');
    const notas = await prisma.fiscalDocument.findMany({
      where: filtroDeNotas(busca),
      select: NOTA_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: MAXIMO_DE_NOTAS_NA_LISTA,
    });
    return NextResponse.json(notas);
  } catch (err) {
    console.error('Erro ao listar notas fiscais:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

/** A nota que já está no banco com esta chave, na resposta 409. */
async function jaImportada(chave: string) {
  const nota = await prisma.fiscalDocument.findFirst({ where: { accessKey: chave }, select: NOTA_SELECT });
  const carga = nota?.collection?.trackingCode;
  return NextResponse.json(
    { error: carga ? `${NOTA_JA_IMPORTADA} Ela está ligada à carga ${carga}.` : NOTA_JA_IMPORTADA, nota, coleta: nota?.collection ?? null },
    { status: 409 },
  );
}

/**
 * Importa o XML de uma NF-e: lê, confere a chave e guarda a nota com o XML
 * original. A resposta leva o que foi lido e a carga sugerida; a carga só
 * nasce quando o operador confirma (`POST /api/fiscal/notas/[id]/carga`).
 * A mesma nota não entra duas vezes na empresa: 409, com a carga a que está ligada.
 */
export async function POST(req: Request) {
  const { user, error } = await requireStaff();
  if (error) return error;

  try {
    if (Number(req.headers.get('content-length') ?? 0) > LIMITE_DO_CORPO_BYTES) return grandeDemais();
    const corpo = await req.text();
    if (Buffer.byteLength(corpo) > LIMITE_DO_CORPO_BYTES) return grandeDemais();

    let json: unknown = null;
    try {
      json = JSON.parse(corpo);
    } catch {
      json = null;
    }
    const parsed = importarNotaSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }

    const leitura = lerNfe(parsed.data.xml);
    if (!leitura.ok) {
      return NextResponse.json({ error: leitura.erro }, { status: leitura.grande ? 413 : 400 });
    }

    const existente = await prisma.fiscalDocument.findFirst({ where: { accessKey: leitura.nota.accessKey }, select: { id: true } });
    if (existente) return jaImportada(leitura.nota.accessKey);

    let nota;
    try {
      nota = await prisma.fiscalDocument.create({
        data: { ...leitura.nota, xml: parsed.data.xml, importedById: user.id },
        select: NOTA_SELECT,
      });
    } catch (err) {
      // Duas importações da mesma nota ao mesmo tempo: o banco deixa passar uma só.
      if (isUniqueViolation(err)) return jaImportada(leitura.nota.accessKey);
      throw err;
    }

    return NextResponse.json({ nota, ...(await sugestaoDaNota(prisma, nota)) }, { status: 201 });
  } catch (err) {
    console.error('Erro ao importar nota fiscal:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
