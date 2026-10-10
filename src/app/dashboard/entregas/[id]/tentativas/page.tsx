import prisma from '@/lib/prisma';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { pode } from '@/lib/permissoes';
import { avisoDeDistancia, fotosDoComprovante, rotuloDoInsucesso, textoDasTentativas } from '@/lib/comprovantes';
import { FOTOS_DO_PAINEL } from '@/lib/comprovantes-db';
import { Fotos } from '../comprovante/fotos';

const dataHora = (quando: Date | string) => new Date(quando).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

/**
 * Tentativas de entrega sem sucesso de uma carga, da primeira para a última:
 * motivo, observação do motorista, quando, a foto da fachada, a posição e o
 * chamado que cada uma abriu. O `[id]` é o da coleta.
 *
 * Quem vê é quem confere comprovante: a página traz foto e posição do
 * motorista, que são dado do painel.
 */
export default async function TentativasPage({ params }: { params: Promise<{ id: string }> }) {
  // O perfil vem do banco, como na página do comprovante.
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect('/login');
  const viewer = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true } });
  if (!pode(viewer?.role, 'comprovantes')) notFound();

  const collectionId = (await params).id;

  const collection = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: {
      receiver: true,
      destination: true,
      trackingCode: true,
      status: true,
      client: { select: { tradeName: true, companyName: true } },
      proof: { select: { id: true } },
      deliveryAttempts: {
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          reason: true,
          note: true,
          latitude: true,
          longitude: true,
          distanceMeters: true,
          createdAt: true,
          manifest: { select: { driver: { select: { user: { select: { name: true } } } }, vehicle: { select: { plate: true } } } },
          occurrence: { select: { id: true, number: true } },
          photos: FOTOS_DO_PAINEL,
        },
      },
    },
  });

  if (!collection) notFound();
  const tentativas = collection.deliveryAttempts;

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <div className="flex justify-between items-center gap-4 mb-6">
        <h1 className="text-3xl font-bold">Tentativas de entrega</h1>
        <Link href="/dashboard/coletas" className="text-blue-600 hover:underline whitespace-nowrap">
          &larr; Voltar para Cargas
        </Link>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>{collection.client.tradeName || collection.client.companyName}</CardTitle>
          <CardDescription>
            {collection.receiver} · {collection.destination}
            {collection.trackingCode ? ` · ${collection.trackingCode}` : ''}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span data-total-de-tentativas className="font-semibold">
            {tentativas.length === 0 ? 'Nenhuma tentativa sem sucesso' : textoDasTentativas(tentativas.length)}
          </span>
          {collection.proof && (
            <Link href={`/dashboard/entregas/${collectionId}/comprovante`} className="text-blue-600 hover:underline">
              Entregue: ver comprovante
            </Link>
          )}
        </CardContent>
      </Card>

      <div className="space-y-4">
        {tentativas.map((tentativa, indice) => {
          const longe = avisoDeDistancia(tentativa.distanceMeters);
          const fotos = fotosDoComprovante({ createdAt: tentativa.createdAt, photos: tentativa.photos });
          return (
            <Card key={tentativa.id} data-tentativa={tentativa.id}>
              <CardHeader>
                <CardTitle>
                  {indice + 1}ª tentativa: {rotuloDoInsucesso(tentativa.reason)}
                </CardTitle>
                <CardDescription>
                  {dataHora(tentativa.createdAt)}
                  {tentativa.manifest?.driver?.user.name ? ` · ${tentativa.manifest.driver.user.name}` : ''}
                  {tentativa.manifest?.vehicle?.plate ? ` · ${tentativa.manifest.vehicle.plate}` : ''}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-3 text-sm">
                  {tentativa.note && (
                    <div>
                      <p className="text-gray-500">Observação do motorista</p>
                      <p className="whitespace-pre-wrap">{tentativa.note}</p>
                    </div>
                  )}
                  {tentativa.latitude !== null && tentativa.longitude !== null && (
                    <div>
                      <p className="text-gray-500">Localização (GPS)</p>
                      <a
                        href={`https://www.google.com/maps/search/?api=1&query=${tentativa.latitude},${tentativa.longitude}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-600 hover:underline"
                      >
                        Ver no Mapa
                      </a>
                      {longe && (
                        <p data-longe-do-endereco className="font-medium text-amber-700">
                          Registrada {longe}
                        </p>
                      )}
                    </div>
                  )}
                  {tentativa.occurrence && (
                    <div>
                      <p className="text-gray-500">Chamado</p>
                      <Link href={`/dashboard/ocorrencias/${tentativa.occurrence.id}`} className="text-blue-600 hover:underline">
                        Chamado nº {tentativa.occurrence.number}
                      </Link>
                    </div>
                  )}
                </div>
                <Fotos fotos={fotos.map((foto) => ({ id: foto.id, kind: foto.kind, dataUrl: foto.dataUrl, sha256: foto.sha256, quando: dataHora(foto.createdAt) }))} vazio="Sem foto da fachada" />
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
