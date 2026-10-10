import prisma from '@/lib/prisma';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { pode } from '@/lib/permissoes';
import { PROOF_STATUS } from '@/lib/entregas';
import { statusBadge } from '@/lib/format';
import { avisoDeDistancia, fotosAtuais, fotosDoComprovante, rotuloDaRelacao, rotuloDaRessalva, textoDasTentativas, type FotoDoComprovante } from '@/lib/comprovantes';
import { FOTOS_DO_PAINEL } from '@/lib/comprovantes-db';
import { Conferencia } from './conferencia';
import { Fotos, type FotoDaTela } from './fotos';

const dataHora = (quando: Date | string) => new Date(quando).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

const paraATela = (foto: FotoDoComprovante): FotoDaTela => ({ id: foto.id, kind: foto.kind, dataUrl: foto.dataUrl, sha256: foto.sha256, quando: dataHora(foto.createdAt) });

/**
 * Comprovante da entrega de uma carga. O `[id]` é o da coleta.
 *
 * Mostra todas as fotos agrupadas por tipo (com o SHA-256 de cada uma), quem
 * recebeu e a relação com o destinatário, a ressalva, o aviso de baixa feita
 * longe do endereço e o histórico de devoluções ao motorista, com as fotos que
 * cada reenvio substituiu. Comprovante antigo (uma foto só, sem relação)
 * aparece com a foto dele como foto da entrega.
 */
export default async function ComprovantePage({ params }: { params: Promise<{ id: string }> }) {
  // O proxy já separa as áreas; aqui o perfil vem do banco, como nas rotas da
  // API, porque a foto e o documento do recebedor são dado pessoal.
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
      client: { select: { tradeName: true, companyName: true } },
      manifest: {
        select: {
          driver: { select: { user: { select: { name: true } } } },
          vehicle: { select: { plate: true } },
        },
      },
      _count: { select: { deliveryAttempts: true } },
      proof: {
        include: {
          reviewedBy: { select: { name: true } },
          photos: FOTOS_DO_PAINEL,
          rejections: {
            select: { id: true, reason: true, rejectedAt: true, resubmittedAt: true, rejectedBy: { select: { name: true } } },
            orderBy: [{ rejectedAt: 'asc' }, { id: 'asc' }],
          },
        },
      },
    },
  });

  if (!collection?.proof) {
    notFound();
  }

  const { proof } = collection;
  const selo = statusBadge(PROOF_STATUS, proof.status);
  const todas = fotosDoComprovante(proof);
  const atuais = fotosAtuais(todas);
  const substituidas = todas.filter((foto) => foto.replacedAt !== null);
  const relacao = rotuloDaRelacao(proof.receiverRelation);
  const ressalva = rotuloDaRessalva(proof.exceptionType) ?? proof.exceptionType;
  const longe = avisoDeDistancia(proof.distanceMeters);
  const tentativas = collection._count.deliveryAttempts;
  // A devolução em aberto é a que o motorista ainda não respondeu.
  const devolucaoAberta = proof.rejections.find((devolucao) => devolucao.resubmittedAt === null);

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Comprovante de Entrega (POD)</h1>
        <Link href="/dashboard/comprovantes" className="text-blue-600 hover:underline">
          &larr; Voltar para Comprovantes
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
            {ressalva && (
              <div data-ressalva className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
                <p className="text-sm font-semibold text-amber-900">Entrega com ressalva: {ressalva}</p>
                {proof.exceptionNote && <p className="text-sm text-amber-900 whitespace-pre-wrap">{proof.exceptionNote}</p>}
              </div>
            )}
            {proof.reviewedAt && (
              <div>
                <p className="text-sm text-gray-500">Conferido por</p>
                <p>
                  {proof.reviewedBy?.name ?? 'Usuário removido'} ·{' '}
                  {dataHora(proof.reviewedAt)}
                </p>
              </div>
            )}
            {proof.rejectionReason && (
              <div>
                <p className="text-sm text-gray-500">Motivo da devolução</p>
                <p className="whitespace-pre-wrap">{proof.rejectionReason}</p>
                {devolucaoAberta && <p className="text-xs text-gray-500">Aguardando as fotos novas do motorista.</p>}
              </div>
            )}
            <div>
              <p className="text-sm text-gray-500">Data da Baixa</p>
              <p>{dataHora(proof.createdAt)}</p>
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
              <p className="font-semibold">
                {proof.receiverName}
                {relacao && <span data-relacao className="font-normal text-gray-600"> · {relacao}</span>}
              </p>
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
                {longe && (
                  <p data-longe-do-endereco className="text-sm font-medium text-amber-700">
                    Baixa registrada {longe}
                  </p>
                )}
              </div>
            )}
            {tentativas > 0 && (
              <div>
                <p className="text-sm text-gray-500">Antes da entrega</p>
                <Link href={`/dashboard/entregas/${collectionId}/tentativas`} className="text-blue-600 hover:underline">
                  {textoDasTentativas(tentativas)}
                </Link>
              </div>
            )}
            {proof.status === 'SUBMITTED' && <Conferencia collectionId={collectionId} />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Evidências Visuais</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <Fotos fotos={atuais.map(paraATela)} />

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

      {proof.rejections.length > 0 && (
        <Card className="mt-6" data-historico-de-devolucoes>
          <CardHeader>
            <CardTitle>Histórico de devoluções</CardTitle>
            <CardDescription>Cada vez que o comprovante voltou ao motorista, e as fotos que ele substituiu</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ol className="space-y-3">
              {proof.rejections.map((devolucao, indice) => (
                <li key={devolucao.id} className="border-l-2 border-red-200 pl-3">
                  <p className="text-sm font-medium">
                    {indice + 1}ª devolução · {devolucao.rejectedBy?.name ?? 'Usuário removido'} · {dataHora(devolucao.rejectedAt)}
                  </p>
                  <p className="text-sm whitespace-pre-wrap">{devolucao.reason}</p>
                  <p className="text-xs text-gray-500">
                    {devolucao.resubmittedAt ? `Fotos novas enviadas em ${dataHora(devolucao.resubmittedAt)}` : 'Aguardando as fotos novas do motorista'}
                  </p>
                </li>
              ))}
            </ol>
            {substituidas.length > 0 && (
              <div data-fotos-substituidas>
                <p className="text-sm font-medium mb-2">Fotos substituídas</p>
                <Fotos fotos={substituidas.map(paraATela)} />
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
