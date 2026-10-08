import { NextResponse } from 'next/server';
import { paraEmpresa } from '@/lib/prisma';
import { empresaPublica } from '@/lib/empresas';

export async function POST(req: Request) {
  try {
    const data = await req.json();
    
    const { companyName, email, origin, destination, weight, phone = '', volumes = 1 } = data;

    if (!companyName || !email || !origin || !destination || !weight) {
      return NextResponse.json({ error: 'Faltam campos obrigatórios' }, { status: 400 });
    }

    // Lógica simples de cálculo de frete para o lead
    const baseRate = 150.0;
    const ratePerKg = 2.5;
    const estimatedValue = baseRate + (Number(weight) * ratePerKg);

    // Rota pública: a empresa vem do corpo (`empresa`, o slug) ou do padrão do ambiente.
    const tenantId = await empresaPublica(data.empresa);
    if (!tenantId) {
      return NextResponse.json({ error: 'Empresa não encontrada' }, { status: 404 });
    }

    const lead = await paraEmpresa(tenantId).db.quoteLead.create({
      data: {
        companyName,
        email,
        phone,
        origin,
        destination,
        volumes: Number(volumes),
        weight: Number(weight),
        estimatedValue,
        status: 'NEW'
      }
    });

    return NextResponse.json({
      message: 'Cotação recebida com sucesso',
      estimatedValue,
      lead
    });
  } catch (error) {
    console.error('Error creating lead:', error);
    return NextResponse.json({ error: 'Erro ao criar cotação' }, { status: 500 });
  }
}
