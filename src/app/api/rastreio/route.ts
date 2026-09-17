import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

/**
 * Rastreio publico por CNPJ/CPF.
 *
 * A rota nao tem sessao: quem digita o documento nao provou ser dono dele. Por
 * isso o `select` abaixo e explicito e fechado. Um `include` aqui arrastaria o
 * registro inteiro de `Client` (limite de credito, condicao de pagamento,
 * e-mail, telefone, endereco), o valor e a chave da nota de cada carga e, pelo
 * caminho `manifest.driver.user`, ate o hash de senha do motorista — tudo em
 * resposta publica. Ao mexer aqui, acrescente campo por campo, e apenas o que a
 * tela de rastreio realmente desenha.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const doc = searchParams.get('doc');

  if (!doc) {
    return NextResponse.json({ error: 'Documento é obrigatório' }, { status: 400 });
  }

  const cleanDoc = doc.replace(/\D/g, '');

  // CPF tem 11 digitos e CNPJ tem 14. Qualquer outro tamanho e digitacao
  // incompleta: responder a lista vazia evita consulta ao banco a cada tecla.
  if (cleanDoc.length !== 11 && cleanDoc.length !== 14) {
    return NextResponse.json([]);
  }

  try {
    const minutas = await prisma.collection.findMany({
      where: {
        client: {
          cnpj: cleanDoc
        }
      },
      select: {
        id: true,
        status: true,
        origin: true,
        destination: true,
        createdAt: true,
        manifest: {
          select: {
            driver: {
              select: {
                user: { select: { name: true } }
              }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: 50
    });

    return NextResponse.json(minutas);
  } catch (error) {
    console.error('Error fetching rastreio:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
