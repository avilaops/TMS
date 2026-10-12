import type { Prisma } from "@prisma/client";
import { Refusal } from "@/lib/cadastros";
import { registrarAuditoria, registrarAuditoriaDepois, type Origem, type QualquerAtor } from "@/lib/auditoria";
import { empresaPorId, type Empresa } from "@/lib/cobranca-gateway-db";
import { SEM_EMITENTE_CADASTRADO } from "@/lib/cte";
import { assinarTexto, assinarXml, resumoDaAssinatura } from "@/lib/cte/assinar";
import { COM_FILA, STATUS_DA_FALHA, ambienteDaLinha, certificadoDaLinha, credencialDaEmpresa, faltasDoCertificado, frase, sortearCodigo, type CredencialDaEmpresa } from "@/lib/cte-db";
import { eventoGuardadoComRessalva, eventoRegistrado, fraseDoEventoComRessalva, type Decisao, type Esperado, type Protocolo, type RespostaDoEvento } from "@/lib/cte/sefaz";
import { SefazError } from "@/lib/cte/soap";
import { danfeLigado } from "@/lib/fiscal-mcp";
import {
  DATA_DE_ENCERRAMENTO_INVALIDA,
  DIAS_PARA_AVISAR_ENCERRAMENTO,
  EMISSAO_EM_ANDAMENTO,
  EM_CONTINGENCIA_A_TRANSMITIR,
  FORA_DO_PRAZO,
  JA_AUTORIZADO,
  MDFE_NAO_ENCONTRADO,
  PAGAMENTO_JA_INFORMADO,
  PAGAMENTO_SO_DE_TAC_AGREGADO,
  SEFAZ_EM_OPERACAO,
  SEM_CARGA_PARA_A_UF,
  SO_AUTORIZADO_CANCELA,
  SO_AUTORIZADO_ENCERRA,
  SO_AUTORIZADO_RECEBE_EVENTO,
  SO_AUTORIZADO_TEM_DAMDFE,
  SO_AUTORIZADO_TEM_XML,
  SO_CONTINGENCIA_TRANSMITE,
  TRANSPORTE_JA_INICIADO,
  VIAGEM_CANCELADA,
  VIAGEM_NAO_ENCONTRADA,
  avisoDoPrazoDaContingencia,
  chaveDeContingencia,
  dentroDoPrazoDeCancelamento,
  diasDesde,
  entradasSchema,
  prazoDaContingencia,
  type PagamentoDoFormulario,
  type Ambiente,
  type ConferenciaDoMdfe,
  type ConfiguracaoDoFormulario,
  type ConfiguracaoDoMdfe,
  type EntradasDoMdfe,
  type EventoDoMdfe,
  type MdfeEmitido,
  type MdfesDaViagem,
  type RespostaDeNaoEncerrados,
  type ResultadoDaEmissao,
  type SituacaoDaEmissao,
  type SituacaoDoMdfe,
  type StatusDoServico,
  type TipoDeEmitente,
  faltasParaSair,
  haFaltasParaSair,
  type FaltaDeMdfe,
  type FaltasParaSair,
} from "@/lib/mdfe";
import { AUTORIZADOR_DO_MDFE, ENDERECO_DO_QR_CODE } from "@/lib/mdfe/enderecos";
import {
  ALVO_DO_EVENTO_DO_MDFE,
  ALVO_DO_MDFE,
  TIPO_DO_EVENTO,
  montarAlteracaoDoPagamento,
  montarCancelamento,
  montarEncerramento,
  montarInclusaoDeCondutor,
  montarMdfe,
  montarPagamentoDaOperacao,
  montarProcEvento,
  montarProcMdfe,
  type EmitenteDoMdfe,
  type EventoMontado,
  type PagamentoDoMdfe,
} from "@/lib/mdfe/montar";
import { prepararMdfe, ufsDeDescarga, type CargaDaViagem, type PreparoDoMdfe, type SeguroPadrao, type VeiculoDaViagem, type ViagemDoMdfe } from "@/lib/mdfe/preparar";
import { CSTAT, REJEICOES_POR_NAO_ENCERRADO, consultarMdfe, consultarNaoEncerrados, decidirMdfe as decidir, enviarEvento, enviarMdfe, statusDoServico, type DestinoDoMdfe } from "@/lib/mdfe/sefaz";
import { municipioDoTexto } from "@/lib/municipios";
import { responsavelTecnico } from "@/lib/cte/responsavel-tecnico";
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
 * CONTINGÊNCIA OFF-LINE (MOC do MDF-e 3.00b, Visão Geral, item 11): quando não
 * se consegue a autorização, quem emite pode pedir, de forma explícita, a
 * emissão com `tpEmis` 2. O documento é montado e assinado com chave própria,
 * número novo e o QR Code assinado, e fica "CONTINGENCY": emitido, sem
 * protocolo, a transmitir em até 168 horas. Ele NÃO é "autorizado" enquanto a
 * SEFAZ não devolver o protocolo. A transmissão manda o MESMO XML (a mesma
 * chave, o mesmo `cMDF`), como o manual exige. O sistema nunca entra em
 * contingência sozinho, e recusa a contingência quando a SEFAZ responde que o
 * serviço está em operação.
 *
 * As chamadas à SEFAZ ficam FORA de transação.
 */

type Tx = Prisma.TransactionClient;
type Quem = { ator: QualquerAtor; origem: Origem };

const PRODUCAO: Ambiente = "PRODUCAO";
const MOTIVO_MAXIMO = 300;

/**
 * As situações em que o MDF-e cobre o transporte da viagem: autorizado,
 * encerrado (foi autorizado) e emitido em contingência off-line. A contingência
 * existe para a carga poder sair sem a autorização em tempo real (MOC do MDF-e
 * 3.00b, Visão Geral, item 11: emitir em contingência, imprimir o DAMDFE e
 * transmitir depois). Enquanto um desses existe para a UF, não se emite outro.
 */
const COBRE_A_VIAGEM = ["AUTHORIZED", "CLOSED", "CONTINGENCY"] as const;

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
  contactName: true,
  contactEmail: true,
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
    contato: linha.contactName,
    email: linha.contactEmail,
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
  issuedAt: true,
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
  [TIPO_DO_EVENTO.PAGAMENTO_DA_OPERACAO]: "Pagamento da operação de transporte",
  [TIPO_DO_EVENTO.ALTERACAO_DO_PAGAMENTO]: "Alteração do pagamento",
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
    emitidoEm: mdfe.issuedAt.toISOString(),
    contingencia: chaveDeContingencia(mdfe.accessKey),
    transmitirAte: mdfe.status === "CONTINGENCY" ? prazoDaContingencia(mdfe.issuedAt).toISOString() : null,
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
    responsavelTecnico: responsavelTecnico(lido.emitente),
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
  const DA_UF = { manifestId: lido.linha.id, environment: lido.ambiente, unloadState: ufDeDescarga };
  const SELECT = { ...MDFE_SELECT, inputs: true, numberBurned: true } as const;
  // O MDF-e que cobre a viagem (autorizado, encerrado ou em contingência) vem antes de um rascunho antigo que ficou sem resposta.
  const ultimo =
    (await db.mdfe.findFirst({ where: { ...DA_UF, status: { in: [...COBRE_A_VIAGEM] } }, orderBy: { updatedAt: "desc" }, select: SELECT })) ??
    (await db.mdfe.findFirst({ where: DA_UF, orderBy: { updatedAt: "desc" }, select: SELECT }));
  const usadas = entradas ?? entradasGuardadas(ultimo?.inputs);
  const preparo = await prepararUf(db, lido, ufDeDescarga, usadas);
  const autorizado = ultimo?.status === "AUTHORIZED" || ultimo?.status === "CLOSED";
  const emContingencia = ultimo?.status === "CONTINGENCY";
  const mantem = ultimo && (ultimo.status === "DRAFT" || ultimo.status === "REJECTED") && !ultimo.numberBurned && lido.emitente && ultimo.series === lido.emitente.serie;
  const numeroPrevisto = mantem ? ultimo.number : lido.emitente ? await proximoNumero(db, lido.ambiente, lido.emitente.serie) : 0;
  return {
    ufDeDescarga,
    pendencias: autorizado ? [JA_AUTORIZADO] : emContingencia ? [EM_CONTINGENCIA_A_TRANSMITIR] : preparo.pendencias,
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

type Saida = { emitente: EmitenteDoMdfe | null; ambiente: Ambiente; faltas: FaltasParaSair };

/**
 * O que falta de documento fiscal para a viagem sair, lido uma vez só para o
 * bloqueio e para o aviso. O MDF-e é um por UF de descarregamento: as UF são
 * as de `ufsDeDescarga` (as mesmas da aba MDF-e da viagem), só das cargas que
 * saem do município, e cada uma é comparada com o `unloadState` dos MDF-e de
 * PRODUÇÃO da viagem que cobrem o transporte (`COBRE_A_VIAGEM`: autorizado e
 * não cancelado, ou emitido em contingência). O de homologação não tem valor
 * fiscal e não cobre a viagem. `null`: a viagem não existe.
 *
 * Vale como CT-e da carga o de produção: o autorizado por este sistema ou o
 * registrado à mão (os dois deixam a carga com `cteStatus` "ISSUED").
 */
async function lerSaida(db: LeituraDb, manifestId: string): Promise<Saida | null> {
  const dona = await db.manifest.findUnique({ where: { id: manifestId }, select: { tenantId: true } });
  if (!dona) return null;
  const lido = await lerViagem(db, dona.tenantId, manifestId);
  const tipo = lido.emitente?.tipo ?? "1";
  const cargas = lido.linha.collections.map((carga) => {
    const origem = municipioDoTexto(carga.origin);
    const destino = municipioDoTexto(carga.destination);
    return {
      id: carga.id,
      codigo: carga.trackingCode ?? carga.id.slice(0, 8),
      ufDeOrigem: origem?.uf ?? null,
      ufDeDestino: destino?.uf ?? null,
      mesmoMunicipio: origem !== null && destino !== null && origem.codigo === destino.codigo,
      cteAutorizado: carga.cteKey !== null && carga.cteStatus === "ISSUED",
    };
  });
  const municipais = new Set(cargas.filter((carga) => carga.mesmoMunicipio).map((carga) => carga.id));
  const ufs = ufsDeDescarga({ cargas: lido.viagem.cargas.filter((carga) => !municipais.has(carga.id)) }, tipo, municipioDoTexto);
  const autorizados = await db.mdfe.findMany({ where: { manifestId, environment: PRODUCAO, status: { in: [...COBRE_A_VIAGEM] } }, select: { unloadState: true }, distinct: ["unloadState"] });
  const comMdfe = autorizados.map((mdfe) => mdfe.unloadState);
  return { emitente: lido.emitente, ambiente: lido.ambiente, faltas: faltasParaSair(cargas, tipo, ufs, comMdfe) };
}

/**
 * A viagem exige MDF-e e alguma UF de descarregamento não tem um autorizado
 * em produção? É o aviso (que não bloqueia) ao liberar a saída, com as UF que
 * faltam. `null`: nada a avisar.
 */
export async function exigenciaSemMdfe(db: LeituraDb, manifestId: string): Promise<FaltaDeMdfe | null> {
  return (await lerSaida(db, manifestId))?.faltas.mdfe ?? null;
}

export type DocumentosDaSaida = {
  faltas: FaltasParaSair;
  /** A empresa emite pelo TMS em produção e falta documento: a saída não é liberada. */
  bloqueia: boolean;
};

/**
 * O que falta de documento fiscal para a viagem sair (`faltasParaSair`), e se
 * isso bloqueia a saída. Bloqueia só quando a empresa tem emitente fiscal
 * configurado em PRODUÇÃO: aí o CT-e de cada carga e o MDF-e de cada UF de
 * descarregamento são emitidos por aqui, e têm de estar autorizados antes de o
 * veículo sair. Em homologação, ou sem emitente (a empresa emite em outro
 * sistema), nada bloqueia.
 */
export async function documentosDaSaida(db: LeituraDb, manifestId: string): Promise<DocumentosDaSaida> {
  const saida = await lerSaida(db, manifestId);
  if (!saida || !saida.emitente || saida.ambiente !== PRODUCAO) return { faltas: { ctes: [], mdfe: null }, bloqueia: false };
  return { faltas: saida.faltas, bloqueia: haFaltasParaSair(saida.faltas) };
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
 *
 * `contingencia`: monta com `tpEmis` 2 e grava como "CONTINGENCY", sem marca de
 * envio (nada vai ser transmitido agora). O número é SEMPRE novo: o MOC
 * recomenda "que se avance um número na sequência da numeração quando da
 * entrada em contingência a fim de evitar que o MDFe emitido em contingência
 * seja posteriormente rejeitado por duplicidade" (Visão Geral, item 11.1). O
 * Ajuste SINIEF 21/10 teria a mesma regra como vedação (cláusula décima
 * segunda, § 2º), mas esse texto NÃO foi lido na fonte oficial (o site do
 * CONFAZ não respondeu): a base aqui é o manual. Um envio normal que ficou sem
 * resposta NÃO é sobrescrito: a linha dele fica, com a chave, para ser
 * conferida na SEFAZ na hora de transmitir (`resolverEnvioSemResposta`).
 */
async function prepararEnvio(
  empresa: Empresa,
  manifestId: string,
  ufDeDescarga: string,
  entradas: EntradasDoMdfe,
  credencial: CredencialDaEmpresa,
  quem: Quem,
  contingencia = false,
): Promise<Preparado> {
  return empresa.transacao(async (tx) => {
    await travarNumeracao(tx, empresa.id);
    const lido = await lerViagem(tx, empresa.id, manifestId);
    const { emitente, ambiente } = lido;
    const viagem = { id: lido.viagem.id, codigo: lido.viagem.codigo };

    const cobre = await tx.mdfe.findFirst({ where: { manifestId, environment: ambiente, unloadState: ufDeDescarga, status: { in: [...COBRE_A_VIAGEM] } }, select: { id: true, status: true } });
    if (cobre) throw new Refusal(cobre.status === "CONTINGENCY" ? EM_CONTINGENCIA_A_TRANSMITIR : JA_AUTORIZADO, 409);

    const pendente = await tx.mdfe.findFirst({
      where: { manifestId, environment: ambiente, unloadState: ufDeDescarga, status: { in: ["DRAFT", "REJECTED"] } },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true, series: true, number: true, accessKey: true, xmlSent: true, sendingAt: true, unanswered: true, numberBurned: true },
    });
    const agora = new Date();
    if (pendente?.sendingAt && agora.getTime() - pendente.sendingAt.getTime() < ENVIO_EM_ANDAMENTO_MS) throw new Refusal(EMISSAO_EM_ANDAMENTO, 409);

    const semResposta = Boolean(pendente && pendente.status === "DRAFT" && pendente.unanswered);
    if (!contingencia && pendente && semResposta && emitente) {
      await tx.mdfe.update({ where: { id: pendente.id }, data: { sendingAt: agora }, select: { id: true } });
      return { id: pendente.id, chave: pendente.accessKey, numero: pendente.number, xml: pendente.xmlSent, ambiente, cnpj: emitente.cnpj, ufDeFim: ufDeDescarga, retomar: true, viagem };
    }

    const preparo = await prepararUf(tx, lido, ufDeDescarga, entradas);
    if (preparo.pendencias.length > 0 || !emitente || !preparo.dados) throw new Refusal(preparo.pendencias[0] ?? SEM_CARGA_PARA_A_UF, 409);

    // Rejeição não consome o número: o reenvio usa o mesmo, salvo quando a SEFAZ disse que ele já foi usado.
    // A contingência nunca reaproveita número.
    let numero: number;
    if (!contingencia && pendente && !pendente.numberBurned && pendente.series === emitente.serie) {
      numero = pendente.number;
    } else {
      const numeracao = await tx.mdfeNumbering.findFirst({ where: { environment: ambiente, series: emitente.serie }, select: { id: true, nextNumber: true } });
      numero = numeracao?.nextNumber ?? 1;
      if (numeracao) await tx.mdfeNumbering.update({ where: { id: numeracao.id }, data: { nextNumber: numero + 1 }, select: { id: true } });
      else await tx.mdfeNumbering.create({ data: { environment: ambiente, series: emitente.serie, nextNumber: numero + 1 }, select: { id: true } });
    }

    const montado = montarMdfe({
      ...preparo.dados,
      numero,
      codigo: sortearCodigo(),
      emissao: agora,
      // O `sign` do QR Code: a chave de acesso assinada com o certificado que assina o MDF-e (MOC, item 9.2.2).
      contingencia: contingencia ? { assinar: (chave) => assinarTexto(chave, credencial.chavePem) } : null,
    });
    const xml = assinarXml(montado.xml, ALVO_DO_MDFE, { chavePem: credencial.chavePem, certificadoPem: credencial.titularPem });
    const dados = {
      series: emitente.serie,
      number: numero,
      accessKey: montado.chave,
      status: contingencia ? "CONTINGENCY" : "DRAFT",
      emitterType: emitente.tipo,
      loadState: preparo.dados.ufDeInicio,
      plate: preparo.dados.rodo.tracao.placa,
      inputs: entradas as Prisma.InputJsonValue,
      xmlSent: xml,
      issuedAt: agora,
      sendingAt: contingencia ? null : agora,
      unanswered: false,
      numberBurned: false,
      statusCode: null,
      statusReason: null,
      issuedById: quem.ator.id,
    };
    // O envio normal que ficou sem resposta pode estar autorizado na SEFAZ: a linha dele não é reaproveitada pela contingência.
    const gravado = pendente && !(contingencia && semResposta)
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
 * A conversa com a SEFAZ para um MDF-e já assinado: na retomada de um envio sem
 * resposta, consulta pela chave antes de reenviar o MESMO XML; depois envia, e
 * busca o protocolo pela consulta quando a resposta é "duplicidade" (204).
 * Falha de rede sai como `SefazError`.
 */
async function conversarComASefaz(destino: DestinoDoMdfe, preparado: Pick<Preparado, "chave" | "ambiente" | "xml" | "retomar">): Promise<Decisao> {
  const esperado: Esperado = { chave: preparado.chave, ambiente: preparado.ambiente, resumo: resumoDaAssinatura(preparado.xml) };
  // Autorizado, ou já cancelado/encerrado lá: a consulta esclareceu, e nada é reenviado.
  const esclarece = (consulta: Decisao) => consulta.tipo === "autorizado" || consulta.tipo === "finalizado";

  let jaEstaLa: Decisao | null = null;
  if (preparado.retomar) {
    const consulta = decidir(await consultarMdfe(destino, preparado.chave), esperado);
    if (esclarece(consulta)) jaEstaLa = consulta;
    // "Não consta" é o único caso em que o mesmo XML é enviado de novo.
    else if (!(consulta.tipo === "rejeitado" && consulta.cStat === CSTAT.NAO_CONSTA)) {
      const motivo = consulta.tipo === "incoerente" ? consulta.motivo : frase(consulta.cStat, consulta.motivo);
      jaEstaLa = { tipo: "incoerente", motivo: `A consulta pela chave não esclareceu a situação do MDF-e: ${motivo}` };
    }
  }
  const decisao = jaEstaLa ?? decidir(await enviarMdfe(destino, preparado.xml), esperado);
  // 204: este mesmo MDF-e já está autorizado lá. O protocolo vem pela consulta.
  if (decisao.tipo !== "ja-autorizado") return decisao;
  const consulta = decidir(await consultarMdfe(destino, preparado.chave), esperado);
  return esclarece(consulta) ? consulta : { tipo: "incoerente", motivo: `${frase(decisao.cStat, decisao.motivo)} A consulta pela chave não devolveu o protocolo.` };
}

/**
 * A SEFAZ tem o MDF-e desta chave, mas já cancelado ou encerrado lá (101 ou
 * 132 na consulta, 218 ou 609 na recepção): isso só acontece quando o envio
 * ficou sem resposta e o documento foi cancelado ou encerrado fora deste
 * sistema. NÃO é gravado como autorizado. O número foi usado: a próxima
 * emissão leva o seguinte.
 */
async function gravarFinalizado(empresa: Empresa, preparado: Preparado, decisao: Extract<Decisao, { tipo: "finalizado" }>, quem: Quem): Promise<ResultadoDaEmissao> {
  const mdfe = await gravarSemAutorizacao(empresa, preparado.id, { status: "REJECTED", statusCode: decisao.cStat, statusReason: decisao.motivo, unanswered: false, numberBurned: true });
  await registrarAuditoriaDepois(empresa.db, {
    ...quem,
    acao: "mdfe.rejeitar",
    entidade: "mdfe",
    entidadeId: preparado.id,
    resumo: `MDF-e nº ${preparado.numero} da viagem #${preparado.viagem.codigo} já está ${decisao.situacao} na SEFAZ: ${frase(decisao.cStat, decisao.motivo)}`,
    depois: { number: preparado.numero, environment: preparado.ambiente, statusCode: decisao.cStat, manifestId: preparado.viagem.id },
  });
  return resultado(
    mdfe,
    false,
    `A SEFAZ informa que o MDF-e nº ${preparado.numero} já está ${decisao.situacao} lá (${frase(decisao.cStat, decisao.motivo)}): ele não foi gravado como autorizado. O número foi usado: a próxima emissão usa o seguinte.`,
  );
}

/**
 * Emissão em contingência off-line (MOC do MDF-e 3.00b, Visão Geral, item 11).
 * Não transmite: monta com `tpEmis` 2, assina e grava como "CONTINGENCY".
 *
 * Só quando não se consegue a autorização: se a SEFAZ responde que o serviço
 * está em operação e não há um envio normal desta viagem sem resposta, a
 * contingência é recusada (o manual a trata como exceção, e o fisco pode
 * restringir quem a usa em demasia). Sem resposta do status, ou com o serviço
 * paralisado (108, 109), ela segue.
 */
async function emitirEmContingencia(
  empresa: Empresa,
  lido: Lido,
  manifestId: string,
  ufDeDescarga: string,
  entradas: EntradasDoMdfe,
  credencial: CredencialDaEmpresa,
  quem: Quem,
): Promise<ResultadoDaEmissao> {
  const antes = await conferencia(empresa.db, lido, ufDeDescarga, entradas);
  if (antes.pendencias.length > 0) throw new Refusal(antes.pendencias[0], 409);

  const semResposta = await empresa.db.mdfe.findFirst({ where: { manifestId, environment: lido.ambiente, unloadState: ufDeDescarga, status: "DRAFT", unanswered: true }, select: { id: true } });
  if (!semResposta) {
    let emOperacao = false;
    try {
      emOperacao = (await statusDoServico({ ambiente: lido.ambiente, credencial })).emOperacao;
    } catch (erro) {
      // Sem resposta do status: é a situação para a qual a contingência existe.
      if (!(erro instanceof SefazError)) throw erro;
    }
    if (emOperacao) throw new Refusal(SEFAZ_EM_OPERACAO, 409);
  }

  const preparado = await prepararEnvio(empresa, manifestId, ufDeDescarga, entradas, credencial, quem, true);
  const mdfe = await empresa.db.mdfe.findUniqueOrThrow({ where: { id: preparado.id }, select: MDFE_SELECT });
  await registrarAuditoriaDepois(empresa.db, {
    ...quem,
    acao: "mdfe.contingencia",
    entidade: "mdfe",
    entidadeId: preparado.id,
    resumo: `MDF-e nº ${preparado.numero} emitido em contingência${emHomologacao(preparado.ambiente)} para a viagem #${preparado.viagem.codigo} (descarga em ${preparado.ufDeFim}), sem transmissão`,
    depois: { number: preparado.numero, accessKey: preparado.chave, environment: preparado.ambiente, manifestId: preparado.viagem.id },
  });
  return resultado(
    mdfe,
    false,
    `MDF-e nº ${preparado.numero} emitido em contingência${emHomologacao(preparado.ambiente)}: ainda NÃO está autorizado. Imprima o DAMDFE (ele sai com "EMISSÃO EM CONTINGÊNCIA") para acompanhar a carga. ${avisoDoPrazoDaContingencia(prazoDaContingencia(mdfe.issuedAt))}`,
  );
}

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
 *
 * `contingencia: true` (pedido explícito de quem emite): não transmite. Ver
 * `emitirEmContingencia`.
 */
export async function emitirMdfe(
  empresa: Empresa,
  manifestId: string,
  ufDeDescarga: string,
  entradas: EntradasDoMdfe,
  quem: Quem,
  opcoes: { contingencia?: boolean } = {},
): Promise<ResultadoDaEmissao> {
  const credencial = await credencialDaEmpresa(empresa);

  // Antes de reservar número: o que falta e o que a SEFAZ já tem em aberto.
  const lido = await lerViagem(empresa.db, empresa.id, manifestId);
  if (!lido.emitente) throw new Refusal(SEM_EMITENTE_CADASTRADO, 409);
  if (opcoes.contingencia) return emitirEmContingencia(empresa, lido, manifestId, ufDeDescarga, entradas, credencial, quem);
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

  let decisao: Decisao;
  try {
    decisao = await conversarComASefaz(destino, preparado);
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

  if (decisao.tipo === "finalizado") return gravarFinalizado(empresa, preparado, decisao, quem);

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

/* ------------------------- Transmissão da contingência ------------------------ */

const CONTINGENCIA_SELECT = {
  id: true,
  status: true,
  environment: true,
  number: true,
  accessKey: true,
  xmlSent: true,
  sendingAt: true,
  unanswered: true,
  unloadState: true,
  plate: true,
  emitterType: true,
  manifestId: true,
} as const;

type Contingencia = Prisma.MdfeGetPayload<{ select: typeof CONTINGENCIA_SELECT }>;

const preparadoDaLinha = (linha: Pick<Contingencia, "id" | "accessKey" | "number" | "xmlSent" | "environment" | "unloadState" | "manifestId" | "unanswered">, cnpj: string): Preparado => ({
  id: linha.id,
  chave: linha.accessKey,
  numero: linha.number,
  xml: linha.xmlSent,
  ambiente: ambienteDaLinha(linha.environment),
  cnpj,
  ufDeFim: linha.unloadState,
  retomar: linha.unanswered,
  viagem: { id: linha.manifestId, codigo: codigoDaViagem(linha.manifestId) },
});

/**
 * Antes de transmitir a contingência: o envio NORMAL da mesma viagem e UF que
 * ficou sem resposta (foi ele que levou à contingência) pode ter sido
 * autorizado pela SEFAZ. A consulta pela chave decide:
 * - não consta (217): o envio não valeu; a linha dele vira "rejeitado";
 * - cancelado ou encerrado lá: idem, com o número dado como usado;
 * - AUTORIZADO: ele é gravado, com o protocolo, e a transmissão para: a viagem
 *   ficou com dois MDF-e para a UF, e a SEFAZ rejeitaria o de contingência
 *   enquanto o outro estiver em aberto (611). Quem decide qual fica é a pessoa.
 * Qualquer outra resposta não esclarece: nada é transmitido.
 */
async function resolverEnvioSemResposta(empresa: Empresa, destino: DestinoDoMdfe, alvo: Contingencia, cnpj: string, quem: Quem): Promise<void> {
  const orfao = await empresa.db.mdfe.findFirst({
    where: { manifestId: alvo.manifestId, environment: alvo.environment, unloadState: alvo.unloadState, status: "DRAFT", unanswered: true },
    orderBy: { createdAt: "desc" },
    select: CONTINGENCIA_SELECT,
  });
  if (!orfao) return;

  let consulta: Decisao;
  try {
    consulta = decidir(await consultarMdfe(destino, orfao.accessKey), { chave: orfao.accessKey, ambiente: destino.ambiente, resumo: resumoDaAssinatura(orfao.xmlSent) });
  } catch (erro) {
    if (!(erro instanceof SefazError)) throw erro;
    throw new Refusal(`${erro.message} Antes de transmitir, o sistema confere na SEFAZ o envio normal anterior (MDF-e nº ${orfao.number}), que ficou sem resposta: nada foi transmitido. Tente de novo.`, STATUS_DA_FALHA(erro));
  }

  if (consulta.tipo === "autorizado") {
    await gravarAutorizacao(empresa, preparadoDaLinha(orfao, cnpj), consulta.protocolo, quem);
    throw new Refusal(
      `O envio normal anterior (MDF-e nº ${orfao.number}) tinha sido autorizado pela SEFAZ (protocolo ${consulta.protocolo.numero}) e agora está gravado. A viagem ficou com dois MDF-e para esta UF: o de contingência (nº ${alvo.number}) não foi transmitido, porque a SEFAZ o rejeita enquanto o outro estiver em aberto (611). Consulte o contador para decidir qual dos dois fica.`,
      409,
    );
  }
  if (consulta.tipo === "finalizado") {
    await gravarSemAutorizacao(empresa, orfao.id, { status: "REJECTED", statusCode: consulta.cStat, statusReason: consulta.motivo, unanswered: false, numberBurned: true });
    return;
  }
  if (consulta.tipo === "rejeitado" && consulta.cStat === CSTAT.NAO_CONSTA) {
    const motivo = `A SEFAZ não tem este envio (${frase(consulta.cStat, consulta.motivo)}). Foi substituído pelo MDF-e nº ${alvo.number}, emitido em contingência.`;
    await gravarSemAutorizacao(empresa, orfao.id, { status: "REJECTED", statusCode: consulta.cStat, statusReason: motivo, unanswered: false });
    return;
  }
  const motivo = consulta.tipo === "incoerente" ? consulta.motivo : frase(consulta.cStat, consulta.motivo);
  throw new Refusal(`A consulta do envio normal anterior (MDF-e nº ${orfao.number}) não esclareceu a situação dele: ${motivo}. Nada foi transmitido: tente de novo.`, 409);
}

const CONTINUA_EM_CONTINGENCIA = "O MDF-e continua emitido em contingência, sem autorização.";

/**
 * Transmite à SEFAZ um MDF-e emitido em contingência: o MESMO XML, com a mesma
 * chave e o mesmo `cMDF` (MOC do MDF-e 3.00b, Visão Geral, item 11.1). Só fica
 * "autorizado" com o protocolo que a SEFAZ devolver.
 *
 * - Autorizado: grava o mdfeProc.
 * - Rejeitado: continua em contingência, com o código e o motivo. Dá para
 *   resolver o motivo fora do documento (encerrar o MDF-e anterior, por
 *   exemplo) e transmitir de novo. Este sistema NÃO refaz o documento de
 *   contingência rejeitado: a providência (Ajuste SINIEF 21/10, cláusula décima
 *   segunda, III) não foi lida na fonte oficial, e fica com o contador.
 * - Sem resposta: continua em contingência; a próxima transmissão começa
 *   consultando a SEFAZ pela chave.
 */
export async function transmitirContingencia(empresa: Empresa, mdfeId: string, quem: Quem): Promise<ResultadoDaEmissao> {
  // Antes de abrir o certificado: o MDF-e existe nesta empresa e está em contingência? (A situação é conferida de novo com a empresa travada.)
  const existente = await empresa.db.mdfe.findUnique({ where: { id: mdfeId }, select: { status: true } });
  if (!existente) throw new Refusal(MDFE_NAO_ENCONTRADO, 404);
  if (existente.status !== "CONTINGENCY") throw new Refusal(SO_CONTINGENCIA_TRANSMITE, 409);
  const credencial = await credencialDaEmpresa(empresa);
  const doEmitente = await empresa.db.fiscalIssuer.findUnique({ where: { tenantId: empresa.id }, select: { cnpj: true } });
  if (!doEmitente) throw new Refusal(SEM_EMITENTE_CADASTRADO, 409);

  const alvo = await empresa.transacao(async (tx) => {
    await travarNumeracao(tx, empresa.id);
    const linha = await tx.mdfe.findUnique({ where: { id: mdfeId }, select: CONTINGENCIA_SELECT });
    if (!linha) throw new Refusal(MDFE_NAO_ENCONTRADO, 404);
    if (linha.status !== "CONTINGENCY") throw new Refusal(SO_CONTINGENCIA_TRANSMITE, 409);
    const agora = new Date();
    if (linha.sendingAt && agora.getTime() - linha.sendingAt.getTime() < ENVIO_EM_ANDAMENTO_MS) throw new Refusal(EMISSAO_EM_ANDAMENTO, 409);
    await tx.mdfe.update({ where: { id: linha.id }, data: { sendingAt: agora }, select: { id: true } });
    return linha;
  }, COM_FILA);

  const preparado = preparadoDaLinha(alvo, doEmitente.cnpj);
  const destino: DestinoDoMdfe = { ambiente: preparado.ambiente, credencial };

  // O que se confere antes de enviar; uma recusa aqui solta a marca de envio e não muda mais nada.
  try {
    await resolverEnvioSemResposta(empresa, destino, alvo, doEmitente.cnpj, quem);
    await barrarPorNaoEncerrado(empresa, destino, doEmitente.cnpj, { placa: alvo.plate, ufDeFim: alvo.unloadState, tipo: tipoDaLinha(alvo.emitterType), ignorar: alvo.accessKey });
  } catch (erro) {
    await empresa.db.mdfe.update({ where: { id: alvo.id }, data: { sendingAt: null }, select: { id: true } });
    throw erro;
  }

  let decisao: Decisao;
  try {
    decisao = await conversarComASefaz(destino, preparado);
  } catch (erro) {
    if (!(erro instanceof SefazError)) {
      await gravarSemAutorizacao(empresa, alvo.id, { statusReason: "Falha interna na transmissão.", unanswered: alvo.unanswered });
      throw erro;
    }
    const ficouSemResposta = erro.incerto || alvo.unanswered;
    await gravarSemAutorizacao(empresa, alvo.id, { statusReason: erro.message, unanswered: ficouSemResposta });
    const proxima = ficouSemResposta ? " A próxima transmissão começa consultando a SEFAZ pela chave, sem duplicar." : " Nada chegou a ser processado: transmita de novo.";
    throw new Refusal(`${erro.message} ${CONTINUA_EM_CONTINGENCIA}${proxima}`, STATUS_DA_FALHA(erro));
  }

  if (decisao.tipo === "autorizado") {
    const mdfe = await gravarAutorizacao(empresa, preparado, decisao.protocolo, quem);
    return resultado(mdfe, true, `MDF-e nº ${preparado.numero} (emitido em contingência) autorizado${emHomologacao(preparado.ambiente)}. Protocolo ${decisao.protocolo.numero}.`);
  }

  if (decisao.tipo === "incoerente") {
    await gravarSemAutorizacao(empresa, alvo.id, { statusReason: decisao.motivo, unanswered: true });
    throw new Refusal(`${decisao.motivo} ${CONTINUA_EM_CONTINGENCIA} A próxima transmissão começa consultando a SEFAZ pela chave.`, 502);
  }

  if (decisao.tipo === "parado") {
    const mdfe = await gravarSemAutorizacao(empresa, alvo.id, { statusCode: decisao.cStat, statusReason: decisao.motivo, unanswered: alvo.unanswered });
    return resultado(mdfe, false, `A SEFAZ não processou o MDF-e: ${frase(decisao.cStat, decisao.motivo)}. ${CONTINUA_EM_CONTINGENCIA} Transmita de novo mais tarde.`);
  }

  if (decisao.tipo === "finalizado") return gravarFinalizado(empresa, preparado, decisao, quem);

  // Rejeitado (ou número usado por outro documento): o documento de contingência não é refeito aqui.
  const mdfe = await gravarSemAutorizacao(empresa, alvo.id, { statusCode: decisao.cStat, statusReason: decisao.motivo, unanswered: false });
  await registrarAuditoriaDepois(empresa.db, {
    ...quem,
    acao: "mdfe.rejeitar",
    entidade: "mdfe",
    entidadeId: alvo.id,
    resumo: `Transmissão do MDF-e nº ${preparado.numero} (contingência) da viagem #${preparado.viagem.codigo} rejeitada pela SEFAZ: ${frase(decisao.cStat, decisao.motivo)}`,
    depois: { number: preparado.numero, environment: preparado.ambiente, statusCode: decisao.cStat, manifestId: preparado.viagem.id },
  });
  const complemento = REJEICOES_POR_NAO_ENCERRADO.includes(decisao.cStat)
    ? " Há MDF-e anterior em aberto na SEFAZ: encerre-o (consulte os não encerrados na tela de MDF-e) e transmita de novo."
    : " Se o motivo se resolve sem mudar o documento, resolva e transmita de novo; se exige mudar o documento, consulte o contador: o sistema não refaz o MDF-e de contingência.";
  return resultado(mdfe, false, `A SEFAZ rejeitou a transmissão do MDF-e: ${frase(decisao.cStat, decisao.motivo)}. ${CONTINUA_EM_CONTINGENCIA}${complemento}`);
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
async function prepararEvento(empresa: Empresa, mdfeId: string, recusa: string, situacoes: readonly SituacaoDoMdfe[] = ["AUTHORIZED"]): Promise<Envio & { protocolo: string }> {
  const alvo = await empresa.db.mdfe.findUnique({ where: { id: mdfeId }, select: ALVO_SELECT });
  if (!alvo) throw new Refusal(MDFE_NAO_ENCONTRADO, 404);
  if (!situacoes.includes(alvo.status as SituacaoDoMdfe) || !alvo.protocol) throw new Refusal(recusa, 409);
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
 *
 * 134 e 136 (MOC, Visão Geral, item 5.1.7) não são recusa: a SEFAZ GUARDOU o
 * evento, com ressalva (134: vinculado a um MDF-e que não está "autorizado";
 * 136: sem vínculo, o MDF-e não existe lá). Isso não prova que o MDF-e mudou
 * de situação: o registro só vale quando `confirma` (a consulta pela chave)
 * diz que sim. Sem confirmação, a resposta é `Refusal` 409 com a frase que diz
 * que o evento ficou guardado lá.
 *
 * Qualquer outra resposta é recusa: `Refusal` 409 com o motivo da SEFAZ.
 */
async function enviarERegistrar(
  envio: Envio,
  evento: EventoMontado,
  oQue: string,
  jaEstava: (resposta: RespostaDoEvento) => Promise<boolean> = async () => false,
  confirma: (resposta: RespostaDoEvento) => Promise<boolean> = async () => false,
): Promise<Registro> {
  const assinado = assinarXml(evento.xml, ALVO_DO_EVENTO_DO_MDFE, { chavePem: envio.credencial.chavePem, certificadoPem: envio.credencial.titularPem });
  try {
    const resposta = await enviarEvento(envio.destino, assinado);
    const base = { cStat: resposta.cStat, motivo: resposta.motivo.slice(0, MOTIVO_MAXIMO), xmlEnviado: assinado, xmlDoRetorno: resposta.xml };
    const esperado = { chave: envio.alvo.accessKey, tipo: evento.tipo };
    if (eventoRegistrado(resposta, esperado)) return { ...base, protocolo: resposta.protocolo, quando: resposta.registradoEm ?? new Date() };
    if (eventoGuardadoComRessalva(resposta, esperado)) {
      if (await confirma(resposta)) return { ...base, protocolo: resposta.protocolo, quando: resposta.registradoEm ?? new Date() };
      throw new Refusal(fraseDoEventoComRessalva(oQue, resposta), 409);
    }
    if (await jaEstava(resposta)) return { ...base, protocolo: null, quando: new Date() };
    throw new Refusal(`A SEFAZ recusou ${oQue}: ${frase(resposta.cStat, resposta.motivo)}.`, 409);
  } catch (erro) {
    if (erro instanceof SefazError) throw new Refusal(`${erro.message} O MDF-e continua como estava: tente de novo.`, STATUS_DA_FALHA(erro));
    throw erro;
  }
}

/**
 * Para o evento que não muda a situação do MDF-e (inclusão de condutor,
 * pagamento): o 134 vale como registro, porque o evento ficou VINCULADO ao
 * MDF-e (só veio com o alerta de que ele não está mais "autorizado": encerrado,
 * por exemplo). O 136 não: o evento ficou sem vínculo.
 */
const vinculadoComAlerta = async (resposta: RespostaDoEvento) => resposta.cStat === CSTAT.EVENTO_REGISTRADO_COM_ALERTA;

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
  const encerradoNaSefaz = async () => (await consultarMdfe(envio.destino, alvo.accessKey)).cStat === CSTAT.ENCERRADO;
  const registro = await enviarERegistrar(envio, evento, "o encerramento", async (resposta) => resposta.cStat === CSTAT.JA_ENCERRADO && (await encerradoNaSefaz()), encerradoNaSefaz);

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
  const canceladoNaSefaz = async () => (await consultarMdfe(envio.destino, alvo.accessKey)).cStat === CSTAT.CANCELADO;
  const registro = await enviarERegistrar(envio, evento, "o cancelamento", async (resposta) => resposta.cStat === CSTAT.JA_CANCELADO && (await canceladoNaSefaz()), canceladoNaSefaz);

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
  const registro = await enviarERegistrar(envio, evento, "a inclusão do condutor", undefined, vinculadoComAlerta);

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

/* ---------------------------- Pagamento do frete ------------------------------ */

/** Do que a pessoa informou ao grupo `infPag` (a mesma conversão do MDF-e, em src/lib/mdfe/preparar.ts). */
const pagamentoDoEvento = (pagamento: PagamentoDoFormulario): PagamentoDoMdfe => ({
  nome: pagamento.nome ?? null,
  documento: pagamento.documento,
  valor: pagamento.valor,
  aPrazo: pagamento.aPrazo,
  adiantamento: pagamento.adiantamento ?? null,
  parcelas: pagamento.parcelas ?? [],
  conta: pagamento.conta,
});

/** Os eventos de pagamento valem para o MDF-e autorizado e para o já encerrado: o pagamento do agregado é "no final do período" (MOC, item 6.5), e as regras do evento só barram o MDF-e cancelado (K04, 218). */
const RECEBE_PAGAMENTO: readonly SituacaoDoMdfe[] = ["AUTHORIZED", "CLOSED"];
const SO_AUTORIZADO_RECEBE_PAGAMENTO = "Só MDF-e autorizado ou encerrado (e não cancelado) recebe o evento de pagamento.";

/** O veículo de tração do MDF-e é de TAC agregado (`veicTracao/prop/tpProp` 0)? É o que a regra K06 do evento 110116 exige. */
const tracaoDeTacAgregado = (xml: string) => /<prop>[\s\S]*?<tpProp>0<\/tpProp>[\s\S]*?<\/prop>/.test(/<veicTracao>[\s\S]*?<\/veicTracao>/.exec(xml)?.[0] ?? "");

const reais = (valor: number) => valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Grava o evento de pagamento registrado e devolve o MDF-e para a tela. */
async function gravarPagamento(empresa: Empresa, alvo: Alvo, evento: EventoMontado, registro: Registro, descricao: string, resumo: string, quem: Quem): Promise<MdfeEmitido> {
  const gravado = await empresa.transacao(async (tx) => {
    await tx.mdfeEvent.create({ data: linhaDoEvento(alvo.id, evento, registro, descricao, quem.ator.id), select: { id: true } });
    await registrarAuditoria(tx, { ...quem, acao: "mdfe.pagamento", entidade: "mdfe", entidadeId: alvo.id, resumo, depois: { tipo: evento.tipo, sequence: evento.sequencia, protocol: registro.protocolo } });
    return tx.mdfe.findUniqueOrThrow({ where: { id: alvo.id }, select: MDFE_SELECT });
  });
  return paraATela(gravado);
}

/**
 * Informa o pagamento da operação de transporte (evento 110116): o pagamento
 * do TAC agregado feito depois da emissão. Um por MDF-e (sequência 1, regra
 * K01). O que a SEFAZ rejeitaria com certeza é recusado aqui, sem enviar: MDF-e
 * cujo veículo de tração não é de TAC agregado (regra K06, rejeição 723) e
 * pagamento já informado.
 */
export async function informarPagamento(
  empresa: Empresa,
  mdfeId: string,
  dados: { viagens: { quantidade: number; numero: number }; pagamento: PagamentoDoFormulario },
  quem: Quem,
): Promise<MdfeEmitido> {
  const envio = await prepararEvento(empresa, mdfeId, SO_AUTORIZADO_RECEBE_PAGAMENTO, RECEBE_PAGAMENTO);
  const { alvo } = envio;
  const documento = await empresa.db.mdfe.findUniqueOrThrow({ where: { id: alvo.id }, select: { xmlSent: true } });
  if (!tracaoDeTacAgregado(documento.xmlSent)) throw new Refusal(PAGAMENTO_SO_DE_TAC_AGREGADO, 409);
  const jaInformado = await empresa.db.mdfeEvent.findFirst({ where: { mdfeId, type: TIPO_DO_EVENTO.PAGAMENTO_DA_OPERACAO }, select: { id: true } });
  if (jaInformado) throw new Refusal(PAGAMENTO_JA_INFORMADO, 409);

  const evento = montarPagamentoDaOperacao({
    chave: alvo.accessKey,
    cnpj: envio.cnpj,
    ambiente: envio.ambiente,
    quando: new Date(),
    protocolo: envio.protocolo,
    viagens: dados.viagens,
    pagamentos: [pagamentoDoEvento(dados.pagamento)],
  });
  const registro = await enviarERegistrar(envio, evento, "o pagamento da operação", undefined, vinculadoComAlerta);
  const valor = reais(dados.pagamento.valor);
  return gravarPagamento(
    empresa,
    alvo,
    evento,
    registro,
    `Pagamento informado: ${valor}, viagem ${dados.viagens.numero} de ${dados.viagens.quantidade}`,
    `Pagamento da operação (${valor}) informado no MDF-e nº ${alvo.number} da viagem #${codigoDaViagem(alvo.manifestId)}`,
    quem,
  );
}

/** Altera o pagamento do serviço de transporte já informado à SEFAZ (evento 110118). A sequência é a próxima deste MDF-e, até 99 (regra K01). */
export async function alterarPagamento(empresa: Empresa, mdfeId: string, dados: { pagamento: PagamentoDoFormulario }, quem: Quem): Promise<MdfeEmitido> {
  const envio = await prepararEvento(empresa, mdfeId, SO_AUTORIZADO_RECEBE_PAGAMENTO, RECEBE_PAGAMENTO);
  const { alvo } = envio;
  const ultimo = await empresa.db.mdfeEvent.findFirst({ where: { mdfeId, type: TIPO_DO_EVENTO.ALTERACAO_DO_PAGAMENTO }, orderBy: { sequence: "desc" }, select: { sequence: true } });
  const sequencia = (ultimo?.sequence ?? 0) + 1;
  if (sequencia > MAXIMO_DE_INCLUSOES) throw new Refusal(`Este MDF-e já tem ${MAXIMO_DE_INCLUSOES} alterações de pagamento, o máximo que a SEFAZ aceita.`, 409);

  const evento = montarAlteracaoDoPagamento({ chave: alvo.accessKey, cnpj: envio.cnpj, ambiente: envio.ambiente, quando: new Date(), sequencia, protocolo: envio.protocolo, pagamento: pagamentoDoEvento(dados.pagamento) });
  const registro = await enviarERegistrar(envio, evento, "a alteração do pagamento", undefined, vinculadoComAlerta);
  const valor = reais(dados.pagamento.valor);
  return gravarPagamento(
    empresa,
    alvo,
    evento,
    registro,
    `Pagamento alterado: ${valor}`,
    `Pagamento do frete alterado (${valor}) no MDF-e nº ${alvo.number} da viagem #${codigoDaViagem(alvo.manifestId)}`,
    quem,
  );
}

/* ------------------------- XML, DAMDFE e consultas à SEFAZ --------------------- */

/** O arquivo do MDF-e autorizado (mdfeProc), para baixar. Só existe para o que a SEFAZ autorizou. */
export async function xmlDoMdfe(empresa: Empresa, mdfeId: string): Promise<{ chave: string; xml: string }> {
  const mdfe = await empresa.db.mdfe.findUnique({ where: { id: mdfeId }, select: { accessKey: true, status: true, xmlReturn: true } });
  if (!mdfe) throw new Refusal(MDFE_NAO_ENCONTRADO, 404);
  if (!["AUTHORIZED", "CLOSED", "CANCELLED"].includes(mdfe.status) || !mdfe.xmlReturn) throw new Refusal(SO_AUTORIZADO_TEM_XML, 409);
  return { chave: mdfe.accessKey, xml: mdfe.xmlReturn };
}

/**
 * O que a rota do DAMDFE precisa: o mdfeProc de um MDF-e autorizado (ou
 * encerrado), e se ele é de homologação. O MDF-e emitido em contingência e
 * ainda não transmitido também tem DAMDFE, a partir do XML assinado, sem
 * protocolo (`contingencia: true`): é o documento que acompanha a carga, com
 * "EMISSÃO EM CONTINGÊNCIA" (MOC do MDF-e 3.00b, Visão Geral, item 11.1).
 */
export async function damdfeDoMdfe(empresa: Empresa, mdfeId: string): Promise<{ chave: string; xml: string; homologacao: boolean; contingencia: boolean }> {
  const mdfe = await empresa.db.mdfe.findUnique({ where: { id: mdfeId }, select: { accessKey: true, status: true, environment: true, protocol: true, xmlSent: true, xmlReturn: true } });
  if (!mdfe) throw new Refusal(MDFE_NAO_ENCONTRADO, 404);
  const homologacao = mdfe.environment !== PRODUCAO;
  if (mdfe.status === "CONTINGENCY" && chaveDeContingencia(mdfe.accessKey)) return { chave: mdfe.accessKey, xml: mdfe.xmlSent, homologacao, contingencia: true };
  if ((mdfe.status !== "AUTHORIZED" && mdfe.status !== "CLOSED") || !mdfe.protocol || !mdfe.xmlReturn) throw new Refusal(SO_AUTORIZADO_TEM_DAMDFE, 409);
  return { chave: mdfe.accessKey, xml: mdfe.xmlReturn, homologacao, contingencia: false };
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
