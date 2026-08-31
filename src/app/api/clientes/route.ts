import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/prisma';

export async function GET() {
  const session = await getServerSession(authOptions);
  
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const clientes = await prisma.client.findMany({
      orderBy: { createdAt: 'desc' }
    });
    return NextResponse.json(clientes);
  } catch (error) {
    console.error('Error fetching clients:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const data = await req.json();
    
    // Validate required fields
    if (!data.cnpj || !data.companyName) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Check for duplicate CNPJ
    const existingClient = await prisma.client.findUnique({
      where: { cnpj: data.cnpj }
    });

    if (existingClient) {
      return NextResponse.json({ error: 'Já existe um cliente cadastrado com este CNPJ/CPF.' }, { status: 409 });
    }

    // Create client
    const newClient = await prisma.client.create({
      data: {
        cnpj: data.cnpj,
        companyName: data.companyName,
        tradeName: data.tradeName,
        email: data.email,
        phone: data.phone,
        address: data.address,
      }
    });

    return NextResponse.json(newClient, { status: 201 });
  } catch (error) {
    console.error('Error creating client:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
