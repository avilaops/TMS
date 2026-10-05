import { NextResponse } from 'next/server';
import { requireStaff } from '@/lib/staff';
import prisma from '@/lib/prisma';
import { withTrackingCode } from '@/lib/tracking';

export async function GET() {
  const { error } = await requireStaff();
  if (error) return error;

  try {
    const coletas = await prisma.collection.findMany({
      include: {
        client: true,
        driver: { include: { user: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
    return NextResponse.json(coletas);
  } catch (error) {
    console.error('Error fetching collections:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const { error } = await requireStaff();
  if (error) return error;

  try {
    const data = await req.json();
    
    if (!data.clientId || !data.sender || !data.receiver || !data.origin || !data.destination || !data.volumes || !data.weight) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Toda coleta nasce com codigo: e ele, com o CNPJ, que abre o rastreio
    // publico. Uma coleta sem codigo simplesmente nao seria rastreavel.
    const newCollection = await withTrackingCode((trackingCode) =>
      prisma.collection.create({
        data: {
          clientId: data.clientId,
          sender: data.sender,
          receiver: data.receiver,
          origin: data.origin,
          destination: data.destination,
          volumes: parseInt(data.volumes),
          weight: parseFloat(data.weight),
          invoiceKey: data.invoiceKey || null,
          invoiceValue: data.invoiceValue ? parseFloat(data.invoiceValue) : null,
          driverId: data.driverId || null,
          trackingCode,
        }
      })
    );

    return NextResponse.json(newCollection, { status: 201 });
  } catch (error) {
    console.error('Error creating collection:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
