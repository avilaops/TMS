import type { Prisma } from "@prisma/client";
import { descargasDaViagem } from "@/lib/mdfe-db";
import { ORDEM_DAS_CARGAS } from "@/lib/manifestos-db";
import {
  DOCUMENT_SELECT,
  cargasSemCte,
  contratoComTransportadora,
  ufsComMdfeDaSubcontratada,
  ufsEmDobro,
  viagemSubcontratada,
  type DocumentoDaSubcontratada,
  type SubcontratacaoDaViagem,
} from "@/lib/subcontratacao";

// O que as rotas leem da subcontratação da viagem. Só o servidor importa este arquivo.

type LeituraDb = Pick<Prisma.TransactionClient, "manifest" | "fiscalIssuer" | "vehicle" | "mdfe" | "freightContract">;

type LinhaDoDocumento = Prisma.SubcontractDocumentGetPayload<{ select: typeof DOCUMENT_SELECT }>;

/** O documento como as rotas o devolvem: a data vira texto. */
export const documentoParaATela = (linha: LinhaDoDocumento): DocumentoDaSubcontratada => ({ ...linha, issuedAt: linha.issuedAt.toISOString() });

/**
 * A subcontratação da viagem: a transportadora do contrato de frete (quando há
 * contrato valendo com uma), as cargas com o CT-e dela, os MDF-e dela por UF
 * de descarregamento e o que falta. Não lê valor nenhum do contrato: quem não
 * lê o frete contratado pode receber isto. `null`: a viagem não existe.
 */
export async function lerSubcontratacao(db: LeituraDb, manifestId: string): Promise<SubcontratacaoDaViagem | null> {
  const viagem = await db.manifest.findUnique({
    where: { id: manifestId },
    select: {
      id: true,
      status: true,
      vehicle: { select: { carrier: { select: { id: true, type: true } } } },
      collections: { select: { id: true, trackingCode: true, destination: true }, orderBy: ORDEM_DAS_CARGAS },
      freightContract: {
        select: {
          status: true,
          carrierId: true,
          carrier: { select: { id: true, name: true, taxId: true, type: true } },
          subcontractDocuments: { select: DOCUMENT_SELECT, orderBy: [{ issuedAt: "asc" }, { createdAt: "asc" }] },
        },
      },
    },
  });
  if (!viagem) return null;

  const contrato = viagem.freightContract;
  const comTransportadora = contratoComTransportadora(contrato);
  const documentos = comTransportadora ? contrato.subcontractDocuments.map(documentoParaATela) : [];
  const descargas = await descargasDaViagem(db, manifestId);

  const cargas = viagem.collections.map((carga) => ({
    id: carga.id,
    codigo: carga.trackingCode ?? carga.id.slice(0, 8),
    destino: carga.destination,
    precisaDeCte: descargas?.cargasComCte.has(carga.id) ?? true,
    ctes: documentos.filter((documento) => documento.kind === "CTE" && documento.collectionId === carga.id),
  }));
  const mdfes = documentos.filter((documento) => documento.kind === "MDFE");

  return {
    viagem: { id: viagem.id, status: viagem.status },
    parceiro: comTransportadora ? { id: contrato.carrier.id, name: contrato.carrier.name, taxId: contrato.carrier.taxId } : null,
    noVeiculoDela: viagemSubcontratada(viagem.vehicle, contrato),
    cargas,
    ufsDeDescarga: descargas?.ufs ?? [],
    mdfes,
    semCte: comTransportadora ? cargasSemCte(cargas) : [],
    ufsEmDobro: ufsEmDobro(descargas?.ufsComMdfeProprio ?? [], ufsComMdfeDaSubcontratada(mdfes)),
  };
}
