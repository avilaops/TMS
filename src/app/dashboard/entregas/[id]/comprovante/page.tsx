import prisma from '@/lib/prisma';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { PROOF_STATUS } from '@/lib/entregas';
import { statusBadge } from '@/lib/format';

/** Comprovante da entrega de uma carga. O `[id]` é o da coleta. */
export default async function ComprovantePage({ params }: { params: Promise<{ id: string }> }) {
  // O proxy já separa as áreas; aqui o perfil vem do banco, como nas rotas da
  // API, porque a foto e o documento do recebedor são dado pessoal.
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect('/login');
  const viewer = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true } });
  if (!viewer || (viewer.role !== 'ADMIN' && viewer.role !== 'OPERATION')) notFound();

  const collectionId = (await params).id;

  const collection = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: {
      receiver: true,
      destination: true,
      trackingCode: true,
      client: { select: { tradeName: true, companyName: true } },
      manifest: {
        select: {
          driver: { select: { user: { select: { name: true } } } },
          vehicle: { select: { plate: true } },
        },
      },
      proof: true,
    },
  });

  if (!collection?.proof) {
    notFound();
  }

  const { proof } = collection;
  const selo = statusBadge(PROOF_STATUS, proof.status);

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Comprovante de Entrega (POD)</h1>
        <Link href="/dashboard/coletas" className="text-blue-600 hover:underline">
          &larr; Voltar para Minutas
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
              <p className="text-sm text-gray-500">Carga</p>
              <p className="font-semibold">{collection.client.tradeName || collection.client.companyName}</p>
              <p className="text-sm text-gray-600">{collection.receiver} · {collection.destination}</p>
            </div>
            {collection.trackingCode && (
              <div>
                <p className="text-sm text-gray-500">Código de rastreio</p>
                <p className="font-mono text-sm">{collection.trackingCode}</p>
              </div>
            )}
            <div>
              <p className="text-sm text-gray-500">Comprovante</p>
              <span className={`inline-block px-2.5 py-1 text-xs font-medium rounded-full border ${selo.className}`}>
                {selo.label}
              </span>
            </div>
            <div>
              <p className="text-sm text-gray-500">Data da Baixa</p>
              <p>{new Date(proof.createdAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Motorista</p>
              <p>
                {collection.manifest?.driver?.user.name || 'Não informado'}
                {collection.manifest?.vehicle?.plate ? ` · ${collection.manifest.vehicle.plate}` : ''}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Nome do Recebedor</p>
              <p className="font-semibold">{proof.receiverName}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Documento do Recebedor</p>
              <p className="font-semibold">{proof.receiverDoc}</p>
            </div>
            {(proof.latitude !== null && proof.longitude !== null) && (
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
                  {/* eslint-disable-next-line @next/next/no-img-element -- imagem embutida (data URL), não há o que otimizar */}
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
                  {/* eslint-disable-next-line @next/next/no-img-element -- imagem embutida (data URL), não há o que otimizar */}
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
