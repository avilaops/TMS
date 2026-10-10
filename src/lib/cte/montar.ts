import {
  CFOP_DE_OUTRA_UF,
  CLASSIFICACOES_DO_IBSCBS,
  CST_DO_IBSCBS,
  NOME_EM_HOMOLOGACAO,
  REGIMES_DO_SIMPLES,
  aliquotaInterestadual,
  type Ambiente,
  type Regime,
  type SituacaoDoIcms,
} from "@/lib/cte";
import { CODIGO_DA_UF, MODELO_DO_CTE, TIPO_DE_EMISSAO_NORMAL, chaveDoCte, dataHoraDoEvento, dataHoraDoXml } from "@/lib/cte/chave";
import { codigoDoAmbiente } from "@/lib/cte/enderecos";
import { responsavelTecnicoDoXml, type ResponsavelTecnico } from "@/lib/cte/responsavel-tecnico";
import { centavos, decimal, digitos, escapar, grupo, tag, textoDoXml } from "@/lib/cte/texto";

/**
 * Monta o XML do CT-e (modelo 57, modal rodoviário, leiaute 4.00), ainda sem
 * assinatura. Função pura: recebe os dados já resolvidos (quem é quem, códigos
 * IBGE, valores) e devolve o XML e a chave. Quem resolve os dados a partir da
 * carga é src/lib/cte/preparar.ts.
 *
 * O XML sai numa linha só, sem espaço entre as tags e sem campo opcional vazio,
 * como o MOC pede. A ordem dos elementos é a do esquema
 * (fiscal/esquemas/cte-4.00/cteTiposBasico_v4.00.xsd, tipo `TCTe`); os testes
 * validam o resultado contra o esquema oficial.
 *
 * O que este CT-e é, sempre: tipo normal (`tpCTe` 0), serviço normal
 * (`tpServ` 0), emissão normal (`tpEmis` 1), DACTE em retrato, sem expedidor
 * nem recebedor, sem contingência.
 *
 * IBS e CBS (Reforma Tributária do Consumo): o grupo `imp/IBSCBS` e o total
 * `imp/vTotDFe` vão quando a empresa tem o CST e a classificação tributária
 * configurados (NT 2025.001 do CT-e, v1.14b; a NT 2026.002 passou a exigir o
 * grupo do regime normal, rejeição 310, em homologação desde 01/07/2026).
 *
 * ICMS: o grupo sai da situação tributária da empresa, da UF do emitente e das
 * UF de início e de fim da prestação (`resolverIcms`). As datas com hora vão no
 * fuso da UF do emitente (src/lib/cte/chave.ts). O responsável técnico
 * (`infRespTec`) vai quando o servidor tem os dados dele.
 *
 * O que NÃO vai: a partilha do ICMS com a UF de término (`ICMSUFFim`, o
 * DIFAL do transporte a não contribuinte: a emissão é bloqueada nesse caso);
 * diferimento, devolução, estorno de crédito, tributação regular e compras
 * governamentais do IBS/CBS; o valor líquido da prestação
 * (`vTPrestLiq`, facultativo, NT 2026.004); e o veículo e o motorista como
 * grupos próprios (o modal rodoviário do CT-e 4.00 não os tem: eles são do
 * MDF-e; aqui vão, quando existem, na observação).
 */

export const NAMESPACE_DO_CTE = "http://www.portalfiscal.inf.br/cte";
export const VERSAO_DO_CTE = "4.00";
/** Versão do aplicativo emissor (`ide/verProc`). */
export const VERSAO_DO_EMISSOR = "TMS Avila Ops 1.0";
export const NATUREZA_DA_OPERACAO = "PRESTACAO DE SERVICO DE TRANSPORTE";

export type EnderecoDoCte = {
  logradouro: string;
  numero: string;
  complemento?: string | null;
  bairro: string;
  /** Código IBGE do município, 7 dígitos. */
  codigoMunicipio: string;
  municipio: string;
  uf: string;
  cep?: string | null;
};

export type EmitenteDoCte = {
  cnpj: string;
  ie: string;
  razaoSocial: string;
  fantasia?: string | null;
  endereco: EnderecoDoCte;
  telefone?: string | null;
  rntrc: string;
  regime: Regime;
  serie: number;
  ambiente: Ambiente;
  cfopDentro: string;
  cfopFora: string;
  icms: SituacaoDoIcms;
  /** Alíquota INTERNA do ICMS (prestação que começa e termina na UF do emitente), em %. */
  aliquota: number;
  /** Percentual de redução da base do ICMS (`pRedBC`), só na situação 20. */
  reducaoDaBase?: number | null;
  /** IBS e CBS: a classificação que o contador dá e as alíquotas do ano, em %. `null`: o CT-e vai sem o grupo `IBSCBS`. */
  ibsCbs: ParametrosDoIbsCbs | null;
};

export type ParametrosDoIbsCbs = {
  cst: string;
  /** Código de classificação tributária (`cClassTrib`), 6 dígitos. */
  classe: string;
  ibsUf: number;
  ibsMunicipio: number;
  cbs: number;
  /** PIS e COFINS sobre o frete, em %: saem da base de cálculo do IBS/CBS. */
  pis: number;
  cofins: number;
};

export type ParticipanteDoCte = {
  /** CNPJ (14 dígitos) ou CPF (11). */
  documento: string;
  /** Só dígitos, "ISENTO", ou nulo quando não se sabe. */
  ie?: string | null;
  nome: string;
  fantasia?: string | null;
  telefone?: string | null;
  email?: string | null;
  endereco: EnderecoDoCte;
};

export type LocalDoCte = { codigoMunicipio: string; municipio: string; uf: string };

export type TomadorDoCte = { papel: "REMETENTE" } | { papel: "DESTINATARIO" } | { papel: "OUTRO"; participante: ParticipanteDoCte };

export type DadosDoCte = {
  emitente: EmitenteDoCte;
  numero: number;
  /** Código numérico aleatório, 8 dígitos (`sortearCodigo`). */
  codigo: string;
  emissao: Date;
  remetente: ParticipanteDoCte;
  destinatario: ParticipanteDoCte;
  tomador: TomadorDoCte;
  /** 1 = contribuinte do ICMS, 2 = contribuinte isento de inscrição, 9 = não contribuinte. */
  contribuinte: "1" | "2" | "9";
  inicio: LocalDoCte;
  fim: LocalDoCte;
  /** Valor total da prestação (o frete), que também é o valor a receber. */
  valorDaPrestacao: number;
  /** Componentes do valor (frete peso, pedágio...). Vazio: um componente só, com o total. */
  componentes: readonly { nome: string; valor: number }[];
  valorDaCarga: number;
  produto: string;
  pesoKg: number;
  volumes: number;
  /** Chaves das NF-e transportadas. Vazio: vai uma declaração (`infOutros`) com `documento`. */
  chavesDeNfe: readonly string[];
  /** Número do documento quando não há NF-e (o código de rastreio da carga). */
  documento?: string | null;
  observacao?: string | null;
  /** Endereço da consulta por QR Code do autorizador (src/lib/cte/enderecos.ts). */
  enderecoDoQrCode: string;
  /** A desenvolvedora do sistema (`infRespTec`). Nulo ou ausente: o CT-e vai sem o grupo. */
  responsavelTecnico?: ResponsavelTecnico | null;
};

export type CteMontado = { xml: string; chave: string; id: string; cfop: string; icms: IcmsDoCte; ibsCbs: IbsCbsDoCte | null };

/**
 * O IBS e a CBS do documento. `valores` nulo: a situação tributária não leva o
 * grupo de valores (imunidade e não incidência). `reducao`: o percentual de
 * redução de alíquota da classificação (CST 200), ou `null`; com redução, os
 * valores saem da alíquota efetiva.
 */
export type IbsCbsDoCte = {
  cst: string;
  classe: string;
  valores: {
    base: number;
    ibsUf: number;
    ibsMunicipio: number;
    cbs: number;
    aliquotaDoIbsUf: number;
    aliquotaDoIbsMunicipio: number;
    aliquotaDaCbs: number;
    reducao: number | null;
    /** Alíquotas efetivas (`pAliqEfet`), só com redução. */
    efetivaDoIbsUf: number;
    efetivaDoIbsMunicipio: number;
    efetivaDaCbs: number;
  } | null;
};

/** O grupo de `imp/ICMS` que o CT-e leva. */
export type GrupoDoIcms = "ICMS00" | "ICMS20" | "ICMS45" | "ICMS60" | "ICMS90" | "ICMSOutraUF" | "ICMSSN";

/**
 * O ICMS do documento. `base`, `aliquota` e `valor` são os do grupo (zero no
 * que não destaca). `reducao`: o `pRedBC` da situação 20. `retido`: o valor é o
 * do ICMS retido por substituição tributária (`vICMSSTRet`), que quem recolhe é
 * o substituto, não o emitente.
 */
export type IcmsDoCte = { situacao: SituacaoDoIcms; grupo: GrupoDoIcms; base: number; aliquota: number; valor: number; reducao: number | null; retido: boolean };

/* ------------------------------------ Regras ---------------------------------- */

/**
 * O CFOP da prestação. Dentro do estado (início e fim na mesma UF) vale o da
 * configuração que começa com 5; fora, o que começa com 6. Quando a prestação
 * começa em UF diferente da do emitente, o MOC (Anexo I, regra G051) exige
 * 5932 ou 6932.
 */
export function cfopDaPrestacao(emitente: Pick<EmitenteDoCte, "cfopDentro" | "cfopFora"> & { uf: string }, inicio: string, fim: string): string {
  const dentro = inicio === fim;
  if (emitente.uf !== inicio) return dentro ? CFOP_DE_OUTRA_UF.dentro : CFOP_DE_OUTRA_UF.fora;
  return dentro ? emitente.cfopDentro : emitente.cfopFora;
}

export const CONSULTE_O_CONTADOR = "Consulte o contador.";

/** A prestação começa em outra UF e termina nela mesma: a alíquota é a interna de lá, que o sistema não tem. */
export const bloqueioDaAliquotaDeOutraUf = (uf: string) =>
  `A prestação começa e termina em ${uf}, fora da UF do emitente: o ICMS é devido a ${uf} pela alíquota interna de lá (grupo ICMSOutraUF), que este sistema não tem de fonte confiável. A emissão está bloqueada. ${CONSULTE_O_CONTADOR}`;

/** A prestação começa em outra UF e a empresa usa uma situação que é benefício ou regime da UF dela. */
export const bloqueioDaSituacaoEmOutraUf = (uf: string, situacao: SituacaoDoIcms) =>
  `A prestação começa em ${uf}, fora da UF do emitente: o ICMS é devido a ${uf}, e a situação ${situacao} configurada (redução, isenção, não tributação ou substituição tributária) é da legislação da UF do emitente, não se presume em ${uf}. A emissão está bloqueada. ${CONSULTE_O_CONTADOR}`;

/**
 * Prestação interestadual com tomador não contribuinte do ICMS: a EC 87/2015
 * criou o diferencial de alíquota para a UF de término (grupo `ICMSUFFim` do
 * leiaute: "prestações interestaduais para consumidor final, não contribuinte
 * do ICMS", MOC 4.00, Anexo I, campo 236). O sistema não tem a alíquota
 * interna nem o fundo de combate à pobreza da UF de término, e as exceções (o
 * frete por conta do remetente, o Simples Nacional) dependem de norma que não
 * foi possível conferir na fonte: o caso fica bloqueado.
 */
export const BLOQUEIO_DO_DIFAL =
  `Prestação interestadual com tomador não contribuinte do ICMS: pode haver diferencial de alíquota para a UF de término (grupo ICMSUFFim), que este sistema não calcula. A emissão está bloqueada. Se o tomador é contribuinte, preencha a inscrição estadual no cadastro do cliente; senão, ${CONSULTE_O_CONTADOR.toLowerCase()}`;

type EmitenteDoIcms = Pick<EmitenteDoCte, "icms" | "aliquota" | "regime" | "reducaoDaBase"> & { uf: string };

/**
 * O ICMS da prestação, ou o motivo pelo qual o sistema não o calcula
 * (`bloqueio`: a emissão para, com a frase para a pessoa).
 *
 * - Simples Nacional (pelo regime ou pela situação): `ICMSSN`, sem valores.
 * - Prestação que começa na UF do emitente: o grupo da situação configurada
 *   (00, 20, 45 para 40/41, 60 ou 90). A alíquota é a interna da configuração
 *   quando a prestação termina na mesma UF, e a interestadual da Resolução do
 *   Senado 22/1989 (7% ou 12%, `aliquotaInterestadual`) quando termina em outra.
 * - Prestação que começa em OUTRA UF (CFOP 5932/6932): o ICMS é devido à UF de
 *   início, no grupo `ICMSOutraUF` (MOC 4.00, Anexo I, campo 225: "ICMS devido
 *   à UF de origem da prestação, quando diferente da UF do emitente"), CST 90.
 *   Interestadual: alíquota da Resolução 22/1989 a partir da UF de início. Dentro
 *   da outra UF: bloqueio (a alíquota interna de lá não é conhecida). Situação
 *   20, 40, 41 ou 60: bloqueio (o benefício é da UF do emitente).
 *
 * Base: o valor da prestação (com a redução, na situação 20).
 */
export function resolverIcms(emitente: EmitenteDoIcms, valorDaPrestacao: number, ufDeInicio: string, ufDeFim: string): { icms: IcmsDoCte } | { bloqueio: string } {
  const semValores = (grupoDoIcms: GrupoDoIcms): { icms: IcmsDoCte } => ({ icms: { situacao: emitente.icms, grupo: grupoDoIcms, base: 0, aliquota: 0, valor: 0, reducao: null, retido: false } });
  // O grupo do Simples vale pelo regime, não só pela escolha: quem é do Simples não destaca ICMS no CT-e.
  if (emitente.icms === "SN" || REGIMES_DO_SIMPLES.includes(emitente.regime)) return semValores("ICMSSN");

  const total = centavos(valorDaPrestacao);
  const interestadual = aliquotaInterestadual(ufDeInicio, ufDeFim);
  const destacado = (grupoDoIcms: GrupoDoIcms, base: number, aliquota: number, reducao: number | null = null, retido = false): { icms: IcmsDoCte } => ({
    icms: { situacao: emitente.icms, grupo: grupoDoIcms, base, aliquota, valor: centavos((base * aliquota) / 100), reducao, retido },
  });

  if (ufDeInicio !== emitente.uf) {
    if (emitente.icms !== "00" && emitente.icms !== "90") return { bloqueio: bloqueioDaSituacaoEmOutraUf(ufDeInicio, emitente.icms) };
    if (interestadual === null) return { bloqueio: bloqueioDaAliquotaDeOutraUf(ufDeInicio) };
    return destacado("ICMSOutraUF", total, interestadual);
  }

  if (emitente.icms === "40" || emitente.icms === "41") return semValores("ICMS45");
  const aliquota = interestadual ?? emitente.aliquota;
  if (emitente.icms === "20") {
    const reducao = emitente.reducaoDaBase ?? 0;
    return destacado("ICMS20", centavos(total * (1 - reducao / 100)), aliquota, reducao);
  }
  if (emitente.icms === "60") return destacado("ICMS60", total, aliquota, null, true);
  return destacado(emitente.icms === "90" ? "ICMS90" : "ICMS00", total, aliquota);
}

/** O ICMS da prestação. Caso bloqueado é erro de programação aqui: quem chama já conferiu com `resolverIcms`. */
export function icmsDaPrestacao(emitente: EmitenteDoIcms, valorDaPrestacao: number, ufDeInicio: string, ufDeFim: string): IcmsDoCte {
  const resolvido = resolverIcms(emitente, valorDaPrestacao, ufDeInicio, ufDeFim);
  if ("bloqueio" in resolvido) throw new Error(resolvido.bloqueio);
  return resolvido.icms;
}

/** Alíquota com até 4 casas, sem resto de ponto flutuante. */
const quatroCasas = (valor: number) => Math.round((valor + Number.EPSILON) * 1e4) / 1e4;

/**
 * O IBS e a CBS da prestação. `null` quando a empresa não tem a classificação
 * configurada.
 *
 * Base de cálculo: o valor da prestação menos o ICMS, o PIS e a COFINS que ela
 * carrega (LC 214/2025, art. 12, § 2º, V: até 2032 esses tributos não integram
 * a base do IBS e da CBS). É a mesma conta que o ERP da casa faz na NF-e (regra
 * UB16-10 da NT 2025.002). A NT do CT-e não confere a base; confere os valores
 * contra ela: valor = base × alíquota, com tolerância de 1 centavo (regras 014,
 * 022 e 029, rejeições 318, 323 e 327).
 *
 * O ICMS retido por substituição tributária (situação 60) NÃO é descontado da
 * base: quem o recolhe é o substituto, e a norma não diz que ele sai do valor
 * da prestação do substituído. A conferência avisa: é ponto para o contador.
 *
 * Com redução de alíquota (CST 200): a alíquota efetiva é a alíquota × (1 −
 * redução/100), e o valor sai dela (NT 2025.001, regras 009b, 017b e 024b, e a
 * "Observação 2" das regras 014, 022 e 029). O percentual de redução é o da
 * tabela de classificação (`CLASSIFICACOES_DO_IBSCBS`).
 */
export function ibsCbsDaPrestacao(emitente: Pick<EmitenteDoCte, "ibsCbs">, valorDaPrestacao: number, icms: Pick<IcmsDoCte, "valor" | "retido">): IbsCbsDoCte | null {
  const parametros = emitente.ibsCbs;
  if (!parametros) return null;
  const situacao = CST_DO_IBSCBS[parametros.cst];
  if (!situacao?.comValores) return { cst: parametros.cst, classe: parametros.classe, valores: null };
  const reducao = situacao.comReducao ? (CLASSIFICACOES_DO_IBSCBS[parametros.classe]?.reducao ?? 0) : null;
  const fator = 1 - (reducao ?? 0) / 100;
  const efetivaDoIbsUf = quatroCasas(parametros.ibsUf * fator);
  const efetivaDoIbsMunicipio = quatroCasas(parametros.ibsMunicipio * fator);
  const efetivaDaCbs = quatroCasas(parametros.cbs * fator);
  const pis = centavos((valorDaPrestacao * parametros.pis) / 100);
  const cofins = centavos((valorDaPrestacao * parametros.cofins) / 100);
  const base = Math.max(0, centavos(valorDaPrestacao - (icms.retido ? 0 : icms.valor) - pis - cofins));
  return {
    cst: parametros.cst,
    classe: parametros.classe,
    valores: {
      base,
      ibsUf: centavos((base * efetivaDoIbsUf) / 100),
      ibsMunicipio: centavos((base * efetivaDoIbsMunicipio) / 100),
      cbs: centavos((base * efetivaDaCbs) / 100),
      aliquotaDoIbsUf: parametros.ibsUf,
      aliquotaDoIbsMunicipio: parametros.ibsMunicipio,
      aliquotaDaCbs: parametros.cbs,
      reducao,
      efetivaDoIbsUf,
      efetivaDoIbsMunicipio,
      efetivaDaCbs,
    },
  };
}

/** A observação com o veículo e o motorista da viagem, quando a carga está numa. */
export function observacaoDaViagem(viagem: { placa: string | null; motorista: string | null } | null): string | null {
  if (!viagem) return null;
  const partes = [viagem.placa ? `Veiculo placa ${viagem.placa}` : null, viagem.motorista ? `Motorista ${viagem.motorista}` : null].filter(Boolean);
  return partes.length > 0 ? `${partes.join(". ")}.` : null;
}

/* ------------------------------------- XML ------------------------------------ */

const documentoDoXml = (documento: string) => (documento.length === 11 ? tag("CPF", documento) : tag("CNPJ", documento));

/** `TIeDest`: até 14 dígitos ou o literal ISENTO. O que não couber fica de fora. */
function inscricaoDoXml(ie: string | null | undefined): string {
  const valor = (ie ?? "").trim().toUpperCase();
  if (valor === "ISENTO" || valor === "ISENTA") return tag("IE", "ISENTO");
  const numeros = digitos(valor);
  return numeros.length >= 2 && numeros.length <= 14 ? tag("IE", numeros) : "";
}

const telefoneDoXml = (telefone: string | null | undefined) => {
  const numeros = digitos(telefone);
  return numeros.length >= 6 && numeros.length <= 14 ? tag("fone", numeros) : "";
};

const emailDoXml = (email: string | null | undefined) => {
  const valor = (email ?? "").trim();
  return valor.length <= 60 && /^[^@\s]+@[^.\s]+\.\S+$/.test(valor) ? tag("email", valor) : "";
};

function enderecoDoXml(endereco: EnderecoDoCte, limiteDoLogradouro: number): string {
  const cep = digitos(endereco.cep);
  return [
    tag("xLgr", textoDoXml(endereco.logradouro, limiteDoLogradouro)),
    tag("nro", textoDoXml(endereco.numero, 60) || "S/N"),
    tag("xCpl", textoDoXml(endereco.complemento, 60)),
    tag("xBairro", textoDoXml(endereco.bairro, 60)),
    tag("cMun", endereco.codigoMunicipio),
    tag("xMun", textoDoXml(endereco.municipio, 60)),
    cep.length === 8 ? tag("CEP", cep) : "",
    tag("UF", endereco.uf),
  ].join("");
}

function participanteDoXml(grupoDoXml: "rem" | "dest", endereco: "enderReme" | "enderDest", parte: ParticipanteDoCte, ambiente: Ambiente): string {
  // Em homologação a razão social de remetente e destinatário é a frase do MOC, senão a SEFAZ rejeita (646 e 649).
  const nome = ambiente === "HOMOLOGACAO" ? NOME_EM_HOMOLOGACAO : textoDoXml(parte.nome, 60);
  return grupo(
    grupoDoXml,
    [
      documentoDoXml(parte.documento),
      inscricaoDoXml(parte.ie),
      tag("xNome", nome),
      // Só o remetente tem nome fantasia no esquema.
      grupoDoXml === "rem" ? tag("xFant", textoDoXml(parte.fantasia, 60)) : "",
      telefoneDoXml(parte.telefone),
      grupo(endereco, enderecoDoXml(parte.endereco, 255)),
      emailDoXml(parte.email),
    ].join(""),
  );
}

function tomadorDoXml(tomador: TomadorDoCte): string {
  if (tomador.papel === "REMETENTE") return grupo("toma3", tag("toma", "0"));
  if (tomador.papel === "DESTINATARIO") return grupo("toma3", tag("toma", "3"));
  const parte = tomador.participante;
  return grupo(
    "toma4",
    [
      tag("toma", "4"),
      documentoDoXml(parte.documento),
      inscricaoDoXml(parte.ie),
      tag("xNome", textoDoXml(parte.nome, 60)),
      tag("xFant", textoDoXml(parte.fantasia, 60)),
      telefoneDoXml(parte.telefone),
      grupo("enderToma", enderecoDoXml(parte.endereco, 255)),
      emailDoXml(parte.email),
    ].join(""),
  );
}

/** O grupo de `imp/ICMS`, na ordem dos campos do esquema (`TImp`). */
function icmsDoXml(icms: IcmsDoCte): string {
  const base = decimal(icms.base, 2);
  const aliquota = decimal(icms.aliquota, 2);
  const valor = decimal(icms.valor, 2);
  switch (icms.grupo) {
    case "ICMSSN":
      return grupo("ICMSSN", tag("CST", "90") + tag("indSN", "1"));
    case "ICMS45":
      return grupo("ICMS45", tag("CST", icms.situacao));
    case "ICMS20":
      return grupo("ICMS20", tag("CST", "20") + tag("pRedBC", decimal(icms.reducao ?? 0, 2)) + tag("vBC", base) + tag("pICMS", aliquota) + tag("vICMS", valor));
    case "ICMS60":
      return grupo("ICMS60", tag("CST", "60") + tag("vBCSTRet", base) + tag("vICMSSTRet", valor) + tag("pICMSSTRet", aliquota));
    case "ICMSOutraUF":
      return grupo("ICMSOutraUF", tag("CST", "90") + tag("vBCOutraUF", base) + tag("pICMSOutraUF", aliquota) + tag("vICMSOutraUF", valor));
    case "ICMS90":
      return grupo("ICMS90", tag("CST", "90") + tag("vBC", base) + tag("pICMS", aliquota) + tag("vICMS", valor));
    default:
      return grupo("ICMS00", tag("CST", "00") + tag("vBC", base) + tag("pICMS", aliquota) + tag("vICMS", valor));
  }
}

/** Alíquota do IBS e da CBS (`TDec_0302_04RTC`): de 2 a 4 casas. */
const aliquotaDoXml = (aliquota: number) => {
  const comQuatro = aliquota.toFixed(4);
  return comQuatro.endsWith("00") ? comQuatro.slice(0, -2) : comQuatro;
};

/** O grupo `gRed` (`TRed`): o percentual de redução da classificação e a alíquota efetiva. Nada sem redução. */
const reducaoDoXml = (reducao: number | null, efetiva: number) => (reducao === null ? "" : grupo("gRed", tag("pRedAliq", aliquotaDoXml(reducao)) + tag("pAliqEfet", aliquotaDoXml(efetiva))));

/**
 * O grupo `IBSCBS` e, depois dele, o total do documento (`vTotDFe`), que a
 * SEFAZ exige sempre que o grupo existe (rejeição 360). O total repete o valor
 * da prestação: em 2026 o IBS e a CBS não se somam (NT 2025.001, item 7) e, a
 * partir de 2027, eles já vêm dentro do `vTPrest` (NT 2026.004, itens 1 e 5).
 */
function ibsCbsDoXml(ibsCbs: IbsCbsDoCte | null, total: number): string {
  if (!ibsCbs) return "";
  const v = ibsCbs.valores;
  const valores = v
    ? grupo(
        "gIBSCBS",
        [
          tag("vBC", decimal(v.base, 2)),
          grupo("gIBSUF", tag("pIBSUF", aliquotaDoXml(v.aliquotaDoIbsUf)) + reducaoDoXml(v.reducao, v.efetivaDoIbsUf) + tag("vIBSUF", decimal(v.ibsUf, 2))),
          grupo("gIBSMun", tag("pIBSMun", aliquotaDoXml(v.aliquotaDoIbsMunicipio)) + reducaoDoXml(v.reducao, v.efetivaDoIbsMunicipio) + tag("vIBSMun", decimal(v.ibsMunicipio, 2))),
          tag("vIBS", decimal(centavos(v.ibsUf + v.ibsMunicipio), 2)),
          grupo("gCBS", tag("pCBS", aliquotaDoXml(v.aliquotaDaCbs)) + reducaoDoXml(v.reducao, v.efetivaDaCbs) + tag("vCBS", decimal(v.cbs, 2))),
        ].join(""),
      )
    : "";
  return grupo("IBSCBS", tag("CST", ibsCbs.cst) + tag("cClassTrib", ibsCbs.classe) + valores) + tag("vTotDFe", decimal(total, 2));
}

function componentesDoXml(dados: DadosDoCte, total: number): string {
  const validos = dados.componentes.map((c) => ({ nome: textoDoXml(c.nome, 15), valor: centavos(c.valor) })).filter((c) => c.nome !== "" && c.valor > 0);
  const soma = centavos(validos.reduce((acumulado, c) => acumulado + c.valor, 0));
  // Os componentes só vão quando fecham com o total; senão vai um só, com o total (a SEFAZ confere a soma).
  const lista = validos.length > 0 && soma === total ? validos : [{ nome: "FRETE", valor: total }];
  return lista.map((c) => grupo("Comp", tag("xNome", c.nome) + tag("vComp", decimal(c.valor, 2)))).join("");
}

function documentosDoXml(dados: DadosDoCte): string {
  if (dados.chavesDeNfe.length > 0) {
    return grupo("infDoc", [...new Set(dados.chavesDeNfe)].map((chave) => grupo("infNFe", tag("chave", chave))).join(""));
  }
  // Sem NF-e: declaração (tpDoc 00), com o número que identifica a carga.
  return grupo("infDoc", grupo("infOutros", tag("tpDoc", "00") + tag("nDoc", textoDoXml(dados.documento, 20))));
}

/** Monta o CT-e. Dado fora do formato é erro de programação: quem chama já conferiu (src/lib/cte/preparar.ts). */
export function montarCte(dados: DadosDoCte): CteMontado {
  const { emitente } = dados;
  const ambiente = emitente.ambiente;
  const chave = chaveDoCte({ uf: emitente.endereco.uf, emissao: dados.emissao, cnpj: emitente.cnpj, serie: emitente.serie, numero: dados.numero, codigo: dados.codigo });
  const id = `CTe${chave}`;

  const total = centavos(dados.valorDaPrestacao);
  const cfop = cfopDaPrestacao({ ...emitente, uf: emitente.endereco.uf }, dados.inicio.uf, dados.fim.uf);
  const icms = icmsDaPrestacao({ ...emitente, uf: emitente.endereco.uf }, total, dados.inicio.uf, dados.fim.uf);
  const ibsCbs = ibsCbsDaPrestacao(emitente, total, icms);

  const ide = grupo(
    "ide",
    [
      tag("cUF", CODIGO_DA_UF[emitente.endereco.uf]),
      tag("cCT", dados.codigo),
      tag("CFOP", cfop),
      tag("natOp", NATUREZA_DA_OPERACAO),
      tag("mod", MODELO_DO_CTE),
      tag("serie", String(emitente.serie)),
      tag("nCT", String(dados.numero)),
      tag("dhEmi", dataHoraDoXml(dados.emissao, emitente.endereco.uf)),
      tag("tpImp", "1"),
      tag("tpEmis", TIPO_DE_EMISSAO_NORMAL),
      tag("cDV", chave.slice(43)),
      tag("tpAmb", codigoDoAmbiente(ambiente)),
      tag("tpCTe", "0"),
      tag("procEmi", "0"),
      tag("verProc", VERSAO_DO_EMISSOR),
      tag("cMunEnv", emitente.endereco.codigoMunicipio),
      tag("xMunEnv", textoDoXml(emitente.endereco.municipio, 60)),
      tag("UFEnv", emitente.endereco.uf),
      tag("modal", "01"),
      tag("tpServ", "0"),
      tag("cMunIni", dados.inicio.codigoMunicipio),
      tag("xMunIni", textoDoXml(dados.inicio.municipio, 60)),
      tag("UFIni", dados.inicio.uf),
      tag("cMunFim", dados.fim.codigoMunicipio),
      tag("xMunFim", textoDoXml(dados.fim.municipio, 60)),
      tag("UFFim", dados.fim.uf),
      // 1 = o recebedor não retira a carga no destino: a transportadora entrega.
      tag("retira", "1"),
      tag("indIEToma", dados.contribuinte),
      tomadorDoXml(dados.tomador),
    ].join(""),
  );

  const compl = grupo("compl", tag("xObs", textoDoXml(dados.observacao, 2000)));

  const emit = grupo(
    "emit",
    [
      tag("CNPJ", emitente.cnpj),
      tag("IE", digitos(emitente.ie)),
      tag("xNome", textoDoXml(emitente.razaoSocial, 60)),
      tag("xFant", textoDoXml(emitente.fantasia, 60)),
      grupo("enderEmit", enderecoDoXml(emitente.endereco, 60) + telefoneDoXml(emitente.telefone)),
      tag("CRT", emitente.regime),
    ].join(""),
  );

  const vPrest = grupo("vPrest", tag("vTPrest", decimal(total, 2)) + tag("vRec", decimal(total, 2)) + componentesDoXml(dados, total));
  const imp = grupo("imp", grupo("ICMS", icmsDoXml(icms)) + ibsCbsDoXml(ibsCbs, total));

  const infCarga = grupo(
    "infCarga",
    [
      tag("vCarga", decimal(centavos(dados.valorDaCarga), 2)),
      tag("proPred", textoDoXml(dados.produto, 60) || "DIVERSOS"),
      grupo("infQ", tag("cUnid", "01") + tag("tpMed", "PESO BRUTO") + tag("qCarga", decimal(dados.pesoKg, 4))),
      grupo("infQ", tag("cUnid", "03") + tag("tpMed", "VOLUMES") + tag("qCarga", decimal(dados.volumes, 4))),
    ].join(""),
  );

  const infModal = grupo("infModal", montarModalRodoviario(emitente.rntrc), ` versaoModal="${VERSAO_DO_CTE}"`);
  const infCTeNorm = grupo("infCTeNorm", infCarga + documentosDoXml(dados) + infModal);

  const infCte = grupo(
    "infCte",
    [ide, compl, emit, participanteDoXml("rem", "enderReme", dados.remetente, ambiente), participanteDoXml("dest", "enderDest", dados.destinatario, ambiente), vPrest, imp, infCTeNorm, responsavelTecnicoDoXml(dados.responsavelTecnico)].join(""),
    ` versao="${VERSAO_DO_CTE}" Id="${id}"`,
  );

  const qrCode = `${dados.enderecoDoQrCode}?chCTe=${chave}&tpAmb=${codigoDoAmbiente(ambiente)}`;
  const infCTeSupl = grupo("infCTeSupl", `<qrCodCTe>${escapar(qrCode)}</qrCodCTe>`);

  return { xml: `<CTe xmlns="${NAMESPACE_DO_CTE}">${infCte}${infCTeSupl}</CTe>`, chave, id, cfop, icms, ibsCbs };
}

/** O grupo do modal rodoviário (`rodo`), que o esquema do CT-e não confere: tem esquema próprio (cteModalRodoviario_v4.00.xsd). */
export function montarModalRodoviario(rntrc: string): string {
  return grupo("rodo", tag("RNTRC", digitos(rntrc)));
}

/* ----------------------------------- Evento ----------------------------------- */

export const TIPO_DO_CANCELAMENTO = "110111";

export type DadosDoCancelamento = {
  chave: string;
  /** CNPJ do emitente (o autor do evento). */
  cnpj: string;
  ambiente: Ambiente;
  /** Protocolo de autorização do CT-e a cancelar. */
  protocolo: string;
  justificativa: string;
  quando: Date;
};

/**
 * O evento de cancelamento (110111), ainda sem assinatura (MOC 4.00, itens 6 e
 * 6.2). O Id é "ID" + tipo do evento + chave + sequência com 3 dígitos; o órgão
 * é a UF que autorizou o CT-e (os 2 primeiros dígitos da chave).
 */
export function montarCancelamento(dados: DadosDoCancelamento): { xml: string; id: string } {
  const id = `ID${TIPO_DO_CANCELAMENTO}${dados.chave}001`;
  const detalhe = grupo(
    "detEvento",
    grupo("evCancCTe", tag("descEvento", "Cancelamento") + tag("nProt", dados.protocolo) + tag("xJust", textoDoXml(dados.justificativa, 255))),
    ` versaoEvento="${VERSAO_DO_CTE}"`,
  );
  const infEvento = grupo(
    "infEvento",
    [
      tag("cOrgao", dados.chave.slice(0, 2)),
      tag("tpAmb", codigoDoAmbiente(dados.ambiente)),
      tag("CNPJ", dados.cnpj),
      tag("chCTe", dados.chave),
      tag("dhEvento", dataHoraDoEvento(dados.quando, dados.chave)),
      tag("tpEvento", TIPO_DO_CANCELAMENTO),
      tag("nSeqEvento", "1"),
      detalhe,
    ].join(""),
    ` Id="${id}"`,
  );
  return { xml: `<eventoCTe xmlns="${NAMESPACE_DO_CTE}" versao="${VERSAO_DO_CTE}">${infEvento}</eventoCTe>`, id };
}

/** O CT-e autorizado com o protocolo (`cteProc`): é o arquivo que a transportadora guarda e entrega ao cliente. */
export function montarProcCte(xmlAssinado: string, protocolo: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><cteProc xmlns="${NAMESPACE_DO_CTE}" versao="${VERSAO_DO_CTE}">${xmlAssinado}${protocolo}</cteProc>`;
}
