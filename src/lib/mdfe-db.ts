import type { Prisma } from "@prisma/client";
import { Refusal } from "@/lib/cadastros";
import { registrarAuditoria, registrarAuditoriaDepois, type Origem, type QualquerAtor } from "@/lib/auditoria";
import { empresaPorId, type Empresa } from "@/lib/cobranca-gateway-db";
import { SEM_EMITENTE_CADASTRADO } from "@/lib/cte";
import { assinarXml, resumoDaAssinatura } from "@/lib/cte/assinar";
import { COM_FILA, STATUS_DA_FALHA, ambienteDaLinha, certificadoDaLinha, credencialDaEmpresa, faltasDoCertificado, frase, sortearCodigo, type CredencialDaEmpresa } from "@/lib/cte-db";
import { decidir, eventoRegistrado, type Decisao, type Esperado, type Protocolo, type RespostaDoEvento } from "@/lib/cte/sefaz";
import { SefazError } from "@/lib/cte/soap";
import { danfeLigado } from "@/lib/fiscal-mcp";
import {
  DATA_DE_ENCERRAMENTO_INVALIDA,
  DIAS_PARA_AVISAR_ENCERRAMENTO,
  EMISSAO_EM_ANDAMENTO,
  FORA_DO_PRAZO,
  JA_AUTORIZADO,
  MDFE_NAO_ENCONTRADO,
  SEM_CARGA_PARA_A_UF,
  SO_AUTORIZADO_CANCELA,
  SO_AUTORIZADO_ENCERRA,
  SO_AUTORIZADO_RECEBE_EVENTO,
  SO_AUTORIZADO_TEM_DAMDFE,
  SO_AUTORIZADO_TEM_XML,
  TRANSPORTE_JA_INICIADO,
  VIAGEM_CANCELADA,
  VIAGEM_NAO_ENCONTRADA,
  dentroDoPrazoDeCancelamento,
  diasDesde,
  entradasSchema,
  exigenciaDeMdfe,
  type Ambiente,
  type ConferenciaDoMdfe,
  type ConfiguracaoDoFormulario,
  type ConfiguracaoDoMdfe,
  type EntradasDoMdfe,
  type EventoDoMdfe,
  type ExigenciaDeMdfe,
  type MdfeEmitido,
  type MdfesDaViagem,
  type RespostaDeNaoEncerrados,
  type ResultadoDaEmissao,
  type SituacaoDaEmissao,
  type SituacaoDoMdfe,
  type StatusDoServico,
  type TipoDeEmitente,
} from "@/lib/mdfe";
import { AUTORIZADOR_DO_MDFE, ENDERECO_DO_QR_CODE } from "@/lib/mdfe/enderecos";
import {
  ALVO_DO_EVENTO_DO_MDFE,
  ALVO_DO_MDFE,
  TIPO_DO_EVENTO,
  montarCancelamento,
  montarEncerramento,
  montarInclusaoDeCondutor,
  montarMdfe,
  montarProcEvento,
  montarProcMdfe,
  type EmitenteDoMdfe,
  type EventoMontado,
} from "@/lib/mdfe/montar";
import { prepararMdfe, ufsDeDescarga, type CargaDaViagem, type PreparoDoMdfe, type SeguroPadrao, type VeiculoDaViagem, type ViagemDoMdfe } from "@/lib/mdfe/preparar";
import { CSTAT, REJEICOES_POR_NAO_ENCERRADO, consultarMdfe, consultarNaoEncerrados, enviarEvento, enviarMdfe, statusDoServico, type DestinoDoMdfe } from "@/lib/mdfe/sefaz";
import { municipioDoTexto } from "@/lib/municipios";
import { avisarEquipe, avisoDeMdfe, avisoDeMdfeEmAberto } from "@/lib/notificacoes";
import { sistema } from "@/lib/prisma";
import { codigoDaViagem } from "@/lib/viagem";

/**
 * O que a emissão de MDF-e grava e lê: a configuração da empresa, a numeração e
 * o caminho de cada MDF-e (conferir, montar, assinar, enviar, gravar a resposta,
 * encerrar, cancelar, incluir condutor). As regras estão em src/lib/mdfe.ts e
 * src/lib/mdfe/. Só o servidor importa este arquivo.
 *
 * O emitente, o certificado A1 (cifrado) e o ambiente são os do CT-e
 * (`FiscalIssuer`, Empresa → Fiscal): um cadastro só para os dois documentos.
 *
 * NUMERAÇÃO: a mesma disciplina do CT-e (ver o topo de src/lib/cte-db.ts), em
 * `MdfeNumbering` (empresa + ambiente + série), com trava própria:
 * - rejeição NÃO consome o número (a SEFAZ não grava MDF-e rejeitado);
 * - autorização consome, e a rejeição 539 (número usado com outra chave) também;
 * - envio sem resposta não decide nada: a próxima tentativa começa consultando
 *   a SEFAZ pela chave e, se não consta lá, reenvia o MESMO XML.
 *
 * ANTES DE ENVIAR, a emissão consulta os MDF-e não encerrados do emitente
 * (`MDFeConsNaoEnc`): a SEFAZ rejeita MDF-e novo para a mesma placa, tipo de
 * emitente e UF de descarregamento com outro em aberto (rejeição 611). Quando o
 * que está em aberto foi emitido por este sistema, a emissão para aqui, com a
 * frase que diz qual encerrar; nada é enviado.
 *
 * As chamadas à SEFAZ ficam FORA de transação.
 */

type Tx = Prisma.TransactionClient;
type Quem = { ator: QualquerAtor; origem: Origem };

const PRODUCAO: Ambiente = "PRODUCAO";
const MOTIVO_MAXIMO = 300;

/* -------------------------------- Configuração -------------------------------- */

const EMITENTE_SELECT = {
  cnpj: true,
  ie: true,
  legalName: true,
  tradeName: true,
  street: true,
  number: true,
  complement: true,
  district: true,
  cityCode: true,
  cityName: true,
  state: true,
  zip: true,
  phone: true,
  rntrc: true,
  environment: true,
  mdfeSeries: true,
  mdfeEmitterType: true,
  insurerName: true,
  insurerTaxId: true,
  insurancePolicy: true,
  certSubject: true,
  certTaxId: true,
  certNotBefore: true,
  certNotAfter: true,
  certUploadedAt: true,
} as const;

type LinhaDoEmitente = Prisma.FiscalIssuerGetPayload<{ select: typeof EMITENTE_SELECT }>;

const tipoDaLinha = (texto: string): TipoDeEmitente => (texto === "2" ? "2" : "1");

function emitenteDaLinha(linha: LinhaDoEmitente): EmitenteDoMdfe {
  return {
    cnpj: linha.cnpj,
    ie: linha.ie,
    razaoSocial: linha.legalName,
    fantasia: linha.tradeName,
    endereco: { logradouro: linha.street, numero: linha.number, complemento: linha.complement, bairro: linha.district, codigoMunicipio: linha.cityCode, municipio: linha.cityName, uf: linha.state, cep: linha.zip },
    telefone: linha.phone,
    rntrc: linha.rntrc,
    serie: linha.mdfeSeries,
    ambiente: ambienteDaLinha(linha.environment),
    tipo: tipoDaLinha(linha.mdfeEmitterType),
  };
}

const seguroDaLinha = (linha: LinhaDoEmitente): SeguroPadrao =>
  linha.insurerName && linha.insurerTaxId && linha.insurancePolicy ? { seguradora: linha.insurerName, cnpjDaSeguradora: linha.insurerTaxId, apolice: linha.insurancePolicy } : null;

type NumeracaoDb = Pick<Tx, "mdfeNumbering">;

async function proximoNumero(db: NumeracaoDb, ambiente: Ambiente, serie: number): Promise<number> {
  const numeracao = await db.mdfeNumbering.findFirst({ where: { environment: ambiente, series: serie }, select: { nextNumber: true } });
  return numeracao?.nextNumber ?? 1;
}

/** Uma operação de numeração de MDF-e por vez na empresa. A trava some no fim da transação. */
async function travarNumeracao(tx: Tx, tenantId: string): Promise<void> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${"tms:mdfe:" + tenantId}))::text`;
}

/** A configuração do MDF-e da empresa, para a tela de MDF-e. */
export async function configuracaoDoMdfe(empresa: Empresa): Promise<ConfiguracaoDoMdfe> {
  const linha = await empresa.db.fiscalIssuer.findUnique({ where: { tenantId: empresa.id }, select: EMITENTE_SELECT });
  if (!linha) return { disponivel: false, ambiente: null, serie: 1, proximoNumero: 1, tipoDeEmitente: "1", seguradora: null, cnpjDaSeguradora: null, apolice: null };
  const ambiente = ambienteDaLinha(linha.environment);
  return {
    disponivel: true,
    ambiente,
    serie: linha.mdfeSeries,
    proximoNumero: await proximoNumero(empresa.db, ambiente, linha.mdfeSeries),
    tipoDeEmitente: tipoDaLinha(linha.mdfeEmitterType),
    seguradora: linha.insurerName,
    cnpjDaSeguradora: linha.insurerTaxId,
    apolice: linha.insurancePolicy,
  };
}

/** Grava a configuração. Não deixa o próximo número ficar abaixo de um MDF-e que a SEFAZ já autorizou. */
export async function salvarConfiguracao(empresa: Empresa, dados: ConfiguracaoDoFormulario, quem: Quem): Promise<ConfiguracaoDoMdfe> {
  await empresa.transacao(async (tx) => {
    await travarNumeracao(tx, empresa.id);
    const antes = await tx.fiscalIssuer.findUnique({ where: { tenantId: empresa.id }, select: EMITENTE_SELECT });
    if (!antes) throw new Refusal(SEM_EMITENTE_CADASTRADO, 409);
    const ambiente = ambienteDaLinha(antes.environment);

    const ultimo = await tx.mdfe.findFirst({
      where: { environment: ambiente, series: dados.serie, status: { in: ["AUTHORIZED", "CLOSED", "CANCELLED"] } },
      orderBy: { number: "desc" },
      select: { number: true },
    });
    if (ultimo && dados.proximoNumero <= ultimo.number) {
      throw new Refusal(`Já existe o MDF-e nº ${ultimo.number} autorizado nesta série e ambiente: o próximo número precisa ser ${ultimo.number + 1} ou maior.`, 409);
    }

    const depois = { mdfeSeries: dados.serie, mdfeEmitterType: dados.tipoDeEmitente, insurerName: dados.seguradora ?? null, insurerTaxId: dados.cnpjDaSeguradora ?? null, insurancePolicy: dados.apolice ?? null };
    await tx.fiscalIssuer.update({ where: { tenantId: empresa.id }, data: depois, select: { id: true } });

    const numeracao = await tx.mdfeNumbering.findFirst({ where: { environment: ambiente, series: dados.serie }, select: { id: true, nextNumber: true } });
    if (!numeracao) await tx.mdfeNumbering.create({ data: { environment: ambiente, series: dados.serie, nextNumber: dados.proximoNumero }, select: { id: true } });
    else if (numeracao.nextNumber !== dados.proximoNumero) await tx.mdfeNumbering.update({ where: { id: numeracao.id }, data: { nextNumber: dados.proximoNumero }, select: { id: true } });

    await registrarAuditoria(tx, {
      ...quem,
      acao: "mdfe.configurar",
      entidade: "empresa",
      entidadeId: empresa.id,
      resumo: "Configuração do MDF-e alterada",
      antes: { mdfeSeries: antes.mdfeSeries, mdfeEmitterType: antes.mdfeEmitterType, insurerName: antes.insurerName, insurerTaxId: antes.insurerTaxId, insurancePolicy: antes.insurancePolicy, proximoNumero: numeracao?.nextNumber ?? 1 },
      depois: { ...depois, proximoNumero: dados.proximoNumero },
    });
  }, COM_FILA);
  return configuracaoDoMdfe(empresa);
}

/** A empresa está pronta para emitir MDF-e? É o que as telas mostram no topo. */
export async function situacaoDaEmissao(empresa: Empresa): Promise<SituacaoDaEmissao> {
  const linha = await empresa.db.fiscalIssuer.findUnique({ where: { tenantId: empresa.id }, select: EMITENTE_SELECT });
  const faltas = [...(linha ? [] : [SEM_EMITENTE_CADASTRADO]), ...faltasDoCertificado(linha ? certificadoDaLinha(linha) : null)];
  return { pronta: faltas.length === 0, ambiente: linha ? ambienteDaLinha(linha.environment) : null, faltas, tipoDeEmitente: linha ? tipoDaLinha(linha.mdfeEmitterType) : null, damdfe: danfeLigado() };
}

/* ----------------------------------- Leitura ---------------------------------- */

const EVENTO_SELECT = { id: true, type: true, sequence: true, protocol: true, registeredAt: true, details: true } as const;

export const MDFE_SELECT = {
  id: true,
  manifestId: true,
  environment: true,
  series: true,
  number: true,
  accessKey: true,
  status: true,
  emitterType: true,
  loadState: true,
  unloadState: true,
  plate: true,
  statusCode: true,
  statusReason: true,
  protocol: true,
  authorizedAt: true,
  closedAt: true,
  cancelledAt: true,
  unanswered: true,
  updatedAt: true,
  events: { select: EVENTO_SELECT, orderBy: { registeredAt: "asc" } },
} as const;

type LinhaDoMdfe = Prisma.MdfeGetPayload<{ select: typeof MDFE_SELECT }>;
type LinhaDoEvento = LinhaDoMdfe["events"][number];

const ROTULO_DO_EVENTO: Record<string, string> = {
  [TIPO_DO_EVENTO.CANCELAMENTO]: "Cancelamento",
  [TIPO_DO_EVENTO.ENCERRAMENTO]: "Encerramento",
  [TIPO_DO_EVENTO.INCLUSAO_DE_CONDUTOR]: "Inclusão de condutor",
  [TIPO_DO_EVENTO.INCLUSAO_DE_DFE]: "Inclusão de DF-e",
};

function eventoParaATela(evento: LinhaDoEvento): EventoDoMdfe {
  const descricao = (evento.details as { descricao?: unknown } | null)?.descricao;
  return {
    id: evento.id,
    tipo: evento.type,
    sequencia: evento.sequence,
    protocolo: evento.protocol,
    registradoEm: evento.registeredAt.toISOString(),
    descricao: typeof descricao === "string" ? descricao : (ROTULO_DO_EVENTO[evento.type] ?? evento.type),
  };
}

/** O MDF-e para a tela. Sem XML. */
export function paraATela(mdfe: LinhaDoMdfe): MdfeEmitido {
  return {
    id: mdfe.id,
    manifestId: mdfe.manifestId,
    viagem: codigoDaViagem(mdfe.manifestId),
    ambiente: ambienteDaLinha(mdfe.environment),
    serie: mdfe.series,
    numero: mdfe.number,
    chave: mdfe.accessKey,
    situacao: mdfe.status as SituacaoDoMdfe,
    tipoDeEmitente: tipoDaLinha(mdfe.emitterType),
    ufDeInicio: mdfe.loadState,
    ufDeFim: mdfe.unloadState,
    placa: mdfe.plate,
    cStat: mdfe.statusCode,
    motivo: mdfe.statusReason,
    protocolo: mdfe.protocol,
    autorizadoEm: mdfe.authorizedAt?.toISOString() ?? null,
    encerradoEm: mdfe.closedAt?.toISOString() ?? null,
    canceladoEm: mdfe.cancelledAt?.toISOString() ?? null,
    semResposta: mdfe.unanswered,
    atualizadoEm: mdfe.updatedAt.toISOString(),
    eventos: mdfe.events.map(eventoParaATela),
  };
}

export const MAXIMO_DE_MDFES_NA_LISTA = 200;

/** Os MDF-e da empresa, do mais recente para o mais antigo (ou só os de uma viagem). */
export async function listarMdfes(empresa: Empresa, manifestId: string | null = null): Promise<MdfeEmitido[]> {
  const linhas = await empresa.db.mdfe.findMany({ where: manifestId ? { manifestId } : {}, orderBy: { updatedAt: "desc" }, take: MAXIMO_DE_MDFES_NA_LISTA, select: MDFE_SELECT });
  return linhas.map(paraATela);
}

const VEICULO_SELECT = {
  id: true,
  plate: true,
  renavam: true,
  tareKg: true,
  capacity: true,
  wheelType: true,
  bodyType: true,
  licenseState: true,
  ownerTaxId: true,
  ownerName: true,
  ownerRntrc: true,
  ownerIe: true,
  ownerState: true,
  ownerType: true,
} as const;

type LinhaDoVeiculo = Prisma.VehicleGetPayload<{ select: typeof VEICULO_SELECT }>;

const veiculoDaLinha = (linha: LinhaDoVeiculo): VeiculoDaViagem => ({
  id: linha.id,
  placa: linha.plate,
  renavam: linha.renavam,
  taraKg: linha.tareKg,
  capacidadeKg: linha.capacity === null ? null : Math.round(linha.capacity),
  rodado: linha.wheelType,
  carroceria: linha.bodyType,
  uf: linha.licenseState,
  proprietario: linha.ownerTaxId ? { documento: linha.ownerTaxId, nome: linha.ownerName, rntrc: linha.ownerRntrc, ie: linha.ownerIe, uf: linha.ownerState, tipo: linha.ownerType } : null,
});

const viagemSelect = (ambiente: Ambiente) =>
  ({
    id: true,
    status: true,
    departedAt: true,
    plannedDepartureAt: true,
    driver: { select: { cpf: true, user: { select: { name: true } } } },
    vehicle: { select: VEICULO_SELECT },
    collections: {
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        trackingCode: true,
        status: true,
        origin: true,
        destination: true,
        weight: true,
        invoiceValue: true,
        invoiceKey: true,
        deliveryZip: true,
        cteKey: true,
        cteStatus: true,
        client: { select: { companyName: true, cnpj: true } },
        ctes: { where: { environment: ambiente, status: "AUTHORIZED" }, orderBy: { authorizedAt: "desc" }, take: 1, select: { accessKey: true, xmlSent: true } },
        fiscalDocuments: { select: { accessKey: true, totalValue: true, grossWeight: true }, orderBy: { createdAt: "asc" }, take: 200 },
      },
    },
  }) as const;

type LinhaDaViagem = Prisma.ManifestGetPayload<{ select: ReturnType<typeof viagemSelect> }>;

function cargaDaLinha(linha: LinhaDaViagem["collections"][number], ambiente: Ambiente): CargaDaViagem {
  const emitido = linha.ctes[0];
  // Só em produção o CT-e registrado à mão (de outro sistema) vale: em homologação ele não existe na SEFAZ de teste.
  const registrado = ambiente === PRODUCAO && linha.cteKey && linha.cteStatus === "ISSUED" ? { chave: linha.cteKey, xml: null } : null;
  return {
    id: linha.id,
    trackingCode: linha.trackingCode,
    origin: linha.origin,
    destination: linha.destination,
    weight: linha.weight,
    invoiceValue: linha.invoiceValue,
    invoiceKey: linha.invoiceKey,
    deliveryZip: linha.deliveryZip,
    cliente: { nome: linha.client.companyName, documento: linha.client.cnpj },
    cte: emitido ? { chave: emitido.accessKey, xml: emitido.xmlSent } : registrado,
    notas: linha.fiscalDocuments.map((nota) => ({ chave: nota.accessKey, valor: nota.totalValue, peso: nota.grossWeight })),
  };
}

function viagemDaLinha(linha: LinhaDaViagem, ambiente: Ambiente): ViagemDoMdfe {
  return {
    id: linha.id,
    codigo: codigoDaViagem(linha.id),
    saida: linha.departedAt ?? linha.plannedDepartureAt,
    motorista: { nome: linha.driver.user.name, cpf: linha.driver.cpf },
    veiculo: veiculoDaLinha(linha.vehicle),
    cargas: linha.collections.map((carga) => cargaDaLinha(carga, ambiente)),
  };
}

type LeituraDb = Pick<Tx, "manifest" | "fiscalIssuer" | "vehicle" | "mdfe">;

type Lido = {
  linha: LinhaDaViagem;
  viagem: ViagemDoMdfe;
  emitente: EmitenteDoMdfe | null;
  seguroPadrao: SeguroPadrao;
  /** O que falta na empresa para assinar e transmitir. */
  faltasDaEmpresa: string[];
  ambiente: Ambiente;
};

/** Lê a viagem e a empresa, no ambiente em uso. */
async function lerViagem(db: LeituraDb, tenantId: string, manifestId: string): Promise<Lido> {
  const doEmitente = await db.fiscalIssuer.findUnique({ where: { tenantId }, select: EMITENTE_SELECT });
  const emitente = doEmitente ? emitenteDaLinha(doEmitente) : null;
  const ambiente: Ambiente = emitente?.ambiente ?? "HOMOLOGACAO";
  const linha = await db.manifest.findUnique({ where: { id: manifestId }, select: viagemSelect(ambiente) });
  if (!linha) throw new Refusal(VIAGEM_NAO_ENCONTRADA, 404);
  const faltasDaEmpresa = [...(doEmitente ? [] : [SEM_EMITENTE_CADASTRADO]), ...faltasDoCertificado(doEmitente ? certificadoDaLinha(doEmitente) : null)];
  return { linha, viagem: viagemDaLinha(linha, ambiente), emitente, seguroPadrao: doEmitente ? seguroDaLinha(doEmitente) : null, faltasDaEmpresa, ambiente };
}

/** Os veículos escolhidos como reboque, na ordem em que foram escolhidos. */
async function lerReboques(db: LeituraDb, ids: readonly string[]): Promise<VeiculoDaViagem[]> {
  if (ids.length === 0) return [];
  const linhas = await db.vehicle.findMany({ where: { id: { in: [...ids] } }, select: VEICULO_SELECT });
  return ids.flatMap((id) => linhas.filter((linha) => linha.id === id).map(veiculoDaLinha));
}

/** O preparo de uma UF, com o que falta na empresa e na viagem somado às pendências do documento. */
async function prepararUf(db: LeituraDb, lido: Lido, ufDeDescarga: string, entradas: EntradasDoMdfe): Promise<PreparoDoMdfe> {
  const preparo = prepararMdfe(lido.viagem, ufDeDescarga, entradas, {
    emitente: lido.emitente,
    seguroPadrao: lido.seguroPadrao,
    reboques: await lerReboques(db, entradas.reboques ?? []),
    enderecoDoQrCode: ENDERECO_DO_QR_CODE,
    achar: municipioDoTexto,
  });
  const daViagem = lido.linha.status === "CANCELLED" ? [VIAGEM_CANCELADA] : [];
  // A falta dos dados fiscais já vem do preparo; aqui entram as do certificado.
  const daEmpresa = lido.emitente ? lido.faltasDaEmpresa : lido.faltasDaEmpresa.filter((falta) => falta !== SEM_EMITENTE_CADASTRADO);
  return { ...preparo, pendencias: [...new Set([...daEmpresa, ...daViagem, ...preparo.pendencias])] };
}

const entradasGuardadas = (bruto: unknown): EntradasDoMdfe => {
  const lidas = entradasSchema.safeParse(bruto ?? {});
  return lidas.success ? lidas.data : {};
};

async function conferencia(db: LeituraDb & NumeracaoDb, lido: Lido, ufDeDescarga: string, entradas: EntradasDoMdfe | null): Promise<ConferenciaDoMdfe> {
  const ultimo = await db.mdfe.findFirst({
    where: { manifestId: lido.linha.id, environment: lido.ambiente, unloadState: ufDeDescarga },
    orderBy: { updatedAt: "desc" },
    select: { ...MDFE_SELECT, inputs: true, numberBurned: true },
  });
  const usadas = entradas ?? entradasGuardadas(ultimo?.inputs);
  const preparo = await prepararUf(db, lido, ufDeDescarga, usadas);
  const autorizado = ultimo?.status === "AUTHORIZED" || ultimo?.status === "CLOSED";
  const mantem = ultimo && (ultimo.status === "DRAFT" || ultimo.status === "REJECTED") && !ultimo.numberBurned && lido.emitente && ultimo.series === lido.emitente.serie;
  const numeroPrevisto = mantem ? ultimo.number : lido.emitente ? await proximoNumero(db, lido.ambiente, lido.emitente.serie) : 0;
  return {
    ufDeDescarga,
    pendencias: autorizado ? [JA_AUTORIZADO] : preparo.pendencias,
    avisos: preparo.avisos,
    resumo: lido.emitente ? { ...preparo.resumo, ambiente: lido.ambiente, serie: lido.emitente.serie, numeroPrevisto } : null,
    entradas: preparo.entradas,
    mdfe: ultimo ? paraATela(ultimo) : null,
  };
}

/** A aba "MDF-e" da viagem: uma conferência por UF de descarregamento, com o MDF-e que cada uma já tem. */
export async function mdfesDaViagem(empresa: Empresa, manifestId: string): Promise<MdfesDaViagem> {
  const lido = await lerViagem(empresa.db, empresa.id, manifestId);
  const ufs = ufsDeDescarga(lido.viagem, lido.emitente?.tipo ?? "1", municipioDoTexto);
  // Um MDF-e já emitido para uma UF que a viagem deixou de ter continua aparecendo (para encerrar ou cancelar).
  const emitidos = await empresa.db.mdfe.findMany({ where: { manifestId, environment: lido.ambiente }, select: { unloadState: true }, distinct: ["unloadState"] });
  const todas = [...new Set([...ufs, ...emitidos.map((emitido) => emitido.unloadState)])];
  const documentos: ConferenciaDoMdfe[] = [];
  for (const uf of todas) documentos.push(await conferencia(empresa.db, lido, uf, null));
  const frota = await empresa.db.vehicle.findMany({ where: { id: { not: lido.linha.vehicle.id } }, orderBy: { plate: "asc" }, take: 300, select: { id: true, plate: true } });
  return {
    pronta: lido.faltasDaEmpresa.length === 0,
    faltas: lido.faltasDaEmpresa,
    ambiente: lido.emitente ? lido.ambiente : null,
    damdfe: danfeLigado(),
    documentos,
    reboques: frota.map((veiculo) => ({ id: veiculo.id, placa: veiculo.plate })),
  };
}

/** "Conferir": o que vai no MDF-e de uma UF com o que a pessoa informou, e o que falta. Nada é enviado nem gravado. */
export async function conferirMdfe(empresa: Empresa, manifestId: string, ufDeDescarga: string, entradas: EntradasDoMdfe): Promise<ConferenciaDoMdfe> {
  return conferencia(empresa.db, await lerViagem(empresa.db, empresa.id, manifestId), ufDeDescarga, entradas);
}

/**
 * A viagem exige MDF-e e ainda não tem um autorizado? É o aviso (que não
 * bloqueia) ao liberar a saída. `null`: nada a avisar.
 */
export async function exigenciaSemMdfe(db: Pick<Tx, "manifest" | "mdfe">, manifestId: string): Promise<Exclude<ExigenciaDeMdfe, "nenhuma"> | null> {
  const viagem = await db.manifest.findUnique({ where: { id: manifestId }, select: { collections: { select: { origin: true, destination: true } } } });
  if (!viagem) return null;
  const exigencia = exigenciaDeMdfe(
    viagem.collections.map((carga) => {
      const origem = municipioDoTexto(carga.origin);
      const destino = municipioDoTexto(carga.destination);
      return { ufDeOrigem: origem?.uf ?? null, ufDeDestino: destino?.uf ?? null, mesmoMunicipio: origem !== null && destino !== null && origem.codigo === destino.codigo };
    }),
  );
  if (exigencia === "nenhuma") return null;
  // Só o de produção tem valor fiscal: o de homologação não cobre a viagem.
  const autorizado = await db.mdfe.findFirst({ where: { manifestId, environment: PRODUCAO, status: { in: ["AUTHORIZED", "CLOSED"] } }, select: { id: true } });
  return autorizado ? null : exigencia;
}

/** Os MDF-e autorizados (e não encerrados) da viagem, no ambiente de produção: é o que se oferece encerrar ao finalizar a viagem. */
export async function mdfesAbertosDaViagem(db: Pick<Tx, "mdfe">, manifestId: string): Promise<{ id: string; numero: number; ambiente: Ambiente }[]> {
  const abertos = await db.mdfe.findMany({ where: { manifestId, status: "AUTHORIZED" }, orderBy: { number: "asc" }, select: { id: true, number: true, environment: true } });
  return abertos.map((mdfe) => ({ id: mdfe.id, numero: mdfe.number, ambiente: ambienteDaLinha(mdfe.environment) }));
}

/* ----------------------------------- Emissão ---------------------------------- */

/** Um envio é dado como parado depois disto: cobre as consultas e o envio, com folga. */
const ENVIO_EM_ANDAMENTO_MS = 150_000;

const SEM_RESPOSTA = "O MDF-e ficou sem resposta: emitir de novo começa consultando a SEFAZ pela chave, sem duplicar.";

type Preparado = {
  id: string;
  chave: string;
  numero: number;
  xml: string;
  ambiente: Ambiente;
  cnpj: string;
  ufDeFim: string;
  /** O envio anterior ficou sem resposta: antes de reenviar, consulta a SEFAZ pela chave. */
  retomar: boolean;
  viagem: { id: string; codigo: string };
};

/**
 * Confere a SEFAZ antes de montar: os MDF-e não encerrados do emitente. Se um
 * deles é DESTA empresa, para a mesma placa, o mesmo tipo de emitente e a mesma
 * UF de descarregamento, a SEFAZ rejeitaria o novo (611): a emissão para aqui.
 * `ignorar` é a chave do próprio MDF-e quando a emissão é a retomada de um
 * envio sem resposta (ele pode estar lá, autorizado).
 */
async function barrarPorNaoEncerrado(empresa: Empresa, destino: DestinoDoMdfe, cnpj: string, alvo: { placa: string; ufDeFim: string; tipo: TipoDeEmitente; ignorar: string | null }): Promise<void> {
  let abertos: Awaited<ReturnType<typeof consultarNaoEncerrados>>;
  try {
    abertos = await consultarNaoEncerrados(destino, cnpj);
  } catch (erro) {
    if (erro instanceof SefazError) throw new Refusal(`${erro.message} A consulta de MDF-e não encerrados é feita antes de emitir: nada foi enviado. Tente de novo.`, STATUS_DA_FALHA(erro));
    throw erro;
  }
  if (abertos.cStat === CSTAT.NENHUM_NAO_ENCERRADO) return;
  if (abertos.cStat !== CSTAT.NAO_ENCERRADOS_LOCALIZADOS) {
    throw new Refusal(`A SEFAZ recusou a consulta de MDF-e não encerrados: ${frase(abertos.cStat, abertos.motivo)}. Nada foi enviado.`, 409);
  }
  const chaves = abertos.mdfes.map((aberto) => aberto.chave).filter((chave) => chave !== alvo.ignorar);
  if (chaves.length === 0) return;
  const daqui = await empresa.db.mdfe.findFirst({
    where: { accessKey: { in: chaves }, environment: destino.ambiente, plate: alvo.placa, unloadState: alvo.ufDeFim, emitterType: alvo.tipo },
    orderBy: { authorizedAt: "asc" },
    select: { number: true, manifestId: true },
  });
  if (daqui) {
    throw new Refusal(
      `O MDF-e nº ${daqui.number} (viagem #${codigoDaViagem(daqui.manifestId)}) está autorizado e não encerrado para a placa ${alvo.placa} com descarga em ${alvo.ufDeFim}: a SEFAZ rejeita outro enquanto ele estiver em aberto (rejeição 611). Encerre-o antes de emitir.`,
      409,
    );
  }
}

/**
 * Reserva o número, monta e assina o MDF-e e grava o rascunho, com a empresa
 * travada. Se há um envio sem resposta, não monta nada: devolve o mesmo XML.
 */
async function prepararEnvio(empresa: Empresa, manifestId: string, ufDeDescarga: string, entradas: EntradasDoMdfe, credencial: CredencialDaEmpresa, quem: Quem): Promise<Preparado> {
  return empresa.transacao(async (tx) => {
    await travarNumeracao(tx, empresa.id);
    const lido = await lerViagem(tx, empresa.id, manifestId);
    const { emitente, ambiente } = lido;
    const viagem = { id: lido.viagem.id, codigo: lido.viagem.codigo };

    const autorizado = await tx.mdfe.findFirst({ where: { manifestId, environment: ambiente, unloadState: ufDeDescarga, status: { in: ["AUTHORIZED", "CLOSED"] } }, select: { id: true } });
    if (autorizado) throw new Refusal(JA_AUTORIZADO, 409);

    const pendente = await tx.mdfe.findFirst({
      where: { manifestId, environment: ambiente, unloadState: ufDeDescarga, status: { in: ["DRAFT", "REJECTED"] } },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true, series: true, number: true, accessKey: true, xmlSent: true, sendingAt: true, unanswered: true, numberBurned: true },
    });
    const agora = new Date();
    if (pendente?.sendingAt && agora.getTime() - pendente.sendingAt.getTime() < ENVIO_EM_ANDAMENTO_MS) throw new Refusal(EMISSAO_EM_ANDAMENTO, 409);

    if (pendente && pendente.status === "DRAFT" && pendente.unanswered && emitente) {
      await tx.mdfe.update({ where: { id: pendente.id }, data: { sendingAt: agora }, select: { id: true } });
      return { id: pendente.id, chave: pendente.accessKey, numero: pendente.number, xml: pendente.xmlSent, ambiente, cnpj: emitente.cnpj, ufDeFim: ufDeDescarga, retomar: true, viagem };
    }

    const preparo = await prepararUf(tx, lido, ufDeDescarga, entradas);
    if (preparo.pendencias.length > 0 || !emitente || !preparo.dados) throw new Refusal(preparo.pendencias[0] ?? SEM_CARGA_PARA_A_UF, 409);

    // Rejeição não consome o número: o reenvio usa o mesmo, salvo quando a SEFAZ disse que ele já foi usado.
    let numero: number;
    if (pendente && !pendente.numberBurned && pendente.series === emitente.serie) {
      numero = pendente.number;
    } else {
      const numeracao = await tx.mdfeNumbering.findFirst({ where: { environment: ambiente, series: emitente.serie }, select: { id: true, nextNumber: true } });
      numero = numeracao?.nextNumber ?? 1;
      if (numeracao) await tx.mdfeNumbering.update({ where: { id: numeracao.id }, data: { nextNumber: numero + 1 }, select: { id: true } });
      else await tx.mdfeNumbering.create({ data: { environment: ambiente, series: emitente.serie, nextNumber: numero + 1 }, select: { id: true } });
    }

    const montado = montarMdfe({ ...preparo.dados, numero, codigo: sortearCodigo(), emissao: agora });
    const xml = assinarXml(montado.xml, ALVO_DO_MDFE, { chavePem: credencial.chavePem, certificadoPem: credencial.titularPem });
    const dados = {
      series: emitente.serie,
      number: numero,
      accessKey: montado.chave,
      status: "DRAFT",
      emitterType: emitente.tipo,
      loadState: preparo.dados.ufDeInicio,
      plate: preparo.dados.rodo.tracao.placa,
      inputs: entradas as Prisma.InputJsonValue,
      xmlSent: xml,
      issuedAt: agora,
      sendingAt: agora,
      unanswered: false,
      numberBurned: false,
      statusCode: null,
      statusReason: null,
      issuedById: quem.ator.id,
    };
    const gravado = pendente
      ? await tx.mdfe.update({ where: { id: pendente.id }, data: dados, select: { id: true } })
      : await tx.mdfe.create({ data: { ...dados, manifestId, environment: ambiente, unloadState: ufDeDescarga }, select: { id: true } });
    return { id: gravado.id, chave: montado.chave, numero, xml, ambiente, cnpj: emitente.cnpj, ufDeFim: ufDeDescarga, retomar: false, viagem };
  }, COM_FILA);
}

type EventoDeIntegracao = "mdfe.autorizado" | "mdfe.encerrado" | "mdfe.cancelado";

/** Quando há endereço de integração, põe o evento na fila, na mesma transação da mudança. */
async function avisarIntegracao(tx: Tx, tipo: EventoDeIntegracao, mdfeId: string): Promise<void> {
  const webhook = await tx.webhook.findFirst({ select: { id: true } });
  if (!webhook) return;
  await tx.outboxEvent.create({ data: { type: tipo, payload: { mdfeId } }, select: { id: true } });
}

const emHomologacao = (ambiente: Ambiente) => (ambiente === PRODUCAO ? "" : " em homologação (sem valor fiscal)");

/** Grava a autorização: só chega aqui com o protocolo que a SEFAZ devolveu. */
async function gravarAutorizacao(empresa: Empresa, preparado: Preparado, protocolo: Protocolo & { numero: string }, quem: Quem): Promise<LinhaDoMdfe> {
  return empresa.transacao(async (tx) => {
    const gravado = await tx.mdfe.update({
      where: { id: preparado.id },
      data: {
        status: "AUTHORIZED",
        protocol: protocolo.numero,
        xmlReturn: montarProcMdfe(preparado.xml, protocolo.xml),
        statusCode: protocolo.cStat,
        statusReason: protocolo.motivo.slice(0, MOTIVO_MAXIMO),
        authorizedAt: protocolo.recebidoEm ?? new Date(),
        sendingAt: null,
        unanswered: false,
      },
      select: MDFE_SELECT,
    });
    await registrarAuditoria(tx, {
      ...quem,
      acao: "mdfe.emitir",
      entidade: "mdfe",
      entidadeId: preparado.id,
      resumo: `MDF-e nº ${preparado.numero} autorizado${emHomologacao(preparado.ambiente)} para a viagem #${preparado.viagem.codigo} (descarga em ${preparado.ufDeFim})`,
      depois: { number: preparado.numero, accessKey: preparado.chave, environment: preparado.ambiente, protocol: protocolo.numero, manifestId: preparado.viagem.id },
    });
    await avisarEquipe(tx, "fiscalVer", avisoDeMdfe("autorizado", { numero: preparado.numero, ambiente: preparado.ambiente, viagem: preparado.viagem.codigo }), quem.ator.id);
    await avisarIntegracao(tx, "mdfe.autorizado", preparado.id);
    return gravado;
  });
}

type Mudanca = { status?: SituacaoDoMdfe; statusCode?: number | null; statusReason: string; unanswered?: boolean; numberBurned?: boolean };

/** Grava o que não é autorização: rejeição, serviço parado, envio sem resposta. Solta a marca de envio em andamento. */
async function gravarSemAutorizacao(empresa: Empresa, id: string, mudanca: Mudanca): Promise<LinhaDoMdfe> {
  return empresa.db.mdfe.update({ where: { id }, data: { ...mudanca, statusReason: mudanca.statusReason.slice(0, MOTIVO_MAXIMO), sendingAt: null }, select: MDFE_SELECT });
}

const resultado = (mdfe: LinhaDoMdfe, autorizado: boolean, mensagem: string): ResultadoDaEmissao => ({ mdfe: paraATela(mdfe), autorizado, mensagem });

/**
 * Emite o MDF-e de uma UF de descarregamento da viagem: consulta os não
 * encerrados, reserva o número, monta, assina, envia e grava a resposta.
 *
 * - Autorizado (com protocolo): grava o mdfeProc.
 * - Rejeitado: fica "rejeitado" com o código e o motivo; emitir de novo refaz o
 *   documento com o mesmo número.
 * - Sem resposta: fica como rascunho "sem resposta"; emitir de novo consulta a
 *   SEFAZ pela chave antes de reenviar o MESMO XML.
 * Falha de rede vira `Refusal` 502/504.
 */
export async function emitirMdfe(empresa: Empresa, manifestId: string, ufDeDescarga: string, entradas: EntradasDoMdfe, quem: Quem): Promise<ResultadoDaEmissao> {
  const credencial = await credencialDaEmpresa(empresa);

  // Antes de reservar número: o que falta e o que a SEFAZ já tem em aberto.
  const lido = await lerViagem(empresa.db, empresa.id, manifestId);
  if (!lido.emitente) throw new Refusal(SEM_EMITENTE_CADASTRADO, 409);
  const semResposta = await empresa.db.mdfe.findFirst({
    where: { manifestId, environment: lido.ambiente, unloadState: ufDeDescarga, status: "DRAFT", unanswered: true },
    orderBy: { createdAt: "desc" },
    select: { accessKey: true },
  });
  if (!semResposta) {
    const antes = await conferencia(empresa.db, lido, ufDeDescarga, entradas);
    if (antes.pendencias.length > 0) throw new Refusal(antes.pendencias[0], 409);
  }
  const destino: DestinoDoMdfe = { ambiente: lido.ambiente, credencial };
  await barrarPorNaoEncerrado(empresa, destino, lido.emitente.cnpj, { placa: lido.viagem.veiculo.placa, ufDeFim: ufDeDescarga, tipo: lido.emitente.tipo, ignorar: semResposta?.accessKey ?? null });

  const preparado = await prepararEnvio(empresa, manifestId, ufDeDescarga, entradas, credencial, quem);
  const esperado: Esperado = { chave: preparado.chave, ambiente: preparado.ambiente, resumo: resumoDaAssinatura(preparado.xml) };

  let decisao: Decisao;
  try {
    let jaEstaLa: Decisao | null = null;
    if (preparado.retomar) {
      const consulta = decidir(await consultarMdfe(destino, preparado.chave), esperado);
      if (consulta.tipo === "autorizado") jaEstaLa = consulta;
      // "Não consta" é o único caso em que o mesmo XML é enviado de novo.
      else if (!(consulta.tipo === "rejeitado" && consulta.cStat === CSTAT.NAO_CONSTA)) {
        const motivo = consulta.tipo === "incoerente" ? consulta.motivo : frase(consulta.cStat, consulta.motivo);
        jaEstaLa = { tipo: "incoerente", motivo: `A consulta pela chave não esclareceu a situação do MDF-e: ${motivo}` };
      }
    }
    decisao = jaEstaLa ?? decidir(await enviarMdfe(destino, preparado.xml), esperado);
    // 204: este mesmo MDF-e já está autorizado lá. O protocolo vem pela consulta.
    if (decisao.tipo === "ja-autorizado") {
      const consulta = decidir(await consultarMdfe(destino, preparado.chave), esperado);
      decisao = consulta.tipo === "autorizado" ? consulta : { tipo: "incoerente", motivo: `${frase(decisao.cStat, decisao.motivo)} A consulta pela chave não devolveu o protocolo.` };
    }
  } catch (erro) {
    if (!(erro instanceof SefazError)) {
      await gravarSemAutorizacao(empresa, preparado.id, { statusReason: "Falha interna no envio.", unanswered: preparado.retomar });
      throw erro;
    }
    const ficouSemResposta = erro.incerto || preparado.retomar;
    await gravarSemAutorizacao(empresa, preparado.id, { statusReason: erro.message, unanswered: ficouSemResposta });
    throw new Refusal(ficouSemResposta ? `${erro.message} ${SEM_RESPOSTA}` : `${erro.message} O MDF-e não chegou a ser processado: tente de novo.`, STATUS_DA_FALHA(erro));
  }

  if (decisao.tipo === "autorizado") {
    const mdfe = await gravarAutorizacao(empresa, preparado, decisao.protocolo, quem);
    return resultado(mdfe, true, `MDF-e nº ${preparado.numero} autorizado${emHomologacao(preparado.ambiente)}. Protocolo ${decisao.protocolo.numero}.`);
  }

  if (decisao.tipo === "incoerente") {
    await gravarSemAutorizacao(empresa, preparado.id, { statusReason: decisao.motivo, unanswered: true });
    throw new Refusal(`${decisao.motivo} ${SEM_RESPOSTA}`, 502);
  }

  if (decisao.tipo === "parado") {
    const mdfe = await gravarSemAutorizacao(empresa, preparado.id, { statusCode: decisao.cStat, statusReason: decisao.motivo, unanswered: preparado.retomar });
    return resultado(mdfe, false, `A SEFAZ não processou o MDF-e: ${frase(decisao.cStat, decisao.motivo)}. Tente de novo mais tarde.`);
  }

  const numeroUsado = decisao.tipo === "numero-usado";
  const mdfe = await gravarSemAutorizacao(empresa, preparado.id, { status: "REJECTED", statusCode: decisao.cStat, statusReason: decisao.motivo, unanswered: false, numberBurned: numeroUsado });
  await registrarAuditoriaDepois(empresa.db, {
    ...quem,
    acao: "mdfe.rejeitar",
    entidade: "mdfe",
    entidadeId: preparado.id,
    resumo: `MDF-e nº ${preparado.numero} da viagem #${preparado.viagem.codigo} rejeitado pela SEFAZ: ${frase(decisao.cStat, decisao.motivo)}`,
    depois: { number: preparado.numero, environment: preparado.ambiente, statusCode: decisao.cStat, manifestId: preparado.viagem.id },
  });
  const complemento = numeroUsado
    ? " O número já foi usado por outro documento: a próxima tentativa usa o número seguinte."
    : REJEICOES_POR_NAO_ENCERRADO.includes(decisao.cStat)
      ? " Há MDF-e anterior em aberto na SEFAZ: encerre-o (consulte os não encerrados na tela de MDF-e) e emita de novo."
      : "";
  return resultado(mdfe, false, `A SEFAZ rejeitou o MDF-e: ${frase(decisao.cStat, decisao.motivo)}.${complemento}`);
}

/* ----------------------------------- Eventos ---------------------------------- */

const ALVO_SELECT = {
  id: true,
  status: true,
  environment: true,
  number: true,
  accessKey: true,
  protocol: true,
  issuedAt: true,
  authorizedAt: true,
  manifestId: true,
  unloadState: true,
  manifest: { select: { status: true, collections: { select: { status: true } } } },
} as const;

type Alvo = Prisma.MdfeGetPayload<{ select: typeof ALVO_SELECT }>;

type Envio = { alvo: Alvo; ambiente: Ambiente; cnpj: string; destino: DestinoDoMdfe; credencial: CredencialDaEmpresa };

/** Lê o MDF-e e o que é preciso para assinar e enviar um evento dele. */
async function prepararEvento(empresa: Empresa, mdfeId: string, recusa: string): Promise<Envio & { protocolo: string }> {
  const alvo = await empresa.db.mdfe.findUnique({ where: { id: mdfeId }, select: ALVO_SELECT });
  if (!alvo) throw new Refusal(MDFE_NAO_ENCONTRADO, 404);
  if (alvo.status !== "AUTHORIZED" || !alvo.protocol) throw new Refusal(recusa, 409);
  const doEmitente = await empresa.db.fiscalIssuer.findUnique({ where: { tenantId: empresa.id }, select: { cnpj: true } });
  if (!doEmitente) throw new Refusal(SEM_EMITENTE_CADASTRADO, 409);
  const credencial = await credencialDaEmpresa(empresa);
  const ambiente = ambienteDaLinha(alvo.environment);
  return { alvo, ambiente, cnpj: doEmitente.cnpj, destino: { ambiente, credencial }, credencial, protocolo: alvo.protocol };
}

type Registro = {
  /** Protocolo do registro. `null`: a SEFAZ só confirmou que o evento já estava lá. */
  protocolo: string | null;
  quando: Date;
  cStat: number;
  motivo: string;
  xmlEnviado: string;
  xmlDoRetorno: string;
};

/**
 * Assina e envia o evento. Devolve o registro quando a SEFAZ registra (135, com
 * protocolo, para a chave e o tipo enviados) ou quando `jaEstava` reconhece que
 * o evento já tinha sido registrado antes (a resposta anterior se perdeu).
 * Qualquer outra resposta é recusa: `Refusal` 409 com o motivo da SEFAZ.
 */
async function enviarERegistrar(
  envio: Envio,
  evento: EventoMontado,
  oQue: string,
  jaEstava: (resposta: RespostaDoEvento) => Promise<boolean> = async () => false,
): Promise<Registro> {
  const assinado = assinarXml(evento.xml, ALVO_DO_EVENTO_DO_MDFE, { chavePem: envio.credencial.chavePem, certificadoPem: envio.credencial.titularPem });
  try {
    const resposta = await enviarEvento(envio.destino, assinado);
    const base = { cStat: resposta.cStat, motivo: resposta.motivo.slice(0, MOTIVO_MAXIMO), xmlEnviado: assinado, xmlDoRetorno: resposta.xml };
    if (eventoRegistrado(resposta, { chave: envio.alvo.accessKey, tipo: evento.tipo })) return { ...base, protocolo: resposta.protocolo, quando: resposta.registradoEm ?? new Date() };
    if (await jaEstava(resposta)) return { ...base, protocolo: null, quando: new Date() };
    throw new Refusal(`A SEFAZ recusou ${oQue}: ${frase(resposta.cStat, resposta.motivo)}.`, 409);
  } catch (erro) {
    if (erro instanceof SefazError) throw new Refusal(`${erro.message} O MDF-e continua como estava: tente de novo.`, STATUS_DA_FALHA(erro));
    throw erro;
  }
}

/** A linha do evento registrado: o procEventoMDFe (evento assinado + retorno) e o protocolo. */
const linhaDoEvento = (mdfeId: string, evento: EventoMontado, registro: Registro, descricao: string, autor: string | null) => ({
  mdfeId,
  type: evento.tipo,
  sequence: evento.sequencia,
  xmlSent: registro.xmlEnviado,
  xmlReturn: registro.xmlDoRetorno ? montarProcEvento(registro.xmlEnviado, registro.xmlDoRetorno) : "",
  protocol: registro.protocolo,
  statusCode: registro.cStat,
  statusReason: registro.motivo,
  registeredAt: registro.quando,
  details: { descricao },
  createdById: autor,
});

/** O dia (AAAA-MM-DD) de um instante no relógio de Brasília. */
const diaEmBrasilia = (instante: Date) => new Date(instante.getTime() - 3 * 3_600_000).toISOString().slice(0, 10);

/**
 * Encerra um MDF-e autorizado: monta, assina e envia o evento 110112, com o dia
 * e o município em que a viagem terminou. Só fica "encerrado" com o evento
 * registrado pela SEFAZ, ou quando ela responde que já estava encerrado (609) e
 * a consulta pela chave confirma (132).
 */
export async function encerrarMdfe(empresa: Empresa, mdfeId: string, dados: { dia: string; cidade: string; uf: string }, quem: Quem): Promise<MdfeEmitido> {
  const envio = await prepararEvento(empresa, mdfeId, SO_AUTORIZADO_ENCERRA);
  const { alvo } = envio;
  const municipio = municipioDoTexto(`${dados.cidade} - ${dados.uf}`);
  if (!municipio || municipio.uf !== dados.uf) throw new Refusal("Cidade não encontrada na tabela de municípios do IBGE para a UF informada. Confira a grafia.", 400);
  // Regra K07 (rejeição 615) e a data do evento, que não pode passar de hoje.
  if (dados.dia < diaEmBrasilia(alvo.issuedAt) || dados.dia > diaEmBrasilia(new Date())) throw new Refusal(DATA_DE_ENCERRAMENTO_INVALIDA, 400);

  const evento = montarEncerramento({ chave: alvo.accessKey, cnpj: envio.cnpj, ambiente: envio.ambiente, quando: new Date(), protocolo: envio.protocolo, dia: dados.dia, municipio });
  const registro = await enviarERegistrar(envio, evento, "o encerramento", async (resposta) => resposta.cStat === CSTAT.JA_ENCERRADO && (await consultarMdfe(envio.destino, alvo.accessKey)).cStat === CSTAT.ENCERRADO);

  const codigo = codigoDaViagem(alvo.manifestId);
  const gravado = await empresa.transacao(async (tx) => {
    const atualizado = await tx.mdfe.update({ where: { id: alvo.id }, data: { status: "CLOSED", closedAt: registro.quando, closeProtocol: registro.protocolo }, select: { id: true } });
    await tx.mdfeEvent.create({ data: linhaDoEvento(alvo.id, evento, registro, `Encerrado em ${municipio.nome}/${municipio.uf}, em ${dados.dia.split("-").reverse().join("/")}`, quem.ator.id), select: { id: true } });
    await registrarAuditoria(tx, {
      ...quem,
      acao: "mdfe.encerrar",
      entidade: "mdfe",
      entidadeId: alvo.id,
      resumo: `MDF-e nº ${alvo.number} da viagem #${codigo} encerrado em ${municipio.nome}/${municipio.uf}`,
      antes: { status: "AUTHORIZED" },
      depois: { status: "CLOSED", closeProtocol: registro.protocolo, cidade: `${municipio.nome}/${municipio.uf}`, dia: dados.dia },
    });
    await avisarEquipe(tx, "fiscalVer", avisoDeMdfe("encerrado", { numero: alvo.number, ambiente: envio.ambiente, viagem: codigo }), quem.ator.id);
    await avisarIntegracao(tx, "mdfe.encerrado", alvo.id);
    return tx.mdfe.findUniqueOrThrow({ where: { id: atualizado.id }, select: MDFE_SELECT });
  });
  return paraATela(gravado);
}

/**
 * Cancela um MDF-e autorizado: evento 110111, dentro de 24 horas da
 * autorização e sem o transporte ter começado. Só fica "cancelado" com o
 * evento registrado pela SEFAZ, ou quando ela responde que já estava cancelado
 * (218) e a consulta pela chave confirma (101).
 */
export async function cancelarMdfe(empresa: Empresa, mdfeId: string, justificativa: string, quem: Quem): Promise<MdfeEmitido> {
  const envio = await prepararEvento(empresa, mdfeId, SO_AUTORIZADO_CANCELA);
  const { alvo } = envio;
  if (!dentroDoPrazoDeCancelamento(alvo.authorizedAt)) throw new Refusal(FORA_DO_PRAZO, 409);
  // O que o sistema sabe do transporte: viagem finalizada ou com entrega feita já começou. O resto a pessoa confirma na tela, e a SEFAZ confere (rejeição 219).
  if (alvo.manifest.status === "FINISHED" || alvo.manifest.collections.some((carga) => carga.status === "DELIVERED")) throw new Refusal(TRANSPORTE_JA_INICIADO, 409);

  const evento = montarCancelamento({ chave: alvo.accessKey, cnpj: envio.cnpj, ambiente: envio.ambiente, quando: new Date(), protocolo: envio.protocolo, justificativa });
  const registro = await enviarERegistrar(envio, evento, "o cancelamento", async (resposta) => resposta.cStat === CSTAT.JA_CANCELADO && (await consultarMdfe(envio.destino, alvo.accessKey)).cStat === CSTAT.CANCELADO);

  const codigo = codigoDaViagem(alvo.manifestId);
  const gravado = await empresa.transacao(async (tx) => {
    await tx.mdfe.update({ where: { id: alvo.id }, data: { status: "CANCELLED", cancelledAt: registro.quando, cancelProtocol: registro.protocolo, cancelReason: justificativa }, select: { id: true } });
    await tx.mdfeEvent.create({ data: linhaDoEvento(alvo.id, evento, registro, `Cancelado: ${justificativa}`.slice(0, 200), quem.ator.id), select: { id: true } });
    await registrarAuditoria(tx, {
      ...quem,
      acao: "mdfe.cancelar",
      entidade: "mdfe",
      entidadeId: alvo.id,
      resumo: `MDF-e nº ${alvo.number} da viagem #${codigo} cancelado`,
      antes: { status: "AUTHORIZED" },
      depois: { status: "CANCELLED", cancelProtocol: registro.protocolo, cancelReason: justificativa },
    });
    await avisarEquipe(tx, "fiscalVer", avisoDeMdfe("cancelado", { numero: alvo.number, ambiente: envio.ambiente, viagem: codigo }), quem.ator.id);
    await avisarIntegracao(tx, "mdfe.cancelado", alvo.id);
    return tx.mdfe.findUniqueOrThrow({ where: { id: alvo.id }, select: MDFE_SELECT });
  });
  return paraATela(gravado);
}

/** O esquema e a regra K01 limitam a 99 inclusões de condutor por MDF-e. */
const MAXIMO_DE_INCLUSOES = 99;

/** Inclui um condutor num MDF-e autorizado (evento 110114). A sequência é a próxima deste MDF-e. */
export async function incluirCondutor(empresa: Empresa, mdfeId: string, condutor: { nome: string; cpf: string }, quem: Quem): Promise<MdfeEmitido> {
  const envio = await prepararEvento(empresa, mdfeId, SO_AUTORIZADO_RECEBE_EVENTO);
  const { alvo } = envio;
  const ultimo = await empresa.db.mdfeEvent.findFirst({ where: { mdfeId, type: TIPO_DO_EVENTO.INCLUSAO_DE_CONDUTOR }, orderBy: { sequence: "desc" }, select: { sequence: true } });
  const sequencia = (ultimo?.sequence ?? 0) + 1;
  if (sequencia > MAXIMO_DE_INCLUSOES) throw new Refusal(`Este MDF-e já tem ${MAXIMO_DE_INCLUSOES} inclusões de condutor, o máximo que a SEFAZ aceita.`, 409);

  const evento = montarInclusaoDeCondutor({ chave: alvo.accessKey, cnpj: envio.cnpj, ambiente: envio.ambiente, quando: new Date(), sequencia, condutor });
  const registro = await enviarERegistrar(envio, evento, "a inclusão do condutor");

  const gravado = await empresa.transacao(async (tx) => {
    await tx.mdfeEvent.create({ data: linhaDoEvento(alvo.id, evento, registro, `Condutor incluído: ${condutor.nome}`, quem.ator.id), select: { id: true } });
    await registrarAuditoria(tx, {
      ...quem,
      acao: "mdfe.condutor",
      entidade: "mdfe",
      entidadeId: alvo.id,
      resumo: `Condutor ${condutor.nome} incluído no MDF-e nº ${alvo.number} da viagem #${codigoDaViagem(alvo.manifestId)}`,
      depois: { condutor: condutor.nome, sequence: sequencia, protocol: registro.protocolo },
    });
    return tx.mdfe.findUniqueOrThrow({ where: { id: alvo.id }, select: MDFE_SELECT });
  });
  return paraATela(gravado);
}

/* ------------------------- XML, DAMDFE e consultas à SEFAZ --------------------- */

/** O arquivo do MDF-e autorizado (mdfeProc), para baixar. Só existe para o que a SEFAZ autorizou. */
export async function xmlDoMdfe(empresa: Empresa, mdfeId: string): Promise<{ chave: string; xml: string }> {
  const mdfe = await empresa.db.mdfe.findUnique({ where: { id: mdfeId }, select: { accessKey: true, status: true, xmlReturn: true } });
  if (!mdfe) throw new Refusal(MDFE_NAO_ENCONTRADO, 404);
  if (!["AUTHORIZED", "CLOSED", "CANCELLED"].includes(mdfe.status) || !mdfe.xmlReturn) throw new Refusal(SO_AUTORIZADO_TEM_XML, 409);
  return { chave: mdfe.accessKey, xml: mdfe.xmlReturn };
}

/** O que a rota do DAMDFE precisa: o mdfeProc de um MDF-e autorizado (ou encerrado), e se ele é de homologação. */
export async function damdfeDoMdfe(empresa: Empresa, mdfeId: string): Promise<{ chave: string; xml: string; homologacao: boolean }> {
  const mdfe = await empresa.db.mdfe.findUnique({ where: { id: mdfeId }, select: { accessKey: true, status: true, environment: true, protocol: true, xmlReturn: true } });
  if (!mdfe) throw new Refusal(MDFE_NAO_ENCONTRADO, 404);
  if ((mdfe.status !== "AUTHORIZED" && mdfe.status !== "CLOSED") || !mdfe.protocol || !mdfe.xmlReturn) throw new Refusal(SO_AUTORIZADO_TEM_DAMDFE, 409);
  return { chave: mdfe.accessKey, xml: mdfe.xmlReturn, homologacao: mdfe.environment !== PRODUCAO };
}

async function emitenteECredencial(empresa: Empresa): Promise<{ cnpj: string; destino: DestinoDoMdfe }> {
  const doEmitente = await empresa.db.fiscalIssuer.findUnique({ where: { tenantId: empresa.id }, select: { cnpj: true, environment: true } });
  if (!doEmitente) throw new Refusal(SEM_EMITENTE_CADASTRADO, 409);
  return { cnpj: doEmitente.cnpj, destino: { ambiente: ambienteDaLinha(doEmitente.environment), credencial: await credencialDaEmpresa(empresa) } };
}

/** Pergunta à SVRS, no ambiente em uso, se o serviço de MDF-e está em operação. */
export async function statusDoServicoDaEmpresa(empresa: Empresa): Promise<StatusDoServico> {
  const { destino } = await emitenteECredencial(empresa);
  const base = { ambiente: destino.ambiente, autorizador: AUTORIZADOR_DO_MDFE };
  try {
    const resposta = await statusDoServico(destino);
    return { ...base, emOperacao: resposta.emOperacao, cStat: resposta.cStat, motivo: resposta.motivo };
  } catch (erro) {
    if (erro instanceof SefazError) return { ...base, emOperacao: false, cStat: null, motivo: erro.message };
    throw erro;
  }
}

/** Os MDF-e que a SEFAZ tem como autorizados e não encerrados para o emitente, com o registro daqui de cada um (quando há). */
export async function naoEncerradosDaEmpresa(empresa: Empresa): Promise<RespostaDeNaoEncerrados> {
  const { cnpj, destino } = await emitenteECredencial(empresa);
  let resposta: Awaited<ReturnType<typeof consultarNaoEncerrados>>;
  try {
    resposta = await consultarNaoEncerrados(destino, cnpj);
  } catch (erro) {
    if (erro instanceof SefazError) throw new Refusal(erro.message, STATUS_DA_FALHA(erro));
    throw erro;
  }
  const daqui = resposta.mdfes.length === 0 ? [] : await empresa.db.mdfe.findMany({ where: { accessKey: { in: resposta.mdfes.map((aberto) => aberto.chave) } }, select: MDFE_SELECT });
  return {
    ambiente: destino.ambiente,
    cStat: resposta.cStat,
    motivo: resposta.motivo,
    mdfes: resposta.mdfes.map((aberto) => {
      const linha = daqui.find((mdfe) => mdfe.accessKey === aberto.chave);
      const mdfe = linha ? paraATela(linha) : null;
      return { ...aberto, mdfe: mdfe && { id: mdfe.id, numero: mdfe.numero, viagem: mdfe.viagem, placa: mdfe.placa, ufDeFim: mdfe.ufDeFim, autorizadoEm: mdfe.autorizadoEm } };
    }),
  };
}

/* ----------------------- Aviso de MDF-e autorizado e em aberto ------------------ */

/**
 * O despachante chama a cada varredura (src/lib/eventos.ts): avisa a equipe, uma
 * vez por MDF-e, dos que estão autorizados há mais de
 * `DIAS_PARA_AVISAR_ENCERRAMENTO` dias sem encerramento. Devolve quantos avisou.
 */
export async function avisarMdfesEmAberto(agora: Date = new Date()): Promise<number> {
  const limite = new Date(agora.getTime() - DIAS_PARA_AVISAR_ENCERRAMENTO * 86_400_000);
  const abertos = await sistema.mdfe.findMany({
    where: { status: "AUTHORIZED", authorizedAt: { lt: limite }, closeReminderAt: null },
    orderBy: { authorizedAt: "asc" },
    take: 100,
    select: { id: true, tenantId: true, number: true, environment: true, manifestId: true, plate: true, authorizedAt: true },
  });
  let avisados = 0;
  for (const mdfe of abertos) {
    const empresa = empresaPorId(mdfe.tenantId);
    await empresa.transacao(async (tx) => {
      // Marca primeiro, e só avisa se foi esta volta que marcou: duas cópias do servidor não avisam em dobro.
      const marcado = await tx.mdfe.updateMany({ where: { id: mdfe.id, status: "AUTHORIZED", closeReminderAt: null }, data: { closeReminderAt: agora } });
      if (marcado.count === 0) return;
      await avisarEquipe(
        tx,
        "fiscalVer",
        avisoDeMdfeEmAberto({ numero: mdfe.number, ambiente: mdfe.environment, viagem: codigoDaViagem(mdfe.manifestId), placa: mdfe.plate, dias: diasDesde(mdfe.authorizedAt, agora) }),
        null,
      );
      avisados += 1;
    });
  }
  return avisados;
}
