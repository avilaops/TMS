type EventoCteIntegracao = {
  id: string;
  type: string;
  sequence: number;
  protocol: string | null;
  statusCode: number;
  statusReason: string;
  registeredAt: Date;
  cancelledAt: Date | null;
};

type CteIntegracao = {
  id: string;
  collectionId: string;
  environment: string;
  series: number;
  number: number;
  accessKey: string;
  status: string;
  protocol: string | null;
  statusCode: number | null;
  statusReason: string | null;
  issuedAt: Date;
  authorizedAt: Date | null;
  cancelledAt: Date | null;
  cancelProtocol: string | null;
  createdAt: Date;
  updatedAt: Date;
  events: EventoCteIntegracao[];
  collection: { trackingCode: string | null };
};

/** Contrato sem XML bruto para o Lojas; os arquivos continuam em rotas privadas. */
export function cteParaLojas(empresa: string, cte: CteIntegracao) {
  const base = `/api/integracoes/lojas/v1/empresas/${encodeURIComponent(empresa)}/documentos-fiscais/cte/${cte.id}`;
  const autorizado = cte.status === "AUTHORIZED" || cte.status === "CANCELLED";
  return {
    id: cte.id,
    coleta_id: cte.collectionId,
    rastreio: cte.collection.trackingCode,
    ambiente: cte.environment,
    serie: cte.series,
    numero: cte.number,
    chave: cte.accessKey,
    status: cte.status,
    protocolo: cte.protocol,
    codigo_status: cte.statusCode,
    motivo_status: cte.statusReason,
    emitido_em: cte.issuedAt.toISOString(),
    autorizado_em: cte.authorizedAt?.toISOString() ?? null,
    cancelado_em: cte.cancelledAt?.toISOString() ?? null,
    protocolo_cancelamento: cte.cancelProtocol,
    observado_em: cte.updatedAt.toISOString(),
    arquivos: {
      xml: autorizado ? `${base}/xml` : null,
      dacte: cte.status === "AUTHORIZED" ? `${base}/dacte` : null,
    },
    eventos: cte.events.map((evento) => ({
      id: evento.id,
      tipo: evento.type,
      sequencia: evento.sequence,
      protocolo: evento.protocol,
      codigo_status: evento.statusCode,
      motivo_status: evento.statusReason,
      registrado_em: evento.registeredAt.toISOString(),
      cancelado_em: evento.cancelledAt?.toISOString() ?? null,
    })),
  };
}
