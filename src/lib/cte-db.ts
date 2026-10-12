import { randomInt } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { Refusal } from "@/lib/cadastros";
import { registrarAuditoria, registrarAuditoriaDepois, type Origem, type QualquerAtor } from "@/lib/auditoria";
import { CifraError, cifraLigada, cifrar, decifrar } from "@/lib/cifra";
import type { Empresa } from "@/lib/cobranca-gateway-db";
import { comoDataUrl } from "@/lib/comprovantes";
import {
  CANCELAMENTO_COM_CARTA,
  CANCELAMENTO_COM_ENTREGA,
  CARGA_NAO_ENCONTRADA,
  CERTIFICADO_ILEGIVEL,
  CNPJ_COM_OUTRO_CERTIFICADO,
  CTE_NAO_ENCONTRADO,
  EMISSAO_EM_ANDAMENTO,
  ENTREGA_JA_REGISTRADA,
  FISCAL_INDISPONIVEL,
  FORA_DO_PRAZO,
  JA_AUTORIZADO,
  JA_REGISTRADO_DE_FORA,
  LIMITE_DE_CARTAS,
  MAXIMO_DE_CARTAS,
  MAXIMO_DE_COMPROVANTES,
  MUNICIPIO_DESCONHECIDO,
  ONDE_CONFIGURAR,
  PRODUCAO_PEDE_CONFIRMACAO,
  RECEBEDOR_INCOMPLETO,
  ROTULO_DO_EVENTO_DO_CTE,
  SEM_COMPROVANTE_ACEITO,
  SEM_DADOS_FISCAIS,
  SEM_EMITENTE_CADASTRADO,
  SEM_ENTREGA_REGISTRADA,
  SEM_IMAGEM_NO_COMPROVANTE,
  SO_AUTORIZADO_CANCELA,
  SO_AUTORIZADO_RECEBE_EVENTO,
  SO_AUTORIZADO_TEM_DACTE,
  SO_AUTORIZADO_TEM_XML,
  SO_CARGA_QUE_SAIU,
  SO_ENVIADO_SE_CONFERE,
  SVC_AINDA_NAO_SINCRONIZADA,
  SVC_NAO_OFERECIDA,
  TIPO_DO_EVENTO_DO_CTE,
  dentroDoPrazoDeCancelamento,
  fraseDaSvcInativa,
  resumoDaCarta,
  svcOferecida,
  type Ambiente,
  type CertificadoDaEmpresa,
  type ConferenciaDoCte,
  type ConferenciaNaSefaz,
  type CorrecaoDaCarta,
  type CteEmitido,
  type DadosFiscais,
  type DadosFiscaisDoFormulario,
  type EntregaDoCte,
  type EventoDoCte,
  type EventosDoCte,
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
import { svcDaChave, type Svc } from "@/lib/cte/chave";
import { enderecosDaUf, svcDaUf } from "@/lib/cte/enderecos";
import { chavesDeNfeDaEntrega, hashDaEntrega, montarCancelamentoDoComprovante, montarCartaDeCorrecao, montarComprovanteDeEntrega, montarProcEventoCte, type EventoMontado } from "@/lib/cte/eventos";
import { TIPO_DO_CANCELAMENTO, montarCancelamento, montarCte, montarProcCte, type EmitenteDoCte } from "@/lib/cte/montar";
import { prepararCte, type CargaDoCte, type Preparo } from "@/lib/cte/preparar";
import { responsavelTecnico } from "@/lib/cte/responsavel-tecnico";
import {
  CSTAT,
  consultarCte,
  decidir,
  enviarCte,
  enviarEvento,
  eventoGuardadoComRessalva,
  eventoRegistrado,
  fraseDoEventoComRessalva,
  statusDoServico,
  type Decisao,
  type Destino,
  type Esperado,
  type EventoDaConsulta,
  type Protocolo,
  type RespostaDaConsulta,
  type RespostaDoEvento,
} from "@/lib/cte/sefaz";
import { SefazError, type Credencial } from "@/lib/cte/soap";
import { textoDoXml } from "@/lib/cte/texto";
import { danfeLigado } from "@/lib/fiscal-mcp";
import { municipioDoTexto } from "@/lib/municipios";
import { cargaRecebeCte } from "@/lib/nfe";
import { REDESPACHO_SELECT, servicoDaCarga } from "@/lib/redespacho";
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

export const EMITENTE_SELECT = {
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
  taxRegime: true,
  cteSeries: true,
  environment: true,
  cfopInState: true,
  cfopOutState: true,
  icmsCst: true,
  icmsRate: true,
  icmsBaseReduction: true,
  icmsReductionInterstate: true,
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

export type LinhaDoEmitente = Prisma.FiscalIssuerGetPayload<{ select: typeof EMITENTE_SELECT }>;

export const ambienteDaLinha = (texto: string): Ambiente => (texto === PRODUCAO ? PRODUCAO : "HOMOLOGACAO");

/** A linha do banco no formato da montagem. */
export function emitenteDaLinha(linha: LinhaDoEmitente): EmitenteDoCte {
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
    regime: linha.taxRegime as Regime,
    serie: linha.cteSeries,
    ambiente: ambienteDaLinha(linha.environment),
    cfopDentro: linha.cfopInState,
    cfopFora: linha.cfopOutState,
    icms: linha.icmsCst as SituacaoDoIcms,
    aliquota: linha.icmsRate,
    reducaoDaBase: linha.icmsBaseReduction,
    reducaoNaInterestadual: linha.icmsReductionInterstate,
    ibsCbs:
      linha.ibsCbsCst && linha.ibsCbsClass
        ? { cst: linha.ibsCbsCst, classe: linha.ibsCbsClass, ibsUf: linha.ibsStateRate, ibsMunicipio: linha.ibsCityRate, cbs: linha.cbsRate, pis: linha.pisRate, cofins: linha.cofinsRate }
        : null,
  };
}

export function certificadoDaLinha(
  // Só o que é do certificado e o CNPJ do emitente: o MDF-e (src/lib/mdfe-db.ts) lê a mesma linha com outros campos.
  linha: Pick<LinhaDoEmitente, "cnpj" | "certSubject" | "certTaxId" | "certNotBefore" | "certNotAfter" | "certUploadedAt">,
  agora: Date = new Date(),
): CertificadoDaEmpresa | null {
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
    contato: emitente.contato ?? null,
    email: emitente.email ?? null,
    rntrc: emitente.rntrc,
    regime: emitente.regime,
    serie: emitente.serie,
    proximoNumero: await proximoNumero(empresa.db, emitente.ambiente, emitente.serie),
    ambiente: emitente.ambiente,
    cfopDentro: emitente.cfopDentro,
    cfopFora: emitente.cfopFora,
    icms: emitente.icms,
    aliquota: emitente.aliquota,
    reducaoDaBase: linha.icmsBaseReduction,
    reducaoNaInterestadual: linha.icmsReductionInterstate,
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
export const COM_FILA = { maxWait: 15_000, timeout: 30_000 } as const;

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
    icmsBaseReduction: linha.icmsBaseReduction,
    icmsReductionInterstate: linha.icmsReductionInterstate,
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
      contactName: dados.contato ?? null,
      contactEmail: dados.email ?? null,
      rntrc: dados.rntrc,
      taxRegime: dados.regime,
      cteSeries: dados.serie,
      environment: dados.ambiente,
      cfopInState: dados.cfopDentro,
      cfopOutState: dados.cfopFora,
      icmsCst: dados.icms,
      icmsRate: dados.aliquota,
      icmsBaseReduction: dados.reducaoDaBase ?? null,
      // Só tem sentido na situação 20: fora dela fica desligado.
      icmsReductionInterstate: dados.icms === "20" && dados.reducaoNaInterestadual,
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

export type CredencialDaEmpresa = Credencial & {
  /** Só o certificado do titular: é o que vai no `KeyInfo` da assinatura. */
  titularPem: string;
};

/**
 * A chave e o certificado em claro, para assinar e para a conexão com a SEFAZ.
 * Recusa (com a frase para a pessoa) quando não há certificado, quando ele
 * venceu ou quando o que está guardado não abre mais.
 */
export async function credencialDaEmpresa(empresa: Empresa): Promise<CredencialDaEmpresa> {
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
    svc: svcDaChave(cte.accessKey),
  };
}

/** Os CT-e mais recentes de cada carga da lista: deles saem o do selo e os que pedem providência (`ctesDaCarga`). */
export const CTE_DA_CARGA = { ctes: { select: CTE_SELECT, orderBy: { updatedAt: "desc" }, take: 8 } } as const;

/**
 * Dos CT-e de uma carga, o que a lista mostra:
 * - `emitido`: o CT-e da carga. É o autorizado que a carga aponta (`cteKey`, em
 *   produção); senão o autorizado pela SVC; senão outro autorizado; senão o mais
 *   recente.
 * - `aResolver`: os outros que pedem uma providência de quem emite. O envio
 *   normal que ficou sem resposta e foi coberto por um CT-e da SVC, e o CT-e
 *   normal que a SEFAZ de origem autorizou depois disso (o que o MOC 4.00,
 *   Visão Geral, item 11.5.3, manda cancelar "imediatamente após o retorno à
 *   operação normal").
 * `linhas` vem da mais recente para a mais antiga.
 */
export function ctesDaCarga(linhas: readonly LinhaDoCte[], cteKey: string | null): { emitido: CteEmitido | null; aResolver: CteEmitido[] } {
  const autorizados = linhas.filter((linha) => linha.status === "AUTHORIZED");
  const principal =
    autorizados.find((linha) => linha.accessKey === cteKey) ?? autorizados.find((linha) => svcDaChave(linha.accessKey) !== null) ?? autorizados[0] ?? linhas[0] ?? null;
  const aResolver = linhas.filter((linha) => linha !== principal && (linha.status === "AUTHORIZED" || (linha.status === "DRAFT" && linha.unanswered)));
  return { emitido: principal && paraATela(principal), aResolver: aResolver.map(paraATela) };
}

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
  ...REDESPACHO_SELECT,
  cteKey: true,
  cteStatus: true,
  client: {
    select: { companyName: true, tradeName: true, cnpj: true, ie: true, email: true, phone: true, address: true, receivers: { select: { name: true, document: true, address: true }, take: 500 } },
  },
  fiscalDocuments: { select: { accessKey: true, xml: true }, orderBy: { createdAt: "asc" }, take: 50 },
  manifest: { select: { status: true, vehicle: { select: { plate: true } }, driver: { select: { user: { select: { name: true } } } } } },
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
    servico: servicoDaCarga(linha),
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
export function faltasDoCertificado(certificado: CertificadoDaEmpresa | null): string[] {
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
  const preparo = prepararCte(cargaDoCte(linha), emitente, enderecos?.qrCode ?? null, municipioDoTexto, new Date(), responsavelTecnico(emitente));

  const daEmpresa = faltasDoCertificado(certificado);

  const daCarga: string[] = [];
  if (!cargaRecebeCte(linha)) daCarga.push(SO_CARGA_QUE_SAIU);
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
  const svc = emitente ? svcDaUf(emitente.endereco.uf) : null;
  return {
    pronta: emitente !== null && faltasDoCertificado(certificado).length === 0,
    pendencias,
    avisos: preparo.avisos,
    resumo: preparo.resumo && { ...preparo.resumo, numeroPrevisto },
    cte: ultimo && paraATela(ultimo),
    svc: svc && emitente ? { nome: svc, oferecida: svcCabe(await pendentesDaCarga(empresa.db, collectionId, emitente.ambiente)) } : null,
  };
}

/* ----------------------------- SVC (contingência) ------------------------------ */

const PENDENTE_SELECT = { id: true, status: true, series: true, number: true, accessKey: true, xmlSent: true, sendingAt: true, unanswered: true, numberBurned: true, statusCode: true, statusReason: true } as const;
type Pendente = Prisma.CteGetPayload<{ select: typeof PENDENTE_SELECT }>;

/** Os CT-e da carga que ainda não se resolveram (rascunho ou rejeitado), do mais novo para o mais antigo. */
async function pendentesDaCarga(db: Pick<Tx, "cte">, collectionId: string, ambiente: Ambiente): Promise<Pendente[]> {
  return db.cte.findMany({ where: { collectionId, environment: ambiente, status: { in: ["DRAFT", "REJECTED"] } }, orderBy: { createdAt: "desc" }, take: 20, select: PENDENTE_SELECT });
}

const semRespostaNormal = (linha: Pendente) => linha.status === "DRAFT" && linha.unanswered && svcDaChave(linha.accessKey) === null;

/**
 * A emissão pela SVC cabe para esta carga? Depois de uma emissão normal que não
 * se resolveu (`svcOferecida`), ou para insistir num CT-e que já foi mandado à
 * SVC (rejeitado por ela, ou sem resposta dela).
 */
function svcCabe(pendentes: readonly Pendente[]): boolean {
  return pendentes.some(
    (linha) =>
      svcDaChave(linha.accessKey) !== null ||
      svcOferecida({ situacao: linha.status as SituacaoDoCte, semResposta: linha.unanswered, cStat: linha.statusCode, motivo: linha.statusReason, svc: null }),
  );
}

/* ----------------------------------- Emissão ---------------------------------- */

/** Um envio é dado como parado depois disto: cobre a consulta e o envio, com folga. */
const ENVIO_EM_ANDAMENTO_MS = 120_000;

/** O código numérico aleatório da chave (`cCT`), 8 dígitos. */
export const sortearCodigo = () => String(randomInt(0, 100_000_000)).padStart(8, "0");

export const STATUS_DA_FALHA = (erro: SefazError) => (erro.motivo === "tempo" ? 504 : 502);

const MOTIVO_MAXIMO = 300;
export const frase = (cStat: number, motivo: string) => `${cStat} - ${motivo}`.slice(0, MOTIVO_MAXIMO);

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
async function prepararEnvio(empresa: Empresa, collectionId: string, credencial: CredencialDaEmpresa, quem: Quem, svc: Svc | null = null): Promise<Preparado> {
  return empresa.transacao(async (tx) => {
    await travarNumeracao(tx, empresa.id);
    const { linha, emitente, preparo, pendencias } = await situacaoDaCarga(tx, empresa.id, collectionId);
    if (pendencias.length > 0 || !emitente || !preparo.dados) throw new Refusal(pendencias[0] ?? SEM_EMITENTE_CADASTRADO, 409);

    const ambiente = emitente.ambiente;
    const carga = { id: linha.id, trackingCode: linha.trackingCode };
    const base = { ambiente, uf: emitente.endereco.uf, cnpj: emitente.cnpj, carga };
    const pendentes = await pendentesDaCarga(tx, collectionId, ambiente);
    const agora = new Date();
    if (pendentes.some((p) => p.sendingAt && agora.getTime() - p.sendingAt.getTime() < ENVIO_EM_ANDAMENTO_MS)) throw new Refusal(EMISSAO_EM_ANDAMENTO, 409);

    // O envio sem resposta é retomado com o MESMO XML. Na emissão normal, o mais recente; na emissão pela SVC,
    // só o que já tinha ido para a SVC: o envio NORMAL sem resposta não é reenviado a ela (é outro documento).
    const semResposta = pendentes.filter((p) => p.status === "DRAFT" && p.unanswered);
    const aRetomar = svc ? semResposta.find((p) => svcDaChave(p.accessKey) !== null) : semResposta[0];
    if (aRetomar) {
      await tx.cte.update({ where: { id: aRetomar.id }, data: { sendingAt: agora }, select: { id: true } });
      return { ...base, id: aRetomar.id, chave: aRetomar.accessKey, numero: aRetomar.number, xml: aRetomar.xmlSent, retomar: true };
    }
    // Pela SVC, a linha do envio normal sem resposta fica como está, à espera da conferência na SEFAZ de origem: o CT-e da SVC é outra linha.
    const pendente = (svc ? pendentes.find((p) => !semRespostaNormal(p)) : pendentes[0]) ?? null;

    // Rejeição não consome o número: o reenvio da mesma carga usa o mesmo, salvo quando a SEFAZ disse que ele já foi usado.
    // Trocar o tipo de emissão pede número novo: "é vedada a reutilização, em contingência, de número de CTe transmitido
    // com tipo de emissão Normal" (MOC 4.00, Visão Geral, item 11.5.3).
    let numero: number;
    if (pendente && !pendente.numberBurned && pendente.series === emitente.serie && svcDaChave(pendente.accessKey) === svc) {
      numero = pendente.number;
    } else {
      const numeracao = await tx.cteNumbering.findFirst({ where: { environment: ambiente, series: emitente.serie }, select: { id: true, nextNumber: true } });
      numero = numeracao?.nextNumber ?? 1;
      if (numeracao) await tx.cteNumbering.update({ where: { id: numeracao.id }, data: { nextNumber: numero + 1 }, select: { id: true } });
      else await tx.cteNumbering.create({ data: { environment: ambiente, series: emitente.serie, nextNumber: numero + 1 }, select: { id: true } });
    }

    const montado = montarCte({ ...preparo.dados, numero, codigo: sortearCodigo(), emissao: agora, svc });
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

/** Com quem se fala sobre o CT-e desta chave: a SVC que o recebeu (`tpEmis` 7 ou 8) ou a autorizadora da UF. */
const destinoDaChave = (uf: string, ambiente: Ambiente, credencial: CredencialDaEmpresa, chave: string): Destino => ({ uf, ambiente, credencial, svc: svcDaChave(chave) });

/** Depois de autorizar pela SVC: lembra do envio normal que ficou sem resposta, se houver. */
async function avisoDoEnvioPendente(empresa: Empresa, collectionId: string, ambiente: Ambiente): Promise<string> {
  const orfao = (await pendentesDaCarga(empresa.db, collectionId, ambiente)).find(semRespostaNormal);
  return orfao
    ? ` O envio normal anterior (CT-e nº ${orfao.number}) continua sem resposta: quando a SEFAZ de origem voltar, use "Conferir na SEFAZ" nele. Se ela o tiver autorizado, ele precisa ser cancelado.`
    : "";
}

/**
 * O que se confere antes de emitir pela SVC (MOC do CT-e 4.00, Visão Geral,
 * itens 11.2, 11.3.3 e 11.5.3), fora de transação. Devolve a SVC que atende a
 * UF do emitente, ou recusa:
 *
 * 1. Só depois de uma emissão normal que não se resolveu (`svcCabe`).
 * 2. A SVC precisa estar ATIVA para a UF: "o SVC depende de ativação da SEFAZ
 *    de origem" (item 11.2, c). O status pedido à SVC responde 113 quando está
 *    (regra M04); com 114 ou outro código, nada é emitido nem numerado.
 * 3. O envio normal que ficou sem resposta é consultado, pela chave, na SEFAZ de
 *    origem. Se ela o AUTORIZOU, ele é gravado e a emissão pela SVC é recusada:
 *    a carga já tem CT-e. Se está cancelado lá, a linha vira "rejeitado".
 *    Qualquer outra resposta, ou resposta nenhuma (é o caso esperado: a SEFAZ
 *    de origem está fora do ar, e "a consulta sobre este CT-e somente poderá
 *    ser direcionada à SEFAZ original quando esta restabelecer seu serviço",
 *    item 4.5.6), NÃO impede a SVC: o envio fica "sem resposta", para ser
 *    conferido depois (`conferirNaSefaz`), e cancelado se a SEFAZ de origem o
 *    tiver autorizado (item 11.5.3). "Não consta" (217) também o deixa como
 *    está: ele pode estar na fila da SEFAZ de origem.
 */
async function prepararSvc(empresa: Empresa, collectionId: string, credencial: CredencialDaEmpresa, quem: Quem): Promise<Svc> {
  const doEmitente = await empresa.db.fiscalIssuer.findUnique({ where: { tenantId: empresa.id }, select: { cnpj: true, state: true, environment: true } });
  if (!doEmitente) throw new Refusal(SEM_EMITENTE_CADASTRADO, 409);
  const svc = svcDaUf(doEmitente.state);
  if (!svc) throw new Refusal(`Não há SVC para a UF ${doEmitente.state}.`, 409);
  const ambiente = ambienteDaLinha(doEmitente.environment);
  const carga = await empresa.db.collection.findUnique({ where: { id: collectionId }, select: { id: true, trackingCode: true } });
  if (!carga) throw new Refusal(CARGA_NAO_ENCONTRADA, 404);
  const pendentes = await pendentesDaCarga(empresa.db, collectionId, ambiente);
  if (!svcCabe(pendentes)) throw new Refusal(SVC_NAO_OFERECIDA, 409);

  try {
    const status = await statusDoServico({ uf: doEmitente.state, ambiente, credencial, svc });
    if (!status.svcAtiva) throw new Refusal(fraseDaSvcInativa(svc, frase(status.cStat, status.motivo)), 409);
  } catch (erro) {
    if (erro instanceof SefazError) throw new Refusal(`${erro.message} Não foi possível saber se a ${svc} está ativa: nada foi emitido nem numerado.`, STATUS_DA_FALHA(erro));
    throw erro;
  }

  const orfao = pendentes.find(semRespostaNormal);
  if (!orfao) return svc;
  let consulta: Decisao;
  try {
    consulta = decidir(await consultarCte({ uf: doEmitente.state, ambiente, credencial }, orfao.accessKey), { chave: orfao.accessKey, ambiente, resumo: resumoDaAssinatura(orfao.xmlSent) });
  } catch (erro) {
    // A SEFAZ de origem não responde: é para isto que a SVC existe. O envio fica "sem resposta".
    if (erro instanceof SefazError) return svc;
    throw erro;
  }
  if (consulta.tipo === "autorizado") {
    const preparado: Preparado = { id: orfao.id, chave: orfao.accessKey, numero: orfao.number, xml: orfao.xmlSent, ambiente, uf: doEmitente.state, cnpj: doEmitente.cnpj, retomar: true, carga };
    await gravarAutorizacao(empresa, preparado, consulta.protocolo, quem);
    throw new Refusal(
      `O envio normal anterior (CT-e nº ${orfao.number}) tinha sido autorizado pela SEFAZ (protocolo ${consulta.protocolo.numero}) e agora está gravado: a carga já tem CT-e. Nada foi emitido pela ${svc}.`,
      409,
    );
  }
  if (consulta.tipo === "finalizado") {
    await gravarSemAutorizacao(empresa, orfao.id, { status: "REJECTED", statusCode: consulta.cStat, statusReason: consulta.motivo, unanswered: false, numberBurned: true });
  }
  return svc;
}

/** Quando há endereço de integração, põe o evento na fila, na mesma transação da mudança. */
async function avisarIntegracao(tx: Tx, tipo: "cte.autorizado" | "cte.cancelado", cteId: string): Promise<void> {
  const webhook = await tx.webhook.findFirst({ select: { id: true } });
  if (!webhook) return;
  await tx.outboxEvent.create({ data: { type: tipo, payload: { cteId } }, select: { id: true } });
}

/** A frase que fica no CT-e normal que a SEFAZ de origem autorizou depois de a carga já ter o CT-e da SVC. */
const fraseDoSubstituido = (numeroDoOutro: number) =>
  `Autorizado pela SEFAZ de origem, mas a carga já tem o CT-e nº ${numeroDoOutro}: este precisa ser CANCELADO (MOC 4.00, Visão Geral, item 11.5.3).`;

/**
 * Grava a autorização: só chega aqui com o protocolo que a SEFAZ devolveu.
 *
 * `substituidoPor`: a carga já tem outro CT-e autorizado (o da SVC), e este é o
 * envio normal que tinha ficado sem resposta e que a SEFAZ de origem acabou
 * autorizando. Ele é gravado como autorizado (é o que ele é na SEFAZ), mas NÃO
 * vira o CT-e da carga: fica com a frase que manda cancelar.
 */
async function gravarAutorizacao(empresa: Empresa, preparado: Preparado, protocolo: Protocolo & { numero: string }, quem: Quem, substituidoPor: number | null = null): Promise<LinhaDoCte> {
  return empresa.transacao(async (tx) => {
    const gravado = await tx.cte.update({
      where: { id: preparado.id },
      data: {
        status: "AUTHORIZED",
        protocol: protocolo.numero,
        xmlReturn: montarProcCte(preparado.xml, protocolo.xml),
        statusCode: protocolo.cStat,
        statusReason: (substituidoPor === null ? protocolo.motivo : fraseDoSubstituido(substituidoPor)).slice(0, MOTIVO_MAXIMO),
        authorizedAt: protocolo.recebidoEm ?? new Date(),
        sendingAt: null,
        unanswered: false,
      },
      select: CTE_SELECT,
    });
    // Só o CT-e de produção tem valor fiscal: é ele que passa a ser o CT-e da carga.
    if (preparado.ambiente === PRODUCAO && substituidoPor === null) {
      await tx.collection.update({ where: { id: preparado.carga.id }, data: { cteKey: preparado.chave, cteNumber: preparado.numero, cteStatus: "ISSUED" }, select: { id: true } });
    }
    const emHomologacao = preparado.ambiente === PRODUCAO ? "" : " em homologação (sem valor fiscal)";
    const pelaSvc = svcDaChave(preparado.chave);
    await registrarAuditoria(tx, {
      ...quem,
      acao: "cte.emitir",
      entidade: "cte",
      entidadeId: preparado.id,
      resumo: `CT-e nº ${preparado.numero} autorizado${pelaSvc ? ` pela ${pelaSvc}` : ""}${emHomologacao} para a carga ${preparado.carga.trackingCode ?? ""}${substituidoPor === null ? "" : ` (a cancelar: a carga já tem o CT-e nº ${substituidoPor})`}`,
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
export async function emitirCte(empresa: Empresa, collectionId: string, quem: Quem, opcoes: { svc?: { justificativa: string } | null } = {}): Promise<ResultadoDaEmissao> {
  const credencial = await credencialDaEmpresa(empresa);
  const svc = opcoes.svc ? await prepararSvc(empresa, collectionId, credencial, quem) : null;
  const preparado = await prepararEnvio(empresa, collectionId, credencial, quem, svc);
  // Com quem se fala sai da chave do documento que vai ser enviado: a retomada de um CT-e da SVC volta à SVC.
  const destino = destinoDaChave(preparado.uf, preparado.ambiente, credencial, preparado.chave);
  const esperado: Esperado = { chave: preparado.chave, ambiente: preparado.ambiente, resumo: resumoDaAssinatura(preparado.xml) };
  if (svc && opcoes.svc && !preparado.retomar) {
    // A justificativa não vai no XML (regra G008 do Anexo I): fica aqui, com quem pediu a contingência e quando.
    await registrarAuditoriaDepois(empresa.db, {
      ...quem,
      acao: "cte.contingencia",
      entidade: "cte",
      entidadeId: preparado.id,
      resumo: `CT-e nº ${preparado.numero} da carga ${preparado.carga.trackingCode ?? ""} enviado à ${svc} (contingência)`,
      depois: { number: preparado.numero, accessKey: preparado.chave, environment: preparado.ambiente, svc, justificativa: opcoes.svc.justificativa, collectionId: preparado.carga.id },
    });
  }

  let decisao: Decisao;
  try {
    let jaEstaLa: Decisao | null = null;
    if (preparado.retomar) {
      const consulta = decidir(await consultarCte(destino, preparado.chave), esperado);
      // Autorizado, ou já cancelado lá (101): a consulta esclareceu, e nada é reenviado.
      if (consulta.tipo === "autorizado" || consulta.tipo === "finalizado") jaEstaLa = consulta;
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
      decisao =
        consulta.tipo === "autorizado" || consulta.tipo === "finalizado" ? consulta : { tipo: "incoerente", motivo: `${frase(decisao.cStat, decisao.motivo)} A consulta pela chave não devolveu o protocolo.` };
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
    const pelaSvc = destino.svc ? ` pela ${destino.svc}` : "";
    const pendente = destino.svc ? await avisoDoEnvioPendente(empresa, collectionId, preparado.ambiente) : "";
    return resultado(cte, true, `CT-e nº ${preparado.numero} autorizado${pelaSvc}${onde}. Protocolo ${decisao.protocolo.numero}.${pendente}`);
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

  if (decisao.tipo === "finalizado") {
    // A SEFAZ tem o CT-e desta chave, mas já cancelado lá (101 na consulta, 218 na recepção): só acontece quando o envio
    // ficou sem resposta e o documento foi cancelado fora deste sistema. NÃO é gravado como autorizado. O número foi usado.
    const cte = await gravarSemAutorizacao(empresa, preparado.id, { status: "REJECTED", statusCode: decisao.cStat, statusReason: decisao.motivo, unanswered: false, numberBurned: true });
    await registrarAuditoriaDepois(empresa.db, {
      ...quem,
      acao: "cte.rejeitar",
      entidade: "cte",
      entidadeId: preparado.id,
      resumo: `CT-e nº ${preparado.numero} da carga ${preparado.carga.trackingCode ?? ""} já está ${decisao.situacao} na SEFAZ: ${frase(decisao.cStat, decisao.motivo)}`,
      depois: { number: preparado.numero, environment: preparado.ambiente, statusCode: decisao.cStat, collectionId: preparado.carga.id },
    });
    return resultado(
      cte,
      false,
      `A SEFAZ informa que o CT-e nº ${preparado.numero} já está ${decisao.situacao} lá (${frase(decisao.cStat, decisao.motivo)}): ele não foi gravado como autorizado. O número foi usado: a próxima emissão usa o seguinte.`,
    );
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
  // O que a SEFAZ recusaria (MOC 4.00, Visão Geral, item 6.2.1): carta de correção associada (regra O14, 523) e comprovante de entrega em vigor (regra Q16, 862).
  const impedem = await empresa.db.cteEvent.findMany({
    where: { cteId, OR: [{ type: TIPO_DO_EVENTO_DO_CTE.CARTA_DE_CORRECAO }, { type: TIPO_DO_EVENTO_DO_CTE.COMPROVANTE_DE_ENTREGA, cancelledAt: null }] },
    select: { type: true },
    take: 50,
  });
  if (impedem.some((evento) => evento.type === TIPO_DO_EVENTO_DO_CTE.COMPROVANTE_DE_ENTREGA)) throw new Refusal(CANCELAMENTO_COM_ENTREGA, 409);
  if (impedem.length > 0) throw new Refusal(CANCELAMENTO_COM_CARTA, 409);

  const doEmitente = await empresa.db.fiscalIssuer.findUnique({ where: { tenantId: empresa.id }, select: { cnpj: true, state: true } });
  if (!doEmitente) throw new Refusal(SEM_EMITENTE_CADASTRADO, 409);
  const credencial = await credencialDaEmpresa(empresa);
  const ambiente = ambienteDaLinha(cte.environment);
  // O CT-e autorizado pela SVC é cancelado NA SVC: "os pedidos de cancelamento na modalidade SVC somente poderão afetar
  // documentos autorizados em contingência pela correspondente SVC" (MOC 4.00, Visão Geral, item 6.2.1), e ela recebe evento
  // mesmo desativada (regra C09, observação).
  const destino = destinoDaChave(doEmitente.state, ambiente, credencial, cte.accessKey);

  const evento = montarCancelamento({ chave: cte.accessKey, cnpj: doEmitente.cnpj, ambiente, protocolo: cte.protocol, justificativa, quando: new Date() });
  const assinado = assinarXml(evento.xml, ALVO_DO_EVENTO, { chavePem: credencial.chavePem, certificadoPem: credencial.titularPem });

  let protocolo: string | null;
  let quando: Date;
  let retorno: string;
  let resposta: RespostaDoEvento;
  try {
    resposta = await enviarEvento(destino, assinado);
    if (eventoRegistrado(resposta, { chave: cte.accessKey, tipo: TIPO_DO_CANCELAMENTO })) {
      protocolo = resposta.protocolo;
      quando = resposta.registradoEm ?? new Date();
      retorno = resposta.xml;
    } else if (resposta.cStat === CSTAT.JA_CANCELADO && (await consultarCte(destino, cte.accessKey)).cStat === CSTAT.CANCELADO) {
      // Um pedido anterior chegou lá e a resposta se perdeu: o CT-e está cancelado na SEFAZ.
      protocolo = null;
      quando = new Date();
      retorno = resposta.xml;
    } else if (eventoGuardadoComRessalva(resposta, { chave: cte.accessKey, tipo: TIPO_DO_CANCELAMENTO })) {
      // 134 ou 136 (MOC 4.00, Visão Geral, item 5.1.7): a SEFAZ guardou o evento, com ressalva. Só vale como cancelamento se a consulta disser que o CT-e está cancelado.
      if ((await consultarCte(destino, cte.accessKey)).cStat !== CSTAT.CANCELADO) throw new Refusal(fraseDoEventoComRessalva("o cancelamento", resposta), 409);
      protocolo = resposta.protocolo;
      quando = resposta.registradoEm ?? new Date();
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
    // O evento registrado também vai para a tabela dos eventos do CT-e, como os outros (as colunas `cancel*` continuam valendo).
    const jaTem = await tx.cteEvent.findFirst({ where: { cteId: cte.id, type: TIPO_DO_CANCELAMENTO, sequence: 1 }, select: { id: true } });
    if (!jaTem) {
      await tx.cteEvent.create({
        data: {
          cteId: cte.id,
          type: TIPO_DO_CANCELAMENTO,
          sequence: 1,
          xmlSent: assinado,
          xmlReturn: retorno ? montarProcEventoCte(assinado, retorno) : "",
          protocol: protocolo,
          statusCode: resposta.cStat,
          statusReason: resposta.motivo.slice(0, MOTIVO_MAXIMO),
          registeredAt: quando,
          details: { descricao: `Cancelado: ${justificativa}`.slice(0, 200) },
          createdById: quem.ator.id,
        },
        select: { id: true },
      });
    }
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

/* ------------------------------- Eventos do CT-e ------------------------------- */

const EVENTO_SELECT = { id: true, type: true, sequence: true, protocol: true, registeredAt: true, details: true, cancelledAt: true } as const;
type LinhaDoEvento = Prisma.CteEventGetPayload<{ select: typeof EVENTO_SELECT }>;
type Detalhes = { descricao?: unknown; deFora?: unknown; recebedor?: unknown; entregueEm?: unknown } | null;

function eventoParaATela(evento: LinhaDoEvento): EventoDoCte {
  const detalhes = evento.details as Detalhes;
  return {
    id: evento.id,
    tipo: evento.type,
    sequencia: evento.sequence,
    protocolo: evento.protocol,
    registradoEm: evento.registeredAt.toISOString(),
    descricao: typeof detalhes?.descricao === "string" ? detalhes.descricao : (ROTULO_DO_EVENTO_DO_CTE[evento.type] ?? evento.type),
    canceladoEm: evento.cancelledAt?.toISOString() ?? null,
    deFora: detalhes?.deFora === true,
  };
}

const ALVO_SELECT = {
  ...CTE_SELECT,
  collectionId: true,
  issuedAt: true,
  xmlSent: true,
  cancelProtocol: true,
  cancelReason: true,
  collection: { select: { trackingCode: true } },
} as const;
type Alvo = Prisma.CteGetPayload<{ select: typeof ALVO_SELECT }>;

type LeituraDeEventos = Pick<Tx, "cte" | "cteEvent" | "proofOfDelivery">;

/** A imagem do comprovante que entra no `hashEntrega`, em Base64, e o nome dela para a tela. */
type ImagemDaEntrega = { base64: string; nome: string };

const IMAGEM_DO_TIPO: Record<string, string> = { CANHOTO: "foto do canhoto", ENTREGA: "foto da entrega" };

/** O texto Base64 de uma imagem guardada como data URL (ou já só em Base64, nos comprovantes antigos). */
const base64DaImagem = (valor: string) => {
  const dataUrl = comoDataUrl(valor);
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
};

type ComprovanteAceito = { id: string; nome: string; documento: string; entregueEm: Date; latitude: number | null; longitude: number | null; imagem: ImagemDaEntrega | null };

/**
 * O comprovante de entrega APROVADO da carga, com a imagem que prova a entrega.
 * A ordem de escolha da imagem: a foto do canhoto assinado (a mais antiga das
 * que valem hoje), a foto da entrega, a foto do comprovante antigo e, por
 * último, a assinatura colhida na tela. Foto de avaria e de fachada não servem.
 * A hora da entrega é a da baixa do motorista (quando o comprovante foi criado).
 */
async function comprovanteAceito(db: LeituraDeEventos, collectionId: string): Promise<ComprovanteAceito | null> {
  const comprovante = await db.proofOfDelivery.findFirst({
    where: { collectionId, status: "APPROVED" },
    select: {
      id: true,
      receiverName: true,
      receiverDoc: true,
      latitude: true,
      longitude: true,
      createdAt: true,
      photoBase64: true,
      signatureBase64: true,
      photos: { where: { replacedAt: null, kind: { in: ["CANHOTO", "ENTREGA"] } }, select: { kind: true, dataUrl: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 10 },
    },
  });
  if (!comprovante) return null;
  const foto = comprovante.photos.find((f) => f.kind === "CANHOTO") ?? comprovante.photos.find((f) => f.kind === "ENTREGA");
  const imagem: ImagemDaEntrega | null = foto
    ? { base64: base64DaImagem(foto.dataUrl), nome: IMAGEM_DO_TIPO[foto.kind] }
    : comprovante.photoBase64
      ? { base64: base64DaImagem(comprovante.photoBase64), nome: IMAGEM_DO_TIPO.ENTREGA }
      : comprovante.signatureBase64
        ? { base64: base64DaImagem(comprovante.signatureBase64), nome: "assinatura" }
        : null;
  return {
    id: comprovante.id,
    nome: textoDoXml(comprovante.receiverName, 60),
    documento: textoDoXml(comprovante.receiverDoc, 20),
    entregueEm: comprovante.createdAt,
    latitude: comprovante.latitude,
    longitude: comprovante.longitude,
    imagem: imagem && imagem.base64 !== "" ? imagem : null,
  };
}

/** O comprovante de entrega em vigor na SEFAZ (registrado e não cancelado), se houver. */
const entregaEmVigor = (eventos: readonly LinhaDoEvento[]) => eventos.filter((evento) => evento.type === TIPO_DO_EVENTO_DO_CTE.COMPROVANTE_DE_ENTREGA && evento.cancelledAt === null).at(-1) ?? null;

/** O que impede o registro da entrega deste CT-e, ou `null` quando dá para registrar. */
function impedimentoDaEntrega(cte: Pick<Alvo, "status" | "protocol" | "accessKey" | "issuedAt">, comprovante: ComprovanteAceito | null): string | null {
  if (cte.status !== "AUTHORIZED" || !cte.protocol) return SO_AUTORIZADO_RECEBE_EVENTO;
  if (!comprovante) return SEM_COMPROVANTE_ACEITO;
  if (!comprovante.imagem) return SEM_IMAGEM_NO_COMPROVANTE;
  if (comprovante.nome.length < 2 || comprovante.documento.length < 2) return RECEBEDOR_INCOMPLETO;
  // Regra O06 (rejeição 872): a entrega não pode ser anterior à emissão do CT-e.
  if (comprovante.entregueEm.getTime() < cte.issuedAt.getTime()) return ENTREGA_ANTES_DA_EMISSAO;
  return null;
}

const ENTREGA_ANTES_DA_EMISSAO = "A entrega foi registrada antes da emissão deste CT-e: a SEFAZ rejeita o comprovante (872).";

async function lerEventos(db: LeituraDeEventos, cte: Alvo): Promise<{ linhas: LinhaDoEvento[]; eventos: EventoDoCte[] }> {
  const linhas = await db.cteEvent.findMany({ where: { cteId: cte.id }, select: EVENTO_SELECT, orderBy: [{ registeredAt: "asc" }, { createdAt: "asc" }], take: 500 });
  const eventos = linhas.map(eventoParaATela);
  // O cancelamento anterior à tabela de eventos só existe nas colunas do CT-e: aparece na lista do mesmo jeito.
  if (cte.cancelledAt && !linhas.some((linha) => linha.type === TIPO_DO_CANCELAMENTO)) {
    eventos.push({
      id: `cancelamento-${cte.id}`,
      tipo: TIPO_DO_CANCELAMENTO,
      sequencia: 1,
      protocolo: cte.cancelProtocol,
      registradoEm: cte.cancelledAt.toISOString(),
      descricao: `Cancelado${cte.cancelReason ? `: ${cte.cancelReason}` : ""}`.slice(0, 200),
      canceladoEm: null,
      deFora: false,
    });
  }
  return { linhas, eventos };
}

/** Os eventos registrados de um CT-e e a situação do comprovante de entrega dele: é o que os painéis "Corrigir" e "Entrega" mostram. */
export async function eventosDoCte(empresa: Empresa, cteId: string): Promise<EventosDoCte> {
  const cte = await empresa.db.cte.findUnique({ where: { id: cteId }, select: ALVO_SELECT });
  if (!cte) throw new Refusal(CTE_NAO_ENCONTRADO, 404);
  const { linhas, eventos } = await lerEventos(empresa.db, cte);
  const emVigor = entregaEmVigor(linhas);
  const comprovante = await comprovanteAceito(empresa.db, cte.collectionId);
  const doComprovante = { recebedor: comprovante?.nome || null, entregueEm: comprovante?.entregueEm.toISOString() ?? null, imagem: comprovante?.imagem?.nome ?? null };
  let entrega: EntregaDoCte;
  if (emVigor) {
    const detalhes = emVigor.details as Detalhes;
    entrega = {
      situacao: "REGISTRADA",
      motivo: null,
      recebedor: typeof detalhes?.recebedor === "string" ? detalhes.recebedor : doComprovante.recebedor,
      entregueEm: typeof detalhes?.entregueEm === "string" ? detalhes.entregueEm : doComprovante.entregueEm,
      imagem: doComprovante.imagem,
      protocolo: emVigor.protocol,
    };
  } else {
    const motivo = impedimentoDaEntrega(cte, comprovante);
    entrega = { situacao: motivo ? "INDISPONIVEL" : "DISPONIVEL", motivo, ...doComprovante, protocolo: null };
  }
  return { cte: paraATela(cte), eventos, entrega };
}

type EnvioDeEvento = { alvo: Alvo; ambiente: Ambiente; cnpj: string; destino: Destino; credencial: CredencialDaEmpresa; protocolo: string };

/**
 * Lê o CT-e e o que é preciso para assinar e enviar um evento dele (carta de
 * correção, comprovante de entrega e o cancelamento do comprovante). Só o
 * CT-e autorizado.
 *
 * O destino é SEMPRE a autorizadora normal da UF do emitente, também quando a
 * chave é de CT-e autorizado pela SVC (`tpEmis` 7 ou 8): a SVC rejeita estes
 * eventos (regra N09, rejeição 530) e o local deles é a SEFAZ autorizadora
 * (ver `SVC_AINDA_NAO_SINCRONIZADA`, em src/lib/cte.ts). O cancelamento do
 * CT-e é que vai à SVC que o autorizou (`cancelarCte`): "os pedidos de
 * cancelamento na modalidade SVC somente poderão afetar documentos autorizados
 * em contingência pela correspondente SVC" (MOC 4.00, Visão Geral, item 6.2).
 */
async function prepararEvento(empresa: Empresa, cteId: string): Promise<EnvioDeEvento> {
  const alvo = await empresa.db.cte.findUnique({ where: { id: cteId }, select: ALVO_SELECT });
  if (!alvo) throw new Refusal(CTE_NAO_ENCONTRADO, 404);
  if (alvo.status !== "AUTHORIZED" || !alvo.protocol) throw new Refusal(SO_AUTORIZADO_RECEBE_EVENTO, 409);
  const doEmitente = await empresa.db.fiscalIssuer.findUnique({ where: { tenantId: empresa.id }, select: { cnpj: true, state: true } });
  if (!doEmitente) throw new Refusal(SEM_EMITENTE_CADASTRADO, 409);
  const credencial = await credencialDaEmpresa(empresa);
  const ambiente = ambienteDaLinha(alvo.environment);
  return { alvo, ambiente, cnpj: doEmitente.cnpj, destino: { uf: doEmitente.state, ambiente, credencial }, credencial, protocolo: alvo.protocol };
}

/** A próxima sequência (`nSeqEvento`) de um tipo de evento para o CT-e: conta também os eventos que vieram pela consulta. */
async function proximaSequencia(empresa: Empresa, cteId: string, tipo: string): Promise<number> {
  const ultimo = await empresa.db.cteEvent.findFirst({ where: { cteId, type: tipo }, orderBy: { sequence: "desc" }, select: { sequence: true } });
  return (ultimo?.sequence ?? 0) + 1;
}

type Registro = { protocolo: string | null; quando: Date; cStat: number; motivo: string; xmlEnviado: string; xmlDoRetorno: string };

/** Rejeição 631 (MOC 4.00, Visão Geral, item 5.1.5, regra N16): já há um evento deste tipo com esta sequência. */
const CSTAT_DUPLICIDADE_DE_EVENTO = 631;

/**
 * Assina e envia um evento que NÃO muda a situação do CT-e (carta de correção,
 * comprovante de entrega, cancelamento do comprovante). É o desenho do MDF-e
 * (`enviarERegistrar`, em src/lib/mdfe-db.ts):
 *
 * - 135, com protocolo, para a chave e o tipo enviados: registrado.
 * - 134 (MOC 4.00, Visão Geral, item 5.1.7): o evento ficou VINCULADO ao CT-e,
 *   com alerta sobre a situação do documento. Vale como registro.
 * - 136: guardado SEM vínculo (o CT-e não existe lá). Não vale: `Refusal` 409
 *   dizendo que o evento ficou guardado na SEFAZ.
 * - 217 para CT-e autorizado pela SVC: a SEFAZ de origem ainda não o tem
 *   (`SVC_AINDA_NAO_SINCRONIZADA`). `Refusal` 409, nada gravado.
 * - 631: a SEFAZ já tem um evento deste tipo com esta sequência (uma resposta
 *   anterior se perdeu, ou ele foi registrado por fora). O sistema NÃO presume
 *   que é o mesmo conteúdo: manda conferir na SEFAZ, que traz o evento.
 * - Qualquer outra resposta é recusa: `Refusal` 409 com o motivo da SEFAZ.
 * - Sem resposta: nada é gravado, e a frase manda conferir antes de repetir.
 */
async function enviarERegistrar(envio: EnvioDeEvento, evento: EventoMontado, oQue: string): Promise<Registro> {
  const assinado = assinarXml(evento.xml, ALVO_DO_EVENTO, { chavePem: envio.credencial.chavePem, certificadoPem: envio.credencial.titularPem });
  try {
    const resposta = await enviarEvento(envio.destino, assinado);
    const esperado = { chave: envio.alvo.accessKey, tipo: evento.tipo };
    const vinculado = eventoRegistrado(resposta, esperado) || (eventoGuardadoComRessalva(resposta, esperado) && resposta.cStat === CSTAT.EVENTO_REGISTRADO_COM_ALERTA);
    if (vinculado) return { protocolo: resposta.protocolo, quando: resposta.registradoEm ?? new Date(), cStat: resposta.cStat, motivo: resposta.motivo.slice(0, MOTIVO_MAXIMO), xmlEnviado: assinado, xmlDoRetorno: resposta.xml };
    if (eventoGuardadoComRessalva(resposta, esperado)) throw new Refusal(fraseDoEventoComRessalva(oQue, resposta), 409);
    // CT-e da SVC que a SEFAZ de origem ainda não tem (regra N20, rejeição 217): nada é gravado, a sequência não é consumida.
    if (resposta.cStat === CSTAT.NAO_CONSTA && svcDaChave(envio.alvo.accessKey)) throw new Refusal(SVC_AINDA_NAO_SINCRONIZADA, 409);
    if (resposta.cStat === CSTAT_DUPLICIDADE_DE_EVENTO) {
      throw new Refusal(`A SEFAZ já tem um evento deste tipo com a sequência ${evento.sequencia} para este CT-e (${frase(resposta.cStat, resposta.motivo)}). Use "Conferir na SEFAZ" para trazer os eventos registrados e tente de novo.`, 409);
    }
    throw new Refusal(`A SEFAZ recusou ${oQue}: ${frase(resposta.cStat, resposta.motivo)}.`, 409);
  } catch (erro) {
    if (erro instanceof SefazError) {
      const proximo = erro.incerto ? ' Antes de tentar de novo, use "Conferir na SEFAZ": o evento pode ter sido registrado.' : " Nada foi registrado: tente de novo.";
      throw new Refusal(`${erro.message}${proximo}`, STATUS_DA_FALHA(erro));
    }
    throw erro;
  }
}

/** A linha do evento registrado: o procEventoCTe (evento assinado + retorno) e o protocolo. */
const linhaDoEvento = (cteId: string, evento: EventoMontado, registro: Registro, detalhes: Prisma.InputJsonObject, autor: string | null) => ({
  cteId,
  type: evento.tipo,
  sequence: evento.sequencia,
  xmlSent: registro.xmlEnviado,
  xmlReturn: registro.xmlDoRetorno ? montarProcEventoCte(registro.xmlEnviado, registro.xmlDoRetorno) : "",
  protocol: registro.protocolo,
  statusCode: registro.cStat,
  statusReason: registro.motivo,
  registeredAt: registro.quando,
  details: detalhes,
  createdById: autor,
});

const doCte = (alvo: Alvo) => `CT-e nº ${alvo.number} da carga ${alvo.collection.trackingCode ?? ""}`;

/**
 * Carta de correção eletrônica (evento 110110; MOC 4.00, Visão Geral, item 6.4).
 * As correções já chegam sem os campos proibidos (`cartaDeCorrecaoSchema`). A
 * sequência é a próxima deste CT-e, até 20 (regra O01). Só fica registrada com
 * o retorno da SEFAZ.
 */
export async function corrigirCte(empresa: Empresa, cteId: string, correcoes: readonly CorrecaoDaCarta[], quem: Quem): Promise<EventosDoCte> {
  const envio = await prepararEvento(empresa, cteId);
  const { alvo } = envio;
  const sequencia = await proximaSequencia(empresa, cteId, TIPO_DO_EVENTO_DO_CTE.CARTA_DE_CORRECAO);
  if (sequencia > MAXIMO_DE_CARTAS) throw new Refusal(LIMITE_DE_CARTAS, 409);

  const evento = montarCartaDeCorrecao({ chave: alvo.accessKey, cnpj: envio.cnpj, ambiente: envio.ambiente, quando: new Date(), sequencia, correcoes });
  const registro = await enviarERegistrar(envio, evento, "a carta de correção");
  const resumo = resumoDaCarta(correcoes);

  await empresa.transacao(async (tx) => {
    await tx.cteEvent.create({ data: linhaDoEvento(alvo.id, evento, registro, { descricao: resumo, correcoes: correcoes.map((c) => ({ grupo: c.grupo, campo: c.campo, valor: c.valor, item: c.item ?? null })) }, quem.ator.id), select: { id: true } });
    await registrarAuditoria(tx, {
      ...quem,
      acao: "cte.corrigir",
      entidade: "cte",
      entidadeId: alvo.id,
      resumo: `Carta de correção nº ${sequencia} registrada para o ${doCte(alvo)}`,
      depois: { sequence: sequencia, protocol: registro.protocolo, correcoes: resumo },
    });
  });
  return eventosDoCte(empresa, cteId);
}

const DIA_E_HORA = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

/**
 * Registra na SEFAZ o comprovante de entrega do CT-e (evento 110180; MOC 4.00,
 * Visão Geral, item 6.8), com o que o comprovante APROVADO da carga tem: quem
 * recebeu, quando, a posição (se houver) e o hash da imagem. É ação de quem tem
 * a capacidade `fiscal`: nada aqui é enviado sozinho.
 *
 * Um comprovante por CT-e (regra O08, rejeição 870): com um em vigor, o pedido
 * é recusado antes de ir à SEFAZ.
 *
 * Na auditoria vai o nome de quem recebeu; documento, posição, imagem e hash
 * não (como no resto do módulo de comprovantes).
 */
export async function registrarEntrega(empresa: Empresa, cteId: string, quem: Quem): Promise<EventosDoCte> {
  const envio = await prepararEvento(empresa, cteId);
  const { alvo } = envio;
  const { linhas } = await lerEventos(empresa.db, alvo);
  if (entregaEmVigor(linhas)) throw new Refusal(ENTREGA_JA_REGISTRADA, 409);
  const comprovante = await comprovanteAceito(empresa.db, alvo.collectionId);
  const impedimento = impedimentoDaEntrega(alvo, comprovante);
  if (impedimento || !comprovante?.imagem) throw new Refusal(impedimento ?? SEM_IMAGEM_NO_COMPROVANTE, 409);
  const sequencia = await proximaSequencia(empresa, cteId, TIPO_DO_EVENTO_DO_CTE.COMPROVANTE_DE_ENTREGA);
  if (sequencia > MAXIMO_DE_COMPROVANTES) throw new Refusal(`Este CT-e já tem ${MAXIMO_DE_COMPROVANTES} eventos de comprovante de entrega, o máximo que a SEFAZ aceita.`, 409);

  const agora = new Date();
  const evento = montarComprovanteDeEntrega({
    chave: alvo.accessKey,
    cnpj: envio.cnpj,
    ambiente: envio.ambiente,
    quando: agora,
    sequencia,
    protocolo: envio.protocolo,
    entregueEm: comprovante.entregueEm,
    documento: comprovante.documento,
    nome: comprovante.nome,
    latitude: comprovante.latitude,
    longitude: comprovante.longitude,
    hash: hashDaEntrega(alvo.accessKey, comprovante.imagem.base64),
    hashEm: agora,
    chavesDeNfe: chavesDeNfeDaEntrega(alvo.xmlSent),
  });
  const registro = await enviarERegistrar(envio, evento, "o comprovante de entrega");
  const descricao = `Entregue a ${comprovante.nome} em ${DIA_E_HORA.format(comprovante.entregueEm)} (${comprovante.imagem.nome})`;

  await empresa.transacao(async (tx) => {
    await tx.cteEvent.create({
      data: linhaDoEvento(alvo.id, evento, registro, { descricao, recebedor: comprovante.nome, entregueEm: comprovante.entregueEm.toISOString(), proofId: comprovante.id }, quem.ator.id),
      select: { id: true },
    });
    await registrarAuditoria(tx, {
      ...quem,
      acao: "cte.entrega",
      entidade: "cte",
      entidadeId: alvo.id,
      resumo: `Comprovante de entrega registrado na SEFAZ para o ${doCte(alvo)}`,
      depois: { sequence: sequencia, protocol: registro.protocolo, recebedor: comprovante.nome },
    });
  });
  return eventosDoCte(empresa, cteId);
}

/**
 * Cancela o comprovante de entrega em vigor (evento 110181; MOC 4.00, Visão
 * Geral, item 6.9), informando o protocolo do CT-e e o do evento de entrega
 * (`nProtCE`). O comprovante só fica cancelado com o retorno da SEFAZ.
 */
export async function cancelarEntrega(empresa: Empresa, cteId: string, quem: Quem): Promise<EventosDoCte> {
  const envio = await prepararEvento(empresa, cteId);
  const { alvo } = envio;
  const { linhas } = await lerEventos(empresa.db, alvo);
  const emVigor = entregaEmVigor(linhas);
  if (!emVigor?.protocol) throw new Refusal(SEM_ENTREGA_REGISTRADA, 409);
  const sequencia = await proximaSequencia(empresa, cteId, TIPO_DO_EVENTO_DO_CTE.CANCELAMENTO_DO_COMPROVANTE);
  if (sequencia > MAXIMO_DE_COMPROVANTES) throw new Refusal(`Este CT-e já tem ${MAXIMO_DE_COMPROVANTES} cancelamentos de comprovante de entrega, o máximo que a SEFAZ aceita.`, 409);

  const evento = montarCancelamentoDoComprovante({ chave: alvo.accessKey, cnpj: envio.cnpj, ambiente: envio.ambiente, quando: new Date(), sequencia, protocolo: envio.protocolo, protocoloDoComprovante: emVigor.protocol });
  const registro = await enviarERegistrar(envio, evento, "o cancelamento do comprovante de entrega");

  await empresa.transacao(async (tx) => {
    await tx.cteEvent.create({ data: linhaDoEvento(alvo.id, evento, registro, { descricao: `Cancelado o comprovante de entrega de protocolo ${emVigor.protocol}` }, quem.ator.id), select: { id: true } });
    await tx.cteEvent.update({ where: { id: emVigor.id }, data: { cancelledAt: registro.quando }, select: { id: true } });
    await registrarAuditoria(tx, {
      ...quem,
      acao: "cte.entrega.cancelar",
      entidade: "cte",
      entidadeId: alvo.id,
      resumo: `Comprovante de entrega do ${doCte(alvo)} cancelado na SEFAZ`,
      depois: { sequence: sequencia, protocol: registro.protocolo, protocoloDoComprovante: emVigor.protocol },
    });
  });
  return eventosDoCte(empresa, cteId);
}

/* ----------------------------- Conferir na SEFAZ ------------------------------ */

/**
 * Grava os eventos que a consulta devolveu e o sistema não tinha (pelo tipo e
 * pela sequência): entram com `xmlSent` vazio, o `procEventoCTe` em
 * `xmlReturn` e a marca de que vieram de fora. O cancelamento de comprovante
 * (110181) que veio assim marca como cancelado o comprovante que ele cita.
 */
async function gravarEventosDaConsulta(tx: Tx, cteId: string, eventos: readonly EventoDaConsulta[]): Promise<number> {
  let novos = 0;
  for (const evento of eventos) {
    const existe = await tx.cteEvent.findFirst({ where: { cteId, type: evento.tipo, sequence: evento.sequencia }, select: { id: true } });
    if (!existe) {
      const rotulo = ROTULO_DO_EVENTO_DO_CTE[evento.tipo] ?? evento.descricao ?? `Evento ${evento.tipo}`;
      await tx.cteEvent.create({
        data: {
          cteId,
          type: evento.tipo,
          sequence: evento.sequencia,
          xmlSent: "",
          xmlReturn: evento.xml,
          protocol: evento.protocolo,
          statusCode: evento.cStat,
          statusReason: evento.motivo.slice(0, MOTIVO_MAXIMO),
          registeredAt: evento.registradoEm ?? new Date(),
          details: { descricao: `${rotulo} (registrado fora deste sistema)`, deFora: true },
          createdById: null,
        },
        select: { id: true },
      });
      novos += 1;
    }
    if (evento.tipo === TIPO_DO_EVENTO_DO_CTE.CANCELAMENTO_DO_COMPROVANTE && evento.protocoloCancelado) {
      await tx.cteEvent.updateMany({
        where: { cteId, type: TIPO_DO_EVENTO_DO_CTE.COMPROVANTE_DE_ENTREGA, protocol: evento.protocoloCancelado, cancelledAt: null },
        data: { cancelledAt: evento.registradoEm ?? new Date() },
      });
    }
  }
  return novos;
}

const CANCELADO_POR_FORA = "Cancelado fora deste sistema (situação lida na consulta à SEFAZ)";

/**
 * "Conferir na SEFAZ": consulta a situação do CT-e pela chave e atualiza o que
 * este sistema tem (MOC 4.00, Visão Geral, item 4.5). QUEM DECIDE É O `cStat`
 * DO TOPO da resposta (item 4.5.6): 100 = autorizado, 101 = cancelado. A
 * denegação (110) não existe mais no CT-e 4.00 ("Eliminação da Denegação",
 * histórico de alterações do manual): não é tratada.
 *
 * - CT-e autorizado aqui e cancelado lá (101): passa a cancelado, com o
 *   protocolo do evento de cancelamento que a consulta trouxer.
 * - CT-e que ficou "sem resposta": se a SEFAZ o autorizou, é gravado com o
 *   protocolo. Quando a carga já tem outro CT-e autorizado (o da SVC), ele NÃO
 *   vira o CT-e da carga: fica marcado para ser cancelado (item 11.5.3). Se
 *   não consta (217) e a carga já tem o CT-e da SVC, vira "rejeitado" com o
 *   número dado como usado; sem outro CT-e, continua "sem resposta" (emitir de
 *   novo reenvia o mesmo XML).
 * - Os eventos vinculados que a consulta devolve (`procEventoCTe`) e que o
 *   sistema não tinha são gravados.
 * - Qualquer outra resposta não muda nada: a frase diz o que a SEFAZ respondeu.
 *
 * O CT-e da SVC é consultado na SVC (item 4.5.6).
 */
export async function conferirNaSefaz(empresa: Empresa, cteId: string, quem: Quem): Promise<ConferenciaNaSefaz> {
  const cte = await empresa.db.cte.findUnique({ where: { id: cteId }, select: ALVO_SELECT });
  if (!cte) throw new Refusal(CTE_NAO_ENCONTRADO, 404);
  const semResposta = cte.status === "DRAFT" && cte.unanswered;
  if (!semResposta && cte.status !== "AUTHORIZED" && cte.status !== "CANCELLED") throw new Refusal(SO_ENVIADO_SE_CONFERE, 409);
  const doEmitente = await empresa.db.fiscalIssuer.findUnique({ where: { tenantId: empresa.id }, select: { cnpj: true, state: true } });
  if (!doEmitente) throw new Refusal(SEM_EMITENTE_CADASTRADO, 409);
  const credencial = await credencialDaEmpresa(empresa);
  const ambiente = ambienteDaLinha(cte.environment);

  let resposta: RespostaDaConsulta;
  try {
    resposta = await consultarCte(destinoDaChave(doEmitente.state, ambiente, credencial, cte.accessKey), cte.accessKey);
  } catch (erro) {
    if (erro instanceof SefazError) throw new Refusal(`${erro.message} Nada mudou neste sistema: tente conferir de novo.`, STATUS_DA_FALHA(erro));
    throw erro;
  }
  const lida = frase(resposta.cStat, resposta.motivo);
  const devolver = async (mensagem: string, novos = 0): Promise<ConferenciaNaSefaz> => {
    const atual = await empresa.db.cte.findUniqueOrThrow({ where: { id: cteId }, select: ALVO_SELECT });
    return { cte: paraATela(atual), mensagem, eventos: (await lerEventos(empresa.db, atual)).eventos, novos };
  };
  const eventosNovos = (novos: number) => (novos > 0 ? ` ${novos} evento(s) que este sistema não tinha foram gravados.` : "");

  if (semResposta) {
    const decisao = decidir(resposta, { chave: cte.accessKey, ambiente, resumo: resumoDaAssinatura(cte.xmlSent) });
    const outro = await empresa.db.cte.findFirst({ where: { collectionId: cte.collectionId, environment: cte.environment, status: "AUTHORIZED", id: { not: cte.id } }, select: { number: true } });
    if (decisao.tipo === "autorizado") {
      const preparado: Preparado = { id: cte.id, chave: cte.accessKey, numero: cte.number, xml: cte.xmlSent, ambiente, uf: doEmitente.state, cnpj: doEmitente.cnpj, retomar: true, carga: { id: cte.collectionId, trackingCode: cte.collection.trackingCode } };
      await gravarAutorizacao(empresa, preparado, decisao.protocolo, quem, outro?.number ?? null);
      const novos = await empresa.transacao((tx) => gravarEventosDaConsulta(tx, cte.id, resposta.eventos));
      return devolver(
        outro
          ? `A SEFAZ tinha autorizado o CT-e nº ${cte.number} (protocolo ${decisao.protocolo.numero}), e a carga já tem o CT-e nº ${outro.number}: CANCELE o CT-e nº ${cte.number} (o prazo é de 7 dias da autorização).`
          : `A SEFAZ tinha autorizado o CT-e nº ${cte.number}: ele está gravado, com o protocolo ${decisao.protocolo.numero}.${eventosNovos(novos)}`,
        novos,
      );
    }
    if (decisao.tipo === "finalizado" || (outro && decisao.tipo === "rejeitado" && decisao.cStat === CSTAT.NAO_CONSTA)) {
      const motivo = decisao.tipo === "finalizado" ? decisao.motivo : `A SEFAZ não tem este envio (${frase(decisao.cStat, decisao.motivo)}). A carga ficou com o CT-e nº ${outro?.number ?? ""}.`;
      await gravarSemAutorizacao(empresa, cte.id, { status: "REJECTED", statusCode: decisao.cStat, statusReason: motivo, unanswered: false, numberBurned: true });
      return devolver(decisao.tipo === "finalizado" ? `A SEFAZ informa que o CT-e nº ${cte.number} já está ${decisao.situacao} lá (${lida}): ele não vale como autorizado.` : `A SEFAZ não tem o envio do CT-e nº ${cte.number} (${lida}): ele foi encerrado como rejeitado, e o número não será reutilizado.`);
    }
    if (decisao.tipo === "rejeitado" && decisao.cStat === CSTAT.NAO_CONSTA) return devolver(`A SEFAZ não tem o CT-e nº ${cte.number} (${lida}). Ele continua "sem resposta": emitir de novo reenvia o mesmo XML, sem duplicar.`);
    return devolver(`A consulta não esclareceu a situação do CT-e nº ${cte.number}: ${decisao.tipo === "incoerente" ? decisao.motivo : lida}. Nada mudou.`);
  }

  if (resposta.cStat !== CSTAT.AUTORIZADO && resposta.cStat !== CSTAT.CANCELADO) return devolver(`A SEFAZ respondeu ${lida}. Nada mudou neste sistema.`);
  // A resposta precisa ser deste CT-e: o protocolo de autorização que vem junto é o da chave consultada.
  if (resposta.protocolo && resposta.protocolo.chave !== cte.accessKey) throw new Refusal("A consulta devolveu o protocolo de outra chave de acesso. Nada mudou neste sistema.", 502);

  const canceladoLa = resposta.cStat === CSTAT.CANCELADO;
  const cancelamento = resposta.eventos.find((evento) => evento.tipo === TIPO_DO_CANCELAMENTO) ?? null;
  const novos = await empresa.transacao(async (tx) => {
    const gravados = await gravarEventosDaConsulta(tx, cte.id, resposta.eventos);
    if (canceladoLa && cte.status === "AUTHORIZED") {
      await tx.cte.update({
        where: { id: cte.id },
        data: { status: "CANCELLED", cancelledAt: cancelamento?.registradoEm ?? new Date(), cancelProtocol: cancelamento?.protocolo ?? null, cancelReason: CANCELADO_POR_FORA, statusCode: resposta.cStat, statusReason: resposta.motivo.slice(0, MOTIVO_MAXIMO) },
        select: { id: true },
      });
      await tx.collection.updateMany({ where: { id: cte.collectionId, cteKey: cte.accessKey }, data: { cteStatus: "CANCELLED" } });
      await registrarAuditoria(tx, {
        ...quem,
        acao: "cte.conferir",
        entidade: "cte",
        entidadeId: cte.id,
        resumo: `${doCte(cte)} está cancelado na SEFAZ (${lida}): situação atualizada pela consulta`,
        antes: { status: "AUTHORIZED" },
        depois: { status: "CANCELLED", cancelProtocol: cancelamento?.protocolo ?? null },
      });
      await avisarEquipe(tx, "fiscalVer", avisoDeCte("cancelado", { numero: cte.number, ambiente, carga: cte.collection.trackingCode }), quem.ator.id);
      await avisarIntegracao(tx, "cte.cancelado", cte.id);
    }
    return gravados;
  });

  if (canceladoLa) return devolver(cte.status === "AUTHORIZED" ? `A SEFAZ informa que o CT-e nº ${cte.number} está CANCELADO (${lida}): a situação foi atualizada.${eventosNovos(novos)}` : `O CT-e nº ${cte.number} está cancelado na SEFAZ, como aqui (${lida}).${eventosNovos(novos)}`, novos);
  return devolver(
    cte.status === "CANCELLED"
      ? `A SEFAZ informa que o CT-e nº ${cte.number} está AUTORIZADO (${lida}), e aqui ele consta cancelado: nada foi mudado. Confira o cancelamento.${eventosNovos(novos)}`
      : `O CT-e nº ${cte.number} está autorizado na SEFAZ, como aqui (${lida}).${eventosNovos(novos)}`,
    novos,
  );
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
