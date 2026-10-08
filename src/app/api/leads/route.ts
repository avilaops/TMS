import { NextResponse } from 'next/server';
import { registrarCotacao } from '@/lib/cotacao';

// Pedido de cotação do site. Mesma regra de `/api/cotacoes` (src/lib/cotacao.ts);
// muda só o formato da resposta, que o site já consome assim.
export async function POST(req: Request) {
  try {
    const resultado = await registrarCotacao(await req.json().catch(() => null), { volumesPadrao: 1 });
    if (!resultado.ok) {
      return NextResponse.json(
        { error: resultado.status === 404 ? 'Empresa não encontrada' : 'Faltam campos obrigatórios' },
        { status: resultado.status },
      );
    }

    return NextResponse.json({
      message: 'Cotação recebida com sucesso',
      // Nulo quando não há tabela em vigor ou a cidade não está nela: o comercial responde.
      estimatedValue: resultado.estimatedValue,
      prazoHoras: resultado.prazoHoras,
      lead: resultado.lead,
    });
  } catch (error) {
    console.error('Error creating lead:', error);
    return NextResponse.json({ error: 'Erro ao criar cotação' }, { status: 500 });
  }
}
