import type { Empresa } from "@/lib/cobranca-gateway-db";
import type { Origem, Ator } from "@/lib/auditoria";
import { escolher, registrarAuditoria } from "@/lib/auditoria";
import { Refusal } from "@/lib/cadastros";
import { lockManifest } from "@/lib/manifestos-db";
import { documentoParaATela } from "@/lib/subcontratacao-db";
import { CAMPOS_DO_DOCUMENTO, CARGA_FORA_DA_VIAGEM, DOCUMENTO_JA_REGISTRADO, DOCUMENTO_NAO_ENCONTRADO, DOCUMENT_SELECT, SEM_CONTRATO_COM_TRANSPORTADORA, VIAGEM_CANCELADA_SEM_DOCUMENTO, contratoComTransportadora, problemaDaChave } from "@/lib/subcontratacao";
import { lerXmlDaSubcontratada } from "@/lib/subcontratacao-xml";
import { AMBIENTES, SEM_EMITENTE_CADASTRADO, type Ambiente } from "@/lib/cte";
import { credencialDaEmpresa, STATUS_DA_FALHA } from "@/lib/cte-db";
import { svcDaChave, ufDoCodigo } from "@/lib/cte/chave";
import { consultarCte } from "@/lib/cte/sefaz";
import { consultarMdfe } from "@/lib/mdfe/sefaz";
import { SefazError } from "@/lib/cte/soap";
import { conferirConsultaDaSubcontratada, ConsultaSubcontratadaInvalida } from "@/lib/subcontratacao-consulta";

type Quem = { ator: Ator; origem: Origem };

export async function importarXmlDaSubcontratada(empresa: Empresa, manifestId: string, xml: string, collectionId: string | null, quem: Quem) {
  const leitura = lerXmlDaSubcontratada(xml);
  if (!leitura.ok) throw new Refusal(leitura.erro, leitura.grande ? 413 : 400);
  const { issuedAt, ...metadados } = leitura.documento;
  const data = { ...metadados, issuedAt: new Date(`${issuedAt}T00:00:00Z`), collectionId: metadados.kind === "CTE" ? collectionId : null };
  if (data.kind === "CTE" && !data.collectionId) throw new Refusal("Escolha a carga que o CT-e da subcontratada cobre.", 400);

  return empresa.transacao(async (tx) => {
    const manifesto = await lockManifest(tx, manifestId);
    if (manifesto.status === "CANCELLED") throw new Refusal(VIAGEM_CANCELADA_SEM_DOCUMENTO, 409);
    const contrato = await tx.freightContract.findUnique({
      where: { manifestId }, select: { id: true, status: true, carrierId: true, carrier: { select: { name: true, taxId: true, type: true } } },
    });
    if (!contratoComTransportadora(contrato)) throw new Refusal(SEM_CONTRATO_COM_TRANSPORTADORA, 409);
    const problema = problemaDaChave(data.kind, data.accessKey, contrato.carrier);
    if (problema) throw new Refusal(problema, 400);
    if (data.collectionId && !await tx.collection.findFirst({ where: { id: data.collectionId, manifestId }, select: { id: true } })) throw new Refusal(CARGA_FORA_DA_VIAGEM, 400);

    const existente = await tx.subcontractDocument.findFirst({
      where: { contractId: contrato.id, accessKey: data.accessKey, collectionId: data.collectionId },
      select: { ...DOCUMENT_SELECT, xml: true },
    });
    if (existente && (existente.xml !== null || existente.kind !== data.kind || existente.unloadState !== data.unloadState || existente.issuedAt.getTime() !== data.issuedAt.getTime() || existente.environment && existente.environment !== data.environment)) {
      throw new Refusal(`${DOCUMENTO_JA_REGISTRADO} Exclua o registro divergente antes de importar outro arquivo.`, 409);
    }
    const anexos = { xml, xmlImportedAt: new Date(), environment: data.environment, protocol: data.protocol };
    const gravado = existente
      ? await tx.subcontractDocument.update({ where: { id: existente.id }, data: anexos, select: DOCUMENT_SELECT })
      : await tx.subcontractDocument.create({ data: { ...data, ...anexos, contractId: contrato.id, createdById: quem.ator.id }, select: DOCUMENT_SELECT });
    await registrarAuditoria(tx, {
      ...quem, acao: "subcontratacao.importar", entidade: "frete-contratado", entidadeId: contrato.id,
      resumo: `XML de ${data.kind === "CTE" ? "CT-e" : "MDF-e"} da subcontratada ${contrato.carrier.name} importado`,
      depois: { ...escolher(gravado, CAMPOS_DO_DOCUMENTO), environment: gravado.environment, protocol: gravado.protocol, hasXml: true },
    });
    return { documento: documentoParaATela(gravado), novo: !existente };
  });
}

export async function xmlDaSubcontratada(empresa: Empresa, manifestId: string, documentoId: string) {
  const documento = await empresa.db.subcontractDocument.findFirst({
    where: { id: documentoId, contract: { manifestId } }, select: { accessKey: true, xml: true },
  });
  if (!documento?.xml) throw new Refusal(DOCUMENTO_NAO_ENCONTRADO, 404);
  return { chave: documento.accessKey, xml: documento.xml };
}

const ALVO_SELECT = {
  ...DOCUMENT_SELECT,
  sefazRevision: true,
  contractId: true,
  contract: { select: { status: true, carrierId: true, carrier: { select: { type: true, name: true, taxId: true } } } },
} as const;

export async function consultarSubcontratada(empresa: Empresa, manifestId: string, documentoId: string, quem: Quem) {
  const alvo = await empresa.db.subcontractDocument.findFirst({ where: { id: documentoId, contract: { manifestId } }, select: ALVO_SELECT });
  if (!alvo) throw new Refusal(DOCUMENTO_NAO_ENCONTRADO, 404);
  if (!contratoComTransportadora(alvo.contract)) throw new Refusal(SEM_CONTRATO_COM_TRANSPORTADORA, 409);
  if (alvo.kind !== "CTE" && alvo.kind !== "MDFE") throw new Refusal("Tipo de documento inválido.", 409);
  const problema = problemaDaChave(alvo.kind, alvo.accessKey, alvo.contract.carrier);
  if (problema) throw new Refusal(problema, 409);
  // Chaves manuais ainda sem ambiente usam o ambiente fiscal da empresa.
  const emitente = alvo.environment === null ? await empresa.db.fiscalIssuer.findUnique({ where: { tenantId: empresa.id }, select: { environment: true } }) : null;
  const environment = alvo.environment ?? emitente?.environment;
  if (!environment || !AMBIENTES.includes(environment as Ambiente)) throw new Refusal(SEM_EMITENTE_CADASTRADO, 409);
  const ambiente = environment as Ambiente;
  const credencial = await credencialDaEmpresa(empresa);
  let situacao: ReturnType<typeof conferirConsultaDaSubcontratada>;
  try {
    // Nenhuma transação permanece aberta durante a conexão externa.
    const resposta = alvo.kind === "CTE"
      ? await consultarCte({ uf: ufDoCodigo(alvo.accessKey.slice(0, 2))!, ambiente, credencial, svc: svcDaChave(alvo.accessKey) }, alvo.accessKey)
      : await consultarMdfe({ ambiente, credencial }, alvo.accessKey);
    situacao = conferirConsultaDaSubcontratada(resposta, { kind: alvo.kind, accessKey: alvo.accessKey, environment: ambiente });
  } catch (erro) {
    if (erro instanceof SefazError) throw new Refusal(`${erro.message} O registro anterior foi preservado.`, STATUS_DA_FALHA(erro));
    if (erro instanceof ConsultaSubcontratadaInvalida) throw new Refusal(erro.message, 502);
    throw erro;
  }
  const checkedAt = new Date();
  return empresa.transacao(async (tx) => {
    await lockManifest(tx, manifestId);
    const atual = await tx.subcontractDocument.findFirst({ where: { id: documentoId, contract: { manifestId } }, select: ALVO_SELECT });
    if (!atual) throw new Refusal(DOCUMENTO_NAO_ENCONTRADO, 404);
    if (!contratoComTransportadora(atual.contract) || atual.contractId !== alvo.contractId || atual.contract.carrierId !== alvo.contract.carrierId) throw new Refusal(SEM_CONTRATO_COM_TRANSPORTADORA, 409);
    if (atual.accessKey !== alvo.accessKey || atual.environment !== alvo.environment || atual.xmlImportedAt?.getTime() !== alvo.xmlImportedAt?.getTime() || atual.sefazRevision !== alvo.sefazRevision) {
      throw new Refusal("O documento mudou durante a consulta. Atualize a tela e consulte novamente.", 409);
    }
    const gravado = await tx.subcontractDocument.update({ where: { id: atual.id }, data: { ...situacao, environment: ambiente, sefazCheckedAt: checkedAt, sefazRevision: { increment: 1 } }, select: DOCUMENT_SELECT });
    await registrarAuditoria(tx, {
      ...quem, acao: "subcontratacao.consultar", entidade: "frete-contratado", entidadeId: alvo.contractId,
      resumo: `Consulta de ${alvo.kind === "CTE" ? "CT-e" : "MDF-e"} da subcontratada: ${situacao.sefazCode}`,
      depois: { accessKey: gravado.accessKey, environment: ambiente, ...situacao, sefazCheckedAt: checkedAt.toISOString() },
    });
    return documentoParaATela(gravado);
  });
}
