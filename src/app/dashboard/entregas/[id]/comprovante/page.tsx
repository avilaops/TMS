import prisma from '@/lib/prisma';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { notFound } from 'next/navigation';
import Link from 'next/link';

export default async function ComprovantePage({ params }: { params: Promise<{ id: string }> }) {
  const deliveryId = (await params).id;
  
  const delivery = await prisma.delivery.findUnique({
    where: { id: deliveryId },
    include: {
      proof: true,
      manifest: {
        include: {
          driver: {
            include: { user: { select: { name: true } } }
          },
          vehicle: true
        }
      }
    }
  });

  if (!delivery || !delivery.proof) {
    notFound();
  }

  const { proof } = delivery;

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Comprovante de Entrega (POD)</h1>
        <Link href="/dashboard/entregas" className="text-blue-600 hover:underline">
          &larr; Voltar para Entregas
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Detalhes da Entrega</CardTitle>
            <CardDescription>Informações sobre a baixa e o recebedor</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm text-gray-500">ID da Entrega</p>
              <p className="font-mono text-sm">{delivery.id}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Status</p>
              <p className="font-semibold">{delivery.status}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Data da Baixa</p>
              <p>{new Date(proof.createdAt).toLocaleString('pt-BR')}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Motorista</p>
              <p>{delivery.manifest?.driver?.user.name || 'Não informado'}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Nome do Recebedor</p>
              <p className="font-semibold">{proof.receiverName}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Documento do Recebedor</p>
              <p className="font-semibold">{proof.receiverDoc}</p>
            </div>
            {(proof.latitude && proof.longitude) && (
              <div>
                <p className="text-sm text-gray-500">Localização (GPS)</p>
                <a 
                  href={`https://www.google.com/maps/search/?api=1&query=${proof.latitude},${proof.longitude}`} 
                  target="_blank" 
                  rel="noreferrer"
                  className="text-blue-600 hover:underline"
                >
                  Ver no Mapa
                </a>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Evidências Visuais</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <p className="text-sm text-gray-500 mb-2">Foto do Local / Mercadoria</p>
              {proof.photoBase64 ? (
                <div className="border rounded-md overflow-hidden bg-gray-50 flex items-center justify-center p-2 h-48">
                  <img src={proof.photoBase64} alt="Foto da entrega" className="max-h-full object-contain" />
                </div>
              ) : (
                <div className="border rounded-md bg-gray-100 flex items-center justify-center h-48 text-gray-400">
                  Nenhuma foto registrada
                </div>
              )}
            </div>

            <div>
              <p className="text-sm text-gray-500 mb-2">Assinatura</p>
              {proof.signatureBase64 ? (
                <div className="border rounded-md overflow-hidden bg-gray-50 flex items-center justify-center p-2 h-32">
                  <img src={proof.signatureBase64} alt="Assinatura" className="max-h-full object-contain mix-blend-multiply" />
                </div>
              ) : (
                <div className="border rounded-md bg-gray-100 flex items-center justify-center h-32 text-gray-400">
                  Nenhuma assinatura registrada
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
