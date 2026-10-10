'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { PROOF_STATUS, PROOF_STATUSES } from '@/lib/entregas';
import { statusBadge } from '@/lib/format';
import { avisoDeDistancia, rotuloDaRelacao, rotuloDaRessalva } from '@/lib/comprovantes';

type ProofStatus = (typeof PROOF_STATUSES)[number];
// Os filtros da tela: as três situações do comprovante e, à parte, as entregas
// com ressalva (em qualquer situação).
type Filtro = ProofStatus | 'RESSALVA';
const FILTROS: readonly Filtro[] = ['SUBMITTED', 'RESSALVA', 'REJECTED', 'APPROVED'];
const ROTULO_DO_FILTRO: Record<Filtro, string> = {
  SUBMITTED: PROOF_STATUS.SUBMITTED.label,
  RESSALVA: 'Com ressalva',
  REJECTED: 'Devolvidos ao motorista',
  APPROVED: PROOF_STATUS.APPROVED.label,
};
const consultaDoFiltro = (filtro: Filtro) => (filtro === 'RESSALVA' ? 'ressalva=1' : `status=${filtro}`);

type Comprovante = {
  id: string;
  status: string;
  receiverName: string;
  receiverDoc: string;
  // Opcionais: comprovante antigo não tem relação nem ressalva, e a distância
  // só existe quando a baixa trouxe posição e a carga tem coordenada.
  receiverRelation?: string | null;
  exceptionType?: string | null;
  distanceMeters?: number | null;
  createdAt: string;
  reviewedAt: string | null;
  rejectionReason: string | null;
  reviewedBy: { id: string; name: string } | null;
  collection: {
    id: string;
    trackingCode: string | null;
    receiver: string;
    destination: string;
    client: { tradeName: string | null; companyName: string };
  };
};

// O que a última busca trouxe, e para qual filtro: enquanto o filtro da tela
// for outro, a lista ainda está carregando.
type Carga = { status: Filtro; itens: Comprovante[]; erro: string | null };

const EMPTY_MESSAGE: Record<Filtro, string> = {
  SUBMITTED: 'Nenhum comprovante aguardando conferência.',
  RESSALVA: 'Nenhuma entrega com ressalva.',
  APPROVED: 'Nenhum comprovante aprovado.',
  REJECTED: 'Nenhum comprovante devolvido ao motorista.',
};

const dataHora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

export default function ComprovantesPage() {
  const [status, setStatus] = useState<Filtro>('SUBMITTED');
  const [carga, setCarga] = useState<Carga | null>(null);

  useEffect(() => {
    let ativo = true;

    (async () => {
      let itens: Comprovante[] = [];
      let erro: string | null = null;
      try {
        const res = await fetch(`/api/comprovantes?${consultaDoFiltro(status)}`);
        const data = await res.json().catch(() => null);
        if (res.ok && Array.isArray(data)) itens = data;
        else erro = data?.error || 'Não foi possível carregar os comprovantes.';
      } catch {
        erro = 'Não foi possível carregar os comprovantes.';
      }
      if (ativo) setCarga({ status, itens, erro });
    })();

    return () => {
      ativo = false;
    };
  }, [status]);

  const carregando = carga?.status !== status;

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Comprovantes de Entrega</h1>
        <p className="text-gray-500">Confira o comprovante enviado pelo motorista e aprove ou devolva para ele refazer.</p>
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
        {FILTROS.map((opcao) => (
          <button
            key={opcao}
            type="button"
            onClick={() => setStatus(opcao)}
            aria-pressed={opcao === status}
            className={`px-4 py-2 text-sm font-medium rounded-full border transition-colors ${
              opcao === status
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
            }`}
          >
            {ROTULO_DO_FILTRO[opcao]}
          </button>
        ))}
      </div>

      {carregando ? (
        <div className="py-12 text-center text-gray-500">Carregando comprovantes...</div>
      ) : carga.erro ? (
        <div className="py-12 text-center text-red-700 border border-red-200 rounded-lg bg-red-50">{carga.erro}</div>
      ) : carga.itens.length === 0 ? (
        <div className="py-12 text-center text-gray-500 border rounded-lg bg-gray-50">{EMPTY_MESSAGE[status]}</div>
      ) : (
        <div className="overflow-x-auto border rounded-lg bg-white">
          <table className="block md:table w-full text-sm">
            <thead className="hidden md:table-header-group bg-gray-50 text-left text-gray-500">
              <tr>
                <th className="px-4 py-3 font-medium">Cliente</th>
                <th className="px-4 py-3 font-medium">Recebedor</th>
                <th className="px-4 py-3 font-medium">Data da baixa</th>
                <th className="px-4 py-3 font-medium">Situação</th>
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody className="block md:table-row-group divide-y">
              {carga.itens.map((comprovante) => {
                const selo = statusBadge(PROOF_STATUS, comprovante.status);
                const { collection } = comprovante;
                const relacao = rotuloDaRelacao(comprovante.receiverRelation);
                const ressalva = comprovante.exceptionType ? (rotuloDaRessalva(comprovante.exceptionType) ?? comprovante.exceptionType) : null;
                const longe = avisoDeDistancia(comprovante.distanceMeters);
                return (
                  <tr key={comprovante.id} data-com-ressalva={ressalva ? '' : undefined} className={`grid grid-cols-2 gap-x-3 gap-y-1.5 px-3 py-2.5 md:table-row ${ressalva ? 'bg-amber-50/60' : ''}`}>
                    <td className="col-span-2 min-w-0 md:table-cell md:px-4 md:py-3">
                      <p className="font-semibold">{collection.client.tradeName || collection.client.companyName}</p>
                      <p className="text-gray-500">
                        {collection.receiver} · {collection.destination}
                      </p>
                      {collection.trackingCode && (
                        <p className="font-mono text-xs text-gray-400">{collection.trackingCode}</p>
                      )}
                    </td>
                    <td data-rotulo="Recebedor" className="min-w-0 md:table-cell md:px-4 md:py-3 before:content-[attr(data-rotulo)] before:block before:text-[11px] before:leading-tight before:text-gray-500 md:before:content-none">
                      <p>{comprovante.receiverName}</p>
                      <p className="text-gray-500">
                        {comprovante.receiverDoc}
                        {relacao ? ` · ${relacao}` : ''}
                      </p>
                    </td>
                    <td data-rotulo="Data da baixa" className="min-w-0 md:table-cell md:px-4 md:py-3 whitespace-nowrap before:content-[attr(data-rotulo)] before:block before:text-[11px] before:leading-tight before:text-gray-500 md:before:content-none">{dataHora(comprovante.createdAt)}</td>
                    <td className="col-span-2 min-w-0 md:table-cell md:px-4 md:py-3">
                      <span className={`inline-block px-2.5 py-1 text-xs font-medium rounded-full border ${selo.className}`}>
                        {selo.label}
                      </span>
                      {ressalva && (
                        <span data-ressalva className="ml-1 inline-block px-2.5 py-1 text-xs font-semibold rounded-full border bg-amber-100 text-amber-800 border-amber-300">
                          Ressalva: {ressalva}
                        </span>
                      )}
                      {longe && (
                        <p data-longe-do-endereco className="mt-1 text-xs font-medium text-amber-700">
                          Baixa {longe}
                        </p>
                      )}
                      {comprovante.reviewedAt && (
                        <p className="mt-1 text-xs text-gray-500">
                          {comprovante.reviewedBy?.name ?? 'Usuário removido'} · {dataHora(comprovante.reviewedAt)}
                        </p>
                      )}
                      {comprovante.rejectionReason && (
                        <p className="mt-1 text-xs text-gray-500">Motivo: {comprovante.rejectionReason}</p>
                      )}
                    </td>
                    <td className="col-span-2 min-w-0 md:table-cell md:px-4 md:py-3 md:text-right whitespace-nowrap">
                      <Link
                        href={`/dashboard/entregas/${collection.id}/comprovante`}
                        className="text-blue-600 hover:underline font-medium"
                      >
                        {comprovante.status === 'SUBMITTED' ? 'Conferir' : 'Ver comprovante'}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
