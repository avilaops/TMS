import { randomInt } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { Refusal } from "@/lib/cadastros";
import { registrarAuditoria, registrarAuditoriaDepois, type Origem, type QualquerAtor } from "@/lib/auditoria";
import { CifraError, cifraLigada, cifrar, decifrar } from "@/lib/cifra";
import type { Empresa } from "@/lib/cobranca-gateway-db";
import {
  CARGA_NAO_ENCONTRADA,
  CERTIFICADO_ILEGIVEL,
  CNPJ_COM_OUTRO_CERTIFICADO,
  CTE_NAO_ENCONTRADO,
  EMISSAO_EM_ANDAMENTO,
  FISCAL_INDISPONIVEL,
  FORA_DO_PRAZO,
  JA_AUTORIZADO,
  JA_REGISTRADO_DE_FORA,
  MUNICIPIO_DESCONHECIDO,
  ONDE_CONFIGURAR,
  PRODUCAO_PEDE_CONFIRMACAO,
  SEM_DADOS_FISCAIS,
  SEM_EMITENTE_CADASTRADO,
  SO_AUTORIZADO_CANCELA,
  SO_AUTORIZADO_TEM_DACTE,
  SO_AUTORIZADO_TEM_XML,
  SO_CARGA_QUE_SAIU,
  dentroDoPrazoDeCancelamento,
  type Ambiente,
  type CertificadoDaEmpresa,
  type ConferenciaDoCte,
  type CteEmitido,
  type DadosFiscais,
  type DadosFiscaisDoFormulario,
  type FiscalDaEmpresa,
  type Regime,
  type ResultadoDaEmissao,
  type SituacaoDaEmissao,
  type SituacaoDoCte,
  type SituacaoDoIcms,
  type StatusDoServico,
} from "@/lib/cte";
import { ALVO_DO_CTE, ALVO_DO_EVENTO, assinarXml, resumoDaAssinatura } from "@/lib/cte/assinar";
import { CertificadoError, VENCIDO, conferenciaDoCnpj, conferirCertificado, lerCertificado } from "@/lib/cte/certificado";
import { enderecosDaUf } from "@/lib/cte/enderecos";
import { TIPO_DO_CANCELAMENTO, montarCancelamento, montarCte, montarProcCte, type EmitenteDoCte } from "@/lib/cte/montar";
import { prepararCte, type CargaDoCte, type Preparo } from "@/lib/cte/preparar";
import { CSTAT, consultarCte, decidir, enviarCte, enviarEvento, eventoRegistrado, statusDoServico, type Decisao, type Destino, type Esperado, type Protocolo } from "@/lib/cte/sefaz";
import { SefazError, type Credencial } from "@/lib/cte/soap";
import { danfeLigado } from "@/lib/fiscal-mcp";
import { municipioDoTexto } from "@/lib/municipios";
import { STATUS_COM_CTE } from "@/lib/nfe";
import { avisarEquipe, avisoDeCte } from "@/lib/notificacoes";

/**
 * O que a emissão de CT-e grava e lê: os dados fiscais e o certificado da
 * empresa, a numeração, e o caminho de cada CT-e (montar, assinar, enviar,
 * gravar a resposta, cancelar). As regras estão em src/lib/cte.ts e
 * src/lib/cte/. Só o servidor importa este arquivo.
 *
 * NUMERAÇÃO (a decisão, e por quê):
 * - O número sai de `CteNumbering` (empresa + ambiente + série), com a empresa
 *   travada (`pg_advisory_xact_lock`, como a fatura): duas emissões ao mesmo
 *   tempo nunca levam o mesmo número, e nenhum número é pulado na hora de pegar.
 * - Rejeição NÃO consome o número: a SEFAZ não grava CT-e rejeitado, então a
 *   correção e o reenvio da mesma carga usam o mesmo número (com chave nova,
 *   porque o código aleatório muda).
 * - Autorização consome. A rejeição 539 (o número já foi usado por outro
 *   documento, com outra chave) também: a próxima tentativa pega número novo.
 * - Envio sem resposta não decide nada: o CT-e fica como está, com o MESMO XML,
 *   e a próxima tentativa começa consultando a SEFAZ pela chave. Se ela
 *   autorizou, grava; se não consta lá, reenvia o mesmo XML. Nunca nasce um
 *   segundo CT-e por causa de uma resposta que não chegou.
 * - Um buraco na numeração só aparece se uma carga rejeitada nunca for
 *   reenviada. O CT-e 4.00 não tem mais o serviço de inutilização (MOC 4.00,
 *   histórico de alterações): não há o que comunicar nesse caso.
 *
 * As chamadas à SEFAZ ficam FORA de transação: a transação só reserva o número
 * e grava o XML; outra, depois, grava a resposta.
 */

type Tx = Prisma.TransactionClient;
type Quem = { ator: QualquerAtor; origem: Origem };

const PRODUCAO: Ambiente = "PRODUCAO";
const SEM_CERTIFICADO = `A empresa não tem certificado digital A1. Envie em ${ONDE_CONFIGURAR}.`;

/* ------------------------------- Dados fiscais -------------------------------- */

// O contexto entra na cifra: o certificado cifrado de uma empresa não abre em outra.
const contexto = (tenantId: string, campo: "certPfx" | "certPassword") => `FiscalIssuer:${tenantId}:${campo}`;

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
  taxRegime: true,
  cteSeries: true,
  environment: true,
  cfopInState: true,
  cfopOutState: true,
  icmsCst: true,
  icmsRate: true,
  ibsCbsCst: true,
  ibsCbsClass: true,
  ibsStateRate: true,
  ibsCityRate: true,
  cbsRate: true,
  pisRate: true,
  cofinsRate: true,
  certSubject: true,
  certTaxId: true,
  certNotBefore: true,
  certNotAfter: true,
  certUploadedAt: true,
} as const;

type LinhaDoEmitente = Prisma.FiscalIssuerGetPayload<{ select: typeof EMITENTE_SELECT }>;

const ambienteDaLinha = (texto: string): Ambiente => (texto === PRODUCAO ? PRODUCAO : "HOMOLOGACAO");

/** A linha do banco no formato da montagem. */
function emitenteDaLinha(linha: LinhaDoEmitente): EmitenteDoCte {
  return {
    cnpj: linha.cnpj,
    ie: linha.ie,
    razaoSocial: linha.legalName,
    fantasia: linha.tradeName,
    endereco: { logradouro: linha.street, numero: linha.number, complemento: linha.complement, bairro: linha.district, codigoMunicipio: linha.cityCode, municipio: linha.cityName, uf: linha.state, cep: linha.zip },
    telefone: linha.phone,
    rntrc: linha.rntrc,
    regime: linha.taxRegime as Regime,
    serie: linha.cteSeries,
    ambiente: ambienteDaLinha(linha.environment),
    cfopDentro: linha.cfopInState,
    cfopFora: linha.cfopOutState,
    icms: linha.icmsCst as SituacaoDoIcms,
    aliquota: linha.icmsRate,
    ibsCbs:
      linha.ibsCbsCst && linha.ibsCbsClass
        ? { cst: linha.ibsCbsCst, classe: linha.ibsCbsClass, ibsUf: linha.ibsStateRate, ibsMunicipio: linha.ibsCityRate, cbs: linha.cbsRate, pis: linha.pisRate, cofins: linha.cofinsRate }
        : null,
  };
}

function certificadoDaLinha(linha: LinhaDoEmitente, agora: Date = new Date()): CertificadoDaEmpresa | null {
  if (!linha.certSubject || !linha.certTaxId || !linha.certNotBefore || !linha.certNotAfter || !linha.certUploadedAt) return null;
  return {
    titular: linha.certSubject,
    cnpj: linha.certTaxId,
    validoDe: linha.certNotBefore.toISOString(),
    validoAte: linha.certNotAfter.toISOString(),
    vencido: agora.getTime() > linha.certNotAfter.getTime(),
    confere: conferenciaDoCnpj(linha.certTaxId, linha.cnpj),
    enviadoEm: linha.certUploadedAt.toISOString(),
  };
}

type NumeracaoDb = Pick<Tx, "cteNumbering">;

async function proximoNumero(db: NumeracaoDb, ambiente: Ambiente, serie: number): Promise<number> {
  const numeracao = await db.cteNumbering.findFirst({ where: { environment: ambiente, series: serie }, select: { nextNumber: true } });
  return numeracao?.nextNumber ?? 1;
}

/** O que Empresa → Fiscal mostra: os dados, e do certificado só o titular, o CNPJ e a validade. */
export async function fiscalDaEmpresa(empresa: Empresa): Promise<FiscalDaEmpresa> {
  const linha = await empresa.db.fiscalIssuer.findUnique({ where: { tenantId: empresa.id }, select: EMITENTE_SELECT });
  if (!linha) return { disponivel: cifraLigada(), dados: null, certificado: null };
  const emitente = emitenteDaLinha(linha);
  const dados: DadosFiscais = {
    cnpj: emitente.cnpj,
    ie: emitente.ie,
    razaoSocial: emitente.razaoSocial,
    fantasia: emitente.fantasia ?? null,
    logradouro: emitente.endereco.logradouro,
    numero: emitente.endereco.numero,
    complemento: emitente.endereco.complemento ?? null,
    bairro: emitente.endereco.bairro,
    codigoMunicipio: emitente.endereco.codigoMunicipio,
    cidade: emitente.endereco.municipio,
    uf: emitente.endereco.uf,
    cep: emitente.endereco.cep ?? "",
    telefone: emitente.telefone ?? null,
    rntrc: emitente.rntrc,
    regime: emitente.regime,
    serie: emitente.serie,
    proximoNumero: await proximoNumero(empresa.db, emitente.ambiente, emitente.serie),
    ambiente: emitente.ambiente,
    cfopDentro: emitente.cfopDentro,
    cfopFora: emitente.cfopFora,
    icms: emitente.icms,
    aliquota: emitente.aliquota,
    ibsCbsCst: linha.ibsCbsCst,
    ibsCbsClasse: linha.ibsCbsClass,
    ibsUf: linha.ibsStateRate,
    ibsMunicipio: linha.ibsCityRate,
    cbs: linha.cbsRate,
    pis: linha.pisRate,
    cofins: linha.cofinsRate,
  };
  return { disponivel: cifraLigada(), dados, certificado: certificadoDaLinha(linha) };
}

/**
 * Os tempos das transações que esperam pela trava da numeração: várias emissões
 * ao mesmo tempo fazem fila, e a última da fila precisa de mais que os 5
 * segundos padrão do Prisma para chegar a vez dela.
 */
const COM_FILA = { maxWait: 15_000, timeout: 30_000 } as const;

/** Uma operação de numeração por vez na empresa. A trava some no fim da transação. */
async function travarNumeracao(tx: Tx, tenantId: string): Promise<void> {
  // `::text` porque a função devolve `void`, que o adaptador do banco não sabe ler.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${"tms:cte:" + tenantId}))::text`;
}

// O que vai para a auditoria dos dados fiscais: tudo, menos o que é do certificado.
const paraAuditoria = (linha: LinhaDoEmitente | null) =>
  linha && {
    cnpj: linha.cnpj,
    ie: linha.ie,
    legalName: linha.legalName,
    cityName: linha.cityName,
    state: linha.state,
    rntrc: linha.rntrc,
    taxRegime: linha.taxRegime,
    cteSeries: linha.cteSeries,
    environment: linha.environment,
    cfopInState: linha.cfopInState,
    cfopOutState: linha.cfopOutState,
    icmsCst: linha.icmsCst,
    icmsRate: linha.icmsRate,
    ibsCbsCst: linha.ibsCbsCst,
    ibsCbsClass: linha.ibsCbsClass,
    ibsStateRate: linha.ibsStateRate,
    ibsCityRate: linha.ibsCityRate,
    cbsRate: linha.cbsRate,
  };

/**
 * Grava os dados fiscais do emitente. Acha o código IBGE do município, exige a
 * confirmação do CNPJ para passar a produção e não deixa o próximo número ficar
 * abaixo de um CT-e que a SEFAZ já autorizou.
 */
export async function salvarDadosFiscais(empresa: Empresa, dados: DadosFiscaisDoFormulario, quem: Quem): Promise<FiscalDaEmpresa> {
  const municipio = municipioDoTexto(`${dados.cidade} - ${dados.uf}`);
  if (!municipio || municipio.uf !== dados.uf) throw new Refusal(MUNICIPIO_DESCONHECIDO, 400);

  await empresa.transacao(async (tx) => {
    await travarNumeracao(tx, empresa.id);
    const antes = await tx.fiscalIssuer.findUnique({ where: { tenantId: empresa.id }, select: EMITENTE_SELECT });

    if (dados.ambiente === PRODUCAO && antes?.environment !== PRODUCAO && dados.confirmacaoDoCnpj !== dados.cnpj) {
      throw new Refusal(PRODUCAO_PEDE_CONFIRMACAO, 400);
    }
    if (antes?.certTaxId && conferenciaDoCnpj(antes.certTaxId, dados.cnpj) === null) throw new Refusal(CNPJ_COM_OUTRO_CERTIFICADO, 409);

    const ultimo = await tx.cte.findFirst({
      where: { environment: dados.ambiente, series: dados.serie, status: { in: ["AUTHORIZED", "CANCELLED"] } },
      orderBy: { number: "desc" },
      select: { number: true },
    });
    if (ultimo && dados.proximoNumero <= ultimo.number) {
      throw new Refusal(`Já existe o CT-e nº ${ultimo.number} autorizado nesta série e ambiente: o próximo número precisa ser ${ultimo.number + 1} ou maior.`, 409);
    }

    const linha = {
      cnpj: dados.cnpj,
      ie: dados.ie,
      legalName: dados.razaoSocial,
      tradeName: dados.fantasia ?? null,
      street: dados.logradouro,
      number: dados.numero,
      complement: dados.complemento ?? null,
      district: dados.bairro,
      cityCode: municipio.codigo,
      cityName: municipio.nome,
      state: municipio.uf,
      zip: dados.cep,
      phone: dados.telefone ?? null,
      rntrc: dados.rntrc,
      taxRegime: dados.regime,
      cteSeries: dados.serie,
      environment: dados.ambiente,
      cfopInState: dados.cfopDentro,
      cfopOutState: dados.cfopFora,
      icmsCst: dados.icms,
      icmsRate: dados.aliquota,
      ibsCbsCst: dados.ibsCbsCst ?? null,
      ibsCbsClass: dados.ibsCbsClasse ?? null,
      ibsStateRate: dados.ibsUf,
      ibsCityRate: dados.ibsMunicipio,
      cbsRate: dados.cbs,
      pisRate: dados.pis,
      cofinsRate: dados.cofins,
    };
    const depois = await tx.fiscalIssuer.upsert({ where: { tenantId: empresa.id }, create: linha, update: linha, select: EMITENTE_SELECT });

    const numeracao = await tx.cteNumbering.findFirst({ where: { environment: dados.ambiente, series: dados.serie }, select: { id: true, nextNumber: true } });
    if (!numeracao) await tx.cteNumbering.create({ data: { environment: dados.ambiente, series: dados.serie, nextNumber: dados.proximoNumero }, select: { id: true } });
    else if (numeracao.nextNumber !== dados.proximoNumero) await tx.cteNumbering.update({ where: { id: numeracao.id }, data: { nextNumber: dados.proximoNumero }, select: { id: true } });

    await registrarAuditoria(tx, {
      ...quem,
      acao: "empresa.fiscal",
      entidade: "empresa",
      entidadeId: empresa.id,
      resumo: antes ? "Dados fiscais do emitente alterados" : "Dados fiscais do emitente cadastrados",
      antes: { ...paraAuditoria(antes), ...(antes && { proximoNumero: numeracao?.nextNumber ?? 1 }) },
      depois: { ...paraAuditoria(depois), proximoNumero: dados.proximoNumero },
    });
  }, COM_FILA);

  return fiscalDaEmpresa(empresa);
}

/**
 * Guarda (cifrado) o certificado A1 da empresa, depois de abrir o arquivo com a
 * senha e conferir que é um e-CNPJ A1, na validade, da empresa emitente. Na
 * auditoria vai o titular, o CNPJ e a validade: nunca o arquivo nem a senha.
 */
export async function salvarCertificado(empresa: Empresa, envio: { arquivo: string; senha: string }, quem: Quem): Promise<FiscalDaEmpresa> {
  if (!cifraLigada()) throw new Refusal(FISCAL_INDISPONIVEL, 503);
  const antes = await empresa.db.fiscalIssuer.findUnique({ where: { tenantId: empresa.id }, select: EMITENTE_SELECT });
  if (!antes) throw new Refusal(SEM_DADOS_FISCAIS, 409);

  let titular: string;
  let cnpj: string;
  let validoDe: Date;
  let validoAte: Date;
  try {
    const lido = lerCertificado(Buffer.from(envio.arquivo, "base64"), envio.senha);
    conferirCertificado(lido, antes.cnpj);
    ({ titular, validoDe, validoAte } = lido);
    cnpj = lido.cnpj ?? "";
  } catch (erro) {
    if (erro instanceof CertificadoError) throw new Refusal(erro.message, 400);
    throw erro;
  }

  await empresa.db.fiscalIssuer.update({
    where: { tenantId: empresa.id },
    data: {
      certPfxEnc: cifrar(envio.arquivo, contexto(empresa.id, "certPfx")),
      certPasswordEnc: cifrar(envio.senha, contexto(empresa.id, "certPassword")),
      certSubject: titular,
      certTaxId: cnpj,
      certNotBefore: validoDe,
      certNotAfter: validoAte,
      certUploadedAt: new Date(),
    },
    select: { id: true },
  });

  // Os nomes dos campos não levam "cert" + "senha"/"arquivo": só o que a tela também mostra.
  await registrarAuditoriaDepois(empresa.db, {
    ...quem,
    acao: "empresa.certificado",
    entidade: "empresa",
    entidadeId: empresa.id,
    resumo: antes.certSubject ? "Certificado digital A1 trocado" : "Certificado digital A1 enviado",
    antes: { certificado: antes.certSubject ? `${antes.certSubject} (CNPJ ${antes.certTaxId}), válido até ${antes.certNotAfter?.toISOString().slice(0, 10)}` : "sem certificado" },
    depois: { certificado: `${titular} (CNPJ ${cnpj}), válido até ${validoAte.toISOString().slice(0, 10)}` },
  });
  return fiscalDaEmpresa(empresa);
}

/** Apaga o certificado guardado. Os CT-e já emitidos ficam como estão. */
export async function removerCertificado(empresa: Empresa, quem: Quem): Promise<FiscalDaEmpresa> {
  const antes = await empresa.db.fiscalIssuer.findUnique({ where: { tenantId: empresa.id }, select: EMITENTE_SELECT });
  if (antes?.certSubject) {
    await empresa.db.fiscalIssuer.update({
      where: { tenantId: empresa.id },
      data: { certPfxEnc: null, certPasswordEnc: null, certSubject: null, certTaxId: null, certNotBefore: null, certNotAfter: null, certUploadedAt: null },
      select: { id: true },
    });
    await registrarAuditoriaDepois(empresa.db, {
      ...quem,
      acao: "empresa.certificado",
      entidade: "empresa",
      entidadeId: empresa.id,
      resumo: "Certificado digital A1 removido",
      antes: { certificado: `${antes.certSubject} (CNPJ ${antes.certTaxId})` },
      depois: { certificado: "sem certificado" },
    });
  }
  return fiscalDaEmpresa(empresa);
}

type CredencialDaEmpresa = Credencial & {
  /** Só o certificado do titular: é o que vai no `KeyInfo` da assinatura. */
  titularPem: string;
};

/**
 * A chave e o certificado em claro, para assinar e para a conexão com a SEFAZ.
 * Recusa (com a frase para a pessoa) quando não há certificado, quando ele
 * venceu ou quando o que está guardado não abre mais.
 */
async function credencialDaEmpresa(empresa: Empresa): Promise<CredencialDaEmpresa> {
  if (!cifraLigada()) throw new Refusal(FISCAL_INDISPONIVEL, 503);
  const linha = await empresa.db.fiscalIssuer.findUnique({ where: { tenantId: empresa.id }, select: { certPfxEnc: true, certPasswordEnc: true, certNotAfter: true } });
  if (!linha?.certPfxEnc || !linha.certPasswordEnc) throw new Refusal(SEM_CERTIFICADO, 409);
  if (linha.certNotAfter && Date.now() > linha.certNotAfter.getTime()) throw new Refusal(`${VENCIDO} Envie o novo em ${ONDE_CONFIGURAR}.`, 409);
  try {
    const arquivo = decifrar(linha.certPfxEnc, contexto(empresa.id, "certPfx"));
    const senha = decifrar(linha.certPasswordEnc, contexto(empresa.id, "certPassword"));
    const lido = lerCertificado(Buffer.from(arquivo, "base64"), senha);
    return { chavePem: lido.chavePem, certificadoPem: lido.certificadoPem, titularPem: lido.titularPem };
  } catch (erro) {
    if (erro instanceof CifraError || erro instanceof CertificadoError) throw new Refusal(CERTIFICADO_ILEGIVEL, 503);
    throw erro;
  }
}

/* ----------------------------------- Leitura ---------------------------------- */

export const CTE_SELECT = {
  id: true,
  environment: true,
  series: true,
  number: true,
  accessKey: true,
  status: true,
  statusCode: true,
  statusReason: true,
  protocol: true,
  authorizedAt: true,
  cancelledAt: true,
  unanswered: true,
  updatedAt: true,
} as const;

type LinhaDoCte = Prisma.CteGetPayload<{ select: typeof CTE_SELECT }>;

/** O CT-e para a tela. Sem XML. */
export function paraATela(cte: LinhaDoCte): CteEmitido {
  return {
    id: cte.id,
    ambiente: ambienteDaLinha(cte.environment),
    serie: cte.series,
    numero: cte.number,
    chave: cte.accessKey,
    situacao: cte.status as SituacaoDoCte,
    cStat: cte.statusCode,
    motivo: cte.statusReason,
    protocolo: cte.protocol,
    autorizadoEm: cte.authorizedAt?.toISOString() ?? null,
    canceladoEm: cte.cancelledAt?.toISOString() ?? null,
    semResposta: cte.unanswered,
    atualizadoEm: cte.updatedAt.toISOString(),
  };
}

/** O CT-e mais recente de cada carga da lista (o que a tela mostra no selo). */
export const CTE_DA_CARGA = { ctes: { select: CTE_SELECT, orderBy: { updatedAt: "desc" }, take: 1 } } as const;

const CARGA_SELECT = {
  id: true,
  trackingCode: true,
  status: true,
  sender: true,
  receiver: true,
  origin: true,
  destination: true,
  volumes: true,
  weight: true,
  invoiceKey: true,
  invoiceValue: true,
  freightValue: true,
  freightDetails: true,
  deliveryStreet: true,
  deliveryNumber: true,
  deliveryDistrict: true,
  deliveryZip: true,
  cteKey: true,
  cteStatus: true,
  client: {
    select: { companyName: true, tradeName: true, cnpj: true, ie: true, email: true, phone: true, address: true, receivers: { select: { name: true, document: true, address: true }, take: 500 } },
  },
  fiscalDocuments: { select: { accessKey: true, xml: true }, orderBy: { createdAt: "asc" }, take: 50 },
  manifest: { select: { vehicle: { select: { plate: true } }, driver: { select: { user: { select: { name: true } } } } } },
} as const;

type LinhaDaCarga = Prisma.CollectionGetPayload<{ select: typeof CARGA_SELECT }>;

function cargaDoCte(linha: LinhaDaCarga): CargaDoCte {
  const { receivers, ...cliente } = linha.client;
  return {
    trackingCode: linha.trackingCode,
    sender: linha.sender,
    receiver: linha.receiver,
    origin: linha.origin,
    destination: linha.destination,
    volumes: linha.volumes,
    weight: linha.weight,
    invoiceKey: linha.invoiceKey,
    invoiceValue: linha.invoiceValue,
    freightValue: linha.freightValue,
    freightDetails: linha.freightDetails,
    deliveryStreet: linha.deliveryStreet,
    deliveryNumber: linha.deliveryNumber,
    deliveryDistrict: linha.deliveryDistrict,
    deliveryZip: linha.deliveryZip,
    client: cliente,
    notas: linha.fiscalDocuments,
    destinatarios: receivers,
    viagem: linha.manifest ? { placa: linha.manifest.vehicle.plate, motorista: linha.manifest.driver.user.name } : null,
  };
}

type Situacao = {
  linha: LinhaDaCarga;
  emitente: EmitenteDoCte | null;
  certificado: CertificadoDaEmpresa | null;
  preparo: Preparo;
  /** O que impede a emissão: as pendências do documento e as da empresa e da carga. */
  pendencias: string[];
};

type LeituraDb = Pick<Tx, "collection" | "fiscalIssuer" | "cte">;

/** O que falta no certificado para assinar e transmitir. Vazio = há certificado válido, da empresa, e chave para abri-lo. */
function faltasDoCertificado(certificado: CertificadoDaEmpresa | null): string[] {
  if (!cifraLigada()) return [FISCAL_INDISPONIVEL];
  if (!certificado) return [SEM_CERTIFICADO];
  if (certificado.vencido) return [`O certificado digital da empresa venceu. Envie o novo em ${ONDE_CONFIGURAR}.`];
  if (certificado.confere === null) return [`O certificado digital é de outro CNPJ. Envie o da empresa emitente em ${ONDE_CONFIGURAR}.`];
  return [];
}

/** A empresa está pronta para emitir? É o que a tela de CT-e mostra no topo. */
export async function situacaoDaEmissao(empresa: Empresa): Promise<SituacaoDaEmissao> {
  const linha = await empresa.db.fiscalIssuer.findUnique({ where: { tenantId: empresa.id }, select: EMITENTE_SELECT });
  const faltas = [...(linha ? [] : [SEM_EMITENTE_CADASTRADO]), ...faltasDoCertificado(linha ? certificadoDaLinha(linha) : null)];
  return { pronta: faltas.length === 0, ambiente: linha ? ambienteDaLinha(linha.environment) : null, faltas, dacte: danfeLigado() };
}

/** Lê a carga e a empresa e diz se dá para emitir. É o que a conferência mostra e o que a emissão confere de novo. */
async function situacaoDaCarga(db: LeituraDb, tenantId: string, collectionId: string): Promise<Situacao> {
  const linha = await db.collection.findUnique({ where: { id: collectionId }, select: CARGA_SELECT });
  if (!linha) throw new Refusal(CARGA_NAO_ENCONTRADA, 404);
  const doEmitente = await db.fiscalIssuer.findUnique({ where: { tenantId }, select: EMITENTE_SELECT });
  const emitente = doEmitente ? emitenteDaLinha(doEmitente) : null;
  const certificado = doEmitente ? certificadoDaLinha(doEmitente) : null;
  const enderecos = emitente ? enderecosDaUf(emitente.endereco.uf, emitente.ambiente) : null;
  const preparo = prepararCte(cargaDoCte(linha), emitente, enderecos?.qrCode ?? null, municipioDoTexto);

  const daEmpresa = faltasDoCertificado(certificado);

  const daCarga: string[] = [];
  if (!(STATUS_COM_CTE as readonly string[]).includes(linha.status)) daCarga.push(SO_CARGA_QUE_SAIU);
  if (emitente) {
    const autorizado = await db.cte.findFirst({ where: { collectionId, environment: emitente.ambiente, status: "AUTHORIZED" }, select: { id: true } });
    if (autorizado) daCarga.push(JA_AUTORIZADO);
    // Em produção o CT-e autorizado ocupa os campos da carga: um registro manual que já esteja lá precisa sair antes.
    else if (emitente.ambiente === PRODUCAO && linha.cteKey !== null && linha.cteStatus === "ISSUED") daCarga.push(JA_REGISTRADO_DE_FORA);
  }

  // Sem os dados fiscais não há documento para conferir: a pendência é preenchê-los.
  const pendencias = emitente ? [...daEmpresa, ...daCarga, ...preparo.pendencias] : [SEM_EMITENTE_CADASTRADO, ...daEmpresa, ...daCarga];
  return { linha, emitente, certificado, preparo, pendencias };
}

/** "Conferir e emitir": o que vai no documento, o que falta e o CT-e que a carga já tem. */
export async function conferirCte(empresa: Empresa, collectionId: string): Promise<ConferenciaDoCte> {
  const { emitente, certificado, preparo, pendencias } = await situacaoDaCarga(empresa.db, empresa.id, collectionId);
  const ultimo = emitente
    ? await empresa.db.cte.findFirst({ where: { collectionId, environment: emitente.ambiente }, orderBy: { updatedAt: "desc" }, select: { ...CTE_SELECT, numberBurned: true } })
    : null;
  // O número que o reenvio de um rejeitado mantém; senão, o próximo da série.
  const mantem = ultimo && (ultimo.status === "DRAFT" || ultimo.status === "REJECTED") && !ultimo.numberBurned && emitente && ultimo.series === emitente.serie;
  const numeroPrevisto = mantem ? ultimo.number : emitente ? await proximoNumero(empresa.db, emitente.ambiente, emitente.serie) : 0;
  return {
    pronta: emitente !== null && faltasDoCertificado(certificado).length === 0,
    pendencias,
    avisos: preparo.avisos,
    resumo: preparo.resumo && { ...preparo.resumo, numeroPrevisto },
    cte: ultimo && paraATela(ultimo),
  };
}

/* ----------------------------------- Emissão ---------------------------------- */

/** Um envio é dado como parado depois disto: cobre a consulta e o envio, com folga. */
const ENVIO_EM_ANDAMENTO_MS = 120_000;

/** O código numérico aleatório da chave (`cCT`), 8 dígitos. */
export const sortearCodigo = () => String(randomInt(0, 100_000_000)).padStart(8, "0");

const STATUS_DA_FALHA = (erro: SefazError) => (erro.motivo === "tempo" ? 504 : 502);

const MOTIVO_MAXIMO = 300;
const frase = (cStat: number, motivo: string) => `${cStat} - ${motivo}`.slice(0, MOTIVO_MAXIMO);

type Preparado = {
  id: string;
  chave: string;
  numero: number;
  xml: string;
  ambiente: Ambiente;
  uf: string;
  cnpj: string;
  /** O envio anterior ficou sem resposta: antes de reenviar, consulta a SEFAZ pela chave. */
  retomar: boolean;
  carga: { id: string; trackingCode: string | null };
};

/**
 * Reserva o número, monta e assina o CT-e e grava o rascunho, com a empresa
 * travada. Se a carga tem um envio sem resposta, não monta nada: devolve o
 * mesmo XML, para a retomada.
 */
async function prepararEnvio(empresa: Empresa, collectionId: string, credencial: CredencialDaEmpresa, quem: Quem): Promise<Preparado> {
  return empresa.transacao(async (tx) => {
    await travarNumeracao(tx, empresa.id);
    const { linha, emitente, preparo, pendencias } = await situacaoDaCarga(tx, empresa.id, collectionId);
    if (pendencias.length > 0 || !emitente || !preparo.dados) throw new Refusal(pendencias[0] ?? SEM_EMITENTE_CADASTRADO, 409);

    const ambiente = emitente.ambiente;
    const carga = { id: linha.id, trackingCode: linha.trackingCode };
    const base = { ambiente, uf: emitente.endereco.uf, cnpj: emitente.cnpj, carga };
    const pendente = await tx.cte.findFirst({
      where: { collectionId, environment: ambiente, status: { in: ["DRAFT", "REJECTED"] } },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true, series: true, number: true, accessKey: true, xmlSent: true, sendingAt: true, unanswered: true, numberBurned: true },
    });
    const agora = new Date();
    if (pendente?.sendingAt && agora.getTime() - pendente.sendingAt.getTime() < ENVIO_EM_ANDAMENTO_MS) throw new Refusal(EMISSAO_EM_ANDAMENTO, 409);

    if (pendente && pendente.status === "DRAFT" && pendente.unanswered) {
      await tx.cte.update({ where: { id: pendente.id }, data: { sendingAt: agora }, select: { id: true } });
      return { ...base, id: pendente.id, chave: pendente.accessKey, numero: pendente.number, xml: pendente.xmlSent, retomar: true };
    }

    // Rejeição não consome o número: o reenvio da mesma carga usa o mesmo, salvo quando a SEFAZ disse que ele já foi usado.
    let numero: number;
    if (pendente && !pendente.numberBurned && pendente.series === emitente.serie) {
      numero = pendente.number;
    } else {
      const numeracao = await tx.cteNumbering.findFirst({ where: { environment: ambiente, series: emitente.serie }, select: { id: true, nextNumber: true } });
      numero = numeracao?.nextNumber ?? 1;
      if (numeracao) await tx.cteNumbering.update({ where: { id: numeracao.id }, data: { nextNumber: numero + 1 }, select: { id: true } });
      else await tx.cteNumbering.create({ data: { environment: ambiente, series: emitente.serie, nextNumber: numero + 1 }, select: { id: true } });
    }

    const montado = montarCte({ ...preparo.dados, numero, codigo: sortearCodigo(), emissao: agora });
    const xml = assinarXml(montado.xml, ALVO_DO_CTE, { chavePem: credencial.chavePem, certificadoPem: credencial.titularPem });
    const dados = {
      series: emitente.serie,
      number: numero,
      accessKey: montado.chave,
      status: "DRAFT",
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
      ? await tx.cte.update({ where: { id: pendente.id }, data: dados, select: { id: true } })
      : await tx.cte.create({ data: { ...dados, collectionId, environment: ambiente }, select: { id: true } });
    return { ...base, id: gravado.id, chave: montado.chave, numero, xml, retomar: false };
  }, COM_FILA);
}

/** Quando há endereço de integração, põe o evento na fila, na mesma transação da mudança. */
async function avisarIntegracao(tx: Tx, tipo: "cte.autorizado" | "cte.cancelado", cteId: string): Promise<void> {
  const webhook = await tx.webhook.findFirst({ select: { id: true } });
  if (!webhook) return;
  await tx.outboxEvent.create({ data: { type: tipo, payload: { cteId } }, select: { id: true } });
}

/** Grava a autorização: só chega aqui com o protocolo que a SEFAZ devolveu. */
async function gravarAutorizacao(empresa: Empresa, preparado: Preparado, protocolo: Protocolo & { numero: string }, quem: Quem): Promise<LinhaDoCte> {
  return empresa.transacao(async (tx) => {
    const gravado = await tx.cte.update({
      where: { id: preparado.id },
      data: {
        status: "AUTHORIZED",
        protocol: protocolo.numero,
        xmlReturn: montarProcCte(preparado.xml, protocolo.xml),
        statusCode: protocolo.cStat,
        statusReason: protocolo.motivo.slice(0, MOTIVO_MAXIMO),
        authorizedAt: protocolo.recebidoEm ?? new Date(),
        sendingAt: null,
        unanswered: false,
      },
      select: CTE_SELECT,
    });
    // Só o CT-e de produção tem valor fiscal: é ele que passa a ser o CT-e da carga.
    if (preparado.ambiente === PRODUCAO) {
      await tx.collection.update({ where: { id: preparado.carga.id }, data: { cteKey: preparado.chave, cteNumber: preparado.numero, cteStatus: "ISSUED" }, select: { id: true } });
    }
    const emHomologacao = preparado.ambiente === PRODUCAO ? "" : " em homologação (sem valor fiscal)";
    await registrarAuditoria(tx, {
      ...quem,
      acao: "cte.emitir",
      entidade: "cte",
      entidadeId: preparado.id,
      resumo: `CT-e nº ${preparado.numero} autorizado${emHomologacao} para a carga ${preparado.carga.trackingCode ?? ""}`,
      depois: { number: preparado.numero, accessKey: preparado.chave, environment: preparado.ambiente, protocol: protocolo.numero, collectionId: preparado.carga.id },
    });
    await avisarEquipe(tx, "fiscalVer", avisoDeCte("autorizado", { numero: preparado.numero, ambiente: preparado.ambiente, carga: preparado.carga.trackingCode }), quem.ator.id);
    await avisarIntegracao(tx, "cte.autorizado", preparado.id);
    return gravado;
  });
}

type Mudanca = { status?: SituacaoDoCte; statusCode?: number | null; statusReason: string; unanswered?: boolean; numberBurned?: boolean };

/** Grava o que não é autorização: rejeição, serviço parado, envio sem resposta. Solta a marca de envio em andamento. */
async function gravarSemAutorizacao(empresa: Empresa, id: string, mudanca: Mudanca): Promise<LinhaDoCte> {
  return empresa.db.cte.update({ where: { id }, data: { ...mudanca, statusReason: mudanca.statusReason.slice(0, MOTIVO_MAXIMO), sendingAt: null }, select: CTE_SELECT });
}

const resultado = (cte: LinhaDoCte, autorizado: boolean, mensagem: string): ResultadoDaEmissao => ({ cte: paraATela(cte), autorizado, mensagem });

const SEM_RESPOSTA = "O CT-e ficou sem resposta: emitir de novo começa consultando a SEFAZ pela chave, sem duplicar.";

/**
 * Emite o CT-e da carga: reserva o número, monta, assina, envia e grava a
 * resposta. Devolve o CT-e como ficou e a mensagem da SEFAZ.
 *
 * - Autorizado (com protocolo): grava o cteProc e, em produção, o CT-e da carga.
 * - Rejeitado: fica "rejeitado" com o código e o motivo; emitir de novo refaz o
 *   documento com o mesmo número.
 * - Sem resposta: fica como rascunho "sem resposta"; emitir de novo consulta a
 *   SEFAZ pela chave antes de reenviar o MESMO XML.
 * Falha de rede vira `Refusal` 502/504, com o CT-e intocado ou marcado "sem resposta".
 */
export async function emitirCte(empresa: Empresa, collectionId: string, quem: Quem): Promise<ResultadoDaEmissao> {
  const credencial = await credencialDaEmpresa(empresa);
  const preparado = await prepararEnvio(empresa, collectionId, credencial, quem);
  const destino: Destino = { uf: preparado.uf, ambiente: preparado.ambiente, credencial };
  const esperado: Esperado = { chave: preparado.chave, ambiente: preparado.ambiente, resumo: resumoDaAssinatura(preparado.xml) };

  let decisao: Decisao;
  try {
    let jaEstaLa: Decisao | null = null;
    if (preparado.retomar) {
      const consulta = decidir(await consultarCte(destino, preparado.chave), esperado);
      if (consulta.tipo === "autorizado") jaEstaLa = consulta;
      // "Não consta" é o único caso em que o mesmo XML é enviado de novo. Qualquer outra resposta não
      // esclarece se o envio anterior valeu: o CT-e continua "sem resposta", e nada novo é montado.
      else if (!(consulta.tipo === "rejeitado" && consulta.cStat === CSTAT.NAO_CONSTA)) {
        const motivo = consulta.tipo === "incoerente" ? consulta.motivo : frase(consulta.cStat, consulta.motivo);
        jaEstaLa = { tipo: "incoerente", motivo: `A consulta pela chave não esclareceu a situação do CT-e: ${motivo}` };
      }
    }
    decisao = jaEstaLa ?? decidir(await enviarCte(destino, preparado.xml), esperado);
    // 204: este mesmo CT-e já está autorizado lá. O protocolo vem pela consulta.
    if (decisao.tipo === "ja-autorizado") {
      const consulta = decidir(await consultarCte(destino, preparado.chave), esperado);
      decisao = consulta.tipo === "autorizado" ? consulta : { tipo: "incoerente", motivo: `${frase(decisao.cStat, decisao.motivo)} A consulta pela chave não devolveu o protocolo.` };
    }
  } catch (erro) {
    if (!(erro instanceof SefazError)) {
      await gravarSemAutorizacao(empresa, preparado.id, { statusReason: "Falha interna no envio.", unanswered: preparado.retomar });
      throw erro;
    }
    // Na retomada o envio anterior continua sem resposta, mesmo que esta falha tenha sido antes de enviar.
    const semResposta = erro.incerto || preparado.retomar;
    await gravarSemAutorizacao(empresa, preparado.id, { statusReason: erro.message, unanswered: semResposta });
    throw new Refusal(semResposta ? `${erro.message} ${SEM_RESPOSTA}` : `${erro.message} O CT-e não chegou a ser processado: tente de novo.`, STATUS_DA_FALHA(erro));
  }

  if (decisao.tipo === "autorizado") {
    const cte = await gravarAutorizacao(empresa, preparado, decisao.protocolo, quem);
    const onde = preparado.ambiente === PRODUCAO ? "" : " em homologação (sem valor fiscal)";
    return resultado(cte, true, `CT-e nº ${preparado.numero} autorizado${onde}. Protocolo ${decisao.protocolo.numero}.`);
  }

  if (decisao.tipo === "incoerente") {
    await gravarSemAutorizacao(empresa, preparado.id, { statusReason: decisao.motivo, unanswered: true });
    throw new Refusal(`${decisao.motivo} ${SEM_RESPOSTA}`, 502);
  }

  if (decisao.tipo === "parado") {
    // Nada foi processado: o rascunho fica como estava antes deste envio.
    const cte = await gravarSemAutorizacao(empresa, preparado.id, { statusCode: decisao.cStat, statusReason: decisao.motivo, unanswered: preparado.retomar });
    return resultado(cte, false, `A SEFAZ não processou o CT-e: ${frase(decisao.cStat, decisao.motivo)}. Tente de novo mais tarde.`);
  }

  const numeroUsado = decisao.tipo === "numero-usado";
  const cte = await gravarSemAutorizacao(empresa, preparado.id, { status: "REJECTED", statusCode: decisao.cStat, statusReason: decisao.motivo, unanswered: false, numberBurned: numeroUsado });
  await registrarAuditoriaDepois(empresa.db, {
    ...quem,
    acao: "cte.rejeitar",
    entidade: "cte",
    entidadeId: preparado.id,
    resumo: `CT-e nº ${preparado.numero} da carga ${preparado.carga.trackingCode ?? ""} rejeitado pela SEFAZ: ${frase(decisao.cStat, decisao.motivo)}`,
    depois: { number: preparado.numero, environment: preparado.ambiente, statusCode: decisao.cStat, collectionId: preparado.carga.id },
  });
  const proximo = numeroUsado ? " O número já foi usado por outro documento: a próxima tentativa usa o número seguinte." : "";
  return resultado(cte, false, `A SEFAZ rejeitou o CT-e: ${frase(decisao.cStat, decisao.motivo)}.${proximo}`);
}

/* --------------------------------- Cancelamento -------------------------------- */

/**
 * Cancela um CT-e autorizado: monta, assina e envia o evento 110111. Só fica
 * "cancelado" com o evento registrado pela SEFAZ (135, com protocolo), ou
 * quando ela responde que o CT-e já estava cancelado (218) e a consulta pela
 * chave confirma (101).
 */
export async function cancelarCte(empresa: Empresa, cteId: string, justificativa: string, quem: Quem): Promise<CteEmitido> {
  const cte = await empresa.db.cte.findUnique({
    where: { id: cteId },
    select: { id: true, status: true, environment: true, number: true, accessKey: true, protocol: true, authorizedAt: true, collectionId: true, collection: { select: { trackingCode: true } } },
  });
  if (!cte) throw new Refusal(CTE_NAO_ENCONTRADO, 404);
  if (cte.status !== "AUTHORIZED" || !cte.protocol) throw new Refusal(SO_AUTORIZADO_CANCELA, 409);
  if (!dentroDoPrazoDeCancelamento(cte.authorizedAt)) throw new Refusal(FORA_DO_PRAZO, 409);

  const doEmitente = await empresa.db.fiscalIssuer.findUnique({ where: { tenantId: empresa.id }, select: { cnpj: true, state: true } });
  if (!doEmitente) throw new Refusal(SEM_EMITENTE_CADASTRADO, 409);
  const credencial = await credencialDaEmpresa(empresa);
  const ambiente = ambienteDaLinha(cte.environment);
  const destino: Destino = { uf: doEmitente.state, ambiente, credencial };

  const evento = montarCancelamento({ chave: cte.accessKey, cnpj: doEmitente.cnpj, ambiente, protocolo: cte.protocol, justificativa, quando: new Date() });
  const assinado = assinarXml(evento.xml, ALVO_DO_EVENTO, { chavePem: credencial.chavePem, certificadoPem: credencial.titularPem });

  let protocolo: string | null;
  let quando: Date;
  let retorno: string;
  try {
    const resposta = await enviarEvento(destino, assinado);
    if (eventoRegistrado(resposta, { chave: cte.accessKey, tipo: TIPO_DO_CANCELAMENTO })) {
      protocolo = resposta.protocolo;
      quando = resposta.registradoEm ?? new Date();
      retorno = resposta.xml;
    } else if (resposta.cStat === CSTAT.JA_CANCELADO && (await consultarCte(destino, cte.accessKey)).cStat === CSTAT.CANCELADO) {
      // Um pedido anterior chegou lá e a resposta se perdeu: o CT-e está cancelado na SEFAZ.
      protocolo = null;
      quando = new Date();
      retorno = resposta.xml;
    } else {
      throw new Refusal(`A SEFAZ recusou o cancelamento: ${frase(resposta.cStat, resposta.motivo)}.`, 409);
    }
  } catch (erro) {
    if (erro instanceof SefazError) throw new Refusal(`${erro.message} O CT-e continua autorizado: tente cancelar de novo.`, STATUS_DA_FALHA(erro));
    throw erro;
  }

  const gravado = await empresa.transacao(async (tx) => {
    const atualizado = await tx.cte.update({
      where: { id: cte.id },
      data: { status: "CANCELLED", cancelledAt: quando, cancelProtocol: protocolo, cancelReason: justificativa, cancelXml: `${assinado}${retorno}` },
      select: CTE_SELECT,
    });
    // O CT-e da carga só muda se for este mesmo (o de produção).
    await tx.collection.updateMany({ where: { id: cte.collectionId, cteKey: cte.accessKey }, data: { cteStatus: "CANCELLED" } });
    await registrarAuditoria(tx, {
      ...quem,
      acao: "cte.cancelar",
      entidade: "cte",
      entidadeId: cte.id,
      resumo: `CT-e nº ${cte.number} da carga ${cte.collection.trackingCode ?? ""} cancelado`,
      antes: { status: "AUTHORIZED" },
      depois: { status: "CANCELLED", cancelProtocol: protocolo, cancelReason: justificativa },
    });
    await avisarEquipe(tx, "fiscalVer", avisoDeCte("cancelado", { numero: cte.number, ambiente, carga: cte.collection.trackingCode }), quem.ator.id);
    await avisarIntegracao(tx, "cte.cancelado", cte.id);
    return atualizado;
  });
  return paraATela(gravado);
}

/* ------------------------------ XML e status do serviço ------------------------ */

/** O arquivo do CT-e autorizado (cteProc), para baixar. Só existe para o que a SEFAZ autorizou. */
export async function xmlDoCte(empresa: Empresa, cteId: string): Promise<{ chave: string; xml: string }> {
  const cte = await empresa.db.cte.findUnique({ where: { id: cteId }, select: { accessKey: true, status: true, xmlReturn: true } });
  if (!cte) throw new Refusal(CTE_NAO_ENCONTRADO, 404);
  if ((cte.status !== "AUTHORIZED" && cte.status !== "CANCELLED") || !cte.xmlReturn) throw new Refusal(SO_AUTORIZADO_TEM_XML, 409);
  return { chave: cte.accessKey, xml: cte.xmlReturn };
}

/** O que a rota do DACTE precisa: o cteProc de um CT-e autorizado (e ainda não cancelado) e se ele é de homologação. */
export async function dacteDoCte(empresa: Empresa, cteId: string): Promise<{ chave: string; xml: string; homologacao: boolean }> {
  const cte = await empresa.db.cte.findUnique({ where: { id: cteId }, select: { accessKey: true, status: true, environment: true, protocol: true, xmlReturn: true } });
  if (!cte) throw new Refusal(CTE_NAO_ENCONTRADO, 404);
  if (cte.status !== "AUTHORIZED" || !cte.protocol || !cte.xmlReturn) throw new Refusal(SO_AUTORIZADO_TEM_DACTE, 409);
  return { chave: cte.accessKey, xml: cte.xmlReturn, homologacao: cte.environment !== PRODUCAO };
}

/** Pergunta à SEFAZ da UF do emitente, no ambiente em uso, se o serviço de CT-e está em operação. */
export async function statusDoServicoDaEmpresa(empresa: Empresa): Promise<StatusDoServico> {
  const doEmitente = await empresa.db.fiscalIssuer.findUnique({ where: { tenantId: empresa.id }, select: { state: true, environment: true } });
  if (!doEmitente) throw new Refusal(SEM_EMITENTE_CADASTRADO, 409);
  const credencial = await credencialDaEmpresa(empresa);
  const ambiente = ambienteDaLinha(doEmitente.environment);
  const autorizador = enderecosDaUf(doEmitente.state, ambiente)?.autorizador ?? doEmitente.state;
  try {
    const resposta = await statusDoServico({ uf: doEmitente.state, ambiente, credencial });
    return { ambiente, autorizador, emOperacao: resposta.emOperacao, cStat: resposta.cStat, motivo: resposta.motivo };
  } catch (erro) {
    if (erro instanceof SefazError) return { ambiente, autorizador, emOperacao: false, cStat: null, motivo: erro.message };
    throw erro;
  }
}
